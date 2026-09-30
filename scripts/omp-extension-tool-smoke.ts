/**
 * Live proof that a custom extension-registered tool reaches a Cedia session (O06).
 *
 * OMP loads trusted JS extensions itself (`--trusted-extension`); an extension that
 * calls `api.registerTool` mounts its tool in the session registry like any other
 * row. This smoke proves Cedia carries that answer at both levels: the registered
 * `tools.catalog.get` operation answers the fixture widget with source `extension`,
 * and the controller-visible host route carries the same row. The fixture tool is a
 * constant string behind a `read`-tier registration - it is never executed here, no
 * model answers, no provider request leaves the machine, and no session turn runs.
 *
 * Run: bun scripts/omp-extension-tool-smoke.ts
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP extension tool smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP extension tool smoke failed: ${message}`);
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

const root = resolve(import.meta.dir, "..");
const fixtureExtension = join(root, "apps/host/test/fixtures/fixture-extension-tool.mjs");
check(await exists(fixtureExtension), `the fixture extension exists at ${fixtureExtension}`);

const rowKeys = ["name", "description", "descriptionTruncated", "source", "active"] as const;
function checkWidgetRow(entry: unknown, message: string): void {
	const row = record(entry, "catalog row");
	for (const key of Object.keys(row)) {
		if (!(rowKeys as readonly string[]).includes(key)) throw new Error(`OMP extension tool smoke failed: catalog row carries unexpected field ${key}`);
	}
	check(row.name === "cedia_smoke_widget", `${message} (name)`);
	check(row.source === "extension", `${message} (source class)`);
	check(row.active === true, `${message} (activation)`);
}

let client: OmpRpcClient | undefined;
try {
	client = await OmpRpcClient.start({
		executable,
		args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", root,
			"--trusted-extension", fixtureExtension],
		cwd: root,
		env: {
			PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`,
			HOME: root,
			PI_CODING_AGENT_DIR: root,
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
	const answer = record(record((await client.requestCedia("cedia_control", { operation: "tools.catalog.get" })).data ?? {}, "cedia_control envelope").result ?? {}, "tools.catalog.get result");
	const rows = answer.tools as unknown[];
	check(Array.isArray(rows), "the bridge answers tool rows");
	const widget = rows.find(entry => (entry as { name?: unknown }).name === "cedia_smoke_widget");
	check(widget !== undefined, "the extension-registered tool is in the registry answer");
	checkWidgetRow(widget, "the bridge row carries the widget with the runtime's own source class");
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-ext-tool-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-ext-tool-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-ext-tool-host-work-"));
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompArgs: ["--trusted-extension", fixtureExtension],
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Extension tool smoke" });
	const session = started.host.createSession(project.id, "Extension tool smoke");
	await started.host.startSession(session.id);
	const controller = started.auth.issue("extension-tool-controller");
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller.token });
	const liveBody = record(live.body, "live catalog body");
	check(live.status === 200 && liveBody.available === true, "the catalog reads controller-visible once the runtime runs");
	const liveWidget = (liveBody.tools as unknown[]).find(entry => (entry as { name?: unknown }).name === "cedia_smoke_widget");
	check(liveWidget !== undefined, "the host route carries the extension-registered row");
	checkWidgetRow(liveWidget, "the route row matches the bridge row exactly");
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
console.log("OMP extension tool smoke passed: an extension-registered tool reaches the session catalog with source extension.");
