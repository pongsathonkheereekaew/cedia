/**
 * Cedia's application envelope carried inside the Paseo v2 E2EE channel.
 *
 * The relay only routes opaque WebSocket frames.  This module belongs to the
 * endpoints and is deliberately independent of Node, Cloudflare, or any
 * WebSocket implementation.
 */

import { importPublicKey } from "./crypto.ts";
import { CEDIA_PROTOCOL_VERSION, type Json } from "../../protocol/src/index.ts";

/** Version of the Cedia request/response envelope (shared with host HTTP). */
export const CEDIA_RELAY_PROTOCOL_VERSION = CEDIA_PROTOCOL_VERSION;
/** Paseo relay WebSocket wire version. */
export const PASEO_RELAY_PROTOCOL_VERSION = 2 as const;
export const MAX_RELAY_PAYLOAD_BYTES = 256 * 1024;
export const DEFAULT_RELAY_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_RELAY_MAX_PENDING_REQUESTS = 64;
export const DEFAULT_RELAY_MAX_REQUEST_IDS = 4_096;

export interface CediaRelayPairingOffer {
	v: typeof PASEO_RELAY_PROTOCOL_VERSION;
	protocolVersion: typeof CEDIA_RELAY_PROTOCOL_VERSION;
	serverId: string;
	daemonPublicKeyB64: string;
	relayEndpoint: string;
	relayUseTls: boolean;
	deviceId: string;
	deviceToken: string;
}

export interface CreateCediaRelayPairingOfferInput {
	serverId: string;
	daemonPublicKeyB64: string;
	relayEndpoint: string;
	relayUseTls?: boolean;
	deviceId: string;
	deviceToken: string;
}

export interface CediaRelayRequest {
	protocolVersion: typeof CEDIA_RELAY_PROTOCOL_VERSION;
	type: "request";
	id: string;
	epoch: number;
	method: string;
	path: string;
	token: string;
	body?: Json;
}

export interface CediaRelayResponse {
	protocolVersion: typeof CEDIA_RELAY_PROTOCOL_VERSION;
	type: "response";
	id: string;
	epoch: number;
	status: number;
	body: Json;
}

export type CediaRelayMessage = CediaRelayRequest | CediaRelayResponse;

export interface CediaRelayHandlerRequest {
	method: string;
	path: string;
	token: string;
	body?: Json;
}

export interface CediaRelayHandlerResponse {
	status: number;
	body: Json;
}

export class CediaRelayProtocolError extends Error {
	readonly code = "relay_protocol_error";

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "CediaRelayProtocolError";
	}
}

export class CediaRelayOfferError extends Error {
	readonly code = "invalid_pairing_offer";

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "CediaRelayOfferError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJson(value: unknown, seen = new WeakSet<object>()): value is Json {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object") return false;
	if (seen.has(value)) return false;
	seen.add(value);
	try {
		if (Array.isArray(value)) return value.every((item) => isJson(item, seen));
		return Object.values(value).every((item) => isJson(item, seen));
	} finally {
		seen.delete(value);
	}
}

function requireString(value: unknown, label: string, maxBytes: number): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new CediaRelayProtocolError(`${label} must be a non-empty string`);
	}
	if (new TextEncoder().encode(value).byteLength > maxBytes) {
		throw new CediaRelayProtocolError(`${label} exceeds ${maxBytes} bytes`);
	}
	return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new CediaRelayProtocolError(`${label} must be an object`);
	return value;
}

function strictKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
	const set = new Set(allowed);
	for (const key of Object.keys(record)) {
		if (!set.has(key)) throw new CediaRelayProtocolError(`${label} contains unknown field: ${key}`);
	}
}

function parseUtf8(data: string | ArrayBuffer | Uint8Array): string {
	if (typeof data === "string") return data;
	const view = data instanceof Uint8Array ? data : new Uint8Array(data);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(view);
	} catch (error) {
		throw new CediaRelayProtocolError("relay frame is not valid UTF-8", { cause: error });
	}
}

function parseJsonFrame(data: string | ArrayBuffer | Uint8Array): unknown {
	const text = parseUtf8(data);
	const size = new TextEncoder().encode(text).byteLength;
	if (size > MAX_RELAY_PAYLOAD_BYTES) {
		throw new CediaRelayProtocolError(`relay frame exceeds ${MAX_RELAY_PAYLOAD_BYTES} bytes`);
	}
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new CediaRelayProtocolError("relay frame is not valid JSON", { cause: error });
	}
}

function requireVersion(value: unknown, label: string): typeof CEDIA_RELAY_PROTOCOL_VERSION {
	if (value !== CEDIA_RELAY_PROTOCOL_VERSION) {
		throw new CediaRelayProtocolError(`${label} must be protocol v${CEDIA_RELAY_PROTOCOL_VERSION}`);
	}
	return CEDIA_RELAY_PROTOCOL_VERSION;
}

function requireEpoch(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1) {
		throw new CediaRelayProtocolError("relay connection epoch must be a positive integer");
	}
	return value as number;
}

function requireRequestId(value: unknown): string {
	return requireString(value, "relay request id", 256);
}

function requirePath(value: unknown): string {
	const path = requireString(value, "relay request path", 8_192);
	if (!path.startsWith("/") || path.startsWith("//")) {
		throw new CediaRelayProtocolError("relay request path must be an absolute local path");
	}
	return path;
}

function requireMethod(value: unknown): string {
	const method = requireString(value, "relay request method", 32).toUpperCase();
	if (!/^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]*$/.test(method)) {
		throw new CediaRelayProtocolError("relay request method is invalid");
	}
	return method;
}

function requireToken(value: unknown): string {
	return requireString(value, "relay request token", 512);
}

function requireBody(value: unknown): Json {
	if (!isJson(value)) throw new CediaRelayProtocolError("relay request body must be JSON");
	return value;
}

function requireStatus(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 100 || (value as number) > 599) {
		throw new CediaRelayProtocolError("relay response status must be an HTTP status");
	}
	return value as number;
}

export function parseCediaRelayMessage(data: string | ArrayBuffer | Uint8Array): CediaRelayMessage {
	const parsed = requireRecord(parseJsonFrame(data), "relay message");
	if (parsed.type === "request") {
		strictKeys(parsed, ["protocolVersion", "type", "id", "epoch", "method", "path", "token", "body"], "relay request");
		const request: CediaRelayRequest = {
			protocolVersion: requireVersion(parsed.protocolVersion, "relay request protocolVersion"),
			type: "request",
			id: requireRequestId(parsed.id),
			epoch: requireEpoch(parsed.epoch),
			method: requireMethod(parsed.method),
			path: requirePath(parsed.path),
			token: requireToken(parsed.token),
		};
		if (Object.prototype.hasOwnProperty.call(parsed, "body")) request.body = requireBody(parsed.body);
		return request;
	}
	if (parsed.type === "response") {
		strictKeys(parsed, ["protocolVersion", "type", "id", "epoch", "status", "body"], "relay response");
		const body = requireBody(parsed.body);
		return {
			protocolVersion: requireVersion(parsed.protocolVersion, "relay response protocolVersion"),
			type: "response",
			id: requireRequestId(parsed.id),
			epoch: requireEpoch(parsed.epoch),
			status: requireStatus(parsed.status),
			body,
		};
	}
	throw new CediaRelayProtocolError("unknown relay message type");
}

export function serializeCediaRelayMessage(message: CediaRelayMessage): string {
	if (!isJson(message)) throw new CediaRelayProtocolError("relay message must be JSON");
	let serialized: string;
	try {
		serialized = JSON.stringify(message);
	} catch (error) {
		throw new CediaRelayProtocolError("relay message cannot be serialized", { cause: error });
	}
	if (new TextEncoder().encode(serialized).byteLength > MAX_RELAY_PAYLOAD_BYTES) {
		throw new CediaRelayProtocolError(`relay message exceeds ${MAX_RELAY_PAYLOAD_BYTES} bytes`);
	}
	return serialized;
}

export function createCediaRelayRequest(input: {
	id: string;
	epoch: number;
	method: string;
	path: string;
	token: string;
	body?: Json;
}): CediaRelayRequest {
	const value: CediaRelayRequest = {
		protocolVersion: CEDIA_RELAY_PROTOCOL_VERSION,
		type: "request",
		id: input.id,
		epoch: input.epoch,
		method: input.method,
		path: input.path,
		token: input.token,
	};
	if (input.body !== undefined) value.body = input.body;
	parseCediaRelayMessage(serializeCediaRelayMessage(value));
	return value;
}

export function createCediaRelayResponse(input: {
	id: string;
	epoch: number;
	status: number;
	body: Json;
}): CediaRelayResponse {
	const value: CediaRelayResponse = {
		protocolVersion: CEDIA_RELAY_PROTOCOL_VERSION,
		type: "response",
		id: input.id,
		epoch: input.epoch,
		status: input.status,
		body: input.body,
	};
	parseCediaRelayMessage(serializeCediaRelayMessage(value));
	return value;
}

function parseRelayEndpoint(value: string, useTls: boolean): { protocol: "ws:" | "wss:"; host: string; port: string; pathname: string } {
	const trimmed = value.trim();
	if (!trimmed) throw new CediaRelayOfferError("relay endpoint is missing");
	let parsed: URL;
	try {
		parsed = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
			? new URL(trimmed)
			: new URL(`${useTls ? "wss" : "ws"}://${trimmed}`);
	} catch (error) {
		throw new CediaRelayOfferError("relay endpoint is invalid", { cause: error });
	}
	if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
		throw new CediaRelayOfferError("relay endpoint must use ws or wss");
	}
	if ((parsed.protocol === "wss:") !== useTls) {
		throw new CediaRelayOfferError("relay endpoint TLS setting does not match the offer");
	}
	if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new CediaRelayOfferError("relay endpoint must not contain credentials or query state");
	}
	const port = parsed.port || (useTls ? "443" : "80");
	return { protocol: parsed.protocol, host: parsed.hostname, port, pathname: parsed.pathname || "/" };
}

export function buildRelayWebSocketUrl(params: {
	endpoint: string;
	useTls: boolean;
	serverId: string;
	role: "server" | "client";
	connectionId?: string;
}): string {
	const endpoint = parseRelayEndpoint(params.endpoint, params.useTls);
	const host = endpoint.host.includes(":") && !endpoint.host.startsWith("[") ? `[${endpoint.host}]` : endpoint.host;
	const path = endpoint.pathname === "/" ? "/ws" : endpoint.pathname.replace(/\/$/, "");
	const url = new URL(`${endpoint.protocol}//${host}:${endpoint.port}${path}`);
	url.searchParams.set("serverId", requireString(params.serverId, "serverId", 256));
	url.searchParams.set("role", params.role);
	url.searchParams.set("v", String(PASEO_RELAY_PROTOCOL_VERSION));
	if (params.connectionId !== undefined) url.searchParams.set("connectionId", requireString(params.connectionId, "connectionId", 256));
	return url.toString();
}

export function createCediaRelayPairingOffer(input: CreateCediaRelayPairingOfferInput): CediaRelayPairingOffer {
	const daemonPublicKeyB64 = requireString(input.daemonPublicKeyB64, "daemonPublicKeyB64", 128);
	try {
		importPublicKey(daemonPublicKeyB64);
	} catch (error) {
		throw new CediaRelayOfferError("daemonPublicKeyB64 is not a valid pinned public key", { cause: error });
	}
	const relayUseTls = input.relayUseTls ?? true;
	parseRelayEndpoint(input.relayEndpoint, relayUseTls);
	return {
		v: PASEO_RELAY_PROTOCOL_VERSION,
		protocolVersion: CEDIA_RELAY_PROTOCOL_VERSION,
		serverId: requireString(input.serverId, "serverId", 256),
		daemonPublicKeyB64,
		relayEndpoint: input.relayEndpoint.trim(),
		relayUseTls,
		deviceId: requireString(input.deviceId, "deviceId", 256),
		deviceToken: requireString(input.deviceToken, "deviceToken", 512),
	};
}

export function validateCediaRelayPairingOffer(value: unknown): CediaRelayPairingOffer {
	const record = requireRecord(value, "pairing offer");
	strictKeys(record, ["v", "protocolVersion", "serverId", "daemonPublicKeyB64", "relayEndpoint", "relayUseTls", "deviceId", "deviceToken"], "pairing offer");
	if (record.v !== PASEO_RELAY_PROTOCOL_VERSION || record.protocolVersion !== CEDIA_RELAY_PROTOCOL_VERSION) {
		throw new CediaRelayOfferError("pairing offer must use protocol v2; plaintext or older versions are refused");
	}
	if (typeof record.relayUseTls !== "boolean") {
		throw new CediaRelayOfferError("pairing offer relayUseTls must be boolean");
	}
	return createCediaRelayPairingOffer({
		serverId: requireString(record.serverId, "serverId", 256),
		daemonPublicKeyB64: requireString(record.daemonPublicKeyB64, "daemonPublicKeyB64", 128),
		relayEndpoint: requireString(record.relayEndpoint, "relayEndpoint", 512),
		relayUseTls: record.relayUseTls === true,
		deviceId: requireString(record.deviceId, "deviceId", 256),
		deviceToken: requireString(record.deviceToken, "deviceToken", 512),
	});
}

/** A deterministic fingerprint for duplicate-ID protection on one E2EE channel. */
export function fingerprintCediaRelayRequest(request: CediaRelayRequest): string {
	return stableJson({
		protocolVersion: request.protocolVersion,
		type: request.type,
		id: request.id,
		epoch: request.epoch,
		method: request.method,
		path: request.path,
		token: request.token,
		...(request.body === undefined ? {} : { body: request.body }),
	});
}

export function stableJson(value: unknown): string {
	if (!isJson(value)) throw new CediaRelayProtocolError("value must be JSON");
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
