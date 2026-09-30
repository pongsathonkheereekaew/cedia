import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpBtwState = "idle" | "answering" | "ready" | "failed";

export type OmpBtwData = {
  readonly state: OmpBtwState;
  readonly question: string | null;
  readonly questionTruncated: boolean;
  readonly answer: string | null;
  readonly answerTruncated: boolean;
  readonly branchable: boolean;
  readonly branchUnavailableReason: string | null;
  readonly reason: string | null;
};

// The snapshot uses the available-pattern (not the state-pattern of the other projections)
// because the answer already carries the side-question lifecycle in `state`: the two words
// would collide on one key. Service routes and receipts share this shape.
export type OmpBtwSnapshot =
  | ({ readonly available: true } & OmpBtwData)
  | { readonly available: false; readonly reason: string };

export type OmpBtwBranchData = {
  readonly cancelled: boolean;
  readonly sessionFile: string | null;
};

export type OmpBtwAskCommandRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly question: string;
};

export type OmpBtwBranchCommandRequest = {
  readonly commandId: string;
  readonly incarnation: string;
};

/** A validation failure from an OMP side-question result. */
export class OmpBtwValidationError extends TypeError {
  readonly name = "OmpBtwValidationError";
  readonly code = "omp_btw_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpBtwClient = {
  readonly phase: string;
  readonly readyFrame?: Record<string, unknown>;
  readonly requestCedia: (
    command: "cedia_control",
    payload: Record<string, unknown>,
  ) => Promise<{ readonly data?: unknown }>;
  readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_BTW_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot ask this task a side question.";
export const NO_OMP_BTW_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for side questions.";

function invalid(message: string): never {
  throw new OmpBtwValidationError(message);
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

function controlAvailable(client: OmpBtwClient): boolean {
  if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
  return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

async function control(client: OmpBtwClient, operation: "btw.state.get" | "btw.ask" | "btw.branch", payload?: Record<string, unknown>): Promise<unknown | undefined> {
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

/** Parse the exact result of `btw.state.get`/`btw.ask`: the bounded answer, never the held objects. */
export function parseOmpBtwData(value: unknown): OmpBtwData {
  const label = "OMP side-question response";
  const item = record(value, label);
  exact(item, ["state", "question", "questionTruncated", "answer", "answerTruncated", "branchable", "branchUnavailableReason", "reason"], label);
  const state = required(item, "state", label);
  if (state !== "idle" && state !== "answering" && state !== "ready" && state !== "failed") invalid(`${label} state must be idle, answering, ready or failed`);
  return {
    state,
    question: nullableText(required(item, "question", label), `${label} question`),
    questionTruncated: boolean(required(item, "questionTruncated", label), `${label} questionTruncated`),
    answer: nullableText(required(item, "answer", label), `${label} answer`),
    answerTruncated: boolean(required(item, "answerTruncated", label), `${label} answerTruncated`),
    branchable: boolean(required(item, "branchable", label), `${label} branchable`),
    branchUnavailableReason: nullableText(required(item, "branchUnavailableReason", label), `${label} branchUnavailableReason`),
    reason: nullableText(required(item, "reason", label), `${label} reason`),
  };
}

/** Parse the exact result of `btw.branch`: the branched file for the host to adopt. */
export function parseOmpBtwBranchData(value: unknown): OmpBtwBranchData {
  const label = "OMP side-question branch response";
  const item = record(value, label);
  exact(item, ["cancelled", "sessionFile"], label);
  const sessionFile = required(item, "sessionFile", label);
  if (sessionFile !== null && (typeof sessionFile !== "string" || sessionFile.trim().length === 0)) invalid(`${label} sessionFile must be a path or null`);
  return {
    cancelled: boolean(required(item, "cancelled", label), `${label} cancelled`),
    sessionFile,
  };
}

/** Parse the shape persisted with a durable side-question receipt. */
export function parseOmpBtwCommandResult(value: unknown): OmpBtwSnapshot {
  const item = record(value, "Cedia side-question command result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia side-question unavailable result");
    const reason = required(item, "reason", "Cedia side-question unavailable result");
    if (typeof reason !== "string") invalid("Cedia side-question unavailable reason must be a string");
    return { available: false, reason };
  }
  if (item.available !== true) invalid("Cedia side-question result availability is unsupported");
  exact(item, ["available", "state", "question", "questionTruncated", "answer", "answerTruncated", "branchable", "branchUnavailableReason", "reason"], "Cedia side-question available result");
  const data = parseOmpBtwData({ state: item.state, question: item.question, questionTruncated: item.questionTruncated, answer: item.answer, answerTruncated: item.answerTruncated, branchable: item.branchable, branchUnavailableReason: item.branchUnavailableReason, reason: item.reason });
  return { available: true, ...data };
}

/** Parse the shape persisted with a durable branch receipt. */
export function parseOmpBtwBranchCommandResult(value: unknown): OmpBtwBranchData | { readonly available: false; readonly reason: string } {
  const item = record(value, "Cedia side-question branch command result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia side-question branch unavailable result");
    const reason = required(item, "reason", "Cedia side-question branch unavailable result");
    if (typeof reason !== "string") invalid("Cedia side-question branch unavailable reason must be a string");
    return { available: false, reason };
  }
  return parseOmpBtwBranchData(item);
}

/** Read the terminal owner's side-question state through the capability bridge. */
export async function readOmpBtw(client: OmpBtwClient): Promise<OmpBtwData | undefined> {
  const result = await control(client, "btw.state.get");
  return result === undefined ? undefined : parseOmpBtwData(result);
}

/** Ask an ephemeral side question and validate the bounded answer that follows. */
export async function askOmpBtw(client: OmpBtwClient, question: string): Promise<OmpBtwData | undefined> {
  if (typeof question !== "string" || question.trim().length === 0) throw new OmpBtwValidationError("OMP side question needs a question");
  const result = await control(client, "btw.ask", { question });
  return result === undefined ? undefined : parseOmpBtwData(result);
}

/** Promote the held side answer and validate the branched file that follows. */
export async function branchOmpBtw(client: OmpBtwClient): Promise<OmpBtwBranchData | undefined> {
  const result = await control(client, "btw.branch");
  return result === undefined ? undefined : parseOmpBtwBranchData(result);
}

/** Per-session side-question projection. OMP remains the owner of the held answer. */
export class OmpBtw {
  #client: OmpBtwClient | undefined;
  #btw: OmpBtwData | undefined;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpBtwClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_BTW_RUNTIME_REASON;
  }

  setClient(client: OmpBtwClient | undefined): void {
    const changed = this.#client !== client;
    this.#client = client;
    if (!client || changed) this.#clearUnavailable(NO_OMP_BTW_RUNTIME_REASON);
  }

  /** Read and cache the side-question state without starting a runtime. */
  async read(client?: OmpBtwClient): Promise<OmpBtwData | undefined> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") return undefined;
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const btw = await readOmpBtw(target);
    if (btw !== undefined) this.#set(btw);
    return btw;
  }

  /** Ask through OMP's owner operation; occupies the call until the answer settles. */
  async ask(question: string, client?: OmpBtwClient): Promise<OmpBtwData> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") throw new Error(NO_OMP_BTW_RUNTIME_REASON);
    if (!controlAvailable(target)) throw new Error(NO_OMP_BTW_BRIDGE_REASON);
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const btw = await askOmpBtw(target, question);
    if (btw === undefined) throw new Error(NO_OMP_BTW_BRIDGE_REASON);
    this.#set(btw);
    return btw;
  }

  /** Promote through OMP's owner operation. */
  async branch(client?: OmpBtwClient): Promise<OmpBtwBranchData> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") throw new Error(NO_OMP_BTW_RUNTIME_REASON);
    if (!controlAvailable(target)) throw new Error(NO_OMP_BTW_BRIDGE_REASON);
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const result = await branchOmpBtw(target);
    if (result === undefined) throw new Error(NO_OMP_BTW_BRIDGE_REASON);
    return result;
  }

  /** Refresh the side-question state from an already-running runtime. */
  async refresh(): Promise<OmpBtwSnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_BTW_RUNTIME_REASON);
      return this.snapshot();
    }
    if (!controlAvailable(client)) {
      this.#clearUnavailable(NO_OMP_BTW_BRIDGE_REASON);
      return this.snapshot();
    }
    try {
      const btw = await this.read();
      if (btw === undefined) this.#clearUnavailable(NO_OMP_BTW_BRIDGE_REASON);
    } catch (error) {
      this.#clearUnavailable(error instanceof Error ? error.message : String(error));
    }
    return this.snapshot();
  }

  /** Alias used by runtime startup and tests that seed a per-session projection. */
  async seed(): Promise<void> {
    await this.refresh();
  }

  snapshot(): OmpBtwSnapshot {
    const client = this.#client;
    if (!client || client.phase !== "ready") return { available: false, reason: NO_OMP_BTW_RUNTIME_REASON };
    if (!controlAvailable(client)) return { available: false, reason: NO_OMP_BTW_BRIDGE_REASON };
    if (this.#btw === undefined) return { available: false, reason: this.#unavailableReason };
    return { available: true, ...this.#btw };
  }

  #set(btw: OmpBtwData): void {
    this.#btw = parseOmpBtwData(btw);
    this.#unavailableReason = "";
  }

  #clearUnavailable(reason: string): void {
    this.#btw = undefined;
    this.#unavailableReason = reason;
  }
}
