import type { CediaTaskViewProviderApi } from "./provider-api.ts";
import { ConfiguredHostProcess, commandId } from "./task-runtime.ts";

/** Item 66: the provider's state, extracted from extension.ts. Fields are plain
 * (the concern slices in provider-*.ts read them through CediaTaskViewProviderApi);
 * `agentEditDecorationHandle`/`reviewCwdCache` are the renamed originals so a field
 * and a method can no longer share a name. Initializers are unchanged. */

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
import { promisify } from "node:util";
import { CediaHostClient, HostDescriptorError, HostHttpError, HostRequestTimeoutError } from "./api.ts";
import type { NativeAction } from "./messages.ts";
import { createInitialTaskState, normalizeSlashCommands, parseCediaUiRequest, reduceTaskState, type LoginProviderOption, type ModelOption, type TaskState } from "./state.ts";
import { CediaIdeAgentProvider } from "./agent-ide-webview.ts";
import { writeAgentThemeSnapshot } from "./agent-theme.ts";
import { fetchGlobalOmpModelSnapshot, fetchOmpModelRoles } from "./omp-catalog.ts";
import { currentModelFromOmpState, modelRoleLabel, sessionIdFromUri, setModelRoleRequest } from "./chat-sessions-map.ts";
import { canAnswer } from "./approval-runtime.ts";
import { approvalCanSubmit, approvalDisplayStatus } from "./approval-view.ts";
import type { ArtifactReceipt } from "../../../packages/protocol/src/artifacts.ts";
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


export class ProviderState {
	agentsChromeApplied = false;
	ideAppendContext: ((text: string) => Promise<void>) | undefined;

	context!: vscode.ExtensionContext;
	/** Durable diagnostics surface. Startup and background failures have no
	 * webview to receive them, so without this they are invisible after the
	 * fact; LogOutputChannel-based channels are written to disk by the host. */
	log!: vscode.LogOutputChannel;
	stateDir!: string;
	hostTimeoutMs!: number;
	hostProcess!: ConfiguredHostProcess;
	/** Every resolved task view: the activity-bar view and the secondary-side-bar
	 * dock can both be open, so each surface receives the same snapshots. A
	 * single field silently dropped one of them. */
	views = new ViewRegistry<vscode.WebviewView>();
	/** A composer focus requested before the dock view resolved for the first time. */
	pendingComposerFocus = new PendingFocus();
	client: CediaHostClient | undefined;
	state: TaskState = createInitialTaskState();
	pollTimer: ReturnType<typeof setInterval> | undefined;
	polling = false;
	navigationEpoch = 0;
	searchEpoch = 0;
	editor = new CediaEditorService({ api: vscode, beforeApply: async requestId => {
		if (!requestId || !this.client || this.disposed) return false;
		try { return (await this.client.editorRequestValid(this.editorId, requestId)).valid; } catch { return false; }
	}, afterApply: summary => (this as unknown as CediaTaskViewProviderApi).recordAgentEdit(summary) });
	editorId = randomUUID();
	editorPolling = false;
	terminals = new OmpTerminalViews(async (sessionId, incarnation, command, payload) => {
		const client = await (this as unknown as CediaTaskViewProviderApi).ensureClient();
		const result = await client.sendCommand(sessionId, { commandId: commandId(), incarnation, command, payload });
		if (result.status !== "completed") throw new Error(result.error ?? "Input outcome is unknown; input was not repeated");
	});
	disposed = false;
	ideLayout: IdeLayoutSnapshot = DEFAULT_IDE_LAYOUT;
	answeredUi = new Set<string>();
	lastFrozen: FrozenEnvelope | undefined;
	inFlightCommandId: string | undefined;
	draftRevision = 0;
	attachments: Attachment[] = [];
	review: ReviewSnapshot = emptyReview();
	reviewPorcelain?: string;
	reviewCwdCache?: string;
	userPtys: { terminal: vscode.Terminal; preview: { id: string; title: string; cwd: string; ended: boolean } }[] = [];
	recents: { path: string }[] = [];
	layout: LayoutTree = createLayoutTree();
	routeHistory: RouteHistory = emptyRouteHistory();
	projectsRoute = false;
	transcriptIndex: Record<string, { readonly title?: string; readonly text: string }> = {};
	paneTranscripts: PaneTranscriptCache = {};
	modelsFetchedFor?: string;
	devices: { id: string; name: string; role: string; revokedAt?: string }[] = [];
	devicesError?: string;
	lastHostSyncAt?: string;
	search: SearchPaletteState = emptySearchPalette();
	agentsStatus: vscode.StatusBarItem | undefined;
	prefs: ProductPrefs = DEFAULT_PRODUCT_PREFS;
	uiSeen = new Map<string, number>();
	artifacts: ArtifactReceipt[] = [];
	artifactsError?: string;
	gitBranch?: string;
	branches: BranchHit[] = [];
	draftBranchRef?: string;
	markedUnread = false;
	sidebarFilters: SidebarFilters = DEFAULT_SIDEBAR_FILTERS;
	worktreeReceipt: WorktreeReceipt = idleWorktreeReceipt();
	lastSentDraft = "";
	/** Edits Cedia applied to an open buffer and has not yet seen saved or
	 * taken back, keyed by document uri. */
	agentEdits = new Map<string, PendingAgentEdit>();
	/** Files whose in-editor lenses were already reported, so the Channel shows
	 * the first offer per file instead of one line per render. */
	agentEditLensLogged = new Set<string>();
	/** The engine caches CodeLens results until onDidChangeCodeLenses fires, and
	 * the decisions come from pending state rather than document content, so
	 * every change to that state must invalidate the cached lenses. */
	agentEditLensesChanged = new vscode.EventEmitter<void>();
	agentEditDecorationHandle: vscode.TextEditorDecorationType | undefined;
	pendingNativeDestination?: NativeDestination;
	settingsRevision = 0;
	settingsDraft?: SettingsSectionDraft;
	settingsApplyError?: string;
	settingsResetPreview?: ResetOverridePreview;
	routeError?: RouteErrorPage;
	historyNote?: string;
	thinking: ThinkingParams = emptyThinkingParams();
	parentSession?: string;
	olderPagesAdvertised = false;
	olderPageCount = 0;
	messageCursor?: string;
	ompPlan: PlanProjection = emptyPlan();
	queueCollapsed = false;
	draftPersistOk = false;
	lastGoodByName: Record<string, ArtifactPreview> = {};
	viewport = { width: 1200, height: 800 };
	retentionBefore: RetentionSnapshot = { sessionId: "", draft: "", scrollEventId: "", mode: "agents" };
	inlinePreview?: { sha256: string; dataUrl?: string; text?: string; kind: string };

}
