import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpPrewalkData = {
  readonly armed: boolean;
};

export type OmpPrewalkSnapshot =
  | ({ readonly state: "available" } & OmpPrewalkData)
  | { readonly state: "unavailable"; readonly reason: string };

/** A validation failure from an OMP prewalk-state result. */
export class OmpPrewalkValidationError extends TypeError {
  readonly name = "OmpPrewalkValidationError";
  readonly code = "omp_prewalk_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpPrewalkClient = {
  readonly phase: string;
  readonly readyFrame?: Record<string, unknown>;
  readonly requestCedia: (
    command: "cedia_control",
    payload: Record<string, unknown>,
  ) => Promise<{ readonly data?: unknown }>;
  readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_PREWALK_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's prewalk state.";
export const NO_OMP_PREWALK_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for prewalk state.";

function invalid(message: string): never {
  throw new OmpPrewalkValidationError(message);
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

function responseData(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
  return value;
}

function controlAvailable(client: OmpPrewalkClient): boolean {
  if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
  return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

async function control(client: OmpPrewalkClient, operation: string, payload?: Record<string, unknown>): Promise<unknown | undefined> {
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

/** Parse the exact result of `prewalk.state.get`. */
export function parseOmpPrewalkState(value: unknown): OmpPrewalkData {
  const item = record(value, "OMP prewalk state response");
  exact(item, ["armed"], "OMP prewalk state response");
  return { armed: boolean(required(item, "armed", "OMP prewalk state response"), "OMP prewalk state armed") };
}

/** Read OMP's prewalk arming state through the capability bridge. */
export async function readOmpPrewalk(client: OmpPrewalkClient): Promise<OmpPrewalkData | undefined> {
  const result = await control(client, "prewalk.state.get");
  return result === undefined ? undefined : parseOmpPrewalkState(result);
}

/** Per-session OMP prewalk projection. OMP remains the owner of arming state. */
export class OmpPrewalk {
  #client: OmpPrewalkClient | undefined;
  #prewalk: OmpPrewalkData | undefined;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpPrewalkClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_PREWALK_RUNTIME_REASON;
  }

  setClient(client: OmpPrewalkClient | undefined): void {
    const changed = this.#client !== client;
    this.#client = client;
    if (!client || changed) this.#clearUnavailable(NO_OMP_PREWALK_RUNTIME_REASON);
  }

  /** Read and cache OMP's prewalk state without starting a runtime. */
  async read(client?: OmpPrewalkClient): Promise<OmpPrewalkData | undefined> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") return undefined;
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const prewalk = await readOmpPrewalk(target);
    if (prewalk !== undefined) this.#set(prewalk);
    return prewalk;
  }

  /** Refresh the prewalk state from an already-running runtime. */
  async refresh(): Promise<OmpPrewalkSnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_PREWALK_RUNTIME_REASON);
      return this.snapshot();
    }
    if (!controlAvailable(client)) {
      this.#clearUnavailable(NO_OMP_PREWALK_BRIDGE_REASON);
      return this.snapshot();
    }
    const prewalk = await this.read();
    if (prewalk === undefined) this.#clearUnavailable(NO_OMP_PREWALK_BRIDGE_REASON);
    return this.snapshot();
  }

  snapshot(): OmpPrewalkSnapshot {
    const client = this.#client;
    if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_PREWALK_RUNTIME_REASON };
    if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_PREWALK_BRIDGE_REASON };
    if (this.#prewalk === undefined) return { state: "unavailable", reason: this.#unavailableReason };
    return { state: "available", ...this.#prewalk };
  }

  #set(prewalk: OmpPrewalkData): void {
    this.#prewalk = parseOmpPrewalkState(prewalk);
    this.#unavailableReason = "";
  }

  #clearUnavailable(reason: string): void {
    this.#prewalk = undefined;
    this.#unavailableReason = reason;
  }
}
