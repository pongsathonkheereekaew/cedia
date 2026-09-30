import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	NO_OMP_USAGE_RUNTIME_REASON,
	OmpUsage,
	OmpUsageValidationError,
	parseOmpUsageCommandResult,
	parseOmpUsageData,
	type OmpUsageReport,
} from "../src/omp-usage.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const fullReport: OmpUsageReport = {
	provider: "fixture",
	fetchedAt: 1_727_000_000_000,
	limits: [
		{
			id: "daily",
			label: "Daily requests",
			scope: { provider: "fixture", accountId: "acct-1" },
			window: { id: "day", label: "Today", resetsAt: 1_727_003_600_000 },
			amount: { unit: "requests", usedFraction: 0.25, used: 25, limit: 100, remainingFraction: 0.75 },
			status: "ok",
			notes: ["Fixture report"],
		},
	],
	resetCredits: {
		availableCount: 1,
		credits: [{ grantedAt: "2026-09-24T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z", status: "available" }],
	},
	notes: ["No provider call in this fixture"],
	accountId: "acct-1",
	accountEmail: "owner@example.invalid",
	limitReached: false,
};

describe("OMP usage projection", () => {
	it("strictly parses complete and partial reports without filling absent amounts", () => {
		expect(parseOmpUsageData({ reports: [fullReport] })).toEqual({ reports: [fullReport] });
		expect(parseOmpUsageData({ reports: [{ provider: "fixture", fetchedAt: 1, limits: [{ id: "requests", label: "Requests", amount: { unit: "requests", used: 1 } }] }] })).toEqual({
			reports: [{ provider: "fixture", fetchedAt: 1, limits: [{ id: "requests", label: "Requests", amount: { unit: "requests", used: 1 } }] }],
		});
		expect(() => parseOmpUsageData({ reports: [{ ...fullReport, limits: [{ ...fullReport.limits[0], amount: { unit: "requests", used: "25" } }] }] })).toThrow(OmpUsageValidationError);
		expect(() => parseOmpUsageData({ reports: [{ ...fullReport, limits: [{ ...fullReport.limits[0], amount: { used: 25 } as never }] }] })).toThrow(/unit/);
		expect(() => parseOmpUsageData({ reports: [{ ...fullReport, extra: true } as never] })).toThrow(/unknown field/);
		expect(() => parseOmpUsageCommandResult({ state: "available", revision: "1", reports: [] } as never)).toThrow(/revision/);
	});

	it("keeps a runtime unavailable message inside an available snapshot", () => {
		expect(parseOmpUsageCommandResult({ state: "available", revision: 1, reports: [], supported: false, unavailable: "Provider fetch failed" })).toEqual({
		state: "available",
		revision: 1,
		reports: [],
		supported: false,
		unavailable: "Provider fetch failed",
	});
	});

	it("does not call a missing runtime and reports its absence", async () => {
		let calls = 0;
		const usage = new OmpUsage();
		expect(await usage.read({ phase: "closed", requestCedia: async () => { calls += 1; throw new Error("must not call"); } })).toBeUndefined();
		expect(usage.snapshot()).toEqual({ state: "unavailable", reason: NO_OMP_USAGE_RUNTIME_REASON });
		expect(calls).toBe(0);
	});
});

describe("authenticated OMP usage route", () => {
	it("reads through a real host only when asked and preserves absent amount fields", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-usage-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Usage fixture" });
		const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixture, ompEnv: { CEDIA_NODE: process.execPath } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const session = host.createSession(project.id, "Usage fixture");
		try {
			expect((await router({ method: "GET", path: `/v1/sessions/${session.id}/usage`, token: auth.ownerToken })).body).toMatchObject({ state: "unavailable" });
			await host.startSession(session.id);
			const response = await router({ method: "GET", path: `/v1/sessions/${session.id}/usage`, token: auth.ownerToken });
			expect(response.status).toBe(200);
			expect(response.body).toMatchObject({ state: "available", reports: [{ provider: "fixture", limits: [{ amount: { unit: "requests", used: 25 } }] }] });
			const amount = (response.body as { reports: [{ limits: [{ amount: Record<string, unknown> }] }] }).reports[0].limits[0].amount;
			expect(amount).not.toHaveProperty("limit");
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("refuses unauthenticated, wrong-method and unknown-query requests", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-usage-route-"));
		const auth = new DeviceAuth(directory);
		const session = { id: "usage-session" };
		const host = { store: { getSession: (id: string) => id === session.id ? session : undefined }, usageSnapshot: async () => ({ state: "available", revision: 1, reports: [] }) } as unknown as CediaHost;
		const router = createRouter(host, auth);
		try {
			expect(await router({ method: "GET", path: `/v1/sessions/${session.id}/usage` })).toMatchObject({ status: 401, body: { error: { code: "unauthorized" } } });
			expect(await router({ method: "POST", path: `/v1/sessions/${session.id}/usage`, token: auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			expect(await router({ method: "GET", path: `/v1/sessions/${session.id}/usage?extra=1`, token: auth.ownerToken })).toMatchObject({ status: 400, body: { error: { code: "invalid_query" } } });
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
