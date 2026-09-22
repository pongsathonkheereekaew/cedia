import {
  CediaRelayClient,
  validateCediaRelayPairingOffer,
  type CediaRelayClientOptions,
  type CediaRelayPairingOffer,
  type CediaRelaySocket,
  type CediaRelayWebSocketFactory,
} from "../../../../packages/relay/src/index.ts";
import type { Json } from "../../../../packages/protocol/src/index.ts";
import type { ClientTransport, TransportMethod } from "./transport.ts";

/** Options for wiring the real encrypted relay client into the mobile API seam. */
export interface MobileRelayTransportOptions {
  readonly offer: CediaRelayPairingOffer;
  /** Supply a platform WebSocket implementation in tests or custom runtimes. */
  readonly createWebSocket?: CediaRelayWebSocketFactory;
  readonly connectionId?: string;
  readonly requestTimeoutMs?: number;
  readonly handshakeTimeoutMs?: number;
  readonly onStateChange?: CediaRelayClientOptions["onStateChange"];
  readonly onError?: CediaRelayClientOptions["onError"];
}

export interface MobileRelayTransport {
  readonly client: CediaRelayClient;
  readonly transport: ClientTransport;
}

function defaultWebSocketFactory(url: string): CediaRelaySocket {
  const Socket = (globalThis as typeof globalThis & { WebSocket?: new (url: string) => unknown }).WebSocket;
  if (!Socket) throw new Error("WebSocket is unavailable; inject a platform WebSocket factory");
  return new Socket(url) as CediaRelaySocket;
}

/**
 * Adapt the endpoint-owned E2EE relay into the host API transport used by the
 * app. The client opens the channel lazily and never replays an unknown request.
 */
export function createMobileRelayTransport(options: MobileRelayTransportOptions): MobileRelayTransport {
  const offer = validateCediaRelayPairingOffer(options.offer);
  const relayOptions: CediaRelayClientOptions = {
    offer,
    createWebSocket: options.createWebSocket ?? defaultWebSocketFactory,
    ...(options.connectionId ? { connectionId: options.connectionId } : {}),
    ...(options.requestTimeoutMs ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
    ...(options.handshakeTimeoutMs ? { handshakeTimeoutMs: options.handshakeTimeoutMs } : {}),
    ...(options.onStateChange ? { onStateChange: options.onStateChange } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
  };
  const client = new CediaRelayClient(relayOptions);
  const transport: ClientTransport = {
    request: async (method: TransportMethod | string, path: string, body?: unknown) => {
      if (client.state !== "open") await client.connect();
      return client.request({
        method,
        path,
        ...(body === undefined ? {} : { body: body as Json }),
      });
    },
  };
  return { client, transport };
}
