import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	NO_OMP_ACCOUNTS_RUNTIME_REASON,
	NO_OMP_MODEL_STATE_RUNTIME_REASON,
	OmpModelState,
	OmpModelStateValidationError,
	parseOmpAccountPinResult,
	parseOmpAccounts,
	parseOmpModelState,
	parseOmpServiceTierResult,
	type OmpAccounts,
	type OmpModelStateData,
	type OmpServiceTierResult,
} from "../src/omp-model-state.ts";
import {
	NO_OMP_MODEL_STATE_BRIDGE_REASON,
	parseOmpModelRoles,
	parseOmpRoleApplyResult,
	type OmpModelRolesData,
	type OmpRoleApplyData,
} from "../src/omp-model-state.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const modelState: OmpModelStateData = {
	model: { provider: "fixture", id: "fixture-model" },
	effort: { configured: "auto", autoResolved: "medium", isAuto: true },
	serviceTiers: {
		families: ["speed", "quality"],
		tiers: ["standard", "fast"],
		current: [
			{ family: "speed", tier: "standard" },
			{ family: "quality", tier: null },
		],
	},
};

const accounts: OmpAccounts = {
	supported: true,
	provider: "fixture",
	accounts: [
		{ credentialId: 7, label: "Work", active: true },
		{ credentialId: 9, label: null, active: false },
	],
	truncated: false,
};

const tierResult: OmpServiceTierResult = {
	family: "speed",
	tier: "fast",
	serviceTiers: modelState.serviceTiers,
};

const roles: OmpModelRolesData = {
	cycleOrder: ["default", "smol"],
	roles: [
		{ role: "default", modelId: "fixture/fixture-model", source: "global" },
		{ role: "smol", modelId: "fixture/fast-1", source: "global" },
	],
	storage: "global",
};

const roleApply: OmpRoleApplyData = { role: "smol", provider: "fixture", model: "fast-1" };

describe("OMP model and account projection", () => {
	it("strictly parses the runtime contracts and preserves nulls", () => {
		expect(parseOmpModelState(modelState)).toEqual(modelState);
		expect(parseOmpAccounts({ ...accounts, supported: false, accounts: [] })).toEqual({ ...accounts, supported: false, accounts: [] });
		expect(parseOmpServiceTierResult(tierResult)).toEqual(tierResult);
		expect(parseOmpAccountPinResult({ pinned: false, list: accounts })).toEqual({ pinned: false, list: accounts });
		for (const malformed of [
			{ ...modelState, extra: true },
			{ ...modelState, model: { provider: "fixture" } },
			{ ...modelState, effort: { ...modelState.effort, autoResolved: 1 } },
		]) expect(() => parseOmpModelState(malformed)).toThrow(OmpModelStateValidationError);
		for (const malformed of [
			{ ...accounts, accounts: [{ ...accounts.accounts[0], active: "yes" }] },
			{ ...accounts, supported: "yes" },
		]) expect(() => parseOmpAccounts(malformed)).toThrow(OmpModelStateValidationError);
		expect(() => parseOmpServiceTierResult({ ...tierResult, tier: 1 })).toThrow(OmpModelStateValidationError);
		expect(parseOmpModelRoles(roles)).toEqual(roles);
		expect(parseOmpRoleApplyResult(roleApply)).toEqual(roleApply);
		for (const malformed of [
			{ ...roles, roles: [{ ...roles.roles[0], source: "elsewhere" }] },
			{ ...roles, cycleOrder: "default" },
			{ ...roles, roles: [{ role: "smol" }] },
		]) expect(() => parseOmpModelRoles(malformed)).toThrow(OmpModelStateValidationError);
		for (const malformed of [
			{ ...roleApply, model: 7 },
			{ ...roleApply, extra: true },
			{ role: "smol" },
		]) expect(() => parseOmpRoleApplyResult(malformed)).toThrow(OmpModelStateValidationError);
		expect(() => parseOmpAccountPinResult({ pinned: true, list: { ...accounts, truncated: "no" } })).toThrow(OmpModelStateValidationError);
	});

	it("does not call a stopped or absent runtime", async () => {
		let calls = 0;
		const state = new OmpModelState({
			client: {
				phase: "closed",
				requestCedia: async () => { calls += 1; throw new Error("must not call stopped runtime"); },
			},
		});
		expect(await state.model()).toEqual({ available: false, reason: NO_OMP_MODEL_STATE_RUNTIME_REASON });
		expect(await state.accounts()).toEqual({ available: false, reason: NO_OMP_ACCOUNTS_RUNTIME_REASON });
		expect(calls).toBe(0);
	});
});

describe("authenticated OMP model and account routes", () => {
	const session = {
		id: "model-state-session",
		projectId: "project-1",
		title: "Model state task",
		cwd: "/tmp/model-state-project",
		sessionFile: "/tmp/model-state-session.jsonl",
		incarnation: "inc-model-state-1",
		status: "idle" as const,
		archived: false,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
	};

	it("keeps the picker controller-visible and owner-gates accounts and tier writes", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-model-state-route-"));
		const auth = new DeviceAuth(directory);
		const controller = auth.issue("model-state-controller");
		const calls: unknown[] = [];
		const host = {
			store: { getSession: (id: string) => id === session.id ? session : undefined },
			modelStateSnapshot: async () => modelState,
			accountsSnapshot: async () => accounts,
			accountsPin: async (_id: string, _device: string, request: unknown) => { calls.push(request); return { pinned: true, list: accounts }; },
			serviceTierSet: async (_id: string, _device: string, request: unknown) => { calls.push(request); return tierResult; },
		} as unknown as CediaHost;
		const router = createRouter(host, auth);
		try {
			expect(await router({ method: "GET", path: `/v1/sessions/${session.id}/model-state`, token: controller.token })).toEqual({ status: 200, body: modelState });
			expect(await router({ method: "GET", path: `/v1/sessions/${session.id}/accounts`, token: controller.token })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/accounts`, token: auth.ownerToken, body: {} })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/accounts/pin`, token: controller.token, body: { commandId: "pin", incarnation: session.incarnation, credentialId: 7 } })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/service-tier`, token: controller.token, body: { commandId: "tier", incarnation: session.incarnation, family: "speed", tier: "fast" } })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });

			const pinBody = { commandId: "pin", incarnation: session.incarnation, credentialId: 7 };
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/accounts/pin`, token: auth.ownerToken, body: pinBody })).toMatchObject({ status: 200, body: { pinned: true, list: accounts } });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/accounts/pin`, token: auth.ownerToken, body: pinBody })).toMatchObject({ status: 200, body: { pinned: true } });
			const tierBody = { commandId: "tier", incarnation: session.incarnation, family: "speed", tier: null };
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/service-tier`, token: auth.ownerToken, body: tierBody })).toMatchObject({ status: 200, body: { family: "speed", tier: "fast" } });
			expect(calls).toHaveLength(3);

			for (const body of [
				{ commandId: "bad-extra", incarnation: session.incarnation, family: "speed", tier: "fast", extra: true },
				{ commandId: "bad-family", incarnation: session.incarnation, family: 7, tier: "fast" },
				{ commandId: "bad-tier", incarnation: session.incarnation, family: "speed", tier: 7 },
			]) {
				expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/service-tier`, token: auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe("authenticated OMP model role routes", () => {
	const session = {
		id: "model-roles-session",
		projectId: "project-1",
		title: "Model roles task",
		cwd: "/tmp/model-roles-project",
		sessionFile: "/tmp/model-roles-session.jsonl",
		incarnation: "inc-model-roles-1",
		status: "idle" as const,
		archived: false,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
	};

	it("keeps the mapping controller-visible and owner-gates the apply", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-model-roles-route-"));
		const auth = new DeviceAuth(directory);
		const controller = auth.issue("model-roles-controller");
		const calls: unknown[] = [];
		const setCalls: unknown[] = [];
		const host = {
			store: { getSession: (id: string) => id === session.id ? session : undefined },
			rolesSnapshot: async () => ({ available: true as const, ...roles }),
			rolesApply: async (_id: string, _device: string, request: unknown) => { calls.push(request); return { ...roleApply }; },
			rolesSet: async (_id: string, _device: string, request: unknown) => { setCalls.push(request); return { ...roles }; },
		} as unknown as CediaHost;
		const router = createRouter(host, auth);
		try {
			expect(await router({ method: "GET", path: `/v1/sessions/${session.id}/roles`, token: controller.token })).toEqual({ status: 200, body: { available: true, ...roles } });
			expect(await router({ method: "GET", path: `/v1/sessions/${session.id}/roles?debug=1`, token: controller.token })).toMatchObject({ status: 400 });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/roles`, token: auth.ownerToken, body: {} })).toMatchObject({ status: 405 });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/roles/apply`, token: controller.token, body: { commandId: "apply", incarnation: session.incarnation, role: "smol" } })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			const applyBody = { commandId: "apply", incarnation: session.incarnation, role: "smol" };
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/roles/apply`, token: auth.ownerToken, body: applyBody })).toMatchObject({ status: 200, body: roleApply });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/roles/apply`, token: auth.ownerToken, body: applyBody })).toMatchObject({ status: 200, body: roleApply });
			expect(calls).toHaveLength(2);
			const setBody = { commandId: "set", incarnation: session.incarnation, role: "smol", modelId: "fixture/fast-2" };
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/roles/set`, token: controller.token, body: setBody })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/roles/set`, token: auth.ownerToken, body: setBody })).toMatchObject({ status: 200, body: roles });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/roles/set`, token: auth.ownerToken, body: setBody })).toMatchObject({ status: 200, body: roles });
			expect(setCalls).toHaveLength(2);
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/roles`, token: auth.ownerToken, body: {} })).toMatchObject({ status: 405 });
			for (const body of [
				{ commandId: "bad-extra", incarnation: session.incarnation, role: "smol", modelId: "fixture/fast-2", extra: true },
				{ commandId: "bad-role", incarnation: session.incarnation, role: "  ", modelId: "fixture/fast-2" },
				{ commandId: "bad-model", incarnation: session.incarnation, role: "smol", modelId: 7 },
				{ commandId: "bad-missing", incarnation: session.incarnation, role: "smol" },
			]) {
				expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/roles/set`, token: auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
			for (const body of [
				{ commandId: "bad-extra", incarnation: session.incarnation, role: "smol", extra: true },
				{ commandId: "bad-role", incarnation: session.incarnation, role: "  " },
				{ commandId: "bad-missing", incarnation: session.incarnation },
			]) {
				expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/roles/apply`, token: auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
			expect(calls).toHaveLength(2);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe("real CediaHost model and account routes", () => {
	it("reads live state and replays pin/tier commands once", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-model-state-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Model state fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const commandLog = join(directory, "commands.log");
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath, CEDIA_FAKE_COMMAND_LOG: commandLog } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const task = host.createSession(project.id, "Model state fixture");
		try {
			for (const request of [
				{ method: "GET", path: `/v1/sessions/${task.id}/model-state` },
				{ method: "GET", path: `/v1/sessions/${task.id}/accounts` },
				{ method: "POST", path: `/v1/sessions/${task.id}/accounts/pin`, body: { commandId: "pre-pin", incarnation: task.incarnation, credentialId: 7 } },
				{ method: "POST", path: `/v1/sessions/${task.id}/service-tier`, body: { commandId: "pre-tier", incarnation: task.incarnation, family: "speed", tier: "fast" } },
			]) {
				const answer = await router({ ...request, token: auth.ownerToken });
				expect(answer.status).toBe(200);
				expect(answer.body).toMatchObject({ available: false, reason: expect.stringMatching(/No OMP runtime/) });
			}
			await host.startSession(task.id);
			expect(await router({ method: "GET", path: `/v1/sessions/${task.id}/model-state`, token: auth.ownerToken })).toEqual({ status: 200, body: { available: true, ...modelState } });
			expect(await router({ method: "GET", path: `/v1/sessions/${task.id}/accounts`, token: auth.ownerToken })).toEqual({ status: 200, body: { available: true, ...accounts } });
			const incarnation = store.getSession(task.id)!.incarnation;
			const pinBody = { commandId: "pin-live", incarnation, credentialId: 7 };
			const pin = await router({ method: "POST", path: `/v1/sessions/${task.id}/accounts/pin`, token: auth.ownerToken, body: pinBody });
			expect(pin).toEqual({ status: 200, body: { pinned: true, list: accounts } });
			expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/accounts/pin`, token: auth.ownerToken, body: pinBody })).toEqual(pin);
			const tierBody = { commandId: "tier-live", incarnation, family: "speed", tier: null };
			const expectedTier = { ...tierResult, tier: null, serviceTiers: { ...tierResult.serviceTiers, current: [{ family: "speed", tier: null }, { family: "quality", tier: null }] } };
			expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/service-tier`, token: auth.ownerToken, body: tierBody })).toEqual({ status: 200, body: expectedTier });
			expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/service-tier`, token: auth.ownerToken, body: tierBody })).toEqual({ status: 200, body: expectedTier });
			const commands = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string });
			expect(commands.filter(command => command.type === "cedia_control" && command.operation === "model.state.get")).toHaveLength(1);
			expect(commands.filter(command => command.type === "cedia_control" && command.operation === "auth.accounts.list")).toHaveLength(1);
			expect(commands.filter(command => command.type === "cedia_control" && command.operation === "auth.account.pin")).toHaveLength(1);
			expect(commands.filter(command => command.type === "cedia_control" && command.operation === "model.service-tier.set")).toHaveLength(1);
			const rolesLive = await router({ method: "GET", path: `/v1/sessions/${task.id}/roles`, token: auth.ownerToken });
			expect(rolesLive).toEqual({ status: 200, body: { available: true, cycleOrder: ["default", "smol"], roles: [{ role: "default", modelId: "fixture/fixture-model", source: "global" }, { role: "smol", modelId: "fixture/fast-1", source: "global" }], storage: "global" } });
			const applyBody = { commandId: "apply-live", incarnation, role: "smol" };
			const applied = await router({ method: "POST", path: `/v1/sessions/${task.id}/roles/apply`, token: auth.ownerToken, body: applyBody });
			expect(applied).toEqual({ status: 200, body: { role: "smol", provider: "fixture", model: "fast-1" } });
			expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/roles/apply`, token: auth.ownerToken, body: applyBody })).toEqual(applied);
			const commandsAfter = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string });
			expect(commandsAfter.filter(command => command.type === "cedia_control" && command.operation === "model.roles.get")).toHaveLength(1);
			expect(commandsAfter.filter(command => command.type === "cedia_control" && command.operation === "model.roles.apply")).toHaveLength(1);
			const setBody = { commandId: "set-live", incarnation, role: "smol", modelId: "fixture/fixture-model" };
			const assignedTable = { cycleOrder: ["default", "smol"], roles: [{ role: "default", modelId: "fixture/fixture-model", source: "global" }, { role: "smol", modelId: "fixture/fixture-model", source: "global" }], storage: "global" };
			const assigned = await router({ method: "POST", path: `/v1/sessions/${task.id}/roles/set`, token: auth.ownerToken, body: setBody });
			expect(assigned).toEqual({ status: 200, body: assignedTable });
			expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/roles/set`, token: auth.ownerToken, body: setBody })).toEqual(assigned);
			const reread = await router({ method: "GET", path: `/v1/sessions/${task.id}/roles`, token: auth.ownerToken });
			expect(reread).toEqual({ status: 200, body: { available: true, cycleOrder: ["default", "smol"], roles: [{ role: "default", modelId: "fixture/fixture-model", source: "global" }, { role: "smol", modelId: "fixture/fixture-model", source: "global" }], storage: "global" } });
			const commandsSet = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string });
			expect(commandsSet.filter(command => command.type === "cedia_control" && command.operation === "model.roles.set")).toHaveLength(1);
			const clearBody = { commandId: "clear-live", incarnation, role: "smol", modelId: null };
			expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/roles/set`, token: auth.ownerToken, body: clearBody })).toEqual({ status: 200, body: { cycleOrder: ["default", "smol"], roles: [{ role: "default", modelId: "fixture/fixture-model", source: "global" }], storage: "global" } });
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("returns a refused pin with the refreshed account list", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-model-state-pin-refused-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Pin refusal fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath, CEDIA_FAKE_HOST_MODE: "account-pin-refused" } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const task = host.createSession(project.id, "Pin refusal fixture");
		try {
			await host.startSession(task.id);
			const body = { commandId: "pin-refused", incarnation: store.getSession(task.id)!.incarnation, credentialId: 7 };
			const refused = await router({ method: "POST", path: `/v1/sessions/${task.id}/accounts/pin`, token: auth.ownerToken, body });
			expect(refused).toEqual({ status: 200, body: { pinned: false, list: accounts } });
			expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/accounts/pin`, token: auth.ownerToken, body })).toEqual(refused);
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("keeps an unsupported provider distinct from an empty account list", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-model-state-unsupported-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Unsupported accounts fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath, CEDIA_FAKE_HOST_MODE: "accounts-unsupported" } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const task = host.createSession(project.id, "Unsupported accounts fixture");
		try {
			await host.startSession(task.id);
			expect(await router({ method: "GET", path: `/v1/sessions/${task.id}/accounts`, token: auth.ownerToken })).toEqual({
				status: 200,
				body: { available: true, supported: false, provider: "fixture", accounts: [], truncated: false },
			});
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("refuses malformed runtime answers without coercing them", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-model-state-malformed-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Malformed model fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath, CEDIA_FAKE_HOST_MODE: "model-state-malformed" } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const task = host.createSession(project.id, "Malformed model fixture");
		try {
			await host.startSession(task.id);
			const answer = await router({ method: "GET", path: `/v1/sessions/${task.id}/model-state`, token: auth.ownerToken });
			expect(answer).toMatchObject({ status: 502, body: { error: { code: "omp_model_state_invalid", message: expect.stringContaining("autoResolved") } } });
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("surfaces a runtime service-tier refusal", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-model-state-tier-refused-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Tier refusal fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath, CEDIA_FAKE_HOST_MODE: "service-tier-refused" } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const task = host.createSession(project.id, "Tier refusal fixture");
		try {
			await host.startSession(task.id);
			const body = { commandId: "tier-refused", incarnation: store.getSession(task.id)!.incarnation, family: "unknown", tier: "fast" };
			const refused = await router({ method: "POST", path: `/v1/sessions/${task.id}/service-tier`, token: auth.ownerToken, body });
			expect(refused).toMatchObject({ status: 409, body: { error: { code: "omp_refused", message: "Unknown service-tier family from fixture" } } });
			expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/service-tier`, token: auth.ownerToken, body })).toEqual(refused);
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
