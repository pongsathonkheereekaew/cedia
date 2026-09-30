import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	NO_OMP_CREDITS_RUNTIME_REASON,
	OmpCredits,
	OmpCreditsValidationError,
	parseOmpCreditsCommandResult,
	parseOmpCreditsData,
	parseOmpCreditsRedeemCommandResult,
	parseOmpCreditsRedeemOutcome,
	type OmpCreditsCommandRequest,
} from "../src/omp-credits.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const credits = {
	accounts: [
		{
			accountId: "acct-1",
			email: "owner@example.invalid",
			availableCount: 1,
			credits: [{ id: "credit-1", status: "available", expiresAt: "2026-10-01T00:00:00.000Z" }],
			active: true,
		},
		{
			accountId: "acct-2",
			availableCount: 0,
			credits: [],
			active: false,
			error: "Fixture account failed to list credits",
		},
	],
};

function controlResponse(operation: string, result: unknown) {
	return { data: { operation, capabilityRevision: "cap-credits-1", result } };
}

describe("OMP credits projection", () => {
	it("strictly parses accounts, keeps absent identifiers absent, and rejects malformed answers", () => {
		expect(parseOmpCreditsData(credits)).toEqual(credits);
		expect(() => parseOmpCreditsData({ accounts: [{ ...credits.accounts[0], credits: [{ status: "available" }] }] })).toThrow(OmpCreditsValidationError);
		expect(() => parseOmpCreditsData({ accounts: [{ ...credits.accounts[0], availableCount: -1 }] })).toThrow(/availableCount/);
		expect(() => parseOmpCreditsData({ accounts: [{ ...credits.accounts[0], active: "yes" }] })).toThrow(/active/);
		expect(() => parseOmpCreditsData({ ...credits, extra: true })).toThrow(/unknown field/);
		expect(() => parseOmpCreditsRedeemOutcome({ ok: true })).toThrow(/code/);
		expect(() => parseOmpCreditsRedeemOutcome({ ok: "yes", code: "reset" })).toThrow(/ok/);
	});

	it("keeps a runtime listing failure in an available snapshot", () => {
		expect(parseOmpCreditsCommandResult({ state: "available", revision: 1, accounts: [], unavailable: "Provider fetch failed" })).toEqual({
			state: "available",
			revision: 1,
			accounts: [],
			unavailable: "Provider fetch failed",
		});
		expect(parseOmpCreditsRedeemCommandResult({ state: "unavailable", reason: "Refresh failed", lastRedeem: { ok: true, code: "reset" } })).toEqual({
			state: "unavailable",
			reason: "Refresh failed",
			lastRedeem: { ok: true, code: "reset" },
		});
	});

	it("does not call a missing runtime", async () => {
		let calls = 0;
		const state = new OmpCredits();
		expect(await state.read({ phase: "closed", requestCedia: async () => { calls += 1; throw new Error("must not call"); } })).toBeUndefined();
		expect(state.snapshot()).toEqual({ state: "unavailable", reason: NO_OMP_CREDITS_RUNTIME_REASON });
		expect(calls).toBe(0);
	});

	it("reads and redeems through the negotiated controls with wire confirmation", async () => {
		const calls: Record<string, unknown>[] = [];
		const client = {
			phase: "ready" as const,
			readyFrame: { cediaCapabilitiesVersion: 1 },
			requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
				calls.push(request);
				return controlResponse(String(request.operation), request.operation === "credits.get" ? credits : { ok: true, code: "reset", accountId: "acct-1", creditId: "credit-1" });
			},
		};
		const state = new OmpCredits();
		expect(await state.read(client)).toEqual(credits);
		expect(await state.redeem(client, { accountId: "acct-1" })).toEqual({ ok: true, code: "reset", accountId: "acct-1", creditId: "credit-1" });
		expect(calls).toEqual([
			{ operation: "credits.get" },
			{ operation: "credits.redeem", payload: { accountId: "acct-1", confirm: true } },
		]);
	});
});

describe("authenticated OMP credits routes", () => {
	const session = {
		id: "credits-session",
		projectId: "project-1",
		title: "Credits task",
		cwd: "/tmp/credits-project",
		sessionFile: "/tmp/credits-session.jsonl",
		incarnation: "inc-credits-1",
		status: "idle" as const,
		archived: false,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
	};

	it("rejects malformed redeem bodies before calling the host", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-credits-route-"));
		const auth = new DeviceAuth(directory);
		const calls: OmpCreditsCommandRequest[] = [];
		const host = {
			store: { getSession: (id: string) => id === session.id ? session : undefined },
			creditsSnapshot: async () => ({ state: "available" as const, revision: 1, accounts: [] }),
			creditsRedeem: async (_id: string, _deviceId: string, request: OmpCreditsCommandRequest) => { calls.push(request); return { state: "unavailable" as const, reason: "fixture" }; },
		} as unknown as CediaHost;
		const router = createRouter(host, auth);
		try {
			for (const body of [
				{ commandId: "missing-incarnation", target: { accountId: "acct-1" } },
				{ incarnation: session.incarnation, target: { accountId: "acct-1" } },
				{ commandId: "extra", incarnation: session.incarnation, target: { accountId: "acct-1" }, extra: true },
				{ commandId: "none", incarnation: session.incarnation, target: {} },
				{ commandId: "two", incarnation: session.incarnation, target: { accountId: "acct-1", email: "owner@example.invalid" } },
				{ commandId: "wrong", incarnation: session.incarnation, target: { accountId: 7 } },
			]) {
				expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/credits/redeem`, token: auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
			expect(calls).toHaveLength(0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("is owner-only and uses typed query and method refusals", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-credits-route-"));
		const auth = new DeviceAuth(directory);
		const host = { store: { getSession: (id: string) => id === session.id ? session : undefined }, creditsSnapshot: async () => ({ state: "available" as const, revision: 1, accounts: [] }), creditsRedeem: async () => ({ state: "unavailable" as const, reason: "fixture" }) } as unknown as CediaHost;
		const router = createRouter(host, auth);
		const controller = auth.issue("credits-controller");
		try {
			expect(await router({ method: "GET", path: `/v1/sessions/${session.id}/credits`, token: controller.token })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await router({ method: "GET", path: `/v1/sessions/${session.id}/credits` })).toMatchObject({ status: 401, body: { error: { code: "unauthorized" } } });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/credits`, token: auth.ownerToken, body: {} })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			expect(await router({ method: "GET", path: `/v1/sessions/${session.id}/credits/redeem`, token: auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			expect(await router({ method: "GET", path: `/v1/sessions/${session.id}/credits?extra=1`, token: auth.ownerToken })).toMatchObject({ status: 400, body: { error: { code: "invalid_query" } } });
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe("real CediaHost credits route", () => {
	it("reads on demand, carries account errors and replays one redeem receipt", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-credits-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Credits fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const commandLog = join(directory, "commands.log");
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath, CEDIA_FAKE_COMMAND_LOG: commandLog } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const task = host.createSession(project.id, "Credits fixture");
		try {
			expect(await router({ method: "GET", path: `/v1/sessions/${task.id}/credits`, token: auth.ownerToken })).toMatchObject({ status: 200, body: { state: "unavailable" } });
			await host.startSession(task.id);
			const read = await router({ method: "GET", path: `/v1/sessions/${task.id}/credits`, token: auth.ownerToken });
			expect(read).toMatchObject({ status: 200, body: { state: "available", accounts: [{ accountId: "acct-1", availableCount: 1 }, { accountId: "acct-2", error: "Fixture account failed to list credits" }] } });
			expect((read.body as { accounts: [{ credentialId?: number }] }).accounts[0]).not.toHaveProperty("credentialId");
			const body = { commandId: "credits-redeem-1", incarnation: store.getSession(task.id)!.incarnation, target: { accountId: "acct-1" } };
			const redeemed = await router({ method: "POST", path: `/v1/sessions/${task.id}/credits/redeem`, token: auth.ownerToken, body });
			expect(redeemed).toMatchObject({ status: 200, body: { state: "available", lastRedeem: { ok: true, code: "reset", accountId: "acct-1" } } });
			expect(await router({ method: "POST", path: `/v1/sessions/${task.id}/credits/redeem`, token: auth.ownerToken, body })).toEqual(redeemed);
			const calls = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string; payload?: Record<string, unknown> }).filter(command => command.type === "cedia_control" && command.operation === "credits.redeem");
			expect(calls).toHaveLength(1);
			expect(calls[0]?.payload).toEqual({ accountId: "acct-1", confirm: true });
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
