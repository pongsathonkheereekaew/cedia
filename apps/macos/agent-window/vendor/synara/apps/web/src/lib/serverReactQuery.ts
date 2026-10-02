import type {
  ProviderKind,
  ServerConfig,
  ServerConsumeCodexResetCreditInput,
  ServerListProviderUsageInput,
  ServerProviderStatus,
  ServerStopLocalServerInput,
} from "@synara/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";
import { parseCapabilitySnapshot, type HostCapability } from "../capabilityGate";

export const LOCAL_SERVERS_VISIBLE_REFETCH_INTERVAL_MS = 10_000;
const LOCAL_SERVERS_DEFAULT_STALE_TIME_MS = 3_000;

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  authSession: () => ["server", "auth", "session"] as const,
  environment: () => ["server", "environment"] as const,
  capabilities: () => ["server", "capabilities"] as const,
  policy: () => ["server", "policy"] as const,
  owners: () => ["server", "owners"] as const,
  modelState: (sessionId: string) => ["server", "modelState", sessionId] as const,
  accounts: (sessionId: string) => ["server", "accounts", sessionId] as const,
  modelRoles: (sessionId: string) => ["server", "modelRoles", sessionId] as const,
  plan: (sessionId: string) => ["server", "plan", sessionId] as const,
  progress: (sessionId: string) => ["server", "progress", sessionId] as const,
  queue: (sessionId: string) => ["server", "queue", sessionId] as const,
  pause: (sessionId: string) => ["server", "pause", sessionId] as const,
  context: (sessionId: string) => ["server", "context", sessionId] as const,
  history: (sessionId: string) => ["server", "history", sessionId] as const,
  historyTranscript: (sessionId: string) => ["server", "history", "transcript", sessionId] as const,
  transcript: (sessionId: string) => ["server", "history", "transcript", sessionId] as const,
  tree: (sessionId: string) => ["server", "tree", sessionId] as const,
  toolCatalog: (sessionId: string) => ["server", "tools", "catalog", sessionId] as const,
  toolCodeMode: (sessionId: string) => ["server", "tools", "codemode", sessionId] as const,
  toolExtensions: (sessionId: string) => ["server", "tools", "extensions", sessionId] as const,
  prewalk: (sessionId: string) => ["server", "prewalk", sessionId] as const,
  loop: (sessionId: string) => ["server", "loop", sessionId] as const,
  btw: (sessionId: string) => ["server", "btw", sessionId] as const,
  omfg: (sessionId: string) => ["server", "omfg", sessionId] as const,
  cleanse: (sessionId: string) => ["server", "cleanse", sessionId] as const,
  goalDetails: (sessionId: string) => ["server", "goal", "details", sessionId] as const,
  usage: (sessionId: string) => ["server", "usage", sessionId] as const,
  credits: (sessionId: string) => ["server", "credits", sessionId] as const,
  memory: (sessionId: string) => ["server", "memory", sessionId] as const,
  agents: (sessionId: string) => ["server", "agents", sessionId] as const,
  agentConfigs: (sessionId: string) => ["server", "agents", "config", sessionId] as const,
  agentTranscript: (sessionId: string, agentId: string, fromByte = 0) =>
    ["server", "agentTranscript", sessionId, agentId, fromByte] as const,
  agentTranscriptRoot: (sessionId: string) => ["server", "agentTranscript", sessionId] as const,
  advisor: (sessionId: string) => ["server", "advisor", sessionId] as const,
  advisorHistory: (sessionId: string) => ["server", "advisor", "history", sessionId] as const,
  advisorConfig: (sessionId: string, scope: string) => ["server", "advisor", "config", sessionId, scope] as const,
  settings: () => ["server", "settings"] as const,
  worktrees: () => ["server", "worktrees"] as const,
  localServers: () => ["server", "localServers"] as const,
  providerUsage: (provider: ProviderKind | null | undefined, homePath?: string | null) =>
    ["server", "providerUsage", provider ?? null, homePath ?? null] as const,
  providerUsageRoot: () => ["server", "providerUsage"] as const,
  allProviderUsage: () => ["server", "allProviderUsage"] as const,
  profileStats: (utcOffsetMinutes: number) =>
    ["server", "profileStats", "peak-hour-v2", utcOffsetMinutes] as const,
  profileTokenStats: (utcOffsetMinutes: number) =>
    ["server", "profileTokenStats", utcOffsetMinutes] as const,
};

export const serverMutationKeys = {
  ownerAttach: () => ["server", "mutation", "owner-attach"] as const,
  stopLocalServer: () => ["server", "mutation", "stopLocalServer"] as const,
  plan: (sessionId: string) => ["server", "mutation", "plan", sessionId] as const,
  queue: (sessionId: string) => ["server", "mutation", "queue", sessionId] as const,
  bashExec: (sessionId: string) => ["server", "mutation", "bash", "exec", sessionId] as const,
  bashAbort: (sessionId: string) => ["server", "mutation", "bash", "abort", sessionId] as const,
  pythonExec: (sessionId: string) => ["server", "mutation", "python", "exec", sessionId] as const,
  pythonAbort: (sessionId: string) => ["server", "mutation", "python", "abort", sessionId] as const,
  pause: (sessionId: string) => ["server", "mutation", "pause", sessionId] as const,
  loop: (sessionId: string) => ["server", "mutation", "loop", sessionId] as const,
  btwAsk: (sessionId: string) => ["server", "mutation", "btw", "ask", sessionId] as const,
  cleanseRun: (sessionId: string) => ["server", "mutation", "cleanse", "run", sessionId] as const,
  cleanseAbort: (sessionId: string) => ["server", "mutation", "cleanse", "abort", sessionId] as const,
  btwBranch: (sessionId: string) => ["server", "mutation", "btw", "branch", sessionId] as const,
  omfgDraft: (sessionId: string) => ["server", "mutation", "omfg", "draft", sessionId] as const,
  omfgSave: (sessionId: string) => ["server", "mutation", "omfg", "save", sessionId] as const,
  omfgAbort: (sessionId: string) => ["server", "mutation", "omfg", "abort", sessionId] as const,
  contextDropImages: (sessionId: string) => ["server", "mutation", "context", "drop-images", sessionId] as const,
  contextShake: (sessionId: string) => ["server", "mutation", "context", "shake", sessionId] as const,
  contextAbortCompaction: (sessionId: string) => ["server", "mutation", "context", "abort-compaction", sessionId] as const,
  historyClear: (sessionId: string) => ["server", "mutation", "history", "clear", sessionId] as const,
  historyFresh: (sessionId: string) => ["server", "mutation", "history", "fresh", sessionId] as const,
  treeNavigate: (sessionId: string) => ["server", "mutation", "tree", "navigate", sessionId] as const,
  clearContext: (sessionId: string) => ["server", "mutation", "history", "clear", sessionId] as const,
  freshSession: (sessionId: string) => ["server", "mutation", "history", "fresh", sessionId] as const,
  creditsRedeem: (sessionId: string) => ["server", "mutation", "credits", "redeem", sessionId] as const,
  memoryApply: (sessionId: string) => ["server", "mutation", "memory", "apply", sessionId] as const,
  advisor: (sessionId: string) => ["server", "mutation", "advisor", sessionId] as const,
  advisorConfig: (sessionId: string) => ["server", "mutation", "advisor", "config", sessionId] as const,
  pinAccount: (sessionId: string) => ["server", "mutation", "accounts", "pin", sessionId] as const,
  serviceTier: (sessionId: string) => ["server", "mutation", "service-tier", sessionId] as const,
  applyRole: (sessionId: string) => ["server", "mutation", "roles", "apply", sessionId] as const,
  setRole: (sessionId: string) => ["server", "mutation", "roles", "set", sessionId] as const,
};

export interface CediaPlanMode {
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly planFilePath?: string;
  readonly workflow: "parallel" | "iterative";
  readonly reentry: boolean;
}

export interface CediaPlanReview {
  readonly reviewId: number;
  readonly title: string;
  readonly planFilePath: string;
  readonly planContent: string;
  readonly truncated: boolean;
  readonly createdAt: number;
}

export type CediaPlanAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly plan: CediaPlanMode | null;
      readonly vibe: { readonly enabled: boolean };
      readonly review: CediaPlanReview | null;
      readonly changed?: boolean;
      readonly reason?: string;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export type CediaProgressTaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface CediaProgressTask {
  readonly content: string;
  readonly status: CediaProgressTaskStatus;
  readonly blocker?: string;
}

export interface CediaProgressPhase {
  readonly name: string;
  readonly tasks: readonly CediaProgressTask[];
}

export type CediaProgressAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly phases: readonly CediaProgressPhase[];
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaQueueEntry {
  readonly text: string;
  readonly truncated: boolean;
  readonly images: number;
}

export type CediaQueueAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly steering: readonly CediaQueueEntry[];
      readonly followUp: readonly CediaQueueEntry[];
      /** Present on a successful drop response; omitted on a read response. */
      readonly dropped?: readonly CediaQueueEntry[];
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaQueueDropInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly mode: "last" | "all";
}

export interface CediaQueueRemoveInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly message: string;
  readonly queue: "steering" | "followUp";
}

export interface CediaQueuePromoteInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly message: string;
}

export type CediaBashAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly exitCode: number | null;
      readonly output: string;
      readonly outputTruncated: boolean;
      readonly cancelled: boolean;
      readonly timedOut: boolean;
      readonly workingDir?: string;
      readonly images: number;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaBashExecInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly command: string;
}

export type CediaPythonAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly exitCode: number | null;
      readonly output: string;
      readonly outputTruncated: boolean;
      readonly cancelled: boolean;
      readonly displayOutputs: number;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaPythonExecInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly code: string;
}

export type CediaPythonAbortAnswer =
  | { readonly state: "available"; readonly revision: number; readonly aborted: boolean }
  | { readonly state: "unavailable"; readonly reason: string };

export type CediaBashAbortAnswer =
  | { readonly state: "available"; readonly revision: number; readonly aborted: boolean }
  | { readonly state: "unavailable"; readonly reason: string };

export type CediaPauseAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly paused: boolean;
      readonly pausedAt?: number;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaPauseInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly paused: boolean;
}

export interface CediaContextUsage {
  readonly contextWindow: number;
  readonly anchored: boolean;
  readonly usedTokens: number;
  readonly systemPromptTokens: number;
  readonly systemToolsTokens: number;
  readonly systemContextTokens: number;
  readonly skillsTokens: number;
  readonly messagesTokens: number;
}

export type CediaContextShakeMode = "elide" | "images" | "thinking";

export interface CediaContextShakeResult {
  readonly mode: CediaContextShakeMode;
  readonly toolResultsDropped: number;
  readonly blocksDropped: number;
  readonly imagesDropped?: number;
  readonly thinkingBlocksDropped?: number;
  readonly tokensFreed: number;
  readonly artifactId?: string;
}

export type CediaContextAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly usage?: CediaContextUsage;
      readonly compacting: boolean;
      readonly speculation: "idle" | "running" | "armed";
      /** Present on a successful drop-images response; omitted on reads and aborts. */
      readonly removed?: number;
      /** Present on a successful context-shake response; omitted on reads and other controls. */
      readonly shake?: CediaContextShakeResult;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaContextCommandInput {
  readonly commandId?: string;
  readonly incarnation?: string;
}

export interface CediaHistoryCheckpoint {
  readonly messageCount: number;
  readonly entryId: string | null;
  readonly startedAt: string;
}

export interface CediaHistoryRewind {
  readonly report: string;
  readonly reportTruncated: boolean;
  readonly startedAt: string;
  readonly rewoundAt: string;
}

export type CediaHistoryAnswer =
  | {
      readonly state: "available";
      readonly checkpoint: CediaHistoryCheckpoint | null;
      readonly lastRewind: CediaHistoryRewind | null;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaTreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: string;
  readonly timestamp: string;
  readonly label: string;
  readonly labelTruncated: boolean;
}

export interface CediaTreeLineage {
  readonly sessionFile: string;
  readonly parentSession: string | null;
  readonly previousSessionFiles: readonly string[];
}

export type CediaTreeAnswer =
  | {
      readonly state: "available";
      readonly leafId: string | null;
      readonly nodes: readonly CediaTreeNode[];
      readonly pathIds: readonly string[];
      readonly truncated: boolean;
      readonly lineage: CediaTreeLineage;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export type CediaTreeNavigateInput = {
  readonly entryId: string;
  readonly summarize?: boolean;
};

export type CediaTreeNavigateAnswer =
  | {
      readonly state: "available";
      readonly moved: boolean;
      readonly cancelled: boolean;
      readonly aborted: boolean;
      readonly askReopen: boolean;
      readonly summarized: boolean;
      readonly editorText: string | null;
      readonly editorTextTruncated: boolean;
      readonly editorImageCount: number;
      readonly leafId: string | null;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export type CediaPrewalkAnswer =
  | {
      readonly state: "available";
      readonly armed: boolean;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaCodeModePrelude {
  readonly name: string;
  readonly enabled: boolean;
}

export type CediaCodeModeAnswer =
  | {
      readonly state: "available";
      readonly active: boolean;
      readonly directToolNames: readonly string[] | null;
      readonly preludes: readonly CediaCodeModePrelude[];
    }
  | { readonly state: "unavailable"; readonly reason: string };

export type CediaLoopAnswer =
  | {
      readonly state: "available";
      readonly enabled: boolean;
      readonly paused: boolean;
      readonly limit: string | null;
      readonly condition: string | null;
      readonly hasPrompt: boolean;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaLoopInput {
  readonly commandId?: string;
  readonly incarnation?: string;
}

export interface CediaToolCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly descriptionTruncated: boolean;
  readonly source: "builtin" | "mcp" | "sdk" | "extension";
  readonly active: boolean;
}

export type CediaToolCatalogAnswer =
  | {
      readonly state: "available";
      readonly tools: readonly CediaToolCatalogEntry[];
      readonly truncated: boolean;
      readonly total: number;
      readonly activeCount: number;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export type CediaTranscriptAnswer =
  | {
      readonly state: "available";
      readonly text: string;
      readonly truncated: boolean;
      readonly bytes: number;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaUsageAmount {
  readonly unit: string;
  readonly usedFraction?: number;
  readonly used?: number;
  readonly limit?: number;
  readonly remainingFraction?: number;
}

export interface CediaUsageWindow {
  readonly id: string;
  readonly label: string;
  readonly resetsAt?: number;
}

export interface CediaUsageLimit {
  readonly id: string;
  readonly label: string;
  readonly scope?: { readonly provider?: string; readonly accountId?: string };
  readonly window?: CediaUsageWindow;
  readonly amount: CediaUsageAmount;
  readonly status?: string;
  readonly notes?: readonly string[];
}

export interface CediaUsageCredit {
  readonly grantedAt?: string;
  readonly expiresAt?: string;
  readonly status?: string;
}

export interface CediaUsageReport {
  readonly provider: string;
  readonly fetchedAt: number;
  readonly limits: readonly CediaUsageLimit[];
  readonly resetCredits?: {
    readonly availableCount: number;
    readonly credits?: readonly CediaUsageCredit[];
  };
  readonly notes?: readonly string[];
  readonly accountId?: string;
  readonly accountEmail?: string;
  readonly limitReached?: boolean;
}

export type CediaUsageAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly reports: readonly CediaUsageReport[];
      readonly supported?: boolean;
      readonly unavailable?: string;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaCredit {
  readonly id: string;
  readonly resetType?: string;
  readonly status?: string;
  readonly grantedAt?: string;
  readonly expiresAt?: string;
  readonly title?: string;
  readonly description?: string;
}

export interface CediaCreditAccount {
  readonly credentialId?: number;
  readonly accountId?: string;
  readonly email?: string;
  readonly availableCount: number;
  readonly credits: readonly CediaCredit[];
  readonly active: boolean;
  readonly error?: string;
}

export interface CediaCreditRedeem {
  readonly ok: boolean;
  readonly code: string;
  readonly accountId?: string;
  readonly email?: string;
  readonly creditId?: string;
}

export interface CediaCreditTarget {
  readonly credentialId?: number;
  readonly accountId?: string;
  readonly email?: string;
}

export type CediaCreditsAvailableAnswer = {
  readonly state: "available";
  readonly revision: number;
  readonly accounts: readonly CediaCreditAccount[];
  readonly unavailable?: string;
  readonly lastRedeem?: CediaCreditRedeem;
};

export type CediaCreditsAnswer = CediaCreditsAvailableAnswer | { readonly state: "unavailable"; readonly reason: string };
export type CediaCreditsRedeemAnswer = CediaCreditsAvailableAnswer | { readonly state: "unavailable"; readonly reason: string; readonly lastRedeem?: CediaCreditRedeem };

export interface CediaContextShakeInput extends CediaContextCommandInput {
  readonly mode: CediaContextShakeMode;
}

export type CediaMemoryBackend = "off" | "local" | "hindsight" | "mnemopi" | "sharpshooter";

export interface CediaMnemopiState {
  readonly sessionId: string;
  readonly lastRetainedTurn: number;
  readonly hasRecalledForFirstTurn: boolean;
  readonly recallTargets: number;
  readonly hasGlobalTarget: boolean;
}

export type CediaRecallTagsMatch = "any" | "all" | "any_strict" | "all_strict";

export interface CediaHindsightState {
  readonly sessionId: string;
  readonly bankId: string;
  readonly banksSet: number;
  readonly retainTags: number;
  readonly recallTags: number;
  readonly recallTagsMatch?: CediaRecallTagsMatch;
  readonly lastRetainedTurn: number;
  readonly hasRecalledForFirstTurn: boolean;
}

export type CediaMemoryAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly backend: CediaMemoryBackend;
      readonly mnemopi?: CediaMnemopiState;
      readonly hindsight?: CediaHindsightState;
      /** Present only after the runtime has applied the selected backend. */
      readonly applied?: true;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaMemoryCommandInput {
  readonly commandId?: string;
  readonly incarnation?: string;
}

/** Alias used by callers that want to name the operation explicitly. */
export type CediaMemoryApplyInput = CediaMemoryCommandInput;

export interface CediaAgentRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly parentId?: string;
  readonly status: string;
  readonly createdAt: number;
  readonly lastActivity: number;
  readonly activity?: string;
  readonly sessionFile?: string;
}

export type CediaAgentsAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly agents: readonly CediaAgentRow[];
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaAgentTranscriptMessage {
  readonly role: string;
  readonly text: string;
  readonly otherParts: number;
}

export type CediaAgentTranscriptAnswer =
  | {
      readonly state: "available";
      readonly agentId: string;
      readonly sessionFile: string;
      readonly fromByte: number;
      readonly nextByte: number;
      readonly reset: boolean;
      readonly messages: readonly CediaAgentTranscriptMessage[];
      readonly truncated: boolean;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaAdvisorModel {
  readonly provider: string;
  readonly id: string;
  readonly name?: string;
}

export interface CediaAdvisorTokens {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

export interface CediaAdvisorMessages {
  readonly user: number;
  readonly assistant: number;
  readonly total: number;
}

interface CediaAdvisorUsage {
  readonly model?: CediaAdvisorModel;
  readonly contextWindow: number;
  readonly contextTokens: number;
  readonly tokens: CediaAdvisorTokens;
  readonly cost: number;
  readonly messages: CediaAdvisorMessages;
}

export interface CediaAdvisorRow extends CediaAdvisorUsage {
  readonly name: string;
  readonly status: string;
  readonly sessionId?: string;
}

export interface CediaAdvisorSnapshot extends CediaAdvisorUsage {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly configured: boolean;
  readonly advisors: readonly CediaAdvisorRow[];
  readonly changed: boolean;
}

export type CediaAdvisorAnswer =
  | { readonly state: "available"; readonly revision: number; readonly advisor: CediaAdvisorSnapshot }
  | { readonly state: "unavailable"; readonly reason: string };

export type CediaAdvisorHistoryAnswer =
  | { readonly state: "available"; readonly text: string | null; readonly truncated: boolean }
  | { readonly state: "unavailable"; readonly reason: string };

export type CediaAdvisorConfigScope = "project" | "user";

export type CediaAdvisorConfigAnswer =
  | {
      readonly state: "available";
      readonly revision: number;
      readonly scope: CediaAdvisorConfigScope;
      readonly path: string;
      readonly exists: boolean;
      readonly text: string;
      readonly advisors?: number;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaAdvisorConfigInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly scope: CediaAdvisorConfigScope;
  readonly text: string;
}

export type CediaPolicyMode = "unset" | "yes" | "no";

export interface CediaCreditPolicy {
  readonly guardActive: boolean;
  readonly stored: CediaPolicyMode;
  readonly effective: CediaPolicyMode;
  readonly overridden: boolean;
  readonly reason: string;
}

export type CediaPolicyAnswer =
  | { readonly state: "available"; readonly answer: CediaCreditPolicy }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CediaRuntimeModel {
  readonly provider: string;
  readonly id: string;
}

export interface CediaRuntimeEffort {
  readonly configured: string | null;
  readonly autoResolved: string | null;
  readonly isAuto: boolean;
}

export interface CediaServiceTierCurrent {
  readonly family: string;
  readonly tier: string | null;
}

export interface CediaServiceTiers {
  readonly families: readonly string[];
  readonly tiers: readonly string[];
  readonly current: readonly CediaServiceTierCurrent[];
}

export type CediaModelStateAnswer =
  | {
      readonly available: true;
      readonly model: CediaRuntimeModel | null;
      readonly effort: CediaRuntimeEffort;
      readonly serviceTiers: CediaServiceTiers;
    }
  | { readonly available: false; readonly reason: string };

export interface CediaAccount {
  readonly credentialId: number;
  readonly label: string | null;
  readonly active: boolean;
}

export interface CediaAccountsProjection {
  readonly supported: boolean;
  readonly provider: string | null;
  readonly accounts: readonly CediaAccount[];
  readonly truncated: boolean;
}

export interface CediaOwnerIdentity {
  readonly mode: "controller" | "inspect_only";
  readonly sessionId: string;
  readonly incarnation: string;
  readonly pid: number;
  readonly ownerStartedAt: string;
}

export type CediaOwnerState = "attached" | "absent" | "stale" | "conflict";

export interface CediaOwnerRow {
  readonly taskId: string;
  readonly title: string;
  readonly archived: boolean;
  readonly state: CediaOwnerState;
  readonly reason?: string;
  readonly identity?: CediaOwnerIdentity;
}

export interface CediaOwnerAnswer {
  readonly owners: readonly CediaOwnerRow[];
  readonly truncated: boolean;
}

interface CediaOwnerApi {
  readonly getOwners: () => Promise<unknown>;
  readonly attachOwner: (taskId: string) => Promise<unknown>;
}

function getCediaOwnerApi(): CediaOwnerApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaOwnerApi> };
  if (typeof api.cedia?.getOwners !== "function" || typeof api.cedia?.attachOwner !== "function") {
    throw new Error("Cedia owner bridge is unavailable.");
  }
  return api.cedia as CediaOwnerApi;
}

export type CediaAccountsAnswer =
  | ({ readonly available: true } & CediaAccountsProjection)
  | { readonly available: false; readonly reason: string };

export interface CediaPinAccountAnswer {
  readonly pinned: boolean;
  readonly list: CediaAccountsProjection;
}

export interface CediaServiceTierAnswer {
  readonly family: string;
  readonly tier: string | null;
  readonly serviceTiers: CediaServiceTiers;
}

export interface CediaModelRoleEntry {
  readonly role: string;
  readonly modelId: string;
  readonly source: string;
}

export type CediaModelRolesAnswer =
  | {
      readonly available: true;
      readonly cycleOrder: readonly string[];
      readonly roles: readonly CediaModelRoleEntry[];
      readonly storage: string;
    }
  | { readonly available: false; readonly reason: string };

export interface CediaRoleApplyAnswer {
  readonly role: string;
  readonly provider: string;
  readonly model: string;
}

interface CediaPlanApi {
  readonly getPlan: (sessionId: string) => Promise<unknown>;
  readonly setPlan: (sessionId: string, body: Record<string, unknown>) => Promise<unknown>;
}

interface CediaProgressApi {
  readonly getProgress: (sessionId: string) => Promise<unknown>;
}

interface CediaQueueApi {
  readonly getQueue: (sessionId: string) => Promise<unknown>;
  readonly dropQueued: (sessionId: string, input: CediaQueueDropInput) => Promise<unknown>;
  readonly removeQueuedMessage?: (sessionId: string, input: CediaQueueRemoveInput) => Promise<unknown>;
  readonly promoteQueuedMessage?: (sessionId: string, input: CediaQueuePromoteInput) => Promise<unknown>;
}

interface CediaContextApi {
  readonly getContext: (sessionId: string) => Promise<unknown>;
  readonly dropContextImages: (sessionId: string, input: CediaContextCommandInput) => Promise<unknown>;
  readonly shakeContext: (sessionId: string, input: CediaContextShakeInput) => Promise<unknown>;
  readonly abortCompaction: (sessionId: string, input: CediaContextCommandInput) => Promise<unknown>;
}

interface CediaHistoryApi {
  readonly getHistory: (sessionId: string) => Promise<unknown>;
  readonly getTranscript: (sessionId: string) => Promise<unknown>;
  readonly clearContext: (sessionId: string, input?: CediaContextCommandInput) => Promise<unknown>;
  readonly freshSession: (sessionId: string, input?: CediaContextCommandInput) => Promise<unknown>;
}

interface CediaTreeApi {
  readonly getTree: (sessionId: string) => Promise<unknown>;
  readonly navigateTree: (sessionId: string, entryId: string, summarize?: boolean) => Promise<unknown>;
}

interface CediaToolCatalogApi {
  readonly getToolCatalog: (sessionId: string) => Promise<unknown>;
  readonly setActiveTools: (sessionId: string, toolNames: readonly string[]) => Promise<unknown>;
  readonly refreshSkills: (sessionId: string) => Promise<unknown>;
}

interface CediaPrewalkApi {
  readonly getPrewalk: (sessionId: string) => Promise<unknown>;
}

interface CediaUsageApi {
  readonly getUsage: (sessionId: string) => Promise<unknown>;
}

interface CediaCreditsApi {
  readonly getCredits: (sessionId: string) => Promise<unknown>;
  readonly redeemCredit: (sessionId: string, target: CediaCreditTarget) => Promise<unknown>;
}

interface CediaMemoryApi {
  readonly getMemory: (sessionId: string) => Promise<unknown>;
  readonly applyMemoryBackend: (sessionId: string, input: CediaMemoryCommandInput) => Promise<unknown>;
}

interface CediaAgentsApi {
  readonly getAgents: (sessionId: string) => Promise<unknown>;
  readonly getAgentTranscript: (sessionId: string, agentId: string, fromByte?: number) => Promise<unknown>;
  readonly killAgent: (sessionId: string, agentId: string) => Promise<unknown>;
  readonly reviveAgent: (sessionId: string, agentId: string) => Promise<unknown>;
  readonly configureAgent: (sessionId: string, body: CediaAgentConfigInput) => Promise<unknown>;
  readonly getAgentConfigs: (sessionId: string) => Promise<unknown>;
}

export interface CediaAgentConfigInput {
  readonly agent: string;
  readonly enabled?: boolean;
  readonly model?: string;
  readonly prewalk?: string;
  readonly advisor?: string;
}

interface CediaAdvisorCommandInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly op: "set";
  readonly enabled: boolean;
}

interface CediaAdvisorApi {
  readonly getAdvisor: (sessionId: string) => Promise<unknown>;
  readonly setAdvisor: (sessionId: string, body: CediaAdvisorCommandInput) => Promise<unknown>;
  readonly getAdvisorHistory: (sessionId: string) => Promise<unknown>;
}

interface CediaPolicyApi {
  readonly getPolicy: () => Promise<unknown>;
}

interface CediaModelStateApi {
  readonly getModelState: (sessionId: string) => Promise<unknown>;
}

interface CediaModelRolesApi {
  readonly getModelRoles: (sessionId: string) => Promise<unknown>;
  readonly applyModelRole: (sessionId: string, role: string) => Promise<unknown>;
  readonly setModelRole: (sessionId: string, role: string, modelId: string | null) => Promise<unknown>;
}

interface CediaAccountsApi {
  readonly getAccounts: (sessionId: string) => Promise<unknown>;
  readonly pinAccount: (sessionId: string, credentialId: number) => Promise<unknown>;
  readonly setServiceTier: (sessionId: string, family: string, tier: string | null) => Promise<unknown>;
}

function getCediaPolicyApi(): CediaPolicyApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaPolicyApi> };
  if (typeof api.cedia?.getPolicy !== "function") {
    throw new Error("Cedia policy bridge is unavailable.");
  }
  return api.cedia as CediaPolicyApi;
}

function getCediaModelRolesApi(): CediaModelRolesApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaModelRolesApi> };
  if (typeof api.cedia?.getModelRoles !== "function" || typeof api.cedia?.applyModelRole !== "function" || typeof api.cedia?.setModelRole !== "function") {
    throw new Error("Cedia model roles bridge is unavailable.");
  }
  return api.cedia as CediaModelRolesApi;
}

function getCediaModelStateApi(): CediaModelStateApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaModelStateApi> };
  if (typeof api.cedia?.getModelState !== "function") {
    throw new Error("Cedia model state bridge is unavailable.");
  }
  return api.cedia as CediaModelStateApi;
}

function getCediaAccountsApi(): CediaAccountsApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaAccountsApi> };
  if (
    typeof api.cedia?.getAccounts !== "function" ||
    typeof api.cedia?.pinAccount !== "function" ||
    typeof api.cedia?.setServiceTier !== "function"
  ) {
    throw new Error("Cedia provider account bridge is unavailable.");
  }
  return api.cedia as CediaAccountsApi;
}

function policyMode(value: unknown): CediaPolicyMode {
  if (value === "unset" || value === "yes" || value === "no") return value;
  throw new Error("Cedia host returned an invalid OMP credit policy mode.");
}

function parseCediaCreditPolicy(value: unknown): CediaCreditPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid OMP credit policy.");
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((field) => !["guardActive", "stored", "effective", "overridden", "reason"].includes(field))) {
    throw new Error("Cedia host returned an invalid OMP credit policy.");
  }
  if (
    typeof row.guardActive !== "boolean" ||
    typeof row.overridden !== "boolean" ||
    typeof row.reason !== "string" ||
    row.reason.trim().length === 0
  ) {
    throw new Error("Cedia host returned an invalid OMP credit policy.");
  }
  return {
    guardActive: row.guardActive,
    stored: policyMode(row.stored),
    effective: policyMode(row.effective),
    overridden: row.overridden,
    reason: row.reason,
  };
}

export function parseCediaPolicyAnswer(value: unknown): CediaPolicyAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid OMP policy response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    if (Object.keys(row).some((field) => !["state", "reason"].includes(field))) {
      throw new Error("Cedia host returned an invalid OMP policy response.");
    }
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
      throw new Error("Cedia host returned an invalid OMP policy response.");
    }
    return { state: "unavailable", reason: row.reason };
  }
  if (row.state !== "available" || Object.keys(row).some((field) => !["state", "answer"].includes(field))) {
    throw new Error("Cedia host returned an invalid OMP policy response.");
  }
  return { state: "available", answer: parseCediaCreditPolicy(row.answer) };
}

export function serverPolicyQueryOptions(enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.policy(),
    queryFn: async () => parseCediaPolicyAnswer(await getCediaPolicyApi().getPolicy()),
    enabled,
    staleTime: 0,
    // Re-read on focus or when this destination becomes active; a timer would invent a policy
    // cadence instead of reflecting the live process that the host reports.
    refetchOnWindowFocus: true,
    retry: false,
  });
}

function nullableString(value: unknown, message: string): string | null {
  if (value === null) return null;
  return usageString(value, message);
}

function cediaStringList(value: unknown, message: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(message);
  }
  return value;
}

function parseCediaRuntimeModel(value: unknown): CediaRuntimeModel | null {
  if (value === null) return null;
  const row = usageRecord(value, "Cedia host returned an invalid runtime model.");
  usageExact(row, ["provider", "id"], "Cedia host returned an invalid runtime model.");
  return {
    provider: usageString(row.provider, "Cedia host returned an invalid runtime model provider."),
    id: usageString(row.id, "Cedia host returned an invalid runtime model id."),
  };
}

function parseCediaRuntimeEffort(value: unknown): CediaRuntimeEffort {
  const row = usageRecord(value, "Cedia host returned an invalid runtime effort.");
  usageExact(row, ["configured", "autoResolved", "isAuto"], "Cedia host returned an invalid runtime effort.");
  return {
    configured: nullableString(row.configured, "Cedia host returned an invalid configured effort."),
    autoResolved: nullableString(row.autoResolved, "Cedia host returned an invalid auto-resolved effort."),
    isAuto: usageBoolean(row.isAuto, "Cedia host returned an invalid auto-effort flag."),
  };
}

function parseCediaServiceTierCurrent(value: unknown): CediaServiceTierCurrent {
  const row = usageRecord(value, "Cedia host returned an invalid service-tier current row.");
  usageExact(row, ["family", "tier"], "Cedia host returned an invalid service-tier current row.");
  return {
    family: usageString(row.family, "Cedia host returned an invalid service-tier family."),
    tier: nullableString(row.tier, "Cedia host returned an invalid service-tier value."),
  };
}

function parseCediaServiceTiers(value: unknown): CediaServiceTiers {
  const row = usageRecord(value, "Cedia host returned an invalid service-tier projection.");
  usageExact(row, ["families", "tiers", "current"], "Cedia host returned an invalid service-tier projection.");
  if (!Array.isArray(row.current)) throw new Error("Cedia host returned invalid service-tier current rows.");
  return {
    families: cediaStringList(row.families, "Cedia host returned invalid service-tier families."),
    tiers: cediaStringList(row.tiers, "Cedia host returned invalid service-tier values."),
    current: row.current.map(parseCediaServiceTierCurrent),
  };
}

export function parseCediaModelStateAnswer(value: unknown): CediaModelStateAnswer {
  const row = usageRecord(value, "Cedia host returned an invalid model-state response.");
  if (row.available === false) {
    usageExact(row, ["available", "reason"], "Cedia host returned an invalid model-state unavailable response.");
    return { available: false, reason: usageString(row.reason, "Cedia host returned an invalid model-state reason.") };
  }
  usageExact(row, ["available", "model", "effort", "serviceTiers"], "Cedia host returned an invalid model-state response.");
  if (row.available !== true) throw new Error("Cedia host returned an invalid model-state response.");
  return {
    available: true,
    model: parseCediaRuntimeModel(row.model),
    effort: parseCediaRuntimeEffort(row.effort),
    serviceTiers: parseCediaServiceTiers(row.serviceTiers),
  };
}

function parseCediaAccount(value: unknown): CediaAccount {
  const row = usageRecord(value, "Cedia host returned an invalid provider account row.");
  usageExact(row, ["credentialId", "label", "active"], "Cedia host returned an invalid provider account row.");
  if (typeof row.credentialId !== "number" || !Number.isSafeInteger(row.credentialId) || row.credentialId < 0) {
    throw new Error("Cedia host returned an invalid provider account credential id.");
  }
  return {
    credentialId: row.credentialId,
    label: nullableString(row.label, "Cedia host returned an invalid provider account label."),
    active: usageBoolean(row.active, "Cedia host returned an invalid provider account active flag."),
  };
}

function parseCediaAccountsProjection(value: unknown): CediaAccountsProjection {
  const row = usageRecord(value, "Cedia host returned an invalid provider account projection.");
  usageExact(row, ["supported", "provider", "accounts", "truncated"], "Cedia host returned an invalid provider account projection.");
  if (!Array.isArray(row.accounts)) throw new Error("Cedia host returned invalid provider account rows.");
  return {
    supported: usageBoolean(row.supported, "Cedia host returned an invalid provider account support flag."),
    provider: nullableString(row.provider, "Cedia host returned an invalid provider account provider."),
    accounts: row.accounts.map(parseCediaAccount),
    truncated: usageBoolean(row.truncated, "Cedia host returned an invalid provider account truncation flag."),
  };
}

export function parseCediaAccountsAnswer(value: unknown): CediaAccountsAnswer {
  const row = usageRecord(value, "Cedia host returned an invalid provider accounts response.");
  if (row.available === false) {
    usageExact(row, ["available", "reason"], "Cedia host returned an invalid provider accounts unavailable response.");
    return { available: false, reason: usageString(row.reason, "Cedia host returned an invalid provider accounts reason.") };
  }
  usageExact(row, ["available", "supported", "provider", "accounts", "truncated"], "Cedia host returned an invalid provider accounts response.");
  if (row.available !== true) throw new Error("Cedia host returned an invalid provider accounts response.");
  const { available: _available, ...projection } = row;
  return { available: true, ...parseCediaAccountsProjection(projection) };
}

export function parseCediaPinAccountAnswer(value: unknown): CediaPinAccountAnswer {
  const row = usageRecord(value, "Cedia host returned an invalid account pin response.");
  usageExact(row, ["pinned", "list"], "Cedia host returned an invalid account pin response.");
  return {
    pinned: usageBoolean(row.pinned, "Cedia host returned an invalid account pin result."),
    list: parseCediaAccountsProjection(row.list),
  };
}

export function parseCediaServiceTierAnswer(value: unknown): CediaServiceTierAnswer {
  const row = usageRecord(value, "Cedia host returned an invalid service-tier response.");
  usageExact(row, ["family", "tier", "serviceTiers"], "Cedia host returned an invalid service-tier response.");
  const family = usageString(row.family, "Cedia host returned an invalid service-tier family.");
  const tier = nullableString(row.tier, "Cedia host returned an invalid service-tier value.");
  const serviceTiers = parseCediaServiceTiers(row.serviceTiers);
  if (!serviceTiers.families.includes(family) || (tier !== null && !serviceTiers.tiers.includes(tier))) {
    throw new Error("Cedia host returned a service-tier value outside its published vocabulary.");
  }
  return {
    family,
    tier,
    serviceTiers,
  };
}

export function serverModelStateQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.modelState(sessionId),
    queryFn: async () => parseCediaModelStateAnswer(await getCediaModelStateApi().getModelState(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
  });
}

export function serverAccountsQueryOptions(sessionId: string, enabled = false) {
  return queryOptions({
    queryKey: serverQueryKeys.accounts(sessionId),
    queryFn: async () => parseCediaAccountsAnswer(await getCediaAccountsApi().getAccounts(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
    retry: false,
  });
}

export function serverPinAccountMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.pinAccount(input.sessionId),
    mutationFn: async (credentialId: number) =>
      parseCediaPinAccountAnswer(await getCediaAccountsApi().pinAccount(input.sessionId, credentialId)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.accounts(input.sessionId), { available: true, ...answer.list });
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.accounts(input.sessionId), refetchType: "none" });
    },
  });
}

export function serverServiceTierMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.serviceTier(input.sessionId),
    mutationFn: async (body: { readonly family: string; readonly tier: string | null }) =>
      parseCediaServiceTierAnswer(await getCediaAccountsApi().setServiceTier(input.sessionId, body.family, body.tier)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData<CediaModelStateAnswer>(serverQueryKeys.modelState(input.sessionId), (current) =>
        current?.available === true ? { ...current, serviceTiers: answer.serviceTiers } : current,
      );
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.modelState(input.sessionId), refetchType: "none" });
    },
  });
}

function parseCediaModelRoleEntry(value: unknown): CediaModelRoleEntry {
  const row = usageRecord(value, "Cedia host returned an invalid model role entry.");
  usageExact(row, ["role", "modelId", "source"], "Cedia host returned an invalid model role entry.");
  const role = usageString(row.role, "Cedia host returned an invalid model role name.");
  const modelId = usageString(row.modelId, "Cedia host returned an invalid model role model.");
  const source = usageString(row.source, "Cedia host returned an invalid model role source.");
  if (role.trim().length === 0 || modelId.trim().length === 0) {
    throw new Error("Cedia host returned an invalid model role entry.");
  }
  return { role, modelId, source };
}

function parseCediaModelRolesTable(row: Record<string, unknown>): {
  readonly cycleOrder: readonly string[];
  readonly roles: readonly CediaModelRoleEntry[];
  readonly storage: string;
} {
  usageExact(row, ["cycleOrder", "roles", "storage"], "Cedia host returned an invalid model roles response.");
  if (!Array.isArray(row.cycleOrder) || !row.cycleOrder.every((entry) => typeof entry === "string")) {
    throw new Error("Cedia host returned an invalid model roles cycle order.");
  }
  if (!Array.isArray(row.roles)) throw new Error("Cedia host returned an invalid model roles list.");
  return {
    cycleOrder: row.cycleOrder,
    roles: row.roles.map((entry) => parseCediaModelRoleEntry(entry)),
    storage: usageString(row.storage, "Cedia host returned an invalid model roles storage."),
  };
}

export function parseCediaModelRolesAnswer(value: unknown): CediaModelRolesAnswer {
  const row = usageRecord(value, "Cedia host returned an invalid model roles response.");
  // The set write answers the bare roles table (the same shape the read wraps
  // as available); accept it as available with identical strictness instead of
  // forcing a wrapper through the durable envelope.
  if (row.available === undefined) {
    return { available: true, ...parseCediaModelRolesTable(row) };
  }
  if (row.available === false) {
    usageExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable model roles response.");
    return { available: false, reason: usageString(row.reason, "Cedia host returned an invalid unavailable model roles reason.") };
  }
  usageExact(row, ["available", "cycleOrder", "roles", "storage"], "Cedia host returned an invalid model roles response.");
  if (row.available !== true) throw new Error("Cedia host returned an invalid model roles response.");
  const { available: _available, ...table } = row;
  return { available: true, ...parseCediaModelRolesTable(table) };
}

export function parseCediaRoleApplyAnswer(value: unknown): CediaRoleApplyAnswer {
  const row = usageRecord(value, "Cedia host returned an invalid role apply response.");
  usageExact(row, ["role", "provider", "model"], "Cedia host returned an invalid role apply response.");
  return {
    role: usageString(row.role, "Cedia host returned an invalid applied role."),
    provider: usageString(row.provider, "Cedia host returned an invalid applied provider."),
    model: usageString(row.model, "Cedia host returned an invalid applied model."),
  };
}

export function serverModelRolesQueryOptions(sessionId: string, enabled = false) {
  return queryOptions({
    queryKey: serverQueryKeys.modelRoles(sessionId),
    queryFn: async () => parseCediaModelRolesAnswer(await getCediaModelRolesApi().getModelRoles(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
    retry: false,
  });
}

export function serverSetRoleMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.setRole(input.sessionId),
    mutationFn: async (assignment: { role: string; modelId: string | null }) =>
      parseCediaModelRolesAnswer(await getCediaModelRolesApi().setModelRole(input.sessionId, assignment.role, assignment.modelId)),
    onSuccess: (answer) => {
      if (answer.available === true) {
        input.queryClient.setQueryData(serverQueryKeys.modelRoles(input.sessionId), answer);
      }
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.modelRoles(input.sessionId), refetchType: "none" });
    },
  });
}

export function serverApplyRoleMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.applyRole(input.sessionId),
    mutationFn: async (role: string) =>
      parseCediaRoleApplyAnswer(await getCediaModelRolesApi().applyModelRole(input.sessionId, role)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData<CediaModelStateAnswer>(serverQueryKeys.modelState(input.sessionId), (current) =>
        current?.available === true ? { ...current, model: { provider: answer.provider, id: answer.model } } : current,
      );
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.modelState(input.sessionId), refetchType: "none" });
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.modelRoles(input.sessionId), refetchType: "none" });
    },
  });
}

function getCediaPlanApi(): CediaPlanApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaPlanApi> };
  if (typeof api.cedia?.getPlan !== "function" || typeof api.cedia?.setPlan !== "function") {
    throw new Error("Cedia plan bridge is unavailable.");
  }
  return api.cedia as CediaPlanApi;
}

function getCediaProgressApi(): CediaProgressApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaProgressApi> };
  if (typeof api.cedia?.getProgress !== "function") {
    throw new Error("Cedia progress bridge is unavailable.");
  }
  return api.cedia as CediaProgressApi;
}

interface CediaPauseApi {
  readonly getRunPause: (sessionId: string) => Promise<unknown>;
  readonly setRunPause: (sessionId: string, input: CediaPauseInput) => Promise<unknown>;
}

interface CediaBashApi {
  readonly execBash: (sessionId: string, input: CediaBashExecInput) => Promise<unknown>;
  readonly abortBash: (sessionId: string, input?: { readonly commandId?: string; readonly incarnation?: string }) => Promise<unknown>;
}

function getCediaQueueApi(): CediaQueueApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaQueueApi> };
  if (typeof api.cedia?.getQueue !== "function" || typeof api.cedia?.dropQueued !== "function") {
    throw new Error("Cedia queue bridge is unavailable.");
  }
  return api.cedia as CediaQueueApi;
}

interface CediaPythonApi {
  readonly execPython: (sessionId: string, input: CediaPythonExecInput) => Promise<unknown>;
  readonly abortPython: (sessionId: string, input?: { readonly commandId?: string; readonly incarnation?: string }) => Promise<unknown>;
}

function getCediaBashApi(): CediaBashApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaBashApi> };
  if (typeof api.cedia?.execBash !== "function" || typeof api.cedia?.abortBash !== "function") {
    throw new Error("Cedia shell bridge is unavailable.");
  }
  return api.cedia as CediaBashApi;
}

function getCediaPythonApi(): CediaPythonApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaPythonApi> };
  if (typeof api.cedia?.execPython !== "function" || typeof api.cedia?.abortPython !== "function") {
    throw new Error("Cedia Python bridge is unavailable.");
  }
  return api.cedia as CediaPythonApi;
}

function getCediaPauseApi(): CediaPauseApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaPauseApi> };
  if (typeof api.cedia?.getRunPause !== "function" || typeof api.cedia?.setRunPause !== "function") {
    throw new Error("Cedia run pause bridge is unavailable.");
  }
  return api.cedia as CediaPauseApi;
}

function getCediaContextApi(): CediaContextApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaContextApi> };
  if (
    typeof api.cedia?.getContext !== "function" ||
    typeof api.cedia?.dropContextImages !== "function" ||
    typeof api.cedia?.shakeContext !== "function" ||
    typeof api.cedia?.abortCompaction !== "function"
  ) {
    throw new Error("Cedia context bridge is unavailable.");
  }
  return api.cedia as CediaContextApi;
}

function getCediaHistoryApi(): CediaHistoryApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaHistoryApi> };
  if (
    typeof api.cedia?.getHistory !== "function" ||
    typeof api.cedia?.getTranscript !== "function" ||
    typeof api.cedia?.clearContext !== "function" ||
    typeof api.cedia?.freshSession !== "function"
  ) {
    throw new Error("Cedia history bridge is unavailable.");
  }
  return api.cedia as CediaHistoryApi;
}

function getCediaToolCatalogApi(): CediaToolCatalogApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaToolCatalogApi> };
  if (
    typeof api.cedia?.getToolCatalog !== "function" ||
    typeof api.cedia?.setActiveTools !== "function" ||
    typeof api.cedia?.refreshSkills !== "function"
  ) {
    throw new Error("Cedia tool catalog bridge is unavailable.");
  }
  return api.cedia as CediaToolCatalogApi;
}

interface CediaToolCodeModeApi {
  readonly getCodeMode: (sessionId: string) => Promise<unknown>;
}

function getCediaToolCodeModeApi(): CediaToolCodeModeApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaToolCodeModeApi> };
  if (typeof api.cedia?.getCodeMode !== "function") {
    throw new Error("Cedia Code Mode bridge is unavailable.");
  }
  return api.cedia as CediaToolCodeModeApi;
}

interface CediaToolExtensionsApi {
  readonly getExtensions: (sessionId: string) => Promise<unknown>;
  readonly setExtensionEnabled: (sessionId: string, id: string, enabled: boolean) => Promise<unknown>;
}

function getCediaToolExtensionsApi(): CediaToolExtensionsApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaToolExtensionsApi> };
  if (typeof api.cedia?.getExtensions !== "function" || typeof api.cedia?.setExtensionEnabled !== "function") {
    throw new Error("Cedia extension catalog bridge is unavailable.");
  }
  return api.cedia as CediaToolExtensionsApi;
}

function getCediaTreeApi(): CediaTreeApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaTreeApi> };
  if (typeof api.cedia?.getTree !== "function" || typeof api.cedia?.navigateTree !== "function") {
    throw new Error("Cedia session tree bridge is unavailable.");
  }
  return api.cedia as CediaTreeApi;
}

function getCediaPrewalkApi(): CediaPrewalkApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaPrewalkApi> };
  if (typeof api.cedia?.getPrewalk !== "function") {
    throw new Error("Cedia prewalk bridge is unavailable.");
  }
  return api.cedia as CediaPrewalkApi;
}

interface CediaLoopApi {
  readonly getLoop: (sessionId: string) => Promise<unknown>;
  readonly disableLoop: (sessionId: string, input: CediaLoopInput) => Promise<unknown>;
}

function getCediaLoopApi(): CediaLoopApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaLoopApi> };
  if (typeof api.cedia?.getLoop !== "function" || typeof api.cedia?.disableLoop !== "function") {
    throw new Error("Cedia loop mode bridge is unavailable.");
  }
  return api.cedia as CediaLoopApi;
}

interface CediaBtwApi {
  readonly getBtw: (sessionId: string) => Promise<unknown>;
  readonly askBtw: (sessionId: string, input: CediaBtwAskInput) => Promise<unknown>;
  readonly branchBtw: (sessionId: string, input: CediaBtwBranchInput) => Promise<unknown>;
}

function getCediaBtwApi(): CediaBtwApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaBtwApi> };
  if (typeof api.cedia?.getBtw !== "function" || typeof api.cedia?.askBtw !== "function" || typeof api.cedia?.branchBtw !== "function") {
    throw new Error("Cedia side-question bridge is unavailable.");
  }
  return api.cedia as CediaBtwApi;
}

interface CediaOmfgApi {
  readonly getOmfg: (sessionId: string) => Promise<unknown>;
  readonly draftOmfg: (sessionId: string, input: CediaOmfgDraftInput) => Promise<unknown>;
  readonly saveOmfg: (sessionId: string, input: CediaOmfgSaveInput) => Promise<unknown>;
  readonly abortOmfg: (sessionId: string, input: CediaOmfgAbortInput) => Promise<unknown>;
}

function getCediaOmfgApi(): CediaOmfgApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaOmfgApi> };
  if (typeof api.cedia?.getOmfg !== "function" || typeof api.cedia?.draftOmfg !== "function" || typeof api.cedia?.saveOmfg !== "function" || typeof api.cedia?.abortOmfg !== "function") {
    throw new Error("Cedia rule-forging bridge is unavailable.");
  }
  return api.cedia as CediaOmfgApi;
}

interface CediaCleanseApi {
  readonly getCleanse: (sessionId: string) => Promise<unknown>;
  readonly runCleanse: (sessionId: string, input: CediaCleanseRunInput) => Promise<unknown>;
  readonly abortCleanse: (sessionId: string, input: CediaCleanseAbortInput) => Promise<unknown>;
}

function getCediaCleanseApi(): CediaCleanseApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaCleanseApi> };
  if (typeof api.cedia?.getCleanse !== "function" || typeof api.cedia?.runCleanse !== "function" || typeof api.cedia?.abortCleanse !== "function") {
    throw new Error("Cedia cleanse bridge is unavailable.");
  }
  return api.cedia as CediaCleanseApi;
}

function getCediaUsageApi(): CediaUsageApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaUsageApi> };
  if (typeof api.cedia?.getUsage !== "function") {
    throw new Error("Cedia usage bridge is unavailable.");
  }
  return api.cedia as CediaUsageApi;
}

function getCediaCreditsApi(): CediaCreditsApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaCreditsApi> };
  if (typeof api.cedia?.getCredits !== "function" || typeof api.cedia?.redeemCredit !== "function") {
    throw new Error("Cedia credits bridge is unavailable.");
  }
  return api.cedia as CediaCreditsApi;
}

function getCediaMemoryApi(): CediaMemoryApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaMemoryApi> };
  if (typeof api.cedia?.getMemory !== "function" || typeof api.cedia?.applyMemoryBackend !== "function") {
    throw new Error("Cedia memory bridge is unavailable.");
  }
  return api.cedia as CediaMemoryApi;
}

function getCediaAgentsApi(): CediaAgentsApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaAgentsApi> };
  if (
    typeof api.cedia?.getAgents !== "function" ||
    typeof api.cedia?.getAgentTranscript !== "function" ||
    typeof api.cedia?.killAgent !== "function" ||
    typeof api.cedia?.reviveAgent !== "function" ||
    typeof api.cedia?.configureAgent !== "function" ||
    typeof api.cedia?.getAgentConfigs !== "function"
  ) {
    throw new Error("Cedia agents bridge is unavailable.");
  }
  return api.cedia as CediaAgentsApi;
}

interface CediaAdvisorConfigApi {
  readonly getAdvisorConfig: (sessionId: string, scope: CediaAdvisorConfigScope) => Promise<unknown>;
  readonly setAdvisorConfig: (sessionId: string, input: CediaAdvisorConfigInput) => Promise<unknown>;
}

function getCediaAdvisorApi(): CediaAdvisorApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaAdvisorApi> };
  if (
    typeof api.cedia?.getAdvisor !== "function" ||
    typeof api.cedia?.setAdvisor !== "function" ||
    typeof api.cedia?.getAdvisorHistory !== "function"
  ) {
    throw new Error("Cedia advisor bridge is unavailable.");
  }
  return api.cedia as CediaAdvisorApi;
}

function asPlan(value: unknown): CediaPlanMode | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cedia host returned an invalid plan state.");
  const row = value as Record<string, unknown>;
  if (typeof row.enabled !== "boolean" || (row.paused !== undefined && typeof row.paused !== "boolean") || (row.planFilePath !== undefined && typeof row.planFilePath !== "string") || (row.workflow !== "parallel" && row.workflow !== "iterative") || typeof row.reentry !== "boolean") {
    throw new Error("Cedia host returned an invalid plan state.");
  }
  return {
    enabled: row.enabled,
    paused: row.paused === true,
    ...(row.planFilePath === undefined ? {} : { planFilePath: row.planFilePath }),
    workflow: row.workflow,
    reentry: row.reentry,
  };
}

function asReview(value: unknown): CediaPlanReview | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cedia host returned an invalid plan review.");
  const row = value as Record<string, unknown>;
  if (typeof row.reviewId !== "number" || !Number.isSafeInteger(row.reviewId) || typeof row.title !== "string" || typeof row.planFilePath !== "string" || typeof row.planContent !== "string" || typeof row.truncated !== "boolean" || typeof row.createdAt !== "number") {
    throw new Error("Cedia host returned an invalid plan review.");
  }
  return {
    reviewId: row.reviewId,
    title: row.title,
    planFilePath: row.planFilePath,
    planContent: row.planContent,
    truncated: row.truncated,
    createdAt: row.createdAt,
  };
}

export function parseCediaPlanAnswer(value: unknown): CediaPlanAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cedia host returned an invalid plan response.");
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    return { state: "unavailable", reason: typeof row.reason === "string" && row.reason.trim() ? row.reason : "The Cedia plan runtime is unavailable." };
  }
  if (row.state !== "available" || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || !row.vibe || typeof row.vibe !== "object" || typeof (row.vibe as Record<string, unknown>).enabled !== "boolean") {
    throw new Error("Cedia host returned an invalid plan response.");
  }
  return {
    state: "available",
    revision: row.revision,
    plan: asPlan(row.plan),
    vibe: { enabled: (row.vibe as Record<string, unknown>).enabled as boolean },
    review: asReview(row.review),
    ...(typeof row.changed === "boolean" ? { changed: row.changed } : {}),
    ...(typeof row.reason === "string" ? { reason: row.reason } : {}),
  };
}

export function serverPlanQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.plan(sessionId),
    queryFn: async () => parseCediaPlanAnswer(await getCediaPlanApi().getPlan(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchInterval: enabled && sessionId.length > 0 ? 1_000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function serverPlanMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.plan(input.sessionId),
    mutationFn: async (body: Record<string, unknown>) => parseCediaPlanAnswer(await getCediaPlanApi().setPlan(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.plan(input.sessionId), answer);
    },
  });
}

function asProgressTask(value: unknown): CediaProgressTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid progress task.");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.content !== "string" ||
    (row.status !== "pending" &&
      row.status !== "in_progress" &&
      row.status !== "completed" &&
      row.status !== "blocked") ||
    (row.blocker !== undefined && typeof row.blocker !== "string")
  ) {
    throw new Error("Cedia host returned an invalid progress task.");
  }
  return {
    content: row.content,
    status: row.status,
    ...(row.blocker === undefined ? {} : { blocker: row.blocker }),
  };
}

function asProgressPhase(value: unknown): CediaProgressPhase {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid progress phase.");
  }
  const row = value as Record<string, unknown>;
  if (typeof row.name !== "string" || !Array.isArray(row.tasks)) {
    throw new Error("Cedia host returned an invalid progress phase.");
  }
  return {
    name: row.name,
    tasks: row.tasks.map(asProgressTask),
  };
}

export function parseCediaProgressAnswer(value: unknown): CediaProgressAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid progress response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    return {
      state: "unavailable",
      reason:
        typeof row.reason === "string" && row.reason.trim().length > 0
          ? row.reason
          : "The Cedia progress runtime is unavailable.",
    };
  }
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    !Array.isArray(row.phases)
  ) {
    throw new Error("Cedia host returned an invalid progress response.");
  }
  return {
    state: "available",
    revision: row.revision,
    phases: row.phases.map(asProgressPhase),
  };
}

export function serverProgressQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.progress(sessionId),
    queryFn: async () => parseCediaProgressAnswer(await getCediaProgressApi().getProgress(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    // Progress is invalidated by the native thread activity stream. It must not run an
    // independent timer that can race OMP's own todo updates.
    refetchOnWindowFocus: true,
    retry: false,
  });
}

function asQueueEntry(value: unknown): CediaQueueEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid queue entry.");
  }
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== "text" && key !== "truncated" && key !== "images") {
      throw new Error("Cedia host returned an invalid queue entry.");
    }
  }
  if (
    typeof row.text !== "string" ||
    row.text.length > 4096 ||
    typeof row.truncated !== "boolean" ||
    typeof row.images !== "number" ||
    !Number.isSafeInteger(row.images) ||
    row.images < 0
  ) {
    throw new Error("Cedia host returned an invalid queue entry.");
  }
  return { text: row.text, truncated: row.truncated, images: row.images };
}

function asQueueEntries(value: unknown): CediaQueueEntry[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error("Cedia host returned an invalid queue list.");
  }
  return value.map(asQueueEntry);
}

export function parseCediaQueueAnswer(value: unknown): CediaQueueAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid queue response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    for (const key of Object.keys(row)) {
      if (key !== "state" && key !== "reason") {
        throw new Error("Cedia host returned an invalid queue unavailable response.");
      }
    }
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
      throw new Error("Cedia host returned an invalid queue unavailable response.");
    }
    return { state: "unavailable", reason: row.reason };
  }
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  ) {
    throw new Error("Cedia host returned an invalid queue response.");
  }
  for (const key of Object.keys(row)) {
    if (key !== "state" && key !== "revision" && key !== "steering" && key !== "followUp" && key !== "dropped") {
      throw new Error("Cedia host returned an invalid queue response.");
    }
  }
  const answer = {
    state: "available" as const,
    revision: row.revision,
    steering: asQueueEntries(row.steering),
    followUp: asQueueEntries(row.followUp),
  };
  return {
    ...answer,
    ...(row.dropped === undefined ? {} : { dropped: asQueueEntries(row.dropped) }),
  } satisfies Extract<CediaQueueAnswer, { state: "available" }>;
}

/** A drop must tell the composer what it removed; a missing list is a malformed mutation answer. */
export function parseCediaQueueDropAnswer(value: unknown): CediaQueueAnswer {
  const answer = parseCediaQueueAnswer(value);
  if (answer.state === "available" && answer.dropped === undefined) {
    throw new Error("Cedia host returned an invalid queue drop response.");
  }
  return answer;
}

export function serverQueueQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.queue(sessionId),
    queryFn: async () => parseCediaQueueAnswer(await getCediaQueueApi().getQueue(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    // Queue changes arrive with the same native thread activity stream as the sibling panels.
    // There is deliberately no independent timer that could claim a queue the runtime did not
    // report at a turn boundary.
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function serverQueueMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.queue(input.sessionId),
    mutationFn: async (body: CediaQueueDropInput) =>
      parseCediaQueueDropAnswer(await getCediaQueueApi().dropQueued(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.queue(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.queue(input.sessionId) });
    },
  });
}

function parseCediaQueueRowAnswer(value: unknown, outcome: "removed" | "promoted"): CediaQueueAnswer {
  const answer = parseCediaQueueAnswer(value);
  if (answer.state === "available") {
    const flag = (answer as unknown as Record<string, unknown>)[outcome];
    if (flag !== true && flag !== false) throw new Error("Cedia host returned an invalid queue row response.");
  }
  return answer;
}

export function serverQueueRowMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: [...serverMutationKeys.queue(input.sessionId), "row"],
    mutationFn: async (body: CediaQueueRemoveInput | ({ readonly promote: true } & CediaQueuePromoteInput)) => {
      const api = getCediaQueueApi();
      if ("promote" in body) {
        if (typeof api.promoteQueuedMessage !== "function") throw new Error("Queue promote needs a newer window shell.");
        const { promote: _promote, ...rest } = body;
        return parseCediaQueueRowAnswer(await api.promoteQueuedMessage(input.sessionId, rest), "promoted");
      }
      if (typeof api.removeQueuedMessage !== "function") throw new Error("Queue remove needs a newer window shell.");
      return parseCediaQueueRowAnswer(await api.removeQueuedMessage(input.sessionId, body), "removed");
    },
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.queue(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.queue(input.sessionId) });
    },
  });
}

export function parseCediaPauseAnswer(value: unknown): CediaPauseAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid run pause response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    for (const key of Object.keys(row)) {
      if (key !== "state" && key !== "reason") {
        throw new Error("Cedia host returned an invalid run pause unavailable response.");
      }
    }
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
      throw new Error("Cedia host returned an invalid run pause unavailable response.");
    }
    return { state: "unavailable", reason: row.reason };
  }
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  ) {
    throw new Error("Cedia host returned an invalid run pause response.");
  }
  for (const key of Object.keys(row)) {
    if (key !== "state" && key !== "revision" && key !== "paused" && key !== "pausedAt") {
      throw new Error("Cedia host returned an invalid run pause response.");
    }
  }
  if (typeof row.paused !== "boolean") {
    throw new Error("Cedia host returned an invalid run pause state.");
  }
  // The runtime omits the pause start when nothing is paused: absence reads as running,
  // never as a pause since epoch zero.
  const pausedAt = row.pausedAt === null || row.pausedAt === undefined
    ? undefined
    : typeof row.pausedAt === "number" && Number.isSafeInteger(row.pausedAt) && row.pausedAt >= 0
      ? row.pausedAt
      : (() => { throw new Error("Cedia host returned an invalid run pause start."); })();
  return {
    state: "available" as const,
    revision: row.revision,
    paused: row.paused,
    ...(pausedAt === undefined ? {} : { pausedAt }),
  };
}

export function serverPauseQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.pause(sessionId),
    queryFn: async () => parseCediaPauseAnswer(await getCediaPauseApi().getRunPause(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    // Pause changes arrive with the same native thread activity stream as the sibling panels.
    // There is deliberately no independent timer that could claim a pause the runtime did not
    // report.
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function parseCediaBashAnswer(value: unknown): CediaBashAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid shell response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    for (const key of Object.keys(row)) {
      if (key !== "state" && key !== "reason") {
        throw new Error("Cedia host returned an invalid shell unavailable response.");
      }
    }
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
      throw new Error("Cedia host returned an invalid shell unavailable response.");
    }
    return { state: "unavailable", reason: row.reason };
  }
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  ) {
    throw new Error("Cedia host returned an invalid shell response.");
  }
  for (const key of Object.keys(row)) {
    if (key !== "state" && key !== "revision" && key !== "exitCode" && key !== "output" && key !== "outputTruncated" && key !== "cancelled" && key !== "timedOut" && key !== "workingDir" && key !== "images") {
      throw new Error("Cedia host returned an invalid shell response.");
    }
  }
  if ((row.exitCode !== null && (typeof row.exitCode !== "number" || !Number.isSafeInteger(row.exitCode) || row.exitCode < 0)) || typeof row.output !== "string") {
    throw new Error("Cedia host returned an invalid shell result.");
  }
  if (typeof row.outputTruncated !== "boolean" || typeof row.cancelled !== "boolean" || typeof row.timedOut !== "boolean") {
    throw new Error("Cedia host returned an invalid shell result.");
  }
  if (typeof row.images !== "number" || !Number.isSafeInteger(row.images) || row.images < 0) {
    throw new Error("Cedia host returned an invalid shell result.");
  }
  // The runtime omits the working directory when it cannot name one; absence reads as
  // unknown, never as the project root.
  const workingDir = row.workingDir === null || row.workingDir === undefined
    ? undefined
    : typeof row.workingDir === "string" && row.workingDir.length > 0
      ? row.workingDir
      : (() => { throw new Error("Cedia host returned an invalid shell working directory."); })();
  return {
    state: "available" as const,
    revision: row.revision,
    exitCode: row.exitCode,
    output: row.output,
    outputTruncated: row.outputTruncated,
    cancelled: row.cancelled,
    timedOut: row.timedOut,
    ...(workingDir === undefined ? {} : { workingDir }),
    images: row.images,
  };
}

export function parseCediaBashAbortAnswer(value: unknown): CediaBashAbortAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid shell abort response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    for (const key of Object.keys(row)) {
      if (key !== "state" && key !== "reason") {
        throw new Error("Cedia host returned an invalid shell abort unavailable response.");
      }
    }
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
      throw new Error("Cedia host returned an invalid shell abort unavailable response.");
    }
    return { state: "unavailable", reason: row.reason };
  }
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    typeof row.aborted !== "boolean"
  ) {
    throw new Error("Cedia host returned an invalid shell abort response.");
  }
  for (const key of Object.keys(row)) {
    if (key !== "state" && key !== "revision" && key !== "aborted") {
      throw new Error("Cedia host returned an invalid shell abort response.");
    }
  }
  return { state: "available" as const, revision: row.revision, aborted: row.aborted };
}

export function serverBashExecMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.bashExec(input.sessionId),
    mutationFn: async (body: CediaBashExecInput) =>
      parseCediaBashAnswer(await getCediaBashApi().execBash(input.sessionId, body)),
  });
}

export function serverBashAbortMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.bashAbort(input.sessionId),
    mutationFn: async (body?: { readonly commandId?: string; readonly incarnation?: string }) =>
      parseCediaBashAbortAnswer(await getCediaBashApi().abortBash(input.sessionId, body)),
  });
}

export function parseCediaPythonAnswer(value: unknown): CediaPythonAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid Python response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    for (const key of Object.keys(row)) {
      if (key !== "state" && key !== "reason") {
        throw new Error("Cedia host returned an invalid Python unavailable response.");
      }
    }
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
      throw new Error("Cedia host returned an invalid Python unavailable response.");
    }
    return { state: "unavailable", reason: row.reason };
  }
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  ) {
    throw new Error("Cedia host returned an invalid Python response.");
  }
  for (const key of Object.keys(row)) {
    if (key !== "state" && key !== "revision" && key !== "exitCode" && key !== "output" && key !== "outputTruncated" && key !== "cancelled" && key !== "displayOutputs") {
      throw new Error("Cedia host returned an invalid Python response.");
    }
  }
  if ((row.exitCode !== null && (typeof row.exitCode !== "number" || !Number.isSafeInteger(row.exitCode) || row.exitCode < 0)) || typeof row.output !== "string") {
    throw new Error("Cedia host returned an invalid Python result.");
  }
  if (typeof row.outputTruncated !== "boolean" || typeof row.cancelled !== "boolean") {
    throw new Error("Cedia host returned an invalid Python result.");
  }
  if (typeof row.displayOutputs !== "number" || !Number.isSafeInteger(row.displayOutputs) || row.displayOutputs < 0) {
    throw new Error("Cedia host returned an invalid Python result.");
  }
  return {
    state: "available" as const,
    revision: row.revision,
    exitCode: row.exitCode,
    output: row.output,
    outputTruncated: row.outputTruncated,
    cancelled: row.cancelled,
    displayOutputs: row.displayOutputs,
  };
}

export function parseCediaPythonAbortAnswer(value: unknown): CediaPythonAbortAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid Python abort response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    for (const key of Object.keys(row)) {
      if (key !== "state" && key !== "reason") {
        throw new Error("Cedia host returned an invalid Python abort unavailable response.");
      }
    }
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
      throw new Error("Cedia host returned an invalid Python abort unavailable response.");
    }
    return { state: "unavailable", reason: row.reason };
  }
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    typeof row.aborted !== "boolean"
  ) {
    throw new Error("Cedia host returned an invalid Python abort response.");
  }
  for (const key of Object.keys(row)) {
    if (key !== "state" && key !== "revision" && key !== "aborted") {
      throw new Error("Cedia host returned an invalid Python abort response.");
    }
  }
  return { state: "available" as const, revision: row.revision, aborted: row.aborted };
}

export function serverPythonExecMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.pythonExec(input.sessionId),
    mutationFn: async (body: CediaPythonExecInput) =>
      parseCediaPythonAnswer(await getCediaPythonApi().execPython(input.sessionId, body)),
  });
}

export function serverPythonAbortMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.pythonAbort(input.sessionId),
    mutationFn: async (body?: { readonly commandId?: string; readonly incarnation?: string }) =>
      parseCediaPythonAbortAnswer(await getCediaPythonApi().abortPython(input.sessionId, body)),
  });
}

export function serverPauseMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.pause(input.sessionId),
    mutationFn: async (body: CediaPauseInput) =>
      parseCediaPauseAnswer(await getCediaPauseApi().setRunPause(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.pause(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.pause(input.sessionId) });
    },
  });
}

function contextInteger(value: unknown, message: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error(message);
  return value;
}

function parseCediaContextUsage(value: unknown): CediaContextUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid context usage.");
  }
  const row = value as Record<string, unknown>;
  const fields = [
    "contextWindow",
    "anchored",
    "usedTokens",
    "systemPromptTokens",
    "systemToolsTokens",
    "systemContextTokens",
    "skillsTokens",
    "messagesTokens",
  ];
  if (Object.keys(row).some((field) => !fields.includes(field))) {
    throw new Error("Cedia host returned an invalid context usage.");
  }
  if (typeof row.anchored !== "boolean") {
    throw new Error("Cedia host returned an invalid context usage.");
  }
  return {
    contextWindow: contextInteger(row.contextWindow, "Cedia host returned an invalid context window.", 1),
    anchored: row.anchored,
    usedTokens: contextInteger(row.usedTokens, "Cedia host returned an invalid context token count."),
    systemPromptTokens: contextInteger(row.systemPromptTokens, "Cedia host returned an invalid system prompt token count."),
    systemToolsTokens: contextInteger(row.systemToolsTokens, "Cedia host returned an invalid system tools token count."),
    systemContextTokens: contextInteger(row.systemContextTokens, "Cedia host returned an invalid system context token count."),
    skillsTokens: contextInteger(row.skillsTokens, "Cedia host returned an invalid skills token count."),
    messagesTokens: contextInteger(row.messagesTokens, "Cedia host returned an invalid messages token count."),
  };
}

function contextShakeMode(value: unknown): CediaContextShakeMode {
  if (value === "elide" || value === "images" || value === "thinking") return value;
  throw new Error("Cedia host returned an invalid context shake mode.");
}

function parseCediaContextShakeResult(value: unknown): CediaContextShakeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid context shake result.");
  }
  const row = value as Record<string, unknown>;
  const fields = [
    "mode",
    "toolResultsDropped",
    "blocksDropped",
    "imagesDropped",
    "thinkingBlocksDropped",
    "tokensFreed",
    "artifactId",
  ];
  if (Object.keys(row).some((field) => !fields.includes(field))) {
    throw new Error("Cedia host returned an invalid context shake result.");
  }
  if (
    row.artifactId !== undefined &&
    (typeof row.artifactId !== "string" || row.artifactId.trim().length === 0)
  ) {
    throw new Error("Cedia host returned an invalid context shake artifact.");
  }
  return {
    mode: contextShakeMode(row.mode),
    toolResultsDropped: contextInteger(row.toolResultsDropped, "Cedia host returned an invalid tool-result drop count."),
    blocksDropped: contextInteger(row.blocksDropped, "Cedia host returned an invalid context block drop count."),
    ...(row.imagesDropped === undefined ? {} : { imagesDropped: contextInteger(row.imagesDropped, "Cedia host returned an invalid image drop count.") }),
    ...(row.thinkingBlocksDropped === undefined ? {} : { thinkingBlocksDropped: contextInteger(row.thinkingBlocksDropped, "Cedia host returned an invalid thinking-block drop count.") }),
    tokensFreed: contextInteger(row.tokensFreed, "Cedia host returned an invalid reclaimed token count."),
    ...(row.artifactId === undefined ? {} : { artifactId: row.artifactId }),
  };
}

function parseCediaContextAnswerInternal(value: unknown, allowRemoved: boolean, allowShake = false): CediaContextAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid context response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    if (Object.keys(row).some((field) => !["state", "reason"].includes(field))) {
      throw new Error("Cedia host returned an invalid context unavailable response.");
    }
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
      throw new Error("Cedia host returned an invalid context unavailable response.");
    }
    return { state: "unavailable", reason: row.reason };
  }
  const allowed = ["state", "revision", "usage", "compacting", "speculation", ...(allowRemoved ? ["removed"] : []), ...(allowShake ? ["shake"] : [])];
  if (
    row.state !== "available" ||
    Object.keys(row).some((field) => !allowed.includes(field)) ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    typeof row.compacting !== "boolean" ||
    (row.speculation !== "idle" && row.speculation !== "running" && row.speculation !== "armed")
  ) {
    throw new Error("Cedia host returned an invalid context response.");
  }
  const usage = row.usage === undefined ? undefined : parseCediaContextUsage(row.usage);
  if (allowRemoved && row.removed !== undefined) {
    contextInteger(row.removed, "Cedia host returned an invalid removed image count.");
  }
  const shake = allowShake && row.shake !== undefined ? parseCediaContextShakeResult(row.shake) : undefined;
  return {
    state: "available",
    revision: row.revision,
    ...(usage === undefined ? {} : { usage }),
    compacting: row.compacting,
    speculation: row.speculation,
    ...(allowRemoved && row.removed !== undefined ? { removed: row.removed as number } : {}),
    ...(shake === undefined ? {} : { shake }),
  };
}

export function parseCediaContextAnswer(value: unknown): CediaContextAnswer {
  return parseCediaContextAnswerInternal(value, false);
}

export function parseCediaContextDropAnswer(value: unknown): CediaContextAnswer {
  const answer = parseCediaContextAnswerInternal(value, true);
  if (answer.state === "available" && answer.removed === undefined) {
    throw new Error("Cedia host returned an invalid context drop response.");
  }
  return answer;
}

export function parseCediaContextShakeAnswer(value: unknown): CediaContextAnswer {
  const answer = parseCediaContextAnswerInternal(value, false, true);
  if (answer.state === "available" && answer.shake === undefined) {
    throw new Error("Cedia host returned an invalid context shake response.");
  }
  return answer;
}

export function parseCediaContextAbortAnswer(value: unknown): CediaContextAnswer {
  return parseCediaContextAnswerInternal(value, false);
}

export function serverContextQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.context(sessionId),
    queryFn: async () => parseCediaContextAnswer(await getCediaContextApi().getContext(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    // Context changes arrive with the runtime's activity stream; a timer could display a count
    // the owner has not reported at a turn boundary.
    refetchOnWindowFocus: true,
    retry: false,
  });
}

function historyRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function historyExact(row: Record<string, unknown>, fields: readonly string[], message: string): void {
  const allowed = new Set(fields);
  if (Object.keys(row).some((field) => !allowed.has(field))) throw new Error(message);
}

function historyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(message);
  return value;
}

function historyCount(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(message);
  return value;
}

function parseCediaOwnerIdentity(value: unknown): CediaOwnerIdentity {
  const row = historyRecord(value, "Cedia host returned an invalid owner identity.");
  historyExact(row, ["mode", "sessionId", "incarnation", "pid", "ownerStartedAt"], "Cedia host returned an invalid owner identity.");
  if (row.mode !== "controller" && row.mode !== "inspect_only") throw new Error("Cedia host returned an invalid owner control mode.");
  if (typeof row.pid !== "number" || !Number.isSafeInteger(row.pid) || row.pid <= 0) {
    throw new Error("Cedia host returned an invalid owner identity.");
  }
  return {
    mode: row.mode,
    sessionId: historyString(row.sessionId, "Cedia host returned an invalid owner identity session."),
    incarnation: historyString(row.incarnation, "Cedia host returned an invalid owner identity incarnation."),
    pid: row.pid,
    ownerStartedAt: historyString(row.ownerStartedAt, "Cedia host returned an invalid owner start time."),
  };
}

function parseCediaOwnerRow(value: unknown): CediaOwnerRow {
  const row = historyRecord(value, "Cedia host returned an invalid owner row.");
  historyExact(row, ["taskId", "title", "archived", "state", "reason", "identity"], "Cedia host returned an invalid owner row.");
  const taskId = historyString(row.taskId, "Cedia host returned an invalid owner task id.");
  const title = historyString(row.title, "Cedia host returned an invalid owner title.");
  if (typeof row.archived !== "boolean") throw new Error("Cedia host returned an invalid owner archive flag.");
  if (row.state !== "attached" && row.state !== "absent" && row.state !== "stale" && row.state !== "conflict") {
    throw new Error("Cedia host returned an invalid owner state.");
  }
  const reason = row.reason === undefined ? undefined : historyString(row.reason, "Cedia host returned an invalid owner reason.");
  const identity = row.identity === undefined ? undefined : parseCediaOwnerIdentity(row.identity);
  if (row.state === "attached") {
    if (!identity || identity.sessionId !== taskId || reason !== undefined) throw new Error("Cedia host returned an invalid attached owner row.");
  } else if (row.state === "stale" || row.state === "conflict") {
    if (reason === undefined || identity !== undefined) throw new Error("Cedia host returned an invalid unresolved owner row.");
  } else if (reason !== undefined || identity !== undefined) {
    throw new Error("Cedia host returned an invalid absent owner row.");
  }
  return {
    taskId,
    title,
    archived: row.archived,
    state: row.state,
    ...(reason === undefined ? {} : { reason }),
    ...(identity === undefined ? {} : { identity }),
  };
}

export function parseCediaOwnerAnswer(value: unknown): CediaOwnerAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid owner listing.");
  historyExact(row, ["owners", "truncated"], "Cedia host returned an invalid owner listing.");
  if (!Array.isArray(row.owners) || typeof row.truncated !== "boolean") {
    throw new Error("Cedia host returned an invalid owner listing.");
  }
  const owners = row.owners.map(parseCediaOwnerRow);
  if (new Set(owners.map((owner) => owner.taskId)).size !== owners.length) {
    throw new Error("Cedia host returned duplicate owner tasks.");
  }
  return { owners, truncated: row.truncated };
}

export function serverOwnersQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.owners(),
    queryFn: async () => parseCediaOwnerAnswer(await getCediaOwnerApi().getOwners()),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    // Owner discovery probes local endpoints. Re-read on explicit focus/reconnect or after
    // Attach; a timer would create repeated socket probes while the picker is merely open.
    refetchInterval: false,
  });
}

export function serverOwnerAttachMutationOptions(input: { readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.ownerAttach(),
    mutationFn: async (body: { readonly taskId: string }) => {
      if (body.taskId.trim().length === 0) throw new Error("Choose a Cedia task owner to attach.");
      return await getCediaOwnerApi().attachOwner(body.taskId);
    },
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.owners() });
    },
  });
}

function parseCediaHistoryCheckpoint(value: unknown): CediaHistoryCheckpoint {
  const row = historyRecord(value, "Cedia host returned an invalid history checkpoint.");
  historyExact(row, ["messageCount", "entryId", "startedAt"], "Cedia host returned an invalid history checkpoint.");
  if (row.entryId !== null && typeof row.entryId !== "string") {
    throw new Error("Cedia host returned an invalid history checkpoint.");
  }
  return {
    messageCount: historyCount(row.messageCount, "Cedia host returned an invalid history message count."),
    entryId: row.entryId as string | null,
    startedAt: historyString(row.startedAt, "Cedia host returned an invalid history checkpoint time."),
  };
}

function parseCediaHistoryRewind(value: unknown): CediaHistoryRewind {
  const row = historyRecord(value, "Cedia host returned an invalid history rewind.");
  historyExact(row, ["report", "reportTruncated", "startedAt", "rewoundAt"], "Cedia host returned an invalid history rewind.");
  if (typeof row.report !== "string" || typeof row.reportTruncated !== "boolean") {
    throw new Error("Cedia host returned an invalid history rewind.");
  }
  return {
    report: row.report,
    reportTruncated: row.reportTruncated,
    startedAt: historyString(row.startedAt, "Cedia host returned an invalid history start time."),
    rewoundAt: historyString(row.rewoundAt, "Cedia host returned an invalid history completion time."),
  };
}

export function parseCediaHistoryAnswer(value: unknown): CediaHistoryAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid history response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable history response.");
    return {
      state: "unavailable",
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable history reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid history response.");
  historyExact(row, ["available", "checkpoint", "lastRewind"], "Cedia host returned an invalid history response.");
  if (row.checkpoint !== null && row.checkpoint === undefined) {
    throw new Error("Cedia host returned an invalid history checkpoint.");
  }
  if (row.lastRewind !== null && row.lastRewind === undefined) {
    throw new Error("Cedia host returned an invalid history rewind.");
  }
  return {
    state: "available",
    checkpoint: row.checkpoint === null ? null : parseCediaHistoryCheckpoint(row.checkpoint),
    lastRewind: row.lastRewind === null ? null : parseCediaHistoryRewind(row.lastRewind),
  };
}

function parseCediaTreeNode(value: unknown): CediaTreeNode {
  const row = historyRecord(value, "Cedia host returned an invalid session tree node.");
  historyExact(row, ["id", "parentId", "kind", "timestamp", "label", "labelTruncated"], "Cedia host returned an invalid session tree node.");
  const id = historyString(row.id, "Cedia host returned an invalid session tree node id.");
  const parentId = row.parentId === null ? null : historyString(row.parentId, "Cedia host returned an invalid session tree parent id.");
  const kind = historyString(row.kind, "Cedia host returned an invalid session tree node kind.");
  const timestamp = historyString(row.timestamp, "Cedia host returned an invalid session tree node timestamp.");
  if (typeof row.label !== "string" || typeof row.labelTruncated !== "boolean") {
    throw new Error("Cedia host returned an invalid session tree node label.");
  }
  return { id, parentId, kind, timestamp, label: row.label, labelTruncated: row.labelTruncated };
}

function parseCediaTreeLineage(value: unknown): CediaTreeLineage {
  const row = historyRecord(value, "Cedia host returned an invalid session tree lineage.");
  historyExact(row, ["sessionFile", "parentSession", "previousSessionFiles"], "Cedia host returned an invalid session tree lineage.");
  if (!Array.isArray(row.previousSessionFiles)) {
    throw new Error("Cedia host returned an invalid previous session file list.");
  }
  return {
    sessionFile: historyString(row.sessionFile, "Cedia host returned an invalid session file."),
    parentSession: row.parentSession === null ? null : historyString(row.parentSession, "Cedia host returned an invalid parent session."),
    previousSessionFiles: row.previousSessionFiles.map((item) => historyString(item, "Cedia host returned an invalid previous session file.")),
  };
}

export function parseCediaTreeAnswer(value: unknown): CediaTreeAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid session tree response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable session tree response.");
    return {
      state: "unavailable",
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable session tree reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid session tree response.");
  historyExact(row, ["available", "leafId", "nodes", "pathIds", "truncated", "lineage"], "Cedia host returned an invalid session tree response.");
  if (row.leafId !== null && typeof row.leafId !== "string") {
    throw new Error("Cedia host returned an invalid session tree leaf id.");
  }
  if (!Array.isArray(row.nodes) || !Array.isArray(row.pathIds) || typeof row.truncated !== "boolean") {
    throw new Error("Cedia host returned an invalid session tree response.");
  }
  const nodes = row.nodes.map(parseCediaTreeNode);
  const pathIds = row.pathIds.map((item) => historyString(item, "Cedia host returned an invalid session tree path id."));
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length || new Set(pathIds).size !== pathIds.length) {
    throw new Error("Cedia host returned an invalid session tree with duplicate ids.");
  }
  return {
    state: "available",
    leafId: row.leafId as string | null,
    nodes,
    pathIds,
    truncated: row.truncated,
    lineage: parseCediaTreeLineage(row.lineage),
  };
}

export function parseCediaPrewalkAnswer(value: unknown): CediaPrewalkAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid prewalk state response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable prewalk state response.");
    return {
      state: "unavailable",
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable prewalk state reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid prewalk state response.");
  historyExact(row, ["available", "armed"], "Cedia host returned an invalid prewalk state response.");
  if (typeof row.armed !== "boolean") {
    throw new Error("Cedia host returned an invalid prewalk state response.");
  }
  return { state: "available", armed: row.armed };
}

export function parseCediaTreeNavigateAnswer(value: unknown): CediaTreeNavigateAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid session tree navigation response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable session tree navigation response.");
    return {
      state: "unavailable",
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable session tree navigation reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid session tree navigation response.");
  historyExact(row, ["available", "moved", "cancelled", "aborted", "askReopen", "summarized", "editorText", "editorTextTruncated", "editorImageCount", "leafId"], "Cedia host returned an invalid session tree navigation response.");
  if (
    typeof row.moved !== "boolean" ||
    typeof row.cancelled !== "boolean" ||
    typeof row.aborted !== "boolean" ||
    typeof row.askReopen !== "boolean" ||
    typeof row.summarized !== "boolean" ||
    (row.editorText !== null && typeof row.editorText !== "string") ||
    typeof row.editorTextTruncated !== "boolean" ||
    typeof row.editorImageCount !== "number" ||
    !Number.isSafeInteger(row.editorImageCount) ||
    row.editorImageCount < 0 ||
    (row.leafId !== null && typeof row.leafId !== "string")
  ) {
    throw new Error("Cedia host returned an invalid session tree navigation response.");
  }
  return {
    state: "available",
    moved: row.moved,
    cancelled: row.cancelled,
    aborted: row.aborted,
    askReopen: row.askReopen,
    summarized: row.summarized,
    editorText: row.editorText as string | null,
    editorTextTruncated: row.editorTextTruncated,
    editorImageCount: row.editorImageCount,
    leafId: row.leafId as string | null,
  };
}

export interface CediaGoalDetails {
  readonly status: string;
  readonly tokenBudget: number | null;
  readonly tokensUsed: number;
  readonly timeUsedSeconds: number;
}

export type CediaGoalDetailsAnswer =
  | ({ readonly state: "available" } & CediaGoalDetails)
  | { readonly state: "unavailable"; readonly reason: string };

function goalDetailsNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Cedia host returned an invalid goal ${label}.`);
  }
  return value;
}

export function parseCediaGoalDetailsAnswer(value: unknown): CediaGoalDetailsAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid goal details response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable goal details response.");
    return {
      state: "unavailable",
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable goal details reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid goal details response.");
  historyExact(row, ["available", "status", "tokenBudget", "tokensUsed", "timeUsedSeconds"], "Cedia host returned an invalid goal details response.");
  if (typeof row.status !== "string" || row.status.trim().length === 0) {
    throw new Error("Cedia host returned an invalid goal status.");
  }
  // The runtime omits the budget when none is set: absence reads as "no budget", never as zero.
  const tokenBudget = row.tokenBudget === null || row.tokenBudget === undefined
    ? null
    : goalDetailsNumber(row.tokenBudget, "token budget");
  return {
    state: "available",
    status: row.status,
    tokenBudget,
    tokensUsed: goalDetailsNumber(row.tokensUsed, "tokens used"),
    timeUsedSeconds: goalDetailsNumber(row.timeUsedSeconds, "time used"),
  };
}

interface CediaGoalDetailsApi {
  readonly getGoalDetails: (sessionId: string) => Promise<unknown>;
}

function getCediaGoalDetailsApi(): CediaGoalDetailsApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaGoalDetailsApi> };
  if (typeof api.cedia?.getGoalDetails !== "function") {
    throw new Error("Cedia goal details bridge is unavailable.");
  }
  return api.cedia as CediaGoalDetailsApi;
}

export function serverGoalDetailsQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.goalDetails(sessionId),
    queryFn: async () => parseCediaGoalDetailsAnswer(await getCediaGoalDetailsApi().getGoalDetails(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
  });
}

function parseCediaToolCatalogEntry(value: unknown): CediaToolCatalogEntry {
  const row = historyRecord(value, "Cedia host returned an invalid tool catalog entry.");
  historyExact(row, ["name", "description", "descriptionTruncated", "source", "active"], "Cedia host returned an invalid tool catalog entry.");
  const name = historyString(row.name, "Cedia host returned an invalid tool catalog entry name.");
  if (name.trim().length === 0) throw new Error("Cedia host returned an invalid tool catalog entry name.");
  if (typeof row.description !== "string" || typeof row.descriptionTruncated !== "boolean") {
    throw new Error("Cedia host returned an invalid tool catalog entry description.");
  }
  if (row.source !== "builtin" && row.source !== "mcp" && row.source !== "sdk" && row.source !== "extension") {
    throw new Error("Cedia host returned an invalid tool catalog entry source.");
  }
  if (typeof row.active !== "boolean") throw new Error("Cedia host returned an invalid tool catalog entry activation.");
  return {
    name,
    description: row.description,
    descriptionTruncated: row.descriptionTruncated,
    source: row.source,
    active: row.active,
  };
}

export function parseCediaToolCatalogAnswer(value: unknown): CediaToolCatalogAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid tool catalog response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable tool catalog response.");
    return {
      state: "unavailable",
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable tool catalog reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid tool catalog response.");
  historyExact(row, ["available", "tools", "truncated", "total", "activeCount"], "Cedia host returned an invalid tool catalog response.");
  if (!Array.isArray(row.tools) || typeof row.truncated !== "boolean") {
    throw new Error("Cedia host returned an invalid tool catalog response.");
  }
  if (typeof row.total !== "number" || !Number.isSafeInteger(row.total) || row.total < 0) {
    throw new Error("Cedia host returned an invalid tool catalog total.");
  }
  if (typeof row.activeCount !== "number" || !Number.isSafeInteger(row.activeCount) || row.activeCount < 0) {
    throw new Error("Cedia host returned an invalid tool catalog active count.");
  }
  const tools = row.tools.map(parseCediaToolCatalogEntry);
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    throw new Error("Cedia host returned a tool catalog with duplicate names.");
  }
  return {
    state: "available",
    tools,
    truncated: row.truncated,
    total: row.total,
    activeCount: row.activeCount,
  };
}



/**
 * Polling rule for session panels whose backend appears with the runtime: while the answer
 * is missing — a failed read, or a successful read reporting absence (`available: false`)
 * because no runtime was up yet — re-read on a bounded interval so the panel heals itself
 * once the runtime boots. Live answers are untouched: they still refresh only on focus,
 * reconnect, remount and explicit invalidation. A genuinely down backend costs one cheap
 * failed read per interval per mounted panel, and a failed read never storms (`retry` stays
 * false everywhere this rule is used).
 *
 * TanStack v5 calls this with the query object as its only argument (see `refetchInterval`
 * in query-core's types); both parameters are unknown-guarded so no call convention can
 * throw inside the scheduler.
 */
function refetchRuleQueryState(query: unknown): { readonly status?: unknown; readonly data?: unknown } | undefined {
  if (!query || typeof query !== "object" || Array.isArray(query)) return undefined;
  const state = (query as Record<string, unknown>).state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
  return state as { readonly status?: unknown; readonly data?: unknown };
}

export function missingBackendRefetchInterval(query?: unknown): number | false {
  const state = refetchRuleQueryState(query);
  if (state?.status === "error") return 5_000;
  const data = state?.data;
  if (data !== undefined && data !== null && typeof data === "object" && !Array.isArray(data)) {
    const answer = (data as Record<string, unknown>).state;
    if (typeof answer === "string" && answer !== "available") return 5_000;
  }
  return false;
}

export function serverToolCatalogQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.toolCatalog(sessionId),
    queryFn: async () => parseCediaToolCatalogAnswer(await getCediaToolCatalogApi().getToolCatalog(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    refetchInterval: missingBackendRefetchInterval,
  });
}

function codeModePrelude(value: unknown, message: string): CediaCodeModePrelude {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== "name" && key !== "enabled") throw new Error(message);
  }
  if (typeof row.name !== "string" || row.name.trim().length === 0 || typeof row.enabled !== "boolean") {
    throw new Error(message);
  }
  return { name: row.name, enabled: row.enabled };
}

export function parseCediaCodeModeAnswer(value: unknown): CediaCodeModeAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid Code Mode response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable Code Mode response.");
    return {
      state: "unavailable",
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable Code Mode reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid Code Mode response.");
  historyExact(row, ["available", "active", "directToolNames", "preludes"], "Cedia host returned an invalid Code Mode response.");
  if (typeof row.active !== "boolean") throw new Error("Cedia host returned an invalid Code Mode response.");
  let directToolNames: readonly string[] | null = null;
  if (row.directToolNames !== null) {
    if (!Array.isArray(row.directToolNames)) throw new Error("Cedia host returned an invalid Code Mode direct list.");
    directToolNames = row.directToolNames.map((name) => {
      if (typeof name !== "string" || name.trim().length === 0) throw new Error("Cedia host returned an invalid Code Mode direct list.");
      return name;
    });
  }
  if (!Array.isArray(row.preludes)) throw new Error("Cedia host returned an invalid Code Mode prelude list.");
  const preludes = row.preludes.map((entry) => codeModePrelude(entry, "Cedia host returned an invalid Code Mode prelude."));
  return { state: "available", active: row.active, directToolNames, preludes };
}

export interface CediaExtensionSource {
  readonly provider: string;
  readonly providerName: string;
  readonly level: string;
}

export interface CediaExtensionEntry {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly descriptionTruncated: boolean;
  readonly path: string;
  readonly source: CediaExtensionSource;
  readonly state: string;
  readonly disabledReason?: string;
  readonly shadowedBy?: string;
}

export interface CediaExtensionRoots {
  readonly explicit: readonly string[];
  readonly mode: string;
  readonly configured: readonly string[];
  readonly configuredLevel: string;
}

export type CediaExtensionsAnswer =
  | {
      readonly available: true;
      readonly roots: CediaExtensionRoots;
      readonly extensions: readonly CediaExtensionEntry[];
      readonly truncated: boolean;
      readonly total: number;
    }
  | { readonly available: false; readonly reason: string };

function parseCediaExtensionSource(value: unknown): CediaExtensionSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cedia host returned an invalid extension source.");
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== "provider" && key !== "providerName" && key !== "level") throw new Error("Cedia host returned an invalid extension source.");
  }
  if (typeof row.provider !== "string" || typeof row.providerName !== "string" || typeof row.level !== "string") {
    throw new Error("Cedia host returned an invalid extension source.");
  }
  return { provider: row.provider, providerName: row.providerName, level: row.level };
}

function parseCediaExtensionEntry(value: unknown): CediaExtensionEntry {
  const row = historyRecord(value, "Cedia host returned an invalid extension entry.");
  historyExact(row, ["id", "kind", "name", "displayName", "description", "descriptionTruncated", "path", "source", "state", "disabledReason", "shadowedBy"], "Cedia host returned an invalid extension entry.");
  for (const key of ["id", "kind", "name", "displayName", "description", "path"] as const) {
    if (typeof row[key] !== "string") throw new Error("Cedia host returned an invalid extension entry.");
  }
  if (typeof row.descriptionTruncated !== "boolean") throw new Error("Cedia host returned an invalid extension entry.");
  if (row.state !== "active" && row.state !== "disabled" && row.state !== "shadowed") {
    throw new Error("Cedia host returned an invalid extension entry.");
  }
  if (row.disabledReason !== undefined && typeof row.disabledReason !== "string") throw new Error("Cedia host returned an invalid extension entry.");
  if (row.shadowedBy !== undefined && typeof row.shadowedBy !== "string") throw new Error("Cedia host returned an invalid extension entry.");
  return {
    id: row.id as string,
    kind: row.kind as string,
    name: row.name as string,
    displayName: row.displayName as string,
    description: row.description as string,
    descriptionTruncated: row.descriptionTruncated,
    path: row.path as string,
    source: parseCediaExtensionSource(row.source),
    state: row.state,
    ...(typeof row.disabledReason === "string" ? { disabledReason: row.disabledReason } : {}),
    ...(typeof row.shadowedBy === "string" ? { shadowedBy: row.shadowedBy } : {}),
  };
}

export function parseCediaExtensionsAnswer(value: unknown): CediaExtensionsAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid extension catalog response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable extension catalog response.");
    return {
      available: false,
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable extension catalog reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid extension catalog response.");
  historyExact(row, ["available", "roots", "extensions", "truncated", "total"], "Cedia host returned an invalid extension catalog response.");
  const roots = historyRecord(row.roots, "Cedia host returned an invalid extension roots.");
  historyExact(roots, ["explicit", "mode", "configured", "configuredLevel"], "Cedia host returned an invalid extension roots.");
  for (const key of ["explicit", "configured"] as const) {
    if (!Array.isArray(roots[key]) || roots[key].some(entry => typeof entry !== "string")) {
      throw new Error("Cedia host returned an invalid extension roots.");
    }
  }
  if (typeof roots.mode !== "string" || roots.mode.trim().length === 0) {
    throw new Error("Cedia host returned an invalid extension roots.");
  }
  if (roots.configuredLevel !== "user" && roots.configuredLevel !== "project") {
    throw new Error("Cedia host returned an invalid extension roots.");
  }
  if (!Array.isArray(row.extensions)) throw new Error("Cedia host returned an invalid extension catalog response.");
  if (typeof row.truncated !== "boolean") throw new Error("Cedia host returned an invalid extension catalog response.");
  if (typeof row.total !== "number" || !Number.isSafeInteger(row.total) || row.total < 0) {
    throw new Error("Cedia host returned an invalid extension catalog response.");
  }
  return {
    available: true,
    roots: {
      explicit: roots.explicit as string[],
      mode: roots.mode as string,
      configured: roots.configured as string[],
      configuredLevel: roots.configuredLevel as string,
    },
    extensions: row.extensions.map((entry) => parseCediaExtensionEntry(entry)),
    truncated: row.truncated,
    total: row.total,
  };
}

export function serverToolExtensionsQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.toolExtensions(sessionId),
    queryFn: async () => parseCediaExtensionsAnswer(await getCediaToolExtensionsApi().getExtensions(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    refetchInterval: missingBackendRefetchInterval,
  });
}

export function serverToolCodeModeQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.toolCodeMode(sessionId),
    queryFn: async () => parseCediaCodeModeAnswer(await getCediaToolCodeModeApi().getCodeMode(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    refetchInterval: missingBackendRefetchInterval,
  });
}

export function serverTreeQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.tree(sessionId),
    queryFn: async () => parseCediaTreeAnswer(await getCediaTreeApi().getTree(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    refetchInterval: missingBackendRefetchInterval,
  });
}

export function serverPrewalkQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.prewalk(sessionId),
    queryFn: async () => parseCediaPrewalkAnswer(await getCediaPrewalkApi().getPrewalk(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    refetchInterval: missingBackendRefetchInterval,
  });
}

function loopNullableText(value: unknown, message: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(message);
  return value;
}

export function parseCediaLoopAnswer(value: unknown): CediaLoopAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid loop mode response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable loop mode response.");
    return {
      state: "unavailable",
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable loop mode reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid loop mode response.");
  historyExact(row, ["available", "enabled", "paused", "limit", "condition", "hasPrompt"], "Cedia host returned an invalid loop mode response.");
  if (typeof row.enabled !== "boolean" || typeof row.paused !== "boolean" || typeof row.hasPrompt !== "boolean") {
    throw new Error("Cedia host returned an invalid loop mode response.");
  }
  return {
    state: "available",
    enabled: row.enabled,
    paused: row.paused,
    limit: loopNullableText(row.limit, "Cedia host returned an invalid loop mode bound."),
    condition: loopNullableText(row.condition, "Cedia host returned an invalid loop mode condition."),
    hasPrompt: row.hasPrompt,
  };
}

export function serverLoopQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.loop(sessionId),
    queryFn: async () => parseCediaLoopAnswer(await getCediaLoopApi().getLoop(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    refetchInterval: missingBackendRefetchInterval,
  });
}

export function serverLoopMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.loop(input.sessionId),
    mutationFn: async (body: CediaLoopInput) =>
      parseCediaLoopAnswer(await getCediaLoopApi().disableLoop(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.loop(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.loop(input.sessionId) });
    },
  });
}

function btwLifecycle(value: unknown): CediaBtwLifecycle {
  if (value === "idle" || value === "answering" || value === "ready" || value === "failed") return value;
  throw new Error("Cedia host returned an invalid side-question state.");
}

function btwNullableText(value: unknown, message: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(message);
  return value;
}

export function parseCediaBtwAnswer(value: unknown): CediaBtwAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid side-question response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable side-question response.");
    return {
      available: false,
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable side-question reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid side-question response.");
  historyExact(row, ["available", "state", "question", "questionTruncated", "answer", "answerTruncated", "branchable", "branchUnavailableReason", "reason"], "Cedia host returned an invalid side-question response.");
  if (typeof row.questionTruncated !== "boolean" || typeof row.answerTruncated !== "boolean" || typeof row.branchable !== "boolean") {
    throw new Error("Cedia host returned an invalid side-question response.");
  }
  return {
    available: true,
    state: btwLifecycle(row.state),
    question: btwNullableText(row.question, "Cedia host returned an invalid side question."),
    questionTruncated: row.questionTruncated,
    answer: btwNullableText(row.answer, "Cedia host returned an invalid side answer."),
    answerTruncated: row.answerTruncated,
    branchable: row.branchable,
    branchUnavailableReason: btwNullableText(row.branchUnavailableReason, "Cedia host returned an invalid side-question branch reason."),
    reason: btwNullableText(row.reason, "Cedia host returned an invalid side-question reason."),
  };
}

export function parseCediaBtwBranchAnswer(value: unknown): CediaBtwBranchAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid side-question branch response.");
  if (row.available === false) {
    throw new Error(historyString(row.reason, "Cedia host returned an invalid unavailable side-question branch reason."));
  }
  historyExact(row, ["cancelled", "sessionFile"], "Cedia host returned an invalid side-question branch response.");
  if (typeof row.cancelled !== "boolean") throw new Error("Cedia host returned an invalid side-question branch response.");
  if (row.sessionFile !== null && (typeof row.sessionFile !== "string" || row.sessionFile.trim().length === 0)) {
    throw new Error("Cedia host returned an invalid side-question branch file.");
  }
  return { cancelled: row.cancelled, sessionFile: row.sessionFile };
}

export function btwAnsweringRefetchInterval(query?: unknown): number | false {
  const data = refetchRuleQueryState(query)?.data as { state?: unknown } | undefined;
  // While an ask runs, poll for its landing: the ask answers the answering state at once
  // and the held answer arrives later. Terminal states never poll.
  if (data !== undefined && data !== null && typeof data === "object" && data.state === "answering") return 2_000;
  return false;
}

export function serverBtwQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.btw(sessionId),
    queryFn: async () => parseCediaBtwAnswer(await getCediaBtwApi().getBtw(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    // Side-question changes arrive with the ask/branch mutations below and the same native
    // thread activity stream as the sibling panels, plus a poll while an ask runs: the ask
    // answers the answering state at once and the held answer lands later.
    refetchOnWindowFocus: true,
    retry: false,
    refetchInterval: btwAnsweringRefetchInterval,
  });
}

export function serverBtwAskMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.btwAsk(input.sessionId),
    mutationFn: async (body: CediaBtwAskInput) =>
      parseCediaBtwAnswer(await getCediaBtwApi().askBtw(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.btw(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.btw(input.sessionId) });
    },
  });
}

export type CediaOmfgLifecycle = "idle" | "drafting" | "ready" | "failed";

export type CediaOmfgAnswer =
  | {
      readonly available: true;
      readonly state: CediaOmfgLifecycle;
      readonly complaint: string | null;
      readonly complaintTruncated: boolean;
      readonly draft: string | null;
      readonly draftTruncated: boolean;
      readonly ruleName: string | null;
      readonly validated: boolean;
      readonly validationFeedback: string | null;
      readonly savedPath: string | null;
      readonly reason: string | null;
    }
  | { readonly available: false; readonly reason: string };

export interface CediaOmfgDraftInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly complaint: string;
  readonly feedback?: string;
}

export interface CediaOmfgSaveInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly scope: "project" | "global";
  readonly overwrite?: boolean;
  readonly allowUnvalidated?: boolean;
}

export interface CediaOmfgAbortInput {
  readonly commandId?: string;
  readonly incarnation?: string;
}

export interface CediaOmfgSaveAnswer {
  readonly saved: boolean;
  readonly scope: "project" | "global";
  readonly name: string;
  readonly path: string;
  readonly validated: boolean;
}

export function serverBtwBranchMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.btwBranch(input.sessionId),
    mutationFn: async (body: CediaBtwBranchInput) =>
      parseCediaBtwBranchAnswer(await getCediaBtwApi().branchBtw(input.sessionId, body)),
    onSuccess: () => {
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.btw(input.sessionId) });
    },
  });
}

function omfgLifecycle(value: unknown): CediaOmfgLifecycle {
  if (value === "idle" || value === "drafting" || value === "ready" || value === "failed") return value;
  throw new Error("Cedia host returned an invalid rule-forging state.");
}

export function parseCediaOmfgAnswer(value: unknown): CediaOmfgAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid rule-forging response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable rule-forging response.");
    return {
      available: false,
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable rule-forging reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid rule-forging response.");
  historyExact(row, ["available", "state", "complaint", "complaintTruncated", "draft", "draftTruncated", "ruleName", "validated", "validationFeedback", "savedPath", "reason"], "Cedia host returned an invalid rule-forging response.");
  const nullableText = (field: unknown, message: string): string | null => {
    if (field === null) return null;
    if (typeof field !== "string") throw new Error(message);
    return field;
  };
  if (typeof row.complaintTruncated !== "boolean" || typeof row.draftTruncated !== "boolean" || typeof row.validated !== "boolean") {
    throw new Error("Cedia host returned an invalid rule-forging response.");
  }
  return {
    available: true,
    state: omfgLifecycle(row.state),
    complaint: nullableText(row.complaint, "Cedia host returned an invalid rule complaint."),
    complaintTruncated: row.complaintTruncated,
    draft: nullableText(row.draft, "Cedia host returned an invalid rule draft."),
    draftTruncated: row.draftTruncated,
    ruleName: nullableText(row.ruleName, "Cedia host returned an invalid rule name."),
    validated: row.validated,
    validationFeedback: nullableText(row.validationFeedback, "Cedia host returned an invalid rule validation."),
    savedPath: nullableText(row.savedPath, "Cedia host returned an invalid rule save path."),
    reason: nullableText(row.reason, "Cedia host returned an invalid rule-forging reason."),
  };
}

export function parseCediaOmfgSaveAnswer(value: unknown): CediaOmfgSaveAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid rule save response.");
  if (row.available === false) {
    throw new Error(historyString(row.reason, "Cedia host returned an invalid unavailable rule save reason."));
  }
  historyExact(row, ["saved", "scope", "name", "path", "validated"], "Cedia host returned an invalid rule save response.");
  if (row.saved !== true) throw new Error("Cedia host returned an unconfirmed rule save.");
  if (row.scope !== "project" && row.scope !== "global") throw new Error("Cedia host returned an invalid rule save scope.");
  if (typeof row.validated !== "boolean") throw new Error("Cedia host returned an invalid rule save response.");
  return {
    saved: true,
    scope: row.scope,
    name: historyString(row.name, "Cedia host returned an invalid rule save name."),
    path: historyString(row.path, "Cedia host returned an invalid rule save path."),
    validated: row.validated,
  };
}

export function omfgDraftingRefetchInterval(query?: unknown): number | false {
  const data = refetchRuleQueryState(query)?.data as { state?: unknown } | undefined;
  // While a draft runs, poll for its landing: the draft answers the drafting state at once
  // and the held candidate lands later. Terminal states never poll.
  if (data !== undefined && data !== null && typeof data === "object" && data.state === "drafting") return 2_000;
  return false;
}

export function serverOmfgQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.omfg(sessionId),
    queryFn: async () => parseCediaOmfgAnswer(await getCediaOmfgApi().getOmfg(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    refetchInterval: omfgDraftingRefetchInterval,
  });
}

export function serverOmfgDraftMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.omfgDraft(input.sessionId),
    mutationFn: async (body: CediaOmfgDraftInput) =>
      parseCediaOmfgAnswer(await getCediaOmfgApi().draftOmfg(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.omfg(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.omfg(input.sessionId) });
    },
  });
}

export function serverOmfgSaveMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.omfgSave(input.sessionId),
    mutationFn: async (body: CediaOmfgSaveInput) =>
      parseCediaOmfgSaveAnswer(await getCediaOmfgApi().saveOmfg(input.sessionId, body)),
    onSuccess: () => {
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.omfg(input.sessionId) });
    },
  });
}

export function serverOmfgAbortMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.omfgAbort(input.sessionId),
    mutationFn: async (body: CediaOmfgAbortInput) =>
      parseCediaOmfgAnswer(await getCediaOmfgApi().abortOmfg(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.omfg(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.omfg(input.sessionId) });
    },
  });
}

function cleanseLifecycle(value: unknown): CediaCleanseLifecycle {
  if (value === "idle" || value === "running" || value === "done" || value === "failed") return value;
  throw new Error("Cedia host returned an invalid cleanse run state.");
}

function cleanseStringArray(value: unknown, message: string): readonly string[] {
  if (!Array.isArray(value) || value.some(line => typeof line !== "string")) throw new Error(message);
  return value;
}

function parseCediaCleanseChecker(value: unknown): CediaCleanseChecker {
  const row = historyRecord(value, "Cedia host returned an invalid cleanse checker.");
  historyExact(row, ["id", "label", "state", "exitCode", "diagnostics", "durationMs"], "Cedia host returned an invalid cleanse checker.");
  if (typeof row.id !== "string" || row.id.trim().length === 0) throw new Error("Cedia host returned an invalid cleanse checker.");
  if (typeof row.label !== "string" || row.label.trim().length === 0) throw new Error("Cedia host returned an invalid cleanse checker.");
  if (row.state !== "running" && row.state !== "done") throw new Error("Cedia host returned an invalid cleanse checker.");
  if (row.exitCode !== null && (typeof row.exitCode !== "number" || !Number.isSafeInteger(row.exitCode))) {
    throw new Error("Cedia host returned an invalid cleanse checker.");
  }
  if (typeof row.diagnostics !== "number" || !Number.isSafeInteger(row.diagnostics) || row.diagnostics < 0) {
    throw new Error("Cedia host returned an invalid cleanse checker.");
  }
  if (row.durationMs !== null && (typeof row.durationMs !== "number" || !Number.isSafeInteger(row.durationMs) || row.durationMs < 0)) {
    throw new Error("Cedia host returned an invalid cleanse checker.");
  }
  return { id: row.id, label: row.label, state: row.state, exitCode: row.exitCode, diagnostics: row.diagnostics, durationMs: row.durationMs };
}

function parseCediaCleanseAgent(value: unknown): CediaCleanseAgent {
  const row = historyRecord(value, "Cedia host returned an invalid cleanse agent.");
  historyExact(row, ["name", "files", "status", "detail"], "Cedia host returned an invalid cleanse agent.");
  if (typeof row.name !== "string" || row.name.trim().length === 0) throw new Error("Cedia host returned an invalid cleanse agent.");
  if (typeof row.files !== "number" || !Number.isSafeInteger(row.files) || row.files < 0) throw new Error("Cedia host returned an invalid cleanse agent.");
  if (typeof row.status !== "string" || typeof row.detail !== "string") throw new Error("Cedia host returned an invalid cleanse agent.");
  return { name: row.name, files: row.files, status: row.status, detail: row.detail };
}

function parseCediaCleanseReport(value: unknown): CediaCleanseReport {
  const row = historyRecord(value, "Cedia host returned an invalid cleanse report.");
  historyExact(row, ["status", "checks", "checksTruncated", "diagnostics", "diagnosticsTruncated", "diagnosticsTotal", "skipped"], "Cedia host returned an invalid cleanse report.");
  if (row.status !== "clean" && row.status !== "unresolved" && row.status !== "unsupported" && row.status !== "cancelled") {
    throw new Error("Cedia host returned an invalid cleanse report.");
  }
  if (!Array.isArray(row.checks) || typeof row.checksTruncated !== "boolean") throw new Error("Cedia host returned an invalid cleanse report.");
  if (!Array.isArray(row.diagnostics) || typeof row.diagnosticsTruncated !== "boolean") {
    throw new Error("Cedia host returned an invalid cleanse report.");
  }
  if (typeof row.diagnosticsTotal !== "number" || !Number.isSafeInteger(row.diagnosticsTotal) || row.diagnosticsTotal < 0) {
    throw new Error("Cedia host returned an invalid cleanse report.");
  }
  if (!Array.isArray(row.skipped)) throw new Error("Cedia host returned an invalid cleanse report.");
  return row as unknown as CediaCleanseReport;
}

export function parseCediaCleanseAnswer(value: unknown): CediaCleanseAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid cleanse response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable cleanse response.");
    return {
      available: false,
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable cleanse reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid cleanse response.");
  historyExact(row, ["available", "state", "request", "phase", "checkers", "agents", "log", "report", "reason"], "Cedia host returned an invalid cleanse response.");
  const state = cleanseLifecycle(row.state);
  if (!Array.isArray(row.checkers) || !Array.isArray(row.agents)) throw new Error("Cedia host returned an invalid cleanse response.");
  const nullableText = (field: unknown, message: string): string | null => {
    if (field === null) return null;
    if (typeof field !== "string") throw new Error(message);
    return field;
  };
  return {
    available: true,
    state,
    request: nullableText(row.request, "Cedia host returned an invalid cleanse request."),
    phase: nullableText(row.phase, "Cedia host returned an invalid cleanse phase."),
    checkers: row.checkers.map((entry) => parseCediaCleanseChecker(entry)),
    agents: row.agents.map((entry) => parseCediaCleanseAgent(entry)),
    log: cleanseStringArray(row.log, "Cedia host returned an invalid cleanse log."),
    report: row.report === null ? null : parseCediaCleanseReport(row.report),
    reason: nullableText(row.reason, "Cedia host returned an invalid cleanse reason."),
  };
}

export function cleanseRunningRefetchInterval(query?: unknown): number | false {
  const data = refetchRuleQueryState(query)?.data as { state?: unknown } | undefined;
  // While a batch runs, poll for its landing: the run answers the running state at once
  // and the held report lands on completion. Terminal states never poll.
  if (data !== undefined && data !== null && typeof data === "object" && data.state === "running") return 3_000;
  return false;
}

export function serverCleanseQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.cleanse(sessionId),
    queryFn: async () => parseCediaCleanseAnswer(await getCediaCleanseApi().getCleanse(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    refetchInterval: cleanseRunningRefetchInterval,
  });
}

export function serverCleanseRunMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.cleanseRun(input.sessionId),
    mutationFn: async (body: CediaCleanseRunInput) =>
      parseCediaCleanseAnswer(await getCediaCleanseApi().runCleanse(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.cleanse(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.cleanse(input.sessionId) });
    },
  });
}

export function serverCleanseAbortMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.cleanseAbort(input.sessionId),
    mutationFn: async (body: CediaCleanseAbortInput) =>
      parseCediaCleanseAnswer(await getCediaCleanseApi().abortCleanse(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.cleanse(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.cleanse(input.sessionId) });
    },
  });
}

export type CediaCleanseLifecycle = "idle" | "running" | "done" | "failed";

export interface CediaCleanseChecker {
  readonly id: string;
  readonly label: string;
  readonly state: "running" | "done";
  readonly exitCode: number | null;
  readonly diagnostics: number;
  readonly durationMs: number | null;
}

export interface CediaCleanseAgent {
  readonly name: string;
  readonly files: number;
  readonly status: string;
  readonly detail: string;
}

export interface CediaCleanseReport {
  readonly status: "clean" | "unresolved" | "unsupported" | "cancelled";
  readonly checks: readonly { readonly id: string; readonly label: string; readonly language: string; readonly exitCode: number | null; readonly diagnostics: number }[];
  readonly checksTruncated: boolean;
  readonly diagnostics: readonly { readonly checker: string; readonly file?: string; readonly line?: number; readonly column?: number; readonly code?: string; readonly severity: string; readonly message: string }[];
  readonly diagnosticsTruncated: boolean;
  readonly diagnosticsTotal: number;
  readonly skipped: readonly { readonly label: string; readonly language: string; readonly reason: string }[];
}

export type CediaCleanseAnswer =
  | {
      readonly available: true;
      readonly state: CediaCleanseLifecycle;
      readonly request: string | null;
      readonly phase: string | null;
      readonly checkers: readonly CediaCleanseChecker[];
      readonly agents: readonly CediaCleanseAgent[];
      readonly log: readonly string[];
      readonly report: CediaCleanseReport | null;
      readonly reason: string | null;
    }
  | { readonly available: false; readonly reason: string };

export interface CediaCleanseRunInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly request?: string;
  readonly all?: boolean;
  readonly includeTests?: boolean;
  readonly maxAgents?: number;
  readonly model?: string;
}

export interface CediaCleanseAbortInput {
  readonly commandId?: string;
  readonly incarnation?: string;
}

export type CediaBtwLifecycle = "idle" | "answering" | "ready" | "failed";

export type CediaBtwAnswer =
  | {
      readonly available: true;
      readonly state: CediaBtwLifecycle;
      readonly question: string | null;
      readonly questionTruncated: boolean;
      readonly answer: string | null;
      readonly answerTruncated: boolean;
      readonly branchable: boolean;
      readonly branchUnavailableReason: string | null;
      readonly reason: string | null;
    }
  | { readonly available: false; readonly reason: string };

export interface CediaBtwAskInput {
  readonly commandId?: string;
  readonly incarnation?: string;
  readonly question: string;
}

export interface CediaBtwBranchInput {
  readonly commandId?: string;
  readonly incarnation?: string;
}

export interface CediaBtwBranchAnswer {
  readonly cancelled: boolean;
  readonly sessionFile: string | null;
}

export interface CediaToolActiveSetInput {
  readonly toolNames: readonly string[];
}

export function serverToolActiveSetMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["server", "mutation", "tools", "active", input.sessionId] as const,
    mutationFn: async (body: CediaToolActiveSetInput) =>
      parseCediaToolCatalogAnswer(await getCediaToolCatalogApi().setActiveTools(input.sessionId, body.toolNames)),
    onSuccess: (answer) => {
      if (answer.state !== "available") return;
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.toolCatalog(input.sessionId) });
    },
  });
}

export function serverToolRefreshSkillsMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["server", "mutation", "tools", "refresh-skills", input.sessionId] as const,
    mutationFn: async () =>
      parseCediaToolCatalogAnswer(await getCediaToolCatalogApi().refreshSkills(input.sessionId)),
    onSuccess: (answer) => {
      if (answer.state !== "available") return;
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.toolCatalog(input.sessionId) });
    },
  });
}

export interface CediaExtensionSetInput {
  readonly id: string;
  readonly enabled: boolean;
}

export function serverToolExtensionSetMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["server", "mutation", "tools", "extensions", "set", input.sessionId] as const,
    mutationFn: async (body: CediaExtensionSetInput) =>
      parseCediaExtensionsAnswer(await getCediaToolExtensionsApi().setExtensionEnabled(input.sessionId, body.id, body.enabled)),
    onSuccess: (answer) => {
      if (answer.available !== true) return;
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.toolExtensions(input.sessionId) });
    },
  });
}

export function serverTreeNavigateMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.treeNavigate(input.sessionId),
    mutationFn: async (body: CediaTreeNavigateInput) =>
      parseCediaTreeNavigateAnswer(await getCediaTreeApi().navigateTree(input.sessionId, body.entryId, body.summarize)),
    onSuccess: (answer) => {
      if (
        answer.state !== "available" ||
        !answer.moved ||
        answer.askReopen ||
        answer.cancelled ||
        answer.aborted
      ) {
        return;
      }
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.tree(input.sessionId) });
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.transcript(input.sessionId) });
    },
  });
}

export function parseCediaTranscriptAnswer(value: unknown): CediaTranscriptAnswer {
  const row = historyRecord(value, "Cedia host returned an invalid history transcript response.");
  if (row.available === false) {
    historyExact(row, ["available", "reason"], "Cedia host returned an invalid unavailable history transcript response.");
    return {
      state: "unavailable",
      reason: historyString(row.reason, "Cedia host returned an invalid unavailable history transcript reason."),
    };
  }
  if (row.available !== true) throw new Error("Cedia host returned an invalid history transcript response.");
  historyExact(row, ["available", "text", "truncated", "bytes"], "Cedia host returned an invalid history transcript response.");
  if (typeof row.text !== "string" || typeof row.truncated !== "boolean") {
    throw new Error("Cedia host returned an invalid history transcript response.");
  }
  return {
    state: "available",
    text: row.text,
    truncated: row.truncated,
    bytes: historyCount(row.bytes, "Cedia host returned an invalid history transcript byte count."),
  };
}

export function serverHistoryQueryOptions(sessionId: string, enabled = false) {
  return queryOptions({
    queryKey: serverQueryKeys.history(sessionId),
    queryFn: async () => parseCediaHistoryAnswer(await getCediaHistoryApi().getHistory(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

export function serverHistoryTranscriptQueryOptions(sessionId: string, enabled = false) {
  return queryOptions({
    queryKey: serverQueryKeys.historyTranscript(sessionId),
    queryFn: async () => parseCediaTranscriptAnswer(await getCediaHistoryApi().getTranscript(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

function usageRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function usageExact(row: Record<string, unknown>, fields: readonly string[], message: string): void {
  const allowed = new Set(fields);
  if (Object.keys(row).some((field) => !allowed.has(field))) throw new Error(message);
}

function usageHas(row: Record<string, unknown>, field: string): boolean {
  return Object.hasOwn(row, field);
}

function usageString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(message);
  return value;
}

function usageNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(message);
  return value;
}

function usageBoolean(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") throw new Error(message);
  return value;
}

function usageNotes(value: unknown, message: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((note) => typeof note !== "string")) throw new Error(message);
  return value;
}

function parseCediaUsageAmount(value: unknown): CediaUsageAmount {
  const row = usageRecord(value, "Cedia host returned an invalid usage amount.");
  usageExact(row, ["unit", "usedFraction", "used", "limit", "remainingFraction"], "Cedia host returned an invalid usage amount.");
  return {
    unit: usageString(row.unit, "Cedia host returned an invalid usage unit."),
    ...(usageHas(row, "usedFraction") ? { usedFraction: usageNumber(row.usedFraction, "Cedia host returned an invalid used fraction.") } : {}),
    ...(usageHas(row, "used") ? { used: usageNumber(row.used, "Cedia host returned an invalid used amount.") } : {}),
    ...(usageHas(row, "limit") ? { limit: usageNumber(row.limit, "Cedia host returned an invalid usage limit.") } : {}),
    ...(usageHas(row, "remainingFraction") ? { remainingFraction: usageNumber(row.remainingFraction, "Cedia host returned an invalid remaining fraction.") } : {}),
  };
}

function parseCediaUsageScope(value: unknown): CediaUsageLimit["scope"] {
  if (value === undefined) return undefined;
  const row = usageRecord(value, "Cedia host returned an invalid usage scope.");
  usageExact(row, ["provider", "accountId"], "Cedia host returned an invalid usage scope.");
  return {
    ...(usageHas(row, "provider") ? { provider: usageString(row.provider, "Cedia host returned an invalid usage scope provider.") } : {}),
    ...(usageHas(row, "accountId") ? { accountId: usageString(row.accountId, "Cedia host returned an invalid usage scope account.") } : {}),
  };
}

function parseCediaUsageWindow(value: unknown): CediaUsageWindow | undefined {
  if (value === undefined) return undefined;
  const row = usageRecord(value, "Cedia host returned an invalid usage window.");
  usageExact(row, ["id", "label", "resetsAt"], "Cedia host returned an invalid usage window.");
  return {
    id: usageString(row.id, "Cedia host returned an invalid usage window id."),
    label: usageString(row.label, "Cedia host returned an invalid usage window label."),
    ...(usageHas(row, "resetsAt") ? { resetsAt: usageNumber(row.resetsAt, "Cedia host returned an invalid usage reset time.") } : {}),
  };
}

function parseCediaUsageLimit(value: unknown): CediaUsageLimit {
  const row = usageRecord(value, "Cedia host returned an invalid usage limit.");
  usageExact(row, ["id", "label", "scope", "window", "amount", "status", "notes"], "Cedia host returned an invalid usage limit.");
  return {
    id: usageString(row.id, "Cedia host returned an invalid usage limit id."),
    label: usageString(row.label, "Cedia host returned an invalid usage limit label."),
    ...(usageHas(row, "scope") ? { scope: parseCediaUsageScope(row.scope) } : {}),
    ...(usageHas(row, "window") ? { window: parseCediaUsageWindow(row.window) } : {}),
    amount: parseCediaUsageAmount(row.amount),
    ...(usageHas(row, "status") ? { status: usageString(row.status, "Cedia host returned an invalid usage status.") } : {}),
    ...(usageHas(row, "notes") ? { notes: usageNotes(row.notes, "Cedia host returned invalid usage limit notes.")! } : {}),
  };
}

function parseCediaUsageCredit(value: unknown): CediaUsageCredit {
  const row = usageRecord(value, "Cedia host returned an invalid usage credit.");
  usageExact(row, ["grantedAt", "expiresAt", "status"], "Cedia host returned an invalid usage credit.");
  return {
    ...(usageHas(row, "grantedAt") ? { grantedAt: usageString(row.grantedAt, "Cedia host returned an invalid credit grant time.") } : {}),
    ...(usageHas(row, "expiresAt") ? { expiresAt: usageString(row.expiresAt, "Cedia host returned an invalid credit expiry.") } : {}),
    ...(usageHas(row, "status") ? { status: usageString(row.status, "Cedia host returned an invalid credit status.") } : {}),
  };
}

function parseCediaUsageReport(value: unknown): CediaUsageReport {
  const row = usageRecord(value, "Cedia host returned an invalid usage report.");
  usageExact(row, ["provider", "fetchedAt", "limits", "resetCredits", "notes", "accountId", "accountEmail", "limitReached"], "Cedia host returned an invalid usage report.");
  if (!Array.isArray(row.limits)) throw new Error("Cedia host returned invalid usage report limits.");
  let resetCredits: CediaUsageReport["resetCredits"];
  if (usageHas(row, "resetCredits")) {
    const credits = usageRecord(row.resetCredits, "Cedia host returned an invalid reset-credit summary.");
    usageExact(credits, ["availableCount", "credits"], "Cedia host returned an invalid reset-credit summary.");
    if (typeof credits.availableCount !== "number" || !Number.isSafeInteger(credits.availableCount) || credits.availableCount < 0) {
      throw new Error("Cedia host returned an invalid reset-credit count.");
    }
    if (usageHas(credits, "credits") && !Array.isArray(credits.credits)) {
      throw new Error("Cedia host returned invalid reset-credit rows.");
    }
    resetCredits = {
      availableCount: credits.availableCount,
      ...(usageHas(credits, "credits") ? { credits: (credits.credits as unknown[]).map(parseCediaUsageCredit) } : {}),
    };
  }
  return {
    provider: usageString(row.provider, "Cedia host returned an invalid usage provider."),
    fetchedAt: usageNumber(row.fetchedAt, "Cedia host returned an invalid usage fetch time."),
    limits: row.limits.map(parseCediaUsageLimit),
    ...(resetCredits === undefined ? {} : { resetCredits }),
    ...(usageHas(row, "notes") ? { notes: usageNotes(row.notes, "Cedia host returned invalid usage report notes.")! } : {}),
    ...(usageHas(row, "accountId") ? { accountId: usageString(row.accountId, "Cedia host returned an invalid usage account id.") } : {}),
    ...(usageHas(row, "accountEmail") ? { accountEmail: usageString(row.accountEmail, "Cedia host returned an invalid usage account email.") } : {}),
    ...(usageHas(row, "limitReached") ? { limitReached: usageBoolean(row.limitReached, "Cedia host returned an invalid usage limit status.") } : {}),
  };
}

/** Parse the host wrapper without turning absent provider amounts into zeroes. */
export function parseCediaUsageAnswer(value: unknown): CediaUsageAnswer {
  const row = usageRecord(value, "Cedia host returned an invalid usage response.");
  if (row.state === "unavailable") {
    usageExact(row, ["state", "reason"], "Cedia host returned an invalid usage unavailable response.");
    return { state: "unavailable", reason: usageString(row.reason, "Cedia host returned an invalid usage unavailable reason.") };
  }
  usageExact(row, ["state", "revision", "reports", "supported", "unavailable"], "Cedia host returned an invalid usage response.");
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !Array.isArray(row.reports)
  ) {
    throw new Error("Cedia host returned an invalid usage response.");
  }
  return {
    state: "available",
    revision: row.revision,
    reports: row.reports.map(parseCediaUsageReport),
    ...(usageHas(row, "supported") ? { supported: usageBoolean(row.supported, "Cedia host returned an invalid usage support flag.") } : {}),
    ...(usageHas(row, "unavailable") ? { unavailable: usageString(row.unavailable, "Cedia host returned an invalid usage caveat.") } : {}),
  };
}

export function serverUsageQueryOptions(sessionId: string, enabled = false) {
  return queryOptions({
    queryKey: serverQueryKeys.usage(sessionId),
    queryFn: async () => parseCediaUsageAnswer(await getCediaUsageApi().getUsage(sessionId)),
    // Provider usage is owner-requested traffic. Keep this disabled until the panel's explicit
    // refresh action calls refetch, and do not let focus/reconnect or a timer ask providers again.
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

function parseCediaCredit(value: unknown): CediaCredit {
  const row = usageRecord(value, "Cedia host returned an invalid saved reset credit.");
  usageExact(
    row,
    ["id", "resetType", "status", "grantedAt", "expiresAt", "title", "description"],
    "Cedia host returned an invalid saved reset credit.",
  );
  return {
    id: usageString(row.id, "Cedia host returned an invalid saved reset credit id."),
    ...(usageHas(row, "resetType") ? { resetType: usageString(row.resetType, "Cedia host returned an invalid saved reset type.") } : {}),
    ...(usageHas(row, "status") ? { status: usageString(row.status, "Cedia host returned an invalid saved reset status.") } : {}),
    ...(usageHas(row, "grantedAt") ? { grantedAt: usageString(row.grantedAt, "Cedia host returned an invalid saved reset grant time.") } : {}),
    ...(usageHas(row, "expiresAt") ? { expiresAt: usageString(row.expiresAt, "Cedia host returned an invalid saved reset expiry.") } : {}),
    ...(usageHas(row, "title") ? { title: usageString(row.title, "Cedia host returned an invalid saved reset title.") } : {}),
    ...(usageHas(row, "description") ? { description: usageString(row.description, "Cedia host returned an invalid saved reset description.") } : {}),
  };
}

function parseCediaCreditAccount(value: unknown): CediaCreditAccount {
  const row = usageRecord(value, "Cedia host returned an invalid saved reset account.");
  usageExact(
    row,
    ["credentialId", "accountId", "email", "availableCount", "credits", "active", "error"],
    "Cedia host returned an invalid saved reset account.",
  );
  if (
    usageHas(row, "credentialId") &&
    (typeof row.credentialId !== "number" || !Number.isSafeInteger(row.credentialId) || row.credentialId < 0)
  ) {
    throw new Error("Cedia host returned an invalid saved reset credential id.");
  }
  if (!Array.isArray(row.credits)) throw new Error("Cedia host returned invalid saved reset account credits.");
  return {
    ...(usageHas(row, "credentialId") ? { credentialId: row.credentialId as number } : {}),
    ...(usageHas(row, "accountId") ? { accountId: usageString(row.accountId, "Cedia host returned an invalid saved reset account id.") } : {}),
    ...(usageHas(row, "email") ? { email: usageString(row.email, "Cedia host returned an invalid saved reset account email.") } : {}),
    availableCount: (() => {
      if (typeof row.availableCount !== "number" || !Number.isSafeInteger(row.availableCount) || row.availableCount < 0) {
        throw new Error("Cedia host returned an invalid saved reset account count.");
      }
      return row.availableCount;
    })(),
    credits: row.credits.map(parseCediaCredit),
    active: usageBoolean(row.active, "Cedia host returned an invalid saved reset active flag."),
    ...(usageHas(row, "error") ? { error: usageString(row.error, "Cedia host returned an invalid saved reset account error.") } : {}),
  };
}

function parseCediaCreditRedeem(value: unknown): CediaCreditRedeem {
  const row = usageRecord(value, "Cedia host returned an invalid saved reset outcome.");
  usageExact(row, ["ok", "code", "accountId", "email", "creditId"], "Cedia host returned an invalid saved reset outcome.");
  return {
    ok: usageBoolean(row.ok, "Cedia host returned an invalid saved reset outcome flag."),
    code: usageString(row.code, "Cedia host returned an invalid saved reset outcome code."),
    ...(usageHas(row, "accountId") ? { accountId: usageString(row.accountId, "Cedia host returned an invalid saved reset outcome account id.") } : {}),
    ...(usageHas(row, "email") ? { email: usageString(row.email, "Cedia host returned an invalid saved reset outcome email.") } : {}),
    ...(usageHas(row, "creditId") ? { creditId: usageString(row.creditId, "Cedia host returned an invalid saved reset outcome credit id.") } : {}),
  };
}

/** Parse saved-reset rows without turning an account/listing failure into an empty count. */
export function parseCediaCreditsAnswer(value: unknown): CediaCreditsAnswer {
  const row = usageRecord(value, "Cedia host returned an invalid saved reset response.");
  if (row.state === "unavailable") {
    usageExact(row, ["state", "reason"], "Cedia host returned an invalid saved reset unavailable response.");
    return { state: "unavailable", reason: usageString(row.reason, "Cedia host returned an invalid saved reset unavailable reason.") };
  }
  usageExact(row, ["state", "revision", "accounts", "unavailable", "lastRedeem"], "Cedia host returned an invalid saved reset response.");
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !Array.isArray(row.accounts)
  ) {
    throw new Error("Cedia host returned an invalid saved reset response.");
  }
  return {
    state: "available",
    revision: row.revision,
    accounts: row.accounts.map(parseCediaCreditAccount),
    ...(usageHas(row, "unavailable") ? { unavailable: usageString(row.unavailable, "Cedia host returned an invalid saved reset caveat.") } : {}),
    ...(usageHas(row, "lastRedeem") ? { lastRedeem: parseCediaCreditRedeem(row.lastRedeem) } : {}),
  };
}

/** Parse the POST answer and require OMP's own outcome when the route was available. */
export function parseCediaCreditsRedeemAnswer(value: unknown): CediaCreditsRedeemAnswer {
  const row = usageRecord(value, "Cedia host returned an invalid saved reset redeem response.");
  if (row.state === "unavailable") {
    usageExact(row, ["state", "reason", "lastRedeem"], "Cedia host returned an invalid saved reset redeem unavailable response.");
    return {
      state: "unavailable",
      reason: usageString(row.reason, "Cedia host returned an invalid saved reset redeem unavailable reason."),
      ...(usageHas(row, "lastRedeem") ? { lastRedeem: parseCediaCreditRedeem(row.lastRedeem) } : {}),
    };
  }
  const answer = parseCediaCreditsAnswer(value);
  if (answer.state === "available" && answer.lastRedeem === undefined) {
    throw new Error("Cedia host returned an invalid saved reset redeem response.");
  }
  return answer;
}

export function serverCreditsQueryOptions(sessionId: string, enabled = false) {
  return queryOptions({
    queryKey: serverQueryKeys.credits(sessionId),
    queryFn: async () => parseCediaCreditsAnswer(await getCediaCreditsApi().getCredits(sessionId)),
    // Saved-reset listing contacts providers. Keep it owner-triggered and never ask again on a timer,
    // focus, or reconnect after a deliberate check.
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

export function serverCreditsRedeemMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.creditsRedeem(input.sessionId),
    mutationFn: async (target: CediaCreditTarget) =>
      parseCediaCreditsRedeemAnswer(await getCediaCreditsApi().redeemCredit(input.sessionId, target)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.credits(input.sessionId), answer);
      // The POST already returns the fresh account rows. Mark stale for a later explicit check,
      // while refetchType none keeps this owner-only mutation from spending another read.
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.credits(input.sessionId), refetchType: "none" });
    },
  });
}

/** Compatibility name for callers that describe this as the credits mutation rather than redeem. */
export const serverCreditsMutationOptions = serverCreditsRedeemMutationOptions;

export function serverContextDropImagesMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.contextDropImages(input.sessionId),
    mutationFn: async (body: CediaContextCommandInput) =>
      parseCediaContextDropAnswer(await getCediaContextApi().dropContextImages(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.context(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.context(input.sessionId) });
    },
  });
}

export function serverContextShakeMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.contextShake(input.sessionId),
    mutationFn: async (body: CediaContextShakeInput) =>
      parseCediaContextShakeAnswer(await getCediaContextApi().shakeContext(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.context(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.context(input.sessionId) });
    },
  });
}

export function serverContextAbortCompactionMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.contextAbortCompaction(input.sessionId),
    mutationFn: async (body: CediaContextCommandInput) =>
      parseCediaContextAbortAnswer(await getCediaContextApi().abortCompaction(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.context(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.context(input.sessionId) });
    },
  });
}

function invalidateHistoryBoundary(input: { readonly sessionId: string; readonly queryClient: QueryClient }): void {
  void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.history(input.sessionId) });
  void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.context(input.sessionId) });
  void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.historyTranscript(input.sessionId) });
}

export function serverHistoryClearMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.historyClear(input.sessionId),
    mutationFn: async (body: CediaContextCommandInput = {}) =>
      await getCediaHistoryApi().clearContext(input.sessionId, body),
    onSuccess: () => invalidateHistoryBoundary(input),
  });
}

export function serverHistoryFreshMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.historyFresh(input.sessionId),
    mutationFn: async (body: CediaContextCommandInput = {}) =>
      await getCediaHistoryApi().freshSession(input.sessionId, body),
    onSuccess: () => invalidateHistoryBoundary(input),
  });
}

/** Compatibility names for callers that describe the controls by their UI action. */
export const serverClearContextMutationOptions = serverHistoryClearMutationOptions;
export const serverFreshSessionMutationOptions = serverHistoryFreshMutationOptions;

function memoryInteger(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(message);
  return value;
}

function memoryText(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(message);
  return value;
}

function parseCediaMnemopiState(value: unknown): CediaMnemopiState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid Mnemopi memory state.");
  }
  const row = value as Record<string, unknown>;
  const fields = ["sessionId", "lastRetainedTurn", "hasRecalledForFirstTurn", "recallTargets", "hasGlobalTarget"];
  if (Object.keys(row).some((field) => !fields.includes(field))) {
    throw new Error("Cedia host returned an invalid Mnemopi memory state.");
  }
  if (
    typeof row.hasRecalledForFirstTurn !== "boolean" ||
    typeof row.hasGlobalTarget !== "boolean"
  ) {
    throw new Error("Cedia host returned an invalid Mnemopi memory state.");
  }
  return {
    sessionId: memoryText(row.sessionId, "Cedia host returned an invalid Mnemopi session id."),
    lastRetainedTurn: memoryInteger(row.lastRetainedTurn, "Cedia host returned an invalid Mnemopi retained-turn count."),
    hasRecalledForFirstTurn: row.hasRecalledForFirstTurn,
    recallTargets: memoryInteger(row.recallTargets, "Cedia host returned an invalid Mnemopi recall-target count."),
    hasGlobalTarget: row.hasGlobalTarget,
  };
}

function parseCediaHindsightState(value: unknown): CediaHindsightState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid Hindsight memory state.");
  }
  const row = value as Record<string, unknown>;
  const fields = [
    "sessionId",
    "bankId",
    "banksSet",
    "retainTags",
    "recallTags",
    "recallTagsMatch",
    "lastRetainedTurn",
    "hasRecalledForFirstTurn",
  ];
  if (Object.keys(row).some((field) => !fields.includes(field))) {
    throw new Error("Cedia host returned an invalid Hindsight memory state.");
  }
  if (
    typeof row.hasRecalledForFirstTurn !== "boolean" ||
    (row.recallTagsMatch !== undefined && row.recallTagsMatch !== "any" && row.recallTagsMatch !== "all" && row.recallTagsMatch !== "any_strict" && row.recallTagsMatch !== "all_strict")
  ) {
    throw new Error("Cedia host returned an invalid Hindsight memory state.");
  }
  return {
    sessionId: memoryText(row.sessionId, "Cedia host returned an invalid Hindsight session id."),
    bankId: memoryText(row.bankId, "Cedia host returned an invalid Hindsight bank id."),
    banksSet: memoryInteger(row.banksSet, "Cedia host returned an invalid Hindsight bank count."),
    retainTags: memoryInteger(row.retainTags, "Cedia host returned an invalid Hindsight retain-tag count."),
    recallTags: memoryInteger(row.recallTags, "Cedia host returned an invalid Hindsight recall-tag count."),
    ...(row.recallTagsMatch === undefined ? {} : { recallTagsMatch: row.recallTagsMatch as CediaRecallTagsMatch }),
    lastRetainedTurn: memoryInteger(row.lastRetainedTurn, "Cedia host returned an invalid Hindsight retained-turn count."),
    hasRecalledForFirstTurn: row.hasRecalledForFirstTurn,
  };
}

function memoryBackend(value: unknown): CediaMemoryBackend {
  if (value === "off" || value === "local" || value === "hindsight" || value === "mnemopi" || value === "sharpshooter") return value;
  throw new Error("Cedia host returned an invalid memory backend.");
}

function parseCediaMemoryAnswerInternal(value: unknown): CediaMemoryAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid memory response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    if (Object.keys(row).some((field) => !["state", "reason"].includes(field))) {
      throw new Error("Cedia host returned an invalid memory unavailable response.");
    }
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
      throw new Error("Cedia host returned an invalid memory unavailable response.");
    }
    return { state: "unavailable", reason: row.reason };
  }
  const fields = ["state", "revision", "backend", "mnemopi", "hindsight", "applied"];
  if (
    row.state !== "available" ||
    Object.keys(row).some((field) => !fields.includes(field)) ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    (row.applied !== undefined && row.applied !== true)
  ) {
    throw new Error("Cedia host returned an invalid memory response.");
  }
  const mnemopi = row.mnemopi === undefined ? undefined : parseCediaMnemopiState(row.mnemopi);
  const hindsight = row.hindsight === undefined ? undefined : parseCediaHindsightState(row.hindsight);
  return {
    state: "available",
    revision: row.revision,
    backend: memoryBackend(row.backend),
    ...(mnemopi === undefined ? {} : { mnemopi }),
    ...(hindsight === undefined ? {} : { hindsight }),
    ...(row.applied === undefined ? {} : { applied: true as const }),
  };
}

export function parseCediaMemoryAnswer(value: unknown): CediaMemoryAnswer {
  return parseCediaMemoryAnswerInternal(value);
}

export function parseCediaMemoryApplyAnswer(value: unknown): CediaMemoryAnswer {
  const answer = parseCediaMemoryAnswerInternal(value);
  if (answer.state === "available" && answer.applied !== true) {
    throw new Error("Cedia host returned an invalid memory apply response.");
  }
  return answer;
}

export function serverMemoryQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.memory(sessionId),
    queryFn: async () => parseCediaMemoryAnswer(await getCediaMemoryApi().getMemory(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    // Memory changes arrive with the runtime's activity stream; a timer would report a state the
    // owner has not published at a turn boundary.
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function serverMemoryMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.memoryApply(input.sessionId),
    mutationFn: async (body: CediaMemoryCommandInput) =>
      parseCediaMemoryApplyAnswer(await getCediaMemoryApi().applyMemoryBackend(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.memory(input.sessionId), answer);
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.memory(input.sessionId) });
    },
  });
}

function asAgentRow(value: unknown): CediaAgentRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid agent row.");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.kind !== "string" ||
    typeof row.status !== "string" ||
    typeof row.createdAt !== "number" ||
    !Number.isFinite(row.createdAt) ||
    typeof row.lastActivity !== "number" ||
    !Number.isFinite(row.lastActivity) ||
    (row.parentId !== undefined && typeof row.parentId !== "string") ||
    (row.activity !== undefined && typeof row.activity !== "string") ||
    (row.sessionFile !== undefined && typeof row.sessionFile !== "string")
  ) {
    throw new Error("Cedia host returned an invalid agent row.");
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    ...(row.parentId === undefined ? {} : { parentId: row.parentId }),
    status: row.status,
    createdAt: row.createdAt,
    lastActivity: row.lastActivity,
    ...(row.activity === undefined ? {} : { activity: row.activity }),
    ...(row.sessionFile === undefined ? {} : { sessionFile: row.sessionFile }),
  };
}

export function parseCediaAgentsAnswer(value: unknown): CediaAgentsAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid agents response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    return {
      state: "unavailable",
      reason:
        typeof row.reason === "string" && row.reason.trim().length > 0
          ? row.reason
          : "The Cedia agents runtime is unavailable.",
    };
  }
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    !Array.isArray(row.agents)
  ) {
    throw new Error("Cedia host returned an invalid agents response.");
  }
  return { state: "available", revision: row.revision, agents: row.agents.map(asAgentRow) };
}

function asAgentTranscriptMessage(value: unknown): CediaAgentTranscriptMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid agent transcript message.");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.role !== "string" ||
    typeof row.text !== "string" ||
    typeof row.otherParts !== "number" ||
    !Number.isSafeInteger(row.otherParts) ||
    row.otherParts < 0
  ) {
    throw new Error("Cedia host returned an invalid agent transcript message.");
  }
  return { role: row.role, text: row.text, otherParts: row.otherParts };
}

export function parseCediaAgentTranscriptAnswer(value: unknown): CediaAgentTranscriptAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid agent transcript response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    return {
      state: "unavailable",
      reason:
        typeof row.reason === "string" && row.reason.trim().length > 0
          ? row.reason
          : "The Cedia agent transcript is unavailable.",
    };
  }
  if (
    row.state !== "available" ||
    typeof row.agentId !== "string" ||
    typeof row.sessionFile !== "string" ||
    typeof row.fromByte !== "number" ||
    !Number.isSafeInteger(row.fromByte) ||
    row.fromByte < 0 ||
    typeof row.nextByte !== "number" ||
    !Number.isSafeInteger(row.nextByte) ||
    row.nextByte < row.fromByte ||
    typeof row.reset !== "boolean" ||
    !Array.isArray(row.messages) ||
    typeof row.truncated !== "boolean"
  ) {
    throw new Error("Cedia host returned an invalid agent transcript response.");
  }
  return {
    state: "available",
    agentId: row.agentId,
    sessionFile: row.sessionFile,
    fromByte: row.fromByte,
    nextByte: row.nextByte,
    reset: row.reset,
    messages: row.messages.map(asAgentTranscriptMessage),
    truncated: row.truncated,
  };
}

export function serverAgentsQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.agents(sessionId),
    queryFn: async () => parseCediaAgentsAnswer(await getCediaAgentsApi().getAgents(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export interface CediaAgentConfigRow {
  readonly name: string;
  readonly source: string;
  readonly enabled: boolean;
  readonly model?: string;
  readonly prewalk?: string;
  readonly advisor?: string;
}

export type CediaAgentConfigsAnswer =
  | { readonly state: "available"; readonly agents: readonly CediaAgentConfigRow[] }
  | { readonly state: "unavailable"; readonly reason: string };

function asAgentConfigRow(value: unknown, message: string): CediaAgentConfigRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  const row = value as Record<string, unknown>;
  if (typeof row.name !== "string" || typeof row.source !== "string" || typeof row.enabled !== "boolean") {
    throw new Error(message);
  }
  const fields: Record<string, unknown> = { name: row.name, source: row.source, enabled: row.enabled };
  for (const field of ["model", "prewalk", "advisor"] as const) {
    const entry = row[field];
    if (entry !== undefined) {
      if (typeof entry !== "string") throw new Error(message);
      fields[field] = entry;
    }
  }
  return fields as unknown as CediaAgentConfigRow;
}

export function parseCediaAgentConfigsAnswer(value: unknown): CediaAgentConfigsAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid agent configs response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    return {
      state: "unavailable",
      reason:
        typeof row.reason === "string" && row.reason.trim().length > 0
          ? row.reason
          : "The Cedia agent configs are unavailable.",
    };
  }
  if (row.state !== "available" || !Array.isArray(row.agents)) {
    throw new Error("Cedia host returned an invalid agent configs response.");
  }
  return {
    state: "available",
    agents: row.agents.map((entry) => asAgentConfigRow(entry, "Cedia host returned an invalid agent configs response.")),
  };
}

export function serverAgentConfigsQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.agentConfigs(sessionId),
    queryFn: async () => parseCediaAgentConfigsAnswer(await getCediaAgentsApi().getAgentConfigs(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function serverAgentTranscriptQueryOptions(
  sessionId: string,
  agentId: string,
  fromByte = 0,
  enabled = true,
) {
  return queryOptions({
    queryKey: serverQueryKeys.agentTranscript(sessionId, agentId, fromByte),
    queryFn: async () =>
      parseCediaAgentTranscriptAnswer(
        await getCediaAgentsApi().getAgentTranscript(sessionId, agentId, fromByte),
      ),
    enabled: enabled && sessionId.length > 0 && agentId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export interface CediaAgentKillInput {
  readonly id: string;
}

export type CediaAgentKillAnswer =
  | { readonly available: true; readonly id: string; readonly aborted: boolean; readonly released: boolean }
  | { readonly available: false; readonly reason: string };

export function parseCediaAgentKillAnswer(value: unknown): CediaAgentKillAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid agent kill response.");
  }
  const row = value as Record<string, unknown>;
  if (row.available === false) {
    return {
      available: false,
      reason:
        typeof row.reason === "string" && row.reason.trim().length > 0
          ? row.reason
          : "The Cedia agent kill is unavailable.",
    };
  }
  if (
    row.available !== true ||
    typeof row.id !== "string" ||
    typeof row.aborted !== "boolean" ||
    typeof row.released !== "boolean"
  ) {
    throw new Error("Cedia host returned an invalid agent kill response.");
  }
  return { available: true, id: row.id, aborted: row.aborted, released: row.released };
}

export interface CediaAgentReviveInput {
  readonly id: string;
}

export type CediaAgentReviveAnswer =
  | { readonly available: true; readonly id: string; readonly revived: boolean }
  | { readonly available: false; readonly reason: string };

export function parseCediaAgentReviveAnswer(value: unknown): CediaAgentReviveAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid agent revive response.");
  }
  const row = value as Record<string, unknown>;
  if (row.available === false) {
    return {
      available: false,
      reason:
        typeof row.reason === "string" && row.reason.trim().length > 0
          ? row.reason
          : "The Cedia agent revive is unavailable.",
    };
  }
  if (row.available !== true || typeof row.id !== "string" || typeof row.revived !== "boolean") {
    throw new Error("Cedia host returned an invalid agent revive response.");
  }
  return { available: true, id: row.id, revived: row.revived };
}

export function serverAgentsKillMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["server", "mutation", "agents", "kill", input.sessionId] as const,
    mutationFn: async (body: CediaAgentKillInput) =>
      parseCediaAgentKillAnswer(await getCediaAgentsApi().killAgent(input.sessionId, body.id)),
    onSuccess: (answer) => {
      if (answer.available !== true) return;
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.agents(input.sessionId) });
    },
  });
}

export function serverAgentsReviveMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["server", "mutation", "agents", "revive", input.sessionId] as const,
    mutationFn: async (body: CediaAgentReviveInput) =>
      parseCediaAgentReviveAnswer(await getCediaAgentsApi().reviveAgent(input.sessionId, body.id)),
    onSuccess: (answer) => {
      if (answer.available !== true) return;
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.agents(input.sessionId) });
    },
  });
}

export type CediaAgentConfigAnswer =
  | { readonly available: true; readonly agent: string; readonly enabled: boolean; readonly model?: string; readonly prewalk?: string; readonly advisor?: string }
  | { readonly available: false; readonly reason: string };

function cediaAgentConfigText(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

export function parseCediaAgentConfigAnswer(value: unknown): CediaAgentConfigAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid agent config response.");
  }
  const row = value as Record<string, unknown>;
  if (row.available === false) {
    return {
      available: false,
      reason:
        typeof row.reason === "string" && row.reason.trim().length > 0
          ? row.reason
          : "The Cedia agent config is unavailable.",
    };
  }
  if (row.available !== true || typeof row.agent !== "string" || typeof row.enabled !== "boolean") {
    throw new Error("Cedia host returned an invalid agent config response.");
  }
  const answer: Record<string, unknown> = { available: true, agent: row.agent, enabled: row.enabled };
  for (const field of ["model", "prewalk", "advisor"] as const) {
    const entry = row[field];
    if (entry !== undefined) answer[field] = cediaAgentConfigText(entry, "Cedia host returned an invalid agent config response.");
  }
  return answer as unknown as CediaAgentConfigAnswer;
}

export function serverAgentsConfigMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["server", "mutation", "agents", "config", input.sessionId] as const,
    mutationFn: async (body: CediaAgentConfigInput) =>
      parseCediaAgentConfigAnswer(await getCediaAgentsApi().configureAgent(input.sessionId, body)),
    onSuccess: (answer) => {
      if (answer.available !== true) return;
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.agents(input.sessionId) });
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.agentConfigs(input.sessionId) });
    },
  });
}

function advisorNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(message);
  return value;
}

function advisorModel(value: unknown, message: string): CediaAdvisorModel | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  const row = value as Record<string, unknown>;
  if (
    typeof row.provider !== "string" || row.provider.trim().length === 0 ||
    typeof row.id !== "string" || row.id.trim().length === 0 ||
    (row.name !== undefined && typeof row.name !== "string")
  ) {
    throw new Error(message);
  }
  return {
    provider: row.provider,
    id: row.id,
    ...(row.name === undefined ? {} : { name: row.name }),
  };
}

function advisorTokens(value: unknown): CediaAdvisorTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cedia host returned an invalid advisor token summary.");
  const row = value as Record<string, unknown>;
  return {
    input: advisorNumber(row.input, "Cedia host returned an invalid advisor token summary."),
    output: advisorNumber(row.output, "Cedia host returned an invalid advisor token summary."),
    reasoning: advisorNumber(row.reasoning, "Cedia host returned an invalid advisor token summary."),
    cacheRead: advisorNumber(row.cacheRead, "Cedia host returned an invalid advisor token summary."),
    cacheWrite: advisorNumber(row.cacheWrite, "Cedia host returned an invalid advisor token summary."),
    total: advisorNumber(row.total, "Cedia host returned an invalid advisor token summary."),
  };
}

function advisorMessages(value: unknown): CediaAdvisorMessages {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cedia host returned an invalid advisor message summary.");
  const row = value as Record<string, unknown>;
  return {
    user: advisorNumber(row.user, "Cedia host returned an invalid advisor message summary."),
    assistant: advisorNumber(row.assistant, "Cedia host returned an invalid advisor message summary."),
    total: advisorNumber(row.total, "Cedia host returned an invalid advisor message summary."),
  };
}

function advisorUsage(value: Record<string, unknown>): Pick<CediaAdvisorRow, "model" | "contextWindow" | "contextTokens" | "tokens" | "cost" | "messages"> {
  const model = advisorModel(value.model, "Cedia host returned an invalid advisor model.");
  return {
    ...(model === undefined ? {} : { model }),
    contextWindow: advisorNumber(value.contextWindow, "Cedia host returned an invalid advisor context."),
    contextTokens: advisorNumber(value.contextTokens, "Cedia host returned an invalid advisor context."),
    tokens: advisorTokens(value.tokens),
    cost: advisorNumber(value.cost, "Cedia host returned an invalid advisor cost."),
    messages: advisorMessages(value.messages),
  };
}

function advisorRow(value: unknown): CediaAdvisorRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cedia host returned an invalid advisor row.");
  const row = value as Record<string, unknown>;
  if (typeof row.name !== "string" || typeof row.status !== "string") throw new Error("Cedia host returned an invalid advisor row.");
  const usage = advisorUsage(row);
  return {
    name: row.name,
    status: row.status,
    ...usage,
    ...(row.sessionId === undefined ? {} : typeof row.sessionId === "string"
      ? { sessionId: row.sessionId }
      : (() => { throw new Error("Cedia host returned an invalid advisor session id."); })()),
  };
}

function advisorSnapshot(value: unknown): CediaAdvisorSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cedia host returned an invalid advisor snapshot.");
  const row = value as Record<string, unknown>;
  if (
    typeof row.enabled !== "boolean" ||
    typeof row.active !== "boolean" ||
    typeof row.configured !== "boolean" ||
    !Array.isArray(row.advisors) ||
    typeof row.changed !== "boolean"
  ) {
    throw new Error("Cedia host returned an invalid advisor snapshot.");
  }
  const summary = advisorUsage(row);
  return {
    enabled: row.enabled,
    active: row.active,
    configured: row.configured,
    ...summary,
    advisors: row.advisors.map(advisorRow),
    changed: row.changed,
  };
}

export function parseCediaAdvisorAnswer(value: unknown): CediaAdvisorAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cedia host returned an invalid advisor response.");
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    return {
      state: "unavailable",
      reason: typeof row.reason === "string" && row.reason.trim().length > 0
        ? row.reason
        : "The Cedia advisor runtime is unavailable.",
    };
  }
  if (row.state !== "available" || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 0) {
    throw new Error("Cedia host returned an invalid advisor response.");
  }
  return { state: "available", revision: row.revision, advisor: advisorSnapshot(row.advisor) };
}

export function parseCediaAdvisorHistoryAnswer(value: unknown): CediaAdvisorHistoryAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cedia host returned an invalid advisor history response.");
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    return {
      state: "unavailable",
      reason: typeof row.reason === "string" && row.reason.trim().length > 0
        ? row.reason
        : "The Cedia advisor transcript is unavailable.",
    };
  }
  if (
    row.state !== "available" ||
    (row.text !== null && typeof row.text !== "string") ||
    typeof row.truncated !== "boolean"
  ) {
    throw new Error("Cedia host returned an invalid advisor history response.");
  }
  return { state: "available", text: row.text, truncated: row.truncated };
}

export function serverAdvisorQueryOptions(sessionId: string, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.advisor(sessionId),
    queryFn: async () => parseCediaAdvisorAnswer(await getCediaAdvisorApi().getAdvisor(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function serverAdvisorMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.advisor(input.sessionId),
    mutationFn: async (body: CediaAdvisorCommandInput) =>
      parseCediaAdvisorAnswer(await getCediaAdvisorApi().setAdvisor(input.sessionId, body)),
    onSuccess: (answer) => {
      input.queryClient.setQueryData(serverQueryKeys.advisor(input.sessionId), answer);
    },
  });
}

function getCediaAdvisorConfigApi(): CediaAdvisorConfigApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<CediaAdvisorConfigApi> };
  if (typeof api.cedia?.getAdvisorConfig !== "function" || typeof api.cedia?.setAdvisorConfig !== "function") {
    throw new Error("Cedia advisor config bridge is unavailable.");
  }
  return api.cedia as CediaAdvisorConfigApi;
}

export function parseCediaAdvisorConfigAnswer(value: unknown): CediaAdvisorConfigAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cedia host returned an invalid advisor config response.");
  }
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable") {
    for (const key of Object.keys(row)) {
      if (key !== "state" && key !== "reason") {
        throw new Error("Cedia host returned an invalid advisor config unavailable response.");
      }
    }
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
      throw new Error("Cedia host returned an invalid advisor config unavailable response.");
    }
    return { state: "unavailable", reason: row.reason };
  }
  if (
    row.state !== "available" ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  ) {
    throw new Error("Cedia host returned an invalid advisor config response.");
  }
  for (const key of Object.keys(row)) {
    if (key !== "state" && key !== "revision" && key !== "scope" && key !== "path" && key !== "exists" && key !== "text" && key !== "advisors") {
      throw new Error("Cedia host returned an invalid advisor config response.");
    }
  }
  if (row.scope !== "project" && row.scope !== "user") {
    throw new Error("Cedia host returned an invalid advisor config scope.");
  }
  if (typeof row.path !== "string" || row.path.trim().length === 0) {
    throw new Error("Cedia host returned an invalid advisor config path.");
  }
  if (typeof row.exists !== "boolean" || typeof row.text !== "string") {
    throw new Error("Cedia host returned an invalid advisor config file state.");
  }
  // The runtime omits the roster count on a read: only a write that applied answers it.
  const advisors = row.advisors === null || row.advisors === undefined
    ? undefined
    : typeof row.advisors === "number" && Number.isSafeInteger(row.advisors) && row.advisors >= 0
      ? row.advisors
      : (() => { throw new Error("Cedia host returned an invalid advisor config roster count."); })();
  return {
    state: "available" as const,
    revision: row.revision,
    scope: row.scope,
    path: row.path,
    exists: row.exists,
    text: row.text,
    ...(advisors === undefined ? {} : { advisors }),
  };
}

export function serverAdvisorConfigQueryOptions(sessionId: string, scope: CediaAdvisorConfigScope, enabled = true) {
  return queryOptions({
    queryKey: serverQueryKeys.advisorConfig(sessionId, scope),
    queryFn: async () => parseCediaAdvisorConfigAnswer(await getCediaAdvisorConfigApi().getAdvisorConfig(sessionId, scope)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    // Config files change outside Cedia too, so the editor re-reads on focus rather than
    // trusting a cached copy it may no longer own.
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function serverAdvisorConfigMutationOptions(input: { readonly sessionId: string; readonly queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.advisorConfig(input.sessionId),
    mutationFn: async (body: CediaAdvisorConfigInput) =>
      parseCediaAdvisorConfigAnswer(await getCediaAdvisorConfigApi().setAdvisorConfig(input.sessionId, body)),
    onSuccess: (answer) => {
      if (answer.state === "available") {
        input.queryClient.setQueryData(serverQueryKeys.advisorConfig(input.sessionId, answer.scope), answer);
      }
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.advisor(input.sessionId) });
    },
  });
}

export function serverAdvisorHistoryQueryOptions(sessionId: string, enabled = false) {
  return queryOptions({
    queryKey: serverQueryKeys.advisorHistory(sessionId),
    queryFn: async () => parseCediaAdvisorHistoryAnswer(await getCediaAdvisorApi().getAdvisorHistory(sessionId)),
    enabled: enabled && sessionId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    staleTime: Infinity,
  });
}

/**
 * Cedia's host capability snapshot.
 *
 * The host's answer depends on this process's live state - whether an OMP runtime is running,
 * whether the packaged remote client let the gateway start - so it is re-read when the window is
 * focused after a short staleness window. The earlier `staleTime: Infinity` meant a window opened
 * before a task started kept reporting "no runtime" for the rest of its life. An unparsable
 * answer stays `undefined`, which every consumer reads as "unknown", never as "everything works".
 */
export const CAPABILITY_SNAPSHOT_STALE_TIME_MS = 30_000;

export function serverCapabilitiesQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.capabilities(),
    queryFn: async (): Promise<readonly HostCapability[] | undefined> => {
      const api = ensureNativeApi() as unknown as { cedia?: { getCapabilities?: () => Promise<unknown> } };
      if (typeof api.cedia?.getCapabilities !== "function") return undefined;
      try {
        return parseCapabilitySnapshot(await api.cedia.getCapabilities());
      } catch {
        // A host that cannot answer leaves every row at its current honest behaviour.
        return undefined;
      }
    },
    staleTime: CAPABILITY_SNAPSHOT_STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
}

interface ProviderStatusSnapshot {
  readonly revision: number;
  readonly providers: readonly ServerProviderStatus[];
  readonly reconciled: boolean;
}

const latestProviderStatusSnapshotByQueryClient = new WeakMap<
  QueryClient,
  ProviderStatusSnapshot
>();

export function hasReconciledServerProviderStatuses(queryClient: QueryClient): boolean {
  return latestProviderStatusSnapshotByQueryClient.get(queryClient)?.reconciled === true;
}

function recordProviderStatusSnapshot(
  queryClient: QueryClient,
  providers: readonly ServerProviderStatus[],
): ProviderStatusSnapshot {
  const snapshot = {
    revision: (latestProviderStatusSnapshotByQueryClient.get(queryClient)?.revision ?? 0) + 1,
    providers,
    reconciled: true,
  };
  latestProviderStatusSnapshotByQueryClient.set(queryClient, snapshot);
  return snapshot;
}

/**
 * Folds an authoritative provider snapshot into server.config. Provider streams
 * can win the race against the initial config query, so retain the latest
 * snapshot and apply it after config hydration instead of dropping it.
 */
export async function reconcileServerProviderStatuses(
  queryClient: QueryClient,
  providers: readonly ServerProviderStatus[],
  options?: {
    readonly loadConfig?: () => Promise<ServerConfig>;
  },
): Promise<void> {
  recordProviderStatusSnapshot(queryClient, providers);

  let applied = false;
  queryClient.setQueryData<ServerConfig>(serverQueryKeys.config(), (current) => {
    if (!current) return current;
    applied = true;
    return { ...current, providers };
  });
  if (applied) return;

  const loadConfig =
    options?.loadConfig ??
    (() =>
      queryClient.fetchQuery({
        ...serverConfigQueryOptions(),
        staleTime: 0,
      }));
  const hydratedConfig = await loadConfig();
  const latestProviders =
    latestProviderStatusSnapshotByQueryClient.get(queryClient)?.providers ?? providers;
  queryClient.setQueryData<ServerConfig>(serverQueryKeys.config(), (current) => ({
    ...(current ?? hydratedConfig),
    providers: latestProviders,
  }));
}

/**
 * Refreshes the config projection when the WebSocket reopens without letting
 * the response overwrite a provider snapshot that arrived while it was in flight.
 */
export async function refreshServerConfigAfterTransportOpen(
  queryClient: QueryClient,
  options?: {
    readonly loadConfig?: () => Promise<ServerConfig>;
  },
): Promise<void> {
  const providerSnapshotAtStart = latestProviderStatusSnapshotByQueryClient.get(queryClient);
  const providerRevisionAtStart = providerSnapshotAtStart?.revision ?? 0;
  latestProviderStatusSnapshotByQueryClient.set(queryClient, {
    revision: providerRevisionAtStart,
    providers: providerSnapshotAtStart?.providers ?? [],
    reconciled: false,
  });
  const loadConfig =
    options?.loadConfig ??
    (() =>
      queryClient.fetchQuery({
        ...serverConfigQueryOptions(),
        staleTime: 0,
      }));
  const config = await loadConfig();
  const latestProviderSnapshot = latestProviderStatusSnapshotByQueryClient.get(queryClient);
  queryClient.setQueryData<ServerConfig>(serverQueryKeys.config(), {
    ...config,
    providers:
      latestProviderSnapshot?.reconciled === true &&
      latestProviderSnapshot.revision > providerRevisionAtStart
        ? latestProviderSnapshot.providers
        : config.providers,
  });
}

export function serverAuthSessionQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.authSession(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getAuthSession();
    },
    staleTime: 15_000,
  });
}

/**
 * The execution environment (OS, arch, server version) is fixed for the life of
 * a server process, so it caches indefinitely; a restart drops the socket and
 * remounts the app, which refetches.
 */
export function serverEnvironmentQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.environment(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getEnvironment();
    },
    staleTime: Infinity,
  });
}

export function serverSettingsQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.settings(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getSettings();
    },
    staleTime: Infinity,
  });
}

export function serverWorktreesQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.worktrees(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listWorktrees();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function serverLocalServersQueryOptions(
  input:
    | boolean
    | {
        enabled?: boolean;
        refetchInterval?: number | false;
        staleTime?: number;
      } = true,
) {
  const options = typeof input === "boolean" ? { enabled: input } : input;
  const enabled = options.enabled ?? true;
  return queryOptions({
    queryKey: serverQueryKeys.localServers(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listLocalServers();
    },
    enabled,
    staleTime: options.staleTime ?? LOCAL_SERVERS_DEFAULT_STALE_TIME_MS,
    refetchInterval: enabled
      ? (options.refetchInterval ?? LOCAL_SERVERS_VISIBLE_REFETCH_INTERVAL_MS)
      : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

// Sidebar project badges need a snapshot, but idle Home should not keep shelling out
// through lsof/ps; active Synara-owned runs still poll for responsive status.
export function sidebarLocalServersQueryOptions(input: {
  hasActiveProjectRun: boolean;
  hasProjects: boolean;
}) {
  const enabled = input.hasProjects || input.hasActiveProjectRun;
  return serverLocalServersQueryOptions({
    enabled,
    refetchInterval: input.hasActiveProjectRun ? LOCAL_SERVERS_VISIBLE_REFETCH_INTERVAL_MS : false,
  });
}

export function serverStopLocalServerMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.stopLocalServer(),
    mutationFn: async (server: ServerStopLocalServerInput) => {
      const api = ensureNativeApi();
      return api.server.stopLocalServer(server);
    },
    onSettled: () => {
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.localServers() });
    },
  });
}

export function serverProviderUsageSnapshotQueryOptions(input: {
  provider: ProviderKind | null | undefined;
  homePath?: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: serverQueryKeys.providerUsage(input.provider, input.homePath),
    enabled: (input.enabled ?? true) && input.provider !== null && input.provider !== undefined,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      if (!input.provider) return null;
      const api = ensureNativeApi();
      return api.server.getProviderUsageSnapshot({
        provider: input.provider,
        ...(input.homePath ? { homePath: input.homePath } : {}),
      });
    },
  });
}

export async function fetchAllProviderUsage(input: ServerListProviderUsageInput = {}) {
  const api = ensureNativeApi();
  return api.server.listProviderUsage(input);
}

export async function consumeCodexResetCredit(input: ServerConsumeCodexResetCreditInput) {
  const api = ensureNativeApi();
  return api.server.consumeCodexResetCredit(input);
}

/** Provider enablement changes alter the membership of the batch and invalidate any
 * provider-scoped result that may otherwise survive after a provider is disabled. */
export async function invalidateProviderUsageQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: serverQueryKeys.allProviderUsage() }),
    queryClient.invalidateQueries({ queryKey: serverQueryKeys.providerUsageRoot() }),
  ]);
}

// Local profile + shareable-card core statistics. The client passes its own fixed
// UTC offset; all metrics are computed from Synara's local DB projections.
export function serverProfileStatsQueryOptions(input: { enabled?: boolean } = {}) {
  const utcOffsetMinutes = -new Date().getTimezoneOffset();
  return queryOptions({
    queryKey: serverQueryKeys.profileStats(utcOffsetMinutes),
    enabled: input.enabled ?? true,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.stats.getProfileStats({
        utcOffsetMinutes,
      });
    },
  });
}

// DB-backed token totals and token heatmap, split from core stats so the Profile
// page can paint first and upgrade token-only surfaces later.
export function serverProfileTokenStatsQueryOptions(input: { enabled?: boolean } = {}) {
  const utcOffsetMinutes = -new Date().getTimezoneOffset();
  return queryOptions({
    queryKey: serverQueryKeys.profileTokenStats(utcOffsetMinutes),
    enabled: input.enabled ?? true,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.stats.getProfileTokenStats({
        utcOffsetMinutes,
      });
    },
  });
}

// Live remaining-usage for every provider. Always fetches the full batch under a single query
// key so every surface (settings panel, header chips, branch toolbar) shares one cache entry
// and one request cycle; the server caches per-provider snapshots, so the batch is cheap.
export function serverAllProviderUsageQueryOptions(
  input:
    | boolean
    | {
        enabled?: boolean;
      } = true,
) {
  const enabled = typeof input === "boolean" ? input : (input.enabled ?? true);
  return queryOptions({
    queryKey: serverQueryKeys.allProviderUsage(),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => fetchAllProviderUsage(),
  });
}
