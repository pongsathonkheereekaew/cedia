/**
 * Live proof of Cedia's O06 tool-catalog probe against the pinned runtime.
 *
 * OMP owns the tool registry and its activation state. This smoke reads that catalog through the
 * registered `tools.catalog.get` operation, then proves Cedia's controller-visible route carries
 * the runtime's own answer: identity, source class and activation state with no parameter schemas,
 * no credential and no transcript content. The fixture listener never answers, so no provider
 * request can complete during this run.
 *
 * Run: bun scripts/omp-tools-catalog-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP tools smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP tools smoke failed: ${message}`);
	return value as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

/** The runtime's own tools.catalog.get answer: bounded rows with identity, source and activation. */
function isCatalogGet(value: unknown): boolean {
	const row = record(value, "tools.catalog.get");
	if (!Array.isArray(row.tools) || typeof row.truncated !== "boolean") return false;
	if (typeof row.total !== "number" || typeof row.activeCount !== "number") return false;
	const names = new Set<string>();
	for (const entry of row.tools) {
		const held = record(entry, "tools.catalog.get entry");
		if (typeof held.name !== "string" || held.name.trim().length === 0) return false;
		if (typeof held.description !== "string" || typeof held.descriptionTruncated !== "boolean") return false;
		if (!["builtin", "mcp", "sdk", "extension"].includes(held.source as string)) return false;
		if (typeof held.active !== "boolean") return false;
		if ("parameters" in held || "sourceInfo" in held) return false;
		names.add(held.name);
	}
	return names.size === (row.tools as unknown[]).length;
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-tools-"));
const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");
const modelsYaml = `providers:
  cedia-tools-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-tools-fixture-model
        name: Cedia tools smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;
await writeFile(join(cwd, "models.yml"), modelsYaml);

// Exercise the pinned bridge itself before asking Cedia to project the same answer.
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

	const catalog = await client.requestCedia("cedia_control", { operation: "tools.catalog.get" });
	const catalogResult = record(catalog.data, "tools.catalog.get data").result;
	check(isCatalogGet(catalogResult), "the runtime answers its own tool catalog with identity, source class and activation");
	const catalogRow = record(catalogResult);
	check((catalogRow.tools as unknown[]).length >= 1, "a session start leaves at least one registered tool");
	const names = (catalogRow.tools as { name: string; active: boolean }[]).map(tool => tool.name);
	check(names.includes("read"), "the native read tool is in the registry");
	check((catalogRow.tools as { active: boolean }[]).filter(tool => tool.active).length <= (catalogRow.tools as unknown[]).length, "active tools are a subset of registered tools");
	check(catalogRow.total === (catalogRow.tools as unknown[]).length, "an untruncated catalog names every registered tool");

	const beforeNames = (catalogRow.tools as { name: string; active: boolean }[])
		.filter(tool => tool.active)
		.map(tool => tool.name);
	check(beforeNames.length >= 2, "at least two tools are active so one can be disabled and restored");
	const victim = beforeNames.find(name => name !== "read") ?? beforeNames[0]!;
	const disabled = await client.requestCedia("cedia_control", {
		operation: "tools.active.set",
		payload: { toolNames: beforeNames.filter(name => name !== victim) },
	});
	const disabledResult = record(disabled.data, "tools.active.set data").result;
	check(isCatalogGet(disabledResult), "the activation write answers the catalog that follows");
	const disabledRow = record(disabledResult);
	check(
		(disabledRow.tools as { name: string; active: boolean }[]).find(tool => tool.name === victim)?.active === false,
		`the runtime reports ${victim} as inactive after the write`,
	);
	const restored = await client.requestCedia("cedia_control", {
		operation: "tools.active.set",
		payload: { toolNames: beforeNames },
	});
	const restoredResult = record(restored.data, "tools.active.set restore data").result;
	check(isCatalogGet(restoredResult), "restoring the enabled set answers the catalog again");
	check(
		(record(restoredResult).tools as { name: string; active: boolean }[]).filter(tool => tool.active).length === beforeNames.length,
		"the restored catalog names every previously active tool as active",
	);

	const refreshed = await client.requestCedia("cedia_control", { operation: "tools.refresh-skills" });
	const refreshedResult = record(refreshed.data, "tools.refresh-skills data").result;
	check(isCatalogGet(refreshedResult), "skill rediscovery answers the catalog that follows");
	check(
		(record(refreshedResult).tools as { name: string }[]).some(tool => tool.name === "read"),
		"the refreshed catalog still names the native read tool",
	);

	let payloadRefused = false;
	try {
		await client.requestCedia("cedia_control", { operation: "tools.catalog.get", payload: { extra: true } });
	} catch {
		payloadRefused = true;
	}
	check(payloadRefused, "a payload on a read that takes none is refused instead of ignored");

	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-tools-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-tools-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-tools-host-work-"));
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const controller = started.auth.issue("Tools smoke controller").token;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Tools smoke" });
	const session = started.host.createSession(project.id, "Tools smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller });
	const beforeBody = record(before.body, "catalog body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller });
	const liveBody = record(live.body, "live catalog body");
	check(live.status === 200 && liveBody.available === true, `a paired controller can read the task's own tool catalog (${live.status})`);
	check(isCatalogGet({ tools: liveBody.tools, truncated: liveBody.truncated, total: liveBody.total, activeCount: liveBody.activeCount }), "the route carries the runtime's own catalog rows");
	check((liveBody.tools as { name: string }[]).some(tool => tool.name === "read"), "the live catalog names the native read tool");

	const withQuery = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog?debug=1`, token: controller });
	check(withQuery.status === 400, `query fields are refused before any runtime call (${withQuery.status})`);
	const wrongMethod = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller });
	check(wrongMethod.status === 405, `a write method on a read is refused (${wrongMethod.status})`);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const liveNames = (liveBody.tools as { name: string; active: boolean }[])
		.filter(tool => tool.active)
		.map(tool => tool.name);
	const switched = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/tools/active`,
		token: started.auth.ownerToken,
		body: { commandId: "tools-smoke-active", incarnation, toolNames: liveNames.slice(0, 1) },
	});
	const switchedBody = record(switched.body, "active-set body");
	check(switched.status === 200 && switchedBody.available === true, `an owner write selects the enabled set (${switched.status})`);
	check(isCatalogGet({ tools: switchedBody.tools, truncated: switchedBody.truncated, total: switchedBody.total, activeCount: switchedBody.activeCount }), "the write answer carries the catalog that follows");
	const replayed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/tools/active`,
		token: started.auth.ownerToken,
		body: { commandId: "tools-smoke-active", incarnation, toolNames: liveNames.slice(0, 1) },
	});
	check(JSON.stringify(replayed.body) === JSON.stringify(switched.body), "a repeated write command id replays the same receipt");
	const hostRefresh = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/tools/refresh-skills`,
		token: started.auth.ownerToken,
		body: { commandId: "tools-smoke-refresh", incarnation },
	});
	const hostRefreshBody = record(hostRefresh.body, "host refresh body");
	check(hostRefresh.status === 200 && hostRefreshBody.available === true, `an owner refresh re-runs skill rediscovery (${hostRefresh.status})`);
	check(isCatalogGet({ tools: hostRefreshBody.tools, truncated: hostRefreshBody.truncated, total: hostRefreshBody.total, activeCount: hostRefreshBody.activeCount }), "the refresh answer carries the catalog that follows");
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
	rm(cwd, { recursive: true, force: true }),
	new Promise<void>(close => held.close(() => close())),
]);
