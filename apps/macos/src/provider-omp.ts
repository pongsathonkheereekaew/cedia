/** Item 66: OMP command dispatch and model state — slice of CediaTaskViewProvider.
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
import { attachmentCounts, errorMessage, asArray, workspacePath, normalizeProject, normalizeSession, normalizeModels, normalizeLoginProviders, commandId } from "./task-runtime.ts";

export const ompConcern: Partial<CediaTaskViewProviderApi> = {
		async ensureProject(this: CediaTaskViewProviderApi, client: CediaHostClient): Promise<Project> {
				if (this.state.project) return this.state.project;
				const path = workspacePath();
				if (!path) throw new Error("Open a folder before starting a Cedia task, or choose New task.");
				const projectsValue = await client.listProjects();
				const projects = asArray<unknown>(projectsValue, "projects").map(normalizeProject).filter((value): value is Project => value !== undefined);
				let project = projects.find(item => item.path === path);
				if (!project) project = await client.createProject(path, path.split(/[\\/]/).pop() || undefined);
				this.setState({ type: "projects", projects: projects.some(item => item.id === project!.id) ? projects : [...projects, project] });
				this.state = reduceTaskState(this.state, { type: "session", session: null });
				this.state = { ...this.state, project };
				this.postSnapshot();
				return project;
		},

		async ensureSession(this: CediaTaskViewProviderApi, client: CediaHostClient): Promise<Session> {
				const project = await this.ensureProject(client);
				if (this.state.session && this.state.session.projectId === project.id) {
					const session = normalizeSession(await client.startSession(this.state.session.id));
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
		},

		async requestOmp(this: CediaTaskViewProviderApi, command: string, payload: Record<string, Json> = {}): Promise<Command | undefined> {
				if (!this.state.session) return undefined;
				try {
					const client = await this.ensureClient();
					const session = this.state.session;
					return await client.sendCommand(session.id, { commandId: commandId(), incarnation: session.incarnation, command, payload });
				} catch (error) {
					// Refresh callers treat "no data" as a valid state, so this does not
					// throw; it must still be recoverable, and mutating callers check the
					// result with ompCommandConfirmed instead of assuming success.
					this.log.warn(`OMP ${command} failed: ${errorMessage(error)}`);
					return undefined;
				}
		},

		async refreshOmpState(this: CediaTaskViewProviderApi): Promise<void> {
				const result = await this.requestOmp("get_state");
				if (!ompCommandConfirmed(result)) return;
				const data = ompCommandData(result);
				this.thinking = thinkingFromOmpState(data);
				this.parentSession = parentSessionFromOmpState(data);
				this.ompPlan = planFromOmpState(data);
				// Item 63c: the guarded send reads `#state.selectedModel`, which nothing
				// in production ever set — so the "choose a model" refusal reached zero
				// views. Feed it from the same `get_state` answer that owns the runtime
				// model, so the guard and the runtime agree.
				const current = currentModelFromOmpState(data);
				if (current?.id && current.id !== this.state.selectedModel) {
					this.setState({ type: "models", models: this.state.models, selectedModel: current.id });
				}
				this.postSnapshot();
		},

		async loadOlderMessages(this: CediaTaskViewProviderApi): Promise<void> {
				const result = await this.requestOmp("get_messages_page", {
					limit: 20,
					...(this.messageCursor ? { cursor: this.messageCursor } : {}),
				});
				if (!ompCommandConfirmed(result)) {
					this.olderPagesAdvertised = false;
					this.historyNote = OLDER_PAGES_NOTE;
					this.postSnapshot();
					return;
				}
				const page = messagesPageFromOmp(ompCommandData(result));
				this.olderPagesAdvertised = page.advertised;
				this.olderPageCount = page.messages.length;
				this.messageCursor = page.nextCursor;
				this.historyNote = page.advertised
					? (page.messages.length
						? `OMP advertised ${page.messages.length} older messages. Host event pages stay forward-only until those events are journaled.`
						: OLDER_PAGES_NOTE)
					: OLDER_PAGES_NOTE;
				const entries = transcriptEntriesFromOmpMessages(page.messages);
				if (entries.length) this.setState({ type: "history_page", entries });
				else this.postSnapshot();
		},

		async selectThinkingLevel(this: CediaTaskViewProviderApi, level: string): Promise<void> {
				const allowed = this.thinking.options.some(item => item.id === level && item.enabled);
				if (!allowed) {
					await vscode.window.showInformationMessage(this.thinking.reason || THINKING_NOT_ADVERTISED);
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
		},

		async sendCommand(this: CediaTaskViewProviderApi, command: string, payload: Record<string, Json>): Promise<void> {
				const client = await this.ensureClient();
				const session = await this.ensureSession(client);
				if (command === "prompt" || command === "steer" || command === "follow_up") {
					if (!this.state.selectedModel) {
						// Item 63c: `refreshOmpState` feeds this from `get_state`, so reaching
						// here means OMP itself named no model — a warning the user can act
						// on, not a silent post into the dead webview shell.
						void vscode.window.showWarningMessage("Choose a model before sending. Cedia does not pick a billed fallback.");
						this.post({ type: "error", text: "Choose a model before sending. Cedia does not pick a billed fallback.", status: this.state.connection });
						return;
					}
					const counts = attachmentCounts(this.attachments);
					if (counts.attachmentsPending > 0 || counts.attachmentsFailed > 0) {
						this.post({ type: "error", text: "Remove unfinished attachments before sending. Cedia will not dispatch a draft that still has local or failed files.", status: this.state.connection });
						return;
					}
					const draft = typeof payload.message === "string" ? payload.message : "";
					const decision = shouldDispatch({
						lastFrozen: this.lastFrozen,
						inFlightCommandId: this.inFlightCommandId,
						next: {
							draftRevision: this.draftRevision,
							attachmentRefs: this.attachments.flatMap(item => item.contentRef ? [item.contentRef] : []),
							targetSession: session.id,
							intent: command === "follow_up" ? "follow_up" : command === "steer" ? "steer" : "send_prompt",
							draft,
						},
					});
					if (!decision.dispatch) return;
					this.lastFrozen = decision.envelope;
					this.inFlightCommandId = decision.envelope.commandId;
				}
				const id = this.inFlightCommandId && (command === "prompt" || command === "steer" || command === "follow_up") ? this.inFlightCommandId : commandId();
				this.setState({ type: "command_created", command: { commandId: id, incarnation: session.incarnation, command, payload } });
				this.setState({ type: "connection", status: "running", error: undefined });
				try {
					const result = await client.sendCommand(session.id, { commandId: id, incarnation: session.incarnation, command, payload });
					this.setState({ type: "command_result", command: result });
					if (this.inFlightCommandId === id) this.inFlightCommandId = undefined;
					if ((command === "prompt" || command === "steer" || command === "follow_up") && (result.status === "acknowledged" || result.status === "completed") && typeof payload.message === "string") {
						this.lastSentDraft = payload.message;
						void this.context.globalState.update("cedia.lastSentDraft", this.lastSentDraft);
						if (this.state.draft === payload.message) {
							this.setState({ type: "draft", draft: "" });
							void this.context.globalState.update("cedia.drafts", this.state.drafts);
						}
					}
					if (result.status === "outcome_unknown") this.setState({ type: "connection", status: "unknown", error: "Command outcome is unknown; inspect command status before retrying." });
					else await this.pullEvents();
				} catch (error) {
					if (this.inFlightCommandId === id) this.inFlightCommandId = undefined;
					this.setState({ type: "command_status", commandId: id, status: "unknown", error: errorMessage(error) });
					this.setState({ type: "connection", status: "unknown", error: `Command ${id} may have reached the host; it was not replayed.` });
					throw error;
				}
		},

		async answerUi(this: CediaTaskViewProviderApi, token: string, answer: string | boolean | readonly string[] | { cancelled: true; timedOut?: boolean }): Promise<void> {
				const pending = this.state.uiRequests.find(item => item.token === token);
				const sessionHint = this.state.session;
				if (pending && sessionHint) {
					const allowed = canAnswer(
						{
							token,
							sessionId: pending.sessionId ?? sessionHint.id,
							incarnation: pending.incarnation ?? sessionHint.incarnation,
							method: pending.request.method,
						},
						{ sessionId: sessionHint.id, incarnation: sessionHint.incarnation },
						this.answeredUi,
					);
					if (!allowed.ok) {
						void vscode.window.showWarningMessage(`Cedia rejected this answer (${allowed.reason}). The request was not sent.`);
						return;
					}
				}
				const client = await this.ensureClient();
				const session = await this.ensureSession(client);
				this.answeredUi.add(token);
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
		},

		async getModels(this: CediaTaskViewProviderApi): Promise<void> {
				const client = await this.ensureClient();
				const session = await this.ensureSession(client);
				const id = commandId();
				this.setState({ type: "command_created", command: { commandId: id, incarnation: session.incarnation, command: "get_available_models", payload: {} } });
					const result = await client.sendCommand(session.id, { commandId: id, incarnation: session.incarnation, command: "get_available_models", payload: {} });
				this.setState({ type: "command_result", command: result });
				const models = normalizeModels(result.result ?? result.ack);
				this.setState({ type: "models", models, selectedModel: this.state.selectedModel });
		},

		async getSlashCommands(this: CediaTaskViewProviderApi): Promise<void> {
				const client = await this.ensureClient();
				const session = await this.ensureSession(client);
				const id = commandId();
				this.setState({ type: "command_created", command: { commandId: id, incarnation: session.incarnation, command: "get_available_commands", payload: {} } });
				const result = await client.sendCommand(session.id, { commandId: id, incarnation: session.incarnation, command: "get_available_commands", payload: {} });
				this.setState({ type: "command_result", command: result });
				this.setState({ type: "slash_commands", commands: normalizeSlashCommands(result.result ?? result.ack) });
		},

		async getLoginProviders(this: CediaTaskViewProviderApi): Promise<void> {
				const client = await this.ensureClient();
				const session = await this.ensureSession(client);
				const id = commandId();
				this.setState({ type: "command_created", command: { commandId: id, incarnation: session.incarnation, command: "get_login_providers", payload: {} } });
				const result = await client.sendCommand(session.id, { commandId: id, incarnation: session.incarnation, command: "get_login_providers", payload: {} });
				this.setState({ type: "command_result", command: result });
				this.setState({ type: "login_providers", providers: normalizeLoginProviders(result.result ?? result.ack) });
		},

		async startLogin(this: CediaTaskViewProviderApi, providerId: string): Promise<void> {
				await this.sendCommand("login", { providerId });
				await this.getLoginProviders().catch(() => {});
				await this.pullEvents();
		},

		async openLoginUrl(this: CediaTaskViewProviderApi, url: string): Promise<void> {
				await vscode.env.openExternal(vscode.Uri.parse(url));
		},

		async selectModel(this: CediaTaskViewProviderApi, modelId: string, provider?: string): Promise<void> {
				const model = this.state.models.find(item => item.id === modelId);
				const actualProvider = provider ?? model?.provider;
				if (!actualProvider) throw new Error("Model provider is unavailable; refresh the model list first.");
				await this.sendCommand("set_model", { provider: actualProvider, modelId });
				this.setState({ type: "models", models: this.state.models, selectedModel: modelId });
		},

		async configureModelRoles(this: CediaTaskViewProviderApi): Promise<void> {
				try {
					const client = await this.ensureClient();
					const log = (message: string) => this.log.info(message);
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
		},

		async handleMessage(this: CediaTaskViewProviderApi, _message: unknown): Promise<void> {
				throw new Error("Cedia task shell was removed (item 63a)");
		},

		async selectDestination(this: CediaTaskViewProviderApi, id: string): Promise<void> {
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
		},

};
