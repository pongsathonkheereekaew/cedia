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
import { AGENTS_WINDOW_WORKSPACE, themeProvidingExtensionIds, consumePendingNativeDestination, DEFAULT_IDE_LAYOUT, draftViewKey, isAgentsWindow, mergeAgentsWindowWorkspaceSettings, modeSwitchProof, normalizeIdeLayout, persistDestinationAcrossReload, queuePendingNativeDestination, rememberIdeChrome, resolveSnapshotThemeName, resolveStartupView, retentionReceipt, runWorkbenchCommands, switchWorkbenchMode, type IdeLayoutSnapshot, type NativeDestination, type RetentionSnapshot } from "./workbench-mode.ts";
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
import { attachmentCounts, safeWorkspaceFile, extensionNonce, errorMessage, asArray, readStoredRecents, workspacePath, descriptorStateDir, hostSetupMessage, cloneStateForWebview, editorMentionContext, appearanceValues, a11yRun, normalizeProject, hostSessionIdsFromHint, normalizeSession, normalizeModels, normalizeLoginProviders, commandId, HOST_REQUEST_TIMEOUT_MS, MAX_SELECTION_CONTEXT_CHARS, EVENT_PAGE_LIMIT, POLL_INTERVAL_MS, HostSetupRequiredError, ConfiguredHostProcess, HostProcessOptions } from "./task-runtime.ts";
import { registerCediaCommands } from "./task-commands.ts";
import { AGENTS_WINDOW_THEME_SETTING_KEYS, syncAgentsWindowTheme } from "./task-theme-sync.ts";
import { ProviderState } from "./provider-state.ts";
import type { CediaTaskViewProviderApi } from "./provider-api.ts";
import { installProviderConcerns } from "./provider-registry.ts";

/** Item 66: the provider type — the API interface merged with the leaf class, so
 * every member is type-checked while the bodies live in provider-*.ts slices
 * installed on the prototype below. */
export interface CediaTaskViewProvider extends CediaTaskViewProviderApi {}
export class CediaTaskViewProvider extends ProviderState {
	constructor(context: vscode.ExtensionContext) {
		super();
		this.context = context;
		this.log = vscode.window.createOutputChannel("Cedia", { log: true });
		context.subscriptions.push(this.log);
		this.stateDir = descriptorStateDir(context);
		const config = vscode.workspace.getConfiguration("cedia");
		const configuredTimeout = Number(config.get("hostRequestTimeoutMs", HOST_REQUEST_TIMEOUT_MS));
		this.hostTimeoutMs = Number.isSafeInteger(configuredTimeout) && configuredTimeout >= 1_000 && configuredTimeout <= 2_147_483_647 ? configuredTimeout : HOST_REQUEST_TIMEOUT_MS;
		this.hostProcess = new ConfiguredHostProcess({ stateDir: this.stateDir, config, extensionPath: context.extensionPath });
		this.agentsStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
		this.agentsStatus.command = "cedia.showAgents";
		this.renderAgentsStatus();
		this.context.subscriptions.push(this.agentsStatus);
		this.recents = readStoredRecents(context.globalState.get("cedia.recentFolders"));
		this.layout = parseLayout(context.globalState.get("cedia.layoutTree")) ?? createLayoutTree();
		const draftMigration = context.globalState.get<{ version?: unknown }>("cedia.drafts.migration");
		const storedDrafts = context.globalState.get<Record<string, string>>("cedia.drafts");
		if (draftMigration?.version !== 1 && storedDrafts && typeof storedDrafts === "object") {
			this.state = { ...this.state, drafts: storedDrafts };
			this.draftPersistOk = true;
		}
		this.prefs = normalizeProductPrefs(context.globalState.get("cedia.productPrefs"));
		this.sidebarFilters = normalizeSidebarFilters(context.globalState.get("cedia.sidebarFilters"));
		this.lastSentDraft = typeof context.globalState.get("cedia.lastSentDraft") === "string" ? String(context.globalState.get("cedia.lastSentDraft")) : "";
		const storedRevision = Number(context.globalState.get("cedia.settingsRevision"));
		this.settingsRevision = Number.isFinite(storedRevision) && storedRevision >= 0 ? Math.trunc(storedRevision) : 0;
		this.ideLayout = this.prefs.windowRestore
			? normalizeIdeLayout(context.globalState.get("cedia.ideLayout"), DEFAULT_IDE_LAYOUT)
			: DEFAULT_IDE_LAYOUT;
		this.queueCollapsed = context.globalState.get("cedia.queueCollapsed") === true;
		const storedDestination = context.globalState.get("cedia.pendingNativeDestination");
		if (storedDestination === "explorer") this.pendingNativeDestination = "explorer";
		this.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
			if (this.agentsChromeApplied) return;
			this.ideLayout = rememberIdeChrome(this.ideLayout, {
				activeEditorUri: editor?.document.uri.toString() ?? this.ideLayout.activeEditorUri,
			});
			void this.context.globalState.update("cedia.ideLayout", this.ideLayout);
		}));
		this.context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(editors => {
			if (!this.prefs.autoHideEmptyIde) return;
			// Native world: only the agents workspace may strip chrome. A plain
			// IDE window keeps full chrome even when it has no editors open.
			if (!this.inAgentsWindow()) return;
			if (this.agentsChromeApplied || this.state.workbenchMode !== "ide") return;
			const remaining = editors.filter(editor => editor.document.uri.scheme !== "untitled" || editor.document.getText().length > 0);
			if (remaining.length === 0) void this.setWorkbenchMode("agents");
		}));
		this.context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
			const next = this.userPtys.map(item => item.terminal === terminal ? { ...item, preview: { ...item.preview, ended: true } } : item);
			if (next.some((item, index) => item !== this.userPtys[index])) {
				this.userPtys = next;
				if (next.every(item => item.preview.ended)) this.expireWorkResource("terminal");
				else this.setWorkResource("terminal", "live");
			}
		}));
		// A saved edit has been kept, and a closed document has nothing left to
		// mark: both drop the pending record so the title buttons stay honest.
		this.context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
			if (this.agentEdits.delete(document.uri.toString())) this.refreshAgentEditMarks();
		}));
		this.context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
			if (this.agentEdits.delete(document.uri.toString())) this.refreshAgentEditMarks();
		}));
		this.context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => {
			if (this.agentEdits.size > 0) this.refreshAgentEditMarks();
		}));
		this.state = reduceTaskState(this.state, { type: "work_panel", action: { type: "set_position", position: this.prefs.panelPosition } });
		const storedPanel = context.globalState.get<Record<string, unknown>>("cedia.workPanelLayout");
		if (storedPanel && typeof storedPanel === "object") {
			this.state = reduceTaskState(this.state, {
				type: "work_panel",
				action: {
					type: "set_size",
					...(typeof storedPanel.preferredWidth === "number" ? { preferredWidth: storedPanel.preferredWidth } : {}),
					...(typeof storedPanel.preferredHeight === "number" ? { preferredHeight: storedPanel.preferredHeight } : {}),
				},
			});
		}
	}
}

/** The concern slices are prototype methods, not class members: install them once,
 * before any instance exists. */
installProviderConcerns(CediaTaskViewProvider.prototype as unknown as CediaTaskViewProviderApi);


/** Commands are invoked from several native surfaces. The editor title and
 * Explorer pass a Uri, while the Source Control menus pass a resource state
 * whose `resourceUri` is the file. Accept both and reject anything else. */
function commandResourceUri(value: unknown): vscode.Uri | undefined {
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
function terminalSelectionOf(terminal: vscode.Terminal): string {
	return (terminal as vscode.Terminal & { readonly selection?: string }).selection ?? "";
}

export function activate(context: vscode.ExtensionContext): void {
	if (!vscode.workspace.isTrusted) {
		activateRestrictedWorkspace(vscode, context, () => activate(context));
		return;
	}
	// The Agents window is a second workbench on its own profile, so nothing here reaches it by
	// itself: not the theme, and not the permission the theme's own extension needs (see
	// task-theme-sync). Doing it at activation - and again whenever the choice changes -
	// means the window is right whichever route opened it.
	const stateDir = descriptorStateDir(context);
	void syncAgentsWindowTheme(context.globalStorageUri, stateDir);
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (AGENTS_WINDOW_THEME_SETTING_KEYS.some(key => event.affectsConfiguration(key))) void syncAgentsWindowTheme(context.globalStorageUri, stateDir);
	}));
	const provider = new CediaTaskViewProvider(context);
	const ideAgent = new CediaIdeAgentProvider(context, descriptorStateDir(context), () => provider.ensureClient(), id => provider.syncIdeSession(id));
	provider.ideAppendContext = text => ideAgent.appendContext(text);
	const draftMigrationState = context.globalState.get<{ version?: unknown }>("cedia.drafts.migration");
	const storedDraftsForMigration = context.globalState.get<unknown>("cedia.drafts");
	if (draftMigrationState?.version !== 1 && storedDraftsForMigration && typeof storedDraftsForMigration === "object"
		&& !Array.isArray(storedDraftsForMigration) && Object.keys(storedDraftsForMigration).length > 0) {
		void provider.ensureClient().catch(error => provider.log.warn(`legacy draft migration remains pending: ${errorMessage(error)}`));
	}
	context.subscriptions.push(
		provider,
		ideAgent,
		vscode.window.registerWebviewViewProvider("cediaComposerDock", ideAgent, { webviewOptions: { retainContextWhenHidden: true } }),
		// The chrome palette follows the active theme kind (Cursor ships light
		// and dark), so repaint the dock when the user switches themes.
		vscode.window.onDidChangeActiveColorTheme(() => {
			provider.reapplyWorkbenchAppearance();
			void syncAgentsWindowTheme(context.globalStorageUri, stateDir);
		}),
		// Original side of a task review diff. Code-OSS renders the diff editor;
		// this only serves the read-only "before" text for one workspace path.
		vscode.workspace.registerTextDocumentContentProvider(NATIVE_DIFF_SCHEME, provider.diffContentProvider()),
		// Original side of the "review the Cedia edit" diff: the recorded
		// pre-edit text for a Cedia edit that is still pending.
		vscode.workspace.registerTextDocumentContentProvider(AGENT_EDIT_DIFF_SCHEME, provider.agentEditBeforeProvider()),
		...registerCediaCommands(vscode, provider, ideAgent),
		// Native lightbulb / Quick Fix surface: the same Cedia actions as the
		// context menus, reachable from the keyboard the way a Cursor-class IDE
		// user reaches for them.
		vscode.languages.registerCodeActionsProvider("*", {
			provideCodeActions: (document: vscode.TextDocument, range: vscode.Range) => provider.codeActionsFor(document, range),
		}, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
		// The decisions on a Cedia edit, on the change itself: the Cursor-class
		// Accept/Reject placement, wired to the same two real commands.
		vscode.languages.registerCodeLensProvider({ scheme: "file" }, provider.agentEditLensesProvider()),
	);
	provider.applyStartupView();
}

export function deactivate(): void { }
