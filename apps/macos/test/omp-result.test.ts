import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORK_NOT_CREATED_REASON, ompCommandConfirmed, THINKING_NOT_APPLIED_REASON } from "../src/omp-result.ts";
import { readProviderSources } from "./provider-sources.ts";

const here = dirname(fileURLToPath(import.meta.url));
const extensionSource = readProviderSources(join(here, "../src"));

describe("OMP command confirmation", () => {
	it("counts only host-confirmed commands as applied", () => {
		expect(ompCommandConfirmed({ status: "completed" })).toBe(true);
		expect(ompCommandConfirmed({ status: "acknowledged" })).toBe(true);
		// A swallowed transport error surfaces as undefined, and an unknown
		// outcome must never be reported to the user as success.
		expect(ompCommandConfirmed(undefined)).toBe(false);
		expect(ompCommandConfirmed({})).toBe(false);
		expect(ompCommandConfirmed({ status: "failed" })).toBe(false);
		expect(ompCommandConfirmed({ status: "not_dispatched" })).toBe(false);
		expect(ompCommandConfirmed({ status: "outcome_unknown" })).toBe(false);
	});

	it("tells the user when a picked thinking level was not applied", () => {
		const body = extensionSource.slice(extensionSource.indexOf("async selectThinkingLevel"));
		const handler = body.slice(0, body.indexOf("\n\t\tasync "));
		expect(handler).toContain('this.requestOmp("set_thinking_level"');
		expect(handler).toContain("if (!ompCommandConfirmed(result)) {");
		expect(handler).toContain("await vscode.window.showInformationMessage(THINKING_NOT_APPLIED_REASON);");
		expect(THINKING_NOT_APPLIED_REASON).toContain("previous level is still in effect");
	});

	it("tells the user when a fork was not created", () => {
		const body = extensionSource.slice(extensionSource.indexOf('if (id === "fork")'));
		const branch = body.slice(0, body.indexOf('if (id === "details")'));
		expect(branch).toContain('this.requestOmp("new_session"');
		expect(branch).toContain("if (!ompCommandConfirmed(forked)) {");
		expect(branch).toContain("await vscode.window.showInformationMessage(FORK_NOT_CREATED_REASON);");
		expect(FORK_NOT_CREATED_REASON).toContain("original task is unchanged");
	});

	it("does not silently swallow a failed OMP request", () => {
		const body = extensionSource.slice(extensionSource.indexOf("async requestOmp"));
		const handler = body.slice(0, body.indexOf("\n\t\tasync "));
		expect(handler).toContain("this.log.warn(`OMP ${command} failed:");
	});
});
