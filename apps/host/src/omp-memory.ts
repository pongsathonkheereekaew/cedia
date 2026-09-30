import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpMemoryBackend = "off" | "local" | "hindsight" | "mnemopi" | "sharpshooter";

export type OmpMemoryMnemopi = {
	readonly sessionId: string;
	readonly lastRetainedTurn: number;
	readonly hasRecalledForFirstTurn: boolean;
	readonly recallTargets: number;
	readonly hasGlobalTarget: boolean;
};

export type OmpMemoryHindsight = {
	readonly sessionId: string;
	readonly bankId: string;
	readonly banksSet: number;
	readonly retainTags: number;
	readonly recallTags: number;
	readonly recallTagsMatch?: "any" | "all" | "any_strict" | "all_strict";
	readonly lastRetainedTurn: number;
	readonly hasRecalledForFirstTurn: boolean;
};

export type OmpMemoryData = {
	readonly backend: OmpMemoryBackend;
	readonly mnemopi?: OmpMemoryMnemopi;
	readonly hindsight?: OmpMemoryHindsight;
	readonly applied?: true;
};

export type OmpMemorySnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpMemoryData)
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpMemoryCommandRequest = {
	readonly commandId: string;
	readonly incarnation: string;
};

/** A validation failure from an OMP memory result. */
export class OmpMemoryValidationError extends TypeError {
	readonly name = "OmpMemoryValidationError";
	readonly code = "omp_memory_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpMemoryClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_MEMORY_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's memory.";
export const NO_OMP_MEMORY_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for memory.";

function invalid(message: string): never {
	throw new OmpMemoryValidationError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	const keys = new Set(allowed);
	for (const key of Object.keys(value)) if (!keys.has(key)) invalid(`${label} has an unknown field ${key}`);
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string") invalid(`${label} must be a string`);
	return value;
}

function nonEmptyText(value: unknown, label: string): string {
	const result = text(value, label);
	if (result.trim().length === 0) invalid(`${label} must be a non-empty string`);
	return result;
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative integer`);
	return value;
}

function parseMnemopi(value: unknown): OmpMemoryMnemopi {
	const item = record(value, "OMP memory mnemopi");
	exact(item, ["sessionId", "lastRetainedTurn", "hasRecalledForFirstTurn", "recallTargets", "hasGlobalTarget"], "OMP memory mnemopi");
	return {
		sessionId: nonEmptyText(item.sessionId, "OMP memory mnemopi sessionId"),
		lastRetainedTurn: nonNegativeInteger(item.lastRetainedTurn, "OMP memory mnemopi lastRetainedTurn"),
		hasRecalledForFirstTurn: boolean(item.hasRecalledForFirstTurn, "OMP memory mnemopi hasRecalledForFirstTurn"),
		recallTargets: nonNegativeInteger(item.recallTargets, "OMP memory mnemopi recallTargets"),
		hasGlobalTarget: boolean(item.hasGlobalTarget, "OMP memory mnemopi hasGlobalTarget"),
	};
}

function parseHindsight(value: unknown): OmpMemoryHindsight {
	const item = record(value, "OMP memory hindsight");
	exact(item, ["sessionId", "bankId", "banksSet", "retainTags", "recallTags", "recallTagsMatch", "lastRetainedTurn", "hasRecalledForFirstTurn"], "OMP memory hindsight");
	if (Object.hasOwn(item, "recallTagsMatch") && (item.recallTagsMatch !== "any" && item.recallTagsMatch !== "all" && item.recallTagsMatch !== "any_strict" && item.recallTagsMatch !== "all_strict")) invalid("OMP memory hindsight recallTagsMatch is unsupported");
	return {
		sessionId: nonEmptyText(item.sessionId, "OMP memory hindsight sessionId"),
		bankId: nonEmptyText(item.bankId, "OMP memory hindsight bankId"),
		banksSet: nonNegativeInteger(item.banksSet, "OMP memory hindsight banksSet"),
		retainTags: nonNegativeInteger(item.retainTags, "OMP memory hindsight retainTags"),
		recallTags: nonNegativeInteger(item.recallTags, "OMP memory hindsight recallTags"),
		...(Object.hasOwn(item, "recallTagsMatch") ? { recallTagsMatch: item.recallTagsMatch as OmpMemoryHindsight["recallTagsMatch"] } : {}),
		lastRetainedTurn: nonNegativeInteger(item.lastRetainedTurn, "OMP memory hindsight lastRetainedTurn"),
		hasRecalledForFirstTurn: boolean(item.hasRecalledForFirstTurn, "OMP memory hindsight hasRecalledForFirstTurn"),
	};
}

/** Parse OMP's shape-only memory projection without inventing absent backend state. */
export function parseOmpMemoryData(value: unknown): OmpMemoryData {
	const item = record(value, "OMP memory response");
	exact(item, ["backend", "mnemopi", "hindsight", "applied"], "OMP memory response");
	if (item.backend !== "off" && item.backend !== "local" && item.backend !== "hindsight" && item.backend !== "mnemopi" && item.backend !== "sharpshooter") invalid("OMP memory backend is unsupported");
	if (Object.hasOwn(item, "applied") && item.applied !== true) invalid("OMP memory applied must be true when present");
	return {
		backend: item.backend,
		...(Object.hasOwn(item, "mnemopi") ? { mnemopi: parseMnemopi(item.mnemopi) } : {}),
		...(Object.hasOwn(item, "hindsight") ? { hindsight: parseHindsight(item.hindsight) } : {}),
		...(Object.hasOwn(item, "applied") ? { applied: true } : {}),
	};
}

/** Parse the projection persisted with a durable memory apply command receipt. */
export function parseOmpMemoryCommandResult(value: unknown): OmpMemorySnapshot {
	const item = record(value, "Cedia memory command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia memory unavailable result");
		return { state: "unavailable", reason: text(item.reason, "Cedia memory unavailable reason") };
	}
	if (item.state !== "available") invalid("Cedia memory result state is unsupported");
	exact(item, ["state", "revision", "backend", "mnemopi", "hindsight", "applied"], "Cedia memory available result");
	const revision = nonNegativeInteger(item.revision, "Cedia memory revision");
	if (revision < 1) invalid("Cedia memory revision must be positive");
	const data = parseOmpMemoryData({
		backend: item.backend,
		...(Object.hasOwn(item, "mnemopi") ? { mnemopi: item.mnemopi } : {}),
		...(Object.hasOwn(item, "hindsight") ? { hindsight: item.hindsight } : {}),
		...(Object.hasOwn(item, "applied") ? { applied: item.applied } : {}),
	});
	if (data.applied !== true) invalid("Cedia memory apply result must include applied");
	return { state: "available", revision, ...data };
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpMemoryClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

/** Run one no-payload memory operation, answering `undefined` when the bridge is absent. */
async function control(client: OmpMemoryClient, operation: "memory.get" | "memory.apply"): Promise<unknown | undefined> {
	if (!controlAvailable(client)) return undefined;
	let response: { readonly data?: unknown };
	try {
		response = await client.requestCedia("cedia_control", { operation });
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

/** Read OMP's shape-only memory projection through the capability bridge. */
export async function readOmpMemory(client: OmpMemoryClient): Promise<OmpMemoryData | undefined> {
	const result = await control(client, "memory.get");
	return result === undefined ? undefined : parseOmpMemoryData(result);
}

/** Apply OMP's selected memory backend and validate the post-apply shape. */
export async function applyOmpMemory(client: OmpMemoryClient): Promise<OmpMemoryData | undefined> {
	const result = await control(client, "memory.apply");
	if (result === undefined) return undefined;
	const data = parseOmpMemoryData(result);
	if (data.applied !== true) invalid("OMP memory apply result must include applied");
	return data;
}

/** Per-session shape-only memory projection. OMP remains the owner of memory state. */
export class OmpMemory {
	#client: OmpMemoryClient | undefined;
	#memory: OmpMemoryData | undefined;
	#revision = 0;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpMemoryClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_MEMORY_RUNTIME_REASON;
	}

	setClient(client: OmpMemoryClient | undefined): void {
		const changed = this.#client !== client;
		this.#client = client;
		if (!client || changed) this.#clearUnavailable(NO_OMP_MEMORY_RUNTIME_REASON);
	}

	/** Read OMP's memory projection without starting a runtime. */
	async read(client?: OmpMemoryClient): Promise<OmpMemoryData | undefined> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") return undefined;
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const memory = await readOmpMemory(target);
		if (memory !== undefined) this.#set(memory);
		return memory;
	}

	/** Apply OMP's selected memory backend and cache the post-apply shape. */
	async apply(client?: OmpMemoryClient): Promise<OmpMemoryData | undefined> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") throw new Error(NO_OMP_MEMORY_RUNTIME_REASON);
		if (!controlAvailable(target)) throw new Error(NO_OMP_MEMORY_BRIDGE_REASON);
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const memory = await applyOmpMemory(target);
		if (memory === undefined) throw new Error(NO_OMP_MEMORY_BRIDGE_REASON);
		this.#set(memory);
		return memory;
	}

	/** Refresh the current memory projection from the already-running runtime. */
	async refresh(): Promise<OmpMemorySnapshot> {
		const client = this.#client;
		if (!client || client.phase !== "ready") {
			this.#clearUnavailable(NO_OMP_MEMORY_RUNTIME_REASON);
			return this.snapshot();
		}
		if (!controlAvailable(client)) {
			this.#clearUnavailable(NO_OMP_MEMORY_BRIDGE_REASON);
			return this.snapshot();
		}
		try {
			const memory = await this.read();
			if (memory === undefined) this.#clearUnavailable(NO_OMP_MEMORY_BRIDGE_REASON);
		} catch (error) {
			this.#clearUnavailable(error instanceof Error ? error.message : String(error));
		}
		return this.snapshot();
	}

	/** Alias used by runtime startup to seed a per-session projection. */
	async seed(): Promise<void> {
		await this.refresh();
	}

	snapshot(): OmpMemorySnapshot {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_MEMORY_RUNTIME_REASON };
		if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_MEMORY_BRIDGE_REASON };
		if (this.#memory === undefined) return { state: "unavailable", reason: this.#unavailableReason };
		return { state: "available", revision: this.#revision, ...this.#memory };
	}

	#set(memory: OmpMemoryData): void {
		this.#memory = parseOmpMemoryData(memory);
		this.#revision += 1;
		this.#unavailableReason = "";
	}

	#clearUnavailable(reason: string): void {
		this.#memory = undefined;
		this.#unavailableReason = reason;
	}
}
