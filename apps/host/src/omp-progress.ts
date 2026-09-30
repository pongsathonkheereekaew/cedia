import {
  parseOmpGoalSnapshot,
  parseOmpGoalUpdatedEvent,
  parseOmpSubagentLifecycleFrame,
  parseOmpSubagentProgressFrame,
  parseOmpSubagentSnapshot,
  type OmpGoalCommandRequest,
  type OmpGoalSnapshot,
  type OmpSubagentRow,
} from "../../../packages/protocol/src/index.ts";

/** A live OMP client with the goal bridge negotiated in its ready frame. */
export type OmpGoalClient = {
  readonly phase: string;
  readonly readyFrame?: Record<string, unknown>;
  readonly requestCedia: (
    command: "cedia_goal",
    payload: Record<string, unknown>,
  ) => Promise<{ readonly data?: unknown }>;
  /** The stock OMP command path used for the live subagent registry. */
  readonly request?: (
    command: "get_subagents",
    payload?: Record<string, never>,
  ) => Promise<{ readonly data?: unknown }>;
};

export type OmpGoalOperationRequest = Pick<OmpGoalCommandRequest, "op" | "objective" | "tokenBudget">;

export type OmpProgressSnapshot =
  | ({ readonly state: "available"; readonly revision: number } & Omit<OmpGoalSnapshot, "startedTurn">)
  | { readonly state: "unavailable"; readonly reason: string };

export type OmpSubagentsSnapshot =
  | { readonly state: "available"; readonly revision: number; readonly subagents: readonly OmpSubagentRow[] }
  | { readonly state: "unavailable"; readonly reason: string };

export const NO_OMP_GOAL_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read or control this task's goal.";
export const NO_OMP_GOAL_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia goal bridge.";
export const NO_OMP_SUBAGENTS_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's subagents.";
export const NO_OMP_SUBAGENTS_COMMAND_REASON = "The live OMP runtime does not advertise get_subagents.";

function responseData(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { data?: unknown }).data;
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read the native goal snapshot from one already-running OMP client. */
export async function readOmpGoal(client: OmpGoalClient): Promise<OmpGoalSnapshot> {
  const response = await client.requestCedia("cedia_goal", { op: "get" });
  return parseOmpGoalSnapshot(responseData(response));
}

/** Apply one native OMP goal operation and validate the returned snapshot. */
export async function applyOmpGoal(client: OmpGoalClient, request: OmpGoalOperationRequest): Promise<OmpGoalSnapshot> {
  const response = await client.requestCedia("cedia_goal", request);
  return parseOmpGoalSnapshot(responseData(response));
}

/**
 * One per-session goal projection. OMP remains the owner: this class only caches the last
 * snapshot the runtime returned or streamed, and never starts a session to satisfy a read.
 */
export class OmpProgress {
  #client: OmpGoalClient | undefined;
  #snapshot: OmpGoalSnapshot | undefined;
  #revision = 0;
  #unavailableReason: string;
  #subagents = new Map<string, OmpSubagentRow>();
  #subagentRevision = 0;
  #subagentsUnavailableReason: string;

  constructor(options: { readonly client?: OmpGoalClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_GOAL_RUNTIME_REASON;
    this.#subagentsUnavailableReason = NO_OMP_SUBAGENTS_RUNTIME_REASON;
  }

  setClient(client: OmpGoalClient | undefined): void {
    this.#client = client;
    if (!client) {
      this.#snapshot = undefined;
      this.#unavailableReason = NO_OMP_GOAL_RUNTIME_REASON;
      this.#subagents.clear();
      this.#subagentsUnavailableReason = NO_OMP_SUBAGENTS_RUNTIME_REASON;
    }
  }

  /** Seed the cache with `cedia_goal {op:"get"}` when the session has already started. */
  async seed(): Promise<void> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#snapshot = undefined;
      this.#unavailableReason = NO_OMP_GOAL_RUNTIME_REASON;
      this.#subagents.clear();
      this.#subagentsUnavailableReason = NO_OMP_SUBAGENTS_RUNTIME_REASON;
      return;
    }
    if (client.readyFrame?.cediaGoalVersion !== 1) {
      this.#snapshot = undefined;
      this.#unavailableReason = NO_OMP_GOAL_BRIDGE_REASON;
    } else {
      try {
        this.#set(await readOmpGoal(client));
      } catch (error) {
        // A malformed or refused read is not a goal. Keep it unavailable so a caller never
        // mistakes an empty cache for a runtime answer.
        this.#snapshot = undefined;
        this.#unavailableReason = errorText(error);
      }
    }
    await this.#seedSubagents(client);
  }

  /** Fold one raw streamed OMP `goal_updated` frame into the cache. */
  update(frame: unknown): void {
    const type = frame && typeof frame === "object" && !Array.isArray(frame)
      ? (frame as Record<string, unknown>).type
      : undefined;
    if (type === "subagent_lifecycle") {
      try { this.#updateSubagentLifecycle(parseOmpSubagentLifecycleFrame(frame)); } catch { /* Malformed runtime frame is ignored. */ }
      return;
    }
    if (type === "subagent_progress") {
      try { this.#updateSubagentProgress(parseOmpSubagentProgressFrame(frame)); } catch { /* Malformed runtime frame is ignored. */ }
      return;
    }
    const event = parseOmpGoalUpdatedEvent(frame);
    const state = event.state === undefined
      ? { enabled: event.goal !== null, goal: event.goal }
      : { ...event.state, goal: event.goal };
    this.#set(parseOmpGoalSnapshot(state));
  }

  snapshot(): OmpProgressSnapshot {
    if (this.#snapshot === undefined) return { state: "unavailable", reason: this.#unavailableReason };
    // `startedTurn` belongs to the POST operation that produced it. A subsequent GET is the
    // runtime's current state, so do not make a one-shot command receipt look like persistent
    // goal metadata.
    const { startedTurn: _startedTurn, ...state } = this.#snapshot;
    return { state: "available", ...state, revision: this.#revision };
  }

  subagents(): OmpSubagentsSnapshot {
    if (this.#subagentsUnavailableReason) return { state: "unavailable", reason: this.#subagentsUnavailableReason };
    const subagents = [...this.#subagents.values()].sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
    return { state: "available", revision: this.#subagentRevision, subagents };
  }

  /** Dispatch through OMP and update the cache only after its success. */
  async apply(request: OmpGoalOperationRequest): Promise<OmpGoalSnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") throw new Error(NO_OMP_GOAL_RUNTIME_REASON);
    if (client.readyFrame?.cediaGoalVersion !== 1) throw new Error(NO_OMP_GOAL_BRIDGE_REASON);
    const snapshot = await applyOmpGoal(client, request);
    this.#set(snapshot);
    return snapshot;
  }

  #set(snapshot: OmpGoalSnapshot): void {
    this.#snapshot = parseOmpGoalSnapshot(snapshot);
    this.#revision += 1;
    this.#unavailableReason = "";
  }

  async #seedSubagents(client: OmpGoalClient): Promise<void> {
    this.#subagents.clear();
    if (!client.request) {
      this.#subagentsUnavailableReason = NO_OMP_SUBAGENTS_COMMAND_REASON;
      return;
    }
    try {
      const response = await client.request("get_subagents");
      const rows = parseOmpSubagentSnapshot(responseData(response));
      for (const row of rows) this.#subagents.set(row.id, row);
      this.#subagentRevision += 1;
      this.#subagentsUnavailableReason = "";
    } catch (error) {
      this.#subagents.clear();
      this.#subagentsUnavailableReason = errorText(error);
    }
  }

  #updateSubagentLifecycle(frame: ReturnType<typeof parseOmpSubagentLifecycleFrame>): void {
    const payload = frame.payload;
    const existing = this.#subagents.get(payload.id);
    if (payload.status === "started") {
      const row: OmpSubagentRow = {
        id: payload.id,
        index: payload.index,
        agent: payload.agent,
        agentSource: payload.agentSource,
        status: "running",
        ...(payload.description === undefined ? (existing?.description === undefined ? {} : { description: existing.description }) : { description: payload.description }),
        ...(existing?.task === undefined ? {} : { task: existing.task }),
        ...(existing?.assignment === undefined ? {} : { assignment: existing.assignment }),
        ...(payload.sessionFile === undefined ? (existing?.sessionFile === undefined ? {} : { sessionFile: existing.sessionFile }) : { sessionFile: payload.sessionFile }),
        ...(payload.parentToolCallId === undefined ? (existing?.parentToolCallId === undefined ? {} : { parentToolCallId: existing.parentToolCallId }) : { parentToolCallId: payload.parentToolCallId }),
        lastUpdate: Date.now(),
        ...(existing?.progress === undefined ? {} : { progress: existing.progress }),
      };
      this.#subagents.set(row.id, row);
    } else {
      this.#subagents.delete(payload.id);
    }
    this.#subagentRevision += 1;
    this.#subagentsUnavailableReason = "";
  }

  #updateSubagentProgress(frame: ReturnType<typeof parseOmpSubagentProgressFrame>): void {
    const payload = frame.payload;
    const progress = payload.progress;
    const existing = this.#subagents.get(progress.id);
    const row: OmpSubagentRow = {
      id: progress.id,
      index: payload.index,
      agent: payload.agent,
      agentSource: payload.agentSource,
      status: progress.status,
      ...(existing?.description === undefined ? {} : { description: existing.description }),
      ...(payload.task.length > 0 ? { task: payload.task } : existing?.task === undefined ? {} : { task: existing.task }),
      ...(payload.assignment === undefined ? (existing?.assignment === undefined ? {} : { assignment: existing.assignment }) : { assignment: payload.assignment }),
      ...(payload.sessionFile === undefined ? (existing?.sessionFile === undefined ? {} : { sessionFile: existing.sessionFile }) : { sessionFile: payload.sessionFile }),
      ...(payload.parentToolCallId === undefined ? (existing?.parentToolCallId === undefined ? {} : { parentToolCallId: existing.parentToolCallId }) : { parentToolCallId: payload.parentToolCallId }),
      lastUpdate: Date.now(),
      progress: {
        toolCount: progress.toolCount,
        requests: progress.requests,
        tokens: progress.tokens,
        cost: progress.cost,
        durationMs: progress.durationMs,
        ...(progress.currentTool === undefined ? {} : { currentTool: progress.currentTool }),
        ...(progress.contextTokens === undefined ? {} : { contextTokens: progress.contextTokens }),
        ...(progress.contextWindow === undefined ? {} : { contextWindow: progress.contextWindow }),
        ...(progress.resolvedModel === undefined ? {} : { resolvedModel: progress.resolvedModel }),
      },
    };
    this.#subagents.set(row.id, row);
    this.#subagentRevision += 1;
    this.#subagentsUnavailableReason = "";
  }
}
