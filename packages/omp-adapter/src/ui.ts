/**
 * Cedia's host-side broker for OMP extension UI frames.
 *
 * The RPC client owns the OMP process and transport.  This module owns only
 * the small UI side channel: it validates `extension_ui_request` frames,
 * presents immutable request snapshots to a host, and turns an explicit host
 * answer into one `extension_ui_response` frame.  It deliberately does not
 * open URLs, render a dialog, execute tools, or create another OMP harness.
 *
 * The wire shapes themselves are declared once in `@cedia/protocol` (see
 * `packages/protocol/src/ui.ts`), which is also what the Mac and phone clients
 * read, so a broker and a client cannot disagree about which methods exist.
 * A host still detects malformed/future frames without bringing down the
 * session: `#parseRequest` answers one explicitly.
 */

import type { CediaUiPresentationRequest, CediaUiRequest, SelectUiRequest, UiInteractiveEvent, UiPresentationEvent } from "../../protocol/src/ui.ts";
import type { RpcExtensionUIResponse } from "./types.ts";

// The wire shapes live in `@cedia/protocol`.  These four names are how the
// adapter's own API has always spelled them; each is the protocol declaration.
export type ExtensionUiInteractiveRequest = CediaUiRequest;

export type ExtensionUiPresentation = CediaUiPresentationRequest;

/** One live interactive request, as this broker emits and records it. */
export type ExtensionUiInteractiveEvent = UiInteractiveEvent;

export type ExtensionUiPresentationEvent = UiPresentationEvent;

/** A serialisable handle valid only for one broker incarnation. */
export type ExtensionUiToken = string;

/** Node's largest portable timer delay; larger wire values overflow to ~1ms. */
export const MAX_EXTENSION_UI_TIMEOUT_MS = 2_147_483_647;

/** Default retained diagnostic bound for a long-lived broker. */
export const MAX_EXTENSION_UI_DIAGNOSTICS = 100;

/** Default number of distinct interactive upstream ids remembered per broker. */
export const MAX_EXTENSION_UI_REQUEST_IDS = 10_000;

/** Emitted after OMP cancels an outstanding interactive request by target id. */
export interface ExtensionUiServerCancelEvent {
	readonly kind: "server-cancel";
	readonly requestId: string;
	readonly targetId: string;
	readonly token: ExtensionUiToken;
	readonly request: ExtensionUiInteractiveRequest;
}

/** Emitted when the host-side timeout settles a request. */
export interface ExtensionUiTimeoutEvent {
	readonly kind: "timeout";
	readonly token: ExtensionUiToken;
	readonly request: ExtensionUiInteractiveRequest;
}

export type ExtensionUiDiagnosticCode =
	| "invalid-frame"
	| "unknown-method"
	| "duplicate-request"
	| "cancel-target-not-found"
	| "stale-response"
	| "invalid-response"
	| "send-failed"
	| "disposed"
	| "listener-failed"
	| "capacity";

export interface ExtensionUiDiagnostic {
	readonly code: ExtensionUiDiagnosticCode;
	readonly message: string;
	readonly frame?: Readonly<Record<string, unknown>>;
	readonly token?: ExtensionUiToken;
	readonly requestId?: string;
}

export interface ExtensionUiDiagnosticEvent {
	readonly kind: "diagnostic";
	readonly diagnostic: ExtensionUiDiagnostic;
}

export type ExtensionUiEvent =
	| ExtensionUiInteractiveEvent
	| ExtensionUiPresentationEvent
	| ExtensionUiServerCancelEvent
	| ExtensionUiTimeoutEvent
	| ExtensionUiDiagnosticEvent;

export type ExtensionUiEventListener = (event: ExtensionUiEvent) => void | Promise<void>;

export type ExtensionUiAnswer = string | boolean | Readonly<{ cancelled: true; timedOut?: boolean }>;

export interface ExtensionUiBrokerOptions {
	/** Writes one already validated side-channel response to OMP. */
	send: (frame: RpcExtensionUIResponse) => void | Promise<void>;
	/** Optional first listener; more listeners can be added with `onEvent`. */
	onEvent?: ExtensionUiEventListener;
	/** Applied when OMP omits `timeout`; omitted means no local deadline. */
	defaultTimeoutMs?: number;
	/** Lower bound is one; values above the exported bound are rejected. */
	maxDiagnostics?: number;
	/** Lower bound is one; values above the exported bound are rejected. */
	maxSeenRequestIds?: number;
}

export type ExtensionUiIngestResult =
	| Readonly<{ accepted: true; kind: "interactive"; token: ExtensionUiToken; request: ExtensionUiInteractiveRequest }>
	| Readonly<{ accepted: true; kind: "presentation"; request: ExtensionUiPresentation }>
	| Readonly<{ accepted: true; kind: "server-cancel"; token: ExtensionUiToken }>
	| Readonly<{ accepted: false; kind: "ignored" }>
	| Readonly<{ accepted: false; kind: "diagnostic"; diagnostic: ExtensionUiDiagnostic }>;

interface PendingUiRequest {
	token: ExtensionUiToken;
	request: ExtensionUiInteractiveRequest;
	timer?: ReturnType<typeof setTimeout>;
	deadline?: number;
}

let brokerIncarnationSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function isTimeout(value: unknown): value is number | undefined {
	return (
		value === undefined ||
		(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_EXTENSION_UI_TIMEOUT_MS)
	);
}

function isNotifyType(value: unknown): value is "info" | "warning" | "error" | undefined {
	return value === undefined || value === "info" || value === "warning" || value === "error";
}

function isWidgetPlacement(value: unknown): value is "aboveEditor" | "belowEditor" | undefined {
	return value === undefined || value === "aboveEditor" || value === "belowEditor";
}

/** Clone JSON-like input and freeze every object/array in the returned tree. */
function snapshot<T>(value: T): T {
	const seen = new WeakMap<object, unknown>();

	const clone = (input: unknown): unknown => {
		if (typeof input !== "object" || input === null) return input;
		const existing = seen.get(input);
		if (existing !== undefined) return existing;

		if (Array.isArray(input)) {
			const result: unknown[] = [];
			seen.set(input, result);
			for (const item of input) result.push(clone(item));
			return Object.freeze(result);
		}

		const result: Record<string, unknown> = {};
		seen.set(input, result);
		for (const key of Object.keys(input)) {
			Object.defineProperty(result, key, {
				configurable: true,
				enumerable: true,
				value: clone((input as Record<string, unknown>)[key]),
				writable: true,
			});
		}
		return Object.freeze(result);
	};

	return clone(value) as T;
}

function makeIncarnation(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (uuid) return uuid;
	brokerIncarnationSequence += 1;
	return `${Date.now().toString(36)}-${brokerIncarnationSequence.toString(36)}`;
}

function isCancelledAnswer(value: unknown): value is Readonly<{ cancelled: true; timedOut?: boolean }> {
	return (
		isRecord(value) &&
		value.cancelled === true &&
		(value.timedOut === undefined || typeof value.timedOut === "boolean") &&
		Object.keys(value).every(key => key === "cancelled" || key === "timedOut")
	);
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

/** Error returned when a response cannot be accepted by this broker. */
export class ExtensionUiBrokerError extends Error {
	readonly name = "ExtensionUiBrokerError";
	readonly code: ExtensionUiDiagnosticCode;
	readonly token?: ExtensionUiToken;
	readonly requestId?: string;

	constructor(code: ExtensionUiDiagnosticCode, message: string, token?: ExtensionUiToken, requestId?: string) {
		super(message);
		this.code = code;
		this.token = token;
		this.requestId = requestId;
	}
}

/**
 * Validates and routes OMP extension UI requests for one broker incarnation.
 *
 * `ingest` is intentionally synchronous: the raw frame came from the client's
 * already ordered frame listener.  Sending an answer is asynchronous and
 * returned by `respond`/`cancel`; once a response is claimed, the pending entry
 * is removed before the injected writer runs, so a failed write is never
 * replayed automatically and a duplicate answer cannot be accepted.
 */
export class ExtensionUiBroker {
	readonly #send: ExtensionUiBrokerOptions["send"];
	readonly #incarnation = makeIncarnation();
	readonly #defaultTimeoutMs: number | undefined;
	readonly #maxDiagnostics: number;
	readonly #maxSeenRequestIds: number;
	readonly #listeners = new Set<ExtensionUiEventListener>();
	readonly #pending = new Map<ExtensionUiToken, PendingUiRequest>();
	readonly #pendingByUpstreamId = new Map<string, ExtensionUiToken>();
	readonly #seenRequestIds = new Set<string>();
	readonly #diagnostics: ExtensionUiDiagnostic[] = [];
	#tokenSequence = 0;
	#disposed = false;
	#emittingDiagnostic = false;

	constructor(options: ExtensionUiBrokerOptions) {
		if (!options || typeof options.send !== "function") {
			throw new TypeError("ExtensionUiBroker requires a send callback");
		}
		if (options.defaultTimeoutMs !== undefined && !isTimeout(options.defaultTimeoutMs)) {
			throw new TypeError(`defaultTimeoutMs must be an integer from 0 to ${MAX_EXTENSION_UI_TIMEOUT_MS}`);
		}
		if (options.maxDiagnostics !== undefined && (!Number.isSafeInteger(options.maxDiagnostics) || options.maxDiagnostics < 1 || options.maxDiagnostics > MAX_EXTENSION_UI_DIAGNOSTICS)) {
			throw new TypeError(`maxDiagnostics must be an integer from 1 to ${MAX_EXTENSION_UI_DIAGNOSTICS}`);
		}
		if (options.maxSeenRequestIds !== undefined && (!Number.isSafeInteger(options.maxSeenRequestIds) || options.maxSeenRequestIds < 1 || options.maxSeenRequestIds > MAX_EXTENSION_UI_REQUEST_IDS)) {
			throw new TypeError(`maxSeenRequestIds must be an integer from 1 to ${MAX_EXTENSION_UI_REQUEST_IDS}`);
		}
		this.#send = options.send;
		this.#defaultTimeoutMs = options.defaultTimeoutMs;
		this.#maxDiagnostics = options.maxDiagnostics ?? MAX_EXTENSION_UI_DIAGNOSTICS;
		this.#maxSeenRequestIds = options.maxSeenRequestIds ?? MAX_EXTENSION_UI_REQUEST_IDS;
		if (options.onEvent) this.#listeners.add(options.onEvent);
	}

	/** Number of interactive requests still awaiting an explicit answer. */
	get pendingCount(): number {
		return this.#pending.size;
	}

	/** Whether this broker has been disposed and can no longer accept frames. */
	get disposed(): boolean {
		return this.#disposed;
	}

	/** Add an event listener and return an idempotent unsubscribe function. */
	onEvent(listener: ExtensionUiEventListener): () => void {
		if (typeof listener !== "function") throw new TypeError("UI event listener must be a function");
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Return opaque handles for currently pending requests. */
	pendingTokens(): readonly ExtensionUiToken[] {
		return Object.freeze([...this.#pending.keys()]);
	}

	/** Current immutable interactions for reconnect; stale replay is not actionable. */
	pendingRequests(): readonly ExtensionUiInteractiveEvent[] {
		return Object.freeze([...this.#pending.values()].filter(pending => pending.deadline === undefined || performance.now() < pending.deadline)
			.map(({ token, request }) => snapshot({ kind: "interactive" as const, token, request })));
	}

	/** Return immutable diagnostic snapshots retained by this broker. */
	getDiagnostics(): readonly ExtensionUiDiagnostic[] {
		return Object.freeze(this.#diagnostics.map(diagnostic => snapshot(diagnostic)));
	}

	/**
	 * Ingest one decoded raw OMP frame.  Non-UI frames are ignored so a shared
	 * client listener can pass through transcript/response frames safely.
	 */
	ingest(frame: unknown): ExtensionUiIngestResult {
		if (!isRecord(frame) || frame.type !== "extension_ui_request") {
			return { accepted: false, kind: "ignored" };
		}
		if (this.#disposed) {
			const diagnostic = this.#recordDiagnostic({
				code: "disposed",
				message: "Cannot ingest an extension UI request after broker disposal",
				frame,
			});
			return { accepted: false, kind: "diagnostic", diagnostic };
		}

		const parsed = this.#parseRequest(frame);
		if ("ok" in parsed) {
			const diagnostic = this.#recordDiagnostic(parsed.diagnostic);
			return { accepted: false, kind: "diagnostic", diagnostic };
		}

		if (parsed.kind === "presentation") {
			const request = snapshot(parsed.request);
			const event = snapshot({ kind: "presentation", request }) as ExtensionUiPresentationEvent;
			this.#emit(event);
			return { accepted: true, kind: "presentation", request };
		}

		if (parsed.kind === "cancel") return this.#ingestServerCancel(parsed);

		const request = snapshot(parsed.request);
		if (this.#seenRequestIds.has(request.id)) {
			const diagnostic = this.#recordDiagnostic({
				code: "duplicate-request",
				message: `Extension UI request id was already seen in this broker incarnation: ${request.id}`,
				frame,
				requestId: request.id,
			});
			return { accepted: false, kind: "diagnostic", diagnostic };
		}
		if (this.#seenRequestIds.size >= this.#maxSeenRequestIds) {
			const diagnostic = this.#recordDiagnostic({
				code: "capacity",
				message: `Extension UI request id capacity (${this.#maxSeenRequestIds}) reached; refusing new id ${request.id}`,
				frame,
				requestId: request.id,
			});
			return { accepted: false, kind: "diagnostic", diagnostic };
		}

		const token = `${this.#incarnation}.${(++this.#tokenSequence).toString(36)}`;
		const pending: PendingUiRequest = { token, request };
		this.#seenRequestIds.add(request.id);
		this.#pending.set(token, pending);
		this.#pendingByUpstreamId.set(request.id, token);
		const wireTimeout = "timeout" in request ? request.timeout : undefined;
		const timeout = wireTimeout ?? this.#defaultTimeoutMs;
		if (timeout !== undefined) {
			pending.deadline = performance.now() + timeout;
			pending.timer = setTimeout(() => this.#expire(token), timeout);
		}

		const event = snapshot({ kind: "interactive", token, request }) as ExtensionUiInteractiveEvent;
		this.#emit(event);
		return { accepted: true, kind: "interactive", token, request };
	}

	/**
	 * Send one explicit answer.  Validation happens before claiming the pending
	 * request, so an invalid answer can be corrected while a valid answer is
	 * still being written.  A valid answer claims the request immediately.
	 */
	respond(token: ExtensionUiToken, answer: ExtensionUiAnswer): Promise<void> {
		const pending = this.#pending.get(token);
		if (!pending) return this.#rejectStale(token);
		if (pending.deadline !== undefined && performance.now() >= pending.deadline) {
			this.#expire(token);
			return this.#rejectStale(token);
		}
		if (!this.#isValidAnswer(pending.request, answer)) {
			const error = new ExtensionUiBrokerError(
				"invalid-response",
				`Response is not valid for extension UI method ${pending.request.method}`,
				token,
				pending.request.id,
			);
			this.#recordDiagnostic({
				code: error.code,
				message: error.message,
				token,
				requestId: pending.request.id,
			});
			return Promise.reject(error);
		}

		this.#takePending(token);
		const frame: RpcExtensionUIResponse = isCancelledAnswer(answer)
			? { type: "extension_ui_response", id: pending.request.id, cancelled: true, ...(answer.timedOut ? { timedOut: true } : {}) }
			: typeof answer === "string"
				? { type: "extension_ui_response", id: pending.request.id, value: answer }
				: { type: "extension_ui_response", id: pending.request.id, confirmed: answer };
		return this.#sendOnce(frame, token, pending.request.id);
	}

	/** Explicitly cancel an interactive request; this never opens or confirms UI. */
	cancel(token: ExtensionUiToken, options: Readonly<{ timedOut?: boolean }> = {}): Promise<void> {
		if (options.timedOut !== undefined && typeof options.timedOut !== "boolean") {
			return Promise.reject(new ExtensionUiBrokerError("invalid-response", "timedOut must be boolean", token));
		}
		return this.respond(token, { cancelled: true, ...(options.timedOut ? { timedOut: true } : {}) });
	}

	/** Invalidate every pending request; no cancellation frames are replayed. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const pending of this.#pending.values()) {
			if (pending.timer !== undefined) clearTimeout(pending.timer);
		}
		this.#pending.clear();
		this.#pendingByUpstreamId.clear();
		this.#listeners.clear();
	}

	#parseRequest(frame: Record<string, unknown>):
		| { kind: "interactive"; request: ExtensionUiInteractiveRequest }
		| { kind: "presentation"; request: ExtensionUiPresentation }
		| { kind: "cancel"; id: string; targetId: string }
		| { ok: false; diagnostic: Omit<ExtensionUiDiagnostic, "frame"> & { frame?: Readonly<Record<string, unknown>> } } {
		const id = frame.id;
		const method = frame.method;
		if (typeof id !== "string" || id.length === 0) {
			return { ok: false, diagnostic: { code: "invalid-frame", message: "extension_ui_request requires a non-empty string id", frame } };
		}
		if (typeof method !== "string") {
			return { ok: false, diagnostic: { code: "invalid-frame", message: "extension_ui_request requires a string method", frame, requestId: id } };
		}

		if (method === "cancel") {
			if (typeof frame.targetId !== "string" || frame.targetId.length === 0) {
				return { ok: false, diagnostic: { code: "invalid-frame", message: "cancel requires a non-empty string targetId", frame, requestId: id } };
			}
			return { kind: "cancel", id, targetId: frame.targetId };
		}

		if (method === "select") {
			if (typeof frame.title !== "string" || !Array.isArray(frame.options) || !frame.options.every(option => typeof option === "string")) {
				return this.#invalidFrame("select requires string title and string[] options", frame, id);
			}
			if (!isTimeout(frame.timeout)) return this.#invalidFrame("select timeout must be a finite non-negative number", frame, id);
			if (frame.optionDetails !== undefined) {
				if (
					!Array.isArray(frame.optionDetails) ||
					!frame.optionDetails.every(detail => isRecord(detail) && isOptionalString(detail.description))
				) {
					return this.#invalidFrame("select optionDetails must be an array of objects with optional descriptions", frame, id);
				}
			}
			const request: SelectUiRequest = {
				id,
				method,
				title: frame.title,
				options: frame.options,
				...(frame.optionDetails === undefined ? {} : { optionDetails: frame.optionDetails }),
				...(frame.timeout === undefined ? {} : { timeout: frame.timeout }),
			};
			return { kind: "interactive", request };
		}

		if (method === "confirm") {
			if (typeof frame.title !== "string" || typeof frame.message !== "string") {
				return this.#invalidFrame("confirm requires string title and message", frame, id);
			}
			if (!isTimeout(frame.timeout)) return this.#invalidFrame("confirm timeout must be a finite non-negative number", frame, id);
			return {
				kind: "interactive",
				request: { id, method, title: frame.title, message: frame.message, ...(frame.timeout === undefined ? {} : { timeout: frame.timeout }) },
			};
		}

		if (method === "input") {
			if (typeof frame.title !== "string" || !isOptionalString(frame.placeholder)) {
				return this.#invalidFrame("input requires string title and optional string placeholder", frame, id);
			}
			if (!isTimeout(frame.timeout)) return this.#invalidFrame("input timeout must be a finite non-negative number", frame, id);
			return {
				kind: "interactive",
				request: {
					id,
					method,
					title: frame.title,
					...(frame.placeholder === undefined ? {} : { placeholder: frame.placeholder }),
					...(frame.timeout === undefined ? {} : { timeout: frame.timeout }),
				},
			};
		}

		if (method === "editor") {
			if (typeof frame.title !== "string" || !isOptionalString(frame.prefill) || (frame.promptStyle !== undefined && typeof frame.promptStyle !== "boolean")) {
				return this.#invalidFrame("editor requires string title and optional prefill/promptStyle", frame, id);
			}
			return {
				kind: "interactive",
				request: {
					id,
					method,
					title: frame.title,
					...(frame.prefill === undefined ? {} : { prefill: frame.prefill }),
					...(frame.promptStyle === undefined ? {} : { promptStyle: frame.promptStyle }),
				},
			};
		}

		if (method === "notify") {
			if (typeof frame.message !== "string" || !isNotifyType(frame.notifyType)) return this.#invalidFrame("notify requires string message and valid notifyType", frame, id);
			return { kind: "presentation", request: { id, method, message: frame.message, ...(frame.notifyType === undefined ? {} : { notifyType: frame.notifyType }) } };
		}

		if (method === "setStatus") {
			if (typeof frame.statusKey !== "string" || !isOptionalString(frame.statusText)) return this.#invalidFrame("setStatus requires string statusKey and optional string statusText", frame, id);
			return { kind: "presentation", request: { id, method, statusKey: frame.statusKey, ...(frame.statusText === undefined ? {} : { statusText: frame.statusText }) } };
		}

		if (method === "setWidget") {
			if (typeof frame.widgetKey !== "string" || (frame.widgetLines !== undefined && (!Array.isArray(frame.widgetLines) || !frame.widgetLines.every(line => typeof line === "string"))) || !isWidgetPlacement(frame.widgetPlacement)) {
				return this.#invalidFrame("setWidget requires string widgetKey and optional string[] widgetLines/widgetPlacement", frame, id);
			}
			return {
				kind: "presentation",
				request: {
					id,
					method,
					widgetKey: frame.widgetKey,
					...(frame.widgetLines === undefined ? {} : { widgetLines: frame.widgetLines }),
					...(frame.widgetPlacement === undefined ? {} : { widgetPlacement: frame.widgetPlacement }),
				},
			};
		}

		if (method === "setTitle") {
			if (typeof frame.title !== "string") return this.#invalidFrame("setTitle requires string title", frame, id);
			return { kind: "presentation", request: { id, method, title: frame.title } };
		}

		if (method === "set_editor_text") {
			if (typeof frame.text !== "string") return this.#invalidFrame("set_editor_text requires string text", frame, id);
			return { kind: "presentation", request: { id, method, text: frame.text } };
		}

		if (method === "open_url") {
			if (typeof frame.url !== "string" || !isOptionalString(frame.launchUrl) || !isOptionalString(frame.instructions)) {
				return this.#invalidFrame("open_url requires string url and optional launchUrl/instructions", frame, id);
			}
			return {
				kind: "presentation",
				request: {
					id,
					method,
					url: frame.url,
					...(frame.launchUrl === undefined ? {} : { launchUrl: frame.launchUrl }),
					...(frame.instructions === undefined ? {} : { instructions: frame.instructions }),
				},
			};
		}

		return { ok: false, diagnostic: { code: "unknown-method", message: `Unknown extension UI method: ${method}`, frame, requestId: id } };
	}

	#invalidFrame(message: string, frame: Record<string, unknown>, requestId: string): { ok: false; diagnostic: Omit<ExtensionUiDiagnostic, "frame"> & { frame?: Readonly<Record<string, unknown>> } } {
		return { ok: false, diagnostic: { code: "invalid-frame", message, frame, requestId } };
	}

	#ingestServerCancel(parsed: { kind: "cancel"; id: string; targetId: string }): ExtensionUiIngestResult {
		const token = this.#pendingByUpstreamId.get(parsed.targetId);
		if (!token) {
			const diagnostic = this.#recordDiagnostic({
				code: "cancel-target-not-found",
				message: `No pending extension UI request for cancel target ${parsed.targetId}`,
				requestId: parsed.targetId,
			});
			return { accepted: false, kind: "diagnostic", diagnostic };
		}
		const pending = this.#pending.get(token);
		if (!pending) {
			const diagnostic = this.#recordDiagnostic({
				code: "cancel-target-not-found",
				message: `No pending extension UI request for cancel target ${parsed.targetId}`,
				requestId: parsed.targetId,
			});
			return { accepted: false, kind: "diagnostic", diagnostic };
		}
		this.#takePending(token);
		const event = snapshot({ kind: "server-cancel", requestId: parsed.id, targetId: parsed.targetId, token, request: pending.request }) as ExtensionUiServerCancelEvent;
		this.#emit(event);
		return { accepted: true, kind: "server-cancel", token };
	}

	#isValidAnswer(request: ExtensionUiInteractiveRequest, answer: ExtensionUiAnswer): boolean {
		if (isCancelledAnswer(answer)) return true;
		if (request.method === "confirm") return typeof answer === "boolean";
		if (request.method === "select") return typeof answer === "string" && request.options.includes(answer);
		return typeof answer === "string";
	}

	#takePending(token: ExtensionUiToken): PendingUiRequest | undefined {
		const pending = this.#pending.get(token);
		if (!pending) return undefined;
		if (pending.timer !== undefined) clearTimeout(pending.timer);
		this.#pending.delete(token);
		this.#pendingByUpstreamId.delete(pending.request.id);
		return pending;
	}

	#expire(token: ExtensionUiToken): void {
		if (this.#disposed) return;
		const pending = this.#takePending(token);
		if (!pending) return;
		const event = snapshot({ kind: "timeout", token, request: pending.request }) as ExtensionUiTimeoutEvent;
		this.#emit(event);
		const frame: RpcExtensionUIResponse = { type: "extension_ui_response", id: pending.request.id, cancelled: true, timedOut: true };
		void this.#sendOnce(frame, token, pending.request.id).catch(() => {
			// #sendOnce already retains a diagnostic.  The timeout callback has no
			// caller to reject, so intentionally swallow the rejected promise.
		});
	}

	#sendOnce(frame: RpcExtensionUIResponse, token: ExtensionUiToken, requestId: string): Promise<void> {
		const immutableFrame = snapshot(frame);
		let result: void | Promise<void>;
		try {
			result = this.#send(immutableFrame);
		} catch (cause) {
			return this.#sendFailure(cause, token, requestId);
		}
		return Promise.resolve(result).catch(cause => this.#sendFailure(cause, token, requestId));
	}

	#sendFailure(cause: unknown, token: ExtensionUiToken, requestId: string): Promise<never> {
		const source = toError(cause);
		const message = `Extension UI response send failed for ${requestId}: ${source.message}`;
		this.#recordDiagnostic({ code: "send-failed", message, token, requestId });
		return Promise.reject(new ExtensionUiBrokerError("send-failed", message, token, requestId));
	}

	#rejectStale(token: ExtensionUiToken): Promise<never> {
		const error = new ExtensionUiBrokerError("stale-response", "Extension UI response token is stale, cancelled, duplicated, or belongs to another broker", token);
		this.#recordDiagnostic({ code: error.code, message: error.message, token });
		return Promise.reject(error);
	}

	#recordDiagnostic(input: Omit<ExtensionUiDiagnostic, "frame"> & { frame?: unknown }): ExtensionUiDiagnostic {
		const diagnostic = snapshot(input) as ExtensionUiDiagnostic;
		if (this.#diagnostics.length >= this.#maxDiagnostics) this.#diagnostics.shift();
		this.#diagnostics.push(diagnostic);
		if (!this.#emittingDiagnostic) {
			this.#emittingDiagnostic = true;
			try {
				const event = snapshot({ kind: "diagnostic", diagnostic }) as ExtensionUiDiagnosticEvent;
				this.#emit(event, false);
			} finally {
				this.#emittingDiagnostic = false;
			}
		}
		return diagnostic;
	}

	#emit(event: ExtensionUiEvent, reportListenerFailures = true): void {
		for (const listener of [...this.#listeners]) {
			try {
				const result = listener(event);
				if (result && typeof (result as Promise<void>).then === "function") {
					void (result as Promise<void>).catch(cause => {
						if (!reportListenerFailures) return;
						this.#recordDiagnostic({ code: "listener-failed", message: `Extension UI event listener failed: ${toError(cause).message}` });
					});
				}
			} catch (cause) {
				if (reportListenerFailures) {
					this.#recordDiagnostic({ code: "listener-failed", message: `Extension UI event listener failed: ${toError(cause).message}` });
				}
			}
		}
	}
}
