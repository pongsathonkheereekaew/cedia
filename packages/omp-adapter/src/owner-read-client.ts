import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { CEDIA_OWNER_BRIDGE_VERSION } from "../../protocol/src/owner.ts";

export type CediaOwnerReadCommand = "get_state" | "get_available_commands";
export interface CediaOwnerReadIdentity {
	readonly sessionId: string;
	readonly incarnation: string;
	readonly pid: number;
	readonly processStartIdentity: string;
	readonly ownerStartedAt: string;
	readonly cwd?: string;
	readonly sessionFile?: string;
}
export interface CediaOwnerReadClientOptions {
	readonly socket: string;
	readonly token: string;
	readonly protocolVersion: number;
	readonly expectedIdentity: CediaOwnerReadIdentity;
	readonly timeoutMs?: number;
}
export interface CediaOwnerReadState {
	readonly sessionId: string;
	readonly sessionName?: string;
	readonly provider?: string;
	readonly modelId?: string;
	readonly isStreaming: boolean;
	readonly isCompacting: boolean;
	readonly queuedMessageCount: number;
	readonly messageCount: number;
	readonly creditGuardEnabled: boolean;
}
export interface CediaOwnerAvailableCommands {
	readonly commands: CediaOwnerAvailableCommand[];
	readonly truncated: boolean;
}
export interface CediaOwnerAvailableCommand {
	readonly name: string;
	readonly aliases?: readonly string[];
	readonly description?: string;
	readonly inputHint?: string;
	readonly subcommands?: readonly { readonly name: string; readonly description?: string; readonly usage?: string }[];
	readonly source: "builtin" | "skill" | "extension" | "custom" | "mcp_prompt" | "file";
}

const MAX_LINE_BYTES = 32 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_PENDING = 16;
const MAX_BUFFER_BYTES = MAX_LINE_BYTES * MAX_PENDING;
const SOURCES = new Set(["builtin", "skill", "extension", "custom", "mcp_prompt", "file"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const boundedText = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;

function projectState(value: unknown): CediaOwnerReadState {
	if (!isRecord(value) || typeof value.sessionId !== "string" || typeof value.isStreaming !== "boolean" || typeof value.isCompacting !== "boolean"
		|| !Number.isSafeInteger(value.queuedMessageCount) || !Number.isSafeInteger(value.messageCount) || typeof value.creditGuardEnabled !== "boolean") {
		throw new Error("owner returned an invalid state projection");
	}
	return {
		sessionId: value.sessionId,
		...(boundedText(value.sessionName, 128) ? { sessionName: value.sessionName } : {}),
		...(boundedText(value.provider, 128) ? { provider: value.provider } : {}),
		...(boundedText(value.modelId, 128) ? { modelId: value.modelId } : {}),
		isStreaming: value.isStreaming,
		isCompacting: value.isCompacting,
		queuedMessageCount: value.queuedMessageCount as number,
		messageCount: value.messageCount as number,
		creditGuardEnabled: value.creditGuardEnabled,
	};
}

function projectCommands(value: unknown): CediaOwnerAvailableCommands {
	if (!isRecord(value) || !Array.isArray(value.commands) || typeof value.truncated !== "boolean") throw new Error("owner returned invalid available commands");
	if (value.commands.length > 32) throw new Error("owner command projection exceeded its bound");
	const commands: CediaOwnerAvailableCommand[] = [];
	for (const command of value.commands) {
		if (!isRecord(command) || !boundedText(command.name, 96) || typeof command.source !== "string" || !SOURCES.has(command.source)) throw new Error("owner returned an invalid command projection");
		if (command.aliases !== undefined && (!Array.isArray(command.aliases) || command.aliases.length > 4 || command.aliases.some(item => !boundedText(item, 64)))) throw new Error("owner returned invalid command aliases");
		if (command.description !== undefined && !boundedText(command.description, 96)) throw new Error("owner returned an invalid command description");
		if (command.input !== undefined && (!isRecord(command.input) || !boundedText(command.input.hint, 96))) throw new Error("owner returned an invalid command input hint");
		if (command.subcommands !== undefined && (!Array.isArray(command.subcommands) || command.subcommands.length > 5)) throw new Error("owner returned invalid command subcommands");
		const subcommands = (command.subcommands as unknown[] | undefined)?.map(item => {
			if (!isRecord(item) || !boundedText(item.name, 96) || (item.description !== undefined && !boundedText(item.description, 96)) || (item.usage !== undefined && !boundedText(item.usage, 64))) throw new Error("owner returned an invalid command subcommand");
			return { name: item.name, ...(item.description === undefined ? {} : { description: item.description }), ...(item.usage === undefined ? {} : { usage: item.usage }) };
		});
		commands.push({ name: command.name, ...(Array.isArray(command.aliases) && command.aliases.length ? { aliases: command.aliases as string[] } : {}), ...(command.description === undefined ? {} : { description: command.description as string }), ...(isRecord(command.input) ? { inputHint: command.input.hint as string } : {}), ...(subcommands?.length ? { subcommands } : {}), source: command.source as CediaOwnerAvailableCommand["source"] });
	}
	return { commands, truncated: value.truncated };
}

/** Authenticates and attaches to an existing owner. detach() only closes this client's socket. */
export async function attachCediaOwnerReadClient(options: CediaOwnerReadClientOptions): Promise<CediaOwnerReadClient> {
	if (options.protocolVersion !== CEDIA_OWNER_BRIDGE_VERSION || options.token.length > 256) throw new Error("unsupported or invalid owner attachment credentials");
	const socket = connect(options.socket);
	const client = new CediaOwnerReadClient(socket, options.protocolVersion, options.token, options.timeoutMs ?? 2_000);
	let connectTimer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([client.ready, new Promise<never>((_, reject) => { connectTimer = setTimeout(() => reject(new Error("owner connection timed out")), options.timeoutMs ?? 2_000); })]);
		const identity = await client.identify();
		const expected = options.expectedIdentity;
		if (identity.sessionId !== expected.sessionId || identity.incarnation !== expected.incarnation || identity.pid !== expected.pid
			|| identity.ownerStartedAt !== expected.ownerStartedAt || (expected.cwd !== undefined && identity.cwd !== expected.cwd)
			|| identity.processStartIdentity !== expected.processStartIdentity
			|| (expected.sessionFile !== undefined && identity.sessionFile !== expected.sessionFile)) throw new Error("owner identity mismatch");
		return client;
	} catch (error) {
		client.detach();
		throw error;
	} finally {
		if (connectTimer) clearTimeout(connectTimer);
	}
}

export class CediaOwnerReadClient {
	readonly #socket: Socket;
	readonly #protocolVersion: number;
	readonly #token: string;
	readonly #timeoutMs: number;
	readonly #pending = new Map<string, { command: CediaOwnerReadCommand | "identify"; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
	#buffer = Buffer.alloc(0);
	#detached = false;
	readonly ready: Promise<void>;
	#readyResolve!: () => void;
	#readyReject!: (error: Error) => void;

	constructor(socket: Socket, protocolVersion: number, token: string, timeoutMs: number) {
		this.#socket = socket;
		this.#protocolVersion = protocolVersion;
		this.#token = token;
		this.#timeoutMs = timeoutMs;
		this.ready = new Promise<void>((resolve, reject) => { this.#readyResolve = resolve; this.#readyReject = reject; });
		socket.on("connect", () => this.#readyResolve());
		socket.on("data", chunk => this.#onData(Buffer.from(chunk)));
		socket.on("error", error => this.#failAll(error));
		socket.on("close", () => this.#failAll(new Error("owner detached or disconnected")));
	}

	async identify(): Promise<CediaOwnerReadIdentity> {
		const value = await this.#request("identify");
		if (!isRecord(value) || !isRecord(value.identity)) throw new Error("owner identity response is invalid");
		const row = value.identity;
		if (typeof row.sessionId !== "string" || typeof row.incarnation !== "string" || !Number.isSafeInteger(row.pid)
			|| typeof row.ownerStartedAt !== "string" || typeof row.cwd !== "string") throw new Error("owner identity response is invalid");
		if (typeof row.processStartIdentity !== "string" || row.processStartIdentity.length === 0) throw new Error("owner identity response is invalid");
		return { sessionId: row.sessionId, incarnation: row.incarnation, pid: row.pid as number, processStartIdentity: row.processStartIdentity, ownerStartedAt: row.ownerStartedAt, cwd: row.cwd,
			...(typeof row.sessionFile === "string" ? { sessionFile: row.sessionFile } : {}) };
	}

	async getState(): Promise<CediaOwnerReadState> { return projectState(await this.#request("get_state")); }
	async getAvailableCommands(): Promise<CediaOwnerAvailableCommands> { return projectCommands(await this.#request("get_available_commands")); }

	detach(): void {
		if (this.#detached) return;
		this.#detached = true;
		this.#socket.destroy();
		this.#failAll(new Error("owner read client detached"));
	}

	#request(command: CediaOwnerReadCommand | "identify"): Promise<unknown> {
		if (this.#detached || this.#socket.destroyed) return Promise.reject(new Error("owner read client is detached"));
		if (this.#pending.size >= MAX_PENDING) return Promise.reject(new Error("owner read client capacity exceeded"));
		const id = randomUUID();
		const request = command === "identify"
			? { protocolVersion: this.#protocolVersion, token: this.#token, request: "identify", id }
			: { protocolVersion: this.#protocolVersion, token: this.#token, request: "rpc_read", command, id };
		const line = Buffer.from(`${JSON.stringify(request)}\n`, "utf8");
		if (line.byteLength > MAX_REQUEST_BYTES) return Promise.reject(new Error("owner read request too large"));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error("owner read request timed out"));
			}, this.#timeoutMs);
			this.#pending.set(id, { command, resolve, reject, timer });
			this.#socket.write(line, error => { if (error) this.#failAll(error); });
		});
	}

	#onData(chunk: Buffer): void {
		this.#buffer = Buffer.concat([this.#buffer, chunk]);
		if (this.#buffer.byteLength > MAX_BUFFER_BYTES) { this.#failAll(new Error("owner response buffer too large")); this.detach(); return; }
		for (;;) {
			const newline = this.#buffer.indexOf(0x0a);
			if (newline < 0) return;
			const line = this.#buffer.subarray(0, newline);
			this.#buffer = this.#buffer.subarray(newline + 1);
			if (line.byteLength > MAX_LINE_BYTES) { this.#failAll(new Error("owner response too large")); this.detach(); return; }
			let frame: unknown;
			try { frame = JSON.parse(line.toString("utf8")); } catch { this.#failAll(new Error("owner response was not JSON")); this.detach(); return; }
			if (!isRecord(frame) || frame.protocolVersion !== this.#protocolVersion || typeof frame.id !== "string") { this.#failAll(new Error("owner response protocol mismatch")); this.detach(); return; }
			const pending = this.#pending.get(frame.id);
			if (!pending) continue;
			this.#pending.delete(frame.id);
			clearTimeout(pending.timer);
			if (frame.ok !== true) { pending.reject(new Error(typeof frame.error === "string" ? frame.error : "owner refused read")); continue; }
			if (pending.command === "identify") pending.resolve(frame);
			else if (frame.command !== pending.command) pending.reject(new Error("owner returned a command mismatch"));
			else pending.resolve(frame.data);
		}
	}

	#failAll(error: Error): void {
		this.#readyReject(error);
		for (const [id, pending] of this.#pending) { clearTimeout(pending.timer); pending.reject(error); this.#pending.delete(id); }
	}
}
