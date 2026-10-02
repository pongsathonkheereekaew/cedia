import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OmpRpcClient, OmpCommandError, OmpRequestTimeoutError } from "../../../packages/omp-adapter/src/client.ts";
import { OmpOwnerControlClient } from "../../../packages/omp-adapter/src/owner-control-client.ts";
import { ExtensionUiBroker } from "../../../packages/omp-adapter/src/ui.ts";
import { RPC_COMMAND_TYPES, CEDIA_UI_COMMAND_TYPES, isSupportedOmpVersion, OMP_BASELINE_VERSION, type CediaUiCommandType, type RpcCommandType, type RpcCommandPayload, type OmpFrame } from "../../../packages/omp-adapter/src/types.ts";
import type { Command, CommandRequest, HostOmpCapabilitySnapshot, HostOmpSettingsAnswer, Json, OmpGoalCommandRequest, OmpSettingsContext, OmpSettingsKeysSnapshot, OmpSettingsValue, Session, SessionDirtyCopy, SessionDirtyCopyEntry, SessionArchiveReceipt, SessionCleanupCapability, SessionCleanupGate, SessionCleanupGateState, SessionCleanupResult, SessionCleanupState, SessionEvent, SessionPendingModel, SessionRestoration, SessionWorkspace, SessionWorkspaceMetadata, TerminalCheckpoint, TurnIntent, TurnState, UiResponseRequest } from "../../../packages/protocol/src/index.ts";
import { TerminalStateRegistry } from "./terminal-state.ts";
import { DurableStore, DurableStoreCommandConflictError } from "./store.ts";
import { ProviderAuthManager } from "./provider-auth.ts";
import { admitNewTaskWorkspace, collectUsedWorkspacePorts, createWorktree, loadWorkspaceBootstrap, planRestoration, restoreWorktree, saveSnapshotManifest, workspaceIdentity, workspacePath } from "./workspaces.ts";
import { gitAncestry, gitWorkingTreeFacts, probeGit, runGitSync } from "./git.ts";
import { EditorConnections } from "./editors.ts";
import { NativeEditorBridge } from "./native-editor.ts";
import { OmpHostDispatcher } from "../../../packages/omp-adapter/src/host.ts";
import { ArtifactStore } from "./artifacts.ts";
import { CEDIA_HOST_URI_SCHEME, readCediaArtifactUri } from "./host-uri.ts";
import { suggestWorkspaceMode, type WorkspaceJudge, type WorkspaceSuggestion } from "./workspace-mode.ts";
import { createOmpModelCatalog, normalizeOmpModelCatalog, type OmpModelCatalog } from "./model-catalog.ts";
import type { ModelCatalogResult } from "../../../packages/protocol/src/models.ts";
import { readOmpCapabilities } from "./omp-capabilities.ts";
import { attachCediaOwnerControlClient, probeCediaOwner, readCediaOwnerSummary, recoverStaleCediaOwnerEndpoint, type CediaOwnerAttachment } from "./owner-endpoint.ts";
import { writeOwnerLaunchContext as persistOwnerLaunchContext } from "./owner-launch-context.ts";
import { OmpSettingsNotEditableError, OmpSettingsPathError, ompSettingDisposition, mutateOmpSettings, previewOmpSettingsReset, readOmpSettingsDescribe, readOmpSettingsKeys, readOmpSettingsValue, readOmpSettingsValueIn, writeOmpSettingsValue } from "./omp-settings.ts";
import { readOmpCreditPolicy, type OmpCreditPolicy } from "./omp-policy.ts";
import { NO_OMP_GOAL_BRIDGE_REASON, NO_OMP_GOAL_RUNTIME_REASON, NO_OMP_SUBAGENTS_RUNTIME_REASON, OmpProgress, type OmpProgressSnapshot, type OmpSubagentsSnapshot } from "./omp-progress.ts";
import { NO_OMP_PLAN_BRIDGE_REASON, NO_OMP_PLAN_RUNTIME_REASON, OmpPlan, parseOmpPlanCommandResult, type CediaPlanCommand, type OmpPlanCommandRequest, type OmpPlanCommandResult, type OmpPlanSnapshot } from "./omp-plan.ts";
import { NO_OMP_TODOS_RUNTIME_REASON, OmpTodos, type OmpTodoSnapshot } from "./omp-todos.ts";
import { NO_OMP_ADVISOR_BRIDGE_REASON, NO_OMP_ADVISOR_RUNTIME_REASON, OmpAdvisor, parseOmpAdvisorCommandResult, type OmpAdvisorCommandRequest, type OmpAdvisorCommandResult, type OmpAdvisorSnapshot } from "./omp-advisor.ts";
import { NO_OMP_ADVISOR_CONFIG_BRIDGE_REASON, NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON, OmpAdvisorConfig, parseOmpAdvisorConfigCommandResult, type OmpAdvisorConfigWriteRequest, type OmpAdvisorConfigSnapshot, type OmpAdvisorConfigScope } from "./omp-advisor-config.ts";
import { NO_OMP_AGENTS_BRIDGE_REASON, NO_OMP_AGENTS_RUNTIME_REASON, OmpAgents, OmpAgentsValidationError, listOmpAgentConfigs, parseOmpAgentConfigResult, parseOmpAgentKillResult, parseOmpAgentReviveResult, type OmpAgentConfigData, type OmpAgentConfigList, type OmpAgentConfigRequest, type OmpAgentConfigResult, type OmpAgentKillData, type OmpAgentKillRequest, type OmpAgentKillResult, type OmpAgentReviveData, type OmpAgentReviveRequest, type OmpAgentReviveResult, type OmpAgentTranscriptSnapshot, type OmpAgentsSnapshot } from "./omp-agents.ts";
import { NO_OMP_QUEUE_BRIDGE_REASON, NO_OMP_QUEUE_RUNTIME_REASON, OmpQueue, parseOmpQueueCommandResult, type OmpQueueDropRequest, type OmpQueueSnapshot } from "./omp-queue.ts";
import { NO_OMP_PAUSE_BRIDGE_REASON, NO_OMP_PAUSE_RUNTIME_REASON, OmpPause, parseOmpPauseCommandResult, type OmpPauseCommandRequest, type OmpPauseSnapshot } from "./omp-pause.ts";
import { MAX_BASH_COMMAND_CHARS, NO_OMP_BASH_RUNTIME_REASON, abortOmpBash, execOmpBash, parseOmpBashAbortCommandResult, parseOmpBashCommandResult, type OmpBashAbortRequest, type OmpBashAbortSnapshot, type OmpBashExecRequest, type OmpBashSnapshot } from "./omp-bash.ts";
import { MAX_PYTHON_CODE_CHARS, NO_OMP_PYTHON_BRIDGE_REASON, NO_OMP_PYTHON_RUNTIME_REASON, OmpPython, parseOmpPythonAbortCommandResult, parseOmpPythonCommandResult, type OmpPythonAbortRequest, type OmpPythonAbortSnapshot, type OmpPythonExecRequest, type OmpPythonSnapshot } from "./omp-python.ts";
import { NO_OMP_CONTEXT_BRIDGE_REASON, NO_OMP_CONTEXT_RUNTIME_REASON, OmpContext, parseOmpContextCommandResult, parseOmpContextShakeCommandResult, type OmpContextCommandRequest, type OmpContextShakeRequest, type OmpContextShakeSnapshot, type OmpContextSnapshot } from "./omp-context.ts";
import { NO_OMP_MEMORY_BRIDGE_REASON, NO_OMP_MEMORY_RUNTIME_REASON, OmpMemory, parseOmpMemoryCommandResult, type OmpMemoryCommandRequest, type OmpMemorySnapshot } from "./omp-memory.ts";
import { NO_OMP_USAGE_RUNTIME_REASON, OmpUsage, type OmpUsageSnapshot } from "./omp-usage.ts";
import { NO_OMP_CREDITS_BRIDGE_REASON, NO_OMP_CREDITS_RUNTIME_REASON, OmpCredits, parseOmpCreditsRedeemCommandResult, type OmpCreditsCommandRequest, type OmpCreditsRedeemSnapshot, type OmpCreditsSnapshot } from "./omp-credits.ts";
import { NO_OMP_HISTORY_BRIDGE_REASON, NO_OMP_HISTORY_RUNTIME_REASON, OmpHistory, parseOmpHistoryFreshResult, parseOmpHistoryResetResult, type OmpHistoryCommandRequest, type OmpHistoryFreshResult, type OmpHistoryResetResult, type OmpHistorySnapshot } from "./omp-history.ts";
import { NO_OMP_TREE_BRIDGE_REASON, NO_OMP_TREE_RUNTIME_REASON, OmpTree, OmpTreeValidationError, parseOmpTreeNavigateSnapshot, type OmpTreeData, type OmpTreeNavigateRequest, type OmpTreeNavigateSnapshot } from "./omp-tree.ts";
import { NO_OMP_PREWALK_BRIDGE_REASON, NO_OMP_PREWALK_RUNTIME_REASON, OmpPrewalk, OmpPrewalkValidationError, type OmpPrewalkData } from "./omp-prewalk.ts";
import { NO_OMP_LOOP_BRIDGE_REASON, NO_OMP_LOOP_RUNTIME_REASON, OmpLoop, OmpLoopValidationError, parseOmpLoopCommandResult, type OmpLoopCommandRequest, type OmpLoopData, type OmpLoopSnapshot } from "./omp-loop.ts";
import { NO_OMP_BTW_BRIDGE_REASON, NO_OMP_BTW_RUNTIME_REASON, OmpBtw, OmpBtwValidationError, parseOmpBtwBranchCommandResult, parseOmpBtwCommandResult, type OmpBtwAskCommandRequest, type OmpBtwBranchCommandRequest, type OmpBtwBranchData, type OmpBtwSnapshot } from "./omp-btw.ts";
import { NO_OMP_CLEANSE_BRIDGE_REASON, NO_OMP_CLEANSE_RUNTIME_REASON, OmpCleanse, OmpCleanseValidationError, parseOmpCleanseCommandResult, type OmpCleanseAbortCommandRequest, type OmpCleanseData, type OmpCleanseRunCommandRequest, type OmpCleanseSnapshot } from "./omp-cleanse.ts";
import { NO_OMP_OMFG_BRIDGE_REASON, NO_OMP_OMFG_RUNTIME_REASON, OmpOmfg, OmpOmfgValidationError, parseOmpOmfgCommandResult, parseOmpOmfgSaveCommandResult, type OmpOmfgAbortCommandRequest, type OmpOmfgData, type OmpOmfgDraftCommandRequest, type OmpOmfgSaveCommandRequest, type OmpOmfgSaveData, type OmpOmfgSnapshot } from "./omp-omfg.ts";
import { NO_OMP_TOOL_CATALOG_BRIDGE_REASON, NO_OMP_CODE_MODE_RUNTIME_REASON, NO_OMP_EXTENSIONS_BRIDGE_REASON, NO_OMP_EXTENSIONS_RUNTIME_REASON, NO_OMP_TOOL_CATALOG_RUNTIME_REASON, OmpCodeMode, OmpExtensions, OmpToolCatalog, OmpToolCatalogValidationError, OmpExtensionsValidationError, parseOmpExtensionsData, parseOmpExtensionSetResult, parseOmpToolActiveSetSnapshot, type OmpExtensionSetRequest, type OmpToolActiveSetRequest, type OmpToolActiveSetSnapshot, type OmpCodeModeData, type OmpExtensionsData, type OmpToolCatalogData, type OmpToolRefreshRequest } from "./omp-management.ts";
import { asAvailableAnswer, NO_OMP_ACCOUNTS_BRIDGE_REASON, NO_OMP_ACCOUNTS_RUNTIME_REASON, NO_OMP_MODEL_STATE_BRIDGE_REASON, NO_OMP_MODEL_STATE_RUNTIME_REASON, OmpModelState, parseOmpAccountPinCommandResult, parseOmpModelRoles, parseOmpRoleApplyCommandResult, parseOmpServiceTierCommandResult, type OmpAccountPinCommandRequest, type OmpAccountPinResult, type OmpAccounts, type OmpAvailable, type OmpModelRolesData, type OmpModelStateData, type OmpRoleApplyCommandRequest, type OmpRoleApplyData, type OmpRoleSetCommandRequest, type OmpServiceTierCommandRequest, type OmpServiceTierResult } from "./omp-model-state.ts";

const DIRTY_COPY_STATES: readonly SessionDirtyCopyEntry["state"][] = ["applied", "copied", "unchanged", "conflict"];

/**
 * Read the recorded copy outcome of a task's worktree (§3.C).
 *
 * A record Cedia cannot read is dropped rather than invented, and dropping it never discards
 * the rest of the workspace identity: the task still names the revision it started from.
 */
function readDirtyCopy(value: unknown): SessionDirtyCopy | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.mode !== "all" && record.mode !== "none" && record.mode !== "selected") return undefined;
  if (!Array.isArray(record.entries) || record.entries.length > 10_000) return undefined;
  const entries: SessionDirtyCopyEntry[] = [];
  for (const entry of record.entries) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const item = entry as Record<string, unknown>;
    if (typeof item.path !== "string" || item.path.length === 0) return undefined;
    if (!DIRTY_COPY_STATES.includes(item.state as SessionDirtyCopyEntry["state"])) return undefined;
    if (item.reason !== undefined && typeof item.reason !== "string") return undefined;
    entries.push({ path: item.path, state: item.state as SessionDirtyCopyEntry["state"], ...(typeof item.reason === "string" ? { reason: item.reason } : {}) });
  }
  return { mode: record.mode, entries };
}

export class HostError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
export interface HostOptions {
  onDiagnostic?: (message: string) => void;
  store: DurableStore;
  stateDir: string;
  ompExecutable?: string;
  ompEnv?: NodeJS.ProcessEnv;
  ompArgs?: string[];
  /** Bound a deliberately held fixture ACK without changing the 30s default. */
  ompRequestTimeoutMs?: number;
  lockExtension?: string;
  /**
   * Operator-only extra `--trusted-extension` paths, appended before the lock
   * extension (O06 packaged-reload path). Set at host startup from
   * `CEDIA_EXTRA_TRUSTED_EXTENSIONS`; never settable by clients — HostOptions
   * originate at server startup, not from session frames. Each entry must be
   * an absolute path to an existing file and is realpath'd like the lock.
   */
  extraTrustedExtensions?: string[];
  onEvent?: (event: SessionEvent) => void;
  onFatal?: (error: Error) => void;
  editors?: EditorConnections;
  virtualUi?: boolean;
  nativeBridge?: boolean;
  editorBridge?: boolean;
  /**
   * Whether the runtime publishes its local owner endpoint (§8.2 O08).
   *
   * Defaults to the same switch as the virtual UI: both are Cedia's own runtime extensions, and an
   * install that turns one off is an install that does not want the other's machinery either.
   */
  ownerBridge?: boolean;
  /** Opt-in judge for `suggestWorkspaceMode`. Absent means the host has no opinion. */
  workspaceJudge?: WorkspaceJudge;
  /** Cleanup remains disabled by default; an explicit test/owner operation may opt into the protocol. */
  cleanupEnabled?: boolean;
  /** Evidence providers for resources this host cannot inspect from the OMP runtime alone. */
  cleanupGuards?: CleanupGuards;
  /** Narrow failure seams used by recovery tests; production leaves every operation on Git/fs/store. */
  cleanupOperations?: CleanupOperations;
}

export type CleanupGuardResult =
  | { readonly state: "clear" }
  | { readonly state: "blocked" | "unavailable" | "uncertain"; readonly reason: string };

export interface CleanupGuards {
  /** Whether an owner terminal is still attached to this task's cwd. */
  readonly userTerminals?: (session: Session, metadata: SessionWorkspaceMetadata) => CleanupGuardResult;
  /** Whether the IDE can prove there are no open or unsaved documents. */
  readonly ide?: (session: Session, metadata: SessionWorkspaceMetadata) => CleanupGuardResult;
}

export interface CleanupOperations {
  readonly createArchiveRef?: (repositoryRoot: string, ref: string, commit: string) => void;
  readonly persistReceipt?: (directory: string, receipt: SessionArchiveReceipt) => void;
  readonly removeWorktree?: (repositoryRoot: string, worktree: string) => void;
  readonly persistCompletion?: () => void;
}
interface Runtime {
  session: Session;
  /** Whether this host spawned OMP or holds a controller lease on an existing owner. */
  ownership: "spawned" | "attached";
  client?: OmpRpcClient | OmpOwnerControlClient;
  goal: OmpProgress;
  plan: OmpPlan;
  todos: OmpTodos;
  advisor: OmpAdvisor;
	advisorConfig: OmpAdvisorConfig;
  agents: OmpAgents;
	queue: OmpQueue;
	pause: OmpPause;
	python: OmpPython;
	context: OmpContext;
	memory: OmpMemory;
	usage: OmpUsage;
	credits: OmpCredits;
	modelState: OmpModelState;
	history: OmpHistory;
	tree: OmpTree;
	prewalk: OmpPrewalk;
	loop: OmpLoop;
	btw: OmpBtw;
	cleanse: OmpCleanse;
	omfg: OmpOmfg;
	toolCatalog: OmpToolCatalog;
	slashCommands: Set<string>;
	extensions: OmpExtensions;
	codeMode: OmpCodeMode;
  todoRefreshPending?: boolean;
  todoRefreshBoundary?: string;
  todoRefreshUnnamedBoundary?: boolean;
  /** Set when OMP refused set_host_uri_schemes behind its startup gate; a later command retries. */
  uriSchemesPending?: boolean;
  /** Set once a non-gate scheme-retry failure has been reported on diagnostics. */
  uriSchemesRetryNotified?: boolean;
  ui: ExtensionUiBroker;
  permissions: ExtensionUiBroker;
  permissionResolvers: Map<string, (allowed: boolean) => void>;
  nativePermissionResolvers: Map<string, (frame: OmpFrame) => void>;
  dispatcher?: OmpHostDispatcher;
  pendingHostFrames: OmpFrame[];
  wireCommands: Map<string, string>;
  activeCommand?: string;
  /** Set when adoption finds an already-running turn whose start/completion frames were missed. */
  adoptedActiveTurn?: boolean;
  closing: boolean;
  faulted: boolean;
  timer?: ReturnType<typeof setInterval>;
  /**
   * Headless screen per virtual terminal, when the virtual UI is on. OMP owns the PTY;
   * this keeps the state a reattaching client would otherwise have to replay
   * (docs/maintenance/evidence/terminal-vt-spike-2026-09-16/).
   */
  terminals?: TerminalStateRegistry;
}
interface SidechatMetadata {
  version: 1;
  sourceThreadId: string;
  sourceSessionFile: string;
  createdAt: string;
}
export type SessionView = Session & { sidechatSourceThreadId: string | null };
/**
 * Absence reasons. Each one names the surface it is about: "no live runtime" and "no bridge on
 * the runtime that is live" are different facts, and a caller acting on the answer needs to know
 * which one it got without reading the code that produced it.
 */
const NO_LIVE_OMP_RUNTIME_REASON = "No OMP runtime is running; Cedia reads the capability table from a live session runtime.";
const NO_LIVE_OMP_SETTINGS_REASON = "No OMP runtime is running; Cedia reads OMP settings from a live session runtime.";
const NO_CAPABILITY_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge.";
const NO_SESSION_OMP_MODEL_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's live model catalog.";

export type SessionModelCatalogResult = ModelCatalogResult | {
  readonly state: "unavailable";
  readonly reason: string;
};

const terminal = new Set(["completed", "failed", "outcome_unknown", "not_dispatched"]);
const turnCommands = new Set(["prompt", "abort_and_prompt"]);
/**
 * Commands that submit a turn of their own (§2.4). `steer` is deliberately absent: it is input
 * to the turn already running, not a second queued turn, so it never claims an identity.
 */
const turnIntents = new Set(["prompt", "abort_and_prompt", "follow_up"]);
/** How many recent turn intents a session row carries; the store keeps the full history. */
const TURN_PROJECTION_LIMIT = 20;
/**
 * How far a turn has come. The projection only ever moves forward: `prepared` is Cedia's
 * acceptance, `queued` the transport acknowledgement, `running` OMP's own start, and a finished
 * state is final. The two honest unknowns sit beside `queued`, because either may still be
 * resolved by evidence or by an explicit Continue.
 */
const TURN_STATE_ORDER: Record<TurnState, number> = {
  prepared: 0,
  queued: 1,
  needs_continue: 1,
  outcome_unknown: 1,
  running: 2,
  completed: 3,
  failed: 3,
  cancelled: 3,
};
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isOwnerLockContention = (error: unknown): boolean => /Cedia session is still owned by another OMP process/.test(errorText(error));

/** A stored restoration record, or `undefined` when it cannot be trusted as one. */
function readRestoration(value: unknown): SessionRestoration | undefined {
  if (!object(value)) return undefined;
  if (typeof value.at !== "string" || typeof value.worktree !== "string" || typeof value.branch !== "string") return undefined;
  if (typeof value.reattached !== "boolean" || typeof value.reason !== "string") return undefined;
  return { at: value.at, worktree: value.worktree, branch: value.branch, reattached: value.reattached, reason: value.reason };
}

/** One application host, multiple independently owned OMP sessions. */
export class CediaHost {
  readonly store: DurableStore;
  readonly #options: HostOptions;
  readonly #modelCatalog: OmpModelCatalog;
  readonly #providerAuth: ProviderAuthManager;
  readonly #extraTrustedExtensions: string[];
  readonly #runtimes = new Map<string, Runtime>();
  #configSettingsClient?: OmpRpcClient;
  #configSettingsStarting?: Promise<OmpRpcClient>;
  readonly #starting = new Map<string, Promise<Session>>();
  readonly #forking = new Map<string, Promise<SessionView>>();
  readonly #stopping = new Map<string, Promise<Session>>();
  readonly #inflight = new Map<string, Promise<Command>>();
  #closing = false;
  #closePromise?: Promise<void>;

  /** Read-only live slash-command projection for deterministic owner-boundary tests and diagnostics. */
  slashCommands(sessionId: string): readonly string[] {
    return [...(this.#runtimes.get(sessionId)?.slashCommands ?? [])];
  }

  constructor(options: HostOptions) {
    this.#options = options;
    this.#extraTrustedExtensions = (options.extraTrustedExtensions ?? []).map(candidate => {
      if (typeof candidate !== "string" || candidate.length === 0 || !isAbsolute(candidate)) {
        throw new HostError("invalid_option", `extraTrustedExtensions needs absolute file paths, got ${JSON.stringify(candidate)}`, 400);
      }
      let resolved: string;
      try {
        resolved = realpathSync(candidate);
      } catch {
        throw new HostError("invalid_option", `extraTrustedExtensions path does not exist: ${candidate}`, 400);
      }
      if (!statSync(resolved).isFile()) {
        throw new HostError("invalid_option", `extraTrustedExtensions path is not a file: ${candidate}`, 400);
      }
      return resolved;
    });
    this.store = options.store;
    this.#modelCatalog = createOmpModelCatalog({
      ompExecutable: options.ompExecutable,
      ompEnv: options.ompEnv,
      ompArgs: options.ompArgs,
    });
    // Short-lived OMP metadata workers, the same shape the catalogue uses: no
    // session, transcript, or credential is owned here.
    this.#providerAuth = new ProviderAuthManager({
      ompExecutable: options.ompExecutable,
      ompEnv: options.ompEnv,
      ompArgs: options.ompArgs,
      onChanged: () => this.#modelCatalog.invalidate(),
    });
  }

	createSession(projectId: string, title = "New task", workspaceMode: "local" | "worktree" = "local", id?: string, baseRef?: string, dirtyFiles?: readonly string[]): Session {
		return this.#createSession(projectId, title, workspaceMode, id, true, baseRef, dirtyFiles);
	}

	/**
	 * Create a task row plus its workspace record.
	 *
	 * `admit` is false only for a sidechat fork: a sidechat is a branch of the task it came
	 * from (it continues that conversation in the same folder), not a second task competing
	 * for the folder, so the one-task-per-folder admission of §3.C does not apply to it.
	 */
	#createSession(projectId: string, title: string, workspaceMode: "local" | "worktree", id: string | undefined, admit: boolean, baseRef?: string, dirtyFiles?: readonly string[]): Session {
		this.#assertOpen();
		const project = this.store.getProject(projectId);
		if (!project) throw new HostError("not_found", "Project not found", 404);
		// Cedia §3.C: identify the folder before creating anything, so a refusal leaves no
		// half-made task behind.
		const identity = workspaceIdentity(project.path);
		// A named base revision is resolved to a commit before anything is created: a branch
		// label is not proof that the revision was used, and only a worktree can be created
		// from another revision in the first place.
		let base: string | undefined;
		// A selection only means something for a task that gets its own worktree: a local task
		// works in the project folder itself, so there is nothing to carry into it.
		if (dirtyFiles !== undefined && workspaceMode !== "worktree") {
			throw new HostError("worktree_required", "Copied files need their own worktree; a task in the project folder already works on them.", 409);
		}
		if (dirtyFiles !== undefined && !identity.isGit) {
			throw new HostError("worktree_required", "This folder is not a Git repository, so Cedia cannot give the task its own worktree.", 409);
		}
		if (baseRef !== undefined) {
			if (!identity.isGit) throw new HostError("unknown_base_ref", "This folder is not a Git repository, so there is no revision to start from.", 409);
			if (workspaceMode !== "worktree") throw new HostError("worktree_required", "A starting revision needs its own worktree; Cedia cannot check one out inside the project folder.", 409);
			base = probeGit(identity.root, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
			if (base === undefined) throw new HostError("unknown_base_ref", `Git does not know the revision ${baseRef} in this repository.`, 409);
		}
		let mode = workspaceMode;
		if (admit) {
			const activeTasksInFolder = this.store.listSessions(projectId, { includeArchived: true })
				.filter(session => !session.archived && session.status !== "stopped").length;
			const admission = admitNewTaskWorkspace({ identity, activeTasksInFolder, requestedMode: workspaceMode });
			if (!admission.ok) throw new HostError(admission.code, admission.reason, 409);
			mode = admission.mode;
		}
		const session = this.store.createSession({ ...(id === undefined ? {} : { id }), projectId, title, cwd: project.path });
		const directory = join(this.#options.stateDir, "sessions", session.id);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		// The qualified launcher reads this record before it starts OMP. Write it as soon as the
		// durable task directory exists, then refresh it below after worktree/session-file setup.
		this.#writeOwnerLaunchContext(session);
		// Record the starting commit and branch for every mode, not only for a worktree: a
		// task restored or reviewed later has to name the revision it actually began from.
		this.#writeWorkspaceIdentity(directory, {
			mode,
			isGit: identity.isGit,
			cwd: project.path,
			root: identity.root,
			...(identity.branch === undefined ? {} : { branch: identity.branch }),
			// A task that named a base revision started from that commit, not from whatever
			// the folder's HEAD happened to be.
			...(base !== undefined ? { sourceCommit: base } : identity.sourceCommit === undefined ? {} : { sourceCommit: identity.sourceCommit }),
			...(baseRef === undefined ? {} : { baseRef }),
		});
		const integrationTargetRef = identity.branch === undefined ? undefined : `refs/heads/${identity.branch}`;
		const repositoryId = identity.isGit ? this.#repositoryIdentity(identity.root) : undefined;
		this.store.updateSessionWorkspaceMetadata(session.id, {
			taskId: session.id,
			projectId: project.id,
			...(repositoryId === undefined ? {} : { repositoryId }),
			actualCwd: project.path,
			...(identity.sourceCommit === undefined ? {} : { sourceCommit: identity.sourceCommit }),
			...(identity.branch === undefined ? {} : { taskBranch: identity.branch }),
			...(integrationTargetRef === undefined ? {} : { integrationTargetRef }),
			...(identity.sourceCommit === undefined ? {} : { integrationTargetCommit: identity.sourceCommit, integrationObservedCommit: identity.sourceCommit }),
		});
		if (mode === "worktree") {
			try {
        const bootstrap = loadWorkspaceBootstrap(project.path);
        const snapshot = createWorktree(project.path, join(this.#options.stateDir, "worktrees", session.id), session.id, {
          allowlist: bootstrap.ignoreAllowlist,
          setupScript: bootstrap.setupScript,
          runScript: bootstrap.runScript,
          portStart: bootstrap.portStart,
          usedPorts: collectUsedWorkspacePorts(this.#options.stateDir),
          ...(base === undefined ? {} : { baseRef: base }),
          ...(dirtyFiles === undefined ? {} : { dirtyFiles }),
        });
	        saveSnapshotManifest(join(directory, "workspace.json"), snapshot);
	        // What the task carried belongs to the workspace record: a later reader has to see
	        // the same per-path outcome the creation reported, conflicts included (§3.C).
	        const recordedIdentity = this.#readWorkspaceIdentity(session.id);
	        if (recordedIdentity && snapshot.dirtyCopy) this.#writeWorkspaceIdentity(directory, { ...recordedIdentity, dirtyCopy: snapshot.dirtyCopy });
		        const worktreeSession = this.store.updateSession(session.id, { cwd: snapshot.cwd });
		        this.#writeOwnerLaunchContext(worktreeSession);
	        this.store.updateSessionWorkspaceMetadata(session.id, {
	          actualCwd: snapshot.cwd,
	          worktreeRoot: snapshot.root,
	          sourceCommit: snapshot.baseCommit,
	          taskBranch: snapshot.branch,
	        });
      } catch (error) {
        this.store.updateSession(session.id, { status: "stopped", archived: true });
        throw error;
      }
    }
		const created = this.store.updateSession(session.id, { sessionFile: join(directory, "session.jsonl") });
		this.#writeOwnerLaunchContext(created);
		return created;
	}

	/**
	 * Archive a task: keep everything, prove what was kept (§2.6, §3.C).
	 *
	 * Archiving never removes a worktree, a branch or a file. What it adds is the immutable
	 * restoration ref and the persisted receipt that a later Continue needs, plus the honest
	 * facts about the worktree it retained - whether the task stopped with tracked changes and
	 * whether ignored files are present, which Cedia never removes. Cleanup stays unavailable
	 * until its own guards pass, so this is the whole archive operation.
	 */
	archiveSession(id: string): SessionView {
		this.#assertOpen();
		const session = this.#session(id);
		if (session.status === "running") {
			throw new HostError("task_running", "Stop the task before archiving it, or wait for its turn to finish.", 409);
		}
		if (session.archived) return this.sessionView(session);
		const identity = this.#readWorkspaceIdentity(id);
		const recordedAt = new Date().toISOString();
		const directory = join(this.#options.stateDir, "sessions", id);
		const worktree = identity?.mode === "worktree" ? session.cwd : undefined;
		const commit = worktree ? probeGit(worktree, ["rev-parse", "HEAD"]) : undefined;
		const branch = worktree ? probeGit(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]) : undefined;
		const dirty = worktree ? (probeGit(worktree, ["status", "--porcelain"]) ?? "") !== "" : false;
		const ignored = worktree ? (probeGit(worktree, ["status", "--porcelain", "--ignored"]) ?? "").split("\n").some(line => line.startsWith("!!")) : false;
		// The ref only exists for a managed worktree: a task working directly in the user's
		// checkout must not leave Cedia refs in that repository.
		let ref: string | undefined;
		if (worktree && commit) {
			ref = `refs/cedia/archive/${id}/${Date.now()}`;
			const created = probeGit(worktree, ["update-ref", ref, commit]);
			// `update-ref` prints nothing on success, so a missing answer means it worked; an
			// actual failure throws inside `probeGit` and leaves `ref` unset below.
			if (probeGit(worktree, ["rev-parse", "--verify", ref]) !== commit) ref = undefined;
			void created;
		}
		const receipt: SessionArchiveReceipt = {
			state: "retained",
			...(ref === undefined ? {} : { ref }),
			...(commit === undefined ? {} : { commit }),
			...(branch === undefined ? {} : { branch }),
			...(worktree === undefined ? {} : { worktree }),
			dirty,
			ignored,
			recordedAt,
			reason: worktree
				? "The worktree, its branch and its files are kept. Cedia removes nothing while cleanup stays unavailable."
				: "The task worked in the project folder, so there is no worktree to keep; nothing was removed.",
		};
		this.#writeArchiveReceipt(directory, receipt);
		const metadata = this.store.getSessionWorkspaceMetadata(id);
		if (metadata !== undefined) {
			this.store.updateSessionWorkspaceMetadata(id, {
				actualCwd: worktree ?? session.cwd,
				...(worktree === undefined ? {} : { worktreeRoot: metadata.worktreeRoot ?? worktree }),
				...(branch === undefined ? {} : { taskBranch: branch }),
				...(commit === undefined ? {} : { restorationSha: commit }),
				...(ref === undefined ? {} : { restorationRef: ref }),
			});
		}
		const archived = this.store.updateSession(id, { archived: true });
		this.#writeOwnerLaunchContext(archived);
		return this.sessionView(archived);
	}

	/**
	 * What is at this task's local owner endpoint (§8.2 O08).
	 *
	 * A decision, never an action: the host reports whether a running OMP owner published an
	 * endpoint for this task, and refuses to guess when a record is stale or names something else.
	 * Nothing here starts, stops or deletes a process.
	 */
	ownerAttachment(sessionId: string): Promise<CediaOwnerAttachment> {
		const session = this.store.getSession(sessionId);
		if (!session) throw new HostError("not_found", "Task not found", 404);
		return probeCediaOwner(join(this.#options.stateDir, "sessions", sessionId), { expected: { sessionId } });
	}

	/**
	 * List the persisted task owners without starting or changing any runtime. The result is capped
	 * and probes are deliberately serialized in a small worker pool so a large task history cannot
	 * create an unbounded number of local socket connections or an unbounded response.
	 */
	async knownOwnerStates(): Promise<{ owners: Array<{ taskId: string; title: string; archived: boolean; state: CediaOwnerAttachment["state"]; reason?: string; identity?: { sessionId: string; incarnation: string; pid: number; ownerStartedAt: string; mode: "controller" | "inspect_only" } }>; truncated: boolean }> {
		const sessions = this.store.listSessions(undefined, { includeArchived: true });
		const limit = 500;
		const selected = sessions.slice(0, limit);
		const owners: Array<{ taskId: string; title: string; archived: boolean; state: CediaOwnerAttachment["state"]; reason?: string; identity?: { sessionId: string; incarnation: string; pid: number; ownerStartedAt: string; mode: "controller" | "inspect_only" } }> = new Array(selected.length);
		let cursor = 0;
		const workers = Array.from({ length: Math.min(8, selected.length) }, async () => {
			for (;;) {
				const index = cursor++;
				const session = selected[index];
				if (!session) return;
				const result = await probeCediaOwner(join(this.#options.stateDir, "sessions", session.id), { expected: { sessionId: session.id, incarnation: session.incarnation } });
				if (result.state === "attached") {
					const { identity } = result;
					owners[index] = { taskId: session.id, title: session.title, archived: session.archived, state: result.state, identity: { sessionId: identity.sessionId, incarnation: identity.incarnation, pid: identity.pid, ownerStartedAt: identity.ownerStartedAt, mode: identity.mode ?? "controller" } };
				} else if (result.state === "stale" || result.state === "conflict") {
					// Probe diagnostics may contain a path from a socket error. The listing is a UI
					// selection surface, so keep a bounded explanation and remove absolute paths.
					const reason = result.reason.replace(/(?:[A-Za-z]:)?[\\/][^\r\n,;)]*/g, "[path]").slice(0, 240);
					owners[index] = { taskId: session.id, title: session.title, archived: session.archived, state: result.state, reason };
				} else owners[index] = { taskId: session.id, title: session.title, archived: session.archived, state: result.state };
			}
		});
		await Promise.all(workers);
		return { owners, truncated: sessions.length > selected.length };
	}

	/** Explicit, allowlisted status read through a live owner's serialized RPC dispatcher. */
	ownerSummary(sessionId: string) {
		const session = this.store.getSession(sessionId);
		if (!session) throw new HostError("not_found", "Task not found", 404);
		return readCediaOwnerSummary(join(this.#options.stateDir, "sessions", sessionId), { expected: { sessionId } });
	}

	/** Report whether the separately gated cleanup operation is enabled. */
	cleanupCapability(): SessionCleanupCapability {
		return this.#options.cleanupEnabled === true
			? { enabled: true, reason: "Cleanup is enabled only for an explicit host operation; no automatic caller is registered." }
			: { enabled: false, reason: "Automatic workspace cleanup is inactive in this host build; worktrees, branches and files are retained." };
	}

	/** Run the cleanup protocol once. The host never calls this automatically. */
	cleanupSession(id: string): Promise<SessionCleanupResult> {
		return this.#cleanupSession(id);
	}

	/** Descriptive alias for callers that name the operation as an attempt. */
	attemptCleanup(id: string): Promise<SessionCleanupResult> {
		return this.#cleanupSession(id);
	}

	async #cleanupSession(id: string): Promise<SessionCleanupResult> {
		this.#assertOpen();
		let session = this.#session(id);
		const capability = this.cleanupCapability();
		let metadata = this.store.getSessionWorkspaceMetadata(id);
		if (metadata === undefined) {
			const identity = this.#readWorkspaceIdentity(id);
			metadata = this.store.updateSessionWorkspaceMetadata(id, {
				taskId: id,
				projectId: session.projectId,
				actualCwd: session.cwd,
				...(identity?.isGit ? { repositoryId: this.#repositoryIdentity(identity.root) } : {}),
				...(identity?.sourceCommit === undefined ? {} : { sourceCommit: identity.sourceCommit }),
				...(identity?.branch === undefined ? {} : { taskBranch: identity.branch, integrationTargetRef: `refs/heads/${identity.branch}`, integrationTargetCommit: identity.sourceCommit, integrationObservedCommit: identity.sourceCommit }),
			});
		}
		const receipt = this.#readArchiveReceipt(id);
		if (metadata.cleanupState === "removed") {
			if (receipt?.state === "removed") return this.#cleanupResult(id, metadata, capability, [], true, "The cleanup transition was already completed.");
			return this.#cleanupRefusal(id, metadata, capability, [{ id: "recheck", state: "uncertain", reason: "The task row says the worktree was removed, but its durable removal receipt is missing." }], "Cleanup completion cannot be trusted without its durable receipt; the workspace remains retained.");
		}
		if (receipt === undefined || !session.archived) {
			return this.#cleanupRefusal(id, metadata, capability, [{ id: "turn", state: "blocked", reason: "Archive the task before requesting workspace cleanup." }], "The task is not archived; its workspace remains retained.");
		}
		// A crash can leave a durable prepared receipt after the worktree removal itself. Finish only
		// the recorded transition when the path and registration are both gone; an existing path is
		// always sent through the normal gates again.
		if (metadata.cleanupState === "prepared" && receipt.state === "prepared") {
			const ref = metadata.restorationRef ?? receipt.ref;
			const sha = metadata.restorationSha ?? receipt.commit;
			const root = this.#repositoryRoot(metadata);
			const refSha = ref && root ? probeGit(root, ["rev-parse", "--verify", ref]) : undefined;
			const registered = root && metadata.worktreeRoot ? this.#worktreeRegistered(root, metadata.worktreeRoot) : undefined;
			if (refSha === sha && metadata.worktreeRoot !== undefined && !existsSync(metadata.worktreeRoot) && registered === false) {
				try {
					metadata = this.store.updateSessionWorkspaceMetadata(id, { cleanupState: "removed", lastFailure: null });
					this.#persistCleanupReceipt(join(this.#options.stateDir, "sessions", id), { ...receipt, state: "removed", ref: ref ?? receipt.ref, commit: sha ?? receipt.commit });
					return this.#cleanupResult(id, metadata, capability, [], true, "The worktree was already absent and its prepared receipt proves the removal transition.");
				} catch (error) {
					return this.#cleanupRefusal(id, metadata, capability, [{ id: "recheck", state: "uncertain", reason: `The prepared cleanup receipt could not be completed: ${error instanceof Error ? error.message : String(error)}` }], "The prepared cleanup transition needs reconciliation.");
				}
			}
		}
		try { metadata = this.store.updateSessionWorkspaceMetadata(id, { cleanupState: "archive_requested", lastFailure: null }); }
		catch (error) { return this.#cleanupRefusal(id, metadata, capability, [{ id: "recheck", state: "uncertain", reason: `Cleanup could not enter archive_requested: ${error instanceof Error ? error.message : String(error)}` }], "Cleanup could not durably start; the workspace remains retained."); }

		const first = this.#evaluateCleanupGates(session, metadata);
		if (first.gates.some(gate => gate.state !== "passed")) {
			const refusal = first.gates.find(gate => gate.state !== "passed")!;
			const gates = [...first.gates, { id: "recheck" as const, state: "uncertain" as const, reason: "The immediate removal recheck was not reached because an earlier guard refused cleanup." }];
			return this.#cleanupRefusal(id, metadata, capability, gates, refusal.reason ?? "A cleanup guard did not pass.");
		}
		if (!capability.enabled) {
			return this.#cleanupRefusal(id, metadata, capability, first.gates, capability.reason);
		}

		const generation = metadata.cleanupGeneration + 1;
		const taskHead = first.taskHead;
		const root = first.repositoryRoot;
		const worktree = metadata.worktreeRoot;
		if (!taskHead || !root || !worktree) {
			return this.#cleanupRefusal(id, metadata, capability, first.gates, "Cleanup requires a managed Git worktree and a verified task HEAD.");
		}
		const ref = `refs/cedia/archive/${id}/${generation}`;
		try {
			if (this.#options.cleanupOperations?.createArchiveRef) this.#options.cleanupOperations.createArchiveRef(root, ref, taskHead);
			else {
				// The generation ref is a receipt, not a mutable bookmark.  Supplying the
				// all-zero old value makes Git refuse an already existing generation instead
				// of silently replacing an orphan left by an interrupted attempt.
				runGitSync(root, ["update-ref", ref, taskHead, "0000000000000000000000000000000000000000"]);
			}
			if (probeGit(root, ["rev-parse", "--verify", ref]) !== taskHead) throw new Error("Git did not return the created archive ref at the task HEAD");
		} catch (error) {
			const reason = `The immutable archive ref could not be created: ${error instanceof Error ? error.message : String(error)}`;
			return this.#cleanupRefusal(id, metadata, capability, first.gates, reason);
		}

		const preparedReceipt: SessionArchiveReceipt = {
			...receipt,
			state: "prepared",
			ref,
			commit: taskHead,
			...(metadata.taskBranch === undefined ? {} : { branch: metadata.taskBranch }),
			...(worktree === undefined ? {} : { worktree }),
			reason: "Cleanup evidence is prepared; the preserved task branch and immutable ref protect the exact task revision.",
		};
		try {
			this.#persistCleanupReceipt(join(this.#options.stateDir, "sessions", id), preparedReceipt);
			metadata = this.store.updateSessionWorkspaceMetadata(id, {
				cleanupGeneration: generation,
				cleanupState: "prepared",
				restorationRef: ref,
				restorationSha: taskHead,
				lastFailure: null,
			});
		} catch (error) {
			const reason = `Cleanup evidence was not durably recorded: ${error instanceof Error ? error.message : String(error)}`;
			return this.#cleanupRefusal(id, metadata, capability, first.gates, reason);
		}

		// Every guard is repeated after the evidence is durable. A mutation here leaves the ref as a
		// harmless orphan and returns the task to retained; it never makes the operation forceful.
		session = this.#session(id);
		const recheck = this.#evaluateCleanupGates(session, metadata);
		const recheckGate: SessionCleanupGate = recheck.gates.some(gate => gate.state !== "passed")
			? { id: "recheck", state: "uncertain", reason: recheck.gates.find(gate => gate.state !== "passed")?.reason ?? "A guard changed while cleanup was preparing." }
			: { id: "recheck", state: "passed" };
		if (recheckGate.state !== "passed") {
			const reason = `Cleanup aborted after a detected race: ${recheckGate.reason}`;
			try {
				metadata = this.store.updateSessionWorkspaceMetadata(id, { cleanupState: "retained", lastFailure: reason });
				this.#persistCleanupReceipt(join(this.#options.stateDir, "sessions", id), { ...preparedReceipt, state: "retained", reason });
			} catch { /* The immutable ref and prepared receipt remain for reconciliation. */ }
			return this.#cleanupResult(id, metadata, capability, [...recheck.gates, recheckGate], false, reason);
		}

		try {
			if (this.#options.cleanupOperations?.removeWorktree) this.#options.cleanupOperations.removeWorktree(root, worktree);
			else runGitSync(root, ["worktree", "remove", worktree]);
		} catch (error) {
			const reason = `Git refused the non-force worktree removal: ${error instanceof Error ? error.message : String(error)}`;
			try {
				metadata = this.store.updateSessionWorkspaceMetadata(id, { cleanupState: "retained", lastFailure: reason });
				this.#persistCleanupReceipt(join(this.#options.stateDir, "sessions", id), { ...preparedReceipt, state: "retained", reason });
			} catch { /* Keep the prepared evidence if a later persistence step is unavailable. */ }
			return this.#cleanupResult(id, metadata, capability, [...recheck.gates, recheckGate], false, reason);
		}
		try {
			this.#options.cleanupOperations?.persistCompletion?.();
			metadata = this.store.updateSessionWorkspaceMetadata(id, { cleanupState: "removed", lastFailure: null });
			this.#persistCleanupReceipt(join(this.#options.stateDir, "sessions", id), { ...preparedReceipt, state: "removed", reason: "The clean managed worktree was removed after every cleanup guard passed; the task branch and archive ref remain." });
		} catch (error) {
			const reason = `The worktree was removed, but completion evidence needs reconciliation: ${error instanceof Error ? error.message : String(error)}`;
			try { metadata = this.store.updateSessionWorkspaceMetadata(id, { cleanupState: "prepared", lastFailure: reason }); } catch { /* prepared evidence remains on disk */ }
			return this.#cleanupResult(id, metadata, capability, [...recheck.gates, recheckGate], true, reason);
		}
		return this.#cleanupResult(id, metadata, capability, [...recheck.gates, recheckGate], true, "The clean managed worktree was removed after every cleanup guard passed; the task branch and archive ref remain.");
	}

	#cleanupResult(id: string, metadata: SessionWorkspaceMetadata, capability: SessionCleanupCapability, gates: readonly SessionCleanupGate[], removed: boolean, reason: string): SessionCleanupResult {
		return { sessionId: id, state: metadata.cleanupState, removed, capability, gates, reason, generation: metadata.cleanupGeneration };
	}

	#persistCleanupReceipt(directory: string, receipt: SessionArchiveReceipt): void {
		if (this.#options.cleanupOperations?.persistReceipt) this.#options.cleanupOperations.persistReceipt(directory, receipt);
		else this.#writeArchiveReceipt(directory, receipt);
	}

	#cleanupRefusal(id: string, metadata: SessionWorkspaceMetadata, capability: SessionCleanupCapability, gates: readonly SessionCleanupGate[], reason: string): SessionCleanupResult {
		let current = metadata;
		try { current = this.store.updateSessionWorkspaceMetadata(id, { cleanupState: "retained", lastFailure: reason }); } catch { /* Preserve the prior durable state when the store itself is unavailable. */ }
		return this.#cleanupResult(id, current, capability, gates, false, reason);
	}

	#evaluateCleanupGates(session: Session, metadata: SessionWorkspaceMetadata): { gates: SessionCleanupGate[]; repositoryRoot?: string; taskHead?: string } {
		const gates: SessionCleanupGate[] = [];
		const runtime = this.#runtimes.get(session.id);
		const openTurns = this.store.listOpenTurnIntents(session.id);
		const turnBlocked = session.status === "running" || session.status === "recovery_required" || runtime?.activeCommand !== undefined || openTurns.length > 0;
		gates.push(turnBlocked ? { id: "turn", state: "blocked", reason: "The task still has an active or unresolved turn." } : { id: "turn", state: "passed" });

		const repositoryRoot = this.#repositoryRoot(metadata);
		let taskHead: string | undefined;
		if (!repositoryRoot || !metadata.worktreeRoot || !metadata.taskBranch || !metadata.integrationTargetRef) {
			gates.push({ id: "integration", state: "unavailable", reason: "Git integration metadata is incomplete for this workspace." });
		} else {
			taskHead = probeGit(metadata.actualCwd, ["rev-parse", "HEAD"]);
			const branchHead = probeGit(repositoryRoot, ["rev-parse", "--verify", `refs/heads/${metadata.taskBranch}`]);
			const targetCommit = probeGit(repositoryRoot, ["rev-parse", "--verify", metadata.integrationTargetRef]);
			const observedCommit = metadata.integrationTargetCommit ?? metadata.integrationObservedCommit;
			if (!taskHead || !branchHead || !targetCommit || !observedCommit) {
				gates.push({ id: "integration", state: "uncertain", reason: "Git could not read the task branch or recorded integration target." });
			} else if (metadata.restorationSha !== undefined && taskHead !== metadata.restorationSha) {
				gates.push({ id: "integration", state: "uncertain", reason: "The task branch moved away from the recorded task revision; cleanup stopped." });
			} else if (branchHead !== taskHead) {
				gates.push({ id: "integration", state: "uncertain", reason: "The task branch moved away from the task worktree HEAD; cleanup stopped." });
			} else if (targetCommit !== observedCommit) {
				gates.push({ id: "integration", state: "uncertain", reason: "The recorded integration target changed after it was observed; cleanup stopped." });
			} else {
				const ancestry = gitAncestry(repositoryRoot, taskHead, targetCommit);
				gates.push(ancestry === "proven" ? { id: "integration", state: "passed" } : { id: "integration", state: ancestry === "not_proven" ? "blocked" : "uncertain", reason: ancestry === "not_proven" ? "Git cannot prove that the task revision is integrated into the recorded target; squash and cherry-pick equivalence is not guessed." : "Git could not establish the integration ancestry proof." });
			}
		}

		const facts = metadata.actualCwd ? gitWorkingTreeFacts(metadata.actualCwd) : undefined;
		if (!facts) gates.push({ id: "working_tree", state: "uncertain", reason: "Git could not inspect tracked, untracked and ignored files." });
		else if (facts.tracked || facts.untracked || facts.ignored) gates.push({ id: "working_tree", state: "blocked", reason: `The worktree still contains ${facts.tracked ? "tracked" : facts.untracked ? "untracked" : "ignored"} data; Cedia never deletes it to make cleanup pass.` });
		else gates.push({ id: "working_tree", state: "passed" });

		if (this.#options.cleanupGuards?.userTerminals) {
			try { gates.push(this.#guardGate("terminals", this.#options.cleanupGuards.userTerminals(session, metadata))); }
			catch (error) { gates.push({ id: "terminals", state: "uncertain", reason: `The owner-terminal state could not be read: ${error instanceof Error ? error.message : String(error)}` }); }
		} else if (runtime?.terminals?.active || runtime?.activeCommand !== undefined) {
			gates.push({ id: "terminals", state: "blocked", reason: "An AI terminal or active command still uses this task workspace." });
		} else {
			gates.push({ id: "terminals", state: "unavailable", reason: "Cedia has no owner-terminal probe for this workspace." });
		}

		if (this.#options.cleanupGuards?.ide) {
			try { gates.push(this.#guardGate("ide", this.#options.cleanupGuards.ide(session, metadata))); }
			catch (error) { gates.push({ id: "ide", state: "uncertain", reason: `The IDE state could not be read: ${error instanceof Error ? error.message : String(error)}` }); }
		} else if (!this.#options.editors) {
			gates.push({ id: "ide", state: "unavailable", reason: "The IDE bridge is unavailable, so open or unsaved work cannot be ruled out." });
		} else {
			try {
				if (this.#options.editors.hasConnection(metadata.actualCwd)) gates.push({ id: "ide", state: "blocked", reason: "An IDE connection still has this workspace open." });
				else if (this.#options.editors.hasRegisteredWorkspace(metadata.actualCwd)) gates.push({ id: "ide", state: "unavailable", reason: "An IDE previously registered this workspace but no live buffer state is available." });
				else gates.push({ id: "ide", state: "passed" });
			} catch (error) { gates.push({ id: "ide", state: "uncertain", reason: `The IDE state could not be read: ${error instanceof Error ? error.message : String(error)}` }); }
		}

		return { gates, ...(repositoryRoot === undefined ? {} : { repositoryRoot }), ...(taskHead === undefined ? {} : { taskHead }) };
	}

	#guardGate(id: "terminals" | "ide", result: CleanupGuardResult): SessionCleanupGate {
		return result.state === "clear" ? { id, state: "passed" } : { id, state: result.state, reason: result.reason };
	}

	#repositoryRoot(metadata: SessionWorkspaceMetadata): string | undefined {
		if (metadata.repositoryId !== undefined) {
			const candidate = metadata.repositoryId.endsWith("/.git") ? dirname(metadata.repositoryId) : metadata.repositoryId;
			if (existsSync(candidate) && probeGit(candidate, ["rev-parse", "--show-toplevel"]) !== undefined) return candidate;
			const parent = dirname(metadata.repositoryId);
			if (existsSync(parent) && probeGit(parent, ["rev-parse", "--show-toplevel"]) !== undefined) return parent;
		}
		return probeGit(metadata.actualCwd, ["rev-parse", "--show-toplevel"]);
	}

	#worktreeRegistered(root: string, path: string): boolean | undefined {
		try {
			const listing = runGitSync(root, ["worktree", "list", "--porcelain"]).toString();
			const canonical = (value: string): string => { try { return realpathSync(value); } catch { return resolve(value); } };
			return listing.split(/\r?\n/).some(line => line.startsWith("worktree ") && canonical(line.slice("worktree ".length)) === canonical(path));
		} catch { return undefined; }
	}

	/**
	 * Hand OMP a pending model/effort change for this task's next turn (§2.4).
	 *
	 * OMP validates the selection now and commits it at its own turn boundary, so a change made
	 * while a turn is running governs a later turn and never restates the running one. The record
	 * stays `awaiting` until the runtime reports that it committed that exact revision; a refused
	 * selection is recorded with the runtime's reason and reported to the caller as an error.
	 */
  async setPendingModel(sessionId: string, request: { revision: number; provider?: string; modelId?: string; thinkingLevel?: string | null }): Promise<SessionPendingModel> {
		this.#assertOpen();
		this.#session(sessionId);
		const runtime = this.#runtimes.get(sessionId);
		const client = runtime?.client;
		if (!client || client.phase !== "ready" || runtime?.closing) {
			throw new HostError("session_not_started", "Start the OMP session before changing its model", 409);
		}
		const directory = join(this.#options.stateDir, "sessions", sessionId);
		const requested: SessionPendingModel["requested"] = {
			...(request.provider === undefined ? {} : { provider: request.provider }),
			...(request.modelId === undefined ? {} : { modelId: request.modelId }),
			...(request.thinkingLevel === undefined ? {} : { thinkingLevel: request.thinkingLevel }),
		};
		const acceptedAt = new Date().toISOString();
		if (!client.pendingModelAdvertised()) {
			// This runtime has no dequeue/start boundary to commit at, so the change cannot be
			// deferred. The record says so instead of pretending it was held, and no revision is
			// ever sent to a runtime that never advertised accepting one.
			await this.#applyModelChangeImmediately(runtime!, request);
			const applied: SessionPendingModel = {
				revision: request.revision,
				state: "in-effect",
				requested,
				acceptedAt,
				applied: {
					at: new Date().toISOString(),
					via: "immediate",
					...(request.provider === undefined || request.modelId === undefined ? {} : { model: `${request.provider}/${request.modelId}` }),
					...(request.thinkingLevel === undefined || request.thinkingLevel === null ? {} : { thinkingLevel: request.thinkingLevel }),
				},
			};
			this.#writePendingModel(directory, applied);
			return applied;
		}
		try {
			await client.requestCedia("cedia_pending_model", {
				revision: request.revision,
				...(request.provider === undefined ? {} : { provider: request.provider }),
				...(request.modelId === undefined ? {} : { modelId: request.modelId }),
				...(request.thinkingLevel === undefined ? {} : { thinkingLevel: request.thinkingLevel }),
			});
		} catch (error) {
			const refused: SessionPendingModel = {
				revision: request.revision,
				state: "refused",
				requested,
				acceptedAt,
				error: error instanceof Error ? error.message : String(error),
			};
			this.#writePendingModel(directory, refused);
			throw new HostError("pending_model_refused", refused.error ?? "The runtime refused this model change", 409);
		}
		const pending: SessionPendingModel = { revision: request.revision, state: "awaiting", requested, acceptedAt };
		this.#writePendingModel(directory, pending);
		// Ask straight away so an idle task converges without waiting for another boundary.
		this.#syncTurnQueue(runtime!);
    return pending;
  }

  /** Read the per-session OMP goal cache without starting or probing a stopped runtime. */
  goalSnapshot(sessionId: string): OmpProgressSnapshot {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.goal) return { state: "unavailable", reason: NO_OMP_GOAL_RUNTIME_REASON };
    return runtime.goal.snapshot();
  }

  /** Read the per-session OMP subagent cache without starting or probing a stopped runtime. */
  subagentsSnapshot(sessionId: string): OmpSubagentsSnapshot {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.goal) return { state: "unavailable", reason: NO_OMP_SUBAGENTS_RUNTIME_REASON };
    return runtime.goal.subagents();
  }

  /** Read the per-session native plan/vibe/review cache without starting or probing a stopped runtime. */
  planSnapshot(sessionId: string): OmpPlanSnapshot {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.plan) return { state: "unavailable", reason: NO_OMP_PLAN_RUNTIME_REASON };
    return runtime.plan.snapshot();
  }

  /** Read the per-session OMP todo phases without starting or probing a stopped runtime. */
  progressSnapshot(sessionId: string): OmpTodoSnapshot {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.todos) return { state: "unavailable", reason: NO_OMP_TODOS_RUNTIME_REASON };
    return runtime.todos.snapshot();
  }

  /** Read the per-session OMP advisor cache without starting or probing a stopped runtime. */
  advisorSnapshot(sessionId: string): OmpAdvisorSnapshot {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.advisor) return { state: "unavailable", reason: NO_OMP_ADVISOR_RUNTIME_REASON };
    return runtime.advisor.snapshot();
  }

  /** Read one scope's advisor config live without starting or probing a stopped runtime. */
  async advisorConfigSnapshot(sessionId: string, scope: OmpAdvisorConfigScope): Promise<OmpAdvisorConfigSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.advisorConfig) return { state: "unavailable", reason: NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON };
    return runtime.advisorConfig.refresh(scope);
  }

  /** Read the runtime-owned agent roster without starting or probing a stopped runtime. */
  async agentsSnapshot(sessionId: string): Promise<OmpAgentsSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.agents) return { state: "unavailable", reason: NO_OMP_AGENTS_RUNTIME_REASON };
    return runtime.agents.refresh();
  }

  /** List every discovered agent with its effective hub config without starting a stopped runtime. */
  async agentsConfigList(sessionId: string): Promise<OmpAgentConfigList> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.agents) {
      return { state: "unavailable", reason: NO_OMP_AGENTS_RUNTIME_REASON };
    }
    try {
      const agents = await listOmpAgentConfigs(runtime.client);
      if (agents === undefined) return { state: "unavailable", reason: NO_OMP_AGENTS_BRIDGE_REASON };
      return { state: "available", agents };
    } catch (error) {
      return { state: "unavailable", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Abort a running agent turn and release its row through the durable owner-only command envelope. */
  async agentsKill(sessionId: string, deviceId: string, request: OmpAgentKillRequest): Promise<OmpAgentKillResult> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this agents command");
    let claim: ReturnType<DurableStore["claimCommand"]>;
    try {
      claim = this.store.claimCommand({
        sessionId,
        commandId: request.commandId,
        deviceId,
        incarnation: request.incarnation,
        kind: "cedia_agents_kill",
        payload: { id: request.id },
      });
    } catch (error) {
      if (error instanceof DurableStoreCommandConflictError) throw new HostError("command_conflict", error.message, 409);
      throw error;
    }
    if (!claim.created) return this.#agentsKillCommandResult(claim.command);

    const unavailable = (reason: string): { readonly available: false; readonly reason: string } => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.agents) {
      const result = unavailable(NO_OMP_AGENTS_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_AGENTS_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.agents.kill(request.id);
      const result: { readonly available: true } & OmpAgentKillData = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "agents.kill", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP agent kill acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      const unavailableError = reason === NO_OMP_AGENTS_RUNTIME_REASON || reason === NO_OMP_AGENTS_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
      if (!terminal.has(current.status)) {
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpAgentsValidationError ? "failed" : "outcome_unknown", {
          error: reason,
          result: error instanceof OmpAgentsValidationError
            ? { errorCode: "omp_agents_invalid", reason }
            : unavailableError
              ? json(result)
              : { errorCode: "request_failed" },
        });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      if (unavailableError) return result;
      if (error instanceof OmpAgentsValidationError) throw new HostError("omp_agents_invalid", reason, 502);
      // A refusal from the runtime (unknown agent, read-only transcript, lifecycle
      // state) is an honest projection, not a command failure: the durable receipt
      // keeps the runtime's reason while the route answers it with 200.
      return result;
    }
  }

  #agentsKillCommandResult(command: Command): OmpAgentKillResult {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpAgentKillResult(stored); } catch { /* fall through to durable error */ }
      if (object(stored) && stored.available === false && typeof stored.reason === "string") return { available: false, reason: stored.reason };
    }
    return { available: false, reason: command.error ?? NO_OMP_AGENTS_RUNTIME_REASON };
  }

  /** Revive a parked agent through the durable owner-only command envelope. */
  async agentsRevive(sessionId: string, deviceId: string, request: OmpAgentReviveRequest): Promise<OmpAgentReviveResult> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this agents command");
    let claim: ReturnType<DurableStore["claimCommand"]>;
    try {
      claim = this.store.claimCommand({
        sessionId,
        commandId: request.commandId,
        deviceId,
        incarnation: request.incarnation,
        kind: "cedia_agents_revive",
        payload: { id: request.id },
      });
    } catch (error) {
      if (error instanceof DurableStoreCommandConflictError) throw new HostError("command_conflict", error.message, 409);
      throw error;
    }
    if (!claim.created) return this.#agentsReviveCommandResult(claim.command);

    const unavailable = (reason: string): { readonly available: false; readonly reason: string } => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.agents) {
      const result = unavailable(NO_OMP_AGENTS_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_AGENTS_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.agents.revive(request.id);
      const result: { readonly available: true } & OmpAgentReviveData = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "agents.revive", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP agent revive acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      const unavailableError = reason === NO_OMP_AGENTS_RUNTIME_REASON || reason === NO_OMP_AGENTS_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
      if (!terminal.has(current.status)) {
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpAgentsValidationError ? "failed" : "outcome_unknown", {
          error: reason,
          result: error instanceof OmpAgentsValidationError
            ? { errorCode: "omp_agents_invalid", reason }
            : unavailableError
              ? json(result)
              : { errorCode: "request_failed" },
        });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      if (unavailableError) return result;
      if (error instanceof OmpAgentsValidationError) throw new HostError("omp_agents_invalid", reason, 502);
      // A refusal from the runtime (unknown agent, read-only transcript, lifecycle
      // state) is an honest projection, not a command failure: the durable receipt
      // keeps the runtime's reason while the route answers it with 200.
      return result;
    }
  }

  /** Configure one discovered agent with the hub's persist semantics. */
  async agentsConfig(sessionId: string, deviceId: string, request: OmpAgentConfigRequest): Promise<OmpAgentConfigResult> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this agents command");
    let claim: ReturnType<DurableStore["claimCommand"]>;
    try {
      claim = this.store.claimCommand({
        sessionId,
        commandId: request.commandId,
        deviceId,
        incarnation: request.incarnation,
        kind: "cedia_agents_config",
        payload: {
          agent: request.agent,
          ...(request.enabled === undefined ? {} : { enabled: request.enabled }),
          ...(request.model === undefined ? {} : { model: request.model }),
          ...(request.prewalk === undefined ? {} : { prewalk: request.prewalk }),
          ...(request.advisor === undefined ? {} : { advisor: request.advisor }),
        },
      });
    } catch (error) {
      if (error instanceof DurableStoreCommandConflictError) throw new HostError("command_conflict", error.message, 409);
      throw error;
    }
    if (!claim.created) return this.#agentsConfigCommandResult(claim.command);

    const unavailable = (reason: string): { readonly available: false; readonly reason: string } => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.agents) {
      const result = unavailable(NO_OMP_AGENTS_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_AGENTS_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.agents.configure({
        agent: request.agent,
        ...(request.enabled === undefined ? {} : { enabled: request.enabled }),
        ...(request.model === undefined ? {} : { model: request.model }),
        ...(request.prewalk === undefined ? {} : { prewalk: request.prewalk }),
        ...(request.advisor === undefined ? {} : { advisor: request.advisor }),
      });
      const result: { readonly available: true } & OmpAgentConfigData = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "agents.config.set", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP agent config acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      const unavailableError = reason === NO_OMP_AGENTS_RUNTIME_REASON || reason === NO_OMP_AGENTS_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
      if (!terminal.has(current.status)) {
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpAgentsValidationError ? "failed" : "outcome_unknown", {
          error: reason,
          result: error instanceof OmpAgentsValidationError
            ? { errorCode: "omp_agents_invalid", reason }
            : unavailableError
              ? json(result)
              : { errorCode: "request_failed" },
        });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      if (unavailableError) return result;
      if (error instanceof OmpAgentsValidationError) throw new HostError("omp_agents_invalid", reason, 502);
      // A refusal from the runtime (unknown agent name) is an honest projection, not a
      // command failure: the durable receipt keeps the runtime's reason while the route
      // answers it with 200.
      return result;
    }
  }

  #agentsConfigCommandResult(command: Command): OmpAgentConfigResult {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpAgentConfigResult(stored); } catch { /* fall through to durable error */ }
      if (object(stored) && stored.available === false && typeof stored.reason === "string") return { available: false, reason: stored.reason };
    }
    return { available: false, reason: command.error ?? NO_OMP_AGENTS_RUNTIME_REASON };
  }

  #agentsReviveCommandResult(command: Command): OmpAgentReviveResult {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpAgentReviveResult(stored); } catch { /* fall through to durable error */ }
      if (object(stored) && stored.available === false && typeof stored.reason === "string") return { available: false, reason: stored.reason };
    }
    return { available: false, reason: command.error ?? NO_OMP_AGENTS_RUNTIME_REASON };
  }

  /** Read OMP's own queued submissions without starting or probing a stopped runtime. */
  async queueSnapshot(sessionId: string): Promise<OmpQueueSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.queue) return { state: "unavailable", reason: NO_OMP_QUEUE_RUNTIME_REASON };
    return runtime.queue.refresh();
  }

  /** Read the process run-pause gate without starting or probing a stopped runtime. */
  async pauseSnapshot(sessionId: string): Promise<OmpPauseSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.pause) return { state: "unavailable", reason: NO_OMP_PAUSE_RUNTIME_REASON };
    return runtime.pause.refresh();
  }

  /** Read OMP's own context accounting without starting or probing a stopped runtime. */
  async contextSnapshot(sessionId: string): Promise<OmpContextSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.context) return { state: "unavailable", reason: NO_OMP_CONTEXT_RUNTIME_REASON };
    return runtime.context.refresh();
  }

  /** Read OMP's own history state without starting or probing a stopped runtime. */
  async historySnapshot(sessionId: string): Promise<{ readonly available: true; readonly checkpoint: Extract<OmpHistorySnapshot, { readonly state: "available" }>["checkpoint"]; readonly lastRewind: Extract<OmpHistorySnapshot, { readonly state: "available" }>["lastRewind"] } | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.history) return { available: false, reason: NO_OMP_HISTORY_RUNTIME_REASON };
    const snapshot = await runtime.history.refresh();
    return snapshot.state === "available"
      ? { available: true, checkpoint: snapshot.checkpoint, lastRewind: snapshot.lastRewind }
      : { available: false, reason: snapshot.reason };
  }

  /** Read OMP's own bounded transcript without starting or probing a stopped runtime. */
  async historyTranscript(sessionId: string): Promise<{ readonly available: true; readonly text: string; readonly truncated: boolean; readonly bytes: number } | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.history) return { available: false, reason: NO_OMP_HISTORY_RUNTIME_REASON };
    const snapshot = await runtime.history.transcript();
    return snapshot.state === "available"
      ? { available: true, text: snapshot.text, truncated: snapshot.truncated, bytes: snapshot.bytes }
      : { available: false, reason: snapshot.reason };
  }

  /** Read OMP's own session tree and lineage without starting or probing a stopped runtime. */
  async treeSnapshot(sessionId: string): Promise<{ readonly available: true } & OmpTreeData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.tree) return { available: false, reason: NO_OMP_TREE_RUNTIME_REASON };
    const snapshot = await runtime.tree.refresh();
    return snapshot.state === "available"
      ? { available: true, leafId: snapshot.leafId, nodes: snapshot.nodes, pathIds: snapshot.pathIds, truncated: snapshot.truncated, lineage: snapshot.lineage }
      : { available: false, reason: snapshot.reason };
  }

  /** Read OMP's loop mode state without starting or probing a stopped runtime. */
  async loopSnapshot(sessionId: string): Promise<{ readonly available: true } & OmpLoopData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.loop) return { available: false, reason: NO_OMP_LOOP_RUNTIME_REASON };
    const snapshot = await runtime.loop.refresh();
    return snapshot.state === "available"
      ? { available: true, enabled: snapshot.enabled, paused: snapshot.paused, limit: snapshot.limit, condition: snapshot.condition, hasPrompt: snapshot.hasPrompt }
      : { available: false, reason: snapshot.reason };
  }

  /**
   * Disable OMP's loop mode inside the durable command envelope used by task controls.
   * Replaying a command id returns the recorded outcome without disabling a second time.
   * Enabling stays on the `/loop` prompt path; this route carries only the disable half.
   */
  async loopCommand(sessionId: string, deviceId: string, request: OmpLoopCommandRequest): Promise<OmpLoopSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this loop command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_loop_set",
      payload: {},
    });
    if (!claim.created) return this.#loopCommandResult(claim.command);

    const unavailable = (reason: string): OmpLoopSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_LOOP_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_LOOP_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.loop.disable();
      const projected = runtime.loop.snapshot();
      const result: OmpLoopSnapshot = projected.state === "available"
        ? projected
        : unavailable(projected.reason);
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "loop.set", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP loop mode acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_LOOP_RUNTIME_REASON || reason === NO_OMP_LOOP_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpLoopValidationError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #loopCommandResult(command: Command): OmpLoopSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpLoopCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_LOOP_RUNTIME_REASON };
  }

  /** Read OMP's side-question state without starting or probing a stopped runtime. */
  async btwSnapshot(sessionId: string): Promise<OmpBtwSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.btw) return { available: false, reason: NO_OMP_BTW_RUNTIME_REASON };
    return runtime.btw.refresh();
  }

  /**
   * Ask an ephemeral side question inside the durable command envelope used by task controls.
   * Like the terminal (which fires the run without awaiting it), the call answers the
   * answering state at once; the answer lands in the held server state and `btwSnapshot`
   * reports it. Replaying a command id returns the recorded acceptance receipt — the answer
   * itself is read from the state, which keeps moving after the receipt is stored. The
   * transcript is never touched by either half.
   */
  async btwAsk(sessionId: string, deviceId: string, request: OmpBtwAskCommandRequest): Promise<OmpBtwSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this side-question command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_btw_ask",
      payload: { question: request.question },
    });
    if (!claim.created) return this.#btwAskCommandResult(claim.command);

    const unavailable = (reason: string): OmpBtwSnapshot => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_BTW_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_BTW_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.btw.ask(request.question);
      const result: OmpBtwSnapshot = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "btw.ask", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP side question acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_BTW_RUNTIME_REASON || reason === NO_OMP_BTW_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpBtwValidationError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #btwAskCommandResult(command: Command): OmpBtwSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpBtwCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { available: false, reason: command.error ?? NO_OMP_BTW_RUNTIME_REASON };
  }

  /**
   * Promote the held side answer into a branched session inside the durable envelope.
   * Replaying a command id returns the recorded branch without forking twice. On success
   * the host adopts the branched session file the runtime names, so windows follow the
   * conversation where it continues.
   */
  async btwBranch(sessionId: string, deviceId: string, request: OmpBtwBranchCommandRequest): Promise<OmpBtwBranchData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this branch command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_btw_branch",
      payload: {},
    });
    if (!claim.created) return this.#btwBranchCommandResult(claim.command);

    const unavailable = (reason: string): { readonly available: false; readonly reason: string } => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_BTW_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_BTW_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.btw.branch();
      if (outcome.sessionFile !== null) {
        this.#assertOwnedSessionPath(runtime.session, outcome.sessionFile);
        runtime.session = this.store.updateSession(sessionId, { sessionFile: outcome.sessionFile });
        this.#writeOwnerLaunchContext(runtime.session);
      }
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "btw.branch", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP side-question branch acknowledged", data: json(outcome) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_BTW_RUNTIME_REASON || reason === NO_OMP_BTW_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpBtwValidationError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #btwBranchCommandResult(command: Command): OmpBtwBranchData | { readonly available: false; readonly reason: string } {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpBtwBranchCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { available: false, reason: command.error ?? NO_OMP_BTW_RUNTIME_REASON };
  }

  /** Read OMP's cleanse run state without starting or probing a stopped runtime. */
  async cleanseSnapshot(sessionId: string): Promise<OmpCleanseSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.cleanse) return { available: false, reason: NO_OMP_CLEANSE_RUNTIME_REASON };
    return runtime.cleanse.refresh();
  }

  /**
   * Start detection plus one bounded repair batch inside the durable command envelope.
   * Like the terminal overlay, the call answers the running state at once; the held report
   * lands later and `cleanseSnapshot` reports it. Replaying a command id returns the recorded
   * acceptance receipt — the report itself is read from the state. The transcript is never
   * touched; repair work happens in the cleanse run's own auxiliary session.
   */
  async cleanseRun(sessionId: string, deviceId: string, request: OmpCleanseRunCommandRequest): Promise<OmpCleanseSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this cleanse command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_cleanse_run",
      payload: {
        ...(request.request === undefined ? {} : { request: request.request }),
        ...(request.all === undefined ? {} : { all: request.all }),
        ...(request.includeTests === undefined ? {} : { includeTests: request.includeTests }),
        ...(request.maxAgents === undefined ? {} : { maxAgents: request.maxAgents }),
        ...(request.model === undefined ? {} : { model: request.model }),
      },
    });
    if (!claim.created) return this.#cleanseCommandResult(claim.command);

    const unavailable = (reason: string): OmpCleanseSnapshot => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_CLEANSE_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_CLEANSE_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.cleanse.run({
        ...(request.request === undefined ? {} : { request: request.request }),
        ...(request.all === undefined ? {} : { all: request.all }),
        ...(request.includeTests === undefined ? {} : { includeTests: request.includeTests }),
        ...(request.maxAgents === undefined ? {} : { maxAgents: request.maxAgents }),
        ...(request.model === undefined ? {} : { model: request.model }),
      });
      const result: OmpCleanseSnapshot = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "cleanse.run", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP cleanse run acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_CLEANSE_RUNTIME_REASON || reason === NO_OMP_CLEANSE_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpCleanseValidationError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #cleanseCommandResult(command: Command): OmpCleanseSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpCleanseCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { available: false, reason: command.error ?? NO_OMP_CLEANSE_RUNTIME_REASON };
  }

  /** Cancel the running cleanse batch through its own abort signal. */
  async cleanseAbort(sessionId: string, deviceId: string, request: OmpCleanseAbortCommandRequest): Promise<OmpCleanseSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this cleanse abort");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_cleanse_abort",
      payload: {},
    });
    if (!claim.created) return this.#cleanseCommandResult(claim.command);

    const unavailable = (reason: string): OmpCleanseSnapshot => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_CLEANSE_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_CLEANSE_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.cleanse.abort();
      const result: OmpCleanseSnapshot = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "cleanse.abort", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP cleanse abort acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_CLEANSE_RUNTIME_REASON || reason === NO_OMP_CLEANSE_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpCleanseValidationError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /** Read OMP's rule-forging state without starting or probing a stopped runtime. */
  async omfgSnapshot(sessionId: string): Promise<OmpOmfgSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.omfg) return { available: false, reason: NO_OMP_OMFG_RUNTIME_REASON };
    return runtime.omfg.refresh();
  }

  /**
   * Draft a TTSR rule candidate inside the durable command envelope used by task controls.
   * Like the terminal overlay, the call answers the drafting state at once; the held draft
   * lands later and `omfgSnapshot` reports it. Replaying a command id returns the recorded
   * acceptance receipt. The transcript is never touched by any half.
   */
  async omfgDraft(sessionId: string, deviceId: string, request: OmpOmfgDraftCommandRequest): Promise<OmpOmfgSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this rule command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_omfg_draft",
      payload: {
        complaint: request.complaint,
        ...(request.feedback === undefined ? {} : { feedback: request.feedback }),
      },
    });
    if (!claim.created) return this.#omfgCommandResult(claim.command);

    const unavailable = (reason: string): OmpOmfgSnapshot => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_OMFG_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_OMFG_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.omfg.draft(request.complaint, request.feedback);
      const result: OmpOmfgSnapshot = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "omfg.draft", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP rule draft acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_OMFG_RUNTIME_REASON || reason === NO_OMP_OMFG_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpOmfgValidationError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #omfgCommandResult(command: Command): OmpOmfgSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpOmfgCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { available: false, reason: command.error ?? NO_OMP_OMFG_RUNTIME_REASON };
  }

  /**
   * Save the held rule draft into the named scope inside the durable envelope.
   * Replaying a command id returns the recorded landing without writing twice.
   */
  async omfgSave(sessionId: string, deviceId: string, request: OmpOmfgSaveCommandRequest): Promise<OmpOmfgSaveData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this rule save");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_omfg_save",
      payload: {
        scope: request.scope,
        ...(request.overwrite === undefined ? {} : { overwrite: request.overwrite }),
        ...(request.allowUnvalidated === undefined ? {} : { allowUnvalidated: request.allowUnvalidated }),
      },
    });
    if (!claim.created) return this.#omfgSaveCommandResult(claim.command);

    const unavailable = (reason: string): { readonly available: false; readonly reason: string } => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_OMFG_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_OMFG_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.omfg.save(request.scope, { overwrite: request.overwrite, allowUnvalidated: request.allowUnvalidated });
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "omfg.save", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP rule save acknowledged", data: json(outcome) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_OMFG_RUNTIME_REASON || reason === NO_OMP_OMFG_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpOmfgValidationError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #omfgSaveCommandResult(command: Command): OmpOmfgSaveData | { readonly available: false; readonly reason: string } {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpOmfgSaveCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { available: false, reason: command.error ?? NO_OMP_OMFG_RUNTIME_REASON };
  }

  /** Cancel a running rule draft through its own abort signal. */
  async omfgAbort(sessionId: string, deviceId: string, request: OmpOmfgAbortCommandRequest): Promise<OmpOmfgSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this rule abort");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_omfg_abort",
      payload: {},
    });
    if (!claim.created) return this.#omfgCommandResult(claim.command);

    const unavailable = (reason: string): OmpOmfgSnapshot => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_OMFG_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_OMFG_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.omfg.abort();
      const result: OmpOmfgSnapshot = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "omfg.abort", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP rule abort acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_OMFG_RUNTIME_REASON || reason === NO_OMP_OMFG_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpOmfgValidationError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /** Read OMP's prewalk arming state without starting or probing a stopped runtime. */
  async prewalkSnapshot(sessionId: string): Promise<{ readonly available: true } & OmpPrewalkData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.prewalk) return { available: false, reason: NO_OMP_PREWALK_RUNTIME_REASON };
    const snapshot = await runtime.prewalk.refresh();
    return snapshot.state === "available"
      ? { available: true, armed: snapshot.armed }
      : { available: false, reason: snapshot.reason };
  };

  /** Read OMP's live tool catalog without starting a runtime; OMP owns registry and activation state. */
  async toolCatalogSnapshot(sessionId: string): Promise<{ readonly available: true } & OmpToolCatalogData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.toolCatalog) return { available: false, reason: NO_OMP_TOOL_CATALOG_RUNTIME_REASON };
    const snapshot = await runtime.toolCatalog.refresh();
    return snapshot.state === "available"
      ? { available: true, tools: snapshot.tools, truncated: snapshot.truncated, total: snapshot.total, activeCount: snapshot.activeCount }
      : { available: false, reason: snapshot.reason };
  }

  /** Read OMP's Code Mode partition without starting a runtime; OMP owns the partition. */
  async toolCodeModeSnapshot(sessionId: string): Promise<{ readonly available: true } & OmpCodeModeData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.codeMode) return { available: false, reason: NO_OMP_CODE_MODE_RUNTIME_REASON };
    const snapshot = await runtime.codeMode.refresh();
    return snapshot.state === "available"
      ? { available: true, active: snapshot.active, directToolNames: snapshot.directToolNames, preludes: snapshot.preludes }
      : { available: false, reason: snapshot.reason };
  }

  /** Read OMP's extension records plus the live root policy without starting a runtime. */
  async toolExtensionsSnapshot(sessionId: string): Promise<{ readonly available: true } & OmpExtensionsData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.extensions) return { available: false, reason: NO_OMP_EXTENSIONS_RUNTIME_REASON };
    const snapshot = await runtime.extensions.refresh();
    return snapshot.state === "available"
      ? { available: true, roots: snapshot.roots, extensions: snapshot.extensions, truncated: snapshot.truncated, total: snapshot.total }
      : { available: false, reason: snapshot.reason };
  }

  /** Select OMP's enabled tools through the durable owner-only command envelope. */
  async toolsActiveSet(sessionId: string, deviceId: string, request: OmpToolActiveSetRequest): Promise<OmpToolActiveSetSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this tools command");
    let claim: ReturnType<DurableStore["claimCommand"]>;
    try {
      claim = this.store.claimCommand({
        sessionId,
        commandId: request.commandId,
        deviceId,
        incarnation: request.incarnation,
        kind: "cedia_tools_active_set",
        payload: { toolNames: [...request.toolNames] },
      });
    } catch (error) {
      if (error instanceof DurableStoreCommandConflictError) throw new HostError("command_conflict", error.message, 409);
      throw error;
    }
    if (!claim.created) return this.#toolsActiveSetCommandResult(claim.command);

    const unavailable = (reason: string): OmpToolActiveSetSnapshot => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.toolCatalog) {
      const result = unavailable(NO_OMP_TOOL_CATALOG_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_TOOL_CATALOG_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.toolCatalog.setActive(request.toolNames);
      const result: OmpToolActiveSetSnapshot = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "tools.active.set", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP tool activation acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      const unavailableError = reason === NO_OMP_TOOL_CATALOG_RUNTIME_REASON || reason === NO_OMP_TOOL_CATALOG_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
      if (!terminal.has(current.status)) {
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpToolCatalogValidationError ? "failed" : "outcome_unknown", {
          error: reason,
          result: error instanceof OmpToolCatalogValidationError
            ? { errorCode: "omp_tool_catalog_invalid", reason }
            : error instanceof OmpCommandError
              ? { errorCode: "omp_refused", reason }
              : unavailableError
                ? json(result)
                : { errorCode: "request_failed" },
        });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      if (unavailableError) return result;
      if (error instanceof OmpToolCatalogValidationError) throw new HostError("omp_tool_catalog_invalid", reason, 502);
      if (error instanceof OmpCommandError) throw new HostError("omp_refused", reason, 409);
      throw error;
    }
  }

  /** Toggle one extension through the durable owner-only command envelope. */
  async toolsExtensionSet(sessionId: string, deviceId: string, request: OmpExtensionSetRequest): Promise<{ readonly available: true } & OmpExtensionsData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this tools command");
    let claim: ReturnType<DurableStore["claimCommand"]>;
    try {
      claim = this.store.claimCommand({
        sessionId,
        commandId: request.commandId,
        deviceId,
        incarnation: request.incarnation,
        kind: "cedia_tools_extension_set",
        payload: { id: request.id, enabled: request.enabled },
      });
    } catch (error) {
      if (error instanceof DurableStoreCommandConflictError) throw new HostError("command_conflict", error.message, 409);
      throw error;
    }
    if (!claim.created) return this.#toolsExtensionSetCommandResult(claim.command);

    const unavailable = (reason: string): { readonly available: false; readonly reason: string } => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.extensions) {
      const result = unavailable(NO_OMP_EXTENSIONS_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_EXTENSIONS_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.extensions.setEnabled(request.id, request.enabled);
      const result: { readonly available: true } & OmpExtensionsData = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "extensions.set", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP extension toggle acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      const unavailableError = reason === NO_OMP_EXTENSIONS_RUNTIME_REASON || reason === NO_OMP_EXTENSIONS_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
      if (!terminal.has(current.status)) {
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpExtensionsValidationError ? "failed" : "outcome_unknown", {
          error: reason,
          result: error instanceof OmpExtensionsValidationError
            ? { errorCode: "omp_tool_catalog_invalid", reason }
            : error instanceof OmpCommandError
              ? { errorCode: "omp_refused", reason }
              : unavailableError
                ? json(result)
                : { errorCode: "request_failed" },
        });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      if (unavailableError) return result;
      if (error instanceof OmpExtensionsValidationError) throw new HostError("omp_tool_catalog_invalid", reason, 502);
      // An unknown extension id is a catalog absence, not a command failure: the durable
      // receipt keeps the runtime's refusal while the route answers the honest projection.
      if (error instanceof OmpCommandError) return result;
      throw error;
    }
  }

  #toolsExtensionSetCommandResult(command: Command): { readonly available: true } & OmpExtensionsData | { readonly available: false; readonly reason: string } {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpExtensionSetResult(stored); } catch { /* fall through to durable error */ }
      if (object(stored) && stored.available === false && typeof stored.reason === "string") return { available: false, reason: stored.reason };
    }
    return { available: false, reason: command.error ?? NO_OMP_EXTENSIONS_RUNTIME_REASON };
  }

  /** Re-run OMP's skill rediscovery through the durable owner-only command envelope. */
  async toolsRefreshSkills(sessionId: string, deviceId: string, request: OmpToolRefreshRequest): Promise<OmpToolActiveSetSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this tools command");
    let claim: ReturnType<DurableStore["claimCommand"]>;
    try {
      claim = this.store.claimCommand({
        sessionId,
        commandId: request.commandId,
        deviceId,
        incarnation: request.incarnation,
        kind: "cedia_tools_refresh_skills",
        payload: {},
      });
    } catch (error) {
      if (error instanceof DurableStoreCommandConflictError) throw new HostError("command_conflict", error.message, 409);
      throw error;
    }
    if (!claim.created) return this.#toolsActiveSetCommandResult(claim.command);

    const unavailable = (reason: string): OmpToolActiveSetSnapshot => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.toolCatalog) {
      const result = unavailable(NO_OMP_TOOL_CATALOG_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_TOOL_CATALOG_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.toolCatalog.refreshSkills();
      const result: OmpToolActiveSetSnapshot = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "tools.refresh-skills", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP skill refresh acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      const unavailableError = reason === NO_OMP_TOOL_CATALOG_RUNTIME_REASON || reason === NO_OMP_TOOL_CATALOG_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
      if (!terminal.has(current.status)) {
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpToolCatalogValidationError ? "failed" : "outcome_unknown", {
          error: reason,
          result: error instanceof OmpToolCatalogValidationError
            ? { errorCode: "omp_tool_catalog_invalid", reason }
            : error instanceof OmpCommandError
              ? { errorCode: "omp_refused", reason }
              : unavailableError
                ? json(result)
                : { errorCode: "request_failed" },
        });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      if (unavailableError) return result;
      if (error instanceof OmpToolCatalogValidationError) throw new HostError("omp_tool_catalog_invalid", reason, 502);
      if (error instanceof OmpCommandError) throw new HostError("omp_refused", reason, 409);
      throw error;
    }
  }

  #toolsActiveSetCommandResult(command: Command): OmpToolActiveSetSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpToolActiveSetSnapshot(stored); } catch { /* fall through to durable error */ }
      if (object(stored) && stored.available === false && typeof stored.reason === "string") return { available: false, reason: stored.reason };
    }
    return { available: false, reason: command.error ?? NO_OMP_TOOL_CATALOG_RUNTIME_REASON };
  }

  /** Read OMP's own memory backend shape without starting or probing a stopped runtime. */
  async memorySnapshot(sessionId: string): Promise<OmpMemorySnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.memory) return { state: "unavailable", reason: NO_OMP_MEMORY_RUNTIME_REASON };
    return runtime.memory.refresh();
  }

  /** Read provider usage only when the owner explicitly asks; this operation performs provider IO. */
  async usageSnapshot(sessionId: string): Promise<OmpUsageSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.usage) return { state: "unavailable", reason: NO_OMP_USAGE_RUNTIME_REASON };
    await runtime.usage.read();
    return runtime.usage.snapshot();
  }

  /** Read saved reset credits only when the owner asks; startup and activity never seed this cache. */
  async creditsSnapshot(sessionId: string): Promise<OmpCreditsSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.credits) return { state: "unavailable", reason: NO_OMP_CREDITS_RUNTIME_REASON };
    await runtime.credits.read();
    return runtime.credits.snapshot();
  }

  /**
   * Redeem one owner-confirmed saved reset through the durable command envelope. A repeated command
   * id returns the recorded outcome, so the scarce credit is never spent twice by replay.
   */
  async creditsRedeem(sessionId: string, deviceId: string, request: OmpCreditsCommandRequest): Promise<OmpCreditsRedeemSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this credits command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_credits_redeem",
      payload: request.target,
    });
    if (!claim.created) return this.#creditsRedeemCommandResult(claim.command);

    const unavailable = (reason: string): OmpCreditsRedeemSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_CREDITS_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_CREDITS_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      // Owner authentication and the UI's explicit confirmation are represented by the
      // `confirm: true` wire field inside OmpCredits.redeem before this runtime call.
      const outcome = await runtime.credits.redeem(runtime.client, request.target);
      if (outcome === undefined) throw new Error(NO_OMP_CREDITS_BRIDGE_REASON);
      // The redeem operation answers only OMP's outcome. Read the account rows it changed so the
      // POST receipt is a fresh projection and never asks the UI to infer a spent credit locally.
      await runtime.credits.read();
      const projected = runtime.credits.snapshot();
      const result: OmpCreditsRedeemSnapshot = { ...projected, lastRedeem: outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "credits.redeem", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP saved reset redeem acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_CREDITS_RUNTIME_REASON || reason === NO_OMP_CREDITS_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /** Read the runtime's current model, effort and service-tier projection. */
  async modelStateSnapshot(sessionId: string): Promise<OmpAvailable<OmpModelStateData>> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.modelState) return { available: false, reason: NO_OMP_MODEL_STATE_RUNTIME_REASON };
    return asAvailableAnswer(await runtime.modelState.model());
  }

  /** Read the current provider-owned OAuth account listing. */
  async accountsSnapshot(sessionId: string): Promise<OmpAvailable<OmpAccounts>> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.modelState) return { available: false, reason: NO_OMP_ACCOUNTS_RUNTIME_REASON };
    return asAvailableAnswer(await runtime.modelState.accounts());
  }

  /** Pin one provider account through the durable owner command envelope. */
  async accountsPin(sessionId: string, deviceId: string, request: OmpAccountPinCommandRequest): Promise<OmpAvailable<OmpAccountPinResult>> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this account command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_account_pin",
      payload: { credentialId: request.credentialId },
    });
    if (!claim.created) return this.#accountPinCommandResult(claim.command);

    const unavailable = (reason: string): OmpAvailable<OmpAccountPinResult> => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.modelState) {
      const result = unavailable(NO_OMP_ACCOUNTS_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_ACCOUNTS_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.modelState.pin(request.credentialId);
      if (outcome === undefined) {
        const result = unavailable(NO_OMP_ACCOUNTS_BRIDGE_REASON);
        const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_ACCOUNTS_BRIDGE_REASON, result: json(result) });
        this.#record(runtime, { type: "cedia_command", command: json(stored) });
        return result;
      }
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "auth.account.pin", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP provider account pin acknowledged", data: json(outcome) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      const malformed = error instanceof TypeError && error.name === "OmpModelStateValidationError";
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, error instanceof OmpCommandError || malformed ? "failed" : "outcome_unknown", {
        error: reason,
        ...(malformed ? { result: { available: false, reason, errorCode: "omp_invalid_response" } } : {}),
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      if (error instanceof OmpCommandError) throw new HostError("omp_refused", reason, 409);
      if (malformed) throw new HostError("omp_invalid_response", reason, 502);
      throw error;
    }
  }

  /** Set or clear one runtime-published service-tier override through the durable owner envelope. */
  async serviceTierSet(sessionId: string, deviceId: string, request: OmpServiceTierCommandRequest): Promise<OmpAvailable<OmpServiceTierResult>> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this service-tier command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_service_tier",
      payload: { family: request.family, tier: request.tier },
    });
    if (!claim.created) return this.#serviceTierCommandResult(claim.command);

    const unavailable = (reason: string): OmpAvailable<OmpServiceTierResult> => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.modelState) {
      const result = unavailable(NO_OMP_MODEL_STATE_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_MODEL_STATE_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.modelState.serviceTier(request.family, request.tier);
      if (outcome === undefined) {
        const result = unavailable(NO_OMP_MODEL_STATE_BRIDGE_REASON);
        const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_MODEL_STATE_BRIDGE_REASON, result: json(result) });
        this.#record(runtime, { type: "cedia_command", command: json(stored) });
        return result;
      }
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "model.service-tier.set", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP service-tier command acknowledged", data: json(outcome) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      const malformed = error instanceof TypeError && error.name === "OmpModelStateValidationError";
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, error instanceof OmpCommandError || malformed ? "failed" : "outcome_unknown", {
        error: reason,
        ...(malformed ? { result: { available: false, reason, errorCode: "omp_invalid_response" } } : {}),
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      if (error instanceof OmpCommandError) throw new HostError("omp_refused", reason, 409);
      if (malformed) throw new HostError("omp_invalid_response", reason, 502);
      throw error;
    }
  }

  /** Read the runtime-owned role-to-model mapping without starting a runtime. */
  async rolesSnapshot(sessionId: string): Promise<{ readonly available: true } & OmpModelRolesData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.modelState) return { available: false, reason: NO_OMP_MODEL_STATE_RUNTIME_REASON };
    return asAvailableAnswer(await runtime.modelState.roles());
  }

  /**
   * Activate one configured role's model through the durable owner envelope.
   * Replaying a command id returns the recorded post-switch answer without switching again.
   */
  /**
   * Assign (or, with a null model, clear) one role mapping through the durable
   * owner envelope. Replaying a command id returns the recorded roles table
   * without writing again. The answer is the roles table that follows, so a
   * window can read back exactly what the runtime now resolves.
   */
  async rolesSet(sessionId: string, deviceId: string, request: OmpRoleSetCommandRequest): Promise<OmpModelRolesData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this role command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_model_role_set",
      payload: { role: request.role, modelId: request.modelId },
    });
    if (!claim.created) return this.#roleSetCommandResult(claim.command);

    const unavailable = (reason: string): { readonly available: false; readonly reason: string } => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.modelState) {
      const result = unavailable(NO_OMP_MODEL_STATE_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_MODEL_STATE_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.modelState.setRole(request.role, request.modelId);
      if (outcome === undefined) {
        const result = unavailable(NO_OMP_MODEL_STATE_BRIDGE_REASON);
        const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_MODEL_STATE_BRIDGE_REASON, result: json(result) });
        this.#record(runtime, { type: "cedia_command", command: json(stored) });
        return result;
      }
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "model.roles.set", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP role assignment acknowledged", data: json(outcome) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_MODEL_STATE_RUNTIME_REASON || reason === NO_OMP_MODEL_STATE_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || (error instanceof TypeError && error.name === "OmpModelStateValidationError") ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #roleSetCommandResult(command: Command): OmpModelRolesData | { readonly available: false; readonly reason: string } {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpModelRoles(stored); } catch { /* fall through to the durable error */ }
    }
    return { available: false, reason: command.error ?? NO_OMP_MODEL_STATE_RUNTIME_REASON };
  }

  async rolesApply(sessionId: string, deviceId: string, request: OmpRoleApplyCommandRequest): Promise<OmpRoleApplyData | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this role command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_model_role_apply",
      payload: { role: request.role },
    });
    if (!claim.created) return this.#roleApplyCommandResult(claim.command);

    const unavailable = (reason: string): { readonly available: false; readonly reason: string } => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.modelState) {
      const result = unavailable(NO_OMP_MODEL_STATE_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_MODEL_STATE_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.modelState.applyRole(request.role);
      if (outcome === undefined) {
        const result = unavailable(NO_OMP_MODEL_STATE_BRIDGE_REASON);
        const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_MODEL_STATE_BRIDGE_REASON, result: json(result) });
        this.#record(runtime, { type: "cedia_command", command: json(stored) });
        return result;
      }
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "model.roles.apply", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP role apply acknowledged", data: json(outcome) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_MODEL_STATE_RUNTIME_REASON || reason === NO_OMP_MODEL_STATE_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || (error instanceof TypeError && error.name === "OmpModelStateValidationError") ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #roleApplyCommandResult(command: Command): OmpRoleApplyData | { readonly available: false; readonly reason: string } {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpRoleApplyCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { available: false, reason: command.error ?? NO_OMP_MODEL_STATE_RUNTIME_REASON };
  }

  /** Read one runtime-owned child transcript through its roster-selected session file. */
  async agentTranscript(sessionId: string, agentId: string, fromByte: number): Promise<OmpAgentTranscriptSnapshot> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.agents) return { state: "unavailable", reason: NO_OMP_AGENTS_RUNTIME_REASON };
    return runtime.agents.transcript(agentId, fromByte);
  }

  /** Read the advisor transcript from an already-running session. */
  async advisorHistory(sessionId: string, compact?: boolean): Promise<Awaited<ReturnType<OmpAdvisor["history"]>>> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.advisor) return { state: "unavailable", reason: NO_OMP_ADVISOR_RUNTIME_REASON };
    return runtime.advisor.history(compact);
  }

  /**
   * Dispatch one advisor switch through the durable command envelope used by task controls.
   * Replaying a command id returns the recorded post-change projection without a second runtime call.
   */
  async advisorCommand(sessionId: string, deviceId: string, request: OmpAdvisorCommandRequest): Promise<OmpAdvisorCommandResult> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this advisor command");
    const payload = { op: request.op, enabled: request.enabled };
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_advisor",
      payload,
    });
    if (!claim.created) return this.#advisorCommandResult(claim.command);

    const unavailable = (reason: string): OmpAdvisorCommandResult => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_ADVISOR_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_ADVISOR_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.advisor.set(request.enabled);
      const projected = runtime.advisor.snapshot();
      const result: OmpAdvisorCommandResult = projected.state === "available"
        ? projected
        : unavailable(projected.reason);
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "advisor.set", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP advisor command acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_ADVISOR_RUNTIME_REASON || reason === NO_OMP_ADVISOR_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /**
   * Dispatch one queue drop through the durable command envelope used by task controls.
   * Replaying a command id returns the recorded post-drop projection without a second runtime call.
   */
  async queueDrop(sessionId: string, deviceId: string, request: OmpQueueDropRequest): Promise<OmpQueueSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this queue command");
    const payload = { mode: request.mode };
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_queue_drop",
      payload,
    });
    if (!claim.created) return this.#queueDropCommandResult(claim.command);

    const unavailable = (reason: string): OmpQueueSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_QUEUE_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_QUEUE_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.queue.drop(request.mode);
      for (const turnIntentId of outcome.droppedIntentIds) {
        const intent = this.store.getTurnIntent(sessionId, turnIntentId);
        if (intent?.state === "queued") {
          this.#recordTurn(runtime, intent, "cancelled", {
            reason: "Owner removed this queued turn from the OMP queue. It did not start; its submission is available in the dropped result.",
          });
        }
      }
      this.#syncTurnQueue(runtime);
      const projected = runtime.queue.snapshot();
      const result: OmpQueueSnapshot = projected.state === "available"
        ? projected
        : unavailable(projected.reason);
      const publicOutcome = { steering: outcome.steering, followUp: outcome.followUp, dropped: outcome.dropped ?? [] };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "queue.drop", result: publicOutcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP queue drop acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_QUEUE_RUNTIME_REASON || reason === NO_OMP_QUEUE_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /**
   * Remove one queued row by text through OMP's own targeted primitive.
   *
   * Drop-last/all cannot name a middle row; `remove_queued_message` removes the
   * first text match, so the composer can offer per-row removal. The matching
   * queued turn intent, if any, settles cancelled like a drop; steer-sourced
   * rows have no intent to settle. Truncated (>4K) rows cannot be addressed and
   * answer removed:false instead of removing the wrong text.
   */
  async queueRemoveMessage(
    sessionId: string,
    deviceId: string,
    request: { commandId: string; incarnation: string; message: string; queue: "steering" | "followUp" },
  ): Promise<OmpQueueSnapshot & { removed: boolean }> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    if (!request.message) throw new HostError("invalid_body", "A queue removal names its message text", 400);
    if (request.queue !== "steering" && request.queue !== "followUp")
      throw new HostError("invalid_body", 'A queue removal names queue steering or followUp', 400);
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_queue_remove",
      payload: { message: request.message, queue: request.queue },
    });
    if (!claim.created) return this.#queueRowCommandResult(claim.command, "removed");
    const unavailable = (reason: string): OmpQueueSnapshot & { removed: boolean } => ({ state: "unavailable", reason, removed: false });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_QUEUE_RUNTIME_REASON);
      this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_QUEUE_RUNTIME_REASON, result: json(result) });
      return result;
    }
    try {
      const ack = await (runtime.client as OmpRpcClient).request("remove_queued_message", {
        message: request.message,
        queue: request.queue,
      });
      const removed = (ack.data as { removed?: unknown } | undefined)?.removed === true;
      if (removed) this.#settleQueuedMessageIntent(runtime, request.message);
      this.#syncTurnQueue(runtime);
      await runtime.queue.read();
      const projected = runtime.queue.snapshot();
      const result: OmpQueueSnapshot & { removed: boolean } =
        projected.state === "available" ? { ...projected, removed } : { ...projected, removed };
      this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json({ type: "response", command: "remove_queued_message", success: true, data: { removed } }),
        result: { meaning: "OMP queue removal acknowledged", data: json(projected), removed },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      this.store.transitionCommand(sessionId, request.commandId, "outcome_unknown", { error: reason, result: json(result) });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /**
   * Settle the queued turn intent that submitted this exact text, if any.
   *
   * OMP removes the first text match; Cedia settles the oldest queued intent
   * with the same submission text so no ghost stays waiting. At most one
   * intent settles per removal, matching the runtime's first-match rule.
   */
  #settleQueuedMessageIntent(runtime: Runtime, message: string): void {
    const sessionId = runtime.session.id;
    const open = this.store.listTurnIntents(sessionId).filter(intent => intent.state === "queued");
    for (const intent of open) {
      const command = this.store.getCommand(sessionId, intent.commandId);
      const submitted = (command?.payload as { message?: unknown } | undefined)?.message;
      if (typeof submitted !== "string" || submitted !== message) continue;
      this.store.transitionTurnIntent(sessionId, intent.turnIntentId, "cancelled", {
        reason: "Owner removed this queued turn from the OMP queue. It did not start.",
      });
      this.#recordTurn(runtime, intent, "cancelled", {
        reason: "Owner removed this queued turn from the OMP queue. It did not start.",
      });
      return;
    }
  }

  /**
   * Promote one follow-up row into steering through OMP's own primitive.
   *
   * Promotion moves the message to the steering queue where its turn runs, so
   * no intent settles here: the promoted turn proceeds instead of cancelling.
   */
  async queuePromoteMessage(
    sessionId: string,
    deviceId: string,
    request: { commandId: string; incarnation: string; message: string },
  ): Promise<OmpQueueSnapshot & { promoted: boolean }> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    if (!request.message) throw new HostError("invalid_body", "A queue promotion names its message text", 400);
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_queue_promote",
      payload: { message: request.message },
    });
    if (!claim.created) return this.#queueRowCommandResult(claim.command, "promoted");
    const unavailable = (reason: string): OmpQueueSnapshot & { promoted: boolean } => ({ state: "unavailable", reason, promoted: false });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_QUEUE_RUNTIME_REASON);
      this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_QUEUE_RUNTIME_REASON, result: json(result) });
      return result;
    }
    try {
      const ack = await (runtime.client as OmpRpcClient).request("promote_queued_message", { message: request.message });
      const promoted = (ack.data as { promoted?: unknown } | undefined)?.promoted === true;
      this.#syncTurnQueue(runtime);
      await runtime.queue.read();
      const projected = runtime.queue.snapshot();
      const result: OmpQueueSnapshot & { promoted: boolean } =
        projected.state === "available" ? { ...projected, promoted } : { ...projected, promoted };
      this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json({ type: "response", command: "promote_queued_message", success: true, data: { promoted } }),
        result: { meaning: "OMP queue promotion acknowledged", data: json(projected), promoted },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      this.store.transitionCommand(sessionId, request.commandId, "outcome_unknown", { error: reason, result: json(result) });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /**
   * Replay a per-row queue command from its receipt: the stored snapshot plus
   * the outcome flag kept beside it (the snapshot alone cannot say what a
   * removal removed). Unparseable receipts stay unavailable, never invented.
   */
  #queueRowCommandResult(command: Command, flag: "removed" | "promoted"): OmpQueueSnapshot & { removed: boolean; promoted: boolean } {
    const base = { removed: false, promoted: false };
    const result = object(command.result) ? (command.result as Record<string, unknown>) : undefined;
    const data = result !== undefined && object(result.data) ? result.data : undefined;
    if (data === undefined) return { state: "unavailable", reason: command.error ?? NO_OMP_QUEUE_RUNTIME_REASON, ...base };
    try {
      const snapshot = parseOmpQueueCommandResult(data);
      const outcome = result?.[flag] === true;
      return snapshot.state === "available"
        ? { ...snapshot, ...base, [flag]: outcome }
        : { ...snapshot, ...base };
    } catch {
      return { state: "unavailable", reason: command.error ?? NO_OMP_QUEUE_RUNTIME_REASON, ...base };
    }
  }

  #queueDropCommandResult(command: Command): OmpQueueSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpQueueCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_QUEUE_RUNTIME_REASON };
  }

  /**
   * Engage or release the run-pause gate through the durable command envelope used by task
   * controls. Replaying a command id returns the recorded post-write projection without
   * touching the gate a second time; pausing while paused answers the state, not an error.
   */
  async pauseCommand(sessionId: string, deviceId: string, request: OmpPauseCommandRequest): Promise<OmpPauseSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this pause command");
    const payload = { paused: request.paused };
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_pause_set",
      payload,
    });
    if (!claim.created) return this.#pauseCommandResult(claim.command);

    const unavailable = (reason: string): OmpPauseSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_PAUSE_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_PAUSE_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.pause.set(request.paused);
      const projected = runtime.pause.snapshot();
      const result: OmpPauseSnapshot = projected.state === "available"
        ? projected
        : unavailable(projected.reason);
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "pause.set", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP run pause acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_PAUSE_RUNTIME_REASON || reason === NO_OMP_PAUSE_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #pauseCommandResult(command: Command): OmpPauseSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpPauseCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_PAUSE_RUNTIME_REASON };
  }

  /**
   * Run one shell command through the session's own foreground bash, inside the durable
   * command envelope used by task controls. Replaying a command id returns the recorded
   * outcome without running the command a second time. Output enters the agent's context
   * exactly as the terminal's bash mode leaves it; Cedia adds no second routing.
   */
  async bashExec(sessionId: string, deviceId: string, request: OmpBashExecRequest): Promise<OmpBashSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this shell command");
    if (typeof request.command !== "string" || request.command.trim().length === 0) throw new HostError("invalid_body", "Shell command must be a non-empty string");
    if (request.command.length > MAX_BASH_COMMAND_CHARS) throw new HostError("invalid_body", `Shell command exceeds ${MAX_BASH_COMMAND_CHARS} characters`);
    const payload = { command: request.command };
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_bash_exec",
      payload,
    });
    if (!claim.created) return this.#bashCommandResult(claim.command);

    const unavailable = (reason: string): OmpBashSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_BASH_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_BASH_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await execOmpBash(runtime.client, request.command);
      const result: OmpBashSnapshot = { state: "available", revision: 1, ...outcome };
      const ack = { type: "response", command: "bash", success: true, data: outcome };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP shell execution acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_BASH_RUNTIME_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #bashCommandResult(command: Command): OmpBashSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpBashCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_BASH_RUNTIME_REASON };
  }

  /**
   * Ask the session to cancel running bash commands, inside the durable command envelope.
   * The answer confirms delivery: running commands are cancelled (an in-flight exec answers
   * with cancelled), and with nothing running the call is still accepted.
   */
  async bashAbort(sessionId: string, deviceId: string, request: OmpBashAbortRequest): Promise<OmpBashAbortSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this shell abort");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_bash_abort",
      payload: {},
    });
    if (!claim.created) return this.#bashAbortCommandResult(claim.command);

    const unavailable = (reason: string): OmpBashAbortSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_BASH_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_BASH_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await abortOmpBash(runtime.client);
      const result: OmpBashAbortSnapshot = { state: "available", revision: 1, ...outcome };
      const ack = { type: "response", command: "abort_bash", success: true, data: outcome };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP shell abort acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_BASH_RUNTIME_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #bashAbortCommandResult(command: Command): OmpBashAbortSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpBashAbortCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_BASH_RUNTIME_REASON };
  }

  /**
   * Run code through the session's shared kernel, inside the durable command envelope used by
   * task controls. Replaying a command id returns the recorded outcome without running the
   * code a second time.
   */
  async pythonExec(sessionId: string, deviceId: string, request: OmpPythonExecRequest): Promise<OmpPythonSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this Python code");
    if (typeof request.code !== "string" || request.code.trim().length === 0) throw new HostError("invalid_body", "Python code must be a non-empty string");
    if (request.code.length > MAX_PYTHON_CODE_CHARS) throw new HostError("invalid_body", `Python code exceeds ${MAX_PYTHON_CODE_CHARS} characters`);
    const payload = { code: request.code };
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_python_exec",
      payload,
    });
    if (!claim.created) return this.#pythonCommandResult(claim.command);

    const unavailable = (reason: string): OmpPythonSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_PYTHON_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_PYTHON_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.python.exec(request.code);
      const projected = runtime.python.snapshot();
      const result: OmpPythonSnapshot = projected.state === "available"
        ? projected
        : unavailable(projected.reason);
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "python.exec", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP Python execution acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_PYTHON_RUNTIME_REASON || reason === NO_OMP_PYTHON_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #pythonCommandResult(command: Command): OmpPythonSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpPythonCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_PYTHON_RUNTIME_REASON };
  }

  /**
   * Ask the session to cancel running Python execution, inside the durable command envelope.
   * The answer confirms delivery: a running execution answers with cancelled, and with
   * nothing running the call is still accepted.
   */
  async pythonAbort(sessionId: string, deviceId: string, request: OmpPythonAbortRequest): Promise<OmpPythonAbortSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this Python abort");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_python_abort",
      payload: {},
    });
    if (!claim.created) return this.#pythonAbortCommandResult(claim.command);

    const unavailable = (reason: string): OmpPythonAbortSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_PYTHON_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_PYTHON_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.python.abort();
      const result: OmpPythonAbortSnapshot = { state: "available", revision: 1, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "python.abort", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP Python abort acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_PYTHON_RUNTIME_REASON || reason === NO_OMP_PYTHON_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #pythonAbortCommandResult(command: Command): OmpPythonAbortSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpPythonAbortCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_PYTHON_RUNTIME_REASON };
  }

  /**
   * Dispatch one context image drop through the durable command envelope used by task controls.
   * Replaying a command id returns the recorded post-drop projection without a second runtime call.
   */
  async contextDropImages(sessionId: string, deviceId: string, request: OmpContextCommandRequest): Promise<OmpContextSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this context command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_context_drop_images",
      payload: {},
    });
    if (!claim.created) return this.#contextCommandResult(claim.command);

    const unavailable = (reason: string): OmpContextSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_CONTEXT_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_CONTEXT_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.context.dropImages();
      const projected = runtime.context.snapshot();
      const result: OmpContextSnapshot = projected.state === "available"
        ? projected
        : unavailable(projected.reason);
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "context.drop-images", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP context image drop acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_CONTEXT_RUNTIME_REASON || reason === NO_OMP_CONTEXT_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /** Dispatch one context compaction-abort request through the durable command envelope. */
  async contextAbortCompaction(sessionId: string, deviceId: string, request: OmpContextCommandRequest): Promise<OmpContextSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this context command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_context_abort_compaction",
      payload: {},
    });
    if (!claim.created) return this.#contextCommandResult(claim.command);

    const unavailable = (reason: string): OmpContextSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_CONTEXT_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_CONTEXT_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.context.abortCompaction();
      const projected = runtime.context.snapshot();
      const result: OmpContextSnapshot = projected.state === "available"
        ? projected
        : unavailable(projected.reason);
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "context.abort-compaction", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP context compaction abort acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_CONTEXT_RUNTIME_REASON || reason === NO_OMP_CONTEXT_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /** Dispatch one context shake through the durable command envelope used by task controls. */
  async contextShake(sessionId: string, deviceId: string, request: OmpContextShakeRequest): Promise<OmpContextShakeSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this context command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_context_shake",
      payload: { mode: request.mode },
    });
    if (!claim.created) return this.#contextShakeCommandResult(claim.command);

    const unavailable = (reason: string): OmpContextShakeSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_CONTEXT_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_CONTEXT_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.context.shake(request.mode);
      const projected = runtime.context.snapshot();
      const result: OmpContextShakeSnapshot = projected.state === "available" && projected.shake !== undefined
        ? { ...projected, shake: projected.shake }
        : unavailable(projected.state === "unavailable" ? projected.reason : "OMP context shake result did not include shake");
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "context.shake", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP context shake acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_CONTEXT_RUNTIME_REASON || reason === NO_OMP_CONTEXT_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /**
   * Dispatch one memory backend apply through the durable command envelope used by task controls.
   * Replaying a command id returns the recorded post-apply projection without a second runtime call.
   */
  async memoryApply(sessionId: string, deviceId: string, request: OmpMemoryCommandRequest): Promise<OmpMemorySnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this memory command");
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_memory_apply",
      payload: {},
    });
    if (!claim.created) return this.#memoryCommandResult(claim.command);

    const unavailable = (reason: string): OmpMemorySnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_MEMORY_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_MEMORY_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.memory.apply();
      const projected = runtime.memory.snapshot();
      const result: OmpMemorySnapshot = projected.state === "available"
        ? projected
        : unavailable(projected.reason);
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "memory.apply", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP memory backend apply acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_MEMORY_RUNTIME_REASON || reason === NO_OMP_MEMORY_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /** Dispatch context.reset through the durable owner command envelope. */
  async historyClear(sessionId: string, deviceId: string, request: OmpHistoryCommandRequest): Promise<OmpHistoryResetResult | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this history command");
    const claim = this.store.claimCommand({ sessionId, commandId: request.commandId, deviceId, incarnation: request.incarnation, kind: "cedia_history_clear", payload: {} });
    if (!claim.created) return this.#historyClearCommandResult(claim.command);

    const unavailable = (reason: string) => ({ available: false as const, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_HISTORY_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_HISTORY_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.history.reset();
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "context.reset", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", { ack: json(ack), result: { meaning: "OMP history context reset acknowledged", data: json(outcome) } });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_HISTORY_RUNTIME_REASON || reason === NO_OMP_HISTORY_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /** Dispatch session.fresh through the durable owner command envelope. */
  async historyFresh(sessionId: string, deviceId: string, request: OmpHistoryCommandRequest): Promise<OmpHistoryFreshResult | { readonly available: false; readonly reason: string }> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this history command");
    const claim = this.store.claimCommand({ sessionId, commandId: request.commandId, deviceId, incarnation: request.incarnation, kind: "cedia_history_fresh", payload: {} });
    if (!claim.created) return this.#historyFreshCommandResult(claim.command);

    const unavailable = (reason: string) => ({ available: false as const, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_HISTORY_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_HISTORY_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.history.fresh();
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "session.fresh", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", { ack: json(ack), result: { meaning: "OMP history fresh session acknowledged", data: json(outcome) } });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_HISTORY_RUNTIME_REASON || reason === NO_OMP_HISTORY_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  /** Navigate OMP's session tree through the durable controller-visible command envelope. */
  async treeNavigate(sessionId: string, deviceId: string, request: OmpTreeNavigateRequest): Promise<OmpTreeNavigateSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this tree command");
    const payload = {
      entryId: request.entryId,
      ...(request.summarize === undefined ? {} : { summarize: request.summarize }),
    };
    let claim: ReturnType<DurableStore["claimCommand"]>;
    try {
      claim = this.store.claimCommand({
        sessionId,
        commandId: request.commandId,
        deviceId,
        incarnation: request.incarnation,
        kind: "cedia_tree_navigate",
        payload,
      });
    } catch (error) {
      if (error instanceof DurableStoreCommandConflictError) throw new HostError("command_conflict", error.message, 409);
      throw error;
    }
    if (!claim.created) return this.#treeNavigateCommandResult(claim.command);

    const unavailable = (reason: string): OmpTreeNavigateSnapshot => ({ available: false, reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready" || !runtime.tree) {
      const result = unavailable(NO_OMP_TREE_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_TREE_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.tree.navigate(request.entryId, request.summarize);
      const result: OmpTreeNavigateSnapshot = { available: true, ...outcome };
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "tree.navigate", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP session-tree navigation acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      const unavailableError = reason === NO_OMP_TREE_RUNTIME_REASON || reason === NO_OMP_TREE_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
      if (!terminal.has(current.status)) {
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError || error instanceof OmpTreeValidationError ? "failed" : "outcome_unknown", {
          error: reason,
          result: error instanceof OmpTreeValidationError
            ? { errorCode: "omp_tree_invalid", reason }
            : error instanceof OmpCommandError
              ? { errorCode: "omp_refused", reason }
              : unavailableError
                ? json(result)
                : { errorCode: "request_failed" },
        });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      if (unavailableError) return result;
      if (error instanceof OmpTreeValidationError) throw new HostError("omp_tree_invalid", reason, 502);
      if (error instanceof OmpCommandError) throw new HostError("omp_refused", reason, 409);
      throw error;
    }
  }

  #historyClearCommandResult(command: Command): OmpHistoryResetResult | { readonly available: false; readonly reason: string } {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpHistoryResetResult(stored); } catch { /* fall through to durable error */ }
      if (object(stored) && stored.available === false && typeof stored.reason === "string") return { available: false, reason: stored.reason };
    }
    return { available: false, reason: command.error ?? NO_OMP_HISTORY_RUNTIME_REASON };
  }

  #historyFreshCommandResult(command: Command): OmpHistoryFreshResult | { readonly available: false; readonly reason: string } {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpHistoryFreshResult(stored); } catch { /* fall through to durable error */ }
      if (object(stored) && stored.available === false && typeof stored.reason === "string") return { available: false, reason: stored.reason };
    }
    return { available: false, reason: command.error ?? NO_OMP_HISTORY_RUNTIME_REASON };
  }

  #treeNavigateCommandResult(command: Command): OmpTreeNavigateSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      if (object(stored) && stored.errorCode === "omp_tree_invalid" && typeof stored.reason === "string") throw new HostError("omp_tree_invalid", stored.reason, 502);
      if (object(stored) && stored.errorCode === "omp_refused" && typeof stored.reason === "string") throw new HostError("omp_refused", stored.reason, 409);
      if (object(stored) && stored.errorCode === "request_failed") throw new HostError("request_failed", "The host could not complete this request", 400);
      try { return parseOmpTreeNavigateSnapshot(stored); } catch { /* fall through to durable error */ }
    }
    if (command.status === "outcome_unknown") throw new HostError("request_failed", "The host could not complete this request", 400);
    return { available: false, reason: command.error ?? NO_OMP_TREE_RUNTIME_REASON };
  }

  #memoryCommandResult(command: Command): OmpMemorySnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpMemoryCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_MEMORY_RUNTIME_REASON };
  }

  #creditsRedeemCommandResult(command: Command): OmpCreditsRedeemSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpCreditsRedeemCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_CREDITS_RUNTIME_REASON };
  }

  #accountPinCommandResult(command: Command): OmpAvailable<OmpAccountPinResult> {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpAccountPinCommandResult(stored); } catch {
        if (object(stored) && stored.available === false && typeof stored.reason === "string") {
          if (stored.errorCode === "omp_invalid_response") throw new HostError("omp_invalid_response", stored.reason, 502);
          return { available: false, reason: stored.reason };
        }
      }
    }
    if (command.status === "failed") throw new HostError("omp_refused", command.error ?? "The OMP runtime refused this account command", 409);
    return { available: false, reason: command.error ?? NO_OMP_ACCOUNTS_RUNTIME_REASON };
  }

  #serviceTierCommandResult(command: Command): OmpAvailable<OmpServiceTierResult> {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpServiceTierCommandResult(stored); } catch {
        if (object(stored) && stored.available === false && typeof stored.reason === "string") {
          if (stored.errorCode === "omp_invalid_response") throw new HostError("omp_invalid_response", stored.reason, 502);
          return { available: false, reason: stored.reason };
        }
      }
    }
    if (command.status === "failed") throw new HostError("omp_refused", command.error ?? "The OMP runtime refused this service-tier command", 409);
    return { available: false, reason: command.error ?? NO_OMP_MODEL_STATE_RUNTIME_REASON };
  }

  #contextCommandResult(command: Command): OmpContextSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpContextCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_CONTEXT_RUNTIME_REASON };
  }

  #contextShakeCommandResult(command: Command): OmpContextShakeSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpContextShakeCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_CONTEXT_RUNTIME_REASON };
  }

  /**
   * Validate, write and apply one scope's advisor config through the durable command envelope
   * used by task controls. Replaying a command id returns the recorded receipt without
   * rewriting the file or re-applying the roster.
   */
  async advisorConfigCommand(sessionId: string, deviceId: string, request: OmpAdvisorConfigWriteRequest): Promise<OmpAdvisorConfigSnapshot> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this advisor config command");
    const payload = { scope: request.scope, text: request.text };
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_advisor_config_set",
      payload,
    });
    if (!claim.created) return this.#advisorConfigCommandResult(claim.command);

    const unavailable = (reason: string): OmpAdvisorConfigSnapshot => ({ state: "unavailable", reason });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.advisorConfig.write(request.scope, request.text);
      const projected = runtime.advisorConfig.snapshot();
      const result: OmpAdvisorConfigSnapshot = projected.state === "available"
        ? projected
        : unavailable(projected.reason);
      const ack = { type: "response", command: "cedia_control", success: true, data: { operation: "advisor.config.set", result: outcome } };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP advisor config acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON || reason === NO_OMP_ADVISOR_CONFIG_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #advisorConfigCommandResult(command: Command): OmpAdvisorConfigSnapshot {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpAdvisorConfigCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON };
  }

  #advisorCommandResult(command: Command): OmpAdvisorCommandResult {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpAdvisorCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_ADVISOR_RUNTIME_REASON };
  }

  /**
   * Dispatch one native plan operation through the durable command envelope used by task
   * controls. The returned projection is persisted with the command, so replaying a command id
   * returns the original runtime outcome without asking OMP to perform a second mode change.
   */
  async planCommand(sessionId: string, deviceId: string, request: OmpPlanCommandRequest): Promise<OmpPlanCommandResult> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this plan command");
    const command: Record<string, unknown> = { op: request.op };
    if (request.op === "enter") {
      if (request.workflow !== undefined) command.workflow = request.workflow;
      if (request.planFilePath !== undefined) command.planFilePath = request.planFilePath;
    } else if (request.op === "exit") {
      if (request.paused !== undefined) command.paused = request.paused;
      if (request.confirm !== undefined) command.confirm = request.confirm;
    } else if (request.op === "review.decide") {
      command.reviewId = request.reviewId;
      command.decision = request.decision;
      if (request.preserveContext !== undefined) command.preserveContext = request.preserveContext;
      if (request.compactBeforeExecute !== undefined) command.compactBeforeExecute = request.compactBeforeExecute;
      if (request.feedback !== undefined) command.feedback = request.feedback;
    }
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_plan",
      payload: json(command),
    });
    if (!claim.created) return this.#planCommandResult(claim.command);

    const unavailable = (reason: string): OmpPlanCommandResult => ({ state: "unavailable", reason, changed: false });
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const result = unavailable(NO_OMP_PLAN_RUNTIME_REASON);
      const stored = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_PLAN_RUNTIME_REASON, result: json(result) });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(stored) });
      return result;
    }
    try {
      const outcome = await runtime.plan.apply(command as CediaPlanCommand);
      const projected = runtime.plan.snapshot();
      const result: OmpPlanCommandResult = projected.state === "available"
        ? { ...projected, changed: outcome.changed, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }) }
        : unavailable(outcome.reason ?? NO_OMP_PLAN_RUNTIME_REASON);
      const ack = { type: "response", command: "cedia_plan", success: true, data: outcome };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP plan command acknowledged", data: json(result) },
      });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = unavailable(reason);
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailableError = reason === NO_OMP_PLAN_RUNTIME_REASON || reason === NO_OMP_PLAN_BRIDGE_REASON || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched");
        this.store.transitionCommand(sessionId, request.commandId, unavailableError ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown", { error: reason, result: json(result) });
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(sessionId, request.commandId)) });
      return result;
    }
  }

  #planCommandResult(command: Command): OmpPlanCommandResult {
    const stored = object(command.result) && object((command.result as Record<string, unknown>).data) ? (command.result as Record<string, unknown>).data : command.result;
    if (stored !== undefined) {
      try { return parseOmpPlanCommandResult(stored); } catch { /* fall through to the durable error */ }
    }
    return { state: "unavailable", reason: command.error ?? NO_OMP_PLAN_RUNTIME_REASON, changed: false };
  }

  /**
   * Dispatch one goal operation through the same durable command envelope as other task controls.
   * The command row is claimed before OMP is called, so a repeated command id returns the original
   * outcome and never performs a second goal mutation.
   */
  async goalCommand(sessionId: string, deviceId: string, request: OmpGoalCommandRequest): Promise<Command> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this goal command");
    const payload = {
      op: request.op,
      ...(request.objective === undefined ? {} : { objective: request.objective }),
      ...(request.tokenBudget === undefined ? {} : { tokenBudget: request.tokenBudget }),
    };
    const claim = this.store.claimCommand({
      sessionId,
      commandId: request.commandId,
      deviceId,
      incarnation: request.incarnation,
      kind: "cedia_goal",
      payload,
    });
    if (!claim.created) return claim.command;
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      const command = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: NO_OMP_GOAL_RUNTIME_REASON });
      if (runtime) this.#record(runtime, { type: "cedia_command", command: json(command) });
      return command;
    }
    try {
      const snapshot = await runtime.goal.apply(payload);
      const ack = { type: "response", command: "cedia_goal", success: true, data: snapshot };
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) this.store.transitionCommand(sessionId, request.commandId, "completed", {
        ack: json(ack),
        result: { meaning: "OMP command acknowledged", data: json(snapshot) },
      });
    } catch (error) {
      const current = this.store.getCommand(sessionId, request.commandId)!;
      if (!terminal.has(current.status)) {
        const unavailable = error instanceof Error && (error.message === NO_OMP_GOAL_RUNTIME_REASON || error.message === NO_OMP_GOAL_BRIDGE_REASON);
        const status = unavailable || (error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched") ? "not_dispatched" : error instanceof OmpCommandError ? "failed" : "outcome_unknown";
        // OMP's refusal is user-facing state. Preserve its message verbatim instead of wrapping
        // it in a host diagnosis or claiming the operation changed the goal.
        const message = error instanceof OmpCommandError ? error.message : errorText(error);
        this.store.transitionCommand(sessionId, request.commandId, status, { error: message });
      }
    }
    const result = this.store.getCommand(sessionId, request.commandId)!;
    this.#record(runtime, { type: "cedia_command", command: json(result) });
    return result;
  }

	/** Apply a model/effort change at once, for a runtime with no pending-change boundary. */
	async #applyModelChangeImmediately(runtime: Runtime, request: { provider?: string; modelId?: string; thinkingLevel?: string | null }): Promise<void> {
		const client = runtime.client;
		if (!client) throw new HostError("session_not_started", "Start the OMP session before changing its model", 409);
		if (request.provider !== undefined && request.modelId !== undefined) {
			await client.request("set_model", { provider: request.provider, modelId: request.modelId });
		}
		if (request.thinkingLevel !== undefined && request.thinkingLevel !== null) {
			await client.request("set_thinking_level", { level: request.thinkingLevel });
		}
	}

	/**
	 * Continue an archived task: put its workspace back and re-open it (§2.6).
	 *
	 * A retained worktree that is still on disk is simply resumed where it is. When the
	 * worktree is gone, the archived revision is checked out again into a managed worktree -
	 * the preserved branch is reattached only if it still points at that revision and no
	 * worktree holds it, so a restore never moves a branch someone else may be using. Every
	 * uncertain condition refuses with an actionable reason and leaves the task archived:
	 * restoring never overwrites what it found, and a moving branch is not proof of anything.
	 */
	restoreSession(id: string): SessionView {
		this.#assertOpen();
		const session = this.#session(id);
		if (session.status === "running") {
			throw new HostError("task_running", "Stop the task before restoring it, or wait for its turn to finish.", 409);
		}
		const receipt = this.#readArchiveReceipt(id);
		// A task the host never archived - or one already restored - has nothing to put back,
		// so re-opening it is the whole operation.
		if (receipt === undefined) {
			const restored = this.store.updateSession(id, { archived: false });
			this.#writeOwnerLaunchContext(restored);
			return this.sessionView(restored);
		}
		if (receipt.state === "restored") {
			const metadata = this.store.getSessionWorkspaceMetadata(id);
			if (metadata?.cleanupState === "removed") this.store.updateSessionWorkspaceMetadata(id, { cleanupState: "retained", lastFailure: null });
			const restored = this.store.updateSession(id, { archived: false });
			this.#writeOwnerLaunchContext(restored);
			return this.sessionView(restored);
		}
		const directory = join(this.#options.stateDir, "sessions", id);
		const identity = this.#readWorkspaceIdentity(id);
		let cwd = session.cwd;
		let restored: SessionRestoration | undefined;
		if (receipt.worktree !== undefined) {
			const live = probeGit(receipt.worktree, ["rev-parse", "--show-toplevel"]);
			if (existsSync(receipt.worktree) && live === receipt.worktree) {
				// The retained worktree is still there, so the task resumes exactly where it stopped.
				cwd = receipt.worktree;
				restored = {
					at: new Date().toISOString(),
					worktree: receipt.worktree,
					branch: receipt.branch ?? probeGit(receipt.worktree, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "",
					reattached: true,
					reason: "The retained worktree is still on disk, so the task continues in it.",
				};
			} else if (existsSync(receipt.worktree)) {
				throw new HostError("restore_unavailable", `Something else is at ${receipt.worktree}. Move it aside to restore this task; Cedia does not overwrite it.`, 409);
			} else {
				// The worktree folder is gone, so the archived revision has to be checked out again.
				const root = identity === undefined ? undefined : probeGit(identity.root, ["rev-parse", "--show-toplevel"]);
				if (root === undefined) {
					throw new HostError("restore_unavailable", "The repository this task was archived from is not available, so its workspace cannot be restored. Open the project folder again, then retry.", 409);
				}
				if (receipt.commit === undefined) {
					throw new HostError("restore_unavailable", "This archive recorded no revision to restore. Continue the task by hand instead of restoring this workspace.", 409);
				}
				// A deleted worktree folder leaves a stale registration behind, which would both
				// block the path and keep the branch looking checked out. Pruning only ever drops
				// registrations whose folder is already gone.
				probeGit(root, ["worktree", "prune"]);
				const plan = planRestoration({
					taskId: id,
					...(receipt.branch === undefined ? {} : { recordedBranch: receipt.branch }),
					archivedCommit: receipt.commit,
					...(receipt.branch === undefined ? {} : { recordedBranchCommit: probeGit(root, ["rev-parse", "--verify", `refs/heads/${receipt.branch}`]) }),
					recordedBranchCheckedOut: receipt.branch !== undefined && this.#worktreeHolding(root, receipt.branch) !== undefined,
					existingBranches: probeGit(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])?.split("\n").filter(Boolean) ?? [],
				});
				restoreWorktree(root, receipt.worktree, plan.branch, receipt.commit, { reattach: plan.reattached });
				cwd = receipt.worktree;
				restored = { at: new Date().toISOString(), worktree: receipt.worktree, branch: plan.branch, reattached: plan.reattached, reason: plan.reason };
			}
		}
		if (restored !== undefined) {
			this.#writeArchiveReceipt(directory, { ...receipt, state: "restored", restored });
			this.store.updateSessionWorkspaceMetadata(id, {
				actualCwd: cwd,
				worktreeRoot: restored.worktree,
				taskBranch: restored.branch,
				cleanupState: "retained",
				lastFailure: null,
			});
		}
		const restoredSession = this.store.updateSession(id, { archived: false, cwd });
		this.#writeOwnerLaunchContext(restoredSession);
		return this.sessionView(restoredSession);
	}

  /**
   * Return the durable host projection plus the sidechat relationship marker.
   * The transcript itself remains in OMP's session file; `sidechat.json` only
   * records the relationship needed to render and re-open the split pane.
   */
  sessionView(session: Session): SessionView {
    const workspace = this.#readWorkspaceIdentity(session.id);
    const archive = this.#readArchiveReceipt(session.id);
    const pendingModel = this.#readPendingModel(session.id);
    const metadata = session.workspaceMetadata;
    const projectedWorkspace: SessionWorkspace | undefined = workspace === undefined && metadata === undefined
      ? undefined
      : {
          ...(workspace ?? { mode: metadata?.worktreeRoot === undefined ? "local" : "worktree", isGit: metadata?.repositoryId !== undefined, cwd: metadata?.actualCwd ?? session.cwd, root: metadata?.worktreeRoot ?? metadata?.repositoryId ?? session.cwd }),
          ...(metadata === undefined ? {} : {
            taskId: metadata.taskId,
            projectId: metadata.projectId,
            ...(metadata.repositoryId === undefined ? {} : { repositoryId: metadata.repositoryId }),
            ...(metadata.worktreeRoot === undefined ? {} : { worktreeRoot: metadata.worktreeRoot }),
            actualCwd: metadata.actualCwd,
            ...(metadata.sourceCommit === undefined ? {} : { sourceCommit: metadata.sourceCommit }),
            ...(metadata.taskBranch === undefined ? {} : { taskBranch: metadata.taskBranch }),
            ...(metadata.integrationTargetRef === undefined ? {} : { integrationTargetRef: metadata.integrationTargetRef }),
            ...(metadata.integrationTargetCommit === undefined ? {} : { integrationTargetCommit: metadata.integrationTargetCommit }),
            ...(metadata.integrationObservedCommit === undefined ? {} : { integrationObservedCommit: metadata.integrationObservedCommit }),
            ...(metadata.restorationRef === undefined ? {} : { restorationRef: metadata.restorationRef }),
            ...(metadata.restorationSha === undefined ? {} : { restorationSha: metadata.restorationSha }),
            cleanupGeneration: metadata.cleanupGeneration,
            cleanupState: metadata.cleanupState,
            ...(metadata.lastFailure === undefined ? {} : { lastFailure: metadata.lastFailure }),
          }),
        };
    return {
      ...session,
      sidechatSourceThreadId: this.#readSidechatMetadata(session.id)?.sourceThreadId ?? null,
      ...(projectedWorkspace === undefined ? {} : { workspace: projectedWorkspace }),
      ...(archive === undefined ? {} : { archive }),
      turns: this.#turnProjection(session.id),
      ...(pendingModel === undefined ? {} : { pendingModel }),
    };
  }

  /**
   * The bounded turn projection a session row carries (§2.4).
   *
   * Deliberately small and oldest-first: clients render what Cedia knows about the
   * submissions it accepted, and the conversation itself is still read from OMP.
   */
  #turnProjection(sessionId: string): TurnIntent[] {
    return this.store.listTurnIntents(sessionId, TURN_PROJECTION_LIMIT).reverse();
  }

  /** The intent a turn boundary frame belongs to: the named command's, else the oldest open. */
  #boundTurn(runtime: Runtime, commandId: string | undefined): TurnIntent | undefined {
    const sessionId = runtime.session.id;
    if (commandId !== undefined) {
      const direct = this.store.getTurnIntentByCommand(sessionId, commandId);
      if (direct !== undefined) return direct;
    }
    if (runtime.activeCommand !== undefined) {
      const active = this.store.getTurnIntentByCommand(sessionId, runtime.activeCommand);
      if (active !== undefined) return active;
    }
    return this.store.listOpenTurnIntents(sessionId)[0];
  }

  /**
   * The intent a frame names, when the runtime echoed the identity Cedia gave the submission
   * (§2.4). A runtime that does not advertise the turn bridge never produces one, so this stays
   * `undefined` and the caller falls back to Cedia's own acceptance order.
   */
  #namedTurn(runtime: Runtime, frame: OmpFrame): TurnIntent | undefined {
    const named = typeof frame.cediaIntentId === "string" ? frame.cediaIntentId : undefined;
    return named === undefined ? undefined : this.store.getTurnIntent(runtime.session.id, named);
  }

  /**
   * Ask the runtime what it has queued and record it, so a queued submission carries OMP's own
   * order rather than Cedia's guess at it. Only a runtime that advertises the turn bridge can
   * answer; anywhere else the projection keeps saying that OMP reported nothing.
   */
  #syncTurnQueue(runtime: Runtime): void {
    const client = runtime.client;
    if (!client || runtime.closing || !client.turnBridgeAdvertised()) return;
    void client.requestCedia("cedia_turn_queue", {}).then(ack => {
      if (runtime.closing) return;
      const data = object(ack.data) ? ack.data : undefined;
      if (data === undefined) return;
      const currentEntry = object(data.current) ? data.current : undefined;
      const current = currentEntry !== undefined && typeof currentEntry.intentId === "string" ? currentEntry.intentId : undefined;
      // The model the runtime reports for the running turn is the one it is actually using for
      // it; a requested-but-unaccepted change is never presented as this turn's model.
      const running = currentEntry !== undefined && object(currentEntry.model) && typeof currentEntry.model.provider === "string" && typeof currentEntry.model.id === "string"
        ? { model: `${currentEntry.model.provider}/${currentEntry.model.id}`, ...(typeof currentEntry.thinkingLevel === "string" ? { thinkingLevel: currentEntry.thinkingLevel } : {}) }
        : undefined;
      // A pending model/effort change stops being "awaiting" only when the runtime reports that
      // it committed that exact revision - or reports why it could not.
      const applied = object(data.applied) ? data.applied : undefined;
      if (applied !== undefined && typeof applied.revision === "number") {
        const record = this.#readPendingModel(runtime.session.id);
        if (record !== undefined && record.revision === applied.revision && record.state === "awaiting") {
          const error = typeof applied.error === "string" ? applied.error : undefined;
          const appliedModel = object(applied.model) && typeof applied.model.provider === "string" && typeof applied.model.id === "string"
            ? `${applied.model.provider}/${applied.model.id}`
            : undefined;
          const reconciled: SessionPendingModel = {
            ...record,
            state: error === undefined ? "in-effect" : "refused",
            ...(error === undefined ? {} : { error }),
            applied: {
              ...(appliedModel === undefined ? {} : { model: appliedModel }),
              ...(typeof applied.thinkingLevel === "string" ? { thinkingLevel: applied.thinkingLevel } : {}),
              at: typeof applied.appliedAt === "string" ? applied.appliedAt : new Date().toISOString(),
              via: "turn-boundary",
            },
          };
          this.#writePendingModel(join(this.#options.stateDir, "sessions", runtime.session.id), reconciled);
        }
      }
      const queued = Array.isArray(data.queued) ? data.queued.filter(object) : [];
      for (const intent of this.store.listOpenTurnIntents(runtime.session.id)) {
        const position = queued.findIndex(entry => entry.intentId === intent.turnIntentId);
        if (intent.turnIntentId === current) {
          this.#recordTurn(runtime, intent, "running", { ...(running ?? {}), reason: "OMP reported this turn running." });
        } else if (position >= 0) {
          const entry = queued[position]!;
          const next = typeof entry.position === "number" ? entry.position : position + 1;
          if (intent.state === "queued" && intent.queuePosition !== next) {
            this.store.transitionTurnIntent(runtime.session.id, intent.turnIntentId, "queued", {
              queuePosition: next,
              reason: `OMP holds this turn queued at position ${next}.`,
            });
          }
        }
      }
    }).catch(() => { /* a queue snapshot is evidence, never a reason to fault the session */ });
  }

  /**
   * Record one step of a turn's projection.
   *
   * A turn boundary frame must never fault the session, so a transition a later frame has
   * already settled is left alone instead of thrown back into the frame path.
   */
  #recordTurn(runtime: Runtime, intent: TurnIntent | undefined, state: TurnState, fields: { evidenceSequence?: number; reason?: string; queuePosition?: number; model?: string; thinkingLevel?: string } = {}): void {
    if (intent === undefined) return;
    // A submission boundary may precede the named model boundary. Retain later
    // execution metadata even when the intent is already running.
    if (intent.state === state
      && (fields.model === undefined || fields.model === intent.model)
      && (fields.thinkingLevel === undefined || fields.thinkingLevel === intent.thinkingLevel)) return;
    if (intent.state === "completed" || intent.state === "failed" || intent.state === "cancelled") return;
    // A turn never moves backwards. OMP can report a boundary before the transport ACK is
    // processed, so the acknowledgement of a turn that already started must not restate it as
    // merely queued.
    if (TURN_STATE_ORDER[state] < TURN_STATE_ORDER[intent.state]) return;
    this.store.transitionTurnIntent(runtime.session.id, intent.turnIntentId, state, fields);
  }

  listModels(): Promise<ModelCatalogResult> {
    this.#assertOpen();
    return this.#modelCatalog.list();
  }

  /**
   * Read a task's model catalog from its already-running OMP owner.
   *
   * The session route deliberately does not start a task or fall back to the metadata worker when
   * a live owner exists: extension/provider additions and removals belong to that owner. An
   * unstarted task gets an explicit absence marker so clients may use the sessionless catalog for
   * discovery without confusing that fallback with a failed live read.
   */
  async listSessionModels(sessionId: string): Promise<SessionModelCatalogResult> {
    this.#assertOpen();
    this.#session(sessionId);
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready") {
      return { state: "unavailable", reason: NO_SESSION_OMP_MODEL_RUNTIME_REASON };
    }
    const ack = await runtime.client.request("get_available_models", {});
    return {
      source: "omp",
      cached: false,
      models: normalizeOmpModelCatalog(ack.data),
    };
  }

  /**
   * Read the capability table from an already-running OMP session.
   *
   * Capability discovery never starts a process or asks a provider for metadata. A host with no
   * live session therefore reports an explicit unavailable state rather than an empty table.
   */
  /**
   * Read the capability table from an already-running runtime.
   *
   * `expectedRevision` is the revision a caller already saw: naming it turns a table that moved
   * underneath the caller into a typed conflict instead of a silent refresh, which is what §8.2
   * requires of a stale capability revision. Nothing here starts a runtime or a session, and a
   * host with no live runtime reports that absence rather than an empty table.
   */
  /**
   * The first live runtime that can answer a Cedia capability operation.
   *
   * Reading metadata never starts a runtime: a host with no live session reports
   * that absence instead of spawning one to look like it has an answer.
   */
  #liveRuntimeClient(): { client: OmpRpcClient | OmpOwnerControlClient } | undefined {
    for (const runtime of this.#runtimes.values()) {
      if (runtime.closing || !runtime.client || runtime.client.phase !== "ready") continue;
      return { client: runtime.client };
    }
    return undefined;
  }

  /**
   * The taskless configuration-only OMP runtime (plan §6.4.1 S2).
   *
   * Spawned lazily on the first settings request that needs no task, supervised
   * across requests and stopped with the host. It owns no session, loads no
   * executable packages and contacts no model: settings operations touch only
   * OMP's own configuration layers. A binary that answers without the settings
   * service marker is closed without sending it a command — a session runtime
   * is never used as the configuration service.
   */
  async #configSettingsRuntime(): Promise<OmpRpcClient> {
    this.#assertOpen();
    const live = this.#configSettingsClient;
    if (live && live.phase === "ready") return live;
    if (live) {
      this.#configSettingsClient = undefined;
      await live.close().catch(() => undefined);
    }
    if (!this.#configSettingsStarting) {
      this.#configSettingsStarting = (async () => {
        const executable = this.#options.ompExecutable ?? "omp";
        const baseEnv = this.#options.ompEnv ?? process.env;
        const client = await OmpRpcClient.start({
          executable,
          cwd: this.#options.stateDir,
          env: {
            ...baseEnv,
            XDG_STATE_HOME: baseEnv.XDG_STATE_HOME ?? join(this.#options.stateDir, "xdg-state"),
            CEDIA_NATIVE_CACHE_DIR: join(this.#options.stateDir, "omp-natives"),
            // Same product policy as every runtime this host spawns (§2.8): never
            // spend a saved credit on its own. Set here too because this process
            // shares the owner's configuration.
            CEDIA_POLICY_CREDIT_GUARD: "1",
            CEDIA_SETTINGS_SERVICE: "1",
          },
          readyTimeoutMs: 20_000,
          requestTimeoutMs: this.#options.ompRequestTimeoutMs ?? 30_000,
        });
        const marker = (client.readyFrame as unknown as { cediaSettingsServiceVersion?: unknown } | undefined)
          ?.cediaSettingsServiceVersion;
        if (marker !== 1) {
          await client.close().catch(() => undefined);
          throw new HostError(
            "omp_settings_unavailable",
            "The OMP runtime does not advertise the taskless configuration service; Settings needs the pinned runtime",
            503,
          );
        }
        this.#configSettingsClient = client;
        return client;
      })().finally(() => {
        this.#configSettingsStarting = undefined;
      });
    }
    return this.#configSettingsStarting;
  }

  async ompCapabilitySnapshot(expectedRevision?: string): Promise<HostOmpCapabilitySnapshot> {
    this.#assertOpen();
    const live = this.#liveRuntimeClient();
    if (!live) return { state: "unavailable", reason: NO_LIVE_OMP_RUNTIME_REASON };
    const snapshot = await readOmpCapabilities(live.client, expectedRevision);
    return snapshot === undefined
      ? { state: "unavailable", reason: NO_CAPABILITY_BRIDGE_REASON }
      : { state: "available", snapshot };
  }

  /**
   * Every settings path the runtime defines, with schema metadata and no values.
   *
   * Served tasklessly through the configuration service so Settings opens with
   * zero tasks and zero provider calls. A runtime predating the service falls
   * back to the live session inventory; a host with neither reports absence.
   */
  async ompSettingsKeys(): Promise<HostOmpSettingsAnswer<OmpSettingsKeysSnapshot>> {
    this.#assertOpen();
    try {
      const client = await this.#configSettingsRuntime();
      const keys = await readOmpSettingsDescribe(client);
      if (keys !== undefined) return { state: "available", answer: keys };
    } catch (error) {
      if (!(error instanceof HostError && error.code === "omp_settings_unavailable")) throw error;
    }
    const live = this.#liveRuntimeClient();
    if (!live) return { state: "unavailable", reason: NO_LIVE_OMP_SETTINGS_REASON };
    const keys = await readOmpSettingsKeys(live.client);
    return keys === undefined
      ? { state: "unavailable", reason: NO_CAPABILITY_BRIDGE_REASON }
      : { state: "available", answer: keys };
  }

  /**
   * Cedia's product-policy layer, as the live runtime reports it (plan §2.8).
   *
   * The guard itself lives in the runtime, where the spend decision is made. This read exists so a
   * surface can show the stored value, the effective value and Cedia's reason side by side instead
   * of rewriting a preference the terminal also owns. A runtime without the bridge, or with no live
   * runtime at all, is `unavailable` with the reason - never an assumed guard.
   */
  async ompPolicy(): Promise<HostOmpSettingsAnswer<OmpCreditPolicy>> {
    this.#assertOpen();
    const live = this.#liveRuntimeClient();
    if (!live) return { state: "unavailable", reason: NO_LIVE_OMP_SETTINGS_REASON };
    const policy = await readOmpCreditPolicy(live.client);
    return policy === undefined
      ? { state: "unavailable", reason: NO_CAPABILITY_BRIDGE_REASON }
      : { state: "available", answer: policy };
  }

  /**
   * One effective settings value from the live runtime.
   *
   * A path the runtime does not define is refused here as a typed error, and a
   * credential path is already answered redacted by the runtime - the host
   * re-validates that shape rather than forwarding whatever arrived.
   */
  async ompSettingsValue(path: string): Promise<HostOmpSettingsAnswer<OmpSettingsValue>> {
    this.#assertOpen();
    const live = this.#liveRuntimeClient();
    if (!live) return { state: "unavailable", reason: NO_LIVE_OMP_SETTINGS_REASON };
    const value = await readOmpSettingsValue(live.client, path);
    return value === undefined
      ? { state: "unavailable", reason: NO_CAPABILITY_BRIDGE_REASON }
      : { state: "available", answer: value };
  }

  /**
   * One effective settings value in an explicit scope.
   *
   * Global and project scopes resolve through the taskless configuration
   * service and never borrow a live task's layers. Session scope reads the
   * named task's existing owner and creates nothing: without that live owner
   * the answer is unavailable, never a neighboring task's settings.
   */
  async ompSettingsValueIn(path: string, context: OmpSettingsContext): Promise<HostOmpSettingsAnswer<OmpSettingsValue>> {
    this.#assertOpen();
    if (context.scope === "session") {
      const runtime = this.#runtimes.get(context.sessionId);
      if (!runtime || runtime.closing || !runtime.client || runtime.client.phase !== "ready")
        return { state: "unavailable", reason: "No live runtime owns this task; Settings reads a named existing task only" };
      const value = await readOmpSettingsValueIn(runtime.client, path, {
        context: { scope: "session", sessionId: context.sessionId },
      });
      return value === undefined
        ? { state: "unavailable", reason: NO_CAPABILITY_BRIDGE_REASON }
        : { state: "available", answer: value };
    }
    const projectDir = context.scope === "project" ? this.#settingsProjectDir(context.projectId) : undefined;
    try {
      const client = await this.#configSettingsRuntime();
      const value = await readOmpSettingsValueIn(
        client,
        path,
        context.scope === "project"
          ? { context: { scope: "project", projectId: context.projectId }, projectDir }
          : { context: { scope: "global" } },
      );
      return value === undefined
        ? { state: "unavailable", reason: NO_CAPABILITY_BRIDGE_REASON }
        : { state: "available", answer: value };
    } catch (error) {
      if (error instanceof HostError && error.code === "omp_settings_unavailable") {
        const live = this.#liveRuntimeClient();
        if (!live) return { state: "unavailable", reason: NO_LIVE_OMP_SETTINGS_REASON };
        const value = await readOmpSettingsValue(live.client, path);
        return value === undefined
          ? { state: "unavailable", reason: NO_CAPABILITY_BRIDGE_REASON }
          : { state: "available", answer: value };
      }
      throw error;
    }
  }

  /** Resolve a project id to its trusted directory. Clients never pass paths. */
  #settingsProjectDir(projectId: string): string {
    const project = this.store.getProject(projectId);
    if (!project) throw new HostError("unknown_project", `Unknown project: ${projectId}`, 404);
    return realpathSync(project.path);
  }

  /**
   * Refuse a project mutation while the IDE holds the project config dirty.
   *
   * The bridge never saves automatically, so writing under a dirty buffer would
   * fork the file: disk keeps the stale content, the buffer keeps the owner's
   * newer text. Without a live editor there is no buffer to protect.
   */
  async #assertProjectConfigClean(projectDir: string): Promise<void> {
    const editors = this.#options.editors;
    if (!editors || !editors.hasConnection(projectDir)) return;
    const targets = [join(projectDir, ".omp", "config.yml"), join(projectDir, ".omp", "settings.json")];
    let inventory: { documents?: { path: string; dirty?: boolean }[] };
    try {
      inventory = (await editors.request(projectDir, { kind: "inventory", includeClean: false }, AbortSignal.timeout(5_000))) as {
        documents?: { path: string; dirty?: boolean }[];
      };
    } catch {
      throw new HostError(
        "omp_settings_editor_unknown",
        "A live IDE covers this project but its buffer state is unreachable; save or close it and retry",
        409,
      );
    }
    const dirty = (inventory.documents ?? []).filter(
      document => document.dirty === true && targets.some(target => document.path === target),
    );
    if (dirty.length > 0)
      throw new HostError(
        "omp_settings_dirty_buffer",
        `The IDE holds unsaved changes in ${dirty.map(document => document.path).slice(0, 3).join(", ")}; save or revert them before Settings writes the project file`,
        409,
      );
  }

  /**
   * Write one settings path through the live runtime.
   *
   * Cedia's policy is applied before the write: the path must exist in the runtime's own schema and
   * its disposition must be `editable`, so an excluded or credential path is refused here rather
   * than relied on to be refused later. The write itself is the runtime's, revision-checked when
   * the caller names the revision it read.
   */
  async ompSettingsWrite(request: { path: string; value: unknown; expectedRevision?: string }): Promise<HostOmpSettingsAnswer<OmpSettingsValue>> {
    this.#assertOpen();
    // The legacy single-path write keeps its contract: the path must be a runtime
    // setting with an editable disposition. It prefers the taskless configuration
    // service and falls back to a live session runtime on older binaries.
    const inventory = await this.ompSettingsKeys();
    if (inventory.state !== "available") return inventory;
    const key = inventory.answer.keys.find(candidate => candidate.path === request.path);
    if (key === undefined) throw new OmpSettingsPathError(request.path, `${request.path} is not a setting this runtime defines`);
    const { disposition, reason } = ompSettingDisposition(key);
    if (disposition !== "editable")
      throw new OmpSettingsNotEditableError(request.path, disposition, reason ?? "Cedia does not write this path");
    try {
      const client = await this.#configSettingsRuntime();
      const written = await writeOmpSettingsValue(client, request);
      return written === undefined
        ? { state: "unavailable", reason: NO_CAPABILITY_BRIDGE_REASON }
        : { state: "available", answer: written };
    } catch (error) {
      if (!(error instanceof HostError && error.code === "omp_settings_unavailable")) throw error;
    }
    const live = this.#liveRuntimeClient();
    if (!live) return { state: "unavailable", reason: NO_LIVE_OMP_SETTINGS_REASON };
    const written = await writeOmpSettingsValue(live.client, request);
    return written === undefined
      ? { state: "unavailable", reason: NO_CAPABILITY_BRIDGE_REASON }
      : { state: "available", answer: written };
  }

  /**
   * Apply a scoped mutation: global writes and unsets go through the taskless
   * configuration service; project writes resolve the project id to its trusted
   * directory and refuse while the IDE holds the project config dirty.
   *
   * Cedia policy precedes the runtime: protected and excluded paths are refused
   * here with their reason. Advanced placement is presentation, not a write
   * prohibition on the new contract; the legacy single-path write keeps its
   * editable-only rule so old surfaces cannot widen themselves by accident.
   */
  async ompSettingsMutate(mutation: {
    context: { scope: "global" } | { scope: "project"; projectId: string };
    expectedRevision?: string;
    changes: readonly ({ path: string; operation: "set"; value?: unknown } | { path: string; operation: "unset" })[];
  }): Promise<{ values: readonly OmpSettingsValue[]; scope: "global" | "project" }> {
    this.#assertOpen();
    const inventory = await this.ompSettingsKeys();
    if (inventory.state !== "available") throw new HostError("omp_settings_unavailable", inventory.reason, 503);
    const byPath = new Map(inventory.answer.keys.map(key => [key.path, key]));
    for (const change of mutation.changes) {
      const key = byPath.get(change.path);
      if (key === undefined) throw new OmpSettingsPathError(change.path, `${change.path} is not a setting this runtime defines`);
      const { disposition, reason } = ompSettingDisposition(key);
      if (disposition === "protected" || disposition === "excluded")
        throw new OmpSettingsNotEditableError(change.path, disposition, reason ?? "Cedia does not write this path");
    }
    const client = await this.#configSettingsRuntime();
    if (mutation.context.scope === "project") {
      const projectDir = this.#settingsProjectDir(mutation.context.projectId);
      await this.#assertProjectConfigClean(projectDir);
      const result = await mutateOmpSettings(
        client,
        {
          context: { scope: "project", projectId: mutation.context.projectId },
          ...(mutation.expectedRevision === undefined ? {} : { expectedRevision: mutation.expectedRevision }),
          changes: mutation.changes as never,
        },
        projectDir,
      );
      if (!result) throw new HostError("omp_settings_unavailable", NO_CAPABILITY_BRIDGE_REASON, 503);
      return result;
    }
    const result = await mutateOmpSettings(
      client,
      { context: { scope: "global" }, ...(mutation.expectedRevision === undefined ? {} : { expectedRevision: mutation.expectedRevision }), changes: mutation.changes as never },
      undefined,
    );
    if (!result) throw new HostError("omp_settings_unavailable", NO_CAPABILITY_BRIDGE_REASON, 503);
    return result;
  }

  /** Preview an unset of the named global paths. Writes nothing. */
  async ompSettingsResetPreview(paths: readonly string[]): Promise<{ path: string; globalConfigured: boolean; current: OmpSettingsValue }[]> {
    this.#assertOpen();
    const client = await this.#configSettingsRuntime();
    const preview = await previewOmpSettingsReset(client, paths);
    if (!preview) throw new HostError("omp_settings_unavailable", NO_CAPABILITY_BRIDGE_REASON, 503);
    return [...preview];
  }

  /** Provider-auth settings: OMP owns the credentials, this only brokers the calls. */
  providerAuth(): ProviderAuthManager {
    this.#assertOpen();
    return this.#providerAuth;
  }

  /** Create (or idempotently re-open) an OMP-owned fork of a session. */
  async forkSession(sourceId: string, title: string, id: string): Promise<SessionView> {
    const inflight = this.#forking.get(id);
    if (inflight) {
      const result = await inflight;
      if (result.sidechatSourceThreadId === sourceId) return result;
      throw new HostError("sidechat_conflict", "This task id belongs to a different source task", 409);
    }
    const operation = this.#forkSession(sourceId, title, id).finally(() => this.#forking.delete(id));
    this.#forking.set(id, operation);
    return operation;
  }

  async #forkSession(sourceId: string, title: string, id: string): Promise<SessionView> {
    this.#assertOpen();
    const source = this.#session(sourceId);
    if (sourceId === id) throw new HostError("sidechat_conflict", "A sidechat must have a different task id", 409);
    this.#assertOwnedSessionPath(source, source.sessionFile);

    const existing = this.store.getSession(id);
    if (existing) {
      const marker = this.#readSidechatMetadata(id);
      if (marker?.sourceThreadId === sourceId) {
        const starting = this.#starting.get(id);
        if (starting) {
          const started = await starting;
          return this.sessionView(started);
        }
        return this.sessionView(existing);
      }
      throw new HostError("sidechat_conflict", "This task id belongs to a different source task", 409);
    }

    // A freshly-created task has only a projected session path. Let the normal
    // managed OMP runtime materialize it before passing it to `--fork`; this
    // preserves one session owner when multiple sidechats are opened at once.
    if (!existsSync(source.sessionFile)) {
      const started = await this.startSession(source.id);
      if (resolve(started.sessionFile) !== resolve(source.sessionFile) || !existsSync(started.sessionFile)) {
        throw new HostError("session_mismatch", "OMP did not materialize the source session file");
      }
    }

    const project = this.store.getProject(source.projectId);
    if (!project) throw new HostError("not_found", "Source project not found", 404);
    // A sidechat continues the same task's folder, so it is admitted outside §3.C's
    // one-task-per-folder rule.
    const child = this.#createSession(project.id, title, "local", id, false);
    const directory = join(this.#options.stateDir, "sessions", child.id);
    // A worktree task must fork in the same working directory. OMP copies the
    // transcript, while the child intentionally shares the source's workspace.
    const childSession = this.store.updateSession(child.id, { cwd: source.cwd });
    this.#writeOwnerLaunchContext(childSession);
    const marker: SidechatMetadata = {
      version: 1,
      sourceThreadId: source.id,
      sourceSessionFile: source.sessionFile,
      createdAt: new Date().toISOString(),
    };
    try {
      this.#writeSidechatMetadata(directory, marker);
      const started = await this.startSession(child.id, source.sessionFile);
      return this.sessionView(started);
    } catch (error) {
      // #startSession closes a partially-created OMP client itself. This second
      // stop is for a race where a ready runtime appeared before a later check.
      await this.stopSession(child.id).catch(() => {});
      try { this.store.deleteSession(child.id); } catch { /* The startup path may already have removed it. */ }
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

	#readSidechatMetadata(id: string): SidechatMetadata | undefined {
    const path = join(this.#options.stateDir, "sessions", id, "sidechat.json");
    if (!existsSync(path)) return undefined;
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      if (value.version !== 1 || typeof value.sourceThreadId !== "string" || typeof value.sourceSessionFile !== "string" || typeof value.createdAt !== "string") return undefined;
      return { version: 1, sourceThreadId: value.sourceThreadId, sourceSessionFile: value.sourceSessionFile, createdAt: value.createdAt };
    } catch {
      return undefined;
    }
  }

  #writeSidechatMetadata(directory: string, metadata: SidechatMetadata): void {
    const path = join(directory, "sidechat.json");
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(metadata), { mode: 0o600 });
    renameSync(temporary, path);
  }

  #writeOwnerLaunchContext(session: Pick<Session, "id" | "incarnation" | "sessionFile" | "cwd">): void {
    persistOwnerLaunchContext(join(this.#options.stateDir, "sessions", session.id), {
      taskId: session.id,
      incarnation: session.incarnation,
      sessionFile: session.sessionFile,
      cwd: session.cwd,
    });
  }

  /** The folder identity a task began from; the session view stamps it on every row. */
  #writeWorkspaceIdentity(directory: string, identity: SessionWorkspace): void {
    const path = join(directory, "workspace-identity.json");
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, ...identity }), { mode: 0o600 });
    renameSync(temporary, path);
  }

  #readWorkspaceIdentity(id: string): SessionWorkspace | undefined {
    const path = join(this.#options.stateDir, "sessions", id, "workspace-identity.json");
    if (!existsSync(path)) return undefined;
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      if (value.version !== 1) return undefined;
      if (value.mode !== "local" && value.mode !== "worktree") return undefined;
      if (typeof value.isGit !== "boolean" || typeof value.cwd !== "string" || typeof value.root !== "string") return undefined;
      if (value.branch !== undefined && typeof value.branch !== "string") return undefined;
      if (value.sourceCommit !== undefined && typeof value.sourceCommit !== "string") return undefined;
      if (value.baseRef !== undefined && typeof value.baseRef !== "string") return undefined;
      const dirtyCopy = readDirtyCopy(value.dirtyCopy);
      return {
        mode: value.mode,
        isGit: value.isGit,
        cwd: value.cwd,
        root: value.root,
        ...(typeof value.branch === "string" ? { branch: value.branch } : {}),
        ...(typeof value.sourceCommit === "string" ? { sourceCommit: value.sourceCommit } : {}),
        ...(typeof value.baseRef === "string" ? { baseRef: value.baseRef } : {}),
        ...(dirtyCopy === undefined ? {} : { dirtyCopy }),
      };
    } catch {
      return undefined;
    }
  }

  #writePendingModel(directory: string, pending: SessionPendingModel): void {
    const path = join(directory, "pending-model.json");
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, ...pending }), { mode: 0o600 });
    renameSync(temporary, path);
  }

  #readPendingModel(id: string): SessionPendingModel | undefined {
    const path = join(this.#options.stateDir, "sessions", id, "pending-model.json");
    if (!existsSync(path)) return undefined;
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      if (value.version !== 1) return undefined;
      if (value.state !== "awaiting" && value.state !== "in-effect" && value.state !== "refused") return undefined;
      if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision <= 0) return undefined;
      if (typeof value.acceptedAt !== "string") return undefined;
      const requested = object(value.requested) ? value.requested : {};
      return {
        revision: value.revision,
        state: value.state,
        acceptedAt: value.acceptedAt,
        requested: {
          ...(typeof requested.provider === "string" ? { provider: requested.provider } : {}),
          ...(typeof requested.modelId === "string" ? { modelId: requested.modelId } : {}),
          ...(requested.thinkingLevel === null || typeof requested.thinkingLevel === "string" ? { thinkingLevel: requested.thinkingLevel as string | null } : {}),
        },
        ...(object(value.applied) && typeof value.applied.at === "string"
          ? {
              applied: {
                ...(typeof value.applied.model === "string" ? { model: value.applied.model } : {}),
                ...(typeof value.applied.thinkingLevel === "string" ? { thinkingLevel: value.applied.thinkingLevel } : {}),
                at: value.applied.at,
              },
            }
          : {}),
        ...(typeof value.error === "string" ? { error: value.error } : {}),
      };
    } catch {
      return undefined;
    }
  }

  #writeArchiveReceipt(directory: string, receipt: SessionArchiveReceipt): void {
    const path = join(directory, "archive-receipt.json");
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, ...receipt }), { mode: 0o600 });
    renameSync(temporary, path);
  }

  /** The worktree currently holding a branch, if any; a branch can only be checked out once. */
  #worktreeHolding(root: string, branch: string): string | undefined {
    const listing = probeGit(root, ["worktree", "list", "--porcelain"]);
    if (listing === undefined) return undefined;
    let path: string | undefined;
    for (const line of listing.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch refs/heads/") && path !== undefined) {
        if (line.slice("branch refs/heads/".length).trim() === branch) return path;
        path = undefined;
      } else if (line === "detached") path = undefined;
    }
    return undefined;
  }

  #readArchiveReceipt(id: string): SessionArchiveReceipt | undefined {
		const path = join(this.#options.stateDir, "sessions", id, "archive-receipt.json");
		if (!existsSync(path)) return undefined;
		try {
			const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
				if (value.version !== 1 || (value.state !== "retained" && value.state !== "prepared" && value.state !== "removed" && value.state !== "restored")) return undefined;
			if (typeof value.dirty !== "boolean" || typeof value.ignored !== "boolean") return undefined;
			if (typeof value.recordedAt !== "string" || typeof value.reason !== "string") return undefined;
			for (const key of ["ref", "commit", "branch", "worktree"] as const) {
				if (value[key] !== undefined && typeof value[key] !== "string") return undefined;
			}
			const restored = readRestoration(value.restored);
			if (value.state === "restored" && restored === undefined) return undefined;
			return {
				state: value.state,
				dirty: value.dirty,
				ignored: value.ignored,
				recordedAt: value.recordedAt,
				reason: value.reason,
				...(typeof value.ref === "string" ? { ref: value.ref } : {}),
				...(typeof value.commit === "string" ? { commit: value.commit } : {}),
				...(typeof value.branch === "string" ? { branch: value.branch } : {}),
				...(typeof value.worktree === "string" ? { worktree: value.worktree } : {}),
				...(restored === undefined ? {} : { restored }),
			};
		} catch {
			return undefined;
		}
	}

	/** Canonical Git common directory is the repository identity, even for linked worktrees. */
	#repositoryIdentity(root: string): string | undefined {
		const common = probeGit(root, ["rev-parse", "--git-common-dir"]);
		if (common === undefined) return undefined;
		return resolve(root, common);
	}

  /**
   * Ask the configured judge whether a request should start in its own worktree.
   *
   * This never changes a session by itself: it returns `undefined` when no judge is configured
   * or the judge has no usable answer, and the caller keeps its own default. `createSession`
   * stays synchronous and unaffected.
   */
  async suggestWorkspaceMode(prompt: string): Promise<WorkspaceSuggestion | undefined> {
    this.#assertOpen();
    const judge = this.#options.workspaceJudge;
    return judge ? suggestWorkspaceMode(judge, prompt) : undefined;
  }

  /** Start a session, optionally asking OMP to create it by forking a source file. */
  startSession(id: string, forkSource?: string): Promise<Session> {
    this.#assertOpen();
    const stopping = this.#stopping.get(id);
    if (stopping) return stopping.then(() => this.startSession(id, forkSource));
    const existing = this.#runtimes.get(id);
    if (existing?.client?.phase === "ready" && !existing.closing) return Promise.resolve(existing.session);
    const starting = this.#starting.get(id);
    if (starting) return starting;
    if (existing) return this.#lost(existing, "OMP process exited").then(() => this.startSession(id, forkSource));
    const operation = this.#startSession(id, forkSource).finally(() => this.#starting.delete(id));
    this.#starting.set(id, operation);
    return operation;
  }

  async #startSession(id: string, forkSource?: string): Promise<Session> {
    const before = this.#session(id);
    const executable = this.#options.ompExecutable ?? "omp";
    const directory = join(this.#options.stateDir, "sessions", before.id);
    // Discovery is the first startup operation. A live, authenticated owner is adopted in place;
    // a stale or conflicting record is evidence that Cedia cannot safely replace, so it refuses
    // before probing a binary, rotating the incarnation, or starting a second process.
    const discovered = await probeCediaOwner(directory, { expected: { sessionId: before.id, incarnation: before.incarnation } });
    if (before.status === "recovery_required" && discovered.state !== "attached") {
      throw new HostError("recovery_required", "Previous work has an unknown outcome. Reconcile before resuming; it will never be replayed automatically.");
    }
    if (discovered.state === "stale" || discovered.state === "conflict") {
      throw new HostError("owner_conflict", `Cedia could not safely start this session: ${discovered.reason}`, 409);
    }
    if (discovered.state === "attached" && discovered.identity.mode === "inspect_only") {
      throw new HostError("owner_conflict", "A TUI owns this task for inspection only; Cedia cannot adopt it as a controller or start another executor.", 409);
    }
    if (discovered.state === "attached" && forkSource !== undefined) {
      throw new HostError("owner_conflict", "A live owner is already attached to this task; forking requires a separate session owner.", 409);
    }
    const shouldAdopt = discovered.state === "attached";
    // Probe with the same environment the runtime will be spawned with: a launcher that
    // selects a binary through `ompEnv` has to be described by the version it reports
    // under that environment, not by whatever the host process's own PATH resolves to.
    // Async so a slow launcher cannot freeze every other session's HTTP/command work.
    const version = !shouldAdopt ? (await new Promise<string>((resolveVersion, rejectVersion) => {
      execFile(executable, ["--version"], {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, ...(this.#options.ompEnv ?? {}) },
      }, (error, stdout) => error ? rejectVersion(error) : resolveVersion(stdout));
    })).trim() : undefined;
    // The baseline is a floor, not a pin: an older runtime than the one the adapter
    // contract was written against is refused by name, and anything newer runs - what it
    // can do is read from its ready frame (the Cedia bridges are capability-gated there),
    // not guessed from its version (see isSupportedOmpVersion).
    if (version !== undefined && !isSupportedOmpVersion(version)) {
      throw new HostError("unsupported_omp", `Expected OMP ${OMP_BASELINE_VERSION} or later; received ${version}`);
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.#assertOwnedSessionPath(before, before.sessionFile);
    const originalIncarnation = before.incarnation;
    if (!shouldAdopt) {
      // Recheck before changing durable identity. A live or ambiguous owner that appeared while
      // the executable was probed is left in place and wins over a new spawn attempt.
      const beforeRotation = await probeCediaOwner(directory, { expected: { sessionId: before.id, incarnation: originalIncarnation } });
      if (beforeRotation.state !== "absent") {
        throw new HostError("owner_conflict", beforeRotation.state === "attached"
          ? "Another owner appeared while this session was starting. Cedia will not start a second executor."
          : `Cedia found an owner record while this session was starting: ${beforeRotation.reason}`, 409);
      }
    }
    // Rotate the incarnation for the new process, but leave the persisted status alone:
    // `agent_start` owns "running" and the ready path below owns "idle". A crash while
    // starting then leaves an idle task instead of a recovery_required one that never ran.

    // An adopted owner keeps the durable identity that was authenticated above. A newly spawned
    // owner gets a fresh incarnation, and the second probe immediately before spawn catches a
    // competing record that appeared while version probing or setup was in progress.
	    const session = shouldAdopt ? before : this.store.updateSession(id, { incarnation: randomUUID() });
	    // Refresh even for adoption: an existing task may predate the sidecar, and the launcher
	    // must validate the same session identity that this startup path just authenticated.
	    this.#writeOwnerLaunchContext(session);
	    const runtime: Runtime = {
	    session, ownership: shouldAdopt ? "attached" : "spawned", goal: new OmpProgress(), plan: new OmpPlan(), todos: new OmpTodos(), advisor: new OmpAdvisor(), advisorConfig: new OmpAdvisorConfig(), agents: new OmpAgents(), queue: new OmpQueue(), pause: new OmpPause(), python: new OmpPython(), context: new OmpContext(), memory: new OmpMemory(), usage: new OmpUsage(), credits: new OmpCredits(), modelState: new OmpModelState(), history: new OmpHistory(), tree: new OmpTree(), prewalk: new OmpPrewalk(), loop: new OmpLoop(), btw: new OmpBtw(), cleanse: new OmpCleanse(), omfg: new OmpOmfg(), toolCatalog: new OmpToolCatalog(), slashCommands: new Set(), extensions: new OmpExtensions(), codeMode: new OmpCodeMode(), closing: false, faulted: false, pendingHostFrames: [], wireCommands: new Map(), permissionResolvers: new Map(), nativePermissionResolvers: new Map(),
      permissions: new ExtensionUiBroker({
        send: frame => { runtime.permissionResolvers.get(String(frame.id))?.("confirmed" in frame && frame.confirmed === true); runtime.nativePermissionResolvers.get(String(frame.id))?.({ ...frame }); },
        onEvent: event => { this.#record(runtime, { type: "cedia_ui", origin: "cedia_host_policy_v1", event: json(event) }); },
      }),
      ui: new ExtensionUiBroker({
        send: async frame => {
          if (!runtime.client || runtime.closing) throw new HostError("unavailable", "OMP is not available");
          await runtime.client.send(frame);
        },
        onEvent: event => { this.#record(runtime, { type: "cedia_ui", event: json(event) }); },
      }),
      ...(this.#options.virtualUi ? { terminals: new TerminalStateRegistry() } : {}),
    };
    this.#runtimes.set(id, runtime);
    try {
      if (shouldAdopt) {
        const candidate = await attachCediaOwnerControlClient(directory, {
          expected: { sessionId: before.id, incarnation: before.incarnation },
          onFrame: frame => this.#onFrame(runtime, frame),
        });
        if (!(candidate instanceof OmpOwnerControlClient)) {
          const reason = candidate.state === "attached"
            ? "The owner disappeared before Cedia could claim its controller lease."
            : candidate.state === "absent" ? "The owner record disappeared before Cedia could claim its controller lease." : candidate.reason;
          throw new HostError("owner_conflict", `Cedia could not adopt the live owner: ${reason}`, 409);
        }
        // The endpoint helper rejects read-only leases; keep this guard at the host boundary too so
        // a future adapter cannot accidentally make an inspector the durable session controller.
        if (candidate.mode !== "read-write") {
          candidate.detach();
          throw new HostError("owner_conflict", "The live owner did not grant a read-write controller lease.", 409);
        }
        runtime.client = candidate;
      } else {
        // Recheck immediately before creating the child. This narrows the race with a qualified
        // launcher; the trusted OMP lock remains the final ownership gate, so a record appearing
        // after this check is still refused by the runtime rather than adopted or killed here.
        const beforeSpawn = await probeCediaOwner(directory, { expected: { sessionId: session.id, incarnation: originalIncarnation } });
        if (beforeSpawn.state !== "absent") {
          throw new HostError("owner_conflict", beforeSpawn.state === "attached"
            ? "Another owner appeared while this session was starting. Cedia will not start a second executor."
            : `Cedia found an owner record while this session was starting: ${beforeSpawn.reason}`, 409);
        }
        const lockExtension = this.#options.lockExtension ?? fileURLToPath(new URL("./runtime-lock.ts", import.meta.url));
        runtime.client = await OmpRpcClient.start({ executable, cwd: realpathSync(session.cwd),
          args: ["--no-title", "--cwd", session.cwd,
            ...(forkSource === undefined ? ["--session", session.sessionFile] : ["--fork", forkSource]),
            "--session-dir", directory,
            ...(this.#options.ompArgs ?? []),
            ...this.#extraTrustedExtensions.flatMap(extension => ["--trusted-extension", extension]),
            "--trusted-extension", lockExtension],
          env: {
            ...(this.#options.ompEnv ?? process.env),
            XDG_STATE_HOME: (this.#options.ompEnv ?? process.env).XDG_STATE_HOME ?? join(this.#options.stateDir, "xdg-state"),
            CEDIA_SESSION_LOCK: join(directory, "owner.sqlite"),
			CEDIA_HOST_LOCK_EXTENSION: realpathSync(lockExtension),
            CEDIA_HOST_SESSION_ID: session.id,
            CEDIA_NATIVE_CACHE_DIR: join(this.#options.stateDir, "omp-natives"),
            // Cedia's product policy (plan §2.8): a runtime this host starts never spends a saved
            // credit on its own. The flag is not optional and not a bridge toggle - it is what makes
            // the process Cedia-controlled, so it is set on every runtime we spawn and never written
            // into the owner's shared configuration.
            CEDIA_POLICY_CREDIT_GUARD: "1",
            ...(this.#options.virtualUi ? { CEDIA_RPC_VIRTUAL_UI: "1" } : {}),
            ...((this.#options.ownerBridge ?? this.#options.virtualUi) ? {
              CEDIA_RPC_OWNER_BRIDGE: "1",
              CEDIA_SESSION_INCARNATION: session.incarnation,
            } : {}),
            ...(this.#options.nativeBridge ? { CEDIA_RPC_NATIVE_BRIDGE: "1" } : {}),
            ...(this.#options.editorBridge ? { CEDIA_RPC_EDITOR_BRIDGE: "1" } : {}),
          },
          readyTimeoutMs: 20_000, requestTimeoutMs: this.#options.ompRequestTimeoutMs ?? 30_000,
          onFrame: frame => this.#onFrame(runtime, frame),
        });
      }
      runtime.goal.setClient(runtime.client);
      runtime.plan.setClient(runtime.client);
      runtime.todos.setClient(runtime.client);
      runtime.advisor.setClient(runtime.client);
      runtime.advisorConfig.setClient(runtime.client);
      runtime.agents.setClient(runtime.client);
      runtime.queue.setClient(runtime.client);
      runtime.pause.setClient(runtime.client);
      runtime.python.setClient(runtime.client);
      runtime.context.setClient(runtime.client);
      runtime.memory.setClient(runtime.client);
      runtime.usage.setClient(runtime.client);
      runtime.credits.setClient(runtime.client);
      runtime.modelState.setClient(runtime.client);
      runtime.history.setClient(runtime.client);
      runtime.tree.setClient(runtime.client);
      runtime.toolCatalog.setClient(runtime.client);
      runtime.extensions.setClient(runtime.client);
      runtime.codeMode.setClient(runtime.client);
      runtime.prewalk.setClient(runtime.client);
      runtime.loop.setClient(runtime.client);
      runtime.btw.setClient(runtime.client);
      runtime.cleanse.setClient(runtime.client);
      runtime.omfg.setClient(runtime.client);
      // This is a read against the already-running owner. A missing bridge or a malformed
      // response becomes an unavailable projection; it never starts another OMP process and
      // never turns an empty cache into a fabricated goal.
      await runtime.goal.seed();
      await runtime.plan.seed();
      await runtime.advisor.seed();
      await runtime.queue.seed();
      await runtime.context.seed();
      await runtime.memory.seed();
      if ((this.#options.nativeBridge || this.#options.editorBridge) && runtime.client.readyFrame?.cediaNativeBridgeVersion !== 1) throw new HostError("unsupported_native_bridge", "This OMP runtime does not support the Cedia native permission bridge");
      if (this.#options.editorBridge && (!this.#options.editors || runtime.client.readyFrame?.cediaEditorBridgeVersion !== 1)) throw new HostError("unsupported_editor_bridge", "This OMP runtime does not support guarded native editor snapshots");
      if (this.#options.virtualUi) await runtime.client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 100, rows: 30 });
      if (this.#options.editors || this.#options.nativeBridge || this.#options.editorBridge) {
        runtime.dispatcher = new OmpHostDispatcher({ requestTimeoutMs: 125_000, send: frame => runtime.client!.send(frame),
          authorize: (request, signal) => object(request.arguments) && !["apply", "apply_disk", "create", "delete", "move"].includes(String(request.arguments.kind)) ? true : this.#permission(runtime, request, signal),
        });
        if (this.#options.editors) runtime.dispatcher.registerTool({ definition: { name: "cedia_editor", description: "Read or apply guarded edits to this task's native editor buffers. Read returns a handle, documentVersion and sha256; apply must echo these. Never saves automatically.", loadMode: "eager",
          parameters: { type: "object", properties: { kind: { type: "string", enum: ["read", "apply", "inventory", "create", "delete", "move"] }, path: { type: "string" }, destination: { type: "string" }, handle: { type: "object" }, expectedVersion: { type: "number" }, expectedHash: { type: "string" }, edits: { type: "array" }, content: { type: "string" } }, required: ["kind"] } },
          handler: async (request, context) => ({ content: [{ type: "text", text: JSON.stringify(await this.#options.editors!.request(runtime.session.cwd, request.arguments as Record<string, unknown>, context.signal)) }] }),
        });
        if (this.#options.nativeBridge || this.#options.editorBridge) runtime.dispatcher.registerTool({ definition: { name: "cedia_native_permission", description: "Internal OMP permission bridge", parameters: { type: "object" } },
          handler: async (request, context) => ({ content: [{ type: "text", text: JSON.stringify(await this.#nativePermission(runtime, request.arguments, context.signal)) }] }),
        });
        if (this.#options.editorBridge && this.#options.editors) {
          const editor = new NativeEditorBridge(this.#options.editors, runtime.session.cwd);
          runtime.dispatcher.registerTool({ definition: { name: "cedia_native_editor", description: "Internal guarded native editor bridge", parameters: { type: "object" } },
            handler: async (request, context) => ({ content: [{ type: "text", text: JSON.stringify(await editor.handle(request.arguments, context.signal)) }] }),
          });
        }
        for (const frame of runtime.pendingHostFrames.splice(0)) void runtime.dispatcher.handle(frame);
        await runtime.client.request("set_host_tools", { tools: runtime.dispatcher.getToolDefinitions().filter(tool => !tool.name.startsWith("cedia_native_")) });
        // Cedia's own URI scheme, with the reader behind it: the task's immutable captured artifacts.
        // The store verifies every read against its digest, so `cedia://artifact/<sha256>` reaches the
        // bytes that were captured rather than whatever the workspace file says now (plan §10 item 37).
        if (runtime.dispatcher.getUriSchemeDefinitions().length === 0) {
          const artifacts = new ArtifactStore(this.#options.stateDir);
          runtime.dispatcher.registerUriScheme({
            definition: {
              scheme: CEDIA_HOST_URI_SCHEME,
              description: "Cedia's captured task artifacts, addressed by their sha256.",
              immutable: true,
            },
            read: request => readCediaArtifactUri(artifacts, runtime.session.id, String(request.url)),
          });
        }
        const schemes = runtime.dispatcher.getUriSchemeDefinitions();
        if (schemes.length > 0) {
          try {
            await this.#installHostUriSchemes(runtime);
          } catch (error) {
            // OMP refuses host commands until its own startup interaction completes (code
            // `cedia_initializing`). A startup custom that waits for user input must not fail
            // session startup: registration is retried before a later command instead, and the
            // deferral is reported on diagnostics. Any other refusal still fails startup.
            if (error instanceof OmpCommandError && error.code === "cedia_initializing") {
              runtime.uriSchemesPending = true;
              try { this.#options.onDiagnostic?.(`Host URI schemes deferred until after startup: ${error.message}`); } catch { /* Diagnostics must never fail startup. */ }
            } else throw error;
          }
        }
      }
      const state = (await runtime.client.request("get_state")).data;
      const forkPathInside = object(state) && typeof state.sessionFile === "string" ? this.#pathInsideSessionDirectory(directory, state.sessionFile) : false;
      if (!object(state) || typeof state.sessionFile !== "string" || (forkSource === undefined
        ? resolve(state.sessionFile) !== resolve(session.sessionFile)
        : !forkPathInside)) {
        throw new HostError("session_mismatch", "OMP resumed a different session file");
      }
      // Reuse the startup get_state response for the runtime's own todo phases. A missing or
      // malformed list remains unavailable; Cedia never fabricates an empty progress view.
      runtime.todos.seedFromState(state);
      const ownerStreaming = object(state) && state.isStreaming === true;
      if (runtime.ownership === "attached" && ownerStreaming) {
        // Events before this controller lease were not observed by this host. Keep any durable
        // in-flight command honest until a later explicit reconciliation resolves its outcome.
        this.#unknownCommands(id, "Cedia attached after the owner had already started a turn; prior command outcome is unknown.");
        runtime.adoptedActiveTurn = true;
      }
      const startupStatus: Session["status"] = before.status === "recovery_required"
        ? "recovery_required"
        : ownerStreaming ? "running" : "idle";
      runtime.session = this.store.updateSession(id, {
        status: startupStatus,
        ...(forkSource === undefined ? {} : { sessionFile: state.sessionFile }),
      });
      this.#writeOwnerLaunchContext(runtime.session);
      this.#record(runtime, { type: "cedia_session", session: json(runtime.session), state: json(state) });
      if (forkSource !== undefined || runtime.ownership === "attached") {
        // OMP owns the inherited transcript. Recording this response lets the
        // renderer hydrate the fork from the child session without copying or
        // inventing transcript entries in the host store.
        await runtime.client.request("get_messages");
      }
      await runtime.client.request("set_subagent_subscription", { level: "events" });
      runtime.timer = setInterval(() => {
        if (runtime.client?.phase === "closed" && !runtime.closing) void this.#lost(runtime, runtime.ownership === "attached"
          ? "The owner controller disconnected; the OMP owner's turn outcome is unknown."
          : "OMP process exited").catch(error => this.#options.onFatal?.(error));
      }, 250);
      runtime.timer.unref?.();
      return runtime.session;
    } catch (error) {
      try { this.#options.onDiagnostic?.(`OMP session startup failed: ${error instanceof Error ? error.message : String(error)}`); } catch { /* Diagnostics must never prevent process cleanup. */ }
      const lockContention = runtime.ownership === "spawned" && isOwnerLockContention(error);
      runtime.closing = true;
      runtime.ui.dispose();
      this.#disposePolicy(runtime);
      if (runtime.ownership === "attached" && runtime.client instanceof OmpOwnerControlClient) runtime.client.detach();
      else await runtime.client?.close().catch(() => {});
      this.#runtimes.delete(id);
      if (runtime.ownership === "attached" || lockContention || (error instanceof HostError && error.code === "owner_conflict")) {
        // A refused adoption/spawn race leaves the discovered owner and the original durable
        // identity untouched. The caller can retry after the owner is explicitly reconciled.
	        const restored = this.store.updateSession(id, { status: before.status, incarnation: before.incarnation });
	        this.#writeOwnerLaunchContext(restored);
	      } else this.store.updateSession(id, { status: "stopped" });
      if (lockContention) throw new HostError("owner_conflict", "Another OMP owner acquired this session lock while Cedia was starting. Cedia did not retry or replace it.", 409);
      throw error;
    }
  }

	async command(sessionId: string, deviceId: string, request: CommandRequest): Promise<Command> {
    this.#assertOpen();
    if (!RPC_COMMAND_TYPES.includes(request.command as RpcCommandType) && !(CEDIA_UI_COMMAND_TYPES as readonly string[]).includes(request.command)) throw new HostError("invalid_command", "Unknown OMP command", 400);
		const session = this.#session(sessionId);
    if (session.status === "recovery_required") throw new HostError("recovery_required", "Previous work has an unknown outcome. Reconcile before sending a new command; it will never be replayed automatically.");
    const key = `${sessionId}:${request.commandId}`;
    const previous = this.store.getCommand(sessionId, request.commandId);
    const currentRuntime = this.#runtimes.get(sessionId);
    if (!previous && currentRuntime?.adoptedActiveTurn === true && ["prompt", "abort_and_prompt", "follow_up", "steer"].includes(request.command)) {
      throw new HostError("owner_turn_unknown", "The adopted owner was already running a turn before this host attached. Reconcile its outcome before sending more turn input.", 409);
    }
    const selectedSlashCommand = request.command === "prompt" ? request.payload?.cediaSelectedSlashCommand : undefined;
    if (!previous && selectedSlashCommand !== undefined) {
			const runtime = this.#runtimes.get(sessionId);
			if (typeof selectedSlashCommand !== "string" || !runtime?.slashCommands.has(selectedSlashCommand)) {
				throw new HostError("stale_slash_command", "This selected slash command is no longer available. Refresh the command list and select it again.", 409);
			}
		}
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this command");
    // A start in flight will not dispatch this command, so refuse it transiently instead
    // of claiming a `not_dispatched` row the client would replay forever. A command that
    // already has a row (idempotent replay) is still returned below.
    if (!previous && this.#starting.has(sessionId)) throw new HostError("session_starting", "The OMP session is starting; retry when it is ready", 409);
    if (request.command === "switch_session") this.#assertOwnedSessionPath(session, request.payload?.sessionPath);
    const claim = this.store.claimCommand({ sessionId, commandId: request.commandId, deviceId,
      incarnation: request.incarnation, kind: request.command, payload: request.payload ?? {} });
    if (!claim.created) {
      const replay = this.#inflight.get(key);
      if (replay) return replay;
      const runtime = this.#runtimes.get(sessionId);
      if (runtime) this.#projectTodosFromCommand(runtime, claim.command);
      return claim.command;
    }
    // §2.4: a submitted turn gets its identity persisted before anything is dispatched, so a
    // crash between acceptance and dispatch leaves evidence instead of a guess.
    if (turnIntents.has(request.command)) {
      this.store.beginTurnIntent({
        sessionId,
        turnIntentId: `turn-${request.commandId}`,
        commandId: request.commandId,
        deviceId,
        incarnation: request.incarnation,
        payloadHash: claim.command.payloadHash,
      });
    }
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime?.client || runtime.client.phase !== "ready" || runtime.closing) {
      const command = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: "Start or reconcile the OMP session before sending commands" });
      const intent = this.store.getTurnIntentByCommand(sessionId, request.commandId);
      if (intent !== undefined) this.store.transitionTurnIntent(sessionId, intent.turnIntentId, "needs_continue", { reason: "The OMP session was not started, so this turn never reached OMP. Continue explicitly; Cedia does not replay it." });
      return command;
    }
    if (turnCommands.has(request.command) && runtime.activeCommand) {
      const command = this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: "A prompt is active; use steer, follow_up, or abort first" });
      const intent = this.store.getTurnIntentByCommand(sessionId, request.commandId);
      if (intent !== undefined) this.store.transitionTurnIntent(sessionId, intent.turnIntentId, "needs_continue", { reason: "A turn was already running, so this one was not dispatched. Continue explicitly; Cedia does not replay it." });
      return command;
    }
    if (turnCommands.has(request.command)) runtime.activeCommand = request.commandId;
    if (request.command === "abort") {
      // Stop interrupts the active turn and pauses what has not started; it never discards
      // the queued text and never launches the next one by itself.
      for (const intent of this.store.listOpenTurnIntents(sessionId)) {
        const state: TurnState = intent.state === "running" ? "cancelled" : "needs_continue";
        this.store.transitionTurnIntent(sessionId, intent.turnIntentId, state, {
          reason: intent.state === "running"
            ? "Stop interrupted this turn."
            : "Stop paused this turn before it started. Continue explicitly; Cedia does not replay it.",
        });
      }
    }
    const operation = this.#dispatch(runtime, request).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, operation);
    return operation;
  }

  /**
   * Install the dispatcher URI schemes on the runtime, verifying OMP reports each one.
   * A scheme the runtime dropped would leave the reader unreachable while the host
   * believed it was registered, so a missing scheme is a failure, not an assumption.
   */
  async #installHostUriSchemes(runtime: Runtime): Promise<void> {
    const schemes = runtime.dispatcher!.getUriSchemeDefinitions();
    const accepted = await (runtime.client as OmpRpcClient).request("set_host_uri_schemes", { schemes });
    const installed = object(accepted.data) && Array.isArray((accepted.data as { schemes?: unknown }).schemes)
      ? ((accepted.data as { schemes: unknown[] }).schemes.filter(entry => typeof entry === "string") as string[])
      : [];
    const missing = schemes.map(entry => entry.scheme).filter(scheme => !installed.includes(scheme));
    if (missing.length > 0) throw new HostError("host_uri_scheme_refused", `OMP did not install the host URI scheme(s): ${missing.join(", ")}`);
  }

  /**
   * Retry a URI-scheme registration deferred by a startup-gate refusal. This never fails
   * the command being dispatched: the schemes stay pending for a later command, and a turn
   * that references an unregistered scheme still fails loudly at OMP with its own error.
   */
  async #retryHostUriSchemes(runtime: Runtime): Promise<void> {
    if (runtime.client instanceof OmpRpcClient && runtime.dispatcher !== undefined) {
      try {
        await this.#installHostUriSchemes(runtime);
        runtime.uriSchemesPending = false;
      } catch (error) {
        // Stay pending; a later command retries. A refusal that is not the startup gate
        // is reported once, so a runtime that keeps dropping the schemes is observable
        // instead of silently retried on every command.
        if (!(error instanceof OmpCommandError) || error.code !== "cedia_initializing") {
          if (runtime.uriSchemesRetryNotified !== true) {
            runtime.uriSchemesRetryNotified = true;
            try { this.#options.onDiagnostic?.(`Host URI scheme retry failed: ${error instanceof Error ? error.message : String(error)}`); } catch { /* Diagnostics must never fail a command. */ }
          }
        }
      }
    }
  }

  async #dispatch(runtime: Runtime, request: CommandRequest): Promise<Command> {
    const id = runtime.session.id;
    if (runtime.uriSchemesPending === true) await this.#retryHostUriSchemes(runtime);
    try {
      const options = {
        onRequestId: (wireId: string) => { runtime.wireCommands.set(wireId, request.commandId); },
        // OMP login waits for the OAuth browser/code path (onPrompt timeout 600s).
        ...(request.command === "login" ? { timeoutMs: 600_000 } : {}),
      };
      // §2.4: when the runtime advertises Cedia's turn bridge, the submission is named on the
      // wire so OMP can echo that identity on its own boundaries. The name is added to the
      // dispatched payload only - the command receipt keeps the payload the caller sent, so its
      // hash stays the hash of the user's command.
      const intent = turnIntents.has(request.command) ? this.store.getTurnIntentByCommand(id, request.commandId) : undefined;
      const payload = {
        ...(request.payload ?? {}),
        ...(intent === undefined || runtime.client!.turnBridgeAdvertised() === false ? {} : { cediaIntentId: intent.turnIntentId }),
      };
      const ack = (CEDIA_UI_COMMAND_TYPES as readonly string[]).includes(request.command)
        ? await runtime.client!.requestCedia(request.command as CediaUiCommandType, payload, options)
        : await runtime.client!.request(request.command as RpcCommandType, payload as RpcCommandPayload<RpcCommandType>, options);
      if (request.command === "set_todos") this.#projectTodosFromAck(runtime, ack);
      const current = this.store.getCommand(id, request.commandId)!;
      if (!terminal.has(current.status)) {
        const localOnly = object(ack.data) && ack.data.agentInvoked === false;
        const awaitsTurn = turnCommands.has(request.command) && request.command !== "handoff" && !localOnly;
        this.store.transitionCommand(id, request.commandId, awaitsTurn ? "acknowledged" : "completed", { ack: json(ack),
          ...(awaitsTurn ? {} : { result: { meaning: "OMP command acknowledged", data: json(ack.data ?? null) } }) });
        if (!awaitsTurn && runtime.activeCommand === request.commandId) runtime.activeCommand = undefined;
        // Transport acknowledgement means accepted, not completed: the submission is queued
        // until OMP reports it starting or ending (§2.4). A `follow_up` completes its command
        // receipt at the ACK, because OMP answers the call rather than the turn, but the turn
        // itself is still pending and is recorded as such.
        if (turnIntents.has(request.command)) {
          this.#recordTurn(runtime, this.store.getTurnIntentByCommand(id, request.commandId), "queued", {
            reason: "OMP accepted this turn. Cedia has not seen it start yet.",
          });
          this.#syncTurnQueue(runtime);
        }
      }
      if (request.command === "cedia_terminal_resize") this.#resizeTerminal(runtime, request.payload);
	      if (["new_session", "switch_session", "branch"].includes(request.command)) {
	        const state = (await runtime.client!.request("get_state")).data;
	        if (object(state) && typeof state.sessionFile === "string") {
	          this.#assertOwnedSessionPath(runtime.session, state.sessionFile);
	          runtime.session = this.store.updateSession(id, { sessionFile: state.sessionFile });
          this.#writeOwnerLaunchContext(runtime.session);
	        }
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(id, request.commandId)) });
    } catch (error) {
      const current = this.store.getCommand(id, request.commandId)!;
      if (!terminal.has(current.status)) {
        const status = error instanceof OmpCommandError ? "failed"
          : error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched" ? "not_dispatched" : "outcome_unknown";
        this.store.transitionCommand(id, request.commandId, status, { error: String(error) });
      }
      if (runtime.activeCommand === request.commandId && this.store.getCommand(id, request.commandId)?.status !== "outcome_unknown") runtime.activeCommand = undefined;
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(id, request.commandId)) });
    }
    const result = this.store.getCommand(id, request.commandId)!;
    if (terminal.has(result.status) && result.status !== "outcome_unknown") this.#forgetWireCommand(runtime, request.commandId);
    return result;
  }

  /** Fold only the runtime's complete set_todos answer into the per-session projection. */
  #projectTodosFromAck(runtime: Runtime, ack: { readonly data?: unknown }): void {
    if (!object(ack.data) || !Object.hasOwn(ack.data, "todoPhases")) return;
    runtime.todos.seedFromState(ack.data);
  }

  /** Re-apply a durable set_todos receipt when an idempotent caller replays its command id. */
  #projectTodosFromCommand(runtime: Runtime, command: Command): void {
    if (command.kind !== "set_todos" || !object(command.ack)) return;
    this.#projectTodosFromAck(runtime, command.ack);
  }

  async respond(sessionId: string, deviceId: string, request: UiResponseRequest): Promise<Command> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && session.incarnation !== request.incarnation) throw new HostError("stale_incarnation", "This interaction belongs to an earlier OMP process");
    const claim = this.store.claimCommand({ sessionId, commandId: request.commandId, deviceId,
      incarnation: request.incarnation, kind: "ui_response", payload: json({ token: request.token, answer: request.answer }) });
    if (!claim.created) return claim.command;
    const runtime = this.#runtimes.get(sessionId);
    try {
      if (!runtime || runtime.closing) throw new HostError("unavailable", "OMP session is not running");
      const broker = runtime.permissions.pendingTokens().includes(request.token) ? runtime.permissions : runtime.ui;
      await broker.respond(request.token, request.answer);
      return this.store.transitionCommand(sessionId, request.commandId, "completed", { result: { meaning: "UI response submitted to OMP; this is not proof of a tool effect" } });
    } catch (error) {
      // A second client answering the same token loses the broker race with a
      // `stale-response` code. That is the O05 single-winner path: say so in the
      // receipt error using the vendor's own already-answered marker, so the
      // window treats it as a refresh instruction instead of a generic failure.
      const code = object(error) && typeof error.code === "string" ? error.code : undefined;
      if (code === "stale-response") {
        return this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: `The UI request was already answered.` });
      }
      const status = object(error) && error.code === "send-failed" ? "outcome_unknown" : "not_dispatched";
      return this.store.transitionCommand(sessionId, request.commandId, status, { error: String(error) });
    }
  }

  pendingUi(id: string): Json[] {
    const runtime = this.#runtimes.get(id);
    return runtime ? [...runtime.ui.pendingRequests(), ...runtime.permissions.pendingRequests()].map(event => json(event)) : [];
  }

  reconcile(id: string, acknowledgeUnknown = false): Session {
    this.#assertOpen();
    if (this.#runtimes.has(id)) throw new HostError("running", "Stop the live session before reconciliation");
    const session = this.#session(id);
    if (session.status !== "recovery_required") return session;
    if (!acknowledgeUnknown) throw new HostError("acknowledgement_required", "Acknowledge the unknown outcome before reconciliation", 400);
    const ownerRecovery = recoverStaleCediaOwnerEndpoint(join(this.#options.stateDir, "sessions", id), {
      sessionId: session.id,
      incarnation: session.incarnation,
    });
    if (ownerRecovery.state === "conflict") {
      throw new HostError("owner_conflict", `Cedia cannot safely clear the previous owner endpoint: ${ownerRecovery.reason}`, 409);
    }
    return this.store.updateSession(id, { status: "stopped" });
  }

  stopSession(id: string): Promise<Session> {
    const previous = this.#stopping.get(id);
    if (previous) return previous;
    const operation = this.#stopSession(id).finally(() => this.#stopping.delete(id));
    this.#stopping.set(id, operation);
    return operation;
  }

  async #stopSession(id: string): Promise<Session> {
    return this.#stopSessionWithMode(id, false);
  }

  /**
   * Stop a host runtime. An attached owner is a different process and cannot be stopped by
   * closing its controller socket; explicit stop/delete therefore refuses, while host shutdown
   * calls the preservation mode below to release only its lease.
   */
  async #stopSessionWithMode(id: string, preserveAttached: boolean): Promise<Session> {
    const starting = this.#starting.get(id);
    if (starting) await starting.catch(() => {});
    const runtime = this.#runtimes.get(id);
    if (!runtime) return this.#session(id);
    if (runtime.ownership === "attached" && !preserveAttached) {
      throw new HostError("owner_attached", "This task is owned by another live OMP process; Cedia will not stop or delete it through a detached controller.", 409);
    }
    runtime.closing = true;
    runtime.ui.dispose();
    this.#disposePolicy(runtime);
    if (runtime.timer) clearInterval(runtime.timer);
    runtime.terminals?.dispose();
    if (runtime.ownership === "attached" && runtime.client instanceof OmpOwnerControlClient) await runtime.client.detach();
    else await runtime.client?.close();
    if (this.#runtimes.get(id) === runtime) this.#runtimes.delete(id);
    if (runtime.ownership === "attached") {
      // The owner remains running and retains its durable incarnation/session state. A later host
      // can claim a new controller lease without Cedia manufacturing a stopped transition.
      return this.#session(id);
    }
    this.#unknownCommands(id, "OMP session was stopped before completion");
    runtime.session = this.store.updateSession(id, { status: "stopped" });
    this.#record(runtime, { type: "cedia_session", session: json(runtime.session) });
    return runtime.session;
  }

  /**
   * The headless screen per virtual terminal for one session.
   *
   * Read-only and cheap: a client that has just attached (or reattached after the
   * mobile history was trimmed) can render this instead of asking OMP for a redraw.
   * An empty list is an honest answer - the session is not running, the virtual UI is
   * off, or this host has no terminal engine for its platform.
   */
  terminalSnapshots(id: string): readonly TerminalCheckpoint[] {
    this.#assertOpen();
    this.#session(id);
    return this.#runtimes.get(id)?.terminals?.snapshots() ?? [];
  }

  /**
   * Delete a session for good: stop whatever is running, drop the record (commands
   * and events follow through the foreign keys) and remove what the host wrote for
   * the session on disk - its transcript directory and its artifacts.
   *
   * A worktree the session created is deliberately left alone: it can hold the
   * user's uncommitted work, and removing it is a larger promise than deleting a
   * chat. The window that asks for this confirms first ("This action cannot be
   * undone."), so there is no second confirmation here.
   */
  async deleteSession(id: string): Promise<void> {
    this.#assertOpen();
    const session = this.#session(id);
    await this.stopSession(id);
    // A controller-less host can still see a live owner on disk. Never remove its record or
    // session directory under it; deletion requires an explicit owner stop/reconciliation first.
    const directory = join(this.#options.stateDir, "sessions", id);
    const owner = await probeCediaOwner(directory, { expected: { sessionId: id, incarnation: session.incarnation } });
    if (owner.state !== "absent") {
      const reason = owner.state === "attached" ? "A live OMP owner still controls this task." : owner.reason;
      throw new HostError("owner_attached", `Cedia will not delete a task whose owner state is unresolved: ${reason}`, 409);
    }
    this.store.deleteSession(id);
    rmSync(join(this.#options.stateDir, "sessions", id), { recursive: true, force: true });
    rmSync(join(this.#options.stateDir, "artifacts", id), { recursive: true, force: true });
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    return this.#closePromise = (async () => {
      await Promise.allSettled([...this.#starting.values()]);
      await this.#providerAuth.close();
      if (this.#configSettingsClient) {
        const config = this.#configSettingsClient;
        this.#configSettingsClient = undefined;
        await config.close().catch(() => undefined);
      }
      const results = await Promise.allSettled([...this.#runtimes.keys()].map(id => this.#stopSessionWithMode(id, true)));
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    })();
  }

  /**
   * Apply a client's resize to the headless screen.
   *
   * It runs after OMP acknowledged the command, so the host's grid follows the PTY it
   * is actually describing instead of a request that may not have landed.
   */
  #resizeTerminal(runtime: Runtime, payload: Record<string, Json> | undefined): void {
    const value = payload ?? {};
    const terminalId = typeof value.terminalId === "string" ? value.terminalId : undefined;
    const cols = typeof value.cols === "number" ? value.cols : undefined;
    const rows = typeof value.rows === "number" ? value.rows : undefined;
    if (!terminalId || !cols || !rows) return;
    runtime.terminals?.resize(terminalId, cols, rows);
  }

  /** Refresh OMP's own todo list once for a turn boundary; both boundary frame kinds may arrive. */
  #refreshTodosAtTurnBoundary(runtime: Runtime, frame: OmpFrame): void {
    const boundary = typeof frame.cediaIntentId === "string" ? frame.cediaIntentId : undefined;
    if (boundary !== undefined) {
      if (runtime.todoRefreshBoundary === boundary) return;
      runtime.todoRefreshBoundary = boundary;
    } else {
      if (runtime.todoRefreshUnnamedBoundary === true) return;
      runtime.todoRefreshUnnamedBoundary = true;
    }
    if (runtime.todoRefreshPending || runtime.closing || !runtime.client || runtime.client.phase !== "ready") return;
    runtime.todoRefreshPending = true;
    void runtime.todos.refresh().catch(() => {}).finally(() => { runtime.todoRefreshPending = false; });
  }

  #onFrame(runtime: Runtime, frame: OmpFrame): void {
    if (runtime.faulted) return;
    try {
      if (frame.type === "available_commands_update" && Array.isArray(frame.commands)) {
        runtime.slashCommands = new Set(frame.commands.flatMap(command => {
          if (!object(command) || typeof command.name !== "string") return [];
          return [command.name, ...(Array.isArray(command.aliases) ? command.aliases.filter((alias): alias is string => typeof alias === "string") : [])];
        }));
      }
      const event = this.#record(runtime, frame);
      if (frame.type === "goal_updated" || frame.type === "subagent_lifecycle" || frame.type === "subagent_progress") runtime.goal.update(frame);
      if (frame.type === "cedia_plan_state" || frame.type === "cedia_plan_review" || frame.type === "cedia_plan_review_closed") runtime.plan.update(frame);
      if (frame.type === "tool_execution_end") runtime.todos.update(frame);
      if (frame.type === "agent_start" || frame.type === "turn_start") runtime.todoRefreshUnnamedBoundary = false;
      if (frame.type === "agent_end" || frame.type === "turn_end") this.#refreshTodosAtTurnBoundary(runtime, frame);
      // Every terminal frame passes through here, so this is where the headless screen
      // stays in step with what the clients are being streamed.
      runtime.terminals?.apply(frame);
      runtime.ui.ingest(frame);
      if (typeof frame.type === "string" && ["host_tool_call", "host_tool_cancel", "host_uri_request", "host_uri_cancel"].includes(frame.type)) {
        if (runtime.dispatcher) void runtime.dispatcher.handle(frame);
        else if (this.#options.editors || this.#options.nativeBridge || this.#options.editorBridge) {
          if (runtime.pendingHostFrames.length >= 100) throw new Error("Startup host bridge request capacity reached");
          runtime.pendingHostFrames.push(frame);
        }
      }
      const commandId = typeof frame.id === "string" ? runtime.wireCommands.get(frame.id) : undefined;
      if (frame.type === "cedia_turn_boundary" && Array.isArray(frame.completedIntentIds) && Array.isArray(frame.runningIntentIds)) {
        // OMP can drain several submitted follow-ups inside one agent run. Only
        // its explicit submission boundary settles that batch; a tool/model
        // turn_end does not. Keep activeCommand until the outer run finishes so
        // a new prompt cannot overlap the queued work still executing.
        for (const intentId of frame.completedIntentIds) {
          if (typeof intentId !== "string") continue;
          this.#recordTurn(runtime, this.store.getTurnIntent(runtime.session.id, intentId), "completed", {
            evidenceSequence: event.sequence, reason: "OMP reported this submission batch finishing.",
          });
        }
        for (const intentId of frame.runningIntentIds) {
          if (typeof intentId !== "string") continue;
          this.#recordTurn(runtime, this.store.getTurnIntent(runtime.session.id, intentId), "running", {
            evidenceSequence: event.sequence, reason: "OMP reported this submission batch starting.",
            ...(typeof frame.cediaModel === "string" ? { model: frame.cediaModel } : {}),
            ...(typeof frame.cediaThinkingLevel === "string" ? { thinkingLevel: frame.cediaThinkingLevel } : {}),
          });
        }
      }
      if (frame.type === "agent_start" || frame.type === "turn_start") {
        // A runtime with the turn bridge names the submission outright; otherwise the oldest
        // open intent is the only honest answer Cedia has.
        const named = this.#namedTurn(runtime, frame);
        // The boundary itself can name the model OMP is running this turn with; that is the
        // honest answer, and a requested-but-unaccepted change never reaches this field.
        const boundaryModel = typeof frame.cediaModel === "string" ? frame.cediaModel : undefined;
        const boundaryThinking = typeof frame.cediaThinkingLevel === "string" ? frame.cediaThinkingLevel : undefined;
        this.#recordTurn(runtime, named ?? this.#boundTurn(runtime, commandId), "running", {
          evidenceSequence: event.sequence,
          ...(boundaryModel === undefined ? {} : { model: boundaryModel }),
          ...(boundaryThinking === undefined ? {} : { thinkingLevel: boundaryThinking }),
          reason: named === undefined ? "OMP reported a turn starting; Cedia's own acceptance order binds it." : "OMP named this turn starting.",
        });
        if (named !== undefined) this.#syncTurnQueue(runtime);
      }
      if (frame.type === "agent_start") runtime.session = this.store.updateSession(runtime.session.id, { status: "running" });
      if (frame.type === "prompt_result" && commandId) this.#complete(runtime, commandId, frame, event.sequence);
      if (frame.type === "response" && frame.success === false && commandId) {
        const current = this.store.getCommand(runtime.session.id, commandId);
        if (current && !terminal.has(current.status)) this.store.transitionCommand(runtime.session.id, commandId, "failed", { error: String(frame.error) });
        this.#recordTurn(runtime, this.store.getTurnIntentByCommand(runtime.session.id, commandId), "failed", {
          evidenceSequence: event.sequence,
          reason: `OMP refused this turn: ${String(frame.error)}`,
        });
        if (runtime.activeCommand === commandId) runtime.activeCommand = undefined;
      }
      if (frame.type === "agent_end" && frame.isTerminal !== false) {
        runtime.adoptedActiveTurn = false;
        if (runtime.activeCommand) this.#complete(runtime, runtime.activeCommand, frame, event.sequence);
        runtime.session = this.store.updateSession(runtime.session.id, { status: "idle" });
      }
    } catch (error) {
      runtime.faulted = true;
      runtime.ui.dispose();
      this.#disposePolicy(runtime);
      void runtime.client?.close().catch(() => {});
      this.#options.onFatal?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #complete(runtime: Runtime, commandId: string, frame: OmpFrame, evidenceSequence?: number): void {
    const current = this.store.getCommand(runtime.session.id, commandId);
    if (current && !terminal.has(current.status)) {
      this.store.transitionCommand(runtime.session.id, commandId, "completed", { result: json(frame) });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(runtime.session.id, commandId)) });
    }
    this.#recordTurn(runtime, this.store.getTurnIntentByCommand(runtime.session.id, commandId), "completed", {
      ...(evidenceSequence === undefined ? {} : { evidenceSequence }),
      reason: "OMP reported this turn finishing.",
    });
    if (runtime.activeCommand === commandId) runtime.activeCommand = undefined;
    this.#forgetWireCommand(runtime, commandId);
  }
  #forgetWireCommand(runtime: Runtime, commandId: string) {
    for (const [wireId, id] of runtime.wireCommands) if (id === commandId) runtime.wireCommands.delete(wireId);
  }
  #record(runtime: Runtime, frame: unknown): SessionEvent {
    const event = this.store.appendEvent(runtime.session.id, runtime.session.incarnation, json(frame));
    this.#options.onEvent?.(event);
    return event;
  }
  async #lost(runtime: Runtime, reason: string): Promise<void> {
    if (this.#runtimes.get(runtime.session.id) !== runtime || runtime.closing) return;
    runtime.closing = true;
    runtime.ui.dispose();
    this.#disposePolicy(runtime);
    if (runtime.timer) clearInterval(runtime.timer);
    runtime.terminals?.dispose();
    this.#runtimes.delete(runtime.session.id);
    this.#unknownCommands(runtime.session.id, reason);
    runtime.session = this.store.updateSession(runtime.session.id, { status: "recovery_required" });
    this.#record(runtime, { type: "cedia_session", session: json(runtime.session), reason });
  }
  #unknownCommands(id: string, reason: string): void {
    for (const command of this.store.listPendingCommands(id)) {
      if (!terminal.has(command.status)) this.store.transitionCommand(id, command.commandId, "outcome_unknown", { error: reason });
    }
    // A turn that was already running when the owner disappeared has an unknown outcome; one
    // that never started is paused work. Neither is ever replayed by itself (§2.4).
    for (const intent of this.store.listOpenTurnIntents(id)) {
      this.store.transitionTurnIntent(id, intent.turnIntentId, intent.state === "prepared" ? "needs_continue" : "outcome_unknown", {
        reason: intent.state === "prepared"
          ? `${reason} This turn never reached OMP; continue explicitly.`
          : `${reason} Cedia cannot prove whether this turn finished.`,
      });
    }
  }
  #permission(runtime: Runtime, request: unknown, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || runtime.closing) return Promise.resolve(false);
    const id = randomUUID();
    return new Promise(resolve => {
      const finish = (allowed: boolean) => { runtime.permissionResolvers.delete(id); signal.removeEventListener("abort", abort); resolve(allowed && !signal.aborted && !runtime.closing); };
      const abort = () => { runtime.permissions.ingest({ type: "extension_ui_request", id: randomUUID(), method: "cancel", targetId: id }); finish(false); };
      runtime.permissionResolvers.set(id, finish); signal.addEventListener("abort", abort, { once: true });
      this.#record(runtime, { type: "cedia_permission", policyVersion: 1, requestId: id, request: json(request) });
      runtime.permissions.ingest({ type: "extension_ui_request", id, method: "confirm", title: "Allow this editor change?", message: JSON.stringify(request, null, 2), timeout: 30_000 });
    });
  }
  #nativePermission(runtime: Runtime, value: unknown, signal: AbortSignal): Promise<Json> {
    if (!object(value) || value.kind !== "permission" || !object(value.toolCall) || !Array.isArray(value.options) || value.options.length < 1 || value.options.length > 16) return Promise.reject(new Error("Invalid native permission request"));
    const options = value.options;
    const toolCall = value.toolCall;
    const kinds = new Set(["allow_once", "allow_always", "reject_once", "reject_always"]);
    if (options.some(option => !object(option) || typeof option.optionId !== "string" || typeof option.name !== "string" || typeof option.kind !== "string" || !kinds.has(option.kind)) || new Set(options.map(option => option.optionId)).size !== options.length) return Promise.reject(new Error("Invalid permission options"));
    if (signal.aborted || runtime.closing) return Promise.resolve({ outcome: "cancelled" });
    const id = randomUUID();
    const labels = options.map((option, index) => `${index + 1}. ${option.name}`);
    return new Promise(resolve => {
      let settled = false;
      const finish = (outcome: Json) => { if (settled) return; settled = true; runtime.nativePermissionResolvers.delete(id); signal.removeEventListener("abort", abort); try { this.#record(runtime, { type: "cedia_native_permission_outcome", policyVersion: 1, requestId: id, outcome }); resolve(outcome); } catch (error) { resolve({ outcome: "cancelled" }); this.#options.onFatal?.(error instanceof Error ? error : new Error(String(error))); } };
      const abort = () => { runtime.permissions.ingest({ type: "extension_ui_request", id: randomUUID(), method: "cancel", targetId: id }); finish({ outcome: "cancelled" }); };
      runtime.nativePermissionResolvers.set(id, frame => {
        const index = typeof frame.value === "string" ? labels.indexOf(frame.value) : -1;
        const selected = options[index];
        finish(index >= 0 && selected && !signal.aborted && !runtime.closing ? { outcome: "selected", optionId: selected.optionId, kind: selected.kind } : { outcome: "cancelled" });
      });
      signal.addEventListener("abort", abort, { once: true });
      this.#record(runtime, { type: "cedia_native_permission", policyVersion: 1, requestId: id, request: json(value) });
      runtime.permissions.ingest({ type: "extension_ui_request", id, method: "select", title: `${String(toolCall.title ?? "Allow this operation?")}\n${JSON.stringify(toolCall.rawInput ?? {})}`, options: labels, timeout: 120_000 });
    });
  }
  #disposePolicy(runtime: Runtime) { runtime.dispatcher?.dispose(); runtime.permissions.dispose(); for (const finish of [...runtime.permissionResolvers.values()]) finish(false); for (const finish of [...runtime.nativePermissionResolvers.values()]) finish({ type: "extension_ui_response", cancelled: true }); }
  #session(id: string): Session {
    const session = this.store.getSession(id);
    if (!session) throw new HostError("not_found", "Task not found", 404);
    return session;
  }
  #assertOwnedSessionPath(session: Session, path: unknown): void {
    if (typeof path !== "string" || !isAbsolute(path)) throw new HostError("invalid_session_path", "Session path must be absolute", 400);
    try { workspacePath(join(this.#options.stateDir, "sessions", session.id), path); }
    catch { throw new HostError("session_boundary", "Import external OMP sessions into a new task before switching"); }
  }
  #pathInsideSessionDirectory(directory: string, path: string): boolean {
    if (!isAbsolute(path)) return false;
    try {
      workspacePath(directory, path);
      return true;
    } catch {
      return false;
    }
  }
  #assertOpen(): void { if (this.#closing) throw new HostError("closing", "Cedia host is shutting down", 503); }
}
