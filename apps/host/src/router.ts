import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { CEDIA_PROTOCOL_VERSION, parseOmpSettingsContext, parseOmpSettingsMutation, type CommandRequest, type HostLifecycleAdmissionReceipt, type HostLifecycleSnapshot, type HostLifecycleStatus, type HostOmpCapabilitySnapshot, type HostOmpSettingsAnswer, type OmpGoalCommandRequest, type OmpSettingsContext, type OmpSettingsKeysSnapshot, type OmpSettingsMutation, type OmpSettingsValue, type HostQuitReceipt, type UiResponseRequest } from "../../../packages/protocol/src/index.ts";
import { isGitMethod } from "../../../packages/protocol/src/git.ts";
import { OMP_BASELINE_VERSION } from "../../../packages/omp-adapter/src/types.ts";
import { DeviceAuth } from "./auth.ts";
import { CediaHost, HostError } from "./service.ts";
import { ProviderAuthError } from "./provider-auth.ts";
import { reviewWorkspace, workspacePath } from "./workspaces.ts";
import { GitCapacityError, GitNotARepositoryError, GitPathNotAuthorizedError, gitAuthorizedRoots, type HostGitService } from "./git.ts";
import type { ArtifactStore } from "./artifacts.ts";
import type { RemoteConnection } from "./remote.ts";
import type { EditorConnections } from "./editors.ts";
import type { EditorResponse } from "../../../packages/protocol/src/editor.ts";
import { createHash } from "node:crypto";
import { ResponseChunks } from "./response-chunks.ts";
import { capabilitySnapshot } from "./capabilities.ts";
import { SettingsConflictError, SettingsStore } from "./settings.ts";
import { DraftConflictError, DraftStore } from "./drafts.ts";
import { OmpCapabilityRevisionError } from "./omp-capabilities.ts";
import { ompSettingDisposition } from "./omp-settings.ts";
import { OmpSettingsNotEditableError, OmpSettingsPathError, OmpSettingsRejectedError, OmpSettingsRevisionError, OmpSettingsValidationError } from "./omp-settings.ts";
import type { OmpAdvisorCommandRequest } from "./omp-advisor.ts";
import type { OmpAdvisorConfigScope, OmpAdvisorConfigWriteRequest } from "./omp-advisor-config.ts";
import { MAX_ADVISOR_CONFIG_TEXT_CHARS } from "./omp-advisor-config.ts";
import type { OmpPlanCommandRequest } from "./omp-plan.ts";
import type { OmpQueueDropRequest } from "./omp-queue.ts";
import type { OmpPauseCommandRequest } from "./omp-pause.ts";
import { MAX_BASH_COMMAND_CHARS, type OmpBashAbortRequest, type OmpBashExecRequest } from "./omp-bash.ts";
import { MAX_PYTHON_CODE_CHARS, type OmpPythonAbortRequest, type OmpPythonExecRequest } from "./omp-python.ts";
import type { OmpContextCommandRequest, OmpContextShakeRequest } from "./omp-context.ts";
import type { OmpMemoryCommandRequest } from "./omp-memory.ts";
import type { OmpCreditsCommandRequest } from "./omp-credits.ts";
import type { OmpCreditPolicy } from "./omp-policy.ts";
import type { OmpHistoryCommandRequest } from "./omp-history.ts";
import { OmpTreeValidationError, type OmpTreeNavigateRequest } from "./omp-tree.ts";
import { OmpPrewalkValidationError } from "./omp-prewalk.ts";
import { OmpLoopValidationError, type OmpLoopCommandRequest } from "./omp-loop.ts";
import { OmpBtwValidationError, type OmpBtwAskCommandRequest, type OmpBtwBranchCommandRequest } from "./omp-btw.ts";
import { OmpCleanseValidationError, type OmpCleanseAbortCommandRequest, type OmpCleanseRunCommandRequest } from "./omp-cleanse.ts";
import { OmpOmfgValidationError, type OmpOmfgAbortCommandRequest, type OmpOmfgDraftCommandRequest, type OmpOmfgSaveCommandRequest } from "./omp-omfg.ts";
import type { OmpExtensionSetRequest, OmpToolActiveSetRequest, OmpToolRefreshRequest } from "./omp-management.ts";
import type { OmpAgentConfigRequest, OmpAgentKillRequest, OmpAgentReviveRequest } from "./omp-agents.ts";
import { OmpModelStateValidationError, type OmpAccountPinCommandRequest, type OmpRoleApplyCommandRequest, type OmpRoleSetCommandRequest, type OmpServiceTierCommandRequest } from "./omp-model-state.ts";

export interface HostRequest { method: string; path: string; token?: string; body?: unknown }
export interface HostResponse { status: number; body: unknown }
/** The router's published shape: one request in, one response out. */
export type HostRouter = (request: HostRequest) => Promise<HostResponse>;
export interface VoiceTranscriptionInput {
  provider: string;
  cwd: string;
  threadId?: string;
  mimeType: string;
  sampleRateHz: number;
  durationMs: number;
  audioBase64: string;
}
export interface VoiceEndpoint {
  transcribe(input: VoiceTranscriptionInput): Promise<{ text: string }>;
  prewarm?(input: { provider: string }): Promise<{ ready: boolean }>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HostError("invalid_body", "Expected an object", 400);
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new HostError("invalid_body", `Invalid ${name}`, 400);
  return value;
}
function integer(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new HostError("invalid_cursor", "Invalid pagination", 400);
  return Number(value);
}

function goalCommand(value: Record<string, unknown>): OmpGoalCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "op", "objective", "tokenBudget"].includes(key)) throw new HostError("invalid_body", `Unsupported goal field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  const operations = ["get", "set", "replace", "pause", "resume", "drop", "complete", "budget"] as const;
  if (typeof value.op !== "string" || !(operations as readonly string[]).includes(value.op)) throw new HostError("invalid_body", "Invalid goal operation", 400);
  const op = value.op as OmpGoalCommandRequest["op"];
  if ((op === "set" || op === "replace") && (typeof value.objective !== "string" || value.objective.trim().length === 0)) throw new HostError("invalid_body", `Goal operation ${op} needs an objective`, 400);
  if (op !== "set" && op !== "replace" && value.objective !== undefined) throw new HostError("invalid_body", `Goal operation ${op} does not take an objective`, 400);
  if (value.tokenBudget !== undefined && (typeof value.tokenBudget !== "number" || !Number.isSafeInteger(value.tokenBudget) || value.tokenBudget <= 0)) throw new HostError("invalid_body", "Goal tokenBudget must be a positive integer", 400);
  if (!["set", "replace", "budget"].includes(op) && value.tokenBudget !== undefined) throw new HostError("invalid_body", `Goal operation ${op} does not take tokenBudget`, 400);
  return {
    commandId,
    incarnation,
    op,
    ...(typeof value.objective === "string" ? { objective: value.objective } : {}),
    ...(typeof value.tokenBudget === "number" ? { tokenBudget: value.tokenBudget } : {}),
  };
}

function advisorConfigScope(url: URL): OmpAdvisorConfigScope {
  const keys = [...url.searchParams.keys()];
  for (const key of keys) if (key !== "scope") throw new HostError("invalid_query", "Advisor config accepts only scope", 400);
  if (url.searchParams.getAll("scope").length !== 1) throw new HostError("invalid_query", "Advisor config needs one scope", 400);
  const scope = url.searchParams.get("scope");
  if (scope !== "project" && scope !== "user") throw new HostError("invalid_query", "Advisor config scope must be project or user", 400);
  return scope;
}

function advisorConfigCommand(value: Record<string, unknown>): OmpAdvisorConfigWriteRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "scope", "text"].includes(key)) throw new HostError("invalid_body", `Unsupported advisor config field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  const scope = value.scope;
  if (scope !== "project" && scope !== "user") throw new HostError("invalid_body", "Advisor config scope must be project or user", 400);
  if (typeof value.text !== "string") throw new HostError("invalid_body", "Advisor config text must be a string", 400);
  if (value.text.length > MAX_ADVISOR_CONFIG_TEXT_CHARS) throw new HostError("invalid_body", `Advisor config text exceeds ${MAX_ADVISOR_CONFIG_TEXT_CHARS} characters`, 400);
  return { commandId, incarnation, scope, text: value.text };
}

function advisorCommand(value: Record<string, unknown>): OmpAdvisorCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "op", "enabled"].includes(key)) throw new HostError("invalid_body", `Unsupported advisor field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  if (value.op !== "set") throw new HostError("invalid_body", "Invalid advisor operation", 400);
  if (typeof value.enabled !== "boolean") throw new HostError("invalid_body", "Advisor set enabled must be a boolean", 400);
  return { commandId, incarnation, op: "set", enabled: value.enabled };
}

function loopCommand(value: Record<string, unknown>): OmpLoopCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation"].includes(key)) throw new HostError("invalid_body", `Unsupported loop field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  return { commandId, incarnation };
}

function btwAskCommand(value: Record<string, unknown>): OmpBtwAskCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "question"].includes(key)) throw new HostError("invalid_body", `Unsupported side-question field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  const question = string(value.question, "question");
  if (question.trim().length === 0) throw new HostError("invalid_body", "Side question needs a question", 400);
  return { commandId, incarnation, question };
}

function cleanseRunCommand(value: Record<string, unknown>): OmpCleanseRunCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "request", "all", "includeTests", "maxAgents", "model"].includes(key)) throw new HostError("invalid_body", `Unsupported cleanse field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  if (value.request !== undefined && (typeof value.request !== "string" || value.request.trim().length === 0)) throw new HostError("invalid_body", "Cleanse request must be a non-empty string", 400);
  if (value.all !== undefined && typeof value.all !== "boolean") throw new HostError("invalid_body", "Cleanse all must be a boolean", 400);
  if (value.includeTests !== undefined && typeof value.includeTests !== "boolean") throw new HostError("invalid_body", "Cleanse includeTests must be a boolean", 400);
  if (value.maxAgents !== undefined && (typeof value.maxAgents !== "number" || !Number.isSafeInteger(value.maxAgents) || value.maxAgents <= 0)) throw new HostError("invalid_body", "Cleanse maxAgents must be a positive integer", 400);
  if (value.model !== undefined && (typeof value.model !== "string" || value.model.trim().length === 0)) throw new HostError("invalid_body", "Cleanse model must be a non-empty string", 400);
  return {
    commandId,
    incarnation,
    ...(typeof value.request === "string" ? { request: value.request } : {}),
    ...(typeof value.all === "boolean" ? { all: value.all } : {}),
    ...(typeof value.includeTests === "boolean" ? { includeTests: value.includeTests } : {}),
    ...(typeof value.maxAgents === "number" ? { maxAgents: value.maxAgents } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
  };
}

function omfgDraftCommand(value: Record<string, unknown>): OmpOmfgDraftCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "complaint", "feedback"].includes(key)) throw new HostError("invalid_body", `Unsupported rule field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  const complaint = string(value.complaint, "complaint");
  if (complaint.trim().length === 0) throw new HostError("invalid_body", "Rule forging needs a complaint", 400);
  if (value.feedback !== undefined && (typeof value.feedback !== "string" || value.feedback.trim().length === 0)) throw new HostError("invalid_body", "Rule feedback must be a non-empty string", 400);
  return {
    commandId,
    incarnation,
    complaint,
    ...(typeof value.feedback === "string" ? { feedback: value.feedback } : {}),
  };
}

function omfgSaveCommand(value: Record<string, unknown>): OmpOmfgSaveCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "scope", "overwrite", "allowUnvalidated"].includes(key)) throw new HostError("invalid_body", `Unsupported rule save field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  if (value.scope !== "project" && value.scope !== "global") throw new HostError("invalid_body", 'Rule save scope must be "project" or "global"', 400);
  if (value.overwrite !== undefined && typeof value.overwrite !== "boolean") throw new HostError("invalid_body", "Rule save overwrite must be a boolean", 400);
  if (value.allowUnvalidated !== undefined && typeof value.allowUnvalidated !== "boolean") throw new HostError("invalid_body", "Rule save allowUnvalidated must be a boolean", 400);
  return {
    commandId,
    incarnation,
    scope: value.scope,
    ...(typeof value.overwrite === "boolean" ? { overwrite: value.overwrite } : {}),
    ...(typeof value.allowUnvalidated === "boolean" ? { allowUnvalidated: value.allowUnvalidated } : {}),
  };
}

function omfgAbortCommand(value: Record<string, unknown>): OmpOmfgAbortCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation"].includes(key)) throw new HostError("invalid_body", `Unsupported rule abort field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  return { commandId, incarnation };
}

function cleanseAbortCommand(value: Record<string, unknown>): OmpCleanseAbortCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation"].includes(key)) throw new HostError("invalid_body", `Unsupported cleanse abort field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  return { commandId, incarnation };
}

function btwBranchCommand(value: Record<string, unknown>): OmpBtwBranchCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation"].includes(key)) throw new HostError("invalid_body", `Unsupported branch field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  return { commandId, incarnation };
}

function pauseCommand(value: Record<string, unknown>): OmpPauseCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "paused"].includes(key)) throw new HostError("invalid_body", `Unsupported pause field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  if (typeof value.paused !== "boolean") throw new HostError("invalid_body", "Run pause must be a boolean", 400);
  return { commandId, incarnation, paused: value.paused };
}

function bashExecCommand(value: Record<string, unknown>): OmpBashExecRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "command"].includes(key)) throw new HostError("invalid_body", `Unsupported shell field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  if (typeof value.command !== "string" || value.command.trim().length === 0) throw new HostError("invalid_body", "Shell command must be a non-empty string", 400);
  if (value.command.length > MAX_BASH_COMMAND_CHARS) throw new HostError("invalid_body", `Shell command exceeds ${MAX_BASH_COMMAND_CHARS} characters`, 400);
  return { commandId, incarnation, command: value.command };
}

function pythonExecCommand(value: Record<string, unknown>): OmpPythonExecRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "code"].includes(key)) throw new HostError("invalid_body", `Unsupported Python field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  if (typeof value.code !== "string" || value.code.trim().length === 0) throw new HostError("invalid_body", "Python code must be a non-empty string", 400);
  if (value.code.length > MAX_PYTHON_CODE_CHARS) throw new HostError("invalid_body", `Python code exceeds ${MAX_PYTHON_CODE_CHARS} characters`, 400);
  return { commandId, incarnation, code: value.code };
}

function pythonAbortCommand(value: Record<string, unknown>): OmpPythonAbortRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation"].includes(key)) throw new HostError("invalid_body", `Unsupported Python abort field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  return { commandId, incarnation };
}

function bashAbortCommand(value: Record<string, unknown>): OmpBashAbortRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation"].includes(key)) throw new HostError("invalid_body", `Unsupported shell abort field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  return { commandId, incarnation };
}

function queueRowCommand(value: Record<string, unknown>, kind: "remove" | "promote"): { commandId: string; incarnation: string; message: string; queue?: string } {
  for (const key of Object.keys(value)) {
    if (!["commandId", "incarnation", "message", "queue"].includes(key)) throw new HostError("invalid_body", `Unsupported queue ${kind} field ${key}`, 400);
    if (kind === "promote" && key === "queue") throw new HostError("invalid_body", "Queue promote addresses follow-up rows only", 400);
  }
  const message = string(value.message, "message");
  if (message.length === 0 || message.length > 4096) throw new HostError("invalid_body", "A queue row message is 1-4096 chars; longer submissions use drop last/all", 400);
  const out: { commandId: string; incarnation: string; message: string; queue?: string } = {
    commandId: string(value.commandId, "commandId"),
    incarnation: string(value.incarnation, "incarnation"),
    message,
  };
  if (kind === "remove") {
    const queue = string(value.queue, "queue");
    if (queue !== "steering" && queue !== "followUp") throw new HostError("invalid_body", "A queue removal names queue steering or followUp", 400);
    out.queue = queue;
  }
  return out;
}

function queueDropCommand(value: Record<string, unknown>): OmpQueueDropRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "mode"].includes(key)) throw new HostError("invalid_body", `Unsupported queue field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  if (value.mode !== "last" && value.mode !== "all") throw new HostError("invalid_body", "Queue drop mode must be last or all", 400);
  return { commandId, incarnation, mode: value.mode };
}

function contextCommand(value: Record<string, unknown>): OmpContextCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation"].includes(key)) throw new HostError("invalid_body", `Unsupported context field ${key}`, 400);
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation") };
}

function contextShakeCommand(value: Record<string, unknown>): OmpContextShakeRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "mode"].includes(key)) throw new HostError("invalid_body", `Unsupported context shake field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  if (value.mode !== "elide" && value.mode !== "images" && value.mode !== "thinking") throw new HostError("invalid_body", "Context shake mode must be elide, images or thinking", 400);
  return { commandId, incarnation, mode: value.mode };
}

function memoryCommand(value: Record<string, unknown>): OmpMemoryCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation"].includes(key)) throw new HostError("invalid_body", `Unsupported memory field ${key}`, 400);
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation") };
}

function historyCommand(value: Record<string, unknown>): OmpHistoryCommandRequest {
	for (const key of Object.keys(value)) if (!["commandId", "incarnation"].includes(key)) throw new HostError("invalid_body", `Unsupported history field ${key}`, 400);
	return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation") };
}

function treeNavigateCommand(value: Record<string, unknown>): OmpTreeNavigateRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "entryId", "summarize"].includes(key)) throw new HostError("invalid_body", `Unsupported tree field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  const entryId = string(value.entryId, "entryId");
  if (value.summarize !== undefined && typeof value.summarize !== "boolean") throw new HostError("invalid_body", "Tree navigate summarize must be a boolean", 400);
  return { commandId, incarnation, entryId, ...(value.summarize === undefined ? {} : { summarize: value.summarize }) };
}

function toolActiveSetCommand(value: Record<string, unknown>): OmpToolActiveSetRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "toolNames"].includes(key)) throw new HostError("invalid_body", `Unsupported tools field ${key}`, 400);
  if (!Array.isArray(value.toolNames) || value.toolNames.length > 500) throw new HostError("invalid_body", "Tools active set needs toolNames as an array of at most 500 strings", 400);
  for (const name of value.toolNames) {
    if (typeof name !== "string" || name.trim().length === 0) throw new HostError("invalid_body", "Tools active set needs every tool name as a non-empty string", 400);
  }
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation"), toolNames: [...(value.toolNames as string[])] };
}

function agentsKillCommand(value: Record<string, unknown>): OmpAgentKillRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "id"].includes(key)) throw new HostError("invalid_body", `Unsupported agents field ${key}`, 400);
  const id = string(value.id, "id");
  if (id.trim().length === 0) throw new HostError("invalid_body", "Agents kill needs an agent id", 400);
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation"), id };
}

function agentsReviveCommand(value: Record<string, unknown>): OmpAgentReviveRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "id"].includes(key)) throw new HostError("invalid_body", `Unsupported agents field ${key}`, 400);
  const id = string(value.id, "id");
  if (id.trim().length === 0) throw new HostError("invalid_body", "Agents revive needs an agent id", 400);
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation"), id };
}

function agentsConfigCommand(value: Record<string, unknown>): OmpAgentConfigRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "agent", "enabled", "model", "prewalk", "advisor"].includes(key)) throw new HostError("invalid_body", `Unsupported agents field ${key}`, 400);
  const agent = string(value.agent, "agent");
  if (agent.trim().length === 0) throw new HostError("invalid_body", "Agents config needs an agent name", 400);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") throw new HostError("invalid_body", "Agents config needs enabled as a boolean", 400);
  for (const field of ["model", "prewalk", "advisor"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") throw new HostError("invalid_body", `Agents config needs ${field} as a string`, 400);
  }
  if (value.enabled === undefined && value.model === undefined && value.prewalk === undefined && value.advisor === undefined) {
    throw new HostError("invalid_body", "Agents config needs at least one of enabled, model, prewalk or advisor", 400);
  }
  return {
    commandId: string(value.commandId, "commandId"),
    incarnation: string(value.incarnation, "incarnation"),
    agent,
    ...(value.enabled === undefined ? {} : { enabled: value.enabled as boolean }),
    ...(value.model === undefined ? {} : { model: value.model as string }),
    ...(value.prewalk === undefined ? {} : { prewalk: value.prewalk as string }),
    ...(value.advisor === undefined ? {} : { advisor: value.advisor as string }),
  };
}

function toolExtensionSetCommand(value: Record<string, unknown>): OmpExtensionSetRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "id", "enabled"].includes(key)) throw new HostError("invalid_body", `Unsupported tools field ${key}`, 400);
  const id = string(value.id, "id");
  if (id.trim().length === 0) throw new HostError("invalid_body", "Tools extension set needs an extension id", 400);
  if (typeof value.enabled !== "boolean") throw new HostError("invalid_body", "Tools extension set needs enabled as a boolean", 400);
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation"), id, enabled: value.enabled };
}

function toolRefreshCommand(value: Record<string, unknown>): OmpToolRefreshRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation"].includes(key)) throw new HostError("invalid_body", `Unsupported tools field ${key}`, 400);
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation") };
}

function accountPinCommand(value: Record<string, unknown>): OmpAccountPinCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "credentialId"].includes(key)) throw new HostError("invalid_body", `Unsupported accounts pin field ${key}`, 400);
  if (typeof value.credentialId !== "number" || !Number.isSafeInteger(value.credentialId) || value.credentialId < 0) throw new HostError("invalid_body", "Account credentialId must be a non-negative safe integer", 400);
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation"), credentialId: value.credentialId };
}

function roleApplyCommand(value: Record<string, unknown>): OmpRoleApplyCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "role"].includes(key)) throw new HostError("invalid_body", `Unsupported role apply field ${key}`, 400);
  const role = string(value.role, "role");
  if (role.trim().length === 0) throw new HostError("invalid_body", "Role apply needs a role name", 400);
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation"), role };
}

function roleSetCommand(value: Record<string, unknown>): OmpRoleSetCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "role", "modelId"].includes(key)) throw new HostError("invalid_body", `Unsupported role set field ${key}`, 400);
  const role = string(value.role, "role");
  if (role.trim().length === 0) throw new HostError("invalid_body", "Role set needs a role name", 400);
  if (!Object.hasOwn(value, "modelId") || (value.modelId !== null && (typeof value.modelId !== "string" || (value.modelId as string).trim().length === 0))) throw new HostError("invalid_body", "Role set needs a model id, or null to clear the role", 400);
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation"), role, modelId: value.modelId as string | null };
}

function serviceTierCommand(value: Record<string, unknown>): OmpServiceTierCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "family", "tier"].includes(key)) throw new HostError("invalid_body", `Unsupported service-tier field ${key}`, 400);
  if (typeof value.family !== "string") throw new HostError("invalid_body", "Service-tier family must be a string", 400);
  if (!Object.hasOwn(value, "tier") || (value.tier !== null && typeof value.tier !== "string")) throw new HostError("invalid_body", "Service-tier tier must be a string or null", 400);
  return { commandId: string(value.commandId, "commandId"), incarnation: string(value.incarnation, "incarnation"), family: value.family, tier: value.tier as string | null };
}

function creditsRedeemCommand(value: Record<string, unknown>): OmpCreditsCommandRequest {
  for (const key of Object.keys(value)) if (!["commandId", "incarnation", "target"].includes(key)) throw new HostError("invalid_body", `Unsupported credits field ${key}`, 400);
  const target = record(value.target);
  for (const key of Object.keys(target)) if (!["credentialId", "accountId", "email"].includes(key)) throw new HostError("invalid_body", `Unsupported credits target field ${key}`, 400);
  const names = (["credentialId", "accountId", "email"] as const).filter(key => target[key] !== undefined);
  if (names.length === 0) throw new HostError("invalid_body", "Credits redeem target needs one account identifier", 400);
  if (names.length > 1) throw new HostError("invalid_body", "Credits redeem target names only one account identifier", 400);
  if (target.credentialId !== undefined && (typeof target.credentialId !== "number" || !Number.isSafeInteger(target.credentialId) || target.credentialId < 0)) throw new HostError("invalid_body", "Credits credentialId must be a non-negative safe integer", 400);
  if (target.accountId !== undefined) string(target.accountId, "accountId");
  if (target.email !== undefined) string(target.email, "email");
  return {
    commandId: string(value.commandId, "commandId"),
    incarnation: string(value.incarnation, "incarnation"),
    target: {
      ...(target.credentialId === undefined ? {} : { credentialId: target.credentialId as number }),
      ...(target.accountId === undefined ? {} : { accountId: target.accountId as string }),
      ...(target.email === undefined ? {} : { email: target.email as string }),
    },
  };
}

function advisorHistoryCompact(url: URL): boolean | undefined {
  const keys = [...url.searchParams.keys()];
  for (const key of keys) if (key !== "compact") throw new HostError("invalid_query", "Advisor history accepts only compact", 400);
  if (!url.searchParams.has("compact")) return undefined;
  if (url.searchParams.getAll("compact").length !== 1) throw new HostError("invalid_query", "Advisor history accepts one compact value", 400);
  const value = url.searchParams.get("compact");
  if (value !== "true" && value !== "false") throw new HostError("invalid_query", "Advisor history compact must be true or false", 400);
  return value === "true";
}

function agentsFromByte(url: URL): number {
  for (const key of url.searchParams.keys()) if (key !== "fromByte") throw new HostError("invalid_query", "Agent transcript accepts only fromByte", 400);
  if (!url.searchParams.has("fromByte")) return 0;
  if (url.searchParams.getAll("fromByte").length !== 1) throw new HostError("invalid_query", "Agent transcript accepts one fromByte value", 400);
  const value = url.searchParams.get("fromByte");
  if (value === null || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new HostError("invalid_query", "Agent transcript fromByte must be a non-negative integer", 400);
  return Number(value);
}

function planCommand(value: Record<string, unknown>): OmpPlanCommandRequest {
  const allowed = ["commandId", "incarnation", "op", "workflow", "planFilePath", "paused", "confirm", "reviewId", "decision", "preserveContext", "compactBeforeExecute", "feedback"] as const;
  for (const key of Object.keys(value)) if (!(allowed as readonly string[]).includes(key)) throw new HostError("invalid_body", `Unsupported plan field ${key}`, 400);
  const commandId = string(value.commandId, "commandId");
  const incarnation = string(value.incarnation, "incarnation");
  const operations = ["read", "enter", "exit", "vibe.enter", "vibe.exit", "review.decide"] as const;
  if (typeof value.op !== "string" || !(operations as readonly string[]).includes(value.op)) throw new HostError("invalid_body", "Invalid plan operation", 400);
  const op = value.op as OmpPlanCommandRequest["op"];
  if (op === "enter") {
    if (value.workflow !== undefined && value.workflow !== "parallel" && value.workflow !== "iterative") throw new HostError("invalid_body", "Plan workflow must be parallel or iterative", 400);
    if (value.planFilePath !== undefined) string(value.planFilePath, "planFilePath");
    if (value.paused !== undefined || value.confirm !== undefined || value.reviewId !== undefined || value.decision !== undefined || value.preserveContext !== undefined || value.compactBeforeExecute !== undefined || value.feedback !== undefined)
      throw new HostError("invalid_body", "Plan enter does not take exit or review fields", 400);
  } else if (op === "exit") {
    if (value.paused !== undefined && typeof value.paused !== "boolean") throw new HostError("invalid_body", "Plan exit paused must be a boolean", 400);
    if (value.confirm !== undefined && typeof value.confirm !== "boolean") throw new HostError("invalid_body", "Plan exit confirm must be a boolean", 400);
    if (value.workflow !== undefined || value.planFilePath !== undefined || value.reviewId !== undefined || value.decision !== undefined || value.preserveContext !== undefined || value.compactBeforeExecute !== undefined || value.feedback !== undefined)
      throw new HostError("invalid_body", "Plan exit does not take enter or review fields", 400);
  } else if (op === "review.decide") {
    if (typeof value.reviewId !== "number" || !Number.isSafeInteger(value.reviewId) || value.reviewId < 0) throw new HostError("invalid_body", "Plan reviewId must be a non-negative integer", 400);
    if (value.decision !== "approve" && value.decision !== "refine" && value.decision !== "cancel") throw new HostError("invalid_body", "Invalid plan review decision", 400);
    if (value.preserveContext !== undefined && typeof value.preserveContext !== "boolean") throw new HostError("invalid_body", "Plan preserveContext must be a boolean", 400);
    if (value.compactBeforeExecute !== undefined && typeof value.compactBeforeExecute !== "boolean") throw new HostError("invalid_body", "Plan compactBeforeExecute must be a boolean", 400);
    if (value.feedback !== undefined && (typeof value.feedback !== "string" || value.feedback.length > 4096)) throw new HostError("invalid_body", "Invalid plan feedback", 400);
    if (value.workflow !== undefined || value.planFilePath !== undefined || value.paused !== undefined || value.confirm !== undefined) throw new HostError("invalid_body", "Plan review decision does not take enter or exit fields", 400);
  } else if (["read", "vibe.enter", "vibe.exit"].includes(op)) {
    if (Object.keys(value).some(key => !["commandId", "incarnation", "op"].includes(key))) throw new HostError("invalid_body", `Plan operation ${op} takes no additional fields`, 400);
  }
  return {
    commandId,
    incarnation,
    op,
    ...(op === "enter" && value.workflow !== undefined ? { workflow: value.workflow as "parallel" | "iterative" } : {}),
    ...(op === "enter" && value.planFilePath !== undefined ? { planFilePath: value.planFilePath as string } : {}),
    ...(op === "exit" && value.paused !== undefined ? { paused: value.paused as boolean } : {}),
    ...(op === "exit" && value.confirm !== undefined ? { confirm: value.confirm as boolean } : {}),
    ...(op === "review.decide" ? {
      reviewId: value.reviewId as number,
      decision: value.decision as "approve" | "refine" | "cancel",
      ...(value.preserveContext === undefined ? {} : { preserveContext: value.preserveContext as boolean }),
      ...(value.compactBeforeExecute === undefined ? {} : { compactBeforeExecute: value.compactBeforeExecute as boolean }),
      ...(value.feedback === undefined ? {} : { feedback: value.feedback as string }),
    } : {}),
  } as OmpPlanCommandRequest;
}

/**
 * The git service's own refusals, translated for a client.
 *
 * An unauthorized folder and a folder without a repository are the two states the protocol names
 * (`GitPathRejection`), so they keep their own codes; everything else keeps git's diagnosis with
 * the host's runtime paths stripped, so a local owner can read what git objected to without the
 * reply doubling as a filesystem listing.
 */
function gitFailure(error: unknown, runtimePaths: readonly string[]): HostError {
  if (error instanceof HostError) return error;
  if (error instanceof GitPathNotAuthorizedError) return new HostError("path_not_authorized", error.message, 403);
  if (error instanceof GitNotARepositoryError) return new HostError("not_a_repository", error.message, 400);
  if (error instanceof GitCapacityError) return new HostError("too_many_actions", error.message, 429);
  const collapsed = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
  let message = collapsed.slice(0, 400);
  for (const path of runtimePaths) message = message.split(path).join(".");
  return new HostError("git_failed", message || "The git command failed", 400);
}

/** Identical authenticated application router for loopback HTTP and encrypted relay. */
export function createRouter(host: CediaHost, auth: DeviceAuth, extras: { artifacts?: ArtifactStore; remote?: RemoteConnection; editors?: EditorConnections; voice?: VoiceEndpoint; git?: HostGitService; ompCapabilities?: (expectedRevision?: string) => Promise<HostOmpCapabilitySnapshot>; ompSettingsKeys?: () => Promise<HostOmpSettingsAnswer<OmpSettingsKeysSnapshot>>; ompSettingsValue?: (path: string) => Promise<HostOmpSettingsAnswer<OmpSettingsValue>>; ompSettingsWrite?: (request: { path: string; value: unknown; expectedRevision?: string }) => Promise<HostOmpSettingsAnswer<OmpSettingsValue>>;
      ompSettingsValueIn?: (path: string, context: OmpSettingsContext) => Promise<HostOmpSettingsAnswer<OmpSettingsValue>>;
      ompSettingsMutate?: (mutation: OmpSettingsMutation) => Promise<{ values: readonly OmpSettingsValue[]; scope: "global" | "project" }>;
      ompSettingsResetPreview?: (paths: string[]) => Promise<{ path: string; globalConfigured: boolean; current: OmpSettingsValue }[]>; /** Cedia's product-policy layer as the live runtime reports it (§2.8). */ ompPolicy?: () => Promise<HostOmpSettingsAnswer<OmpCreditPolicy>>; lifecycle?: { snapshot(): HostLifecycleSnapshot; identity(): unknown; adopt(input: unknown, stateDir: string, protocolVersion: number): HostLifecycleSnapshot; assertAccepting(): void; status?: () => HostLifecycleStatus; requestQuit?: () => HostLifecycleSnapshot; resume?: () => HostLifecycleSnapshot }; /** The selected remote path's local end, so the capability row reports whether it is up (§6.5). */ gateway?: () => { readonly url: string } | undefined; /** Issue one short-lived enrollment code into the gateway's own store (§6.5). */ issueRemoteEnrollment?: (name: string) => { readonly code: string; readonly pin: string; readonly expiresAt: string }; stateDir?: string; settings?: SettingsStore; drafts?: DraftStore } = {}): HostRouter {
  const responses = new ResponseChunks();
  return async (request: HostRequest): Promise<HostResponse> => {
    try {
      const device = auth.authenticate(request.token);
      if (!device) throw new HostError("unauthorized", "Device credential is missing or revoked", 401);
      const url = new URL(request.path, "http://cedia.local");
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== "v1") throw new HostError("not_found", "Unknown API version", 404);
      const method = request.method.toUpperCase();
      const body = () => record(request.body);
      const owner = () => { if (device.role !== "owner") throw new HostError("forbidden", "Only the local owner can manage devices", 403); };
      // Lifetime transitions are the one family a fenced host still accepts: it must be able to
      // keep fencing, reopen on a cancelled quit and stop. Everything else is refused.
      if (method !== "GET" && !(method === "POST" && parts[1] === "lifecycle" && (parts[2] === "quit" || parts[2] === "fence" || parts[2] === "resume"))) {
        try { extras.lifecycle?.assertAccepting(); }
        catch (error) { throw new HostError("host_quitting", error instanceof Error ? error.message : "Host is quitting", 409); }
      }
      const voiceInput = (): VoiceTranscriptionInput => {
        const b = body();
        if (b.provider !== "omp") throw new HostError("invalid_body", "Voice transcription must use OMP", 400);
        const cwd = string(b.cwd, "cwd");
        const mimeType = string(b.mimeType, "mimeType");
        const audioBase64 = b.audioBase64;
        const sampleRateHz = b.sampleRateHz;
        const durationMs = b.durationMs;
        if (!/^audio\/[A-Za-z0-9.+-]+$/.test(mimeType)) throw new HostError("invalid_body", "Invalid audio MIME type", 400);
        if (typeof audioBase64 !== "string" || audioBase64.length === 0 || audioBase64.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)) throw new HostError("invalid_body", "Invalid voice payload", 400);
        if (typeof sampleRateHz !== "number" || !Number.isSafeInteger(sampleRateHz) || sampleRateHz < 8_000 || sampleRateHz > 192_000) throw new HostError("invalid_body", "Invalid sample rate", 400);
        if (typeof durationMs !== "number" || !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 10 * 60_000) throw new HostError("invalid_body", "Invalid audio duration", 400);
        return { provider: "omp", cwd, ...(b.threadId === undefined ? {} : { threadId: string(b.threadId, "threadId") }), mimeType, sampleRateHz, durationMs, audioBase64 };
      };
      let result: unknown;
      if (parts.length === 2 && parts[1] === "owners") {
        owner();
        if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
        if (url.search !== "" || request.body !== undefined) throw new HostError("invalid_request", "Owner listing does not accept a query string or request body", 400);
        result = await host.knownOwnerStates();
      } else if (parts.length === 2 && parts[1] === "capabilities" && method === "GET") {
        owner();
        let runtime: HostOmpCapabilitySnapshot | undefined;
        // An owner that already read the table may name the revision it saw: a table that moved
        // is then a 409 conflict, not a silent refresh of what the caller is acting on.
        const expectRevision = url.searchParams.get("expectRevision") ?? undefined;
        try { runtime = extras.ompCapabilities ? await extras.ompCapabilities(expectRevision) : undefined; }
        catch (error) {
          if (error instanceof OmpCapabilityRevisionError) throw new HostError(error.code, error.message, 409);
          throw error;
        }
        const gateway = extras.gateway?.();
        const snapshot = capabilitySnapshot(runtime?.state === "available" ? runtime.snapshot : undefined, { ...(gateway === undefined ? {} : { gateway }) });
        result = {
          ...snapshot,
          capabilities: [...snapshot.capabilities, {
            id: "workspace.cleanup",
            availability: host.cleanupCapability().enabled ? "available" : "dependency_unavailable",
            scope: "session",
            reason: host.cleanupCapability().reason,
            operations: ["inspect", "attempt"],
          }],
          ...(runtime === undefined ? {} : {
            omp: runtime.state === "available"
              ? { state: "available" as const, capabilityRevision: runtime.snapshot.capabilityRevision, ompRevision: runtime.snapshot.ompRevision }
              : runtime,
          }),
        };
      } else if (parts.length === 3 && parts[1] === "omp" && parts[2] === "policy" && method === "GET") {
        // Cedia's own credit policy, read from the runtime that enforces it (plan §2.8). Owner-only:
        // it describes this Mac's process and is never a control a paired device may change.
        owner();
        if (!extras.ompPolicy) throw new HostError("omp_policy_unavailable", "No OMP policy owner is wired", 503);
        result = await extras.ompPolicy();
      } else if (parts.length === 4 && parts[1] === "omp" && parts[2] === "settings" && parts[3] === "keys" && method === "GET") {
        // The runtime's own settings schema, never a Cedia copy of it. A host with no live
        // runtime answers "unavailable" with the reason instead of an empty list.
        owner();
        if (!extras.ompSettingsKeys) throw new HostError("omp_settings_unavailable", "No OMP settings owner is wired", 503);
        const keys = await extras.ompSettingsKeys();
        result = keys.state === "available"
          // Cedia's own disposition travels with the runtime's schema facts, so a window shows what
          // it may write without re-deriving the policy, and a path Cedia does not edit still says
          // why.
          ? { state: keys.state, ...keys.answer, keys: keys.answer.keys.map(key => ({ ...key, ...ompSettingDisposition(key) })) }
          : keys;
      } else if (parts.length === 3 && parts[1] === "omp" && parts[2] === "settings" && method === "PATCH") {
        // The owner writes one OMP setting through the runtime. Cedia's policy decides which paths
        // are writable at all; the runtime validates the value and checks the revision.
        owner();
        // Policy and mechanism are separated on purpose: the route owns Cedia's disposition rule -
        // which paths this surface may write at all - and the runtime owns the value's schema and
        // the revision. Both providers must be wired, so an unclassified path cannot slip through a
        // half-wired host.
        const write = body();
        if (Object.hasOwn(write, "changes")) {
          // Scoped mutations: global writes through the taskless service, project
          // writes through the trusted directory with dirty-buffer coordination.
          // Advanced placement is presentation, not a write prohibition, on this
          // contract; protected and excluded paths stay refused with their reason.
          if (!extras.ompSettingsMutate)
            throw new HostError("omp_settings_unavailable", "No scoped settings owner is wired", 503);
          let mutation: OmpSettingsMutation;
          try {
            mutation = parseOmpSettingsMutation(write);
          } catch (error) {
            throw new HostError("invalid_body", error instanceof Error ? error.message : "Invalid settings mutation", 400);
          }
          try {
            result = await extras.ompSettingsMutate(mutation);
          } catch (error) {
            if (error instanceof OmpSettingsPathError) throw new HostError(error.code, error.message, 404);
            if (error instanceof OmpSettingsNotEditableError) throw new HostError(error.code, error.message, 403);
            if (error instanceof OmpSettingsRevisionError) throw new HostError(error.code, error.message, 409);
            if (error instanceof OmpSettingsRejectedError) throw new HostError(error.code, error.message, 400);
            if (error instanceof HostError) throw error;
            throw error;
          }
        } else {
        if (!extras.ompSettingsWrite || !extras.ompSettingsKeys)
          throw new HostError("omp_settings_unavailable", "No OMP settings owner is wired", 503);
        const writePath = string(write.path, "path");
        if (!Object.hasOwn(write, "value")) throw new HostError("invalid_body", "A settings write needs a value", 400);
        const expectedRevision = write.expectedRevision === undefined ? undefined : string(write.expectedRevision, "expectedRevision");
        const inventory = await extras.ompSettingsKeys();
        if (inventory.state !== "available") throw new HostError("omp_settings_unavailable", inventory.reason, 503);
        const settingsKey = inventory.answer.keys.find(key => key.path === writePath);
        if (settingsKey === undefined) throw new HostError("omp_settings_unknown_path", `${writePath} is not a setting this runtime defines`, 404);
        const classified = ompSettingDisposition(settingsKey);
        if (classified.disposition !== "editable")
          throw new HostError(
            "omp_settings_not_editable",
            `${writePath} is ${classified.disposition}: ${classified.reason ?? "Cedia does not write this path"}`,
            403,
          );
        try {
          const written = await extras.ompSettingsWrite({ path: writePath, value: write.value, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
          result = written.state === "available" ? { state: written.state, ...written.answer } : written;
        } catch (error) {
          if (error instanceof OmpSettingsPathError) throw new HostError(error.code, error.message, 404);
          if (error instanceof OmpSettingsNotEditableError) throw new HostError(error.code, error.message, 403);
          if (error instanceof OmpSettingsRevisionError) throw new HostError(error.code, error.message, 409);
          // Anything else the runtime refused (a value its schema does not accept, an unknown field)
          // is the caller's request, not a server fault, and keeps the runtime's own words.
          if (error instanceof Error && error.name === "OmpSettingsRejectedError") throw new HostError("omp_settings_rejected", error.message, 400);
          throw error;
          }
        }
      } else if (parts.length === 4 && parts[1] === "omp" && parts[2] === "settings" && parts[3] === "value" && method === "GET") {
        owner();
        const path = (url.searchParams.get("path") ?? "").trim();
        if (!path) throw new HostError("invalid_query", "A settings path is required", 400);
        const scope = url.searchParams.get("scope");
        if (scope !== null) {
          // Scoped reads resolve an explicit configuration: global and project go
          // through the taskless service, session reads a named existing task.
          let context: OmpSettingsContext;
          try {
            context = parseOmpSettingsContext({
              scope,
              ...(url.searchParams.get("projectId") === null ? {} : { projectId: url.searchParams.get("projectId") }),
              ...(url.searchParams.get("sessionId") === null ? {} : { sessionId: url.searchParams.get("sessionId") }),
            });
          } catch (error) {
            throw new HostError("invalid_query", error instanceof Error ? error.message : "Invalid settings scope", 400);
          }
          if (!extras.ompSettingsValueIn) throw new HostError("omp_settings_unavailable", "No scoped settings owner is wired", 503);
          try {
            const value = await extras.ompSettingsValueIn(path, context);
            result = value.state === "available" ? { state: value.state, ...value.answer } : value;
          } catch (error) {
            if (error instanceof OmpSettingsPathError) throw new HostError(error.code, error.message, 404);
            if (error instanceof HostError) throw error;
            throw error;
          }
        } else {
          if (!extras.ompSettingsValue) throw new HostError("omp_settings_unavailable", "No OMP settings owner is wired", 503);
          try {
            const value = await extras.ompSettingsValue(path);
            result = value.state === "available" ? { state: value.state, ...value.answer } : value;
          } catch (error) {
            // A key the running runtime does not define is a missing resource, not a transport
            // failure: the caller learns which key it asked for.
            if (error instanceof OmpSettingsPathError) throw new HostError(error.code, error.message, 404);
            throw error;
          }
        }
      } else if (parts.length === 4 && parts[1] === "omp" && parts[2] === "settings" && parts[3] === "reset-preview" && method === "POST") {
        // Preview an unset of the named global paths. Writes nothing.
        owner();
        if (!extras.ompSettingsResetPreview) throw new HostError("omp_settings_unavailable", "No scoped settings owner is wired", 503);
        const preview = body();
        if (!Array.isArray(preview.paths) || preview.paths.length === 0 || preview.paths.length > 512)
          throw new HostError("invalid_body", "A reset preview names 1-512 paths", 400);
        for (const entry of preview.paths)
          if (typeof entry !== "string" || entry.length === 0) throw new HostError("invalid_body", "Reset preview paths must be non-empty strings", 400);
        result = { entries: await extras.ompSettingsResetPreview(preview.paths as string[]) };
      } else if (parts.length === 2 && parts[1] === "settings" && method === "GET") {
        owner();
        result = extras.settings?.read() ?? { error: "Settings owner unavailable" };
      } else if (parts.length === 2 && parts[1] === "settings" && method === "PATCH") {
        owner();
        if (!extras.settings) throw new HostError("settings_unavailable", "Cedia settings owner is unavailable", 503);
        const b = body();
        if (!Number.isSafeInteger(b.expectedRevision) || typeof b.category !== "string" || !b.patch || typeof b.patch !== "object" || Array.isArray(b.patch)) throw new HostError("invalid_body", "Settings patch must name a revision, category and object patch", 400);
        try { result = extras.settings.patch(b.expectedRevision as number, b.category, b.patch as Record<string, unknown>); }
        catch (error) { if (error instanceof SettingsConflictError) throw new HostError(error.code, error.message, 409); throw new HostError("invalid_settings", error instanceof Error ? error.message : "Invalid settings patch", 400); }
      } else if (parts.length === 3 && parts[1] === "drafts" && parts[2] === "import" && method === "POST") {
        owner();
        if (!extras.drafts) throw new HostError("drafts_unavailable", "Cedia draft owner is unavailable", 503);
        const b = body();
        if (!Array.isArray(b.entries)) throw new HostError("invalid_body", "Draft import entries must be an array", 400);
        try { result = extras.drafts.import(device.id, b.entries as never); }
        catch (error) { throw new HostError("invalid_draft", error instanceof Error ? error.message : "Invalid draft import", 400); }
      } else if (parts.length === 3 && parts[1] === "drafts" && method === "GET") {
        owner();
        if (!extras.drafts) throw new HostError("drafts_unavailable", "Cedia draft owner is unavailable", 503);
        const draft = extras.drafts.read(device.id, parts[2]!);
        if (!draft) throw new HostError("draft_not_found", "Draft not found", 404);
        result = draft;
      } else if (parts.length === 3 && parts[1] === "drafts" && method === "PATCH") {
        owner();
        if (!extras.drafts) throw new HostError("drafts_unavailable", "Cedia draft owner is unavailable", 503);
        const b = body();
        for (const key of Object.keys(b)) if (!["expectedRevision", "text", "attachments", "content", "sessionId", "source"].includes(key)) throw new HostError("invalid_body", `Unsupported draft field ${key}`, 400);
        if (!Number.isSafeInteger(b.expectedRevision) || typeof b.text !== "string") throw new HostError("invalid_body", "Draft patch must include expectedRevision and text", 400);
        try { result = extras.drafts.patch(device.id, parts[2]!, { expectedRevision: b.expectedRevision as number, text: b.text, ...(b.attachments === undefined ? {} : { attachments: b.attachments as never }), ...(b.content === undefined ? {} : { content: b.content as never }), ...(b.sessionId === undefined ? {} : { sessionId: b.sessionId as string }), ...(b.source === undefined ? {} : { source: b.source as string }) }); }
        catch (error) { if (error instanceof DraftConflictError) throw new HostError(error.code, error.message, 409); throw new HostError("invalid_draft", error instanceof Error ? error.message : "Invalid draft patch", 400); }
      } else if (parts.length === 4 && parts[1] === "drafts" && parts[3] === "submissions" && method === "POST") {
        owner();
        if (!extras.drafts) throw new HostError("drafts_unavailable", "Cedia draft owner is unavailable", 503);
        const b = body();
        if (!Number.isSafeInteger(b.expectedRevision) || typeof b.commandId !== "string" || typeof b.payloadHash !== "string") throw new HostError("invalid_body", "Draft submission must include expectedRevision, commandId and payloadHash", 400);
        try {
          const submission = extras.drafts.submit(device.id, parts[2]!, { expectedRevision: b.expectedRevision as number, commandId: b.commandId, payloadHash: b.payloadHash });
          const draft = extras.drafts.read(device.id, parts[2]!);
          if (!draft) throw new DraftConflictError("Draft was removed before submission was acknowledged");
          result = { accepted: true, ...submission, draft };
        } catch (error) { if (error instanceof DraftConflictError) throw new HostError(error.code, error.message, 409); throw new HostError("invalid_draft", error instanceof Error ? error.message : "Invalid draft submission", 400); }
      } else if (parts.length === 4 && parts[1] === "drafts" && parts[3] === "clear" && method === "POST") {
        owner();
        if (!extras.drafts) throw new HostError("drafts_unavailable", "Cedia draft owner is unavailable", 503);
        const b = body();
        if (!Number.isSafeInteger(b.expectedRevision)) throw new HostError("invalid_body", "Draft clear must include expectedRevision", 400);
        try { result = extras.drafts.clear(device.id, parts[2]!, { expectedRevision: b.expectedRevision as number }); }
        catch (error) { throw new HostError("invalid_draft", error instanceof Error ? error.message : "Invalid draft clear", 400); }
      } else if (parts.length === 3 && parts[1] === "responses" && method === "GET") {
        result = responses.read(device.id, parts[2]!, integer(url.searchParams.get("offset"), 0));
      } else if (parts.length === 2 && parts[1] === "health" && method === "GET") {
        // Informational: the OMP release this host was built against. The runtime gate accepts
        // that release or anything newer (see isSupportedOmpVersion), so this is the baseline,
        // not a claim about the binary on disk.
        result = { protocolVersion: CEDIA_PROTOCOL_VERSION, status: "ready", ompVersion: OMP_BASELINE_VERSION,
          ...(extras.lifecycle ? { lifecycle: extras.lifecycle.snapshot(), identity: extras.lifecycle.identity() } : {}) };
      } else if (parts.length === 2 && parts[1] === "lifecycle" && method === "GET") {
        if (!extras.lifecycle?.status) throw new HostError("lifecycle_unavailable", "Host lifecycle status is unavailable", 503);
        result = extras.lifecycle.status();
      } else if (parts.length === 3 && parts[1] === "lifecycle" && parts[2] === "adopt" && method === "POST") {
        owner();
        if (!extras.lifecycle) throw new HostError("lifecycle_unavailable", "Host lifecycle handshake is unavailable", 503);
        try { result = extras.lifecycle.adopt(body(), extras.stateDir ?? "", CEDIA_PROTOCOL_VERSION); }
        catch (error) { throw new HostError("adoption_rejected", error instanceof Error ? error.message : "Host adoption rejected", 409); }
      } else if (parts.length === 3 && parts[1] === "lifecycle" && parts[2] === "quit" && method === "POST") {
        owner();
        if (!extras.lifecycle?.requestQuit || !extras.lifecycle.status) throw new HostError("lifecycle_unavailable", "Host lifecycle handshake is unavailable", 503);
        const alreadyRequested = extras.lifecycle.snapshot().phase !== "ready";
        const snapshot = extras.lifecycle.requestQuit();
        const status = extras.lifecycle.status();
        const receipt: HostQuitReceipt = { accepted: true, alreadyRequested, phase: snapshot.phase, generation: snapshot.generation, runningSessions: status.runningSessions };
        result = receipt;
      } else if (parts.length === 3 && parts[1] === "lifecycle" && parts[2] === "fence" && method === "POST") {
        // The deliberate quit closes admission *before* it asks the owner, so no new local or
        // remote work can start during the decision window (plan §2.7).
        owner();
        if (!extras.lifecycle?.requestQuit || !extras.lifecycle.status) throw new HostError("lifecycle_unavailable", "Host lifecycle handshake is unavailable", 503);
        const alreadyFenced = extras.lifecycle.snapshot().phase !== "ready";
        const snapshot = extras.lifecycle.requestQuit();
        const status = extras.lifecycle.status();
        const receipt: HostLifecycleAdmissionReceipt = { accepted: true, changed: !alreadyFenced, phase: snapshot.phase, generation: snapshot.generation, runningSessions: status.runningSessions };
        result = receipt;
      } else if (parts.length === 3 && parts[1] === "lifecycle" && parts[2] === "resume" && method === "POST") {
        owner();
        if (!extras.lifecycle?.resume || !extras.lifecycle.status) throw new HostError("lifecycle_unavailable", "Host lifecycle handshake is unavailable", 503);
        const wasFenced = extras.lifecycle.snapshot().phase === "quitting";
        let snapshot: HostLifecycleSnapshot;
        try { snapshot = extras.lifecycle.resume(); }
        catch (error) { throw new HostError("lifecycle_stopped", error instanceof Error ? error.message : "Host cannot reopen admission", 409); }
        const status = extras.lifecycle.status();
        const receipt: HostLifecycleAdmissionReceipt = { accepted: true, changed: wasFenced, phase: snapshot.phase, generation: snapshot.generation, runningSessions: status.runningSessions };
        result = receipt;
      } else if (parts.length === 2 && parts[1] === "models" && method === "GET") {
        result = await host.listModels();
      } else if (parts[1] === "providers" && parts.length === 2 && method === "GET") {
        // Provider auth belongs to OMP; this route only brokers its own API and
        // never returns credential material.
        result = await host.providerAuth().list();
      } else if (parts[1] === "providers" && parts.length === 4 && parts[3] === "api-key" && method === "POST") {
        result = await host.providerAuth().saveApiKey(parts[2]!, string(body().apiKey, "apiKey"));
      } else if (parts[1] === "providers" && parts.length === 4 && parts[3] === "auth" && method === "DELETE") {
        result = await host.providerAuth().logout(parts[2]!);
      } else if (parts[1] === "providers" && parts.length === 4 && parts[3] === "login" && method === "POST") {
        result = await host.providerAuth().login(parts[2]!);
      } else if (parts[1] === "provider-logins" && parts.length === 3 && method === "GET") {
        result = host.providerAuth().getLogin(parts[2]!);
      } else if (parts[1] === "provider-logins" && parts.length === 3 && method === "DELETE") {
        result = await host.providerAuth().cancel(parts[2]!);
      } else if (parts[1] === "provider-logins" && parts.length === 4 && parts[3] === "input" && method === "POST") {
        const b = body();
        result = await host.providerAuth().respond(parts[2]!, string(b.requestId, "requestId"), string(b.value, "value"));
      } else if (parts.length === 2 && parts[1] === "voice" && method === "GET") {
        result = extras.voice ? { provider: "omp", available: true } : { provider: "omp", available: false, reason: "The current OMP runtime does not expose a transcription endpoint" };
      } else if (parts.length === 3 && parts[1] === "voice" && parts[2] === "transcribe" && method === "POST") {
        if (!extras.voice) throw new HostError("voice_unavailable", "The current OMP runtime does not expose a transcription endpoint", 503);
        result = await extras.voice.transcribe(voiceInput());
      } else if (parts.length === 3 && parts[1] === "voice" && parts[2] === "prewarm" && method === "POST") {
        if (!extras.voice?.prewarm) throw new HostError("voice_unavailable", "The current OMP runtime does not expose a transcription endpoint", 503);
        const b = body();
        if (b.provider !== "omp") throw new HostError("invalid_body", "Voice prewarm must use OMP", 400);
        result = await extras.voice.prewarm({ provider: "omp" });
      } else if (parts[1] === "projects" && parts.length === 2) {
        if (method === "GET") result = host.store.listProjects({ includeArchived: true });
        else if (method === "POST") { const b = body(); result = host.store.createProject({ ...(b.id === undefined ? {} : { id: string(b.id, "id") }), path: string(b.path, "path"), ...(b.name === undefined ? {} : { name: string(b.name, "name") }) }); }
        else throw new HostError("method_not_allowed", "Unsupported method", 405);
      } else if (parts[1] === "projects" && parts.length === 3 && method === "PATCH") {
        const b = body();
        for (const key of Object.keys(b)) if (!["name", "pinned", "archived"].includes(key)) throw new HostError("invalid_body", `Unsupported project field ${key}`, 400);
        result = host.store.updateProject(parts[2]!, b);
      } else if (parts[1] === "workspace-suggestion" && parts.length === 2 && method === "POST") {
        // Opt-in capability. "No opinion" is a normal answer, not an error, so a client that
        // asks without a configured judge gets `mode: null` and keeps its own default.
        const prompt = body().prompt;
        if (typeof prompt !== "string") throw new HostError("invalid_body", "Invalid prompt", 400);
        result = (await host.suggestWorkspaceMode(prompt.slice(0, 2_000))) ?? { mode: null };
      } else if (parts[1] === "sessions" && parts.length === 2) {
        if (method === "GET") result = host.store.listSessions(url.searchParams.get("projectId") ?? undefined, { includeArchived: true }).map(session => host.sessionView(session));
        else if (method === "POST") {
          const b = body();
          if (b.workspaceMode !== undefined && b.workspaceMode !== "local" && b.workspaceMode !== "worktree") throw new HostError("unsupported_workspace", "Choose local or worktree mode", 400);
          if (b.baseRef !== undefined && typeof b.baseRef !== "string") throw new HostError("invalid_body", "A base revision must be a string", 400);
          if (b.dirtyFiles !== undefined && (!Array.isArray(b.dirtyFiles) || b.dirtyFiles.some(name => typeof name !== "string"))) {
            throw new HostError("invalid_body", "Copied files must be a list of project-relative paths", 400);
          }
          // Answer with the same view a read returns: the caller learns the workspace the task
          // actually got (its mode, starting commit and what it carried) without a second round trip.
          result = host.sessionView(host.createSession(string(b.projectId, "projectId"), b.title === undefined ? undefined : string(b.title, "title"), b.workspaceMode as "local" | "worktree" | undefined, b.id === undefined ? undefined : string(b.id, "id"), b.baseRef === undefined ? undefined : string(b.baseRef, "baseRef"), b.dirtyFiles === undefined ? undefined : (b.dirtyFiles as string[])));
        } else throw new HostError("method_not_allowed", "Unsupported method", 405);
      } else if (parts[1] === "sessions" && parts.length >= 3) {
        const id = parts[2]!;
        const session = host.store.getSession(id);
        if (!session) throw new HostError("not_found", "Task not found", 404);
        const action = parts[3];
        if (parts.length === 5 && action === "owner" && parts[4] === "summary" && method === "GET") {
          // Summary is a fixed, read-only projection from the OMP owner's serialized dispatcher.
          owner();
          result = await host.ownerSummary(id);
        } else if (parts.length === 4 && action === "owner" && method === "GET") {
          // §8.2 O08: who owns this task's local endpoint, and is it really there. Owner-only,
          // read-only, and it never resolves an ambiguity by acting on it.
          owner();
          result = await host.ownerAttachment(id);
        } else if (parts.length === 4 && action === "owner") throw new HostError("method_not_allowed", "Unsupported method", 405);
        else if (parts.length === 3 && method === "GET") result = host.sessionView(session);
        else if (parts.length === 3 && method === "DELETE") {
          await host.deleteSession(id);
          result = { deleted: true };
        } else if (parts.length === 3 && method === "PATCH") {
          const b = body();
          for (const key of Object.keys(b)) if (!["title", "archived", "pinned"].includes(key)) throw new HostError("invalid_body", `Unsupported task field ${key}`, 400);
          const patch: { title?: string; pinned?: boolean; archived?: boolean } = {};
          if (typeof b.title === "string") patch.title = b.title;
          if (typeof b.pinned === "boolean") patch.pinned = b.pinned;
          // Archiving is its own operation: it refuses a running task and records the ref and
          // receipt it kept (§2.6, §3.C). Restoring is its own operation too: it puts the
          // workspace back before the task runs again. The other fields stay plain updates.
          if (b.archived === true) {
            if (Object.keys(patch).length > 0) host.store.updateSession(id, patch);
            result = host.archiveSession(id);
          } else if (b.archived === false) {
            if (Object.keys(patch).length > 0) host.store.updateSession(id, patch);
            result = host.restoreSession(id);
          } else {
            result = host.sessionView(host.store.updateSession(id, patch));
          }
        } else if (action === "models" && parts.length === 4) {
          // The live model catalog is controller-visible, but unlike the metadata route it is
          // bound to this task's already-running OMP owner. A stopped task returns an explicit
          // absence marker; a live owner's failure is allowed to propagate instead of falling
          // back to the global catalog and hiding dynamic removals.
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Session model catalog does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Session model catalog does not accept body fields", 400);
          result = await host.listSessionModels(id);
        } else if (action === "pending-model" && parts.length === 4 && method === "POST") {
          // §2.4: a model/effort change is handed to OMP with a revision and only becomes the
          // task's selection when OMP reports committing it at its own turn boundary.
          const b = body();
          for (const key of Object.keys(b)) if (!["revision", "provider", "modelId", "thinkingLevel"].includes(key)) throw new HostError("invalid_body", `Unsupported pending-model field ${key}`, 400);
          if (typeof b.revision !== "number" || !Number.isSafeInteger(b.revision) || b.revision <= 0) throw new HostError("invalid_body", "A pending model change needs a positive integer revision", 400);
          if ((b.provider === undefined) !== (b.modelId === undefined)) throw new HostError("invalid_body", "A pending model change needs both a provider and a model id, or neither", 400);
          if (b.thinkingLevel !== undefined && b.thinkingLevel !== null && typeof b.thinkingLevel !== "string") throw new HostError("invalid_body", "A pending thinking level must be a string or null", 400);
          result = await host.setPendingModel(id, {
            revision: b.revision,
            ...(typeof b.provider === "string" ? { provider: b.provider } : {}),
            ...(typeof b.modelId === "string" ? { modelId: b.modelId } : {}),
            ...(b.thinkingLevel === undefined ? {} : { thinkingLevel: b.thinkingLevel as string | null }),
          });
        } else if (action === "model-state" && parts.length === 4) {
          // The picker is controller-visible: it describes the runtime that every attached client
          // is looking at, while owner-only account and tier mutations remain below.
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Model state does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Model state does not accept body fields", 400);
          result = await host.modelStateSnapshot(id);
        } else if (action === "accounts" && parts.length === 4) {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Accounts does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Accounts does not accept body fields", 400);
          result = await host.accountsSnapshot(id);
        } else if (action === "accounts" && parts.length === 5 && parts[4] === "pin") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Accounts pin does not accept query fields", 400);
          result = await host.accountsPin(id, device.id, accountPinCommand(body()));
        } else if (action === "roles" && parts.length === 4) {
          // The role mapping is controller-visible: it describes the runtime every attached
          // client is looking at, while activating a role stays an owner-only write below.
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Roles does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Roles does not accept body fields", 400);
          result = await host.rolesSnapshot(id);
        } else if (action === "roles" && parts.length === 5 && parts[4] === "apply") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Role apply does not accept query fields", 400);
          result = await host.rolesApply(id, device.id, roleApplyCommand(body()));
        } else if (action === "roles" && parts.length === 5 && parts[4] === "set") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Role set does not accept query fields", 400);
          result = await host.rolesSet(id, device.id, roleSetCommand(body()));
        } else if (action === "service-tier" && parts.length === 4) {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Service-tier does not accept query fields", 400);
          result = await host.serviceTierSet(id, device.id, serviceTierCommand(body()));
        } else if (action === "goal" && parts.length === 4 && method === "GET") {
          // Goal reads are controller-visible task projections. The host answers from the
          // per-session cache and never starts a stopped OMP runtime just to populate it.
          result = host.goalSnapshot(id);
        } else if (action === "subagents" && parts.length === 4 && method === "GET") {
          // Subagent reads are controller-visible task projections. The host answers from the
          // per-session cache and never starts a stopped OMP runtime just to populate it.
          result = host.subagentsSnapshot(id);
        } else if (action === "goal" && parts.length === 4 && method === "POST") {
          result = await host.goalCommand(id, device.id, goalCommand(body()));
        } else if (action === "advisor" && parts.length === 4 && (method === "GET" || method === "POST")) {
          owner();
          if (method === "GET") {
            if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Advisor does not accept query fields", 400);
            if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Advisor does not accept body fields", 400);
            result = host.advisorSnapshot(id);
          } else {
            result = await host.advisorCommand(id, device.id, advisorCommand(body()));
          }
        } else if (action === "advisor" && parts.length === 5 && parts[4] === "config" && method === "GET") {
          owner();
          result = await host.advisorConfigSnapshot(id, advisorConfigScope(url));
        } else if (action === "advisor" && parts.length === 5 && parts[4] === "config" && method === "POST") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Advisor config command does not accept query fields", 400);
          result = await host.advisorConfigCommand(id, device.id, advisorConfigCommand(body()));
        } else if (action === "queue" && parts.length === 4) {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Queue does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Queue does not accept body fields", 400);
          result = await host.queueSnapshot(id);
        } else if (action === "queue" && parts.length === 5 && parts[4] === "drop") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Queue drop does not accept query fields", 400);
          result = await host.queueDrop(id, device.id, queueDropCommand(body()));
        } else if (action === "queue" && parts.length === 5 && parts[4] === "remove") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Queue remove does not accept query fields", 400);
          const remove = queueRowCommand(body(), "remove");
          result = await host.queueRemoveMessage(id, device.id, {
            commandId: remove.commandId,
            incarnation: remove.incarnation,
            message: remove.message,
            queue: remove.queue as "steering" | "followUp",
          });
        } else if (action === "queue" && parts.length === 5 && parts[4] === "promote") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Queue promote does not accept query fields", 400);
          const promote = queueRowCommand(body(), "promote");
          result = await host.queuePromoteMessage(id, device.id, {
            commandId: promote.commandId,
            incarnation: promote.incarnation,
            message: promote.message,
          });
        } else if (action === "pause" && parts.length === 4 && method === "GET") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Pause does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Pause does not accept body fields", 400);
          result = await host.pauseSnapshot(id);
        } else if (action === "pause" && parts.length === 4 && method === "POST") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Pause command does not accept query fields", 400);
          result = await host.pauseCommand(id, device.id, pauseCommand(body()));
        } else if (action === "bash" && parts.length === 5 && parts[4] === "exec") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Shell exec does not accept query fields", 400);
          result = await host.bashExec(id, device.id, bashExecCommand(body()));
        } else if (action === "bash" && parts.length === 5 && parts[4] === "abort") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Shell abort does not accept query fields", 400);
          result = await host.bashAbort(id, device.id, bashAbortCommand(body()));
        } else if (action === "python" && parts.length === 5 && parts[4] === "exec") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Python exec does not accept query fields", 400);
          result = await host.pythonExec(id, device.id, pythonExecCommand(body()));
        } else if (action === "python" && parts.length === 5 && parts[4] === "abort") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Python abort does not accept query fields", 400);
          result = await host.pythonAbort(id, device.id, pythonAbortCommand(body()));
        } else if (action === "context" && parts.length === 4) {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Context does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Context does not accept body fields", 400);
          result = await host.contextSnapshot(id);
        } else if (action === "tree" && parts.length === 4) {
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Tree does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Tree does not accept body fields", 400);
          result = await host.treeSnapshot(id);
        } else if (action === "loop" && parts.length === 4 && method === "GET") {
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Loop does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Loop does not accept body fields", 400);
          result = await host.loopSnapshot(id);
        } else if (action === "loop" && parts.length === 4 && method === "POST") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Loop command does not accept query fields", 400);
          result = await host.loopCommand(id, device.id, loopCommand(body()));
        } else if (action === "btw" && parts.length === 4 && method === "GET") {
          // The side-question state is controller-visible: the bounded answer belongs to the
          // task every attached client is looking at, and the held objects never cross.
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Side question does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Side question does not accept body fields", 400);
          result = await host.btwSnapshot(id);
        } else if (action === "btw" && parts.length === 5 && parts[4] === "ask" && method === "POST") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Side-question ask does not accept query fields", 400);
          result = await host.btwAsk(id, device.id, btwAskCommand(body()));
        } else if (action === "btw" && parts.length === 5 && parts[4] === "branch" && method === "POST") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Side-question branch does not accept query fields", 400);
          result = await host.btwBranch(id, device.id, btwBranchCommand(body()));
        } else if (action === "cleanse" && parts.length === 4 && method === "GET") {
          // The cleanse run state is controller-visible: bounded summaries and the report
          // belong to the task every attached client is looking at; repair bodies stay out.
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Cleanse does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Cleanse does not accept body fields", 400);
          result = await host.cleanseSnapshot(id);
        } else if (action === "cleanse" && parts.length === 5 && parts[4] === "run" && method === "POST") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Cleanse run does not accept query fields", 400);
          result = await host.cleanseRun(id, device.id, cleanseRunCommand(body()));
        } else if (action === "cleanse" && parts.length === 5 && parts[4] === "abort" && method === "POST") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Cleanse abort does not accept query fields", 400);
          result = await host.cleanseAbort(id, device.id, cleanseAbortCommand(body()));
        } else if (action === "omfg" && parts.length === 4 && method === "GET") {
          // The rule-forging state is controller-visible: the bounded draft belongs to the
          // task every attached client is looking at; the held objects never cross.
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Rule forging does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Rule forging does not accept body fields", 400);
          result = await host.omfgSnapshot(id);
        } else if (action === "omfg" && parts.length === 5 && parts[4] === "draft" && method === "POST") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Rule draft does not accept query fields", 400);
          result = await host.omfgDraft(id, device.id, omfgDraftCommand(body()));
        } else if (action === "omfg" && parts.length === 5 && parts[4] === "save" && method === "POST") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Rule save does not accept query fields", 400);
          result = await host.omfgSave(id, device.id, omfgSaveCommand(body()));
        } else if (action === "omfg" && parts.length === 5 && parts[4] === "abort" && method === "POST") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Rule abort does not accept query fields", 400);
          result = await host.omfgAbort(id, device.id, omfgAbortCommand(body()));
        } else if (action === "prewalk" && parts.length === 4) {
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Prewalk does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Prewalk does not accept body fields", 400);
          result = await host.prewalkSnapshot(id);
        } else if (action === "tools" && parts.length === 5 && parts[4] === "catalog") {
          // The live tool catalog is controller-visible: it describes the runtime every attached
          // client is looking at, and it carries no mutation, credential or transcript content.
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Tool catalog does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Tool catalog does not accept body fields", 400);
          result = await host.toolCatalogSnapshot(id);
        } else if (action === "tools" && parts.length === 5 && parts[4] === "codemode") {
          // The Code Mode partition is controller-visible: names and flags only, never
          // prelude sources, credentials or transcript content.
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Code Mode does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Code Mode does not accept body fields", 400);
          result = await host.toolCodeModeSnapshot(id);
        } else if (action === "tools" && parts.length === 5 && parts[4] === "extensions") {
          // The extension catalog is controller-visible: records, root policy and enablement
          // state describe the runtime every attached client is looking at, and the records'
          // raw discovery bag never crosses. Management (enable/disable, custom roots) is a
          // separate surface with its own gate.
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Extensions does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Extensions does not accept body fields", 400);
          result = await host.toolExtensionsSnapshot(id);
        } else if (action === "tools" && parts.length === 6 && parts[4] === "extensions" && parts[5] === "set") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Tools extension set does not accept query fields", 400);
          result = await host.toolsExtensionSet(id, device.id, toolExtensionSetCommand(body()));
        } else if (action === "tools" && parts.length === 5 && parts[4] === "refresh-skills") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Tools refresh does not accept query fields", 400);
          result = await host.toolsRefreshSkills(id, device.id, toolRefreshCommand(body()));
        } else if (action === "tools" && parts.length === 5 && parts[4] === "active") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Tools active set does not accept query fields", 400);
          result = await host.toolsActiveSet(id, device.id, toolActiveSetCommand(body()));
        } else if (action === "tree" && parts.length === 5 && parts[4] === "navigate") {
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Tree navigate does not accept query fields", 400);
          result = await host.treeNavigate(id, device.id, treeNavigateCommand(body()));
        } else if (action === "context" && parts.length === 5 && (parts[4] === "drop-images" || parts[4] === "abort-compaction")) {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Context command does not accept query fields", 400);
          const command = contextCommand(body());
          result = parts[4] === "drop-images"
            ? await host.contextDropImages(id, device.id, command)
            : await host.contextAbortCompaction(id, device.id, command);
        } else if (action === "context" && parts.length === 5 && parts[4] === "shake") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Context shake does not accept query fields", 400);
          result = await host.contextShake(id, device.id, contextShakeCommand(body()));
        } else if (action === "memory" && parts.length === 4) {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Memory does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Memory does not accept body fields", 400);
          result = await host.memorySnapshot(id);
        } else if (action === "memory" && parts.length === 5 && parts[4] === "apply") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Memory apply does not accept query fields", 400);
          result = await host.memoryApply(id, device.id, memoryCommand(body()));
        } else if (action === "history" && parts.length === 4) {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "History does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "History does not accept body fields", 400);
          result = await host.historySnapshot(id);
        } else if (action === "history" && parts.length === 5 && parts[4] === "transcript") {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "History transcript does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "History transcript does not accept body fields", 400);
          result = await host.historyTranscript(id);
        } else if (action === "history" && parts.length === 5 && (parts[4] === "clear" || parts[4] === "fresh")) {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "History command does not accept query fields", 400);
          const command = historyCommand(body());
          result = parts[4] === "clear"
            ? await host.historyClear(id, device.id, command)
            : await host.historyFresh(id, device.id, command);
        } else if (action === "usage" && parts.length === 4) {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Usage does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Usage does not accept body fields", 400);
          result = await host.usageSnapshot(id);
        } else if (action === "credits" && parts.length === 4) {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Credits does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Credits does not accept body fields", 400);
          result = await host.creditsSnapshot(id);
        } else if (action === "credits" && parts.length === 5 && parts[4] === "redeem") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Credits redeem does not accept query fields", 400);
          result = await host.creditsRedeem(id, device.id, creditsRedeemCommand(body()));
        } else if (action === "advisor" && parts.length === 5 && parts[4] === "history" && method === "GET") {
          owner();
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Advisor history does not accept body fields", 400);
          result = await host.advisorHistory(id, advisorHistoryCompact(url));
        } else if (action === "agents" && parts.length === 4) {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Agents does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Agents does not accept body fields", 400);
          result = await host.agentsSnapshot(id);
        } else if (action === "agents" && parts.length === 6 && parts[5] === "transcript") {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Agent transcript does not accept body fields", 400);
          const agentId = parts[4];
          if (!agentId || agentId.includes("/") || agentId.length > 4096) throw new HostError("not_found", "Unknown agent route", 404);
          result = await host.agentTranscript(id, agentId, agentsFromByte(url));
        } else if (action === "agents" && parts.length === 5 && parts[4] === "kill") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Agents kill does not accept query fields", 400);
          result = await host.agentsKill(id, device.id, agentsKillCommand(body()));
        } else if (action === "agents" && parts.length === 5 && parts[4] === "revive") {
          owner();
          if (method !== "POST") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Agents revive does not accept query fields", 400);
          result = await host.agentsRevive(id, device.id, agentsReviveCommand(body()));
        } else if (action === "agents" && parts.length === 5 && parts[4] === "config") {
          owner();
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Agents config does not accept query fields", 400);
          if (method === "GET") {
            if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Agents config list does not accept body fields", 400);
            result = await host.agentsConfigList(id);
          } else if (method === "POST") {
            result = await host.agentsConfig(id, device.id, agentsConfigCommand(body()));
          } else throw new HostError("method_not_allowed", "Unsupported method", 405);
        } else if (action === "progress" && parts.length === 4) {
          owner();
          if (method !== "GET") throw new HostError("method_not_allowed", "Unsupported method", 405);
          if ([...url.searchParams.keys()].length > 0) throw new HostError("invalid_query", "Progress does not accept query fields", 400);
          if (request.body !== undefined && Object.keys(body()).length > 0) throw new HostError("invalid_body", "Progress does not accept body fields", 400);
          result = host.progressSnapshot(id);
        } else if (action === "plan" && parts.length === 4 && (method === "GET" || method === "POST")) {
          owner();
          if (method === "GET") result = host.planSnapshot(id);
          else result = await host.planCommand(id, device.id, planCommand(body()));
        } else if (action === "cleanup" && parts.length === 4 && method === "GET") {
          result = { capability: host.cleanupCapability(), workspace: host.store.getSessionWorkspaceMetadata(id), archive: host.sessionView(session).archive };
        } else if (action === "cleanup" && parts.length === 4 && method === "POST") {
          result = await host.cleanupSession(id);
        } else if (action === "events" && parts.length === 6 && parts[5] === "frame" && method === "GET") {
          const sequence = integer(parts[4]!, 0);
          const page = host.store.readEvents(id, sequence - 1, 1);
          const event = page.events[0];
          if (!event || event.sequence !== sequence) {
            // Retention dropped it, or it never existed; a client can act on the
            // difference, and a bare 404 leaves a fork hydration guessing.
            if (page.firstSequence > sequence) throw new HostError("history_truncated", "That event was dropped by journal retention", 404);
            throw new HostError("not_found", "Event not found", 404);
          }
          const text = JSON.stringify(event.frame); const offset = integer(url.searchParams.get("offset"), 0);
          result = { sequence, offset, text: text.slice(offset, offset + 24_000), length: text.length, sha256: createHash("sha256").update(text).digest("hex") };
        } else if (action === "artifacts" && parts.length === 5 && method === "GET" && extras.artifacts) result = extras.artifacts.read(id, parts[4]!, integer(url.searchParams.get("offset"), 0));
        else if (action === "fork" && parts.length === 4 && method === "POST") {
          const b = body();
          result = await host.forkSession(id, string(b.title, "title"), string(b.id, "id"));
        }
        else if (parts.length !== 4) throw new HostError("not_found", "Unknown task route", 404);
        else if (action === "artifacts" && method === "GET" && extras.artifacts) result = extras.artifacts.list(id);
        else if (action === "artifacts" && method === "POST" && extras.artifacts) {
          const b = body(); const sourcePaths = b.sourcePaths ?? [];
          if (!Array.isArray(sourcePaths) || sourcePaths.some(path => typeof path !== "string")) throw new HostError("invalid_body", "sourcePaths must be a list of paths", 400);
          result = extras.artifacts.capture(id, session.cwd, string(b.path, "path"), sourcePaths);
        }
        // A client that just attached can render the host's headless screen instead of
        // replaying a bounded chunk history (empty list = no virtual UI or no engine).
        else if (action === "terminals" && parts.length === 4 && method === "GET") result = { terminals: host.terminalSnapshots(id) };
        else if (action === "start" && method === "POST") result = await host.startSession(id);
        else if (action === "stop" && method === "POST") result = await host.stopSession(id);
        else if (action === "reconcile" && method === "POST") {
          if (body().acknowledgeUnknown !== true) throw new HostError("acknowledgement_required", "Acknowledge the unknown outcome before reconciliation", 400);
          result = host.reconcile(id, true);
        } else if (action === "events" && method === "GET") {
          const after = integer(url.searchParams.get("after"), 0);
          const page = host.store.readEvents(id, after, integer(url.searchParams.get("limit"), 200));
          let bytes = 0;
          const events = [];
          for (const event of page.events) {
            const text = JSON.stringify(event.frame);
            const frame = Buffer.byteLength(text) > 48_000 ? { type: "cedia_frame_reference", sequence: event.sequence, length: text.length, sha256: createHash("sha256").update(text).digest("hex") } : event.frame;
            const projected = { ...event, frame }; const size = Buffer.byteLength(JSON.stringify(projected));
            if (events.length && bytes + size > 128_000) break;
            events.push(projected); bytes += size;
          }
          // `firstSequence`/`historyTruncated` are the retention half of this page: a
          // client that reattaches at `after: 0` is told where the journal starts now
          // instead of reading a short page as the whole task.
          result = { events, cursor: events.at(-1)?.sequence ?? after, hasMore: page.hasMore || events.length < page.events.length, firstSequence: page.firstSequence, historyTruncated: page.historyTruncated };
        }
        else if (action === "commands" && method === "GET") result = host.store.listCommands(id);
        else if (action === "commands" && method === "POST") {
          const b = body(); string(b.commandId, "commandId"); string(b.incarnation, "incarnation"); string(b.command, "command");
          if (b.payload !== undefined) record(b.payload);
          result = await host.command(id, device.id, b as unknown as CommandRequest);
        } else if (action === "ui" && method === "GET") result = host.pendingUi(id);
        else if (action === "ui" && method === "POST") {
          const b = body(); string(b.commandId, "commandId"); string(b.incarnation, "incarnation"); string(b.token, "token");
          result = await host.respond(id, device.id, b as unknown as UiResponseRequest);
        } else if (action === "review" && method === "GET") result = reviewWorkspace(session.cwd);
        else if (action === "files" && method === "GET") {
          const path = workspacePath(session.cwd, url.searchParams.get("path") ?? ".");
          const stat = lstatSync(path);
          if (stat.isDirectory()) result = { entries: readdirSync(path, { withFileTypes: true }).slice(0, 1000).map(entry => ({ name: entry.name, directory: entry.isDirectory(), symlink: entry.isSymbolicLink() })) };
          else if (stat.isFile() && stat.size <= 1024 * 1024) { const bytes = readFileSync(path); result = bytes.includes(0) ? { binary: true, size: stat.size } : { text: bytes.toString("utf8"), size: stat.size }; }
          else result = { binary: true, size: stat.size };
        } else throw new HostError("not_found", "Unknown task route", 404);
      } else if (parts[1] === "git" && extras.git) {
        // One git implementation behind three routes: a one-shot method, a streaming action, and
        // that action's poll. `path` is a working directory the host must already own, so the
        // refusal is always available before any git process starts. Owner-only for the same
        // reason the editor bridge is: these methods move the user's checkout (stage, checkout,
        // stash, commit, push, worktree removal), and a paired controller is a projection of the
        // session, not a second pair of hands on the repository.
        owner();
        const git = extras.git;
        const runtimePaths = [host.store.paths.stateDir, ...gitAuthorizedRoots(host.store)];
        try {
          if (parts.length === 2 && method === "POST") {
            const b = body();
            if (!isGitMethod(b.method)) throw new HostError("invalid_body", "Unknown git method", 400);
            result = await git.request({ path: b.path, method: b.method, input: b.input });
          } else if (parts.length === 3 && parts[2] === "actions" && method === "POST") {
            result = git.startAction(body());
          } else if (parts.length === 4 && parts[2] === "actions" && method === "GET") {
            const poll = git.pollAction(string(parts[3], "actionId"), integer(url.searchParams.get("after"), 0));
            if (!poll) throw new HostError("not_found", "Unknown git action", 404);
            result = poll;
          } else throw new HostError("not_found", "Unknown git route", 404);
        } catch (error) {
          throw gitFailure(error, runtimePaths);
        }
      } else if (parts[1] === "editors" && extras.editors) {
        owner();
        const id = string(parts[2], "editor client ID");
        if (parts.length === 3 && method === "POST") {
          const roots = body().roots;
          if (!Array.isArray(roots) || roots.some(root => typeof root !== "string")) throw new HostError("invalid_body", "Expected workspace roots", 400);
          extras.editors.register(id, roots); result = { registered: true };
        } else if (parts.length === 4 && parts[3] === "requests" && method === "GET") result = extras.editors.poll(id);
        else if (parts.length === 5 && parts[3] === "requests" && method === "GET") result = { valid: extras.editors.valid(id, parts[4]!) };
        else if (parts.length === 4 && parts[3] === "responses" && method === "POST") { extras.editors.respond(id, body() as unknown as EditorResponse); result = { accepted: true }; }
        else throw new HostError("not_found", "Unknown editor route", 404);
      } else if (parts[1] === "remote" && (extras.remote !== undefined || extras.gateway !== undefined)) {
        // Two remote paths share this namespace without sharing a meaning: the retained Paseo
        // relay (its own identity, its own status) and the selected local gateway, whose only
        // owner actions are reading its state and issuing one short-lived enrollment code (§6.5).
        owner();
        const gateway = extras.gateway?.();
        if (parts.length === 3 && parts[2] === "gateway" && method === "GET") {
          result = gateway === undefined
            ? { state: "unavailable", reason: "This build carries no remote web client, so the loopback gateway did not start." }
            : { state: "available", url: gateway.url };
        } else if (parts.length === 3 && parts[2] === "enrollment" && method === "POST") {
          if (extras.issueRemoteEnrollment === undefined || gateway === undefined)
            throw new HostError("remote_unavailable", "The remote gateway is not running in this build, so there is nothing to enroll a device against", 503);
          const name = body().name === undefined ? "Remote device" : string(body().name, "name");
          result = extras.issueRemoteEnrollment(name);
        } else if (parts.length === 3 && parts[2] === "enrollment") throw new HostError("method_not_allowed", "Issuing an enrollment code is a POST", 405);
        else if (extras.remote === undefined) throw new HostError("not_found", "Unknown remote route", 404);
        else if (parts.length === 2 && method === "GET") result = extras.remote.status();
        else if (parts.length === 3 && parts[2] === "pair" && method === "POST") result = await extras.remote.pair(string(body().name, "name"));
        else if (parts.length === 3 && parts[2] === "disable" && method === "POST") { await extras.remote.disable(); result = extras.remote.status(); }
        else throw new HostError("not_found", "Unknown remote route", 404);
      } else if (parts[1] === "devices") {
        owner();
        if (parts.length === 2 && method === "GET") result = auth.list();
        else if (parts.length === 2 && method === "POST") result = auth.issue(string(body().name, "name"));
        else if (parts.length === 4 && parts[3] === "revoke" && method === "POST") { auth.revoke(parts[2]!); result = { revoked: true }; }
        else throw new HostError("not_found", "Unknown device route", 404);
      } else throw new HostError("not_found", "Unknown route", 404);
      return { status: 200, body: parts[1] === "responses" ? result : responses.wrap(device.id, result) };
    } catch (error) {
      if (error instanceof HostError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      if (error instanceof OmpTreeValidationError) return { status: 502, body: { error: { code: error.code, message: error.message } } };
      if (error instanceof OmpPrewalkValidationError) return { status: 502, body: { error: { code: error.code, message: error.message } } };
      if (error instanceof OmpLoopValidationError) return { status: 502, body: { error: { code: error.code, message: error.message } } };
      if (error instanceof OmpBtwValidationError) return { status: 502, body: { error: { code: error.code, message: error.message } } };
      if (error instanceof OmpCleanseValidationError) return { status: 502, body: { error: { code: error.code, message: error.message } } };
      if (error instanceof OmpOmfgValidationError) return { status: 502, body: { error: { code: error.code, message: error.message } } };
      if (error instanceof OmpModelStateValidationError) return { status: 502, body: { error: { code: error.code, message: error.message } } };
      // Provider-auth failures are authored by the host (OMP's own error text is
      // replaced at the manager), and the settings surface needs them verbatim.
      if (error instanceof ProviderAuthError) return { status: error.status, body: { error: { code: "provider_auth_failed", message: error.message } } };
      // Keep runtime paths, provider credentials and subprocess stderr out of remote errors.
      return { status: 400, body: { error: { code: "request_failed", message: "The host could not complete this request" } } };
    }
  };
}
