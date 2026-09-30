import { describe, expect, test } from "bun:test";
import {
	createNativeGatewayTransport,
	createWebGatewayTransport,
	GatewayCsrfRequiredError,
	GatewayEnrollmentError,
	GatewayUnauthenticatedError,
	redeemGatewayEnrollment,
	validateGatewayEndpoint,
} from "../core/gateway.ts";
import { isGatewayPairingOffer, isLegacyRelayPairingOffer, parsePairingOffer, pairingTransportLabel } from "../core/pairing.ts";
import { validateTransportUrl } from "../core/transport.ts";

function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const legacyOffer = {
	v: 2,
	protocolVersion: 1,
	serverId: "mac-1",
	relayEndpoint: "relay.example.test:443",
	relayUseTls: true,
	daemonPublicKeyB64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
	deviceId: "iphone-1",
	deviceToken: "device-token",
} as const;

describe("selected gateway transport", () => {
	test("keeps a legacy relay offer parseable but labels it inert", () => {
		const offer = parsePairingOffer(legacyOffer);
		expect(isLegacyRelayPairingOffer(offer)).toBe(true);
		expect(isGatewayPairingOffer(offer)).toBe(false);
		expect(pairingTransportLabel(offer)).toContain("inactive");
		const versioned = parsePairingOffer({ ...legacyOffer, transport: { version: 1, kind: "paseo-relay" } });
		expect((versioned as { transport?: { kind?: string } }).transport?.kind).toBe("paseo-relay");
		expect(pairingTransportLabel(versioned)).toContain("inactive");
	});

	test("refuses non-HTTPS and credential-bearing tailnet endpoints", () => {
		expect(() => validateGatewayEndpoint("http://mac.tailnet.ts.net")).toThrow("HTTPS");
		expect(() => validateGatewayEndpoint("https://user:pass@mac.tailnet.ts.net")).toThrow();
		expect(() => validateGatewayEndpoint("https://mac.tailnet.ts.net/?token=secret")).toThrow();
		expect(() => validateTransportUrl("https://mac.tailnet.ts.net/?token=secret")).toThrow();
	});

	test("web mutations use same-origin cookies and the CSRF cookie", async () => {
		let seenInput: RequestInfo | URL | undefined;
		let seenInit: RequestInit | undefined;
		const transport = createWebGatewayTransport({
			cookieSource: () => "cedia_csrf=csrf-123",
			fetch: async (input, init) => {
				seenInput = input;
				seenInit = init;
				return jsonResponse(200, { ok: true });
			},
		});
		await expect(transport.request("POST", "/v1/sessions", { title: "x" })).resolves.toMatchObject({ status: 200, body: { ok: true } });
		expect(seenInput).toBe("/v1/sessions");
		expect(seenInit?.credentials).toBe("same-origin");
		expect(new Headers(seenInit?.headers).get("X-Cedia-CSRF")).toBe("csrf-123");
		expect(new Headers(seenInit?.headers).get("Authorization")).toBeNull();
	});

	test("maps csrf_required and revoked devices to typed errors", async () => {
		const csrf = createWebGatewayTransport({ fetch: async () => jsonResponse(403, { error: { code: "csrf_required", message: "needs csrf" } }) });
		await expect(csrf.request("POST", "/v1/projects", {})).rejects.toBeInstanceOf(GatewayCsrfRequiredError);
		const revoked = createWebGatewayTransport({ fetch: async () => jsonResponse(401, { error: { code: "unauthorized", message: "revoked" } }) });
		await expect(revoked.request("GET", "/v1/projects")).rejects.toBeInstanceOf(GatewayUnauthenticatedError);
	});

	test("maps enrollment failures to distinct actionable errors", async () => {
		for (const [status, code, phrase] of [
			[410, "enrollment_expired", "expired"],
			[409, "enrollment_already_redeemed", "already used"],
			[401, "enrollment_unknown", "not valid"],
		] as const) {
			const fetch = async () => jsonResponse(status, { error: { code, message: "server message" } });
			const error = await redeemGatewayEnrollment({ endpoint: "https://mac.tailnet.ts.net", code: "code", name: "Phone", fetch }).then(() => undefined, reason => reason);
			expect(error).toBeInstanceOf(GatewayEnrollmentError);
			expect((error as GatewayEnrollmentError).code).toBe(code);
			expect((error as GatewayEnrollmentError).message).toContain(phrase);
		}
	});

	test("native gateway sends the SecureStore-held token without putting it in the URL", async () => {
		let seenInput: RequestInfo | URL | undefined;
		let seenInit: RequestInit | undefined;
		const transport = createNativeGatewayTransport({
			endpoint: "https://mac.tailnet.ts.net",
			token: "device-token",
			fetch: async (input, init) => {
				seenInput = input;
				seenInit = init;
				return jsonResponse(200, { ok: true });
			},
		});
		await transport.request("POST", "/v1/sessions", {});
		expect(String(seenInput)).toBe("https://mac.tailnet.ts.net/v1/sessions");
		expect(String(seenInput)).not.toContain("device-token");
		expect(new Headers(seenInit?.headers).get("Authorization")).toBe("Bearer device-token");
		// One credential, sent one way: the Mac treats a valid Bearer request as its own proof, so
		// there is no cookie to duplicate and no CSRF token to add for a mutation.
		expect(new Headers(seenInit?.headers).get("Cookie")).toBeNull();
		expect(new Headers(seenInit?.headers).get("X-Cedia-CSRF")).toBeNull();
	});
});
