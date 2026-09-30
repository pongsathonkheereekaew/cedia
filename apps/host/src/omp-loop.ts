import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpLoopData = {
	readonly enabled: boolean;
	readonly paused: boolean;
	readonly limit: string | null;
	readonly condition: string | null;
	readonly hasPrompt: boolean;
};

export type OmpLoopSnapshot =
	| ({ readonly state: "available" } & OmpLoopData)
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpLoopCommandRequest = {
	readonly commandId: string;
	readonly incarnation: string;
};

/** A validation failure from an OMP loop-mode result. */
export class OmpLoopValidationError extends TypeError {
	readonly name = "OmpLoopValidationError";
	readonly code = "omp_loop_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpLoopClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_LOOP_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read or change this task's loop mode.";
export const NO_OMP_LOOP_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for loop mode.";

function invalid(message: string): never {
	throw new OmpLoopValidationError(message);
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

function nullableText(value: unknown, label: string): string | null {
	if (value === null) return null;
	if (typeof value !== "string") invalid(`${label} must be a string or null`);
	return value;
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpLoopClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

async function control(client: OmpLoopClient, operation: "loop.state.get" | "loop.set"): Promise<unknown | undefined> {
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

/** Parse the exact result of `loop.state.get`/`loop.set`: OMP's words, bounded, no prompt text. */
export function parseOmpLoopData(value: unknown): OmpLoopData {
	const label = "OMP loop mode response";
	const item = record(value, label);
	exact(item, ["enabled", "paused", "limit", "condition", "hasPrompt"], label);
	return {
		enabled: boolean(required(item, "enabled", label), `${label} enabled`),
		paused: boolean(required(item, "paused", label), `${label} paused`),
		limit: nullableText(required(item, "limit", label), `${label} limit`),
		condition: nullableText(required(item, "condition", label), `${label} condition`),
		hasPrompt: boolean(required(item, "hasPrompt", label), `${label} hasPrompt`),
	};
}

/** Parse the shape persisted with a durable loop command receipt. */
export function parseOmpLoopCommandResult(value: unknown): OmpLoopSnapshot {
	const item = record(value, "Cedia loop command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia loop unavailable result");
		const reason = required(item, "reason", "Cedia loop unavailable result");
		if (typeof reason !== "string") invalid("Cedia loop unavailable reason must be a string");
		return { state: "unavailable", reason };
	}
	if (item.state !== "available") invalid("Cedia loop result state is unsupported");
	exact(item, ["state", "enabled", "paused", "limit", "condition", "hasPrompt"], "Cedia loop available result");
	const data = parseOmpLoopData({ enabled: item.enabled, paused: item.paused, limit: item.limit, condition: item.condition, hasPrompt: item.hasPrompt });
	return { state: "available", ...data };
}

/** Read the terminal owner's loop state through the capability bridge. */
export async function readOmpLoop(client: OmpLoopClient): Promise<OmpLoopData | undefined> {
	const result = await control(client, "loop.state.get");
	return result === undefined ? undefined : parseOmpLoopData(result);
}

/** Disable the terminal owner's loop mode and validate the state that follows. */
export async function disableOmpLoop(client: OmpLoopClient): Promise<OmpLoopData | undefined> {
	const result = await control(client, "loop.set");
	return result === undefined ? undefined : parseOmpLoopData(result);
}

/** Per-session loop-mode projection. OMP remains the owner of loop state. */
export class OmpLoop {
	#client: OmpLoopClient | undefined;
	#loop: OmpLoopData | undefined;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpLoopClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_LOOP_RUNTIME_REASON;
	}

	setClient(client: OmpLoopClient | undefined): void {
		const changed = this.#client !== client;
		this.#client = client;
		if (!client || changed) this.#clearUnavailable(NO_OMP_LOOP_RUNTIME_REASON);
	}

	/** Read and cache the loop state without starting a runtime. */
	async read(client?: OmpLoopClient): Promise<OmpLoopData | undefined> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") return undefined;
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const loop = await readOmpLoop(target);
		if (loop !== undefined) this.#set(loop);
		return loop;
	}

	/** Disable loop mode through OMP's owner operation. */
	async disable(client?: OmpLoopClient): Promise<OmpLoopData> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") throw new Error(NO_OMP_LOOP_RUNTIME_REASON);
		if (!controlAvailable(target)) throw new Error(NO_OMP_LOOP_BRIDGE_REASON);
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const loop = await disableOmpLoop(target);
		if (loop === undefined) throw new Error(NO_OMP_LOOP_BRIDGE_REASON);
		this.#set(loop);
		return loop;
	}

	/** Refresh the loop state from an already-running runtime. */
	async refresh(): Promise<OmpLoopSnapshot> {
		const client = this.#client;
		if (!client || client.phase !== "ready") {
			this.#clearUnavailable(NO_OMP_LOOP_RUNTIME_REASON);
			return this.snapshot();
		}
		if (!controlAvailable(client)) {
			this.#clearUnavailable(NO_OMP_LOOP_BRIDGE_REASON);
			return this.snapshot();
		}
		try {
			const loop = await this.read();
			if (loop === undefined) this.#clearUnavailable(NO_OMP_LOOP_BRIDGE_REASON);
		} catch (error) {
			this.#clearUnavailable(error instanceof Error ? error.message : String(error));
		}
		return this.snapshot();
	}

	/** Alias used by runtime startup and tests that seed a per-session projection. */
	async seed(): Promise<void> {
		await this.refresh();
	}

	snapshot(): OmpLoopSnapshot {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_LOOP_RUNTIME_REASON };
		if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_LOOP_BRIDGE_REASON };
		if (this.#loop === undefined) return { state: "unavailable", reason: this.#unavailableReason };
		return { state: "available", ...this.#loop };
	}

	#set(loop: OmpLoopData): void {
		this.#loop = parseOmpLoopData(loop);
		this.#unavailableReason = "";
	}

	#clearUnavailable(reason: string): void {
		this.#loop = undefined;
		this.#unavailableReason = reason;
	}
}
