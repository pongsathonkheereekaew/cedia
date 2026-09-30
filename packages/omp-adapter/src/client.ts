import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
	MAX_RPC_FRAME_BYTES,
	MAX_RPC_REASSEMBLED_BYTES,
	OMP_RPC_PROTOCOL_VERSION,
	RPC_COMMAND_TYPES,
	CEDIA_UI_COMMAND_TYPES,
	type CediaUiCommandType,
	type OmpFrame,
	type OmpFrameListener,
	type OmpRequestOptions,
	type OmpRpcClientStartOptions,
	type RpcAck,
	type RpcClientSideFrame,
	type RpcCommandPayload,
	type RpcCommandType,
	type RpcFailureResponse,
	type RpcReadyFrame,
	type RpcResponse,
} from "./types.ts";
import { NdjsonFrameDecoder, RpcFrameDecoder } from "./framing.ts";

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 1_000;
const DEFAULT_STDERR_LIMIT_BYTES = 256 * 1024;

let processRequestSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRpcResponse(value: unknown): value is RpcResponse {
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
		value.maxReassembledFrameBytes === MAX_RPC_REASSEMBLED_BYTES
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

function isCommandType(command: string): command is RpcCommandType {
	return (RPC_COMMAND_TYPES as readonly string[]).includes(command);
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/** Raised when OMP returns a failed response frame for a command. */
export class OmpCommandError extends Error {
	readonly name = "OmpCommandError";
	readonly command: string;
	readonly code?: string;
	readonly response?: RpcFailureResponse;

	constructor(
		message: string,
		command: string,
		code?: string,
		response?: RpcFailureResponse,
	) {
		super(message);
		this.command = command;
		this.code = code;
		this.response = response;
	}
}

/** Raised when an ACK did not arrive before the configured timeout. */
export class OmpRequestTimeoutError extends Error {
	readonly name = "OmpRequestTimeoutError";
	readonly outcome: "unknown" | "not-dispatched";
	readonly command: string;
	readonly requestId: string;

	constructor(
		command: string,
		requestId: string,
		timeoutMs: number,
		outcome: "unknown" | "not-dispatched" = "unknown",
	) {
		super(`Timeout waiting for OMP response to ${command} (${timeoutMs} ms); outcome is ${outcome}`);
		this.outcome = outcome;
		this.command = command;
		this.requestId = requestId;
	}
}

/** Raised when a caller uses a client before it is ready or after close. */
export class OmpClientStateError extends Error {
	readonly name = "OmpClientStateError";
}

/** Raised when stdout violates the bounded OMP JSONL transport contract. */
export class OmpProtocolError extends Error {
	readonly name = "OmpProtocolError";
}

interface PendingRequest {
	command: RpcCommandType;
	resolve: (response: RpcAck) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	settled: boolean;
	dispatched: boolean;
}

type ClientPhase = "new" | "starting" | "ready" | "closing" | "closed";

/**
 * Node-compatible OMP `rpc-ui` subprocess adapter.
 *
 * This class owns transport framing and command correlation only.  It does not
 * auto-approve extension UI requests or execute host tools; those frames are
 * emitted verbatim to the host and must be answered explicitly with `send`.
 */
export class OmpRpcClient {
	static async start(options: OmpRpcClientStartOptions = {}): Promise<OmpRpcClient> {
		const client = new OmpRpcClient(options);
		try {
			await client.#start();
			return client;
		} catch (cause) {
			await client.close();
			throw cause;
		}
	}

	readonly #options: Required<
		Pick<OmpRpcClientStartOptions, "readyTimeoutMs" | "requestTimeoutMs" | "shutdownGraceMs" | "stderrLimitBytes">
	> & OmpRpcClientStartOptions;
	#phase: ClientPhase = "new";
	#child: ChildProcessWithoutNullStreams | undefined;
	#exitPromise: Promise<void> | undefined;
	#exitResolve: (() => void) | undefined;
	#stdioClosePromise: Promise<void> | undefined;
	#stdioCloseResolve: (() => void) | undefined;
	#stdioClosed = false;
	#closePromise: Promise<void> | undefined;
	#ownerBridgeRequested = false;
	#readyPromise: Promise<RpcReadyFrame> | undefined;
	#readyResolve: ((frame: RpcReadyFrame) => void) | undefined;
	#readyReject: ((error: Error) => void) | undefined;
	#readyFrame: RpcReadyFrame | undefined;
	#protocolVersion = 1;
	#readError: Error | undefined;
	#stdoutEnded = false;
	#frameDecoder = new NdjsonFrameDecoder();
	#rpcFrameDecoder = new RpcFrameDecoder();
	#protocolV2Enabled = false;
	#readyTimeout: ReturnType<typeof setTimeout> | undefined;
	#listeners = new Set<OmpFrameListener>();
	#pending = new Map<string, PendingRequest>();
	#writeQueue: Promise<void> = Promise.resolve();
	#stderrChunks: Buffer[] = [];
	#stderrBytes = 0;
	#requestCounter = 0;

	private constructor(options: OmpRpcClientStartOptions) {
		this.#options = {
			...options,
			readyTimeoutMs: options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
			requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
			shutdownGraceMs: options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
			stderrLimitBytes: options.stderrLimitBytes ?? DEFAULT_STDERR_LIMIT_BYTES,
		};
		if (options.onFrame) this.#listeners.add(options.onFrame);
	}

	/** Protocol version selected after startup negotiation (1 while starting). */
	get protocolVersion(): number {
		return this.#protocolVersion;
	}

	get readyFrame(): RpcReadyFrame | undefined {
		return this.#readyFrame;
	}

	get phase(): ClientPhase {
		return this.#phase;
	}

	/** Current bounded stderr tail. */
	get stderr(): string {
		return Buffer.concat(this.#stderrChunks).toString("utf8");
	}

	getStderr(): string {
		return this.stderr;
	}

	/** Subscribe to every decoded logical frame, including future/unknown frames. */
	onFrame(listener: OmpFrameListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Send an explicit extension UI/host-tool/host-URI response frame.
	 *
	 * The adapter deliberately does not synthesize these responses.  This keeps
	 * approvals and host capabilities under the Cedia host's control.
	 */
	send(frame: RpcClientSideFrame): Promise<void> {
		if (!isSideChannelFrame(frame)) return Promise.reject(new TypeError("invalid OMP side-channel frame"));
		return this.#sendFrameWhenReady(frame);
	}

	sendSideChannel(frame: RpcClientSideFrame): Promise<void> {
		return this.send(frame);
	}

	/**
	 * Send one canonical RPC command and resolve on its response ACK.
	 *
	 * Prompt completion is represented by later `agent_end` (or other event)
	 * frames delivered to `onFrame`; it is intentionally not conflated with the
	 * immediate command ACK.
	 */
	request<C extends RpcCommandType>(
		command: C,
		payload?: RpcCommandPayload<C>,
		options?: OmpRequestOptions,
	): Promise<RpcAck<C>> {
		if (this.#phase !== "ready") return Promise.reject(new OmpClientStateError(`OMP client is ${this.#phase}, not ready`));
		return this.#sendCommand(command, payload ?? ({} as RpcCommandPayload<C>), options?.timeoutMs ?? this.#options.requestTimeoutMs, options?.onRequestId) as Promise<
			RpcAck<C>
		>;
	}

	/** Gracefully close stdin and reap the child, escalating TERM then KILL. */
	requestCedia(command: CediaUiCommandType, payload: Record<string, unknown>, options?: OmpRequestOptions): Promise<RpcAck> {
		const modelRoles = command === "cedia_get_model_roles" || command === "cedia_set_model_role";
		const providerAuth =
			command === "cedia_get_auth_providers" || command === "cedia_set_api_key" || command === "cedia_logout";
		const capabilities = command === "cedia_get_capabilities" || command === "cedia_control";
		const goal = command === "cedia_goal";
		const plan = command === "cedia_plan";
		if (!this.#cediaCommandAdvertised(command))
			return Promise.reject(
				new OmpClientStateError(
					modelRoles
						? "This OMP runtime does not advertise the Cedia model-role bridge"
						: providerAuth
							? "This OMP runtime does not advertise the Cedia provider-auth bridge"
							: capabilities
								? "This OMP runtime does not advertise the Cedia capability bridge"
								: goal
									? "This OMP runtime does not advertise the Cedia goal bridge"
									: plan
										? "This OMP runtime does not advertise the Cedia plan bridge"
										: "This OMP runtime does not advertise Cedia virtual UI v1",
				),
			);
		return this.#sendCommand(command as unknown as RpcCommandType, payload as RpcCommandPayload<RpcCommandType>, options?.timeoutMs ?? this.#options.requestTimeoutMs, options?.onRequestId);
	}

	close(): Promise<void> {
		if (this.#closePromise) return this.#closePromise;
		this.#closePromise = this.#closeProcess();
		return this.#closePromise;
	}

	async #start(): Promise<void> {
		if (this.#phase !== "new") throw new OmpClientStateError("OMP client already started");
		const extraArgs = [...(this.#options.args ?? [])];
		if (extraArgs.some(arg => arg === "--mode" || arg.startsWith("--mode="))) {
			throw new TypeError("OMP adapter owns --mode rpc-ui; remove --mode from args");
		}

		this.#phase = "starting";
		this.#readyPromise = new Promise<RpcReadyFrame>((resolve, reject) => {
			this.#readyResolve = resolve;
			this.#readyReject = reject;
		});
		// Supplying `env` is an explicit isolation boundary: do not merge ambient
		// provider credentials or unrelated variables into the child.  Callers that
		// need PATH or locale values must provide them themselves.
		const env = this.#options.env === undefined ? process.env : this.#options.env;
		this.#ownerBridgeRequested = env.CEDIA_RPC_OWNER_BRIDGE === "1";
		const executable = this.#options.executable ?? "omp";
		const args = ["--mode", "rpc-ui", ...extraArgs];
		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawn(executable, args, {
				cwd: this.#options.cwd,
				env,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (cause) {
			this.#rejectReady(toError(cause));
			this.#phase = "closed";
			throw cause;
		}
		this.#child = child;
		this.#exitPromise = new Promise<void>(resolve => {
			this.#exitResolve = resolve;
		});
		this.#stdioClosePromise = new Promise<void>(resolve => {
			this.#stdioCloseResolve = resolve;
		});

		child.stdout.on("data", (chunk: Buffer | string) => {
			if (this.#phase === "closed") return;
			try {
				const physicalFrames = this.#frameDecoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
				for (const physical of physicalFrames) {
					if (isRecord(physical) && physical.type === "rpc_chunk" && !this.#protocolV2Enabled)
						throw new OmpProtocolError("received rpc_chunk before protocol-v2 negotiation");
					const logical = this.#rpcFrameDecoder.push(physical);
					if (logical) this.#handleFrame(logical);
				}
			} catch (cause) {
				this.#failProtocol(toError(cause));
			}
		});
		child.stdout.on("end", () => {
			this.#stdoutEnded = true;
			try {
				for (const physical of this.#frameDecoder.finish()) {
					if (isRecord(physical) && physical.type === "rpc_chunk" && !this.#protocolV2Enabled)
						throw new OmpProtocolError("received rpc_chunk before protocol-v2 negotiation");
					const logical = this.#rpcFrameDecoder.push(physical);
					if (logical) this.#handleFrame(logical);
				}
				this.#rpcFrameDecoder.finish();
			} catch (cause) {
				this.#failProtocol(toError(cause));
			}
			if (this.#phase !== "closing" && this.#phase !== "closed")
				this.#failProtocol(new OmpProtocolError(`OMP stdout ended unexpectedly${this.stderr ? `: ${this.stderr}` : ""}`));
		});
		child.stdout.on("error", error => this.#failProtocol(new OmpProtocolError(`OMP stdout error: ${error.message}`)));
		child.stdin.on("error", error => this.#failRequests(new Error(`OMP stdin error: ${error.message}`)));
		child.stderr.on("data", chunk => this.#appendStderr(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
		child.stderr.on("error", error => this.#appendStderr(Buffer.from(`stderr stream error: ${error.message}\n`)));
		child.on("error", error => this.#onChildError(error));
		child.on("exit", (code, signal) => this.#onChildExit(code, signal));
		child.on("close", (code, signal) => this.#onChildClose(code, signal));

		this.#readyTimeout = setTimeout(() => {
			if (this.#phase !== "starting") return;
			this.#failProtocol(new OmpProtocolError(`Timeout waiting for supported OMP ready frame${this.stderr ? `: ${this.stderr}` : ""}`));
		}, this.#options.readyTimeoutMs);
		this.#readyTimeout.unref?.();

		const ready = await this.#readyPromise;
		if (!isReadyFrame(ready)) throw new OmpProtocolError("OMP ready frame failed validation");
		const negotiated = await this.#sendCommand("negotiate_protocol", { protocolVersion: OMP_RPC_PROTOCOL_VERSION }, this.#options.requestTimeoutMs);
		if (
			!negotiated.success ||
			negotiated.command !== "negotiate_protocol" ||
			!isRecord(negotiated.data) ||
			negotiated.data.protocolVersion !== OMP_RPC_PROTOCOL_VERSION
		)
			throw new OmpProtocolError("OMP protocol-v2 negotiation failed");
		// The same stdout callback may have resolved the ACK and then encountered
		// malformed data. Never resurrect a client whose teardown already began.
		if (this.#readError) throw this.#readError;
		if (this.#phase !== "starting") throw new OmpClientStateError(`OMP stopped during startup (${this.#phase})`);
		this.#protocolV2Enabled = true;
		this.#protocolVersion = OMP_RPC_PROTOCOL_VERSION;
		this.#phase = "ready";
		if (this.#readyTimeout) clearTimeout(this.#readyTimeout);
		this.#readyTimeout = undefined;
	}

	#handleFrame(frame: OmpFrame): void {
		// Emit before correlation so startup, unknown, duplicate and late frames
		// are all observable with their original fields intact.
		for (const listener of [...this.#listeners]) {
			try {
				listener(frame);
			} catch {
				// A host listener cannot be allowed to tear down the OMP transport.
			}
		}

		if (frame.type === "ready" && this.#phase === "starting" && !this.#readyFrame) {
			if (!isReadyFrame(frame)) {
				this.#failProtocol(new OmpProtocolError("OMP ready frame is unsupported or has invalid transport limits"));
				return;
			}
			this.#readyFrame = frame;
			this.#readyResolve?.(frame);
			return;
		}

		if (!isRpcResponse(frame)) return;
		if (typeof frame.id !== "string") return;
		const pending = this.#pending.get(frame.id);
		if (!pending) return;
		this.#pending.delete(frame.id);
		if (pending.settled) return;
		pending.settled = true;
		clearTimeout(pending.timer);
		if (frame.command !== pending.command) {
			pending.reject(new OmpProtocolError(`OMP response command mismatch: expected ${pending.command}, got ${frame.command}`));
			return;
		}
		if (frame.success) {
			// The negotiation ACK and the first v2 chunk can arrive in the same
			// stdout data callback.  Flip the decoder gate before the callback's
			// physical-frame loop advances to the next line.
			if (
				frame.command === "negotiate_protocol" &&
				isRecord(frame.data) &&
				frame.data.protocolVersion === OMP_RPC_PROTOCOL_VERSION
			)
				this.#protocolV2Enabled = true;
			pending.resolve(frame as RpcAck);
			return;
		}
		const failure = frame as RpcFailureResponse;
		pending.reject(new OmpCommandError(failure.error, failure.command, failure.code, failure));
	}

	/**
	 * Whether the running OMP advertised the patch command the caller is about to
	 * send. Each Cedia bridge has its own ready-frame marker because they ship
	 * under different opt-ins: a runtime with the terminal bridge but not the
	 * model-role surface must reject only the command it really lacks, instead of
	 * letting the call through to a process that would answer with an error.
	 */
	#cediaCommandAdvertised(command: string): boolean {
		const ready = this.#readyFrame;
		if (!ready) return false;
		if (command === "cedia_get_model_roles" || command === "cedia_set_model_role") return ready.cediaModelRolesVersion === 1;
		// The turn bridge names submissions and reports the queue; its identities are simply
		// absent on a runtime that never advertised it, so the command is refused here rather
		// than sent to a process that would answer with an error.
		if (command === "cedia_turn_queue") return ready.cediaTurnBridgeVersion === 1;
		// Pending model/effort acceptance is its own bridge: a runtime can hold a revision for
		// the next turn only when it says so, and the ordinary `set_model` path is unaffected.
		if (command === "cedia_pending_model") return ready.cediaPendingModelVersion === 1;
		// Goal mode is its own bridge (O07): the command reads OMP's own goal state and asks for
		// the transitions `/goal` performs, so a runtime without it must answer with the gap
		// rather than with a goal state a client would then draw.
		if (command === "cedia_goal") return ready.cediaGoalVersion === 1;
		if (command === "cedia_plan") return ready.cediaPlanVersion === 1;
		if (command === "cedia_get_auth_providers" || command === "cedia_set_api_key" || command === "cedia_logout")
			return ready.cediaAuthVersion === 1;
		// The capability table and its controlled operations are one bridge: a runtime
		// that cannot name the table cannot be asked to run an operation from it.
		if (command === "cedia_get_capabilities" || command === "cedia_control") return ready.cediaCapabilitiesVersion === 1;
		return ready.cediaVirtualUiVersion === 1;
	}

	/**
	 * Whether the running OMP advertises Cedia's turn bridge (§2.4): it echoes the identity of
	 * a named submission on that turn's boundaries and answers `cedia_turn_queue`. A runtime
	 * without it still runs every command - the host then records its own acceptance order and
	 * says so, instead of claiming OMP reported a queue it never reported.
	 */
	turnBridgeAdvertised(): boolean {
		return this.#readyFrame?.cediaTurnBridgeVersion === 1;
	}

	/**
	 * Whether the running OMP accepts a pending model/effort change (§2.4): it validates the
	 * revision now and commits it at its own turn boundary. A runtime without it keeps the
	 * ordinary model command, so the host never presents an unaccepted change as accepted.
	 */
	pendingModelAdvertised(): boolean {
		return this.#readyFrame?.cediaPendingModelVersion === 1;
	}

	/**
	 * Whether the running OMP advertises Cedia's capability table and `cedia_control` (§8.2 O04).
	 * The two ship as one bridge: a runtime that cannot name its table cannot be asked to run an
	 * operation from it, so a caller that sees `false` reports the gap instead of inventing one.
	 */
	capabilitiesAdvertised(): boolean {
		return this.#readyFrame?.cediaCapabilitiesVersion === 1;
	}

	#sendCommand<C extends RpcCommandType>(
		command: C,
		payload: RpcCommandPayload<C>,
		timeoutMs: number,
		onRequestId?: (id: string) => void,
	): Promise<RpcAck<C>> {
		if (this.#phase !== "ready" && !(this.#phase === "starting" && command === "negotiate_protocol"))
			return Promise.reject(new OmpClientStateError(`OMP client is ${this.#phase}, not ready`));
		if (!isCommandType(command) && !(this.#cediaCommandAdvertised(command) && (CEDIA_UI_COMMAND_TYPES as readonly string[]).includes(command))) return Promise.reject(new TypeError(`Unknown OMP RPC command: ${command}`));
		if (!isRecord(payload)) return Promise.reject(new TypeError("OMP RPC payload must be an object"));
		const requestId = this.#newRequestId();
		try { onRequestId?.(requestId); } catch (error) { return Promise.reject(error); }
		const frame = { ...payload, id: requestId, type: command } as OmpFrame;
		const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
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
			this.#enqueueWrite(frame, requestId).catch(error => {
				const pending = this.#pending.get(requestId);
				if (!pending || pending.settled) return;
				this.#pending.delete(requestId);
				pending.settled = true;
				clearTimeout(pending.timer);
				reject(toError(error));
			});
		});
	}

	#sendFrameWhenReady(frame: RpcClientSideFrame): Promise<void> {
		if (this.#phase !== "ready") return Promise.reject(new OmpClientStateError(`OMP client is ${this.#phase}, not ready`));
		return this.#enqueueWrite(frame);
	}

	#enqueueWrite(frame: object, requestId?: string): Promise<void> {
		const task = this.#writeQueue.then(() => {
			// Expiry/close can happen while a prior write waits for drain. An
			// undispatched command must not start later merely because stdin resumes.
			const pending = requestId === undefined ? undefined : this.#pending.get(requestId);
			if (requestId !== undefined && !pending) return;
			return this.#writeNow(frame, () => { if (pending) pending.dispatched = true; });
		});
		this.#writeQueue = task.catch(() => {});
		return task;
	}

	async #writeNow(frame: object, onDispatch?: () => void): Promise<void> {
		const child = this.#child;
		if (!child || child.stdin.destroyed || child.stdin.writableEnded)
			throw new OmpClientStateError(`OMP stdin is unavailable while client is ${this.#phase}`);
		const line = `${JSON.stringify(frame)}\n`;
		// Pinned OMP stdin accepts one logical JSONL object; rpc_chunk is output-only.
		if (Buffer.byteLength(line, "utf8") > MAX_RPC_REASSEMBLED_BYTES)
			throw new OmpProtocolError("outgoing OMP frame exceeds 64 MiB logical limit");
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const cleanup = () => {
				child.stdin.off("error", onError);
				child.stdin.off("close", onClose);
				child.stdin.off("drain", onDrain);
			};
			const settle = (error?: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (error) reject(error);
				else resolve();
			};
			const onError = (error: Error) => settle(error);
			const onClose = () => settle(new OmpClientStateError("OMP stdin closed before frame was written"));
			const onDrain = () => settle();
			child.stdin.once("error", onError);
			child.stdin.once("close", onClose);
			try {
				onDispatch?.();
				const accepted = child.stdin.write(line, "utf8");
				if (accepted) {
					cleanup();
					settled = true;
					resolve();
				} else {
					child.stdin.once("drain", onDrain);
				}
			} catch (cause) {
				settle(toError(cause));
			}
		});
	}

	#newRequestId(): string {
		const globalSequence = ++processRequestSequence;
		this.#requestCounter++;
		return `cedia_${process.pid}_${Date.now().toString(36)}_${globalSequence.toString(36)}_${this.#requestCounter.toString(36)}`;
	}

	#appendStderr(chunk: Uint8Array): void {
		if (chunk.byteLength === 0) return;
		this.#stderrChunks.push(Buffer.from(chunk));
		this.#stderrBytes += chunk.byteLength;
		const limit = this.#options.stderrLimitBytes;
		while (this.#stderrBytes > limit && this.#stderrChunks.length > 1) {
			const head = this.#stderrChunks.shift();
			if (head) this.#stderrBytes -= head.byteLength;
		}
		if (this.#stderrBytes > limit && this.#stderrChunks.length === 1) {
			const only = this.#stderrChunks[0];
			this.#stderrChunks[0] = only.subarray(only.byteLength - limit);
			this.#stderrBytes = this.#stderrChunks[0].byteLength;
		}
	}

	#onChildError(error: Error): void {
		if (this.#phase === "closing" || this.#phase === "closed") return;
		this.#failProtocol(new OmpProtocolError(`OMP process error: ${error.message}`));
	}

	#onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
		this.#exitResolve?.();
		this.#exitResolve = undefined;
		// Process exit precedes stdio close. Stop accepting commands, but retain
		// correlation and keep decoding the final stdout bytes until close.
		if (this.#phase === "closing" || this.#phase === "closed") return;
		this.#phase = "closing";
		void this.#waitForStdioClose(1_000).then(() => {
			if (!this.#stdioClosed) this.#failProtocol(new OmpProtocolError(`OMP exited (${signal ?? code}) but stdio did not close`));
		});
	}

	#onChildClose(code: number | null, signal: NodeJS.Signals | null): void {
		this.#stdioClosed = true;
		this.#stdioCloseResolve?.();
		this.#stdioCloseResolve = undefined;
		const description = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
		const error = new OmpProtocolError(`OMP process exited with ${description}${this.stderr ? `: ${this.stderr}` : ""}`);
		this.#failRequests(error);
		this.#rejectReady(error);
		this.#phase = "closed";
	}

	#failProtocol(error: Error): void {
		if (this.#readError) return;
		const protocolError = error instanceof OmpProtocolError ? error : new OmpProtocolError(error.message, { cause: error });
		this.#readError = protocolError;
		this.#failRequests(protocolError);
		this.#rejectReady(protocolError);
		if (this.#phase !== "closed") {
			// Share teardown with callers of close(). Its rejected promise remains
			// observable there, while the background initiator avoids an unhandled rejection.
			void this.close().catch(() => {});
		}
	}

	#failRequests(error: Error): void {
		for (const [id, pending] of this.#pending) {
			this.#pending.delete(id);
			if (pending.settled) continue;
			pending.settled = true;
			clearTimeout(pending.timer);
			pending.reject(error);
		}
	}

	#rejectReady(error: Error): void {
		if (!this.#readyReject) return;
		this.#readyReject(error);
		this.#readyResolve = undefined;
		this.#readyReject = undefined;
		if (this.#readyTimeout) clearTimeout(this.#readyTimeout);
		this.#readyTimeout = undefined;
	}

	async #closeProcess(): Promise<void> {
		if (this.#phase === "new") {
			this.#phase = "closed";
			return;
		}
		if (this.#phase !== "closed") this.#phase = "closing";
		const closeError = new OmpClientStateError("OMP client closed");
		this.#failRequests(closeError);
		this.#rejectReady(closeError);
		const child = this.#child;
		if (!child) {
			this.#phase = "closed";
			return;
		}
		try {
			// An instrumented owner survives stdin EOF so a crashed host can reattach.
			// Explicit close must ask that owner to dispose itself before ending stdio;
			// SIGTERM remains a bounded fallback if the private shutdown frame is lost.
			if (this.#ownerBridgeRequested && this.#phase === "closing" && !child.stdin.destroyed && !child.stdin.writableEnded) {
				try {
					child.stdin.write(`${JSON.stringify({ type: "cedia_owner_shutdown", id: `cedia_close_${++processRequestSequence}` })}\n`);
				} catch {
					// EOF and the bounded signal fallback still reap an unresponsive child.
				}
			}
			if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
		} catch {
			// Continue with process reaping if EOF cannot be written.
		}
		const shutdownGraceMs = this.#ownerBridgeRequested ? Math.max(5_000, this.#options.shutdownGraceMs) : this.#options.shutdownGraceMs;
		await this.#waitForExit(shutdownGraceMs);
		if (!this.#hasExited(child)) {
			try {
				child.kill("SIGTERM");
			} catch {
				// The process may have exited between the check and kill.
			}
			await this.#waitForExit(this.#options.shutdownGraceMs);
		}
		if (!this.#hasExited(child)) {
			try {
				child.kill("SIGKILL");
			} catch {
				// The process may have exited between the checks.
			}
			await this.#waitForExit(Math.max(1_000, this.#options.shutdownGraceMs));
		}
		if (!this.#hasExited(child)) {
			throw new OmpProtocolError(`OMP process ${child.pid} did not exit after SIGKILL; not reaped`);
		}
		// A reaped process can still have readable output, or a descendant can
		// retain its pipe. Drain normal output; make a bounded failure explicit.
		await this.#waitForStdioClose(1_000);
		const drained = this.#stdioClosed;
		child.stdin.destroy();
		child.stdout.destroy();
		child.stderr.destroy();
		this.#phase = "closed";
		if (!drained) throw new OmpProtocolError("OMP process exited but stdio drain timed out; final output may be incomplete");
	}

	#hasExited(child: ChildProcessWithoutNullStreams): boolean {
		return child.pid === undefined || child.exitCode !== null || child.signalCode !== null;
	}

	async #waitForExit(timeoutMs: number): Promise<void> {
		const exitPromise = this.#exitPromise;
		if (!exitPromise) return;
		if (this.#hasExited(this.#child!)) return;
		await this.#waitBounded(exitPromise, timeoutMs);
	}

	async #waitForStdioClose(timeoutMs: number): Promise<void> {
		if (!this.#stdioClosePromise || this.#stdioClosed) return;
		await this.#waitBounded(this.#stdioClosePromise, timeoutMs);
	}

	async #waitBounded(promise: Promise<void>, timeoutMs: number): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([promise, new Promise<void>(resolve => {
				timer = setTimeout(resolve, timeoutMs);
			})]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
}
