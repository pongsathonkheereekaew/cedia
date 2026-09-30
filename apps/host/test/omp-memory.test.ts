import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	NO_OMP_MEMORY_BRIDGE_REASON,
	NO_OMP_MEMORY_RUNTIME_REASON,
	OmpMemory,
	OmpMemoryValidationError,
	parseOmpMemoryData,
	type OmpMemoryCommandRequest,
	type OmpMemoryData,
} from "../src/omp-memory.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const mnemopi = {
	sessionId: "mnemopi-session",
	lastRetainedTurn: 3,
	hasRecalledForFirstTurn: true,
	recallTargets: 2,
	hasGlobalTarget: false,
};

const hindsight = {
	sessionId: "hindsight-session",
	bankId: "fixture-bank",
	banksSet: 1,
	retainTags: 2,
	recallTags: 1,
	recallTagsMatch: "any" as const,
	lastRetainedTurn: 4,
	hasRecalledForFirstTurn: false,
};

const memory: OmpMemoryData = { backend: "mnemopi", mnemopi, hindsight };

function controlResponse(operation: string, result: unknown) {
	return { data: { operation, capabilityRevision: "cap-memory-1", result } };
}

describe("OMP memory projection", () => {
	it("strictly parses the runtime shape and keeps absent blocks absent", () => {
		expect(parseOmpMemoryData(memory)).toEqual(memory);
		expect(parseOmpMemoryData({ backend: "off" })).toEqual({ backend: "off" });
		expect(parseOmpMemoryData({ ...memory, applied: true })).toEqual({ ...memory, applied: true });
		expect(() => parseOmpMemoryData({ ...memory, backend: "remote" })).toThrow(OmpMemoryValidationError);
		expect(() => parseOmpMemoryData({ ...memory, mnemopi: { ...mnemopi, lastRetainedTurn: "3" } })).toThrow(/lastRetainedTurn/);
		expect(() => parseOmpMemoryData({ ...memory, hindsight: { ...hindsight, secret: true } })).toThrow(/unknown field/);
		expect(() => parseOmpMemoryData({ ...memory, applied: false })).toThrow(/applied/);
	});

	it("reads only a live negotiated runtime and reports absence otherwise", async () => {
		let requests = 0;
		const stopped = new OmpMemory({
			client: {
				phase: "closed",
				readyFrame: { cediaCapabilitiesVersion: 1 },
				requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
			},
		});
		expect(await stopped.read()).toBeUndefined();
		expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_MEMORY_RUNTIME_REASON });
		expect(requests).toBe(0);

		const absent = new OmpMemory({
			client: {
				phase: "ready",
				readyFrame: {},
				requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
			},
		});
		expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_MEMORY_BRIDGE_REASON });
		expect(requests).toBe(0);
		expect(await new OmpMemory().refresh()).toEqual({ state: "unavailable", reason: NO_OMP_MEMORY_RUNTIME_REASON });
	});

	it("reads and applies through the no-payload memory bridge", async () => {
		const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
		const client = {
			phase: "ready" as const,
			readyFrame: { cediaCapabilitiesVersion: 1 },
			requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
				calls.push(request as { operation: string; payload?: Record<string, unknown> });
				const operation = String(request.operation);
				return controlResponse(operation, operation === "memory.apply" ? { ...memory, applied: true } : memory);
			},
		};
		const state = new OmpMemory({ client });
		expect(await state.refresh()).toEqual({ state: "available", revision: 1, ...memory });
		expect(await state.apply()).toEqual({ ...memory, applied: true });
		expect(calls).toEqual([{ operation: "memory.get" }, { operation: "memory.apply" }]);
	});
});

describe("authenticated OMP memory routes", () => {
	const session = {
		id: "memory-session",
		projectId: "project-1",
		title: "Memory task",
		cwd: "/tmp/memory-project",
		sessionFile: "/tmp/memory-session.jsonl",
		incarnation: "inc-memory-1",
		status: "idle" as const,
		archived: false,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
	};

	function fixture() {
		const directory = mkdtempSync(join(tmpdir(), "cedia-memory-route-"));
		const auth = new DeviceAuth(directory);
		const calls: OmpMemoryCommandRequest[] = [];
		const outcome = { state: "available" as const, revision: 2, backend: "off" as const, applied: true };
		const host = {
			store: { getSession: (id: string) => id === session.id ? session : undefined },
			memorySnapshot: async () => ({ state: "available" as const, revision: 1, backend: "off" as const }),
			memoryApply: async (_id: string, _deviceId: string, request: OmpMemoryCommandRequest) => { if (calls.length === 0) calls.push(request); return outcome; },
		} as unknown as CediaHost;
		return { directory, auth, router: createRouter(host, auth), calls, outcome };
	}

	it("answers reads without inventing absent blocks and replays command ids", async () => {
		const f = fixture();
		try {
			const get = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/memory`, token: f.auth.ownerToken });
			expect(get).toEqual({ status: 200, body: { state: "available", revision: 1, backend: "off" } });
			expect((await f.router({ method: "GET", path: `/v1/sessions/${session.id}/memory?nope=1`, token: f.auth.ownerToken })).body).toMatchObject({ error: { code: "invalid_query" } });

			const body = { commandId: "memory-apply-1", incarnation: session.incarnation };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/memory/apply`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/memory/apply`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(f.calls).toEqual([body]);

			for (const invalid of [
				{ commandId: "missing-incarnation" },
				{ incarnation: session.incarnation },
				{ commandId: "extra", incarnation: session.incarnation, extra: true },
			]) {
				const response = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/memory/apply`, token: f.auth.ownerToken, body: invalid });
				expect(response).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});

	it("checks owner before wrong-method refusal", async () => {
		const f = fixture();
		const controller = f.auth.issue("memory-controller");
		try {
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/memory`, token: controller.token })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/memory`, token: f.auth.ownerToken, body: {} })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/memory/apply`, token: f.auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});
});

describe("real CediaHost memory route", () => {
	it("reports unavailable before start and the runtime's shape after start", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-memory-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Memory fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const commandLog = join(directory, "commands.log");
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath, CEDIA_FAKE_COMMAND_LOG: commandLog } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const session = host.createSession(project.id, "Memory fixture");
		try {
			const before = await router({ method: "GET", path: `/v1/sessions/${session.id}/memory`, token: auth.ownerToken });
			expect(before).toMatchObject({ status: 200, body: { state: "unavailable", reason: expect.stringMatching(/No OMP runtime/) } });
			await host.startSession(session.id);
			const live = await router({ method: "GET", path: `/v1/sessions/${session.id}/memory`, token: auth.ownerToken });
			expect(live).toMatchObject({ status: 200, body: { state: "available", backend: "off" } });
			expect((live.body as { revision?: number }).revision).toBeGreaterThan(0);
			expect((live.body as Record<string, unknown>).mnemopi).toBeUndefined();
			expect((live.body as Record<string, unknown>).hindsight).toBeUndefined();
			const incarnation = store.getSession(session.id)!.incarnation;
			const applied = await router({ method: "POST", path: `/v1/sessions/${session.id}/memory/apply`, token: auth.ownerToken, body: { commandId: "memory-host-apply", incarnation } });
			expect(applied).toMatchObject({ status: 200, body: { state: "available", backend: "off", applied: true } });
			const replay = await router({ method: "POST", path: `/v1/sessions/${session.id}/memory/apply`, token: auth.ownerToken, body: { commandId: "memory-host-apply", incarnation } });
			expect(JSON.stringify(replay.body)).toBe(JSON.stringify(applied.body));
			const applyCalls = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string }).filter(command => command.type === "cedia_control" && command.operation === "memory.apply");
			expect(applyCalls).toHaveLength(1);
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
