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
	type ProviderListSkillsInput,
} from "@synara/contracts";
import { applyEventPage, applyFrame, createInitialTaskState, type TaskState as CediaTaskState, type TranscriptEntry } from "../../src/state.ts";
import type { Json } from "../../../../packages/protocol/src/index.ts";
import { installCediaProviderAuthApi } from "../vendor/synara/apps/web/src/lib/cediaProviderAuth";
import { useComposerDraftStore } from "../vendor/synara/apps/web/src/composerDraftStore";
import { readComposerImageBlob } from "../vendor/synara/apps/web/src/lib/composerImageBlobStore";
import { createNativeTerminalApi } from "./native-terminal";
import { createNativeFilesApi } from "./native-files";
import { createNativeBrowserApi } from "./native-browser";
import { createNativeGitApi } from "./native-git";
import { createNativeDeviceApi } from "./native-device";
import { createDesktopZoomController } from "./desktopZoom";
import { createCediaContextMenuPresenter } from "./cedia-context-menu";

export const CEDIA_AGENT_CHANNEL = "vscode:cediaAgent";
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
 * Bytes for a composer image attachment, looked up across the composer stores the
 * send paths own: the live draft's File, a queued turn's File, then the persisted
 * IndexedDB blob (AppSnap / reload-hydration window). Null when nothing backs the id.
 */
async function composerImageFile(threadId: string, imageId: string): Promise<File | null> {
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

export interface CediaProject {
	id: string;
	path: string;
	name: string;
	pinned?: boolean;
	archived?: boolean;
	createdAt: string;
	updatedAt?: string;
}

export interface CediaSession {
	id: string;
	projectId: string;
	title: string;
	cwd: string;
	sessionFile?: string;
	incarnation: string;
	status: "idle" | "running" | "stopped" | "recovery_required" | string;
	archived?: boolean;
	pinned?: boolean;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
}

interface CediaEvent {
	sessionId: string;
	incarnation: string;
	sequence: number;
	timestamp: string;
	frame: unknown;
}

interface CediaEventPage {
	events: CediaEvent[];
	cursor: number;
	hasMore: boolean;
}

interface CediaCommand {
	status?: string;
	result?: unknown;
	ack?: unknown;
	error?: string;
	[key: string]: unknown;
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

function reduceEvents(state: TaskState, events: readonly CediaEvent[]): TaskState {
	return applyEventPage(state, {
		events: events.map(event => ({
			sessionId: event.sessionId,
			incarnation: event.incarnation,
			sequence: event.sequence,
			timestamp: event.timestamp,
			// The durable event envelope owns the timestamp, while the shared
			// reducer intentionally receives only the frame payload. Preserve the
			// envelope timestamp on object frames so lifecycle projections (turns,
			// messages, tools) retain an ordering timestamp without maintaining a
			// second reducer in this adapter.
			frame: (() => {
				const frame = record(event.frame);
				return frame && typeof frame.timestamp !== "string"
					? { ...frame, timestamp: event.timestamp } as Json
					: event.frame as Json;
			})(),
		})),
		cursor: events.at(-1)?.sequence ?? state.cursor,
		hasMore: false,
	});
}

function asProjects(value: unknown): CediaProject[] {
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
			...(typeof row.pinned === "boolean" ? { pinned: row.pinned } : {}),
			...(typeof row.archived === "boolean" ? { archived: row.archived } : {}),
			createdAt,
			...(typeof row.updatedAt === "string" && row.updatedAt.trim() ? { updatedAt: row.updatedAt.trim() } : {}),
		}];
	});
}

function asSessions(value: unknown): CediaSession[] {
	return array(value).flatMap(item => {
		const row = record(item);
		if (!row) return [];
		const id = string(row?.id);
		const projectId = string(row?.projectId);
		const title = string(row?.title) ?? "New task";
		const cwd = string(row?.cwd) ?? "";
		const incarnation = string(row?.incarnation);
		const createdAt = string(row?.createdAt);
		const updatedAt = string(row?.updatedAt) ?? createdAt;
		if (!id || !projectId || !cwd || !incarnation || !createdAt || !updatedAt) return [];
		return [{
			...row,
			id,
			projectId,
			title,
			cwd,
			incarnation,
			status: string(row?.status) ?? "idle",
			createdAt,
			updatedAt,
		} as CediaSession];
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

function splitIdeTarget(target: string, projects: readonly CediaProject[]): { cwd: string; path?: string; line?: number } {
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

function latestModel(state: TaskState, session: CediaSession): { id: string; provider?: string; effort?: string } | undefined {
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

function selectionFor(session: CediaSession, state: TaskState, modelBySession?: ReadonlyMap<string, string>): ModelSelectionLike {
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

function pendingInteractions(value: unknown, session: CediaSession, now: string): unknown[] {
	return array(value).flatMap(item => {
		const row = record(item);
		const token = string(row?.token) ?? string(row?.requestId);
		if (!token) return [];
		const request = record(row?.request) ?? row ?? {};
		const method = string(request.method) ?? "confirm";
		return [{
			interactionKind: /input|select|password|editor/i.test(method) ? "userInput" : "approval",
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

function threadProjection(
	session: CediaSession,
	project: CediaProject | undefined,
	state: TaskState,
	now: string,
	modelBySession?: ReadonlyMap<string, string>,
	pendingUi?: unknown,
	workspace?: ThreadWorkspaceMetadata,
): Record<string, unknown> {
	const modelSelection = selectionFor(session, state, modelBySession);
	const interactions = pendingInteractions(pendingUi, session, now);
	const latestTurn = latestTurnFromState(state);
	const sessionView = {
		threadId: session.id,
		status: sessionStatus(session.status, latestTurn),
		providerName: "omp",
		runtimeMode: "approval-required",
		activeTurnId: latestTurn?.state === "running" ? latestTurn.turnId : null,
		lastError: session.status === "recovery_required" ? "OMP session requires reconciliation" : null,
		updatedAt: session.updatedAt,
	};
	return {
		id: session.id,
		projectId: session.projectId,
		title: session.title,
		modelSelection,
		runtimeMode: "approval-required",
		interactionMode: "default",
		envMode: workspace?.envMode ?? "local",
		branch: workspace?.branch ?? null,
		worktreePath: workspace?.worktreePath ?? null,
		workingDirectory: session.cwd,
		associatedWorktreePath: workspace?.associatedWorktreePath ?? null,
		associatedWorktreeBranch: workspace?.associatedWorktreeBranch ?? null,
		associatedWorktreeRef: workspace?.associatedWorktreeRef ?? null,
		createBranchFlowCompleted: workspace?.createBranchFlowCompleted ?? false,
		isPinned: session.pinned === true,
		parentThreadId: null,
		creationSource: null,
		sourceThreadId: null,
		sourceTurnId: null,
		gatewayOperationId: null,
		gatewayOperationIndex: null,
		subagentAgentId: null,
		subagentNickname: null,
		subagentRole: null,
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
		goal: "",
		goalStartedAt: null,
		goalPausedAt: null,
		goalAchievements: [],
		messages: messagesFromState(state, now, turnIdsByEntry(state)),
		proposedPlans: [],
		activities: activitiesFromState(state, now),
		pendingInteractions: interactions,
		checkpoints: [],
		session: sessionView,
		projectTitle: project?.name,
	};
}

function shellThreadProjection(thread: Record<string, unknown>, session: CediaSession): Record<string, unknown> {
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
	readonly session: CediaSession;
	readonly project: CediaProject | undefined;
	readonly cursor: number;
	readonly ui: readonly unknown[];
	readonly model?: string;
	readonly usage?: { readonly usedTokens: number; readonly maxTokens: number };
	readonly workspace?: ThreadWorkspaceMetadata;
}): string {
	const session = input.session;
	return JSON.stringify([
		session.id, session.projectId, session.title, session.status, session.incarnation,
		session.updatedAt, session.cwd, session.pinned === true, session.archived === true,
		string(session.sidechatSourceThreadId) ?? "",
		input.project ? [input.project.id, input.project.name, input.project.path, input.project.pinned === true, input.project.archived === true, input.project.updatedAt] : null,
		input.cursor,
		input.model ?? "",
		input.usage ? [input.usage.usedTokens, input.usage.maxTokens] : null,
		input.workspace ?? null,
		input.ui,
	]);
}

/** The same idea for the shell: what a shell snapshot is built from, not what it renders. */
function shellSnapshotKey(data: {
	readonly projects: readonly CediaProject[];
	readonly sessions: readonly CediaSession[];
	readonly states: ReadonlyMap<string, TaskState>;
}): string {
	return JSON.stringify([
		data.projects.map(project => [project.id, project.path, project.name, project.pinned === true, project.archived === true, project.updatedAt]),
		data.sessions.map(session => [session.id, session.projectId, session.title, session.status, session.incarnation, session.updatedAt, session.cwd, session.pinned === true, session.archived === true]),
		[...data.states].map(([id, state]) => [id, state.cursor, state.transcript.length]),
	]);
}

export function projectCediaShellSnapshot(
	projects: readonly CediaProject[],
	sessions: readonly CediaSession[],
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
		spaceId: null,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt ?? project.createdAt,
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

	async request<T>(method: NonNullable<AgentRequest["method"]>, path: string, body?: unknown): Promise<T> {
		if (!path.startsWith("/v1/") || path.includes("#") || path.includes("\\")) throw new Error("Invalid Cedia host path");
		return await this.#bridge.invoke(CEDIA_AGENT_CHANNEL, {
			kind: "request",
			method,
			path,
			...(body === undefined ? {} : { body }),
		}) as T;
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

	async projects(): Promise<CediaProject[]> {
		return asProjects(await this.request("GET", "/v1/projects"));
	}

	async sessions(projectId?: string): Promise<CediaSession[]> {
		const query = projectId === undefined ? "" : `?projectId=${encodeURIComponent(projectId)}`;
		return asSessions(await this.request("GET", `/v1/sessions${query}`));
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

	async session(sessionId: string): Promise<CediaSession> {
		const value = await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(sessionId)}`);
		const rows = asSessions([value]);
		if (!rows[0]) throw new Error(`Cedia session '${sessionId}' is unavailable`);
		return rows[0];
	}

	async events(session: CediaSession): Promise<{ state: TaskState; cursor: number }> {
		const cached = this.#eventCache.get(session.id);
		let state = cached?.incarnation === session.incarnation ? cached.state : initialState();
		let cursor = cached?.incarnation === session.incarnation ? cached.cursor : 0;
		for (;;) {
			const page = await this.request<CediaEventPage>("GET", `/v1/sessions/${encodeURIComponent(session.id)}/events?after=${cursor}&limit=500`);
			const pageEvents = await Promise.all(page.events.map(event => this.hydrateEvent(session.id, event)));
			state = reduceEvents(state, pageEvents);
			cursor = page.cursor;
			this.#eventCache.set(session.id, { incarnation: session.incarnation, cursor, state });
			if (!page.hasMore) return { state, cursor };
		}
	}

	async ui(session: CediaSession): Promise<unknown[]> {
		const value = await this.request<unknown>("GET", `/v1/sessions/${encodeURIComponent(session.id)}/ui`);
		const row = record(value);
		return array(row?.requests ?? value);
	}

	async hydrateEvent(sessionId: string, event: CediaEvent): Promise<CediaEvent> {
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

	async readShellData(hydrateTranscripts: boolean): Promise<{ projects: CediaProject[]; sessions: CediaSession[]; states: Map<string, TaskState> }> {
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
		this.#shellKey = shellSnapshotKey(data);
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
			spaceId: null,
			createdAt: project.createdAt,
			updatedAt: project.updatedAt ?? project.createdAt,
			...(full ? { deletedAt: null } : {}),
		}));
		const projectMap = new Map(data.projects.map(project => [project.id, project]));
		const threads = data.sessions.map(session => {
			const state = data.states.get(session.id) ?? initialState();
			const thread = threadProjection(session, projectMap.get(session.projectId), state, now, this.#modelBySession);
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
		const model = latestModel(state, session);
		if (model?.id) this.#modelBySession.set(session.id, modelSlug(model));
		this.#snapshotSequence += 1;
		const project = projects.find(candidate => candidate.id === session.projectId);
		const workspace = this.#threadWorkspace.get(threadId);
		const thread = threadProjection(session, project, state, iso(this.#now), this.#modelBySession, ui, workspace);
		// Read occupancy after completed messages/compaction, never sum lifetime token usage.
		// The marker excludes our own get_state response, avoiding a polling feedback loop.
		const contextFrames = state.transcript.flatMap(entry => entry.rawFrames).filter(frame =>
			["cedia_session", "message_end", "agent_end", "auto_compaction_end"].includes(String(frame.type)));
		const marker = `${session.incarnation}:${contextFrames.length}:${model?.provider ?? ""}:${model?.id ?? ""}`;
		let context = this.#contextCache.get(threadId);
		if (context?.marker !== marker && contextFrames.length && session.status !== "stopped" && session.status !== "recovery_required") {
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

	async sendCommand(session: CediaSession, commandId: string, command: string, payload?: Record<string, unknown>): Promise<CediaCommand> {
		return await this.request<CediaCommand>("POST", `/v1/sessions/${encodeURIComponent(session.id)}/commands`, {
			commandId,
			incarnation: session.incarnation,
			command,
			...(payload && Object.keys(payload).length ? { payload } : {}),
		});
	}

	/** The session's own rewind points, in order: OMP's `get_branch_messages` answers `{entryId, text}`. */
	async userMessageEntries(session: CediaSession): Promise<Array<{ entryId: string; text: string }>> {
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
	async resyncTranscript(session: CediaSession): Promise<void> {
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
		const { state } = await this.events(session);
		// Both lists are the session's user messages in order, so the Nth entry is the Nth message.
		// Counting is safer than matching text: the composer rewrites what it sends, so the stored
		// text and the visible text are not the same string.
		const userMessageIds = state.transcript.filter(entry => entry.kind === "message" && entry.role === "user").map(entry => entry.id);
		const index = userMessageIds.indexOf(messageId);
		if (index < 0) throw new Error("Cedia could not find that message in this task's transcript");
		const entryId = (await this.userMessageEntries(session))[index]?.entryId;
		if (!entryId) throw new Error("OMP no longer offers that message as a rewind point");
		const branch = await this.sendCommand(session, id(), "branch", { entryId });
		if (branch.status === "failed" || branch.status === "outcome_unknown" || branch.status === "not_dispatched") throw new Error(branch.error ?? "OMP did not rewind this task");
		if (record(record(branch.result)?.data)?.cancelled === true) throw new Error("OMP cancelled the rewind");
		// The branch may point the session at another file, so re-read it before speaking again.
		session = await this.session(threadId);
		await this.resyncTranscript(session);
		const selection = modelSelectionFromCommand(row.modelSelection);
		if (selection) await this.setModelIfRequested(session, selection);
		await this.sendCommand(session, string(row.commandId) ?? id(), "prompt", { message: text });
	}

	async ensureStarted(session: CediaSession): Promise<CediaSession> {
		if (session.status === "recovery_required") throw new Error("OMP session requires reconciliation before sending a turn");
		if (session.status === "running") return session;
		const value = await this.request<unknown>("POST", `/v1/sessions/${encodeURIComponent(session.id)}/start`);
		const started = asSessions([value])[0];
		if (!started) throw new Error(`Cedia did not return a started session for '${session.id}'`);
		this.#eventCache.delete(session.id);
		return started;
	}

	async setModelIfRequested(session: CediaSession, selection: ModelSelectionLike | undefined): Promise<void> {
		if (!selection || selection.model === OMP_UNRESOLVED_MODEL) return;
		// Model discovery is global OMP metadata. Reading it through the host route
		// avoids starting an arbitrary existing task just to populate the picker and
		// keeps selection and the provider.listModels surface on one catalog.
		const catalog = await this.request<unknown>("GET", "/v1/models");
		const rows = normalizeOmpModels(catalog);
		const exact = rows.filter(row => row.slug === selection.model);
		const bare = rows.filter(row => row.id === selection.model);
		const matches = exact.length > 0 ? exact : bare;
		const match = matches.length === 1 ? matches[0] : matches.find(row => row.provider === selection.ompProvider);
		if (!match) throw new Error(`OMP no longer advertises model '${selection.model}'`);
		if (!match.provider) throw new Error(`OMP did not identify the provider for model '${selection.model}'`);
		const result = await this.sendCommand(session, id(), "set_model", { provider: match.provider, modelId: match.id });
		if (result.status === "failed" || result.status === "outcome_unknown" || result.status === "not_dispatched") throw new Error(result.error ?? "OMP rejected the model change");
		this.#modelBySession.set(session.id, match.slug);
		const requestedEffort = selection.reasoningEffort ?? selection.options?.thinkingLevel;
		if (requestedEffort) {
			if (match.efforts && match.efforts.length > 0 && !match.efforts.includes(requestedEffort)) throw new Error(`OMP does not advertise reasoning effort '${requestedEffort}' for '${match.id}'`);
			const effort = await this.sendCommand(session, id(), "set_thinking_level", { level: requestedEffort });
			if (effort.status === "failed" || effort.status === "outcome_unknown" || effort.status === "not_dispatched") throw new Error(effort.error ?? "OMP rejected the reasoning effort");
		}
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
			const payload = { message: turn.message, ...(turn.images.length > 0 ? { images: turn.images } : {}) };
			let session = await this.ensureStarted(await this.session(threadId));
			const selection = modelSelectionFromCommand(row.modelSelection);
			if (selection) await this.setModelIfRequested(session, selection);
			const dispatchMode = row.dispatchMode === "steer" ? "steer" : row.dispatchMode === "queue" ? "queue" : undefined;
			const command = session.status === "running" && dispatchMode
				? dispatchMode === "steer" ? "steer" : "follow_up"
				: "prompt";
			let result = await this.sendCommand(session, string(row.commandId) ?? id(), command, payload);
			if (result.status === "not_dispatched") {
				// A not_dispatched result is explicitly safe to retry with the same
				// command id.  Refresh the session first so its durable incarnation
				// matches the next command envelope.
				session = await this.ensureStarted(await this.session(threadId));
				result = await this.sendCommand(session, string(row.commandId) ?? id(), command, payload);
			}
			if (result.status === "failed" || result.status === "outcome_unknown" || result.status === "not_dispatched") throw new Error(result.error ?? "OMP did not accept the prompt");
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
		const result = await this.request<CediaCommand>("POST", `/v1/sessions/${encodeURIComponent(threadId)}/ui`, {
			commandId: string(command.commandId) ?? id(),
			incarnation: session.incarnation,
			token,
			answer,
		});
		if (result.status === "failed" || result.status === "outcome_unknown") throw new Error(result.error ?? "Cedia did not accept the UI response");
	}

	async listModels(): Promise<{ models: unknown[]; source: string }> {
		try {
			const catalog = await this.request<unknown>("GET", "/v1/models");
			const rows = normalizeOmpModels(catalog);
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
		} catch {
			// The picker remains honest when OMP metadata is temporarily unavailable;
			// importantly, no existing task was started as a discovery side effect.
			return { models: [], source: "omp" };
		}
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
				listModels: async () => await adapter.listModels(),
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
	return adapter.nativeApi();
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
