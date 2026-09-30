import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpHistoryCheckpoint = {
	readonly messageCount: number;
	readonly entryId: string | null;
	readonly startedAt: string;
};

export type OmpHistoryLastRewind = {
	readonly report: string;
	readonly reportTruncated: boolean;
	readonly startedAt: string;
	readonly rewoundAt: string;
};

export type OmpHistoryState = {
	readonly checkpoint: OmpHistoryCheckpoint | null;
	readonly lastRewind: OmpHistoryLastRewind | null;
};

export type OmpHistoryTranscript = {
	readonly text: string;
	readonly truncated: boolean;
	readonly bytes: number;
};

export type OmpHistoryResetResult = { readonly reset: true };

export type OmpHistoryFreshResult = {
	readonly fresh: true;
	readonly providerSessionId: string | null;
};

export type OmpHistoryCommandRequest = {
	readonly commandId: string;
	readonly incarnation: string;
};

/** The clear and fresh routes use the same command envelope. */
export type OmpHistoryClearRequest = OmpHistoryCommandRequest;
export type OmpHistoryFreshRequest = OmpHistoryCommandRequest;

export type OmpHistorySnapshot =
	| { readonly state: "available"; readonly checkpoint: OmpHistoryCheckpoint | null; readonly lastRewind: OmpHistoryLastRewind | null }
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpHistoryTranscriptSnapshot =
	| ({ readonly state: "available" } & OmpHistoryTranscript)
	| { readonly state: "unavailable"; readonly reason: string };

export class OmpHistoryValidationError extends TypeError {
	readonly name = "OmpHistoryValidationError";
	readonly code = "omp_history_invalid" as const;
}

export type OmpHistoryClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_HISTORY_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's history.";
export const NO_OMP_HISTORY_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for history.";

/** These bounds are part of OMP's registered history operation contract. */
const MAX_HISTORY_REPORT_CHARS = 4_096;
const MAX_HISTORY_TRANSCRIPT_BYTES = 262_144;

function invalid(message: string): never {
	throw new OmpHistoryValidationError(message);
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

/** Parse OMP's checkpoint without filling absent fields from host state. */
export function parseOmpHistoryCheckpoint(value: unknown): OmpHistoryCheckpoint | null {
	if (value === null) return null;
	const item = record(value, "OMP history checkpoint");
	exact(item, ["messageCount", "entryId", "startedAt"], "OMP history checkpoint");
	if (!Object.hasOwn(item, "messageCount")) invalid("OMP history checkpoint has no messageCount");
	if (!Object.hasOwn(item, "entryId")) invalid("OMP history checkpoint has no entryId");
	if (!Object.hasOwn(item, "startedAt")) invalid("OMP history checkpoint has no startedAt");
	if (item.entryId !== null && typeof item.entryId !== "string") invalid("OMP history checkpoint entryId must be a string or null");
	return {
		messageCount: nonNegativeInteger(item.messageCount, "OMP history checkpoint messageCount"),
		entryId: item.entryId as string | null,
		startedAt: nonEmptyText(item.startedAt, "OMP history checkpoint startedAt"),
	};
}

/** Parse OMP's last-rewind record without changing its bounded report. */
export function parseOmpHistoryLastRewind(value: unknown): OmpHistoryLastRewind | null {
	if (value === null) return null;
	const item = record(value, "OMP history lastRewind");
	exact(item, ["report", "reportTruncated", "startedAt", "rewoundAt"], "OMP history lastRewind");
	for (const key of ["report", "reportTruncated", "startedAt", "rewoundAt"] as const) {
		if (!Object.hasOwn(item, key)) invalid(`OMP history lastRewind has no ${key}`);
	}
	const report = text(item.report, "OMP history lastRewind report");
	if (report.length > MAX_HISTORY_REPORT_CHARS) invalid(`OMP history lastRewind report exceeds ${MAX_HISTORY_REPORT_CHARS} characters`);
	return {
		report,
		reportTruncated: boolean(item.reportTruncated, "OMP history lastRewind reportTruncated"),
		startedAt: nonEmptyText(item.startedAt, "OMP history lastRewind startedAt"),
		rewoundAt: nonEmptyText(item.rewoundAt, "OMP history lastRewind rewoundAt"),
	};
}

/** Parse the complete `history.state` result. */
export function parseOmpHistoryState(value: unknown): OmpHistoryState {
	const item = record(value, "OMP history state response");
	exact(item, ["checkpoint", "lastRewind"], "OMP history state response");
	if (!Object.hasOwn(item, "checkpoint")) invalid("OMP history state response has no checkpoint");
	if (!Object.hasOwn(item, "lastRewind")) invalid("OMP history state response has no lastRewind");
	return {
		checkpoint: parseOmpHistoryCheckpoint(item.checkpoint),
		lastRewind: parseOmpHistoryLastRewind(item.lastRewind),
	};
}

/** Parse the complete `history.transcript` result, preserving OMP's own bounds. */
export function parseOmpHistoryTranscript(value: unknown): OmpHistoryTranscript {
	const item = record(value, "OMP history transcript response");
	exact(item, ["text", "truncated", "bytes"], "OMP history transcript response");
	for (const key of ["text", "truncated", "bytes"] as const) {
		if (!Object.hasOwn(item, key)) invalid(`OMP history transcript response has no ${key}`);
	}
	const transcriptText = text(item.text, "OMP history transcript text");
	const transcriptBytes = Buffer.byteLength(transcriptText, "utf8");
	if (transcriptBytes > MAX_HISTORY_TRANSCRIPT_BYTES) invalid(`OMP history transcript text exceeds ${MAX_HISTORY_TRANSCRIPT_BYTES} bytes`);
	const bytes = nonNegativeInteger(item.bytes, "OMP history transcript bytes");
	if (bytes !== transcriptBytes) invalid("OMP history transcript bytes do not match text");
	return {
		text: transcriptText,
		truncated: boolean(item.truncated, "OMP history transcript truncated"),
		bytes,
	};
}

/** Parse the exact result of `context.reset`. */
export function parseOmpHistoryResetResult(value: unknown): OmpHistoryResetResult {
	const item = record(value, "OMP history reset response");
	exact(item, ["reset"], "OMP history reset response");
	if (item.reset !== true) invalid("OMP history reset response must confirm reset");
	return { reset: true };
}

/** Alias used by callers that name the route operation `history.clear`. */
export const parseOmpHistoryClearResult = parseOmpHistoryResetResult;

/** Parse the exact result of `session.fresh`. */
export function parseOmpHistoryFreshResult(value: unknown): OmpHistoryFreshResult {
	const item = record(value, "OMP history fresh response");
	exact(item, ["fresh", "providerSessionId"], "OMP history fresh response");
	if (item.fresh !== true) invalid("OMP history fresh response must confirm fresh");
	if (item.providerSessionId !== null && typeof item.providerSessionId !== "string") invalid("OMP history fresh providerSessionId must be a string or null");
	return { fresh: true, providerSessionId: item.providerSessionId as string | null };
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpHistoryClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

async function control(client: OmpHistoryClient, operation: "history.state" | "history.transcript" | "context.reset" | "session.fresh"): Promise<unknown | undefined> {
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
	nonEmptyText(data.capabilityRevision, "Cedia control capability revision");
	if (!Object.hasOwn(data, "result") || data.result === undefined) invalid("Cedia control response has no result");
	return data.result;
}

export async function readOmpHistoryState(client: OmpHistoryClient): Promise<OmpHistoryState | undefined> {
	const result = await control(client, "history.state");
	return result === undefined ? undefined : parseOmpHistoryState(result);
}

export async function readOmpHistoryTranscript(client: OmpHistoryClient): Promise<OmpHistoryTranscript | undefined> {
	const result = await control(client, "history.transcript");
	return result === undefined ? undefined : parseOmpHistoryTranscript(result);
}

export async function resetOmpHistory(client: OmpHistoryClient): Promise<OmpHistoryResetResult | undefined> {
	const result = await control(client, "context.reset");
	return result === undefined ? undefined : parseOmpHistoryResetResult(result);
}

/** Alias for the owner-facing history clear action. */
export const clearOmpHistory = resetOmpHistory;

export async function freshOmpHistory(client: OmpHistoryClient): Promise<OmpHistoryFreshResult | undefined> {
	const result = await control(client, "session.fresh");
	return result === undefined ? undefined : parseOmpHistoryFreshResult(result);
}

/** Per-session OMP history state. Reads happen only on explicit caller requests. */
export class OmpHistory {
	#client: OmpHistoryClient | undefined;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpHistoryClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_HISTORY_RUNTIME_REASON;
	}

	setClient(client: OmpHistoryClient | undefined): void {
		const changed = this.#client !== client;
		this.#client = client;
		if (!client || changed) this.#unavailableReason = NO_OMP_HISTORY_RUNTIME_REASON;
	}

	/** Read the runtime-owned history checkpoint/rewind state. */
	async refresh(): Promise<OmpHistorySnapshot> {
		const client = this.#client;
		if (!client || client.phase !== "ready") {
			this.#unavailableReason = NO_OMP_HISTORY_RUNTIME_REASON;
			return { state: "unavailable", reason: NO_OMP_HISTORY_RUNTIME_REASON };
		}
		if (!controlAvailable(client)) {
			this.#unavailableReason = NO_OMP_HISTORY_BRIDGE_REASON;
			return { state: "unavailable", reason: NO_OMP_HISTORY_BRIDGE_REASON };
		}
		try {
			const state = await readOmpHistoryState(client);
			if (state === undefined) {
				this.#unavailableReason = NO_OMP_HISTORY_BRIDGE_REASON;
				return { state: "unavailable", reason: NO_OMP_HISTORY_BRIDGE_REASON };
			}
			this.#unavailableReason = "";
			return { state: "available", ...state };
		} catch (error) {
			this.#unavailableReason = error instanceof Error ? error.message : String(error);
			return { state: "unavailable", reason: this.#unavailableReason };
		}
	}

	/** Named alias for callers that refer to the runtime operation as `history.state`. */
	async state(): Promise<OmpHistorySnapshot> {
		return this.refresh();
	}

	/** Read the runtime-owned bounded transcript. */
	async transcript(): Promise<OmpHistoryTranscriptSnapshot> {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_HISTORY_RUNTIME_REASON };
		if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_HISTORY_BRIDGE_REASON };
		try {
			const transcript = await readOmpHistoryTranscript(client);
			if (transcript === undefined) return { state: "unavailable", reason: NO_OMP_HISTORY_BRIDGE_REASON };
			return { state: "available", ...transcript };
		} catch (error) {
			return { state: "unavailable", reason: error instanceof Error ? error.message : String(error) };
		}
	}

	/** Reset context through OMP's owner operation. */
	async reset(): Promise<OmpHistoryResetResult> {
		const client = this.#client;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_HISTORY_RUNTIME_REASON);
		if (!controlAvailable(client)) throw new Error(NO_OMP_HISTORY_BRIDGE_REASON);
		const result = await resetOmpHistory(client);
		if (result === undefined) throw new Error(NO_OMP_HISTORY_BRIDGE_REASON);
		return result;
	}

	/** Named alias for the owner-facing history clear action. */
	async clear(): Promise<OmpHistoryResetResult> {
		return this.reset();
	}

	/** Start a fresh provider session through OMP's owner operation. */
	async fresh(): Promise<OmpHistoryFreshResult> {
		const client = this.#client;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_HISTORY_RUNTIME_REASON);
		if (!controlAvailable(client)) throw new Error(NO_OMP_HISTORY_BRIDGE_REASON);
		const result = await freshOmpHistory(client);
		if (result === undefined) throw new Error(NO_OMP_HISTORY_BRIDGE_REASON);
		return result;
	}
}
