/** Item 66: Review surface, devices, settings, tasks — slice of CediaTaskViewProvider.
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


import type { CediaTaskViewProviderApi } from "./provider-api.ts";
import { errorMessage, workspacePath, editorMentionContext, commandId, requestGit } from "./task-runtime.ts";

export const reviewConcern: Partial<CediaTaskViewProviderApi> = {
		async nativeAction(this: CediaTaskViewProviderApi, action: NativeAction): Promise<void> {
				const cwd = this.state.session?.cwd ?? this.state.project?.path ?? workspacePath();
				switch (action) {
					case "files": {
						this.pendingNativeDestination = queuePendingNativeDestination(this.pendingNativeDestination, "explorer");
						await this.context.globalState.update("cedia.pendingNativeDestination", this.pendingNativeDestination);
						const windowFolder = workspacePath();
						const willReload = Boolean(cwd && windowFolder && resolve(windowFolder) !== resolve(cwd));
						const destination = persistDestinationAcrossReload(willReload, this.pendingNativeDestination);
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
						this.userPtys = [...this.userPtys, {
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
						if (!this.client || !this.state.session) {
							await vscode.window.showInformationMessage("Preview and artifacts open from a Cedia task. No file was executed.");
							return;
						}
						await showArtifacts(this.client, this.state.session.id, join(this.context.globalStorageUri.fsPath, "artifacts"));
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
		},

		async refreshReview(this: CediaTaskViewProviderApi): Promise<void> {
				const cwd = this.state.session?.cwd ?? this.state.project?.path ?? workspacePath() ?? "";
				if (!cwd) {
					this.review = emptyReview();
					this.reviewPorcelain = undefined;
					this.reviewCwdCache = undefined;
					this.postSnapshot();
					return;
				}
				if (this.reviewCwdCache !== cwd) {
					this.reviewPorcelain = undefined;
					this.reviewCwdCache = cwd;
				}
				try {
					// The host answers the same porcelain text this panel has always
					// classified, so `reviewFromGitStatus` and its staleness comparison
					// stay as they are; only the source of the text moved.
					const client = await this.ensureClient();
					const status = await requestGit(client, cwd, "porcelain", {});
					const next = reviewFromGitStatus(status.text, cwd);
					const selected = this.review.selectedPath
						? { selectedPath: this.review.selectedPath, hunks: this.review.hunks, diffError: this.review.diffError }
						: {};
					this.review = this.review.selectedPath && this.reviewPorcelain !== undefined && this.reviewPorcelain !== status.text
						? markReviewStale({ ...next, ...selected })
						: { ...next, ...selected };
					this.reviewPorcelain = status.text;
				} catch (error) {
					this.review = reviewFromGitStatus("", cwd, errorMessage(error));
					this.reviewPorcelain = undefined;
				}
				await this.applyDirtyConflict();
				this.setWorkResource("changes", this.review.stale ? "stale" : this.review.files.length ? "ready" : "unopened");
		},

		async refreshArtifacts(this: CediaTaskViewProviderApi): Promise<void> {
				if (!this.client || !this.state.session) {
					this.artifacts = [];
					this.artifactsError = "Open a running task to list immutable artifact receipts.";
					this.postSnapshot();
					return;
				}
				try {
					this.artifacts = await this.client.listArtifacts(this.state.session.id);
					this.artifactsError = undefined;
					const mapped = mapArtifactsForWebview(this.artifacts, this.lastGoodByName);
					this.lastGoodByName = mapped.lastGoodByName;
					const candidate = mapped.artifacts.find((item) => canInlinePreviewBytes(item.preview.kind, item.size, item) && !item.retainedLastGood)
						?? mapped.artifacts.find((item) => canInlinePreviewBytes(item.preview.kind, item.size, item));
					if (candidate && this.state.session) {
						try {
							const bytes = await downloadArtifact(this.client, this.state.session.id, candidate);
							const mime = inlinePreviewMime(candidate.preview.kind, candidate);
							this.inlinePreview = candidate.preview.kind === "text"
								? { sha256: candidate.sha256, kind: "text", text: bytes.toString("utf8").slice(0, 8_000) }
								: mime
									? { sha256: candidate.sha256, kind: candidate.preview.kind, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` }
									: undefined;
						} catch {
							this.inlinePreview = undefined;
						}
					} else {
						this.inlinePreview = undefined;
					}
				} catch (error) {
					this.artifactsError = errorMessage(error);
				}
				this.postSnapshot();
		},

		async refreshDevices(this: CediaTaskViewProviderApi): Promise<void> {
				try {
					const client = await this.ensureClient();
					this.devices = await client.listDevices();
					this.devicesError = undefined;
				} catch (error) {
					this.devicesError = errorMessage(error);
				}
				this.postSnapshot();
		},

		async pairDevice(this: CediaTaskViewProviderApi): Promise<void> {
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
		},

		async manageDevices(this: CediaTaskViewProviderApi): Promise<void> {
				const client = await this.ensureClient();
				const devices = (await client.listDevices()).filter(device => device.role !== "owner" && !device.revokedAt);
				const selected = await vscode.window.showQuickPick(devices.map(device => ({ label: device.name, description: "Revoke access", id: device.id })), { title: "Cedia devices" });
				if (selected) { await client.revokeDevice(selected.id); void vscode.window.showInformationMessage(`Revoked ${selected.label}`); }
		},

		async ompControls(this: CediaTaskViewProviderApi): Promise<void> {
				const selected = await vscode.window.showQuickPick(jsonPickerCommands(RPC_COMMAND_TYPES).map(command => ({ label: command })), { title: "OMP controls", placeHolder: "Run a control on the current OMP session" });
				if (!selected) return;
				const raw = await vscode.window.showInputBox({ title: `OMP: ${selected.label}`, prompt: "JSON parameters for this pinned OMP control", value: "{}", validateInput: value => { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? null : "Enter a JSON object"; } catch { return "Enter valid JSON"; } } });
				if (raw === undefined) return;
				await this.sendCommand(selected.label, JSON.parse(raw));
		},

		async ompSignIn(this: CediaTaskViewProviderApi): Promise<void> {
				const terminal = vscode.window.createTerminal({ name: "OMP sign-in (/login)" });
				terminal.show();
				terminal.sendText("omp");
		},

		async openCediaSettings(this: CediaTaskViewProviderApi): Promise<void> {
				await this.setWorkbenchMode("agents");
				await this.revealAgentSurface();
				this.post({ type: "open_settings", section: "Devices/connections" });
		},

		async taskActions(this: CediaTaskViewProviderApi): Promise<void> {
				const session = this.state.session;
				const chrome = moreMenuActions({
					hasSession: Boolean(session),
					pinned: session?.pinned,
					archived: session?.archived,
					recoveryRequired: session?.status === "recovery_required",
					hasParent: Boolean(this.parentSession),
					hasDraft: this.state.draft.trim().length > 0,
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
					if (!this.terminals.show(session.id, session.incarnation)) void vscode.window.showInformationMessage("This task has no interaction terminal yet.");
					return;
				}
				if (action.label === "Artifacts") {
					const client = await this.ensureClient();
					await showArtifacts(client, session.id, join(this.context.globalStorageUri.fsPath, "artifacts"));
				}
		},

		async runMoreAction(this: CediaTaskViewProviderApi, id: string): Promise<void> {
				const session = this.state.session;
				if (id === "open_ide_new_window") return this.setWorkbenchMode("ide", { newWindow: true });
				if (id === "mark_unread") { this.markedUnread = true; this.postSnapshot(); return; }
				if (id === "discard_draft") {
					const plan = discardDraftPlan({
						draft: this.state.draft,
						projectId: this.state.project?.id,
						sessionId: this.state.session?.id,
					});
					if (!plan.hasText) {
						await vscode.window.showInformationMessage("No draft on this view. Discard draft does not delete a session.");
						return;
					}
					const confirmed = await vscode.window.showWarningMessage(DISCARD_DRAFT_CONFIRM, { modal: true }, "Discard draft");
					if (!confirmed) return;
					this.draftPersistOk = false;
					this.state = reduceTaskState(this.state, { type: "draft", draft: "" });
					this.captureActivePaneDraft();
					try {
						await this.context.globalState.update("cedia.drafts", this.state.drafts);
						this.draftPersistOk = true;
					} catch {
						this.draftPersistOk = false;
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
					this.layout = maximizeActive(this.layout);
					this.persistLayout();
					this.postSnapshot();
					return;
				}
				if (id === "restore_layout") {
					this.layout = restoreLayout(this.layout);
					this.persistLayout();
					this.postSnapshot();
					return;
				}
				if (id === "move_left" || id === "move_right" || id === "move_up" || id === "move_down") {
					const direction = id.slice("move_".length) as "left" | "right" | "up" | "down";
					this.layout = moveActive(this.layout, direction);
					this.persistLayout();
					this.postSnapshot();
					return;
				}
				if (id === "maximize_area") {
					this.setState({ type: "work_panel", action: { type: "close_panel" } });
					return;
				}
				if (id === "fork") {
					if (!this.parentSession) {
						await vscode.window.showInformationMessage(FORK_NO_PARENT_REASON);
						return;
					}
					const forked = await this.requestOmp("new_session", { parentSession: this.parentSession });
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
		},

		async inspectOutcome(this: CediaTaskViewProviderApi): Promise<void> {
				const session = this.state.session;
				const unknown = Object.values(this.state.pendingCommands).filter(item => item.status === "unknown");
				const lines = [
					session ? `${session.title}\n${session.id}\nstatus ${session.status}` : "No task is open.",
					this.state.lastError ? `Last error: ${this.state.lastError}` : "",
					`Connection: ${this.state.connection}`,
					this.lastHostSyncAt ? `Last host sync: ${this.lastHostSyncAt}` : "Last host sync: never",
					unknown.length
						? `Unknown commands:\n${unknown.map(item => `${item.command} · ${item.commandId}`).join("\n")}`
						: "No unknown command receipts.",
					"Cedia will not repeat the old command. Inspect the workspace, then reconcile if the session requires review.",
				].filter(Boolean);
				const action = session?.status === "recovery_required" ? "Reconcile…" : undefined;
				const picked = await vscode.window.showInformationMessage(lines.join("\n\n"), { modal: true }, ...(action ? [action] : []));
				if (picked === "Reconcile…") await this.runMoreAction("reconcile");
		},

		sessionForMutation(this: CediaTaskViewProviderApi, sessionId?: string): Session | undefined {
				if (sessionId) {
					if (this.state.session?.id === sessionId) return this.state.session;
					return this.state.sessions.find(item => item.id === sessionId);
				}
				return this.state.session ?? undefined;
		},

		async patchListedSession(this: CediaTaskViewProviderApi, sessionId: string | undefined, apply: (session: Session, client: CediaHostClient) => Promise<void>): Promise<void> {
				const session = this.sessionForMutation(sessionId);
				if (!session) return;
				const client = await this.ensureClient();
				await apply(session, client);
				if (this.state.project) await this.loadProjectSessions(client, this.state.project);
		},

		async downloadArtifactCopy(this: CediaTaskViewProviderApi, sha256: string): Promise<void> {
				const receipt = this.artifacts.find(item => item.sha256 === sha256);
				if (!this.client || !this.state.session || !receipt) {
					await vscode.window.showInformationMessage("No artifact receipt to download.");
					return;
				}
				const bytes = await downloadArtifact(this.client, this.state.session.id, receipt);
				const target = await vscode.window.showSaveDialog({
					saveLabel: "Save artifact copy",
					defaultUri: vscode.Uri.file(receipt.name),
				});
				if (!target) return;
				await vscode.workspace.fs.writeFile(target, bytes);
		},

		async exportDiagnostics(this: CediaTaskViewProviderApi): Promise<void> {
				const target = await vscode.window.showSaveDialog({
					saveLabel: "Export redacted diagnostics",
					defaultUri: vscode.Uri.file("cedia-diagnostics.txt"),
				});
				if (!target) return;
				const body = redactedDiagnostics({
					connection: this.state.connection,
					sessionId: this.state.session?.id,
					projectId: this.state.project?.id,
					pending: Object.keys(this.state.pendingCommands).length,
					approvals: this.state.uiRequests.length,
					lastHostSyncAt: this.lastHostSyncAt,
					relayStatus: "unknown",
				});
				await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(body + "\n"));
				void vscode.window.showInformationMessage("Saved a redacted diagnostics file. Provider tokens were not included.");
		},

		prefill(this: CediaTaskViewProviderApi, text: string): void {
				this.post({ type: "prefill", text });
				this.focusComposer();
		},

		currentMentions(this: CediaTaskViewProviderApi): ReturnType<typeof mentionRows> {
				const selection = editorMentionContext();
				return mentionRows({
					query: this.search.scope === "files" ? this.search.query : "",
					sessions: this.state.sessions,
					files: this.search.hits.filter(hit => hit.scope === "files").map(hit => ({ path: hit.id })),
					artifacts: this.artifacts,
					hasSelection: selection.hasSelection,
					selectionPreview: selection.selectionPreview,
					uploadAdvertised: false,
				});
		},

};
