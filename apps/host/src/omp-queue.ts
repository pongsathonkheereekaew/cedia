import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpQueueDropMode = "last" | "all";

export type QueueRow = {
	readonly text: string;
	readonly truncated: boolean;
	readonly images: number;
};

export type OmpQueueData = {
	readonly steering: readonly QueueRow[];
	readonly followUp: readonly QueueRow[];
	readonly dropped?: readonly QueueRow[];
};

/** Internal queue-drop result used by the host to settle exactly the removed turn intents. */
export type OmpQueueDropOutcome = OmpQueueData & { readonly droppedIntentIds: readonly string[] };

export type OmpQueueSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpQueueData)
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpQueueDropRequest = {
	readonly commandId: string;
	readonly incarnation: string;
	readonly mode: OmpQueueDropMode;
};

export type OmpQueueRowAddress = "steering" | "followUp";

export type OmpQueueRemoveRequest = {
	readonly commandId: string;
	readonly incarnation: string;
	/** Full row text (rows display up to 4,096 chars; longer submissions use drop last/all). */
	readonly message: string;
	readonly queue: OmpQueueRowAddress;
};

export type OmpQueuePromoteRequest = {
	readonly commandId: string;
	readonly incarnation: string;
	/** Full row text of a follow-up row to move into steering. */
	readonly message: string;
};

/** A validation failure from an OMP queue result. */
export class OmpQueueValidationError extends TypeError {
	readonly name = "OmpQueueValidationError";
	readonly code = "omp_queue_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpQueueClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_QUEUE_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's queue.";
export const NO_OMP_QUEUE_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for the queue.";

const MAX_QUEUE_ITEMS = 50;
const MAX_QUEUE_DROP_IDENTITIES = 10_000;
const MAX_QUEUE_TEXT_CHARS = 4_096;

function invalid(message: string): never {
	throw new OmpQueueValidationError(message);
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

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative integer`);
	return value;
}

function parseRow(value: unknown, side: string, index: number): QueueRow {
	const label = `OMP queue ${side} row ${index}`;
	const item = record(value, label);
	exact(item, ["text", "truncated", "images"], label);
	const rowText = text(item.text, `${label} text`);
	if (rowText.length > MAX_QUEUE_TEXT_CHARS) invalid(`${label} text exceeds ${MAX_QUEUE_TEXT_CHARS} characters`);
	return {
		text: rowText,
		truncated: boolean(item.truncated, `${label} truncated`),
		images: nonNegativeInteger(item.images, `${label} images`),
	};
}

function parseRows(value: unknown, side: string): readonly QueueRow[] {
	if (!Array.isArray(value)) invalid(`OMP queue ${side} must be an array`);
	if (value.length > MAX_QUEUE_ITEMS) invalid(`OMP queue ${side} exceeds ${MAX_QUEUE_ITEMS} rows`);
	return value.map((row, index) => parseRow(row, side, index));
}

/** Parse the complete `queue.get`/`queue.drop` result without inventing missing rows. */
export function parseOmpQueueData(value: unknown): OmpQueueData {
	const item = record(value, "OMP queue response");
	exact(item, ["steering", "followUp", "dropped"], "OMP queue response");
	return {
		steering: parseRows(item.steering, "steering"),
		followUp: parseRows(item.followUp, "followUp"),
		...(item.dropped === undefined ? {} : { dropped: parseRows(item.dropped, "dropped") }),
	};
}

/** Parse the owner-only queue-drop result, including identities that are never projected to a window. */
export function parseOmpQueueDropOutcome(value: unknown): OmpQueueDropOutcome {
	const item = record(value, "OMP queue drop response");
	exact(item, ["steering", "followUp", "dropped", "droppedIntentIds"], "OMP queue drop response");
	const data = parseOmpQueueData({
		steering: item.steering,
		followUp: item.followUp,
		...(item.dropped === undefined ? {} : { dropped: item.dropped }),
	});
	if (!Array.isArray(item.droppedIntentIds) || item.droppedIntentIds.length > MAX_QUEUE_DROP_IDENTITIES) invalid(`OMP queue drop identities exceed ${MAX_QUEUE_DROP_IDENTITIES}`);
	const droppedIntentIds = item.droppedIntentIds.map((value, index) => {
		if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) invalid(`OMP queue drop identity ${index} must be a non-empty bounded string`);
		return value;
	});
	if (new Set(droppedIntentIds).size !== droppedIntentIds.length) invalid("OMP queue drop identities must be unique");
	return { ...data, droppedIntentIds };
}

/** Parse the projection persisted with a durable queue drop command receipt. */
export function parseOmpQueueCommandResult(value: unknown): OmpQueueSnapshot {
	const item = record(value, "Cedia queue command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia queue unavailable result");
		return { state: "unavailable", reason: text(item.reason, "Cedia queue unavailable reason") };
	}
	if (item.state !== "available") invalid("Cedia queue result state is unsupported");
	exact(item, ["state", "revision", "steering", "followUp", "dropped"], "Cedia queue available result");
	const revision = nonNegativeInteger(item.revision, "Cedia queue revision");
	if (revision < 1) invalid("Cedia queue revision must be positive");
	const data = parseOmpQueueData({
		steering: item.steering,
		followUp: item.followUp,
		...(item.dropped === undefined ? {} : { dropped: item.dropped }),
	});
	return { state: "available", revision, ...data };
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpQueueClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

/** Run one registered queue operation, answering `undefined` when the bridge is absent. */
async function control(client: OmpQueueClient, operation: string, payload?: Record<string, unknown>): Promise<unknown | undefined> {
	if (!controlAvailable(client)) return undefined;
	let response: { readonly data?: unknown };
	try {
		response = await client.requestCedia("cedia_control", {
			operation,
			...(payload === undefined ? {} : { payload }),
		});
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

/** Read OMP's queue snapshot through the capability bridge. */
export async function readOmpQueue(client: OmpQueueClient): Promise<OmpQueueData | undefined> {
	const result = await control(client, "queue.get");
	return result === undefined ? undefined : parseOmpQueueData(result);
}

/** Remove queued submissions through OMP and validate the resulting snapshot. */
export async function dropOmpQueue(client: OmpQueueClient, mode: OmpQueueDropMode): Promise<OmpQueueDropOutcome | undefined> {
	if (mode !== "last" && mode !== "all") throw new OmpQueueValidationError("OMP queue drop mode must be last or all");
	const result = await control(client, "queue.drop", { mode });
	return result === undefined ? undefined : parseOmpQueueDropOutcome(result);
}

/** Per-session queue projection. OMP remains the sole queue owner. */
export class OmpQueue {
	#client: OmpQueueClient | undefined;
	#queue: OmpQueueData | undefined;
	#revision = 0;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpQueueClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_QUEUE_RUNTIME_REASON;
	}

	setClient(client: OmpQueueClient | undefined): void {
		const changed = this.#client !== client;
		this.#client = client;
		if (!client || changed) this.#clearUnavailable(NO_OMP_QUEUE_RUNTIME_REASON);
	}

	/** Read and cache OMP's current queue without starting a runtime. */
	async read(client?: OmpQueueClient): Promise<OmpQueueData | undefined> {
		const target = client ?? this.#client;
		if (!target) return undefined;
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const queue = await readOmpQueue(target);
		if (queue !== undefined) this.#set(queue);
		return queue;
	}

	/** Remove queued submissions and cache the runtime's post-drop projection. */
	async drop(mode: OmpQueueDropMode): Promise<OmpQueueDropOutcome>;
	async drop(client: OmpQueueClient, mode: OmpQueueDropMode): Promise<OmpQueueDropOutcome>;
	async drop(clientOrMode: OmpQueueClient | OmpQueueDropMode, maybeMode?: OmpQueueDropMode): Promise<OmpQueueDropOutcome> {
		const client = typeof clientOrMode === "string" ? this.#client : clientOrMode;
		const mode = typeof clientOrMode === "string" ? clientOrMode : maybeMode;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_QUEUE_RUNTIME_REASON);
		if (!controlAvailable(client)) throw new Error(NO_OMP_QUEUE_BRIDGE_REASON);
		if (mode === undefined) throw new OmpQueueValidationError("OMP queue drop mode is required");
		if (typeof clientOrMode !== "string" && clientOrMode !== this.#client) this.setClient(clientOrMode);
		const queue = await dropOmpQueue(client, mode);
		if (queue === undefined) throw new Error(NO_OMP_QUEUE_BRIDGE_REASON);
		this.#set({ steering: queue.steering, followUp: queue.followUp, ...(queue.dropped === undefined ? {} : { dropped: queue.dropped }) });
		return queue;
	}

	/** Refresh the current queue from the already-running runtime. */
	async refresh(): Promise<OmpQueueSnapshot> {
		const client = this.#client;
		if (!client || client.phase !== "ready") {
			this.#clearUnavailable(NO_OMP_QUEUE_RUNTIME_REASON);
			return this.snapshot();
		}
		if (!controlAvailable(client)) {
			this.#clearUnavailable(NO_OMP_QUEUE_BRIDGE_REASON);
			return this.snapshot();
		}
		try {
			const queue = await this.read();
			if (queue === undefined) this.#clearUnavailable(NO_OMP_QUEUE_BRIDGE_REASON);
		} catch (error) {
			this.#clearUnavailable(error instanceof Error ? error.message : String(error));
		}
		return this.snapshot();
	}

	/** Alias used by runtime startup and tests that seed a per-session projection. */
	async seed(): Promise<void> {
		await this.refresh();
	}

	snapshot(): OmpQueueSnapshot {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_QUEUE_RUNTIME_REASON };
		if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_QUEUE_BRIDGE_REASON };
		if (this.#queue === undefined) return { state: "unavailable", reason: this.#unavailableReason };
		return { state: "available", revision: this.#revision, ...this.#queue };
	}

	#set(queue: OmpQueueData): void {
		this.#queue = parseOmpQueueData(queue);
		this.#revision += 1;
		this.#unavailableReason = "";
	}

	#clearUnavailable(reason: string): void {
		this.#queue = undefined;
		this.#unavailableReason = reason;
	}
}
