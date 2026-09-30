/**
 * Live proof of Cedia's O02 session tree against the pinned runtime.
 *
 * OMP owns the session file, its tree and its active branch. This smoke reads that structure through
 * the capability bridge, then proves Cedia's routes carry the runtime's own answers: the tree with
 * the active branch, the lineage from the session header, and a navigation that reports what really
 * happened. The fixture listener never answers, so no provider request can complete during this run.
 *
 * Run: bun scripts/omp-tree-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP tree smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP tree smoke failed: ${message}`);
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

/** The runtime's own tree.get answer: rows, the active branch, the lineage and honest bounds. */
function isTreeGet(value: unknown): boolean {
	const row = record(value, "tree.get");
	if (row.leafId !== null && typeof row.leafId !== "string") return false;
	if (!Array.isArray(row.nodes) || !Array.isArray(row.pathIds)) return false;
	if (typeof row.truncated !== "boolean") return false;
	if (!row.pathIds.every(id => typeof id === "string")) return false;
	if (!row.nodes.every(entry => {
		const held = record(entry, "tree.get node");
		return typeof held.id === "string"
			&& (held.parentId === null || typeof held.parentId === "string")
			&& typeof held.kind === "string"
			&& typeof held.timestamp === "string"
			&& typeof held.label === "string"
			&& typeof held.labelTruncated === "boolean";
	})) return false;
	const lineage = record(row.lineage, "tree.get lineage");
	return typeof lineage.sessionFile === "string"
		&& (lineage.parentSession === null || typeof lineage.parentSession === "string")
		&& Array.isArray(lineage.previousSessionFiles)
		&& lineage.previousSessionFiles.every(entry => typeof entry === "string");
}

/** The runtime's own tree.navigate answer: what happened, not what was asked for. */
function isTreeNavigate(value: unknown): boolean {
	const row = record(value, "tree.navigate");
	for (const flag of ["moved", "cancelled", "aborted", "askReopen", "summarized", "editorTextTruncated"]) {
		if (typeof row[flag] !== "boolean") return false;
	}
	if (row.editorText !== null && typeof row.editorText !== "string") return false;
	if (typeof row.editorImageCount !== "number") return false;
	if (row.leafId !== null && typeof row.leafId !== "string") return false;
	// A parked `ask` target is never reported as a move.
	if (row.askReopen === true && row.moved === true) return false;
	if ((row.cancelled === true || row.aborted === true) && row.moved === true) return false;
	return true;
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-tree-"));
const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");
const modelsYaml = `providers:
  cedia-tree-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-tree-fixture-model
        name: Cedia tree smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;
await writeFile(join(cwd, "models.yml"), modelsYaml);

let rootLeafId: string | null = null;

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

	const tree = await client.requestCedia("cedia_control", { operation: "tree.get" });
	const treeResult = record(tree.data, "tree.get data").result;
	check(isTreeGet(treeResult), "the runtime answers its own tree with the active branch, lineage and bounds");
	const treeRow = record(treeResult);
	const pathIds = treeRow.pathIds as string[];
	const nodes = treeRow.nodes as { id: string; parentId: string | null }[];
	check(nodes.length >= 1 && pathIds.length >= 1, "a session start leaves at least one entry on the active branch");
	check(nodes.some(node => node.id === pathIds[0]) && treeRow.leafId === pathIds.at(-1), "the reported leaf is the end of the reported active branch");
	check(record(treeRow.lineage).parentSession === null && (record(treeRow.lineage).previousSessionFiles as unknown[]).length === 0, "a session Cedia started reports no parent and no moved-from file");
	rootLeafId = pathIds[0]!;

	const moved = await client.requestCedia("cedia_control", { operation: "tree.navigate", payload: { entryId: rootLeafId, summarize: false } });
	const movedResult = record(moved.data, "tree.navigate data").result;
	check(isTreeNavigate(movedResult), "the runtime answers what a navigation really did");
	check(record(movedResult).moved === true && record(movedResult).leafId === rootLeafId, "navigating to the root moves the active branch to it");

	let unknownRefused = false;
	try {
		await client.requestCedia("cedia_control", { operation: "tree.navigate", payload: { entryId: "no-such-entry", summarize: false } });
	} catch {
		unknownRefused = true;
	}
	check(unknownRefused, "an entry id the runtime does not have is refused instead of answering a fabricated move");

	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-tree-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-tree-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-tree-host-work-"));
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
	const controller = started.auth.issue("Tree smoke controller").token;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Tree smoke" });
	const session = started.host.createSession(project.id, "Tree smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tree`, token: controller });
	const beforeBody = record(before.body, "tree body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tree`, token: controller });
	const liveBody = record(live.body, "live tree body");
	check(live.status === 200 && liveBody.available === true, `a paired controller can read the task's own tree (${live.status})`);
	check(isTreeGet({ leafId: liveBody.leafId, nodes: liveBody.nodes, pathIds: liveBody.pathIds, truncated: liveBody.truncated, lineage: liveBody.lineage }), "the route carries the runtime's own tree and lineage");
	const liveNodes = liveBody.nodes as { id: string }[];
	check(liveNodes.length >= 1, "the live tree has at least one entry");
	const target = (liveBody.pathIds as string[])[0]!;

	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const malformed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/tree/navigate`,
		token: controller,
		body: { commandId: "tree-smoke-malformed", incarnation, entryId: target, summarize: "yes" },
	});
	const malformedBody = record(malformed.body, "malformed navigate body");
	check(malformed.status === 400 && record(malformedBody.error, "malformed navigate error").code === "invalid_body"
		&& started.host.store.getCommand(session.id, "tree-smoke-malformed") === undefined, "an unknown field or a non-boolean summarize is refused before the durable or runtime call");

	const navigated = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/tree/navigate`,
		token: controller,
		body: { commandId: "tree-smoke-navigate", incarnation, entryId: target, summarize: false },
	});
	const navigatedBody = record(navigated.body, "navigate body");
	check(navigated.status === 200 && navigatedBody.available === true, "a real navigation answers the runtime's own result");
	check(isTreeNavigate({
		moved: navigatedBody.moved,
		cancelled: navigatedBody.cancelled,
		aborted: navigatedBody.aborted,
		askReopen: navigatedBody.askReopen,
		summarized: navigatedBody.summarized,
		editorText: navigatedBody.editorText,
		editorTextTruncated: navigatedBody.editorTextTruncated,
		editorImageCount: navigatedBody.editorImageCount,
		leafId: navigatedBody.leafId,
	}), "the navigation answer describes what happened, and never reports a parked target as a move");
	check(navigatedBody.moved === true && navigatedBody.leafId === target, "the branch moved to the requested entry");
	const replay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/tree/navigate`,
		token: controller,
		body: { commandId: "tree-smoke-navigate", incarnation, entryId: target, summarize: false },
	});
	check(JSON.stringify(replay.body) === JSON.stringify(navigated.body), "a repeated navigation command id replays the same receipt");

	const stale = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/tree/navigate`,
		token: controller,
		body: { commandId: "tree-smoke-stale", incarnation: "incarnation-from-another-run", entryId: target },
	});
	check(stale.status === 409, `a stale incarnation is refused rather than applied (${stale.status})`);

	const refreshed = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/tree`, token: controller });
	const refreshedBody = record(refreshed.body, "refreshed tree body");
	check(refreshedBody.leafId === target, "the read that follows shows the branch the navigation actually set");
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
console.log(JSON.stringify({ ok: true, version }, null, 2));
