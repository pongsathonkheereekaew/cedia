import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

/**
 * Cedia's Python execution projection (plan §8.2 O11).
 *
 * This runs code one-shot through the session's shared kernel — the same kernel the eval
 * tool collaborates on — with no chunk streaming on this path: an exec answers when it
 * finishes, is aborted, or the kernel refuses it. Rich display outputs (plots, HTML, images)
 * are reported as a count, never as embedded bytes. Aborting confirms delivery: a running
 * execution answers cancelled, and with nothing running the call is still accepted.
 * Execution runs with the kernel's own routing, environment and extension hooks; Cedia adds
 * no second routing and no second kernel.
 */
export type OmpPythonExecRequest = {
	readonly commandId: string;
	readonly incarnation: string;
	readonly code: string;
};

export type OmpPythonAbortRequest = {
	readonly commandId: string;
	readonly incarnation: string;
};

export type OmpPythonResult = {
	readonly exitCode: number | null;
	readonly output: string;
	readonly outputTruncated: boolean;
	readonly cancelled: boolean;
	readonly displayOutputs: number;
};

export type OmpPythonSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpPythonResult)
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpPythonAbortData = {
	readonly aborted: boolean;
};

export type OmpPythonAbortSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpPythonAbortData)
	| { readonly state: "unavailable"; readonly reason: string };

/** Largest code text the host forwards; longer text is refused, never cut. */
export const MAX_PYTHON_CODE_CHARS = 64 * 1024;

/** Largest execution output the host carries; the runtime truncates far below this. */
export const MAX_PYTHON_OUTPUT_CHARS = 256 * 1024;

/** A validation failure from an OMP Python execution result. */
export class OmpPythonValidationError extends TypeError {
	readonly name = "OmpPythonValidationError";
	readonly code = "omp_python_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpPythonClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_PYTHON_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot run Python code for this task.";
export const NO_OMP_PYTHON_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for Python execution.";

function invalid(message: string): never {
	throw new OmpPythonValidationError(message);
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

function exitCode(value: unknown, label: string): number | null {
	if (value === null || value === undefined) return null;
	return nonNegativeInteger(value, label);
}

/** Parse the exact result of `python.exec` without inventing rows. */
export function parseOmpPythonResult(value: unknown): OmpPythonResult {
	const label = "OMP Python result";
	const item = record(value, label);
	exact(item, ["exitCode", "output", "outputTruncated", "cancelled", "displayOutputs"], label);
	const output = text(required(item, "output", label), `${label} output`);
	if (output.length > MAX_PYTHON_OUTPUT_CHARS) invalid(`${label} output exceeds ${MAX_PYTHON_OUTPUT_CHARS} characters`);
	return {
		exitCode: exitCode(item.exitCode, `${label} exitCode`),
		output,
		outputTruncated: boolean(required(item, "outputTruncated", label), `${label} outputTruncated`),
		cancelled: boolean(required(item, "cancelled", label), `${label} cancelled`),
		displayOutputs: nonNegativeInteger(required(item, "displayOutputs", label), `${label} displayOutputs`),
	};
}

/** Parse the shape persisted with a durable Python exec receipt. */
export function parseOmpPythonCommandResult(value: unknown): OmpPythonSnapshot {
	const item = record(value, "Cedia Python command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia Python unavailable result");
		return { state: "unavailable", reason: text(required(item, "reason", "Cedia Python unavailable reason"), "Cedia Python unavailable reason") };
	}
	if (item.state !== "available") invalid("Cedia Python result state is unsupported");
	exact(item, ["state", "revision", "exitCode", "output", "outputTruncated", "cancelled", "displayOutputs"], "Cedia Python available result");
	const revision = nonNegativeInteger(required(item, "revision", "Cedia Python available result"), "Cedia Python revision");
	if (revision < 1) invalid("Cedia Python revision must be positive");
	const data = parseOmpPythonResult({
		exitCode: item.exitCode,
		output: item.output,
		outputTruncated: item.outputTruncated,
		cancelled: item.cancelled,
		displayOutputs: item.displayOutputs,
	});
	return { state: "available", revision, ...data };
}

/** Parse the shape persisted with a durable Python abort receipt. */
export function parseOmpPythonAbortCommandResult(value: unknown): OmpPythonAbortSnapshot {
	const item = record(value, "Cedia Python abort command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia Python abort unavailable result");
		return { state: "unavailable", reason: text(required(item, "reason", "Cedia Python abort unavailable reason"), "Cedia Python abort unavailable reason") };
	}
	if (item.state !== "available") invalid("Cedia Python abort result state is unsupported");
	exact(item, ["state", "revision", "aborted"], "Cedia Python abort available result");
	const revision = nonNegativeInteger(required(item, "revision", "Cedia Python abort available result"), "Cedia Python abort revision");
	if (revision < 1) invalid("Cedia Python abort revision must be positive");
	return { state: "available", revision, aborted: boolean(required(item, "aborted", "Cedia Python abort available result"), "Cedia Python abort aborted") };
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpPythonClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

/** Run one registered Python operation, answering `undefined` when the bridge is absent. */
async function control(client: OmpPythonClient, operation: "python.exec" | "python.abort", payload?: Record<string, unknown>): Promise<unknown | undefined> {
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

/** Run code through the session's shared kernel and validate the bounded answer. */
export async function execOmpPython(client: OmpPythonClient, code: string): Promise<OmpPythonResult | undefined> {
	if (typeof code !== "string" || code.trim().length === 0) throw new OmpPythonValidationError("OMP Python code must be a non-empty string");
	if (code.length > MAX_PYTHON_CODE_CHARS) throw new OmpPythonValidationError(`OMP Python code exceeds ${MAX_PYTHON_CODE_CHARS} characters`);
	const result = await control(client, "python.exec", { code });
	return result === undefined ? undefined : parseOmpPythonResult(result);
}

/**
 * Ask the session to cancel running Python execution. The answer confirms delivery: a
 * running execution answers with cancelled, and with nothing running the call is still
 * accepted. What was running is visible in the exec outcome, not here.
 */
export async function abortOmpPython(client: OmpPythonClient): Promise<OmpPythonAbortData | undefined> {
	const result = await control(client, "python.abort");
	if (result === undefined) return undefined;
	const item = record(result, "OMP Python abort response");
	exact(item, ["aborted"], "OMP Python abort response");
	return { aborted: boolean(required(item, "aborted", "OMP Python abort response"), "OMP Python abort aborted") };
}

/** Per-session Python execution projection. OMP remains the owner of the kernel. */
export class OmpPython {
	#client: OmpPythonClient | undefined;
	#result: OmpPythonResult | undefined;
	#revision = 0;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpPythonClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_PYTHON_RUNTIME_REASON;
	}

	setClient(client: OmpPythonClient | undefined): void {
		const changed = this.#client !== client;
		this.#client = client;
		if (!client || changed) this.#clearUnavailable(NO_OMP_PYTHON_RUNTIME_REASON);
	}

	/** Run code and cache the runtime's bounded answer. */
	async exec(code: string): Promise<OmpPythonResult>;
	async exec(client: OmpPythonClient, code: string): Promise<OmpPythonResult>;
	async exec(clientOrCode: OmpPythonClient | string, maybeCode?: string): Promise<OmpPythonResult> {
		const client = typeof clientOrCode === "string" ? this.#client : clientOrCode;
		const code = typeof clientOrCode === "string" ? clientOrCode : maybeCode;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_PYTHON_RUNTIME_REASON);
		if (!controlAvailable(client)) throw new Error(NO_OMP_PYTHON_BRIDGE_REASON);
		if (code === undefined) throw new OmpPythonValidationError("OMP Python code is required");
		if (typeof clientOrCode !== "string" && clientOrCode !== this.#client) this.setClient(clientOrCode);
		const result = await execOmpPython(client, code);
		if (result === undefined) throw new Error(NO_OMP_PYTHON_BRIDGE_REASON);
		this.#set(result);
		return result;
	}

	/** Ask for cancellation through OMP's owner operation. */
	async abort(): Promise<OmpPythonAbortData>;
	async abort(client: OmpPythonClient): Promise<OmpPythonAbortData>;
	async abort(client?: OmpPythonClient): Promise<OmpPythonAbortData> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") throw new Error(NO_OMP_PYTHON_RUNTIME_REASON);
		if (!controlAvailable(target)) throw new Error(NO_OMP_PYTHON_BRIDGE_REASON);
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const result = await abortOmpPython(target);
		if (result === undefined) throw new Error(NO_OMP_PYTHON_BRIDGE_REASON);
		return result;
	}

	snapshot(): { readonly state: "available"; readonly revision: number } & OmpPythonResult | { readonly state: "unavailable"; readonly reason: string } {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_PYTHON_RUNTIME_REASON };
		if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_PYTHON_BRIDGE_REASON };
		if (this.#result === undefined) return { state: "unavailable", reason: this.#unavailableReason };
		return { state: "available", revision: this.#revision, ...this.#result };
	}

	#set(result: OmpPythonResult): void {
		this.#result = parseOmpPythonResult(result);
		this.#revision += 1;
		this.#unavailableReason = "";
	}

	#clearUnavailable(reason: string): void {
		this.#result = undefined;
		this.#unavailableReason = reason;
	}
}
