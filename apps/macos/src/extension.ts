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
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { CediaHostClient, HostDescriptorError, HostHttpError, HostRequestTimeoutError } from "./api.ts";
import { parseWebviewMessage, type NativeAction, type WebviewMessage } from "./messages.ts";
import { createInitialTaskState, normalizeSlashCommands, parseCediaUiRequest, reduceTaskState, type LoginProviderOption, type ModelOption, type TaskState } from "./state.ts";
import { createTaskWebviewHtml } from "./webview.ts";
import { CediaIdeAgentProvider } from "./agent-ide-webview.ts";
import { writeAgentThemeSnapshot } from "./agent-theme.ts";
import { fetchGlobalOmpModelSnapshot, fetchOmpModelRoles } from "./omp-catalog.ts";
import { modelRoleLabel, sessionIdFromUri, setModelRoleRequest } from "./chat-sessions-map.ts";
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
import { BRANCH_SELECT_REASON, parseGitBranchList, type BranchHit } from "./branch-picker.ts";
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
import { AGENT_EDIT_DIFF_SCHEME, agentEditDiffTitle, decodeAgentEditDocId, decodeReviewDocId, encodeAgentEditDocId, encodeReviewDocId, looksBinary, NATIVE_DIFF_BINARY_REASON, NATIVE_DIFF_SCHEME, nativeDiffPlan, resolveReviewTarget, reviewOriginalArgs } from "./native-diff.ts";
import { cediaCodeActions } from "./code-actions.ts";
import { agentEditLabel, agentEditLenses, agentEditReviewDecision, decorationHover, decorationRange, markRangesFor, revertDecision, type MarkRange, type PendingAgentEdit } from "./agent-edit-marks.ts";
import { selectionAction, selectionPrompt, type SelectionActionId } from "./selection-actions.ts";
import { MAX_TERMINAL_CITATION_CHARS, TERMINAL_NOT_FOCUSED_REASON, terminalCitation } from "./terminal-context.ts";
import { PendingFocus, ViewRegistry } from "./view-registry.ts";
import { RPC_COMMAND_TYPES } from "../../../packages/omp-adapter/src/types.ts";
import QRCode from "qrcode";
import { OmpTerminalViews } from "./terminal.ts";
import type { Command, Json, Project, Session } from "../../../packages/protocol/src/index.ts";

const HOST_REQUEST_TIMEOUT_MS = 15_000;
/** Upper bound for a cited editor selection. Beyond this the block is cut and
 * labelled so the user is never shown a silently shortened citation. */
const MAX_SELECTION_CONTEXT_CHARS = 12_000;
const EVENT_PAGE_LIMIT = 200;
const POLL_INTERVAL_MS = 1_200;
const execFileAsync = promisify(execFile);

function attachmentCounts(attachments: readonly Attachment[]) {
	return {
		attachmentsReady: attachments.filter(item => item.state === "ready").length,
		attachmentsPending: attachments.filter(item => item.state === "local" || item.state === "uploading").length,
		attachmentsFailed: attachments.filter(item => item.state === "failed").length,
	};
}

function safeWorkspaceFile(cwd: string, candidate: string): string | undefined {
	if (!candidate || candidate.includes("\0") || isAbsolute(candidate)) return undefined;
	const resolved = resolve(cwd, candidate);
	const rel = relative(cwd, resolved);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
	return resolved;
}

function extensionNonce(): string {
	return randomBytes(18).toString("base64").replace(/[^a-zA-Z0-9]/g, "");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function asArray<T>(value: unknown, key: string): T[] {
	if (Array.isArray(value)) return value as T[];
	if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key])) return (value as Record<string, unknown>)[key] as T[];
	return [];
}

function readStoredRecents(value: unknown): { path: string }[] {
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

function workspacePath(): string | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder?.uri?.fsPath;
}

function descriptorStateDir(context: vscode.ExtensionContext): string {
	const configured = String(vscode.workspace.getConfiguration("cedia").get("hostStateDir", "")).trim();
	return resolve(configured || join(homedir(), "Library", "Application Support", "Cedia", "host"));
}

function hostSetupMessage(stateDir: string): string {
	return `Cedia host is offline. Configure cedia.hostNodePath and cedia.hostScriptPath, then start the host (state: ${stateDir}).`;
}

class HostSetupRequiredError extends Error {
	readonly code = "host-not-running";
	constructor(message: string) {
		super(message);
		this.name = "HostSetupRequiredError";
	}
}

interface HostProcessOptions {
	readonly extensionPath: string;
	readonly stateDir: string;
	readonly config: vscode.WorkspaceConfiguration;
}

/** Starts only the configured Cedia host helper, never OMP itself. */
class ConfiguredHostProcess {
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

function cloneStateForWebview(state: TaskState, extras: {
	readonly attachments?: readonly Attachment[];
	readonly review?: ReviewSnapshot;
	readonly devices?: readonly { id: string; name: string; role: string; revokedAt?: string }[];
	readonly devicesError?: string;
	readonly lastHostSyncAt?: string;
	readonly search?: SearchPaletteState;
	readonly prefs?: ProductPrefs;
	readonly terminals?: readonly { id: string; title: string; ended: boolean; truncated: boolean; text: string; kind?: "user" | "agent"; cwd?: string }[];
	readonly artifacts?: readonly ArtifactReceipt[];
	readonly artifactsError?: string;
	readonly gitBranch?: string;
	readonly markedUnread?: boolean;
	readonly sidebarFilters?: SidebarFilters;
	readonly lastSentDraft?: string;
	readonly settingsRevision?: number;
	readonly settingsDraft?: SettingsSectionDraft;
	readonly settingsApplyError?: string;
	readonly settingsResetPreview?: ResetOverridePreview;
	readonly routeError?: RouteErrorPage;
	readonly historyNote?: string;
	readonly lastGoodByName?: Readonly<Record<string, ArtifactPreview>>;
	readonly viewport?: { readonly width: number; readonly height: number };
	readonly retention?: ReturnType<typeof retentionReceipt>;
	readonly inlinePreview?: { readonly sha256: string; readonly dataUrl?: string; readonly text?: string; readonly kind: string };
	readonly mentionContext?: { readonly hasSelection: boolean; readonly selectionPreview?: string };
	readonly mentions?: readonly { readonly id: string; readonly kind: string; readonly label: string; readonly insert?: string; readonly enabled: boolean; readonly reason?: string; readonly action: string }[];
	readonly settingsRows?: readonly { readonly id: string; readonly section: string; readonly label: string; readonly value: string; readonly source: string; readonly scope: string; readonly writable: boolean; readonly reason?: string }[];
	readonly thinking?: ThinkingParams;
	readonly hasParent?: boolean;
	readonly parentSession?: string;
	readonly olderPagesAdvertised?: boolean;
	readonly olderPageCount?: number;
	readonly ompPlan?: PlanProjection;
	readonly queueCollapsed?: boolean;
	readonly draftPersistOk?: boolean;
	readonly branches?: readonly BranchHit[];
	readonly draftBranchRef?: string;
	readonly cediaVersion?: string;
	readonly extensionVersion?: string;
	readonly codeOssVersion?: string;
	readonly welcome?: ReturnType<typeof projectsWelcomeModel>;
	readonly userPtys?: ReturnType<typeof userPtyRows>;
	readonly layout?: unknown;
	readonly layoutPanes?: readonly PaneView[];
	readonly layoutAxis?: "single" | "row" | "column";
	readonly layoutRatio?: number;
	readonly paneMaximized?: boolean;
	readonly canMoveLeft?: boolean;
	readonly canMoveRight?: boolean;
	readonly canMoveUp?: boolean;
	readonly canMoveDown?: boolean;
	readonly layoutBoxes?: readonly { readonly viewId: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
	readonly layoutSashes?: readonly { readonly orientation: "row" | "column"; readonly x: number; readonly y: number; readonly length: number; readonly thickness: 2; readonly firstViewId: string }[];
	readonly browserBridge?: boolean;
	readonly shortcutRows?: readonly { readonly id: string; readonly command: string; readonly title: string; readonly keybinding: string }[];
	readonly scrollKey?: string;
	readonly routeKind?: "projects" | "task";
	readonly canRouteBack?: boolean;
	readonly canRouteForward?: boolean;
	readonly worktreeReceipt?: WorktreeReceipt;
} = {}): unknown {
	const clone = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
	const attachments = extras.attachments ?? [];
	const axes = composerAxesFromTask(state, attachmentCounts(attachments));
	const connection = state.connection === "connecting" ? "reconnecting" : state.connection === "connected" || state.connection === "running" ? "online" : state.connection === "unknown" ? "offline" : "offline";
	const mappedArtifacts = mapArtifactsForWebview(extras.artifacts ?? [], extras.lastGoodByName ?? {});
	const sidebarFilters = extras.sidebarFilters ?? DEFAULT_SIDEBAR_FILTERS;
	const projectedSessions = state.sessions.map(session => projectSessionFilterFields(session));
	const visibleSessions = applySessionFilters(projectedSessions, sidebarFilters, {
		drafts: state.drafts,
		selectedSessionId: state.session?.id,
	});
	return {
		...clone,
		composer: resolveComposerControls(axes),
		recovery: recoveryBanner({
			connection,
			draftSaved: extras.draftPersistOk === true,
			outcomeUnknown: state.connection === "unknown" || Object.values(state.pendingCommands).some(command => command.status === "unknown"),
			pendingApprovals: state.uiRequests.length,
		}),
		workTabs: [...WORK_PANEL_TABS],
		visibleResources: visibleWorkResources(state.workPanel),
		settingsSections: [...SETTINGS_SECTIONS],
		catalog: ompSettingsCatalog({
			models: state.models.map(model => ({ id: model.id, label: model.label, provider: model.provider, authenticated: model.available !== false })),
			loginProviders: state.loginProviders,
			browserBridge: false,
			voice: false,
			cloud: false,
			automations: false,
		}),
		attachments,
		uiRequests: state.uiRequests.map(item => {
			const displayStatus = approvalDisplayStatus({
				token: item.token,
				requestId: item.request.id,
				sessionId: item.sessionId,
				incarnation: item.incarnation,
				method: item.request.method,
				cwd: item.cwd,
				tool: item.tool,
				target: item.target,
				timeout: "timeout" in item.request ? item.request.timeout : undefined,
				receivedAt: item.receivedAt,
				status: item.status,
			}, {
				sessionId: state.session?.id,
				incarnation: state.session?.incarnation,
				connection: state.connection,
			});
			return {
				...item,
				displayStatus,
				canSubmit: approvalCanSubmit(displayStatus, state.connection),
			};
		}),
		review: (() => {
			const review = extras.review ?? emptyReview(state.session?.cwd ?? state.project?.path ?? "");
			return {
				...review,
				summary: reviewSummary(review.files, review.hunks),
				workspaceLabel: reviewWorkspaceLabel(review.cwd, extras.gitBranch),
				commit: reviewCommitPreview({
					branch: extras.gitBranch,
					files: review.files,
				}),
			};
		})(),
		plan: extras.ompPlan?.advertised === true
			? { ...extras.ompPlan, subagentTree: buildSubagentTree(extras.ompPlan.subagents) }
			: emptyPlan(),
		devices: extras.devices ?? [],
		devicesError: extras.devicesError,
		lastHostSyncAt: extras.lastHostSyncAt,
		// Provider marks for the dock's model picker (see provider-icons.ts): static data, so the
		// webview never fetches an icon and never parses markup for one.
		providerGlyphs: providerGlyphMap(),
		hostReachable: state.connection === "connected" || state.connection === "running",
		relayStatus: "unknown",
		destinations: destinationOptions({
			hasGit: Boolean(extras.gitBranch),
			hostReachable: state.connection === "connected" || state.connection === "running",
			relayStatus: "unknown",
			projectName: state.project?.name,
		}),
		search: extras.search ?? emptySearchPalette(),
		prefs: extras.prefs ?? DEFAULT_PRODUCT_PREFS,
		terminals: extras.terminals ?? [],
		artifacts: mappedArtifacts.artifacts,
		artifactsError: extras.artifactsError,
		gitBranch: extras.gitBranch,
		branches: extras.branches ?? [],
		draftBranchRef: extras.draftBranchRef,
		about: aboutIdentity({
			cediaVersion: extras.cediaVersion,
			extensionVersion: extras.extensionVersion,
			codeOssVersion: extras.codeOssVersion,
			connection: state.connection,
		}),
		markedUnread: extras.markedUnread === true,
		sidebarFilters,
		visibleSessions,
		filterChips: filterChips(sidebarFilters),
		markAllRead: markAllAsReadScope(visibleSessions.length),
		filterEmpty: filterEmptyCopy(state.sessions.length > 0, visibleSessions.length),
		lastSentDraft: extras.lastSentDraft || "",
		project: state.project ? { ...(clone.project as object), ...(extras.gitBranch ? { branch: extras.gitBranch } : {}) } : null,
		headerMeta: taskHeaderMeta({
			projectName: state.project?.name,
			path: state.project?.path,
			branch: extras.draftBranchRef || extras.gitBranch,
			cwd: state.session?.cwd ?? state.project?.path,
			parentSession: extras.hasParent ? extras.parentSession : undefined,
		}),
		a11ySummary: announceSummary({
			connection: state.connection === "connecting" ? "reconnecting" : state.connection === "connected" || state.connection === "running" ? "online" : "offline",
			run: a11yRun(state),
		}),
		settingsRevision: extras.settingsRevision ?? 0,
		settingsDraft: extras.settingsDraft,
		settingsApplyError: extras.settingsApplyError,
		settingsResetPreview: extras.settingsResetPreview,
		settingsSource: settingsSourcePath("global"),
		settingsScope: extras.settingsDraft?.scope ?? "global",
		olderPagesAdvertised: extras.olderPagesAdvertised === true,
		olderPageCount: extras.olderPageCount ?? 0,
		thinking: extras.thinking ?? emptyThinkingParams(),
		historyNote: extras.historyNote,
		routeError: extras.routeError,
		motion: motionTokens(extras.prefs?.reduceMotion === true),
		lastGoodPreview: mappedArtifacts.artifacts.find((item) => item.retainedLastGood)?.preview
			?? mappedArtifacts.artifacts.find((item) => item.preview.viewer === "inline")?.preview,
		welcome: extras.welcome ?? projectsWelcomeModel(),
		userPtys: extras.userPtys ?? [],
		userPtyOpenReason: newUserPtyPlan().reason,
		userPtyFocusReason: focusUserPtyPlan().reason,
		browserBridge: extras.browserBridge === true,
		layout: extras.layout,
		layoutPanes: extras.layoutPanes ?? [],
		layoutAxis: extras.layoutAxis ?? "single",
		layoutRatio: extras.layoutRatio ?? 1,
		paneMaximized: extras.paneMaximized === true,
		layoutBoxes: extras.layoutBoxes ?? [],
		layoutSashes: extras.layoutSashes ?? [],
		moreActions: moreMenuActions({
			hasSession: Boolean(state.session),
			pinned: state.session?.pinned,
			archived: state.session?.archived,
			recoveryRequired: state.session?.status === "recovery_required",
			hasParent: extras.hasParent === true,
			hasDraft: state.draft.trim().length > 0,
			canSplitRight: canSplit({ direction: "right", availablePx: extras.viewport?.width ?? 1200, paneCount: extras.layoutPanes?.length ?? 1 }).ok,
			canSplitDown: canSplit({ direction: "down", availablePx: extras.viewport?.height ?? 800, paneCount: extras.layoutPanes?.length ?? 1 }).ok,
			paneCount: extras.layoutPanes?.length ?? 1,
			paneMaximized: extras.paneMaximized === true,
			canMoveLeft: extras.canMoveLeft === true,
			canMoveRight: extras.canMoveRight === true,
			canMoveUp: extras.canMoveUp === true,
			canMoveDown: extras.canMoveDown === true,
		}),
		shellLayout: resolveShellLayout({
			contentWidth: extras.viewport?.width ?? 1200,
			contentHeight: extras.viewport?.height ?? 800,
			preferredSidebarWidth: extras.prefs?.sidebarWidth ?? 260,
			preferredPanelWidth: state.workPanel.preferredWidth,
			preferredPanelHeight: state.workPanel.preferredHeight,
			panelOpen: state.workPanel.open,
			panelPosition: extras.prefs?.panelPosition ?? state.workPanel.position,
		}),
		retention: extras.retention,
		diagnosticsPreview: redactedDiagnostics({
			connection: state.connection,
			sessionId: state.session?.id,
			projectId: state.project?.id,
			pending: Object.keys(state.pendingCommands).length,
			approvals: state.uiRequests.length,
			lastHostSyncAt: extras.lastHostSyncAt,
			relayStatus: "unknown",
		}),
		inlinePreview: extras.inlinePreview,
		mentionContext: extras.mentionContext ?? { hasSelection: false },
		mentions: extras.mentions ?? [],
		settingsRows: extras.settingsRows ?? [],
		shortcutRows: extras.shortcutRows ?? [],
		scrollKey: extras.scrollKey,
		routeKind: extras.routeKind ?? "task",
		canRouteBack: extras.canRouteBack === true,
		canRouteForward: extras.canRouteForward === true,
		sessions: projectedSessions,
		worktreeReceipt: extras.worktreeReceipt ?? idleWorktreeReceipt(),
		connectionBadge: state.connection === "running" ? "connected" : state.connection,
		runStatus: a11yRun(state),
		queueCollapsed: extras.queueCollapsed === true,
	};
}

function editorMentionContext(): { hasSelection: boolean; selectionPreview?: string } {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.selection.isEmpty) return { hasSelection: false };
	const preview = editor.document.getText(editor.selection).replace(/\s+/g, " ").trim().slice(0, 80);
	return { hasSelection: true, ...(preview ? { selectionPreview: preview } : {}) };
}

function appearanceValues(prefs: ProductPrefs): Record<string, unknown> {
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

function a11yRun(state: TaskState): "idle" | "running" | "stopping" | "waiting" | "unknown" {
	if (state.connection === "unknown" || Object.values(state.pendingCommands).some((command) => command.status === "unknown")) return "unknown";
	if (state.uiRequests.length > 0) return "waiting";
	if (state.connection === "running") return "running";
	return "idle";
}

function normalizeProject(value: unknown): Project | undefined {
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
function hostSessionIdsFromHint(hint: unknown): string[] {
	const values = Array.isArray(hint) ? hint : [hint];
	const ids = new Set<string>();
	for (const value of values) {
		if (typeof value !== "string" || value.length === 0) continue;
		const hostId = value.includes("://") ? sessionIdFromUri(vscode.Uri.parse(value)) : value;
		if (hostId) ids.add(hostId);
	}
	return [...ids];
}

function normalizeSession(value: unknown): Session | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = value as Record<string, unknown>;
	if (typeof item.id !== "string" || typeof item.projectId !== "string" || typeof item.incarnation !== "string") return undefined;
	return item as unknown as Session;
}

function normalizeModels(value: unknown): ModelOption[] {
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

function normalizeLoginProviders(value: unknown): LoginProviderOption[] {
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

function commandId(): string {
	try { return randomUUID(); } catch { return `cedia-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
}

/** One host connection and one webview projection per extension instance. */
export class CediaTaskViewProvider {
	readonly #context: vscode.ExtensionContext;
	/** Durable diagnostics surface. Startup and background failures have no
	 * webview to receive them, so without this they are invisible after the
	 * fact; LogOutputChannel-based channels are written to disk by the host. */
	readonly #log: vscode.LogOutputChannel;
	readonly #stateDir: string;
	readonly #hostTimeoutMs: number;
	readonly #hostProcess: ConfiguredHostProcess;
	/** Every resolved task view: the activity-bar view and the secondary-side-bar
	 * dock can both be open, so each surface receives the same snapshots. A
	 * single field silently dropped one of them. */
	readonly #views = new ViewRegistry<vscode.WebviewView>();
	/** A composer focus requested before the dock view resolved for the first time. */
	readonly #pendingComposerFocus = new PendingFocus();
	#client: CediaHostClient | undefined;
	#state: TaskState = createInitialTaskState();
	#pollTimer: ReturnType<typeof setInterval> | undefined;
	#polling = false;
	#navigationEpoch = 0;
	#searchEpoch = 0;
	readonly #editor = new CediaEditorService({ api: vscode, beforeApply: async requestId => {
		if (!requestId || !this.#client || this.#disposed) return false;
		try { return (await this.#client.editorRequestValid(this.#editorId, requestId)).valid; } catch { return false; }
	}, afterApply: summary => this.recordAgentEdit(summary) });
	readonly #editorId = randomUUID();
	#editorPolling = false;
	readonly #terminals = new OmpTerminalViews(async (sessionId, incarnation, command, payload) => {
		const client = await this.ensureClient();
		const result = await client.sendCommand(sessionId, { commandId: commandId(), incarnation, command, payload });
		if (result.status !== "completed") throw new Error(result.error ?? "Input outcome is unknown; input was not repeated");
	});
	#disposed = false;
	#ideLayout: IdeLayoutSnapshot = DEFAULT_IDE_LAYOUT;
	#answeredUi = new Set<string>();
	#lastFrozen: FrozenEnvelope | undefined;
	#inFlightCommandId: string | undefined;
	#draftRevision = 0;
	#attachments: Attachment[] = [];
	#review: ReviewSnapshot = emptyReview();
	#reviewPorcelain?: string;
	#reviewCwd?: string;
	#userPtys: { terminal: vscode.Terminal; preview: { id: string; title: string; cwd: string; ended: boolean } }[] = [];
	#recents: { path: string }[] = [];
	#layout: LayoutTree = createLayoutTree();
	#routeHistory: RouteHistory = emptyRouteHistory();
	#projectsRoute = false;
	#transcriptIndex: Record<string, { readonly title?: string; readonly text: string }> = {};
	#paneTranscripts: PaneTranscriptCache = {};
	#modelsFetchedFor?: string;
	#devices: { id: string; name: string; role: string; revokedAt?: string }[] = [];
	#devicesError?: string;
	#lastHostSyncAt?: string;
	#search: SearchPaletteState = emptySearchPalette();
	#agentsStatus: vscode.StatusBarItem | undefined;
	#prefs: ProductPrefs = DEFAULT_PRODUCT_PREFS;
	#uiSeen = new Map<string, number>();
	#artifacts: ArtifactReceipt[] = [];
	#artifactsError?: string;
	#gitBranch?: string;
	#branches: BranchHit[] = [];
	#draftBranchRef?: string;
	#markedUnread = false;
	#sidebarFilters: SidebarFilters = DEFAULT_SIDEBAR_FILTERS;
	#worktreeReceipt: WorktreeReceipt = idleWorktreeReceipt();
	#lastSentDraft = "";
	/** Edits Cedia applied to an open buffer and has not yet seen saved or
	 * taken back, keyed by document uri. */
	readonly #agentEdits = new Map<string, PendingAgentEdit>();
	/** Files whose in-editor lenses were already reported, so the Channel shows
	 * the first offer per file instead of one line per render. */
	readonly #agentEditLensLogged = new Set<string>();
	/** The engine caches CodeLens results until onDidChangeCodeLenses fires, and
	 * the decisions come from pending state rather than document content, so
	 * every change to that state must invalidate the cached lenses. */
	readonly #agentEditLensesChanged = new vscode.EventEmitter<void>();
	#agentEditDecoration: vscode.TextEditorDecorationType | undefined;
	#pendingNativeDestination?: NativeDestination;
	#settingsRevision = 0;
	#settingsDraft?: SettingsSectionDraft;
	#settingsApplyError?: string;
	#settingsResetPreview?: ResetOverridePreview;
	#routeError?: RouteErrorPage;
	#historyNote?: string;
	#thinking: ThinkingParams = emptyThinkingParams();
	#parentSession?: string;
	#olderPagesAdvertised = false;
	#olderPageCount = 0;
	#messageCursor?: string;
	#ompPlan: PlanProjection = emptyPlan();
	#queueCollapsed = false;
	#draftPersistOk = false;
	#lastGoodByName: Record<string, ArtifactPreview> = {};
	#viewport = { width: 1200, height: 800 };
	#retentionBefore: RetentionSnapshot = { sessionId: "", draft: "", scrollEventId: "", mode: "agents" };
	#inlinePreview?: { sha256: string; dataUrl?: string; text?: string; kind: string };

	constructor(context: vscode.ExtensionContext) {
		this.#context = context;
		this.#log = vscode.window.createOutputChannel("Cedia", { log: true });
		context.subscriptions.push(this.#log);
		this.#stateDir = descriptorStateDir(context);
		const config = vscode.workspace.getConfiguration("cedia");
		const configuredTimeout = Number(config.get("hostRequestTimeoutMs", HOST_REQUEST_TIMEOUT_MS));
		this.#hostTimeoutMs = Number.isSafeInteger(configuredTimeout) && configuredTimeout >= 1_000 && configuredTimeout <= 2_147_483_647 ? configuredTimeout : HOST_REQUEST_TIMEOUT_MS;
		this.#hostProcess = new ConfiguredHostProcess({ stateDir: this.#stateDir, config, extensionPath: context.extensionPath });
		this.#agentsStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
		this.#agentsStatus.command = "cedia.showAgents";
		this.renderAgentsStatus();
		this.#context.subscriptions.push(this.#agentsStatus);
		this.#recents = readStoredRecents(context.globalState.get("cedia.recentFolders"));
		this.#layout = parseLayout(context.globalState.get("cedia.layoutTree")) ?? createLayoutTree();
		const storedDrafts = context.globalState.get<Record<string, string>>("cedia.drafts");
		if (storedDrafts && typeof storedDrafts === "object") {
			this.#state = { ...this.#state, drafts: storedDrafts };
			this.#draftPersistOk = true;
		}
		this.#prefs = normalizeProductPrefs(context.globalState.get("cedia.productPrefs"));
		this.#sidebarFilters = normalizeSidebarFilters(context.globalState.get("cedia.sidebarFilters"));
		this.#lastSentDraft = typeof context.globalState.get("cedia.lastSentDraft") === "string" ? String(context.globalState.get("cedia.lastSentDraft")) : "";
		const storedRevision = Number(context.globalState.get("cedia.settingsRevision"));
		this.#settingsRevision = Number.isFinite(storedRevision) && storedRevision >= 0 ? Math.trunc(storedRevision) : 0;
		this.#ideLayout = this.#prefs.windowRestore
			? normalizeIdeLayout(context.globalState.get("cedia.ideLayout"), DEFAULT_IDE_LAYOUT)
			: DEFAULT_IDE_LAYOUT;
		this.#queueCollapsed = context.globalState.get("cedia.queueCollapsed") === true;
		const storedDestination = context.globalState.get("cedia.pendingNativeDestination");
		if (storedDestination === "explorer") this.#pendingNativeDestination = "explorer";
		this.#context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
			if (this.#agentsChromeApplied) return;
			this.#ideLayout = rememberIdeChrome(this.#ideLayout, {
				activeEditorUri: editor?.document.uri.toString() ?? this.#ideLayout.activeEditorUri,
			});
			void this.#context.globalState.update("cedia.ideLayout", this.#ideLayout);
		}));
		this.#context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(editors => {
			if (!this.#prefs.autoHideEmptyIde) return;
			// Native world: only the agents workspace may strip chrome. A plain
			// IDE window keeps full chrome even when it has no editors open.
			if (!this.inAgentsWindow()) return;
			if (this.#agentsChromeApplied || this.#state.workbenchMode !== "ide") return;
			const remaining = editors.filter(editor => editor.document.uri.scheme !== "untitled" || editor.document.getText().length > 0);
			if (remaining.length === 0) void this.setWorkbenchMode("agents");
		}));
		this.#context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
			const next = this.#userPtys.map(item => item.terminal === terminal ? { ...item, preview: { ...item.preview, ended: true } } : item);
			if (next.some((item, index) => item !== this.#userPtys[index])) {
				this.#userPtys = next;
				if (next.every(item => item.preview.ended)) this.expireWorkResource("terminal");
				else this.setWorkResource("terminal", "live");
			}
		}));
		// A saved edit has been kept, and a closed document has nothing left to
		// mark: both drop the pending record so the title buttons stay honest.
		this.#context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
			if (this.#agentEdits.delete(document.uri.toString())) this.refreshAgentEditMarks();
		}));
		this.#context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
			if (this.#agentEdits.delete(document.uri.toString())) this.refreshAgentEditMarks();
		}));
		this.#context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => {
			if (this.#agentEdits.size > 0) this.refreshAgentEditMarks();
		}));
		this.#state = reduceTaskState(this.#state, { type: "work_panel", action: { type: "set_position", position: this.#prefs.panelPosition } });
		const storedPanel = context.globalState.get<Record<string, unknown>>("cedia.workPanelLayout");
		if (storedPanel && typeof storedPanel === "object") {
			this.#state = reduceTaskState(this.#state, {
				type: "work_panel",
				action: {
					type: "set_size",
					...(typeof storedPanel.preferredWidth === "number" ? { preferredWidth: storedPanel.preferredWidth } : {}),
					...(typeof storedPanel.preferredHeight === "number" ? { preferredHeight: storedPanel.preferredHeight } : {}),
				},
			});
		}
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.#views.add(view);
		view.onDidDispose(() => { this.#views.remove(view); }, undefined, this.#context.subscriptions);
		this.configureWebview(view.webview);
		if (this.#pendingComposerFocus.claim()) this.post({ type: "focus_composer" });
		void this.refresh().catch(error => this.reportError(error));
	}

	private configureWebview(webview: vscode.Webview): void {
		webview.options = {
			enableScripts: true,
			localResourceRoots: [this.#context.extensionUri],
		};
		webview.html = createTaskWebviewHtml(webview, extensionNonce());
		webview.onDidReceiveMessage((value: unknown) => {
			const message = parseWebviewMessage(value);
			if (!message) {
				this.reportError(new Error("Cedia ignored an invalid webview message"));
				return;
			}
			void this.handleMessage(message).catch(error => this.reportError(error));
		}, undefined, this.#context.subscriptions);
		this.postSnapshot();
	}

	openAgentsWindow(): void {
		// Cedia's Agents surface is the base sessions workbench window, not a
		// docked shell in this window (see CEDIA-PLAN.md S1c).
		void vscode.commands.executeCommand("workbench.action.openAgentsWindow");
	}

	showIde(): void {
		void this.setWorkbenchMode("ide");
	}

	/**
	 * Bring this window's agent surface forward.
	 *
	 * There is one agent surface per window and it differs by window: the native
	 * Agents window (the base sessions workbench) owns its own, and in a plain IDE
	 * window the agent surface is the docked `cediaComposerDock` view. The
	 * full-page shell editor that used to live in an editor column is retired - it
	 * was a second agent surface for the same window, which the SSOT rule in the
	 * plan forbids - so this only has to reveal the dock.
	 */
	private async revealAgentSurface(): Promise<void> {
		if (this.inAgentsWindow()) return;
		await this.focusDock();
	}

	#agentsChromeApplied = false;

	private captureIdeLayout(): IdeLayoutSnapshot {
		const editor = vscode.window.activeTextEditor;
		const alreadyAgents = this.#agentsChromeApplied;
		const showTabs = vscode.workspace.getConfiguration("workbench.editor").get<string>("showTabs");
		const statusBarVisible = vscode.workspace.getConfiguration("workbench").get<boolean>("statusBar.visible");
		const breadcrumbsEnabled = vscode.workspace.getConfiguration("breadcrumbs").get<boolean>("enabled");
		const activityBarLocation = vscode.workspace.getConfiguration("workbench").get<string>("activityBar.location");
		if (alreadyAgents) {
			return rememberIdeChrome(this.#ideLayout, {
				activeEditorUri: editor?.document.uri.toString() ?? this.#ideLayout.activeEditorUri,
			});
		}
		const captured = {
			sidebarVisible: this.#ideLayout.sidebarVisible !== false,
			auxiliaryBarVisible: this.#ideLayout.auxiliaryBarVisible === true,
			panelVisible: this.#ideLayout.panelVisible !== false,
			activeEditorUri: editor?.document.uri.toString() ?? this.#ideLayout.activeEditorUri,
			showTabs: showTabs ?? this.#ideLayout.showTabs ?? "multiple",
			statusBarVisible: statusBarVisible ?? this.#ideLayout.statusBarVisible ?? true,
			breadcrumbsEnabled: breadcrumbsEnabled ?? this.#ideLayout.breadcrumbsEnabled ?? true,
			activityBarLocation: activityBarLocation ?? this.#ideLayout.activityBarLocation ?? "default",
		};
		// Read through the same rule the loader uses, so a workspace setting left
		// behind by a previous Agents session cannot be recorded as the user's
		// IDE layout (that is what made IDE mode return without tabs or a status
		// bar). The previous snapshot supplies the fallback.
		const sanitized = normalizeIdeLayout(captured, this.#ideLayout);
		void this.#context.globalState.update("cedia.ideLayout", sanitized);
		return sanitized;
	}
	private async applyWorkbenchAppearance(mode: "agents" | "ide"): Promise<void> {
		const editor = vscode.workspace.getConfiguration("workbench.editor");
		const workbench = vscode.workspace.getConfiguration("workbench");
		const chat = vscode.workspace.getConfiguration("chat");
		const window = vscode.workspace.getConfiguration("window");
		const breadcrumbs = vscode.workspace.getConfiguration("breadcrumbs");
		// Cosmetic workbench settings are written to the workspace scope, which
		// throws when no folder is open yet (e.g. during early startup). A
		// failure here must never abort the mode switch itself, because the
		// caller still has to record the mode and reveal the agent surface.
		//
		// `chromeVisibility` marks the settings that decide whether native chrome
		// is on screen at all. Those fall back to the global scope, because the
		// Agents shell can legitimately have no folder attached: without the
		// fallback the window keeps stock IDE chrome (including the status bar)
		// around the dock, which is exactly the "looks unchanged" report. Colour
		// customisations deliberately do NOT take that fallback - writing them
		// globally would repaint every other window on the machine.
		const apply = async (target: { update(section: string, value: unknown, scope: vscode.ConfigurationTarget): Thenable<void> }, section: string, value: unknown, chromeVisibility = false): Promise<void> => {
			try {
				await target.update(section, value, vscode.ConfigurationTarget.Workspace);
				return;
			} catch (error) {
				if (!chromeVisibility) {
					// Appearance is cosmetic; the mode change still applies. Log at
					// debug so the reason is recoverable without adding startup noise.
					this.#log.debug(`workbench appearance skipped for ${section}: ${errorMessage(error)}`);
					return;
				}
				try {
					await target.update(section, value, vscode.ConfigurationTarget.Global);
				} catch (fallbackError) {
					this.#log.debug(`workbench appearance skipped for ${section}: ${errorMessage(error)} / ${errorMessage(fallbackError)}`);
				}
			}
		};
		// Cedia no longer repaints the window with a palette of its own. The Agents
		// window and the IDE are the same application, so the theme the user picked for
		// the IDE is what both windows show - a second palette in one of them read as
		// the editor changing colour when it switched modes. Colour customisations this
		// extension wrote earlier are cleared, and only when they carry Cedia's whole
		// signature (see isCediaWorkbenchPalette): a user's own customisations, or a
		// different theme, are never touched.
		const chromeChoice = workbench.inspect?.<Record<string, unknown>>("colorCustomizations");
		const written = [
			[vscode.ConfigurationTarget.Workspace, chromeChoice?.workspaceValue],
			[vscode.ConfigurationTarget.Global, chromeChoice?.globalValue],
		] as const;
		for (const [scope, value] of written) {
			if (!isCediaWorkbenchPalette(value)) {
				continue;
			}
			// Removed at the scope that holds it: clearing a global palette through the
			// workspace-first helper above would only shadow it, and the window would
			// keep wearing the old colours.
			try {
				await workbench.update("colorCustomizations", undefined, scope);
			} catch (error) {
				this.#log.debug(`workbench appearance skipped for colorCustomizations: ${errorMessage(error)}`);
			}
		}
		// Cursor's shipped configuration turns window.autoDetectColorScheme on,
		// so its chrome follows the OS light/dark setting. Cedia's palette is
		// keyed off the resulting theme kind, so without this the reference's
		// light chrome could never be reached on a light desktop. A global
		// value means the user chose their own behaviour, and Cedia leaves it.
		const autoDetect = window.inspect?.<boolean>("autoDetectColorScheme");
		if (autoDetect?.globalValue === undefined) {
			await apply(window, "autoDetectColorScheme", true, true);
		}
		// Cedia has one agent surface and OMP is its only execution harness. Keep
		// Code-OSS's built-in Chat view hidden even for existing installs that
		// carried a previous `false` value; otherwise its default Chat tab appears
		// beside the Cedia dock and presents a second, non-OMP agent entry point.
		// A global fallback covers folderless windows, while the workspace value
		// keeps a project's setting from re-enabling the duplicate later.
		await apply(chat, "disableAIFeatures", true, true);
		if (mode === "agents") {
			// The reference right-hand Apps panel is a tab group (its strip lists
			// the open apps and `Open new tab menu`), so the Agents window keeps
			// editor tabs. Cedia's own Apps panel hides this strip only while it is
			// the group's sole tab, which is what leaves the empty home clean.
			await apply(editor, "showTabs", "multiple", true);
			// The editor actions (Split Editor, Toggle Panel, Toggle Secondary Side
			// Bar, More Actions) are still Code-OSS chrome around the Cedia shell, so
			// they stay out of the title bar in this window.
			await apply(editor, "editorActionsLocation", "hidden", true);
			await apply(workbench, "statusBar.visible", false, true);
			await apply(workbench, "activityBar.location", "hidden", true);
			// The title-bar layout control is the other stock chrome control
			// that survives hiding the status bar and activity bar.
			await apply(workbench, "layoutControl.enabled", false, true);
			await apply(window, "commandCenter", false, true);
			await apply(breadcrumbs, "enabled", false, true);
			return;
		}
		await apply(editor, "showTabs", this.#ideLayout.showTabs ?? "multiple", true);
		await apply(editor, "editorActionsLocation", "default", true);
		await apply(workbench, "statusBar.visible", this.#ideLayout.statusBarVisible ?? true, true);
		await apply(workbench, "layoutControl.enabled", true, true);
		await apply(workbench, "activityBar.location", this.#ideLayout.activityBarLocation ?? "default", true);
		await apply(window, "commandCenter", true, true);
		await apply(breadcrumbs, "enabled", this.#ideLayout.breadcrumbsEnabled ?? true, true);
	}

	/** Re-write the chrome palette after the active theme kind changed.
	 * Cursor ships light and dark chrome, so a theme switch must repaint the
	 * agent dock too instead of leaving the previous kind's colours behind. */
	reapplyWorkbenchAppearance(): void {
		const mode = this.#state.workbenchMode === "ide" ? "ide" : "agents";
		void this.applyWorkbenchAppearance(mode).catch(error => this.reportError(error));
	}

	private inAgentsWindow(): boolean {
		return isAgentsWindow(vscode.workspace.workspaceFile);
	}

	private async rememberIdeFolder(): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (folder && !this.inAgentsWindow()) await this.#context.globalState.update("cedia.lastIdeFolder", folder);
	}

	private async openIdeWindow(): Promise<void> {
		const folder = this.#state.project?.path || this.#context.globalState.get<string>("cedia.lastIdeFolder");
		if (folder) {
			await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(folder), { forceNewWindow: true });
			return;
		}
		await vscode.commands.executeCommand("workbench.action.newWindow");
	}

	async setWorkbenchMode(mode: "agents" | "ide", opts?: { readonly newWindow?: boolean }): Promise<void> {
		this.#retentionBefore = this.retentionSnapshot(this.#state.workbenchMode === "ide" ? "ide" : "agents");
		if (opts?.newWindow) {
			if (mode === "ide") {
				await this.openIdeWindow();
				return;
			}
			// Placement belongs to the base's own window command; the extension used
			// to write a Cedia-branded workspace file and open it in a new window,
			// which nothing called and which duplicated this route.
			this.openAgentsWindow();
			return;
		}
		// Until Agents chrome was applied once, the visible workbench is stock IDE
		// chrome even though state already says "agents" — so the first Agents
		// entry must still issue the hide commands instead of no-oping.
		const from: "agents" | "ide" = this.#agentsChromeApplied ? "agents" : "ide";
		if (mode === "agents") await this.rememberIdeFolder();
		if (mode === "agents" && from !== "agents") this.#ideLayout = this.captureIdeLayout();
		this.setState({ type: "workbench_mode", mode });
		const switched = switchWorkbenchMode({ from, to: mode, ideLayout: this.#ideLayout });
		this.#ideLayout = switched.ideLayout;
		if (mode === "agents") await this.revealAgentSurface();
		await runWorkbenchCommands((command, ...args) => vscode.commands.executeCommand(command, ...args), switched.commands);
		// Appearance is cosmetic and its workspace-scoped writes can stall (for
		// example while the settings file is being written, or before a folder
		// is attached). Awaiting it used to hang the whole mode switch, so the
		// mode was never recorded and the agent surface was never revealed.
		// Fire it and continue; failures are ignored because nothing depends on it.
		void this.applyWorkbenchAppearance(mode).catch(error => this.reportError(error));
		this.#agentsChromeApplied = mode === "agents";
		this.persistModeSwitchProof(mode);
		this.#log.debug(`workbench mode applied: ${mode} (chromeApplied=${this.#agentsChromeApplied})`);
		void this.#context.globalState.update("cedia.lastWorkbenchMode", mode);
		if (mode === "ide") {
			this.#agentsStatus?.show();
			if (this.#ideLayout.activeEditorUri) {
				try {
					await vscode.window.showTextDocument(vscode.Uri.parse(this.#ideLayout.activeEditorUri), { preview: false, preserveFocus: false });
				} catch { /* Missing editors stay closed; chrome restore still applies. */ }
			}
			const consumed = consumePendingNativeDestination("ide", this.#pendingNativeDestination);
			this.#pendingNativeDestination = consumed.pending;
			void this.#context.globalState.update("cedia.pendingNativeDestination", this.#pendingNativeDestination);
			if (consumed.openExplorer) {
				this.#ideLayout = rememberIdeChrome(this.#ideLayout, { sidebarVisible: true });
				void this.#context.globalState.update("cedia.ideLayout", this.#ideLayout);
				await vscode.commands.executeCommand("workbench.view.explorer");
			}
			return;
		}
		this.#agentsStatus?.hide();
	}

	private attachmentRefs(): readonly string[] {
		return this.#attachments.map(item => item.contentRef || item.id);
	}

	private retentionSnapshot(mode: "agents" | "ide"): RetentionSnapshot {
		return {
			sessionId: this.#state.session?.id ?? "",
			draft: this.#state.draft,
			scrollEventId: this.#state.transcriptScrolls[draftViewKey(this.#state.project?.id, this.#state.session?.id)]?.eventId ?? "",
			attachmentRefs: this.attachmentRefs(),
			mode,
			pendingDestination: this.#pendingNativeDestination,
		};
	}

	private persistModeSwitchProof(to: "agents" | "ide"): void {
		const after = this.retentionSnapshot(to);
		const proof = modeSwitchProof(this.#retentionBefore, after);
		void this.#context.globalState.update("cedia.modeSwitchProof", proof);
		const uri = vscode.Uri.joinPath(this.#context.globalStorageUri, "mode-switch-proof.json");
		// The file service returns a Thenable, which has no `.catch`; wrapping it
		// keeps the whole chain catchable so a failed write is reported instead
		// of becoming an unhandled rejection.
		void Promise.resolve(vscode.workspace.fs.createDirectory(this.#context.globalStorageUri))
			.then(() => vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`${JSON.stringify(proof, null, 2)}\n`)))
			.then(() => this.#log.debug(`mode switch proof written: ${uri.toString()}`))
			// The proof is diagnostics, not product state, but a silent failure
			// here used to hide a broken extension storage path entirely.
			.catch(error => this.#log.warn(`mode switch proof not written (${uri.toString()}): ${errorMessage(error)}`));
	}

	focusComposer(): void {
		void this.focusAgentSurface({ type: "focus_composer" });
	}

	focusSearch(): void {
		void this.focusAgentSurface({ type: "focus_search" });
	}

	skipToTask(): void {
		void this.focusAgentSurface({ type: "focus_task" });
	}

	/** Focus the agent without destroying the user's IDE layout. While the
	 * workbench is in IDE mode the docked agent surface is revealed; only the
	 * explicit Show Agents command replaces the chrome with the full window. */
	private async focusAgentSurface(message: unknown): Promise<void> {
		if (this.#state.workbenchMode === "ide") {
			await this.focusDock();
			this.post(message);
			return;
		}
		this.post(message);
	}

	refreshNow(): Promise<void> {
		return this.refresh();
	}

	/** Pin or unpin the project whose folder was right-clicked. */
	setProjectPinned(folderPath: unknown): Promise<void> {
		return this.withHostProject(folderPath, async (project, client) => {
			const updated = await client.patchProject(project.id, { pinned: !project.pinned });
			void vscode.window.showInformationMessage(updated.pinned ? `Pinned ${updated.name}` : `Unpinned ${updated.name}`);
			await this.refresh();
		});
	}

	/**
	 * Assign which OMP model does which job (roles), or clear a role back to
	 * OMP's own default.
	 *
	 * Roles are a host-side OMP concern, so this is a Cedia command rather than a
	 * composer chip: in the Agents window the composer renders only the `models`
	 * option group (the bridge projects it into the dedicated model picker), so a
	 * second inline picker would need a desktop patch. The command reaches the
	 * same host surface the TUI carousel does and reports what OMP confirmed.
	 */
	async configureModelRoles(): Promise<void> {
		try {
			const client = await this.ensureClient();
			const log = (message: string) => this.#log.info(message);
			const roles = await fetchOmpModelRoles(() => this.ensureClient(), log);
			if (roles.roles.length === 0) {
				void vscode.window.showInformationMessage("OMP reports no configured model roles. Set them in OMP's own /models picker first.");
				return;
			}
			const role = await vscode.window.showQuickPick(
				roles.roles.map(entry => ({
					label: modelRoleLabel(entry.role),
					description: entry.modelId,
					detail: `role: ${entry.role} · from ${entry.source}`,
					role: entry.role,
				})),
				{ title: "OMP model roles", placeHolder: "Which role to change" },
			);
			if (!role) return;
			const snapshot = await fetchGlobalOmpModelSnapshot(() => this.ensureClient(), log);
			if (snapshot.models.length === 0) {
				void vscode.window.showInformationMessage("OMP advertised no models, so there is nothing to assign.");
				return;
			}
			const picked = await vscode.window.showQuickPick(
				[
					{ label: "OMP default", description: "Clear this role so OMP resolves it itself", selector: null as string | null },
					...snapshot.models.map(model => ({
						label: model.label,
						description: `${model.provider ? `${model.provider}/` : ""}${model.id}${model.available ? "" : " (unavailable)"}`,
						selector: (model.provider ? `${model.provider}/${model.id}` : model.id) as string | null,
					})),
				],
				{ title: `Model for the ${modelRoleLabel(role.role)} role`, placeHolder: "Pick a model, or clear the role" },
			);
			if (!picked) return;
			const sessions = await client.listSessions();
			const probe = sessions.find(candidate => !candidate.archived) ?? sessions[0];
			if (!probe) {
				void vscode.window.showInformationMessage("Cedia needs at least one task before it can change an OMP setting.");
				return;
			}
			const session = probe.status === "running" ? probe : await client.startSession(probe.id);
			const result = await client.sendCommand(session.id, setModelRoleRequest(session, role.role, picked.selector, commandId()));
			if (result.status === "failed" || result.status === "not_dispatched") {
				void vscode.window.showWarningMessage(`Cedia could not set the ${modelRoleLabel(role.role)} role: ${result.error ?? result.status}`);
				return;
			}
			void vscode.window.showInformationMessage(picked.selector === null
				? `Cleared the ${modelRoleLabel(role.role)} role; OMP resolves it itself again.`
				: `The ${modelRoleLabel(role.role)} role now uses ${picked.selector}.`);
		} catch (error) {
			void vscode.window.showWarningMessage(`Cedia could not change the model roles: ${errorMessage(error)}`);
		}
	}

	/** Rename the project record; the folder on disk is never touched. */
	renameProject(folderPath: unknown): Promise<void> {
		return this.withHostProject(folderPath, async (project, client) => {
			const name = await vscode.window.showInputBox({
				prompt: "Project name",
				value: project.name,
				placeHolder: project.path,
			});
			const trimmed = name?.trim();
			if (!trimmed || trimmed === project.name) {
				return;
			}
			const updated = await client.patchProject(project.id, { name: trimmed });
			void vscode.window.showInformationMessage(`Renamed to ${updated.name}`);
			await this.refresh();
		});
	}

	/**
	 * Archive every chat of the project.
	 *
	 * Archiving is the host's own reversible operation: the transcripts stay on disk and
	 * stay readable, which is why this does not delete them.
	 */
	archiveProjectChats(folderPath: unknown): Promise<void> {
		return this.withHostProject(folderPath, async (project, client) => {
			const sessions = await client.listSessions(project.id);
			const open = sessions.filter(session => !session.archived);
			for (const session of open) {
				await client.patchSession(session.id, { archived: true });
			}
			void vscode.window.showInformationMessage(open.length === 0
				? `No open chats in ${project.name}.`
				: `Archived ${open.length} chat${open.length === 1 ? "" : "s"} in ${project.name}.`);
			// The sidebar regroups rows from the refreshed projection.
			await this.refresh();
		});
	}

	/**
	 * Remove the project from Cedia.
	 *
	 * The sidebar's project row is its chats' workspace group, so removing the project
	 * means archiving the chats with it: the group disappears from the list because an
	 * archived row leaves it, and the list keeps archived rows out of the way until a
	 * filter asks for them. Everything stays reversible and on disk - the folder is
	 * never touched, the transcripts stay, and the project record is archived rather
	 * than deleted because the host has no delete and inventing one would throw away
	 * what the host owns.
	 */
	removeProject(folderPath: unknown): Promise<void> {
		return this.withHostProject(folderPath, async (project, client) => {
			const sessions = await client.listSessions(project.id);
			const open = sessions.filter(session => !session.archived);
			const confirmed = await vscode.window.showWarningMessage(
				open.length === 0
					? `Remove ${project.name} from Cedia? The folder stays on disk.`
					: `Remove ${project.name} from Cedia? Its ${open.length === 1 ? "chat is" : `${open.length} chats are`} archived with it. The folder stays on disk.`,
				{ modal: true },
				"Remove",
			);
			if (confirmed !== "Remove") {
				return;
			}
			for (const session of open) {
				await client.patchSession(session.id, { archived: true });
			}
			await client.patchProject(project.id, { archived: true });
			void vscode.window.showInformationMessage(`Removed ${project.name} from Cedia. Its chats are archived and its folder is untouched.`);
			await this.refresh();
		});
	}

	/**
	 * Delete chats the Agents window's session list picked.
	 *
	 * The list's own `Delete...` item confirms first ("This action cannot be
	 * undone."), so the ids arrive already agreed on. Deleting removes the host's
	 * record and the transcript it wrote for the session; a project folder is never
	 * touched, and a worktree the session created stays on disk because it can hold
	 * uncommitted work.
	 */
	async deleteChatSessions(hint: unknown): Promise<void> {
		const ids = hostSessionIdsFromHint(hint);
		if (ids.length === 0) {
			void vscode.window.showWarningMessage("Cedia could not tell which chat to delete.");
			return;
		}
		try {
			const client = await this.ensureClient();
			for (const id of ids) {
				await client.deleteSession(id);
			}
			void vscode.window.showInformationMessage(ids.length === 1 ? "Deleted 1 chat." : `Deleted ${ids.length} chats.`);
			// The sidebar regroups rows from the refreshed projection.
			await this.refresh();
		} catch (error) {
			void vscode.window.showWarningMessage(`Cedia could not delete that chat: ${errorMessage(error)}`);
		}
	}

	/**
	 * Create a worktree for the project and start a task in it.
	 *
	 * Cedia creates the worktree with the task and leaves it on disk when the task ends, so
	 * this is the closest real equivalent of the reference's "create permanent worktree":
	 * the difference is that the checkout belongs to a task rather than to the project row.
	 */
	createWorktreeForProject(folderPath: unknown): Promise<void> {
		return this.withHostProject(folderPath, async (project, client) => {
			const sessionValue = await client.createSession({ projectId: project.id, workspaceMode: "worktree" });
			const created = normalizeSession(sessionValue);
			if (!created) {
				throw new Error("Cedia host returned an invalid session");
			}
			void vscode.window.showInformationMessage(`Created a worktree task for ${project.name} at ${created.cwd}`);
			await this.refresh();
		});
	}

	/**
	 * Resolve the host project that owns a folder.
	 *
	 * The sidebar's project rows are the open workspace folders, while pin/rename/archive
	 * live on the host's project record. Matching by path joins the two, and it is the only
	 * honest join available: two folders can share a name, and a folder the host was never
	 * told about is not a project yet.
	 */
	private async resolveHostProject(hint: string, client: CediaHostClient): Promise<Project | undefined> {
		const wanted = hint.replace(/\/+$/, "");
		const projects = await client.listProjects();
		const byPath = projects.find(project => project.path.replace(/\/+$/, "") === wanted);
		if (byPath) {
			return byPath;
		}
		// A row that carries no path (the sessions list groups rows by workspace name) is
		// matched by name, and only when exactly one project matches: guessing between two
		// folders that share a name would act on the wrong one.
		const byName = projects.filter(project => project.name === hint);
		return byName.length === 1 ? byName[0] : undefined;
	}

	private async withHostProject(hint: unknown, run: (project: Project, client: CediaHostClient) => Promise<void>): Promise<void> {
		if (typeof hint !== "string" || hint.length === 0) {
			void vscode.window.showWarningMessage("Cedia needs the project folder for that action.");
			return;
		}
		try {
			const client = await this.ensureClient();
			const project = await this.resolveHostProject(hint, client);
			if (!project) {
				void vscode.window.showWarningMessage(`Cedia cannot tell which project "${hint}" is. Open the folder in Cedia so the project is registered, or use its project row.`);
				return;
			}
			await run(project, client);
		} catch (error) {
			void vscode.window.showWarningMessage(`Cedia could not complete that project action: ${errorMessage(error)}`);
		}
	}

	/** Reveal the project's folder in the OS file manager. */
	revealProject(hint: unknown): Promise<void> {
		return this.withHostProject(hint, async project => {
			await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(project.path));
		});
	}

	prefill(text: string): void {
		this.post({ type: "prefill", text });
		this.focusComposer();
	}

	private post(message: unknown): void {
		const targets = this.#views.targets().map(view => view.webview);
		for (const target of targets) void target.postMessage(message);
	}

	private postSnapshot(): void {
		this.renderAgentsStatus();
		this.syncCediaContext();
		this.#lastGoodByName = mapArtifactsForWebview(this.#artifacts, this.#lastGoodByName).lastGoodByName;
		this.post({
			type: "snapshot",
			state: cloneStateForWebview(this.#state, {
				attachments: this.#attachments,
				review: this.#review,
				devices: this.#devices,
				devicesError: this.#devicesError,
				lastHostSyncAt: this.#lastHostSyncAt,
				search: this.#search,
				prefs: this.#prefs,
				terminals: [
					...this.#userPtys.map(item => ({ ...item.preview, kind: "user" as const, truncated: false, text: "" })),
					...(this.#state.session
						? this.#terminals.preview(this.#state.session.id, this.#state.session.incarnation).map(item => ({
							...item,
							kind: "agent" as const,
							cwd: this.#state.session?.cwd,
						}))
						: []),
				],
				artifacts: this.#artifacts,
				artifactsError: this.#artifactsError,
				gitBranch: this.#gitBranch,
				branches: this.#branches,
				draftBranchRef: this.#draftBranchRef,
				welcome: this.welcomeModel(),
				userPtys: userPtyRows(this.#userPtys.map(item => item.preview)),
				layout: serializeLayout(this.#layout),
				layoutAxis: this.#layout.root.type === "split" && !this.#layout.maximizedViewId ? this.#layout.root.orientation : "single",
				layoutRatio: this.#layout.root.type === "split" ? this.#layout.root.ratio : 1,
				paneMaximized: Boolean(this.#layout.maximizedViewId),
				canMoveLeft: moveActive(this.#layout, "left") !== this.#layout,
				canMoveRight: moveActive(this.#layout, "right") !== this.#layout,
				canMoveUp: moveActive(this.#layout, "up") !== this.#layout,
				canMoveDown: moveActive(this.#layout, "down") !== this.#layout,
				layoutBoxes: layoutBoxes(this.#layout, this.#viewport.width, this.#viewport.height),
				layoutSashes: layoutSashes(this.#layout, this.#viewport.width, this.#viewport.height),
				layoutPanes: buildPaneViews({
					tree: this.#layout,
					cache: this.#paneTranscripts,
					drafts: this.#state.drafts,
					activeDraft: this.#state.draft,
					sessions: this.#state.sessions,
				}),
				browserBridge: false,
				cediaVersion: vscode.version,
				extensionVersion: typeof this.#context.extension.packageJSON?.version === "string" ? this.#context.extension.packageJSON.version : undefined,
				codeOssVersion: vscode.version,
				markedUnread: this.#markedUnread,
				sidebarFilters: this.#sidebarFilters,
				lastSentDraft: this.#lastSentDraft,
				settingsRevision: this.#settingsRevision,
				settingsDraft: this.#settingsDraft,
				settingsApplyError: this.#settingsApplyError,
				settingsResetPreview: this.#settingsResetPreview,
				routeError: this.#routeError,
				historyNote: this.#historyNote,
				thinking: this.#thinking,
				hasParent: Boolean(this.#parentSession),
				parentSession: this.#parentSession,
				olderPagesAdvertised: this.#olderPagesAdvertised,
				olderPageCount: this.#olderPageCount,
				ompPlan: this.#ompPlan,
				queueCollapsed: this.#queueCollapsed,
				draftPersistOk: this.#draftPersistOk,
				lastGoodByName: this.#lastGoodByName,
				viewport: this.#viewport,
				inlinePreview: this.#inlinePreview,
				mentionContext: editorMentionContext(),
				mentions: this.currentMentions(),
				settingsRows: this.currentSettingsRows(),
				shortcutRows: shortcutRowsFromContributes(this.#context.extension.packageJSON?.contributes),
				scrollKey: this.activeScrollKey(),
				routeKind: this.#projectsRoute ? "projects" : "task",
				canRouteBack: canRouteBack(this.#routeHistory),
				worktreeReceipt: this.#worktreeReceipt,
				canRouteForward: canRouteForward(this.#routeHistory),
				retention: retentionReceipt(this.#retentionBefore, this.retentionSnapshot(this.#state.workbenchMode === "ide" ? "ide" : "agents")),
			}),
		});
		this.applyWindowTitle();
	}

	private currentMentions(): ReturnType<typeof mentionRows> {
		const selection = editorMentionContext();
		return mentionRows({
			query: this.#search.scope === "files" ? this.#search.query : "",
			sessions: this.#state.sessions,
			files: this.#search.hits.filter(hit => hit.scope === "files").map(hit => ({ path: hit.id })),
			artifacts: this.#artifacts,
			hasSelection: selection.hasSelection,
			selectionPreview: selection.selectionPreview,
			uploadAdvertised: false,
		});
	}

	private currentSettingsRows(): ReturnType<typeof bindSettingsCatalogRows> {
		const source = settingsSourcePath("global");
		return [
			...bindSettingsCatalogRows({ section: "Models/providers", models: this.#state.models, source }),
			...bindSettingsCatalogRows({ section: "Agents/OMP", loginProviders: this.#state.loginProviders, source }),
			...bindSettingsCatalogRows({ section: "Tools/MCP", source }),
			...bindSettingsCatalogRows({ section: "Skills/rules/hooks/commands", slashCommands: this.#state.slashCommands, skills: skillsFromSlashCommands(this.#state.slashCommands), source }),
		];
	}

	private activeScrollKey(): string {
		const leaf = activeLeaf(this.#layout);
		if (leaf) return paneDraftKey(leaf);
		return draftViewKey(this.#state.project?.id, this.#state.session?.id);
	}

	private scrollKeyForView(viewId?: string): string {
		if (viewId) {
			const leaf = visibleLeaves(this.#layout).find(item => item.viewId === viewId);
			if (leaf) return paneDraftKey(leaf);
		}
		return this.activeScrollKey();
	}

	applyStartupView(): void {
		const startup = resolveStartupView({
			pending: this.#pendingNativeDestination,
			rememberedMode: this.#context.globalState.get("cedia.lastWorkbenchMode"),
			startupView: this.#prefs.startupView,
			inAgentsWindow: this.inAgentsWindow(),
		});
		this.#log.info(`startup view=${this.#prefs.startupView} mode=${startup.mode} revealDock=${startup.revealDock}`);
		void this.setWorkbenchMode(startup.mode)
			.then(async () => {
				if (!startup.revealDock) return;
				this.#log.debug("revealing docked agent view");
				// Coexistence default: keep the native IDE and put the agent beside
				// it. Revealing the container must not steal the editor's focus, so
				// this uses the container reveal command rather than the dock focus.
				try {
					await vscode.commands.executeCommand("workbench.view.extension.cediaDock");
					this.#log.debug("docked agent view revealed");
				} catch (error) {
					// Older layouts may not expose the container command; the view is
					// still available from the side bar, so this is not fatal.
					this.#log.warn(`could not reveal the docked view: ${errorMessage(error)}`);
					this.post({ type: "error", text: `Cedia could not reveal the docked view: ${errorMessage(error)}`, status: "unknown" });
				}
			})
			// Startup must never fail silently: an unhandled rejection here used
			// to leave the mode, the layout, and the dock state inconsistent.
			.catch(error => this.reportError(error));
	}

	private applyWindowTitle(): void {
		const title = cediaWindowTitle({
			mode: this.#state.workbenchMode === "ide" ? "ide" : "agents",
			taskTitle: this.#state.session?.title,
			projectName: this.#state.project?.name,
			fileName: vscode.window.activeTextEditor?.document.fileName.split(/[\\/]/).pop(),
		});
		// Window-scoped writes throw when no folder is open (early startup, or a
		// window opened without a workspace). The title is cosmetic, so a failure
		// must not become an unhandled rejection on every snapshot.
		// A window can open with no folder at all, and there the workspace write
		// always fails: the title then stays whatever the base set, which reads as
		// an internal Code-OSS window instead of the product. The global scope is
		// the same fallback the chrome settings above already use.
		const windowConfig = vscode.workspace.getConfiguration("window");
		void windowConfig
			.update("title", title, vscode.ConfigurationTarget.Workspace)
			.then(undefined, () => {
				void windowConfig.update("title", title, vscode.ConfigurationTarget.Global)
					.then(undefined, () => { /* title is cosmetic */ });
			});
	}

	private setState(action: Parameters<typeof reduceTaskState>[1]): void {
		this.#state = reduceTaskState(this.#state, action);
		const leaf = activeLeaf(this.#layout);
		if (leaf) this.#paneTranscripts = rememberPaneTranscript(this.#paneTranscripts, leaf, this.#state.transcript);
		if (this.#state.session) {
			this.#transcriptIndex[this.#state.session.id] = {
				title: this.#state.session.title,
				text: this.#state.transcript.map(entry => entry.text || entry.output || "").filter(Boolean).join("\n"),
			};
		}
		this.postSnapshot();
	}

	private currentRouteFrame(): RouteFrame {
		if (this.#projectsRoute) return { kind: "projects" };
		return {
			kind: "task",
			projectId: this.#state.project?.id ?? null,
			sessionId: this.#state.session?.id ?? null,
			scrollKey: this.activeScrollKey(),
			offset: this.#state.transcriptScrolls[this.activeScrollKey()]?.offset,
		};
	}

	private rememberCurrentRoute(): void {
		this.#routeHistory = rememberRoute(this.#routeHistory, this.currentRouteFrame());
	}

	private async applyRouteFrame(frame: RouteFrame): Promise<void> {
		if (frame.kind === "projects") {
			this.#projectsRoute = true;
			this.postSnapshot();
			return;
		}
		this.#projectsRoute = false;
		if (frame.sessionId) {
			await this.selectSession(frame.sessionId, true);
			return;
		}
		this.setState({ type: "reset", session: null, project: this.#state.project });
	}

	async openProjectsRoute(): Promise<void> {
		this.rememberCurrentRoute();
		this.#projectsRoute = true;
		this.#routeHistory = rememberRoute(this.#routeHistory, { kind: "projects" });
		this.postSnapshot();
	}

	async goRouteBack(): Promise<void> {
		const next = routeBack(this.#routeHistory);
		if (!next.frame) {
			await this.openProjectsRoute();
			return;
		}
		this.#routeHistory = next.history;
		await this.applyRouteFrame(next.frame);
	}

	async goRouteForward(): Promise<void> {
		const next = routeForward(this.#routeHistory);
		if (!next.frame) return;
		this.#routeHistory = next.history;
		await this.applyRouteFrame(next.frame);
	}

	private reportError(error: unknown): void {
		const message = errorMessage(error);
		// Failures raised from startup or from a background mode switch have no
		// webview to receive them, and previously vanished without a trace.
		this.#log.error(error instanceof Error ? (error.stack ?? message) : message);
		const offline = error instanceof HostSetupRequiredError || error instanceof HostDescriptorError || error instanceof TypeError || error instanceof HostRequestTimeoutError || (error instanceof HostHttpError && error.status >= 500);
		this.setState({ type: "connection", status: offline ? "offline" : "unknown", error: message, markUnknown: true });
		this.post({ type: "error", text: message, status: offline ? "offline" : "unknown" });
	}

	async ensureClient(): Promise<CediaHostClient> {
		if (this.#client) {
			try {
				await this.#client.health();
				if (this.#state.connection !== "connected" && this.#state.connection !== "running") this.setState({ type: "connection", status: "connected" });
				return this.#client;
			} catch { this.#client = undefined; }
		}
		this.setState({ type: "connection", status: "connecting" });
		try {
			this.#client = await CediaHostClient.fromStateDir(this.#stateDir, { timeoutMs: this.#hostTimeoutMs, requirePrivateMode: true });
			await this.#client.health();
		} catch (firstError) {
			this.#client = undefined;
			await this.#hostProcess.start();
			const deadline = Date.now() + 7_000;
			let lastError: unknown = firstError;
			while (Date.now() < deadline) {
				try {
					this.#client = await CediaHostClient.fromStateDir(this.#stateDir, { timeoutMs: this.#hostTimeoutMs, requirePrivateMode: true });
					await this.#client.health();
					break;
				} catch (error) {
					this.#client = undefined;
					lastError = error;
					await new Promise(resolve => setTimeout(resolve, 150));
				}
			}
			if (!this.#client) throw new HostSetupRequiredError(`${hostSetupMessage(this.#stateDir)} ${errorMessage(lastError)}`);
		}
		this.setState({ type: "connection", status: "connected", error: undefined });
		this.startPolling();
		return this.#client;
	}

	async syncIdeSession(id: string): Promise<void> {
		if (this.#state.session?.id === id) return;
		await this.refresh();
		await this.selectSession(id, true);
	}

	private startPolling(): void {
		if (this.#pollTimer) return;
		this.#pollTimer = setInterval(() => { void this.pullEvents(); void this.pollEditor(); }, POLL_INTERVAL_MS);
	}

	private async pollEditor(): Promise<void> {
		if (this.#editorPolling || !this.#client || this.#disposed) return;
		this.#editorPolling = true;
		const client = this.#client;
		try {
			await client.registerEditor(this.#editorId, (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
			const requests = await client.editorRequests(this.#editorId);
			for (const request of requests) {
				if (this.#disposed) break;
				const response = await this.#editor.handleRequest(request);
				await client.editorResponse(this.#editorId, response);
			}
		} catch { /* Never repeat delivered edits after a lost response. The host records timeout/unknown. */ }
		finally { this.#editorPolling = false; }
	}

	private async pullEvents(): Promise<void> {
		if (this.#polling || !this.#client || !this.#state.session) return;
		this.#polling = true;
		const sessionId = this.#state.session.id;
		const epoch = this.#navigationEpoch;
		const current = () => epoch === this.#navigationEpoch && this.#state.session?.id === sessionId;
		try {
			const latestValue = await this.#client.getSession(sessionId);
			if (!current()) return;
			const latest = normalizeSession(latestValue);
			if (latest && latest.incarnation !== this.#state.session.incarnation) {
				const projects = this.#state.projects;
				const sessions = this.#state.sessions.map(item => item.id === latest.id ? latest : item);
				this.#state = reduceTaskState(this.#state, { type: "reset", project: this.#state.project, session: latest });
				this.#state = { ...this.#state, projects, sessions };
				this.postSnapshot();
			} else if (latest) {
				this.setState({ type: "session", session: latest });
			}
			const activeSession = this.#state.session;
			if (!activeSession) return;
			const page = await this.#client.getEvents(sessionId, this.#state.cursor, EVENT_PAGE_LIMIT);
			if (!current()) return;
			for (const event of page.events) this.#terminals.ingest(event);
			this.setState({ type: "events", page });
			const commands = await this.#client.getCommands(activeSession.id, { limit: EVENT_PAGE_LIMIT });
			if (!current()) return;
			for (const command of commands) this.setState({ type: "command_result", command });
			const pending = await this.#client.getPendingUi(activeSession.id);
			if (!current()) return;
			const requests = pending.flatMap(item => {
				const parsed = parseCediaUiRequest(item);
				if (!parsed) return [];
				const seen = this.#uiSeen.get(parsed.token) ?? Date.now();
				this.#uiSeen.set(parsed.token, seen);
				return [{
					...parsed,
					sessionId: parsed.sessionId ?? activeSession.id,
					incarnation: parsed.incarnation ?? activeSession.incarnation,
					receivedAt: parsed.receivedAt ?? seen,
				}];
			});
			for (const token of [...this.#uiSeen.keys()]) {
				if (!requests.some(item => item.token === token)) this.#uiSeen.delete(token);
			}
			this.setState({ type: "ui_sync", requests });
			this.#lastHostSyncAt = new Date().toISOString();
			if (page.events.length > 0 || commands.length > 0) this.setState({ type: "connection", status: activeSession.status === "running" ? "running" : "connected", error: undefined });
		} catch (error) {
			if (!current()) return;
			this.#client = undefined;
			this.setState({ type: "connection", status: "offline", error: errorMessage(error), markUnknown: true });
			this.post({ type: "error", text: `Cedia host disconnected: ${errorMessage(error)}`, status: "offline" });
		} finally {
			this.#polling = false;
		}
	}

	private async refresh(): Promise<void> {
		const client = await this.ensureClient();
		const projectsValue = await client.listProjects();
		const projects = asArray<unknown>(projectsValue, "projects").map(normalizeProject).filter((value): value is Project => value !== undefined);
		this.setState({ type: "projects", projects });
		let project = this.#state.project;
		const currentWorkspace = workspacePath();
		if (!project && currentWorkspace) project = projects.find(item => item.path === currentWorkspace) ?? null;
		if (!project && projects.length === 1) project = projects[0] ?? null;
		if (project) {
			this.setState({ type: "projects", projects });
			const sameProject = this.#state.project?.id === project.id;
			const sameSession = this.#state.session?.projectId === project.id;
			if (!sameProject || !sameSession) {
				this.#state = reduceTaskState(this.#state, { type: "reset", project, session: sameSession ? this.#state.session : null });
				this.postSnapshot();
			} else if (!this.#state.project) {
				this.#state = { ...this.#state, project };
				this.postSnapshot();
			}
			await this.loadProjectSessions(client, project);
		}
		await this.pullEvents();
		await this.refreshGitBranch();
		if (this.#state.session) await this.getLoginProviders().catch(() => {});
	}

	private async refreshGitBranch(): Promise<void> {
		const cwd = this.#state.session?.cwd ?? this.#state.project?.path ?? workspacePath();
		if (!cwd) {
			this.#gitBranch = undefined;
			this.#branches = [];
			return;
		}
		try {
			const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 3_000 });
			const branch = stdout.trim();
			this.#gitBranch = branch && branch !== "HEAD" ? branch : undefined;
		} catch {
			this.#gitBranch = undefined;
		}
		try {
			const { stdout } = await execFileAsync("git", ["-C", cwd, "branch", "-a"], { timeout: 3_000 });
			this.#branches = parseGitBranchList(stdout, this.#gitBranch);
		} catch {
			this.#branches = [];
		}
	}

	private async loadProjectSessions(client: CediaHostClient, project: Project): Promise<void> {
		const sessionsValue = await client.listSessions(project.id);
		const sessions = asArray<unknown>(sessionsValue, "sessions").map(normalizeSession).filter((value): value is Session => value !== undefined);
		this.setState({ type: "sessions", sessions });
		if (this.#state.session && !sessions.some(item => item.id === this.#state.session?.id)) {
			this.setState({ type: "session", session: null });
		}
	}

	private async ensureProject(client: CediaHostClient): Promise<Project> {
		if (this.#state.project) return this.#state.project;
		const path = workspacePath();
		if (!path) throw new Error("Open a folder before starting a Cedia task, or choose New task.");
		const projectsValue = await client.listProjects();
		const projects = asArray<unknown>(projectsValue, "projects").map(normalizeProject).filter((value): value is Project => value !== undefined);
		let project = projects.find(item => item.path === path);
		if (!project) project = await client.createProject(path, path.split(/[\\/]/).pop() || undefined);
		this.setState({ type: "projects", projects: projects.some(item => item.id === project!.id) ? projects : [...projects, project] });
		this.#state = reduceTaskState(this.#state, { type: "session", session: null });
		this.#state = { ...this.#state, project };
		this.postSnapshot();
		return project;
	}

	private async ensureSession(client: CediaHostClient): Promise<Session> {
		const project = await this.ensureProject(client);
		if (this.#state.session && this.#state.session.projectId === project.id) {
			const session = normalizeSession(await client.startSession(this.#state.session.id));
			if (!session) throw new Error("Cedia host returned an invalid session");
			this.setState({ type: "session", session });
			return session;
		}
		const createdValue = await client.createSession({ projectId: project.id, workspaceMode: "local" });
		const created = normalizeSession(createdValue);
		if (!created) throw new Error("Cedia host returned an invalid session");
		const startedValue = await client.startSession(created.id);
		const session = normalizeSession(startedValue) ?? created;
		this.setState({ type: "session", session });
		this.setState({ type: "connection", status: session.status === "running" ? "running" : "connected", error: undefined });
		return session;
	}

	private async requestOmp(command: string, payload: Record<string, Json> = {}): Promise<Command | undefined> {
		if (!this.#state.session) return undefined;
		try {
			const client = await this.ensureClient();
			const session = this.#state.session;
			return await client.sendCommand(session.id, { commandId: commandId(), incarnation: session.incarnation, command, payload });
		} catch (error) {
			// Refresh callers treat "no data" as a valid state, so this does not
			// throw; it must still be recoverable, and mutating callers check the
			// result with ompCommandConfirmed instead of assuming success.
			this.#log.warn(`OMP ${command} failed: ${errorMessage(error)}`);
			return undefined;
		}
	}

	private async refreshOmpState(): Promise<void> {
		const result = await this.requestOmp("get_state");
		if (!ompCommandConfirmed(result)) return;
		const data = ompCommandData(result);
		this.#thinking = thinkingFromOmpState(data);
		this.#parentSession = parentSessionFromOmpState(data);
		this.#ompPlan = planFromOmpState(data);
		this.postSnapshot();
	}

	private async loadOlderMessages(): Promise<void> {
		const result = await this.requestOmp("get_messages_page", {
			limit: 20,
			...(this.#messageCursor ? { cursor: this.#messageCursor } : {}),
		});
		if (!ompCommandConfirmed(result)) {
			this.#olderPagesAdvertised = false;
			this.#historyNote = OLDER_PAGES_NOTE;
			this.postSnapshot();
			return;
		}
		const page = messagesPageFromOmp(ompCommandData(result));
		this.#olderPagesAdvertised = page.advertised;
		this.#olderPageCount = page.messages.length;
		this.#messageCursor = page.nextCursor;
		this.#historyNote = page.advertised
			? (page.messages.length
				? `OMP advertised ${page.messages.length} older messages. Host event pages stay forward-only until those events are journaled.`
				: OLDER_PAGES_NOTE)
			: OLDER_PAGES_NOTE;
		const entries = transcriptEntriesFromOmpMessages(page.messages);
		if (entries.length) this.setState({ type: "history_page", entries });
		else this.postSnapshot();
	}

	private async selectThinkingLevel(level: string): Promise<void> {
		const allowed = this.#thinking.options.some(item => item.id === level && item.enabled);
		if (!allowed) {
			await vscode.window.showInformationMessage(this.#thinking.reason || THINKING_NOT_ADVERTISED);
			return;
		}
		// A level the user picked is a mutation: if OMP did not confirm it the
		// control must say so rather than snap back with no explanation.
		const result = await this.requestOmp("set_thinking_level", { level });
		if (!ompCommandConfirmed(result)) {
			await vscode.window.showInformationMessage(THINKING_NOT_APPLIED_REASON);
			await this.refreshOmpState();
			return;
		}
		await this.refreshOmpState();
	}

	private async sendCommand(command: string, payload: Record<string, Json>): Promise<void> {
		const client = await this.ensureClient();
		const session = await this.ensureSession(client);
		if (command === "prompt" || command === "steer" || command === "follow_up") {
			if (!this.#state.selectedModel) {
				this.post({ type: "error", text: "Choose a model before sending. Cedia does not pick a billed fallback.", status: this.#state.connection });
				return;
			}
			const counts = attachmentCounts(this.#attachments);
			if (counts.attachmentsPending > 0 || counts.attachmentsFailed > 0) {
				this.post({ type: "error", text: "Remove unfinished attachments before sending. Cedia will not dispatch a draft that still has local or failed files.", status: this.#state.connection });
				return;
			}
			const draft = typeof payload.message === "string" ? payload.message : "";
			const decision = shouldDispatch({
				lastFrozen: this.#lastFrozen,
				inFlightCommandId: this.#inFlightCommandId,
				next: {
					draftRevision: this.#draftRevision,
					attachmentRefs: this.#attachments.flatMap(item => item.contentRef ? [item.contentRef] : []),
					targetSession: session.id,
					intent: command === "follow_up" ? "follow_up" : command === "steer" ? "steer" : "send_prompt",
					draft,
				},
			});
			if (!decision.dispatch) return;
			this.#lastFrozen = decision.envelope;
			this.#inFlightCommandId = decision.envelope.commandId;
		}
		const id = this.#inFlightCommandId && (command === "prompt" || command === "steer" || command === "follow_up") ? this.#inFlightCommandId : commandId();
		this.setState({ type: "command_created", command: { commandId: id, incarnation: session.incarnation, command, payload } });
		this.setState({ type: "connection", status: "running", error: undefined });
		try {
			const result = await client.sendCommand(session.id, { commandId: id, incarnation: session.incarnation, command, payload });
			this.setState({ type: "command_result", command: result });
			if (this.#inFlightCommandId === id) this.#inFlightCommandId = undefined;
			if ((command === "prompt" || command === "steer" || command === "follow_up") && (result.status === "acknowledged" || result.status === "completed") && typeof payload.message === "string") {
				this.#lastSentDraft = payload.message;
				void this.#context.globalState.update("cedia.lastSentDraft", this.#lastSentDraft);
				if (this.#state.draft === payload.message) {
					this.setState({ type: "draft", draft: "" });
					void this.#context.globalState.update("cedia.drafts", this.#state.drafts);
				}
			}
			if (result.status === "outcome_unknown") this.setState({ type: "connection", status: "unknown", error: "Command outcome is unknown; inspect command status before retrying." });
			else await this.pullEvents();
		} catch (error) {
			if (this.#inFlightCommandId === id) this.#inFlightCommandId = undefined;
			this.setState({ type: "command_status", commandId: id, status: "unknown", error: errorMessage(error) });
			this.setState({ type: "connection", status: "unknown", error: `Command ${id} may have reached the host; it was not replayed.` });
			throw error;
		}
	}

	private async answerUi(token: string, answer: string | boolean | readonly string[] | { cancelled: true; timedOut?: boolean }): Promise<void> {
		const pending = this.#state.uiRequests.find(item => item.token === token);
		const sessionHint = this.#state.session;
		if (pending && sessionHint) {
			const allowed = canAnswer(
				{
					token,
					sessionId: pending.sessionId ?? sessionHint.id,
					incarnation: pending.incarnation ?? sessionHint.incarnation,
					method: pending.request.method,
				},
				{ sessionId: sessionHint.id, incarnation: sessionHint.incarnation },
				this.#answeredUi,
			);
			if (!allowed.ok) {
				void vscode.window.showWarningMessage(`Cedia rejected this answer (${allowed.reason}). The request was not sent.`);
				return;
			}
		}
		const client = await this.ensureClient();
		const session = await this.ensureSession(client);
		this.#answeredUi.add(token);
		const id = commandId();
		const hostAnswer: string | boolean | { cancelled: true; timedOut?: boolean } = Array.isArray(answer)
			? answer.join("\n")
			: (answer as string | boolean | { cancelled: true; timedOut?: boolean });
		this.setState({ type: "command_created", command: { commandId: id, incarnation: session.incarnation, command: "ui_response", payload: { token, answer: hostAnswer as Json } } });
		try {
			const result = await client.sendUiResponse(session.id, { commandId: id, incarnation: session.incarnation, token, answer: hostAnswer });
			if (result) this.setState({ type: "command_result", command: result });
			this.setState({ type: "ui_resolved", token });
		} catch (error) {
			this.setState({ type: "command_status", commandId: id, status: "unknown", error: errorMessage(error) });
			throw error;
		}
	}

	async newTaskFlow(): Promise<void> {
		this.rememberCurrentRoute();
		this.#projectsRoute = false;
		this.#navigationEpoch++;
		this.#historyNote = undefined;
		this.#routeError = undefined;
		this.rememberActiveTranscript();
		this.captureActivePaneDraft();
		if (visibleLeaves(this.#layout).length > 1) {
			this.#layout = assignActive(this.#layout, { sessionId: null });
			this.persistLayout();
			this.setState({ type: "reset", session: null, project: this.#state.project });
			this.applyActivePaneDraft();
			return;
		}
		this.setState({ type: "reset", session: null, project: this.#state.project });
		this.syncSinglePaneIdentity();
	}

	async openFolderFlow(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Use folder for Cedia task" });
		if (!picked?.[0]) return;
		await this.openProjectAtPath(picked[0].fsPath);
	}

	/**
	 * Add a project the way the Agents sidebar means it: pick a folder, register it
	 * with the host, and make sure it has a task, because the sidebar lists a project
	 * as the workspace group of its sessions - a project with no task would be added
	 * and stay invisible. Nothing here leaves this window; handing the folder to the
	 * workbench's own open-folder command is what opened an IDE window instead.
	 */
	async addProjectFlow(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Add folder as a Cedia project" });
		if (!picked?.[0]) return;
		await this.addProjectAtPath(picked[0].fsPath);
	}

	/**
	 * Complete a search term for the Apps panel's browser.
	 *
	 * The workbench's own fetch is subject to CORS, so the address bar cannot reach the
	 * engine's suggest endpoint; the extension host runs on Node and can. A failure is an
	 * empty list, never a thrown error the address bar would have to handle.
	 */
	async suggestSearchTerms(term: unknown): Promise<string[]> {
		if (typeof term !== "string" || term.trim().length === 0) return [];
		try {
			const response = await fetch(`${SUGGEST_ENDPOINT}${encodeURIComponent(term.trim())}`, {
				signal: AbortSignal.timeout(2000),
				headers: { accept: "application/json" },
			});
			if (!response.ok) return [];
			return parseSuggestionPayload(await response.text());
		} catch (error) {
			this.#log.debug(`search suggestions unavailable: ${errorMessage(error)}`);
			return [];
		}
	}

	private async addProjectAtPath(path: string): Promise<void> {
		if (!path) return;
		if (!existsSync(path)) {
			await vscode.window.showInformationMessage(MISSING_RECENT_REASON);
			return;
		}
		const client = await this.ensureClient();
		const projects = asArray<Project>(await client.listProjects(), "projects");
		const existing = projects.find(project => project.path === path);
		const sessions = await client.listSessions();
		const plan = projectAddPlan({
			...(existing ? { known: { archived: existing.archived === true } } : {}),
			openSessions: sessions.filter(session => session.projectId === existing?.id && !session.archived).length,
		});
		const projectValue = plan.createProject
			? await client.createProject(path, path.split(/[\\/]/).pop() || undefined)
			: existing!;
		const project = normalizeProject(projectValue);
		if (!project) throw new Error("Cedia host returned an invalid project");
		if (plan.unarchive) {
			await client.patchProject(project.id, { archived: false });
		}
		await this.rememberRecent(path);
		if (plan.createSession) {
			// No title: the host names a new task, the same way its own New Task does.
			await client.createSession({ projectId: project.id });
		}
		// The sidebar regroups rows from the refreshed projection.
		await this.refresh();
		this.postSnapshot();
	}

	private welcomeModel(): ReturnType<typeof projectsWelcomeModel> {
		const current = workspacePath();
		const paths = this.#recents.map(item => item.path);
		if (current && !paths.includes(current)) paths.unshift(current);
		return projectsWelcomeModel({
			recents: paths.map(path => ({ path, missing: !existsSync(path) })),
			cloneAdvertised: false,
		});
	}

	private async rememberRecent(path: string): Promise<void> {
		const cleaned = path.trim();
		if (!cleaned) return;
		this.#recents = [{ path: cleaned }, ...this.#recents.filter(item => item.path !== cleaned)].slice(0, 12);
		await this.#context.globalState.update("cedia.recentFolders", this.#recents);
	}

	private persistLayout(): void {
		void this.#context.globalState.update("cedia.layoutTree", serializeLayout(this.#layout));
	}

	private setWorkResource(tab: WorkPanelTab, status: ResourceStatus, detail?: string): void {
		const taskKey = draftViewKey(this.#state.project?.id, this.#state.session?.id);
		const nativeAction = tab === "changes" ? "diff" : tab === "files" ? "files" : tab === "terminal" ? "terminal" : tab === "browser" ? "browser" : tab === "preview" ? "preview" : "artifacts";
		this.setState({
			type: "work_panel",
			action: {
				type: "set_resource",
				resource: {
					id: workResourceId(taskKey, tab),
					tab,
					taskKey,
					status,
					label: tab,
					nativeAction,
					...(detail ? { detail } : {}),
				},
			},
		});
	}

	private expireWorkResource(tab: WorkPanelTab): void {
		const taskKey = draftViewKey(this.#state.project?.id, this.#state.session?.id);
		this.setState({ type: "work_panel", action: { type: "expire_resource", id: workResourceId(taskKey, tab) } });
	}

	private async restartWorkResource(tab: WorkPanelTab): Promise<void> {
		const taskKey = draftViewKey(this.#state.project?.id, this.#state.session?.id);
		const nativeAction = tab === "changes" ? "diff" : tab === "files" ? "files" : tab === "terminal" ? "terminal" : tab === "browser" ? "browser" : tab === "preview" ? "preview" : "artifacts";
		this.setState({
			type: "work_panel",
			action: {
				type: "restart_resource",
				resource: {
					id: workResourceId(taskKey, tab),
					tab,
					taskKey,
					status: "unopened",
					label: tab,
					nativeAction,
				},
			},
		});
		this.postSnapshot();
		if (tab === "terminal") await this.nativeAction("terminal");
		else if (tab === "files") await this.nativeAction("files");
		else if (tab === "changes") await this.refreshReview();
		else if (tab === "browser") {
			await vscode.window.showInformationMessage("Browser is unsupported until the OMP browser bridge advertises a live handle. No page was opened.");
		} else {
			this.setState({ type: "work_panel", action: { type: "open_tab", tab } });
			await this.refreshArtifacts();
		}
	}

	private async activatePane(viewId?: string): Promise<void> {
		if (!viewId || viewId === this.#layout.activeViewId) return;
		this.rememberActiveTranscript();
		this.captureActivePaneDraft();
		this.#layout = focusView(this.#layout, viewId);
		this.persistLayout();
		await this.revealActivePane();
	}

	private rememberActiveTranscript(): void {
		const leaf = activeLeaf(this.#layout);
		if (!leaf) return;
		this.#paneTranscripts = rememberPaneTranscript(this.#paneTranscripts, leaf, this.#state.transcript);
	}

	private captureActivePaneDraft(): void {
		const leaf = activeLeaf(this.#layout);
		if (!leaf) return;
		this.#state = { ...this.#state, drafts: { ...this.#state.drafts, [paneDraftKey(leaf)]: this.#state.draft } };
	}

	private applyActivePaneDraft(): void {
		const leaf = activeLeaf(this.#layout);
		if (!leaf) return;
		const key = paneDraftKey(leaf);
		const draft = this.#state.drafts[key] ?? "";
		this.#state = reduceTaskState(this.#state, { type: "draft", draft });
		this.#state = { ...this.#state, drafts: { ...this.#state.drafts, [key]: draft } };
	}

	private syncSinglePaneIdentity(): void {
		if (visibleLeaves(this.#layout).length !== 1) return;
		this.#layout = createLayoutTree({
			projectId: this.#state.project?.id ?? null,
			sessionId: this.#state.session?.id ?? null,
			viewId: this.#layout.activeViewId,
		});
		this.persistLayout();
	}

	private async openProjectAtPath(path: string): Promise<void> {
		if (!path) return;
		if (!existsSync(path)) {
			await vscode.window.showInformationMessage(MISSING_RECENT_REASON);
			this.postSnapshot();
			return;
		}
		this.#navigationEpoch++;
		this.#historyNote = undefined;
		this.#routeError = undefined;
		const client = await this.ensureClient();
		const existingProjects = asArray<Project>(await client.listProjects(), "projects");
		const projectValue = existingProjects.find(project => project.path === path) ?? await client.createProject(path, path.split(/[\\/]/).pop() || undefined);
		const project = normalizeProject(projectValue);
		if (!project) throw new Error("Cedia host returned an invalid project");
		await this.rememberRecent(path);
		this.setState({ type: "reset", session: null, project });
		this.setState({ type: "projects", projects: [...this.#state.projects.filter(item => item.id !== project.id), project] });
		this.syncSinglePaneIdentity();
		await this.loadProjectSessions(client, project);
	}

	private applyPaneSplit(direction: "right" | "down"): void {
		const availablePx = direction === "right" ? this.#viewport.width : this.#viewport.height;
		const room = canSplit({ direction, availablePx, paneCount: layoutLeaves(this.#layout).length });
		if (!room.ok) {
			void vscode.window.showInformationMessage(NEED_MORE_SPACE_REASON);
			return;
		}
		this.rememberActiveTranscript();
		this.captureActivePaneDraft();
		this.#layout = splitActive(this.#layout, direction, availablePx);
		this.applyActivePaneDraft();
		this.persistLayout();
		this.postSnapshot();
	}

	private async openSessionInNewPane(sessionId: string): Promise<void> {
		const next = openSessionInSplit(this.#layout, {
			sessionId,
			availablePx: this.#viewport.width,
			projectId: this.#state.project?.id ?? null,
		});
		if (!next.ok) {
			void vscode.window.showInformationMessage(next.reason);
			return;
		}
		this.rememberActiveTranscript();
		this.captureActivePaneDraft();
		this.#layout = next.tree;
		this.persistLayout();
		await this.selectSession(sessionId);
	}

	private applyClosePane(): void {
		this.captureActivePaneDraft();
		const before = visibleLeaves(this.#layout).length;
		this.#layout = closeActive(this.#layout);
		this.applyActivePaneDraft();
		this.persistLayout();
		if (before <= 1) {
			void this.newTaskFlow();
			return;
		}
		void this.revealActivePane();
	}

	private async revealActivePane(): Promise<void> {
		const leaf = activeLeaf(this.#layout);
		if (leaf?.sessionId && leaf.sessionId !== this.#state.session?.id) {
			await this.selectSession(leaf.sessionId);
			this.applyActivePaneDraft();
			this.postSnapshot();
			return;
		}
		if (!leaf?.sessionId && this.#state.session) {
			this.setState({ type: "session", session: null });
			this.applyActivePaneDraft();
			this.postSnapshot();
			return;
		}
		this.applyActivePaneDraft();
		this.postSnapshot();
	}

	private async createWorktreeOnCurrentProject(): Promise<void> {
		const project = this.#state.project;
		if (!project) {
			await this.openFolderFlow();
			return;
		}
		if (!this.#gitBranch) {
			this.#worktreeReceipt = failedWorktreeReceipt(WORKTREE_NO_GIT_REASON);
			this.postSnapshot();
			await vscode.window.showInformationMessage(WORKTREE_NO_GIT_REASON);
			return;
		}
		this.#navigationEpoch++;
		const epoch = this.#navigationEpoch;
		this.#historyNote = undefined;
		this.#routeError = undefined;
		this.#worktreeReceipt = beginWorktreeReceipt();
		this.postSnapshot();
		try {
			const client = await this.ensureClient();
			const sessionValue = await client.createSession({ projectId: project.id, workspaceMode: "worktree" });
			const created = normalizeSession(sessionValue);
			if (!created) throw new Error("Cedia host returned an invalid session");
			if (epoch !== this.#navigationEpoch) {
				this.#worktreeReceipt = cancelWorktreeReceipt({ status: "creating", path: created.cwd, sessionId: created.id });
				this.postSnapshot();
				return;
			}
			const previousProjects = this.#state.projects;
			const drafts = this.#state.drafts;
			const workbenchMode = this.#state.workbenchMode;
			this.#state = reduceTaskState(createInitialTaskState({ drafts, workbenchMode, draft: drafts[draftViewKey(project.id, created.id)] ?? "" }), { type: "session", session: created });
			this.#state = { ...this.#state, project, projects: previousProjects, sessions: [created, ...this.#state.sessions.filter(item => item.id !== created.id)], connection: "connecting" };
			this.#worktreeReceipt = readyWorktreeReceipt({ path: created.cwd, sessionId: created.id });
			this.postSnapshot();
			await this.startCreatedSession(created.id, created);
		} catch (error) {
			this.#worktreeReceipt = epoch !== this.#navigationEpoch
				? cancelWorktreeReceipt({ status: "creating" })
				: failedWorktreeReceipt(errorMessage(error));
			this.postSnapshot();
		}
	}

	private async startCreatedSession(id: string, created: ReturnType<typeof normalizeSession>): Promise<void> {
		if (!created) return;
		const epoch = this.#navigationEpoch;
		const client = await this.ensureClient();
		const startedValue = await client.startSession(id);
		if (epoch !== this.#navigationEpoch || this.#state.session?.id !== created.id) return;
		this.setState({ type: "session", session: normalizeSession(startedValue) ?? created });
		await this.pullEvents();
	}

	private routeAvailability() {
		return availabilityFromLists({
			projects: this.#state.projects,
			sessions: this.#state.sessions,
		});
	}

	private showRouteError(error: RouteErrorPage): void {
		this.#routeError = error;
		this.postSnapshot();
	}

	private async selectProject(id: string): Promise<void> {
		const validation = validateRoute({ kind: "projects", projectId: id }, this.routeAvailability());
		if (!validation.ok) {
			this.showRouteError(validation.error);
			return;
		}
		this.#navigationEpoch++;
		this.#routeError = undefined;
		this.#historyNote = undefined;
		const project = this.#state.projects.find(item => item.id === id);
		if (!project) {
			this.showRouteError(routeErrorPage({ kind: "projects", reason: "missing", id }));
			return;
		}
		const client = await this.ensureClient();
		const projects = this.#state.projects;
		this.#state = reduceTaskState(this.#state, { type: "reset", project, session: null });
		this.#state = { ...this.#state, projects };
		this.postSnapshot();
		await this.loadProjectSessions(client, project);
	}

	private async selectSession(id: string, fromHistory = false): Promise<void> {
		const validation = validateRoute({ kind: "task", projectId: this.#state.project?.id, sessionId: id }, this.routeAvailability());
		if (!validation.ok) {
			this.showRouteError(validation.error);
			return;
		}
		this.#navigationEpoch++;
		this.#routeError = undefined;
		this.#historyNote = undefined;
		const client = await this.ensureClient();
		let session = undefined as ReturnType<typeof normalizeSession>;
		try {
			session = normalizeSession(await client.getSession(id));
		} catch {
			this.showRouteError(routeErrorPage({ kind: "task", reason: "unknown", id }));
			return;
		}
		if (!session) {
			this.showRouteError(routeErrorPage({ kind: "task", reason: "missing", id }));
			return;
		}
		if (!fromHistory) {
			this.rememberCurrentRoute();
			this.#projectsRoute = false;
			this.#routeHistory = rememberRoute(this.#routeHistory, {
				kind: "task",
				projectId: session.projectId,
				sessionId: session.id,
			});
		} else {
			this.#projectsRoute = false;
		}
		this.rememberActiveTranscript();
		this.captureActivePaneDraft();
		this.#layout = assignActive(this.#layout, {
			sessionId: session.id,
			projectId: session.projectId ?? this.#state.project?.id ?? null,
		});
		this.persistLayout();
		const projects = this.#state.projects;
		const sessions = this.#state.sessions;
		this.#state = reduceTaskState(this.#state, { type: "reset", project: this.#state.projects.find(item => item.id === session.projectId) ?? this.#state.project, session });
		this.#state = { ...this.#state, projects, sessions };
		this.postSnapshot();
		await this.pullEvents();
		if (this.#modelsFetchedFor !== session.id) {
			this.#modelsFetchedFor = session.id;
			await this.getModels().catch(() => {});
		}
		await this.refreshOmpState();
	}

	private async selectModel(modelId: string, provider?: string): Promise<void> {
		const model = this.#state.models.find(item => item.id === modelId);
		const actualProvider = provider ?? model?.provider;
		if (!actualProvider) throw new Error("Model provider is unavailable; refresh the model list first.");
		await this.sendCommand("set_model", { provider: actualProvider, modelId });
		this.setState({ type: "models", models: this.#state.models, selectedModel: modelId });
	}

	private async getModels(): Promise<void> {
		const client = await this.ensureClient();
		const session = await this.ensureSession(client);
		const id = commandId();
		this.setState({ type: "command_created", command: { commandId: id, incarnation: session.incarnation, command: "get_available_models", payload: {} } });
			const result = await client.sendCommand(session.id, { commandId: id, incarnation: session.incarnation, command: "get_available_models", payload: {} });
		this.setState({ type: "command_result", command: result });
		const models = normalizeModels(result.result ?? result.ack);
		this.setState({ type: "models", models, selectedModel: this.#state.selectedModel });
	}

	private async getLoginProviders(): Promise<void> {
		const client = await this.ensureClient();
		const session = await this.ensureSession(client);
		const id = commandId();
		this.setState({ type: "command_created", command: { commandId: id, incarnation: session.incarnation, command: "get_login_providers", payload: {} } });
		const result = await client.sendCommand(session.id, { commandId: id, incarnation: session.incarnation, command: "get_login_providers", payload: {} });
		this.setState({ type: "command_result", command: result });
		this.setState({ type: "login_providers", providers: normalizeLoginProviders(result.result ?? result.ack) });
	}

	private async getSlashCommands(): Promise<void> {
		const client = await this.ensureClient();
		const session = await this.ensureSession(client);
		const id = commandId();
		this.setState({ type: "command_created", command: { commandId: id, incarnation: session.incarnation, command: "get_available_commands", payload: {} } });
		const result = await client.sendCommand(session.id, { commandId: id, incarnation: session.incarnation, command: "get_available_commands", payload: {} });
		this.setState({ type: "command_result", command: result });
		this.setState({ type: "slash_commands", commands: normalizeSlashCommands(result.result ?? result.ack) });
	}

	private async startLogin(providerId: string): Promise<void> {
		await this.sendCommand("login", { providerId });
		await this.getLoginProviders().catch(() => {});
		await this.pullEvents();
	}

	private async openLoginUrl(url: string): Promise<void> {
		await vscode.env.openExternal(vscode.Uri.parse(url));
	}

	async nativeAction(action: NativeAction): Promise<void> {
		const cwd = this.#state.session?.cwd ?? this.#state.project?.path ?? workspacePath();
		switch (action) {
			case "files": {
				this.#pendingNativeDestination = queuePendingNativeDestination(this.#pendingNativeDestination, "explorer");
				await this.#context.globalState.update("cedia.pendingNativeDestination", this.#pendingNativeDestination);
				const windowFolder = workspacePath();
				const willReload = Boolean(cwd && windowFolder && resolve(windowFolder) !== resolve(cwd));
				const destination = persistDestinationAcrossReload(willReload, this.#pendingNativeDestination);
				if (!destination.consumeNow) {
					if (cwd) await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(cwd), { forceNewWindow: false, forceReuseWindow: true });
					return;
				}
				await this.setWorkbenchMode("ide");
				break;
			}
			case "diff":
				this.setState({ type: "work_panel", action: { type: "open_tab", tab: "changes" } });
				await this.refreshReview();
				break;
			case "terminal": {
				const plan = newUserPtyPlan(cwd);
				const terminal = vscode.window.createTerminal({ name: plan.title, cwd: plan.cwd || cwd });
				this.#userPtys = [...this.#userPtys, {
					terminal,
					preview: { id: commandId(), title: plan.title, cwd: plan.cwd || cwd || "", ended: false },
				}];
				terminal.show();
				this.setWorkResource("terminal", "live", plan.cwd || cwd || "");
				break;
			}
			case "settings": await this.openCediaSettings(); break;
			case "host_settings":
				await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:cedia.cedia");
				break;
			case "preview":
				this.setState({ type: "work_panel", action: { type: "open_tab", tab: "preview" } });
				await this.refreshArtifacts();
				break;
			case "artifacts": {
				if (!this.#client || !this.#state.session) {
					await vscode.window.showInformationMessage("Preview and artifacts open from a Cedia task. No file was executed.");
					return;
				}
				await showArtifacts(this.#client, this.#state.session.id, join(this.#context.globalStorageUri.fsPath, "artifacts"));
				break;
			}
			case "browser":
				await vscode.window.showInformationMessage("Browser is unsupported until the OMP browser bridge advertises a live handle. No page was opened.");
				break;
			case "pair":
				await this.pairDevice();
				break;
			case "devices":
				await this.manageDevices();
				await this.refreshDevices();
				break;
		}
	}

	private async refreshReview(): Promise<void> {
		const cwd = this.#state.session?.cwd ?? this.#state.project?.path ?? workspacePath() ?? "";
		if (!cwd) {
			this.#review = emptyReview();
			this.#reviewPorcelain = undefined;
			this.#reviewCwd = undefined;
			this.postSnapshot();
			return;
		}
		if (this.#reviewCwd !== cwd) {
			this.#reviewPorcelain = undefined;
			this.#reviewCwd = cwd;
		}
		try {
			const { stdout } = await execFileAsync("git", ["-C", cwd, "status", "--porcelain=v1", "-uall"], { timeout: 8_000, maxBuffer: 1_000_000 });
			const next = reviewFromGitStatus(stdout, cwd);
			const selected = this.#review.selectedPath
				? { selectedPath: this.#review.selectedPath, hunks: this.#review.hunks, diffError: this.#review.diffError }
				: {};
			this.#review = this.#review.selectedPath && this.#reviewPorcelain !== undefined && this.#reviewPorcelain !== stdout
				? markReviewStale({ ...next, ...selected })
				: { ...next, ...selected };
			this.#reviewPorcelain = stdout;
		} catch (error) {
			this.#review = reviewFromGitStatus("", cwd, errorMessage(error));
			this.#reviewPorcelain = undefined;
		}
		await this.applyDirtyConflict();
		this.setWorkResource("changes", this.#review.stale ? "stale" : this.#review.files.length ? "ready" : "unopened");
	}

	private async refreshArtifacts(): Promise<void> {
		if (!this.#client || !this.#state.session) {
			this.#artifacts = [];
			this.#artifactsError = "Open a running task to list immutable artifact receipts.";
			this.postSnapshot();
			return;
		}
		try {
			this.#artifacts = await this.#client.listArtifacts(this.#state.session.id);
			this.#artifactsError = undefined;
			const mapped = mapArtifactsForWebview(this.#artifacts, this.#lastGoodByName);
			this.#lastGoodByName = mapped.lastGoodByName;
			const candidate = mapped.artifacts.find((item) => canInlinePreviewBytes(item.preview.kind, item.size, item) && !item.retainedLastGood)
				?? mapped.artifacts.find((item) => canInlinePreviewBytes(item.preview.kind, item.size, item));
			if (candidate && this.#state.session) {
				try {
					const bytes = await downloadArtifact(this.#client, this.#state.session.id, candidate);
					const mime = inlinePreviewMime(candidate.preview.kind, candidate);
					this.#inlinePreview = candidate.preview.kind === "text"
						? { sha256: candidate.sha256, kind: "text", text: bytes.toString("utf8").slice(0, 8_000) }
						: mime
							? { sha256: candidate.sha256, kind: candidate.preview.kind, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` }
							: undefined;
				} catch {
					this.#inlinePreview = undefined;
				}
			} else {
				this.#inlinePreview = undefined;
			}
		} catch (error) {
			this.#artifactsError = errorMessage(error);
		}
		this.postSnapshot();
	}

	private async refreshDevices(): Promise<void> {
		try {
			const client = await this.ensureClient();
			this.#devices = await client.listDevices();
			this.#devicesError = undefined;
		} catch (error) {
			this.#devicesError = errorMessage(error);
		}
		this.postSnapshot();
	}

	private async pickAttachments(): Promise<void> {
		const uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, openLabel: "Attach to Cedia" });
		if (!uris?.length) return;
		for (const uri of uris) {
			const id = commandId();
			const name = basename(uri.fsPath);
			if (alreadyAttached(this.#attachments, { name })) {
				void vscode.window.showInformationMessage("Already attached. Cedia added another chip because you asked again.");
			}
			this.#attachments = [...this.#attachments, { id, name, mime: "application/octet-stream", state: "local" }];
			this.postSnapshot();
			this.#attachments = this.#attachments.map(item => item.id === id
				? { ...item, state: "failed", error: "Host file upload is not advertised. Remove this chip to send, or wait until OMP advertises an upload." }
				: item);
		}
		this.postSnapshot();
	}

	private async reviewFile(path: string): Promise<void> {
		const cwd = this.#state.session?.cwd ?? this.#state.project?.path ?? workspacePath();
		if (!cwd) {
			this.#review = { ...this.#review, selectedPath: path, hunks: [], diffError: "Open a project before reviewing a file." };
			this.postSnapshot();
			return;
		}
		const resolved = safeWorkspaceFile(cwd, path);
		if (!resolved) {
			this.#review = { ...this.#review, selectedPath: path, hunks: [], diffError: "Cedia ignored a path outside this task workspace." };
			this.postSnapshot();
			return;
		}
		try {
			const { stdout } = await execFileAsync("git", ["-C", cwd, "diff", "--no-color", "--", path], { timeout: 8_000, maxBuffer: 1_000_000 });
			const hunks = parseUnifiedDiff(stdout);
			const binary = !hunks.length && await this.gitPathIsBinary(cwd, path);
			this.#review = {
				...this.#review,
				selectedPath: path,
				hunks,
				diffError: hunks.length
					? undefined
					: binary
						? NATIVE_DIFF_BINARY_REASON
						: "No unstaged hunks. Stage and commit stay in Code-OSS — Cedia does not invent a second Git owner.",
			};
		} catch (error) {
			this.#review = { ...this.#review, selectedPath: path, hunks: [], diffError: errorMessage(error) };
		}
		await this.applyDirtyConflict();
		this.postSnapshot();
	}

	private async applyDirtyConflict(): Promise<void> {
		try {
			const inventory = await this.#editor.inventory(false);
			this.#review = markReviewDirtyConflict(
				this.#review,
				inventory.documents.filter(item => item.dirty).map(item => item.path),
			);
		} catch {
			// Dirty inventory is additive honesty, not a second review owner.
		}
	}

	private async openWorkspaceFile(path: string): Promise<void> {
		const cwd = this.#state.session?.cwd ?? this.#state.project?.path ?? workspacePath();
		if (!cwd) {
			await vscode.window.showInformationMessage("Open a project before opening a review file.");
			return;
		}
		const resolved = safeWorkspaceFile(cwd, path);
		if (!resolved) {
			await vscode.window.showWarningMessage("Cedia ignored a path outside this task workspace.");
			return;
		}
		await this.setWorkbenchMode("ide");
		await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(resolved));
	}

	private async openMergeEditor(path: string): Promise<void> {
		const cwd = this.#state.session?.cwd ?? this.#state.project?.path ?? workspacePath();
		if (!cwd) {
			await vscode.window.showInformationMessage("Open a project before opening a merge editor.");
			return;
		}
		const resolved = safeWorkspaceFile(cwd, path);
		if (!resolved) {
			await vscode.window.showWarningMessage("Cedia ignored a path outside this task workspace.");
			return;
		}
		const selected = this.#review.files.find(file => file.path === path);
		if (!reviewOpenMergeEnabled(selected)) {
			await vscode.window.showInformationMessage(REVIEW_CONFLICT_REASON);
			return;
		}
		await this.setWorkbenchMode("ide");
		const uri = vscode.Uri.file(resolved);
		await vscode.commands.executeCommand("vscode.open", uri);
		try {
			await vscode.commands.executeCommand("git.openMergeEditor", uri);
		} catch {
			await vscode.window.showInformationMessage(REVIEW_CONFLICT_REASON);
		}
	}

	async pairDevice(): Promise<void> {
		const name = await vscode.window.showInputBox({ title: "Pair an iPhone with this Mac", prompt: "Name this device. It can control Cedia tasks until revoked.", value: "My iPhone", ignoreFocusOut: true });
		if (!name?.trim()) return;
		try {
			const client = await this.ensureClient();
			const offer = await client.pairDevice(name.trim());
			const code = await QRCode.toDataURL(JSON.stringify(offer), { width: 320, margin: 2 });
			const panel = vscode.window.createWebviewPanel("cediaPairing", "Pair iPhone", vscode.ViewColumn.Active, {});
			panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>body{font-family:system-ui;padding:32px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}img{max-width:100%}p{max-width:40em}</style></head><body><h1>Connect your iPhone</h1><p>Scan this private QR code in Cedia on your iPhone. Keep it private: it grants control of this Mac’s Cedia tasks.</p><img alt="Private Cedia pairing QR code" src="${code}"><p>Revoke access anytime with Cedia: Manage Devices. Close this tab after pairing.</p></body></html>`;
		} catch (error) {
			const reason = errorMessage(error);
			await vscode.window.showErrorMessage(`Cedia could not start iPhone pairing: ${reason}. Next step: start/configure the Cedia host, then try Pair iPhone again (or open Cedia Settings → Devices).`);
		}
	}

	async manageDevices(): Promise<void> {
		const client = await this.ensureClient();
		const devices = (await client.listDevices()).filter(device => device.role !== "owner" && !device.revokedAt);
		const selected = await vscode.window.showQuickPick(devices.map(device => ({ label: device.name, description: "Revoke access", id: device.id })), { title: "Cedia devices" });
		if (selected) { await client.revokeDevice(selected.id); void vscode.window.showInformationMessage(`Revoked ${selected.label}`); }
	}

	async ompControls(): Promise<void> {
		const selected = await vscode.window.showQuickPick(jsonPickerCommands(RPC_COMMAND_TYPES).map(command => ({ label: command })), { title: "OMP controls", placeHolder: "Run a control on the current OMP session" });
		if (!selected) return;
		const raw = await vscode.window.showInputBox({ title: `OMP: ${selected.label}`, prompt: "JSON parameters for this pinned OMP control", value: "{}", validateInput: value => { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? null : "Enter a JSON object"; } catch { return "Enter valid JSON"; } } });
		if (raw === undefined) return;
		await this.sendCommand(selected.label, JSON.parse(raw));
	}

	async openCediaSettings(): Promise<void> {
		await this.setWorkbenchMode("agents");
		await this.revealAgentSurface();
		this.post({ type: "open_settings", section: "Devices/connections" });
	}

	/**
	 * Open a terminal running `omp` so the user can sign providers in with
	 * `/login <provider>`. Plain inherited environment on purpose: it is the
	 * same credential store the user's own terminal logins and the host read,
	 * so nothing is invented and nothing needs syncing. Not tracked as a task
	 * work resource — signing in is account setup, not task output.
	 */
	async ompSignIn(): Promise<void> {
		const terminal = vscode.window.createTerminal({ name: "OMP sign-in (/login)" });
		terminal.show();
		terminal.sendText("omp");
	}

	private async runMoreAction(id: string): Promise<void> {
		const session = this.#state.session;
		if (id === "open_ide_new_window") return this.setWorkbenchMode("ide", { newWindow: true });
		if (id === "mark_unread") { this.#markedUnread = true; this.postSnapshot(); return; }
		if (id === "discard_draft") {
			const plan = discardDraftPlan({
				draft: this.#state.draft,
				projectId: this.#state.project?.id,
				sessionId: this.#state.session?.id,
			});
			if (!plan.hasText) {
				await vscode.window.showInformationMessage("No draft on this view. Discard draft does not delete a session.");
				return;
			}
			const confirmed = await vscode.window.showWarningMessage(DISCARD_DRAFT_CONFIRM, { modal: true }, "Discard draft");
			if (!confirmed) return;
			this.#draftPersistOk = false;
			this.#state = reduceTaskState(this.#state, { type: "draft", draft: "" });
			this.captureActivePaneDraft();
			try {
				await this.#context.globalState.update("cedia.drafts", this.#state.drafts);
				this.#draftPersistOk = true;
			} catch {
				this.#draftPersistOk = false;
			}
			this.postSnapshot();
			return;
		}
		if (id === "split_right") {
			this.applyPaneSplit("right");
			return;
		}
		if (id === "split_down") {
			this.applyPaneSplit("down");
			return;
		}
		if (id === "close_pane") {
			this.applyClosePane();
			return;
		}
		if (id === "maximize_pane") {
			this.#layout = maximizeActive(this.#layout);
			this.persistLayout();
			this.postSnapshot();
			return;
		}
		if (id === "restore_layout") {
			this.#layout = restoreLayout(this.#layout);
			this.persistLayout();
			this.postSnapshot();
			return;
		}
		if (id === "move_left" || id === "move_right" || id === "move_up" || id === "move_down") {
			const direction = id.slice("move_".length) as "left" | "right" | "up" | "down";
			this.#layout = moveActive(this.#layout, direction);
			this.persistLayout();
			this.postSnapshot();
			return;
		}
		if (id === "maximize_area") {
			this.setState({ type: "work_panel", action: { type: "close_panel" } });
			return;
		}
		if (id === "fork") {
			if (!this.#parentSession) {
				await vscode.window.showInformationMessage(FORK_NO_PARENT_REASON);
				return;
			}
			const forked = await this.requestOmp("new_session", { parentSession: this.#parentSession });
			if (!ompCommandConfirmed(forked)) {
				await vscode.window.showInformationMessage(FORK_NOT_CREATED_REASON);
				return;
			}
			await this.refresh();
			return;
		}
		if (id === "details") {
			await vscode.window.showInformationMessage(session ? `${session.title}\n${session.cwd || ""}\n${session.id}` : "No task");
			return;
		}
		if (!session) return;
		const client = await this.ensureClient();
		if (id === "rename") {
			const title = await vscode.window.showInputBox({ title: "Task name", value: session.title });
			if (title?.trim()) await client.patchSession(session.id, { title: title.trim() });
		} else if (id === "reconcile") {
			const confirmed = await vscode.window.showWarningMessage("Previous work may have changed files before the connection was lost. Inspect the workspace before resuming. Cedia will not repeat the old command.", { modal: true }, "I inspected the outcome — resume");
			if (confirmed) await client.reconcileSession(session.id);
		} else if (id === "pin" || id === "unpin") await client.patchSession(session.id, { pinned: !session.pinned });
		else if (id === "archive" || id === "restore") {
			if (id === "archive" && session.status === "running") {
				const confirmed = await vscode.window.showWarningMessage("Work continues on this Mac. Archive only hides the task from the list. Cedia will not stop OMP.", { modal: true }, "Archive anyway");
				if (!confirmed) return;
			}
			await client.patchSession(session.id, { archived: !session.archived });
		}
		await this.refresh();
	}

	private async inspectOutcome(): Promise<void> {
		const session = this.#state.session;
		const unknown = Object.values(this.#state.pendingCommands).filter(item => item.status === "unknown");
		const lines = [
			session ? `${session.title}\n${session.id}\nstatus ${session.status}` : "No task is open.",
			this.#state.lastError ? `Last error: ${this.#state.lastError}` : "",
			`Connection: ${this.#state.connection}`,
			this.#lastHostSyncAt ? `Last host sync: ${this.#lastHostSyncAt}` : "Last host sync: never",
			unknown.length
				? `Unknown commands:\n${unknown.map(item => `${item.command} · ${item.commandId}`).join("\n")}`
				: "No unknown command receipts.",
			"Cedia will not repeat the old command. Inspect the workspace, then reconcile if the session requires review.",
		].filter(Boolean);
		const action = session?.status === "recovery_required" ? "Reconcile…" : undefined;
		const picked = await vscode.window.showInformationMessage(lines.join("\n\n"), { modal: true }, ...(action ? [action] : []));
		if (picked === "Reconcile…") await this.runMoreAction("reconcile");
	}

	async taskActions(): Promise<void> {
		const session = this.#state.session;
		const chrome = moreMenuActions({
			hasSession: Boolean(session),
			pinned: session?.pinned,
			archived: session?.archived,
			recoveryRequired: session?.status === "recovery_required",
			hasParent: Boolean(this.#parentSession),
			hasDraft: this.#state.draft.trim().length > 0,
		});
		const extras: Array<vscode.QuickPickItem & { id?: string }> = [
			{ label: "New task" },
			{ label: "Show interaction terminal" },
			{ label: "Artifacts" },
			{ label: "OMP controls" },
			{ label: "Open browser", description: "Unsupported until the OMP browser bridge advertises a live handle." },
			{ label: "Pair iPhone" },
			{ label: "Manage devices" },
		];
		const action = await vscode.window.showQuickPick<vscode.QuickPickItem & { id?: MoreMenuActionId | string }>([
			...chrome.map((item) => ({ label: item.label, description: item.reason, id: item.id })),
			...extras,
		], { title: "Cedia" });
		if (!action) return;
		const id = action.id;
		if (id) return this.runMoreAction(String(id));
		if (action.label === "New task") return this.newTaskFlow();
		if (action.label === "OMP controls") return this.ompControls();
		if (action.label === "Pair iPhone") return this.pairDevice();
		if (action.label === "Manage devices") return this.manageDevices();
		if (action.label === "Open browser") { await vscode.window.showInformationMessage("Browser is unsupported until the OMP browser bridge advertises a live handle. No page was opened."); return; }
		if (!session) return;
		if (action.label === "Show interaction terminal") {
			if (!this.#terminals.show(session.id, session.incarnation)) void vscode.window.showInformationMessage("This task has no interaction terminal yet.");
			return;
		}
		if (action.label === "Artifacts") {
			const client = await this.ensureClient();
			await showArtifacts(client, session.id, join(this.#context.globalStorageUri.fsPath, "artifacts"));
		}
	}

	private sessionForMutation(sessionId?: string): Session | undefined {
		if (sessionId) {
			if (this.#state.session?.id === sessionId) return this.#state.session;
			return this.#state.sessions.find(item => item.id === sessionId);
		}
		return this.#state.session ?? undefined;
	}

	private async patchListedSession(sessionId: string | undefined, apply: (session: Session, client: CediaHostClient) => Promise<void>): Promise<void> {
		const session = this.sessionForMutation(sessionId);
		if (!session) return;
		const client = await this.ensureClient();
		await apply(session, client);
		if (this.#state.project) await this.loadProjectSessions(client, this.#state.project);
	}

	private async handleMessage(message: WebviewMessage): Promise<void> {
		switch (message.type) {
			case "send_prompt":
				await this.activatePane(message.viewId);
				await this.sendCommand("prompt", { message: message.text });
				break;
			case "steer":
				await this.activatePane(message.viewId);
				await this.sendCommand("steer", { message: message.text });
				break;
			case "follow_up":
				await this.activatePane(message.viewId);
				await this.sendCommand("follow_up", { message: message.text });
				break;
			case "stop": {
				if (!this.#client || !this.#state.session) return;
				await this.sendCommand("abort", {});
				this.setState({ type: "connection", status: "connected", error: undefined });
				await this.pullEvents();
				break;
			}
			case "new_task": await this.newTaskFlow(); break;
			case "open_folder": await this.openFolderFlow(); break;
			case "task_actions": await this.taskActions(); break;
			case "more_action": await this.runMoreAction(message.id); break;
			case "viewport":
				this.#viewport = { width: message.width, height: message.height };
				this.postSnapshot();
				break;
			case "select_project": await this.selectProject(message.projectId); break;
			case "select_session": await this.selectSession(message.sessionId); break;
			case "search": {
				const searchEpoch = ++this.#searchEpoch;
				const navigationEpoch = this.#navigationEpoch;
				const query = message.query;
				const scope = message.scope ?? this.#search.scope;
				this.#search = {
					...this.#search,
					query,
					scope,
					updating: true,
					queryId: searchEpoch,
				};
				this.postSnapshot();
				let files: { path: string }[] = [];
				let lastIndexedNote: string | undefined;
				if (query.trim() && (scope === "all" || scope === "files")) {
					const cleaned = query.replace(/[{}[\]*?]/g, "").slice(0, 64);
					if (cleaned) {
						try {
							const uris = await vscode.workspace.findFiles(`**/*${cleaned}*`, "{**/node_modules/**,**/.git/**,**/dist/**,**/upstream/**,**/desktop/**}", 24);
							files = uris.map(uri => ({ path: vscode.workspace.asRelativePath(uri) }));
						} catch {
							lastIndexedNote = SEARCH_INDEX_FAILED_NOTE;
						}
					}
				}
				if (searchEpoch !== this.#searchEpoch || navigationEpoch !== this.#navigationEpoch) break;
				this.#search = {
					...buildSearchHits({
						query,
						scope,
						sessions: this.#state.sessions,
						files,
						settings: [...SETTINGS_SECTIONS],
						settingRows: this.currentSettingsRows().map(row => ({ id: row.id, section: row.section, label: row.label })),
						transcripts: Object.entries(this.#transcriptIndex).map(([sessionId, row]) => ({
							sessionId,
							title: row.title,
							text: row.text,
						})),
					}),
					updating: false,
					queryId: searchEpoch,
					...(lastIndexedNote ? { lastIndexedNote } : {}),
				};
				this.postSnapshot();
				break;
			}
			case "refresh": await this.refresh(); break;
			case "load_more":
				await this.loadOlderMessages();
				break;
			case "get_models": await this.getModels(); break;
			case "get_login_providers": await this.getLoginProviders(); break;
			case "get_slash_commands": await this.getSlashCommands(); break;
			case "run_slash": await this.sendCommand("prompt", { message: `/${message.name.replace(/^\/+/, "")}` }); break;
			case "compact": await this.sendCommand("compact", {}); break;
			case "start_login": await this.startLogin(message.providerId); break;
			case "open_login_url": await this.openLoginUrl(message.url); break;
			case "select_model": await this.selectModel(message.modelId, message.provider); break;
			case "select_thinking_level": await this.selectThinkingLevel(message.level); break;
			case "ui_answer": await this.answerUi(message.token, message.answer); break;
			case "ui_cancel": await this.answerUi(message.token, { cancelled: true }); break;
			case "native_action": await this.nativeAction(message.action); break;
			case "rename_session": {
				await this.patchListedSession(message.sessionId, async (session, client) => {
					const title = message.title?.trim() || await vscode.window.showInputBox({ title: "Task name", value: session.title });
					if (!title?.trim()) return;
					const updated = await client.patchSession(session.id, { title: title.trim() });
					const next = normalizeSession(updated);
					if (next && this.#state.session?.id === session.id) this.setState({ type: "session", session: next });
				});
				break;
			}
			case "archive_session": {
				await this.patchListedSession(message.sessionId, async (session, client) => {
					const hide = message.archived !== false;
					if (hide && session.status === "running") {
						const confirmed = await vscode.window.showWarningMessage("Work continues on this Mac. Archive only hides the task from the list. Cedia will not stop OMP.", { modal: true }, "Archive anyway");
						if (!confirmed) return;
					}
					await client.patchSession(session.id, { archived: hide });
					if (hide && this.#state.session?.id === session.id) this.setState({ type: "session", session: null });
				});
				break;
			}
			case "pin_session": {
				await this.patchListedSession(message.sessionId, async (session, client) => {
					await client.patchSession(session.id, { pinned: message.pinned });
				});
				break;
			}
			// The dock's own Delete item. The Agents window's list confirms before it
			// sends (`cedia.session.delete`), so this side has to ask: the host's delete
			// removes the record and the transcript it wrote, and nothing brings it back.
			case "delete_session": {
				const session = this.sessionForMutation(message.sessionId);
				if (!session) return;
				const confirmed = await vscode.window.showWarningMessage(
					`Delete "${session.title}"? This action cannot be undone.`,
					{ modal: true },
					"Delete",
				);
				if (!confirmed) return;
				await this.deleteChatSessions([session.id]);
				break;
			}
			case "set_workbench_mode": await this.setWorkbenchMode(message.mode); break;
			case "persist_draft": {
				this.#draftRevision += 1;
				this.#draftPersistOk = false;
				this.#state = reduceTaskState(this.#state, { type: "draft", draft: message.draft });
				this.captureActivePaneDraft();
				this.postSnapshot();
				try {
					await this.#context.globalState.update("cedia.drafts", this.#state.drafts);
					this.#draftPersistOk = true;
				} catch {
					this.#draftPersistOk = false;
				}
				this.postSnapshot();
				break;
			}
			case "persist_scroll":
				this.setState({
					type: "transcript_scroll",
					key: this.scrollKeyForView(message.viewId),
					offset: message.offset,
					followLatest: message.followLatest,
					...(message.eventId ? { eventId: message.eventId } : {}),
				});
				break;
			case "work_panel":
				this.setState({ type: "work_panel", action: { type: "open_tab", tab: message.tab } });
				if (message.tab === "changes") await this.refreshReview();
				if (message.tab === "artifacts" || message.tab === "preview") await this.refreshArtifacts();
				break;
			case "close_work_panel": this.setState({ type: "work_panel", action: { type: "close_panel" } }); break;
			case "set_pref": {
				const base = normalizeProductPrefs({ ...this.#prefs, ...(this.#settingsDraft?.values ?? {}) });
				const next = message.key === "density" && (message.value === "comfortable" || message.value === "detailed")
					? applyProductPref(base, { density: message.value })
					: message.key === "panelPosition" && (message.value === "right" || message.value === "bottom")
						? applyProductPref(base, { panelPosition: message.value })
						: message.key === "startupView" && (message.value === "ide" || message.value === "agents" || message.value === "last_task")
							? applyProductPref(base, { startupView: message.value })
						: message.key === "submitEnter" && typeof message.value === "boolean"
							? applyProductPref(base, { submitEnter: message.value })
							: message.key === "reduceMotion" && typeof message.value === "boolean"
								? applyProductPref(base, { reduceMotion: message.value })
								: message.key === "highContrast" && typeof message.value === "boolean"
									? applyProductPref(base, { highContrast: message.value })
								: message.key === "windowRestore" && typeof message.value === "boolean"
									? applyProductPref(base, { windowRestore: message.value })
								: message.key === "autoHideEmptyIde" && typeof message.value === "boolean"
									? applyProductPref(base, { autoHideEmptyIde: message.value })
								: base;
				this.#settingsDraft = beginSettingsDraft("Appearance", this.#settingsDraft?.revision ?? this.#settingsRevision, appearanceValues(next));
				this.#settingsApplyError = undefined;
				this.postSnapshot();
				break;
			}
			case "apply_settings": {
				const draft = beginSettingsDraft(message.section, message.revision, message.values, message.scope ?? "global");
				const result = applySettingsSection(this.#settingsRevision, draft);
				if (!result.ok) {
					this.#settingsDraft = draft;
					this.#settingsApplyError = result.reason;
					this.postSnapshot();
					break;
				}
				this.#prefs = normalizeProductPrefs({ ...this.#prefs, ...result.values });
				this.#settingsRevision = result.revision;
				this.#settingsDraft = undefined;
				this.#settingsApplyError = undefined;
				this.#settingsResetPreview = undefined;
				void this.#context.globalState.update("cedia.productPrefs", this.#prefs);
				void this.#context.globalState.update("cedia.settingsRevision", this.#settingsRevision);
				if (this.#prefs.panelPosition !== this.#state.workPanel.position) {
					this.setState({ type: "work_panel", action: { type: "set_position", position: this.#prefs.panelPosition } });
				} else {
					this.postSnapshot();
				}
				break;
			}
			case "reset_settings": {
				const key = message.key;
				if (!isProductPrefSettingKey(key)) break;
				const currentValues = normalizeProductPrefs({ ...this.#prefs, ...(this.#settingsDraft?.values ?? {}) });
				const current = currentValues[key];
				const inherited = DEFAULT_PRODUCT_PREFS[key];
				this.#settingsResetPreview = previewResetOverride(key, current, inherited);
				this.#settingsDraft = beginSettingsDraft(
					"Appearance",
					this.#settingsDraft?.revision ?? this.#settingsRevision,
					appearanceValues(applyProductPref(currentValues, { [key]: inherited })),
				);
				this.#settingsApplyError = undefined;
				this.postSnapshot();
				break;
			}
			case "route_error_action": {
				this.#routeError = undefined;
				if (message.action === "projects") await this.openProjectsRoute();
				else await this.goRouteBack();
				break;
			}
			case "navigate_projects":
				await this.openProjectsRoute();
				break;
			case "route_back":
				await this.goRouteBack();
				break;
			case "route_forward":
				await this.goRouteForward();
				break;
			case "work_panel_layout":
				if (message.position) this.#state = reduceTaskState(this.#state, { type: "work_panel", action: { type: "set_position", position: message.position } });
				if (message.preferredWidth !== undefined || message.preferredHeight !== undefined) {
					this.#state = reduceTaskState(this.#state, { type: "work_panel", action: { type: "set_size", preferredWidth: message.preferredWidth, preferredHeight: message.preferredHeight } });
				}
				if (message.position && message.position !== this.#prefs.panelPosition) {
					this.#prefs = applyProductPref(this.#prefs, { panelPosition: message.position });
					void this.#context.globalState.update("cedia.productPrefs", this.#prefs);
				}
				if (message.preferredSidebarWidth !== undefined) {
					this.#prefs = applyProductPref(this.#prefs, { sidebarWidth: clampSidebarWidth(message.preferredSidebarWidth) });
					void this.#context.globalState.update("cedia.productPrefs", this.#prefs);
				}
				void this.#context.globalState.update("cedia.workPanelLayout", {
					preferredWidth: this.#state.workPanel.preferredWidth,
					preferredHeight: this.#state.workPanel.preferredHeight,
					position: this.#state.workPanel.position,
					preferredSidebarWidth: this.#prefs.sidebarWidth,
				});
				this.postSnapshot();
				break;
			case "pick_attachments": await this.pickAttachments(); break;
			case "retry_attachment": {
				this.#attachments = this.#attachments.map(item => item.id !== message.id ? item : {
					...reduceAttachment(item, { type: "retry" }),
					state: "failed",
					error: "Host file upload is not advertised. Remove this chip to send, or wait until OMP advertises an upload.",
				});
				this.postSnapshot();
				break;
			}
			case "remove_attachment":
				this.#attachments = this.#attachments.filter(item => item.id !== message.id);
				this.postSnapshot();
				break;
			case "refresh_review": await this.refreshReview(); break;
			case "refresh_devices": await this.refreshDevices(); break;
			case "open_workspace_file": await this.openWorkspaceFile(message.path); break;
			case "review_file": await this.reviewFile(message.path); break;
			case "native_diff": await this.openNativeDiff(message.path); break;
			case "open_in_split": await this.openSessionInNewPane(message.sessionId); break;
			case "select_theme": await vscode.commands.executeCommand("workbench.action.selectTheme"); break;
			case "open_keybindings": await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings"); break;
			case "open_merge_editor": await this.openMergeEditor(message.path); break;
			case "jump_latest":
				this.#markedUnread = false;
				this.setState({
					type: "transcript_scroll",
					key: draftViewKey(this.#state.project?.id, this.#state.session?.id),
					offset: 0,
					followLatest: true,
				});
				break;
			case "inspect_outcome": await this.inspectOutcome(); break;
			case "set_sidebar_filters":
				this.#sidebarFilters = normalizeSidebarFilters({ ...this.#sidebarFilters, ...message.filters });
				void this.#context.globalState.update("cedia.sidebarFilters", this.#sidebarFilters);
				this.postSnapshot();
				break;
			case "export_diagnostics":
				await this.exportDiagnostics();
				break;
			case "restore_sent_draft":
				if (this.#lastSentDraft) {
					this.setState({ type: "draft", draft: this.#lastSentDraft });
					void this.#context.globalState.update("cedia.drafts", this.#state.drafts);
				}
				break;
			case "copy_queue_draft": {
				const command = this.#state.pendingCommands[message.commandId];
				const payload = command?.payload;
				const text = payload && typeof payload.message === "string" ? payload.message : "";
				if (text.trim()) {
					this.setState({ type: "draft", draft: text });
					void this.#context.globalState.update("cedia.drafts", this.#state.drafts);
				}
				break;
			}
			case "revoke_device": {
				const client = await this.ensureClient();
				await client.revokeDevice(message.deviceId);
				await this.refreshDevices();
				break;
			}
			case "mark_all_read":
				this.#markedUnread = false;
				this.postSnapshot();
				break;
			case "download_artifact":
				await this.downloadArtifactCopy(message.sha256);
				break;
			case "select_destination":
				await this.selectDestination(message.id);
				break;
			case "mention_pick":
				await this.pickMention(message.kind, message.id);
				break;
			case "refresh_branch":
				await this.refreshGitBranch();
				this.postSnapshot();
				break;
			case "select_branch_ref": {
				const hit = this.#branches.find(item => item.name === message.ref);
				if (!hit) {
					await vscode.window.showInformationMessage("That ref is not in the advertised Git list. Cedia will not invent main or checkout.");
					break;
				}
				this.#draftBranchRef = hit.name;
				this.postSnapshot();
				await vscode.window.showInformationMessage(`${BRANCH_SELECT_REASON} Target: ${hit.name}.`);
				break;
			}
			case "create_worktree":
				await this.createWorktreeOnCurrentProject();
				break;
			case "cancel_worktree":
				if (this.#worktreeReceipt.status === "creating") this.#navigationEpoch++;
				this.#worktreeReceipt = cancelWorktreeReceipt(this.#worktreeReceipt);
				this.postSnapshot();
				break;
			case "restart_resource":
				await this.restartWorkResource(message.tab);
				break;
			case "set_queue_collapsed":
				this.#queueCollapsed = message.collapsed;
				void this.#context.globalState.update("cedia.queueCollapsed", this.#queueCollapsed);
				this.postSnapshot();
				break;
			case "split_pane":
				this.applyPaneSplit(message.direction);
				break;
			case "close_pane":
				this.applyClosePane();
				break;
			case "focus_pane":
				this.captureActivePaneDraft();
				this.#layout = focusView(this.#layout, message.viewId);
				this.persistLayout();
				await this.revealActivePane();
				break;
			case "open_recent":
				await this.openProjectAtPath(message.path);
				break;
			case "focus_user_pty": {
				const row = this.#userPtys.find(item => item.preview.id === message.id);
				if (!row) {
					await vscode.window.showInformationMessage(focusUserPtyPlan().reason);
					break;
				}
				row.terminal.show();
				this.postSnapshot();
				break;
			}
			case "persist_pane_draft": {
				const leaf = visibleLeaves(this.#layout).find(item => item.viewId === message.viewId);
				if (!leaf) break;
				const key = paneDraftKey(leaf);
				this.#state = { ...this.#state, drafts: { ...this.#state.drafts, [key]: message.draft } };
				if (leaf.viewId === this.#layout.activeViewId) {
					this.#state = reduceTaskState(this.#state, { type: "draft", draft: message.draft });
					this.captureActivePaneDraft();
				}
				try {
					await this.#context.globalState.update("cedia.drafts", this.#state.drafts);
					this.#draftPersistOk = true;
				} catch {
					this.#draftPersistOk = false;
					this.postSnapshot();
				}
				break;
			}
			case "set_layout_ratio": {
				this.#layout = setSplitRatio(this.#layout, message.firstViewId, message.ratio);
				this.persistLayout();
				this.postSnapshot();
				break;
			}
			case "pop_to_ide": {
				const tab = message.tab ?? this.#state.workPanel.activeTab;
				if (tab === "browser") {
					await vscode.window.showInformationMessage("Browser is unsupported until the OMP browser bridge advertises a live handle. Opening IDE without a page.");
				}
				await this.setWorkbenchMode("ide");
				const landing = ideLandingForWorkTab(tab, this.#review);
				if (landing.message) await vscode.window.showInformationMessage(landing.message);
				if (landing.view === "file") await this.openWorkspaceFile(landing.path);
				else if (landing.view === "explorer" || tab === "files") await vscode.commands.executeCommand("workbench.view.explorer");
				else if (tab === "terminal") {
					const row = this.#userPtys.find(item => !item.preview.ended) ?? this.#userPtys[0];
					if (row) row.terminal.show();
					else await this.nativeAction("terminal");
				}
				break;
			}
		}
	}

	private async selectDestination(id: string): Promise<void> {
		if (id === "ws-worktree") {
			await this.createWorktreeOnCurrentProject();
			return;
		}
		if (id === "run-cloud") {
			await vscode.window.showInformationMessage(CLOUD_DESTINATION_REASON);
			return;
		}
		if (id === "via-relay") {
			await vscode.window.showInformationMessage(RELAY_UNKNOWN_REASON);
			return;
		}
		await vscode.window.showInformationMessage("This task already uses that destination.");
	}

	/** Append one citation block to the composer draft and, when asked, bring the
	 * composer forward. The editor-selection, file, and terminal citation paths
	 * all end here so the draft merge, persistence, and status message cannot
	 * drift apart between surfaces. */
	ideAppendContext: ((text: string) => Promise<void>) | undefined;
	private async appendContextBlock(block: string, citation: string, focus: boolean): Promise<boolean> {
		if (this.ideAppendContext && !this.inAgentsWindow()) {
			await this.ideAppendContext(block);
			void vscode.window.setStatusBarMessage(`Cedia: added ${citation}`, 3000);
			return true;
		}
		const existing = this.#state.draft;
		const nextDraft = existing.trim().length === 0 ? `${block}\n` : `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
		this.#draftRevision += 1;
		this.#draftPersistOk = false;
		this.#state = reduceTaskState(this.#state, { type: "draft", draft: nextDraft });
		this.captureActivePaneDraft();
		this.postSnapshot();
		try {
			await this.#context.globalState.update("cedia.drafts", this.#state.drafts);
			this.#draftPersistOk = true;
		} catch { /* The snapshot already carries the draft; persistence is best-effort here. */ }
		if (focus) {
			// Force-set the composer value even when it already holds focus.
			this.post({ type: "prefill", text: nextDraft });
			await this.focusDock();
		}
		void vscode.window.setStatusBarMessage(`Cedia: added ${citation}`, 3000);
		return true;
	}

	/** Insert the real active-editor selection (or whole file) into the task
	 * draft as a cited context block. This is the ide-native entry point: it
	 * appends to the existing draft, persists it, and never switches the
	 * workbench mode or restarts the OMP owner. */
	private async appendActiveEditorContext(opts: {
		readonly requireSelection: boolean;
		readonly focus: boolean;
		/** Explicit target, used by the Explorer context menu. Defaults to the active editor. */
		readonly uri?: vscode.Uri;
	}): Promise<boolean> {
		const active = vscode.window.activeTextEditor;
		const targetUri = opts.uri ?? active?.document.uri;
		// A selection citation must quote the editor's range. This used to key
		// off `opts.uri`, so the two selection call sites (the editor context
		// menu and the composer's selection mention) passed no uri and silently
		// quoted the whole file instead of the highlighted lines. `requireSelection`
		// is exactly the selection/file distinction the call sites already make.
		const editor = opts.requireSelection && active && !active.selection.isEmpty && active.document.uri.toString() === targetUri?.toString()
			? active
			: undefined;
		if (!targetUri || targetUri.scheme !== "file") {
			await vscode.window.showInformationMessage(
				opts.requireSelection
					? "Open a workspace file and select text first. Cedia adds a real editor selection, not a placeholder."
					: "Open a workspace file first. Cedia cites the real file path.",
			);
			return false;
		}
		if (opts.requireSelection && (!active || active.selection.isEmpty || active.document.uri.toString() !== targetUri.toString())) {
			await vscode.window.showInformationMessage("Select text in the editor first. Cedia did not invent a selection.");
			return false;
		}
		let document: vscode.TextDocument;
		try {
			document = await vscode.workspace.openTextDocument(targetUri);
		} catch (error) {
			await vscode.window.showInformationMessage(`Cedia could not read that file: ${errorMessage(error)}`);
			return false;
		}
		const buffer = document.getText();
		const range = editor
			? editor.selection
			: new vscode.Range(document.positionAt(0), document.positionAt(buffer.length));
		const relative = vscode.workspace.asRelativePath(targetUri, false);
		const startLine = range.start.line + 1;
		const endLine = range.end.line + 1;
		const raw = document.getText(range);
		const truncated = raw.length > MAX_SELECTION_CONTEXT_CHARS;
		const body = truncated ? raw.slice(0, MAX_SELECTION_CONTEXT_CHARS) : raw;
		const citation = startLine === endLine ? `${relative}#L${startLine}` : `${relative}#L${startLine}-L${endLine}`;
		const fence = document.languageId || "";
		const block = [
			citation,
			"```" + fence,
			body,
			"```",
			...(truncated ? [`(truncated at ${MAX_SELECTION_CONTEXT_CHARS} characters of ${raw.length})`] : []),
		].join("\n");
		return this.appendContextBlock(block, citation, opts.focus);
	}

	/** Editor context-menu command: cite the current selection. */
	async addSelectionToTask(): Promise<void> {
		await this.appendActiveEditorContext({ requireSelection: true, focus: true });
	}

	/** Terminal context-menu command: cite the selection from the active
	 * terminal. Code-OSS exposes the real selection on the terminal object, so
	 * this quotes what the user highlighted and nothing they did not. */
	async addTerminalSelectionToTask(): Promise<void> {
		const terminal = vscode.window.activeTerminal;
		if (!terminal) {
			await vscode.window.showInformationMessage(TERMINAL_NOT_FOCUSED_REASON);
			return;
		}
		const citation = terminalCitation({
			name: terminal.name,
			selection: terminalSelectionOf(terminal),
			maxChars: MAX_TERMINAL_CITATION_CHARS,
		});
		if (!citation.ok) {
			await vscode.window.showInformationMessage(citation.reason);
			return;
		}
		await this.appendContextBlock(citation.block, citation.citation, true);
	}

	/** Native lightbulb / Quick Fix actions for the file under the cursor.
	 * Returns actions only when they can actually run, so the lightbulb never
	 * offers a command that would fail on invoke. */
	codeActionsFor(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
		if (document.uri.scheme !== "file") return [];
		const specs = cediaCodeActions({
			taskAvailable: this.hasTaskSurface(),
			hasSelection: !range.isEmpty,
		});
		return specs.map(spec => {
			const action = new vscode.CodeAction(spec.title, vscode.CodeActionKind.QuickFix);
			action.command = { command: spec.command, title: spec.title };
			return action;
		});
	}

	/** One-shot Cursor-class actions on the selection (Explain, Fix). The
	 * selection is cited with its real path and line range and the action goes
	 * out as one task turn through the guarded send path, so OMP stays the only
	 * execution owner and nothing is edited on the user's behalf. */
	async runSelectionAction(id: SelectionActionId): Promise<void> {
		const spec = selectionAction(id);
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.scheme !== "file") {
			await vscode.window.showInformationMessage("Open a workspace file before using Cedia on a selection.");
			return;
		}
		if (editor.selection.isEmpty) {
			await vscode.window.showInformationMessage(`Select the code first, then run ${spec.title}.`);
			return;
		}
		const relative = vscode.workspace.asRelativePath(editor.document.uri, false);
		const startLine = editor.selection.start.line + 1;
		const endLine = editor.selection.end.line + 1;
		const citation = startLine === endLine ? `${relative}#L${startLine}` : `${relative}#L${startLine}-L${endLine}`;
		const raw = editor.document.getText(editor.selection);
		const truncated = raw.length > MAX_SELECTION_CONTEXT_CHARS;
		const prompt = selectionPrompt({
			instruction: spec.instruction,
			citation,
			languageId: editor.document.languageId || "",
			body: truncated ? raw.slice(0, MAX_SELECTION_CONTEXT_CHARS) : raw,
			...(truncated ? { truncated: { limit: MAX_SELECTION_CONTEXT_CHARS, original: raw.length } } : {}),
		});
		// Same staging rule as inline edit: a refused send leaves the
		// instruction in the composer instead of dropping it, and an unsent
		// draft is merged rather than overwritten.
		const existingDraft = this.#state.draft.trim();
		const outgoing = existingDraft ? `${existingDraft}\n\n${prompt}` : prompt;
		this.#draftRevision += 1;
		this.#state = reduceTaskState(this.#state, { type: "draft", draft: outgoing });
		this.captureActivePaneDraft();
		this.postSnapshot();
		await this.focusDock();
		await this.sendCommand("prompt", { message: outgoing });
		void this.#context.globalState.update("cedia.drafts", this.#state.drafts);
	}

	/** Mark the regions an applied edit produced, and remember the text to
	 * restore if the user takes it back. The document already holds the edit,
	 * so this is presentation plus one decision - it never re-applies an edit. */
	/** Editor-bridge callback: an edit that OMP applied through the guarded
	 * bridge now sits in this buffer. Public because the bridge hands it in. */
	recordAgentEdit(summary: EditorAppliedSummary): void {
		if (this.#disposed) return;
		// The mark is the lines the apply actually changed, not the edit's own
		// reported span: OMP's guarded native apply reports one whole-file edit
		// even for a two-character change, which would mark the entire file.
		const ranges = markRangesFor(summary.textBefore, summary.edits);
		if (ranges.length === 0) return;
		const pending: PendingAgentEdit = {
			path: vscode.workspace.asRelativePath(vscode.Uri.parse(summary.uri), false),
			ranges,
			version: summary.version,
			textBefore: summary.textBefore,
		};
		this.#agentEdits.set(summary.uri, pending);
		this.refreshAgentEditMarks();
		void vscode.window.setStatusBarMessage(`Cedia: ${agentEditLabel(pending.path, ranges)}`, 5000);
	}

	private agentEditDecorationType(): vscode.TextEditorDecorationType {
		return this.#agentEditDecoration ??= vscode.window.createTextEditorDecorationType({
			borderColor: new vscode.ThemeColor("editorInfo.foreground"),
			borderStyle: "solid",
			borderWidth: "0 0 0 3px",
			backgroundColor: new vscode.ThemeColor("editor.wordHighlightStrongBackground"),
		});
	}

	/** Paint the marks on every visible editor, clear the ones with nothing
	 * pending, and tell the menus whether any edit is waiting. */
	private refreshAgentEditMarks(): void {
		const type = this.agentEditDecorationType();
		for (const editor of vscode.window.visibleTextEditors) {
			const pending = this.#agentEdits.get(editor.document.uri.toString());
			if (!pending) { editor.setDecorations(type, []); continue; }
			editor.setDecorations(type, pending.ranges.map(range => this.agentEditDecoration(editor.document, range, pending)));
		}
		void vscode.commands.executeCommand("setContext", "cedia.agentEditPending", this.#agentEdits.size > 0);
		// The lens list depends on this state, not on the document text, so the
		// engine's cached CodeLens result has to be invalidated explicitly.
		this.#agentEditLensesChanged.fire();
	}

	private agentEditDecoration(document: vscode.TextDocument, range: MarkRange, pending: PendingAgentEdit): vscode.DecorationOptions {
		const mark = decorationRange(document, range);
		return {
			range: new vscode.Range(
				new vscode.Position(mark.start.line, mark.start.character),
				new vscode.Position(mark.end.line, mark.end.character),
			),
			hoverMessage: decorationHover(pending.path),
		};
	}

	/** Keep the agent's edit. For an unsaved buffer "kept" means saved, so this
	 * saves the document and drops the mark. */
	async keepAgentEdit(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const pending = editor ? this.#agentEdits.get(editor.document.uri.toString()) : undefined;
		if (!editor || !pending) {
			await vscode.window.showInformationMessage("This file has no Cedia edit waiting. Cedia only marks edits it applied through the editor bridge.");
			return;
		}
		if (editor.document.isDirty && !await editor.document.save()) {
			await vscode.window.showInformationMessage("Cedia could not save the file, so the edit is still unsaved.");
			return;
		}
		this.forgetAgentEdit(editor.document.uri.toString(), `Cedia: kept the edit to ${pending.path}`);
	}

	/** Take the agent's edit back by restoring the exact pre-edit text, and only
	 * while the buffer still holds the version Cedia produced. */
	async revertAgentEdit(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const pending = editor ? this.#agentEdits.get(editor.document.uri.toString()) : undefined;
		if (!editor || !pending) {
			await vscode.window.showInformationMessage("This file has no Cedia edit waiting. Cedia only marks edits it applied through the editor bridge.");
			return;
		}
		const decision = revertDecision(pending, editor.document.version);
		if (!decision.ok) {
			await vscode.window.showInformationMessage(decision.reason);
			return;
		}
		const document = editor.document;
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length)), decision.text);
		if (!await vscode.workspace.applyEdit(edit)) {
			await vscode.window.showInformationMessage("VS Code did not take the Cedia edit back; the buffer is unchanged.");
			return;
		}
		this.forgetAgentEdit(document.uri.toString(), `Cedia: took back the edit to ${pending.path}`);
	}

	/** Review exactly what Cedia changed: a native Code-OSS diff between the
	 * recorded pre-edit text and the current buffer. This is the Cursor-class
	 * review loop on top of the mark whose two decisions are Keep and Take
	 * Back. The pre-edit side is virtual and read-only; nothing is written. */
	async reviewAgentEdit(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const pending = editor ? this.#agentEdits.get(editor.document.uri.toString()) : undefined;
		if (!editor || !pending) {
			await vscode.window.showInformationMessage("This file has no Cedia edit waiting. Cedia only reviews edits it applied through the editor bridge.");
			return;
		}
		const decision = agentEditReviewDecision(pending, editor.document.version);
		if (!decision.ok) {
			await vscode.window.showInformationMessage(decision.reason);
			return;
		}
		const before = vscode.Uri.parse(encodeAgentEditDocId(editor.document.uri.toString()));
		await vscode.commands.executeCommand("vscode.diff", before, editor.document.uri, agentEditDiffTitle(pending.path));
	}

	/** In-editor decisions on a Cedia edit. The same Keep / Take Back the title
	 * actions and the context menu offer, attached to the first region Cedia
	 * changed so the choice sits where the change is. Empty for every document
	 * without a pending edit, so no lens is advertised that would fail. */
	agentEditLensesFor(document: vscode.TextDocument): vscode.CodeLens[] {
		const pending = this.#agentEdits.get(document.uri.toString());
		if (!pending) return [];
		const specs = agentEditLenses(pending);
		// The provider is called on every render, so only the first offer per file
		// is logged; it is the real-app proof that the engine asked for the lenses.
		const key = document.uri.toString();
		if (!this.#agentEditLensLogged.has(key)) {
			this.#agentEditLensLogged.add(key);
			this.#log.info(`agent edit lenses offered path=${pending.path} decisions=${specs.length} line=${specs[0]?.line ?? 0}`);
		}
		return specs.map(spec => new vscode.CodeLens(
			new vscode.Range(new vscode.Position(spec.line, 0), new vscode.Position(spec.line, 0)),
			{ command: spec.command, title: spec.title },
		));
	}

	/** The engine needs both halves: the query and the invalidation signal. */
	agentEditLensesProvider(): vscode.CodeLensProvider {
		return {
			provideCodeLenses: (document: vscode.TextDocument) => this.agentEditLensesFor(document),
			onDidChangeCodeLenses: this.#agentEditLensesChanged.event,
		};
	}

	/** Drop one pending edit and repaint. */
	private forgetAgentEdit(uri: string, message: string): void {
		this.#agentEdits.delete(uri);
		this.#agentEditLensLogged.delete(uri);
		this.refreshAgentEditMarks();
		void vscode.window.setStatusBarMessage(message, 4000);
	}

	/** Inline edit (Cmd+K): describe a change for the current selection and send
	 * it as one task turn. The selection is cited with its real path and line
	 * range; OMP stays the single execution owner and applies any resulting edit
	 * through the guarded editor bridge. The transient selection highlight is
	 * cleared when the turn is dispatched so a stale overlay never lingers. */
	async inlineEdit(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.scheme !== "file") {
			await vscode.window.showInformationMessage("Open a workspace file before using Cedia inline edit.");
			return;
		}
		if (editor.selection.isEmpty) {
			await vscode.window.showInformationMessage("Select the code you want to change, then run Cedia inline edit.");
			return;
		}
		const relative = vscode.workspace.asRelativePath(editor.document.uri, false);
		const startLine = editor.selection.start.line + 1;
		const endLine = editor.selection.end.line + 1;
		const citation = startLine === endLine ? `${relative}#L${startLine}` : `${relative}#L${startLine}-L${endLine}`;
		const instruction = await vscode.window.showInputBox({
			title: `Cedia: edit ${citation}`,
			prompt: "Describe the change to make to the selected code.",
			placeHolder: "e.g. add retry with backoff and a test",
			ignoreFocusOut: true,
		});
		if (instruction === undefined) return;
		const trimmed = instruction.trim();
		if (!trimmed) {
			await vscode.window.showInformationMessage("Cedia inline edit needs an instruction. Nothing was sent.");
			return;
		}
		const raw = editor.document.getText(editor.selection);
		const truncated = raw.length > MAX_SELECTION_CONTEXT_CHARS;
		const body = truncated ? raw.slice(0, MAX_SELECTION_CONTEXT_CHARS) : raw;
		const fence = editor.document.languageId || "";
		const prompt = [
			`Edit ${citation}: ${trimmed}`,
			"",
			"```" + fence,
			body,
			"```",
			...(truncated ? [`(truncated at ${MAX_SELECTION_CONTEXT_CHARS} characters of ${raw.length})`] : []),
		].join("\n");
		// Show the run where the user can watch it, then dispatch through the
		// normal guarded send path so the dispatch guard, model check, and
		// command journal all apply.
		// Stage the outgoing text in the draft first: if the send is refused (no
		// model chosen, host offline, duplicate click) the user's instruction is
		// still in the composer instead of being dropped. An unsent draft is
		// merged rather than overwritten so nothing the user already typed is
		// lost, and a successful dispatch clears the draft through the normal
		// send path.
		const existingDraft = this.#state.draft.trim();
		const outgoing = existingDraft ? `${existingDraft}\n\n${prompt}` : prompt;
		this.#draftRevision += 1;
		this.#state = reduceTaskState(this.#state, { type: "draft", draft: outgoing });
		this.captureActivePaneDraft();
		this.postSnapshot();
		await this.focusDock();
		await this.sendCommand("prompt", { message: outgoing });
		void this.#context.globalState.update("cedia.drafts", this.#state.drafts);
	}

	/** Editor title and Explorer context command: cite a whole file. The
	 * Explorer supplies the clicked resource; the editor title uses the active
	 * document. */
	async addFileToTask(resource?: vscode.Uri): Promise<void> {
		const resolved = commandResourceUri(resource);
		const uri = resolved && resolved.scheme === "file" ? resolved : undefined;
		await this.appendActiveEditorContext({ requireSelection: false, focus: true, ...(uri ? { uri } : {}) });
	}

	/** Reveal the docked agent view without changing workbench mode. */
	async focusDock(): Promise<void> {
		this.#pendingComposerFocus.request();
		// Code-OSS registers a focus command per *view* as `<viewId>.focus`, and
		// opens a view's container as part of focusing it. `cediaDock` is the
		// container id, so the earlier `cediaDock.focus` was never a real command:
		// it rejected into a silent catch and the composer was never brought
		// forward after "add selection" or "inline edit". The dock is the only
		// Cedia view now, so there is one command to try and no fallback chain.
		let focused = false;
		try {
			await vscode.commands.executeCommand("cediaComposerDock.focus");
			focused = true;
		} catch { /* The dock is not registered in this window (restricted mode, or no provider). */ }
		if (!focused) this.#log.debug("no Cedia view could be focused; the draft still updated");
		if (this.#views.size > 0 && this.#pendingComposerFocus.claim()) this.post({ type: "focus_composer" });
	}

	/** Serve the "before" side of a task review diff to the native diff editor.
	 * The body is read from Git for one workspace-relative path; nothing is
	 * executed and no file on disk is modified. */
	diffContentProvider(): vscode.TextDocumentContentProvider {
		return {
			provideTextDocumentContent: async (uri: vscode.Uri): Promise<string> => {
				const id = decodeReviewDocId(uri.toString());
				if (!id) return "";
				const cwd = this.reviewCwd();
				if (!cwd) return "";
				const resolved = safeWorkspaceFile(cwd, id.path);
				if (!resolved) return "";
				return this.gitOriginalText(cwd, id.ref, id.path);
			},
		};
	}

	private reviewCwd(): string | undefined {
		return this.#state.session?.cwd ?? this.#state.project?.path ?? workspacePath();
	}

	/** Original side of the "review the Cedia edit" diff: the exact text the
	 * buffer held immediately before Cedia applied the edit that is still
	 * pending. Returns empty once the record is gone, so a tab left open cannot
	 * keep showing a diff Cedia no longer stands behind. */
	agentEditBeforeProvider(): vscode.TextDocumentContentProvider {
		return {
			provideTextDocumentContent: (uri: vscode.Uri): string => {
				const documentUri = decodeAgentEditDocId(uri.toString());
				if (!documentUri) return "";
				return this.#agentEdits.get(documentUri)?.textBefore ?? "";
			},
		};
	}

	/** Working-tree-relative original text for a ref. A missing path (new or
	 * untracked file) yields an empty original so the diff reads as all-added
	 * instead of Cedia inventing content. */
	private async gitOriginalText(cwd: string, ref: string, path: string): Promise<string> {
		const [subcommand, target] = reviewOriginalArgs(ref, path);
		try {
			const { stdout } = await execFileAsync("git", ["-C", cwd, subcommand!, target!], {
				timeout: 8_000,
				maxBuffer: 8 * 1024 * 1024,
				encoding: "buffer",
			} as never);
			const buffer = stdout as unknown as Buffer;
			const text = buffer.toString("utf8");
			return looksBinary(text) ? "" : text;
		} catch {
			// No version of this path in the ref, or the ref is unavailable.
			return "";
		}
	}

	/** Ask Git whether one path is binary, so the honest "text diffs only" guard
	 * holds on every entry point. It used to read the extension hint off the
	 * review snapshot, which the direct command path never populated, so a
	 * binary file could open a text diff of its bytes. */
	private async gitPathIsBinary(cwd: string, path: string): Promise<boolean> {
		try {
			const { stdout } = await execFileAsync("git", ["-C", cwd, "diff", "HEAD", "--numstat", "--no-color", "--", path], { timeout: 8_000 });
			const line = String(stdout).split("\n").find(value => value.trim().length > 0);
			if (!line) return false;
			const [added, deleted] = line.split("\t");
			return added === "-" && deleted === "-";
		} catch {
			return false;
		}
	}

	/** Open one task change in the real Code-OSS diff editor. */
	async openNativeDiff(path: string): Promise<void> {
		const cwd = this.reviewCwd();
		if (!cwd) {
			await vscode.window.showInformationMessage("Open a project before reviewing a file.");
			return;
		}
		const resolved = safeWorkspaceFile(cwd, path);
		if (!resolved) {
			await vscode.window.showWarningMessage("Cedia ignored a path outside this task workspace.");
			return;
		}
		const file = this.#review.files.find(item => item.path === path);
		const plan = nativeDiffPlan({
			path,
			// Git's own answer beats the snapshot's extension hint: the command
			// palette and keybinding paths never populate that snapshot.
			binary: file?.binaryHint === true || await this.gitPathIsBinary(cwd, path),
			missingOriginal: file ? !file.tracked || file.status === "untracked" || file.status === "added" : false,
		});
		if (!plan.open) {
			await vscode.window.showInformationMessage(plan.reason);
			return;
		}
		const original = vscode.Uri.parse(encodeReviewDocId({ ref: "HEAD", path }));
		const modified = vscode.Uri.file(resolved);
		// Reveal the native diff without stealing focus from the agent when the
		// user is already typing; the diff is a review surface, not a mode.
		await vscode.commands.executeCommand("vscode.diff", original, modified, plan.title, { preserveFocus: false });
	}

	/** Command-palette, keybinding, and Explorer entry: review a file against
	 * HEAD in the native diff editor. The Explorer supplies the resource. */
	async reviewActiveFileInDiff(resource?: vscode.Uri): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const cwd = this.reviewCwd();
		const resolved = commandResourceUri(resource);
		const uri = resolved && resolved.scheme === "file" ? resolved : editor?.document.uri;
		const decision = resolveReviewTarget({
			relativePath: uri ? vscode.workspace.asRelativePath(uri, false) : undefined,
			cwd,
		});
		if (!decision.open) {
			await vscode.window.showInformationMessage(decision.reason);
			return;
		}
		await this.reviewFile(decision.path);
		await this.openNativeDiff(decision.path);
	}

	/** Native status bar entry: the real connection/run/approval state, not a
	 * static label. Clicking it opens the task surface. */
	private renderAgentsStatus(): void {
		const item = this.#agentsStatus;
		if (!item) return;
		const approvals = this.#state.uiRequests.length;
		const connection = this.#state.connection;
		const running = this.#state.session?.status === "running";
		const syncing = this.#state.pendingCommands && Object.values(this.#state.pendingCommands).some((command) => command && command.status === "sent");
		let text: string;
		let tooltip: string;
		if (approvals > 0) {
			text = `$(bell) Cedia ${approvals} approval${approvals === 1 ? "" : "s"}`;
			tooltip = `${approvals} request${approvals === 1 ? "" : "s"} waiting for your answer. Click to open the task.`;
		} else if (running) {
			text = "$(sync~spin) Cedia running";
			tooltip = "A Cedia task is running. Click to open the task.";
		} else if (syncing) {
			text = "$(arrow-sync) Cedia sending";
			tooltip = "A command was sent and is waiting for the host to confirm it.";
		} else if (connection === "connected") {
			text = "$(comment-discussion) Cedia ready";
			tooltip = "Cedia is connected to the Mac host. Click to open the task.";
		} else if (connection === "offline") {
			text = "$(debug-disconnect) Cedia offline";
			tooltip = "The Cedia host is not reachable. Drafts are kept on this device.";
		} else {
			text = "$(comment-discussion) Cedia";
			tooltip = "Click to open the Cedia task.";
		}
		item.text = text;
		item.tooltip = tooltip;
		// Hidden by workbench.statusBar.visible in the full Agents window; the
		// item simply does not render there.
		item.show();
	}

	/** A real task surface exists: an open project, a connected client, or a
	 * session. One rule shared by the context key and the Code Action provider
	 * so the menu and the lightbulb cannot disagree. */
	private hasTaskSurface(): boolean {
		return Boolean(this.#state.project || this.#client || this.#state.session);
	}

	/** Gate editor context-menu entries on a real task surface being present. */
	private syncCediaContext(): void {
		void vscode.commands.executeCommand("setContext", "cedia.taskAvailable", this.hasTaskSurface());
	}

	private async pickMention(kind: "file" | "folder" | "selection" | "logs" | "artifacts" | "session", _id: string): Promise<void> {
		if (kind === "logs") this.setState({ type: "work_panel", action: { type: "open_tab", tab: "terminal" } });
		else if (kind === "selection") await this.appendActiveEditorContext({ requireSelection: true, focus: false });
	}

	private async downloadArtifactCopy(sha256: string): Promise<void> {
		const receipt = this.#artifacts.find(item => item.sha256 === sha256);
		if (!this.#client || !this.#state.session || !receipt) {
			await vscode.window.showInformationMessage("No artifact receipt to download.");
			return;
		}
		const bytes = await downloadArtifact(this.#client, this.#state.session.id, receipt);
		const target = await vscode.window.showSaveDialog({
			saveLabel: "Save artifact copy",
			defaultUri: vscode.Uri.file(receipt.name),
		});
		if (!target) return;
		await vscode.workspace.fs.writeFile(target, bytes);
	}

	private async exportDiagnostics(): Promise<void> {
		const target = await vscode.window.showSaveDialog({
			saveLabel: "Export redacted diagnostics",
			defaultUri: vscode.Uri.file("cedia-diagnostics.txt"),
		});
		if (!target) return;
		const body = redactedDiagnostics({
			connection: this.#state.connection,
			sessionId: this.#state.session?.id,
			projectId: this.#state.project?.id,
			pending: Object.keys(this.#state.pendingCommands).length,
			approvals: this.#state.uiRequests.length,
			lastHostSyncAt: this.#lastHostSyncAt,
			relayStatus: "unknown",
		});
		await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(body + "\n"));
		void vscode.window.showInformationMessage("Saved a redacted diagnostics file. Provider tokens were not included.");
	}

	dispose(): void {
		this.#disposed = true;
		this.#agentEditDecoration?.dispose();
		this.#agentEditLensesChanged.dispose();
		this.#agentEdits.clear();
		this.#editor.dispose();
		this.#terminals.dispose();
		if (this.#pollTimer) clearInterval(this.#pollTimer);
		this.#pollTimer = undefined;
		this.#client = undefined;
	}
}

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

/** The settings that decide which theme the Agents window paints. */
const AGENTS_WINDOW_THEME_SETTING_KEYS = [
	"workbench.colorTheme",
	"workbench.preferredDarkColorTheme",
	"workbench.preferredLightColorTheme",
	"window.autoDetectColorScheme",
] as const;

/**
 * Keep the Agents window's own profile in step with the theme chosen in this window.
 *
 * The Agents window is a separate workbench on upstream's internal `agents` profile, and that
 * profile starts with no settings file at all, so the theme the user picked here would not reach
 * it. Carrying the keys is only half of it: the window also disables every extension that ships
 * code (`canExecuteOnSessionsWindow`), which is every theme with a settings section of its own
 * (Catppuccin contributes `configuration` next to `themes`). Its declarative theme is then never
 * registered and `workbench.colorTheme` quietly resolves to the stock theme — the two windows
 * disagreeing on colour is exactly this, not a missing extension.
 *
 * `extensions.supportAgentsWindow` is upstream's override for that gate, and it is
 * `ConfigurationScope.APPLICATION`, so it has to be written at user scope. This profile's settings
 * file is the only user scope the window has, and it carries the theme keys too so both halves of
 * "the Agents window follows the theme I chose" land in one place.
 */
async function syncAgentsWindowTheme(globalStorage: vscode.Uri, stateDir?: string): Promise<void> {
	const workbench = vscode.workspace.getConfiguration("workbench");
	const colorTheme = workbench.get<string>("colorTheme");
	const preferredDark = workbench.get<string>("preferredDarkColorTheme");
	const preferredLight = workbench.get<string>("preferredLightColorTheme");
	const autoDetect = vscode.workspace.getConfiguration("window").get<boolean>("autoDetectColorScheme");
	const themeKind = Number(vscode.window.activeColorTheme?.kind);
	const mode = themeKind === 1 || themeKind === 4 ? "light" : "dark";
	// The snapshot file is shared by every window, so every window publishes what it shows:
	// otherwise the file freezes at whatever the IDE last wrote and the agent keeps wearing
	// that theme after the user re-themed elsewhere. With autoDetect the stored colorTheme
	// is not what the window shows, so the resolved preferred theme is handed over instead.
	const themeName = resolveSnapshotThemeName({
		colorTheme,
		preferredDarkColorTheme: preferredDark,
		preferredLightColorTheme: preferredLight,
		autoDetectColorScheme: autoDetect,
		mode,
	});
	// The standalone renderer cannot ask the extension host for
	// `activeColorTheme`. Persist the name/kind immediately; the embedded Agent
	// view later replaces this fallback with the effective --vscode-* palette.
	try {
		await writeAgentThemeSnapshot(stateDir, {
			mode,
			...(themeName ? { themeName } : {}),
		});
	} catch (error) {
		// Theme handoff is cosmetic. A locked or read-only state directory should
		// never prevent the extension from activating or syncing the workspace file.
		console.debug("Cedia Agent theme snapshot unavailable", error);
	}
	// A window that is already the Agents window has nothing to hand over for the second
	// half: its globalStorage is the profile's own, so the workspace path below would
	// resolve inside it instead of to the shared workspace file.
	if (isAgentsWindow(vscode.workspace.workspaceFile)) return;
	const settings: Record<string, unknown> = {
		"workbench.colorTheme": colorTheme,
		"workbench.preferredDarkColorTheme": preferredDark,
		"workbench.preferredLightColorTheme": preferredLight,
		"window.autoDetectColorScheme": autoDetect,
		// The reference's sidebar groups sessions by project and has no empty "Chats" group,
		// so this window does not draw one (plan chrome decision). It is a settings-only
		// change: the group's rows have nothing to show in a window whose chats all belong
		// to a project.
		"sessions.list.showEmptyDefaultGroups": false,
	};
	const support: Record<string, boolean> = {
		...(vscode.workspace.getConfiguration("extensions").get<Record<string, boolean>>("supportAgentsWindow") ?? {}),
	};
	// The Agents window has its own extension host. Register every installed
	// theme provider there so the theme picker exposes the same catalogue as the
	// IDE, while the selected theme keys above still determine the active theme.
	for (const id of allThemeProvidingExtensionIds(vscode.extensions.all)) support[id] = true;
	if (Object.keys(support).length === 0) return;
	const file = vscode.Uri.file(resolve(globalStorage.fsPath, "..", "..", AGENTS_WINDOW_WORKSPACE));
	let existing: string | undefined;
	try {
		existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
	} catch {
		existing = undefined;
	}
	await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(mergeAgentsWindowWorkspaceSettings(existing, settings, support)));
}

export function activate(context: vscode.ExtensionContext): void {
	if (!vscode.workspace.isTrusted) {
		activateRestrictedWorkspace(vscode, context, () => activate(context));
		return;
	}
	// The Agents window is a second workbench on its own profile, so nothing here reaches it by
	// itself: not the theme, and not the permission the theme's own extension needs (see
	// syncAgentsWindowTheme). Doing it at activation - and again whenever the choice changes -
	// means the window is right whichever route opened it.
	const stateDir = descriptorStateDir(context);
	void syncAgentsWindowTheme(context.globalStorageUri, stateDir);
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (AGENTS_WINDOW_THEME_SETTING_KEYS.some(key => event.affectsConfiguration(key))) void syncAgentsWindowTheme(context.globalStorageUri, stateDir);
	}));
	const provider = new CediaTaskViewProvider(context);
	const ideAgent = new CediaIdeAgentProvider(context, descriptorStateDir(context), () => provider.ensureClient(), id => provider.syncIdeSession(id));
	provider.ideAppendContext = text => ideAgent.appendContext(text);
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
		vscode.commands.registerCommand("cedia.openComposer", (query?: unknown) => {
			if (typeof query === "string" && query.trim()) return ideAgent.appendContext(query);
			return ideAgent.focus();
		}),
		// One command opens the Agents window. This used to be two
		// (`cedia.openTask` and `cedia.showAgents`) with the same handler and
		// different titles, so the palette offered the same destination twice.
		vscode.commands.registerCommand("cedia.showAgents", () => ideAgent.openAgents()),
		vscode.commands.registerCommand("cedia.showIde", () => provider.showIde()),
		vscode.commands.registerCommand("cedia.newTask", () => ideAgent.focus("newTask")),
		vscode.commands.registerCommand("cedia.openFolder", () => provider.openFolderFlow()),
		// Which OMP model does which job: a host concern, so it is a command rather
		// than a composer chip (the Agents window composer renders only the model picker).
		vscode.commands.registerCommand("cedia.models.configureRoles", () => provider.configureModelRoles()),
		// The sidebar's project rows call these with the folder they were right-clicked on:
		// the row is a workspace folder, the operations are the host's project record.
		vscode.commands.registerCommand("cedia.project.setPinned", (folderPath?: string) => provider.setProjectPinned(folderPath)),
		vscode.commands.registerCommand("cedia.project.rename", (folderPath?: string) => provider.renameProject(folderPath)),
		vscode.commands.registerCommand("cedia.project.archiveChats", (folderPath?: string) => provider.archiveProjectChats(folderPath)),
		vscode.commands.registerCommand("cedia.project.remove", (folderPath?: string) => provider.removeProject(folderPath)),
		// The Agents window's session rows call this with the chat session resources
		// the list's own `Delete...` item confirmed.
		vscode.commands.registerCommand("cedia.session.delete", (hint?: unknown) => provider.deleteChatSessions(hint)),
		vscode.commands.registerCommand("cedia.project.createWorktree", (folderPath?: string) => provider.createWorktreeForProject(folderPath)),
		vscode.commands.registerCommand("cedia.project.reveal", (hint?: string) => provider.revealProject(hint)),
		// The Agents sidebar's "New Project": registers the folder and gives it a task
		// in this window, instead of opening the folder somewhere else.
		vscode.commands.registerCommand("cedia.project.add", () => provider.addProjectFlow()),
		// Internal: the Apps panel's address bar asks for the engine's suggestions, which
		// it cannot fetch itself (CORS). Not declared in the manifest - it has no
		// standalone meaning in the command palette.
		vscode.commands.registerCommand("cedia.browser.suggest", (term?: string) => provider.suggestSearchTerms(term)),
		vscode.commands.registerCommand("cedia.refresh", () => provider.refreshNow()),
		vscode.commands.registerCommand("cedia.openFiles", () => provider.nativeAction("files")),
		vscode.commands.registerCommand("cedia.showDiff", () => provider.nativeAction("diff")),
		vscode.commands.registerCommand("cedia.openTerminal", () => provider.nativeAction("terminal")),
		vscode.commands.registerCommand("cedia.openSettings", () => provider.openCediaSettings()),
		vscode.commands.registerCommand("cedia.ompSignIn", () => provider.ompSignIn()),		vscode.commands.registerCommand("cedia.searchTasks", () => provider.focusSearch()),
		vscode.commands.registerCommand("cedia.skipToTask", () => provider.skipToTask()),
		vscode.commands.registerCommand("cedia.pairDevice", () => provider.pairDevice()),
		vscode.commands.registerCommand("cedia.connectIPhone", () => provider.pairDevice()),
		vscode.commands.registerCommand("cedia.manageDevices", () => provider.manageDevices()),
		vscode.commands.registerCommand("cedia.ompControls", () => provider.ompControls()),
		vscode.commands.registerCommand("cedia.taskActions", () => provider.taskActions()),
		vscode.commands.registerCommand("cedia.reviewInDiff", (resource?: vscode.Uri) => provider.reviewActiveFileInDiff(resource)),
		vscode.commands.registerCommand("cedia.addSelectionToTask", () => provider.addSelectionToTask()),
		vscode.commands.registerCommand("cedia.addTerminalSelectionToTask", () => provider.addTerminalSelectionToTask()),
		vscode.commands.registerCommand("cedia.explainSelection", () => provider.runSelectionAction("explain")),
		vscode.commands.registerCommand("cedia.fixSelection", () => provider.runSelectionAction("fix")),
		vscode.commands.registerCommand("cedia.keepAgentEdit", () => provider.keepAgentEdit()),
		vscode.commands.registerCommand("cedia.revertAgentEdit", () => provider.revertAgentEdit()),
		vscode.commands.registerCommand("cedia.reviewAgentEdit", () => provider.reviewAgentEdit()),
		vscode.commands.registerCommand("cedia.inlineEdit", () => provider.inlineEdit()),
		vscode.commands.registerCommand("cedia.addFileToTask", (resource?: vscode.Uri) => provider.addFileToTask(resource)),
		vscode.commands.registerCommand("cedia.focusDock", () => provider.focusDock()),
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
