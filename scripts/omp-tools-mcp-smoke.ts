/**
 * Live proof that MCP tools can be added and removed from a running Cedia
 * session catalog (O06 dynamic-discovery gate).
 *
 * OMP owns MCP discovery and the tool registry: a session started in a folder with
 * `.mcp.json` connects the listed stdio servers itself and mounts their tools as
 * `mcp__<server>_<tool>`. This smoke proves Cedia's controller-visible route carries
 * that answer - identity, source class and activation state, with no parameter schemas,
 * no credential and no transcript content. The fixture server speaks MCP over stdio and
 * never touches the network, and the fixture model endpoint never answers, so no
 * provider request can complete during this run.
 *
 * Run: bun scripts/omp-tools-mcp-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP MCP tools smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP MCP tools smoke failed: ${message}`);
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
const fixtureServer = join(root, "apps/host/test/fixtures/fixture-mcp-server.mjs");
check(await exists(fixtureServer), `the fixture MCP server exists at ${fixtureServer}`);

// The runtime spawns the MCP server itself; whatever runs this smoke runs the fixture too,
// the same way the agent-window fixture runs under CEDIA_NODE.
const mcpCommand = process.execPath;

const cwd = await mkdtemp(join(tmpdir(), "cedia-tools-mcp-"));
await writeFile(join(cwd, ".mcp.json"), JSON.stringify({
	mcpServers: {
		fixture: { command: mcpCommand, args: [fixtureServer] },
	},
}));
const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");
const modelsYaml = `providers:
  cedia-tools-mcp-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-tools-mcp-fixture-model
        name: Cedia MCP tools smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;
await writeFile(join(cwd, "hello.txt"), "MCP tools smoke fixture\n");

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-tools-mcp-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-tools-mcp-host-profile-"));
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const controller = started.auth.issue("MCP tools smoke controller").token;
	const project = started.host.store.createProject({ path: cwd, name: "MCP tools smoke" });
	const session = started.host.createSession(project.id, "MCP tools smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller });
	const beforeBody = record(before.body, "catalog body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);

	// MCP discovery runs deferred inside session startup; poll the live catalog for the row.
	const deadline = Date.now() + 90_000;
	let liveBody: Record<string, unknown> | undefined;
	let mcpRow: { name: string; description: unknown; descriptionTruncated: unknown; source: unknown; active: unknown } | undefined;
	while (Date.now() < deadline) {
		const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller });
		check(live.status === 200, `the catalog route answers (${live.status})`);
		liveBody = record(live.body, "live catalog body");
		if (liveBody.available === true) {
			const tools = liveBody.tools as { name: string; description: unknown; descriptionTruncated: unknown; source: unknown; active: unknown }[];
			mcpRow = tools.find(tool => tool.name === "mcp__fixture_echo");
			if (mcpRow !== undefined) break;
		}
		await new Promise(resolve => setTimeout(resolve, 2_000));
	}
	check(mcpRow !== undefined, "the fixture MCP tool appears in the live session catalog as mcp__fixture_echo");
	const row = record(mcpRow, "MCP tool row");
	check(row.source === "mcp", `the row carries the runtime's own mcp source class (${String(row.source)})`);
	check(typeof row.description === "string" && (row.description as string).length > 0, "the row carries the tool description");
	// Mount-scoped tools are not top-level active: the runtime keeps connected MCP tools
	// mounted under xd:// devices (its setActiveToolsByName partitions top-level versus
	// mount), so the catalog reports the runtime's own flag rather than a Cedia invention.
	console.log(`INFO mcp__fixture_echo active=${String(row.active)} (mount-scoped, expected false)`);
	check(typeof liveBody!.total === "number" && (liveBody!.total as number) >= 1, "the catalog counts its rows");
	console.log(`OK   ${JSON.stringify({ total: liveBody!.total, activeCount: liveBody!.activeCount })}`);

	const readNames = async (): Promise<Set<string>> => {
		const response = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller });
		check(response.status === 200, `the connected session catalog remains readable (${response.status})`);
		const body = record(response.body, "dynamic catalog body");
		check(body.available === true && Array.isArray(body.tools), "the running session returns one complete available catalog snapshot");
		return new Set((body.tools as { name: string }[]).map(tool => tool.name));
	};
	const sendMcpReload = async (commandId: string): Promise<void> => {
		const current = started.host.store.getSession(session.id);
		check(current !== undefined, "the running task remains registered during MCP rediscovery");
		const response = await started.router({
			method: "POST",
			path: `/v1/sessions/${session.id}/commands`,
			token: started.auth.ownerToken,
			body: { commandId, incarnation: current.incarnation, command: "prompt", payload: { message: "/mcp reload" } },
		});
		check(response.status === 200, `/mcp reload is accepted by the existing OMP session (${response.status})`);
		const command = record(response.body, "mcp reload command receipt");
		const ack = record(command.ack, "mcp reload OMP ack");
		const ackData = record(ack.data, "mcp reload OMP ack data");
		console.log(`OBS  /mcp reload receipt: ${JSON.stringify({ status: command.status, agentInvoked: ackData.agentInvoked, result: command.result, error: command.error })}`);
		const frames = started.host.store.readEvents(session.id).events.map(event => event.frame as Record<string, unknown>);
		const output = frames.filter(frame => frame.type === "command_output").map(frame => frame.text).filter(text => typeof text === "string").slice(-6);
		console.log(`OBS  /mcp reload runtime output: ${JSON.stringify(output)}`);
		check(ackData.agentInvoked === false, "/mcp reload ran as a local OMP command without an agent/provider turn");
	};
	const waitForCatalog = async (label: string, predicate: (names: Set<string>) => boolean): Promise<Set<string>> => {
		const end = Date.now() + 30_000;
		let names = new Set<string>();
		while (Date.now() < end) {
			names = await readNames();
			if (predicate(names)) return names;
			await new Promise(resolve => setTimeout(resolve, 500));
		}
		throw new Error(`OMP MCP tools smoke failed: ${label}; final catalog: ${JSON.stringify([...names].filter(name => name.startsWith("mcp__")))}`);
	};

	const extraConfig = {
		fixture: { command: mcpCommand, args: [fixtureServer] },
		// Keep the endpoint-equivalence key distinct; OMP intentionally aliases
		// identical MCP connections even when their config names differ.
		fixture_extra: { command: mcpCommand, args: [fixtureServer, "--secondary-fixture"] },
	};
	await writeFile(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: extraConfig }));
	await sendMcpReload("mcp-dynamic-add");
	const withExtra = await waitForCatalog("adding a connected MCP server refreshes the runtime catalog", names => names.has("mcp__fixture_extra_echo"));
	check(withExtra.has("mcp__fixture_echo"), "the pre-existing MCP tool remains in the catalog while the added server appears");
	console.log("OK   live catalog after add includes mcp__fixture_echo and mcp__fixture_extra_echo");

	await writeFile(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: extraConfig.fixture } }));
	await sendMcpReload("mcp-dynamic-remove");
	const afterRemove = await waitForCatalog("removing a connected MCP server removes its tool from the runtime catalog", names => !names.has("mcp__fixture_extra_echo"));
	check(afterRemove.has("mcp__fixture_echo"), "removing the extra server preserves the remaining MCP tool");
	console.log("OK   live catalog after remove contains only the still-configured fixture MCP tool");
} finally {
	await started.close();
	held.close();
	await rm(cwd, { recursive: true, force: true });
	await rm(hostStateDir, { recursive: true, force: true });
	await rm(hostProfileDir, { recursive: true, force: true });
}
console.log("OMP MCP dynamic smoke passed: adding and removing fixture MCP servers refreshed the connected session catalog");
