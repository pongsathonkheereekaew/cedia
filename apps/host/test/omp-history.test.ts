import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	NO_OMP_HISTORY_BRIDGE_REASON,
	NO_OMP_HISTORY_RUNTIME_REASON,
	OmpHistory,
	OmpHistoryValidationError,
	parseOmpHistoryCheckpoint,
	parseOmpHistoryFreshResult,
	parseOmpHistoryState,
	parseOmpHistoryTranscript,
	parseOmpHistoryResetResult,
	type OmpHistoryCommandRequest,
	type OmpHistoryState,
	type OmpHistoryTranscript,
} from "../src/omp-history.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const checkpoint = { messageCount: 3, entryId: "entry-3", startedAt: "2026-09-24T00:00:00.000Z" };
const lastRewind = {
	report: "Rewound to entry-2",
	reportTruncated: false,
	startedAt: "2026-09-24T00:00:00.000Z",
	rewoundAt: "2026-09-24T00:01:00.000Z",
};
const state: OmpHistoryState = { checkpoint, lastRewind };
const transcript: OmpHistoryTranscript = { text: "user: hello\nassistant: hi\n", truncated: false, bytes: 26 };

function controlResponse(operation: string, result: unknown) {
	return { data: { operation, capabilityRevision: "cap-history-1", result } };
}

describe("OMP history projection", () => {
	it("strictly parses state, transcript, and context operation results", () => {
		expect(parseOmpHistoryCheckpoint(checkpoint)).toEqual(checkpoint);
		expect(parseOmpHistoryCheckpoint(null)).toBeNull();
		expect(parseOmpHistoryState(state)).toEqual(state);
		expect(parseOmpHistoryTranscript(transcript)).toEqual(transcript);
		expect(parseOmpHistoryResetResult({ reset: true })).toEqual({ reset: true });
		expect(parseOmpHistoryFreshResult({ fresh: true, providerSessionId: null })).toEqual({ fresh: true, providerSessionId: null });
		expect(() => parseOmpHistoryState({ ...state, checkpoint: { ...checkpoint, messageCount: "3" } })).toThrow(OmpHistoryValidationError);
		expect(() => parseOmpHistoryState({ ...state, lastRewind: { ...lastRewind, reportTruncated: "no" } })).toThrow(/reportTruncated/);
		expect(() => parseOmpHistoryTranscript({ ...transcript, extra: true })).toThrow(/unknown field/);
		expect(() => parseOmpHistoryTranscript({ ...transcript, bytes: -1 })).toThrow(/bytes/);
		expect(() => parseOmpHistoryTranscript({ ...transcript, bytes: transcript.bytes + 1 })).toThrow(/match text/);
		expect(() => parseOmpHistoryState({ ...state, lastRewind: { ...lastRewind, report: "r".repeat(4_097) } })).toThrow(/exceeds/);
		expect(() => parseOmpHistoryResetResult({ reset: true, extra: true })).toThrow(/unknown field/);
		expect(() => parseOmpHistoryFreshResult({ fresh: true, providerSessionId: 42 })).toThrow(/providerSessionId/);
	});

	it("reads state and transcript and dispatches both context operations through cedia_control", async () => {
		const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
		const client = {
			phase: "ready" as const,
			readyFrame: { cediaCapabilitiesVersion: 1 },
			requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
				calls.push(request as { operation: string; payload?: Record<string, unknown> });
				const operation = String(request.operation);
				const result = operation === "history.state"
					? state
					: operation === "history.transcript"
						? transcript
						: operation === "context.reset"
							? { reset: true }
							: { fresh: true, providerSessionId: "provider-session-2" };
				return controlResponse(operation, result);
			},
		};
		const history = new OmpHistory({ client });
		expect(await history.refresh()).toEqual({ state: "available", ...state });
		expect(await history.transcript()).toEqual({ state: "available", ...transcript });
		expect(await history.reset()).toEqual({ reset: true });
		expect(await history.fresh()).toEqual({ fresh: true, providerSessionId: "provider-session-2" });
		expect(calls).toEqual([
			{ operation: "history.state" },
			{ operation: "history.transcript" },
			{ operation: "context.reset" },
			{ operation: "session.fresh" },
		]);
	});

	it("does not probe a stopped or non-advertising runtime", async () => {
		let requests = 0;
		const stopped = new OmpHistory({
			client: {
				phase: "closed",
				readyFrame: { cediaCapabilitiesVersion: 1 },
				requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
			},
		});
		expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_HISTORY_RUNTIME_REASON });
		expect(await stopped.transcript()).toEqual({ state: "unavailable", reason: NO_OMP_HISTORY_RUNTIME_REASON });

		const absent = new OmpHistory({
			client: {
				phase: "ready",
				readyFrame: {},
				requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
			},
		});
		expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_HISTORY_BRIDGE_REASON });
		expect(await absent.transcript()).toEqual({ state: "unavailable", reason: NO_OMP_HISTORY_BRIDGE_REASON });
		expect(requests).toBe(0);
	});
});

describe("authenticated OMP history routes", () => {
	const session = {
		id: "history-session",
		projectId: "project-1",
		title: "History task",
		cwd: "/tmp/history-project",
		sessionFile: "/tmp/history-session.jsonl",
		incarnation: "inc-history-1",
		status: "idle" as const,
		archived: false,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
	};

	function fixture() {
		const directory = mkdtempSync(join(tmpdir(), "cedia-history-route-"));
		const auth = new DeviceAuth(directory);
		const resetCalls: OmpHistoryCommandRequest[] = [];
		const freshCalls: OmpHistoryCommandRequest[] = [];
		const resetOutcome = { reset: true } as const;
		const freshOutcome = { fresh: true, providerSessionId: "provider-session-2" } as const;
		const host = {
			store: { getSession: (id: string) => id === session.id ? session : undefined },
			historySnapshot: async () => ({ available: true as const, checkpoint, lastRewind }),
			historyTranscript: async () => ({ available: true as const, ...transcript }),
			historyClear: async (_id: string, _deviceId: string, request: OmpHistoryCommandRequest) => { if (!resetCalls.length) resetCalls.push(request); return resetOutcome; },
			historyFresh: async (_id: string, _deviceId: string, request: OmpHistoryCommandRequest) => { if (!freshCalls.length) freshCalls.push(request); return freshOutcome; },
		} as unknown as CediaHost;
		return { directory, auth, router: createRouter(host, auth), resetCalls, freshCalls, resetOutcome, freshOutcome };
	}

	it("answers reads and replays both durable command ids", async () => {
		const f = fixture();
		try {
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/history`, token: f.auth.ownerToken })).toEqual({ status: 200, body: { available: true, checkpoint, lastRewind } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/history/transcript`, token: f.auth.ownerToken })).toEqual({ status: 200, body: { available: true, ...transcript } });
			const resetBody = { commandId: "history-clear-1", incarnation: session.incarnation };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/history/clear`, token: f.auth.ownerToken, body: resetBody })).toEqual({ status: 200, body: f.resetOutcome });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/history/clear`, token: f.auth.ownerToken, body: resetBody })).toEqual({ status: 200, body: f.resetOutcome });
			expect(f.resetCalls).toEqual([resetBody]);
			const freshBody = { commandId: "history-fresh-1", incarnation: session.incarnation };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/history/fresh`, token: f.auth.ownerToken, body: freshBody })).toEqual({ status: 200, body: f.freshOutcome });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/history/fresh`, token: f.auth.ownerToken, body: freshBody })).toEqual({ status: 200, body: f.freshOutcome });
			expect(f.freshCalls).toEqual([freshBody]);
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});

	it("rejects malformed envelopes, unsupported methods and controller credentials", async () => {
		const f = fixture();
		const controller = f.auth.issue("history-controller");
		try {
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/history`, token: controller.token })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/history?nope=1`, token: f.auth.ownerToken })).toMatchObject({ status: 400, body: { error: { code: "invalid_query" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/history/transcript?nope=1`, token: f.auth.ownerToken })).toMatchObject({ status: 400, body: { error: { code: "invalid_query" } } });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/history`, token: f.auth.ownerToken, body: {} })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/history/clear`, token: f.auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			for (const invalid of [
				{ commandId: "missing-incarnation" },
				{ incarnation: session.incarnation },
				{ commandId: "extra", incarnation: session.incarnation, extra: true },
			]) {
				expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/history/clear`, token: f.auth.ownerToken, body: invalid })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});
});

describe("real CediaHost history routes", () => {
	it("reads the fixture state/transcript and dispatches each recovery operation once", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-history-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "History fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const commandLog = join(directory, "commands.log");
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath, CEDIA_FAKE_COMMAND_LOG: commandLog } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const task = host.createSession(project.id, "History fixture");
		try {
			expect(await router({ method: "GET", path: `/v1/sessions/${task.id}/history`, token: auth.ownerToken })).toMatchObject({ status: 200, body: { available: false, reason: expect.stringMatching(/No OMP runtime/) } });
			expect(await router({ method: "GET", path: `/v1/sessions/${task.id}/history/transcript`, token: auth.ownerToken })).toMatchObject({ status: 200, body: { available: false, reason: expect.stringMatching(/No OMP runtime/) } });
		await host.startSession(task.id);
		const history = await router({ method: "GET", path: `/v1/sessions/${task.id}/history`, token: auth.ownerToken });
		expect(history).toEqual({ status: 200, body: { available: true, checkpoint, lastRewind } });
		const transcriptRoute = await router({ method: "GET", path: `/v1/sessions/${task.id}/history/transcript`, token: auth.ownerToken });
		expect(transcriptRoute).toEqual({ status: 200, body: { available: true, text: transcript.text, truncated: false, bytes: 26 } });
		const incarnation = store.getSession(task.id)!.incarnation;
		const clearBody = { commandId: "history-host-clear", incarnation };
		const clear = await router({ method: "POST", path: `/v1/sessions/${task.id}/history/clear`, token: auth.ownerToken, body: clearBody });
		expect(clear).toEqual({ status: 200, body: { reset: true } });
		expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/history/clear`, token: auth.ownerToken, body: clearBody })).toEqual(clear);
		expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/history/fresh`, token: auth.ownerToken, body: clearBody })).toMatchObject({ status: 400, body: { error: { code: "request_failed" } } });
		const freshBody = { commandId: "history-host-fresh", incarnation };
		const fresh = await router({ method: "POST", path: `/v1/sessions/${task.id}/history/fresh`, token: auth.ownerToken, body: freshBody });
		expect(fresh).toEqual({ status: 200, body: { fresh: true, providerSessionId: "fixture-provider-session" } });
		expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/history/fresh`, token: auth.ownerToken, body: freshBody })).toEqual(fresh);
		const commands = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string });
		expect(commands.filter(command => command.type === "cedia_control" && command.operation === "history.state")).toHaveLength(1);
		expect(commands.filter(command => command.type === "cedia_control" && command.operation === "history.transcript")).toHaveLength(1);
		expect(commands.filter(command => command.type === "cedia_control" && command.operation === "context.reset")).toHaveLength(1);
		expect(commands.filter(command => command.type === "cedia_control" && command.operation === "session.fresh")).toHaveLength(1);
		const clearReceipt = store.getCommand(task.id, clearBody.commandId);
		expect(clearReceipt).toMatchObject({ commandId: clearBody.commandId, incarnation, kind: "cedia_history_clear", status: "completed", payload: {}, ack: { command: "cedia_control", success: true }, result: { meaning: "OMP history context reset acknowledged", data: { reset: true } } });
		const freshReceipt = store.getCommand(task.id, freshBody.commandId);
		expect(freshReceipt).toMatchObject({ commandId: freshBody.commandId, incarnation, kind: "cedia_history_fresh", status: "completed", payload: {}, ack: { command: "cedia_control", success: true }, result: { meaning: "OMP history fresh session acknowledged", data: { fresh: true, providerSessionId: "fixture-provider-session" } } });
	} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("reports a malformed runtime answer as unavailable instead of coercing it", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-history-malformed-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Malformed history fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath, CEDIA_FAKE_HOST_MODE: "history-malformed-state" } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const task = host.createSession(project.id, "Malformed history fixture");
		try {
			await host.startSession(task.id);
			const response = await router({ method: "GET", path: `/v1/sessions/${task.id}/history`, token: auth.ownerToken });
			expect(response).toMatchObject({ status: 200, body: { available: false, reason: expect.stringMatching(/messageCount/) } });
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
