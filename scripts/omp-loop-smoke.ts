/**
 * Live proof of Cedia's O07 loop-mode surface against the pinned runtime.
 *
 * Loop mode belongs to the terminal owner: enabling runs the terminal's own `/loop`
 * transition (here through the prompt path the RPC terminal owner dispatches headless,
 * with a bound and no inline prompt so no turn ever starts), the state reads back through
 * the registered `loop.state.get` operation, and the owner-only durable POST disables it
 * through `loop.set`. No provider turn runs anywhere in this proof, so no model endpoint
 * is configured at all.
 *
 * Run: bun scripts/omp-loop-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP loop smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP loop smoke failed: ${message}`);
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-loop-"));
const modelsYaml = `providers:
  cedia-loop-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-loop-fixture-model
        name: Cedia loop smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;
await writeFile(join(cwd, "models.yml"), modelsYaml);

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
	const off = record(record((await client.requestCedia("cedia_control", { operation: "loop.state.get" })).data, "cedia_control data").result, "loop.state.get result");
	check(off.enabled === false && off.hasPrompt === false, "a fresh terminal owner reads loop off with no prompt armed");
	const enabled = await client.request("prompt", { message: "/loop 3" });
	check(record(enabled, "loop prompt ack") !== undefined, "the terminal owner consumes /loop through the prompt path");
	const on = record(record((await client.requestCedia("cedia_control", { operation: "loop.state.get" })).data, "cedia_control data").result, "loop.state.get result");
	check(on.enabled === true && on.hasPrompt === false, "the bound loop reads back enabled with no prompt armed");
	check(typeof on.limit === "string" && (on.limit as string).includes("3"), `the bound reads back in the runtime's own words (${String(on.limit)})`);
	const disabled = record(record((await client.requestCedia("cedia_control", { operation: "loop.set" })).data, "cedia_control data").result, "loop.set result");
	check(disabled.enabled === false, "the owner disable answers loop off");
	const reread = record(record((await client.requestCedia("cedia_control", { operation: "loop.state.get" })).data, "cedia_control data").result, "loop.state.get result");
	check(reread.enabled === false, "a second read stays off");
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-loop-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-loop-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-loop-host-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Loop smoke" });
	const session = started.host.createSession(project.id, "Loop smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/loop`, token: owner });
	const beforeBody = record(before.body, "loop body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;

	const read = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/loop`, token: owner });
	const readBody = record(read.body, "live loop body");
	check(read.status === 200 && readBody.available === true && readBody.enabled === false, "a fresh runtime reads loop off");

	const disabled = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/loop`,
		token: owner,
		body: { commandId: "loop-smoke-set", incarnation },
	});
	check(disabled.status === 200, `an owner disable is accepted (${disabled.status})`);
	const disabledBody = record(disabled.body, "loop write body");
	check(disabledBody.state === "available" && disabledBody.enabled === false, "the write answer carries loop off");

	const replayed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/loop`,
		token: owner,
		body: { commandId: "loop-smoke-set", incarnation },
	});
	check(JSON.stringify(replayed.body) === JSON.stringify(disabled.body), "a repeated loop command id replays the same receipt");

	for (const [label, body] of [
		["extra field", { commandId: "loop-smoke-bad-1", incarnation, enabled: false }],
		["missing incarnation", { commandId: "loop-smoke-bad-2" }],
	] as const) {
		const refused = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/loop`, token: owner, body });
		check(refused.status === 400, `${label} is refused before any runtime call (${refused.status})`);
	}
	const stale = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/loop`,
		token: owner,
		body: { commandId: "loop-smoke-stale", incarnation: "old" },
	});
	check(stale.status === 409, `a stale incarnation is refused (${stale.status})`);
} finally {
	await started.close();
}

await Promise.all([
	rm(cwd, { recursive: true, force: true }),
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
console.log("OMP loop smoke passed: the prompt path enables, the bridge reads, the owner route disables.");
