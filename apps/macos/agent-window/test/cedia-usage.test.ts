import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import { tagCediaHostErrorMessage } from "../src/host-error-codes.ts";

type Request = {
	kind: "request";
	method: "GET" | "POST";
	path: string;
	body?: unknown;
};

function usageBridge(answer: unknown = { reports: [] }) {
	const calls: Request[] = [];
	return {
		calls,
		bridge: {
			invoke: async (_channel: string, input: Request) => {
				calls.push(input);
				return answer;
			},
		},
	};
}

describe("Cedia native usage adapter", () => {
	it("reads usage through the owner session route", async () => {
		const fixture = usageBridge({ reports: [] });
		const api = createCediaNativeApi({ bridge: fixture.bridge });

		await api.cedia.getUsage("session/usage");

		expect(fixture.calls).toEqual([
			{ kind: "request", method: "GET", path: "/v1/sessions/session%2Fusage/usage" },
		]);
	});

	it("preserves a typed host refusal reason and code", async () => {
		const fixture = usageBridge();
		fixture.bridge.invoke = async () => {
			throw new Error(tagCediaHostErrorMessage("CEDIA_USAGE_UNAVAILABLE", "Usage route is unavailable"));
		};
		const api = createCediaNativeApi({ bridge: fixture.bridge });

		await expect(api.cedia.getUsage("session-usage")).rejects.toMatchObject({
			name: "CediaHostError",
			code: "CEDIA_USAGE_UNAVAILABLE",
			message: "Usage route is unavailable",
		});
	});

	it("reads saved reset credits and fills identity for an explicit redeem", async () => {
		const fixture = usageBridge({ state: "available", revision: 2, accounts: [] });
		fixture.bridge.invoke = async (_channel: string, input: Request) => {
			fixture.calls.push(input);
			if (input.path === "/v1/sessions/session-credits") {
				return {
					id: "session-credits",
					projectId: "project-credits",
					cwd: "/workspace/credits",
					sessionFile: "/tmp/session-credits.json",
					incarnation: "inc-credits",
					status: "idle",
					archived: false,
					createdAt: "2026-09-24T00:00:00.000Z",
					updatedAt: "2026-09-24T00:00:00.000Z",
				};
			}
			return { state: "available", revision: 2, accounts: [], lastRedeem: { ok: false, code: "no_credit" } };
		};
		const api = createCediaNativeApi({ bridge: fixture.bridge });

		await api.cedia.getCredits("session/credits");
		await api.cedia.redeemCredit("session-credits", { accountId: "acct-1" });

		expect(fixture.calls).toEqual([
			{ kind: "request", method: "GET", path: "/v1/sessions/session%2Fcredits/credits" },
			{ kind: "request", method: "GET", path: "/v1/sessions/session-credits" },
			{
				kind: "request",
				method: "POST",
				path: "/v1/sessions/session-credits/credits/redeem",
				body: { commandId: expect.any(String), incarnation: "inc-credits", target: { accountId: "acct-1" } },
			},
		]);
	});

	it("preserves a typed host refusal for the credits route", async () => {
		const fixture = usageBridge();
		fixture.bridge.invoke = async () => {
			throw new Error(tagCediaHostErrorMessage("CEDIA_CREDITS_UNAVAILABLE", "Saved reset listing is unavailable"));
		};
		const api = createCediaNativeApi({ bridge: fixture.bridge });

		await expect(api.cedia.getCredits("session-credits")).rejects.toMatchObject({
			name: "CediaHostError",
			code: "CEDIA_CREDITS_UNAVAILABLE",
			message: "Saved reset listing is unavailable",
		});
	});
});
