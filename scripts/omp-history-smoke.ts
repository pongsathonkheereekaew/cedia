/**
 * Live proof of Cedia's O02 history view against the pinned runtime.
 *
 * OMP owns the session, its tree and its checkpoint/rewind bookkeeping. This smoke reads that
 * state through the capability bridge, then proves Cedia's owner-only routes answer the runtime's
 * own facts, keep a missing runtime distinct from an empty history, and replay a durable command
 * instead of dispatching it twice. The fixture listener never answers, so no provider request can
 * complete during this run.
 *
 * Run: bun scripts/omp-history-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP history smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP history smoke failed: ${message}`);
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

/** The runtime's own answer to `context.reset`, as the bridge registers it. */
function isResetResult(value: unknown): boolean {
	const row = record(value, "context.reset result");
	return row.reset === true && Object.keys(row).length === 1;
}

/** The runtime's own answer to `session.fresh`, as the bridge registers it. */
function isFreshResult(value: unknown): boolean {
	const row = record(value, "session.fresh result");
	return row.fresh === true && (row.providerSessionId === null || typeof row.providerSessionId === "string");
}

/** The runtime's own answer to `history.transcript`: bounded text whose size it reports itself. */
function isTranscriptResult(value: unknown): boolean {
	const row = record(value, "history.transcript result");
	return typeof row.text === "string" && typeof row.truncated === "boolean"
		&& row.bytes === Buffer.byteLength(row.text, "utf8")
		&& Buffer.byteLength(row.text, "utf8") <= 262_144;
}

/** The runtime's own answer to `history.state`: checkpoint and rewind projected, never invented. */
function isHistoryStateResult(value: unknown): boolean {
	const row = record(value, "history.state result");
	const checkpoint = row.checkpoint;
	if (checkpoint !== null) {
		const held = record(checkpoint, "history.state checkpoint");
		if (typeof held.messageCount !== "number" || typeof held.startedAt !== "string") return false;
		if (held.entryId !== null && typeof held.entryId !== "string") return false;
	}
	const rewind = row.lastRewind;
	if (rewind !== null) {
		const held = record(rewind, "history.state lastRewind");
		if (typeof held.report !== "string" || held.report.length > 4_096) return false;
		if (typeof held.reportTruncated !== "boolean" || typeof held.startedAt !== "string" || typeof held.rewoundAt !== "string") return false;
	}
	return "checkpoint" in row && "lastRewind" in row;
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-history-"));
const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");
const modelsYaml = `providers:
  cedia-history-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-history-fixture-model
        name: Cedia history smoke fixture
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

	const state = await client.requestCedia("cedia_control", { operation: "history.state" });
	const stateResult = record(state.data, "history.state data").result;
	check(isHistoryStateResult(stateResult), "the runtime answers its own checkpoint/rewind state");
	check(record(stateResult).checkpoint === null && record(stateResult).lastRewind === null, "a session with no checkpoint or rewind reports neither rather than a fabricated default");

	const transcript = await client.requestCedia("cedia_control", { operation: "history.transcript" });
	const transcriptResult = record(transcript.data, "history.transcript data").result;
	check(isTranscriptResult(transcriptResult), "the runtime answers its own bounded transcript text with its own byte count");

	const fresh = await client.requestCedia("cedia_control", { operation: "session.fresh" });
	check(isFreshResult(record(fresh.data, "session.fresh data").result), "the runtime rotates provider state and answers the ids that follow");

	const reset = await client.requestCedia("cedia_control", { operation: "context.reset" });
	check(isResetResult(record(reset.data, "context.reset data").result), "the runtime clears the context in place and answers its own acknowledgement");

	let unknownRefused = false;
	try {
		await client.requestCedia("cedia_control", { operation: "history.unknown" });
	} catch {
		unknownRefused = true;
	}
	check(unknownRefused, "an operation outside the static table is refused before any handler runs");

	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-history-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-history-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-history-host-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "History smoke" });
	const session = started.host.createSession(project.id, "History smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/history`, token: owner });
	const beforeBody = record(before.body, "history body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");
	const beforeTranscript = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/history/transcript`, token: owner });
	const beforeTranscriptBody = record(beforeTranscript.body, "transcript body before start");
	check(beforeTranscript.status === 200 && beforeTranscriptBody.available === false && typeof beforeTranscriptBody.reason === "string", "a transcript read with no runtime reports the same absence");

	await started.host.startSession(session.id);
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/history`, token: owner });
	const liveBody = record(live.body, "live history body");
	check(live.status === 200 && liveBody.available === true && liveBody.checkpoint === null && liveBody.lastRewind === null, "the history route answers OMP's own state for a live session");
	const liveTranscript = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/history/transcript`, token: owner });
	const liveTranscriptBody = record(liveTranscript.body, "live transcript body");
	check(liveTranscript.status === 200 && liveTranscriptBody.available === true && typeof liveTranscriptBody.text === "string"
		&& liveTranscriptBody.bytes === Buffer.byteLength(liveTranscriptBody.text as string, "utf8")
		&& typeof liveTranscriptBody.truncated === "boolean", "the transcript route carries the runtime's own text, byte count and truncation flag");

	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const malformed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/history/clear`,
		token: owner,
		body: { commandId: "history-smoke-malformed", incarnation, mode: "all" },
	});
	const malformedBody = record(malformed.body, "malformed clear body");
	check(malformed.status === 400 && record(malformedBody.error, "malformed clear error").code === "invalid_body"
		&& started.host.store.getCommand(session.id, "history-smoke-malformed") === undefined, "an unknown clear field is refused before the durable or runtime call");

	const cleared = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/history/clear`,
		token: owner,
		body: { commandId: "history-smoke-clear", incarnation },
	});
	const clearedBody = record(cleared.body, "clear body");
	check(cleared.status === 200 && clearedBody.reset === true, "a fresh session clear answers the runtime's own acknowledgement");
	const clearedReplay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/history/clear`,
		token: owner,
		body: { commandId: "history-smoke-clear", incarnation },
	});
	check(JSON.stringify(clearedReplay.body) === JSON.stringify(cleared.body), "a repeated clear command id replays the same receipt");

	const freshened = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/history/fresh`,
		token: owner,
		body: { commandId: "history-smoke-fresh", incarnation },
	});
	const freshenedBody = record(freshened.body, "fresh body");
	check(freshened.status === 200 && freshenedBody.fresh === true
		&& (freshenedBody.providerSessionId === null || typeof freshenedBody.providerSessionId === "string"), "the fresh route answers the runtime's own provider-session result");

	const stale = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/history/fresh`,
		token: owner,
		body: { commandId: "history-smoke-stale", incarnation: "incarnation-from-another-run" },
	});
	check(stale.status === 409, `a stale incarnation is refused rather than applied (${stale.status})`);

	const controller = started.auth.issue("History smoke controller").token;
	const notOwner = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/history`, token: controller });
	check(notOwner.status === 401 || notOwner.status === 403, `a paired controller is refused on the history read (${notOwner.status})`);
	const notOwnerClear = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/history/clear`,
		token: controller,
		body: { commandId: "history-smoke-controller", incarnation },
	});
	check(notOwnerClear.status === 401 || notOwnerClear.status === 403
		&& started.host.store.getCommand(session.id, "history-smoke-controller") === undefined, `a paired controller is refused on the history write (${notOwnerClear.status})`);
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
