/**
 * Explicitly authorized Muse subagent transcript diagnostic.
 *
 * Runs against an isolated host/session/workspace while inheriting OMP's personal
 * profile. Before the sole provider turn it pins and reads back the exact model
 * and confirms provider auth metadata without reading credential material. A
 * failed selection/auth check stops before spend; a failed observation is recorded without retry.
 *
 * Run: bun scripts/omp-agents-muse-live-proof.ts
 */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";
import { attestOmpRuntime } from "./lib/omp-runtime-integrity.ts";

const MODEL = "opencode-go/muse-spark-1.3-contributor";
const DEADLINE_MS = 240_000;
const ROOT = resolve(import.meta.dir, "..");
const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/") ? resolve(requested) : (process.env.PATH ?? "").split(delimiter).map(p => join(p, requested)).find(Boolean) ?? requested;
const attestation = attestOmpRuntime(ROOT, executable);
if (!attestation.sourceVerified) throw new Error("Refusing live provider proof: OMP runtime source is not attested");
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
if (!isSupportedOmpVersion(version)) throw new Error(`Unsupported OMP runtime: ${version}`);
if (!process.env.HOME) throw new Error("Refusing live provider proof: HOME is required for OMP-native auth");

const scratch = await mkdtemp(join(tmpdir(), "cedia-muse-agents-"));
let started: Awaited<ReturnType<typeof startHostServer>> | undefined;
let turnDispatched = false;
const diagnostic: Record<string, unknown> = { model: MODEL, runtime: version, runtimeAttested: attestation.sourceVerified };
const say = (line: string) => console.log(line);
function check(condition: unknown, line: string): asserts condition { if (!condition) throw new Error(line); say(`OK   ${line}`); }
const obj = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected host response shape");
	return value as Record<string, unknown>;
};
const nap = (ms: number) => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const safeReason = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	return value.replaceAll(scratch, "<scratch>").replaceAll(homedir(), "<home>").slice(0, 240);
};
const childFileStats = async (sessionFile: unknown): Promise<Record<string, unknown> | undefined> => {
	if (typeof sessionFile !== "string" || !sessionFile.startsWith(scratch)) return undefined;
	try {
		const [metadata, raw] = await Promise.all([stat(sessionFile), readFile(sessionFile, "utf8")]);
		const completeLines = raw.split("\n").filter(Boolean);
		let messageLines = 0;
		for (const line of completeLines) {
			try { if (obj(JSON.parse(line)).type === "message") messageLines += 1; } catch { /* count malformed lines without exposing them */ }
		}
		return { file: "<scratch child JSONL>", byteLength: metadata.size, completeLines: completeLines.length, messageLines };
	} catch (error) { return { file: "<scratch child JSONL>", readError: safeReason(error instanceof Error ? error.message : error) }; }
};
try {
	const projectPath = join(scratch, "project");
	await (await import("node:fs/promises")).mkdir(projectPath);
	started = await startHostServer({
		stateDir: join(scratch, "host"), port: 0, ompExecutable: executable, virtualUi: true,
		ompArgs: ["--no-skills", "--no-rules", "--no-extensions"],
		ompEnv: { HOME: homedir(), PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", CEDIA_NODE: process.execPath },
	});
	const owner = started.auth.ownerToken;
	const route = async (method: string, path: string, body?: unknown) => started!.router({ method, path, token: owner, ...(body === undefined ? {} : { body }) });
	const unwrap = async (body: unknown): Promise<unknown> => {
		const item = obj(body);
		if (!item.cediaResponseReference) return body;
		const ref = obj(item.cediaResponseReference);
		let text = "";
		for (let offset = 0; offset < Number(ref.length);) {
			const chunk = obj((await route("GET", `/v1/responses/${String(ref.sha256)}?offset=${offset}`)).body);
			const part = String(chunk.text ?? "");
			if (!part) throw new Error("Host response reference returned an empty page");
			text += part;
			offset += part.length;
		}
		return JSON.parse(text);
	};
	const project = started.host.store.createProject({ path: projectPath, name: "Muse subagent proof" });
	const session = started.host.createSession(project.id, "Muse subagent proof");
	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const selected = await route("POST", `/v1/sessions/${session.id}/commands`, {
		commandId: "muse-agents-select", incarnation, command: "set_model",
		payload: { provider: "opencode-go", modelId: "muse-spark-1.3-contributor" },
	});
	check(selected.status === 200, `OMP accepts the requested model before a turn (HTTP ${selected.status})`);
	const stateResponse = await route("GET", `/v1/sessions/${session.id}/model-state`);
	const state = obj(stateResponse.body);
	const selectedModel = obj(state.model);
	check(state.available === true && selectedModel.provider === "opencode-go" && selectedModel.id === "muse-spark-1.3-contributor", `effective model reads back exactly as ${MODEL}`);
	diagnostic.modelSelected = true;
	const authResponse = await route("GET", "/v1/providers");
	check(authResponse.status === 200, `OMP provider auth metadata is readable before a turn (HTTP ${authResponse.status})`);
	const providers = obj(authResponse.body).providers;
	check(Array.isArray(providers), "OMP returned provider auth metadata");
	const go = (providers as unknown[]).map(obj).find(row => row.id === "opencode-go");
	check(go?.authenticated === true && go.available === true, "opencode-go is available and authenticated before spend");
	diagnostic.providerAuthenticated = true;

	const dispatched = await route("POST", `/v1/sessions/${session.id}/commands`, {
		commandId: "muse-agents-tan", incarnation, command: "prompt",
		payload: { message: "/tan Reply with exactly SUBAGENT_PROOF_DONE. Do not use tools or modify files. Stop after replying." },
	});
	check(dispatched.status === 200, `one /tan dispatch is accepted (HTTP ${dispatched.status})`);
	turnDispatched = true;
	diagnostic.turnDispatched = true;
	const deadline = Date.now() + DEADLINE_MS;
	let worker: Record<string, unknown> | undefined;
	while (Date.now() < deadline) {
		const rosterResponse = await route("GET", `/v1/sessions/${session.id}/agents`);
		const roster = obj(rosterResponse.body);
		const rows = Array.isArray(roster.agents) ? roster.agents.map(obj) : [];
		worker = rows.find(row => row.kind === "sub" && row.parentId === "Main" && row.status === "parked");
		if (worker) break;
		await nap(1500);
	}
	if (!worker) {
		const roster = obj((await route("GET", `/v1/sessions/${session.id}/agents`)).body);
		const running = (Array.isArray(roster.agents) ? roster.agents.map(obj) : []).find(row => row.kind === "sub" && row.status === "running");
		if (running) await route("POST", `/v1/sessions/${session.id}/agents/kill`, { commandId: "muse-agents-timeout-kill", incarnation, id: running.id });
		throw new Error(`Muse subagent did not park within ${DEADLINE_MS}ms; stopped and not retried`);
	}
	const id = String(worker.id);
	diagnostic.child = { id, kind: worker.kind, parentId: worker.parentId, status: worker.status, sessionFile: typeof worker.sessionFile === "string" ? "<scratch child JSONL>" : undefined };
	diagnostic.childJsonl = await childFileStats(worker.sessionFile);
	check(worker.parentId === "Main" && worker.status === "parked", `real OMP subagent ${id} parked under Main`);
	const transcriptResponse = await route("GET", `/v1/sessions/${session.id}/agents/${encodeURIComponent(id)}/transcript`);
	diagnostic.transcriptHttpStatus = transcriptResponse.status;
	check(transcriptResponse.status === 200, "the child transcript is readable through the host route");
	const transcript = obj(await unwrap(transcriptResponse.body));
	diagnostic.transcript = { state: transcript.state, reason: safeReason(transcript.reason), fromByte: transcript.fromByte, nextByte: transcript.nextByte, messageCount: Array.isArray(transcript.messages) ? transcript.messages.length : undefined };
	const messages = Array.isArray(transcript.messages) ? transcript.messages.map(obj) : [];
	const projectedText = messages.map(message => String(message.text ?? ""));
	const proofText = projectedText.join("\n");
	const completionObserved = proofText.includes("SUBAGENT_PROOF_DONE");
	check(transcript.state === "available" && messages.length > 0, "the child transcript response contains persisted messages");
	check(completionObserved, "the child transcript contains the requested completion marker");
	const before = JSON.stringify(messages.map(({ role, text, otherParts }) => ({ role, text, otherParts })));
	const stale = await route("POST", `/v1/sessions/${session.id}/agents/revive`, { commandId: "muse-agents-stale-revive", incarnation: "stale-incarnation", id });
	check(stale.status === 409 && obj(obj(stale.body).error).code === "stale_incarnation", "stale incarnation revive is refused with 409");
	check(started.host.store.getCommand(session.id, "muse-agents-stale-revive") === undefined, "stale revive creates no durable command receipt");
	const revived = await route("POST", `/v1/sessions/${session.id}/agents/revive`, { commandId: "muse-agents-revive", incarnation, id });
	const reviveBody = obj(revived.body);
	check(revived.status === 200 && reviveBody.available === true && reviveBody.revived === true, "owner revive restores the parked subagent");
	const afterRoster = obj((await route("GET", `/v1/sessions/${session.id}/agents`)).body);
	const afterWorker = (Array.isArray(afterRoster.agents) ? afterRoster.agents.map(obj) : []).find(row => row.id === id);
	check(afterWorker?.status === "idle", "revived child is idle and has not started an unrequested turn");
	const afterTranscript = obj(await unwrap((await route("GET", `/v1/sessions/${session.id}/agents/${encodeURIComponent(id)}/transcript`)).body));
	const afterMessages = Array.isArray(afterTranscript.messages) ? afterTranscript.messages.map(obj) : [];
	check(JSON.stringify(afterMessages.map(({ role, text, otherParts }) => ({ role, text, otherParts }))) === before, "revive leaves the child transcript unchanged");
	say(JSON.stringify({ result: "ok", model: MODEL, providerAuthenticated: true, providerTurns: 1, childId: id, lineage: worker.parentId, finalStatus: afterWorker.status, transcriptMessages: messages.length, reviveTranscriptUnchanged: true, runtime: version, attestation }));
} catch (error) {
	diagnostic.result = turnDispatched ? "failed-after-dispatch" : "stopped-before-provider-turn";
	diagnostic.error = safeReason(error instanceof Error ? error.message : error);
	diagnostic.providerTurns = turnDispatched ? 1 : 0;
	say(JSON.stringify({ ...diagnostic, attestation }));
	process.exitCode = 1;
} finally {
	await started?.close();
	await rm(scratch, { recursive: true, force: true });
}
