import type { CediaGatewayPairingOffer, PairingSecretStore } from "./pairing.ts";
import { isRecord, nonEmptyString } from "./types.ts";
import {
	TransportError,
	type ClientTransport,
	type TransportMethod,
} from "./transport.ts";

/** Fetch's portable subset; Bun's `preconnect` extension is not required here. */
export type GatewayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** A structured error returned by the CEDIA gateway, retaining its action code. */
export class GatewayTransportError extends TransportError {
	readonly gatewayCode?: string;

	constructor(path: string, message: string, status?: number, code?: string, options?: { cause?: unknown }) {
		super(path, message, status, code, options);
		this.name = "GatewayTransportError";
		this.gatewayCode = code;
	}
}

/** The browser session has ended or the native controller was revoked. */
export class GatewayUnauthenticatedError extends GatewayTransportError {
	readonly code = "unauthenticated" as const;

	constructor(path: string, status = 401, message = "This Cedia device is no longer authenticated; pair it again") {
		super(path, message, status, "unauthenticated");
		this.name = "GatewayUnauthenticatedError";
	}
}

/** A browser mutation is missing the gateway session's CSRF token. */
export class GatewayCsrfRequiredError extends GatewayTransportError {
	readonly code = "csrf_required" as const;

	constructor(path: string, message = "This request needs the gateway session's CSRF token") {
		super(path, message, 403, "csrf_required");
		this.name = "GatewayCsrfRequiredError";
	}
}

export type GatewayEnrollmentCode = "enrollment_expired" | "enrollment_already_redeemed" | "enrollment_unknown";

/** An enrollment failure has a distinct next action for the pairing UI. */
export class GatewayEnrollmentError extends Error {
	readonly status: number;
	readonly code: GatewayEnrollmentCode | string;

	constructor(status: number, code: GatewayEnrollmentCode | string, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "GatewayEnrollmentError";
		this.status = status;
		this.code = code;
	}
}

export interface GatewayEnrollmentResult {
	readonly deviceId: string;
	readonly deviceName: string;
	/** Native mode receives the controller token from the session cookie. Web mode leaves this absent. */
	readonly deviceToken?: string;
	readonly csrf?: string;
	readonly origin: string;
}

export interface GatewaySession {
	readonly authenticated: boolean;
	readonly device?: { readonly id: string; readonly name: string; readonly role?: string };
	readonly csrf?: string | null;
}

export interface GatewayTransportOptions {
	readonly endpoint: string;
	readonly token?: string | (() => Promise<string | null>);
	readonly fetch?: GatewayFetch;
	readonly timeoutMs?: number;
	/** Development-only escape hatch for an explicitly loopback HTTP endpoint. */
	readonly allowLocalhostDevelopment?: boolean;
}

export interface WebGatewayTransportOptions {
	readonly fetch?: GatewayFetch;
	readonly cookieSource?: () => string;
	readonly timeoutMs?: number;
}

interface GatewayResponseBody {
	readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

function responseBody(value: unknown): GatewayResponseBody | undefined {
	return isRecord(value) ? value as GatewayResponseBody : undefined;
}

function errorCode(body: unknown): string | undefined {
	const error = responseBody(body)?.error;
	return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

function errorMessage(body: unknown, status: number): string {
	const error = responseBody(body)?.error;
	return isRecord(error) && typeof error.message === "string" && error.message.trim()
		? error.message
		: `Cedia gateway request failed (${status})`;
}

async function readJson(response: Response, path: string): Promise<unknown> {
	const text = await response.text();
	if (!text.trim()) return undefined;
	try { return JSON.parse(text) as unknown; } catch (error) {
		throw new GatewayTransportError(path, "Cedia gateway returned malformed JSON", response.status, undefined, { cause: error });
	}
}

function throwGatewayError(path: string, status: number, body: unknown): never {
	const code = errorCode(body);
	if (status === 401 || code === "unauthorized" || code === "revoked" || code === "unauthenticated") throw new GatewayUnauthenticatedError(path, status, errorMessage(body, status));
	if (status === 403 && code === "csrf_required") throw new GatewayCsrfRequiredError(path, errorMessage(body, status));
	throw new GatewayTransportError(path, errorMessage(body, status), status, code);
}

function readCookie(source: string, name: string): string | null {
	for (const part of source.split(";")) {
		const index = part.indexOf("=");
		if (index < 0 || part.slice(0, index).trim() !== name) continue;
		const value = part.slice(index + 1).trim();
		try { return decodeURIComponent(value); } catch { return value; }
	}
	return null;
}

function browserCookieSource(): string {
	const documentLike = (globalThis as typeof globalThis & { document?: { cookie?: string } }).document;
	return documentLike?.cookie ?? "";
}

function isMutation(method: string): boolean {
	return method !== "GET" && method !== "HEAD";
}

function requestPath(path: string): string {
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new TypeError("Gateway paths must be absolute local paths");
	return path;
}

function timeoutValue(timeoutMs: number | undefined): number {
	const value = timeoutMs ?? 15_000;
	if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new RangeError("timeoutMs must be an integer from 1 to 2147483647");
	return value;
}

function tokenReader(value: string | (() => Promise<string | null>) | undefined): () => Promise<string | null> {
	return typeof value === "function" ? value : async () => value ?? null;
}

/** Validate an explicit tailnet origin. Credentials may never be hidden in its URL. */
export function validateGatewayEndpoint(value: string, allowLocalhostDevelopment = false): URL {
	let parsed: URL;
	try { parsed = new URL(value); } catch (error) { throw new GatewayEnrollmentError(0, "invalid_endpoint", "Cedia gateway endpoint is invalid", { cause: error }); }
	const localhost = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
	if (parsed.protocol !== "https:" && !(allowLocalhostDevelopment && localhost && parsed.protocol === "http:")) throw new GatewayEnrollmentError(0, "invalid_endpoint", "Cedia gateway endpoint must use HTTPS; HTTP is allowed only for explicit localhost development");
	if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/")) throw new GatewayEnrollmentError(0, "invalid_endpoint", "Cedia gateway endpoint must be an origin without credentials, path, or query state");
	return parsed;
}

/** Naming used by the remote design docs and callers that call this a tailnet endpoint. */
export const validateTailnetEndpoint = validateGatewayEndpoint;

async function performRequest(
	fetchImpl: GatewayFetch,
	input: RequestInfo | URL,
	path: string,
	method: TransportMethod | string,
	init: RequestInit,
	timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(input, { ...init, method, signal: controller.signal });
		const parsed = await readJson(response, path);
		if (!response.ok) throwGatewayError(path, response.status, parsed);
		return { status: response.status, body: parsed };
	} catch (error) {
		if (error instanceof GatewayTransportError) throw error;
		if (controller.signal.aborted) throw new GatewayTransportError(path, `Cedia gateway request timed out after ${timeoutMs}ms`);
		throw new GatewayTransportError(path, error instanceof Error ? error.message : String(error), undefined, undefined, { cause: error });
	} finally {
		clearTimeout(timer);
	}
}

/** Same-origin browser transport. It never adds a bearer header or writes credentials to storage. */
export function createWebGatewayTransport(options: WebGatewayTransportOptions = {}): ClientTransport {
	const fetchImpl = options.fetch ?? fetch;
	const readCookies = options.cookieSource ?? browserCookieSource;
	const timeoutMs = timeoutValue(options.timeoutMs);
	return {
		async request(method, relativePath, body) {
			const path = requestPath(relativePath);
			const headers = new Headers({ Accept: "application/json" });
			if (isMutation(method.toUpperCase())) {
				const csrf = readCookie(readCookies(), "cedia_csrf");
				if (csrf) headers.set("X-Cedia-CSRF", csrf);
			}
			if (body !== undefined) {
				headers.set("Content-Type", "application/json");
			}
			return performRequest(fetchImpl, path, path, method, {
				headers,
				credentials: "same-origin",
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			}, timeoutMs);
		},
	};
}

/** Native transport for the explicit HTTPS gateway and a SecureStore-held controller token. */
export function createNativeGatewayTransport(options: GatewayTransportOptions): ClientTransport {
	const endpoint = validateGatewayEndpoint(options.endpoint, options.allowLocalhostDevelopment === true);
	const fetchImpl = options.fetch ?? fetch;
	const timeoutMs = timeoutValue(options.timeoutMs);
	const readToken = tokenReader(options.token);
	return {
		async request(method, relativePath, body) {
			const path = requestPath(relativePath);
			const target = new URL(path, endpoint);
			const token = await readToken();
			if (!token) throw new GatewayUnauthenticatedError(path);
			// One credential, sent the one way a native client can. The Mac treats a valid Bearer
			// token as its own proof and refuses the Mac's owner device at the gateway entirely, and
			// CSRF only exists because a browser sends cookies automatically - this client never
			// sends one, so there is nothing to duplicate and no token to add on a mutation.
			const headers: Record<string, string> = { Accept: "application/json" };
			if (token) {
				headers.Authorization = `Bearer ${token}`;
			}
			if (body !== undefined) {
				headers["Content-Type"] = "application/json";
			}
			return performRequest(fetchImpl, target, path, method, {
				headers,
				credentials: "omit",
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			}, timeoutMs);
		},
	};
}

/** Alias used by callers that do not need to spell out the platform mode. */
export const createGatewayTransport = createNativeGatewayTransport;
export const createTailnetGatewayTransport = createNativeGatewayTransport;

/** Read the gateway session without treating a logged-out browser as a transport failure. */
export async function getGatewaySession(transport: ClientTransport): Promise<GatewaySession> {
	const result = await transport.request("GET", "/gateway/session");
	if (!isRecord(result.body) || typeof result.body.authenticated !== "boolean") throw new GatewayTransportError("/gateway/session", "Cedia gateway returned an invalid session response", result.status, "invalid_session");
	const device = isRecord(result.body.device) && typeof result.body.device.id === "string" && typeof result.body.device.name === "string"
		? { id: result.body.device.id, name: result.body.device.name, ...(typeof result.body.device.role === "string" ? { role: result.body.device.role } : {}) }
		: undefined;
	return { authenticated: result.body.authenticated, ...(device ? { device } : {}), ...(typeof result.body.csrf === "string" || result.body.csrf === null ? { csrf: result.body.csrf } : {}) };
}

export const readGatewaySession = getGatewaySession;

function setCookieHeaders(response: Response): string[] {
	const headersWithGetSetCookie = response.headers as Headers & { getSetCookie?: () => string[] };
	if (typeof headersWithGetSetCookie.getSetCookie === "function") return headersWithGetSetCookie.getSetCookie();
	const combined = response.headers.get("set-cookie");
	return combined ? combined.split(/,(?=\s*(?:cedia_session|cedia_csrf)=)/i) : [];
}

function cookieFromHeaders(headers: readonly string[], name: string): string | undefined {
	const prefix = `${name}=`;
	const header = headers.find(item => item.trimStart().toLowerCase().startsWith(prefix));
	return header?.trimStart().slice(prefix.length).split(";", 1)[0];
}

function enrollmentMessage(code: string | undefined, status: number, fallback: string): string {
	if (code === "enrollment_expired") return "This enrollment code expired. Ask the Mac for a new code.";
	if (code === "enrollment_already_redeemed") return "This enrollment code was already used. Ask the Mac for a new code.";
	if (code === "enrollment_unknown") return "This enrollment code is not valid. Check it or ask the Mac for a new one.";
	return fallback || `Enrollment failed (${status})`;
}

/** Redeem a short-lived code/pin; browser cookies stay in the browser, native stores its session token. */
export async function redeemGatewayEnrollment(options: {
	readonly endpoint: string;
	readonly code?: string;
	readonly pin?: string;
	readonly name: string;
	readonly fetch?: GatewayFetch;
	readonly web?: boolean;
}): Promise<GatewayEnrollmentResult> {
	const endpoint = validateGatewayEndpoint(options.endpoint, false);
	const code = options.code?.trim() || options.pin?.trim();
	if (!code) throw new GatewayEnrollmentError(400, "invalid_body", "Enter the enrollment code or pin shown by the Mac");
	if (!nonEmptyString(options.name) || options.name.trim().length > 100) throw new GatewayEnrollmentError(400, "invalid_body", "A device name is required");
	const fetchImpl = options.fetch ?? fetch;
	const path = "/gateway/enroll";
	const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" });
	const controller = new AbortController();
	try {
		const response = await fetchImpl(options.web ? path : new URL(path, endpoint), {
			method: "POST",
			headers,
			// A native client has no cookie jar, so it asks for the controller token in the body and
			// the Mac refuses that answer to anything carrying a browser `Origin` (plan §6.5).
			body: JSON.stringify({ code, name: options.name.trim(), ...(options.web ? {} : { client: "native" }) }),
			credentials: options.web ? "same-origin" : "omit",
			signal: controller.signal,
		});
		const parsed = await readJson(response, path);
		if (!response.ok) {
			const codeValue = errorCode(parsed) ?? "enrollment_failed";
			throw new GatewayEnrollmentError(response.status, codeValue, enrollmentMessage(codeValue, response.status, errorMessage(parsed, response.status)));
		}
		if (!isRecord(parsed) || !isRecord(parsed.device) || typeof parsed.device.id !== "string" || typeof parsed.device.name !== "string") throw new GatewayEnrollmentError(502, "invalid_response", "The Mac returned an invalid enrollment response");
		const setCookies = setCookieHeaders(response);
		const csrf = typeof parsed.csrf === "string" && parsed.csrf ? parsed.csrf : cookieFromHeaders(setCookies, "cedia_csrf");
		// The native answer carries the token in the body because React Native does not expose
		// Set-Cookie to JavaScript; the browser answer carries it only as an HttpOnly cookie.
		const session = typeof parsed.token === "string" && parsed.token ? parsed.token : cookieFromHeaders(setCookies, "cedia_session");
		return {
			deviceId: parsed.device.id,
			deviceName: parsed.device.name,
			...(session ? { deviceToken: session } : {}),
			...(csrf ? { csrf } : {}),
			origin: endpoint.origin,
		};
	} catch (error) {
		if (error instanceof GatewayEnrollmentError) throw error;
		throw new GatewayEnrollmentError(0, "network", error instanceof Error ? error.message : String(error), { cause: error });
	} finally {
		controller.abort();
	}
}

export const enrollGateway = redeemGatewayEnrollment;

/** Persist the native enrollment result through the existing SecureStore seam. */
export async function persistGatewayEnrollment(
	store: PairingSecretStore,
	offer: CediaGatewayPairingOffer,
	result: GatewayEnrollmentResult,
): Promise<void> {
	if (!result.deviceToken) throw new GatewayEnrollmentError(502, "invalid_response", "The Mac did not return a controller session token for this native device");
	await store.setItem(`cedia.pairing.v2.${encodeURIComponent(offer.serverId)}.device-token`, result.deviceToken);
	await store.setItem(`cedia.pairing.v2.${encodeURIComponent(offer.serverId)}.device-id`, result.deviceId);
	await store.setItem(`cedia.pairing.v2.${encodeURIComponent(offer.serverId)}.gateway-origin`, result.origin);
	if (result.csrf) await store.setItem(`cedia.pairing.v2.${encodeURIComponent(offer.serverId)}.gateway-csrf`, result.csrf);
}

export function gatewaySessionTransport(options: WebGatewayTransportOptions = {}): ClientTransport {
	return createWebGatewayTransport(options);
}
