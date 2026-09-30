import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
	CediaUsagePanel,
	type CediaCreditsAnswer,
	type CediaUsageAnswer,
} from "../vendor/synara/apps/web/src/components/chat/CediaUsageSurface";
import {
	parseCediaCreditsAnswer,
	parseCediaCreditsRedeemAnswer,
	parseCediaUsageAnswer,
	serverCreditsQueryOptions,
	serverUsageQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const usage: CediaUsageAnswer = {
	state: "available",
	revision: 4,
	reports: [{
		provider: "codex",
		fetchedAt: Date.parse("2026-09-24T04:05:06.000Z"),
		accountEmail: "owner@example.test",
		limits: [{
			id: "five-hour",
			label: "Five hour window",
			window: { id: "five-hour", label: "5 hours", resetsAt: Date.parse("2026-09-24T06:00:00.000Z") },
			amount: { unit: "requests", usedFraction: 0.25, used: 5, limit: 20, remainingFraction: 0.75 },
			status: "ok",
		}],
		resetCredits: {
			availableCount: 2,
			credits: [{ expiresAt: "2026-09-30T00:00:00.000Z", status: "available" }],
		},
	}],
};

const credits: CediaCreditsAnswer = {
	state: "available",
	revision: 7,
	accounts: [{
		credentialId: 4,
		accountId: "acct-1",
		email: "owner@example.test",
		availableCount: 2,
		credits: [{
			id: "credit-1",
			resetType: "five_hour",
			status: "available",
			expiresAt: "2026-09-30T00:00:00.000Z",
			grantedAt: "2026-09-20T00:00:00.000Z",
			title: "Five-hour reset",
			description: "A saved window reset",
		}],
		active: true,
	}],
};

describe("Cedia usage surface", () => {
	it("renders provider metadata, reported amounts, reset credits, and manual refresh copy", () => {
		const html = renderToStaticMarkup(
			<CediaUsagePanel state={usage} credits={credits} requested busy={false} onRefresh={() => undefined} onCheckCredits={() => undefined} />,
		);

		expect(html).toContain("codex");
		expect(html).toContain("owner@example.test");
		expect(html).toContain("5 hours");
		expect(html).toContain("requests");
		expect(html).toContain("Used: 5");
		expect(html).toContain("Limit: 20");
		expect(html).toContain("Used fraction: 0.25");
		expect(html).toContain("2 available reset credits");
		expect(html).toContain("2026-09-30T00:00:00.000Z");
		expect(html).toContain("Refreshing asks the providers");
		expect(html).toContain("Refresh usage");
		expect(html).toContain("Check saved resets");
		expect(html).toContain("Account ID: acct-1");
		expect(html).toContain("Account email: owner@example.test");
		expect(html).toContain("Active session account");
		expect(html).toContain("2 available reset credits");
		expect(html).toContain("Status: available");
		expect(html).toContain("Expires: 2026-09-30T00:00:00.000Z");
	});

	it("requires a named two-step confirmation before redeeming and reports OMP outcomes", () => {
		const pending = renderToStaticMarkup(
			<CediaUsagePanel
				state={usage}
				credits={credits}
				redeemConfirmation={{ key: "credential:4", accountLabel: "owner@example.test", windowLabel: "five hour" }}
				onRedeemCredit={() => undefined}
			/>,
		);
		expect(pending).toContain("Confirm redeem");
		expect(pending).toContain("owner@example.test");
		expect(pending).toContain("five hour window");
		expect(pending).toContain("spends one saved reset");

		const answered = renderToStaticMarkup(
			<CediaUsagePanel
				state={usage}
				credits={{ ...credits, lastRedeem: { ok: false, code: "already_redeemed", accountId: "acct-1" } }}
				onRedeemCredit={() => undefined}
			/>,
		);
		expect(answered).toContain("Already redeemed; no reset was applied");
		expect(answered).toContain("already_redeemed");
	});

	it("shows account listing errors without turning them into zero credits", () => {
		const html = renderToStaticMarkup(
			<CediaUsagePanel
				state={usage}
				credits={{ state: "available", revision: 8, accounts: [{ accountId: "acct-error", availableCount: 0, credits: [], active: false, error: "token refresh failed" }] }}
			/>,
		);
		expect(html).toContain("token refresh failed");
		expect(html).toContain("Saved reset listing failed");
		expect(html).not.toContain("0 available reset credits");
	});

	it("shows a host reason or runtime caveat without inventing account rows", () => {
		const host = renderToStaticMarkup(
			<CediaUsagePanel state={usage} credits={{ state: "unavailable", reason: "No live OMP runtime" }} />,
		);
		expect(host).toContain("No live OMP runtime");
		expect(host).not.toContain("No saved reset accounts were reported");

		const caveat = renderToStaticMarkup(
			<CediaUsagePanel state={usage} credits={{ state: "available", revision: 9, accounts: [], unavailable: "Provider account listing failed" }} />,
		);
		expect(caveat).toContain("Provider account listing failed");
		expect(caveat).not.toContain("0 available saved reset credits");
	});

	it("keeps omitted amount fields unknown instead of inventing zeroes", () => {
		const html = renderToStaticMarkup(
			<CediaUsagePanel
				state={{
					...usage,
					reports: [{
						...usage.reports[0]!,
						limits: [{ ...usage.reports[0]!.limits[0]!, amount: { unit: "tokens" } }],
					}],
				}}
				requested
				onRefresh={() => undefined}
			/>,
		);

		expect(html).toContain("Used: unknown tokens");
		expect(html).toContain("Limit: unknown tokens");
		expect(html).not.toContain("Used: 0");
		expect(html).not.toContain("Limit: 0");
	});

	it("distinguishes runtime caveats, unsupported usage, and an owner-requested empty result", () => {
		const caveat = renderToStaticMarkup(
			<CediaUsagePanel
				state={{ ...usage, unavailable: "Provider usage could not be refreshed" }}
				requested
				onRefresh={() => undefined}
			/>,
		);
		expect(caveat).toContain("Provider usage could not be refreshed");
		expect(caveat).toContain("codex");

		const unsupported = renderToStaticMarkup(
			<CediaUsagePanel
				state={{ state: "available", revision: 5, reports: [], supported: false, unavailable: "No usage support" }}
				requested
				onRefresh={() => undefined}
			/>,
		);
		expect(unsupported).toContain("runtime cannot report provider usage");
		expect(unsupported).toContain("No usage support");

		const empty = renderToStaticMarkup(
			<CediaUsagePanel state={{ state: "available", revision: 6, reports: [] }} requested onRefresh={() => undefined} />,
		);
		expect(empty).toContain("No provider usage was reported");
	});

	it("shows the host reason when the route is unavailable, with a way to ask again", () => {
		const html = renderToStaticMarkup(
			<CediaUsagePanel
				state={{ state: "unavailable", reason: "No live OMP runtime" }}
				requested
				onRefresh={() => undefined}
			/>,
		);
		expect(html).toContain("No live OMP runtime");
		// No usage facts may be invented for an answer that did not arrive.
		expect(html).not.toContain("No provider usage was reported");
		// The read is manual, so a transient failure keeps the one control that can ask again.
		expect(html).toContain("Refresh usage");
	});

	it("carries no refresh control when there is nothing to call it with", () => {
		const html = renderToStaticMarkup(
			<CediaUsagePanel state={{ state: "unavailable", reason: "No live OMP runtime" }} requested />,
		);
		expect(html).toContain("No live OMP runtime");
	});

	it("rejects malformed answers and leaves optional amount fields absent", () => {
		expect(parseCediaUsageAnswer({
			state: "available",
			revision: 1,
			reports: [{
				provider: "codex",
				fetchedAt: 1,
				limits: [{ id: "one", label: "One", amount: { unit: "tokens" } }],
			}],
		})).toEqual({
			state: "available",
			revision: 1,
			reports: [{
				provider: "codex",
				fetchedAt: 1,
				limits: [{ id: "one", label: "One", amount: { unit: "tokens" } }],
			}],
		});
		expect(() => parseCediaUsageAnswer({ state: "available", revision: 1, reports: [{ provider: "codex", fetchedAt: 1, limits: [{ id: "one", label: "One", amount: { unit: "tokens", used: 0, nope: 1 } }] }] })).toThrow();
		expect(() => parseCediaUsageAnswer({ state: "available", revision: 1, reports: [{ provider: "codex", fetchedAt: 1, limits: [{ id: "one", label: "One", amount: { unit: "tokens" } }] }], supported: "yes" })).toThrow();
		expect(parseCediaUsageAnswer({ state: "unavailable", reason: "Stopped" })).toEqual({ state: "unavailable", reason: "Stopped" });
	});

	it("parses saved reset answers defensively and requires a redeem outcome on redeem answers", () => {
		expect(parseCediaCreditsAnswer({
			state: "available",
			revision: 2,
			accounts: [{ accountId: "acct-1", availableCount: 1, credits: [{ id: "credit-1", status: "available" }], active: true, error: "temporary" }],
			unavailable: "one account could not be read",
		})).toMatchObject({ unavailable: "one account could not be read" });
		expect(parseCediaCreditsRedeemAnswer({
			state: "available",
			revision: 3,
			accounts: [],
			lastRedeem: { ok: true, code: "reset", accountId: "acct-1", creditId: "credit-1" },
		})).toMatchObject({ lastRedeem: { code: "reset" } });
		expect(() => parseCediaCreditsAnswer({ state: "available", revision: 1, accounts: [{ availableCount: 0, credits: [], active: "yes" }] })).toThrow();
		expect(() => parseCediaCreditsAnswer({ state: "available", revision: 1, accounts: [{ availableCount: 0, credits: [{ id: "credit-1", unexpected: true }], active: false }] })).toThrow();
		expect(() => parseCediaCreditsRedeemAnswer({ state: "available", revision: 1, accounts: [] })).toThrow();
		expect(parseCediaCreditsAnswer({ state: "unavailable", reason: "Stopped" })).toEqual({ state: "unavailable", reason: "Stopped" });
	});

	it("starts disabled and does not configure polling or focus refetch", () => {
		const options = serverUsageQueryOptions("session-usage");
		expect(options.enabled).toBe(false);
		expect(options.refetchInterval).toBe(false);
		expect(options.refetchOnWindowFocus).toBe(false);
		const creditsOptions = serverCreditsQueryOptions("session-credits");
		expect(creditsOptions.enabled).toBe(false);
		expect(creditsOptions.refetchInterval).toBe(false);
		expect(creditsOptions.refetchOnWindowFocus).toBe(false);
		expect(creditsOptions.refetchOnReconnect).toBe(false);
	});
});
