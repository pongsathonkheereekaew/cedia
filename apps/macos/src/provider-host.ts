/** Item 66: Host connection, polling, and refresh — slice of CediaTaskViewProvider.
 *
 * Installed on the prototype by provider-registry.ts. Bodies are unchanged apart
 * from `private` removal and `this.#x`→`this.x`; each method's `this` is typed by
 * the API, so a body is checked exactly as it was inside the class. */

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


import type { CediaTaskViewProviderApi } from "./provider-api.ts";
import { errorMessage, asArray, workspacePath, hostSetupMessage, normalizeProject, normalizeSession, EVENT_PAGE_LIMIT, POLL_INTERVAL_MS, requestGit, HostSetupRequiredError } from "./task-runtime.ts";
import { importLegacyExtensionDrafts, legacyDraftMigrationFromExtensionState } from "./agent-ui-state.ts";

async function migrateLegacyDrafts(provider: CediaTaskViewProviderApi, client: CediaHostClient): Promise<void> {
	const marker = provider.context.globalState.get<{ version?: unknown }>("cedia.drafts.migration");
	if (marker?.version === 1) return;
	provider.legacyDraftMigration ??= importLegacyExtensionDrafts(
		(method, path, body) => client.requestApplication(method, path, body),
		legacyDraftMigrationFromExtensionState(provider.context.globalState),
	).catch(error => {
		provider.legacyDraftMigration = undefined;
		throw error;
	});
	await provider.legacyDraftMigration;
}

export const hostConcern: Partial<CediaTaskViewProviderApi> = {
		async ensureClient(this: CediaTaskViewProviderApi): Promise<CediaHostClient> {
				if (this.client) {
					const active = this.client;
					try { await active.health(); } catch { if (this.client === active) this.client = undefined; }
					if (this.client === active) {
						try { await migrateLegacyDrafts(this, active); }
						catch (error) { this.log.warn(`legacy draft migration remains pending: ${errorMessage(error)}`); }
						if (this.state.connection !== "connected" && this.state.connection !== "running") this.setState({ type: "connection", status: "connected" });
						return active;
					}
				}
				this.setState({ type: "connection", status: "connecting" });
				try {
					this.client = await CediaHostClient.fromStateDir(this.stateDir, { timeoutMs: this.hostTimeoutMs, requirePrivateMode: true });
					await this.client.health();
				} catch (firstError) {
					this.client = undefined;
					await this.hostProcess.start();
					const deadline = Date.now() + 7_000;
					let lastError: unknown = firstError;
					while (Date.now() < deadline) {
						try {
							this.client = await CediaHostClient.fromStateDir(this.stateDir, { timeoutMs: this.hostTimeoutMs, requirePrivateMode: true });
							await this.client.health();
							break;
						} catch (error) {
							this.client = undefined;
							lastError = error;
							await new Promise(resolve => setTimeout(resolve, 150));
						}
					}
					if (!this.client) throw new HostSetupRequiredError(`${hostSetupMessage(this.stateDir)} ${errorMessage(lastError)}`);
				}
				if (this.client) {
					try { await migrateLegacyDrafts(this, this.client); }
					catch (error) { this.log.warn(`legacy draft migration remains pending: ${errorMessage(error)}`); }
				}
				this.setState({ type: "connection", status: "connected", error: undefined });
				this.startPolling();
				return this.client;
		},

		async syncIdeSession(this: CediaTaskViewProviderApi, id: string): Promise<void> {
				if (this.state.session?.id === id) return;
				await this.refresh();
				await this.selectSession(id, true);
		},

		startPolling(this: CediaTaskViewProviderApi): void {
				if (this.pollTimer) return;
				this.pollTimer = setInterval(() => { void this.pullEvents(); void this.pollEditor(); }, POLL_INTERVAL_MS);
		},

		async pollEditor(this: CediaTaskViewProviderApi): Promise<void> {
				if (this.editorPolling || !this.client || this.disposed) return;
				this.editorPolling = true;
				const client = this.client;
				try {
					await client.registerEditor(this.editorId, (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
					const requests = await client.editorRequests(this.editorId);
					for (const request of requests) {
						if (this.disposed) break;
						const response = await this.editor.handleRequest(request);
						await client.editorResponse(this.editorId, response);
					}
				} catch { /* Never repeat delivered edits after a lost response. The host records timeout/unknown. */ }
				finally { this.editorPolling = false; }
		},

		async pullEvents(this: CediaTaskViewProviderApi): Promise<void> {
				if (this.polling || !this.client || !this.state.session) return;
				this.polling = true;
				const sessionId = this.state.session.id;
				const epoch = this.navigationEpoch;
				const current = () => epoch === this.navigationEpoch && this.state.session?.id === sessionId;
				try {
					const latestValue = await this.client.getSession(sessionId);
					if (!current()) return;
					const latest = normalizeSession(latestValue);
					if (latest && latest.incarnation !== this.state.session.incarnation) {
						const projects = this.state.projects;
						const sessions = this.state.sessions.map(item => item.id === latest.id ? latest : item);
						this.state = reduceTaskState(this.state, { type: "reset", project: this.state.project, session: latest });
						this.state = { ...this.state, projects, sessions };
						this.postSnapshot();
					} else if (latest) {
						this.setState({ type: "session", session: latest });
					}
					const activeSession = this.state.session;
					if (!activeSession) return;
					const page = await this.client.getEvents(sessionId, this.state.cursor, EVENT_PAGE_LIMIT);
					if (!current()) return;
					for (const event of page.events) this.terminals.ingest(event);
					this.setState({ type: "events", page });
					const commands = await this.client.getCommands(activeSession.id, { limit: EVENT_PAGE_LIMIT });
					if (!current()) return;
					for (const command of commands) this.setState({ type: "command_result", command });
					const pending = await this.client.getPendingUi(activeSession.id);
					if (!current()) return;
					const requests = pending.flatMap(item => {
						const parsed = parseCediaUiRequest(item);
						if (!parsed.ok) {
							// A request this surface cannot render is stated, not dropped. The
							// reducer owns that line and needs the envelope it refused.
							if (parsed.reason === "unknown-method") this.setState({ type: "ui_request", event: item });
							return [];
						}
						const seen = this.uiSeen.get(parsed.request.token) ?? Date.now();
						this.uiSeen.set(parsed.request.token, seen);
						return [{
							...parsed.request,
							sessionId: parsed.request.sessionId ?? activeSession.id,
							incarnation: parsed.request.incarnation ?? activeSession.incarnation,
							receivedAt: parsed.request.receivedAt ?? seen,
						}];
					});
					for (const token of [...this.uiSeen.keys()]) {
						if (!requests.some(item => item.token === token)) this.uiSeen.delete(token);
					}
					this.setState({ type: "ui_sync", requests });
					this.lastHostSyncAt = new Date().toISOString();
					if (page.events.length > 0 || commands.length > 0) this.setState({ type: "connection", status: activeSession.status === "running" ? "running" : "connected", error: undefined });
				} catch (error) {
					if (!current()) return;
					this.client = undefined;
					this.setState({ type: "connection", status: "offline", error: errorMessage(error), markUnknown: true });
					this.post({ type: "error", text: `Cedia host disconnected: ${errorMessage(error)}`, status: "offline" });
				} finally {
					this.polling = false;
				}
		},

		async refresh(this: CediaTaskViewProviderApi): Promise<void> {
				const client = await this.ensureClient();
				const projectsValue = await client.listProjects();
				const projects = asArray<unknown>(projectsValue, "projects").map(normalizeProject).filter((value): value is Project => value !== undefined);
				this.setState({ type: "projects", projects });
				let project = this.state.project;
				const currentWorkspace = workspacePath();
				if (!project && currentWorkspace) project = projects.find(item => item.path === currentWorkspace) ?? null;
				if (!project && projects.length === 1) project = projects[0] ?? null;
				if (project) {
					this.setState({ type: "projects", projects });
					const sameProject = this.state.project?.id === project.id;
					const sameSession = this.state.session?.projectId === project.id;
					if (!sameProject || !sameSession) {
						this.state = reduceTaskState(this.state, { type: "reset", project, session: sameSession ? this.state.session : null });
						this.postSnapshot();
					} else if (!this.state.project) {
						this.state = { ...this.state, project };
						this.postSnapshot();
					}
					await this.loadProjectSessions(client, project);
				}
				await this.pullEvents();
				await this.refreshGitBranch();
				if (this.state.session) await this.getLoginProviders().catch(() => {});
		},

		async refreshGitBranch(this: CediaTaskViewProviderApi): Promise<void> {
				const cwd = this.state.session?.cwd ?? this.state.project?.path ?? workspacePath();
				if (!cwd) {
					this.gitBranch = undefined;
					this.branches = [];
					return;
				}
				try {
					// The host owns the repository read: one call for the checked out
					// branch and one for the advertised refs, both authorized against
					// the roots it already knows.
					const client = await this.ensureClient();
					const status = await requestGit(client, cwd, "status", {});
					const branches = await requestGit(client, cwd, "listBranches", {});
					this.gitBranch = status.branch ?? undefined;
					this.branches = branchHitsFromHostBranches(branches.branches);
				} catch {
					this.gitBranch = undefined;
					this.branches = [];
				}
		},

		async loadProjectSessions(this: CediaTaskViewProviderApi, client: CediaHostClient, project: Project): Promise<void> {
				const sessionsValue = await client.listSessions(project.id);
				const sessions = asArray<unknown>(sessionsValue, "sessions").map(normalizeSession).filter((value): value is Session => value !== undefined);
				this.setState({ type: "sessions", sessions });
				if (this.state.session && !sessions.some(item => item.id === this.state.session?.id)) {
					this.setState({ type: "session", session: null });
				}
		},

		reportError(this: CediaTaskViewProviderApi, error: unknown): void {
				const message = errorMessage(error);
				// Failures raised from startup or from a background mode switch have no
				// webview to receive them, and previously vanished without a trace.
				this.log.error(error instanceof Error ? (error.stack ?? message) : message);
				const offline = error instanceof HostSetupRequiredError || error instanceof HostDescriptorError || error instanceof TypeError || error instanceof HostRequestTimeoutError || (error instanceof HostHttpError && error.status >= 500);
				this.setState({ type: "connection", status: offline ? "offline" : "unknown", error: message, markUnknown: true });
				this.post({ type: "error", text: message, status: offline ? "offline" : "unknown" });
		},

		refreshNow(this: CediaTaskViewProviderApi): Promise<void> {
				return this.refresh();
		},

		async focusAgentSurface(this: CediaTaskViewProviderApi, message: unknown): Promise<void> {
				if (this.state.workbenchMode === "ide") {
					await this.focusDock();
					this.post(message);
					return;
				}
				this.post(message);
		},

};
