import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import {
	CEDIA_UI_COMMAND_TYPES,
	MAX_RPC_FRAME_BYTES,
	OMP_RPC_PROTOCOL_VERSION,
	RPC_COMMAND_TYPES,
	type CediaUiCommandType,
	type OmpFrame,
	type OmpFrameListener,
	type OmpRequestOptions,
	type RpcAck,
	type RpcClientSideFrame,
	type RpcCommandPayload,
	type RpcCommandType,
	type RpcFailureResponse,
	type RpcReadyFrame,
} from "./types.ts";
import { OmpClientStateError, OmpCommandError, OmpProtocolError, OmpRequestTimeoutError } from "./client.ts";
import { CEDIA_OWNER_BRIDGE_VERSION } from "../../protocol/src/owner.ts";

/** The identity a controller must prove before it can claim a running owner. */
export interface CediaOwnerControlIdentity {
	readonly sessionId: string;
	readonly incarnation: string;
	readonly pid: number;
	readonly processStartIdentity: string;
	readonly ownerStartedAt: string;
	readonly cwd?: string;
	readonly sessionFile?: string;
}

export interface OmpOwnerControlClientOptions {
	/** The mode-0600 Unix socket named by the owner's discovery record. */
	readonly socket: string;
	/** The per-owner bearer token from the discovery record. */
	readonly token: string;
	/** The Cedia owner bridge protocol, distinct from OMP's RPC protocol. */
	readonly protocolVersion: number;
	/** Identity read from the same discovery record, never inferred from a PID. */
	readonly expectedIdentity: CediaOwnerControlIdentity;
	/** Connection, claim, and release deadline. */
	readonly timeoutMs?: number;
	/** Default deadline for controller command acknowledgements. */
	readonly requestTimeoutMs?: number;
	/** Receives every OMP frame forwarded by the claimed owner. */
	readonly onFrame?: OmpFrameListener;
}

export type OmpOwnerControlMode = "read-write" | "read-only";
export type OmpOwnerControlPhase = "new" | "starting" | "ready" | "closing" | "closed";

/** A transport failure after dispatch means the command outcome cannot be reconstructed safely. */
export class OmpOwnerControlDisconnectedError extends Error {
	readonly name = "OmpOwnerControlDisconnectedError";
	readonly outcome = "unknown" as const;
	readonly command?: string;
	readonly requestId?: string;

	constructor(message: string, command?: string, requestId?: string) {
		super(message);
		this.command = command;
		this.requestId = requestId;
	}
}

/** Raised when a local owner refuses a controller claim or lease operation. */
export class OmpOwnerControlError extends Error {
	readonly name = "OmpOwnerControlError";
	readonly code?: string;

	constructor(message: string, code?: string) {
		super(message);
		this.code = code;
	}
}

const MAX_CONTROLLER_FRAME_BYTES = 1024 * 1024;
const MAX_CONTROLLER_PENDING = 64;
const MAX_CONTROLLER_OUTBOUND_BYTES = 8 * 1024 * 1024;
const MAX_CONTROLLER_SIDECHANNEL_IDS = 64;
// Several one-megabyte frames may arrive in one kernel read. Bound the aggregate buffer
// separately from the per-line limit so valid coalesced frames are not mistaken for one giant
// frame.
const MAX_CONTROLLER_INBOUND_BUFFER_BYTES = MAX_CONTROLLER_OUTBOUND_BYTES;
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RELEASE_TIMEOUT_MS = 2_000;

const SAFE_READ_COMMANDS = new Set<RpcCommandType>([
	"get_state",
	"get_available_commands",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function isCanonicalCommand(value: string): value is RpcCommandType {
	return (RPC_COMMAND_TYPES as readonly string[]).includes(value);
}

function isRpcResponse(value: unknown): value is {
	type: "response";
	command: string;
	success: boolean;
	id?: string;
	[key: string]: unknown;
} {
	return (
		isRecord(value) &&
		value.type === "response" &&
		typeof value.command === "string" &&
		typeof value.success === "boolean" &&
		(value.id === undefined || typeof value.id === "string") &&
		(value.success === true || typeof value.error === "string")
	);
}

function isReadyFrame(value: unknown): value is RpcReadyFrame {
	return (
		isRecord(value) &&
		value.type === "ready" &&
		value.protocolVersion === 1 &&
		Array.isArray(value.supportedProtocolVersions) &&
		value.supportedProtocolVersions.includes(OMP_RPC_PROTOCOL_VERSION) &&
		value.maxFrameBytes === MAX_RPC_FRAME_BYTES &&
		value.maxReassembledFrameBytes === 64 * 1024 * 1024 &&
		value.cediaOwnerControllerVersion === 1 &&
		value.cediaOwnerControllerMaxFrameBytes === MAX_CONTROLLER_FRAME_BYTES &&
		value.cediaOwnerControllerMaxPending === MAX_CONTROLLER_PENDING
	);
}

function isSideChannelFrame(value: unknown): value is RpcClientSideFrame {
	if (!isRecord(value) || typeof value.type !== "string" || typeof value.id !== "string") return false;
	switch (value.type) {
		case "extension_ui_response":
			return (
				(typeof value.value === "string" && value.confirmed === undefined && value.cancelled === undefined) ||
				(typeof value.confirmed === "boolean" && value.value === undefined && value.cancelled === undefined) ||
				(value.cancelled === true && value.value === undefined && value.confirmed === undefined)
			);
		case "host_tool_update":
			return Object.hasOwn(value, "partialResult");
		case "host_tool_result":
			return Object.hasOwn(value, "result");
		case "host_uri_result":
			return true;
		default:
			return false;
	}
}

function identityFrom(value: unknown): CediaOwnerControlIdentity | undefined {
	if (!isRecord(value)) return undefined;
	if (
		typeof value.sessionId !== "string" ||
		value.sessionId.length === 0 ||
		typeof value.incarnation !== "string" ||
		value.incarnation.length === 0 ||
		!Number.isSafeInteger(value.pid) ||
		(value.pid as number) <= 0 ||
		typeof value.ownerStartedAt !== "string" ||
		value.ownerStartedAt.length === 0
		|| typeof value.processStartIdentity !== "string" || value.processStartIdentity.length === 0
	)
		return undefined;
	if (value.cwd !== undefined && (typeof value.cwd !== "string" || value.cwd.length === 0)) return undefined;
	if (value.sessionFile !== undefined && (typeof value.sessionFile !== "string" || value.sessionFile.length === 0)) return undefined;
	return {
		sessionId: value.sessionId,
		incarnation: value.incarnation,
		pid: value.pid as number,
		processStartIdentity: value.processStartIdentity,
		ownerStartedAt: value.ownerStartedAt,
		...(value.cwd === undefined ? {} : { cwd: value.cwd }),
		...(value.sessionFile === undefined ? {} : { sessionFile: value.sessionFile }),
	};
}

function identityMatches(actual: CediaOwnerControlIdentity, expected: CediaOwnerControlIdentity): boolean {
	return (
		actual.sessionId === expected.sessionId &&
		actual.incarnation === expected.incarnation &&
		actual.pid === expected.pid &&
		actual.processStartIdentity === expected.processStartIdentity &&
		actual.ownerStartedAt === expected.ownerStartedAt &&
		(expected.cwd === undefined || actual.cwd === undefined || actual.cwd === expected.cwd) &&
		(expected.sessionFile === undefined || actual.sessionFile === undefined || actual.sessionFile === expected.sessionFile)
	);
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

interface PendingCommand {
	readonly command: string;
	readonly resolve: (value: RpcAck) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
	settled: boolean;
	dispatched: boolean;
}

/**
 * Controller-side adapter for an already-running OMP `rpc-ui` owner.
 *
 * The owner remains the execution/session owner. This class owns only one local socket lease;
 * `close` and `detach` release that lease or close the socket and never signal the OMP process.
 */
export class OmpOwnerControlClient {
	static async attach(options: OmpOwnerControlClientOptions): Promise<OmpOwnerControlClient> {
		const client = new OmpOwnerControlClient(options);
		try {
			await client.#start();
			return client;
		} catch (error) {
			client.#disposeWithoutRelease();
			throw error;
		}
	}

	readonly #options: Required<Pick<OmpOwnerControlClientOptions, "timeoutMs" | "requestTimeoutMs">> & OmpOwnerControlClientOptions;
	readonly #socketPath: string;
	readonly #token: string;
	readonly #protocolVersion: number;
	readonly #expectedIdentity: CediaOwnerControlIdentity;
	#socket: Socket | undefined;
	#phase: OmpOwnerControlPhase = "new";
	#mode: OmpOwnerControlMode | undefined;
	#identity: CediaOwnerControlIdentity | undefined;
	#leaseId: string | undefined;
	#readyFrame: RpcReadyFrame | undefined;
	#buffer = Buffer.alloc(0);
	#listeners = new Set<OmpFrameListener>();
	#pending = new Map<string, PendingCommand>();
	#sideChannelIds = new Set<string>();
	#writeQueue: Promise<void> = Promise.resolve();
	#queuedBytes = 0;
	#connectPromise: Promise<void> | undefined;
	#connectResolve: (() => void) | undefined;
	#connectReject: ((error: Error) => void) | undefined;
	#claimId: string | undefined;
	#claimPromise: Promise<void> | undefined;
	#claimResolve: (() => void) | undefined;
	#claimReject: ((error: Error) => void) | undefined;
	#closePromise: Promise<void> | undefined;
	#transportError: Error | undefined;

	private constructor(options: OmpOwnerControlClientOptions) {
		this.#options = {
			...options,
			timeoutMs: options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
			requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		};
		this.#socketPath = options.socket;
		this.#token = options.token;
		this.#protocolVersion = options.protocolVersion;
		this.#expectedIdentity = options.expectedIdentity;
		if (options.onFrame) this.#listeners.add(options.onFrame);
	}

	get protocolVersion(): number {
		return OMP_RPC_PROTOCOL_VERSION;
	}

	get readyFrame(): RpcReadyFrame | undefined {
		return this.#readyFrame;
	}

	get phase(): OmpOwnerControlPhase {
		return this.#phase;
	}

	get mode(): OmpOwnerControlMode | undefined {
		return this.#mode;
	}

	get identity(): CediaOwnerControlIdentity | undefined {
		return this.#identity;
	}

	get leaseId(): string | undefined {
		return this.#leaseId;
	}

	/** Subscribe to every decoded OMP frame forwarded by the owner. */
	onFrame(listener: OmpFrameListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Send a tracked extension UI, host-tool, or host-URI response through this lease. */
	send(frame: RpcClientSideFrame): Promise<void> {
		if (!isSideChannelFrame(frame)) return Promise.reject(new TypeError("invalid OMP side-channel frame"));
		if (this.#phase !== "ready") return Promise.reject(new OmpClientStateError(`owner controller is ${this.#phase}, not ready`));
		if (!this.#sideChannelIds.has(frame.id))
			return Promise.reject(new OmpClientStateError("side-channel response does not match a pending owner request"));
		const terminal = frame.type === "extension_ui_response" || frame.type === "host_tool_result" || frame.type === "host_uri_result";
		let line: Buffer;
		try {
			line = this.#line({
				protocolVersion: this.#protocolVersion,
				token: this.#token,
				request: "controller_sidechannel",
				leaseId: this.#leaseId,
				frame,
			});
		} catch (error) {
			return Promise.reject(toError(error));
		}
		return this.#enqueueWrite(line).then(() => {
			if (terminal) this.#sideChannelIds.delete(frame.id);
		});
	}

	sendSideChannel(frame: RpcClientSideFrame): Promise<void> {
		return this.send(frame);
	}

	request<C extends RpcCommandType>(
		command: C,
		payload?: RpcCommandPayload<C>,
		options?: OmpRequestOptions,
	): Promise<RpcAck<C>> {
		return this.#sendCommand(command, payload ?? ({} as RpcCommandPayload<C>), options);
	}

	requestCedia(command: CediaUiCommandType, payload: Record<string, unknown>, options?: OmpRequestOptions): Promise<RpcAck> {
		if (!this.#cediaCommandAdvertised(command))
			return Promise.reject(new OmpClientStateError(this.#missingCediaBridgeMessage(command)));
		return this.#sendCommand(command as unknown as RpcCommandType, payload as RpcCommandPayload<RpcCommandType>, options);
	}

	turnBridgeAdvertised(): boolean {
		return this.#readyFrame?.cediaTurnBridgeVersion === 1;
	}

	pendingModelAdvertised(): boolean {
		return this.#readyFrame?.cediaPendingModelVersion === 1;
	}

	capabilitiesAdvertised(): boolean {
		return this.#readyFrame?.cediaCapabilitiesVersion === 1;
	}

	/** Release this controller lease and close only this client's socket. */
	close(): Promise<void> {
		if (this.#closePromise) return this.#closePromise;
		this.#closePromise = this.#closeInternal();
		return this.#closePromise;
	}

	/** Detach immediately; the owner remains running and the server observes lease cancellation. */
	detach(): void {
		if (this.#phase === "closed") return;
		this.#phase = "closing";
		this.#failPending(new OmpOwnerControlDisconnectedError("owner controller detached; command outcomes are unknown"));
		this.#socket?.destroy();
		this.#phase = "closed";
	}

	async #start(): Promise<void> {
		if (this.#phase !== "new") throw new OmpClientStateError("owner controller already started");
		if (this.#protocolVersion !== CEDIA_OWNER_BRIDGE_VERSION) throw new OmpProtocolError("unsupported owner controller protocol");
		if (typeof this.#token !== "string" || this.#token.length === 0 || this.#token.length > 256)
			throw new OmpProtocolError("invalid owner controller token");
		if (!identityFrom(this.#expectedIdentity)) throw new OmpProtocolError("invalid expected owner identity");
		this.#phase = "starting";
		const socket = connect(this.#socketPath);
		this.#socket = socket;
		this.#connectPromise = new Promise<void>((resolve, reject) => {
			this.#connectResolve = resolve;
			this.#connectReject = reject;
		});
		this.#claimPromise = new Promise<void>((resolve, reject) => {
			this.#claimResolve = resolve;
			this.#claimReject = reject;
		});
		socket.on("connect", () => this.#connectResolve?.());
		socket.on("data", chunk => this.#onData(Buffer.from(chunk)));
		socket.on("error", error => this.#failTransport(error));
		socket.on("close", () => this.#onSocketClose());
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.#connectPromise,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new OmpOwnerControlError("owner controller connection timed out", "timeout")), this.#options.timeoutMs);
				}),
			]);
			if (timer) clearTimeout(timer);
			timer = undefined;
			const claimId = this.#newRequestId();
			this.#claimId = claimId;
			const claim = {
				protocolVersion: this.#protocolVersion,
				token: this.#token,
				request: "claim_controller",
				id: claimId,
				expectedIdentity: {
					sessionId: this.#expectedIdentity.sessionId,
					incarnation: this.#expectedIdentity.incarnation,
					pid: this.#expectedIdentity.pid,
					processStartIdentity: this.#expectedIdentity.processStartIdentity,
					ownerStartedAt: this.#expectedIdentity.ownerStartedAt,
				},
			};
			await this.#enqueueWrite(this.#line(claim));
			await Promise.race([
				this.#claimPromise,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new OmpOwnerControlError("owner controller claim timed out", "timeout")), this.#options.timeoutMs);
				}),
			]);
			const phaseAfterClaim = this.#phase as OmpOwnerControlPhase;
			if (phaseAfterClaim !== "ready") throw new OmpClientStateError(`owner controller stopped during claim (${phaseAfterClaim})`);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	#sendCommand<C extends RpcCommandType>(command: C, payload: RpcCommandPayload<C>, options?: OmpRequestOptions): Promise<RpcAck<C>> {
		if (this.#phase !== "ready") return Promise.reject(new OmpClientStateError(`owner controller is ${this.#phase}, not ready`));
		if (!isCanonicalCommand(command) && !(CEDIA_UI_COMMAND_TYPES as readonly string[]).includes(command))
			return Promise.reject(new TypeError(`Unknown OMP RPC command: ${command}`));
		if (this.#mode === "read-only" && (!isCanonicalCommand(command) || !SAFE_READ_COMMANDS.has(command)))
			return Promise.reject(new OmpClientStateError(`owner controller is read-only; refusing command ${command}`));
		if (!isRecord(payload)) return Promise.reject(new TypeError("OMP RPC payload must be an object"));
		if (this.#pending.size >= MAX_CONTROLLER_PENDING)
			return Promise.reject(new OmpClientStateError("owner controller command capacity exceeded"));
		const requestId = this.#newRequestId();
		try {
			options?.onRequestId?.(requestId);
		} catch (error) {
			return Promise.reject(toError(error));
		}
		let line: Buffer;
		try {
			const commandPayload = { ...payload } as Record<string, unknown>;
			// The outer envelope owns correlation. Never let a caller smuggle an `id` into the
			// dispatcher payload; the owner rejects such a frame to keep private IDs out of commands.
			delete commandPayload.id;
			line = this.#line({
				protocolVersion: this.#protocolVersion,
				token: this.#token,
				request: "controller_command",
				leaseId: this.#leaseId,
				id: requestId,
				command: { ...commandPayload, type: command },
			});
		} catch (error) {
			return Promise.reject(toError(error));
		}
		const timeout = Number.isFinite(options?.timeoutMs) && (options?.timeoutMs ?? 0) > 0 ? (options?.timeoutMs as number) : this.#options.requestTimeoutMs;
		return new Promise<RpcAck<C>>((resolve, reject) => {
			const timer = setTimeout(() => {
				const pending = this.#pending.get(requestId);
				if (!pending || pending.settled) return;
				this.#pending.delete(requestId);
				pending.settled = true;
				reject(new OmpRequestTimeoutError(command, requestId, timeout, pending.dispatched ? "unknown" : "not-dispatched"));
			}, timeout);
			timer.unref?.();
			this.#pending.set(requestId, {
				command,
				resolve: value => resolve(value as RpcAck<C>),
				reject,
				timer,
				settled: false,
				dispatched: false,
			});
			this.#enqueueWrite(line, requestId).catch(error => {
				const pending = this.#pending.get(requestId);
				if (!pending || pending.settled) return;
				this.#pending.delete(requestId);
				pending.settled = true;
				clearTimeout(pending.timer);
				reject(toError(error));
			});
		});
	}

	#handleOuterFrame(frame: Record<string, unknown>): void {
		if (this.#phase === "starting") {
			if (frame.id !== this.#claimId) return;
			this.#handleClaim(frame);
			return;
		}
		if (this.#phase !== "ready") return;
		if (frame.ok === false && typeof frame.id === "string" && typeof frame.error === "string") {
			const pending = this.#pending.get(frame.id);
			if (pending && !pending.settled) {
				this.#pending.delete(frame.id);
				pending.settled = true;
				clearTimeout(pending.timer);
				const failure: RpcFailureResponse = {
					type: "response",
					id: frame.id,
					command: pending.command,
					success: false,
					error: frame.error,
					...(typeof frame.code === "string" ? { code: frame.code } : { code: frame.error }),
				};
				pending.reject(new OmpCommandError(failure.error, failure.command, failure.code, failure));
			}
			return;
		}
		if (frame.type !== "controller_frame" || frame.leaseId !== this.#leaseId || !isRecord(frame.frame)) {
			// Unknown future protocol messages are ignored, but a controller envelope with the wrong
			// lease is a protocol violation: accepting it could leak another controller's response.
			if (frame.type === "controller_frame") this.#failTransport(new OmpProtocolError("owner controller lease mismatch"));
			return;
		}
		const inner = frame.frame;
		if (!this.#rememberSideChannelRequest(inner)) return;
		for (const listener of [...this.#listeners]) {
			try {
				listener(inner);
			} catch {
				// Host listeners are observers and cannot tear down the owner transport.
			}
		}
		if (!isRpcResponse(inner) || typeof inner.id !== "string") return;
		const pending = this.#pending.get(inner.id);
		if (!pending || pending.settled) return;
		this.#pending.delete(inner.id);
		pending.settled = true;
		clearTimeout(pending.timer);
		if (inner.command !== pending.command) {
			pending.reject(new OmpProtocolError(`OMP response command mismatch: expected ${pending.command}, got ${inner.command}`));
			return;
		}
		if (inner.success) {
			pending.resolve(inner as RpcAck);
			return;
		}
		const failure = inner as unknown as RpcFailureResponse;
		pending.reject(new OmpCommandError(failure.error, failure.command, failure.code, failure));
	}

	#handleClaim(frame: Record<string, unknown>): void {
		if (frame.protocolVersion !== this.#protocolVersion || frame.id !== this.#claimId) {
			this.#claimReject?.(new OmpProtocolError("owner controller claim response mismatch"));
			return;
		}
		if (frame.ok !== true) {
			const message = typeof frame.error === "string" ? frame.error : "owner refused controller claim";
			this.#claimReject?.(new OmpOwnerControlError(message, typeof frame.code === "string" ? frame.code : message));
			return;
		}
		if (frame.controllerProtocolVersion !== 1 || typeof frame.leaseId !== "string" || (frame.mode !== "read-write" && frame.mode !== "read-only")) {
			this.#claimReject?.(new OmpProtocolError("owner controller claim response is invalid"));
			return;
		}
		const identity = identityFrom(frame.identity);
		if (!identity || !identityMatches(identity, this.#expectedIdentity)) {
			this.#claimReject?.(new OmpOwnerControlError("owner controller identity mismatch", "identity_mismatch"));
			return;
		}
		if (!isReadyFrame(frame.ready)) {
			this.#claimReject?.(new OmpProtocolError("owner controller ready frame is invalid"));
			return;
		}
		this.#leaseId = frame.leaseId;
		this.#identity = identity;
		this.#mode = frame.mode;
		this.#readyFrame = frame.ready;
		this.#phase = "ready";
		this.#claimResolve?.();
	}

	#rememberSideChannelRequest(frame: Record<string, unknown>): boolean {
		if (typeof frame.id !== "string") return true;
		if (frame.type === "host_tool_cancel" || frame.type === "host_uri_cancel" || (frame.type === "extension_ui_request" && frame.method === "cancel")) {
			if (typeof frame.targetId === "string") this.#sideChannelIds.delete(frame.targetId);
			return true;
		}
		if (frame.type !== "extension_ui_request" && frame.type !== "host_tool_call" && frame.type !== "host_uri_request") return true;
		if (!this.#sideChannelIds.has(frame.id) && this.#sideChannelIds.size >= MAX_CONTROLLER_SIDECHANNEL_IDS) {
			this.#failTransport(new OmpProtocolError("owner controller side-channel capacity exceeded"));
			return false;
		}
		this.#sideChannelIds.add(frame.id);
		return true;
	}

	#onData(chunk: Buffer): void {
		if (this.#phase === "closed") return;
		this.#buffer = Buffer.concat([this.#buffer, chunk]);
		if (this.#buffer.byteLength > MAX_CONTROLLER_INBOUND_BUFFER_BYTES) {
			this.#failTransport(new OmpProtocolError("owner controller response buffer exceeded its bound"));
			return;
		}
		for (;;) {
			const newline = this.#buffer.indexOf(0x0a);
			if (newline < 0) return;
			const line = this.#buffer.subarray(0, newline);
			this.#buffer = this.#buffer.subarray(newline + 1);
			if (line.byteLength + 1 > MAX_CONTROLLER_FRAME_BYTES) {
				this.#failTransport(new OmpProtocolError("owner controller frame exceeds 1 MiB"));
				return;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line.toString("utf8"));
			} catch {
				this.#failTransport(new OmpProtocolError("owner controller response was not JSON"));
				return;
			}
			if (!isRecord(parsed) || parsed.protocolVersion !== this.#protocolVersion) {
				this.#failTransport(new OmpProtocolError("owner controller response protocol mismatch"));
				return;
			}
			this.#handleOuterFrame(parsed);
			if ((this.#phase as OmpOwnerControlPhase) === "closed") return;
		}
	}

	#line(frame: Record<string, unknown>): Buffer {
		const line = Buffer.from(`${JSON.stringify(frame)}\n`, "utf8");
		if (line.byteLength > MAX_CONTROLLER_FRAME_BYTES) throw new OmpProtocolError("owner controller frame exceeds 1 MiB");
		return line;
	}

	#enqueueWrite(line: Buffer, requestId?: string): Promise<void> {
		if (this.#phase === "closed") return Promise.reject(new OmpClientStateError("owner controller is closed"));
		if (this.#queuedBytes + line.byteLength > MAX_CONTROLLER_OUTBOUND_BYTES)
			return Promise.reject(new OmpProtocolError("owner controller outbound queue exceeded 8 MiB"));
		this.#queuedBytes += line.byteLength;
		const task = this.#writeQueue.then(async () => {
			const pending = requestId === undefined ? undefined : this.#pending.get(requestId);
			if (requestId !== undefined && (!pending || pending.settled)) return;
			if (requestId !== undefined && pending) pending.dispatched = true;
			await this.#writeNow(line);
		}).finally(() => {
			this.#queuedBytes = Math.max(0, this.#queuedBytes - line.byteLength);
		});
		this.#writeQueue = task.catch(() => {});
		return task;
	}

	#writeNow(line: Buffer): Promise<void> {
		const socket = this.#socket;
		if (!socket || socket.destroyed || socket.writableEnded) return Promise.reject(new OmpClientStateError("owner controller socket is unavailable"));
		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const cleanup = () => {
				socket.off("error", onError);
				socket.off("close", onClose);
			};
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (error) reject(error);
				else resolve();
			};
			const onError = (error: Error) => finish(error);
			const onClose = () => finish(new OmpOwnerControlDisconnectedError("owner controller socket closed while writing"));
			socket.once("error", onError);
			socket.once("close", onClose);
			try {
				socket.write(line, error => finish(error ?? undefined));
			} catch (error) {
				finish(toError(error));
			}
		});
	}

	#onSocketClose(): void {
		if (this.#phase === "closing" || this.#phase === "closed") return;
		this.#failTransport(new OmpOwnerControlDisconnectedError("owner controller disconnected; command outcomes are unknown"));
	}

	#failTransport(error: Error): void {
		if (this.#phase === "closed" || this.#phase === "closing") return;
		this.#transportError = error;
		this.#claimReject?.(error);
		this.#connectReject?.(error);
		this.#failPending(error);
		this.#phase = "closed";
		this.#socket?.destroy();
	}

	#failPending(error: Error): void {
		for (const [id, pending] of this.#pending) {
			this.#pending.delete(id);
			if (pending.settled) continue;
			pending.settled = true;
			clearTimeout(pending.timer);
			pending.reject(error);
		}
	}

	async #closeInternal(): Promise<void> {
		if (this.#phase === "closed") return;
		if (this.#phase === "new") {
			this.#phase = "closed";
			return;
		}
		this.#phase = "closing";
		this.#failPending(new OmpOwnerControlDisconnectedError("owner controller closed; command outcomes are unknown"));
		const socket = this.#socket;
		if (!socket || socket.destroyed) {
			this.#phase = "closed";
			return;
		}
		if (this.#leaseId) {
			try {
				await this.#enqueueWrite(this.#line({ protocolVersion: this.#protocolVersion, token: this.#token, request: "release_controller", leaseId: this.#leaseId, id: this.#newRequestId() }));
			} catch {
				// The server observes the socket close as lease cancellation when a release cannot be written.
			}
		}
		socket.end();
		await new Promise<void>(resolve => {
			if (socket.destroyed) {
				resolve();
				return;
			}
			let timer = setTimeout(() => {
				socket.destroy();
				resolve();
			}, this.#options.timeoutMs || DEFAULT_RELEASE_TIMEOUT_MS);
			timer.unref?.();
			socket.once("close", () => {
				clearTimeout(timer);
				resolve();
			});
		});
		this.#phase = "closed";
	}

	#disposeWithoutRelease(): void {
		this.#phase = "closed";
		this.#failPending(this.#transportError ?? new OmpOwnerControlDisconnectedError("owner controller attach failed"));
		this.#socket?.destroy();
	}

	#newRequestId(): string {
		return `cedia_owner_${process.pid}_${Date.now().toString(36)}_${randomUUID()}`;
	}

	#cediaCommandAdvertised(command: string): boolean {
		const ready = this.#readyFrame;
		if (!ready) return false;
		if (command === "cedia_get_model_roles" || command === "cedia_set_model_role") return ready.cediaModelRolesVersion === 1;
		if (command === "cedia_turn_queue") return ready.cediaTurnBridgeVersion === 1;
		if (command === "cedia_pending_model") return ready.cediaPendingModelVersion === 1;
		if (command === "cedia_goal") return ready.cediaGoalVersion === 1;
		if (command === "cedia_plan") return ready.cediaPlanVersion === 1;
		if (command === "cedia_get_auth_providers" || command === "cedia_set_api_key" || command === "cedia_logout") return ready.cediaAuthVersion === 1;
		if (command === "cedia_get_capabilities" || command === "cedia_control") return ready.cediaCapabilitiesVersion === 1;
		return ready.cediaVirtualUiVersion === 1;
	}

	#missingCediaBridgeMessage(command: string): string {
		if (command === "cedia_get_model_roles" || command === "cedia_set_model_role") return "This OMP runtime does not advertise the Cedia model-role bridge";
		if (command === "cedia_turn_queue") return "This OMP runtime does not advertise the Cedia turn bridge";
		if (command === "cedia_pending_model") return "This OMP runtime does not advertise the Cedia pending-model bridge";
		if (command === "cedia_goal") return "This OMP runtime does not advertise the Cedia goal bridge";
		if (command === "cedia_plan") return "This OMP runtime does not advertise the Cedia plan bridge";
		if (command === "cedia_get_auth_providers" || command === "cedia_set_api_key" || command === "cedia_logout") return "This OMP runtime does not advertise the Cedia provider-auth bridge";
		if (command === "cedia_get_capabilities" || command === "cedia_control") return "This OMP runtime does not advertise the Cedia capability bridge";
		return "This OMP runtime does not advertise Cedia virtual UI v1";
	}

}

export { MAX_CONTROLLER_FRAME_BYTES, MAX_CONTROLLER_PENDING, MAX_CONTROLLER_OUTBOUND_BYTES };
