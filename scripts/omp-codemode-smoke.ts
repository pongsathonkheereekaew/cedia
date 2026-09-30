/**
 * Live proof of Cedia's O06 Code Mode partition read against the pinned runtime.
 *
 * Code Mode's direct partition and eval prelude flags are the session's own getters
 * (`getCodeModeDirectToolNames`, `getEvalPreludes`). This smoke reads that partition
 * through the registered `tools.codemode.get` operation, then proves Cedia's
 * controller-visible route carries the runtime's own answer: names and one boolean
 * each, never prelude sources. No Code Mode model is selected here, so the honest live
 * state is a disengaged partition — the engaged rendering is renderer-tested only.
 * No provider request is made anywhere in this run.
 *
 * Run: bun scripts/omp-codemode-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP Code Mode smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP Code Mode smoke failed: ${message}`);
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-codemode-"));
await writeFile(join(cwd, "models.yml"), "providers: {}\n");

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
	const ack = await client.requestCedia("cedia_control", { operation: "tools.codemode.get" });
	const result = record(record(ack.data, "cedia_control data").result, "tools.codemode.get result");
	check(result.active === false, "a session without a Code Mode model reads the partition disengaged");
	check(result.directToolNames === null, "a disengaged partition carries a null direct list, not an empty one");
	check(Array.isArray(result.preludes), "the answer carries the runtime's own prelude rows");
	const names = (result.preludes as unknown[]).map(entry => (record(entry, "prelude row").name as unknown));
	check(names.includes("browser"), `the runtime names its browser prelude (${JSON.stringify(names)})`);
	for (const entry of result.preludes as unknown[]) {
		const row = record(entry, "prelude row");
		check(typeof row.name === "string" && typeof row.enabled === "boolean", "a prelude row is a name and a flag");
		check(!("javascript" in row) && !("python" in row) && !("documentation" in row), "no prelude source crosses the projection");
	}
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-codemode-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-codemode-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-codemode-host-work-"));
await writeFile(join(hostProfileDir, "models.yml"), "providers: {}\n", { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Code Mode smoke" });
	const session = started.host.createSession(project.id, "Code Mode smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/codemode`, token: owner });
	const beforeBody = record(before.body, "Code Mode body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const controller = started.auth.issue("codemode-controller");
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/codemode`, token: controller.token });
	const liveBody = record(live.body, "live Code Mode body");
	check(live.status === 200 && liveBody.available === true && liveBody.active === false, "a fresh runtime reads the partition disengaged to a controller");
	check(liveBody.directToolNames === null && Array.isArray(liveBody.preludes), "the route carries the runtime's own disengaged shape");

	const withQuery = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/codemode?debug=1`, token: controller.token });
	check(withQuery.status === 400, "query fields are refused before any runtime call");
	const wrongMethod = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/codemode`, token: controller.token });
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
console.log("OMP Code Mode smoke passed: the partition reads disengaged, sources never cross, the route carries it.");
