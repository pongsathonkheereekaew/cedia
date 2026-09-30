import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	NO_OMP_QUEUE_BRIDGE_REASON,
	NO_OMP_QUEUE_RUNTIME_REASON,
	OmpQueue,
	OmpQueueValidationError,
	parseOmpQueueData,
	parseOmpQueueDropOutcome,
	type OmpQueueDropRequest,
	type OmpQueueData,
} from "../src/omp-queue.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const queue: OmpQueueData = {
	steering: [{ text: "steer me", truncated: false, images: 1 }],
	followUp: [{ text: "follow up", truncated: true, images: 0 }],
};

function controlResponse(operation: string, result: unknown) {
	return { data: { operation, capabilityRevision: "cap-queue-1", result } };
}

describe("OMP queue projection", () => {
	it("strictly parses queue rows and drop results", () => {
		expect(parseOmpQueueData(queue)).toEqual(queue);
		expect(parseOmpQueueData({ ...queue, dropped: [{ text: "gone", truncated: false, images: 2 }] })).toEqual({
			...queue,
			dropped: [{ text: "gone", truncated: false, images: 2 }],
		});
		expect(() => parseOmpQueueData({ ...queue, extra: true })).toThrow(OmpQueueValidationError);
		expect(() => parseOmpQueueData({ ...queue, steering: [{ text: "bad", truncated: false, images: -1 }] })).toThrow(/images/);
		expect(() => parseOmpQueueData({ ...queue, followUp: [{ text: "bad", truncated: "no", images: 0 }] })).toThrow(/truncated/);
		expect(parseOmpQueueDropOutcome({ ...queue, dropped: [], droppedIntentIds: ["turn-1"] }).droppedIntentIds).toEqual(["turn-1"]);
		expect(() => parseOmpQueueDropOutcome({ ...queue, dropped: [], droppedIntentIds: Array.from({ length: 10_001 }, (_, index) => `turn-${index}`) })).toThrow(/exceed 10000/);
	});

	it("reads and drops through the negotiated cedia_control bridge", async () => {
		const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
		const client = {
			phase: "ready" as const,
			readyFrame: { cediaCapabilitiesVersion: 1 },
			requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
				calls.push(request as { operation: string; payload?: Record<string, unknown> });
				return controlResponse(String(request.operation), request.operation === "queue.drop" ? { ...queue, dropped: queue.steering, droppedIntentIds: ["turn-private-id"] } : queue);
			},
		};
		const state = new OmpQueue({ client });
		expect(await state.refresh()).toEqual({ state: "available", revision: 1, ...queue });
		expect(await state.drop("last")).toEqual({ ...queue, dropped: queue.steering, droppedIntentIds: ["turn-private-id"] });
		expect(state.snapshot()).toEqual({ state: "available", revision: 2, ...queue, dropped: queue.steering });
		expect(JSON.stringify(state.snapshot())).not.toContain("turn-private-id");
		expect(calls).toEqual([{ operation: "queue.get" }, { operation: "queue.drop", payload: { mode: "last" } }]);
	});

	it("reports missing runtime and bridge without starting or probing one", async () => {
		let requests = 0;
		const stopped = new OmpQueue({
			client: {
				phase: "closed",
				readyFrame: { cediaCapabilitiesVersion: 1 },
				requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
			},
		});
		expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_QUEUE_RUNTIME_REASON });
		expect(requests).toBe(0);

		const absent = new OmpQueue({
			client: {
				phase: "ready",
				readyFrame: {},
				requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
			},
		});
		expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_QUEUE_BRIDGE_REASON });
		expect(requests).toBe(0);

		expect(await new OmpQueue().refresh()).toEqual({ state: "unavailable", reason: NO_OMP_QUEUE_RUNTIME_REASON });
	});
});

describe("authenticated OMP queue routes", () => {
	const session = {
		id: "queue-session",
		projectId: "project-1",
		title: "Queue task",
		cwd: "/tmp/queue-project",
		sessionFile: "/tmp/queue-session.jsonl",
		incarnation: "inc-queue-1",
		status: "idle" as const,
		archived: false,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
	};

	function fixture() {
		const directory = mkdtempSync(join(tmpdir(), "cedia-queue-route-"));
		const auth = new DeviceAuth(directory);
		const calls: OmpQueueDropRequest[] = [];
		const outcome = { state: "available" as const, revision: 4, steering: [], followUp: [], dropped: [{ text: "gone", truncated: false, images: 0 }] };
		const host = {
			store: { getSession: (id: string) => id === session.id ? session : undefined },
			queueSnapshot: async () => ({ state: "available" as const, revision: 3, steering: queue.steering, followUp: queue.followUp }),
		queueDrop: async (_id: string, _deviceId: string, request: OmpQueueDropRequest) => { if (calls.length === 0) calls.push(request); return outcome; },
		} as unknown as CediaHost;
		return { directory, auth, router: createRouter(host, auth), calls, outcome };
	}

	it("answers GET and POST, rejects malformed envelopes, and replays a command id", async () => {
		const f = fixture();
		try {
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: f.auth.ownerToken })).toEqual({ status: 200, body: { state: "available", revision: 3, steering: queue.steering, followUp: queue.followUp } });
			expect((await f.router({ method: "GET", path: `/v1/sessions/${session.id}/queue?nope=1`, token: f.auth.ownerToken })).body).toMatchObject({ error: { code: "invalid_query" } });
			const body = { commandId: "queue-drop-1", incarnation: session.incarnation, mode: "last" as const };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/queue/drop`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/queue/drop`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(f.calls).toEqual([body]);
			for (const invalid of [
				{ commandId: "missing-mode", incarnation: session.incarnation },
				{ commandId: "bad-mode", incarnation: session.incarnation, mode: "nope" },
				{ commandId: "extra", incarnation: session.incarnation, mode: "last", extra: true },
				{ incarnation: session.incarnation, mode: "last" },
				{ commandId: "missing-incarnation", mode: "last" },
			]) {
				const response = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/queue/drop`, token: f.auth.ownerToken, body: invalid });
				expect(response).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});

	it("checks owner before wrong-method refusal", async () => {
		const f = fixture();
		const controller = f.auth.issue("queue-controller");
		try {
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: controller.token })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/queue`, token: f.auth.ownerToken, body: {} })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/queue/drop`, token: f.auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});
});

describe("real CediaHost queue route", () => {
	it("answers unavailable before start and the runtime's queue after start", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-queue-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Queue fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const fixtureNode = process.env.CEDIA_FIXTURE_NODE ?? process.execPath;
		const commandLog = join(directory, "commands.log");
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_COMMAND_LOG: commandLog } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const session = host.createSession(project.id, "Queue fixture");
		try {
			expect((await router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: auth.ownerToken })).body).toMatchObject({ state: "unavailable", reason: expect.stringMatching(/No OMP runtime/) });
			await host.startSession(session.id);
			const live = await router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: auth.ownerToken });
			expect(live).toMatchObject({ status: 200, body: { state: "available", steering: [], followUp: [] } });
			const incarnation = store.getSession(session.id)!.incarnation;
			const dropped = await router({ method: "POST", path: `/v1/sessions/${session.id}/queue/drop`, token: auth.ownerToken, body: { commandId: "queue-host-drop", incarnation, mode: "all" } });
			expect(dropped).toMatchObject({ status: 200, body: { state: "available", dropped: [] } });
			const replay = await router({ method: "POST", path: `/v1/sessions/${session.id}/queue/drop`, token: auth.ownerToken, body: { commandId: "queue-host-drop", incarnation, mode: "all" } });
			expect(replay.body).toEqual(dropped.body);
			const dropCalls = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string }).filter(command => command.type === "cedia_control" && command.operation === "queue.drop");
			expect(dropCalls).toHaveLength(1);
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
