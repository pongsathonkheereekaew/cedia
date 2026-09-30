import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	NO_OMP_PAUSE_BRIDGE_REASON,
	NO_OMP_PAUSE_RUNTIME_REASON,
	OmpPause,
	OmpPauseValidationError,
	parseOmpPauseData,
	type OmpPauseCommandRequest,
	type OmpPauseData,
} from "../src/omp-pause.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const running: OmpPauseData = { paused: false };
const paused: OmpPauseData = { paused: true, pausedAt: 1790000000000 };

function controlResponse(operation: string, result: unknown) {
	return { data: { operation, capabilityRevision: "cap-pause-1", result } };
}

describe("OMP run pause projection", () => {
	it("strictly parses pause states and command receipts", () => {
		expect(parseOmpPauseData(running)).toEqual(running);
		expect(parseOmpPauseData(paused)).toEqual(paused);
		expect(() => parseOmpPauseData({ paused: false, extra: true })).toThrow(OmpPauseValidationError);
		expect(() => parseOmpPauseData({ paused: "yes" })).toThrow(/paused/);
		expect(() => parseOmpPauseData({ paused: true, pausedAt: -1 })).toThrow(/pausedAt/);
	});

	it("reads and drives the gate through the negotiated cedia_control bridge", async () => {
		const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
		let gate = false;
		const client = {
			phase: "ready" as const,
			readyFrame: { cediaCapabilitiesVersion: 1 },
			requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
				calls.push(request as { operation: string; payload?: Record<string, unknown> });
				if (request.operation === "pause.set") gate = (request.payload as { paused: boolean }).paused;
				return controlResponse(String(request.operation), gate ? { paused: true, pausedAt: 7 } : { paused: false });
			},
		};
		const state = new OmpPause({ client });
		expect(await state.refresh()).toEqual({ state: "available", revision: 1, paused: false });
		expect(await state.set(true)).toEqual({ paused: true, pausedAt: 7 });
		expect(await state.set(false)).toEqual({ paused: false });
		expect(calls).toEqual([{ operation: "pause.get" }, { operation: "pause.set", payload: { paused: true } }, { operation: "pause.set", payload: { paused: false } }]);
	});

	it("reports missing runtime and bridge without starting or probing one", async () => {
		let requests = 0;
		const stopped = new OmpPause({
			client: {
				phase: "closed",
				readyFrame: { cediaCapabilitiesVersion: 1 },
				requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
			},
		});
		expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_PAUSE_RUNTIME_REASON });
		expect(requests).toBe(0);

		const absent = new OmpPause({
			client: {
				phase: "ready",
				readyFrame: {},
				requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
			},
		});
		expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_PAUSE_BRIDGE_REASON });
		expect(requests).toBe(0);

		expect(await new OmpPause().refresh()).toEqual({ state: "unavailable", reason: NO_OMP_PAUSE_RUNTIME_REASON });
	});
});

describe("authenticated OMP pause routes", () => {
	const session = {
		id: "pause-session",
		projectId: "project-1",
		title: "Pause task",
		cwd: "/tmp/pause-project",
		sessionFile: "/tmp/pause-session.jsonl",
		incarnation: "inc-pause-1",
		status: "idle" as const,
		archived: false,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
	};

	function fixture() {
		const directory = mkdtempSync(join(tmpdir(), "cedia-pause-route-"));
		const auth = new DeviceAuth(directory);
		const calls: OmpPauseCommandRequest[] = [];
		const outcome = { state: "available" as const, revision: 4, paused: true, pausedAt: 9 };
		const host = {
			store: { getSession: (id: string) => id === session.id ? session : undefined },
			pauseSnapshot: async () => ({ state: "available" as const, revision: 3, paused: false }),
			pauseCommand: async (_id: string, _deviceId: string, request: OmpPauseCommandRequest) => { if (calls.length === 0) calls.push(request); return outcome; },
		} as unknown as CediaHost;
		return { directory, auth, router: createRouter(host, auth), calls, outcome };
	}

	it("answers GET and POST, rejects malformed envelopes, and replays a command id", async () => {
		const f = fixture();
		try {
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/pause`, token: f.auth.ownerToken })).toEqual({ status: 200, body: { state: "available", revision: 3, paused: false } });
			expect((await f.router({ method: "GET", path: `/v1/sessions/${session.id}/pause?nope=1`, token: f.auth.ownerToken })).body).toMatchObject({ error: { code: "invalid_query" } });
			const body = { commandId: "pause-1", incarnation: session.incarnation, paused: true };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/pause`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/pause`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(f.calls).toEqual([body]);
			for (const invalid of [
				{ commandId: "missing-paused", incarnation: session.incarnation },
				{ commandId: "bad-paused", incarnation: session.incarnation, paused: "yes" },
				{ commandId: "extra", incarnation: session.incarnation, paused: true, extra: true },
				{ incarnation: session.incarnation, paused: true },
				{ commandId: "missing-incarnation", paused: true },
			]) {
				const response = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/pause`, token: f.auth.ownerToken, body: invalid });
				expect(response).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});

	it("checks owner before wrong-method refusal", async () => {
		const f = fixture();
		const controller = f.auth.issue("pause-controller");
		try {
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/pause`, token: controller.token })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/pause`, token: f.auth.ownerToken, body: {} })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/pause/extra`, token: f.auth.ownerToken })).toMatchObject({ status: 404 });
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});
});

describe("real CediaHost pause route", () => {
	it("answers unavailable before start and drives the fixture gate after start", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-pause-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Pause fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const fixtureNode = process.env.CEDIA_FIXTURE_NODE ?? process.execPath;
		const commandLog = join(directory, "commands.log");
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_COMMAND_LOG: commandLog } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const session = host.createSession(project.id, "Pause fixture");
		try {
			expect((await router({ method: "GET", path: `/v1/sessions/${session.id}/pause`, token: auth.ownerToken })).body).toMatchObject({ state: "unavailable", reason: expect.stringMatching(/No OMP runtime/) });
			await host.startSession(session.id);
			const live = await router({ method: "GET", path: `/v1/sessions/${session.id}/pause`, token: auth.ownerToken });
			expect(live).toMatchObject({ status: 200, body: { state: "available", paused: false } });
			const incarnation = store.getSession(session.id)!.incarnation;
			const engaged = await router({ method: "POST", path: `/v1/sessions/${session.id}/pause`, token: auth.ownerToken, body: { commandId: "pause-host-set", incarnation, paused: true } });
			expect(engaged).toMatchObject({ status: 200, body: { state: "available", paused: true } });
			expect((await router({ method: "GET", path: `/v1/sessions/${session.id}/pause`, token: auth.ownerToken })).body).toMatchObject({ state: "available", paused: true });
			const replay = await router({ method: "POST", path: `/v1/sessions/${session.id}/pause`, token: auth.ownerToken, body: { commandId: "pause-host-set", incarnation, paused: true } });
			expect(replay.body).toEqual(engaged.body);
			const released = await router({ method: "POST", path: `/v1/sessions/${session.id}/pause`, token: auth.ownerToken, body: { commandId: "pause-host-release", incarnation, paused: false } });
			expect(released).toMatchObject({ status: 200, body: { state: "available", paused: false } });
			const pauseCalls = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string }).filter(command => command.type === "cedia_control" && (command.operation === "pause.get" || command.operation === "pause.set"));
			expect(pauseCalls.filter(command => command.operation === "pause.set")).toHaveLength(2);
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
