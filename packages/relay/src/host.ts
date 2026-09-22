/**
 * Cedia request endpoint running on the Mac side of an encrypted relay
 * channel.  Authentication remains the responsibility of the injected host
 * handler; this class forwards the token on every request and never caches an
 * authorization decision.
 */

import { EncryptedChannel } from "./encrypted-channel.ts";
import {
	fingerprintCediaRelayRequest,
	parseCediaRelayMessage,
	serializeCediaRelayMessage,
	type CediaRelayHandlerRequest,
	type CediaRelayHandlerResponse,
	type CediaRelayRequest,
	type CediaRelayResponse,
	CediaRelayProtocolError,
	DEFAULT_RELAY_MAX_PENDING_REQUESTS,
	DEFAULT_RELAY_MAX_REQUEST_IDS,
	DEFAULT_RELAY_REQUEST_TIMEOUT_MS,
} from "./protocol.ts";
import type { Json } from "../../protocol/src/index.ts";

export type CediaRelayRequestHandler = (
	request: CediaRelayHandlerRequest,
	signal?: AbortSignal,
) => CediaRelayHandlerResponse | Promise<CediaRelayHandlerResponse>;

export interface CediaRelayHostOptions {
	channel: EncryptedChannel;
	handler: CediaRelayRequestHandler;
	/** Checked on every delivery and again before releasing a response, including cached replies. */
	authorize: (token: string) => boolean;
	maxRequestIds?: number;
	/** Maximum number of handler invocations that may remain unsettled. */
	maxPendingRequests?: number;
	requestTimeoutMs?: number;
	onError?: (error: Error, phase: "protocol" | "handler" | "send" | "disposed") => void;
}

interface RequestRecord {
	fingerprint: string;
	promise: Promise<CediaRelayResponse>;
	controller: AbortController;
	completed: boolean;
	response?: CediaRelayResponse;
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function jsonError(code: string, message: string): Json {
	return { error: { code, message } };
}

function isResponse(value: unknown): value is CediaRelayResponse {
	return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "response";
}

function responseFor(request: CediaRelayRequest, status: number, body: Json): CediaRelayResponse {
	return {
		protocolVersion: request.protocolVersion,
		type: "response",
		id: request.id,
		epoch: request.epoch,
		status,
		body,
	};
}

function isOversizedSerializationError(error: unknown): boolean {
	return error instanceof CediaRelayProtocolError && /relay (?:message|frame) exceeds \d+ bytes/i.test(error.message);
}

function timeoutHandle(timer: ReturnType<typeof setTimeout>): void {
	if (typeof timer === "object" && timer !== null && "unref" in timer) {
		const unref = (timer as { unref?: unknown }).unref;
		if (typeof unref === "function") unref.call(timer);
	}
}

export class CediaRelayHost {
	readonly #channel: EncryptedChannel;
	readonly #handler: CediaRelayRequestHandler;
	readonly #authorize: (token: string) => boolean;
	readonly #maxRequestIds: number;
	readonly #maxPendingRequests: number;
	readonly #requestTimeoutMs: number;
	readonly #onError?: CediaRelayHostOptions["onError"];
	readonly #records = new Map<string, RequestRecord>();
	readonly #active = new Set<AbortController>();
	readonly #disposePromise: Promise<void>;
	#resolveDispose!: () => void;
	#epoch: number | undefined;
	#disposed = false;

	constructor(options: CediaRelayHostOptions) {
		if (!(options.channel instanceof EncryptedChannel)) throw new TypeError("channel is required");
		if (typeof options.handler !== "function") throw new TypeError("handler is required");
		if (typeof options.authorize !== "function") throw new TypeError("authorize is required");
		this.#authorize = options.authorize;
		this.#channel = options.channel;
		this.#handler = options.handler;
		this.#maxRequestIds = options.maxRequestIds ?? DEFAULT_RELAY_MAX_REQUEST_IDS;
		this.#maxPendingRequests = options.maxPendingRequests ?? DEFAULT_RELAY_MAX_PENDING_REQUESTS;
		this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_RELAY_REQUEST_TIMEOUT_MS;
		if (!Number.isSafeInteger(this.#maxRequestIds) || this.#maxRequestIds < 1) throw new RangeError("maxRequestIds must be a positive integer");
		if (!Number.isSafeInteger(this.#maxPendingRequests) || this.#maxPendingRequests < 1) throw new RangeError("maxPendingRequests must be a positive integer");
		if (!Number.isSafeInteger(this.#requestTimeoutMs) || this.#requestTimeoutMs < 1 || this.#requestTimeoutMs > 2_147_483_647) throw new RangeError("requestTimeoutMs is invalid");
		this.#disposePromise = new Promise<void>((resolve) => { this.#resolveDispose = resolve; });
	}

	get disposed(): boolean {
		return this.#disposed;
	}

	get pendingRequestCount(): number {
		return this.#active.size;
	}

	/** Deliver one decrypted frame from the server data socket. */
	receive(data: string | ArrayBuffer): void {
		if (this.#disposed) return;
		void this.#receive(data);
	}

	async #receive(data: string | ArrayBuffer): Promise<void> {
		let parsed: ReturnType<typeof parseCediaRelayMessage>;
		try {
			parsed = parseCediaRelayMessage(data);
			if (isResponse(parsed)) throw new CediaRelayProtocolError("host received a response frame");
		} catch (error) {
			this.#protocolError(asError(error));
			return;
		}
		if (this.#epoch === undefined) this.#epoch = parsed.epoch;
		if (parsed.epoch !== this.#epoch) {
			this.#protocolError(new CediaRelayProtocolError("relay request epoch changed on one connection"));
			return;
		}

		const fingerprint = fingerprintCediaRelayRequest(parsed);
		if (!this.#isAuthorized(parsed.token)) {
			await this.#sendResponse(parsed, responseFor(parsed, 401, jsonError("unauthorized", "Device revoked or unavailable")));
			return;
		}
		const previous = this.#records.get(parsed.id);
		if (previous) {
			if (previous.fingerprint !== fingerprint) {
				this.#protocolError(new CediaRelayProtocolError("relay request id was reused with a different payload"));
				return;
			}
			// The original request owns the only handler invocation. Once its
			// response exists, returning that cached response lets a caller
			// reconcile a lost ACK without executing the mutation twice.
			if (previous.response && this.#channel.isOpen()) await this.#sendResponse(parsed, previous.response);
			return;
		}

		// Request IDs are a replay-protection ledger for this channel. Never
		// evict completed IDs: once the bounded ledger is full, require the
		// peer to rotate the channel instead of allowing an old mutation ID to
		// be forgotten and replayed.
		if (this.#records.size >= this.#maxRequestIds) {
			await this.#sendResponse(parsed, responseFor(parsed, 429, jsonError("request_id_capacity", "Relay request ID capacity reached; reconnect to rotate the channel")));
			this.#closeAtCapacity();
			return;
		}
		// Keep the number of underlying handler invocations bounded even when a
		// handler ignores AbortSignal after its timeout. Timed-out invocations
		// retain their slot until the handler actually settles.
		if (this.#active.size >= this.#maxPendingRequests) {
			await this.#sendResponse(parsed, responseFor(parsed, 429, jsonError("host_capacity", "Cedia host request capacity reached")));
			return;
		}

		const controller = new AbortController();
		this.#active.add(controller);
		const promise = this.#run(parsed, controller, () => this.#active.delete(controller));
		const record: RequestRecord = { fingerprint, promise, controller, completed: false };
		this.#records.set(parsed.id, record);
		try {
			const response = this.#fitResponse(parsed, await promise);
			record.completed = true;
			record.response = response;
			if (this.#disposed || !this.#channel.isOpen()) return;
			await this.#sendResponse(parsed, response);
		} catch (error) {
			if (!this.#disposed) this.#emit(asError(error), "send");
		}
	}

	async #run(request: CediaRelayRequest, controller: AbortController, release: () => void): Promise<CediaRelayResponse> {
		const timeoutMarker = Symbol("timeout");
		const disposedMarker = Symbol("disposed");
		let timer: ReturnType<typeof setTimeout> | undefined;
		const handlerPromise: Promise<CediaRelayHandlerResponse> = Promise.resolve().then(async () => {
			if (this.#disposed) return { status: 503, body: jsonError("disposed", "Cedia host is unavailable") };
			return await this.#handler({ method: request.method, path: request.path, token: request.token, ...(request.body === undefined ? {} : { body: request.body }) }, controller.signal);
		});
		// Keep a slot occupied until an uncooperative handler actually settles.
		// The response race below may finish earlier, but this callback prevents
		// repeated timed-out mutations from creating unbounded work.
		void handlerPromise.then(release, release);
		const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
			timer = setTimeout(() => {
				controller.abort();
				resolve(timeoutMarker);
			}, this.#requestTimeoutMs);
			timeoutHandle(timer);
		});
		const disposedPromise = this.#disposePromise.then(() => disposedMarker);
		try {
			const outcome = await Promise.race([handlerPromise, timeoutPromise, disposedPromise]);
			if (outcome === timeoutMarker) return responseFor(request, 504, jsonError("timeout", "Cedia host request timed out"));
			if (outcome === disposedMarker) return responseFor(request, 503, jsonError("disposed", "Cedia host is unavailable"));
			const result = outcome as CediaRelayHandlerResponse;
			if (!result || typeof result !== "object" || !Number.isSafeInteger(result.status) || result.status < 100 || result.status > 599) {
				return responseFor(request, 500, jsonError("invalid_handler_response", "Cedia host returned an invalid response"));
			}
			if (controller.signal.aborted) return responseFor(request, 504, jsonError("timeout", "Cedia host request timed out"));
			return responseFor(request, result.status, result.body);
		} catch (error) {
			this.#emit(asError(error), "handler");
			return responseFor(request, 500, jsonError("handler_error", "Cedia host request failed"));
		} finally {
			if (timer) clearTimeout(timer);
			// Always consume a late rejection after a timeout/disposal race.
			void handlerPromise.catch(() => undefined);
		}
	}

	#isAuthorized(token: string): boolean {
		try {
			return this.#authorize(token) === true;
		} catch (error) {
			// An authorization implementation failure is fail-closed. Keep the
			// error observable without allowing it to escape receive() as an
			// unhandled rejection.
			this.#emit(asError(error), "handler");
			return false;
		}
	}

	/** Validate a response before caching it so oversized handlers get a
	 * deterministic 413 instead of leaving the peer waiting for a timeout. */
	#fitResponse(request: CediaRelayRequest, response: CediaRelayResponse): CediaRelayResponse {
		try {
			serializeCediaRelayMessage(response);
			return response;
		} catch (error) {
			const normalized = asError(error);
			this.#emit(normalized, "send");
			return responseFor(
				request,
				isOversizedSerializationError(error) ? 413 : 500,
				jsonError(
					isOversizedSerializationError(error) ? "response_too_large" : "invalid_handler_response",
					isOversizedSerializationError(error)
						? "Cedia host response exceeds the relay payload limit"
						: "Cedia host returned a response that cannot be serialized",
				),
			);
		}
	}

	/** Authorize and send a response at the last possible moment. This is
	 * deliberately reused for first responses and cached replays so revocation
	 * takes effect without waiting for a reconnect. */
	async #sendResponse(request: CediaRelayRequest, response: CediaRelayResponse): Promise<void> {
		if (this.#disposed || !this.#channel.isOpen()) return;
		const authorizedResponse = this.#isAuthorized(request.token)
			? response
			: responseFor(request, 401, jsonError("unauthorized", "Device revoked or unavailable"));
		const safeResponse = this.#fitResponse(request, authorizedResponse);
		if (this.#disposed || !this.#channel.isOpen()) return;
		try {
			await this.#channel.send(serializeCediaRelayMessage(safeResponse));
		} catch (error) {
			this.#emit(asError(error), "send");
		}
	}

	/** Abort handlers and prevent any later frame from being accepted. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#resolveDispose();
		for (const controller of this.#active) controller.abort();
		this.#active.clear();
		this.#records.clear();
	}

	close(code = 1000, reason = "Normal closure"): void {
		this.dispose();
		try {
			this.#channel.close(code, reason);
		} catch (error) {
			this.#emit(asError(error), "disposed");
		}
	}

	#closeAtCapacity(): void {
		if (this.#disposed) return;
		this.dispose();
		try {
			this.#channel.close(1013, "Relay request ID capacity reached");
		} catch (error) {
			this.#emit(asError(error), "disposed");
		}
	}

	#protocolError(error: Error): void {
		this.#emit(error, "protocol");
		if (this.#disposed) return;
		this.dispose();
		try {
			this.#channel.close(1002, "Relay protocol error");
		} catch {
			// The peer may have already closed.
		}
	}

	#emit(error: Error, phase: "protocol" | "handler" | "send" | "disposed"): void {
		try {
			this.#onError?.(error, phase);
		} catch {
			// Diagnostics must never break the transport.
		}
	}
}
