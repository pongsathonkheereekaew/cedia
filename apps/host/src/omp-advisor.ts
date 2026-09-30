import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpAdvisorModel = {
  readonly provider: string;
  readonly id: string;
  readonly name?: string;
};

export type OmpAdvisorTokens = {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
};

export type OmpAdvisorMessages = {
  readonly user: number;
  readonly assistant: number;
  readonly total: number;
};

export type OmpAdvisorStat = {
  readonly name: string;
  readonly status: string;
  readonly model?: OmpAdvisorModel;
  readonly contextWindow: number;
  readonly contextTokens: number;
  readonly tokens: OmpAdvisorTokens;
  readonly cost: number;
  readonly messages: OmpAdvisorMessages;
  readonly sessionId?: string;
};

export type OmpAdvisorData = {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly configured: boolean;
  readonly model?: OmpAdvisorModel;
  readonly contextWindow: number;
  readonly contextTokens: number;
  readonly tokens: OmpAdvisorTokens;
  readonly cost: number;
  readonly messages: OmpAdvisorMessages;
  readonly advisors: readonly OmpAdvisorStat[];
  readonly changed: boolean;
};

export type OmpAdvisorHistory = {
  readonly text: string | null;
  readonly truncated: boolean;
};

export type OmpAdvisorSnapshot =
  | { readonly state: "available"; readonly revision: number; readonly advisor: OmpAdvisorData }
  | { readonly state: "unavailable"; readonly reason: string };

export type OmpAdvisorHistorySnapshot =
  | ({ readonly state: "available" } & OmpAdvisorHistory)
  | { readonly state: "unavailable"; readonly reason: string };

export type OmpAdvisorCommandRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly op: "set";
  readonly enabled: boolean;
};

export type OmpAdvisorCommandResult = OmpAdvisorSnapshot;

/** A validation failure from an OMP advisor result. */
export class OmpAdvisorValidationError extends TypeError {
  readonly name = "OmpAdvisorValidationError";
  readonly code = "omp_advisor_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpAdvisorClient = {
  readonly phase: string;
  readonly readyFrame?: Record<string, unknown>;
  readonly requestCedia: (
    command: "cedia_control",
    payload: Record<string, unknown>,
  ) => Promise<{ readonly data?: unknown }>;
  readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_ADVISOR_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's advisor.";
export const NO_OMP_ADVISOR_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge.";

function invalid(message: string): never {
  throw new OmpAdvisorValidationError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) if (!keys.has(key)) invalid(`${label} has an unknown field ${key}`);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
  return value;
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

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative integer`);
  return value;
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid(`${label} must be a non-negative number`);
  return value;
}

function parseModel(value: unknown, label: string): OmpAdvisorModel {
  const item = record(value, label);
  exact(item, ["provider", "id", "name"], label);
  const name = item.name === undefined ? undefined : nonEmptyText(item.name, `${label} name`);
  return {
    provider: nonEmptyText(item.provider, `${label} provider`),
    id: nonEmptyText(item.id, `${label} id`),
    ...(name === undefined ? {} : { name }),
  };
}

function parseTokens(value: unknown, label: string): OmpAdvisorTokens {
  const item = record(value, label);
  exact(item, ["input", "output", "reasoning", "cacheRead", "cacheWrite", "total"], label);
  return {
    input: nonNegativeInteger(item.input, `${label} input`),
    output: nonNegativeInteger(item.output, `${label} output`),
    reasoning: nonNegativeInteger(item.reasoning, `${label} reasoning`),
    cacheRead: nonNegativeInteger(item.cacheRead, `${label} cacheRead`),
    cacheWrite: nonNegativeInteger(item.cacheWrite, `${label} cacheWrite`),
    total: nonNegativeInteger(item.total, `${label} total`),
  };
}

function parseMessages(value: unknown, label: string): OmpAdvisorMessages {
  const item = record(value, label);
  exact(item, ["user", "assistant", "total"], label);
  return {
    user: nonNegativeInteger(item.user, `${label} user`),
    assistant: nonNegativeInteger(item.assistant, `${label} assistant`),
    total: nonNegativeInteger(item.total, `${label} total`),
  };
}

function parseStat(value: unknown, index: number): OmpAdvisorStat {
  const label = `OMP advisor ${index}`;
  const item = record(value, label);
  exact(item, ["name", "status", "model", "contextWindow", "contextTokens", "tokens", "cost", "messages", "sessionId"], label);
  const model = item.model === undefined ? undefined : parseModel(item.model, `${label} model`);
  const sessionId = item.sessionId === undefined ? undefined : nonEmptyText(item.sessionId, `${label} sessionId`);
  return {
    name: nonEmptyText(item.name, `${label} name`),
    status: nonEmptyText(item.status, `${label} status`),
    ...(model === undefined ? {} : { model }),
    contextWindow: nonNegativeInteger(item.contextWindow, `${label} contextWindow`),
    contextTokens: nonNegativeInteger(item.contextTokens, `${label} contextTokens`),
    tokens: parseTokens(item.tokens, `${label} tokens`),
    cost: nonNegativeNumber(item.cost, `${label} cost`),
    messages: parseMessages(item.messages, `${label} messages`),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

/** Parse the complete `advisor.get`/`advisor.set` result without inventing defaults. */
export function parseOmpAdvisorData(value: unknown): OmpAdvisorData {
  const item = record(value, "OMP advisor response");
  exact(item, ["enabled", "active", "configured", "model", "contextWindow", "contextTokens", "tokens", "cost", "messages", "advisors", "changed"], "OMP advisor response");
  if (!Array.isArray(item.advisors)) invalid("OMP advisor advisors must be an array");
  const model = item.model === undefined ? undefined : parseModel(item.model, "OMP advisor model");
  return {
    enabled: boolean(item.enabled, "OMP advisor enabled"),
    active: boolean(item.active, "OMP advisor active"),
    configured: boolean(item.configured, "OMP advisor configured"),
    ...(model === undefined ? {} : { model }),
    contextWindow: nonNegativeInteger(item.contextWindow, "OMP advisor contextWindow"),
    contextTokens: nonNegativeInteger(item.contextTokens, "OMP advisor contextTokens"),
    tokens: parseTokens(item.tokens, "OMP advisor tokens"),
    cost: nonNegativeNumber(item.cost, "OMP advisor cost"),
    messages: parseMessages(item.messages, "OMP advisor messages"),
    advisors: item.advisors.map((entry, index) => parseStat(entry, index)),
    changed: boolean(item.changed, "OMP advisor changed"),
  };
}

/** Parse the complete `advisor.history` result. */
export function parseOmpAdvisorHistory(value: unknown): OmpAdvisorHistory {
  const item = record(value, "OMP advisor history");
  exact(item, ["text", "truncated"], "OMP advisor history");
  if (item.text !== null && typeof item.text !== "string") invalid("OMP advisor history text must be a string or null");
  return { text: item.text as string | null, truncated: boolean(item.truncated, "OMP advisor history truncated") };
}

/** Parse the projection persisted with a durable advisor command receipt. */
export function parseOmpAdvisorCommandResult(value: unknown): OmpAdvisorCommandResult {
  const item = record(value, "Cedia advisor command result");
  if (item.state === "unavailable") {
    exact(item, ["state", "reason"], "Cedia advisor unavailable result");
    return { state: "unavailable", reason: text(item.reason, "Cedia advisor unavailable reason") };
  }
  if (item.state !== "available") invalid("Cedia advisor result state is unsupported");
  exact(item, ["state", "revision", "advisor"], "Cedia advisor available result");
  const revision = nonNegativeInteger(item.revision, "Cedia advisor revision");
  if (revision < 1) invalid("Cedia advisor revision must be positive");
  return { state: "available", revision, advisor: parseOmpAdvisorData(item.advisor) };
}

function responseData(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
  return value;
}

function controlAvailable(client: OmpAdvisorClient): boolean {
  if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
  // A ready client without a negotiated ready frame cannot prove that the
  // capability bridge exists. Treat that as an honest absence instead of
  // probing `cedia_control` and turning the absence into a transport error.
  return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

/** Run one registered advisor operation, answering `undefined` when the bridge is absent. */
async function control(client: OmpAdvisorClient, operation: string, payload?: Record<string, unknown>): Promise<unknown | undefined> {
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
  nonEmptyText(data.capabilityRevision, "Cedia control capability revision");
  if (!Object.hasOwn(data, "result") || data.result === undefined) invalid("Cedia control response has no result");
  return data.result;
}

/** Read OMP's advisor snapshot through the capability bridge. */
export async function readOmpAdvisor(client: OmpAdvisorClient): Promise<OmpAdvisorData | undefined> {
  const result = await control(client, "advisor.get");
  return result === undefined ? undefined : parseOmpAdvisorData(result);
}

/** Switch OMP's advisor and validate the post-change snapshot. */
export async function setOmpAdvisor(client: OmpAdvisorClient, enabled: boolean): Promise<OmpAdvisorData | undefined> {
  const result = await control(client, "advisor.set", { enabled });
  return result === undefined ? undefined : parseOmpAdvisorData(result);
}

/** Read OMP's bounded advisor transcript through the capability bridge. */
export async function readOmpAdvisorHistory(client: OmpAdvisorClient, compact?: boolean): Promise<OmpAdvisorHistory | undefined> {
  const result = await control(client, "advisor.history", compact === undefined ? undefined : { compact });
  return result === undefined ? undefined : parseOmpAdvisorHistory(result);
}

/** Per-session advisor state. This projection never starts a runtime to satisfy a read. */
export class OmpAdvisor {
  #client: OmpAdvisorClient | undefined;
  #advisor: OmpAdvisorData | undefined;
  #revision = 0;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpAdvisorClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_ADVISOR_RUNTIME_REASON;
  }

  setClient(client: OmpAdvisorClient | undefined): void {
    this.#client = client;
    if (!client) this.#clearUnavailable(NO_OMP_ADVISOR_RUNTIME_REASON);
  }

  /** Seed from `cedia_control {operation:"advisor.get"}` for an already-running session. */
  async seed(): Promise<void> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_ADVISOR_RUNTIME_REASON);
      return;
    }
    if (!controlAvailable(client)) {
      this.#clearUnavailable(NO_OMP_ADVISOR_BRIDGE_REASON);
      return;
    }
    try {
      const advisor = await readOmpAdvisor(client);
      if (advisor === undefined) this.#clearUnavailable(NO_OMP_ADVISOR_BRIDGE_REASON);
      else this.#set(advisor);
    } catch (error) {
      this.#clearUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  snapshot(): OmpAdvisorSnapshot {
    const client = this.#client;
    if (!client) return { state: "unavailable", reason: this.#unavailableReason };
    if (client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_ADVISOR_RUNTIME_REASON };
    if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_ADVISOR_BRIDGE_REASON };
    if (this.#advisor === undefined) return { state: "unavailable", reason: this.#unavailableReason };
    return { state: "available", revision: this.#revision, advisor: this.#advisor };
  }

  /** Switch the advisor through OMP and cache the acknowledged snapshot. */
  async set(enabled: boolean): Promise<OmpAdvisorData> {
    const client = this.#client;
    if (!client || client.phase !== "ready") throw new Error(NO_OMP_ADVISOR_RUNTIME_REASON);
    if (!controlAvailable(client)) throw new Error(NO_OMP_ADVISOR_BRIDGE_REASON);
    const advisor = await setOmpAdvisor(client, enabled);
    if (advisor === undefined) {
      this.#clearUnavailable(NO_OMP_ADVISOR_BRIDGE_REASON);
      throw new Error(NO_OMP_ADVISOR_BRIDGE_REASON);
    }
    this.#set(advisor);
    return advisor;
  }

  /** Read the bounded transcript from the already-running runtime. */
  async history(compact?: boolean): Promise<OmpAdvisorHistorySnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_ADVISOR_RUNTIME_REASON };
    if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_ADVISOR_BRIDGE_REASON };
    try {
      const history = await readOmpAdvisorHistory(client, compact);
      if (history === undefined) {
        this.#clearUnavailable(NO_OMP_ADVISOR_BRIDGE_REASON);
        return { state: "unavailable", reason: NO_OMP_ADVISOR_BRIDGE_REASON };
      }
      return { state: "available", ...history };
    } catch (error) {
      return { state: "unavailable", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  #set(advisor: OmpAdvisorData): void {
    this.#advisor = parseOmpAdvisorData(advisor);
    this.#revision += 1;
    this.#unavailableReason = "";
  }

  #clearUnavailable(reason: string): void {
    this.#advisor = undefined;
    this.#unavailableReason = reason;
  }
}
