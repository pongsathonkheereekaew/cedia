/** Item 66: Workbench chrome, status bar, context keys, layout — slice of CediaTaskViewProvider.
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
import { errorMessage } from "./task-runtime.ts";

export const chromeConcern: Partial<CediaTaskViewProviderApi> = {
		async setWorkbenchMode(this: CediaTaskViewProviderApi, mode: "agents" | "ide", opts?: { readonly newWindow?: boolean }): Promise<void> {
				this.retentionBefore = this.retentionSnapshot(this.state.workbenchMode === "ide" ? "ide" : "agents");
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
				const from: "agents" | "ide" = this.agentsChromeApplied ? "agents" : "ide";
				if (mode === "agents") await this.rememberIdeFolder();
				if (mode === "agents" && from !== "agents") {
					// Native Code-OSS owns secondary-bar visibility. The user may have
					// closed it since our last snapshot, so read the live part before
					// Agents chrome hides it and persist exactly that choice.
					let visible: boolean | undefined;
					try {
						visible = await vscode.commands.executeCommand<boolean>("cedia.internal.readAuxiliaryBarVisibility");
					} catch {
						// An older shell can still restore its previous snapshot.
					}
					this.ideLayout = this.captureIdeLayout(visible);
				}
				this.setState({ type: "workbench_mode", mode });
				const switched = switchWorkbenchMode({ from, to: mode, ideLayout: this.ideLayout });
				this.ideLayout = switched.ideLayout;
				if (mode === "agents") await this.revealAgentSurface();
				await runWorkbenchCommands((command, ...args) => vscode.commands.executeCommand(command, ...args), switched.commands);
				// Appearance is cosmetic and its workspace-scoped writes can stall (for
				// example while the settings file is being written, or before a folder
				// is attached). Awaiting it used to hang the whole mode switch, so the
				// mode was never recorded and the agent surface was never revealed.
				// Fire it and continue; failures are ignored because nothing depends on it.
				void this.applyWorkbenchAppearance(mode).catch(error => this.reportError(error));
				this.agentsChromeApplied = mode === "agents";
				this.persistModeSwitchProof(mode);
				this.log.debug(`workbench mode applied: ${mode} (chromeApplied=${this.agentsChromeApplied})`);
				void this.context.globalState.update("cedia.lastWorkbenchMode", mode);
				if (mode === "ide") {
					this.agentsStatus?.show();
					if (this.ideLayout.activeEditorUri) {
						try {
							await vscode.window.showTextDocument(vscode.Uri.parse(this.ideLayout.activeEditorUri), { preview: false, preserveFocus: false });
						} catch { /* Missing editors stay closed; chrome restore still applies. */ }
					}
					const consumed = consumePendingNativeDestination("ide", this.pendingNativeDestination);
					this.pendingNativeDestination = consumed.pending;
					void this.context.globalState.update("cedia.pendingNativeDestination", this.pendingNativeDestination);
					if (consumed.openExplorer) {
						this.ideLayout = rememberIdeChrome(this.ideLayout, { sidebarVisible: true });
						void this.context.globalState.update("cedia.ideLayout", this.ideLayout);
						await vscode.commands.executeCommand("workbench.view.explorer");
					}
					return;
				}
				this.agentsStatus?.hide();
		},

		async applyWorkbenchAppearance(this: CediaTaskViewProviderApi, mode: "agents" | "ide"): Promise<void> {
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
							this.log.debug(`workbench appearance skipped for ${section}: ${errorMessage(error)}`);
							return;
						}
						try {
							await target.update(section, value, vscode.ConfigurationTarget.Global);
						} catch (fallbackError) {
							this.log.debug(`workbench appearance skipped for ${section}: ${errorMessage(error)} / ${errorMessage(fallbackError)}`);
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
						this.log.debug(`workbench appearance skipped for colorCustomizations: ${errorMessage(error)}`);
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
				await apply(editor, "showTabs", this.ideLayout.showTabs ?? "multiple", true);
				await apply(editor, "editorActionsLocation", "default", true);
				await apply(workbench, "statusBar.visible", this.ideLayout.statusBarVisible ?? true, true);
				await apply(workbench, "layoutControl.enabled", true, true);
				await apply(workbench, "activityBar.location", this.ideLayout.activityBarLocation ?? "default", true);
				await apply(window, "commandCenter", true, true);
				await apply(breadcrumbs, "enabled", this.ideLayout.breadcrumbsEnabled ?? true, true);
		},

		reapplyWorkbenchAppearance(this: CediaTaskViewProviderApi): void {
				const mode = this.state.workbenchMode === "ide" ? "ide" : "agents";
				void this.applyWorkbenchAppearance(mode).catch(error => this.reportError(error));
		},

		inAgentsWindow(this: CediaTaskViewProviderApi): boolean {
				return isAgentsWindow(vscode.workspace.workspaceFile);
		},

		async rememberIdeFolder(this: CediaTaskViewProviderApi): Promise<void> {
				const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				if (folder && !this.inAgentsWindow()) await this.context.globalState.update("cedia.lastIdeFolder", folder);
		},

		async openIdeWindow(this: CediaTaskViewProviderApi): Promise<void> {
				const folder = this.state.project?.path || this.context.globalState.get<string>("cedia.lastIdeFolder");
				if (folder) {
					await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(folder), { forceNewWindow: true });
					return;
				}
				await vscode.commands.executeCommand("workbench.action.newWindow");
		},

		resolveWebviewView(this: CediaTaskViewProviderApi, view: vscode.WebviewView): void {
				// Item 63a: the hand-drawn task shell is deleted — the dock renders the
				// shared bundle through CediaIdeAgentProvider now. The view registry stays:
				// status-bar and context-key updates are live pieces with no bundle path.
				this.views.add(view);
				view.onDidDispose(() => { this.views.remove(view); }, undefined, this.context.subscriptions);
				if (this.pendingComposerFocus.claim()) this.post({ type: "focus_composer" });
				void this.refresh().catch(error => this.reportError(error));
		},

		openAgentsWindow(this: CediaTaskViewProviderApi): void {
				// Cedia's Agents surface is the base sessions workbench window, not a
				// docked shell in this window (see CEDIA-PLAN.md S1c).
				void vscode.commands.executeCommand("workbench.action.openAgentsWindow");
		},

		showIde(this: CediaTaskViewProviderApi): void {
				void this.setWorkbenchMode("ide");
		},

		async focusDock(this: CediaTaskViewProviderApi): Promise<void> {
				this.pendingComposerFocus.request();
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
				if (!focused) this.log.debug("no Cedia view could be focused; the draft still updated");
				if (this.views.size > 0 && this.pendingComposerFocus.claim()) this.post({ type: "focus_composer" });
		},

		focusComposer(this: CediaTaskViewProviderApi): void {
				void this.focusAgentSurface({ type: "focus_composer" });
		},

		focusSearch(this: CediaTaskViewProviderApi): void {
				void this.focusAgentSurface({ type: "focus_search" });
		},

		skipToTask(this: CediaTaskViewProviderApi): void {
				void this.focusAgentSurface({ type: "focus_task" });
		},

		renderAgentsStatus(this: CediaTaskViewProviderApi): void {
				const item = this.agentsStatus;
				if (!item) return;
				const approvals = this.state.uiRequests.length;
				const connection = this.state.connection;
				const running = this.state.session?.status === "running";
				const syncing = this.state.pendingCommands && Object.values(this.state.pendingCommands).some((command) => command && command.status === "sent");
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
		},

		hasTaskSurface(this: CediaTaskViewProviderApi): boolean {
				return Boolean(this.state.project || this.client || this.state.session);
		},

		syncCediaContext(this: CediaTaskViewProviderApi): void {
				void vscode.commands.executeCommand("setContext", "cedia.taskAvailable", this.hasTaskSurface());
		},

		applyWindowTitle(this: CediaTaskViewProviderApi): void {
				const title = cediaWindowTitle({
					mode: this.state.workbenchMode === "ide" ? "ide" : "agents",
					taskTitle: this.state.session?.title,
					projectName: this.state.project?.name,
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
		},

		setState(this: CediaTaskViewProviderApi, action: Parameters<typeof reduceTaskState>[1]): void {
				this.state = reduceTaskState(this.state, action);
				const leaf = activeLeaf(this.layout);
				if (leaf) this.paneTranscripts = rememberPaneTranscript(this.paneTranscripts, leaf, this.state.transcript);
				if (this.state.session) {
					this.transcriptIndex[this.state.session.id] = {
						title: this.state.session.title,
						text: this.state.transcript.map(entry => entry.text || entry.output || "").filter(Boolean).join("\n"),
					};
				}
				this.postSnapshot();
		},

		post(this: CediaTaskViewProviderApi, message: unknown): void {
				// Item 63a: no task-shell view can resolve (its registration is gone), so
				// there are no targets — kept so live callers (errors, refusals, focus)
				// don't churn before item 66's split. The argument is still typechecked.
				void message;
				const targets = this.views.targets().map(view => view.webview);
				for (const target of targets) void target.postMessage(message);
		},

		postSnapshot(this: CediaTaskViewProviderApi): void {
				// Item 63a: the snapshot post fed the dead shell — dropped. Status bar
				// and context keys are the live pieces and stay.
				this.renderAgentsStatus();
				this.syncCediaContext();
				// Item 63a: snapshot body deleted with the shell — see the method note.
				this.applyWindowTitle();
		},

		attachmentRefs(this: CediaTaskViewProviderApi): readonly string[] {
				return this.attachments.map(item => item.contentRef || item.id);
		},

		retentionSnapshot(this: CediaTaskViewProviderApi, mode: "agents" | "ide"): RetentionSnapshot {
				return {
					sessionId: this.state.session?.id ?? "",
					draft: this.state.draft,
					scrollEventId: this.state.transcriptScrolls[draftViewKey(this.state.project?.id, this.state.session?.id)]?.eventId ?? "",
					attachmentRefs: this.attachmentRefs(),
					mode,
					pendingDestination: this.pendingNativeDestination,
				};
		},

		persistModeSwitchProof(this: CediaTaskViewProviderApi, to: "agents" | "ide"): void {
				const after = this.retentionSnapshot(to);
				const proof = modeSwitchProof(this.retentionBefore, after);
				void this.context.globalState.update("cedia.modeSwitchProof", proof);
				const uri = vscode.Uri.joinPath(this.context.globalStorageUri, "mode-switch-proof.json");
				// The file service returns a Thenable, which has no `.catch`; wrapping it
				// keeps the whole chain catchable so a failed write is reported instead
				// of becoming an unhandled rejection.
				void Promise.resolve(vscode.workspace.fs.createDirectory(this.context.globalStorageUri))
					.then(() => vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`${JSON.stringify(proof, null, 2)}\n`)))
					.then(() => this.log.debug(`mode switch proof written: ${uri.toString()}`))
					// The proof is diagnostics, not product state, but a silent failure
					// here used to hide a broken extension storage path entirely.
					.catch(error => this.log.warn(`mode switch proof not written (${uri.toString()}): ${errorMessage(error)}`));
		},

		activeScrollKey(this: CediaTaskViewProviderApi): string {
				const leaf = activeLeaf(this.layout);
				if (leaf) return paneDraftKey(leaf);
				return draftViewKey(this.state.project?.id, this.state.session?.id);
		},

		scrollKeyForView(this: CediaTaskViewProviderApi, viewId?: string): string {
				if (viewId) {
					const leaf = visibleLeaves(this.layout).find(item => item.viewId === viewId);
					if (leaf) return paneDraftKey(leaf);
				}
				return this.activeScrollKey();
		},

		rememberActiveTranscript(this: CediaTaskViewProviderApi): void {
				const leaf = activeLeaf(this.layout);
				if (!leaf) return;
				this.paneTranscripts = rememberPaneTranscript(this.paneTranscripts, leaf, this.state.transcript);
		},

		captureActivePaneDraft(this: CediaTaskViewProviderApi): void {
				const leaf = activeLeaf(this.layout);
				if (!leaf) return;
				this.state = { ...this.state, drafts: { ...this.state.drafts, [paneDraftKey(leaf)]: this.state.draft } };
		},

		applyActivePaneDraft(this: CediaTaskViewProviderApi): void {
				const leaf = activeLeaf(this.layout);
				if (!leaf) return;
				const key = paneDraftKey(leaf);
				const draft = this.state.drafts[key] ?? "";
				this.state = reduceTaskState(this.state, { type: "draft", draft });
				this.state = { ...this.state, drafts: { ...this.state.drafts, [key]: draft } };
		},

		syncSinglePaneIdentity(this: CediaTaskViewProviderApi): void {
				if (visibleLeaves(this.layout).length !== 1) return;
				this.layout = createLayoutTree({
					projectId: this.state.project?.id ?? null,
					sessionId: this.state.session?.id ?? null,
					viewId: this.layout.activeViewId,
				});
				this.persistLayout();
		},

		persistLayout(this: CediaTaskViewProviderApi): void {
				void this.context.globalState.update("cedia.layoutTree", serializeLayout(this.layout));
		},

		async persistLegacyDrafts(this: CediaTaskViewProviderApi): Promise<void> {
				const migration = this.context.globalState.get<{ version?: unknown }>("cedia.drafts.migration");
				if (migration?.version === 1) return;
				await this.context.globalState.update("cedia.drafts", this.state.drafts);
		},

		setWorkResource(this: CediaTaskViewProviderApi, tab: WorkPanelTab, status: ResourceStatus, detail?: string): void {
				const taskKey = draftViewKey(this.state.project?.id, this.state.session?.id);
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
		},

		expireWorkResource(this: CediaTaskViewProviderApi, tab: WorkPanelTab): void {
				const taskKey = draftViewKey(this.state.project?.id, this.state.session?.id);
				this.setState({ type: "work_panel", action: { type: "expire_resource", id: workResourceId(taskKey, tab) } });
		},

		async restartWorkResource(this: CediaTaskViewProviderApi, tab: WorkPanelTab): Promise<void> {
				const taskKey = draftViewKey(this.state.project?.id, this.state.session?.id);
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
		},

		async activatePane(this: CediaTaskViewProviderApi, viewId?: string): Promise<void> {
				if (!viewId || viewId === this.layout.activeViewId) return;
				this.rememberActiveTranscript();
				this.captureActivePaneDraft();
				this.layout = focusView(this.layout, viewId);
				this.persistLayout();
				await this.revealActivePane();
		},

		applyPaneSplit(this: CediaTaskViewProviderApi, direction: "right" | "down"): void {
				const availablePx = direction === "right" ? this.viewport.width : this.viewport.height;
				const room = canSplit({ direction, availablePx, paneCount: layoutLeaves(this.layout).length });
				if (!room.ok) {
					void vscode.window.showInformationMessage(NEED_MORE_SPACE_REASON);
					return;
				}
				this.rememberActiveTranscript();
				this.captureActivePaneDraft();
				this.layout = splitActive(this.layout, direction, availablePx);
				this.applyActivePaneDraft();
				this.persistLayout();
				this.postSnapshot();
		},

		async openSessionInNewPane(this: CediaTaskViewProviderApi, sessionId: string): Promise<void> {
				const next = openSessionInSplit(this.layout, {
					sessionId,
					availablePx: this.viewport.width,
					projectId: this.state.project?.id ?? null,
				});
				if (!next.ok) {
					void vscode.window.showInformationMessage(next.reason);
					return;
				}
				this.rememberActiveTranscript();
				this.captureActivePaneDraft();
				this.layout = next.tree;
				this.persistLayout();
				await this.selectSession(sessionId);
		},

		applyClosePane(this: CediaTaskViewProviderApi): void {
				this.captureActivePaneDraft();
				const before = visibleLeaves(this.layout).length;
				this.layout = closeActive(this.layout);
				this.applyActivePaneDraft();
				this.persistLayout();
				if (before <= 1) {
					void this.newTaskFlow();
					return;
				}
				void this.revealActivePane();
		},

		async revealActivePane(this: CediaTaskViewProviderApi): Promise<void> {
				const leaf = activeLeaf(this.layout);
				if (leaf?.sessionId && leaf.sessionId !== this.state.session?.id) {
					await this.selectSession(leaf.sessionId);
					this.applyActivePaneDraft();
					this.postSnapshot();
					return;
				}
				if (!leaf?.sessionId && this.state.session) {
					this.setState({ type: "session", session: null });
					this.applyActivePaneDraft();
					this.postSnapshot();
					return;
				}
				this.applyActivePaneDraft();
				this.postSnapshot();
		},

		getStateForTest(this: CediaTaskViewProviderApi): { draft: string } {
				return { draft: this.state.draft };
		},

		getWorkPanelForTest(this: CediaTaskViewProviderApi): { open: boolean; activeTab: string } {
				return { open: this.state.workPanel.open, activeTab: this.state.workPanel.activeTab };
		},

		dispose(this: CediaTaskViewProviderApi): void {
				this.disposed = true;
				this.agentEditDecorationHandle?.dispose();
				this.agentEditLensesChanged.dispose();
				this.agentEdits.clear();
				this.editor.dispose();
				this.terminals.dispose();
				if (this.pollTimer) clearInterval(this.pollTimer);
				this.pollTimer = undefined;
				this.client = undefined;
		},

		applyStartupView(this: CediaTaskViewProviderApi): void {
				const startup = resolveStartupView({
					pending: this.pendingNativeDestination,
					rememberedMode: this.context.globalState.get("cedia.lastWorkbenchMode"),
					startupView: this.prefs.startupView,
					inAgentsWindow: this.inAgentsWindow(),
				});
				this.log.info(`startup view=${this.prefs.startupView} mode=${startup.mode} revealDock=${startup.revealDock}`);
				void this.setWorkbenchMode(startup.mode)
					.then(async () => {
						if (!startup.revealDock || !this.ideLayout.auxiliaryBarVisible) return;
						this.log.debug("revealing docked agent view");
						// Coexistence default: keep the native IDE and put the agent beside
						// it. Revealing the container must not steal the editor's focus, so
						// this uses the container reveal command rather than the dock focus.
						try {
							await vscode.commands.executeCommand("workbench.view.extension.cediaDock");
							this.log.debug("docked agent view revealed");
						} catch (error) {
							// Older layouts may not expose the container command; the view is
							// still available from the side bar, so this is not fatal.
							this.log.warn(`could not reveal the docked view: ${errorMessage(error)}`);
							this.post({ type: "error", text: `Cedia could not reveal the docked view: ${errorMessage(error)}`, status: "unknown" });
						}
					})
					// Startup must never fail silently: an unhandled rejection here used
					// to leave the mode, the layout, and the dock state inconsistent.
					.catch(error => this.reportError(error));
		},

		captureIdeLayout(this: CediaTaskViewProviderApi, auxiliaryBarVisible?: boolean): IdeLayoutSnapshot {
				const editor = vscode.window.activeTextEditor;
				const alreadyAgents = this.agentsChromeApplied;
				const showTabs = vscode.workspace.getConfiguration("workbench.editor").get<string>("showTabs");
				const statusBarVisible = vscode.workspace.getConfiguration("workbench").get<boolean>("statusBar.visible");
				const breadcrumbsEnabled = vscode.workspace.getConfiguration("breadcrumbs").get<boolean>("enabled");
				const activityBarLocation = vscode.workspace.getConfiguration("workbench").get<string>("activityBar.location");
				if (alreadyAgents) {
					return rememberIdeChrome(this.ideLayout, {
						activeEditorUri: editor?.document.uri.toString() ?? this.ideLayout.activeEditorUri,
					});
				}
				const captured = {
					sidebarVisible: this.ideLayout.sidebarVisible !== false,
					auxiliaryBarVisible: auxiliaryBarVisible ?? this.ideLayout.auxiliaryBarVisible,
					panelVisible: this.ideLayout.panelVisible !== false,
					activeEditorUri: editor?.document.uri.toString() ?? this.ideLayout.activeEditorUri,
					showTabs: showTabs ?? this.ideLayout.showTabs ?? "multiple",
					statusBarVisible: statusBarVisible ?? this.ideLayout.statusBarVisible ?? true,
					breadcrumbsEnabled: breadcrumbsEnabled ?? this.ideLayout.breadcrumbsEnabled ?? true,
					activityBarLocation: activityBarLocation ?? this.ideLayout.activityBarLocation ?? "default",
				};
				// Read through the same rule the loader uses, so a workspace setting left
				// behind by a previous Agents session cannot be recorded as the user's
				// IDE layout (that is what made IDE mode return without tabs or a status
				// bar). The previous snapshot supplies the fallback.
				const sanitized = normalizeIdeLayout(captured, this.ideLayout);
				void this.context.globalState.update("cedia.ideLayout", sanitized);
				return sanitized;
		},

		async revealAgentSurface(this: CediaTaskViewProviderApi): Promise<void> {
				if (this.inAgentsWindow()) return;
				await this.focusDock();
		},

};
