import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	NO_OMP_CONTEXT_BRIDGE_REASON,
	NO_OMP_CONTEXT_RUNTIME_REASON,
	OmpContext,
	OmpContextValidationError,
	parseOmpContextData,
	type OmpContextData,
	type OmpContextCommandRequest,
	type OmpContextShakeRequest,
} from "../src/omp-context.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const usage = {
	contextWindow: 128_000,
	anchored: true,
	usedTokens: 2_048,
	systemPromptTokens: 600,
	systemToolsTokens: 400,
	systemContextTokens: 200,
	skillsTokens: 100,
	messagesTokens: 748,
};

const context: OmpContextData = { usage, compacting: false, speculation: "idle" };
const shake = {
	mode: "elide" as const,
	toolResultsDropped: 2,
	blocksDropped: 3,
	imagesDropped: 1,
	thinkingBlocksDropped: 0,
	tokensFreed: 512,
	artifactId: "artifact-context-1",
};

function controlResponse(operation: string, result: unknown) {
	return { data: { operation, capabilityRevision: "cap-context-1", result } };
}

describe("OMP context projection", () => {
	it("strictly parses the runtime shape, including an omitted usage breakdown", () => {
		expect(parseOmpContextData(context)).toEqual(context);
		expect(parseOmpContextData({ compacting: true, speculation: "armed" })).toEqual({ compacting: true, speculation: "armed" });
		expect(parseOmpContextData({ ...context, removed: 2 })).toEqual({ ...context, removed: 2 });
		expect(parseOmpContextData({ ...context, shake })).toEqual({ ...context, shake });
		expect(() => parseOmpContextData({ ...context, shake: { ...shake, mode: "unknown" } })).toThrow(/mode/);
		expect(() => parseOmpContextData({ ...context, shake: { ...shake, tokensFreed: "many" } })).toThrow(/tokensFreed/);
		expect(() => parseOmpContextData({ ...context, shake: { ...shake, artifactId: "" } })).toThrow(/artifactId/);
		expect(() => parseOmpContextData({ ...context, usage: { ...usage, usedTokens: "many" } })).toThrow(OmpContextValidationError);
		expect(() => parseOmpContextData({ ...context, speculation: "maybe" })).toThrow(/speculation/);
		expect(() => parseOmpContextData({ ...context, compacting: "no" })).toThrow(/compacting/);
		expect(() => parseOmpContextData({ speculation: "idle" })).toThrow(/compacting/);
		expect(() => parseOmpContextData({ ...context, usage: { ...usage, anchored: 1 } })).toThrow(/anchored/);
		const { anchored: _anchored, ...withoutAnchored } = usage;
		expect(() => parseOmpContextData({ ...context, usage: withoutAnchored })).toThrow(/anchored/);
		expect(() => parseOmpContextData({ ...context, usage: { ...usage, messagesTokens: Number.NaN } })).toThrow(/messagesTokens/);
		expect(() => parseOmpContextData({ ...context, extra: true })).toThrow(/unknown field/);
	});

	it("reads only a live negotiated runtime and reports absence otherwise", async () => {
		let requests = 0;
		const stopped = new OmpContext({
			client: {
				phase: "closed",
				readyFrame: { cediaCapabilitiesVersion: 1 },
				requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
			},
		});
		expect(await stopped.read()).toBeUndefined();
		expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_CONTEXT_RUNTIME_REASON });
		expect(requests).toBe(0);

		const absent = new OmpContext({
			client: {
				phase: "ready",
				readyFrame: {},
				requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
			},
		});
		expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_CONTEXT_BRIDGE_REASON });
		expect(requests).toBe(0);
		expect(await new OmpContext().refresh()).toEqual({ state: "unavailable", reason: NO_OMP_CONTEXT_RUNTIME_REASON });
	});

	it("reads and applies the three no-payload context controls", async () => {
		const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
		const client = {
			phase: "ready" as const,
			readyFrame: { cediaCapabilitiesVersion: 1 },
			requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
				calls.push(request as { operation: string; payload?: Record<string, unknown> });
				const operation = String(request.operation);
				return controlResponse(operation, operation === "context.drop-images" ? { ...context, removed: 2 } : context);
			},
		};
		const state = new OmpContext({ client });
		expect(await state.refresh()).toEqual({ state: "available", revision: 1, ...context });
		expect(await state.dropImages()).toEqual({ ...context, removed: 2 });
		expect(await state.abortCompaction()).toEqual(context);
		expect(calls).toEqual([{ operation: "context.get" }, { operation: "context.drop-images" }, { operation: "context.abort-compaction" }]);
	});

	it("shakes context through the negotiated control and keeps the runtime result", async () => {
		const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
		const client = {
			phase: "ready" as const,
			readyFrame: { cediaCapabilitiesVersion: 1 },
			requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
				calls.push(request as { operation: string; payload?: Record<string, unknown> });
				return controlResponse(String(request.operation), { ...context, shake });
			},
		};
		const state = new OmpContext({ client });
		expect(await state.shake("elide")).toEqual({ ...context, shake });
		expect(calls).toEqual([{ operation: "context.shake", payload: { mode: "elide" } }]);
	});
});

describe("authenticated OMP context routes", () => {
	const session = {
		id: "context-session",
		projectId: "project-1",
		title: "Context task",
		cwd: "/tmp/context-project",
		sessionFile: "/tmp/context-session.jsonl",
		incarnation: "inc-context-1",
		status: "idle" as const,
		archived: false,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
	};

	function fixture() {
		const directory = mkdtempSync(join(tmpdir(), "cedia-context-route-"));
		const auth = new DeviceAuth(directory);
		const calls: OmpContextCommandRequest[] = [];
		const shakeCalls: OmpContextShakeRequest[] = [];
		const outcome = { state: "available" as const, revision: 4, compacting: false, speculation: "idle" as const, removed: 0 };
		const shakeOutcome = { state: "available" as const, revision: 5, compacting: false, speculation: "idle" as const, shake };
		const host = {
			store: { getSession: (id: string) => id === session.id ? session : undefined },
			contextSnapshot: async () => ({ state: "available" as const, revision: 3, compacting: false, speculation: "idle" as const }),
			contextDropImages: async (_id: string, _deviceId: string, request: OmpContextCommandRequest) => { if (calls.length === 0) calls.push(request); return outcome; },
			contextAbortCompaction: async (_id: string, _deviceId: string, request: OmpContextCommandRequest) => { calls.push(request); return { ...outcome, removed: undefined }; },
			contextShake: async (_id: string, _deviceId: string, request: OmpContextShakeRequest) => { if (!shakeCalls.some(entry => entry.commandId === request.commandId)) shakeCalls.push(request); return shakeOutcome; },
		} as unknown as CediaHost;
		return { directory, auth, router: createRouter(host, auth), calls, shakeCalls, outcome, shakeOutcome };
	}

	it("answers reads without inventing an omitted usage and replays command ids", async () => {
		const f = fixture();
		try {
			const get = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/context`, token: f.auth.ownerToken });
			expect(get).toEqual({ status: 200, body: { state: "available", revision: 3, compacting: false, speculation: "idle" } });
			const unknownQuery = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/context?nope=1`, token: f.auth.ownerToken });
			expect(unknownQuery).toMatchObject({ status: 400, body: { error: { code: "invalid_query" } } });

			const body = { commandId: "context-drop-1", incarnation: session.incarnation };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/context/drop-images`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/context/drop-images`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
		expect(f.calls).toEqual([body]);

			for (const invalid of [
				{ commandId: "missing-incarnation" },
				{ incarnation: session.incarnation },
				{ commandId: "extra", incarnation: session.incarnation, extra: true },
			]) {
				const response = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/context/drop-images`, token: f.auth.ownerToken, body: invalid });
				expect(response).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}

			const shakeBody = { commandId: "context-shake-1", incarnation: session.incarnation, mode: "elide" as const };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/context/shake`, token: f.auth.ownerToken, body: shakeBody })).toEqual({ status: 200, body: f.shakeOutcome });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/context/shake`, token: f.auth.ownerToken, body: shakeBody })).toEqual({ status: 200, body: f.shakeOutcome });
			expect(f.shakeCalls).toEqual([shakeBody]);

			for (const invalid of [
				{ commandId: "bad-mode", incarnation: session.incarnation, mode: "other" },
				{ commandId: "extra-field", incarnation: session.incarnation, mode: "elide", extra: true },
				{ commandId: "missing-incarnation", mode: "elide" },
				{ incarnation: session.incarnation, mode: "elide" },
			]) {
				const response = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/context/shake`, token: f.auth.ownerToken, body: invalid });
				expect(response).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
			expect(f.shakeCalls).toHaveLength(1);
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/context/shake?nope=1`, token: f.auth.ownerToken, body: shakeBody })).toMatchObject({ status: 400, body: { error: { code: "invalid_query" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/context/shake`, token: f.auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});

	it("checks owner before method refusal", async () => {
		const f = fixture();
		const controller = f.auth.issue("context-controller");
		try {
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/context`, token: controller.token })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/context/shake`, token: controller.token, body: { commandId: "owner-only", incarnation: session.incarnation, mode: "elide" } })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/context`, token: f.auth.ownerToken, body: {} })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/context/drop-images`, token: f.auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});
});

describe("real CediaHost context route", () => {
	it("reports unavailable before start and preserves a runtime answer without usage", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-context-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Context fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath, CEDIA_FAKE_HOST_MODE: "context-no-usage" } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const session = host.createSession(project.id, "Context fixture");
		try {
			const before = await router({ method: "GET", path: `/v1/sessions/${session.id}/context`, token: auth.ownerToken });
			expect(before).toMatchObject({ status: 200, body: { state: "unavailable", reason: expect.stringMatching(/No OMP runtime/) } });
			const beforeShake = await router({ method: "POST", path: `/v1/sessions/${session.id}/context/shake`, token: auth.ownerToken, body: { commandId: "context-host-shake", incarnation: session.incarnation, mode: "elide" } });
			expect(beforeShake).toMatchObject({ status: 200, body: { state: "unavailable", reason: expect.stringMatching(/No OMP runtime/) } });
			await host.startSession(session.id);
			const live = await router({ method: "GET", path: `/v1/sessions/${session.id}/context`, token: auth.ownerToken });
			expect(live).toMatchObject({ status: 200, body: { state: "available", compacting: false, speculation: "idle" } });
			expect((live.body as Record<string, unknown>).usage).toBeUndefined();
			const incarnation = store.getSession(session.id)!.incarnation;
			const drop = await router({ method: "POST", path: `/v1/sessions/${session.id}/context/drop-images`, token: auth.ownerToken, body: { commandId: "context-host-drop", incarnation } });
			expect(drop).toMatchObject({ status: 200, body: { state: "available", removed: 0 } });
			const replay = await router({ method: "POST", path: `/v1/sessions/${session.id}/context/drop-images`, token: auth.ownerToken, body: { commandId: "context-host-drop", incarnation } });
			expect(JSON.stringify(replay.body)).toBe(JSON.stringify(drop.body));
		} finally {
			await host.close();
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
