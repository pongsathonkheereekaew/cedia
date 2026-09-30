/**
 * Live proof of Cedia's O06 extension-catalog read and toggle against the pinned runtime.
 *
 * The runtime's own discovery answer (records plus the live root policy) through the
 * registered `extensions.list` operation, then Cedia's controller-visible route carrying
 * the same answer with the records' raw discovery bag left behind. The fixture project
 * carries an `.omp/mcp.json` pair (one active, one flag-disabled), so the states are
 * the runtime's own, not defaults. The write half goes through the host's owner-only
 * durable route: disabling and re-enabling the active fixture server, replaying the
 * first command id, and naming an unknown id. Custom roots stay a separate surface
 * with their own gate. No model, no provider, and no session turn anywhere in this run.
 *
 * Run: bun scripts/omp-extensions-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP extensions smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP extensions smoke failed: ${message}`);
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

const mcpJson = JSON.stringify({
	mcpServers: {
		"smoke-echo": { command: "echo", args: ["hi"] },
		"smoke-off": { command: "echo", args: ["off"], enabled: false },
	},
});

const cwd = await mkdtemp(join(tmpdir(), "cedia-extensions-"));
await writeFile(join(cwd, "models.yml"), "providers: {}\n");
await mkdir(join(cwd, ".omp"), { recursive: true });
await writeFile(join(cwd, ".omp", "mcp.json"), mcpJson);

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
	const answer = record(record((await client.requestCedia("cedia_control", { operation: "extensions.list" })).data ?? {}, "cedia_control envelope").result ?? {}, "extensions.list result");
	const rows = answer.extensions as unknown[];
	check(Array.isArray(rows), "the answer carries extension rows");
	const echo = rows.find(entry => (entry as { id?: unknown }).id === "mcp:smoke-echo") as Record<string, unknown> | undefined;
	const off = rows.find(entry => (entry as { id?: unknown }).id === "mcp:smoke-off") as Record<string, unknown> | undefined;
	check(echo?.state === "active", "the active fixture server reads active with its own state");
	check(off?.state === "disabled", "the flag-disabled fixture server reads disabled with its own state");
	check(!("raw" in (echo ?? {})), "no record carries the raw discovery bag");
	const roots = record(answer.roots, "extension roots");
	check(Array.isArray(roots.configured), "the answer carries the live root policy");
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-extensions-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-extensions-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-extensions-host-work-"));
await writeFile(join(hostProfileDir, "models.yml"), "providers: {}\n", { mode: 0o600 });
await mkdir(join(hostWorkDir, ".omp"), { recursive: true });
await writeFile(join(hostWorkDir, ".omp", "mcp.json"), mcpJson);
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Extensions smoke" });
	const session = started.host.createSession(project.id, "Extensions smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/extensions`, token: owner });
	const beforeBody = record(before.body, "extensions body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const controller = started.auth.issue("extensions-controller");
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/extensions`, token: controller.token });
	const liveBody = record(live.body, "live extensions body");
	check(live.status === 200 && liveBody.available === true, "the catalog reads controller-visible once the runtime runs");
	const liveRows = liveBody.extensions as unknown[];
	const liveEcho = liveRows.find(entry => (entry as { id?: unknown }).id === "mcp:smoke-echo") as Record<string, unknown> | undefined;
	const liveOff = liveRows.find(entry => (entry as { id?: unknown }).id === "mcp:smoke-off") as Record<string, unknown> | undefined;
	check(liveEcho?.state === "active" && liveOff?.state === "disabled", "the route carries the runtime's own record states");
	check(!("raw" in (liveEcho ?? {})), "the route never carries the raw discovery bag");

	const incarnation = (started.host.store.getSession(session.id) as { incarnation: string }).incarnation;
	const toggled = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/extensions/set`, token: owner, body: { commandId: "smoke-ext-off", incarnation, id: "mcp:smoke-echo", enabled: false } });
	const toggledBody = record(toggled.body, "toggled extensions body");
	check(toggled.status === 200 && toggledBody.available === true, "disabling answers the catalog that follows");
	const toggledRows = toggledBody.extensions as unknown[];
	const toggledEcho = toggledRows.find(entry => (entry as { id?: unknown }).id === "mcp:smoke-echo") as Record<string, unknown> | undefined;
	check(toggledEcho?.state === "disabled", "the disabled fixture server reads disabled with the runtime's own state");
	const replayed = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/extensions/set`, token: owner, body: { commandId: "smoke-ext-off", incarnation, id: "mcp:smoke-echo", enabled: false } });
	check(replayed.status === 200 && JSON.stringify(replayed.body) === JSON.stringify(toggled.body), "a repeated command id replays the stored catalog, not a second toggle");
	const reenabled = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/extensions/set`, token: owner, body: { commandId: "smoke-ext-on", incarnation, id: "mcp:smoke-echo", enabled: true } });
	const reenabledBody = record(reenabled.body, "re-enabled extensions body");
	const reenabledEcho = (reenabledBody.extensions as unknown[]).find(entry => (entry as { id?: unknown }).id === "mcp:smoke-echo") as Record<string, unknown> | undefined;
	check(reenabled.status === 200 && reenabledBody.available === true && reenabledEcho?.state === "active", "re-enabling restores the active state");
	const refused = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/extensions/set`, token: owner, body: { commandId: "smoke-ext-missing", incarnation, id: "mcp:missing", enabled: false } });
	const refusedBody = record(refused.body, "unknown extension body");
	check(refused.status === 200 && refusedBody.available === false && typeof refusedBody.reason === "string" && refusedBody.reason.length > 0, `an unknown id answers unavailable with the runtime's own reason (${String(refusedBody.reason).slice(0, 80)})`);

	const withQuery = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/extensions?debug=1`, token: controller.token });
	check(withQuery.status === 400, "query fields are refused before any runtime call");
	const wrongMethod = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/extensions`, token: controller.token });
	check(wrongMethod.status === 405, "writes are refused on the read route");
} finally {
	await started.close();
}

await Promise.all([
	rm(cwd, { recursive: true, force: true }),
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
console.log("OMP extensions smoke passed: the catalog reads with states, roots ride along, sources never cross.");
