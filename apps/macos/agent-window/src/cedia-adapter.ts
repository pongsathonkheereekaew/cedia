/**
 * NativeApi projection for the Cedia Agent Window.
 *
 * Synara owns the renderer and its event router.  Cedia owns one authenticated
 * OMP host, so this module translates Synara's project/thread commands to the
 * versioned `/v1` application API and rebuilds renderer snapshots from the
 * host's durable event journal.  No provider process or transcript is started
 * in this module.
 */

import {
	DEFAULT_SERVER_SETTINGS_VIEW,
	ThreadId,
	type DesktopBridge,
	type ProviderCompactThreadInput,
	type ProviderListCommandsInput,
	type ProviderListModelsInput,
	type ProviderListSkillsInput,
} from "@synara/contracts";
import { applyEventPage, applyFrame, createInitialTaskState, type TaskState as CediaTaskState, type TranscriptEntry } from "../../src/state.ts";
import { parseOmpGoalSnapshot, parseOmpGoalUpdatedEvent, parseOmpSubagentList, type Command, type EventPage, type Json, type OmpGoalSnapshot, type OmpSubagentRow, type Project, type Session, type SessionDirtyCopy, type SessionEvent, type SessionWorkspace } from "../../../../packages/protocol/src/index.ts";
import { readCediaHostError } from "./host-error-codes.ts";
import { installCediaProviderAuthApi } from "../vendor/synara/apps/web/src/lib/cediaProviderAuth";
import { useComposerDraftStore } from "../vendor/synara/apps/web/src/composerDraftStore";
import { requestComposerFocus } from "../vendor/synara/apps/web/src/composerFocusRequestStore";
import { stagedComposerImageFile } from "../vendor/synara/apps/web/src/lib/cediaStagedAttachments";
import { readComposerImageBlob } from "../vendor/synara/apps/web/src/lib/composerImageBlobStore";
import { createNativeTerminalApi } from "./native-terminal";
import { createNativeFilesApi } from "./native-files";
import { createNativeBrowserApi } from "./native-browser";
import { createNativeGitApi } from "./native-git";
import { createNativeDeviceApi } from "./native-device";
import { createDesktopZoomController } from "./desktopZoom";
import { createCediaContextMenuPresenter } from "./cedia-context-menu";

import { AGENT_WINDOW_CHANNEL as CEDIA_AGENT_CHANNEL } from "../../src/bridge-contract.ts";
/** UI-only value used until OMP reports a current model. Never sent to OMP. */
export const OMP_UNRESOLVED_MODEL = "cedia:unresolved";

/** Base64 for OMP's `images[]` — arrayBuffer-based so it works in the renderer and in tests (no FileReader). */
async function fileToBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

/**
 * Bytes for a composer image attachment. The turn's own staged bytes come first —
 * the composer's send path clears its draft (images and their blobs included) before
 * this dispatch runs, so the stores below only back an image the draft still holds:
 * the live draft's File, a queued turn's File, then the persisted IndexedDB blob
 * (AppSnap / reload-hydration window). Null when nothing backs the id.
 */
async function composerImageFile(threadId: string, imageId: string): Promise<File | null> {
	const staged = stagedComposerImageFile(threadId, imageId);
	if (staged) return staged;
	const draft = useComposerDraftStore.getState().draftsByThreadId[ThreadId.makeUnsafe(threadId)];
	if (!draft) return null;
	const live = draft.images.find((image) => image.id === imageId);
	if (live?.file) return live.file;
	const queued = draft.queuedTurns
		.flatMap((turn) => ("images" in turn && Array.isArray(turn.images) ? turn.images : []))
		.find((image) => image.id === imageId);
	if (queued?.file) return queued.file;
	const persisted = draft.persistedAttachments.find((item) => item.id === imageId && item.blobKey);
	return persisted?.blobKey ? await readComposerImageBlob(persisted.blobKey) : null;
}

export interface AgentWindowBridge {
	invoke(channel: string, input?: unknown): Promise<unknown>;
	send?(channel: string, input?: unknown): void;
	on?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
	removeListener?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

interface RequestBridge extends AgentWindowBridge {
	invoke(channel: typeof CEDIA_AGENT_CHANNEL, input: AgentRequest): Promise<unknown>;
}

interface AgentRequest {
	kind: "request" | "keybindings";
	method?: "GET" | "POST" | "PATCH" | "DELETE";
	path?: string;
	body?: unknown;
	action?: "read" | "write";
	file?: string;
	rule?: unknown;
	replacing?: unknown;
}

interface AdapterOptions {
	readonly bridge?: AgentWindowBridge;
	readonly now?: () => Date;
}

/** The host-owned plan control operations exposed to the shared agent bundle. */
export type CediaPlanOperation = "read" | "enter" | "exit" | "vibe.enter" | "vibe.exit" | "review.decide";

export interface CediaPlanCommand {
	readonly commandId: string;
	/** Optional for the renderer convenience API; the adapter fills it from the durable session row. */
	readonly incarnation?: string;
	readonly op: CediaPlanOperation;
	readonly workflow?: "parallel" | "iterative";
	readonly planFilePath?: string;
	readonly paused?: boolean;
	readonly confirm?: boolean;
	readonly reviewId?: number;
	readonly decision?: "approve" | "refine" | "cancel";
	readonly preserveContext?: boolean;
	readonly compactBeforeExecute?: boolean;
	readonly feedback?: string;
}

/** The host-owned advisor switch operation exposed to the shared agent bundle. */
export interface CediaAgentConfigInput {
	/** Optional for the renderer convenience API; the adapter fills the command identity. */
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly agent: string;
	readonly enabled?: boolean;
	readonly model?: string;
	readonly prewalk?: string;
	readonly advisor?: string;
}

export interface CediaAdvisorCommand {
	/** Optional for the renderer convenience API; the adapter fills both command fields. */
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly op: "set";
	readonly enabled: boolean;
}

/** A host-owned advisor config read or write; the adapter fills command identity for renderer callers. */
export interface CediaAdvisorConfigCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly scope: "project" | "user";
	readonly text?: string;
}

/** A host-owned queue drop; the adapter fills command identity for renderer callers. */
export interface CediaQueueDropCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly mode: "last" | "all";
}

/** A host-owned shell execution; the adapter fills command identity for renderer callers. */
export interface CediaBashExecCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly command: string;
}

/** A host-owned Python execution; the adapter fills command identity for renderer callers. */
export interface CediaPythonExecCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly code: string;
}

/** A host-owned Python abort; the adapter fills command identity for renderer callers. */
export interface CediaPythonAbortCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
}

/** A host-owned shell abort; the adapter fills command identity for renderer callers. */
export interface CediaBashAbortCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
}

/** A host-owned run-pause write; the adapter fills command identity for renderer callers. */
export interface CediaOmfgDraftCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly complaint: string;
	readonly feedback?: string;
}

export interface CediaOmfgSaveCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly scope: "project" | "global";
	readonly overwrite?: boolean;
	readonly allowUnvalidated?: boolean;
}

export interface CediaOmfgAbortCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
}

/** A host-owned run-pause write; the adapter fills command identity for renderer callers. */
export interface CediaCleanseRunCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly request?: string;
	readonly all?: boolean;
	readonly includeTests?: boolean;
	readonly maxAgents?: number;
	readonly model?: string;
}

export interface CediaCleanseAbortCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
}

/** A host-owned run-pause write; the adapter fills command identity for renderer callers. */
export interface CediaBtwAskCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly question: string;
}

export interface CediaBtwBranchCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
}

/** A host-owned run-pause write; the adapter fills command identity for renderer callers. */
export interface CediaRunPauseCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
	readonly paused: boolean;
}

/** A host-owned loop disable; the adapter fills command identity for renderer callers. */
export interface CediaLoopCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
}

/** A context maintenance command; the adapter fills omitted identity fields from the session. */
export interface CediaContextCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
}

/** A context shake command; the adapter fills omitted identity fields from the session. */
export interface CediaContextShakeCommand extends CediaContextCommand {
	readonly mode: "elide" | "images" | "thinking";
}

/** A memory apply command; the adapter fills omitted identity fields from the session. */
export interface CediaMemoryCommand {
	readonly commandId?: string;
	readonly incarnation?: string;
}

/** One account identity accepted by OMP's saved-reset redeem operation. */
export interface CediaCreditTarget {
	readonly credentialId?: number;
	readonly accountId?: string;
	readonly email?: string;
}

/** The runtime's own model, effort, and service-tier projection for one session. */
export interface CediaModelStateCommandTarget {
	readonly family: string;
	readonly tier: string | null;
}

/** The owner-visible account identity projection for the active provider. */
export interface CediaAccountTarget {
	readonly credentialId: number;
}

/**
 * What the shared draft owner answers before a Send dispatches (plan §2.5 item 2). `reserved`
 * carries the command the host bound to this revision; `conflict` means the revision was
 * already sent with different text; `none` means this task has no draft record to reserve.
 */
type DraftReservation =
	| { readonly status: "reserved"; readonly commandId: string; readonly revision: number }
	| { readonly status: "conflict" }
	| { readonly status: "none" };

interface BootstrapEnvironment {
	readonly platform: string;
	readonly homeDir: string;
	readonly worktreesDir: string;
	readonly version: string;
}

interface ShellProjectionOptions {
	readonly modelBySession?: ReadonlyMap<string, string>;
}

interface ModelSelectionLike {
	readonly provider: "omp";
	readonly model: string;
	readonly reasoningEffort?: string;
	readonly ompProvider?: string;
	readonly options?: { readonly thinkingLevel?: string };
}

type TaskState = CediaTaskState;

/**
 * The workspace metadata a thread carries, as the renderer asserts it.
 *
 * Synara's branch toolbar keeps a local thread pointing at the checkout it really sits in: when the
 * thread's own `branch` disagrees with the current Git branch it dispatches `thread.meta.update` to
 * bring the two together (`shouldSyncLocalThreadBranch`, `BranchToolbar.logic.ts`). Cedia ignored
 * those fields and projected `branch: null` forever, so the predicate never became false and the
 * window dispatched the same command about sixty times a second - measured 2026-09-20: 549 calls
 * in 9s, every one of them a `PATCH` that moved the session's `updated_at`, which the one-second
 * snapshot poll then read as news. The window repainted on every pass, which a user sees as the
 * chat flickering. The values are the renderer's reading of the real checkout through Cedia's own
 * git surface; recording them is what stops the argument, not an invention.
 */
interface ThreadWorkspaceMetadata {
	readonly envMode?: "local" | "worktree";
	readonly branch?: string | null;
	readonly worktreePath?: string | null;
	readonly associatedWorktreePath?: string | null;
	readonly associatedWorktreeBranch?: string | null;
	readonly associatedWorktreeRef?: string | null;
	readonly createBranchFlowCompleted?: boolean;
}

const THREAD_WORKSPACE_KEYS = [
	"envMode", "branch", "worktreePath",
	"associatedWorktreePath", "associatedWorktreeBranch", "associatedWorktreeRef",
	"createBranchFlowCompleted",
] as const;

/** The workspace fields of a `thread.meta.update`, or `undefined` when it carries none. */
function threadWorkspacePatch(row: Record<string, unknown>): ThreadWorkspaceMetadata | undefined {
	const patch: Record<string, unknown> = {};
	for (const key of THREAD_WORKSPACE_KEYS) {
		if (key in row) patch[key] = row[key];
	}
	return Object.keys(patch).length > 0 ? patch as ThreadWorkspaceMetadata : undefined;
}

function initialState(): TaskState {
	return createInitialTaskState();
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function string(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asSessionWorkspace(value: unknown, fallbackCwd: string): SessionWorkspace | undefined {
	const row = record(value);
	if (!row || (row.mode !== "local" && row.mode !== "worktree") || typeof row.isGit !== "boolean") return undefined;
	const cwd = string(row.cwd) ?? fallbackCwd;
	const root = string(row.root) ?? cwd;
	const dirtyCopyValue = record(row.dirtyCopy);
	let dirtyCopy: SessionDirtyCopy | undefined;
	if (dirtyCopyValue && (dirtyCopyValue.mode === "all" || dirtyCopyValue.mode === "none" || dirtyCopyValue.mode === "selected")) {
		const entries = array(dirtyCopyValue.entries).flatMap(value => {
			const entry = record(value);
			if (!entry || typeof entry.path !== "string" || (entry.state !== "applied" && entry.state !== "copied" && entry.state !== "unchanged" && entry.state !== "conflict")) return [];
			const state = entry.state as SessionDirtyCopy["entries"][number]["state"];
			return [{ path: entry.path, state, ...(typeof entry.reason === "string" ? { reason: entry.reason } : {}) }];
		});
		if (entries.length === array(dirtyCopyValue.entries).length) dirtyCopy = { mode: dirtyCopyValue.mode, entries };
	}
	const text = (key: string): string | undefined => string(row[key]);
	const cleanupState = row.cleanupState === "retained" || row.cleanupState === "archive_requested" || row.cleanupState === "prepared" || row.cleanupState === "removed"
		? row.cleanupState
		: undefined;
	return {
		mode: row.mode,
		isGit: row.isGit,
		cwd,
		root,
		...(text("branch") ? { branch: text("branch") } : {}),
		...(text("sourceCommit") ? { sourceCommit: text("sourceCommit") } : {}),
		...(text("baseRef") ? { baseRef: text("baseRef") } : {}),
		...(dirtyCopy ? { dirtyCopy } : {}),
		...(text("taskId") ? { taskId: text("taskId") } : {}),
		...(text("projectId") ? { projectId: text("projectId") } : {}),
		...(text("repositoryId") ? { repositoryId: text("repositoryId") } : {}),
		...(text("worktreeRoot") ? { worktreeRoot: text("worktreeRoot") } : {}),
		...(text("actualCwd") ? { actualCwd: text("actualCwd") } : {}),
		...(text("taskBranch") ? { taskBranch: text("taskBranch") } : {}),
		...(text("integrationTargetRef") ? { integrationTargetRef: text("integrationTargetRef") } : {}),
		...(text("integrationTargetCommit") ? { integrationTargetCommit: text("integrationTargetCommit") } : {}),
		...(text("integrationObservedCommit") ? { integrationObservedCommit: text("integrationObservedCommit") } : {}),
		...(text("restorationRef") ? { restorationRef: text("restorationRef") } : {}),
		...(text("restorationSha") ? { restorationSha: text("restorationSha") } : {}),
		...(Number.isSafeInteger(row.cleanupGeneration) ? { cleanupGeneration: row.cleanupGeneration as number } : {}),
		...(cleanupState ? { cleanupState } : {}),
		...(text("lastFailure") ? { lastFailure: text("lastFailure") } : {}),
	};
}

/**
 * Why a failed transcript entry failed, in the provider's own words.
 *
 * OMP records an assistant message that ended on a provider error with the message it received
 * (`errorMessage`, and a shorter `errorClassificationMessage` alongside it), and the message
 * carries no text at all. The provider's sentence is the honest content for that row; Cedia's own
 * sentence only says that the turn stopped. Moved here with item 56: the native chat surface that
 * owned this reader is retired, and the bundle timeline is its only reader now.
 */
function entryFailureText(entry: TranscriptEntry): string | undefined {
	if (entry.status !== "failed") return undefined;
	for (const frame of [...entry.rawFrames].reverse()) {
		const row = record(frame);
		// A host event carries the message either at its top level or under `message`, and the
		// write-through ack nests both under `data`.
		const message = record(row?.message) ?? record(record(row?.data)?.message);
		const text = string(message?.errorMessage) ?? string(row?.errorMessage)
			?? string(message?.errorClassificationMessage) ?? string(row?.errorClassificationMessage);
		if (text) return text;
	}
	return undefined;
}

/**
 * Name the non-image references so their context is not dropped silently, then
 * fold them into the prompt as one `Attached context` block. Moved here with
 * item 56 for the same reason as `entryFailureText`: the adapter is the only
 * caller left.
 */
function promptWithAttachedContext(prompt: string, labels: readonly string[]): string {
	if (labels.length === 0) return prompt;
	return `${prompt}\n\nAttached context:\n${labels.map(label => `- ${label}`).join("\n")}`;
}

/**
 * The frame as the reducer reads it, keeping the envelope's timestamp.
 *
 * The durable event envelope owns the timestamp, while the shared reducer
 * intentionally receives only the frame payload. Preserve the envelope timestamp
 * on object frames so lifecycle projections (turns, messages, tools) retain an
 * ordering timestamp without maintaining a second reducer in this adapter.
 */
function frameWithEnvelopeTimestamp(frame: Json, timestamp: string): Json {
	const row = typeof frame === "object" && frame !== null && !Array.isArray(frame) ? frame : undefined;
	if (!row || typeof row.timestamp === "string") return frame;
	return { ...row, timestamp };
}

function reduceEvents(state: TaskState, events: readonly SessionEvent[]): TaskState {
	return applyEventPage(state, {
		events: events.map(event => ({
			sessionId: event.sessionId,
			incarnation: event.incarnation,
			sequence: event.sequence,
			timestamp: event.timestamp,
			frame: frameWithEnvelopeTimestamp(event.frame, event.timestamp),
		})),
		cursor: events.at(-1)?.sequence ?? state.cursor,
		hasMore: false,
	});
}

function asProjects(value: unknown): Project[] {
	return array(value).flatMap(item => {
		const row = record(item);
		if (!row) return [];
		const id = string(row?.id);
		const path = string(row?.path);
		const name = string(row?.name) ?? path?.split(/[\\/]/).filter(Boolean).at(-1);
		const createdAt = string(row?.createdAt);
		if (!id || !path || !name || !createdAt) return [];
		return [{
			id,
			path,
			name,
			pinned: row.pinned === true,
			archived: row.archived === true,
			createdAt,
		}];
	});
}

/**
 * Is this the host's pending-model record?
 *
 * The states are the host's own three; anything else is not a record a window may draw.
 */
function isPendingModelRecord(value: unknown): value is NonNullable<Session["pendingModel"]> {
	const row = record(value);
	if (!row) return false;
	if (typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1) return false;
	if (row.state !== "awaiting" && row.state !== "in-effect" && row.state !== "refused") return false;
	return typeof row.acceptedAt === "string" && record(row.requested) !== undefined;
}

/**
 * Is this the host's own archive receipt (§2.6)?
 *
 * The four states are the host's protocol; a receipt missing its own required facts is not one a
 * window may show as a retention decision.
 */
function isArchiveReceipt(value: unknown): value is NonNullable<Session["archive"]> {
	const row = record(value);
	if (!row) return false;
	if (row.state !== "retained" && row.state !== "prepared" && row.state !== "removed" && row.state !== "restored") return false;
	if (typeof row.dirty !== "boolean" || typeof row.ignored !== "boolean") return false;
	if (typeof row.recordedAt !== "string" || typeof row.reason !== "string") return false;
	if (row.state === "restored") {
		const restored = record(row.restored);
		if (!restored || typeof restored.worktree !== "string" || typeof restored.branch !== "string" || typeof restored.reattached !== "boolean") return false;
	}
	return true;
}

function asSessions(value: unknown): Session[] {
	return array(value).flatMap(item => {
		const row = record(item);
		if (!row) return [];
		const id = string(row?.id);
		const projectId = string(row?.projectId);
		const title = string(row?.title) ?? "New task";
		const cwd = string(row?.cwd) ?? "";
		const sessionFile = string(row?.sessionFile) ?? "";
		const incarnation = string(row?.incarnation);
		const createdAt = string(row?.createdAt);
		const updatedAt = string(row?.updatedAt) ?? createdAt;
		const status = row.status;
		if (!id || !projectId || !cwd || !incarnation || !createdAt || !updatedAt) return [];
		const workspace = asSessionWorkspace(row.workspace, cwd);
		return [{
			id,
			projectId,
			title,
			cwd,
			sessionFile,
			incarnation,
			// Anything outside the host's own status vocabulary is not a state a client
			// may act on, so it reads as the quiet one.
			status: status === "running" || status === "stopped" || status === "recovery_required" ? status : "idle",
			archived: row.archived === true,
			pinned: row.pinned === true,
			createdAt,
			updatedAt,
			...(workspace ? { workspace } : {}),
			// Null for an ordinary task, the source task's id for a sidechat fork.
			sidechatSourceThreadId: string(row.sidechatSourceThreadId) ?? null,
			// The host's turn projection travels with the row: it is what tells a caller whether a
			// model change belongs to the turn about to start or to the one after it.
			...(Array.isArray(row.turns) ? { turns: row.turns as Session["turns"] } : {}),
			// §2.4: the model/effort change the task is holding. It is a record about the request,
			// never a claim that OMP committed it, so a row whose shape is not the host's own
			// vocabulary carries nothing rather than a half-read record.
			...(isPendingModelRecord(row.pendingModel) ? { pendingModel: row.pendingModel } : {}),
			// §2.6: the archive receipt the host recorded for this task, read only when it has the
			// states and facts the host itself writes.
			...(isArchiveReceipt(row.archive) ? { archive: row.archive } : {}),
		}];
	});
}

function iso(now: () => Date): string {
	return now().toISOString();
}

function keybindingsPath(environment: BootstrapEnvironment): string {
	const home = environment.homeDir.replace(/[\\/]+$/, "");
	if (environment.platform === "darwin") return `${home}/Library/Application Support/Cedia/User/keybindings.json`;
	if (environment.platform === "win32") return `${home}/AppData/Roaming/Cedia/User/keybindings.json`;
	return `${home}/.config/Cedia/User/keybindings.json`;
}

function id(): string {
	try {
		if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
	} catch {
		// Fall through to the non-cryptographic identity only in an unavailable test runtime.
	}
	return `cedia-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function splitIdeTarget(target: string, projects: readonly Project[]): { cwd: string; path?: string; line?: number } {
	if (!target.startsWith("/") || target.includes("\0")) throw new Error("IDE target must be an absolute path");
	let path = target;
	let line: number | undefined;
	const lineSuffix = /^(.*):(\d+)(?::\d+)?$/.exec(target);
	if (lineSuffix && lineSuffix[1]?.startsWith("/")) {
		path = lineSuffix[1];
		line = Number(lineSuffix[2]);
	}
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
	const root = projects
		.map(project => ({ project, root: project.path.replace(/\\/g, "/").replace(/\/+$/, "") || "/" }))
		.filter(item => normalized === item.root || normalized.startsWith(`${item.root}/`))
		.sort((a, b) => b.root.length - a.root.length)[0];
	if (root) {
		const relative = normalized.slice(root.root.length).replace(/^\/+/, "");
		return {
			cwd: root.project.path,
			...(relative ? { path: relative } : {}),
			...(line ? { line } : {}),
		};
	}
	const slash = normalized.lastIndexOf("/");
	if (slash <= 0) return { cwd: normalized, ...(line ? { line } : {}) };
	return { cwd: normalized.slice(0, slash), path: normalized.slice(slash + 1), ...(line ? { line } : {}) };
}

function unsupported(operation: string): never {
	throw new Error(`Cedia Agent Window does not support ${operation}`);
}

function frameReference(frame: unknown): { sequence: number; length: number; sha256: string } | undefined {
	const row = record(frame);
	if (row?.type !== "cedia_frame_reference") return undefined;
	if (!Number.isSafeInteger(row.sequence) || !Number.isSafeInteger(row.length) || (row.length as number) < 1 || (row.length as number) > 64 * 1024 * 1024 || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error("Invalid event reference");
	return { sequence: row.sequence as number, length: row.length as number, sha256: row.sha256 };
}

async function sha256Hex(value: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error("Cedia event integrity cannot be verified in this runtime");
	const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function modelFromFrame(frame: unknown): { id: string; provider?: string; effort?: string } | undefined {
	const row = record(frame);
	if (!row) return undefined;
	const type = string(row.type) ?? string(row.event) ?? string(row.kind);
	const candidates: { value: Record<string, unknown>; explicitModel: boolean }[] = [{ value: row, explicitModel: false }];
	for (const nested of [row, ...["data", "state", "result", "ack"].map(key => record(row[key]))]) {
		if (!nested) continue;
		candidates.push({ value: nested, explicitModel: false });
		for (const modelKey of ["model", "currentModel"]) {
			const model = record(nested[modelKey]);
			if (model) candidates.push({ value: {
				...model,
				// OMP get_state returns effort beside the model object, not inside it.
				thinkingLevel: model.thinkingLevel ?? nested.thinkingLevel,
				reasoningEffort: model.reasoningEffort ?? nested.reasoningEffort,
			}, explicitModel: true });
		}
	}
	for (const candidate of candidates) {
		const nested = candidate.value;
		const model = string(nested.modelId) ?? string(nested.model) ?? string(nested.currentModel) ?? (candidate.explicitModel ? string(nested.id) : undefined);
		const hasModelShape = candidate.explicitModel || typeof nested.modelId === "string" || typeof nested.currentModel === "string" || (type ? /(state|model)/i.test(type) : false);
		if (!model || !hasModelShape) continue;
		const provider = string(nested.provider) ?? string(nested.modelProvider);
		const effort = string(nested.thinkingLevel) ?? string(nested.reasoningEffort);
		return { id: model, ...(provider ? { provider } : {}), ...(effort ? { effort } : {}) };
	}
	return undefined;
}

function latestModel(state: TaskState, session: Session): { id: string; provider?: string; effort?: string } | undefined {
	const direct = modelFromFrame(session);
	if (direct) return direct;
	for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
		const entry = state.transcript[index];
		if (!entry) continue;
		for (let frameIndex = entry.rawFrames.length - 1; frameIndex >= 0; frameIndex -= 1) {
			const model = modelFromFrame(entry.rawFrames[frameIndex]);
			if (model) return model;
		}
	}
	return undefined;
}

function modelSlug(model: { id: string; provider?: string }): string {
	if (!model.provider) return model.id;
	const prefix = `${model.provider}/`;
	return model.id.startsWith(prefix) ? model.id : `${prefix}${model.id}`;
}

function selectionFor(session: Session, state: TaskState, modelBySession?: ReadonlyMap<string, string>): ModelSelectionLike {
	const model = latestModel(state, session);
	const id = model ? modelSlug(model) : modelBySession?.get(session.id) ?? OMP_UNRESOLVED_MODEL;
	return {
		provider: "omp",
		model: id,
		...(model?.effort ? { reasoningEffort: model.effort, options: { thinkingLevel: model.effort } } : {}),
		...(model?.provider ? { ompProvider: model.provider } : {}),
	};
}

function sessionStatus(status: string, turn: TurnProjection | null): "idle" | "starting" | "running" | "ready" | "interrupted" | "stopped" | "error" {
	switch (status) {
		case "recovery_required": return "error";
		case "stopped": return "stopped";
		default:
			if (turn?.state === "running") return "running";
			// Cedia's `running` session status means the OMP process is alive. The
			// actual turn lifecycle is carried by agent_start/agent_end frames.
			if (status === "running" || turn?.state === "completed") return "ready";
			// Cedia's `idle` is not an ended session: the task still owns its folder
			// (plan section 3.C) and its runtime starts on demand, so it is the
			// vendor's `ready`. Reporting `idle` would read as legacy `closed` and
			// release the folder slot the host still holds, refusing the next local
			// task instead of offering the busy-project worktree default.
			if (status === "idle") return "ready";
			return "idle";
	}
}

/**
 * The turn each transcript entry belongs to, keyed by entry id.
 *
 * Synara only offers "edit message" at the tail of a conversation, and it decides that from the
 * `turnId` the messages carry (`resolveLatestTailUserMessageEditTarget`): the tail from the latest
 * user message must belong to exactly one turn. Cedia projected `turnId: null` for every message,
 * so that policy always answered `missing-turn-metadata` and the button never rendered - measured
 * live 2026-09-20, zero `Edit message` controls in the window. A turn starts at the prompt command
 * the host records (the write-through ack does not start one) and owns every entry after it until
 * the next prompt.
 */
function turnIdsByEntry(state: TaskState): Map<string, string> {
	const byEntry = new Map<string, string>();
	let current: string | undefined;
	for (const entry of state.transcript) {
		for (const frame of entry.rawFrames) {
			if (string(frame.type) !== "cedia_command") continue;
			const command = record(frame.command);
			const kind = string(command?.kind);
			if (kind !== "prompt" && kind !== "steer" && kind !== "follow_up") continue;
			current = string(command?.commandId);
		}
		if (current) byEntry.set(entry.id, current);
	}
	return byEntry;
}

function messagesFromState(state: TaskState, fallbackTime: string, turnIds: ReadonlyMap<string, string>): unknown[] {
	return state.transcript.flatMap((entry, index) => {
		if (entry.role !== "user" && entry.role !== "assistant") return [];
		const createdAt = entry.createdAt ?? fallbackTime;
		return [{
			id: entry.id || `message-${index + 1}`,
			role: entry.role,
			// A turn that ended on a provider error carries no text at all: OMP records the
			// provider's own sentence on the frame instead, and the timeline then painted
			// `(empty response)`, which read as a completion with nothing to say. `entryFailureText`
			// is the same reader the Code-OSS sessions window already prints that sentence from, so
			// both surfaces say why a turn produced nothing.
			text: entry.text || entryFailureText(entry) || entry.text,
			turnId: turnIds.get(entry.id) ?? null,
			streaming: entry.status === "streaming",
			source: "native",
			createdAt,
			updatedAt: createdAt,
		}];
	});
}

export function contextUsageFromFrame(frame: unknown): { usedTokens: number; maxTokens: number; usedPercent: number } | undefined {
	const row = record(frame);
	if (!row) return undefined;
	for (const candidate of [row, record(row.data), record(row.state), record(record(row.result)?.data), record(record(row.ack)?.data)]) {
		const usage = record(candidate?.contextUsage);
		const tokens = usage?.tokens;
		const capacity = usage?.contextWindow;
		if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0 || typeof capacity !== "number" || !Number.isFinite(capacity) || capacity <= 0) continue;
		return { usedTokens: tokens, maxTokens: capacity, usedPercent: Math.min(100, tokens / capacity * 100) };
	}
	return undefined;
}

function activitiesFromState(state: TaskState, fallbackTime: string): unknown[] {
	return state.transcript.flatMap((entry, index) => {
		if (entry.role !== "tool" && entry.kind !== "tool" && entry.kind !== "event") return [];
		const raw = entry.rawFrames.at(-1);
		const rawType = string(raw?.type) ?? string(raw?.event) ?? string(raw?.kind);
		if (rawType && ["cedia_session", "cedia_command", "response", "ready", "agent_start", "agent_end", "prompt_result"].includes(rawType)) return [];
		// The reducer keeps one `event` entry per frame it does not model, and gives that entry the
		// frame's own type as its text when the frame carries nothing else (`state.ts`, the `event`
		// branch). OMP's bookkeeping frames - `turn_start`, `turn_end`, `auto_retry_start`,
		// `auto_retry_end`, `model_changed`, `thinking_level_changed`, `advisor_cost_changed` - arrive
		// that way, so drawing them fills the transcript with rows reading `Turn_start`. The dock
		// already keeps this rule (it draws no `event` row unless it failed); the window follows it,
		// because a failed frame is still a fact the user needs and an unmodelled one that succeeded
		// is not.
		if (entry.kind === "event" && entry.status !== "failed") return [];
		const summary = entry.text.trim() || entry.toolName || "OMP event";
		return [{
			id: entry.id || `activity-${index + 1}`,
			tone: entry.status === "failed" ? "error" : entry.role === "tool" ? "tool" : "info",
			kind: entry.toolName ?? entry.kind ?? "event",
			summary,
			payload: { ...(entry.rawFrames.at(-1) ?? {}), cediaToolStatus: entry.toolStatus ?? entry.status },
			turnId: null,
			sequence: index + 1,
			createdAt: entry.createdAt ?? fallbackTime,
		}];
	});
}

interface TurnProjection {
	readonly turnId: string;
	readonly state: "running" | "interrupted" | "completed" | "error";
	readonly requestedAt: string;
	readonly startedAt: string | null;
	readonly completedAt: string | null;
}

function latestTurnFromState(state: TaskState): TurnProjection | null {
	let latest: TurnProjection | null = null;
	for (const entry of state.transcript) {
		for (const frame of entry.rawFrames) {
			const type = string(frame.type) ?? string(frame.event) ?? string(frame.kind);
			// Generic event rows in the shared reducer retain the raw frame but do
			// not assign a transcript-row timestamp.  reduceEvents preserves the
			// durable envelope timestamp on the frame, so use it for turn
			// lifecycle projections before falling back to the row timestamp.
			const timestamp = entry.createdAt ?? string(frame.timestamp);
			if (!type || !timestamp) continue;
			if (type === "cedia_command") {
				const command = record(frame.command);
				if (string(command?.kind) !== "prompt" && string(command?.kind) !== "steer" && string(command?.kind) !== "follow_up") continue;
				const commandId = string(command?.commandId) ?? `turn:${entry.id}`;
				// The host records a command twice: once acknowledged, once carrying its result when
				// the turn finishes. The second record arrives *after* that turn's `agent_end`, so
				// reading it as "a turn started" put a finished task back into `running` - the window
				// then offered `Steer` instead of `Send` and queued everything the user typed. The
				// command's own status is the discriminator: an in-flight command is a running turn.
				const status = string(command?.status);
				if (status === "completed" || status === "failed" || status === "outcome_unknown" || status === "not_dispatched") {
					if (!latest || latest.turnId !== commandId) continue;
					latest = { turnId: latest.turnId, state: "completed", requestedAt: latest.requestedAt, startedAt: latest.startedAt, completedAt: timestamp };
					continue;
				}
				latest = { turnId: commandId, state: "running", requestedAt: timestamp, startedAt: null, completedAt: null };
				continue;
			}
			if (type === "agent_start") {
				const turnId: string = string(frame.turnId) ?? string(frame.turn_id) ?? string(frame.id) ?? latest?.turnId ?? `turn:${entry.id}`;
				latest = { turnId, state: "running", requestedAt: latest?.requestedAt ?? timestamp, startedAt: timestamp, completedAt: null };
				continue;
			}
			if (type === "agent_end") {
				if (!latest) continue;
				latest = { ...latest, state: frame.isTerminal === false ? "running" : "completed", completedAt: frame.isTerminal === false ? null : timestamp };
			}
		}
	}
	return latest;
}

function pendingInteractions(value: unknown, session: Session, now: string): unknown[] {
	return array(value).flatMap(item => {
		const row = record(item);
		const token = string(row?.token) ?? string(row?.requestId);
		if (!token) return [];
		const request = record(row?.request) ?? row ?? {};
		const method = string(request.method) ?? "confirm";
		return [{
			interactionKind: /input|select|editor/i.test(method) ? "userInput" : "approval",
			requestId: token,
			threadId: session.id,
			turnId: null,
			lifecycleGeneration: session.incarnation,
			status: "pending",
			decision: null,
			responseCommandId: null,
			responseRequestedAt: null,
			createdAt: string(row?.receivedAt) ?? now,
			resolvedAt: null,
		}];
	});
}

/**
 * Synthesize the `user-input.requested` activities the bundle's pending-input
 * derivation replays (probe 10 gap, item 1 permission half).
 *
 * The settlement rows above deliberately stay token-only (no titles, options,
 * or params — #1305), and the derivation ignores settlements for content: it
 * rebuilds pending inputs from `user-input.requested` activities carrying
 * `payload.questions`. OMP's permission gate arrives as `select` frames
 * (options Approve/Deny), so without this synthesis the composer panel has
 * nothing to render and no click can reach `thread.user-input.respond`.
 * Only the decision surface (title + option labels) is forwarded; rich
 * request params never leave the broker journal.
 */
function pendingInputActivities(value: unknown, session: Session, now: string, sequenceStart: number): unknown[] {
	return array(value).flatMap((item, index) => {
		const row = record(item);
		const token = string(row?.token) ?? string(row?.requestId);
		if (!token) return [];
		const request = record(row?.request) ?? {};
		const method = string(request.method) ?? "";
		if (!/input|select|editor/i.test(method)) return [];
		const title = string(request.title) ?? "";
		if (!title) return [];
		const questionId = string(request.id) ?? token;
		const details = array(request.optionDetails);
		const options = array(request.options).flatMap((option, optionIndex) => {
			const label = string(option);
			if (!label) return [];
			const description = string(record(details[optionIndex])?.description) ?? "";
			return [{ label, description }];
		});
		// `input`/`editor` frames carry no options; the composer supplies free text.
		return [{
			id: `pending-input-${token}`,
			tone: "info",
			kind: "user-input.requested",
			summary: title,
			payload: {
				requestId: token,
				lifecycleGeneration: session.incarnation,
				questions: [{ id: questionId, header: "Permission", question: title, options }],
			},
			turnId: null,
			sequence: sequenceStart + index,
			createdAt: string(row?.receivedAt) ?? now,
		}];
	});
}

/**
 * Synthesize the `approval.requested` activities the bundle's pending-approval
 * derivation replays (o11 paid-probe gap: `confirm`-method broker frames project
 * to token-only `approval` settlements and render nothing clickable, so the turn
 * stalls with no path to an answer).
 *
 * The only in-tree producer of `confirm`-method frames is the native editor
 * bridge (`apps/host/src/service.ts`, "Allow this editor change?"), so a confirm
 * row is a file-change approval: requestKind `file-change`, detail carrying the
 * title plus the bounded request message. The bundle's own approval UI answers
 * through the existing `thread.approval.respond` boolean path, so no
 * respond-side change is needed, and no other broker field leaves the journal.
 */
const CONFIRM_DETAIL_LIMIT = 2000;

function pendingApprovalActivities(value: unknown, session: Session, now: string, sequenceStart: number): unknown[] {
	return array(value).flatMap((item, index) => {
		const row = record(item);
		const token = string(row?.token) ?? string(row?.requestId);
		if (!token) return [];
		const request = record(row?.request) ?? {};
		if (!/^confirm$/i.test(string(request.method) ?? "")) return [];
		const title = string(request.title) ?? "";
		if (!title) return [];
		const message = string(request.message) ?? "";
		const full = message ? `${title}\n${message}` : title;
		const detail = full.length > CONFIRM_DETAIL_LIMIT ? `${full.slice(0, CONFIRM_DETAIL_LIMIT)}\n[truncated]` : full;
		return [{
			id: `pending-approval-${token}`,
			tone: "info",
			kind: "approval.requested",
			summary: title,
			payload: {
				requestId: token,
				lifecycleGeneration: session.incarnation,
				requestKind: "file-change",
				detail,
			},
			turnId: null,
			sequence: sequenceStart + index,
			createdAt: string(row?.receivedAt) ?? now,
		}];
	});
}

/** The newest native goal event in the reduced OMP transcript, if one was valid. */
function latestGoalSnapshot(state: TaskState): OmpGoalSnapshot | undefined {
	for (let entryIndex = state.transcript.length - 1; entryIndex >= 0; entryIndex -= 1) {
		const entry = state.transcript[entryIndex];
		if (!entry) continue;
		for (let frameIndex = entry.rawFrames.length - 1; frameIndex >= 0; frameIndex -= 1) {
			const frame = entry.rawFrames[frameIndex];
			if (record(frame)?.type !== "goal_updated") continue;
			try {
				// The shared reducer adds the durable event timestamp to every object frame. It is
				// envelope metadata, not part of OMP's strict goal_updated payload.
				const row = record(frame);
				const { timestamp: _timestamp, ...goalFrame } = row ?? {};
				const event = parseOmpGoalUpdatedEvent(goalFrame);
				return event.state === undefined
					? { enabled: event.goal !== null, goal: event.goal }
					: { ...event.state, goal: event.goal };
			} catch {
				// A malformed future event is not a goal. Keep looking for an earlier valid
				// event; the host read below remains the fallback when none is usable.
			}
		}
	}
	return undefined;
}

/** Read the host route's available wrapper, dropping only its route metadata. */
function parseHostGoalSnapshot(value: unknown): OmpGoalSnapshot | undefined {
	const row = record(value);
	if (!row || row.state !== "available") return undefined;
	const { state: _state, revision: _revision, ...snapshot } = row;
	try { return parseOmpGoalSnapshot(snapshot); } catch { return undefined; }
}

function visibleGoal(snapshot: OmpGoalSnapshot | undefined): OmpGoalSnapshot["goal"] {
	const goal = snapshot?.goal;
	// OMP keeps a budget-limited goal live so the owner can raise its budget. The vendor header has
	// no separate budget state, so keep showing the objective (with no paused timestamp) until OMP
	// reports the terminal dropped or complete state.
	return goal && (goal.status === "active" || goal.status === "paused" || goal.status === "budget-limited") ? goal : null;
}

/** Read the host's available live subagent wrapper, dropping route metadata and invalid rows. */
function parseHostSubagents(value: unknown): OmpSubagentRow[] | undefined {
	const row = record(value);
	if (!row || row.state !== "available" || !Array.isArray(row.subagents)) return undefined;
	try { return parseOmpSubagentList(row.subagents); } catch { return undefined; }
}

function subagentActivityTime(row: OmpSubagentRow, fallback: string): string {
	try { return new Date(row.lastUpdate).toISOString(); } catch { return fallback; }
}

/** Build the exact payload shape consumed by workLog.ts's collab subagent decoders. */
function subagentActivitiesFromRows(
	rows: readonly OmpSubagentRow[] | undefined,
	turnId: string | null,
	sequenceStart: number,
	fallbackTime: string,
): unknown[] {
	if (!rows || rows.length === 0) return [];
	return rows.map((row, index) => {
		// `agent` is OMP's own agent name (the definition the run was started from), which is what
		// the strip shows as the role; `agentSource` is where that definition came from (bundled,
		// project, user) and would read as a meaningless label, so it stays out of the display.
		const label = row.assignment ?? row.task ?? row.description ?? `${row.agent} subagent`;
		const receiverAgent: Record<string, unknown> = {
			threadId: row.id,
			agentId: row.agent,
			agentRole: row.agent,
			...(row.progress?.resolvedModel === undefined ? {} : { model: row.progress.resolvedModel }),
			...(row.assignment === undefined && row.task === undefined ? {} : { prompt: row.assignment ?? row.task! }),
		};
		const agentState: Record<string, unknown> = {
			threadId: row.id,
			agentId: row.agent,
			agentRole: row.agent,
			status: row.status,
			message: label,
			...(row.progress?.resolvedModel === undefined ? {} : { model: row.progress.resolvedModel }),
		};
		const item = {
			status: row.status,
			prompt: label,
			receiverAgents: [receiverAgent],
			statuses: { [row.id]: agentState },
		};
		return {
			id: `cedia-subagent-${row.id}`,
			kind: row.status === "completed" || row.status === "failed" || row.status === "aborted" ? "tool.completed" : "tool.started",
			tone: row.status === "failed" || row.status === "aborted" ? "error" : "tool",
			summary: label,
			payload: { itemType: "collab_agent_tool_call", data: { item } },
			turnId,
			sequence: sequenceStart + index,
			createdAt: subagentActivityTime(row, fallbackTime),
		};
	});
}

function goalTimeIso(value: number | undefined): string | null {
	if (value === undefined) return null;
	try { return new Date(value).toISOString(); } catch { return null; }
}

function threadProjection(
	session: Session,
	project: Project | undefined,
	state: TaskState,
	now: string,
	modelBySession?: ReadonlyMap<string, string>,
	pendingUi?: unknown,
	workspace?: ThreadWorkspaceMetadata,
	goalSnapshot?: OmpGoalSnapshot,
	subagents?: readonly OmpSubagentRow[],
): Record<string, unknown> {
	const modelSelection = selectionFor(session, state, modelBySession);
	const interactions = pendingInteractions(pendingUi, session, now);
	const latestTurn = latestTurnFromState(state);
	const turnIds = turnIdsByEntry(state);
	const subagentTurnId = latestTurn?.turnId ?? [...turnIds.values()].at(-1) ?? null;
	const ownSubagent = subagents?.find(candidate => candidate.id === session.id || candidate.sessionFile === session.sessionFile);
	// The host's session row is authoritative immediately after a worktree task is
	// created. Renderer metadata is only a compatibility override for older rows and
	// explicit handoff updates; do not fall back to the project root while that local
	// metadata map is still empty.
	const hostWorkspace = session.workspace;
	const projectedEnvMode = workspace?.envMode ?? hostWorkspace?.mode ?? "local";
	const projectedBranch = workspace?.branch ?? hostWorkspace?.taskBranch ?? hostWorkspace?.branch ?? null;
	const projectedWorktreePath = workspace?.worktreePath ??
		(projectedEnvMode === "worktree" ? hostWorkspace?.actualCwd ?? hostWorkspace?.worktreeRoot ?? hostWorkspace?.cwd ?? session.cwd : null);
	const projectedAssociatedWorktreePath = workspace?.associatedWorktreePath ?? projectedWorktreePath;
	const projectedAssociatedWorktreeBranch = workspace?.associatedWorktreeBranch ?? projectedBranch;
	const projectedAssociatedWorktreeRef = workspace?.associatedWorktreeRef ?? hostWorkspace?.sourceCommit ?? hostWorkspace?.baseRef ?? null;
	const sessionView = {
		threadId: session.id,
		status: sessionStatus(session.status, latestTurn),
		providerName: "omp",
		runtimeMode: "approval-required",
		activeTurnId: latestTurn?.state === "running" ? latestTurn.turnId : null,
		lastError: session.status === "recovery_required" ? "OMP session requires reconciliation" : null,
		updatedAt: session.updatedAt,
		// §2.4: a model/effort change the task is holding for its next turn travels with the row,
		// so a surface can show "awaiting OMP" instead of presenting the request as in effect.
		pendingModel: session.pendingModel ?? null,
		// §2.6: what the archive kept, and how Continue put a task back. The window shows a decision
		// from the host's own record rather than inferring that files came back.
		archive: session.archive ?? null,
		// §2.4/O01: the bounded turn projection, reduced to what a surface may draw. The window can
		// say how much work OMP is holding and whether a turn's outcome is still unknown; it never
		// sees this device's identity or the payload hash, and it never invents a turn the host did
		// not record.
		turns: (session.turns ?? []).map(turn => ({
			turnIntentId: turn.turnIntentId,
			state: turn.state,
			...(turn.queuePosition === undefined ? {} : { queuePosition: turn.queuePosition }),
			...(turn.model === undefined ? {} : { model: turn.model }),
			...(turn.reason === undefined ? {} : { reason: turn.reason }),
		})),
	};
	const goal = visibleGoal(goalSnapshot);
	return {
		id: session.id,
		projectId: session.projectId,
		title: session.title,
		modelSelection,
		runtimeMode: "approval-required",
		interactionMode: "default",
		envMode: projectedEnvMode,
		branch: projectedBranch,
		worktreePath: projectedWorktreePath,
		workingDirectory: session.cwd,
		associatedWorktreePath: projectedAssociatedWorktreePath,
		associatedWorktreeBranch: projectedAssociatedWorktreeBranch,
		associatedWorktreeRef: projectedAssociatedWorktreeRef,
		createBranchFlowCompleted: workspace?.createBranchFlowCompleted ?? false,
		isPinned: session.pinned === true,
		parentThreadId: null,
		creationSource: null,
		sourceThreadId: null,
		sourceTurnId: null,
		gatewayOperationId: null,
		gatewayOperationIndex: null,
		subagentAgentId: ownSubagent?.agent ?? null,
		subagentNickname: ownSubagent?.description ?? null,
		subagentRole: ownSubagent?.agent ?? null,
		forkSourceThreadId: null,
		sidechatSourceThreadId: string(session.sidechatSourceThreadId) ?? null,
		sidechatLastActivityAt: null,
		sidechatExpiredAt: null,
		lastKnownPr: null,
		latestTurn: latestTurn ? { ...latestTurn, assistantMessageId: null } : null,
		latestUserMessageAt: null,
		hasPendingApprovals: interactions.some(item => record(item)?.interactionKind === "approval"),
		hasPendingUserInput: interactions.some(item => record(item)?.interactionKind === "userInput"),
		hasActionableProposedPlan: false,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		archivedAt: session.archived ? session.updatedAt : null,
		settledAt: null,
		deletedAt: null,
		handoff: null,
		pinnedMessages: [],
		notes: "",
		goal: goal?.objective ?? "",
		goalStartedAt: goalTimeIso(goal?.createdAt),
		goalPausedAt: goal?.status === "paused" ? goalTimeIso(goal.updatedAt) : null,
		goalAchievements: [],
		messages: messagesFromState(state, now, turnIds),
		proposedPlans: [],
		activities: [
			...activitiesFromState(state, now),
			...pendingInputActivities(pendingUi, session, now, state.transcript.length + 1),
			...pendingApprovalActivities(pendingUi, session, now, state.transcript.length + 1),
			...subagentActivitiesFromRows(subagents, subagentTurnId, state.transcript.length + 1, now),
		],
		pendingInteractions: interactions,
		cediaSlashCommands: state.slashCommands,
		checkpoints: [],
		session: sessionView,
		projectTitle: project?.name,
	};
}

function shellThreadProjection(thread: Record<string, unknown>, session: Session): Record<string, unknown> {
	const copy = { ...thread };
	// The host updates status on agent_start/terminal agent_end. Cached detail
	// may belong to a task no longer subscribed to; it cannot own shell liveness.
	const turn = record(copy.latestTurn);
	const running = session.status === "running";
	if ((turn?.state === "running") !== running) copy.latestTurn = null;
	copy.session = {
		...record(copy.session),
		status: running ? "running" : sessionStatus(session.status, null),
		activeTurnId: running && turn?.state === "running" ? turn.turnId : null,
	};
	delete copy.messages;
	delete copy.proposedPlans;
	delete copy.activities;
	delete copy.pendingInteractions;
	delete copy.checkpoints;
	delete copy.pinnedMessages;
	delete copy.notes;
	delete copy.goalAchievements;
	return copy;
}

/**
 * Everything {@link threadProjection} is built from, as one comparable string.
 *
 * `subscribeThread` polls the host once a second, because the host exposes a cursor rather than a
 * push channel, and the window repaints whatever it is handed. Emitting one snapshot per poll
 * therefore repainted an idle task forever - measured 2026-09-20 on a stopped task: ~510 DOM
 * mutations per second and the renderer pinned at 110% CPU, which a user reads as the chat
 * flickering. The event cursor moves when the transcript changes and the session record covers
 * everything else, so a poll that finds both unchanged has nothing new to say.
 *
 * The `now` argument is deliberately absent: it only ever feeds timestamp fallbacks, and a fallback
 * that moves is not news. Everything else the projection reads has to be here, or the window would
 * stop updating - keep this in step with {@link threadProjection}'s parameters.
 */
function threadSnapshotKey(input: {
	readonly session: Session;
	readonly project: Project | undefined;
	readonly cursor: number;
	readonly ui: readonly unknown[];
	readonly model?: string;
	readonly usage?: { readonly usedTokens: number; readonly maxTokens: number };
	readonly workspace?: ThreadWorkspaceMetadata;
	readonly goal?: OmpGoalSnapshot;
	readonly subagents?: readonly OmpSubagentRow[];
}): string {
	const session = input.session;
	return JSON.stringify([
		session.id, session.projectId, session.title, session.status, session.incarnation,
		session.updatedAt, session.cwd, session.pinned === true, session.archived === true,
		string(session.sidechatSourceThreadId) ?? "",
		// §2.4: a held model/effort change is its own reason to repaint. It is recorded against the
		// task, not against the OMP session row, so the row's timestamps can stand still while it moves.
		session.pendingModel ? JSON.stringify(session.pendingModel) : "",
		// §2.6: the same for the archive receipt - Continue rewrites it (state `restored` plus where
		// it resumed) without the OMP session row moving at all.
		session.archive ? JSON.stringify(session.archive) : "",
		// §2.4/O01: the turn projection moves on OMP's boundaries, not on the session row's stamp, so
		// a queued turn starting is its own reason to repaint.
		session.turns ? JSON.stringify(session.turns) : "",
		input.project ? [input.project.id, input.project.name, input.project.path, input.project.pinned === true, input.project.archived === true, input.project.createdAt] : null,
		input.cursor,
		input.model ?? "",
		input.usage ? [input.usage.usedTokens, input.usage.maxTokens] : null,
		input.workspace ?? null,
		input.goal ?? null,
		input.subagents ? JSON.stringify(input.subagents) : null,
		input.ui,
	]);
}

/** The same idea for the shell: what a shell snapshot is built from, not what it renders. */
function shellSnapshotKey(data: {
	readonly projects: readonly Project[];
	readonly sessions: readonly Session[];
	readonly states: ReadonlyMap<string, TaskState>;
	readonly goals?: ReadonlyMap<string, OmpGoalSnapshot | undefined>;
}): string {
	return JSON.stringify([
		data.projects.map(project => [project.id, project.path, project.name, project.pinned === true, project.archived === true, project.createdAt]),
		data.sessions.map(session => [session.id, session.projectId, session.title, session.status, session.incarnation, session.updatedAt, session.cwd, session.pinned === true, session.archived === true, session.pendingModel ? JSON.stringify(session.pendingModel) : "", session.archive ? JSON.stringify(session.archive) : "", session.turns ? JSON.stringify(session.turns) : ""]),
		[...data.states].map(([id, state]) => [id, state.cursor, state.transcript.length]),
		data.goals ? [...data.goals].map(([id, goal]) => [id, goal ? JSON.stringify(goal) : ""]) : [],
	]);
}

export function projectCediaShellSnapshot(
	projects: readonly Project[],
	sessions: readonly Session[],
	snapshotSequence: number,
	updatedAt: string,
	options: ShellProjectionOptions = {},
): Record<string, unknown> {
	// The host answers `/v1/projects` with archived rows too, because a client that offers "restore"
	// needs them. This window has no such control and the IDE window already hides them
	// (`agents-session-delete-2026-09-16`), so an archived project is removed here rather than
	// listed forever - measured live 2026-09-20: a smoke-test project archived on 2026-09-12 still
	// appeared in the sidebar on every launch, because this projection dropped the flag and the
	// renderer had nothing to filter on.
	const projectRows = projects.filter(project => project.archived !== true).map(project => ({
		id: project.id,
		kind: "project",
		title: project.name,
		workspaceRoot: project.path,
		defaultModelSelection: null,
		scripts: [],
		isPinned: project.pinned === true,
		createdAt: project.createdAt,
		// A project row has one timestamp: the host never updates it, so the sidebar
		// must read `createdAt` rather than invent a second one.
		updatedAt: project.createdAt,
	}));
	const projectMap = new Map(projects.map(project => [project.id, project]));
	const threads = sessions.map(session => shellThreadProjection(threadProjection(session, projectMap.get(session.projectId), initialState(), updatedAt, options.modelBySession), session));
	return { snapshotSequence, spaces: [], projects: projectRows, threads, updatedAt };
}

function unwrapModelResult(value: unknown): unknown {
	const row = record(value);
	return row && "data" in row ? unwrapModelResult(row.data) : value;
}

interface OmpModelRow {
	id: string;
	provider?: string;
	slug: string;
	label: string;
	available: boolean;
	reason?: string;
	upstreamProviderId?: string;
	upstreamProviderName?: string;
	efforts?: string[];
	defaultReasoningEffort?: string;
	contextWindow?: number;
	maxOutputTokens?: number;
}

interface EventCacheEntry {
	readonly incarnation: string;
	readonly cursor: number;
	readonly state: TaskState;
}

function normalizeOmpModels(value: unknown): OmpModelRow[] {
	const data = unwrapModelResult(value);
	const rows = Array.isArray(data) ? data : array(record(data)?.models ?? record(data)?.availableModels ?? record(data)?.available_models);
	const bySlug = new Map<string, OmpModelRow>();
	for (const item of rows) {
		const row = record(item);
		const id = string(row?.id) ?? string(row?.modelId);
		if (!id) continue;
		const provider = string(row?.provider) ?? string(row?.providerId) ?? string(row?.upstreamProviderId);
		const slug = modelSlug({ id, ...(provider ? { provider } : {}) });
		if (bySlug.has(slug)) continue;
		const label = string(row?.label) ?? string(row?.name) ?? slug;
		const thinking = record(row?.thinking) ?? record(row?.reasoning);
		// OMP's live catalog exposes model-specific ladders as `thinking: string[]`.
		// Host responses use supportedReasoningEfforts descriptors; retain either
		// explicit list exactly and never widen a restricted model to a fallback.
		const rawEfforts = Array.isArray(row?.thinking)
			? row.thinking
			: Array.isArray(row?.supportedReasoningEfforts)
				? row.supportedReasoningEfforts
				: Array.isArray(row?.supported_reasoning_efforts)
					? row.supported_reasoning_efforts
					: Array.isArray(thinking?.efforts)
						? thinking.efforts
						: Array.isArray(row?.efforts)
							? row.efforts
							: Array.isArray(row?.reasoningEfforts)
								? row.reasoningEfforts
								: [];
		const efforts = [...new Set(rawEfforts.flatMap(entry => {
			if (typeof entry === "string") return entry.trim() ? [entry.trim()] : [];
			const option = record(entry);
			const value = string(option?.value) ?? string(option?.id);
			return value ? [value] : [];
		}))];
		const defaultReasoningEffort = string(row?.defaultReasoningEffort)
			?? string(row?.defaultEffort)
			?? string(thinking?.defaultEffort)
			?? string(thinking?.default);
		const upstreamProviderId = string(row?.upstreamProviderId) ?? provider;
		const upstreamProviderName = string(row?.upstreamProviderName) ?? string(row?.providerName) ?? provider;
		const reason = string(row?.reason);
		bySlug.set(slug, {
			id,
			...(provider ? { provider } : {}),
			slug,
			label,
			available: row?.available !== false,
			...(reason ? { reason } : {}),
			...(upstreamProviderId ? { upstreamProviderId } : {}),
			...(upstreamProviderName ? { upstreamProviderName } : {}),
			...(efforts.length ? { efforts } : {}),
			...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
			...(typeof row?.contextWindow === "number" && Number.isFinite(row.contextWindow) && row.contextWindow > 0 ? { contextWindow: row.contextWindow } : {}),
			...(typeof row?.maxTokens === "number" && Number.isFinite(row.maxTokens) && row.maxTokens > 0 ? { maxOutputTokens: row.maxTokens } :
				typeof row?.maxOutputTokens === "number" && Number.isFinite(row.maxOutputTokens) && row.maxOutputTokens > 0 ? { maxOutputTokens: row.maxOutputTokens } : {}),
		});
	}
	return [...bySlug.values()];
}

/**
 * A catalog answer's rows.
 *
 * A host answer that carries no list is a host bug, not an empty catalog:
 * collapsing it to `[]` would let the picker claim OMP advertises no models, and
 * would make `setModelIfRequested` report that an advertised model no longer
 * exists. Rows themselves stay loosely typed: OMP's own `get_available_models`
 * envelope is normalized field by field in `normalizeOmpModels`.
 */
function catalogModels(value: unknown): unknown[] {
	const row = record(value);
	if (!row || !Array.isArray(row.models)) throw new Error("Cedia host did not return a model catalog");
	return row.models;
}

function isUnavailableModelCatalog(value: unknown): boolean {
	const row = record(value);
	return row?.state === "unavailable" && typeof row.reason === "string";
}

/** Pure adapter-side catalog projection, shared by provider tests and the native API. */
export function normalizeOmpModelRows(value: unknown): OmpModelRow[] {
	return normalizeOmpModels(value);
}

function modelSelectionFromCommand(value: unknown): ModelSelectionLike | undefined {
	const row = record(value);
	if (row?.provider !== "omp" || typeof row.model !== "string") return undefined;
	return row as unknown as ModelSelectionLike;
}

class CediaAgentAdapter {
	readonly #bridge: RequestBridge;
	readonly #now: () => Date;
	#snapshotSequence = 0;
	#shellSubscriptions = 0;
	readonly #threadSubscriptions = new Set<string>();
	#shellTimer: ReturnType<typeof setInterval> | undefined;
	readonly #threadTimers = new Map<string, ReturnType<typeof setInterval>>();
	readonly #shellListeners = new Set<(event: unknown) => void>();
	readonly #threadListeners = new Set<(event: unknown) => void>();
	readonly #domainListeners = new Set<(event: unknown) => void>();
	readonly #modelBySession = new Map<string, string>();
	/** The last pending-model revision handed to the host for a task. */
	readonly #pendingModelRevision = new Map<string, number>();
	readonly #threadWorkspace = new Map<string, ThreadWorkspaceMetadata>();
	readonly #eventCache = new Map<string, EventCacheEntry>();
	readonly #contextCache = new Map<string, { marker: string; usage: ReturnType<typeof contextUsageFromFrame>; updatedAt: string }>();
	/** What the last emitted shell/thread snapshot was built from, so an unchanged poll stays quiet. */
	#shellKey: string | undefined;
	readonly #threadKeys = new Map<string, string>();
	#shellRefresh: Promise<void> | undefined;
	readonly #threadRefreshes = new Map<string, Promise<void>>();
	#bootstrapEnvironment: Promise<BootstrapEnvironment> | undefined;

	constructor(options: AdapterOptions = {}) {
		this.#bridge = (options.bridge ?? defaultBridge()) as RequestBridge;
		this.#now = options.now ?? (() => new Date());
	}

	dispose(): void {
		if (this.#shellTimer) clearInterval(this.#shellTimer);
		this.#shellTimer = undefined;
		for (const timer of this.#threadTimers.values()) clearInterval(timer);
		this.#threadTimers.clear();
		this.#threadSubscriptions.clear();
		this.#shellSubscriptions = 0;
		this.#shellListeners.clear();
		this.#threadListeners.clear();
		this.#domainListeners.clear();
		this.#eventCache.clear();
		this.#contextCache.clear();
		this.#threadWorkspace.clear();
		this.#shellKey = undefined;
		this.#threadKeys.clear();
		this.#shellRefresh = undefined;
		this.#threadRefreshes.clear();
		this.#bootstrapEnvironment = undefined;
	}

	async bootstrapEnvironment(): Promise<BootstrapEnvironment> {
		if (this.#bootstrapEnvironment) return this.#bootstrapEnvironment;
		const load = (async () => {
			const value = await this.#bridge.invoke(CEDIA_AGENT_CHANNEL, { kind: "bootstrap" } as unknown as AgentRequest);
			const row = record(value);
			const homeDir = string(row?.homeDir);
			const worktreesDir = string(row?.worktreesDir);
			if (!homeDir || !worktreesDir) throw new Error("Cedia bootstrap did not return workspace paths");
			return {
				platform: string(row?.platform) ?? "unknown",
				homeDir,
				worktreesDir,
				version: string(row?.version) ?? "unknown",
			};
		})();
		this.#bootstrapEnvironment = load;
		try {
			return await load;
		} catch (error) {
			if (this.#bootstrapEnvironment === load) this.#bootstrapEnvironment = undefined;
			throw error;
		}
	}

	/**
	 * The host's capability snapshot (CEDIA-PLAN §2.2).
	 *
	 * Read-only and never invented: the answer is whatever the host advertises, and the
	 * consumer (`capabilityGate`) treats an unparsable or absent snapshot as "unknown"
	 * rather than as an empty catalog of working features.
	 */
	async capabilities(): Promise<unknown> {
		return await this.request<unknown>("GET", "/v1/capabilities");
	}

	/** Read the host-owned OMP credit policy without changing the owner's shared setting. */
	async getPolicy(): Promise<unknown> {
		return await this.request<unknown>("GET", "/v1/omp/policy");
	}

	/** Read the runtime's own model, effort, and service-tier state for one session. */
	async getModelState(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/model-state`);
	}

	/** Read the owner-visible provider account identities for one session. */
	async getAccounts(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/accounts`);
	}

	/** Pin one provider account through the host's durable owner command. */
	async pinAccount(sessionId: string, credentialId: number): Promise<unknown> {
		const requestBody = {
			commandId: id(),
			incarnation: (await this.session(sessionId)).incarnation,
			credentialId,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/accounts/pin`, requestBody);
	}

	/** Read the runtime-owned role-to-model mapping for one session. */
	async getModelRoles(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/roles`);
	}

	/** Activate one configured role's model through the host's durable owner command. */
	async applyModelRole(sessionId: string, role: string): Promise<unknown> {
		if (typeof role !== "string" || role.trim().length === 0) throw new Error("Role apply needs a role name");
		const requestBody = {
			commandId: id(),
			incarnation: (await this.session(sessionId)).incarnation,
			role,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/roles/apply`, requestBody);
	}

	/** Assign (or, with null, clear) one role mapping through the host's durable owner command. */
	async setModelRole(sessionId: string, role: string, modelId: string | null): Promise<unknown> {
		if (typeof role !== "string" || role.trim().length === 0) throw new Error("Role set needs a role name");
		if (modelId !== null && (typeof modelId !== "string" || modelId.trim().length === 0)) throw new Error("Role set needs a model id, or null to clear the role");
		const requestBody = {
			commandId: id(),
			incarnation: (await this.session(sessionId)).incarnation,
			role,
			modelId,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/roles/set`, requestBody);
	}

	/** Set or clear one runtime-published service-tier override. */
	async setServiceTier(sessionId: string, family: string, tier: string | null): Promise<unknown> {
		const requestBody = {
			commandId: id(),
			incarnation: (await this.session(sessionId)).incarnation,
			family,
			tier,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/service-tier`, requestBody);
	}

	/** Read the host-owned plan, vibe, and pending review state for one session. */
	async getPlan(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/plan`);
	}

	/** Read OMP's current todo progress for one session. */
	async getProgress(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/progress`);
	}

	/** Read OMP's own steering and follow-up queues for one session. */
	async getQueue(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/queue`);
	}

	/** Remove queued user submissions while preserving the host's typed refusal errors. */
	async dropQueued(sessionId: string, body: CediaQueueDropCommand): Promise<unknown> {
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
			mode: body.mode,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/queue/drop`, requestBody);
	}

	/** Run one shell command through the session's own foreground bash. */
	async execBash(sessionId: string, body: CediaBashExecCommand): Promise<unknown> {
		if (typeof body.command !== "string" || body.command.trim().length === 0) throw new Error("Shell command must be a non-empty string");
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
			command: body.command,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/bash/exec`, requestBody);
	}

	/** Run code one-shot through the session's shared kernel. */
	async execPython(sessionId: string, body: CediaPythonExecCommand): Promise<unknown> {
		if (typeof body.code !== "string" || body.code.trim().length === 0) throw new Error("Python code must be a non-empty string");
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
			code: body.code,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/python/exec`, requestBody);
	}

	/** Ask the session to cancel running Python execution. */
	async abortPython(sessionId: string, body?: CediaPythonAbortCommand): Promise<unknown> {
		const requestBody = {
			commandId: body?.commandId ?? id(),
			incarnation: body?.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/python/abort`, requestBody);
	}

	/** Ask the session to cancel running bash commands. */
	async abortBash(sessionId: string, body?: CediaBashAbortCommand): Promise<unknown> {
		const requestBody = {
			commandId: body?.commandId ?? id(),
			incarnation: body?.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/bash/abort`, requestBody);
	}

	/** Read the process run-pause gate for one session. */
	async getRunPause(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/pause`);
	}

	/** Engage or release the process run-pause gate while preserving the host's typed refusal errors. */
	async setRunPaused(sessionId: string, body: CediaRunPauseCommand): Promise<unknown> {
		if (typeof body.paused !== "boolean") throw new Error("Run pause must be a boolean");
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
			paused: body.paused,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/pause`, requestBody);
	}

	/** Read the runtime-owned context usage and maintenance state for one session. */
	async getContext(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/context`);
	}

	/** Read the runtime-owned checkpoint and rewind facts for one session. */
	async getHistory(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/history`);
	}

	/** Read the runtime-owned session tree and this task's lineage. */
	async getTree(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/tree`);
	}

	/** Read whether the runtime's prewalk handoff is armed. Absence stays absence. */
	async getPrewalk(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/prewalk`);
	}

	/** Read the terminal owner's loop mode for one session. Absence stays absence. */
	async getLoop(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/loop`);
	}

	/** Disable the terminal owner's loop mode while preserving the host's typed refusal errors. */
	async disableLoop(sessionId: string, body?: CediaLoopCommand): Promise<unknown> {
		const requestBody = {
			commandId: body?.commandId ?? id(),
			incarnation: body?.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/loop`, requestBody);
	}

	/** Read the terminal owner side-question state for one session. */
	async getBtw(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/btw`);
	}

	/** Ask an ephemeral side question through the host's durable owner command. */
	async askBtw(sessionId: string, body: CediaBtwAskCommand): Promise<unknown> {
		if (!body || typeof body.question !== "string" || body.question.trim().length === 0) throw new Error("Side question needs a question");
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
			question: body.question,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/btw/ask`, requestBody);
	}

	/** Promote the held side answer into a branched session. */
	async branchBtw(sessionId: string, body?: CediaBtwBranchCommand): Promise<unknown> {
		const requestBody = {
			commandId: body?.commandId ?? id(),
			incarnation: body?.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/btw/branch`, requestBody);
	}

	/** Read the cleanse run state for one session. */
	async getCleanse(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/cleanse`);
	}

	/** Start detection plus one bounded repair batch through the host's durable owner command. */
	async runCleanse(sessionId: string, body: CediaCleanseRunCommand): Promise<unknown> {
		const requestBody: Record<string, unknown> = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		for (const [key, value] of Object.entries({ request: body.request, all: body.all, includeTests: body.includeTests, maxAgents: body.maxAgents, model: body.model })) {
			if (value !== undefined) requestBody[key] = value;
		}
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/cleanse/run`, requestBody);
	}

	/** Cancel the running cleanse batch. */
	async abortCleanse(sessionId: string, body?: CediaCleanseAbortCommand): Promise<unknown> {
		const requestBody = {
			commandId: body?.commandId ?? id(),
			incarnation: body?.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/cleanse/abort`, requestBody);
	}

	/** Read the rule-forging state for one session. */
	async getOmfg(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/omfg`);
	}

	/** Draft a TTSR rule candidate through the host's durable owner command. */
	async draftOmfg(sessionId: string, body: CediaOmfgDraftCommand): Promise<unknown> {
		if (!body || typeof body.complaint !== "string" || body.complaint.trim().length === 0) throw new Error("Rule forging needs a complaint");
		const requestBody: Record<string, unknown> = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
			complaint: body.complaint,
		};
		if (body.feedback !== undefined) requestBody.feedback = body.feedback;
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/omfg/draft`, requestBody);
	}

	/** Save the held rule draft into the named scope. */
	async saveOmfg(sessionId: string, body: CediaOmfgSaveCommand): Promise<unknown> {
		if (!body || (body.scope !== "project" && body.scope !== "global")) throw new Error('Rule save scope must be "project" or "global"');
		const requestBody: Record<string, unknown> = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
			scope: body.scope,
		};
		if (body.overwrite !== undefined) requestBody.overwrite = body.overwrite;
		if (body.allowUnvalidated !== undefined) requestBody.allowUnvalidated = body.allowUnvalidated;
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/omfg/save`, requestBody);
	}

	/** Cancel a running rule draft. */
	async abortOmfg(sessionId: string, body?: CediaOmfgAbortCommand): Promise<unknown> {
		const requestBody = {
			commandId: body?.commandId ?? id(),
			incarnation: body?.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/omfg/abort`, requestBody);
	}

	/** Read the runtime-owned live tool catalog: registry identity, source class and activation. */
	async getToolCatalog(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/tools/catalog`);
	}

	/** Read the runtime-owned extension records plus the live root policy. */
	async getExtensions(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/tools/extensions`);
	}

	/** Read the runtime-owned Code Mode partition: direct names and prelude flags, never sources. */
	async getCodeMode(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/tools/codemode`);
	}

	/** Re-run the runtime-owned skill rediscovery, preserving the durable command envelope. */
	async refreshSkills(sessionId: string): Promise<unknown> {
		const session = await this.session(sessionId);
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/tools/refresh-skills`, {
			commandId: id(),
			incarnation: session.incarnation,
		});
	}

	/** Select the runtime-owned enabled tools, preserving the durable command envelope. */
	async setActiveTools(sessionId: string, toolNames: readonly string[]): Promise<unknown> {
		const session = await this.session(sessionId);
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/tools/active`, {
			commandId: id(),
			incarnation: session.incarnation,
			toolNames: [...toolNames],
		});
	}

	/** Enable or disable one runtime-owned extension, preserving the durable command envelope. */
	async setExtensionEnabled(sessionId: string, extensionId: string, enabled: boolean): Promise<unknown> {
		const session = await this.session(sessionId);
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/tools/extensions/set`, {
			commandId: id(),
			incarnation: session.incarnation,
			id: extensionId,
			enabled,
		});
	}

	/** Navigate the runtime-owned session tree, preserving the durable command envelope. */
	async navigateTree(sessionId: string, entryId: string, summarize?: boolean): Promise<unknown> {
		const session = await this.session(sessionId);
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/tree/navigate`, {
			commandId: id(),
			incarnation: session.incarnation,
			entryId,
			...(summarize === undefined ? {} : { summarize }),
		});
	}

	/** Read the runtime-owned transcript for one session on demand. */
	async getTranscript(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/history/transcript`);
	}

	/** Clear the runtime conversation context in place, preserving the durable session/task. */
	async clearContext(sessionId: string, body: CediaContextCommand = {}): Promise<unknown> {
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/history/clear`, requestBody);
	}

	/** Start a fresh provider session for the same durable task through the runtime boundary. */
	async freshSession(sessionId: string, body: CediaContextCommand = {}): Promise<unknown> {
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/history/fresh`, requestBody);
	}

	/** Read the owner-requested provider usage snapshot for one session. */
	async getUsage(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/usage`);
	}

	/** Read live saved-reset accounts only when the owner asks for them. */
	async getCredits(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/credits`);
	}

	/** Redeem one saved reset after the owner has confirmed the selected account. */
	async redeemCredit(sessionId: string, target: CediaCreditTarget): Promise<unknown> {
		const requestBody = {
			commandId: id(),
			incarnation: (await this.session(sessionId)).incarnation,
			target,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/credits/redeem`, requestBody);
	}

	/** Remove image parts from the stored transcript after the runtime confirms the command. */
	async dropContextImages(sessionId: string, body: CediaContextCommand): Promise<unknown> {
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/context/drop-images`, requestBody);
	}

	/** Reduce stored context with the runtime's selected strategy and preserve its typed answer. */
	async shakeContext(sessionId: string, body: CediaContextShakeCommand): Promise<unknown> {
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
			mode: body.mode,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/context/shake`, requestBody);
	}

	/** Ask the runtime to stop an active compaction and return the state it observed afterward. */
	async abortCompaction(sessionId: string, body: CediaContextCommand): Promise<unknown> {
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/context/abort-compaction`, requestBody);
	}

	/** Read the runtime-owned memory backend and its shape-only session state. */
	async getMemory(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/memory`);
	}

	/** Re-apply the selected memory backend through the runtime-owned operation. */
	async applyMemoryBackend(sessionId: string, body: CediaMemoryCommand): Promise<unknown> {
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/memory/apply`, requestBody);
	}

	/** Read the host/runtime-owned agent roster for one session. */
	async getAgents(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/agents`);
	}

	/** Read one page of a selected agent's child transcript. */
	async getAgentTranscript(sessionId: string, agentId: string, fromByte = 0): Promise<unknown> {
		return await this.request<unknown>(
			"GET",
			`/v1/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/transcript?fromByte=${fromByte}`,
		);
	}

	/** Abort a running agent turn and release its row, preserving the durable command envelope. */
	async killAgent(sessionId: string, agentId: string): Promise<unknown> {
		const session = await this.session(sessionId);
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/agents/kill`, {
			commandId: id(),
			incarnation: session.incarnation,
			id: agentId,
		});
	}

	/** Revive a parked agent through the lifecycle's own restore, preserving the durable command envelope. */
	async reviveAgent(sessionId: string, agentId: string): Promise<unknown> {
		const session = await this.session(sessionId);
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/agents/revive`, {
			commandId: id(),
			incarnation: session.incarnation,
			id: agentId,
		});
	}

	/** List every discovered agent with its effective hub config. */
	async getAgentConfigs(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/agents/config`);
	}

	/** Configure one discovered agent with the hub's persist semantics, preserving the durable command envelope. */
	async configureAgent(sessionId: string, body: CediaAgentConfigInput): Promise<unknown> {
		const session = await this.session(sessionId);
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/agents/config`, {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? session.incarnation,
			agent: body.agent,
			...(body.enabled === undefined ? {} : { enabled: body.enabled }),
			...(body.model === undefined ? {} : { model: body.model }),
			...(body.prewalk === undefined ? {} : { prewalk: body.prewalk }),
			...(body.advisor === undefined ? {} : { advisor: body.advisor }),
		});
	}

	/** Read the host-owned advisor switch, runtime state, and spend for one session. */
	async getAdvisor(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/advisor`);
	}

	/** Apply one host-owned advisor switch operation. */
	async setAdvisor(sessionId: string, body: CediaAdvisorCommand): Promise<unknown> {
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
			op: body.op,
			enabled: body.enabled,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/advisor`, requestBody);
	}

	/** Read the bounded advisor transcript owned by the runtime. */
	async getAdvisorHistory(sessionId: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/advisor/history`);
	}

	/** Read one scope's raw advisor config text without starting a stopped runtime. */
	async getAdvisorConfig(sessionId: string, scope: "project" | "user"): Promise<unknown> {
		if (scope !== "project" && scope !== "user") throw new Error("Advisor config scope must be project or user");
		return await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/advisor/config?scope=${scope}`);
	}

	/** Validate, write and apply one scope's advisor config while preserving the host's typed refusal errors. */
	async setAdvisorConfig(sessionId: string, body: CediaAdvisorConfigCommand): Promise<unknown> {
		if (body.scope !== "project" && body.scope !== "user") throw new Error("Advisor config scope must be project or user");
		if (typeof body.text !== "string") throw new Error("Advisor config text must be a string");
		const requestBody = {
			commandId: body.commandId ?? id(),
			incarnation: body.incarnation ?? (await this.session(sessionId)).incarnation,
			scope: body.scope,
			text: body.text,
		};
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/advisor/config`, requestBody);
	}

	/** Apply one host-owned plan operation. The request body is forwarded unchanged. */
	async setPlan(sessionId: string, body: CediaPlanCommand): Promise<unknown> {
		const requestBody = body.incarnation === undefined
			? { ...body, incarnation: (await this.session(sessionId)).incarnation }
			: body;
		return await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/plan`, requestBody);
	}

	/** The selected remote path's own state (§6.5). Owner-only on the host side. */
	async remoteGatewayState(): Promise<unknown> {
		return await this.request<unknown>("GET", "/v1/remote/gateway");
	}

	/**
	 * Ask the host for one short-lived enrollment code.
	 *
	 * The code is minted by the gateway's own store, is redeemed once, and is never stored by
	 * Cedia: this method returns what the owner has to read out or scan, once.
	 */
	async issueRemoteEnrollment(name: string): Promise<unknown> {
		return await this.request<unknown>("POST", "/v1/remote/enrollment", { name });
	}

	/** Paired controller devices, and the one action that ends a pairing. */
	async listDevices(): Promise<unknown> {
		return await this.request<unknown>("GET", "/v1/devices");
	}

	async revokeDevice(deviceId: string): Promise<unknown> {
		return await this.request<unknown>("POST", `/v1/devices/${encodeURIComponent(deviceId)}/revoke`, {});
	}

	/** OMP's live settings inventory, including Cedia's disposition for every schema path. */
	async getOmpSettingsKeys(): Promise<unknown> {
		return await this.request<unknown>("GET", "/v1/omp/settings/keys");
	}

	/** Read one effective OMP setting. The host owns redaction and layer resolution. */
	async getOmpSettingValue(path: string): Promise<unknown> {
		return await this.request<unknown>("GET", `/v1/omp/settings/value?path=${encodeURIComponent(path)}`);
	}

	/** Write one OMP setting with the revision the row was read at. Host errors propagate unchanged. */
	async setOmpSetting(input: { path: string; value: unknown; expectedRevision?: string }): Promise<unknown> {
		return await this.request<unknown>("PATCH", "/v1/omp/settings", {
			path: input.path,
			value: input.value,
			...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
		});
	}

	async request<T>(method: NonNullable<AgentRequest["method"]>, path: string, body?: unknown): Promise<T> {
		if (!path.startsWith("/v1/") || path.includes("#") || path.includes("\\")) throw new Error("Invalid Cedia host path");
		try {
			return await this.#bridge.invoke(CEDIA_AGENT_CHANNEL, {
				kind: "request",
				method,
				path,
				...(body === undefined ? {} : { body }),
			}) as T;
		} catch (error) {
			// One funnel for every renderer-side application request, so a host error code is
			// restored in the same place it was lost (see host-error-codes.ts).
			throw normalizeCediaHostError(error);
		}
	}

	/**
	 * Item 57: the bundle's keybindings read/write through the extension bridge.
	 * The main process owns `Cedia/User/keybindings.json` (read + validate +
	 * resolve there); this only forwards the op and trusts the resolved rows, so
	 * a binding edited in the agent window lands in the same file the workbench
	 * keybinding service watches — and vice versa.
	 */
	async readKeybindings(): Promise<{ configPath: string; keybindings: unknown[]; issues: unknown[] }> {
		const environment = await this.bootstrapEnvironment();
		const file = keybindingsPath(environment);
		const result = await this.#bridge.invoke(CEDIA_AGENT_CHANNEL, { kind: "keybindings", action: "read", file }) as { configPath?: unknown; keybindings?: unknown; issues?: unknown };
		return {
			configPath: typeof result?.configPath === "string" ? result.configPath : file,
			keybindings: Array.isArray(result?.keybindings) ? result.keybindings : [],
			issues: Array.isArray(result?.issues) ? result.issues : [],
		};
	}

	async writeKeybinding(input: { rule: unknown; replacing?: unknown }): Promise<{ keybindings: unknown[]; issues: unknown[] }> {
		const environment = await this.bootstrapEnvironment();
		const result = await this.#bridge.invoke(CEDIA_AGENT_CHANNEL, {
			kind: "keybindings",
			action: "write",
			file: keybindingsPath(environment),
			rule: input.rule,
			...(input.replacing === undefined ? {} : { replacing: input.replacing }),
		}) as { keybindings?: unknown; issues?: unknown };
		return {
			keybindings: Array.isArray(result?.keybindings) ? result.keybindings : [],
			issues: Array.isArray(result?.issues) ? result.issues : [],
		};
	}

	async voiceAvailable(): Promise<boolean> {
		try {
			const value = record(await this.request<unknown>("GET", "/v1/voice"));
			return value?.available === true;
		} catch {
			return false;
		}
	}

	async projects(): Promise<Project[]> {
		return asProjects(await this.request("GET", "/v1/projects"));
	}

	async sessions(projectId?: string): Promise<Session[]> {
		const query = projectId === undefined ? "" : `?projectId=${encodeURIComponent(projectId)}`;
		return asSessions(await this.request("GET", `/v1/sessions${query}`));
	}

	/** Re-probe known owners, then ask the host to adopt the selected task owner. */
	async attachOwner(sessionId: string): Promise<Session> {
		// The listing endpoint performs the same bounded owner probe used by the picker immediately
		// before the action. The start route remains the final authenticated lease/identity gate.
		await this.request<unknown>("GET", "/v1/owners");
		const value = await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/start`);
		const started = asSessions([value])[0];
		if (!started) throw new Error(`Cedia did not return a started session for '${sessionId}'`);
		this.#eventCache.delete(sessionId);
		return started;
	}

	/**
	 * Fold composer attachments/mentions/skills into the outgoing prompt the way the
	 * native path proved it (§10 item 61): image bytes travel in OMP's own `images[]`
	 * and every other reference is named in a labelled attached-context block. OMP's
	 * agent reads referenced files itself, so paths stay references — nothing is
	 * uploaded anywhere (§10 item 60).
	 */
	async turnTextWithAttachments(
		threadId: string,
		message: Record<string, unknown>,
	): Promise<{ message: string; images: Array<{ type: "image"; data: string; mimeType: string }> }> {
		const text = string(message.text) ?? "";
		const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
		const labels: string[] = [];
		// Mirrors the native `attachedContextLabels`: name every non-image reference,
		// deduplicated, so a chip can never be dropped silently.
		const pushLabel = (label: string | undefined): void => {
			if (!label || labels.includes(label)) return;
			labels.push(label);
		};
		for (const item of array(message.attachments)) {
			const attachment = record(item);
			if (!attachment) continue;
			const kind = string(attachment.type);
			if (kind === "image") {
				const imageId = string(attachment.id);
				const file = imageId ? await composerImageFile(threadId, imageId) : null;
				if (!file) {
					throw new Error(`Cedia could not read the bytes for attached image '${string(attachment.name) ?? imageId ?? "image"}'`);
				}
				images.push({ type: "image", data: await fileToBase64(file), mimeType: string(attachment.mimeType) ?? "image/png" });
				continue;
			}
			if (kind === "file") pushLabel(string(attachment.name));
			else if (kind === "assistant-selection") pushLabel(string(attachment.text));
		}
		for (const item of array(message.mentions)) {
			const mention = record(item);
			if (!mention) continue;
			pushLabel(string(mention.path) ?? string(mention.name));
		}
		for (const item of array(message.skills)) {
			const skill = record(item);
			const name = skill ? string(skill.name) : undefined;
			// The composer's slash lane already puts `/name` in the text when it was
			// completed there; only name a skill chip that left no text behind.
			if (name && !text.includes(name)) pushLabel(`Skill: ${name}`);
		}
		return {
			message: labels.length > 0 ? promptWithAttachedContext(text, labels) : text,
			images,
		};
	}

	/** OMP's live slash/skill catalogue for a task's session; best-effort empty when there is no session to ask. */
	async availableSlashCommands(threadId: string | undefined): Promise<unknown[]> {
		if (!threadId) return [];
		try {
			const session = await this.session(threadId);
			const command = await this.sendCommand(session, id(), "get_available_commands");
			return array(record(record(command.result)?.data)?.commands);
		} catch {
			// Discovery is best-effort: a draft, absent or starting session reports no
			// extra commands rather than breaking the composer menu.
			return [];
		}
	}

	async session(sessionId: string): Promise<Session> {
		const value = await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}`);
		const rows = asSessions([value]);
		if (!rows[0]) throw new Error(`Cedia session '${sessionId}' is unavailable`);
		return rows[0];
	}

	async events(session: Session): Promise<{ state: TaskState; cursor: number }> {
		const cached = this.#eventCache.get(session.id);
		let state = cached?.incarnation === session.incarnation ? cached.state : initialState();
		let cursor = cached?.incarnation === session.incarnation ? cached.cursor : 0;
		for (;;) {
			const page = await this.request<EventPage>("GET", `/v1/sessions/${encodeURIComponent(session.id)}/events?after=${cursor}&limit=500`);
			const pageEvents = await Promise.all(page.events.map(event => this.hydrateEvent(session.id, event)));
			state = reduceEvents(state, pageEvents);
			cursor = page.cursor;
			this.#eventCache.set(session.id, { incarnation: session.incarnation, cursor, state });
			if (!page.hasMore) return { state, cursor };
		}
	}

	async ui(session: Session): Promise<unknown[]> {
		const value = await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(session.id)}/ui`);
		const row = record(value);
		return array(row?.requests ?? value);
	}

	/** Read a task's goal only when its event journal has not supplied one. */
	async goalFromHost(sessionId: string): Promise<OmpGoalSnapshot | undefined> {
		try {
			return parseHostGoalSnapshot(await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/goal`));
		} catch {
			// A stopped or older runtime has no goal surface. The projection stays empty rather
			// than presenting a local draft as if OMP accepted it.
			return undefined;
		}
	}

	/**
	 * Project the host's goal snapshot to the budget and usage details a surface may draw.
	 * No token, objective edit or second command is involved: this is the read half of the
	 * goal's budget controls, and an absent goal reads as unavailable rather than as zeroes.
	 */
	async getGoalDetails(sessionId: string): Promise<unknown> {
		const snapshot = await this.goalFromHost(sessionId);
		const goal = visibleGoal(snapshot);
		if (!goal) return { available: false as const, reason: "This task has no active goal." };
		return {
			available: true as const,
			status: goal.status,
			tokenBudget: goal.tokenBudget ?? null,
			tokensUsed: goal.tokensUsed,
			timeUsedSeconds: goal.timeUsedSeconds,
		};
	}

	/** Read the host's live subagent cache without starting a stopped runtime. */
	async subagentsFromHost(sessionId: string): Promise<OmpSubagentRow[] | undefined> {
		try {
			return parseHostSubagents(await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}/subagents`));
		} catch {
			return undefined;
		}
	}

	async hydrateEvent(sessionId: string, event: SessionEvent): Promise<SessionEvent> {
		const reference = frameReference(event.frame);
		if (!reference) return event;
		let text = "";
		while (text.length < reference.length) {
			const chunk = await this.request<{ offset: number; length: number; sha256: string; text: string }>(
				"GET",
				`/v1/sessions/${encodeURIComponent(sessionId)}/events/${reference.sequence}/frame?offset=${text.length}`,
			);
			if (chunk.offset !== text.length || chunk.length !== reference.length || chunk.sha256 !== reference.sha256 || typeof chunk.text !== "string" || chunk.text.length === 0 || chunk.text.length > 24_000) throw new Error("Invalid event reference chunk");
			text += chunk.text;
		}
		if (text.length !== reference.length || await sha256Hex(text) !== reference.sha256) throw new Error("Cedia event reference integrity failure");
		return { ...event, frame: JSON.parse(text) };
	}

	async readShellData(hydrateTranscripts: boolean): Promise<{ projects: Project[]; sessions: Session[]; states: Map<string, TaskState> }> {
		// An archived project is a removed one: its tasks leave the list with it, so the sidebar
		// cannot show orphan groups. A task opened directly still renders through `threadSnapshot`.
		const projects = (await this.projects()).filter(project => project.archived !== true);
		const sessionBatches = await Promise.all(projects.map(project => this.sessions(project.id)));
		const sessions = sessionBatches.flat();
		const states = new Map<string, TaskState>();
		await Promise.all(sessions.map(async session => {
			try {
				// A shell snapshot must not replay every historical transcript before the
				// sidebar can mount. Detail subscriptions hydrate only the opened tasks.
				const cached = this.#eventCache.get(session.id);
				const state = hydrateTranscripts
					? (await this.events(session)).state
					: cached?.incarnation === session.incarnation ? cached.state : initialState();
				states.set(session.id, state);
				const current = latestModel(state, session);
				if (current?.id) this.#modelBySession.set(session.id, modelSlug(current));
			} catch {
				states.set(session.id, initialState());
			}
		}));
		return { projects, sessions, states };
	}

	async shellSnapshot(full: boolean): Promise<Record<string, unknown>> {
		const data = await this.readShellData(full);
		const goals = new Map<string, OmpGoalSnapshot | undefined>();
		await Promise.all(data.sessions.map(async session => {
			// A streamed goal update is authoritative for the reduced transcript. Only ask the host
			// projection when this shell read has not seen one yet (for example, a stopped task or a
			// lightweight sidebar hydration).
			goals.set(session.id, latestGoalSnapshot(data.states.get(session.id) ?? initialState()) ?? await this.goalFromHost(session.id));
		}));
		this.#shellKey = shellSnapshotKey({ ...data, goals });
		this.#snapshotSequence += 1;
		const now = iso(this.#now);
		const projectRows = data.projects.map(project => ({
			id: project.id,
			kind: "project",
			title: project.name,
			workspaceRoot: project.path,
			defaultModelSelection: null,
			scripts: [],
			isPinned: project.pinned === true,
			createdAt: project.createdAt,
			updatedAt: project.createdAt,
			...(full ? { deletedAt: null } : {}),
		}));
		const projectMap = new Map(data.projects.map(project => [project.id, project]));
		const threads = data.sessions.map(session => {
			const state = data.states.get(session.id) ?? initialState();
			const thread = threadProjection(session, projectMap.get(session.projectId), state, now, this.#modelBySession, undefined, undefined, goals.get(session.id));
			return full ? thread : shellThreadProjection(thread, session);
		});
		return { snapshotSequence: this.#snapshotSequence, spaces: [], projects: projectRows, threads, updatedAt: now };
	}

	async threadSnapshot(threadId: string): Promise<Record<string, unknown>> {
		const session = await this.session(threadId);
		const projects = await this.projects();
		const { state, cursor } = await this.events(session);
		let ui: unknown[] = [];
		try { ui = await this.ui(session); } catch { /* unavailable while the session is stopped */ }
		const goalSnapshot = latestGoalSnapshot(state) ?? await this.goalFromHost(session.id);
		const subagents = await this.subagentsFromHost(session.id);
		const model = latestModel(state, session);
		if (model?.id) this.#modelBySession.set(session.id, modelSlug(model));
		this.#snapshotSequence += 1;
		const project = projects.find(candidate => candidate.id === session.projectId);
		const workspace = this.#threadWorkspace.get(threadId);
		const thread = threadProjection(session, project, state, iso(this.#now), this.#modelBySession, ui, workspace, goalSnapshot, subagents);
		// Read occupancy after completed messages/compaction, never sum lifetime token usage.
		// The marker excludes our own get_state response, avoiding a polling feedback loop.
		const contextFrames = state.transcript.flatMap(entry => entry.rawFrames).filter(frame =>
			["cedia_session", "message_end", "agent_end", "auto_compaction_end"].includes(String(frame.type)));
		const marker = `${session.incarnation}:${contextFrames.length}:${model?.provider ?? ""}:${model?.id ?? ""}`;
		let context = this.#contextCache.get(threadId);
		// A live confirmation is time-bounded and must reach the window immediately.
		// `get_state` can wait behind the active OMP turn, so do not hold the entire
		// thread snapshot (including its pending approval card) on context accounting.
		if (ui.length === 0 && context?.marker !== marker && contextFrames.length && session.status !== "stopped" && session.status !== "recovery_required") {
			try {
				const response = await this.sendCommand(session, id(), "get_state");
				context = { marker, usage: contextUsageFromFrame(response), updatedAt: iso(this.#now) };
				this.#contextCache.set(threadId, context);
			} catch { /* A stopped runtime must not prevent reading its transcript. */ }
		}
		const usage = context ? context.usage : [...contextFrames].reverse().map(contextUsageFromFrame).find(Boolean);
		this.#threadKeys.set(threadId, threadSnapshotKey({
			session, project, cursor, ui, model: model ? modelSlug(model) : undefined,
			...(usage ? { usage } : {}),
			...(workspace ? { workspace } : {}),
			...(goalSnapshot ? { goal: goalSnapshot } : {}),
			...(subagents ? { subagents } : {}),
		}));
		if (usage) (thread.activities as unknown[]).push({
			id: `context-${threadId}`, kind: "context-window.updated", tone: "info",
			summary: "Context window usage", payload: usage, turnId: null,
			sequence: state.transcript.length + 1, createdAt: context?.updatedAt ?? iso(this.#now),
		});
		return { snapshotSequence: this.#snapshotSequence, thread };
	}

	emitShell(snapshot: Record<string, unknown>): void {
		const item = { kind: "snapshot", snapshot };
		for (const listener of this.#shellListeners) listener(item);
	}

	emitThread(snapshot: Record<string, unknown>): void {
		const item = { kind: "snapshot", snapshot };
		for (const listener of this.#threadListeners) listener(item);
	}

	async refreshShell(): Promise<void> {
		if (this.#shellRefresh) return this.#shellRefresh;
		const refresh = (async () => {
			const emitted = this.#shellKey;
			const snapshot = await this.shellSnapshot(false);
			// A poll that found nothing new must not repaint the window. `shellSnapshot` records what
			// this read was built from, so an identical key means the listener already has it.
			if (emitted !== undefined && this.#shellKey === emitted) return;
			this.emitShell(snapshot);
		})();
		this.#shellRefresh = refresh;
		try { await refresh; } finally { if (this.#shellRefresh === refresh) this.#shellRefresh = undefined; }
	}

	async refreshThread(threadId: string): Promise<void> {
		const prior = this.#threadRefreshes.get(threadId);
		if (prior) return prior;
		const refresh = (async () => {
			const emitted = this.#threadKeys.get(threadId);
			const snapshot = await this.threadSnapshot(threadId);
			if (emitted !== undefined && this.#threadKeys.get(threadId) === emitted) return;
			this.emitThread(snapshot);
		})();
		this.#threadRefreshes.set(threadId, refresh);
		try { await refresh; } finally { if (this.#threadRefreshes.get(threadId) === refresh) this.#threadRefreshes.delete(threadId); }
	}

	async sendGoalCommand(session: Session, request: { readonly op: "set" | "replace" | "pause" | "resume" | "drop" | "complete" | "budget"; readonly objective?: string; readonly tokenBudget?: number }): Promise<Command> {
		const result = await this.request<Command>("POST", `/v1/sessions/${encodeURIComponent(session.id)}/goal`, {
			commandId: id(),
			incarnation: session.incarnation,
			...request,
		});
		if (result.status === "failed" || result.status === "outcome_unknown" || result.status === "not_dispatched") throw new Error(result.error ?? "OMP did not accept the goal operation");
		return result;
	}

	async updateGoalFromMetadata(threadId: string, objective: string): Promise<void> {
		const session = await this.session(threadId);
		if (objective.trim().length === 0) {
			await this.sendGoalCommand(session, { op: "drop" });
			return;
		}
		const current = await this.goalFromHost(threadId);
		const existing = visibleGoal(current);
		await this.sendGoalCommand(session, { op: existing ? "replace" : "set", objective: objective.trim() });
	}

	async updateGoalPausedFromMetadata(threadId: string, paused: boolean): Promise<void> {
		const session = await this.session(threadId);
		await this.sendGoalCommand(session, { op: paused ? "pause" : "resume" });
	}

	async updateGoalBudgetFromMetadata(threadId: string, tokenBudget: number): Promise<void> {
		if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) throw new Error("A goal token budget must be a positive integer");
		const session = await this.session(threadId);
		await this.sendGoalCommand(session, { op: "budget", tokenBudget });
	}

	/**
	 * Ask the shared draft owner for the command bound to this task's current revision
	 * (CEDIA §2.5). The composer keeps its own register; this identity is what makes two
	 * windows sending the same revision produce one turn instead of two.
	 */
	async reserveDraftSubmission(threadId: string, commandId: string, message: string): Promise<DraftReservation> {
		try {
			const answer = await this.#bridge.invoke(CEDIA_AGENT_CHANNEL, {
				kind: "uiDraft",
				threadId,
				action: "reserve",
				commandId,
				text: message,
			} as unknown as AgentRequest) as DraftReservation;
			return answer && typeof answer === "object" && "status" in answer ? answer : { status: "none" };
		} catch {
			// Bookkeeping must never be what blocks a send: an unavailable draft owner means this
			// turn carries its own command id, exactly as it did before the draft owner existed.
			return { status: "none" };
		}
	}

	/** Drop the delivered draft, and only while its revision still matches (§2.5 item 3). */
	async releaseDraftSubmission(threadId: string, revision: number): Promise<void> {
		try {
			await this.#bridge.invoke(CEDIA_AGENT_CHANNEL, { kind: "uiDraft", threadId, action: "clear", revision } as unknown as AgentRequest);
		} catch (error) {
			console.warn("Cedia could not release a delivered composer draft.", error);
			// A newer edit, or a host that already moved on, leaves the draft where it is.
		}
	}

	async sendCommand(session: Session, commandId: string, command: string, payload?: Record<string, unknown>): Promise<Command> {
		return await this.request<Command>("POST", `/v1/sessions/${encodeURIComponent(session.id)}/commands`, {
			commandId,
			incarnation: session.incarnation,
			command,
			...(payload && Object.keys(payload).length ? { payload } : {}),
		});
	}

	/** The session's own rewind points, in order: OMP's `get_branch_messages` answers `{entryId, text}`. */
	async userMessageEntries(session: Session): Promise<Array<{ entryId: string; text: string }>> {
		const command = await this.sendCommand(session, id(), "get_branch_messages");
		const rows = array(record(record(command.result)?.data)?.messages);
		return rows.flatMap(row => {
			const entryId = string(record(row)?.entryId);
			return entryId ? [{ entryId, text: string(record(row)?.text) ?? "" }] : [];
		});
	}

	/**
	 * Replace this window's transcript with OMP's own for the session's current branch.
	 *
	 * Cedia's transcript is a projection of an append-only event journal while OMP's session is a
	 * tree, so after a rewind the journal still holds the abandoned tail: replaying it would show
	 * exactly the messages the user rewound past. OMP's `get_messages` answers with the messages of
	 * the current leaf and the shared reducer already reads that response shape, so the journal
	 * cursor stays where it is and only the transcript is swapped.
	 */
	async resyncTranscript(session: Session): Promise<void> {
		const command = await this.sendCommand(session, id(), "get_messages");
		const messages = array(record(record(command.result)?.data)?.messages);
		const { state, cursor } = await this.events(session);
		const rebuilt = applyFrame(
			createInitialTaskState(),
			{ type: "response", command: "get_messages", success: true, data: { messages } } as unknown as Json,
			undefined,
			{ sessionId: session.id, incarnation: session.incarnation },
		);
		this.#eventCache.set(session.id, { incarnation: session.incarnation, cursor, state: { ...state, transcript: rebuilt.transcript } });
	}

	/**
	 * Resolve one of this task's own user messages to the rewind point OMP offers for it.
	 *
	 * `get_branch_messages` lists the session's user messages in order, and this transcript's user
	 * rows are indexed into that list. The two only describe the same conversation while they hold
	 * the same messages: OMP omits user messages whose extracted text is empty, a steer or
	 * follow-up adds a user row without adding a turn, and Cedia's journal is append-only while
	 * OMP's session is a tree. Counting is what makes a tail rewind exact, so it stays the rule
	 * while the lists agree; when they do not, the message's own text corroborates the point and a
	 * disagreement refuses. Branching at a message the user did not name would silently rewrite
	 * their task, which is worse than refusing.
	 */
	async rewindPoint(session: Session, messageId: string): Promise<{ entryId: string; text: string }> {
		const { state } = await this.events(session);
		const userRows = state.transcript.filter(entry => entry.kind === "message" && entry.role === "user");
		const index = userRows.findIndex(entry => entry.id === messageId);
		const row = index < 0 ? undefined : userRows[index];
		if (!row) throw new Error("Cedia could not find that message in this task's transcript");
		const entries = await this.userMessageEntries(session);
		const ordinal = entries[index];
		if (ordinal && entries.length === userRows.length) return ordinal;
		// Both sides of the comparison are the text of the message this task sent, so the stored
		// and the visible string differing (the composer rewrites what it sends) does not matter.
		const wanted = row.text.trim();
		const matches = wanted.length > 0 ? entries.filter(entry => entry.text === wanted) : [];
		const match = matches.length === 1 ? matches[0] : undefined;
		if (!match) throw new Error(`Cedia will not rewind: OMP lists ${entries.length} rewind points for this task while its transcript has ${userRows.length} user messages, and that message's text does not single one out. Reopen the task before rewinding.`);
		return match;
	}

	/**
	 * Edit an earlier message and replay the turn from there, on OMP's own rewind.
	 *
	 * OMP rewinds by branching (`session.branch(entryId)`): the conversation is cut at that user
	 * message, the abandoned path stays in the session tree, and the original text comes back so it
	 * can be resubmitted. That is the whole of what the harness offers - it does not restore files -
	 * and this is the same operation its own `/rewind` selector performs.
	 */
	async applyEditAndResend(row: Record<string, unknown>): Promise<void> {
		const threadId = string(row.threadId);
		const messageId = string(row.messageId);
		const text = string(row.text);
		if (!threadId || !messageId || !text) throw new Error("Editing a message needs a task, the message and its text");
		let session = await this.session(threadId);
		if (session.status === "running") throw new Error("Interrupt the current turn before editing an earlier message.");
		const point = await this.rewindPoint(session, messageId);
		const branch = await this.sendCommand(session, id(), "branch", { entryId: point.entryId });
		if (branch.status === "failed" || branch.status === "outcome_unknown" || branch.status === "not_dispatched") throw new Error(branch.error ?? "OMP did not rewind this task");
		if (record(record(branch.result)?.data)?.cancelled === true) throw new Error("OMP cancelled the rewind");
		// The branch may point the session at another file, so re-read it before speaking again.
		session = await this.session(threadId);
		await this.resyncTranscript(session);
		const selection = modelSelectionFromCommand(row.modelSelection);
		// The model picked with a send applies to that send: this is not a deferred change.
		if (selection) await this.setModelIfRequested(session, selection, { forSubmission: true });
		await this.sendCommand(session, string(row.commandId) ?? id(), "prompt", { message: text });
	}

	/**
	 * Rewind the task to one of its own user messages, without sending anything again.
	 *
	 * This is `applyEditAndResend`'s branch step on its own: the same OMP rewind, but the text
	 * `branch` hands back goes into the composer instead of a new turn, so the user can change it
	 * or leave it. The command carries `numTurns` - the client's own statement of how many turns it
	 * discards - while the rewind point is addressed by message id, because an ordinal cannot
	 * survive the list skews `rewindPoint` guards against.
	 */
	async rewindToMessage(row: Record<string, unknown>): Promise<void> {
		const threadId = string(row.threadId);
		const messageId = string(row.messageId);
		if (!threadId || !messageId) throw new Error("Rewinding needs the task and the message to rewind to");
		let session = await this.session(threadId);
		if (session.status === "running") throw new Error("Interrupt the current turn before rewinding to an earlier message.");
		const point = await this.rewindPoint(session, messageId);
		const branch = await this.sendCommand(session, id(), "branch", { entryId: point.entryId });
		if (branch.status === "failed" || branch.status === "outcome_unknown" || branch.status === "not_dispatched") throw new Error(branch.error ?? "OMP did not rewind this task");
		if (record(record(branch.result)?.data)?.cancelled === true) throw new Error("OMP cancelled the rewind");
		// The branch may point the session at another file, so re-read it before speaking again.
		session = await this.session(threadId);
		await this.resyncTranscript(session);
		// OMP returns the rewound message for editor pre-fill, and its own TUI puts it in the
		// draft - never in a new turn. `get_branch_messages` reported that same message's text, so
		// it backs the write when a host's `branch` answer omits it.
		const thread = ThreadId.makeUnsafe(threadId);
		const rewound = string(record(record(branch.result)?.data)?.text) ?? point.text;
		useComposerDraftStore.getState().setPrompt(thread, rewound);
		requestComposerFocus(thread);
	}

	async ensureStarted(session: Session): Promise<Session> {
		if (session.status === "recovery_required") throw new Error("OMP session requires reconciliation before sending a turn");
		if (session.status === "running") return session;
		const value = await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(session.id)}/start`);
		const started = asSessions([value])[0];
		if (!started) throw new Error(`Cedia did not return a started session for '${session.id}'`);
		this.#eventCache.delete(session.id);
		return started;
	}

	async setModelIfRequested(session: Session, selection: ModelSelectionLike | undefined, options: { forSubmission?: boolean } = {}): Promise<void> {
		if (!selection || selection.model === OMP_UNRESOLVED_MODEL) return;
		// A running task's owner catalog is authoritative for selection: extensions/providers may
		// add or remove rows after the sessionless metadata worker last ran. An unstarted task gets
		// the explicit absence marker and may safely fall back to the global discovery route.
		const sessionCatalog = await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(session.id)}/models`);
		const catalog = isUnavailableModelCatalog(sessionCatalog)
			? await this.request<unknown>("GET", "/v1/models")
			: sessionCatalog;
		const rows = normalizeOmpModels(catalogModels(catalog));
		const exact = rows.filter(row => row.slug === selection.model);
		const bare = rows.filter(row => row.id === selection.model);
		const matches = exact.length > 0 ? exact : bare;
		const match = matches.length === 1 ? matches[0] : matches.find(row => row.provider === selection.ompProvider);
		if (!match) throw new Error(`OMP no longer advertises model '${selection.model}'`);
		if (!match.provider) throw new Error(`OMP did not identify the provider for model '${selection.model}'`);
		const requestedEffort = selection.reasoningEffort ?? selection.options?.thinkingLevel;
		if (requestedEffort && match.efforts && match.efforts.length > 0 && !match.efforts.includes(requestedEffort)) {
			throw new Error(`OMP does not advertise reasoning effort '${requestedEffort}' for '${match.id}'`);
		}
		// §2.4: while a turn is running, the change is handed to OMP as a revision and committed
		// at OMP's own turn boundary, so the running turn keeps the model it started with. The
		// host decides what that runtime can honour and records what actually happened. An idle
		// task still applies the change immediately, because there is no next turn to defer to.
		// A turn is in flight only when the host's own turn projection says one is running: a task
		// that is merely started reports `status: running` too, and a model picked for the turn the
		// user is about to send must apply to that turn, not to the one after it.
		const turnInFlight = options.forSubmission === true
			? false
			: session.turns === undefined
				? session.status === "running"
				: session.turns.some(turn => turn.state === "running");
		if (turnInFlight) {
			const applied = await this.request<{ state?: string; applied?: { model?: string; via?: string } }>("POST", `/v1/sessions/${encodeURIComponent(session.id)}/pending-model`, {
				revision: this.#nextPendingModelRevision(session.id),
				provider: match.provider,
				modelId: match.id,
				...(requestedEffort ? { thinkingLevel: requestedEffort } : {}),
			});
			// Only a change OMP reports as in effect may be shown as the task's model.
			if (applied?.state === "in-effect" && applied.applied?.model) this.#modelBySession.set(session.id, applied.applied.model);
			return;
		}
		const result = await this.sendCommand(session, id(), "set_model", { provider: match.provider, modelId: match.id });
		if (result.status === "failed" || result.status === "outcome_unknown" || result.status === "not_dispatched") throw new Error(result.error ?? "OMP rejected the model change");
		this.#modelBySession.set(session.id, match.slug);
		if (requestedEffort) {
			const effort = await this.sendCommand(session, id(), "set_thinking_level", { level: requestedEffort });
			if (effort.status === "failed" || effort.status === "outcome_unknown" || effort.status === "not_dispatched") throw new Error(effort.error ?? "OMP rejected the reasoning effort");
		}
	}

	/**
	 * The revision a task's next pending model change carries.
	 *
	 * Monotonic per task and independent of the wall clock, so two windows changing the same
	 * task's model cannot produce the same revision for different requests - OMP echoes the
	 * revision back, and that echo is what tells the host which change was committed.
	 */
	#nextPendingModelRevision(sessionId: string): number {
		const next = (this.#pendingModelRevision.get(sessionId) ?? 0) + 1;
		this.#pendingModelRevision.set(sessionId, next);
		return next;
	}

	async dispatch(command: unknown): Promise<{ sequence: number }> {
		const row = record(command);
		const type = string(row?.type);
		if (!row || !type) unsupported("an invalid orchestration command");
		const now = iso(this.#now);
		if (type === "project.create") {
			const projectId = string(row.projectId);
			const workspaceRoot = string(row.workspaceRoot);
			if (!projectId || !workspaceRoot) throw new Error("Project creation requires a workspace root");
			await this.request("POST", "/v1/projects", { id: projectId, path: workspaceRoot, ...(string(row.title) ? { name: string(row.title) } : {}) });
		} else if (type === "project.meta.update") {
			const projectId = string(row.projectId);
			if (!projectId) throw new Error("Project id is required");
			const patch: Record<string, unknown> = {};
			if (string(row.title)) patch.name = string(row.title);
			if (typeof row.isPinned === "boolean") patch.pinned = row.isPinned;
			if (typeof row.archived === "boolean") patch.archived = row.archived;
			if (string(row.workspaceRoot)) throw new Error("Cedia cannot move a project workspace");
			await this.request("PATCH", `/v1/projects/${encodeURIComponent(projectId)}`, patch);
		} else if (type === "project.delete") {
			const projectId = string(row.projectId);
			if (!projectId) throw new Error("Project id is required");
			await this.request("PATCH", `/v1/projects/${encodeURIComponent(projectId)}`, { archived: true });
		} else if (type === "thread.fork.create") {
			const sourceId = string(row.sourceThreadId);
			const threadId = string(row.threadId);
			if (!sourceId || !threadId) throw new Error("Side chat requires a source task and a new task id");
			// OMP forks its durable session. UI importedMessages are never an
			// alternative execution history or a synthetic prompt.
			await this.request("POST", `/v1/sessions/${encodeURIComponent(sourceId)}/fork`, {
				id: threadId,
				...(string(row.title) ? { title: string(row.title) } : {}),
			});
		} else if (type === "thread.create") {
			const projectId = string(row.projectId);
			if (!projectId) throw new Error("Thread creation requires a project");
			await this.request("POST", "/v1/sessions", {
				id: string(row.threadId),
				projectId,
				...(string(row.title) ? { title: string(row.title) } : {}),
				workspaceMode: row.envMode === "worktree" ? "worktree" : "local",
				// A base revision is only meaningful for an isolated worktree, and the host
				// resolves it to a commit before creating anything (§3.C).
				...(row.envMode === "worktree" && string(row.baseRef) ? { baseRef: string(row.baseRef) } : {}),
				// A dirty-file selection likewise only applies to a worktree creation: the
				// host carries exactly those paths and refuses a malformed list before
				// creating anything, so the adapter forwards the selection verbatim and
				// lets the host refusal (with its per-path outcome) surface.
				...(row.envMode === "worktree" && row.dirtyFiles !== undefined ? { dirtyFiles: row.dirtyFiles } : {}),
			});
		} else if (["thread.meta.update", "thread.archive", "thread.unarchive"].includes(type)) {
			const threadId = string(row.threadId);
			if (!threadId) throw new Error("Thread id is required");
			const patch: Record<string, unknown> = {};
			if (type === "thread.archive") patch.archived = true;
			else if (type === "thread.unarchive") patch.archived = false;
			else {
				if (string(row.title)) patch.title = string(row.title);
				if (typeof row.isPinned === "boolean") patch.pinned = row.isPinned;
				if (Object.hasOwn(row, "goal")) {
					if (typeof row.goal !== "string") throw new Error("A thread goal must be text");
					await this.updateGoalFromMetadata(threadId, row.goal);
				}
				if (Object.hasOwn(row, "goalPaused")) {
					if (typeof row.goalPaused !== "boolean") throw new Error("A thread goal pause state must be boolean");
					await this.updateGoalPausedFromMetadata(threadId, row.goalPaused);
				}
				// The workspace fields are the thread's own metadata, not the host's: they describe
				// which checkout this thread is pointed at. Cedia keeps them for the window's
				// lifetime and projects them back (see `ThreadWorkspaceMetadata`), which is what
				// settles the branch toolbar instead of leaving it to re-ask forever.
				const workspace = threadWorkspacePatch(row);
				if (workspace) this.#threadWorkspace.set(threadId, { ...this.#threadWorkspace.get(threadId), ...workspace });
				if (row.modelSelection !== undefined) {
					const selection = modelSelectionFromCommand(row.modelSelection);
					if (!selection) throw new Error("A valid OMP model selection is required");
					const session = await this.ensureStarted(await this.session(threadId));
					await this.setModelIfRequested(session, selection);
				}
			}
			// An empty patch is not a no-op on the host: `updateSession` stamps `updated_at` for any
			// call, and the snapshot poll reads that stamp as a change. A command that only carried
			// thread metadata must not move the session row.
			if (Object.keys(patch).length > 0) await this.request("PATCH", `/v1/sessions/${encodeURIComponent(threadId)}`, patch);
		} else if (type === "thread.delete") {
			const threadId = string(row.threadId);
			if (!threadId) throw new Error("Thread id is required");
			await this.request("DELETE", `/v1/sessions/${encodeURIComponent(threadId)}`);
		} else if (type === "thread.turn.start") {
			const threadId = string(row.threadId);
			const message = record(row.message);
			if (!threadId || !message || typeof message.text !== "string") throw new Error("Turn requires a thread and message");
			// Cedia §10 item 61: attachments/mentions/skills fold into the prompt the way
			// the native path proved it — image bytes into OMP's `images[]`, everything
			// else into a labelled attached-context block.
			const turn = await this.turnTextWithAttachments(threadId, message);
			const selectedSlashCommand = string(row.cediaSelectedSlashCommand);
			const payload = {
				message: turn.message,
				...(turn.images.length > 0 ? { images: turn.images } : {}),
				...(selectedSlashCommand ? { cediaSelectedSlashCommand: selectedSlashCommand } : {}),
			};
			const dispatchMode = row.dispatchMode === "steer" ? "steer" : row.dispatchMode === "queue" ? "queue" : undefined;
			const existingSession = await this.session(threadId);
			if (selectedSlashCommand && existingSession.status === "running" && dispatchMode) {
				throw new Error("The selected slash command cannot be dispatched while this turn is running. Retry after the current turn finishes.");
			}
			let session = await this.ensureStarted(existingSession);
			if (selectedSlashCommand && session.status === "running" && dispatchMode) {
				throw new Error("The selected slash command cannot be dispatched while this turn is running. Retry after the current turn finishes.");
			}
			// Cedia §2.5: the shared draft owner binds this revision to one command before
			// dispatch. Two windows sending the same revision then produce one turn, and a
			// revision already sent with different text stops here instead of double-sending.
			const requestedCommandId = string(row.commandId) ?? id();
			const reservation = await this.reserveDraftSubmission(threadId, requestedCommandId, turn.message);
			if (reservation.status === "conflict") throw new Error("This draft was already sent with different text from another window. Review the task before sending again.");
			const commandId = reservation.status === "reserved" ? reservation.commandId : requestedCommandId;
			const selection = modelSelectionFromCommand(row.modelSelection);
			// `dispatchMode: steer` feeds the running turn, which keeps the model it started with,
			// so a change sent with it is deferred; a plain send owns the turn it starts.
			if (selection) await this.setModelIfRequested(session, selection, { forSubmission: dispatchMode === undefined });
			const command = session.status === "running" && dispatchMode
				? dispatchMode === "steer" ? "steer" : "follow_up"
				: "prompt";
			let result = await this.sendCommand(session, commandId, command, payload);
			if (result.status === "not_dispatched") {
				// A not_dispatched result is explicitly safe to retry with the same
				// command id.  Refresh the session first so its durable incarnation
				// matches the next command envelope.
				session = await this.ensureStarted(await this.session(threadId));
				result = await this.sendCommand(session, commandId, command, payload);
			}
			if (result.status === "failed" || result.status === "outcome_unknown" || result.status === "not_dispatched") throw new Error(result.error ?? "OMP did not accept the prompt");
			// Accepted: the draft has become history, and a newer edit keeps its own revision.
			if (reservation.status === "reserved") await this.releaseDraftSubmission(threadId, reservation.revision);
		} else if (type === "thread.turn.interrupt" || type === "thread.task.stop") {
			const threadId = string(row.threadId);
			if (!threadId) throw new Error("Thread id is required");
			const session = await this.session(threadId);
			const result = await this.sendCommand(session, string(row.commandId) ?? id(), "abort");
			if (result.status === "failed" || result.status === "outcome_unknown") throw new Error(result.error ?? "OMP did not stop the turn");
		} else if (type === "thread.session.stop") {
			const threadId = string(row.threadId);
			if (!threadId) throw new Error("Thread id is required");
			await this.request("POST", `/v1/sessions/${encodeURIComponent(threadId)}/stop`);
		} else if (type === "thread.message.edit-and-resend") {
			await this.applyEditAndResend(row);
		} else if (type === "thread.conversation.rollback") {
			await this.rewindToMessage(row);
		} else if (type === "thread.approval.respond") {
			await this.respondUi(row, row.decision === "accept" || row.decision === "acceptForSession");
		} else if (type === "thread.user-input.respond") {
			const answers = record(row.answers) ?? {};
			const values = Object.values(answers);
			const answer = values.length === 1 && (typeof values[0] === "string" || typeof values[0] === "boolean") ? values[0] : JSON.stringify(answers);
			await this.respondUi(row, answer ?? "");
		} else {
			unsupported(type);
		}
		this.#snapshotSequence += 1;
		if (this.#shellSubscriptions > 0) void this.refreshShell();
		if (typeof row.threadId === "string" && this.#threadSubscriptions.has(row.threadId)) void this.refreshThread(row.threadId);
		for (const listener of this.#domainListeners) {
			// Cedia events are durable OMP frames, not Synara domain events. The
			// snapshot stream is the honest bridge; do not fabricate a domain event.
			void listener;
		}
		return { sequence: this.#snapshotSequence };
	}

	async respondUi(command: Record<string, unknown>, answer: string | boolean): Promise<void> {
		const threadId = string(command.threadId);
		const token = string(command.requestId);
		if (!threadId || !token) throw new Error("UI response requires a thread and request id");
		const session = await this.session(threadId);
		const result = await this.request<Command>("POST", `/v1/sessions/${encodeURIComponent(threadId)}/ui`, {
			commandId: string(command.commandId) ?? id(),
			incarnation: session.incarnation,
			token,
			answer,
		});
		if (result.status === "failed" || result.status === "outcome_unknown") throw new Error(result.error ?? "Cedia did not accept the UI response");
	}

	async listModels(input: ProviderListModelsInput): Promise<{ models: unknown[]; source: string }> {
		let catalog: unknown;
		if (input.provider === "omp" && input.threadId) {
			// A live task owns the extension/provider catalog for that task. Only an explicit
			// no-runtime marker is allowed to fall back to the sessionless metadata route;
			// transport or OMP failures must remain visible to the picker.
			const sessionCatalog = await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(input.threadId)}/models`);
			if (!isUnavailableModelCatalog(sessionCatalog)) {
				catalog = sessionCatalog;
			} else {
				try {
					catalog = await this.request<unknown>("GET", "/v1/models");
				} catch {
					// OMP metadata is optional and this read is discovery, not a turn: with the
					// route itself unavailable the picker is simply empty, and no existing task
					// was started as a discovery side effect.
					return { models: [], source: "omp" };
				}
			}
		} else {
			try {
				catalog = await this.request<unknown>("GET", "/v1/models");
			} catch {
				// OMP metadata is optional and this read is discovery, not a turn: with the
				// route itself unavailable the picker is simply empty, and no existing task
				// was started as a discovery side effect.
				return { models: [], source: "omp" };
			}
		}
		// An answer that arrived without a list is not the same fact as an unavailable
		// catalogue, so it surfaces instead of reading as "OMP offers nothing".
		const rows = normalizeOmpModels(catalogModels(catalog));
		return {
			source: "omp",
			models: rows.map(row => ({
				slug: row.slug,
				name: row.label,
				...(row.reason ? { description: row.reason } : {}),
				...(row.upstreamProviderId ? { upstreamProviderId: row.upstreamProviderId } : {}),
				...(row.upstreamProviderName ? { upstreamProviderName: row.upstreamProviderName } : {}),
				...(row.efforts ? { supportedReasoningEfforts: row.efforts.map(value => ({ value, label: value })) } : {}),
				...(row.defaultReasoningEffort ? { defaultReasoningEffort: row.defaultReasoningEffort } : {}),
				...(row.contextWindow ? {
					contextWindow: row.contextWindow,
					contextWindowOptions: [{ value: String(row.contextWindow), label: String(row.contextWindow), isDefault: true }],
				} : {}),
				...(row.maxOutputTokens ? { maxOutputTokens: row.maxOutputTokens } : {}),
			})),
		};
	}

	async getThreadState(threadId: string): Promise<TaskState> {
		return (await this.events(await this.session(threadId))).state;
	}

	nativeApi(): unknown {
		const adapter = this;
		const providerPath = (providerId: string) => `/v1/providers/${encodeURIComponent(providerId)}`;
		const loginPath = (id: string) => `/v1/provider-logins/${encodeURIComponent(id)}`;
		installCediaProviderAuthApi({
			list: () => adapter.request("GET", "/v1/providers"),
			saveApiKey: (providerId, apiKey) => adapter.request("POST", `${providerPath(providerId)}/api-key`, { apiKey }),
			logout: (providerId) => adapter.request("DELETE", `${providerPath(providerId)}/auth`),
			login: (providerId) => adapter.request("POST", `${providerPath(providerId)}/login`),
			getLogin: (id) => adapter.request("GET", loginPath(id)),
			respond: (id, requestId, value) => adapter.request("POST", `${loginPath(id)}/input`, { requestId, value }),
			cancel: (id) => adapter.request("DELETE", loginPath(id)),
		});
		const files = createNativeFilesApi(adapter.#bridge);
		const browser = createNativeBrowserApi(adapter.#bridge);
		const onEvent = (listeners: Set<(event: unknown) => void>) => (listener: (event: unknown) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		};
		const readSnapshot = async () => await adapter.shellSnapshot(true);
		const unsupportedAsync = (name: string) => async (..._args: unknown[]): Promise<never> => unsupported(name);
		const api = {
			dispose: () => adapter.dispose(),
			dialogs: {
				pickFolder: async () => {
					const bridge = adapter.#bridge;
					return await bridge.invoke(CEDIA_AGENT_CHANNEL, { kind: "pickFolder" } as unknown as AgentRequest) as string | null;
				},
				confirm: async (message: string) => typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(message) : false,
			},
			shell: {
				openInEditor: async (target: string, _editor: string) => {
					const projects = await adapter.projects();
					const ideTarget = splitIdeTarget(target, projects);
					const routeId = typeof window !== "undefined" ? window.location.hash.slice(2).split(/[?\/]/)[0] : undefined;
					// A newly composed draft can have a route before an OMP session exists.
					// Only hand off durable sessions; opening the IDE still works for drafts.
					let sessionId: string | undefined;
					if (routeId && /^[A-Za-z0-9_-]{1,128}$/.test(routeId)) {
						const sessions = await adapter.sessions(projects.find(project => project.path === ideTarget.cwd)?.id);
						sessionId = sessions.find(session => session.id === routeId)?.id;
						if (!sessionId) {
							const draft = await adapter.#bridge.invoke(CEDIA_AGENT_CHANNEL, { kind: "uiDraft", action: "read", threadId: routeId } as unknown as AgentRequest) as { draftThread?: unknown } | null;
							if (draft?.draftThread) sessionId = routeId;
						}
					}
					await adapter.#bridge.invoke(CEDIA_AGENT_CHANNEL, { kind: "openIde", ...ideTarget, ...(sessionId ? { sessionId } : {}) } as unknown as AgentRequest);
				},
				openExternal: async (url: string) => { await adapter.#bridge.invoke(CEDIA_AGENT_CHANNEL, { kind: "openExternal", url } as unknown as AgentRequest); },
				showInFolder: unsupportedAsync("shell.showInFolder"),
			},
			projects: {
				discoverScripts: async () => ({ targets: [] }),
				prewarmSearchIndex: async () => ({ started: false }),
				resolveWorkspaceFileReferences: unsupportedAsync("projects.resolveWorkspaceFileReferences"),
				resolveOutOfRootFileReference: unsupportedAsync("projects.resolveOutOfRootFileReference"),
				createLocalFilePreviewGrant: unsupportedAsync("projects.createLocalFilePreviewGrant"),
				runDevServer: unsupportedAsync("projects.runDevServer"),
				stopDevServer: unsupportedAsync("projects.stopDevServer"),
				listDevServers: async () => ({ servers: [] }),
				...files.projects,
				onDevServerEvent: () => () => undefined,
				provisionFromGitHub: unsupportedAsync("projects.provisionFromGitHub"),
				onProvisionProgress: () => () => undefined,
			},
			filesystem: files.filesystem,
			// The NativeApi interface still declares this member; nothing in this window renders
			// Studio outputs any more (§10 item 60 cut the surface), so it stays the honest refusal.
			studio: { listThreadOutputs: unsupportedAsync("studio.listThreadOutputs") },
			provider: {
				// Cedia §10 item 62: skills/commands are OMP's own `get_available_commands`
				// (rows split by `source`), and compaction is OMP's `compact` — all real.
				getComposerCapabilities: async () => ({ provider: "omp", supportsSkillMentions: false, supportsSkillDiscovery: true, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsThreadCompaction: true, supportsThreadImport: false }),
				compactThread: async (input: ProviderCompactThreadInput) => {
					const threadId = string(input.threadId);
					if (!threadId) throw new Error("Compaction needs a task");
					const session = await adapter.ensureStarted(await adapter.session(threadId));
					const result = await adapter.sendCommand(session, id(), "compact");
					if (result.status === "failed" || result.status === "outcome_unknown" || result.status === "not_dispatched") throw new Error(result.error ?? "OMP did not compact this task");
				},
				listCommands: async (input: ProviderListCommandsInput) => {
					// `get_available_commands` needs a session; a draft with no host session
					// honestly reports no provider commands (the built-in list still shows).
					const rows = await adapter.availableSlashCommands(input.threadId);
					const commands = rows.flatMap((row) => {
						const command = record(row);
						const name = command ? string(command.name) : undefined;
						const source = command ? string(command.source) : undefined;
						if (!name || source === "skill") return [];
						const description = command ? string(command.description) : undefined;
						return [{ name, ...(description ? { description } : {}) }];
					});
					return { commands, source: "omp" };
				},
				listSkills: async (input: ProviderListSkillsInput) => {
					const rows = await adapter.availableSlashCommands(input.threadId);
					const skills = rows.flatMap((row) => {
						const command = record(row);
						const name = command ? string(command.name) : undefined;
						const source = command ? string(command.source) : undefined;
						if (!name || source !== "skill") return [];
						const description = command ? string(command.description) : undefined;
						// OMP's RPC row carries no file path and the descriptor requires one;
						// on this path the reference is inert (OMP invokes skills by name).
						return [{ name, path: name, enabled: true, ...(description ? { description } : {}) }];
					});
					return { skills, source: "omp" };
				},
				// Sessionless: the settings catalog has no OMP session to ask (recorded §9).
				listSkillsCatalog: async () => ({ skills: [] }),
				listPlugins: async () => ({ marketplaces: [], marketplaceLoadErrors: [], remoteSyncError: null, featuredPluginIds: [], source: "omp" }),
				readPlugin: unsupportedAsync("provider.readPlugin"),
				listModels: async (input: ProviderListModelsInput) => await adapter.listModels(input),
				listAgents: async () => ({ agents: [], source: "omp" }),
			},
			server: {
				getConfig: async () => {
					const environment = await adapter.bootstrapEnvironment();
					const stored = await adapter.readKeybindings().catch(() => ({ configPath: keybindingsPath(environment), keybindings: [], issues: [] }));
					return {
						cwd: environment.homeDir,
						homeDir: environment.homeDir,
						worktreesDir: environment.worktreesDir,
						keybindingsConfigPath: stored.configPath,
						keybindings: stored.keybindings,
						issues: stored.issues,
						providers: [{ provider: "omp", status: "ready", available: true, authStatus: "unknown", authLabel: "Managed by OMP", checkedAt: iso(adapter.#now), message: "OMP execution is owned by the Cedia host", voiceTranscriptionAvailable: await adapter.voiceAvailable() }],
						availableEditors: ["vscode"],
					};
				},
				getEnvironment: async () => {
					const environment = await adapter.bootstrapEnvironment();
					const os = environment.platform === "win32" ? "windows" : environment.platform === "darwin" || environment.platform === "linux" ? environment.platform : "unknown";
					return { environmentId: "cedia-local", label: "Cedia local", platform: { os, arch: "other" }, serverVersion: environment.version, capabilities: { repositoryIdentity: false } };
				},
				getSettings: async () => ({
					...DEFAULT_SERVER_SETTINGS_VIEW,
					textGenerationModelSelection: { provider: "omp", model: OMP_UNRESOLVED_MODEL },
					providers: { ...DEFAULT_SERVER_SETTINGS_VIEW.providers, omp: { ...DEFAULT_SERVER_SETTINGS_VIEW.providers.omp, enabled: true } },
				}),
				updateSettings: unsupportedAsync("server.updateSettings"),
				getAuthSession: unsupportedAsync("server.getAuthSession"),
				bootstrapAuth: unsupportedAsync("server.bootstrapAuth"),
				bootstrapBearerAuth: unsupportedAsync("server.bootstrapBearerAuth"),
				issueAuthWebSocketToken: unsupportedAsync("server.issueAuthWebSocketToken"),
				createAuthPairingToken: unsupportedAsync("server.createAuthPairingToken"),
				listAuthPairingLinks: unsupportedAsync("server.listAuthPairingLinks"),
				revokeAuthPairingLink: unsupportedAsync("server.revokeAuthPairingLink"),
				listAuthClients: unsupportedAsync("server.listAuthClients"),
				revokeAuthClient: unsupportedAsync("server.revokeAuthClient"),
				revokeOtherAuthClients: unsupportedAsync("server.revokeOtherAuthClients"),
				logoutAuthSession: unsupportedAsync("server.logoutAuthSession"),
				listExternalMcpIntegrations: async () => [],
				createExternalMcpIntegration: unsupportedAsync("server.createExternalMcpIntegration"),
				revokeExternalMcpIntegration: unsupportedAsync("server.revokeExternalMcpIntegration"),
				refreshExternalMcpPairing: unsupportedAsync("server.refreshExternalMcpPairing"),
				refreshProviders: unsupportedAsync("server.refreshProviders"),
				updateProvider: unsupportedAsync("server.updateProvider"),
				listWorktrees: async () => ({ worktrees: [] }),
				listLocalServers: async () => ({ servers: [] }),
				stopLocalServer: unsupportedAsync("server.stopLocalServer"),
				getProviderUsageSnapshot: unsupportedAsync("server.getProviderUsageSnapshot"),
				listProviderUsage: unsupportedAsync("server.listProviderUsage"),
				consumeCodexResetCredit: unsupportedAsync("server.consumeCodexResetCredit"),
				getDiagnostics: unsupportedAsync("server.getDiagnostics"),
				generateThreadRecap: unsupportedAsync("server.generateThreadRecap"),
				generateAutomationIntent: unsupportedAsync("server.generateAutomationIntent"),
				prewarmVoice: async (input: unknown) => await adapter.request("POST", "/v1/voice/prewarm", input),
				transcribeVoice: async (input: unknown) => await adapter.request("POST", "/v1/voice/transcribe", input),
				upsertKeybinding: async (input: { rule: unknown; replacing?: unknown }) => await adapter.writeKeybinding(input ?? {}),
			},
			orchestration: {
				getSnapshot: async () => await adapter.shellSnapshot(true),
				getShellSnapshot: async () => await adapter.shellSnapshot(false),
				getThreadDetailSnapshot: async (input: { threadId: string }) => await adapter.threadSnapshot(input.threadId),
				dispatchCommand: async (command: unknown) => await adapter.dispatch(command),
				importThread: unsupportedAsync("orchestration.importThread"),
				regenerateThreadTitle: unsupportedAsync("orchestration.regenerateThreadTitle"),
				repairState: async () => await adapter.shellSnapshot(true),
				getTurnDiff: unsupportedAsync("orchestration.getTurnDiff"),
				getFullThreadDiff: unsupportedAsync("orchestration.getFullThreadDiff"),
				replayEvents: async () => [],
				listProviderDeliveryBlockers: async () => ({ blockers: [] }),
				reconcileProviderDelivery: unsupportedAsync("orchestration.reconcileProviderDelivery"),
				prepareQuitResume: unsupportedAsync("orchestration.prepareQuitResume"),
				subscribeShell: async () => {
					adapter.#shellSubscriptions += 1;
					if (adapter.#shellSubscriptions === 1) {
						await adapter.refreshShell();
						adapter.#shellTimer = setInterval(() => { void adapter.refreshShell().catch(() => undefined); }, 1_000);
						(adapter.#shellTimer as unknown as { unref?: () => void }).unref?.();
					}
				},
				unsubscribeShell: async () => {
					adapter.#shellSubscriptions = Math.max(0, adapter.#shellSubscriptions - 1);
					if (adapter.#shellSubscriptions === 0 && adapter.#shellTimer) { clearInterval(adapter.#shellTimer); adapter.#shellTimer = undefined; }
				},
				subscribeThread: async (input: { threadId: string }) => {
					adapter.#threadSubscriptions.add(input.threadId);
					await adapter.refreshThread(input.threadId);
					if (!adapter.#threadTimers.has(input.threadId)) {
						const timer = setInterval(() => { void adapter.refreshThread(input.threadId).catch(() => undefined); }, 1_000);
						(timer as unknown as { unref?: () => void }).unref?.();
						adapter.#threadTimers.set(input.threadId, timer);
					}
				},
				unsubscribeThread: async (input: { threadId: string }) => {
					adapter.#threadSubscriptions.delete(input.threadId);
					const timer = adapter.#threadTimers.get(input.threadId);
					if (timer) { clearInterval(timer); adapter.#threadTimers.delete(input.threadId); }
				},
				onDomainEvent: onEvent(adapter.#domainListeners),
				onShellEvent: onEvent(adapter.#shellListeners),
				onThreadEvent: onEvent(adapter.#threadListeners),
			},
			automation: {
				list: async () => ({ definitions: [], runs: [], memories: [] }),
				getMemory: async () => null,
				create: unsupportedAsync("automation.create"),
				update: unsupportedAsync("automation.update"),
				delete: unsupportedAsync("automation.delete"),
				runNow: unsupportedAsync("automation.runNow"),
				cancelRun: unsupportedAsync("automation.cancelRun"),
				markRunRead: unsupportedAsync("automation.markRunRead"),
				archiveRun: unsupportedAsync("automation.archiveRun"),
				resolveProposal: unsupportedAsync("automation.resolveProposal"),
				onEvent: () => () => undefined,
			},
			terminal: createNativeTerminalApi(adapter.#bridge),
			git: createNativeGitApi(adapter.#bridge),
			pullRequests: new Proxy({}, { get: (_target, key) => String(key).startsWith("on") ? () => () => undefined : unsupportedAsync(`pullRequests.${String(key)}`) }),
			contextMenu: { show: createCediaContextMenuPresenter() },
			stats: { getProfileStats: unsupportedAsync("stats.getProfileStats"), getProfileTokenStats: unsupportedAsync("stats.getProfileTokenStats") },
			device: createNativeDeviceApi(adapter.#bridge),
			browser: { ...browser, onCopyLink: browser.onBrowserCopyLink },
		};
		return api;
	}
}

function defaultBridge(): AgentWindowBridge {
	const candidate = (globalThis as { window?: { vscode?: { ipcRenderer?: AgentWindowBridge } } }).window?.vscode?.ipcRenderer;
	if (!candidate?.invoke) throw new Error("Cedia Agent Window preload bridge is unavailable");
	return candidate;
}

export function createCediaNativeApi(options: AdapterOptions = {}): any {
	const adapter = new CediaAgentAdapter(options);
	// The full interface is intentionally cast at this boundary: Synara's
	// contracts have provider-specific method overloads, while unsupported Cedia
	// domains reject at runtime instead of pretending to succeed.
	// `cedia` is Cedia's own namespace: the vendor contracts describe Synara's server, and
	// the capability snapshot is a Cedia host fact, not something to smuggle into it.
	const api = adapter.nativeApi() as Record<string, unknown>;
	return {
		...api,
		cedia: {
			getOwners: async (): Promise<unknown> => await adapter.request("GET", "/v1/owners"),
			attachOwner: async (sessionId: string): Promise<unknown> => await adapter.attachOwner(sessionId),
			getCapabilities: async (): Promise<unknown> => await adapter.capabilities(),
			getPolicy: async (): Promise<unknown> => await adapter.getPolicy(),
			getModelState: async (sessionId: string): Promise<unknown> => await adapter.getModelState(sessionId),
			getAccounts: async (sessionId: string): Promise<unknown> => await adapter.getAccounts(sessionId),
			pinAccount: async (sessionId: string, credentialId: number): Promise<unknown> => await adapter.pinAccount(sessionId, credentialId),
			setServiceTier: async (sessionId: string, family: string, tier: string | null): Promise<unknown> => await adapter.setServiceTier(sessionId, family, tier),
			getModelRoles: async (sessionId: string): Promise<unknown> => await adapter.getModelRoles(sessionId),
			applyModelRole: async (sessionId: string, role: string): Promise<unknown> => await adapter.applyModelRole(sessionId, role),
			setModelRole: async (sessionId: string, role: string, modelId: string | null): Promise<unknown> => await adapter.setModelRole(sessionId, role, modelId),
			getPlan: async (sessionId: string): Promise<unknown> => await adapter.getPlan(sessionId),
			getProgress: async (sessionId: string): Promise<unknown> => await adapter.getProgress(sessionId),
			getQueue: async (sessionId: string): Promise<unknown> => await adapter.getQueue(sessionId),
			dropQueued: async (sessionId: string, body: CediaQueueDropCommand): Promise<unknown> => await adapter.dropQueued(sessionId, body),
			getRunPause: async (sessionId: string): Promise<unknown> => await adapter.getRunPause(sessionId),
			setRunPause: async (sessionId: string, body: CediaRunPauseCommand): Promise<unknown> => await adapter.setRunPaused(sessionId, body),
			execBash: async (sessionId: string, body: CediaBashExecCommand): Promise<unknown> => await adapter.execBash(sessionId, body),
			abortBash: async (sessionId: string, body?: CediaBashAbortCommand): Promise<unknown> => await adapter.abortBash(sessionId, body),
			execPython: async (sessionId: string, body: CediaPythonExecCommand): Promise<unknown> => await adapter.execPython(sessionId, body),
			abortPython: async (sessionId: string, body?: CediaPythonAbortCommand): Promise<unknown> => await adapter.abortPython(sessionId, body),
			getContext: async (sessionId: string): Promise<unknown> => await adapter.getContext(sessionId),
			getHistory: async (sessionId: string): Promise<unknown> => await adapter.getHistory(sessionId),
			getTree: async (sessionId: string): Promise<unknown> => await adapter.getTree(sessionId),
			getPrewalk: async (sessionId: string): Promise<unknown> => await adapter.getPrewalk(sessionId),
			getOmfg: async (sessionId: string): Promise<unknown> => await adapter.getOmfg(sessionId),
			draftOmfg: async (sessionId: string, body: CediaOmfgDraftCommand): Promise<unknown> => await adapter.draftOmfg(sessionId, body),
			saveOmfg: async (sessionId: string, body: CediaOmfgSaveCommand): Promise<unknown> => await adapter.saveOmfg(sessionId, body),
			abortOmfg: async (sessionId: string, body?: CediaOmfgAbortCommand): Promise<unknown> => await adapter.abortOmfg(sessionId, body),
			getCleanse: async (sessionId: string): Promise<unknown> => await adapter.getCleanse(sessionId),
			runCleanse: async (sessionId: string, body: CediaCleanseRunCommand): Promise<unknown> => await adapter.runCleanse(sessionId, body),
			abortCleanse: async (sessionId: string, body?: CediaCleanseAbortCommand): Promise<unknown> => await adapter.abortCleanse(sessionId, body),
			getBtw: async (sessionId: string): Promise<unknown> => await adapter.getBtw(sessionId),
			askBtw: async (sessionId: string, body: CediaBtwAskCommand): Promise<unknown> => await adapter.askBtw(sessionId, body),
			branchBtw: async (sessionId: string, body?: CediaBtwBranchCommand): Promise<unknown> => await adapter.branchBtw(sessionId, body),
			getLoop: async (sessionId: string): Promise<unknown> => await adapter.getLoop(sessionId),
			disableLoop: async (sessionId: string, body?: CediaLoopCommand): Promise<unknown> => await adapter.disableLoop(sessionId, body),
			navigateTree: async (sessionId: string, entryId: string, summarize?: boolean): Promise<unknown> => await adapter.navigateTree(sessionId, entryId, summarize),
			getToolCatalog: async (sessionId: string): Promise<unknown> => await adapter.getToolCatalog(sessionId),
			getCodeMode: async (sessionId: string): Promise<unknown> => await adapter.getCodeMode(sessionId),
			getExtensions: async (sessionId: string): Promise<unknown> => await adapter.getExtensions(sessionId),
			setActiveTools: async (sessionId: string, toolNames: readonly string[]): Promise<unknown> => await adapter.setActiveTools(sessionId, toolNames),
			setExtensionEnabled: async (sessionId: string, extensionId: string, enabled: boolean): Promise<unknown> => await adapter.setExtensionEnabled(sessionId, extensionId, enabled),
			refreshSkills: async (sessionId: string): Promise<unknown> => await adapter.refreshSkills(sessionId),
			getTranscript: async (sessionId: string): Promise<unknown> => await adapter.getTranscript(sessionId),
			clearContext: async (sessionId: string, body?: CediaContextCommand): Promise<unknown> => await adapter.clearContext(sessionId, body),
			freshSession: async (sessionId: string, body?: CediaContextCommand): Promise<unknown> => await adapter.freshSession(sessionId, body),
			getUsage: async (sessionId: string): Promise<unknown> => await adapter.getUsage(sessionId),
			getGoalDetails: async (sessionId: string): Promise<unknown> => await adapter.getGoalDetails(sessionId),
			setGoalBudget: async (sessionId: string, tokenBudget: number): Promise<unknown> => {
				if (typeof tokenBudget !== "number" || !Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) throw new Error("A goal token budget must be a positive integer");
				return await adapter.updateGoalBudgetFromMetadata(sessionId, tokenBudget);
			},
			getCredits: async (sessionId: string): Promise<unknown> => await adapter.getCredits(sessionId),
			redeemCredit: async (sessionId: string, target: CediaCreditTarget): Promise<unknown> => await adapter.redeemCredit(sessionId, target),
			dropContextImages: async (sessionId: string, body: CediaContextCommand): Promise<unknown> => await adapter.dropContextImages(sessionId, body),
			shakeContext: async (sessionId: string, body: CediaContextShakeCommand): Promise<unknown> => await adapter.shakeContext(sessionId, body),
			abortCompaction: async (sessionId: string, body: CediaContextCommand): Promise<unknown> => await adapter.abortCompaction(sessionId, body),
			getMemory: async (sessionId: string): Promise<unknown> => await adapter.getMemory(sessionId),
			applyMemoryBackend: async (sessionId: string, body: CediaMemoryCommand): Promise<unknown> => await adapter.applyMemoryBackend(sessionId, body),
			getAgents: async (sessionId: string): Promise<unknown> => await adapter.getAgents(sessionId),
			getAgentTranscript: async (sessionId: string, agentId: string, fromByte?: number): Promise<unknown> => await adapter.getAgentTranscript(sessionId, agentId, fromByte),
			killAgent: async (sessionId: string, agentId: string): Promise<unknown> => await adapter.killAgent(sessionId, agentId),
			reviveAgent: async (sessionId: string, agentId: string): Promise<unknown> => await adapter.reviveAgent(sessionId, agentId),
			getAgentConfigs: async (sessionId: string): Promise<unknown> => await adapter.getAgentConfigs(sessionId),
			configureAgent: async (sessionId: string, body: CediaAgentConfigInput): Promise<unknown> => await adapter.configureAgent(sessionId, body),
			setPlan: async (sessionId: string, body: CediaPlanCommand): Promise<unknown> => await adapter.setPlan(sessionId, body),
			getAdvisor: async (sessionId: string): Promise<unknown> => await adapter.getAdvisor(sessionId),
			setAdvisor: async (sessionId: string, body: CediaAdvisorCommand): Promise<unknown> => await adapter.setAdvisor(sessionId, body),
			getAdvisorHistory: async (sessionId: string): Promise<unknown> => await adapter.getAdvisorHistory(sessionId),
			getAdvisorConfig: async (sessionId: string, scope: "project" | "user"): Promise<unknown> => await adapter.getAdvisorConfig(sessionId, scope),
			setAdvisorConfig: async (sessionId: string, body: CediaAdvisorConfigCommand): Promise<unknown> => await adapter.setAdvisorConfig(sessionId, body),
			getOmpSettingsKeys: async (): Promise<unknown> => await adapter.getOmpSettingsKeys(),
			getOmpSettingValue: async (path: string): Promise<unknown> => await adapter.getOmpSettingValue(path),
			setOmpSetting: async (input: { path: string; value: unknown; expectedRevision?: string }): Promise<unknown> => await adapter.setOmpSetting(input),
			getRemoteGatewayState: async (): Promise<unknown> => await adapter.remoteGatewayState(),
			issueRemoteEnrollment: async (name: string): Promise<unknown> => await adapter.issueRemoteEnrollment(name),
			listDevices: async (): Promise<unknown> => await adapter.listDevices(),
			revokeDevice: async (deviceId: string): Promise<unknown> => await adapter.revokeDevice(deviceId),
		},
	};
}

/**
 * Rebuild the typed host error Electron's IPC flattened.
 *
 * The transport keeps only a message, so the main process tags the code into it and this
 * restores it as a property. An error that never carried a code is returned untouched, and the
 * host's own words are never rewritten beyond removing the tag and Electron's prefixes.
 */
export function normalizeCediaHostError(error: unknown): Error {
	const original = error instanceof Error ? error : new Error(String(error));
	const { code, message } = readCediaHostError(original.message);
	if (code === undefined) return original;
	const normalized = new Error(message);
	normalized.name = "CediaHostError";
	normalized.stack = original.stack;
	return Object.assign(normalized, { code });
}

export interface CediaDesktopBridgeOptions { readonly bridge: AgentWindowBridge }

export interface CediaDesktopBridge extends DesktopBridge {
	/** Read the latest IDE theme snapshot while an Agent window remains open. */
	getThemeSnapshot?: () => Promise<unknown>;
}

export function createCediaDesktopBridge(options: CediaDesktopBridgeOptions): CediaDesktopBridge {
	const bridge = options.bridge;
	const zoom = createDesktopZoomController(bridge);
	const unsupportedDesktop = async (name: string): Promise<never> => unsupported(name);
	return {
		browser: { ...createNativeBrowserApi(bridge), onBrowserUseOpenPanelRequest: () => () => undefined },
		getWsUrl: () => null,
		pickFolder: async () => await bridge.invoke(CEDIA_AGENT_CHANNEL, { kind: "pickFolder" } as unknown as AgentRequest) as string | null,
		confirm: async (message: string) => typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(message) : false,
		setTheme: async () => undefined,
		getThemeSnapshot: async () => await bridge.invoke(CEDIA_AGENT_CHANNEL, { kind: "theme" }),
		setAppIcon: async () => undefined,
		showContextMenu: createCediaContextMenuPresenter(),
		openExternal: async (url: string) => { await bridge.invoke(CEDIA_AGENT_CHANNEL, { kind: "openExternal", url } as unknown as AgentRequest); return true; },
		showInFolder: async (path: string) => unsupportedDesktop(`desktop.showInFolder (${path})`),
		onMenuAction: (listener: (action: string) => void) => {
			const onAction = (_event: unknown, ...args: unknown[]): void => {
				const payload = args[0];
				if (typeof payload === "string") {
					listener(payload);
					return;
				}
				if (payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as { id?: unknown }).id === "string") {
					listener((payload as { id: string }).id);
				}
			};
			bridge.on?.("vscode:runAction", onAction);
			return () => bridge.removeListener?.("vscode:runAction", onAction);
		},
		onQuitConfirmationRequest: () => () => undefined,
		replyQuitConfirmation: () => undefined,
		getZoomFactor: zoom.getZoomFactor,
		onZoomFactorChange: zoom.onZoomFactorChange,
		getUpdateState: async () => ({ state: "unsupported" }),
		checkForUpdates: async () => ({ state: "unsupported" }),
		downloadUpdate: async () => ({ state: "unsupported" }),
		installUpdate: async () => ({ state: "unsupported" }),
		onUpdateState: () => () => undefined,
		notifications: { isSupported: async () => false, show: async () => false },
	} as unknown as DesktopBridge;
}
