/** Browser/React-Native compatible Cedia relay client. */

import { createClientChannel, type EncryptedChannel } from "./encrypted-channel.ts";
import {
	buildRelayWebSocketUrl,
	createCediaRelayRequest,
	parseCediaRelayMessage,
	serializeCediaRelayMessage,
	validateCediaRelayPairingOffer,
	type CediaRelayHandlerResponse,
	type CediaRelayPairingOffer,
	type CediaRelayResponse,
	CediaRelayOfferError,
	CediaRelayProtocolError,
	DEFAULT_RELAY_MAX_PENDING_REQUESTS,
	DEFAULT_RELAY_REQUEST_TIMEOUT_MS,
} from "./protocol.ts";
import { createSocketTransport, subscribeSocket, type CediaRelaySocket, type CediaRelayWebSocketFactory } from "./transport.ts";
import type { Json } from "../../protocol/src/index.ts";

export type CediaRelayClientState = "idle" | "connecting" | "open" | "closed";

export class CediaRelayConnectionError extends Error {
	readonly code = "relay_connection_error";

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "CediaRelayConnectionError";
	}
}

export class CediaRelayDisconnectedError extends Error {
	readonly code = "relay_disconnected";
	readonly epoch: number;

	constructor(epoch: number, message = "Cedia relay connection closed") {
		super(message);
		this.name = "CediaRelayDisconnectedError";
		this.epoch = epoch;
	}
}

export class CediaRelayRequestTimeoutError extends Error {
	readonly code = "relay_request_timeout";
	readonly id: string;
	readonly epoch: number;
	readonly outcome = "unknown" as const;

	constructor(id: string, epoch: number, timeoutMs: number) {
		super(`Cedia relay request timed out after ${timeoutMs}ms: ${id}`);
		this.name = "CediaRelayRequestTimeoutError";
		this.id = id;
		this.epoch = epoch;
	}
}

export class CediaRelayCapacityError extends Error {
	readonly code = "relay_capacity";

	constructor(message: string) {
		super(message);
		this.name = "CediaRelayCapacityError";
	}
}

export interface CediaRelayClientOptions {
	offer: CediaRelayPairingOffer;
	createWebSocket: CediaRelayWebSocketFactory;
	connectionId?: string;
	requestTimeoutMs?: number;
	maxPendingRequests?: number;
	handshakeTimeoutMs?: number;
	onStateChange?: (state: CediaRelayClientState) => void;
	onError?: (error: Error) => void;
}

export interface CediaRelayRequestInput {
	method: string;
	path: string;
	body?: Json;
	/** Optional caller-owned request ID. It is never rewritten or retried. */
	requestId?: string;
}

export interface CediaRelayClientResponse extends CediaRelayHandlerResponse {}

interface PendingRequest {
	epoch: number;
	timer: ReturnType<typeof setTimeout>;
	resolve: (response: CediaRelayClientResponse) => void;
	reject: (error: Error) => void;
}

let fallbackIdCounter = 0;

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function timeoutHandle(timer: ReturnType<typeof setTimeout>): void {
	if (typeof timer === "object" && timer !== null && "unref" in timer) {
		const unref = (timer as { unref?: unknown }).unref;
		if (typeof unref === "function") unref.call(timer);
	}
}

function createId(prefix: string): string {
	const cryptoObject = globalThis.crypto;
	if (cryptoObject?.randomUUID) return `${prefix}_${cryptoObject.randomUUID()}`;
	if (cryptoObject?.getRandomValues) {
		const bytes = new Uint8Array(16);
		cryptoObject.getRandomValues(bytes);
		return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
	}
	fallbackIdCounter += 1;
	return `${prefix}_${Date.now().toString(36)}_${fallbackIdCounter.toString(36)}`;
}

function eventError(value: unknown): Error {
	if (value instanceof Error) return value;
	if (typeof value === "object" && value !== null && "error" in value) return asError((value as { error: unknown }).error);
	return asError(value);
}

export class CediaRelayClient {
	readonly #factory: CediaRelayWebSocketFactory;
	#offer: CediaRelayPairingOffer;
	/**
	 * An optional caller-selected route.  Paseo v2 assigns the client route
	 * when this is omitted, so the normal client path must not manufacture and
	 * send a connectionId of its own.  Keeping the value only when explicitly
	 * supplied also preserves deterministic routing for tests and reconnecting
	 * peers that need it.
	 */
	readonly #connectionId?: string;
	readonly #requestTimeoutMs: number;
	readonly #maxPendingRequests: number;
	readonly #handshakeTimeoutMs: number;
	readonly #onStateChange?: CediaRelayClientOptions["onStateChange"];
	readonly #onError?: CediaRelayClientOptions["onError"];
	readonly #pending = new Map<string, PendingRequest>();
	#state: CediaRelayClientState = "idle";
	#socket: CediaRelaySocket | null = null;
	#channel: EncryptedChannel | null = null;
	#epoch = 0;
	#connectPromise: Promise<void> | null = null;
	/** Cancels the in-flight handshake before its socket is detached. */
	#cancelConnect: (() => void) | null = null;
	#closing = false;

	constructor(options: CediaRelayClientOptions) {
		this.#offer = validateCediaRelayPairingOffer(options.offer);
		if (typeof options.createWebSocket !== "function") throw new TypeError("createWebSocket is required");
		this.#factory = options.createWebSocket;
		const requestedConnectionId = options.connectionId?.trim();
		this.#connectionId = requestedConnectionId || undefined;
		if (this.#connectionId && this.#connectionId.length > 256) throw new RangeError("connectionId is too long");
		this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_RELAY_REQUEST_TIMEOUT_MS;
		this.#maxPendingRequests = options.maxPendingRequests ?? DEFAULT_RELAY_MAX_PENDING_REQUESTS;
		this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? this.#requestTimeoutMs;
		if (!Number.isSafeInteger(this.#requestTimeoutMs) || this.#requestTimeoutMs < 1 || this.#requestTimeoutMs > 2_147_483_647) throw new RangeError("requestTimeoutMs is invalid");
		if (!Number.isSafeInteger(this.#maxPendingRequests) || this.#maxPendingRequests < 1) throw new RangeError("maxPendingRequests must be a positive integer");
		if (!Number.isSafeInteger(this.#handshakeTimeoutMs) || this.#handshakeTimeoutMs < 1 || this.#handshakeTimeoutMs > 2_147_483_647) throw new RangeError("handshakeTimeoutMs is invalid");
		this.#onStateChange = options.onStateChange;
		this.#onError = options.onError;
	}

	get offer(): CediaRelayPairingOffer {
		return { ...this.#offer };
	}

	get connectionId(): string | undefined {
		return this.#connectionId;
	}

	get state(): CediaRelayClientState {
		return this.#state;
	}

	get connectionEpoch(): number {
		return this.#epoch;
	}

	get pendingRequestCount(): number {
		return this.#pending.size;
	}

	/** Open a fresh data socket. Pending requests from an older epoch are never replayed. */
	async connect(): Promise<void> {
		if (this.#state === "open") return;
		if (this.#connectPromise) return this.#connectPromise;
		if (this.#state === "closed") this.#closing = false;
		this.#state = "connecting";
		this.#emitState();
		const epoch = ++this.#epoch;
		let socket: CediaRelaySocket;
		try {
			socket = this.#factory(buildRelayWebSocketUrl({
				endpoint: this.#offer.relayEndpoint,
				useTls: this.#offer.relayUseTls,
				serverId: this.#offer.serverId,
				role: "client",
				...(this.#connectionId === undefined ? {} : { connectionId: this.#connectionId }),
			}));
		} catch (error) {
			this.#state = "idle";
			this.#emitState();
			throw new CediaRelayConnectionError("failed to create relay WebSocket", { cause: error });
		}
		this.#socket = socket;
		const transport = createSocketTransport(socket);
		let channel: EncryptedChannel | null = null;
		let handshakeStarted = false;
		let settled = false;
		let openNotified = false;
		let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
		let resolveReady!: () => void;
		let rejectReady!: (error: Error) => void;
		const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
		this.#connectPromise = ready;
		const fail = (error: unknown, closeSocket = true, emitError = true) => {
			if (this.#socket !== socket || this.#epoch !== epoch) return;
			const normalized = asError(error);
			if (!settled) {
				settled = true;
				if (handshakeTimer) clearTimeout(handshakeTimer);
				rejectReady(normalized);
			}
			this.#channel = null;
			if (this.#state !== "closed") {
				this.#state = "idle";
				this.#emitState();
			}
			this.#rejectPending(epoch, new CediaRelayDisconnectedError(epoch, normalized.message));
			if (emitError) this.#emitError(normalized);
			if (closeSocket) {
				try {
					if (normalized instanceof CediaRelayProtocolError && socket.terminate) socket.terminate();
					else socket.close(4002, "Cedia relay connection failed");
				} catch {
					// The socket may already be closed.
				}
			}
			if (this.#socket === socket) this.#socket = null;
		};
		const cancel = () => {
			if (settled) return;
			fail(new CediaRelayDisconnectedError(epoch, "Cedia relay connection cancelled"), false, false);
		};
		this.#cancelConnect = cancel;
		const markChannelOpen = () => {
			if (this.#socket !== socket || this.#epoch !== epoch || settled) return;
			if (!channel) {
				openNotified = true;
				return;
			}
			if (handshakeTimer) clearTimeout(handshakeTimer);
			this.#channel = channel;
			settled = true;
			this.#state = "open";
			this.#emitState();
			resolveReady();
		};
		const onOpen = () => {
			if (this.#socket !== socket || this.#closing || handshakeStarted) return;
			handshakeStarted = true;
			handshakeTimer = setTimeout(() => fail(new CediaRelayConnectionError(`relay E2EE handshake timed out after ${this.#handshakeTimeoutMs}ms`)), this.#handshakeTimeoutMs);
			timeoutHandle(handshakeTimer);
			void createClientChannel(transport, this.#offer.daemonPublicKeyB64, {
				onopen: markChannelOpen,
				onmessage: (data) => this.#handleMessage(epoch, data),
				onclose: (code, reason) => fail(new CediaRelayDisconnectedError(epoch, `relay closed (${code}): ${reason}`), false),
				onerror: (error) => this.#emitError(error),
			}).then((created) => {
				channel = created;
				if (this.#socket === socket && this.#channel === null) this.#channel = created;
				if (openNotified) markChannelOpen();
			}).catch((error) => fail(new CediaRelayConnectionError("relay E2EE handshake failed", { cause: error })));
		};
		const onClose = (code?: unknown, reason?: unknown) => {
			const closeCode = typeof code === "number" ? code : 1006;
			const closeReason = typeof reason === "string" ? reason : "";
			fail(new CediaRelayDisconnectedError(epoch, `relay closed (${closeCode}): ${closeReason}`), false);
		};
		const onError = (error: unknown) => {
			this.#emitError(eventError(error));
			if (!handshakeStarted) fail(new CediaRelayConnectionError("relay WebSocket error", { cause: error }));
		};
		subscribeSocket(socket, "open", onOpen);
		subscribeSocket(socket, "close", onClose);
		subscribeSocket(socket, "error", onError);
		// A browser can be in OPEN state before listeners are installed when a
		// custom test/factory socket is used.  Normal WebSockets emit `open` once.
		if (socket.readyState === 1) onOpen();
		try {
			await ready;
		} finally {
			if (this.#connectPromise === ready) this.#connectPromise = null;
			if (this.#cancelConnect === cancel) this.#cancelConnect = null;
		}
	}

	/** Explicitly reconnect. No in-flight request is carried to the new epoch. */
	async reconnect(): Promise<void> {
		this.close(1000, "Reconnect requested");
		return this.connect();
	}

	close(code = 1000, reason = "Normal closure"): void {
		this.#closing = true;
		// Settle a pending handshake while its socket still matches the active
		// attempt.  Clearing #socket first makes the attempt's identity guard
		// ignore the close event and leaves connect() awaiting forever.
		const socket = this.#socket;
		this.#cancelConnect?.();
		this.#connectPromise = null;
		this.#cancelConnect = null;
		const epoch = this.#epoch;
		this.#state = "closed";
		this.#emitState();
		this.#rejectPending(epoch, new CediaRelayDisconnectedError(epoch, reason));
		this.#channel = null;
		this.#socket = null;
		try {
			if (socket) socket.close(code, reason);
		} catch (error) {
			this.#emitError(asError(error));
		}
	}

	/** Update relay coordinates while retaining the pinned daemon public key. */
	updateOffer(value: unknown): void {
		const next = validateCediaRelayPairingOffer(value);
		if (next.serverId !== this.#offer.serverId || next.daemonPublicKeyB64 !== this.#offer.daemonPublicKeyB64) {
			throw new CediaRelayOfferError("relay offer changed the pinned server identity");
		}
		this.#offer = next;
	}

	request(input: CediaRelayRequestInput): Promise<CediaRelayClientResponse> {
		if (this.#state !== "open" || !this.#channel) throw new CediaRelayConnectionError("relay channel is not open");
		if (this.#pending.size >= this.#maxPendingRequests) throw new CediaRelayCapacityError("relay pending request limit reached");
		const id = input.requestId?.trim() || createId("req");
		if (this.#pending.has(id)) throw new CediaRelayCapacityError(`relay request id is already pending: ${id}`);
		const epoch = this.#epoch;
		const request = createCediaRelayRequest({ id, epoch, method: input.method, path: input.path, token: this.#offer.deviceToken, ...(input.body === undefined ? {} : { body: input.body }) });
		const serialized = serializeCediaRelayMessage(request);
		return new Promise<CediaRelayClientResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				const pending = this.#pending.get(id);
				if (!pending || pending.epoch !== epoch) return;
				this.#pending.delete(id);
				pending.reject(new CediaRelayRequestTimeoutError(id, epoch, this.#requestTimeoutMs));
			}, this.#requestTimeoutMs);
			timeoutHandle(timer);
			this.#pending.set(id, { epoch, timer, resolve, reject });
			void this.#channel!.send(serialized).catch((error) => {
				const pending = this.#pending.get(id);
				if (!pending) return;
				this.#pending.delete(id);
				clearTimeout(pending.timer);
				pending.reject(new CediaRelayDisconnectedError(epoch, asError(error).message));
			});
		});
	}

	/** Poll the host's durable event route. It is intentionally an ordinary GET request. */
	pollEvents(path: string, cursor?: number): Promise<CediaRelayClientResponse> {
		const separator = path.includes("?") ? "&" : "?";
		return this.request({ method: "GET", path: cursor === undefined ? path : `${path}${separator}cursor=${encodeURIComponent(String(cursor))}` });
	}

	async #handleMessage(epoch: number, data: string | ArrayBuffer): Promise<void> {
		if (this.#socket === null || this.#epoch !== epoch) return;
		let message: ReturnType<typeof parseCediaRelayMessage>;
		try {
			message = parseCediaRelayMessage(data);
			if (message.type !== "response") throw new CediaRelayProtocolError("client received a request frame");
		} catch (error) {
			this.#protocolError(epoch, asError(error));
			return;
		}
		if (message.epoch !== epoch) {
			this.#protocolError(epoch, new CediaRelayProtocolError("relay response belongs to a different connection epoch"));
			return;
		}
		const pending = this.#pending.get(message.id);
		if (!pending || pending.epoch !== epoch) {
			this.#protocolError(epoch, new CediaRelayProtocolError(`unknown relay response id: ${message.id}`));
			return;
		}
		this.#pending.delete(message.id);
		clearTimeout(pending.timer);
		pending.resolve({ status: message.status, body: message.body });
	}

	#protocolError(epoch: number, error: Error): void {
		this.#emitError(error);
		if (this.#epoch !== epoch) return;
		const socket = this.#socket;
		// A malformed handshake frame can arrive before connect() has settled.
		// Reject that attempt before detaching the socket, otherwise the attempt
		// identity guard would ignore the subsequent close event.
		this.#cancelConnect?.();
		this.#channel = null;
		this.#socket = null;
		this.#state = "idle";
		this.#emitState();
		this.#rejectPending(epoch, new CediaRelayDisconnectedError(epoch, error.message));
		try {
			if (socket?.terminate) socket.terminate();
			else socket?.close(1002, "Relay protocol error");
		} catch {
			// ignore already-closed sockets
		}
	}

	#rejectPending(epoch: number, error: Error): void {
		for (const [id, pending] of this.#pending) {
			if (pending.epoch !== epoch) continue;
			this.#pending.delete(id);
			clearTimeout(pending.timer);
			pending.reject(error);
		}
	}

	#emitState(): void {
		try { this.#onStateChange?.(this.#state); } catch { /* callbacks are observational */ }
	}

	#emitError(error: Error): void {
		try { this.#onError?.(error); } catch { /* callbacks are observational */ }
	}
}
