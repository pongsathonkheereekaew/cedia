import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";
import type { RpcAck, RpcCommandPayload, RpcCommandType } from "../../../packages/omp-adapter/src/types.ts";

/**
 * Cedia's session-bash projection (plan §8.2 O11).
 *
 * OMP owns a foreground shell per session: the terminal's bash mode runs commands through it
 * with extension hooks, direnv handling and result ownership across transcript transitions.
 * Cedia drives the same `bash`/`abort_bash` RPC commands the terminal's mode uses — one shot,
 * no PTY streaming on this path — and projects the answered result. Output never streams here:
 * a run answers when it finishes, is aborted, or times out on OMP's own deadlines.
 *
 * What this projection deliberately does not carry: PTY viewport bytes (no virtual terminal
 * rides this path), terminal graphics bytes (reported as a count, never as embedded images),
 * and OMP-side artifact references (Cedia addresses its own captured artifacts instead).
 * The command runs with OMP's own shell routing, environment and extension hooks — the same
 * behavior the terminal's bash mode sees — in the task session's cwd.
 */
export type OmpBashExecRequest = {
	readonly commandId: string;
	readonly incarnation: string;
	readonly command: string;
};

export type OmpBashAbortRequest = {
	readonly commandId: string;
	readonly incarnation: string;
};

export type OmpBashResult = {
	readonly exitCode: number | null;
	readonly output: string;
	readonly outputTruncated: boolean;
	readonly cancelled: boolean;
	readonly timedOut: boolean;
	readonly workingDir?: string;
	readonly images: number;
};

export type OmpBashSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpBashResult)
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpBashAbortData = {
	readonly aborted: boolean;
};

export type OmpBashAbortSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpBashAbortData)
	| { readonly state: "unavailable"; readonly reason: string };

/** Largest shell command the host forwards; longer text is refused, never cut. */
export const MAX_BASH_COMMAND_CHARS = 8 * 1024;

/** Largest shell output the host carries; the runtime truncates far below this. */
export const MAX_BASH_OUTPUT_CHARS = 256 * 1024;

/** A validation failure from an OMP session-bash result. */
export class OmpBashValidationError extends TypeError {
	readonly name = "OmpBashValidationError";
	readonly code = "omp_bash_invalid" as const;
}

/** A live OMP client for the audited `bash`/`abort_bash` commands. */
export type OmpBashClient = {
	readonly phase: string;
	readonly request: <C extends RpcCommandType>(
		command: C,
		payload?: RpcCommandPayload<C>,
	) => Promise<RpcAck<C>>;
};

export const NO_OMP_BASH_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot run shell commands for this task.";

function invalid(message: string): never {
	throw new OmpBashValidationError(message);
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

function exitCode(value: unknown, label: string): number | null {
	if (value === null || value === undefined) return null;
	return nonNegativeInteger(value, label);
}

/** Parse the runtime's own `BashResult` into the bounded projection Cedia carries. */
export function parseOmpBashResult(value: unknown): OmpBashResult {
	const label = "OMP bash result";
	const item = record(value, label);
	exact(item, ["output", "exitCode", "cancelled", "timedOut", "truncated", "totalLines", "totalBytes", "outputLines", "outputBytes", "artifactId", "workingDir", "images"], label);
	const output = text(required(item, "output", label), `${label} output`);
	if (output.length > MAX_BASH_OUTPUT_CHARS) invalid(`${label} output exceeds ${MAX_BASH_OUTPUT_CHARS} characters`);
	const workingDir = item.workingDir === undefined ? undefined : nonEmptyText(item.workingDir, `${label} workingDir`);
	const images = item.images === undefined ? 0 : nonNegativeInteger((item.images as unknown[]).length ?? item.images, `${label} images`);
	return {
		exitCode: exitCode(item.exitCode, `${label} exitCode`),
		output,
		outputTruncated: boolean(required(item, "truncated", label), `${label} truncated`),
		cancelled: boolean(required(item, "cancelled", label), `${label} cancelled`),
		timedOut: item.timedOut === undefined ? false : boolean(item.timedOut, `${label} timedOut`),
		...(workingDir === undefined ? {} : { workingDir }),
		images,
	};
}

/** Parse the shape persisted with a durable bash exec receipt. */
export function parseOmpBashCommandResult(value: unknown): OmpBashSnapshot {
	const item = record(value, "Cedia bash command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia bash unavailable result");
		return { state: "unavailable", reason: text(required(item, "reason", "Cedia bash unavailable reason"), "Cedia bash unavailable reason") };
	}
	if (item.state !== "available") invalid("Cedia bash result state is unsupported");
	exact(item, ["state", "revision", "exitCode", "output", "outputTruncated", "cancelled", "timedOut", "workingDir", "images"], "Cedia bash available result");
	const revision = nonNegativeInteger(required(item, "revision", "Cedia bash available result"), "Cedia bash revision");
	if (revision < 1) invalid("Cedia bash revision must be positive");
	const data = parseOmpBashResult({
		output: item.output,
		exitCode: item.exitCode,
		cancelled: item.cancelled,
		timedOut: item.timedOut,
		truncated: item.outputTruncated,
		totalLines: 0,
		totalBytes: 0,
		outputLines: 0,
		outputBytes: 0,
		...(item.workingDir === undefined ? {} : { workingDir: item.workingDir }),
		images: item.images,
	});
	return { state: "available", revision, ...data };
}

/** Parse the shape persisted with a durable bash abort receipt. */
export function parseOmpBashAbortCommandResult(value: unknown): OmpBashAbortSnapshot {
	const item = record(value, "Cedia bash abort command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia bash abort unavailable result");
		return { state: "unavailable", reason: text(required(item, "reason", "Cedia bash abort unavailable reason"), "Cedia bash abort unavailable reason") };
	}
	if (item.state !== "available") invalid("Cedia bash abort result state is unsupported");
	exact(item, ["state", "revision", "aborted"], "Cedia bash abort available result");
	const revision = nonNegativeInteger(required(item, "revision", "Cedia bash abort available result"), "Cedia bash abort revision");
	if (revision < 1) invalid("Cedia bash abort revision must be positive");
	return { state: "available", revision, aborted: boolean(required(item, "aborted", "Cedia bash abort available result"), "Cedia bash abort aborted") };
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

/** Run one shell command through the session's own foreground bash and validate the answer. */
export async function execOmpBash(client: OmpBashClient, command: string): Promise<OmpBashResult> {
	if (typeof command !== "string" || command.trim().length === 0) throw new OmpBashValidationError("OMP bash command must be a non-empty string");
	if (command.length > MAX_BASH_COMMAND_CHARS) throw new OmpBashValidationError(`OMP bash command exceeds ${MAX_BASH_COMMAND_CHARS} characters`);
	try {
		const response = await client.request("bash", { command });
		return parseOmpBashResult(responseData(response));
	} catch (error) {
		if (error instanceof OmpClientStateError) throw new Error(NO_OMP_BASH_RUNTIME_REASON);
		throw error;
	}
}

/**
 * Ask the session to cancel running bash commands. The answer confirms delivery: running
 * commands are cancelled (an in-flight exec answers with cancelled), and with nothing running
 * the call is still accepted. What was running is visible in the exec outcome, not here.
 */
export async function abortOmpBash(client: OmpBashClient): Promise<OmpBashAbortData> {
	try {
		await client.request("abort_bash");
	} catch (error) {
		if (error instanceof OmpClientStateError) throw new Error(NO_OMP_BASH_RUNTIME_REASON);
		throw error;
	}
	return { aborted: true };
}
