/** Browser-safe Cedia relay public entrypoint. */

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
