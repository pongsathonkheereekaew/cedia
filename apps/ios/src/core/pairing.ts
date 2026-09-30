import {
	CEDIA_PAIRING_TRANSPORT_VERSION,
	validateCediaRelayPairingOffer,
	type CediaPairingTransportDiscriminator,
	type CediaRelayPairingOffer,
} from "../../../../packages/relay/src/index.ts";
import { isRecord, nonEmptyString } from "./types.ts";

/** The selected private transport, carried alongside a pairing offer. */
export type GatewayTransportDiscriminator = CediaPairingTransportDiscriminator & {
	readonly kind: "tailscale-gateway";
};

/**
 * New pairing material for the Tailscale Serve/CEDIA gateway path.
 *
 * `enrollmentCode`/`enrollmentPin` are short-lived bootstrap values. They are
 * intentionally removed before the offer is persisted; the returned controller
 * token is stored through PairingSecretStore instead.
 */
export interface CediaGatewayPairingOffer {
	readonly transport: GatewayTransportDiscriminator;
	readonly serverId: string;
	readonly gatewayOrigin: string;
	readonly deviceName: string;
	readonly enrollmentCode?: string;
	readonly enrollmentPin?: string;
	/** Optional legacy fields keep old read-only UI/tests type-safe; gateway code never consumes them. */
	readonly relayEndpoint?: string;
	readonly daemonPublicKeyB64?: string;
}

export type CediaLegacyRelayPairingOffer = CediaRelayPairingOffer & {
	readonly transport?: CediaPairingTransportDiscriminator & { readonly kind: "paseo-relay" };
};

/** Pairing payloads accepted by the mobile client. Legacy relay offers remain parseable. */
export type PairingOffer = CediaLegacyRelayPairingOffer | CediaGatewayPairingOffer;

export function isGatewayPairingOffer(value: PairingOffer | unknown): value is CediaGatewayPairingOffer {
	return isRecord(value)
		&& isRecord(value.transport)
		&& value.transport.version === CEDIA_PAIRING_TRANSPORT_VERSION
		&& value.transport.kind === "tailscale-gateway"
		&& typeof value.gatewayOrigin === "string"
		&& typeof value.deviceName === "string";
}

export function isLegacyRelayPairingOffer(value: PairingOffer | unknown): value is CediaRelayPairingOffer {
	return isRecord(value)
		&& (!Object.prototype.hasOwnProperty.call(value, "transport") || (isRecord(value.transport) && value.transport.version === CEDIA_PAIRING_TRANSPORT_VERSION && value.transport.kind === "paseo-relay"))
		&& typeof value.relayEndpoint === "string"
		&& typeof value.deviceToken === "string";
}

export function pairingTransportLabel(value: PairingOffer | unknown): string {
	if (isGatewayPairingOffer(value)) return "Tailscale gateway";
	if (isLegacyRelayPairingOffer(value)) return "Paseo relay (legacy, inactive)";
	return "Unavailable transport";
}

export class PairingOfferError extends Error {
  readonly code = "invalid-pairing-offer";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
    this.name = "PairingOfferError";
  }
}

export interface PairingSecretStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem?(key: string): Promise<void>;
}

export interface StoredPairingSecrets {
	readonly serverId: string;
	readonly deviceId: string;
	readonly deviceToken: string;
	readonly daemonPublicKeyB64: string;
	/** Native gateway session cookie, when this is a gateway pairing. */
	readonly gatewayCsrf?: string;
	readonly gatewayOrigin?: string;
}

const SECRET_PREFIX = "cedia.pairing.v2";
const CURRENT_SERVER_KEY = `${SECRET_PREFIX}.current-server`;

function secretKey(serverId: string, field: string): string {
  return `${SECRET_PREFIX}.${encodeURIComponent(serverId)}.${field}`;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - value.length % 4) % 4), "=");
  try {
    if (typeof globalThis.atob === "function") {
      const binary = globalThis.atob(normalized);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    const buffer = (globalThis as typeof globalThis & { Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
    if (buffer) return buffer.from(normalized, "base64").toString("utf8");
  } catch (error) {
    throw new PairingOfferError("Pairing offer QR payload is not valid UTF-8", { cause: error });
  }
  throw new PairingOfferError("This device cannot decode a pairing QR payload");
}

function validateGatewayOrigin(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) throw new PairingOfferError("Gateway endpoint is required");
	let parsed: URL;
	try { parsed = new URL(value.trim()); } catch (error) { throw new PairingOfferError("Gateway endpoint is invalid", { cause: error }); }
	if (parsed.protocol !== "https:") throw new PairingOfferError("Gateway endpoint must use HTTPS");
	if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/")) {
		throw new PairingOfferError("Gateway endpoint must be an HTTPS origin without credentials, path, or query state");
	}
	return parsed.origin;
}

function gatewayString(value: unknown, label: string, max = 256): string {
	if (typeof value !== "string" || !value.trim() || value.length > max) throw new PairingOfferError(`${label} is required`);
	return value.trim();
}

function validateGatewayPairingOffer(value: unknown, allowStored = false): CediaGatewayPairingOffer {
	if (!isRecord(value)) throw new PairingOfferError("Gateway pairing offer must be a JSON object");
	const transport = value.transport;
	if (!isRecord(transport) || transport.version !== CEDIA_PAIRING_TRANSPORT_VERSION || !["tailscale-gateway", "tailscale", "gateway"].includes(String(transport.kind))) {
		throw new PairingOfferError("Gateway pairing offer has an unsupported transport version");
	}
	const allowed = new Set(["transport", "serverId", "gatewayOrigin", "endpoint", "origin", "deviceName", "name", "enrollmentCode", "code", "enrollmentPin", "pin"]);
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PairingOfferError(`Gateway pairing offer contains unknown field: ${key}`);
	const enrollmentCodeValue = value.enrollmentCode ?? value.code;
	const enrollmentPinValue = value.enrollmentPin ?? value.pin;
	const enrollmentCode = enrollmentCodeValue === undefined ? undefined : gatewayString(enrollmentCodeValue, "Enrollment code", 128);
	const enrollmentPin = enrollmentPinValue === undefined ? undefined : gatewayString(enrollmentPinValue, "Enrollment pin", 128);
	if (!allowStored && enrollmentCode === undefined && enrollmentPin === undefined) throw new PairingOfferError("Gateway pairing offer needs an enrollment code or pin");
	if (enrollmentCode === undefined && enrollmentPin === undefined && !allowStored) throw new PairingOfferError("Gateway pairing offer needs an enrollment code or pin");
	return {
		transport: { version: CEDIA_PAIRING_TRANSPORT_VERSION, kind: "tailscale-gateway" },
		serverId: gatewayString(value.serverId, "serverId"),
		gatewayOrigin: validateGatewayOrigin(value.gatewayOrigin ?? value.endpoint ?? value.origin),
		deviceName: gatewayString(value.deviceName ?? value.name, "Device name", 100),
		...(enrollmentCode === undefined ? {} : { enrollmentCode }),
		...(enrollmentPin === undefined ? {} : { enrollmentPin }),
	};
}

function parseCandidate(value: unknown): PairingOffer {
	if (!isRecord(value)) throw new PairingOfferError("Pairing offer must be a JSON object");
	if (Object.prototype.hasOwnProperty.call(value, "transport")) {
		const transport = value.transport;
		if (isRecord(transport) && transport.version === CEDIA_PAIRING_TRANSPORT_VERSION && transport.kind === "paseo-relay") {
			const { transport: _transport, ...legacy } = value;
			const validated = parseCandidate(legacy);
			if (!isLegacyRelayPairingOffer(validated)) return validated;
			return { ...validated, transport: { version: CEDIA_PAIRING_TRANSPORT_VERSION, kind: "paseo-relay" } };
		}
		return validateGatewayPairingOffer(value);
	}
	try {
		return validateCediaRelayPairingOffer(value);
  } catch (error) {
    if (error instanceof PairingOfferError) throw error;
    throw new PairingOfferError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

function parseStoredCandidate(value: unknown): PairingOffer {
	if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, "transport")) {
		const transport = value.transport;
		if (isRecord(transport) && transport.kind === "paseo-relay") return parseCandidate(value);
		return validateGatewayPairingOffer(value, true);
	}
	return parseCandidate(value);
}

/** Display-only truncation of the pinned Mac public key. Not a derived hash. */
export function pairingPublicKeyFingerprint(publicKeyB64: string): string {
  const compact = publicKeyB64.replace(/\s+/g, "").replace(/=+$/, "");
  if (!compact) return "";
  if (compact.length <= 16) return compact;
  return `${compact.slice(0, 8)}…${compact.slice(-4)}`;
}

/** Parse private JSON, or a QR URL carrying #offer=<base64url JSON>. */
export function parsePairingOffer(input: string | unknown): PairingOffer {
  if (typeof input === "object") return parseCandidate(input);
  if (typeof input !== "string" || !input.trim()) throw new PairingOfferError("Pairing offer is empty");
  const raw = input.trim();
  let json = raw;
  const marker = raw.indexOf("#offer=");
  if (marker >= 0) {
    const encoded = raw.slice(marker + "#offer=".length).split(/[&#]/, 1)[0]?.trim();
    if (!encoded) throw new PairingOfferError("Pairing offer QR payload is empty");
    json = decodeBase64Url(encoded);
  }
  try { return parseCandidate(JSON.parse(json) as unknown); } catch (error) {
    if (error instanceof PairingOfferError) throw error;
    throw new PairingOfferError("Pairing offer JSON is invalid");
  }
}

export function pairingSecretKeys(serverId: string): { token: string; deviceId: string; daemonPublicKeyB64: string; offer: string } {
  if (!nonEmptyString(serverId)) throw new TypeError("serverId is required");
  return {
    token: secretKey(serverId, "device-token"),
    deviceId: secretKey(serverId, "device-id"),
    daemonPublicKeyB64: secretKey(serverId, "daemon-public-key"),
    offer: secretKey(serverId, "offer"),
  };
}

/** Store credentials only through SecureStore-backed PairingSecretStore. */
export async function savePairingSecrets(
	store: PairingSecretStore,
	offer: PairingOffer,
	credentials: { readonly deviceToken?: string; readonly deviceId?: string; readonly gatewayCsrf?: string } = {},
): Promise<StoredPairingSecrets> {
	const validated = parseCandidate(offer);
	const keys = pairingSecretKeys(validated.serverId);
	const deviceToken = isGatewayPairingOffer(validated) ? credentials.deviceToken : validated.deviceToken;
	if (!deviceToken) throw new PairingOfferError("Gateway pairing must be enrolled before its token can be stored");
	const [existingPublicKey, existingDeviceId] = await Promise.all([store.getItem(keys.daemonPublicKeyB64), store.getItem(keys.deviceId)]);
	const deviceId = isGatewayPairingOffer(validated) ? credentials.deviceId ?? (await store.getItem(keys.deviceId)) ?? `gateway-${validated.serverId}` : validated.deviceId;
	if (existingPublicKey && isLegacyRelayPairingOffer(validated) && existingPublicKey !== validated.daemonPublicKeyB64) throw new PairingOfferError("The Mac public key changed; revoke the old pairing before importing this offer");
	if (existingDeviceId && deviceId && existingDeviceId !== deviceId) throw new PairingOfferError("This server already has a different paired device; revoke it before importing this offer");
	const sanitizedOffer = isGatewayPairingOffer(validated)
		? { ...validated, enrollmentCode: undefined, enrollmentPin: undefined }
		: validated;
	const gatewayCsrfKey = secretKey(validated.serverId, "gateway-csrf");
	const gatewayOriginKey = secretKey(validated.serverId, "gateway-origin");
	await Promise.all([
		store.setItem(keys.token, deviceToken),
		store.setItem(keys.deviceId, deviceId ?? validated.serverId),
		...(isLegacyRelayPairingOffer(validated) ? [store.setItem(keys.daemonPublicKeyB64, validated.daemonPublicKeyB64)] : []),
		store.setItem(keys.offer, JSON.stringify(sanitizedOffer)),
		...(isGatewayPairingOffer(validated) && credentials.gatewayCsrf ? [store.setItem(gatewayCsrfKey, credentials.gatewayCsrf)] : []),
		...(isGatewayPairingOffer(validated) ? [store.setItem(gatewayOriginKey, validated.gatewayOrigin)] : []),
		store.setItem(CURRENT_SERVER_KEY, validated.serverId),
	]);
	return {
		serverId: validated.serverId,
		deviceId: deviceId ?? validated.serverId,
		deviceToken,
		daemonPublicKeyB64: isLegacyRelayPairingOffer(validated) ? validated.daemonPublicKeyB64 : "",
		...(isGatewayPairingOffer(validated) && credentials.gatewayCsrf ? { gatewayCsrf: credentials.gatewayCsrf } : {}),
		...(isGatewayPairingOffer(validated) ? { gatewayOrigin: validated.gatewayOrigin } : {}),
	};
}

/** Recover the last pairing offer so the app can reconnect after relaunch. */
export async function readStoredPairingOffer(store: PairingSecretStore): Promise<PairingOffer | null> {
  const serverId = await store.getItem(CURRENT_SERVER_KEY);
  if (!serverId) return null;
  const keys = pairingSecretKeys(serverId);
  const raw = await store.getItem(keys.offer);
  if (!raw) return null;
  try {
    return parseStoredCandidate(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function readPairingSecrets(store: PairingSecretStore, serverId: string): Promise<StoredPairingSecrets | null> {
  const keys = pairingSecretKeys(serverId);
  const [deviceToken, deviceId, daemonPublicKeyB64] = await Promise.all([store.getItem(keys.token), store.getItem(keys.deviceId), store.getItem(keys.daemonPublicKeyB64)]);
  if (!deviceToken || !deviceId) return null;
  const [gatewayCsrf, gatewayOrigin] = await Promise.all([store.getItem(secretKey(serverId, "gateway-csrf")), store.getItem(secretKey(serverId, "gateway-origin"))]);
  return { serverId, deviceId, deviceToken, daemonPublicKeyB64: daemonPublicKeyB64 ?? "", ...(gatewayCsrf ? { gatewayCsrf } : {}), ...(gatewayOrigin ? { gatewayOrigin } : {}) };
}

export async function revokePairing(store: PairingSecretStore, serverId: string): Promise<void> {
  const keys = pairingSecretKeys(serverId);
  if (!store.deleteItem) return;
  await Promise.all([store.deleteItem(keys.token), store.deleteItem(keys.deviceId), store.deleteItem(keys.daemonPublicKeyB64), store.deleteItem(keys.offer), store.deleteItem(secretKey(serverId, "gateway-csrf")), store.deleteItem(secretKey(serverId, "gateway-origin"))]);
  if ((await store.getItem(CURRENT_SERVER_KEY)) === serverId) await store.deleteItem(CURRENT_SERVER_KEY);
}
