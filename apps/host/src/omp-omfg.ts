import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpOmfgLifecycle = "idle" | "drafting" | "ready" | "failed";

export type OmpOmfgData = {
  readonly state: OmpOmfgLifecycle;
  readonly complaint: string | null;
  readonly complaintTruncated: boolean;
  readonly draft: string | null;
  readonly draftTruncated: boolean;
  readonly ruleName: string | null;
  readonly validated: boolean;
  readonly validationFeedback: string | null;
  readonly savedPath: string | null;
  readonly reason: string | null;
};

export type OmpOmfgSnapshot =
  | ({ readonly available: true } & OmpOmfgData)
  | { readonly available: false; readonly reason: string };

export type OmpOmfgSaveData = {
  readonly saved: boolean;
  readonly scope: "project" | "global";
  readonly name: string;
  readonly path: string;
  readonly validated: boolean;
};

export type OmpOmfgDraftCommandRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly complaint: string;
  readonly feedback?: string;
};

export type OmpOmfgSaveCommandRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly scope: "project" | "global";
  readonly overwrite?: boolean;
  readonly allowUnvalidated?: boolean;
};

export type OmpOmfgAbortCommandRequest = {
  readonly commandId: string;
  readonly incarnation: string;
};

/** A validation failure from an OMP rule-forging result. */
export class OmpOmfgValidationError extends TypeError {
  readonly name = "OmpOmfgValidationError";
  readonly code = "omp_omfg_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpOmfgClient = {
  readonly phase: string;
  readonly readyFrame?: Record<string, unknown>;
  readonly requestCedia: (
    command: "cedia_control",
    payload: Record<string, unknown>,
  ) => Promise<{ readonly data?: unknown }>;
  readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_OMFG_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot forge a rule for this task.";
export const NO_OMP_OMFG_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for rule forging.";

function invalid(message: string): never {
  throw new OmpOmfgValidationError(message);
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

function controlAvailable(client: OmpOmfgClient): boolean {
  if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
  return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

async function control(client: OmpOmfgClient, operation: "omfg.state.get" | "omfg.draft" | "omfg.save" | "omfg.abort", payload?: Record<string, unknown>): Promise<unknown | undefined> {
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

/** Parse the exact result of `omfg.state.get`/`omfg.draft`: the bounded draft for review. */
export function parseOmpOmfgData(value: unknown): OmpOmfgData {
  const label = "OMP rule-forging response";
  const item = record(value, label);
  exact(item, ["state", "complaint", "complaintTruncated", "draft", "draftTruncated", "ruleName", "validated", "validationFeedback", "savedPath", "reason"], label);
  const state = required(item, "state", label);
  if (state !== "idle" && state !== "drafting" && state !== "ready" && state !== "failed") invalid(`${label} state must be idle, drafting, ready or failed`);
  return {
    state,
    complaint: nullableText(required(item, "complaint", label), `${label} complaint`),
    complaintTruncated: boolean(required(item, "complaintTruncated", label), `${label} complaintTruncated`),
    draft: nullableText(required(item, "draft", label), `${label} draft`),
    draftTruncated: boolean(required(item, "draftTruncated", label), `${label} draftTruncated`),
    ruleName: nullableText(required(item, "ruleName", label), `${label} ruleName`),
    validated: boolean(required(item, "validated", label), `${label} validated`),
    validationFeedback: nullableText(required(item, "validationFeedback", label), `${label} validationFeedback`),
    savedPath: nullableText(required(item, "savedPath", label), `${label} savedPath`),
    reason: nullableText(required(item, "reason", label), `${label} reason`),
  };
}

/** Parse the exact result of `omfg.save`: where the rule landed. */
export function parseOmpOmfgSaveData(value: unknown): OmpOmfgSaveData {
  const label = "OMP rule-forging save response";
  const item = record(value, label);
  exact(item, ["saved", "scope", "name", "path", "validated"], label);
  const scope = required(item, "scope", label);
  if (scope !== "project" && scope !== "global") invalid(`${label} scope must be project or global`);
  return {
    saved: boolean(required(item, "saved", label), `${label} saved`),
    scope,
    name: text(required(item, "name", label), `${label} name`),
    path: text(required(item, "path", label), `${label} path`),
    validated: boolean(required(item, "validated", label), `${label} validated`),
  };
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string`);
  return value;
}

/** Parse the shape persisted with a durable rule-forging receipt. */
export function parseOmpOmfgCommandResult(value: unknown): OmpOmfgSnapshot {
  const item = record(value, "Cedia rule-forging command result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia rule-forging unavailable result");
    const reason = required(item, "reason", "Cedia rule-forging unavailable result");
    if (typeof reason !== "string") invalid("Cedia rule-forging unavailable reason must be a string");
    return { available: false, reason };
  }
  if (item.available !== true) invalid("Cedia rule-forging result availability is unsupported");
  const { available: _available, ...data } = item;
  return { available: true, ...parseOmpOmfgData(data) };
}

/** Parse the shape persisted with a durable save receipt. */
export function parseOmpOmfgSaveCommandResult(value: unknown): OmpOmfgSaveData | { readonly available: false; readonly reason: string } {
  const item = record(value, "Cedia rule-forging save command result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia rule-forging save unavailable result");
    const reason = required(item, "reason", "Cedia rule-forging save unavailable result");
    if (typeof reason !== "string") invalid("Cedia rule-forging save unavailable reason must be a string");
    return { available: false, reason };
  }
  return parseOmpOmfgSaveData(item);
}

/** Read the rule-forging state through the capability bridge. */
export async function readOmpOmfg(client: OmpOmfgClient): Promise<OmpOmfgData | undefined> {
  const result = await control(client, "omfg.state.get");
  return result === undefined ? undefined : parseOmpOmfgData(result);
}

/** Draft a rule and validate the bounded candidate that follows. */
export async function draftOmpOmfg(client: OmpOmfgClient, complaint: string, feedback?: string): Promise<OmpOmfgData | undefined> {
  if (typeof complaint !== "string" || complaint.trim().length === 0) throw new OmpOmfgValidationError("OMP rule forging needs a complaint");
  const result = await control(client, "omfg.draft", feedback === undefined ? { complaint } : { complaint, feedback });
  return result === undefined ? undefined : parseOmpOmfgData(result);
}

/** Save the held draft and validate where it landed. */
export async function saveOmpOmfg(client: OmpOmfgClient, scope: "project" | "global", guards?: { overwrite?: boolean; allowUnvalidated?: boolean }): Promise<OmpOmfgSaveData | undefined> {
  const result = await control(client, "omfg.save", {
    scope,
    ...(guards?.overwrite === undefined ? {} : { overwrite: guards.overwrite }),
    ...(guards?.allowUnvalidated === undefined ? {} : { allowUnvalidated: guards.allowUnvalidated }),
  });
  return result === undefined ? undefined : parseOmpOmfgSaveData(result);
}

/** Cancel a running draft and validate the state that follows. */
export async function abortOmpOmfg(client: OmpOmfgClient): Promise<OmpOmfgData | undefined> {
  const result = await control(client, "omfg.abort");
  return result === undefined ? undefined : parseOmpOmfgData(result);
}

/** Per-session rule-forging projection. OMP remains the owner of the held draft. */
export class OmpOmfg {
  #client: OmpOmfgClient | undefined;
  #omfg: OmpOmfgData | undefined;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpOmfgClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_OMFG_RUNTIME_REASON;
  }

  setClient(client: OmpOmfgClient | undefined): void {
    const changed = this.#client !== client;
    this.#client = client;
    if (!client || changed) this.#clearUnavailable(NO_OMP_OMFG_RUNTIME_REASON);
  }

  /** Read and cache the forging state without starting a runtime. */
  async read(client?: OmpOmfgClient): Promise<OmpOmfgData | undefined> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") return undefined;
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const omfg = await readOmpOmfg(target);
    if (omfg !== undefined) this.#set(omfg);
    return omfg;
  }

  /** Draft through OMP's owner operation; answers the drafting state at once. */
  async draft(complaint: string, feedback?: string, client?: OmpOmfgClient): Promise<OmpOmfgData> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") throw new Error(NO_OMP_OMFG_RUNTIME_REASON);
    if (!controlAvailable(target)) throw new Error(NO_OMP_OMFG_BRIDGE_REASON);
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const omfg = await draftOmpOmfg(target, complaint, feedback);
    if (omfg === undefined) throw new Error(NO_OMP_OMFG_BRIDGE_REASON);
    this.#set(omfg);
    return omfg;
  }

  /** Save through OMP's owner operation. */
  async save(scope: "project" | "global", guards?: { overwrite?: boolean; allowUnvalidated?: boolean }, client?: OmpOmfgClient): Promise<OmpOmfgSaveData> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") throw new Error(NO_OMP_OMFG_RUNTIME_REASON);
    if (!controlAvailable(target)) throw new Error(NO_OMP_OMFG_BRIDGE_REASON);
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const result = await saveOmpOmfg(target, scope, guards);
    if (result === undefined) throw new Error(NO_OMP_OMFG_BRIDGE_REASON);
    return result;
  }

  /** Cancel a running draft through OMP's owner operation. */
  async abort(client?: OmpOmfgClient): Promise<OmpOmfgData> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") throw new Error(NO_OMP_OMFG_RUNTIME_REASON);
    if (!controlAvailable(target)) throw new Error(NO_OMP_OMFG_BRIDGE_REASON);
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const omfg = await abortOmpOmfg(target);
    if (omfg === undefined) throw new Error(NO_OMP_OMFG_BRIDGE_REASON);
    this.#set(omfg);
    return omfg;
  }

  /** Refresh the forging state from an already-running runtime. */
  async refresh(): Promise<OmpOmfgSnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_OMFG_RUNTIME_REASON);
      return this.snapshot();
    }
    if (!controlAvailable(client)) {
      this.#clearUnavailable(NO_OMP_OMFG_BRIDGE_REASON);
      return this.snapshot();
    }
    try {
      const omfg = await this.read();
      if (omfg === undefined) this.#clearUnavailable(NO_OMP_OMFG_BRIDGE_REASON);
    } catch (error) {
      this.#clearUnavailable(error instanceof Error ? error.message : String(error));
    }
    return this.snapshot();
  }

  /** Alias used by runtime startup and tests that seed a per-session projection. */
  async seed(): Promise<void> {
    await this.refresh();
  }

  snapshot(): OmpOmfgSnapshot {
    const client = this.#client;
    if (!client || client.phase !== "ready") return { available: false, reason: NO_OMP_OMFG_RUNTIME_REASON };
    if (!controlAvailable(client)) return { available: false, reason: NO_OMP_OMFG_BRIDGE_REASON };
    if (this.#omfg === undefined) return { available: false, reason: this.#unavailableReason };
    return { available: true, ...this.#omfg };
  }

  #set(omfg: OmpOmfgData): void {
    this.#omfg = parseOmpOmfgData(omfg);
    this.#unavailableReason = "";
  }

  #clearUnavailable(reason: string): void {
    this.#omfg = undefined;
    this.#unavailableReason = reason;
  }
}
