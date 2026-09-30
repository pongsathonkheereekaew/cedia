import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	MAX_ADVISOR_CONFIG_TEXT_CHARS,
	NO_OMP_ADVISOR_CONFIG_BRIDGE_REASON,
	NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON,
	OmpAdvisorConfig,
	OmpAdvisorConfigValidationError,
	parseOmpAdvisorConfigData,
	type OmpAdvisorConfigData,
	type OmpAdvisorConfigWriteRequest,
} from "../src/omp-advisor-config.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const missing: OmpAdvisorConfigData = { scope: "project", path: "/task/WATCHDOG.yml", exists: false, text: "" };
const present: OmpAdvisorConfigData = { scope: "project", path: "/task/WATCHDOG.yml", exists: true, text: "advisors:\n  - name: probe\n", advisors: 1 };

function controlResponse(operation: string, result: unknown) {
	return { data: { operation, capabilityRevision: "cap-advisor-config-1", result } };
}

describe("OMP advisor config projection", () => {
	it("strictly parses config reads and command receipts", () => {
		expect(parseOmpAdvisorConfigData(missing)).toEqual(missing);
		expect(parseOmpAdvisorConfigData(present)).toEqual(present);
		expect(() => parseOmpAdvisorConfigData({ ...present, scope: "global" })).toThrow(/scope/);
		expect(() => parseOmpAdvisorConfigData({ ...present, extra: true })).toThrow(OmpAdvisorConfigValidationError);
		expect(() => parseOmpAdvisorConfigData({ ...present, text: "x".repeat(MAX_ADVISOR_CONFIG_TEXT_CHARS + 1) })).toThrow(/exceeds/);
		expect(() => parseOmpAdvisorConfigData({ ...present, advisors: -1 })).toThrow(/advisors/);
	});

	it("reads and writes through the negotiated cedia_control bridge", async () => {
		const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
		let stored = { ...missing };
		const client = {
			phase: "ready" as const,
			readyFrame: { cediaCapabilitiesVersion: 1 },
			requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
				calls.push(request as { operation: string; payload?: Record<string, unknown> });
				if (request.operation === "advisor.config.set") {
					const payload = request.payload as { text: string };
					stored = { scope: "project", path: stored.path, exists: true, text: payload.text, advisors: 1 };
				}
				return controlResponse(String(request.operation), stored);
			},
		};
		const state = new OmpAdvisorConfig({ client });
		expect(await state.refresh("project")).toEqual({ state: "available", revision: 1, ...missing });
		expect(await state.write("project", "advisors:\n  - name: probe\n")).toMatchObject({ exists: true, advisors: 1 });
		expect(calls).toEqual([
			{ operation: "advisor.config.get", payload: { scope: "project" } },
			{ operation: "advisor.config.set", payload: { scope: "project", text: "advisors:\n  - name: probe\n" } },
		]);
		await expect(state.write("global" as never, "advisors: []\n")).rejects.toThrow(/scope/);
		expect(calls).toHaveLength(2);
	});

	it("reports missing runtime and bridge without starting or probing one", async () => {
		let requests = 0;
		const stopped = new OmpAdvisorConfig({
			client: {
				phase: "closed",
				readyFrame: { cediaCapabilitiesVersion: 1 },
				requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
			},
		});
		expect(await stopped.refresh("project")).toEqual({ state: "unavailable", reason: NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON });
		expect(requests).toBe(0);

		const absent = new OmpAdvisorConfig({
			client: {
				phase: "ready",
				readyFrame: {},
				requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
			},
		});
		expect(await absent.refresh("project")).toEqual({ state: "unavailable", reason: NO_OMP_ADVISOR_CONFIG_BRIDGE_REASON });
		expect(requests).toBe(0);

		expect(await new OmpAdvisorConfig().refresh("project")).toEqual({ state: "unavailable", reason: NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON });
	});
});

describe("authenticated OMP advisor config routes", () => {
	const session = {
		id: "advisor-config-session",
		projectId: "project-1",
		title: "Advisor config task",
		cwd: "/tmp/advisor-config-project",
		sessionFile: "/tmp/advisor-config-session.jsonl",
		incarnation: "inc-advisor-config-1",
		status: "idle" as const,
		archived: false,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
	};

	function fixture() {
		const directory = mkdtempSync(join(tmpdir(), "cedia-advisor-config-route-"));
		const auth = new DeviceAuth(directory);
		const calls: OmpAdvisorConfigWriteRequest[] = [];
		const outcome = { state: "available" as const, revision: 4, ...present };
		const host = {
			store: { getSession: (id: string) => id === session.id ? session : undefined },
			advisorConfigSnapshot: async (_id: string, scope: string) => ({ state: "available" as const, revision: 3, ...missing, scope }),
			advisorConfigCommand: async (_id: string, _deviceId: string, request: OmpAdvisorConfigWriteRequest) => { if (calls.length === 0) calls.push(request); return outcome; },
		} as unknown as CediaHost;
		return { directory, auth, router: createRouter(host, auth), calls, outcome };
	}

	it("answers GET and POST, rejects malformed envelopes, and replays a command id", async () => {
		const f = fixture();
		try {
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/config?scope=project`, token: f.auth.ownerToken })).toEqual({ status: 200, body: { state: "available", revision: 3, ...missing, scope: "project" } });
			for (const bad of ["", "?scope=global", "?scope=project&scope=user", "?other=1"]) {
				const response = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/config${bad}`, token: f.auth.ownerToken });
				expect(response).toMatchObject({ status: 400, body: { error: { code: "invalid_query" } } });
			}
			const body = { commandId: "advisor-config-1", incarnation: session.incarnation, scope: "project" as const, text: present.text };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/advisor/config`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/advisor/config`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(f.calls).toEqual([body]);
			for (const invalid of [
				{ commandId: "missing-text", incarnation: session.incarnation, scope: "project" },
				{ commandId: "bad-scope", incarnation: session.incarnation, scope: "global", text: present.text },
				{ commandId: "bad-text", incarnation: session.incarnation, scope: "project", text: 7 },
				{ commandId: "extra", incarnation: session.incarnation, scope: "project", text: present.text, extra: true },
				{ incarnation: session.incarnation, scope: "project", text: present.text },
				{ commandId: "missing-incarnation", scope: "project", text: present.text },
			]) {
				const response = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/advisor/config`, token: f.auth.ownerToken, body: invalid });
				expect(response).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});

	it("checks owner before wrong-method refusal", async () => {
		const f = fixture();
		const controller = f.auth.issue("advisor-config-controller");
		try {
			expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/config?scope=project`, token: controller.token })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/advisor/config?scope=project`, token: f.auth.ownerToken, body: {} })).toMatchObject({ status: 400, body: { error: { code: "invalid_query" } } });
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});
});

describe("real CediaHost advisor config route", () => {
	it("reads absence, writes through the fixture, refuses bad text, and removes on empty", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-advisor-config-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Advisor config fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const fixtureNode = process.env.CEDIA_FIXTURE_NODE ?? process.execPath;
		const commandLog = join(directory, "commands.log");
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_COMMAND_LOG: commandLog } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const session = host.createSession(project.id, "Advisor config fixture");
		try {
			expect((await router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/config?scope=project`, token: auth.ownerToken })).body).toMatchObject({ state: "unavailable", reason: expect.stringMatching(/No OMP runtime/) });
			await host.startSession(session.id);
			const incarnation = store.getSession(session.id)!.incarnation;
			const text = "advisors:\n  - name: probe\n";
			const written = await router({ method: "POST", path: `/v1/sessions/${session.id}/advisor/config`, token: auth.ownerToken, body: { commandId: "advisor-config-host-write", incarnation, scope: "project", text } });
			expect(written).toMatchObject({ status: 200, body: { state: "available", scope: "project", exists: true, text, advisors: 1 } });
			const read = await router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/config?scope=project`, token: auth.ownerToken });
			expect(read).toMatchObject({ status: 200, body: { state: "available", exists: true, text } });
			const replay = await router({ method: "POST", path: `/v1/sessions/${session.id}/advisor/config`, token: auth.ownerToken, body: { commandId: "advisor-config-host-write", incarnation, scope: "project", text } });
			expect(replay.body).toEqual(written.body);
			const setCalls = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string }).filter(command => command.type === "cedia_control" && command.operation === "advisor.config.set");
			expect(setCalls).toHaveLength(1);
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
