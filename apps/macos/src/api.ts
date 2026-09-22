import type { ArtifactReceipt, ArtifactChunk } from "../../../packages/protocol/src/artifacts.ts";
/**
 * HTTP client for the Cedia Mac host.
 *
 * The VS Code extension is a client of the host; it never starts OMP and it
 * never sends a provider credential to the webview.  The descriptor is read
 * from the private host state directory and the bearer token is attached only
 * to requests made by this module.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type {
	ApiError,
	Command,
	CommandRequest,
	EventPage,
	HostDescriptor,
	Json,
	Project,
	Session,
	UiResponseRequest,
} from "../../../packages/protocol/src/index.ts";

export const HOST_DESCRIPTOR_FILE = "host.json";
export const HOST_API_PREFIX = "/v1";
export const DEFAULT_HOST_REQUEST_TIMEOUT_MS = 15_000;

export type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class HostDescriptorError extends Error {
	readonly code = "invalid-host-descriptor";

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "HostDescriptorError";
	}
}

export class HostHttpError extends Error {
	readonly name = "HostHttpError";
	readonly status: number;
	readonly code?: string;
	readonly requestPath: string;

	constructor(status: number, requestPath: string, message: string, code?: string) {
		super(message);
		this.status = status;
		this.requestPath = requestPath;
		this.code = code;
	}
}

export class HostRequestTimeoutError extends Error {
	readonly name = "HostRequestTimeoutError";
	readonly requestPath: string;

	constructor(requestPath: string, timeoutMs: number) {
		super(`Cedia host request timed out after ${timeoutMs}ms: ${requestPath}`);
		this.requestPath = requestPath;
	}
}

export interface CediaHostClientOptions {
	readonly descriptor: HostDescriptor;
	readonly timeoutMs?: number;
	readonly fetch?: FetchImplementation;
}

export interface HostDescriptorReadOptions {
	readonly fileName?: string;
	/** Refuse descriptors whose owner has not restricted the file. */
	readonly requirePrivateMode?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function validPid(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Validate a descriptor before its token is used. */
export function validateHostDescriptor(value: unknown): HostDescriptor {
	if (!isRecord(value)) throw new HostDescriptorError("host descriptor must be a JSON object");
	if (value.protocolVersion !== 1) {
		throw new HostDescriptorError(`unsupported host protocol version: ${String(value.protocolVersion)}`);
	}
	if (!nonEmptyString(value.url)) throw new HostDescriptorError("host descriptor url is missing");
	let parsed: URL;
	try {
		parsed = new URL(value.url);
	} catch (error) {
		throw new HostDescriptorError("host descriptor url is invalid", { cause: error });
	}
	if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
		throw new HostDescriptorError("host descriptor must identify the local 127.0.0.1 HTTP host");
	}
	if (!nonEmptyString(value.token)) throw new HostDescriptorError("host descriptor token is missing");
	if (!validPid(value.pid)) throw new HostDescriptorError("host descriptor pid is invalid");
	return {
		protocolVersion: 1,
		url: parsed.toString(),
		token: value.token,
		pid: value.pid,
	};
}

/**
 * Read the host's private descriptor.  The extension only needs read access;
 * creation, rotation and deletion remain host responsibilities.
 */
export async function readHostDescriptor(
	stateDir: string,
	options: HostDescriptorReadOptions = {},
): Promise<HostDescriptor> {
	if (!nonEmptyString(stateDir)) throw new HostDescriptorError("host state directory is missing");
	const descriptorPath = join(stateDir, options.fileName ?? HOST_DESCRIPTOR_FILE);
	let file;
	try {
		file = await stat(descriptorPath);
	} catch (error) {
		throw new HostDescriptorError(`host descriptor is unavailable: ${descriptorPath}`, { cause: error });
	}
	if (!file.isFile()) throw new HostDescriptorError("host descriptor is not a regular file");
	if (options.requirePrivateMode === true && (file.mode & 0o077) !== 0) {
		throw new HostDescriptorError("host descriptor must be private to its owner");
	}
	let text: string;
	try {
		text = await readFile(descriptorPath, "utf8");
	} catch (error) {
		throw new HostDescriptorError(`cannot read host descriptor: ${descriptorPath}`, { cause: error });
	}
	try {
		return validateHostDescriptor(JSON.parse(text) as unknown);
	} catch (error) {
		if (error instanceof HostDescriptorError) throw error;
		throw new HostDescriptorError("host descriptor is not valid JSON", { cause: error });
	}
}

function jsonValue(value: unknown): value is Json {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(jsonValue);
	if (!isRecord(value)) return false;
	return Object.values(value).every(jsonValue);
}

function asJsonRecord(value: unknown, context: string): Record<string, Json> {
	if (!isRecord(value) || !Object.entries(value).every(([key, item]) => nonEmptyString(key) && jsonValue(item))) {
		throw new TypeError(`expected a JSON object for ${context}`);
	}
	return value as Record<string, Json>;
}

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
	const entries = Object.entries(query).filter((entry): entry is [string, string | number] => entry[1] !== undefined);
	if (entries.length === 0) return path;
	const params = new URLSearchParams();
	for (const [key, value] of entries) params.set(key, String(value));
	return `${path}?${params.toString()}`;
}

function encoded(value: string): string {
	return encodeURIComponent(value);
}

function normalizePatch(patch: Record<string, unknown>): Record<string, Json> {
	const result = asJsonRecord(patch, "patch");
	if (Object.keys(result).length === 0) throw new TypeError("patch must contain at least one field");
	return result;
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Small, dependency-free client for the versioned Cedia host API.
 * Commands are caller-owned: the client generates no retry and never changes
 * command IDs, so reconnect can safely re-read `/commands` and ask the user
 * what to do with an unknown outcome.
 */
export class CediaHostClient {
	readonly descriptor: HostDescriptor;
	readonly timeoutMs: number;
	readonly #fetch: FetchImplementation;
	readonly #baseUrl: URL;

	constructor(options: CediaHostClientOptions) {
		this.descriptor = validateHostDescriptor(options.descriptor);
		this.timeoutMs = options.timeoutMs ?? DEFAULT_HOST_REQUEST_TIMEOUT_MS;
		if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 2_147_483_647) {
			throw new RangeError("timeoutMs must be an integer from 1 to 2147483647");
		}
		this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
		this.#baseUrl = new URL(this.descriptor.url);
		this.#baseUrl.pathname = `${this.#baseUrl.pathname.replace(/\/$/, "")}${HOST_API_PREFIX}/`;
	}

	static async fromStateDir(stateDir: string, options: Omit<CediaHostClientOptions, "descriptor"> & HostDescriptorReadOptions = {}): Promise<CediaHostClient> {
		const descriptor = await readHostDescriptor(stateDir, options);
		return new CediaHostClient({ descriptor, ...options });
	}

	get baseUrl(): string {
		return this.#baseUrl.toString();
	}

	private path(relative: string): string {
		return new URL(relative.replace(/^\//, ""), this.#baseUrl).toString();
	}

	health(): Promise<unknown> { return this.request("GET", "health"); }
	/** Main-process application bridge; keeps authentication and chunk verification in this client. */
	requestApplication<T = unknown>(method: string, relative: string, body?: unknown): Promise<T> {
		return this.request<T>(method, relative, body);
	}
	registerEditor(id: string, roots: string[]): Promise<unknown> { return this.request("POST", `editors/${encodeURIComponent(id)}`, { roots }); }
	editorRequests(id: string): Promise<import("../../../packages/protocol/src/editor.ts").EditorRequest[]> { return this.request("GET", `editors/${encodeURIComponent(id)}/requests`); }
	editorRequestValid(id: string, requestId: string): Promise<{ valid: boolean }> { return this.request("GET", `editors/${encodeURIComponent(id)}/requests/${encodeURIComponent(requestId)}`); }
	editorResponse(id: string, response: import("../../../packages/protocol/src/editor.ts").EditorResponse): Promise<unknown> { return this.request("POST", `editors/${encodeURIComponent(id)}/responses`, response); }
	pairDevice(name: string): Promise<unknown> { return this.request("POST", "remote/pair", { name }); }
	listDevices(): Promise<{ id: string; name: string; role: string; revokedAt?: string }[]> { return this.request("GET", "devices"); }
	revokeDevice(id: string): Promise<unknown> { return this.request("POST", `devices/${encodeURIComponent(id)}/revoke`, {}); }
	reconcileSession(id: string): Promise<Session> { return this.request("POST", `sessions/${encodeURIComponent(id)}/reconcile`, { acknowledgeUnknown: true }); }

	private async request<T>(method: string, relative: string, body?: unknown, timeoutMs?: number): Promise<T> {
		const controller = new AbortController();
		const limit = timeoutMs ?? this.timeoutMs;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_147_483_647) {
			throw new RangeError("timeoutMs must be an integer from 1 to 2147483647");
		}
		const timer = setTimeout(() => controller.abort(), limit);
		const headers = new Headers({
			Accept: "application/json",
			Authorization: `Bearer ${this.descriptor.token}`,
		});
		const init: RequestInit = { method, headers, signal: controller.signal };
		if (body !== undefined) {
			headers.set("Content-Type", "application/json");
			init.body = JSON.stringify(body);
		}
		try {
			const response = await this.#fetch(this.path(relative), init);
			const text = await response.text();
			let parsed: unknown = undefined;
			if (text.trim()) {
				try {
					parsed = JSON.parse(text) as unknown;
				} catch (error) {
					if (response.ok) throw new HostHttpError(response.status, relative, "host returned malformed JSON");
					throw new HostHttpError(response.status, relative, `host request failed (${response.status})`);
				}
			}
			if (!response.ok) {
				const apiError = isRecord(parsed) && isRecord(parsed.error) ? parsed as Partial<ApiError> : undefined;
				const detail = apiError?.error && typeof apiError.error.message === "string" ? apiError.error.message : `host request failed (${response.status})`;
				const code = apiError?.error && typeof apiError.error.code === "string" ? apiError.error.code : undefined;
				throw new HostHttpError(response.status, relative, detail, code);
			}
			if (response.status === 204 || parsed === undefined) return undefined as T;
			if (isRecord(parsed) && isRecord(parsed.cediaResponseReference)) {
				const reference = parsed.cediaResponseReference;
				if (typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(reference.sha256) || !Number.isSafeInteger(reference.length) || (reference.length as number) < 1 || (reference.length as number) > 64 * 1024 * 1024) throw new Error("Invalid response reference");
				let joined = "";
				while (joined.length < (reference.length as number)) {
					const chunk: { sha256: string; offset: number; length: number; text: string } = await this.request<{ sha256: string; offset: number; length: number; text: string }>("GET", `responses/${reference.sha256}?offset=${joined.length}`);
					if (chunk.sha256 !== reference.sha256 || chunk.offset !== joined.length || chunk.length !== reference.length || typeof chunk.text !== "string" || !chunk.text || chunk.text.length > 24_000) throw new Error("Invalid response chunk");
					joined += chunk.text;
				}
				if (joined.length !== reference.length || createHash("sha256").update(joined).digest("hex") !== reference.sha256) throw new Error("Response integrity failure");
				return JSON.parse(joined) as T;
			}
			return parsed as T;
		} catch (error) {
			if (isAbortError(error) || controller.signal.aborted) throw new HostRequestTimeoutError(relative, limit);
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	listArtifacts(sessionId: string): Promise<ArtifactReceipt[]> { return this.request("GET", `sessions/${encodeURIComponent(sessionId)}/artifacts`); }
	captureArtifact(sessionId: string, path: string): Promise<ArtifactReceipt> { return this.request("POST", `sessions/${encodeURIComponent(sessionId)}/artifacts`, { path }); }
	getArtifactChunk(sessionId: string, hash: string, offset: number): Promise<ArtifactChunk> { return this.request("GET", `sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(hash)}?offset=${offset}`); }

	listProjects(): Promise<Project[]> {
		return this.request<Project[]>("GET", "projects");
	}

	createProject(path: string, name?: string): Promise<Project> {
		if (!nonEmptyString(path)) throw new TypeError("project path is required");
		return this.request<Project>("POST", "projects", { path, ...(name?.trim() ? { name: name.trim() } : {}) });
	}

	listSessions(projectId?: string): Promise<Session[]> {
		return this.request<Session[]>("GET", withQuery("sessions", { projectId }));
	}

	createSession(input: { projectId: string; title?: string; workspaceMode?: string }): Promise<Session> {
		if (!nonEmptyString(input.projectId)) throw new TypeError("projectId is required");
		const body: Record<string, Json> = { projectId: input.projectId };
		if (input.title?.trim()) body.title = input.title.trim();
		if (input.workspaceMode?.trim()) body.workspaceMode = input.workspaceMode.trim();
		return this.request<Session>("POST", "sessions", body);
	}

	startSession(sessionId: string): Promise<Session> {
		return this.request<Session>("POST", `sessions/${encoded(sessionId)}/start`);
	}

	getSession(sessionId: string): Promise<Session> {
		return this.request<Session>("GET", `sessions/${encoded(sessionId)}`);
	}

	async getEvents(sessionId: string, after = 0, limit = 100): Promise<EventPage> {
		if (!Number.isSafeInteger(after) || after < 0) throw new RangeError("after must be a non-negative integer");
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError("limit must be between 1 and 1000");
		const page = await this.request<EventPage>("GET", withQuery(`sessions/${encoded(sessionId)}/events`, { after, limit }));
		for (const event of page.events) {
			const frame = event.frame;
			if (!isRecord(frame) || frame.type !== "cedia_frame_reference") continue;
			if (!Number.isSafeInteger(frame.length) || (frame.length as number) < 1 || (frame.length as number) > 64 * 1024 * 1024) throw new Error("Invalid event reference length");
			let text = "";
			while (text.length < (frame.length as number)) {
				const chunk = await this.request<{ offset: number; text: string; length: number; sha256: string }>("GET", withQuery(`sessions/${encoded(sessionId)}/events/${event.sequence}/frame`, { offset: text.length }));
				if (chunk.offset !== text.length || chunk.length !== frame.length || chunk.sha256 !== frame.sha256 || !chunk.text || chunk.text.length > 24_000) throw new Error("Invalid event reference chunk");
				text += chunk.text;
			}
			if (text.length !== frame.length || createHash("sha256").update(text).digest("hex") !== frame.sha256) throw new Error("Event reference integrity failure");
			event.frame = JSON.parse(text);
		}
		return page;
	}

	sendCommand(request: CommandRequest): Promise<Command>;
	sendCommand(sessionId: string, request: CommandRequest): Promise<Command>;
	sendCommand(sessionIdOrRequest: string | CommandRequest, maybeRequest?: CommandRequest): Promise<Command> {
		const sessionId = typeof sessionIdOrRequest === "string" ? sessionIdOrRequest : undefined;
		const request = typeof sessionIdOrRequest === "string" ? maybeRequest : sessionIdOrRequest;
		if (!request) throw new TypeError("command request is required");
		if (!nonEmptyString(request.commandId) || !nonEmptyString(request.incarnation) || !nonEmptyString(request.command)) {
			throw new TypeError("commandId, incarnation, and command are required");
		}
		if (request.payload !== undefined) asJsonRecord(request.payload, "command payload");
		return this.request<Command>(
			"POST",
			sessionId ? `sessions/${encoded(sessionId)}/commands` : "commands",
			request,
			request.command === "login" ? 600_000 : undefined,
		);
	}

	sendUiResponse(request: UiResponseRequest): Promise<Command | undefined>;
	sendUiResponse(sessionId: string, request: UiResponseRequest): Promise<Command | undefined>;
	sendUiResponse(sessionIdOrRequest: string | UiResponseRequest, maybeRequest?: UiResponseRequest): Promise<Command | undefined> {
		const sessionId = typeof sessionIdOrRequest === "string" ? sessionIdOrRequest : undefined;
		const request = typeof sessionIdOrRequest === "string" ? maybeRequest : sessionIdOrRequest;
		if (!request) throw new TypeError("UI response request is required");
		if (!nonEmptyString(request.commandId) || !nonEmptyString(request.incarnation) || !nonEmptyString(request.token)) {
			throw new TypeError("commandId, incarnation, and token are required");
		}
		const answer = request.answer;
		if (typeof answer !== "string" && typeof answer !== "boolean" && !(isRecord(answer) && answer.cancelled === true)) {
			throw new TypeError("UI answer must be a string, boolean, or cancelled object");
		}
		return this.request<Command | undefined>("POST", sessionId ? `sessions/${encoded(sessionId)}/ui` : "ui", request);
	}

	getPendingUi(sessionId: string): Promise<unknown[]> {
		return this.request<unknown[]>("GET", `sessions/${encoded(sessionId)}/ui`);
	}

	stopSession(sessionId: string): Promise<Session | undefined> {
		return this.request<Session | undefined>("POST", `sessions/${encoded(sessionId)}/stop`);
	}

	getCommands(sessionId: string, options: { after?: number; limit?: number } = {}): Promise<Command[]> {
		const after = options.after;
		const limit = options.limit;
		if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) throw new RangeError("after must be a non-negative integer");
		if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)) throw new RangeError("limit must be between 1 and 1000");
		return this.request<Command[]>("GET", withQuery(`sessions/${encoded(sessionId)}/commands`, { after, limit }));
	}

	patchProject(projectId: string, patch: { name?: string; archived?: boolean; pinned?: boolean }): Promise<Project> {
		return this.request<Project>("PATCH", `projects/${encoded(projectId)}`, normalizePatch(patch));
	}

	patchSession(sessionId: string, patch: { title?: string; archived?: boolean; pinned?: boolean }): Promise<Session> {
		return this.request<Session>("PATCH", `sessions/${encoded(sessionId)}`, normalizePatch(patch));
	}

	/** Removes the record and everything the host wrote for the session. */
	deleteSession(sessionId: string): Promise<unknown> {
		return this.request("DELETE", `sessions/${encoded(sessionId)}`);
	}
}
