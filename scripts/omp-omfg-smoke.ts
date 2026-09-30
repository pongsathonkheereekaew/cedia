/**
 * Live proof of Cedia's O02 rule-forging surface against the pinned runtime.
 *
 * Forging drafts a TTSR rule candidate over an ephemeral turn, validates it against the
 * assistant history, and saves it into the project or global rules directory with the
 * runtime registering it live. Like the terminal overlay, the draft answers the drafting
 * state at once and the held candidate lands later. No provider turn can complete in this
 * run (dead endpoint), so the honest live states are: the draft dispatches, the failure
 * lands with the runtime's own error, and the save is refused with nothing held. The
 * draft-validate-save path is fixture-proven (bridge unit tests drive a canned rule
 * through validation, file write, and live registration) and renderer-tested; reaching
 * it live needs a provider turn.
 *
 * Run: bun scripts/omp-omfg-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP rule-forging smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP rule-forging smoke failed: ${message}`);
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

function resultOf(ack: unknown, what: string): Record<string, unknown> {
	const data = record((ack as { data?: unknown }).data ?? {}, "cedia_control envelope");
	return record(data.result, what);
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

const modelsYaml = `providers:
  cedia-omfg-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-omfg-fixture-model
        name: Cedia rule-forging smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

const cwd = await mkdtemp(join(tmpdir(), "cedia-omfg-"));
await writeFile(join(cwd, "models.yml"), modelsYaml);

async function pollState(
	read: () => Promise<Record<string, unknown>>,
	done: (state: Record<string, unknown>) => boolean,
	timeoutMs: number,
): Promise<Record<string, unknown>> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const current = await read();
		if (done(current)) return current;
		if (Date.now() > deadline) throw new Error("OMP rule-forging smoke failed: a dispatched draft never settled");
		await new Promise(resolve => setTimeout(resolve, 1_000));
	}
}

let client: OmpRpcClient | undefined;
try {
	client = await OmpRpcClient.start({
		executable,
		args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", cwd],
		cwd,
		env: {
			PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`,
			HOME: cwd,
			PI_CODING_AGENT_DIR: cwd,
			PI_NO_PTY: "1",
			PI_NOTIFICATIONS: "off",
			TERM: "xterm-256color",
			CEDIA_RPC_VIRTUAL_UI: "1",
		},
		readyTimeoutMs: 30_000,
		requestTimeoutMs: 30_000,
		onFrame() {
			/* frames are not needed for this proof */
		},
	});
	await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });
	const idle = resultOf(await client.requestCedia("cedia_control", { operation: "omfg.state.get" }), "omfg.state.get result");
	check(idle.state === "idle" && idle.draft === null, "a fresh terminal owner reads rule-forging idle with nothing held");
	const switched = await client.request("prompt", { message: "/switch cedia-omfg-fixture-model" });
	check(record((switched as { data?: unknown }).data ?? {}).agentInvoked === false, "the fixture model is selected");
	const dispatched = resultOf(await client.requestCedia("cedia_control", { operation: "omfg.draft", payload: { complaint: "Stop that." } }), "omfg.draft result");
	check(dispatched.state === "drafting", "the draft dispatches at once instead of occupying the call");
	const settled = await pollState(
		async () => resultOf(await client!.requestCedia("cedia_control", { operation: "omfg.state.get" }), "omfg.state.get result"),
		current => current.state === "ready" || current.state === "failed",
		120_000,
	);
	check(settled.state === "failed" && typeof settled.reason === "string" && settled.reason.length > 0, "the draft fails honestly against a dead endpoint with the runtime's own error");
	check(settled.draft === null, "a failed draft holds no candidate and no save");
	let refused = false;
	try {
		await client.requestCedia("cedia_control", { operation: "omfg.save", payload: { scope: "project" } });
	} catch (error) {
		refused = /No rule draft to save/.test(error instanceof Error ? error.message : String(error));
	}
	check(refused, "saving with nothing held is refused before any file is touched");
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-omfg-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-omfg-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-omfg-host-work-"));
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Rule-forging smoke" });
	const session = started.host.createSession(project.id, "Rule-forging smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/omfg`, token: owner });
	const beforeBody = record(before.body, "omfg body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const controller = started.auth.issue("omfg-controller");

	const idle = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/omfg`, token: controller.token });
	const idleBody = record(idle.body, "live omfg body");
	check(idle.status === 200 && idleBody.available === true && idleBody.state === "idle", "a fresh runtime reads rule-forging idle to a controller");

	const deniedDraft = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/draft`, token: controller.token, body: { commandId: "omfg-smoke-no", incarnation, complaint: "Stop that." } });
	check(deniedDraft.status === 403, "a controller may read the forging state but never draft one");
	const deniedSave = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/save`, token: controller.token, body: { commandId: "omfg-smoke-no-save", incarnation, scope: "project" } });
	check(deniedSave.status === 403, "a controller may never save one either");
	const deniedAbort = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/abort`, token: controller.token, body: { commandId: "omfg-smoke-no-abort", incarnation } });
	check(deniedAbort.status === 403, "a controller may never abort one either");

	const picked = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/pending-model`, token: owner, body: { revision: 1, provider: "cedia-omfg-fixture", modelId: "cedia-omfg-fixture-model" } });
	check(picked.status === 200, "the fixture model is selected for the host session");
	const drafted = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/draft`, token: owner, body: { commandId: "omfg-smoke-draft", incarnation, complaint: "Stop that." } });
	const draftedBody = record(drafted.body, "omfg draft body");
	check(drafted.status === 200 && draftedBody.available === true && draftedBody.state === "drafting", "the owner draft dispatches at once instead of occupying the route");

	const replayed = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/draft`, token: owner, body: { commandId: "omfg-smoke-draft", incarnation, complaint: "Stop that." } });
	check(JSON.stringify(replayed.body) === JSON.stringify(drafted.body), "a repeated draft command id replays the same acceptance receipt");

	const settled = await pollState(
		async () => record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/omfg`, token: owner })).body, "omfg poll body"),
		current => current.available === true && (current.state === "ready" || current.state === "failed"),
		120_000,
	);
	check(settled.state === "failed" && typeof settled.reason === "string" && settled.reason.length > 0, "the owner draft fails honestly against a dead endpoint");

	const refused = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/save`, token: owner, body: { commandId: "omfg-smoke-save", incarnation, scope: "project" } });
	check(refused.status === 200, "the refused save answers with a reason, not a transport error");
	check((record(refused.body, "omfg save body") as { available?: unknown }).available === false, "saving a failed draft reports unavailability with the refusal");

	for (const [label, body, route] of [
		["extra field", { commandId: "omfg-smoke-bad-1", incarnation, complaint: "x", extra: true }, "draft"],
		["blank complaint", { commandId: "omfg-smoke-bad-2", incarnation, complaint: "  " }, "draft"],
		["missing complaint", { commandId: "omfg-smoke-bad-3", incarnation }, "draft"],
		["bad scope", { commandId: "omfg-smoke-bad-4", incarnation, scope: "everywhere" }, "save"],
		["bad overwrite", { commandId: "omfg-smoke-bad-5", incarnation, scope: "project", overwrite: "yes" }, "save"],
	] as const) {
		const bad = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/${route}`, token: owner, body });
		check(bad.status === 400, `${label} is refused before any runtime call (${bad.status})`);
	}
	const stale = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/draft`, token: owner, body: { commandId: "omfg-smoke-stale", incarnation: "old", complaint: "x" } });
	check(stale.status === 409, "a stale incarnation is refused (409)");
} finally {
	await started.close();
}

await Promise.all([
	rm(cwd, { recursive: true, force: true }),
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
console.log("OMP rule-forging smoke passed: idle reads, the draft fails honestly, the save is refused, routes hold.");
