/** Item 66: Project and session operations — slice of CediaTaskViewProvider.
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


import type { CediaTaskViewProviderApi } from "./provider-api.ts";
import { errorMessage, asArray, workspacePath, normalizeProject, hostSessionIdsFromHint, normalizeSession } from "./task-runtime.ts";

export const projectsConcern: Partial<CediaTaskViewProviderApi> = {
		async resolveHostProject(this: CediaTaskViewProviderApi, hint: string, client: CediaHostClient): Promise<Project | undefined> {
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
		},

		async withHostProject(this: CediaTaskViewProviderApi, hint: unknown, run: (project: Project, client: CediaHostClient) => Promise<void>): Promise<void> {
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
		},

		setProjectPinned(this: CediaTaskViewProviderApi, folderPath: unknown): Promise<void> {
				return this.withHostProject(folderPath, async (project, client) => {
					const updated = await client.patchProject(project.id, { pinned: !project.pinned });
					void vscode.window.showInformationMessage(updated.pinned ? `Pinned ${updated.name}` : `Unpinned ${updated.name}`);
					await this.refresh();
				});
		},

		renameProject(this: CediaTaskViewProviderApi, folderPath: unknown): Promise<void> {
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
		},

		archiveProjectChats(this: CediaTaskViewProviderApi, folderPath: unknown): Promise<void> {
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
		},

		removeProject(this: CediaTaskViewProviderApi, folderPath: unknown): Promise<void> {
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
		},

		async deleteChatSessions(this: CediaTaskViewProviderApi, hint: unknown): Promise<void> {
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
		},

		createWorktreeForProject(this: CediaTaskViewProviderApi, folderPath: unknown): Promise<void> {
				return this.withHostProject(folderPath, async (project, client) => {
					const sessionValue = await client.createSession({ projectId: project.id, workspaceMode: "worktree" });
					const created = normalizeSession(sessionValue);
					if (!created) {
						throw new Error("Cedia host returned an invalid session");
					}
					void vscode.window.showInformationMessage(`Created a worktree task for ${project.name} at ${created.cwd}`);
					await this.refresh();
				});
		},

		revealProject(this: CediaTaskViewProviderApi, hint: unknown): Promise<void> {
				return this.withHostProject(hint, async project => {
					await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(project.path));
				});
		},

		async newTaskFlow(this: CediaTaskViewProviderApi): Promise<void> {
				this.rememberCurrentRoute();
				this.projectsRoute = false;
				this.navigationEpoch++;
				this.historyNote = undefined;
				this.routeError = undefined;
				this.rememberActiveTranscript();
				this.captureActivePaneDraft();
				if (visibleLeaves(this.layout).length > 1) {
					this.layout = assignActive(this.layout, { sessionId: null });
					this.persistLayout();
					this.setState({ type: "reset", session: null, project: this.state.project });
					this.applyActivePaneDraft();
					return;
				}
				this.setState({ type: "reset", session: null, project: this.state.project });
				this.syncSinglePaneIdentity();
		},

		async openFolderFlow(this: CediaTaskViewProviderApi): Promise<void> {
				const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Use folder for Cedia task" });
				if (!picked?.[0]) return;
				await this.openProjectAtPath(picked[0].fsPath);
		},

		async addProjectFlow(this: CediaTaskViewProviderApi): Promise<void> {
				const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Add folder as a Cedia project" });
				if (!picked?.[0]) return;
				await this.addProjectAtPath(picked[0].fsPath);
		},

		async addProjectAtPath(this: CediaTaskViewProviderApi, path: string): Promise<void> {
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
		},

		async openProjectAtPath(this: CediaTaskViewProviderApi, path: string): Promise<void> {
				if (!path) return;
				if (!existsSync(path)) {
					await vscode.window.showInformationMessage(MISSING_RECENT_REASON);
					this.postSnapshot();
					return;
				}
				this.navigationEpoch++;
				this.historyNote = undefined;
				this.routeError = undefined;
				const client = await this.ensureClient();
				const existingProjects = asArray<Project>(await client.listProjects(), "projects");
				const projectValue = existingProjects.find(project => project.path === path) ?? await client.createProject(path, path.split(/[\\/]/).pop() || undefined);
				const project = normalizeProject(projectValue);
				if (!project) throw new Error("Cedia host returned an invalid project");
				await this.rememberRecent(path);
				this.setState({ type: "reset", session: null, project });
				this.setState({ type: "projects", projects: [...this.state.projects.filter(item => item.id !== project.id), project] });
				this.syncSinglePaneIdentity();
				await this.loadProjectSessions(client, project);
		},

		async rememberRecent(this: CediaTaskViewProviderApi, path: string): Promise<void> {
				const cleaned = path.trim();
				if (!cleaned) return;
				this.recents = [{ path: cleaned }, ...this.recents.filter(item => item.path !== cleaned)].slice(0, 12);
				await this.context.globalState.update("cedia.recentFolders", this.recents);
		},

		welcomeModel(this: CediaTaskViewProviderApi): ReturnType<typeof projectsWelcomeModel> {
				const current = workspacePath();
				const paths = this.recents.map(item => item.path);
				if (current && !paths.includes(current)) paths.unshift(current);
				return projectsWelcomeModel({
					recents: paths.map(path => ({ path, missing: !existsSync(path) })),
					cloneAdvertised: false,
				});
		},

		async openProjectsRoute(this: CediaTaskViewProviderApi): Promise<void> {
				this.rememberCurrentRoute();
				this.projectsRoute = true;
				this.routeHistory = rememberRoute(this.routeHistory, { kind: "projects" });
				this.postSnapshot();
		},

		async goRouteBack(this: CediaTaskViewProviderApi): Promise<void> {
				const next = routeBack(this.routeHistory);
				if (!next.frame) {
					await this.openProjectsRoute();
					return;
				}
				this.routeHistory = next.history;
				await this.applyRouteFrame(next.frame);
		},

		async goRouteForward(this: CediaTaskViewProviderApi): Promise<void> {
				const next = routeForward(this.routeHistory);
				if (!next.frame) return;
				this.routeHistory = next.history;
				await this.applyRouteFrame(next.frame);
		},

		rememberCurrentRoute(this: CediaTaskViewProviderApi): void {
				this.routeHistory = rememberRoute(this.routeHistory, this.currentRouteFrame());
		},

		async applyRouteFrame(this: CediaTaskViewProviderApi, frame: RouteFrame): Promise<void> {
				if (frame.kind === "projects") {
					this.projectsRoute = true;
					this.postSnapshot();
					return;
				}
				this.projectsRoute = false;
				if (frame.sessionId) {
					await this.selectSession(frame.sessionId, true);
					return;
				}
				this.setState({ type: "reset", session: null, project: this.state.project });
		},

		currentRouteFrame(this: CediaTaskViewProviderApi): RouteFrame {
				if (this.projectsRoute) return { kind: "projects" };
				return {
					kind: "task",
					projectId: this.state.project?.id ?? null,
					sessionId: this.state.session?.id ?? null,
					scrollKey: this.activeScrollKey(),
					offset: this.state.transcriptScrolls[this.activeScrollKey()]?.offset,
				};
		},

		routeAvailability(this: CediaTaskViewProviderApi) {
				return availabilityFromLists({
					projects: this.state.projects,
					sessions: this.state.sessions,
				});
		},

		showRouteError(this: CediaTaskViewProviderApi, error: RouteErrorPage): void {
				this.routeError = error;
				this.postSnapshot();
		},

		async selectProject(this: CediaTaskViewProviderApi, id: string): Promise<void> {
				const validation = validateRoute({ kind: "projects", projectId: id }, this.routeAvailability());
				if (!validation.ok) {
					this.showRouteError(validation.error);
					return;
				}
				this.navigationEpoch++;
				this.routeError = undefined;
				this.historyNote = undefined;
				const project = this.state.projects.find(item => item.id === id);
				if (!project) {
					this.showRouteError(routeErrorPage({ kind: "projects", reason: "missing", id }));
					return;
				}
				const client = await this.ensureClient();
				const projects = this.state.projects;
				this.state = reduceTaskState(this.state, { type: "reset", project, session: null });
				this.state = { ...this.state, projects };
				this.postSnapshot();
				await this.loadProjectSessions(client, project);
		},

		async selectSession(this: CediaTaskViewProviderApi, id: string, fromHistory = false): Promise<void> {
				const validation = validateRoute({ kind: "task", projectId: this.state.project?.id, sessionId: id }, this.routeAvailability());
				if (!validation.ok) {
					this.showRouteError(validation.error);
					return;
				}
				this.navigationEpoch++;
				this.routeError = undefined;
				this.historyNote = undefined;
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
					this.projectsRoute = false;
					this.routeHistory = rememberRoute(this.routeHistory, {
						kind: "task",
						projectId: session.projectId,
						sessionId: session.id,
					});
				} else {
					this.projectsRoute = false;
				}
				this.rememberActiveTranscript();
				this.captureActivePaneDraft();
				this.layout = assignActive(this.layout, {
					sessionId: session.id,
					projectId: session.projectId ?? this.state.project?.id ?? null,
				});
				this.persistLayout();
				const projects = this.state.projects;
				const sessions = this.state.sessions;
				this.state = reduceTaskState(this.state, { type: "reset", project: this.state.projects.find(item => item.id === session.projectId) ?? this.state.project, session });
				this.state = { ...this.state, projects, sessions };
				this.postSnapshot();
				await this.pullEvents();
				if (this.modelsFetchedFor !== session.id) {
					this.modelsFetchedFor = session.id;
					await this.getModels().catch(() => {});
				}
				await this.refreshOmpState();
		},

		async createWorktreeOnCurrentProject(this: CediaTaskViewProviderApi): Promise<void> {
				const project = this.state.project;
				if (!project) {
					await this.openFolderFlow();
					return;
				}
				if (!this.gitBranch) {
					this.worktreeReceipt = failedWorktreeReceipt(WORKTREE_NO_GIT_REASON);
					this.postSnapshot();
					await vscode.window.showInformationMessage(WORKTREE_NO_GIT_REASON);
					return;
				}
				this.navigationEpoch++;
				const epoch = this.navigationEpoch;
				this.historyNote = undefined;
				this.routeError = undefined;
				this.worktreeReceipt = beginWorktreeReceipt();
				this.postSnapshot();
				try {
					const client = await this.ensureClient();
					const sessionValue = await client.createSession({ projectId: project.id, workspaceMode: "worktree" });
					const created = normalizeSession(sessionValue);
					if (!created) throw new Error("Cedia host returned an invalid session");
					if (epoch !== this.navigationEpoch) {
						this.worktreeReceipt = cancelWorktreeReceipt({ status: "creating", path: created.cwd, sessionId: created.id });
						this.postSnapshot();
						return;
					}
					const previousProjects = this.state.projects;
					const drafts = this.state.drafts;
					const workbenchMode = this.state.workbenchMode;
					this.state = reduceTaskState(createInitialTaskState({ drafts, workbenchMode, draft: drafts[draftViewKey(project.id, created.id)] ?? "" }), { type: "session", session: created });
					this.state = { ...this.state, project, projects: previousProjects, sessions: [created, ...this.state.sessions.filter(item => item.id !== created.id)], connection: "connecting" };
					this.worktreeReceipt = readyWorktreeReceipt({ path: created.cwd, sessionId: created.id });
					this.postSnapshot();
					await this.startCreatedSession(created.id, created);
				} catch (error) {
					this.worktreeReceipt = epoch !== this.navigationEpoch
						? cancelWorktreeReceipt({ status: "creating" })
						: failedWorktreeReceipt(errorMessage(error));
					this.postSnapshot();
				}
		},

		async startCreatedSession(this: CediaTaskViewProviderApi, id: string, created: ReturnType<typeof normalizeSession>): Promise<void> {
				if (!created) return;
				const epoch = this.navigationEpoch;
				const client = await this.ensureClient();
				const startedValue = await client.startSession(id);
				if (epoch !== this.navigationEpoch || this.state.session?.id !== created.id) return;
				this.setState({ type: "session", session: normalizeSession(startedValue) ?? created });
				await this.pullEvents();
		},

};
