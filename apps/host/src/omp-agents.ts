import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpAgent = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly parentId?: string;
  readonly status: string;
  readonly createdAt: number;
  readonly lastActivity: number;
  readonly activity?: string;
  readonly sessionFile?: string;
};

export type OmpAgentsData = { readonly agents: readonly OmpAgent[] };

export type OmpAgentMessage = {
  readonly role: string;
  readonly content: unknown;
};

export type OmpAgentTranscript = {
  readonly sessionFile: string;
  readonly fromByte: number;
  readonly nextByte: number;
  readonly reset: boolean;
  readonly entries: readonly unknown[];
  readonly messages: readonly OmpAgentMessage[];
};

export type OmpAgentTranscriptMessage = {
  readonly role: string;
  readonly text: string;
  readonly otherParts: number;
};

export type OmpAgentsSnapshot =
  | { readonly state: "available"; readonly revision: number; readonly agents: readonly OmpAgent[] }
  | { readonly state: "unavailable"; readonly reason: string };

export type OmpAgentTranscriptSnapshot =
  | {
      readonly state: "available";
      readonly agentId: string;
      readonly sessionFile: string;
      readonly fromByte: number;
      readonly nextByte: number;
      readonly reset: boolean;
      readonly messages: readonly OmpAgentTranscriptMessage[];
      readonly truncated: boolean;
    }
  | { readonly state: "unavailable"; readonly reason: string };

/** A live OMP client with the Cedia capability bridge and the native transcript command. */
export type OmpAgentsClient = {
  readonly phase: string;
  readonly readyFrame?: Record<string, unknown>;
  readonly requestCedia: (
    command: "cedia_control",
    payload: Record<string, unknown>,
  ) => Promise<{ readonly data?: unknown }>;
  readonly request: (
    command: "get_subagent_messages",
    payload: { readonly sessionFile: string; readonly fromByte: number },
  ) => Promise<{ readonly data?: unknown }>;
  readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_AGENTS_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's agents.";
export const NO_OMP_AGENTS_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for agents.";
export const NO_OMP_AGENT_UNKNOWN_REASON = (agentId: string): string => `Unknown agent ${agentId}: it is not present in the runtime agent roster.`;
export const NO_OMP_AGENT_NO_SESSION_REASON = (agentId: string): string => `Agent ${agentId} has no sessionFile; no transcript is available.`;
export const NO_OMP_AGENT_EMPTY_TRANSCRIPT_REASON = (agentId: string): string => `Agent ${agentId} has not produced transcript output yet.`;

/** A validation failure from an OMP agent-lifecycle result. Uses the agents error code family. */
export class OmpAgentsValidationError extends TypeError {
  readonly name = "OmpAgentsValidationError";
  readonly code = "omp_agents_invalid" as const;
}

const MAX_TRANSCRIPT_MESSAGES = 50;
const MAX_MESSAGE_TEXT = 8_192;

function invalid(message: string): never {
  throw new OmpAgentsValidationError(message);
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

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative integer`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
  return value;
}

function parseAgent(value: unknown, index: number): OmpAgent {
  const label = `OMP agent ${index}`;
  const item = record(value, label);
  exact(item, ["id", "name", "kind", "parentId", "status", "createdAt", "lastActivity", "activity", "sessionFile"], label);
  const parentId = item.parentId === undefined ? undefined : nonEmptyText(item.parentId, `${label} parentId`);
  const activity = item.activity === undefined ? undefined : text(item.activity, `${label} activity`);
  const sessionFile = item.sessionFile === undefined ? undefined : nonEmptyText(item.sessionFile, `${label} sessionFile`);
  return {
    id: nonEmptyText(item.id, `${label} id`),
    name: nonEmptyText(item.name, `${label} name`),
    kind: nonEmptyText(item.kind, `${label} kind`),
    ...(parentId === undefined ? {} : { parentId }),
    status: nonEmptyText(item.status, `${label} status`),
    createdAt: nonNegativeInteger(item.createdAt, `${label} createdAt`),
    lastActivity: nonNegativeInteger(item.lastActivity, `${label} lastActivity`),
    ...(activity === undefined ? {} : { activity }),
    ...(sessionFile === undefined ? {} : { sessionFile }),
  };
}

/** Parse the complete `agents.get` result without inventing missing roster rows. */
export function parseOmpAgentsData(value: unknown): OmpAgentsData {
  const item = record(value, "OMP agents response");
  exact(item, ["agents"], "OMP agents response");
  if (!Array.isArray(item.agents)) invalid("OMP agents agents must be an array");
  return { agents: item.agents.map((agent, index) => parseAgent(agent, index)) };
}

function parseTranscriptMessage(value: unknown, index: number): OmpAgentMessage {
  const item = record(value, `OMP agent transcript message ${index}`);
  if (!Object.hasOwn(item, "role")) invalid(`OMP agent transcript message ${index} has no role`);
  if (!Object.hasOwn(item, "content")) invalid(`OMP agent transcript message ${index} has no content`);
  return { role: text(item.role, `OMP agent transcript message ${index} role`), content: item.content };
}

/** Parse the runtime's direct `get_subagent_messages` answer. Message metadata stays opaque. */
export function parseOmpAgentTranscript(value: unknown): OmpAgentTranscript {
  const item = record(value, "OMP agent transcript response");
  exact(item, ["sessionFile", "fromByte", "nextByte", "reset", "entries", "messages"], "OMP agent transcript response");
  if (!Array.isArray(item.entries)) invalid("OMP agent transcript entries must be an array");
  if (!Array.isArray(item.messages)) invalid("OMP agent transcript messages must be an array");
  return {
    sessionFile: nonEmptyText(item.sessionFile, "OMP agent transcript sessionFile"),
    fromByte: nonNegativeInteger(item.fromByte, "OMP agent transcript fromByte"),
    nextByte: nonNegativeInteger(item.nextByte, "OMP agent transcript nextByte"),
    reset: boolean(item.reset, "OMP agent transcript reset"),
    entries: item.entries,
    messages: item.messages.map((message, index) => parseTranscriptMessage(message, index)),
  };
}

function responseData(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
  return value;
}

function controlAvailable(client: OmpAgentsClient): boolean {
  if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
  return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

async function control(client: OmpAgentsClient, operation: string, payload?: Record<string, unknown>): Promise<unknown | undefined> {
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

/** Read OMP's own agent registry through the Cedia capability bridge. */
export async function readOmpAgents(client: OmpAgentsClient): Promise<OmpAgentsData | undefined> {
  const result = await control(client, "agents.get");
  return result === undefined ? undefined : parseOmpAgentsData(result);
}

/** Read one child transcript through OMP's existing byte-paged RPC command. */
export async function readOmpAgentTranscript(client: OmpAgentsClient, sessionFile: string, fromByte = 0): Promise<OmpAgentTranscript> {
  const response = await client.request("get_subagent_messages", { sessionFile, fromByte });
  return parseOmpAgentTranscript(responseData(response));
}

function textParts(content: unknown): { text: string; otherParts: number } {
  if (typeof content === "string") return { text: content, otherParts: 0 };
  if (!Array.isArray(content)) return { text: "", otherParts: 1 };
  let text = "";
  let otherParts = 0;
  let hasTextPart = false;
  for (const part of content) {
    if (part && typeof part === "object" && !Array.isArray(part) && (part as Record<string, unknown>).type === "text" && typeof (part as Record<string, unknown>).text === "string") {
      hasTextPart = true;
      text += (part as { readonly text: string }).text;
    } else {
      otherParts += 1;
    }
  }
  return { text, otherParts: hasTextPart ? otherParts : Math.max(1, otherParts) };
}

/** Project text-only transcript content into the bounded host response. */
export function projectOmpAgentTranscript(transcript: OmpAgentTranscript, agentId: string): OmpAgentTranscriptSnapshot {
  let truncated = transcript.messages.length > MAX_TRANSCRIPT_MESSAGES;
  const messages = transcript.messages.slice(0, MAX_TRANSCRIPT_MESSAGES).map(message => {
    const parts = textParts(message.content);
    if (parts.text.length > MAX_MESSAGE_TEXT) truncated = true;
    return { role: message.role, text: parts.text.slice(0, MAX_MESSAGE_TEXT), otherParts: parts.otherParts };
  });
  return {
    state: "available",
    agentId,
    sessionFile: transcript.sessionFile,
    fromByte: transcript.fromByte,
    nextByte: transcript.nextByte,
    reset: transcript.reset,
    messages,
    truncated,
  };
}

export type OmpAgentKillRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly id: string;
};

export type OmpAgentKillData = {
  readonly id: string;
  readonly aborted: boolean;
  readonly released: boolean;
};

export type OmpAgentKillResult =
  | ({ readonly available: true } & OmpAgentKillData)
  | { readonly available: false; readonly reason: string };

export type OmpAgentReviveRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly id: string;
};

export type OmpAgentReviveData = {
  readonly id: string;
  readonly revived: boolean;
};

export type OmpAgentReviveResult =
  | ({ readonly available: true } & OmpAgentReviveData)
  | { readonly available: false; readonly reason: string };

function parseOmpAgentKillData(value: unknown): OmpAgentKillData {
  const label = "OMP agent kill response";
  const item = record(value, label);
  exact(item, ["id", "aborted", "released"], label);
  return {
    id: nonEmptyText(item.id, `${label} id`),
    aborted: boolean(item.aborted, `${label} aborted`),
    released: boolean(item.released, `${label} released`),
  };
}

function parseOmpAgentReviveData(value: unknown): OmpAgentReviveData {
  const label = "OMP agent revive response";
  const item = record(value, label);
  exact(item, ["id", "revived"], label);
  return {
    id: nonEmptyText(item.id, `${label} id`),
    revived: boolean(item.revived, `${label} revived`),
  };
}

/** Parse the durable route result of `agents.kill`: the available wrapper around the outcome. */
export function parseOmpAgentKillResult(value: unknown): OmpAgentKillResult {
  const item = record(value, "Cedia agent kill result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia agent unavailable result");
    return { available: false, reason: text(item.reason, "Cedia agent unavailable reason") };
  }
  if (item.available !== true) invalid("Cedia agent result available must be a boolean");
  const result = parseOmpAgentKillData({
    id: item.id,
    aborted: item.aborted,
    released: item.released,
  });
  exact(item, ["available", "id", "aborted", "released"], "Cedia agent available result");
  return { available: true, ...result };
}

/** Parse the durable route result of `agents.revive`: the available wrapper around the outcome. */
export function parseOmpAgentReviveResult(value: unknown): OmpAgentReviveResult {
  const item = record(value, "Cedia agent revive result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia agent unavailable result");
    return { available: false, reason: text(item.reason, "Cedia agent unavailable reason") };
  }
  if (item.available !== true) invalid("Cedia agent result available must be a boolean");
  const result = parseOmpAgentReviveData({ id: item.id, revived: item.revived });
  exact(item, ["available", "id", "revived"], "Cedia agent available result");
  return { available: true, ...result };
}

export type OmpAgentConfigRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly agent: string;
  readonly enabled?: boolean;
  readonly model?: string;
  readonly prewalk?: string;
  readonly advisor?: string;
};

export type OmpAgentConfigData = {
  readonly agent: string;
  readonly enabled: boolean;
  readonly model?: string;
  readonly prewalk?: string;
  readonly advisor?: string;
};

export type OmpAgentConfigResult =
  | ({ readonly available: true } & OmpAgentConfigData)
  | { readonly available: false; readonly reason: string };

function parseOmpAgentConfigData(value: unknown): OmpAgentConfigData {
  const label = "OMP agent config response";
  const item = record(value, label);
  exact(item, ["agent", "enabled", "model", "prewalk", "advisor"], label);
  const result: OmpAgentConfigData = {
    agent: nonEmptyText(item.agent, `${label} agent`),
    enabled: boolean(item.enabled, `${label} enabled`),
  };
  for (const field of ["model", "prewalk", "advisor"] as const) {
    const entry = item[field];
    if (entry !== undefined) (result as Record<string, unknown>)[field] = text(entry, `${label} ${field}`);
  }
  return result;
}

/** Parse the durable route result of `agents.config.set`: the available wrapper around the outcome. */
export function parseOmpAgentConfigResult(value: unknown): OmpAgentConfigResult {
  const item = record(value, "Cedia agent config result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia agent unavailable result");
    return { available: false, reason: text(item.reason, "Cedia agent unavailable reason") };
  }
  if (item.available !== true) invalid("Cedia agent result available must be a boolean");
  const result = parseOmpAgentConfigData({
    agent: item.agent,
    enabled: item.enabled,
    ...(item.model === undefined ? {} : { model: item.model }),
    ...(item.prewalk === undefined ? {} : { prewalk: item.prewalk }),
    ...(item.advisor === undefined ? {} : { advisor: item.advisor }),
  });
  exact(item, ["available", "agent", "enabled", "model", "prewalk", "advisor"], "Cedia agent available result");
  return { available: true, ...result };
}

/** Configure one discovered agent through the capability bridge. */
export async function configOmpAgent(client: OmpAgentsClient, input: Omit<OmpAgentConfigRequest, "commandId" | "incarnation">): Promise<OmpAgentConfigData | undefined> {
  const payload: Record<string, unknown> = { agent: input.agent };
  if (input.enabled !== undefined) payload.enabled = input.enabled;
  if (input.model !== undefined) payload.model = input.model;
  if (input.prewalk !== undefined) payload.prewalk = input.prewalk;
  if (input.advisor !== undefined) payload.advisor = input.advisor;
  const result = await control(client, "agents.config.set", payload);
  if (result === undefined) return undefined;
  try {
    return parseOmpAgentConfigData(result);
  } catch (error) {
    throw new OmpAgentsValidationError(error instanceof Error ? error.message : String(error));
  }
}

/** Abort a running agent turn and release its row through the capability bridge. */
export async function killOmpAgent(client: OmpAgentsClient, id: string): Promise<OmpAgentKillData | undefined> {
  const result = await control(client, "agents.kill", { id });
  if (result === undefined) return undefined;
  try {
    return parseOmpAgentKillData(result);
  } catch (error) {
    throw new OmpAgentsValidationError(error instanceof Error ? error.message : String(error));
  }
}

/** Revive a parked agent through the capability bridge. */
export async function reviveOmpAgent(client: OmpAgentsClient, id: string): Promise<OmpAgentReviveData | undefined> {
  const result = await control(client, "agents.revive", { id });
  if (result === undefined) return undefined;
  try {
    return parseOmpAgentReviveData(result);
  } catch (error) {
    throw new OmpAgentsValidationError(error instanceof Error ? error.message : String(error));
  }
}

export type OmpAgentConfigRow = {
  readonly name: string;
  readonly source: string;
  readonly enabled: boolean;
  readonly model?: string;
  readonly prewalk?: string;
  readonly advisor?: string;
};

export type OmpAgentConfigList =
  | { readonly state: "available"; readonly agents: readonly OmpAgentConfigRow[] }
  | { readonly state: "unavailable"; readonly reason: string };

function parseOmpAgentConfigRow(value: unknown, index: number): OmpAgentConfigRow {
  const label = `OMP agent config ${index}`;
  const item = record(value, label);
  exact(item, ["name", "source", "enabled", "model", "prewalk", "advisor"], label);
  const row: OmpAgentConfigRow = {
    name: nonEmptyText(item.name, `${label} name`),
    source: nonEmptyText(item.source, `${label} source`),
    enabled: boolean(item.enabled, `${label} enabled`),
  };
  for (const field of ["model", "prewalk", "advisor"] as const) {
    const entry = item[field];
    if (entry !== undefined) (row as Record<string, unknown>)[field] = text(entry, `${label} ${field}`);
  }
  return row;
}

/** Parse the `agents.config.list` result: the hub table without the overlay. */
export function parseOmpAgentConfigList(value: unknown): OmpAgentConfigRow[] {
  const item = record(value, "OMP agent config list");
  exact(item, ["agents"], "OMP agent config list");
  if (!Array.isArray(item.agents)) invalid("OMP agent config list agents must be an array");
  return item.agents.map((entry, index) => parseOmpAgentConfigRow(entry, index));
}

/** List every discovered agent with its effective hub config through the capability bridge. */
export async function listOmpAgentConfigs(client: OmpAgentsClient): Promise<OmpAgentConfigRow[] | undefined> {
  const result = await control(client, "agents.config.list");
  if (result === undefined) return undefined;
  try {
    return parseOmpAgentConfigList(result);
  } catch (error) {
    throw new OmpAgentsValidationError(error instanceof Error ? error.message : String(error));
  }
}

/** Per-session runtime-owned roster and child transcript projection. */
export class OmpAgents {
  #client: OmpAgentsClient | undefined;
  #agents: OmpAgentsData | undefined;
  #revision = 0;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpAgentsClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_AGENTS_RUNTIME_REASON;
  }

  setClient(client: OmpAgentsClient | undefined): void {
    const changed = this.#client !== client;
    this.#client = client;
    if (!client || changed) this.#clearUnavailable(NO_OMP_AGENTS_RUNTIME_REASON);
  }

  /** Refresh the roster from the already-running runtime. */
  async refresh(): Promise<OmpAgentsSnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_AGENTS_RUNTIME_REASON);
      return this.snapshot();
    }
    if (!controlAvailable(client)) {
      this.#clearUnavailable(NO_OMP_AGENTS_BRIDGE_REASON);
      return this.snapshot();
    }
    try {
      const agents = await readOmpAgents(client);
      if (agents === undefined) this.#clearUnavailable(NO_OMP_AGENTS_BRIDGE_REASON);
      else this.#set(agents);
    } catch (error) {
      this.#clearUnavailable(error instanceof Error ? error.message : String(error));
    }
    return this.snapshot();
  }

  /** Alias used by runtime startup and tests that seed a per-session projection. */
  async seed(): Promise<void> {
    await this.refresh();
  }

  /** Abort a running agent turn and release its row; OMP owns the lifecycle. */
  async kill(id: string): Promise<OmpAgentKillData> {
    const client = this.#client;
    if (!client || client.phase !== "ready") throw new Error(NO_OMP_AGENTS_RUNTIME_REASON);
    if (!controlAvailable(client)) throw new Error(NO_OMP_AGENTS_BRIDGE_REASON);
    const result = await killOmpAgent(client, id);
    if (result === undefined) throw new Error(NO_OMP_AGENTS_BRIDGE_REASON);
    await this.refresh();
    return result;
  }

  /** Configure one discovered agent with the hub's persist semantics; OMP owns the settings. */
  async configure(input: Omit<OmpAgentConfigRequest, "commandId" | "incarnation">): Promise<OmpAgentConfigData> {
    const client = this.#client;
    if (!client || client.phase !== "ready") throw new Error(NO_OMP_AGENTS_RUNTIME_REASON);
    if (!controlAvailable(client)) throw new Error(NO_OMP_AGENTS_BRIDGE_REASON);
    const result = await configOmpAgent(client, input);
    if (result === undefined) throw new Error(NO_OMP_AGENTS_BRIDGE_REASON);
    await this.refresh();
    return result;
  }

  /** Revive a parked agent through the lifecycle's own restore. */
  async revive(id: string): Promise<OmpAgentReviveData> {
    const client = this.#client;
    if (!client || client.phase !== "ready") throw new Error(NO_OMP_AGENTS_RUNTIME_REASON);
    if (!controlAvailable(client)) throw new Error(NO_OMP_AGENTS_BRIDGE_REASON);
    const result = await reviveOmpAgent(client, id);
    if (result === undefined) throw new Error(NO_OMP_AGENTS_BRIDGE_REASON);
    await this.refresh();
    return result;
  }

  snapshot(): OmpAgentsSnapshot {
    const client = this.#client;
    if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_AGENTS_RUNTIME_REASON };
    if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_AGENTS_BRIDGE_REASON };
    if (this.#agents === undefined) return { state: "unavailable", reason: this.#unavailableReason };
    return { state: "available", revision: this.#revision, agents: this.#agents.agents };
  }

  /** Read one named child transcript, resolving its source only from the runtime roster. */
  async transcript(agentId: string, fromByte: number): Promise<OmpAgentTranscriptSnapshot> {
    // A roster read is the source of truth for the selected session file. Reuse one already read
    // for this live runtime so an unknown or transcript-less row is refused without issuing a
    // second control call; a transcript opened directly still obtains the roster first.
    const roster = this.#agents === undefined ? await this.refresh() : this.snapshot();
    if (roster.state !== "available") return roster;
    const agent = roster.agents.find(candidate => candidate.id === agentId);
    if (agent === undefined) return { state: "unavailable", reason: NO_OMP_AGENT_UNKNOWN_REASON(agentId) };
    if (agent.sessionFile === undefined) return { state: "unavailable", reason: NO_OMP_AGENT_NO_SESSION_REASON(agentId) };
    const client = this.#client;
    if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_AGENTS_RUNTIME_REASON };
    try {
      const transcript = await readOmpAgentTranscript(client, agent.sessionFile, fromByte);
      if (transcript.sessionFile !== agent.sessionFile) throw new TypeError("OMP agent transcript session file did not match the roster");
      const snapshot = projectOmpAgentTranscript(transcript, agentId);
      // A child that has produced no output yet must say so: an available transcript with
      // zero messages would render as a silent empty. A later page (fromByte > 0) that reads
      // past the end stays available, since that is paging, not absence.
      if (snapshot.state === "available" && snapshot.messages.length === 0 && fromByte === 0) return { state: "unavailable", reason: NO_OMP_AGENT_EMPTY_TRANSCRIPT_REASON(agentId) };
      return snapshot;
    } catch (error) {
      return { state: "unavailable", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  #set(agents: OmpAgentsData): void {
    this.#agents = parseOmpAgentsData(agents);
    this.#revision += 1;
    this.#unavailableReason = "";
  }

  #clearUnavailable(reason: string): void {
    this.#agents = undefined;
    this.#unavailableReason = reason;
  }
}
