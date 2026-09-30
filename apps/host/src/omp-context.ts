import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpContextUsage = {
	readonly contextWindow: number;
	readonly anchored: boolean;
	readonly usedTokens: number;
	readonly systemPromptTokens: number;
	readonly systemToolsTokens: number;
	readonly systemContextTokens: number;
	readonly skillsTokens: number;
	readonly messagesTokens: number;
};

export type OmpContextData = {
	readonly usage?: OmpContextUsage;
	readonly compacting: boolean;
	readonly speculation: "idle" | "running" | "armed";
	readonly removed?: number;
	readonly shake?: OmpContextShake;
};

export type OmpContextShakeMode = "elide" | "images" | "thinking";

export type OmpContextShake = {
	readonly mode: OmpContextShakeMode;
	readonly toolResultsDropped: number;
	readonly blocksDropped: number;
	readonly imagesDropped?: number;
	readonly thinkingBlocksDropped?: number;
	readonly tokensFreed: number;
	readonly artifactId?: string;
};

export type OmpContextSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpContextData)
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpContextCommandRequest = {
	readonly commandId: string;
	readonly incarnation: string;
};

export type OmpContextShakeRequest = OmpContextCommandRequest & {
	readonly mode: OmpContextShakeMode;
};

/** A validation failure from an OMP context result. */
export class OmpContextValidationError extends TypeError {
	readonly name = "OmpContextValidationError";
	readonly code = "omp_context_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpContextClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

export type OmpContextShakeSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpContextData & { readonly shake: OmpContextShake })
	| { readonly state: "unavailable"; readonly reason: string };

export const NO_OMP_CONTEXT_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's context.";
export const NO_OMP_CONTEXT_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for context.";

const USAGE_FIELDS = [
	"contextWindow",
	"anchored",
	"usedTokens",
	"systemPromptTokens",
	"systemToolsTokens",
	"systemContextTokens",
	"skillsTokens",
	"messagesTokens",
] as const;

function invalid(message: string): never {
	throw new OmpContextValidationError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	const keys = new Set(allowed);
	for (const key of Object.keys(value)) if (!keys.has(key)) invalid(`${label} has an unknown field ${key}`);
}

function finiteNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${label} must be a finite number`);
	return value;
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative integer`);
	return value;
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) invalid(`${label} must be a non-empty string`);
	return value;
}

function parseUsage(value: unknown): OmpContextUsage {
	const item = record(value, "OMP context usage");
	exact(item, USAGE_FIELDS, "OMP context usage");
	const usage = {
		contextWindow: finiteNumber(item.contextWindow, "OMP context usage contextWindow"),
		anchored: boolean(item.anchored, "OMP context usage anchored"),
		usedTokens: finiteNumber(item.usedTokens, "OMP context usage usedTokens"),
		systemPromptTokens: finiteNumber(item.systemPromptTokens, "OMP context usage systemPromptTokens"),
		systemToolsTokens: finiteNumber(item.systemToolsTokens, "OMP context usage systemToolsTokens"),
		systemContextTokens: finiteNumber(item.systemContextTokens, "OMP context usage systemContextTokens"),
		skillsTokens: finiteNumber(item.skillsTokens, "OMP context usage skillsTokens"),
		messagesTokens: finiteNumber(item.messagesTokens, "OMP context usage messagesTokens"),
	};
	return usage;
}

function parseShake(value: unknown): OmpContextShake {
	const item = record(value, "OMP context shake");
	exact(item, ["mode", "toolResultsDropped", "blocksDropped", "imagesDropped", "thinkingBlocksDropped", "tokensFreed", "artifactId"], "OMP context shake");
	if (item.mode !== "elide" && item.mode !== "images" && item.mode !== "thinking") invalid("OMP context shake mode is unsupported");
	return {
		mode: item.mode,
		toolResultsDropped: finiteNumber(item.toolResultsDropped, "OMP context shake toolResultsDropped"),
		blocksDropped: finiteNumber(item.blocksDropped, "OMP context shake blocksDropped"),
		...(Object.hasOwn(item, "imagesDropped") ? { imagesDropped: finiteNumber(item.imagesDropped, "OMP context shake imagesDropped") } : {}),
		...(Object.hasOwn(item, "thinkingBlocksDropped") ? { thinkingBlocksDropped: finiteNumber(item.thinkingBlocksDropped, "OMP context shake thinkingBlocksDropped") } : {}),
		tokensFreed: finiteNumber(item.tokensFreed, "OMP context shake tokensFreed"),
		...(Object.hasOwn(item, "artifactId") ? { artifactId: nonEmptyString(item.artifactId, "OMP context shake artifactId") } : {}),
	};
}

/** Parse the runtime's context projection without filling absent accounting with zeroes. */
export function parseOmpContextData(value: unknown): OmpContextData {
	const item = record(value, "OMP context response");
	exact(item, ["usage", "compacting", "speculation", "removed", "shake"], "OMP context response");
	if (item.usage === undefined && Object.hasOwn(item, "usage")) invalid("OMP context usage must be an object when present");
	if (item.speculation !== "idle" && item.speculation !== "running" && item.speculation !== "armed") invalid("OMP context speculation is unsupported");
	return {
		...(item.usage === undefined ? {} : { usage: parseUsage(item.usage) }),
		compacting: boolean(item.compacting, "OMP context compacting"),
		speculation: item.speculation,
		...(item.removed === undefined ? {} : { removed: nonNegativeInteger(item.removed, "OMP context removed") }),
		...(Object.hasOwn(item, "shake") ? { shake: parseShake(item.shake) } : {}),
	};
}

/** Parse the projection persisted with a durable context command receipt. */
export function parseOmpContextCommandResult(value: unknown): OmpContextSnapshot {
	const item = record(value, "Cedia context command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia context unavailable result");
		if (typeof item.reason !== "string") invalid("Cedia context unavailable reason must be a string");
		return { state: "unavailable", reason: item.reason };
	}
	if (item.state !== "available") invalid("Cedia context result state is unsupported");
	exact(item, ["state", "revision", "usage", "compacting", "speculation", "removed", "shake"], "Cedia context available result");
	if (typeof item.revision !== "number" || !Number.isSafeInteger(item.revision) || item.revision < 1) invalid("Cedia context revision must be a positive integer");
	const data = parseOmpContextData({
		...(item.usage === undefined ? {} : { usage: item.usage }),
		compacting: item.compacting,
		speculation: item.speculation,
		...(item.removed === undefined ? {} : { removed: item.removed }),
		...(Object.hasOwn(item, "shake") ? { shake: item.shake } : {}),
	});
	return { state: "available", revision: item.revision, ...data };
}

/** Parse a durable context shake receipt, requiring the runtime's own shake result. */
export function parseOmpContextShakeCommandResult(value: unknown): OmpContextShakeSnapshot {
	const result = parseOmpContextCommandResult(value);
	if (result.state === "available" && result.shake === undefined) invalid("Cedia context shake result must include shake");
	return result as OmpContextShakeSnapshot;
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpContextClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

/** Run one registered context operation, answering `undefined` when the bridge is absent. */
async function control(client: OmpContextClient, operation: "context.get" | "context.drop-images" | "context.abort-compaction" | "context.shake", payload?: Record<string, unknown>): Promise<unknown | undefined> {
	if (!controlAvailable(client)) return undefined;
	let response: { readonly data?: unknown };
	try {
		response = await client.requestCedia("cedia_control", { operation, ...(payload === undefined ? {} : { payload }) });
	} catch (error) {
		if (error instanceof OmpClientStateError) return undefined;
		throw error;
	}
	const data = record(responseData(response), "Cedia control response");
	exact(data, ["operation", "capabilityRevision", "result"], "Cedia control response");
	if (data.operation !== operation) invalid(`Cedia control answered ${String(data.operation)} for ${operation}`);
	if (typeof data.capabilityRevision !== "string" || data.capabilityRevision.trim().length === 0) invalid("Cedia control capability revision must be a non-empty string");
	if (!Object.hasOwn(data, "result") || data.result === undefined) invalid("Cedia control response has no result");
	return data.result;
}

/** Read OMP's context projection through the capability bridge. */
export async function readOmpContext(client: OmpContextClient): Promise<OmpContextData | undefined> {
	const result = await control(client, "context.get");
	return result === undefined ? undefined : parseOmpContextData(result);
}

/** Remove image content through OMP and validate the resulting projection. */
export async function dropOmpContextImages(client: OmpContextClient): Promise<OmpContextData | undefined> {
	const result = await control(client, "context.drop-images");
	if (result === undefined) return undefined;
	const context = parseOmpContextData(result);
	if (context.removed === undefined) invalid("OMP context drop result must include removed");
	return context;
}

/** Request OMP to abort compaction and validate its post-request projection. */
export async function abortOmpContextCompaction(client: OmpContextClient): Promise<OmpContextData | undefined> {
	const result = await control(client, "context.abort-compaction");
	return result === undefined ? undefined : parseOmpContextData(result);
}

/** Reduce stored context through OMP and require the runtime's own result beside its new state. */
export async function shakeOmpContext(client: OmpContextClient, mode: OmpContextShakeMode): Promise<OmpContextData | undefined> {
	if (mode !== "elide" && mode !== "images" && mode !== "thinking") throw new OmpContextValidationError("OMP context shake mode must be elide, images or thinking");
	const result = await control(client, "context.shake", { mode });
	if (result === undefined) return undefined;
	const context = parseOmpContextData(result);
	if (context.shake === undefined) invalid("OMP context shake result must include shake");
	return context;
}

/** Per-session context projection. OMP remains the owner of accounting and maintenance state. */
export class OmpContext {
	#client: OmpContextClient | undefined;
	#context: OmpContextData | undefined;
	#revision = 0;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpContextClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_CONTEXT_RUNTIME_REASON;
	}

	setClient(client: OmpContextClient | undefined): void {
		const changed = this.#client !== client;
		this.#client = client;
		if (!client || changed) this.#clearUnavailable(NO_OMP_CONTEXT_RUNTIME_REASON);
	}

	/** Read OMP's current context without starting a runtime. */
	async read(client?: OmpContextClient): Promise<OmpContextData | undefined> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") return undefined;
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const context = await readOmpContext(target);
		if (context !== undefined) this.#set(context);
		return context;
	}

	/** Remove image content and cache the runtime's post-drop projection. */
	async dropImages(client?: OmpContextClient): Promise<OmpContextData | undefined> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") throw new Error(NO_OMP_CONTEXT_RUNTIME_REASON);
		if (!controlAvailable(target)) throw new Error(NO_OMP_CONTEXT_BRIDGE_REASON);
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const context = await dropOmpContextImages(target);
		if (context === undefined) throw new Error(NO_OMP_CONTEXT_BRIDGE_REASON);
		this.#set(context);
		return context;
	}

	/** Ask OMP to cancel compaction and cache the state that follows the request. */
	async abortCompaction(client?: OmpContextClient): Promise<OmpContextData | undefined> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") throw new Error(NO_OMP_CONTEXT_RUNTIME_REASON);
		if (!controlAvailable(target)) throw new Error(NO_OMP_CONTEXT_BRIDGE_REASON);
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const context = await abortOmpContextCompaction(target);
		if (context === undefined) throw new Error(NO_OMP_CONTEXT_BRIDGE_REASON);
		this.#set(context);
		return context;
	}

	/** Run OMP's selected context reduction strategy and cache its post-request projection. */
	async shake(mode: OmpContextShakeMode): Promise<OmpContextData | undefined>;
	async shake(client: OmpContextClient, mode: OmpContextShakeMode): Promise<OmpContextData | undefined>;
	async shake(clientOrMode: OmpContextClient | OmpContextShakeMode, maybeMode?: OmpContextShakeMode): Promise<OmpContextData | undefined> {
		const client = typeof clientOrMode === "string" ? this.#client : clientOrMode;
		const mode = typeof clientOrMode === "string" ? clientOrMode : maybeMode;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_CONTEXT_RUNTIME_REASON);
		if (!controlAvailable(client)) throw new Error(NO_OMP_CONTEXT_BRIDGE_REASON);
		if (mode === undefined) throw new OmpContextValidationError("OMP context shake mode is required");
		if (typeof clientOrMode !== "string" && clientOrMode !== this.#client) this.setClient(clientOrMode);
		const context = await shakeOmpContext(client, mode);
		if (context === undefined) throw new Error(NO_OMP_CONTEXT_BRIDGE_REASON);
		this.#set(context);
		return context;
	}

	/** Refresh the context from an already-running runtime. */
	async refresh(): Promise<OmpContextSnapshot> {
		const client = this.#client;
		if (!client || client.phase !== "ready") {
			this.#clearUnavailable(NO_OMP_CONTEXT_RUNTIME_REASON);
			return this.snapshot();
		}
		if (!controlAvailable(client)) {
			this.#clearUnavailable(NO_OMP_CONTEXT_BRIDGE_REASON);
			return this.snapshot();
		}
		try {
			const context = await this.read();
			if (context === undefined) this.#clearUnavailable(NO_OMP_CONTEXT_BRIDGE_REASON);
		} catch (error) {
			this.#clearUnavailable(error instanceof Error ? error.message : String(error));
		}
		return this.snapshot();
	}

	/** Alias used by runtime startup and tests that seed a per-session projection. */
	async seed(): Promise<void> {
		await this.refresh();
	}

	snapshot(): OmpContextSnapshot {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_CONTEXT_RUNTIME_REASON };
		if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_CONTEXT_BRIDGE_REASON };
		if (this.#context === undefined) return { state: "unavailable", reason: this.#unavailableReason };
		return { state: "available", revision: this.#revision, ...this.#context };
	}

	#set(context: OmpContextData): void {
		this.#context = parseOmpContextData(context);
		this.#revision += 1;
		this.#unavailableReason = "";
	}

	#clearUnavailable(reason: string): void {
		this.#context = undefined;
		this.#unavailableReason = reason;
	}
}
