/**
 * Live proof of Cedia's O09 context view against the pinned runtime.
 *
 * OMP owns context accounting and maintenance state. This smoke reads that state through the
 * capability bridge, then proves Cedia's owner-only routes preserve an omitted breakdown, return
 * OMP's post-control state, and report image removal as zero on a branch with no images. The
 * fixture listener never answers, so no provider request can complete during this run.
 *
 * Run: bun scripts/omp-context-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP context smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP context smoke failed: ${message}`);
	return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value);
}

const numericShakeFields = ["toolResultsDropped", "blocksDropped", "imagesDropped", "thinkingBlocksDropped", "tokensFreed"] as const;

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

const cwd = await mkdtemp(join(tmpdir(), "cedia-context-"));
const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");
const modelsYaml = `providers:
  cedia-context-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-context-fixture-model
        name: Cedia context smoke fixture
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
	const answer = await client.requestCedia("cedia_control", { operation: "context.get" });
	const raw = record(record(answer.data, "cedia_control data").result, "context.get result");
	check(typeof raw.compacting === "boolean" && typeof raw.speculation === "string", "the runtime answers context maintenance state");
	check(record(raw.usage, "runtime usage").contextWindow !== undefined && typeof record(raw.usage, "runtime usage").usedTokens === "number", "a configured model gives the runtime a numeric context breakdown");
	const shaken = await client.requestCedia("cedia_control", { operation: "context.shake", payload: { mode: "elide" } });
	const shakenRaw = record(record(shaken.data, "cedia_control shake data").result, "context.shake result");
	const shake = record(shakenRaw.shake, "context.shake shake result");
	check(shake.mode === "elide" && numericShakeFields.filter(field => Object.hasOwn(shake, field)).every(field => finiteNumber(shake[field])), "the runtime answers its own elide shake result with numeric counts");
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-context-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-context-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-context-host-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Context smoke" });
	const session = started.host.createSession(project.id, "Context smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/context`, token: owner });
	const beforeBody = record(before.body, "context body before start");
	check(before.status === 200 && beforeBody.state === "unavailable" && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/context`, token: owner });
	const liveBody = record(live.body, "live context body");
	check(live.status === 200 && liveBody.state === "available", "the context route answers for a live session");
	check(record(liveBody.usage, "live context usage").contextWindow !== undefined && typeof record(liveBody.usage, "live context usage").usedTokens === "number", "the route carries OMP's numeric accounting");

	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const unknown = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/context/shake`,
		token: owner,
		body: { commandId: "context-smoke-unknown", incarnation, mode: "unknown" },
	});
	const unknownBody = record(unknown.body, "unknown shake body");
	check(unknown.status === 400 && record(unknownBody.error, "unknown shake error").code === "invalid_body" && started.host.store.getCommand(session.id, "context-smoke-unknown") === undefined, "an unknown shake mode is refused before the durable or runtime call");

	const shakenHost = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/context/shake`,
		token: owner,
		body: { commandId: "context-smoke-shake", incarnation, mode: "elide" },
	});
	const shakenHostBody = record(shakenHost.body, "host shake body");
	const hostShake = record(shakenHostBody.shake, "host shake result");
	check(shakenHost.status === 200 && shakenHostBody.state === "available" && hostShake.mode === "elide" && numericShakeFields.filter(field => Object.hasOwn(hostShake, field)).every(field => finiteNumber(hostShake[field])), "a fresh session shake answers the runtime's own result");
	const shakeReplay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/context/shake`,
		token: owner,
		body: { commandId: "context-smoke-shake", incarnation, mode: "elide" },
	});
	check(JSON.stringify(shakeReplay.body) === JSON.stringify(shakenHost.body), "a repeated shake command id replays the same receipt");

	const aborted = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/context/abort-compaction`,
		token: owner,
		body: { commandId: "context-smoke-abort", incarnation },
	});
	const abortedBody = record(aborted.body, "abort body");
	check(aborted.status === 200 && typeof abortedBody.compacting === "boolean" && typeof abortedBody.speculation === "string", "abort-compaction answers the state that follows the cancel request");

	const dropped = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/context/drop-images`,
		token: owner,
		body: { commandId: "context-smoke-drop", incarnation },
	});
	const droppedBody = record(dropped.body, "drop body");
	check(dropped.status === 200 && droppedBody.removed === 0 && typeof droppedBody.compacting === "boolean" && typeof droppedBody.speculation === "string" && typeof record(droppedBody.usage, "drop usage").usedTokens === "number", "drop-images reports zero removed images with the runtime's full accounting");
	const replay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/context/drop-images`,
		token: owner,
		body: { commandId: "context-smoke-drop", incarnation },
	});
	check(JSON.stringify(replay.body) === JSON.stringify(dropped.body), "a repeated context command id replays the same receipt");

	const notOwner = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/context` });
	check(notOwner.status === 401 || notOwner.status === 403, `the context routes are owner-only (${notOwner.status})`);
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
