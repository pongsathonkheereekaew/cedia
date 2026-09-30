import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpPauseData = {
	readonly paused: boolean;
	readonly pausedAt?: number;
};

export type OmpPauseSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpPauseData)
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpPauseCommandRequest = {
	readonly commandId: string;
	readonly incarnation: string;
	readonly paused: boolean;
};

/** A validation failure from an OMP run-pause result. */
export class OmpPauseValidationError extends TypeError {
	readonly name = "OmpPauseValidationError";
	readonly code = "omp_pause_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpPauseClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_PAUSE_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read or change this task's run pause.";
export const NO_OMP_PAUSE_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for run pause.";

function invalid(message: string): never {
	throw new OmpPauseValidationError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	const keys = new Set(allowed);
	for (const key of Object.keys(value)) if (!keys.has(key)) invalid(`${label} has an unknown field ${key}`);
}

function required(value: Record<string, unknown>, key: string, label: string): unknown {
	if (!Object.hasOwn(value, key)) invalid(`${label} has no ${key}`);
	return value[key];
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
	return value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string") invalid(`${label} must be a string`);
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative integer`);
	return value;
}

/** Parse the exact result of `pause.get`/`pause.set`: the gate as it stands, nothing derived. */
export function parseOmpPauseData(value: unknown): OmpPauseData {
	const label = "OMP run pause response";
	const item = record(value, label);
	exact(item, ["paused", "pausedAt"], label);
	const paused = boolean(required(item, "paused", label), `${label} paused`);
	if (item.pausedAt === undefined) return { paused };
	return { paused, pausedAt: nonNegativeInteger(item.pausedAt, `${label} pausedAt`) };
}

/** Parse the shape persisted with a durable pause command receipt. */
export function parseOmpPauseCommandResult(value: unknown): OmpPauseSnapshot {
	const item = record(value, "Cedia run pause command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia run pause unavailable result");
		return { state: "unavailable", reason: text(required(item, "reason", "Cedia run pause unavailable result"), "Cedia run pause unavailable reason") };
	}
	if (item.state !== "available") invalid("Cedia run pause result state is unsupported");
	exact(item, ["state", "revision", "paused", "pausedAt"], "Cedia run pause available result");
	const revision = nonNegativeInteger(required(item, "revision", "Cedia run pause available result"), "Cedia run pause revision");
	if (revision < 1) invalid("Cedia run pause revision must be positive");
	const data = parseOmpPauseData({ paused: item.paused, pausedAt: item.pausedAt });
	return { state: "available", revision, ...data };
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpPauseClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

/** Run one registered run-pause operation, answering `undefined` when the bridge is absent. */
async function control(client: OmpPauseClient, operation: "pause.get" | "pause.set", payload?: Record<string, unknown>): Promise<unknown | undefined> {
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

/** Read the process run-pause gate through the capability bridge. */
export async function readOmpPause(client: OmpPauseClient): Promise<OmpPauseData | undefined> {
	const result = await control(client, "pause.get");
	return result === undefined ? undefined : parseOmpPauseData(result);
}

/** Engage or release the process run-pause gate and validate the state that follows. */
export async function setOmpPause(client: OmpPauseClient, paused: boolean): Promise<OmpPauseData | undefined> {
	if (typeof paused !== "boolean") throw new OmpPauseValidationError("OMP run pause must be a boolean");
	const result = await control(client, "pause.set", { paused });
	return result === undefined ? undefined : parseOmpPauseData(result);
}

/** Per-session run-pause projection. OMP remains the owner of the gate. */
export class OmpPause {
	#client: OmpPauseClient | undefined;
	#pause: OmpPauseData | undefined;
	#revision = 0;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpPauseClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_PAUSE_RUNTIME_REASON;
	}

	setClient(client: OmpPauseClient | undefined): void {
		const changed = this.#client !== client;
		this.#client = client;
		if (!client || changed) this.#clearUnavailable(NO_OMP_PAUSE_RUNTIME_REASON);
	}

	/** Read and cache the gate without starting a runtime. */
	async read(client?: OmpPauseClient): Promise<OmpPauseData | undefined> {
		const target = client ?? this.#client;
		if (!target) return undefined;
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const pause = await readOmpPause(target);
		if (pause !== undefined) this.#set(pause);
		return pause;
	}

	/** Engage or release the gate through OMP's owner operation. */
	async set(paused: boolean): Promise<OmpPauseData>;
	async set(client: OmpPauseClient, paused: boolean): Promise<OmpPauseData>;
	async set(clientOrPaused: OmpPauseClient | boolean, maybePaused?: boolean): Promise<OmpPauseData> {
		const client = typeof clientOrPaused === "boolean" ? this.#client : clientOrPaused;
		const paused = typeof clientOrPaused === "boolean" ? clientOrPaused : maybePaused;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_PAUSE_RUNTIME_REASON);
		if (!controlAvailable(client)) throw new Error(NO_OMP_PAUSE_BRIDGE_REASON);
		if (paused === undefined) throw new OmpPauseValidationError("OMP run pause must be a boolean");
		if (typeof clientOrPaused !== "boolean" && clientOrPaused !== this.#client) this.setClient(clientOrPaused);
		const pause = await setOmpPause(client, paused);
		if (pause === undefined) throw new Error(NO_OMP_PAUSE_BRIDGE_REASON);
		this.#set(pause);
		return pause;
	}

	/** Refresh the pause state from an already-running runtime. */
	async refresh(): Promise<OmpPauseSnapshot> {
		const client = this.#client;
		if (!client || client.phase !== "ready") {
			this.#clearUnavailable(NO_OMP_PAUSE_RUNTIME_REASON);
			return this.snapshot();
		}
		if (!controlAvailable(client)) {
			this.#clearUnavailable(NO_OMP_PAUSE_BRIDGE_REASON);
			return this.snapshot();
		}
		try {
			const pause = await this.read();
			if (pause === undefined) this.#clearUnavailable(NO_OMP_PAUSE_BRIDGE_REASON);
		} catch (error) {
			this.#clearUnavailable(error instanceof Error ? error.message : String(error));
		}
		return this.snapshot();
	}

	/** Alias used by runtime startup and tests that seed a per-session projection. */
	async seed(): Promise<void> {
		await this.refresh();
	}

	snapshot(): OmpPauseSnapshot {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_PAUSE_RUNTIME_REASON };
		if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_PAUSE_BRIDGE_REASON };
		if (this.#pause === undefined) return { state: "unavailable", reason: this.#unavailableReason };
		return { state: "available", revision: this.#revision, ...this.#pause };
	}

	#set(pause: OmpPauseData): void {
		this.#pause = parseOmpPauseData(pause);
		this.#revision += 1;
		this.#unavailableReason = "";
	}

	#clearUnavailable(reason: string): void {
		this.#pause = undefined;
		this.#unavailableReason = reason;
	}
}
