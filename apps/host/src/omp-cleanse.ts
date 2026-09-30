import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpCleanseLifecycle = "idle" | "running" | "done" | "failed";

export type OmpCleanseChecker = {
  readonly id: string;
  readonly label: string;
  readonly state: "running" | "done";
  readonly exitCode: number | null;
  readonly diagnostics: number;
  readonly durationMs: number | null;
};

export type OmpCleanseAgent = {
  readonly name: string;
  readonly files: number;
  readonly status: string;
  readonly detail: string;
};

export type OmpCleanseReport = {
  readonly status: "clean" | "unresolved" | "unsupported" | "cancelled";
  readonly checks: readonly { readonly id: string; readonly label: string; readonly language: string; readonly exitCode: number | null; readonly diagnostics: number }[];
  readonly checksTruncated: boolean;
  readonly diagnostics: readonly { readonly checker: string; readonly file?: string; readonly line?: number; readonly column?: number; readonly code?: string; readonly severity: string; readonly message: string }[];
  readonly diagnosticsTruncated: boolean;
  readonly diagnosticsTotal: number;
  readonly skipped: readonly { readonly label: string; readonly language: string; readonly reason: string }[];
};

export type OmpCleanseData = {
  readonly state: OmpCleanseLifecycle;
  readonly request: string | null;
  readonly phase: string | null;
  readonly checkers: readonly OmpCleanseChecker[];
  readonly agents: readonly OmpCleanseAgent[];
  readonly log: readonly string[];
  readonly report: OmpCleanseReport | null;
  readonly reason: string | null;
};

export type OmpCleanseSnapshot =
  | ({ readonly available: true } & OmpCleanseData)
  | { readonly available: false; readonly reason: string };

export type OmpCleanseRunCommandRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly request?: string;
  readonly all?: boolean;
  readonly includeTests?: boolean;
  readonly maxAgents?: number;
  readonly model?: string;
};

export type OmpCleanseAbortCommandRequest = {
  readonly commandId: string;
  readonly incarnation: string;
};

/** A validation failure from an OMP cleanse result. */
export class OmpCleanseValidationError extends TypeError {
  readonly name = "OmpCleanseValidationError";
  readonly code = "omp_cleanse_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpCleanseClient = {
  readonly phase: string;
  readonly readyFrame?: Record<string, unknown>;
  readonly requestCedia: (
    command: "cedia_control",
    payload: Record<string, unknown>,
  ) => Promise<{ readonly data?: unknown }>;
  readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_CLEANSE_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot run this task's cleanse.";
export const NO_OMP_CLEANSE_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for cleanse.";

function invalid(message: string): never {
  throw new OmpCleanseValidationError(message);
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

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid(`${label} must be a string or null`);
  return value;
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid(`${label} must be an integer or null`);
  return value;
}

function responseData(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
  return value;
}

function controlAvailable(client: OmpCleanseClient): boolean {
  if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
  return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

async function control(client: OmpCleanseClient, operation: "cleanse.state.get" | "cleanse.run" | "cleanse.abort", payload?: Record<string, unknown>): Promise<unknown | undefined> {
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

function parseChecker(value: unknown, index: number): OmpCleanseChecker {
  const label = `OMP cleanse checker ${index}`;
  const item = record(value, label);
  exact(item, ["id", "label", "state", "exitCode", "diagnostics", "durationMs"], label);
  const state = required(item, "state", label);
  if (state !== "running" && state !== "done") invalid(`${label} state must be running or done`);
  const exitCode = required(item, "exitCode", label);
  if (exitCode !== null && (typeof exitCode !== "number" || !Number.isSafeInteger(exitCode))) invalid(`${label} exitCode must be an integer or null`);
  const diagnostics = required(item, "diagnostics", label);
  if (typeof diagnostics !== "number" || !Number.isSafeInteger(diagnostics) || diagnostics < 0) invalid(`${label} diagnostics must be a non-negative integer`);
  const id = required(item, "id", label);
  const name = required(item, "label", label);
  if (typeof id !== "string" || id.trim().length === 0) invalid(`${label} id must be a non-empty string`);
  if (typeof name !== "string" || name.trim().length === 0) invalid(`${label} label must be a non-empty string`);
  return { id, label: name, state, exitCode, diagnostics, durationMs: nullableInteger(required(item, "durationMs", label), `${label} durationMs`) };
}

function parseAgent(value: unknown, index: number): OmpCleanseAgent {
  const label = `OMP cleanse agent ${index}`;
  const item = record(value, label);
  exact(item, ["name", "files", "status", "detail"], label);
  const name = required(item, "name", label);
  const files = required(item, "files", label);
  const status = required(item, "status", label);
  const detail = required(item, "detail", label);
  if (typeof name !== "string" || name.trim().length === 0) invalid(`${label} name must be a non-empty string`);
  if (typeof files !== "number" || !Number.isSafeInteger(files) || files < 0) invalid(`${label} files must be a non-negative integer`);
  if (typeof status !== "string" || status.trim().length === 0) invalid(`${label} status must be a non-empty string`);
  if (typeof detail !== "string") invalid(`${label} detail must be a string`);
  return { name, files, status, detail };
}

function parseReport(value: unknown): OmpCleanseReport {
  const label = "OMP cleanse report";
  const item = record(value, label);
  exact(item, ["status", "checks", "checksTruncated", "diagnostics", "diagnosticsTruncated", "diagnosticsTotal", "skipped"], label);
  const status = required(item, "status", label);
  if (status !== "clean" && status !== "unresolved" && status !== "unsupported" && status !== "cancelled") invalid(`${label} status must be a run status`);
  const rawChecks = required(item, "checks", label);
  if (!Array.isArray(rawChecks)) invalid(`${label} checks must be an array`);
  const checks = rawChecks.map((entry, index) => {
    const entryLabel = `${label} checks[${index}]`;
    const row = record(entry, entryLabel);
    exact(row, ["id", "label", "language", "exitCode", "diagnostics"], entryLabel);
    const count = required(row, "diagnostics", entryLabel);
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) invalid(`${entryLabel} diagnostics must be a non-negative integer`);
    return {
      id: text(required(row, "id", entryLabel), `${entryLabel} id`),
      label: text(required(row, "label", entryLabel), `${entryLabel} label`),
      language: text(required(row, "language", entryLabel), `${entryLabel} language`),
      exitCode: nullableInteger(required(row, "exitCode", entryLabel), `${entryLabel} exitCode`),
      diagnostics: count,
    };
  });
  const rawDiagnostics = required(item, "diagnostics", label);
  if (!Array.isArray(rawDiagnostics)) invalid(`${label} diagnostics must be an array`);
  const diagnostics = rawDiagnostics.map((entry, index) => {
    const entryLabel = `${label} diagnostics[${index}]`;
    const row = record(entry, entryLabel);
    for (const key of Object.keys(row)) {
      if (!["checker", "file", "line", "column", "code", "severity", "message"].includes(key)) invalid(`${entryLabel} has an unknown field ${key}`);
    }
    const line = row.line === undefined ? undefined : Number(row.line);
    const column = row.column === undefined ? undefined : Number(row.column);
    if (line !== undefined && (!Number.isSafeInteger(line) || line < 0)) invalid(`${entryLabel} line must be a non-negative integer`);
    if (column !== undefined && (!Number.isSafeInteger(column) || column < 0)) invalid(`${entryLabel} column must be a non-negative integer`);
    return {
      checker: text(required(row, "checker", entryLabel), `${entryLabel} checker`),
      ...(row.file === undefined ? {} : { file: text(row.file, `${entryLabel} file`) }),
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
      ...(row.code === undefined ? {} : { code: text(row.code, `${entryLabel} code`) }),
      severity: text(required(row, "severity", entryLabel), `${entryLabel} severity`),
      message: text(required(row, "message", entryLabel), `${entryLabel} message`),
    };
  });
  const rawSkipped = required(item, "skipped", label);
  if (!Array.isArray(rawSkipped)) invalid(`${label} skipped must be an array`);
  const skipped = rawSkipped.map((entry, index) => {
    const entryLabel = `${label} skipped[${index}]`;
    const row = record(entry, entryLabel);
    exact(row, ["label", "language", "reason"], entryLabel);
    return { label: text(required(row, "label", entryLabel), `${entryLabel} label`), language: text(required(row, "language", entryLabel), `${entryLabel} language`), reason: text(required(row, "reason", entryLabel), `${entryLabel} reason`) };
  });
  const diagnosticsTotal = required(item, "diagnosticsTotal", label);
  if (typeof diagnosticsTotal !== "number" || !Number.isSafeInteger(diagnosticsTotal) || diagnosticsTotal < 0) invalid(`${label} diagnosticsTotal must be a non-negative integer`);
  return {
    status,
    checks,
    checksTruncated: boolean(required(item, "checksTruncated", label), `${label} checksTruncated`),
    diagnostics,
    diagnosticsTruncated: boolean(required(item, "diagnosticsTruncated", label), `${label} diagnosticsTruncated`),
    diagnosticsTotal,
    skipped,
  };
}

/** Parse the exact result of `cleanse.state.get`/`cleanse.run`: the bounded held state. */
export function parseOmpCleanseData(value: unknown): OmpCleanseData {
  const label = "OMP cleanse response";
  const item = record(value, label);
  exact(item, ["state", "request", "phase", "checkers", "agents", "log", "report", "reason"], label);
  const state = required(item, "state", label);
  if (state !== "idle" && state !== "running" && state !== "done" && state !== "failed") invalid(`${label} state must be idle, running, done or failed`);
  const rawCheckers = required(item, "checkers", label);
  if (!Array.isArray(rawCheckers)) invalid(`${label} checkers must be an array`);
  const rawAgents = required(item, "agents", label);
  if (!Array.isArray(rawAgents)) invalid(`${label} agents must be an array`);
  const rawLog = required(item, "log", label);
  if (!Array.isArray(rawLog) || rawLog.some(line => typeof line !== "string")) invalid(`${label} log must be string lines`);
  const rawReport = required(item, "report", label);
  return {
    state,
    request: nullableText(required(item, "request", label), `${label} request`),
    phase: nullableText(required(item, "phase", label), `${label} phase`),
    checkers: rawCheckers.map((entry, index) => parseChecker(entry, index)),
    agents: rawAgents.map((entry, index) => parseAgent(entry, index)),
    log: rawLog as string[],
    report: rawReport === null ? null : parseReport(rawReport),
    reason: nullableText(required(item, "reason", label), `${label} reason`),
  };
}

/** Parse the shape persisted with a durable cleanse receipt. */
export function parseOmpCleanseCommandResult(value: unknown): OmpCleanseSnapshot {
  const item = record(value, "Cedia cleanse command result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia cleanse unavailable result");
    const reason = required(item, "reason", "Cedia cleanse unavailable result");
    if (typeof reason !== "string") invalid("Cedia cleanse unavailable reason must be a string");
    return { available: false, reason };
  }
  if (item.available !== true) invalid("Cedia cleanse result availability is unsupported");
  const { available: _available, ...data } = item;
  return { available: true, ...parseOmpCleanseData(data) };
}

/** Read the cleanse run state through the capability bridge. */
export async function readOmpCleanse(client: OmpCleanseClient): Promise<OmpCleanseData | undefined> {
  const result = await control(client, "cleanse.state.get");
  return result === undefined ? undefined : parseOmpCleanseData(result);
}

/** Start a detection plus bounded repair batch and validate the running state that follows. */
export async function runOmpCleanse(client: OmpCleanseClient, options: { request?: string; all?: boolean; includeTests?: boolean; maxAgents?: number; model?: string }): Promise<OmpCleanseData | undefined> {
  const result = await control(client, "cleanse.run", { ...options });
  return result === undefined ? undefined : parseOmpCleanseData(result);
}

/** Cancel the running cleanse batch and validate the state that follows. */
export async function abortOmpCleanse(client: OmpCleanseClient): Promise<OmpCleanseData | undefined> {
  const result = await control(client, "cleanse.abort");
  return result === undefined ? undefined : parseOmpCleanseData(result);
}

/** Per-session cleanse projection. OMP remains the owner of the run. */
export class OmpCleanse {
  #client: OmpCleanseClient | undefined;
  #cleanse: OmpCleanseData | undefined;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpCleanseClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_CLEANSE_RUNTIME_REASON;
  }

  setClient(client: OmpCleanseClient | undefined): void {
    const changed = this.#client !== client;
    this.#client = client;
    if (!client || changed) this.#clearUnavailable(NO_OMP_CLEANSE_RUNTIME_REASON);
  }

  /** Read and cache the run state without starting a runtime. */
  async read(client?: OmpCleanseClient): Promise<OmpCleanseData | undefined> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") return undefined;
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const cleanse = await readOmpCleanse(target);
    if (cleanse !== undefined) this.#set(cleanse);
    return cleanse;
  }

  /** Start a run through OMP's owner operation; answers the running state at once. */
  async run(options: { request?: string; all?: boolean; includeTests?: boolean; maxAgents?: number; model?: string }, client?: OmpCleanseClient): Promise<OmpCleanseData> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") throw new Error(NO_OMP_CLEANSE_RUNTIME_REASON);
    if (!controlAvailable(target)) throw new Error(NO_OMP_CLEANSE_BRIDGE_REASON);
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const cleanse = await runOmpCleanse(target, options);
    if (cleanse === undefined) throw new Error(NO_OMP_CLEANSE_BRIDGE_REASON);
    this.#set(cleanse);
    return cleanse;
  }

  /** Cancel the run through OMP's owner operation. */
  async abort(client?: OmpCleanseClient): Promise<OmpCleanseData> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") throw new Error(NO_OMP_CLEANSE_RUNTIME_REASON);
    if (!controlAvailable(target)) throw new Error(NO_OMP_CLEANSE_BRIDGE_REASON);
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const cleanse = await abortOmpCleanse(target);
    if (cleanse === undefined) throw new Error(NO_OMP_CLEANSE_BRIDGE_REASON);
    this.#set(cleanse);
    return cleanse;
  }

  /** Refresh the run state from an already-running runtime. */
  async refresh(): Promise<OmpCleanseSnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_CLEANSE_RUNTIME_REASON);
      return this.snapshot();
    }
    if (!controlAvailable(client)) {
      this.#clearUnavailable(NO_OMP_CLEANSE_BRIDGE_REASON);
      return this.snapshot();
    }
    try {
      const cleanse = await this.read();
      if (cleanse === undefined) this.#clearUnavailable(NO_OMP_CLEANSE_BRIDGE_REASON);
    } catch (error) {
      this.#clearUnavailable(error instanceof Error ? error.message : String(error));
    }
    return this.snapshot();
  }

  /** Alias used by runtime startup and tests that seed a per-session projection. */
  async seed(): Promise<void> {
    await this.refresh();
  }

  snapshot(): OmpCleanseSnapshot {
    const client = this.#client;
    if (!client || client.phase !== "ready") return { available: false, reason: NO_OMP_CLEANSE_RUNTIME_REASON };
    if (!controlAvailable(client)) return { available: false, reason: NO_OMP_CLEANSE_BRIDGE_REASON };
    if (this.#cleanse === undefined) return { available: false, reason: this.#unavailableReason };
    return { available: true, ...this.#cleanse };
  }

  #set(cleanse: OmpCleanseData): void {
    this.#cleanse = parseOmpCleanseData(cleanse);
    this.#unavailableReason = "";
  }

  #clearUnavailable(reason: string): void {
    this.#cleanse = undefined;
    this.#unavailableReason = reason;
  }
}
