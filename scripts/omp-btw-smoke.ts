/**
 * Live proof of Cedia's O02 side-question surface against the pinned runtime.
 *
 * A side question runs an ephemeral turn against the session context: the answer never
 * touches the transcript, and promoting it forks the session file through the session's
 * own branch path. Like the terminal firing without awaiting, the ask answers the answering
 * state at once and the held outcome lands later. No provider turn can complete in this run
 * (dead endpoint), so the honest live states are: the ask dispatches, the failure lands with
 * the runtime's own error, and the branch is refused with nothing held. The
 * answered-then-branched path is fixture-proven (bridge unit tests drive the session doubles
 * end to end, and the host fixture promotes into an adopted file) and renderer-tested;
 * reaching it live needs a provider turn.
 *
 * Run: bun scripts/omp-btw-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP side-question smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP side-question smoke failed: ${message}`);
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

const modelsYaml = `providers:
  cedia-btw-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-btw-fixture-model
        name: Cedia side-question smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

const cwd = await mkdtemp(join(tmpdir(), "cedia-btw-"));
await writeFile(join(cwd, "models.yml"), modelsYaml);

function resultOf(ack: unknown, what: string): Record<string, unknown> {
	return record(record(ack as { data?: unknown }, "cedia_control envelope").data ?? {}, "cedia_control data").result !== undefined
		? record(record((ack as { data?: unknown }).data, "cedia_control data").result, what)
		: record({}, what);
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
		requestTimeoutMs: 60_000,
		onFrame() {
			/* frames are not needed for this proof */
		},
	});
	await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });
	const idle = resultOf(await client.requestCedia("cedia_control", { operation: "btw.state.get" }), "btw.state.get result");
	check(idle.state === "idle" && idle.branchable === false, "a fresh terminal owner reads side-question idle with nothing held");
	// Select the fixture model so the ask reaches the ephemeral turn instead of the no-model refusal.
	const switched = await client.request("prompt", { message: "/switch cedia-btw-fixture-model" });
	check(record((switched as { data?: unknown }).data ?? {}).agentInvoked === false, "the fixture model is selected");
	// Like the terminal firing without awaiting, the ask answers the answering state at once;
	// the held failure lands later and the state reports it.
	const dispatched = resultOf(await client.requestCedia("cedia_control", { operation: "btw.ask", payload: { question: "Why is the sky blue?" } }), "btw.ask result");
	check(dispatched.state === "answering", "the ask dispatches at once instead of occupying the call");
	let asked: Record<string, unknown> | undefined;
	{
		const deadline = Date.now() + 120_000;
		while (Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 1_000));
			const current = resultOf(await client.requestCedia("cedia_control", { operation: "btw.state.get" }), "btw.state.get result");
			if (current.state !== "answering") {
				asked = current;
				break;
			}
		}
	}
	check(asked !== undefined, "the dispatched ask settles instead of hanging the state");
	check(asked.state === "failed" && typeof asked.reason === "string" && asked.reason.length > 0, "the ask fails honestly against a dead endpoint with the runtime's own error");
	check(asked.answer === null && asked.branchable === false, "a failed ask holds no answer and no branch");
	let refused = false;
	try {
		await client.requestCedia("cedia_control", { operation: "btw.branch" });
	} catch (error) {
		refused = /no answered side question/.test(error instanceof Error ? error.message : String(error));
	}
	check(refused, "branching with nothing held is refused before anything is forked");
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-btw-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-btw-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-btw-host-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Side-question smoke" });
	const session = started.host.createSession(project.id, "Side-question smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/btw`, token: owner });
	const beforeBody = record(before.body, "btw body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const controller = started.auth.issue("btw-controller");

	const idle = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/btw`, token: controller.token });
	const idleBody = record(idle.body, "live btw body");
	check(idle.status === 200 && idleBody.available === true && idleBody.state === "idle", "a fresh runtime reads side-question idle to a controller");

	const deniedAsk = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/ask`, token: controller.token, body: { commandId: "btw-smoke-no", incarnation, question: "Why?" } });
	check(deniedAsk.status === 403, "a controller may read the side question but never ask one");
	const deniedBranch = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/branch`, token: controller.token, body: { commandId: "btw-smoke-no-branch", incarnation } });
	check(deniedBranch.status === 403, "a controller may never promote one either");

	const picked = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/pending-model`, token: owner, body: { revision: 1, provider: "cedia-btw-fixture", modelId: "cedia-btw-fixture-model" } });
	check(picked.status === 200, "the fixture model is selected for the host session");
	const asked = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/ask`, token: owner, body: { commandId: "btw-smoke-ask", incarnation, question: "Why is the sky blue?" } });
	const askedBody = record(asked.body, "btw ask body");
	check(asked.status === 200 && askedBody.available === true && askedBody.state === "answering", "the owner ask dispatches at once instead of occupying the route");
	const replayed = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/ask`, token: owner, body: { commandId: "btw-smoke-ask", incarnation, question: "Why is the sky blue?" } });
	check(JSON.stringify(replayed.body) === JSON.stringify(asked.body), "a repeated ask command id replays the same acceptance receipt");
	let settled: Record<string, unknown> | undefined;
	{
		const deadline = Date.now() + 120_000;
		while (Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 1_000));
			const current = record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/btw`, token: owner })).body, "btw poll body");
			if (current.available === true && current.state !== "answering") {
				settled = current;
				break;
			}
		}
	}
	check(settled !== undefined, "the dispatched ask settles instead of hanging the state");
	check(settled.state === "failed" && typeof settled.reason === "string" && settled.reason.length > 0, "the owner ask fails honestly against a dead endpoint");

	const refused = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/branch`, token: owner, body: { commandId: "btw-smoke-branch", incarnation } });
	check(refused.status === 200, "the refused branch answers with a reason, not a transport error");
	check((record(refused.body, "btw branch body") as { available?: unknown }).available === false, "branching a failed ask reports unavailability with the refusal");

	for (const [label, body] of [
		["extra field", { commandId: "btw-smoke-bad-1", incarnation, question: "Why?", extra: true }],
		["blank question", { commandId: "btw-smoke-bad-2", incarnation, question: "  " }],
		["missing question", { commandId: "btw-smoke-bad-3", incarnation }],
	] as const) {
		const bad = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/ask`, token: owner, body });
		check(bad.status === 400, `${label} is refused before any runtime call (${bad.status})`);
	}
	const stale = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/ask`, token: owner, body: { commandId: "btw-smoke-stale", incarnation: "old", question: "Why?" } });
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
console.log("OMP side-question smoke passed: idle reads, the ask fails honestly, the branch is refused, routes hold.");
