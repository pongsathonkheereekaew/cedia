/** Browser-safe Cedia relay public entrypoint. */

/**
 * Version of the pairing transport discriminator.  The relay offer predates this
 * field and intentionally remains valid without it; mobile callers use the
 * discriminator to decide which transport may be armed.
 */
export const CEDIA_PAIRING_TRANSPORT_VERSION = 1 as const;
export type CediaPairingTransportKind = "paseo-relay" | "tailscale-gateway";
export interface CediaPairingTransportDiscriminator {
	readonly version: typeof CEDIA_PAIRING_TRANSPORT_VERSION;
	readonly kind: CediaPairingTransportKind;
}

export function validateCediaPairingTransport(value: unknown): CediaPairingTransportDiscriminator {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("pairing transport must be an object");
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some(key => key !== "version" && key !== "kind")) throw new TypeError("pairing transport contains unknown fields");
	if (record.version !== CEDIA_PAIRING_TRANSPORT_VERSION || (record.kind !== "paseo-relay" && record.kind !== "tailscale-gateway")) throw new TypeError("pairing transport version or kind is unsupported");
	return { version: CEDIA_PAIRING_TRANSPORT_VERSION, kind: record.kind };
}

export { CediaRelayClient } from "./client.ts";
export type {
	CediaRelayClientOptions,
	CediaRelayClientResponse,
	CediaRelayClientState,
	CediaRelayRequestInput,
} from "./client.ts";
export {
	CediaRelayCapacityError,
	CediaRelayConnectionError,
	CediaRelayDisconnectedError,
	CediaRelayRequestTimeoutError,
} from "./client.ts";

export { CediaRelayHost } from "./host.ts";
export type { CediaRelayHostOptions, CediaRelayRequestHandler } from "./host.ts";

export {
	CEDIA_RELAY_PROTOCOL_VERSION,
	PASEO_RELAY_PROTOCOL_VERSION,
	DEFAULT_RELAY_MAX_PENDING_REQUESTS,
	DEFAULT_RELAY_MAX_REQUEST_IDS,
	DEFAULT_RELAY_REQUEST_TIMEOUT_MS,
	MAX_RELAY_PAYLOAD_BYTES,
	buildRelayWebSocketUrl,
	createCediaRelayPairingOffer,
	createCediaRelayRequest,
	createCediaRelayResponse,
	fingerprintCediaRelayRequest,
	parseCediaRelayMessage,
	serializeCediaRelayMessage,
	stableJson,
	validateCediaRelayPairingOffer,
} from "./protocol.ts";
export type {
	CediaRelayHandlerRequest,
	CediaRelayHandlerResponse,
	CediaRelayMessage,
	CediaRelayPairingOffer,
	CediaRelayRequest,
	CediaRelayResponse,
	CreateCediaRelayPairingOfferInput,
} from "./protocol.ts";
export { CediaRelayOfferError, CediaRelayProtocolError } from "./protocol.ts";

export {
	createClientChannel,
	createDaemonChannel,
	EncryptedChannel,
	generateKeyPair,
	exportPublicKey,
	importPublicKey,
	exportSecretKey,
	importSecretKey,
	deriveSharedKey,
	encrypt,
	decrypt,
} from "./e2ee.ts";
export type { EncryptedChannelEvents, Transport, TransportMessage, KeyPair, SharedKey } from "./e2ee.ts";

export type {
	CediaRelaySocket,
	CediaRelaySocketMessage,
	CediaRelayTransport,
	CediaRelayWebSocketFactory,
} from "./transport.ts";
