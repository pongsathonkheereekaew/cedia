/** Item 66: Editor surface: selections, agent edits, lenses — slice of CediaTaskViewProvider.
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
import { AGENT_EDIT_DIFF_SCHEME, agentEditDiffTitle, decodeAgentEditDocId, decodeReviewDocId, encodeAgentEditDocId, encodeReviewDocId, looksBinary, NATIVE_DIFF_BINARY_REASON, NATIVE_DIFF_SCHEME, nativeDiffPlan, resolveReviewTarget, safeReviewRef } from "./native-diff.ts";
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
import { safeWorkspaceFile, errorMessage, workspacePath, commandId, MAX_SELECTION_CONTEXT_CHARS, requestGit, commandResourceUri, terminalSelectionOf } from "./task-runtime.ts";

export const editorConcern: Partial<CediaTaskViewProviderApi> = {
		codeActionsFor(this: CediaTaskViewProviderApi, document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
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
		},

		agentEditLensesFor(this: CediaTaskViewProviderApi, document: vscode.TextDocument): vscode.CodeLens[] {
				const pending = this.agentEdits.get(document.uri.toString());
				if (!pending) return [];
				const specs = agentEditLenses(pending);
				// The provider is called on every render, so only the first offer per file
				// is logged; it is the real-app proof that the engine asked for the lenses.
				const key = document.uri.toString();
				if (!this.agentEditLensLogged.has(key)) {
					this.agentEditLensLogged.add(key);
					this.log.info(`agent edit lenses offered path=${pending.path} decisions=${specs.length} line=${specs[0]?.line ?? 0}`);
				}
				return specs.map(spec => new vscode.CodeLens(
					new vscode.Range(new vscode.Position(spec.line, 0), new vscode.Position(spec.line, 0)),
					{ command: spec.command, title: spec.title },
				));
		},

		agentEditLensesProvider(this: CediaTaskViewProviderApi): vscode.CodeLensProvider {
				return {
					provideCodeLenses: (document: vscode.TextDocument) => this.agentEditLensesFor(document),
					onDidChangeCodeLenses: this.agentEditLensesChanged.event,
				};
		},

		agentEditDecorationType(this: CediaTaskViewProviderApi): vscode.TextEditorDecorationType {
				return this.agentEditDecorationHandle ??= vscode.window.createTextEditorDecorationType({
					borderColor: new vscode.ThemeColor("editorInfo.foreground"),
					borderStyle: "solid",
					borderWidth: "0 0 0 3px",
					backgroundColor: new vscode.ThemeColor("editor.wordHighlightStrongBackground"),
				});
		},

		refreshAgentEditMarks(this: CediaTaskViewProviderApi): void {
				const type = this.agentEditDecorationType();
				for (const editor of vscode.window.visibleTextEditors) {
					const pending = this.agentEdits.get(editor.document.uri.toString());
					if (!pending) { editor.setDecorations(type, []); continue; }
					editor.setDecorations(type, pending.ranges.map(range => this.agentEditDecoration(editor.document, range, pending)));
				}
				void vscode.commands.executeCommand("setContext", "cedia.agentEditPending", this.agentEdits.size > 0);
				// The lens list depends on this state, not on the document text, so the
				// engine's cached CodeLens result has to be invalidated explicitly.
				this.agentEditLensesChanged.fire();
		},

		agentEditDecoration(this: CediaTaskViewProviderApi, document: vscode.TextDocument, range: MarkRange, pending: PendingAgentEdit): vscode.DecorationOptions {
				const mark = decorationRange(document, range);
				return {
					range: new vscode.Range(
						new vscode.Position(mark.start.line, mark.start.character),
						new vscode.Position(mark.end.line, mark.end.character),
					),
					hoverMessage: decorationHover(pending.path),
				};
		},

		async keepAgentEdit(this: CediaTaskViewProviderApi): Promise<void> {
				const editor = vscode.window.activeTextEditor;
				const pending = editor ? this.agentEdits.get(editor.document.uri.toString()) : undefined;
				if (!editor || !pending) {
					await vscode.window.showInformationMessage("This file has no Cedia edit waiting. Cedia only marks edits it applied through the editor bridge.");
					return;
				}
				if (editor.document.isDirty && !await editor.document.save()) {
					await vscode.window.showInformationMessage("Cedia could not save the file, so the edit is still unsaved.");
					return;
				}
				this.forgetAgentEdit(editor.document.uri.toString(), `Cedia: kept the edit to ${pending.path}`);
		},

		async revertAgentEdit(this: CediaTaskViewProviderApi): Promise<void> {
				const editor = vscode.window.activeTextEditor;
				const pending = editor ? this.agentEdits.get(editor.document.uri.toString()) : undefined;
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
		},

		async reviewAgentEdit(this: CediaTaskViewProviderApi): Promise<void> {
				const editor = vscode.window.activeTextEditor;
				const pending = editor ? this.agentEdits.get(editor.document.uri.toString()) : undefined;
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
		},

		forgetAgentEdit(this: CediaTaskViewProviderApi, uri: string, message: string): void {
				this.agentEdits.delete(uri);
				this.agentEditLensLogged.delete(uri);
				this.refreshAgentEditMarks();
				void vscode.window.setStatusBarMessage(message, 4000);
		},

		async inlineEdit(this: CediaTaskViewProviderApi): Promise<void> {
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
				const existingDraft = this.state.draft.trim();
				const outgoing = existingDraft ? `${existingDraft}\n\n${prompt}` : prompt;
				this.draftRevision += 1;
				this.state = reduceTaskState(this.state, { type: "draft", draft: outgoing });
				this.captureActivePaneDraft();
				this.postSnapshot();
				await this.focusDock();
				await this.sendCommand("prompt", { message: outgoing });
				void this.context.globalState.update("cedia.drafts", this.state.drafts);
		},

		async addFileToTask(this: CediaTaskViewProviderApi, resource?: vscode.Uri): Promise<void> {
				const resolved = commandResourceUri(resource);
				const uri = resolved && resolved.scheme === "file" ? resolved : undefined;
				await this.appendActiveEditorContext({ requireSelection: false, focus: true, ...(uri ? { uri } : {}) });
		},

		async runSelectionAction(this: CediaTaskViewProviderApi, id: SelectionActionId): Promise<void> {
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
				const existingDraft = this.state.draft.trim();
				const outgoing = existingDraft ? `${existingDraft}\n\n${prompt}` : prompt;
				this.draftRevision += 1;
				this.state = reduceTaskState(this.state, { type: "draft", draft: outgoing });
				this.captureActivePaneDraft();
				this.postSnapshot();
				await this.focusDock();
				await this.sendCommand("prompt", { message: outgoing });
				void this.context.globalState.update("cedia.drafts", this.state.drafts);
		},

		async appendActiveEditorContext(this: CediaTaskViewProviderApi, opts: {
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
		},

		async appendContextBlock(this: CediaTaskViewProviderApi, block: string, citation: string, focus: boolean): Promise<boolean> {
				if (this.ideAppendContext && !this.inAgentsWindow()) {
					await this.ideAppendContext(block);
					void vscode.window.setStatusBarMessage(`Cedia: added ${citation}`, 3000);
					return true;
				}
				const existing = this.state.draft;
				const nextDraft = existing.trim().length === 0 ? `${block}\n` : `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
				this.draftRevision += 1;
				this.draftPersistOk = false;
				this.state = reduceTaskState(this.state, { type: "draft", draft: nextDraft });
				this.captureActivePaneDraft();
				this.postSnapshot();
				try {
					await this.context.globalState.update("cedia.drafts", this.state.drafts);
					this.draftPersistOk = true;
				} catch { /* The snapshot already carries the draft; persistence is best-effort here. */ }
				if (focus) {
					// Force-set the composer value even when it already holds focus.
					this.post({ type: "prefill", text: nextDraft });
					await this.focusDock();
				}
				void vscode.window.setStatusBarMessage(`Cedia: added ${citation}`, 3000);
				return true;
		},

		async addSelectionToTask(this: CediaTaskViewProviderApi): Promise<void> {
				await this.appendActiveEditorContext({ requireSelection: true, focus: true });
		},

		async addTerminalSelectionToTask(this: CediaTaskViewProviderApi): Promise<void> {
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
		},

		recordAgentEdit(this: CediaTaskViewProviderApi, summary: EditorAppliedSummary): void {
				if (this.disposed) return;
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
				this.agentEdits.set(summary.uri, pending);
				this.refreshAgentEditMarks();
				void vscode.window.setStatusBarMessage(`Cedia: ${agentEditLabel(pending.path, ranges)}`, 5000);
		},

		async reviewActiveFileInDiff(this: CediaTaskViewProviderApi, resource?: vscode.Uri): Promise<void> {
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
		},

		async openNativeDiff(this: CediaTaskViewProviderApi, path: string): Promise<void> {
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
				const file = this.review.files.find(item => item.path === path);
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
		},

		async reviewFile(this: CediaTaskViewProviderApi, path: string): Promise<void> {
				const cwd = this.state.session?.cwd ?? this.state.project?.path ?? workspacePath();
				if (!cwd) {
					this.review = { ...this.review, selectedPath: path, hunks: [], diffError: "Open a project before reviewing a file." };
					this.postSnapshot();
					return;
				}
				const resolved = safeWorkspaceFile(cwd, path);
				if (!resolved) {
					this.review = { ...this.review, selectedPath: path, hunks: [], diffError: "Cedia ignored a path outside this task workspace." };
					this.postSnapshot();
					return;
				}
				try {
					const client = await this.ensureClient();
					// Unstaged scope is what the hunk list has always shown: index vs
					// working tree, never against HEAD.
					const diff = await requestGit(client, cwd, "readWorkingTreeDiff", { scope: "unstaged", filePath: path });
					const hunks = parseUnifiedDiff(diff.patch);
					const binary = !hunks.length && await this.gitPathIsBinary(cwd, path);
					this.review = {
						...this.review,
						selectedPath: path,
						hunks,
						diffError: hunks.length
							? undefined
							: binary
								? NATIVE_DIFF_BINARY_REASON
								: "No unstaged hunks. Stage and commit stay in Code-OSS — Cedia does not invent a second Git owner.",
					};
				} catch (error) {
					this.review = { ...this.review, selectedPath: path, hunks: [], diffError: errorMessage(error) };
				}
				await this.applyDirtyConflict();
				this.postSnapshot();
		},

		async openWorkspaceFile(this: CediaTaskViewProviderApi, path: string): Promise<void> {
				const cwd = this.state.session?.cwd ?? this.state.project?.path ?? workspacePath();
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
		},

		async openMergeEditor(this: CediaTaskViewProviderApi, path: string): Promise<void> {
				const cwd = this.state.session?.cwd ?? this.state.project?.path ?? workspacePath();
				if (!cwd) {
					await vscode.window.showInformationMessage("Open a project before opening a merge editor.");
					return;
				}
				const resolved = safeWorkspaceFile(cwd, path);
				if (!resolved) {
					await vscode.window.showWarningMessage("Cedia ignored a path outside this task workspace.");
					return;
				}
				const selected = this.review.files.find(file => file.path === path);
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
		},

		reviewCwd(this: CediaTaskViewProviderApi): string | undefined {
				return this.state.session?.cwd ?? this.state.project?.path ?? workspacePath();
		},

		async gitOriginalText(this: CediaTaskViewProviderApi, cwd: string, ref: string, path: string): Promise<string> {
				try {
					// The ref is hardened here before it leaves the extension; the host
					// reads the revision and reports a missing path instead of failing.
					const client = await this.ensureClient();
					const original = await requestGit(client, cwd, "readFileAtRev", { filePath: path, rev: safeReviewRef(ref) });
					if (original.missing) return "";
					return looksBinary(original.contents) ? "" : original.contents;
				} catch {
					// No version of this path in the ref, or the host is unavailable.
					return "";
				}
		},

		async gitPathIsBinary(this: CediaTaskViewProviderApi, cwd: string, path: string): Promise<boolean> {
				try {
					const client = await this.ensureClient();
					const stats = await requestGit(client, cwd, "workingTreeDiffStats", { scope: "workingTree", filePath: path });
					return stats.files.some(file => file.path === path && file.binary);
				} catch {
					return false;
				}
		},

		diffContentProvider(this: CediaTaskViewProviderApi): vscode.TextDocumentContentProvider {
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
		},

		agentEditBeforeProvider(this: CediaTaskViewProviderApi): vscode.TextDocumentContentProvider {
				return {
					provideTextDocumentContent: (uri: vscode.Uri): string => {
						const documentUri = decodeAgentEditDocId(uri.toString());
						if (!documentUri) return "";
						return this.agentEdits.get(documentUri)?.textBefore ?? "";
					},
				};
		},

		async suggestSearchTerms(this: CediaTaskViewProviderApi, term: unknown): Promise<string[]> {
				if (typeof term !== "string" || term.trim().length === 0) return [];
				try {
					const response = await fetch(`${SUGGEST_ENDPOINT}${encodeURIComponent(term.trim())}`, {
						signal: AbortSignal.timeout(2000),
						headers: { accept: "application/json" },
					});
					if (!response.ok) return [];
					return parseSuggestionPayload(await response.text());
				} catch (error) {
					this.log.debug(`search suggestions unavailable: ${errorMessage(error)}`);
					return [];
				}
		},

		async applyDirtyConflict(this: CediaTaskViewProviderApi): Promise<void> {
				try {
					const inventory = await this.editor.inventory(false);
					this.review = markReviewDirtyConflict(
						this.review,
						inventory.documents.filter(item => item.dirty).map(item => item.path),
					);
				} catch {
					// Dirty inventory is additive honesty, not a second review owner.
				}
		},

		async pickMention(this: CediaTaskViewProviderApi, kind: "file" | "folder" | "selection" | "logs" | "artifacts" | "session", _id: string): Promise<void> {
				if (kind === "logs") this.setState({ type: "work_panel", action: { type: "open_tab", tab: "terminal" } });
				else if (kind === "selection") await this.appendActiveEditorContext({ requireSelection: true, focus: false });
		},

		currentSettingsRows(this: CediaTaskViewProviderApi): ReturnType<typeof bindSettingsCatalogRows> {
				const source = settingsSourcePath("global");
				return [
					...bindSettingsCatalogRows({ section: "Models/providers", models: this.state.models, source }),
					...bindSettingsCatalogRows({ section: "Agents/OMP", loginProviders: this.state.loginProviders, source }),
					...bindSettingsCatalogRows({ section: "Tools/MCP", source }),
					...bindSettingsCatalogRows({ section: "Skills/rules/hooks/commands", slashCommands: this.state.slashCommands, skills: skillsFromSlashCommands(this.state.slashCommands), source }),
				];
		},

		async pickAttachments(this: CediaTaskViewProviderApi): Promise<void> {
				const uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, openLabel: "Attach to Cedia" });
				if (!uris?.length) return;
				for (const uri of uris) {
					const id = commandId();
					const name = basename(uri.fsPath);
					if (alreadyAttached(this.attachments, { name })) {
						void vscode.window.showInformationMessage("Already attached. Cedia added another chip because you asked again.");
					}
					this.attachments = [...this.attachments, { id, name, mime: "application/octet-stream", state: "local" }];
					this.postSnapshot();
					this.attachments = this.attachments.map(item => item.id === id
						? { ...item, state: "failed", error: "Host file upload is not advertised. Remove this chip to send, or wait until OMP advertises an upload." }
						: item);
				}
				this.postSnapshot();
		},

};
