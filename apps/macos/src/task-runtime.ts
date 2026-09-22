/** Item 66: module-level helpers and the configured host launcher, extracted from
 * extension.ts so the concern slices can import them. Bodies unchanged. */

import { activateRestrictedWorkspace } from "./restricted.ts";
import { showArtifacts } from "./artifacts.ts";
/*
 * Cedia's Mac extension boundary.
 *
 * This extension talks to the Cedia host over its authenticated HTTP API.  It
 * intentionally has no OMP process launcher: OMP belongs to the host and the
 * host descriptor is the only way this client discovers a running session.
 */

import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { CediaHostClient, HostDescriptorError, HostHttpError, HostRequestTimeoutError } from "./api.ts";
import type { NativeAction } from "./messages.ts";
import { createInitialTaskState, normalizeSlashCommands, parseCediaUiRequest, reduceTaskState, type LoginProviderOption, type ModelOption, type TaskState } from "./state.ts";
import { CediaIdeAgentProvider } from "./agent-ide-webview.ts";
import { writeAgentThemeSnapshot } from "./agent-theme.ts";
import { fetchGlobalOmpModelSnapshot, fetchOmpModelRoles } from "./omp-catalog.ts";
import { currentModelFromOmpState, modelRoleLabel, sessionIdFromUri, setModelRoleRequest } from "./chat-sessions-map.ts";
import { canAnswer } from "./approval-runtime.ts";
import { approvalCanSubmit, approvalDisplayStatus } from "./approval-view.ts";
import type { ArtifactReceipt } from "./artifact-transfer.ts";
import { ompSettingsCatalog, SETTINGS_SECTIONS } from "./capability-catalog.ts";
import { composerAxesFromTask, resolveComposerControls } from "./composer-runtime.ts";
import { isCediaWorkbenchPalette } from "./cedia-theme.ts";
import { shouldDispatch, type FrozenEnvelope } from "./dispatch-guard.ts";
import { recoveryBanner } from "./recovery-ui.ts";
import { DISCARD_DRAFT_CONFIRM, discardDraftPlan } from "./discard-draft.ts";
import { aboutIdentity } from "./about-identity.ts";
import { alreadyAttached, reduceAttachment, type Attachment } from "./attachment-runtime.ts";
import { buildSubagentTree, emptyPlan, planFromOmpState, type PlanProjection } from "./plan-projection.ts";
import { BRANCH_SELECT_REASON, branchHitsFromHostBranches, type BranchHit } from "./branch-picker.ts";
import { providerGlyphMap } from "./provider-icons.ts";
import { emptyReview, ideLandingForWorkTab, markReviewDirtyConflict, markReviewStale, parseUnifiedDiff, REVIEW_CONFLICT_REASON, reviewCommitPreview, reviewFromGitStatus, reviewOpenMergeEnabled, reviewSummary, reviewWorkspaceLabel, type ReviewSnapshot } from "./review-snapshot.ts";
import { buildSearchHits, emptySearchPalette, SEARCH_INDEX_FAILED_NOTE, type SearchPaletteState } from "./search-palette.ts";
import { applyProductPref, clampSidebarWidth, DEFAULT_PRODUCT_PREFS, isProductPrefSettingKey, normalizeProductPrefs, type ProductPrefs } from "./product-prefs.ts";
import { canInlinePreviewBytes, inlinePreviewMime, mapArtifactsForWebview, type ArtifactPreview } from "./artifact-preview.ts";
import { downloadArtifact } from "./artifact-transfer.ts";
import { applySessionFilters, DEFAULT_SIDEBAR_FILTERS, filterChips, filterEmptyCopy, markAllAsReadScope, normalizeSidebarFilters, type SidebarFilters } from "./sidebar-filters.ts";
import { cediaWindowTitle, FORK_NO_PARENT_REASON, moreMenuActions, NEED_MORE_SPACE_REASON, taskHeaderMeta, type MoreMenuActionId } from "./task-chrome.ts";
import { MISSING_RECENT_REASON, projectAddPlan, projectsWelcomeModel } from "./projects-welcome.ts";
import { parseSuggestionPayload, SUGGEST_ENDPOINT } from "./browser-search.ts";
import { focusUserPtyPlan, newUserPtyPlan, userPtyRows } from "./user-pty.ts";
import { activeLeaf, assignActive, canSplit, closeActive, createLayoutTree, focusView, layoutLeaves, maximizeActive, moveActive, openSessionInSplit, paneDraftKey, parseLayout, restoreLayout, serializeLayout, splitActive, visibleLeaves, type LayoutTree } from "./layout-tree.ts";
import { layoutBoxes, layoutSashes, setSplitRatio } from "./layout-geometry.ts";
import { buildPaneViews, rememberPaneTranscript, type PaneTranscriptCache, type PaneView } from "./pane-views.ts";
import { announceSummary, motionTokens } from "./ui-a11y.ts";
import { redactedDiagnostics } from "./diagnostics.ts";
import { AGENTS_WINDOW_WORKSPACE, allThemeProvidingExtensionIds, consumePendingNativeDestination, DEFAULT_IDE_LAYOUT, draftViewKey, isAgentsWindow, mergeAgentsWindowWorkspaceSettings, modeSwitchProof, normalizeIdeLayout, persistDestinationAcrossReload, queuePendingNativeDestination, rememberIdeChrome, resolveSnapshotThemeName, resolveStartupView, retentionReceipt, runWorkbenchCommands, switchWorkbenchMode, type IdeLayoutSnapshot, type NativeDestination, type RetentionSnapshot } from "./workbench-mode.ts";
import { availabilityFromLists, routeErrorPage, validateRoute, type RouteErrorPage } from "./route-error.ts";
import { applySettingsSection, beginSettingsDraft, previewResetOverride, settingsSourcePath, type ResetOverridePreview, type SettingsSectionDraft } from "./settings-revision.ts";
import { OLDER_PAGES_NOTE } from "./history-page.ts";
import { CLOUD_DESTINATION_REASON, destinationOptions, RELAY_UNKNOWN_REASON, WORKTREE_NO_GIT_REASON } from "./destination-picker.ts";
import { mentionRows } from "./mention-context.ts";
import { bindSettingsCatalogRows, jsonPickerCommands, skillsFromSlashCommands } from "./settings-catalog-rows.ts";
import { shortcutRowsFromContributes } from "./shortcut-rows.ts";
import { canRouteBack, canRouteForward, emptyRouteHistory, rememberRoute, routeBack, routeForward, type RouteFrame, type RouteHistory } from "./route-stack.ts";
import { emptyThinkingParams, messagesPageFromOmp, ompCommandData, parentSessionFromOmpState, THINKING_NOT_ADVERTISED, thinkingFromOmpState, type ThinkingParams } from "./thinking-params.ts";
import { FORK_NOT_CREATED_REASON, ompCommandConfirmed, THINKING_NOT_APPLIED_REASON } from "./omp-result.ts";
import { transcriptEntriesFromOmpMessages } from "./transcript-page.ts";
import { resolveShellLayout, visibleWorkResources, workResourceId, WORK_PANEL_TABS, type ResourceStatus, type WorkPanelTab } from "./work-panel.ts";
import { projectSessionFilterFields } from "./session-row-meta.ts";
import { beginWorktreeReceipt, cancelWorktreeReceipt, failedWorktreeReceipt, idleWorktreeReceipt, readyWorktreeReceipt, type WorktreeReceipt } from "./worktree-receipt.ts";
import { CediaEditorService, type EditorAppliedSummary } from "./editor.ts";
import { AGENT_EDIT_DIFF_SCHEME, agentEditDiffTitle, decodeAgentEditDocId, decodeReviewDocId, encodeAgentEditDocId, encodeReviewDocId, looksBinary, NATIVE_DIFF_BINARY_REASON, NATIVE_DIFF_SCHEME, nativeDiffPlan, resolveReviewTarget } from "./native-diff.ts";
import { cediaCodeActions } from "./code-actions.ts";
import { agentEditLabel, agentEditLenses, agentEditReviewDecision, decorationHover, decorationRange, markRangesFor, revertDecision, type MarkRange, type PendingAgentEdit } from "./agent-edit-marks.ts";
import { selectionAction, selectionPrompt, type SelectionActionId } from "./selection-actions.ts";
import { MAX_TERMINAL_CITATION_CHARS, TERMINAL_NOT_FOCUSED_REASON, terminalCitation } from "./terminal-context.ts";
import { PendingFocus, ViewRegistry } from "./view-registry.ts";
import { RPC_COMMAND_TYPES } from "../../../packages/omp-adapter/src/types.ts";
import QRCode from "qrcode";
import { OmpTerminalViews } from "./terminal.ts";
import type { Command, Json, Project, Session } from "../../../packages/protocol/src/index.ts";
import type { GitMethod, GitMethodInput, GitMethodResult, GitRequest } from "../../../packages/protocol/src/git.ts";


export const HOST_REQUEST_TIMEOUT_MS = 15_000;
/** Upper bound for a cited editor selection. Beyond this the block is cut and
 * labelled so the user is never shown a silently shortened citation. */
export const MAX_SELECTION_CONTEXT_CHARS = 12_000;
export const EVENT_PAGE_LIMIT = 200;
export const POLL_INTERVAL_MS = 1_200;

/** One git operation, answered by the host (§10 item 58).  Every Cedia surface
 * reads git through here, so no concern needs its own `git` process. */
export function requestGit<M extends GitMethod>(client: CediaHostClient, path: string, method: M, input: GitMethodInput<M>): Promise<GitMethodResult<M>> {
	return client.requestApplication<GitMethodResult<M>>("POST", "git", { path, method, input } satisfies GitRequest);
}

export function attachmentCounts(attachments: readonly Attachment[]) {
	return {
		attachmentsReady: attachments.filter(item => item.state === "ready").length,
		attachmentsPending: attachments.filter(item => item.state === "local" || item.state === "uploading").length,
		attachmentsFailed: attachments.filter(item => item.state === "failed").length,
	};
}

export function safeWorkspaceFile(cwd: string, candidate: string): string | undefined {
	if (!candidate || candidate.includes("\0") || isAbsolute(candidate)) return undefined;
	const resolved = resolve(cwd, candidate);
	const rel = relative(cwd, resolved);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
	return resolved;
}

export function extensionNonce(): string {
	return randomBytes(18).toString("base64").replace(/[^a-zA-Z0-9]/g, "");
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function asArray<T>(value: unknown, key: string): T[] {
	if (Array.isArray(value)) return value as T[];
	if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key])) return (value as Record<string, unknown>)[key] as T[];
	return [];
}

export function readStoredRecents(value: unknown): { path: string }[] {
	if (!Array.isArray(value)) return [];
	const paths: { path: string }[] = [];
	for (const item of value) {
		const path = typeof item === "string" ? item.trim() : item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string"
			? (item as { path: string }).path.trim()
			: "";
		if (path && !paths.some(row => row.path === path)) paths.push({ path });
		if (paths.length >= 12) break;
	}
	return paths;
}

export function workspacePath(): string | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder?.uri?.fsPath;
}

export function descriptorStateDir(context: vscode.ExtensionContext): string {
	const configured = String(vscode.workspace.getConfiguration("cedia").get("hostStateDir", "")).trim();
	return resolve(configured || join(homedir(), "Library", "Application Support", "Cedia", "host"));
}

export function hostSetupMessage(stateDir: string): string {
	return `Cedia host is offline. Configure cedia.hostNodePath and cedia.hostScriptPath, then start the host (state: ${stateDir}).`;
}

export class HostSetupRequiredError extends Error {
	readonly code = "host-not-running";
	constructor(message: string) {
		super(message);
		this.name = "HostSetupRequiredError";
	}
}

export interface HostProcessOptions {
	readonly extensionPath: string;
	readonly stateDir: string;
	readonly config: vscode.WorkspaceConfiguration;
}

/** Starts only the configured Cedia host helper, never OMP itself. */
export class ConfiguredHostProcess {
	readonly #extensionPath: string;
	readonly #stateDir: string;
	readonly #config: vscode.WorkspaceConfiguration;
	#child: ChildProcess | undefined;

	constructor(options: HostProcessOptions) {
		this.#extensionPath = options.extensionPath;
		this.#stateDir = options.stateDir;
		this.#config = options.config;
	}

	async start(): Promise<void> {
		const bundledNode = join(this.#extensionPath, "runtime/node/bin/node");
		const bundledScript = join(this.#extensionPath, "runtime/host/cli.js");
		const nodePath = String(this.#config.get("hostNodePath", "")).trim() || (existsSync(bundledNode) ? bundledNode : "");
		const scriptPath = String(this.#config.get("hostScriptPath", "")).trim() || (existsSync(bundledScript) ? bundledScript : "");
		if (!nodePath || !scriptPath) throw new HostSetupRequiredError(hostSetupMessage(this.#stateDir));
		if (this.#child && this.#child.exitCode === null) return;
		let child: ChildProcess;
		try {
			child = spawn(nodePath, [scriptPath, "ensure"], {
				cwd: workspacePath(),
				// The host runs detached so it can outlive this launcher, so it also needs
				// to know which process started it: its watchdog stops a host whose app is
				// gone and which nothing else still needs (apps/host/src/host-lifetime.ts).
				env: { ...process.env, CEDIA_STATE_DIR: this.#stateDir, CEDIA_PARENT_PID: String(process.pid) },
				stdio: "ignore",
				detached: true,
			});
		} catch (error) {
			throw new HostSetupRequiredError(`Cannot start Cedia host helper: ${errorMessage(error)}`);
		}
		this.#child = child;
		child.unref();
	}
}

// Item 63a: deleted with the hand-drawn task shell — the dock renders the shared
// bundle through CediaIdeAgentProvider now. Kept as a named stub so item 66 can see
// exactly what the split removes (no other callers remain).
export function cloneStateForWebview(_state: unknown, _extras: unknown = {}): unknown {
	void _state;
	void _extras;
	throw new Error("Cedia task shell was removed (item 63a)");
}

export function editorMentionContext(): { hasSelection: boolean; selectionPreview?: string } {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.selection.isEmpty) return { hasSelection: false };
	const preview = editor.document.getText(editor.selection).replace(/\s+/g, " ").trim().slice(0, 80);
	return { hasSelection: true, ...(preview ? { selectionPreview: preview } : {}) };
}

export function appearanceValues(prefs: ProductPrefs): Record<string, unknown> {
	return {
		density: prefs.density,
		panelPosition: prefs.panelPosition,
		submitEnter: prefs.submitEnter,
		reduceMotion: prefs.reduceMotion,
		highContrast: prefs.highContrast,
		startupView: prefs.startupView,
		windowRestore: prefs.windowRestore,
		autoHideEmptyIde: prefs.autoHideEmptyIde,
	};
}

export function a11yRun(state: TaskState): "idle" | "running" | "stopping" | "waiting" | "unknown" {
	if (state.connection === "unknown" || Object.values(state.pendingCommands).some((command) => command.status === "unknown")) return "unknown";
	if (state.uiRequests.length > 0) return "waiting";
	if (state.connection === "running") return "running";
	return "idle";
}

export function normalizeProject(value: unknown): Project | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = value as Record<string, unknown>;
	if (typeof item.id !== "string" || typeof item.path !== "string") return undefined;
	return item as unknown as Project;
}

/**
 * Host session ids from whatever the caller passed.
 *
 * The Agents window's session list hands over its own ids, which are the chat
 * session resources (`cedia://session/<id>`); a caller that already holds host ids
 * passes those. Both are accepted, and anything else is dropped rather than guessed
 * at, so a malformed hint deletes nothing instead of the wrong chat.
 */
export function hostSessionIdsFromHint(hint: unknown): string[] {
	const values = Array.isArray(hint) ? hint : [hint];
	const ids = new Set<string>();
	for (const value of values) {
		if (typeof value !== "string" || value.length === 0) continue;
		const hostId = value.includes("://") ? sessionIdFromUri(vscode.Uri.parse(value)) : value;
		if (hostId) ids.add(hostId);
	}
	return [...ids];
}

export function normalizeSession(value: unknown): Session | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = value as Record<string, unknown>;
	if (typeof item.id !== "string" || typeof item.projectId !== "string" || typeof item.incarnation !== "string") return undefined;
	return item as unknown as Session;
}

export function normalizeModels(value: unknown): ModelOption[] {
	if (value && typeof value === "object" && !Array.isArray(value) && "data" in value) {
		return normalizeModels((value as Record<string, unknown>).data);
	}
	const raw = asArray<Record<string, unknown>>(value, "models");
	return raw.flatMap((item): ModelOption[] => {
		const id = typeof item.id === "string" ? item.id : typeof item.modelId === "string" ? item.modelId : undefined;
		if (!id) return [];
		const provider = typeof item.provider === "string" ? item.provider : undefined;
		return [{ ...item, id, provider, label: typeof item.label === "string" ? item.label : provider ? `${provider} / ${id}` : id, available: item.available !== false }];
	});
}

export function normalizeLoginProviders(value: unknown): LoginProviderOption[] {
	if (value && typeof value === "object" && !Array.isArray(value) && "data" in value) {
		return normalizeLoginProviders((value as Record<string, unknown>).data);
	}
	const raw = asArray<Record<string, unknown>>(value, "providers");
	return raw.flatMap((item): LoginProviderOption[] => {
		const id = typeof item.id === "string" ? item.id : undefined;
		if (!id) return [];
		return [{
			id,
			name: typeof item.name === "string" ? item.name : id,
			available: item.available !== false,
			authenticated: item.authenticated === true,
		}];
	});
}

export function commandId(): string {
	try { return randomUUID(); } catch { return `cedia-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
}

/** One host connection and one webview projection per extension instance. */

/** Commands are invoked from several native surfaces. The editor title and
 * Explorer pass a Uri, while the Source Control menus pass a resource state
 * whose `resourceUri` is the file. Accept both and reject anything else. */
export function commandResourceUri(value: unknown): vscode.Uri | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as { scheme?: unknown; resourceUri?: unknown };
	if (typeof candidate.scheme === "string") return value as vscode.Uri;
	const nested = candidate.resourceUri as { scheme?: unknown } | undefined;
	if (nested && typeof nested.scheme === "string") return nested as vscode.Uri;
	return undefined;
}

/** The pinned Code-OSS runtime exposes `Terminal.selection`
 * (`src/vs/workbench/api/common/extHostTerminalService.ts`, fed by
 * `$acceptTerminalSelection`), but the `vscode.d.ts` in this checkout predates
 * the declaration. Read it structurally so the citation quotes the engine's
 * real selection instead of inventing a second source for it. */
export function terminalSelectionOf(terminal: vscode.Terminal): string {
	return (terminal as vscode.Terminal & { readonly selection?: string }).selection ?? "";
}
