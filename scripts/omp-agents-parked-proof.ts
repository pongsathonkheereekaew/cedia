/**
 * Fixture-backed proof of Cedia's O07 revive path against a genuinely parked agent
 * (plan §8.2 O07). NOT a real-provider proof.
 *
 * A loopback stub answers every `POST /chat/completions` with one canned SSE text turn
 * (standard OpenAI wire: role preamble, content delta, stop + usage, `[DONE]`), so a
 * `/tan` dispatched through the host commands route completes and parks through the
 * runtime's own controller path (`setStatus parked` + dispose + detach). Cedia's own
 * owner-only durable revive route then restores it through the lifecycle's own
 * `ensureLive`. Zero provider involvement: no credentials, no cost, loopback only.
 * Production code is untouched — the parked state comes from the real controller path.
 *
 * Run: bun scripts/omp-agents-parked-proof.ts
 */
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP agents parked proof failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP agents parked proof failed: ${message}`);
	return value as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
	? resolve(requested)
	: ((process.env.PATH ?? "")
			.split(delimiter)
			.map(dir => join(dir, requested))
			.find(candidate => candidate) ?? requested);
check(await exists(executable), `OMP runtime is present at ${executable}`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);

let completions = 0;
const stub: Server = createServer((req, res) => {
	if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: "fixture stub answers only POST .../chat/completions" }));
		return;
	}
	req.resume();
	req.on("end", () => {
		completions += 1;
		const id = `chatcmpl-fixture-${completions}`;
		const chunk = (delta: string, finish: string | null, usage: boolean) =>
			`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "cedia-parked-proof-model", choices: [{ index: 0, delta: JSON.parse(delta), finish_reason: finish }], ...(usage ? { usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } } : {}) })}\n\n`;
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
		res.write(chunk(`{"role":"assistant","content":""}`, null, false));
		res.write(chunk(`{"content":"Standing by. No action needed."}`, null, false));
		res.write(chunk(`{}`, "stop", true));
		res.write("data: [DONE]\n\n");
		res.end();
	});
});
await new Promise<void>(ready => stub.listen(0, "127.0.0.1", () => ready()));
const address = stub.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "canned completions stub bound (answers one text turn per call)");

const modelsYaml = `providers:
  cedia-parked-proof-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-parked-proof-model
        name: Cedia parked proof fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

type AgentRow = { id: string; name: string; kind: string; parentId?: string; status: string; sessionFile?: string };

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-parked-proof-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-parked-proof-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-parked-proof-work-"));
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
let preserveScratch = false;
let started: Awaited<ReturnType<typeof startHostServer>> | undefined;
let diagnostic: Record<string, unknown> = {};
const writeDiagnostic = async (error?: unknown) => {
	if (error !== undefined) diagnostic.failure = error instanceof Error ? error.message : String(error);
	diagnostic.completions = completions;
	diagnostic.preservedDirectories = [hostStateDir, hostProfileDir, hostWorkDir];
	await writeFile(join(hostWorkDir, "transcript-diagnostic.json"), JSON.stringify(diagnostic, null, 2));
};
try {
started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Parked proof" });
	const session = started.host.createSession(project.id, "Parked proof");
	await started.host.startSession(session.id);
	const incarnation = (started.host.store.getSession(session.id) as { incarnation: string }).incarnation;

	const sent = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/commands`,
		token: owner,
		body: { commandId: "parked-proof-tan", incarnation, command: "prompt", payload: { message: "/tan probe parked revive target" } },
	});
	check(sent.status === 200, `the host accepts the tan dispatch through the commands route (${sent.status})`);

	let worker: AgentRow | undefined;
	{
		const deadline = Date.now() + 120_000;
		let sawRunning = false;
		for (;;) {
			const roster = record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: owner })).body, "agents body");
			const rows = ((roster as { agents?: AgentRow[] }).agents ?? []).filter(row => row.kind === "sub");
			if (rows.some(row => row.status === "running")) sawRunning = true;
			const parked = rows.find(row => row.status === "parked");
			if (parked !== undefined) {
				worker = parked;
				break;
			}
			if (Date.now() > deadline) throw new Error(`OMP agents parked proof failed: no parked row (sawRunning=${sawRunning}, completions=${completions}, rows=${JSON.stringify(rows).slice(0, 200)})`);
			await new Promise(resolve => setTimeout(resolve, 1_000));
		}
	}
	check(worker !== undefined && worker.parentId === "Main", "the roster carries the finished worker with its parent linkage");
	check(worker.status === "parked", `the finished worker parks through the real controller path (status: ${worker.status})`);
	check(completions > 0, `the worker completed on canned stub turns only (${completions} completions, 0 provider calls)`);

	// A parked agent is transcript-only: focus reads it.
	const focus = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/${worker.id}/transcript`, token: owner });
	check(focus.status === 200, "the transcript route answers for the parked worker");
	const transcript = record(focus.body, "projected transcript");
	const sessionFile = worker.sessionFile;
	check(typeof sessionFile === "string" && sessionFile.length > 0, "the roster names the parked child's session file");
	const filePath = resolve(sessionFile);
	const fileBytes = await readFile(filePath, "utf8");
	const completeLines = fileBytes.split("\n").filter(Boolean);
	const messageLines = completeLines.filter(line => {
		try { return record(JSON.parse(line)).type === "message"; } catch { return false; }
	});
	diagnostic = {
		workerId: worker.id,
		parentId: worker.parentId,
		status: worker.status,
		sessionFile: "<scratch child session file>",
		fileByteLength: Buffer.byteLength(fileBytes),
		completeJsonlLines: completeLines.length,
		messageJsonlLines: messageLines.length,
		messageLineByteLengths: messageLines.map(line => Buffer.byteLength(line)),
		routeState: transcript.state,
		routeReason: typeof transcript.reason === "string" ? transcript.reason : undefined,
		routeMessageCount: Array.isArray(transcript.messages) ? transcript.messages.length : null,
		routeFromByte: transcript.fromByte,
		routeNextByte: transcript.nextByte,
		routeReset: transcript.reset,
	};
	console.log(`OBS  child transcript metadata: ${JSON.stringify(diagnostic)}`);
	check(fileBytes.length > 0 && messageLines.length > 0, "the persisted child file contains complete message entries");
	check(Array.isArray(transcript.messages) && transcript.messages.length > 0, `the host projection returns child messages (got ${Array.isArray(transcript.messages) ? transcript.messages.length : "non-array"})`);
	check(transcript.nextByte === Buffer.byteLength(fileBytes), `host transcript nextByte matches child JSONL size (${transcript.nextByte}/${Buffer.byteLength(fileBytes)})`);

	// Revive through Cedia's own durable route.
	const revived = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/revive`,
		token: owner,
		body: { commandId: "parked-proof-revive", incarnation, id: worker.id },
	});
	check(revived.status === 200, `the revive route answers (${revived.status})`);
	const reviveBody = record(revived.body, "revive body");
	check(
		reviveBody.available === true && reviveBody.id === worker.id && reviveBody.revived === true,
		`the revive restores the parked worker through the lifecycle's own restore (${JSON.stringify(revived.body).slice(0, 120)})`,
	);

	const after = record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: owner })).body, "agents body");
	const rows = ((after as { agents?: AgentRow[] }).agents ?? []).filter(row => row.id === worker!.id);
	console.log(`OBS  post-revive row: ${JSON.stringify(rows[0] ?? null).slice(0, 240)} (completions=${completions})`);

	// Idempotency: the same command id replays the stored result, never a second restore.
	const replay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/revive`,
		token: owner,
		body: { commandId: "parked-proof-revive", incarnation, id: worker.id },
	});
	check(replay.status === 200 && JSON.stringify(replay.body) === JSON.stringify(revived.body), "a repeated revive command id replays the stored result byte-identically");
} catch (error) {
	process.exitCode = 1;
	preserveScratch = true;
	await writeDiagnostic(error);
} finally {
	await started?.close();
	await new Promise<void>(close => stub.close(() => close()));
	if (preserveScratch) {
		console.error(`DIAG scratch retained at ${hostWorkDir} (redacted transcript metadata only)`);
	} else {
		await Promise.all([
			rm(hostStateDir, { recursive: true, force: true }),
			rm(hostProfileDir, { recursive: true, force: true }),
			rm(hostWorkDir, { recursive: true, force: true }),
		]);
	}
}
if (process.exitCode !== 1) {
	console.log(JSON.stringify({ ok: true, reviveOfParked: true, backing: "local canned-stub fixture, 0 provider calls", realProviderProof: false }));
}
