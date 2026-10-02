/** Cedia application protocol. OMP remains the execution/transcript authority. */
export const CEDIA_PROTOCOL_VERSION = 1 as const;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Project {
  id: string;
  path: string;
  name: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
}

export interface Session {
  pinned?: boolean;
  id: string;
  projectId: string;
  title: string;
  cwd: string;
  sessionFile: string;
  incarnation: string;
  status: "idle" | "running" | "stopped" | "recovery_required";
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Set when this session is a sidechat fork: the id of the task it was forked
   * from. `null` for an ordinary session; the host stamps it on every session
   * row it serves, because that relationship decides whether a client may
   * re-open an existing fork id instead of creating a new task.
   */
  sidechatSourceThreadId?: string | null;
  /**
   * How this task's files are isolated, stamped by the host from the workspace record
   * it wrote when the task was created (§2.2 project and workspace, §3.C).
   */
  workspace?: SessionWorkspace;
  /** Durable workspace/cleanup association kept on the task row (§2.6). */
  workspaceMetadata?: SessionWorkspaceMetadata;
  /**
   * What the host kept when the task was archived (§2.6). Archiving retains the workspace;
   * cleanup stays unavailable until its guards pass, so the receipt is the proof that a
   * retained task can still be restored to the revision it stopped on.
   */
  archive?: SessionArchiveReceipt;
  /**
   * The host's projection of the turns submitted to this task (§2.4), most recent last.
   * This is bookkeeping about submissions, never a second transcript: the conversation
   * itself stays in OMP's own session file.
   */
  turns?: readonly TurnIntent[];
  /**
   * A model/effort change this task is holding for its next turn (§2.4). OMP validates it on
   * acceptance and commits it at a turn boundary; until OMP reports that commit the state is
   * `awaiting`, and a requested selection is never presented as a turn's active model.
   */
  pendingModel?: SessionPendingModel;
}

export interface SessionPendingModel {
  /** Cedia's marker for this change, echoed by OMP when it commits it. */
  readonly revision: number;
  readonly state: "awaiting" | "in-effect" | "refused";
  readonly requested: {
    readonly provider?: string;
    readonly modelId?: string;
    readonly thinkingLevel?: string | null;
  };
  /** When OMP accepted the revision. */
  readonly acceptedAt: string;
  /** What OMP reported committing, once it reported one. */
  readonly applied?: {
    /** The model OMP reported running afterwards, as `provider/id`. */
    readonly model?: string;
    readonly thinkingLevel?: string;
    readonly at: string;
    /**
     * `turn-boundary` when the runtime committed the change at its own dequeue/start boundary,
     * `immediate` when this runtime has no such boundary and the change was applied at once.
     */
    readonly via?: "turn-boundary" | "immediate";
  };
  /** Why the change was refused, in the runtime's or the host's words. */
  readonly error?: string;
}

/**
 * Where one submitted turn stands (§2.4).
 *
 * `prepared` and `queued` are Cedia's own acceptance states; `running`, `completed`,
 * `failed` and `cancelled` are conclusions drawn from OMP's frames; `needs_continue`
 * and `outcome_unknown` are the honest answers when Cedia cannot prove what happened,
 * and are never resolved by guessing or by replaying the turn.
 */
export type TurnState = "prepared" | "queued" | "running" | "completed" | "failed" | "cancelled" | "needs_continue" | "outcome_unknown";

export interface TurnIntent {
  /** Stable identity of this submitted turn, linked to the command that carried it. */
  turnIntentId: string;
  commandId: string;
  deviceId: string;
  incarnation: string;
  /** The same payload hash the command receipt carries, so a replay is provably the same turn. */
  payloadHash: string;
  /** The order Cedia accepted intents for this task; OMP's own order is reported separately. */
  acceptedSequence: number;
  state: TurnState;
  /**
   * The position OMP's queue snapshot reported for this intent, once a runtime that
   * advertises the queue bridge answered. Absent means OMP never reported one.
   */
  queuePosition?: number;
  /** The OMP event sequence this projection last used as evidence. */
  evidenceSequence?: number;
  /**
   * The model OMP reported actually running this turn, as `provider/id`, read from the runtime
   * at the turn's boundary. Absent means OMP has not reported one - never a requested model.
   */
  model?: string;
  /** The thinking level OMP reported with that model, when it reported one. */
  thinkingLevel?: string;
  /** Why the state is what it is, in the user's words. */
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionArchiveReceipt {
  /**
   * `retained` while the archive holds the workspace; `prepared` after the immutable cleanup
   * receipt is durable; `removed` once the worktree was removed; `restored` once Continue put the
   * task back.
   */
  readonly state: "retained" | "prepared" | "removed" | "restored";
  /** The immutable ref this archive created, when the task worked in a managed worktree. */
  readonly ref?: string;
  readonly commit?: string;
  readonly branch?: string;
  /** The managed worktree the task kept, when it had one. */
  readonly worktree?: string;
  /** True when the task stopped with tracked changes, so restoring is not "clean". */
  readonly dirty: boolean;
  /** True when the worktree held ignored files, which Cedia never removes. */
  readonly ignored: boolean;
  readonly recordedAt: string;
  /** Why the host retained rather than removed anything, in the user's words. */
  readonly reason: string;
  /** How Continue restored this task, once it has (§2.6). */
  readonly restored?: SessionRestoration;
}

export interface SessionRestoration {
  readonly at: string;
  /** The worktree the task continues in. */
  readonly worktree: string;
  readonly branch: string;
  /** True when the recorded task branch itself was reattached rather than a new branch. */
  readonly reattached: boolean;
  /** How the revision was reinstated, in the user's words. */
  readonly reason: string;
}

export interface SessionWorkspace {
  readonly mode: "local" | "worktree";
  /** True when the project folder is a Git repository. */
  readonly isGit: boolean;
  readonly cwd: string;
  readonly root: string;
  /** The branch the task started from; absent on a detached HEAD. */
  readonly branch?: string;
  /** The commit the task started from. */
  readonly sourceCommit?: string;
  /**
   * The base revision the caller asked for, when it named one. The label is not proof of
   * anything on its own: `sourceCommit` is the commit that label resolved to before the
   * worktree was created (§3.C), which is what the task actually started from.
   */
  readonly baseRef?: string;
  /**
   * What the new worktree carried from the project folder's uncommitted state (§3.C
   * "optional selected uncommitted-file copying"). Present only for a worktree task: a task
   * that shares the project folder has nothing to carry, and a refusal is reported per path
   * rather than silently dropping the file.
   */
  readonly dirtyCopy?: SessionDirtyCopy;
  /** Durable task-row fields are projected here as well for clients that only consume workspace. */
  readonly taskId?: string;
  readonly projectId?: string;
  readonly repositoryId?: string;
  readonly worktreeRoot?: string;
  readonly actualCwd?: string;
  readonly taskBranch?: string;
  readonly integrationTargetRef?: string;
  readonly integrationTargetCommit?: string;
  readonly integrationObservedCommit?: string;
  readonly restorationRef?: string;
  readonly restorationSha?: string;
  readonly cleanupGeneration?: number;
  readonly cleanupState?: SessionCleanupState;
  readonly lastFailure?: string;
}

/** The durable cleanup state machine for one task workspace. */
export type SessionCleanupState = "retained" | "archive_requested" | "prepared" | "removed";

/** One project path the caller asked a new worktree to carry, and what actually happened. */
export interface SessionDirtyCopyEntry {
  readonly path: string;
  /**
   * `applied` a tracked modification, `copied` an untracked file, `unchanged` nothing to
   * carry, `conflict` a refusal that names its reason. Conflicts are reported; the source
   * folder is never modified by any of them.
   */
  readonly state: "applied" | "copied" | "unchanged" | "conflict";
  readonly reason?: string;
}

/** Which uncommitted project files a task carried: all of them, none, or the named ones. */
export interface SessionDirtyCopy {
  readonly mode: "all" | "none" | "selected";
  readonly entries: readonly SessionDirtyCopyEntry[];
}

/** A cleanup gate's evidence, kept explicit so an unavailable check cannot look like a pass. */
export type SessionCleanupGateState = "passed" | "blocked" | "unavailable" | "uncertain";

export interface SessionCleanupGate {
  readonly id: "turn" | "integration" | "working_tree" | "terminals" | "ide" | "recheck";
  readonly state: SessionCleanupGateState;
  readonly reason?: string;
}

export interface SessionCleanupCapability {
  readonly enabled: boolean;
  readonly reason: string;
}

/** Workspace facts that must survive a host restart and are never inferred from a label. */
export interface SessionWorkspaceMetadata {
  readonly taskId: string;
  readonly projectId: string;
  /** Canonical Git common directory, when this task belongs to a repository. */
  readonly repositoryId?: string;
  /** Managed worktree root; absent for a shared project folder. */
  readonly worktreeRoot?: string;
  /** The actual task cwd, which may be nested below the worktree root. */
  readonly actualCwd: string;
  readonly sourceCommit?: string;
  readonly taskBranch?: string;
  /** Ref used as the integration target, usually the primary branch. */
  readonly integrationTargetRef?: string;
  /** Commit observed at the target ref when this metadata was recorded. */
  readonly integrationTargetCommit?: string;
  /** Descriptive alias for integrations that call the target observation a separate field. */
  readonly integrationObservedCommit?: string;
  /** Immutable archive ref and the exact SHA it protects for Continue. */
  readonly restorationRef?: string;
  readonly restorationSha?: string;
  readonly cleanupGeneration: number;
  readonly cleanupState: SessionCleanupState;
  readonly lastFailure?: string;
}

export interface SessionCleanupResult {
  readonly sessionId: string;
  readonly state: SessionCleanupState;
  readonly removed: boolean;
  readonly capability: SessionCleanupCapability;
  readonly gates: readonly SessionCleanupGate[];
  readonly reason: string;
  readonly generation: number;
}

export type CommandStatus = "claimed" | "acknowledged" | "completed" | "failed" | "outcome_unknown" | "not_dispatched";
export interface Command {
  sessionId: string;
  commandId: string;
  deviceId: string;
  incarnation: string;
  kind: string;
  payload: Json;
  payloadHash: string;
  status: CommandStatus;
  ack?: Json;
  result?: Json;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Every session-event kind the pinned OMP session emits (§8.2 O01).
 *
 * This is Cedia's typed registry, not a copy of OMP's source: the F coverage gate compares it
 * with the dated audit's own union, so an upstream event Cedia has not classified is reported
 * instead of being absorbed by the generic transcript row. A kind that is listed here is
 * recognised by name; it is not a claim that a surface draws it.
 */
export const CEDIA_SESSION_EVENT_KINDS = [
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_stream_update",
  "tool_execution_end",
  "auto_compaction_start",
  "auto_compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "retry_fallback_applied",
  "retry_fallback_succeeded",
  "model_changed",
  "config_warnings_changed",
  "advisor_cost_changed",
  "advisor_yielded",
  "ttsr_triggered",
  "todo_reminder",
  "todo_auto_clear",
  "irc_message",
  "notice",
  "thinking_level_changed",
  "goal_updated",
] as const;

export type CediaSessionEventKind = (typeof CEDIA_SESSION_EVENT_KINDS)[number];

/**
 * The payload-free session signals.
 *
 * OMP emits these to say that a piece of session state changed and the client should re-read it:
 * the config warnings situation, the advisor's cost, and that the advisor yielded this turn.
 * They carry no data of their own, so a client that does not recognise them by name silently
 * loses the change - the three recognition gaps the dated audit names.
 */
export const CEDIA_SESSION_EVENT_SIGNALS = [
  "config_warnings_changed",
  "advisor_cost_changed",
  "advisor_yielded",
] as const;

export type CediaSessionEventSignal = (typeof CEDIA_SESSION_EVENT_SIGNALS)[number];

/** One recognised session signal, with where it was seen in the session's event order. */
export interface SessionEventSignal {
  readonly kind: CediaSessionEventSignal;
  readonly sequence?: number;
  readonly at?: string;
}

export function isCediaSessionEventKind(value: unknown): value is CediaSessionEventKind {
  return typeof value === "string" && (CEDIA_SESSION_EVENT_KINDS as readonly string[]).includes(value);
}

export function isCediaSessionEventSignal(value: unknown): value is CediaSessionEventSignal {
  return typeof value === "string" && (CEDIA_SESSION_EVENT_SIGNALS as readonly string[]).includes(value);
}

export interface SessionEvent {
  sessionId: string;
  incarnation: string;
  sequence: number;
  timestamp: string;
  frame: Json;
}

/** Native OMP goal state projected by the Cedia goal bridge (plan §8.2 O07). */
export type OmpGoalStatus = "active" | "paused" | "budget-limited" | "complete" | "dropped";

export interface OmpGoal {
  readonly id: string;
  readonly objective: string;
  readonly status: OmpGoalStatus;
  readonly tokenBudget?: number;
  readonly tokensUsed: number;
  readonly timeUsedSeconds: number;
  /** Epoch milliseconds from OMP; the adapter turns these into ISO strings for the renderer. */
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** The data returned by `cedia_goal`, and the optional state on `goal_updated`. */
export interface OmpGoalSnapshot {
  readonly enabled: boolean;
  readonly mode?: "active" | "exiting";
  readonly reason?: "completed";
  readonly goal: OmpGoal | null;
  /** Present only when `set`/`replace` started the objective as a turn. */
  readonly startedTurn?: boolean;
}

export type OmpGoalOperation = "get" | "set" | "replace" | "pause" | "resume" | "drop" | "complete" | "budget";

/** The host route's command envelope payload, before it is sent to OMP. */
export interface OmpGoalCommandRequest {
  readonly commandId: string;
  readonly incarnation: string;
  readonly op: OmpGoalOperation;
  readonly objective?: string;
  readonly tokenBudget?: number;
}

/** A raw goal update carried by OMP's session event stream. */
export interface OmpGoalUpdatedEvent {
  readonly type: "goal_updated";
  readonly goal: OmpGoal | null;
  readonly state?: OmpGoalSnapshot;
}

export type RpcCediaGoalData = OmpGoalSnapshot;

export class OmpGoalValidationError extends TypeError {
  readonly code = "omp_goal_invalid" as const;
  constructor(message: string) {
    super(message);
    this.name = "OmpGoalValidationError";
  }
}

const OMP_GOAL_STATUSES = ["active", "paused", "budget-limited", "complete", "dropped"] as const;
const OMP_GOAL_SNAPSHOT_KEYS = new Set(["enabled", "mode", "reason", "goal", "startedTurn"]);
const OMP_GOAL_KEYS = new Set(["id", "objective", "status", "tokenBudget", "tokensUsed", "timeUsedSeconds", "createdAt", "updatedAt"]);

function goalRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OmpGoalValidationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function goalExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new OmpGoalValidationError(`${label} has an unknown field ${key}`);
}

function goalText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new OmpGoalValidationError(`${label} must be a non-empty string`);
  return value;
}

function goalBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new OmpGoalValidationError(`${label} must be a boolean`);
  return value;
}

function goalNumber(value: unknown, label: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < 0)
    throw new OmpGoalValidationError(`${label} must be a non-negative ${integer ? "integer" : "number"}`);
  return value;
}

/** Parse one untrusted goal row from OMP. */
export function parseOmpGoal(value: unknown): OmpGoal {
  const record = goalRecord(value, "OMP goal");
  goalExactKeys(record, OMP_GOAL_KEYS, "OMP goal");
  const id = goalText(record.id, "OMP goal id");
  const objective = goalText(record.objective, "OMP goal objective");
  if (typeof record.status !== "string" || !(OMP_GOAL_STATUSES as readonly string[]).includes(record.status)) throw new OmpGoalValidationError("OMP goal status is unsupported");
  const status = record.status as OmpGoalStatus;
  const tokenBudget = record.tokenBudget === undefined ? undefined : goalNumber(record.tokenBudget, "OMP goal token budget", true);
  if (tokenBudget !== undefined && tokenBudget <= 0) throw new OmpGoalValidationError("OMP goal token budget must be positive");
  const tokensUsed = goalNumber(record.tokensUsed, "OMP goal tokens used", true);
  const timeUsedSeconds = goalNumber(record.timeUsedSeconds, "OMP goal time used");
  const createdAt = goalNumber(record.createdAt, "OMP goal createdAt", true);
  const updatedAt = goalNumber(record.updatedAt, "OMP goal updatedAt", true);
  return { id, objective, status, ...(tokenBudget === undefined ? {} : { tokenBudget }), tokensUsed, timeUsedSeconds, createdAt, updatedAt };
}

/** Parse the strict data object returned by `cedia_goal`. */
export function parseOmpGoalSnapshot(value: unknown): OmpGoalSnapshot {
  const record = goalRecord(value, "OMP goal snapshot");
  goalExactKeys(record, OMP_GOAL_SNAPSHOT_KEYS, "OMP goal snapshot");
  const enabled = goalBoolean(record.enabled, "OMP goal enabled marker");
  const mode = record.mode === undefined ? undefined : record.mode === "active" || record.mode === "exiting" ? record.mode : undefined;
  if (record.mode !== undefined && mode === undefined) throw new OmpGoalValidationError("OMP goal mode is unsupported");
  const reason = record.reason === undefined ? undefined : record.reason === "completed" ? record.reason : undefined;
  if (record.reason !== undefined && reason === undefined) throw new OmpGoalValidationError("OMP goal reason is unsupported");
  const goal = record.goal === null ? null : parseOmpGoal(record.goal);
  const startedTurn = record.startedTurn === undefined ? undefined : goalBoolean(record.startedTurn, "OMP goal started-turn marker");
  return {
    enabled,
    ...(mode === undefined ? {} : { mode }),
    ...(reason === undefined ? {} : { reason }),
    goal,
    ...(startedTurn === undefined ? {} : { startedTurn }),
  };
}

/** Parse a raw `goal_updated` event without coercing malformed goal rows. */
export function parseOmpGoalUpdatedEvent(value: unknown): OmpGoalUpdatedEvent {
  const record = goalRecord(value, "OMP goal update");
  goalExactKeys(record, new Set(["type", "goal", "state"]), "OMP goal update");
  if (record.type !== "goal_updated") throw new OmpGoalValidationError("OMP goal update type is unsupported");
  const goal = record.goal === null ? null : parseOmpGoal(record.goal);
  const state = record.state === undefined ? undefined : parseOmpGoalSnapshot(record.state);
  return { type: "goal_updated", goal, ...(state === undefined ? {} : { state }) };
}

export const validateOmpGoal = parseOmpGoal;
export const validateOmpGoalSnapshot = parseOmpGoalSnapshot;

/** Native OMP subagent state projected by the Cedia subagent bridge (plan §8.2 O07). */
export type OmpSubagentStatus = "pending" | "running" | "completed" | "failed" | "aborted";
export type OmpSubagentAgentSource = "bundled" | "user" | "project";

/** The bounded accounting/progress fields a Cedia row may expose. */
export interface OmpSubagentProgress {
  readonly toolCount: number;
  readonly requests: number;
  readonly tokens: number;
  readonly cost: number;
  readonly durationMs: number;
  readonly currentTool?: string;
  readonly contextTokens?: number;
  readonly contextWindow?: number;
  readonly resolvedModel?: string;
}
export type OmpSubagentProgressProjection = OmpSubagentProgress;

/** One live row returned by OMP's `get_subagents`. */
export interface OmpSubagentRow {
  readonly id: string;
  readonly index: number;
  readonly agent: string;
  readonly agentSource: OmpSubagentAgentSource;
  readonly status: OmpSubagentStatus;
  readonly description?: string;
  readonly task?: string;
  readonly assignment?: string;
  readonly sessionFile?: string;
  readonly parentToolCallId?: string;
  readonly lastUpdate: number;
  readonly progress?: OmpSubagentProgress;
}

export interface OmpSubagentLifecycleFrame {
  readonly type: "subagent_lifecycle";
  readonly payload: {
    readonly id: string;
    readonly index: number;
    readonly agent: string;
    readonly agentSource: OmpSubagentAgentSource;
    readonly description?: string;
    readonly status: "started" | "completed" | "failed" | "aborted";
    readonly sessionFile?: string;
    readonly parentToolCallId?: string;
    readonly detached?: boolean;
  };
}

/** A progress frame keeps only identity/status plus the bounded accounting projection. */
export interface OmpSubagentProgressFrame {
  readonly type: "subagent_progress";
  readonly payload: {
    readonly index: number;
    readonly agent: string;
    readonly agentSource: OmpSubagentAgentSource;
    readonly task: string;
    readonly parentToolCallId?: string;
    readonly assignment?: string;
    readonly sessionFile?: string;
    readonly detached?: boolean;
    readonly progress: OmpSubagentProgress & { readonly id: string; readonly status: OmpSubagentStatus };
  };
}

export type OmpSubagentFrame = OmpSubagentLifecycleFrame | OmpSubagentProgressFrame;

export class OmpSubagentValidationError extends TypeError {
  readonly code = "omp_subagent_invalid" as const;
  constructor(message: string) {
    super(message);
    this.name = "OmpSubagentValidationError";
  }
}

const OMP_SUBAGENT_STATUSES = ["pending", "running", "completed", "failed", "aborted"] as const;
const OMP_SUBAGENT_AGENT_SOURCES = ["bundled", "user", "project"] as const;
const OMP_SUBAGENT_LIFECYCLE_STATUSES = ["started", "completed", "failed", "aborted"] as const;
const OMP_SUBAGENT_ROW_KEYS = new Set([
  "id", "index", "agent", "agentSource", "status", "description", "task", "assignment",
  "sessionFile", "parentToolCallId", "lastUpdate", "progress",
]);
const OMP_SUBAGENT_PROGRESS_KEYS = new Set([
  "id", "index", "agent", "agentSource", "status", "task", "assignment", "description", "lastIntent",
  "currentTool", "currentToolArgs", "currentToolStartMs", "recentTools", "recentOutput",
  "toolCount", "requests", "tokens", "contextTokens", "contextWindow", "cost", "durationMs",
  "modelOverride", "modelRole", "resolvedModel", "resolvedModelIdentity", "resolvedThinkingLevel",
  "resolvedModelIsFallback", "advisor", "extractedToolData", "retryState", "retryFailure", "inflightTaskDetails",
]);
const OMP_SUBAGENT_LIFECYCLE_FRAME_KEYS = new Set(["type", "payload"]);
const OMP_SUBAGENT_LIFECYCLE_PAYLOAD_KEYS = new Set([
  "id", "index", "agent", "agentSource", "description", "status", "sessionFile", "parentToolCallId", "detached",
]);
const OMP_SUBAGENT_PROGRESS_FRAME_KEYS = new Set(["type", "payload"]);
const OMP_SUBAGENT_PROGRESS_PAYLOAD_KEYS = new Set([
  "index", "agent", "agentSource", "task", "parentToolCallId", "assignment", "progress", "sessionFile", "detached",
]);

function subagentRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OmpSubagentValidationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function subagentExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new OmpSubagentValidationError(`${label} has an unknown field ${key}`);
}

function subagentText(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) throw new OmpSubagentValidationError(`${label} must be a ${allowEmpty ? "string" : "non-empty string"}`);
  return value;
}

function subagentNumber(value: unknown, label: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < 0)
    throw new OmpSubagentValidationError(`${label} must be a non-negative ${integer ? "integer" : "number"}`);
  return value;
}

function subagentEnum<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new OmpSubagentValidationError(`${label} is unsupported`);
  return value as T;
}

function optionalSubagentText(record: Record<string, unknown>, key: string, label: string): string | undefined {
  return record[key] === undefined ? undefined : subagentText(record[key], label);
}

interface ParsedOmpSubagentProgress {
  readonly projection: OmpSubagentProgress;
  readonly id?: string;
  readonly status?: OmpSubagentStatus;
}

/** Parse a runtime AgentProgress object and discard transcript/tool argument/output fields. */
function parseOmpSubagentProgressProjection(value: unknown, requireIdentity: boolean): ParsedOmpSubagentProgress {
  const record = subagentRecord(value, "OMP subagent progress");
  subagentExactKeys(record, OMP_SUBAGENT_PROGRESS_KEYS, "OMP subagent progress");
  const id = record.id === undefined
    ? undefined
    : subagentText(record.id, "OMP subagent progress id");
  if (requireIdentity && id === undefined) throw new OmpSubagentValidationError("OMP subagent progress id is required");
  const status = record.status === undefined
    ? undefined
    : subagentEnum(record.status, OMP_SUBAGENT_STATUSES, "OMP subagent progress status");
  if (requireIdentity && status === undefined) throw new OmpSubagentValidationError("OMP subagent progress status is required");
  if (record.index !== undefined) subagentNumber(record.index, "OMP subagent progress index", true);
  if (record.agent !== undefined) subagentText(record.agent, "OMP subagent progress agent");
  if (record.agentSource !== undefined) subagentEnum(record.agentSource, OMP_SUBAGENT_AGENT_SOURCES, "OMP subagent progress agentSource");
  if (record.task !== undefined) subagentText(record.task, "OMP subagent progress task");
  if (record.assignment !== undefined) subagentText(record.assignment, "OMP subagent progress assignment");
  if (record.description !== undefined) subagentText(record.description, "OMP subagent progress description");
  if (record.lastIntent !== undefined) subagentText(record.lastIntent, "OMP subagent progress lastIntent");
  if (record.modelOverride !== undefined && typeof record.modelOverride !== "string" && !(Array.isArray(record.modelOverride) && record.modelOverride.every(item => typeof item === "string"))) throw new OmpSubagentValidationError("OMP subagent progress modelOverride is malformed");
  if (record.modelRole !== undefined) subagentText(record.modelRole, "OMP subagent progress modelRole");
  if (record.resolvedModelIdentity !== undefined) subagentText(record.resolvedModelIdentity, "OMP subagent progress resolvedModelIdentity");
  if (record.resolvedThinkingLevel !== undefined) subagentText(record.resolvedThinkingLevel, "OMP subagent progress resolvedThinkingLevel");
  if (record.resolvedModelIsFallback !== undefined && typeof record.resolvedModelIsFallback !== "boolean") throw new OmpSubagentValidationError("OMP subagent progress resolvedModelIsFallback must be a boolean");
  if (record.advisor !== undefined && typeof record.advisor !== "boolean") throw new OmpSubagentValidationError("OMP subagent progress advisor must be a boolean");
  if (record.extractedToolData !== undefined) subagentRecord(record.extractedToolData, "OMP subagent progress extractedToolData");
  if (record.retryState !== undefined) subagentRecord(record.retryState, "OMP subagent progress retryState");
  if (record.retryFailure !== undefined) subagentRecord(record.retryFailure, "OMP subagent progress retryFailure");
  if (record.inflightTaskDetails !== undefined) subagentRecord(record.inflightTaskDetails, "OMP subagent progress inflightTaskDetails");
  if (record.currentToolArgs !== undefined) subagentText(record.currentToolArgs, "OMP subagent progress currentToolArgs", true);
  if (record.currentToolStartMs !== undefined) subagentNumber(record.currentToolStartMs, "OMP subagent progress currentToolStartMs", true);
  if (record.recentTools !== undefined) {
    if (!Array.isArray(record.recentTools) || record.recentTools.length > 256) throw new OmpSubagentValidationError("OMP subagent progress recentTools must be a bounded array");
    for (const tool of record.recentTools) {
      const row = subagentRecord(tool, "OMP subagent progress recent tool");
      if (typeof row.tool !== "string" || typeof row.args !== "string" || typeof row.endMs !== "number") throw new OmpSubagentValidationError("OMP subagent progress recent tool is malformed");
    }
  }
  if (record.recentOutput !== undefined) {
    if (!Array.isArray(record.recentOutput) || record.recentOutput.length > 256 || record.recentOutput.some(item => typeof item !== "string")) throw new OmpSubagentValidationError("OMP subagent progress recentOutput must be a bounded string array");
  }
  const currentTool = record.currentTool === undefined ? undefined : subagentText(record.currentTool, "OMP subagent progress currentTool");
  const toolCount = subagentNumber(record.toolCount, "OMP subagent progress toolCount", true);
  const requests = subagentNumber(record.requests, "OMP subagent progress requests", true);
  const tokens = subagentNumber(record.tokens, "OMP subagent progress tokens", true);
  const cost = subagentNumber(record.cost, "OMP subagent progress cost");
  const durationMs = subagentNumber(record.durationMs, "OMP subagent progress durationMs", true);
  const contextTokens = record.contextTokens === undefined ? undefined : subagentNumber(record.contextTokens, "OMP subagent progress contextTokens", true);
  const contextWindow = record.contextWindow === undefined ? undefined : subagentNumber(record.contextWindow, "OMP subagent progress contextWindow", true);
  const resolvedModel = record.resolvedModel === undefined ? undefined : subagentText(record.resolvedModel, "OMP subagent progress resolvedModel");
  return {
    ...(id === undefined ? {} : { id }),
    ...(status === undefined ? {} : { status }),
    projection: {
      toolCount,
      requests,
      tokens,
      cost,
      durationMs,
      ...(currentTool === undefined ? {} : { currentTool }),
      ...(contextTokens === undefined ? {} : { contextTokens }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(resolvedModel === undefined ? {} : { resolvedModel }),
    },
  };
}

/** Parse one untrusted live subagent row from OMP. */
export function parseOmpSubagentRow(value: unknown): OmpSubagentRow {
  const record = subagentRecord(value, "OMP subagent row");
  subagentExactKeys(record, OMP_SUBAGENT_ROW_KEYS, "OMP subagent row");
  const id = subagentText(record.id, "OMP subagent id");
  const index = subagentNumber(record.index, "OMP subagent index", true);
  const agent = subagentText(record.agent, "OMP subagent agent");
  const agentSource = subagentEnum(record.agentSource, OMP_SUBAGENT_AGENT_SOURCES, "OMP subagent agentSource");
  const status = subagentEnum(record.status, OMP_SUBAGENT_STATUSES, "OMP subagent status");
  const description = optionalSubagentText(record, "description", "OMP subagent description");
  const task = optionalSubagentText(record, "task", "OMP subagent task");
  const assignment = optionalSubagentText(record, "assignment", "OMP subagent assignment");
  const sessionFile = optionalSubagentText(record, "sessionFile", "OMP subagent sessionFile");
  const parentToolCallId = optionalSubagentText(record, "parentToolCallId", "OMP subagent parentToolCallId");
  const lastUpdate = subagentNumber(record.lastUpdate, "OMP subagent lastUpdate", true);
  let progress: OmpSubagentProgress | undefined;
  if (record.progress !== undefined) {
    const parsed = parseOmpSubagentProgressProjection(record.progress, false);
    if (parsed.id !== undefined && parsed.id !== id) throw new OmpSubagentValidationError("OMP subagent progress id does not match row id");
    progress = parsed.projection;
  }
  return {
    id,
    index,
    agent,
    agentSource,
    status,
    ...(description === undefined ? {} : { description }),
    ...(task === undefined ? {} : { task }),
    ...(assignment === undefined ? {} : { assignment }),
    ...(sessionFile === undefined ? {} : { sessionFile }),
    ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
    lastUpdate,
    ...(progress === undefined ? {} : { progress }),
  };
}

/** Parse an untrusted array of live subagent rows from OMP. */
export function parseOmpSubagentList(value: unknown): OmpSubagentRow[] {
  if (!Array.isArray(value) || value.length > 256) throw new OmpSubagentValidationError("OMP subagent list must be a bounded array");
  const rows = value.map(parseOmpSubagentRow);
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new OmpSubagentValidationError(`OMP subagent id is duplicated: ${row.id}`);
    ids.add(row.id);
  }
  return rows;
}

/** Parse the `get_subagents` response envelope. */
export function parseOmpSubagentSnapshot(value: unknown): OmpSubagentRow[] {
  const record = subagentRecord(value, "OMP subagent snapshot");
  subagentExactKeys(record, new Set(["subagents"]), "OMP subagent snapshot");
  return parseOmpSubagentList(record.subagents);
}

/** Parse one raw `subagent_lifecycle` frame. */
export function parseOmpSubagentLifecycleFrame(value: unknown): OmpSubagentLifecycleFrame {
  const frame = subagentRecord(value, "OMP subagent lifecycle frame");
  subagentExactKeys(frame, OMP_SUBAGENT_LIFECYCLE_FRAME_KEYS, "OMP subagent lifecycle frame");
  if (frame.type !== "subagent_lifecycle") throw new OmpSubagentValidationError("OMP subagent lifecycle frame type is unsupported");
  const payload = subagentRecord(frame.payload, "OMP subagent lifecycle payload");
  subagentExactKeys(payload, OMP_SUBAGENT_LIFECYCLE_PAYLOAD_KEYS, "OMP subagent lifecycle payload");
  const id = subagentText(payload.id, "OMP subagent lifecycle id");
  const index = subagentNumber(payload.index, "OMP subagent lifecycle index", true);
  const agent = subagentText(payload.agent, "OMP subagent lifecycle agent");
  const agentSource = subagentEnum(payload.agentSource, OMP_SUBAGENT_AGENT_SOURCES, "OMP subagent lifecycle agentSource");
  const description = optionalSubagentText(payload, "description", "OMP subagent lifecycle description");
  const status = subagentEnum(payload.status, OMP_SUBAGENT_LIFECYCLE_STATUSES, "OMP subagent lifecycle status");
  const sessionFile = optionalSubagentText(payload, "sessionFile", "OMP subagent lifecycle sessionFile");
  const parentToolCallId = optionalSubagentText(payload, "parentToolCallId", "OMP subagent lifecycle parentToolCallId");
  const detached = payload.detached === undefined ? undefined : payload.detached;
  if (detached !== undefined && typeof detached !== "boolean") throw new OmpSubagentValidationError("OMP subagent lifecycle detached must be a boolean");
  return {
    type: "subagent_lifecycle",
    payload: {
      id, index, agent, agentSource,
      ...(description === undefined ? {} : { description }),
      status,
      ...(sessionFile === undefined ? {} : { sessionFile }),
      ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
      ...(detached === undefined ? {} : { detached }),
    },
  };
}

/** Parse one raw `subagent_progress` frame and drop unbounded runtime fields. */
export function parseOmpSubagentProgressFrame(value: unknown): OmpSubagentProgressFrame {
  const frame = subagentRecord(value, "OMP subagent progress frame");
  subagentExactKeys(frame, OMP_SUBAGENT_PROGRESS_FRAME_KEYS, "OMP subagent progress frame");
  if (frame.type !== "subagent_progress") throw new OmpSubagentValidationError("OMP subagent progress frame type is unsupported");
  const payload = subagentRecord(frame.payload, "OMP subagent progress payload");
  subagentExactKeys(payload, OMP_SUBAGENT_PROGRESS_PAYLOAD_KEYS, "OMP subagent progress payload");
  const index = subagentNumber(payload.index, "OMP subagent progress index", true);
  const agent = subagentText(payload.agent, "OMP subagent progress agent");
  const agentSource = subagentEnum(payload.agentSource, OMP_SUBAGENT_AGENT_SOURCES, "OMP subagent progress agentSource");
  const task = subagentText(payload.task, "OMP subagent progress task");
  const parentToolCallId = optionalSubagentText(payload, "parentToolCallId", "OMP subagent progress parentToolCallId");
  const assignment = optionalSubagentText(payload, "assignment", "OMP subagent progress assignment");
  const sessionFile = optionalSubagentText(payload, "sessionFile", "OMP subagent progress sessionFile");
  const detached = payload.detached === undefined ? undefined : payload.detached;
  if (detached !== undefined && typeof detached !== "boolean") throw new OmpSubagentValidationError("OMP subagent progress detached must be a boolean");
  const progress = parseOmpSubagentProgressProjection(payload.progress, true);
  if (progress.id === undefined || progress.status === undefined) throw new OmpSubagentValidationError("OMP subagent progress identity is required");
  return {
    type: "subagent_progress",
    payload: {
      index, agent, agentSource, task,
      ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
      ...(assignment === undefined ? {} : { assignment }),
      ...(sessionFile === undefined ? {} : { sessionFile }),
      ...(detached === undefined ? {} : { detached }),
      progress: { id: progress.id, status: progress.status, ...progress.projection },
    },
  };
}

export const parseOmpSubagentRows = parseOmpSubagentList;
export const parseOmpSubagents = parseOmpSubagentList;

export interface DraftAttachment {
  readonly id: string;
  readonly name?: string;
  readonly kind: "image" | "file" | "text";
  readonly byteLength?: number;
}

export interface DraftSnapshot {
  readonly draftId: string;
  readonly revision: number;
  readonly text: string;
  readonly attachments: readonly DraftAttachment[];
  /**
   * The payload the Mac windows exchange for this draft. Opaque to the host: it is
   * the renderer's serialized composer draft, bounded in size and never interpreted
   * as execution input. `text` stays the readable projection for search and Send.
   */
  readonly content?: Json;
  readonly sessionId?: string;
  readonly updatedAt: string;
  readonly source?: string;
}

export interface DraftSubmission {
  readonly submissionId: string;
  readonly draftId: string;
  readonly revision: number;
  readonly commandId: string;
  readonly createdAt: string;
}

/**
 * One run of adjacent visible cells sharing a style. Rows are 0-based within the
 * checkpoint grid; `col` is the 0-based starting column. Colours are `#rrggbb`.
 */
export interface TerminalCheckpointRun {
  readonly row: number;
  readonly col: number;
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly foreground?: string;
  readonly background?: string;
}

/**
 * One checkpoint of a virtual terminal, as the host keeps it.
 *
 * OMP owns the PTY; the host keeps a headless screen per terminal so a client that
 * attaches (or reattaches) can restore the screen instead of replaying a bounded chunk
 * history. `lastSequence` is the highest `cedia_terminal_output` sequence folded into
 * this screen, and `historyIncomplete` says the host itself dropped a gap and cannot
 * vouch for the whole grid.
 */
export interface TerminalCheckpoint {
  terminalId: string;
  title?: string;
  cols: number;
  rows: number;
  cursorRow: number;
  cursorCol: number;
  /** Visible rows, right-trimmed; trailing blank rows are dropped. */
  lines: string[];
  /** Styled runs of the visible grid; absent when the engine reported no cells. */
  readonly runs?: readonly TerminalCheckpointRun[];
  lastSequence: number;
  closed: boolean;
  closeReason?: string;
  historyIncomplete: boolean;
}

export interface CommandRequest {
  commandId: string;
  incarnation: string;
  command: string;
  payload?: { [key: string]: Json };
}

export interface UiResponseRequest {
  commandId: string;
  incarnation: string;
  token: string;
  answer: string | boolean | { cancelled: true; timedOut?: boolean };
}

/**
 * One page of a session's event journal.
 *
 * A host that bounds a session's journal (retention drops that session's oldest
 * frames once it crosses a cap) owes every reader two extra facts, so a short
 * page is never mistaken for a whole history:
 *
 * - `firstSequence` is the oldest sequence the host still holds, 0 when the
 *   session has no events at all.
 * - `historyTruncated` says retention dropped older frames, so this page is not
 *   the session's whole history.
 *
 * Both are optional because a client also builds pages of its own (a local
 * replay, a test fixture) where no host retention decision exists; a bounded
 * host always sends both.
 */
export interface EventPage {
  events: SessionEvent[];
  cursor: number;
  hasMore: boolean;
  /** Oldest sequence the host still holds; 0 when the session has no events. */
  firstSequence?: number;
  /** True when the host dropped this session's oldest events. */
  historyTruncated?: boolean;
}

export interface HostDescriptor {
  protocolVersion: typeof CEDIA_PROTOCOL_VERSION;
  url: string;
  /** Stored only in the private local descriptor; never returned by health. */
  token: string;
  pid: number;
  /** Host process start identity prevents adopting a recycled PID. */
  processStartedAt?: string;
  /** App owner lease generation adopted by the current Electron main process. */
  appGeneration?: string;
}

/** The OMP coverage family that owns a registered capability. */
export type OmpCoverageFamily =
  | "O01" | "O02" | "O03" | "O04" | "O05" | "O06"
  | "O07" | "O08" | "O09" | "O10" | "O11" | "O12";

/** Availability reported by the pinned OMP capability bridge. */
export type OmpCapabilityState = "available" | "dependency_unavailable" | "integration_missing";
export type OmpCapabilityScope = "session" | "project" | "global" | "device";
export type OmpCapabilityApply = "immediate" | "turn_boundary" | "reload" | "new_session";
export type OmpCapabilitySurface = "agent" | "ide" | "web" | "iphone";
export type OmpCapabilityPrincipal = "owner" | "controller";

/** One entry from OMP's allowlisted, versioned capability table. */
export interface OmpCapabilityDescriptor {
  readonly id: string;
  readonly family: OmpCoverageFamily;
  readonly state: OmpCapabilityState;
  readonly scope: OmpCapabilityScope;
  readonly apply: OmpCapabilityApply;
  readonly surfaces: readonly OmpCapabilitySurface[];
  readonly principal: OmpCapabilityPrincipal;
  readonly bridgeVersion: number;
  readonly schemaVersion: number;
  readonly source: string;
  readonly ompRevision: string;
  readonly receipt?: string;
  readonly reason?: string;
}

/** The response carried by `cedia_get_capabilities`. */
export interface OmpCapabilitySnapshot {
  readonly bridgeVersion: number;
  readonly schemaVersion: number;
  readonly capabilityRevision: string;
  readonly ompRevision: string;
  readonly capabilities: readonly OmpCapabilityDescriptor[];
}

/** Wire-oriented aliases used by the adapter contract; kept dependency-free in the host protocol. */
export type RpcCediaCapabilityFamily = OmpCoverageFamily;
export type RpcCediaCapabilityState = OmpCapabilityState;
export type RpcCediaCapabilityDescriptor = OmpCapabilityDescriptor;
export type RpcCediaCapabilitiesData = OmpCapabilitySnapshot;

/** The host's explicit answer about whether a live runtime capability table exists. */
export type HostOmpCapabilitySnapshot =
  | { readonly state: "available"; readonly snapshot: OmpCapabilitySnapshot }
  | { readonly state: "unavailable"; readonly reason: string };

/** Metadata exposed alongside the aggregate capability rows on the owner route. */
export type OmpCapabilityHostAnswer =
  | { readonly state: "available"; readonly capabilityRevision: string; readonly ompRevision: string }
  | { readonly state: "unavailable"; readonly reason: string };

export class OmpCapabilityValidationError extends TypeError {
  readonly code = "omp_capabilities_invalid" as const;
  constructor(message: string) {
    super(message);
    this.name = "OmpCapabilityValidationError";
  }
}

const OMP_CAPABILITY_FAMILIES = ["O01", "O02", "O03", "O04", "O05", "O06", "O07", "O08", "O09", "O10", "O11", "O12"] as const;
const OMP_CAPABILITY_STATES = ["available", "dependency_unavailable", "integration_missing"] as const;
const OMP_CAPABILITY_SCOPES = ["session", "project", "global", "device"] as const;
const OMP_CAPABILITY_APPLY = ["immediate", "turn_boundary", "reload", "new_session"] as const;
const OMP_CAPABILITY_SURFACES = ["agent", "ide", "web", "iphone"] as const;
const OMP_CAPABILITY_PRINCIPALS = ["owner", "controller"] as const;
const OMP_DESCRIPTOR_KEYS = new Set(["id", "family", "state", "scope", "apply", "surfaces", "principal", "bridgeVersion", "schemaVersion", "source", "ompRevision", "receipt", "reason"]);
const OMP_SNAPSHOT_KEYS = new Set(["bridgeVersion", "schemaVersion", "capabilityRevision", "ompRevision", "capabilities"]);

function ompRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OmpCapabilityValidationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new OmpCapabilityValidationError(`${label} has an unknown field ${key}`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new OmpCapabilityValidationError(`${label} must be a non-empty string`);
  return value;
}

function versionOne(value: unknown, label: string): number {
  if (value !== 1) throw new OmpCapabilityValidationError(`${label} must be version 1`);
  return 1;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new OmpCapabilityValidationError(`${label} is unsupported`);
  return value as T;
}

/** Parse and validate one untrusted descriptor received from OMP. */
export function parseOmpCapabilityDescriptor(value: unknown): OmpCapabilityDescriptor {
  const record = ompRecord(value, "OMP capability descriptor");
  exactKeys(record, OMP_DESCRIPTOR_KEYS, "OMP capability descriptor");
  const id = record.id;
  if (typeof id !== "string" || !/^[a-z0-9]+(?:[._-]?[a-z0-9]+)*(?:\.[a-z0-9]+(?:[._-]?[a-z0-9]+)*)+$/.test(id))
    throw new OmpCapabilityValidationError("OMP capability descriptor id must be dotted lowercase text");
  const family = enumValue(record.family, OMP_CAPABILITY_FAMILIES, "OMP capability family");
  const state = enumValue(record.state, OMP_CAPABILITY_STATES, "OMP capability state");
  const scope = enumValue(record.scope, OMP_CAPABILITY_SCOPES, "OMP capability scope");
  const apply = enumValue(record.apply, OMP_CAPABILITY_APPLY, "OMP capability apply policy");
  if (!Array.isArray(record.surfaces)) throw new OmpCapabilityValidationError("OMP capability surfaces must be an array");
  const surfaces = record.surfaces.map((surface, index) => enumValue(surface, OMP_CAPABILITY_SURFACES, `OMP capability surface ${index}`));
  if (new Set(surfaces).size !== surfaces.length) throw new OmpCapabilityValidationError("OMP capability surfaces must not repeat");
  const principal = enumValue(record.principal, OMP_CAPABILITY_PRINCIPALS, "OMP capability principal");
  const bridgeVersion = versionOne(record.bridgeVersion, "OMP capability bridgeVersion");
  const schemaVersion = versionOne(record.schemaVersion, "OMP capability schemaVersion");
  const source = nonEmptyString(record.source, "OMP capability source");
  const ompRevision = nonEmptyString(record.ompRevision, "OMP revision");
  const receipt = record.receipt === undefined ? undefined : nonEmptyString(record.receipt, "OMP capability receipt");
  const reason = record.reason === undefined ? undefined : nonEmptyString(record.reason, "OMP capability reason");
  if (state !== "available" && reason === undefined) throw new OmpCapabilityValidationError("OMP capability reason is required when the state is unavailable");
  return {
    id,
    family,
    state,
    scope,
    apply,
    surfaces,
    principal,
    bridgeVersion,
    schemaVersion,
    source,
    ompRevision,
    ...(receipt === undefined ? {} : { receipt }),
    ...(reason === undefined ? {} : { reason }),
  };
}

/** Parse and validate an untrusted `cedia_get_capabilities` response. */
export function parseOmpCapabilitySnapshot(value: unknown): OmpCapabilitySnapshot {
  const record = ompRecord(value, "OMP capability snapshot");
  exactKeys(record, OMP_SNAPSHOT_KEYS, "OMP capability snapshot");
  const bridgeVersion = versionOne(record.bridgeVersion, "OMP capability bridgeVersion");
  const schemaVersion = versionOne(record.schemaVersion, "OMP capability schemaVersion");
  const capabilityRevision = nonEmptyString(record.capabilityRevision, "OMP capability revision");
  const ompRevision = nonEmptyString(record.ompRevision, "OMP revision");
  if (!Array.isArray(record.capabilities)) throw new OmpCapabilityValidationError("OMP capabilities must be an array");
  const capabilities = record.capabilities.map(parseOmpCapabilityDescriptor);
  const ids = new Set<string>();
  for (const descriptor of capabilities) {
    if (descriptor.ompRevision !== ompRevision) throw new OmpCapabilityValidationError(`OMP capability ${descriptor.id} has a different OMP revision`);
    if (ids.has(descriptor.id)) throw new OmpCapabilityValidationError(`OMP capability id is duplicated: ${descriptor.id}`);
    ids.add(descriptor.id);
  }
  return { bridgeVersion, schemaVersion, capabilityRevision, ompRevision, capabilities };
}

export function isOmpCapabilityDescriptor(value: unknown): value is OmpCapabilityDescriptor {
  try { parseOmpCapabilityDescriptor(value); return true; } catch { return false; }
}

export function isOmpCapabilitySnapshot(value: unknown): value is OmpCapabilitySnapshot {
  try { parseOmpCapabilitySnapshot(value); return true; } catch { return false; }
}

/**
 * OMP settings metadata (plan §8.2 O04, the config half).
 *
 * This is the schema's own inventory: a path, its type, whether the runtime
 * treats it as a credential, whether it has a settings-UI row, and whether it is
 * the one path OMP can write into a project layer. It never carries a value.
 */
export type OmpSettingsScope = "global" | "project" | "session";

export interface OmpSettingsContextGlobal {
  readonly scope: "global";
}
export interface OmpSettingsContextProject {
  readonly scope: "project";
  readonly projectId: string;
}
export interface OmpSettingsContextSession {
  readonly scope: "session";
  readonly sessionId: string;
}
/**
 * Which configuration a settings request resolves in. Global is the shared OMP
 * configuration the terminal also uses. Project is one explicitly selected
 * project the host resolves to a trusted directory. Session is an inspect-only
 * effective view tied to a named existing task.
 */
export type OmpSettingsContext = OmpSettingsContextGlobal | OmpSettingsContextProject | OmpSettingsContextSession;

export type OmpSettingsMutationChange =
  | { readonly path: string; readonly operation: "set"; readonly value: unknown }
  | { readonly path: string; readonly operation: "unset" };

export interface OmpSettingsMutation {
  readonly context: Exclude<OmpSettingsContext, OmpSettingsContextSession>;
  readonly expectedRevision?: string;
  readonly changes: readonly OmpSettingsMutationChange[];
}

export interface OmpSettingsKey {
  readonly path: string;
  readonly type: string;
  readonly credential: boolean;
  readonly ui: boolean;
  readonly tab?: string;
  readonly projectWritable: boolean;
  /** The TUI label, group and help text OMP declares, when it declares them. */
  readonly label?: string;
  readonly description?: string;
  readonly group?: string;
  /** The static schema default, identical for every user; never a configured value. */
  readonly defaultJson?: unknown;
  /** The environment variable that overrides this path, when one exists. */
  readonly envVar?: string;
  /**
   * The values an `enum` path accepts, published by the schema that validates a write.
   * Present only when the runtime declares them, so a control renders the real choices and
   * falls back to asking the runtime when an older runtime publishes none.
   */
  readonly values?: readonly string[];
  /**
   * When a change to this path takes effect, and only when the runtime can prove it.
   *
   * `immediate` is OMP's own declaration that a side effect runs as the value is written.
   * A path without this field is unclassified on purpose: the runtime reads it somewhere, but
   * nothing in its declarations says when, and Cedia says so instead of guessing a timing.
   */
  readonly apply?: OmpSettingsApply;
}

/**
 * When a settings change reaches the running runtime (§6.4, §8.2's descriptor `apply`).
 *
 * Cedia publishes only what the runtime proves. `immediate` comes from OMP's own hook table,
 * which runs at the moment of a write; the remaining three are in the vocabulary because a
 * client has to render them once a classification proves them, not because they are guessed.
 */
export type OmpSettingsApply = "immediate" | "turn_boundary" | "reload" | "new_session";

export interface OmpSettingsKeysSnapshot {
  readonly keys: readonly OmpSettingsKey[];
  /** Identifies the effective settings this inventory was read from; a write may name it. */
  readonly settingsRevision: string;
}

/**
 * One effective settings value.
 *
 * `configured` distinguishes a value some layer set from the schema default. A
 * credential path answers `redacted: true` with no value, and a value too large
 * for a client answers `tooLarge` with its size rather than arriving truncated.
 */
export interface OmpSettingsValue {
  readonly path: string;
  readonly credential: boolean;
  readonly redacted: boolean;
  readonly configured: boolean;
  readonly value?: unknown;
  readonly tooLarge?: true;
  readonly bytes?: number;
  /** Identifies the effective settings this value was read at; a write may name it. */
  readonly settingsRevision: string;
  /**
   * Which configuration this answer was resolved in. Absent on answers from a
   * runtime predating scopes: every legacy read went through a live session
   * runtime, so the parser reports those as session scope.
   */
  readonly scope: OmpSettingsScope;
  /** The layer supplying the effective value, in merge precedence order. */
  readonly provenance?: "env" | "runtime" | "overlay" | "project" | "global" | "default";
  /** The saved global-layer value when one exists, so masking is visible. Absent under redaction rules. */
  readonly storedGlobal?: unknown;
  /** The static schema default, identical for every user. */
  readonly defaultJson?: unknown;
}

/** The host's explicit answer about whether a live runtime answered a settings read. */
export type HostOmpSettingsAnswer<T> =
  | { readonly state: "available"; readonly answer: T }
  | { readonly state: "unavailable"; readonly reason: string };

export class OmpSettingsValidationError extends TypeError {
  readonly code = "omp_settings_invalid" as const;
  constructor(message: string) {
    super(message);
    this.name = "OmpSettingsValidationError";
  }
}

const OMP_SETTINGS_KEY_FIELDS = new Set(["path", "type", "credential", "ui", "tab", "projectWritable", "values", "apply", "label", "description", "group", "defaultJson", "envVar"]);
const OMP_SETTINGS_INVENTORY_FIELDS = new Set(["keys", "settingsRevision"]);
const OMP_SETTINGS_VALUE_FIELDS = new Set(["path", "credential", "redacted", "configured", "value", "tooLarge", "bytes", "settingsRevision", "scope", "provenance", "storedGlobal", "defaultJson"]);

function ompSettingsRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OmpSettingsValidationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function ompSettingsExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new OmpSettingsValidationError(`${label} has an unknown field ${key}`);
}

function ompSettingsText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new OmpSettingsValidationError(`${label} must be a non-empty string`);
  return value;
}

function ompSettingsFlag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new OmpSettingsValidationError(`${label} must be a boolean`);
  return value;
}

/** Parse and validate one untrusted settings key from OMP's inventory. */
export function parseOmpSettingsKey(value: unknown): OmpSettingsKey {
  const record = ompSettingsRecord(value, "OMP settings key");
  ompSettingsExactKeys(record, OMP_SETTINGS_KEY_FIELDS, "OMP settings key");
  const path = ompSettingsText(record.path, "OMP settings path");
  const type = ompSettingsText(record.type, "OMP settings type");
  const credential = ompSettingsFlag(record.credential, "OMP settings credential marker");
  const ui = ompSettingsFlag(record.ui, "OMP settings UI marker");
  const tab = record.tab === undefined ? undefined : ompSettingsText(record.tab, "OMP settings tab");
  const projectWritable = ompSettingsFlag(record.projectWritable, "OMP settings project-writable marker");
  const values = record.values === undefined ? undefined : ompSettingsEnumValues(record.values);
  const apply = record.apply === undefined ? undefined : ompSettingsApply(record.apply);
  const label = record.label === undefined ? undefined : ompSettingsText(record.label, "OMP settings label");
  const description = record.description === undefined ? undefined : ompSettingsText(record.description, "OMP settings description");
  const group = record.group === undefined ? undefined : ompSettingsText(record.group, "OMP settings group");
  const envVar = record.envVar === undefined ? undefined : ompSettingsText(record.envVar, "OMP settings env marker");
  return { path, type, credential, ui, ...(tab === undefined ? {} : { tab }), projectWritable, ...(values === undefined ? {} : { values }), ...(apply === undefined ? {} : { apply }), ...(label === undefined ? {} : { label }), ...(description === undefined ? {} : { description }), ...(group === undefined ? {} : { group }), ...(Object.hasOwn(record, "defaultJson") ? { defaultJson: record.defaultJson } : {}), ...(envVar === undefined ? {} : { envVar }) };
}

/** An unknown timing is refused: a client must not render a timing the runtime never claimed. */
function ompSettingsApply(value: unknown): OmpSettingsApply {
  if (value === "immediate" || value === "turn_boundary" || value === "reload" || value === "new_session") return value;
  throw new OmpSettingsValidationError("OMP settings apply must be a known timing");
}

/**
 * An enum path's published choices.
 *
 * A list that repeats a value or mixes types would make a control offer something the
 * runtime's own validator refuses, so a malformed list is refused instead of trimmed.
 */
function ompSettingsEnumValues(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) throw new OmpSettingsValidationError("OMP settings values must be a non-empty bounded array");
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 512) throw new OmpSettingsValidationError("OMP settings values must be non-empty strings");
    if (seen.has(entry)) throw new OmpSettingsValidationError(`OMP settings value is duplicated: ${entry}`);
    seen.add(entry);
  }
  return [...value];
}

/** Parse and validate the untrusted inventory answer. */
export function parseOmpSettingsKeys(value: unknown): OmpSettingsKeysSnapshot {
  const record = ompSettingsRecord(value, "OMP settings inventory");
  ompSettingsExactKeys(record, OMP_SETTINGS_INVENTORY_FIELDS, "OMP settings inventory");
  if (!Array.isArray(record.keys)) throw new OmpSettingsValidationError("OMP settings inventory keys must be an array");
  const settingsRevision = ompSettingsText(record.settingsRevision, "OMP settings revision");
  const keys = record.keys.map(parseOmpSettingsKey);
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key.path)) throw new OmpSettingsValidationError(`OMP settings path is duplicated: ${key.path}`);
    seen.add(key.path);
  }
  return { keys, settingsRevision };
}

/**
 * Parse and validate one untrusted settings value.
 *
 * The invariant is what keeps a secret from leaking by accident: a redacted or
 * oversized answer must not carry a value, and a value must not claim either.
 */
export function parseOmpSettingsValue(value: unknown): OmpSettingsValue {
  const record = ompSettingsRecord(value, "OMP settings value");
  ompSettingsExactKeys(record, OMP_SETTINGS_VALUE_FIELDS, "OMP settings value");
  const path = ompSettingsText(record.path, "OMP settings path");
  const credential = ompSettingsFlag(record.credential, "OMP settings credential marker");
  const redacted = ompSettingsFlag(record.redacted, "OMP settings redaction marker");
  const configured = ompSettingsFlag(record.configured, "OMP settings configured marker");
  const settingsRevision = ompSettingsText(record.settingsRevision, "OMP settings revision");
  const tooLarge = record.tooLarge === undefined ? undefined : ompSettingsFlag(record.tooLarge, "OMP settings size marker");
  const bytes = record.bytes === undefined ? undefined : record.bytes;
  if (bytes !== undefined && (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0))
    throw new OmpSettingsValidationError("OMP settings byte count must be a non-negative integer");
  const carriesValue = Object.hasOwn(record, "value");
  if (redacted && carriesValue) throw new OmpSettingsValidationError("a redacted settings answer must not carry a value");
  if (tooLarge === true && carriesValue) throw new OmpSettingsValidationError("an oversized settings answer must not carry a value");
  if (!redacted && tooLarge !== true && !carriesValue) throw new OmpSettingsValidationError("a settings answer must carry a value unless it is redacted or oversized");
  if (tooLarge === true && bytes === undefined) throw new OmpSettingsValidationError("an oversized settings answer must report its size");
  if (credential && !redacted) throw new OmpSettingsValidationError("a credential path must be answered redacted");
  // Answers from a runtime predating scopes were all read through a live session
  // runtime, so the parser reports those as session scope instead of guessing global.
  const scope = record.scope === undefined ? "session" : ompSettingsScope(record.scope);
  const provenance = record.provenance === undefined ? undefined : ompSettingsProvenance(record.provenance);
  const carriesStored = Object.hasOwn(record, "storedGlobal");
  if (redacted && carriesStored) throw new OmpSettingsValidationError("a redacted settings answer must not carry a stored layer");
  if (tooLarge === true && carriesStored) throw new OmpSettingsValidationError("an oversized settings answer must not carry a stored layer");
  return {
    path,
    credential,
    redacted,
    configured,
    settingsRevision,
    scope,
    ...(carriesValue ? { value: record.value } : {}),
    ...(tooLarge === true ? { tooLarge: true as const } : {}),
    ...(bytes === undefined ? {} : { bytes: bytes as number }),
    ...(provenance === undefined ? {} : { provenance }),
    ...(carriesStored ? { storedGlobal: record.storedGlobal } : {}),
    ...(Object.hasOwn(record, "defaultJson") ? { defaultJson: record.defaultJson } : {}),
  };
}

function ompSettingsScope(value: unknown): OmpSettingsScope {
  if (value === "global" || value === "project" || value === "session") return value;
  throw new OmpSettingsValidationError("OMP settings scope must be global, project or session");
}

function ompSettingsProvenance(value: unknown): NonNullable<OmpSettingsValue["provenance"]> {
  if (value === "env" || value === "runtime" || value === "overlay" || value === "project" || value === "global" || value === "default") return value;
  throw new OmpSettingsValidationError("OMP settings provenance must be a layer the runtime reads");
}

/**
 * Parse an untrusted settings context from a client. Session scope names its
 * task; project scope names a project id the host resolves to a trusted
 * directory. Clients never pass filesystem paths.
 */
export function parseOmpSettingsContext(value: unknown): OmpSettingsContext {
  const record = ompSettingsRecord(value, "OMP settings context");
  if (record.scope === "global") {
    ompSettingsExactKeys(record, new Set(["scope"]), "OMP settings context");
    return { scope: "global" };
  }
  if (record.scope === "project") {
    ompSettingsExactKeys(record, new Set(["scope", "projectId"]), "OMP settings context");
    return { scope: "project", projectId: ompSettingsText(record.projectId, "OMP project id") };
  }
  if (record.scope === "session") {
    ompSettingsExactKeys(record, new Set(["scope", "sessionId"]), "OMP settings context");
    return { scope: "session", sessionId: ompSettingsText(record.sessionId, "OMP session id") };
  }
  throw new OmpSettingsValidationError("OMP settings scope must be global, project or session");
}

/**
 * Parse an untrusted scoped mutation from the owner. Shape only: the runtime
 * validates paths, values and the revision before anything is written, and a
 * session context is refused here because task controls are not preferences.
 */
export function parseOmpSettingsMutation(value: unknown): OmpSettingsMutation {
  const record = ompSettingsRecord(value, "OMP settings mutation");
  ompSettingsExactKeys(record, new Set(["context", "expectedRevision", "changes"]), "OMP settings mutation");
  const context = parseOmpSettingsContext(record.context);
  if (context.scope === "session") throw new OmpSettingsValidationError("a settings mutation never targets a session");
  const expectedRevision = record.expectedRevision === undefined ? undefined : ompSettingsText(record.expectedRevision, "OMP settings revision");
  if (!Array.isArray(record.changes) || record.changes.length === 0 || record.changes.length > 256)
    throw new OmpSettingsValidationError("OMP settings changes must be a non-empty bounded array");
  const changes = record.changes.map(entry => {
    const change = ompSettingsRecord(entry, "OMP settings change");
    const path = ompSettingsText(change.path, "OMP settings path");
    if (change.operation === "unset") {
      ompSettingsExactKeys(change, new Set(["path", "operation"]), "OMP settings change");
      return { path, operation: "unset" as const };
    }
    if (change.operation === "set") {
      ompSettingsExactKeys(change, new Set(["path", "operation", "value"]), "OMP settings change");
      if (!Object.hasOwn(change, "value")) throw new OmpSettingsValidationError("OMP settings set needs a value");
      return { path, operation: "set" as const, value: change.value };
    }
    throw new OmpSettingsValidationError("OMP settings changes are set with a value, or unset");
  });
  return { context, ...(expectedRevision === undefined ? {} : { expectedRevision }), changes };
}

/** Explicit validation aliases for callers that prefer an assert-like name. */
export const validateOmpCapabilityDescriptor = parseOmpCapabilityDescriptor;
export const validateOmpCapabilitySnapshot = parseOmpCapabilitySnapshot;

export type CapabilityAvailability = "available" | "dependency_unavailable" | "integration_missing";
export interface CapabilityDescriptor {
  readonly id: string;
  readonly availability: CapabilityAvailability;
  readonly scope: "app" | "session" | "project" | "global" | "device";
  readonly reason?: string;
  readonly operations: readonly string[];
}
export interface CapabilitySnapshot {
  readonly protocolVersion: typeof CEDIA_PROTOCOL_VERSION;
  readonly revision: string;
  readonly capabilities: readonly CapabilityDescriptor[];
  readonly omp?: OmpCapabilityHostAnswer;
  readonly ompCapabilityRevision?: string;
  readonly ompRevision?: string;
}
export type HostLifecyclePhase = "ready" | "quitting" | "stopped";
export interface HostLifecycleSnapshot {
  readonly phase: HostLifecyclePhase;
  readonly generation: string;
  readonly processStartedAt: string;
}
/** What an authenticated client may read about the host's lifetime state. */
export interface HostLifecycleStatus extends HostLifecycleSnapshot {
  readonly accepting: boolean;
  readonly runningSessions: number;
  readonly remotePaired: boolean;
}
export interface HostQuitReceipt {
  readonly accepted: true;
  readonly alreadyRequested: boolean;
  readonly phase: HostLifecyclePhase;
  readonly generation: string;
  readonly runningSessions: number;
}

/**
 * The owner-only answer to `POST /v1/lifecycle/fence` and `POST /v1/lifecycle/resume`.
 *
 * The deliberate quit asks the owner before stopping anything (plan §2.7), so the host
 * fences admission first and reopens it when the owner cancels. `changed` says whether
 * this request moved the phase, which keeps a repeated fence or an unnecessary reopen
 * from reading as if it had done something.
 */
export interface HostLifecycleAdmissionReceipt {
  readonly accepted: true;
  readonly changed: boolean;
  readonly phase: HostLifecyclePhase;
  readonly generation: string;
  readonly runningSessions: number;
}

export interface ApiError {
  error: { code: string; message: string };
}
