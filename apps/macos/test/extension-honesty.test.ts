import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ideLandingForWorkTab, REVIEW_NO_GIT_REASON } from "../src/review-snapshot.ts";
import { readProviderSources } from "./provider-sources.ts";

const src = readProviderSources(join(dirname(fileURLToPath(import.meta.url)), "../src"));
const manifest = JSON.parse(
	readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as {
	readonly contributes: {
		readonly commands: readonly { readonly command: string }[];
		readonly viewsContainers: Record<string, readonly { readonly id: string }[]>;
		readonly views: Record<string, readonly { readonly id: string; readonly type?: string }[]>;
		readonly menus: Record<string, readonly { readonly command: string; readonly when?: string }[]>;
		readonly keybindings: readonly { readonly command: string; readonly key?: string; readonly mac?: string; readonly when?: string }[];
	};
	readonly activationEvents: readonly string[];
};

describe("extension honesty leftovers", () => {
	it("opens Cedia settings on the Devices pairing section instead of native host paths", () => {
		expect(src).toContain('this.post({ type: "open_settings", section: "Devices/connections" })');
		expect(src).toContain('case "host_settings":');
		expect(src).toContain('workbench.action.openSettings", "@ext:cedia.cedia"');
	});

	it("surfaces pairing failure guidance and does not open SCM welcome", () => {
		expect(src).toContain("Cedia could not start iPhone pairing");
		expect(src).toContain("Cedia Settings → Devices");
		expect(src).toContain("ideLandingForWorkTab");
		expect(src).not.toContain("workbench.view.scm");
	});

	it("routes non-Git Review to a task-scoped IDE landing with an explanation", () => {
		expect(ideLandingForWorkTab("changes", { noGit: true })).toEqual({ view: "explorer", message: REVIEW_NO_GIT_REASON });
		expect(ideLandingForWorkTab("changes", { noGit: true, selectedPath: "notes.md" })).toEqual({ view: "file", path: "notes.md", message: REVIEW_NO_GIT_REASON });
	});
});

describe("ide-native workbench contributions", () => {
	it("docks the agent in the native secondary side bar next to the editor", () => {
		const containers = manifest.contributes.viewsContainers.secondarySidebar ?? [];
		expect(containers.map((entry) => entry.id)).toContain("cediaDock");
		const dockViews = manifest.contributes.views.cediaDock ?? [];
		expect(dockViews.map((entry) => entry.id)).toContain("cediaComposerDock");
		expect(dockViews.every((entry) => entry.type === "webview")).toBe(true);
		// The dock must activate on its own view, not only after the full window.
		expect(manifest.activationEvents).toContain("onView:cediaComposerDock");
	});

	it("registers the real editor-to-task commands and their menu entries", () => {
		const commands = manifest.contributes.commands.map((entry) => entry.command);
		expect(commands).toContain("cedia.addSelectionToTask");
		expect(commands).toContain("cedia.addFileToTask");
		const editorContext = manifest.contributes.menus["editor/context"] ?? [];
		expect(editorContext.map((entry) => entry.command)).toContain("cedia.addSelectionToTask");
		// Only offered when there is a real selection and a real task surface.
		const entry = editorContext.find((item) => item.command === "cedia.addSelectionToTask");
		expect(entry?.when).toContain("editorHasSelection");
		expect(entry?.when).toContain("cedia.taskAvailable");
		const titleMenu = manifest.contributes.menus["view/title"] ?? [];
		// The shared Agent header owns these actions; native view/title entries duplicate them.
		expect(titleMenu.some((item) => item.when?.includes("cediaComposerDock"))).toBe(false);
	});

	it("opens task changes in the real Code-OSS diff editor, not a mock diff", () => {
		// The original side is served by a registered content provider, and the
		// extension calls the real `vscode.diff` command.
		expect(src).toContain('vscode.workspace.registerTextDocumentContentProvider(NATIVE_DIFF_SCHEME, provider.diffContentProvider())');
		expect(src).toContain('await vscode.commands.executeCommand("vscode.diff", original, modified, plan.title, { preserveFocus: false });');
		// Binary files are refused rather than shown as a misleading text diff.
		expect(src).toContain("nativeDiffPlan({");
		expect(src).toContain("binary: file?.binaryHint === true");
		// The provider must not send an unvalidated ref to the host's revision
		// read: it hardens the ref itself, and no concern shells out any more.
		expect(src).toContain("rev: safeReviewRef(ref)");
		expect(src).not.toMatch(/execFile/);
		expect(src).not.toContain("`${safeRef}:${path}`");
		// Review must not initialize Git or write to disk.
		const diffProviderBody = src.slice(src.indexOf("diffContentProvider(this:"));
		expect(diffProviderBody.slice(0, diffProviderBody.indexOf("\n\t\t},"))).not.toContain("writeFile");
	});

	it("wires the selection mention and editor command to real cited context", () => {
		// The @ Selection row must not be a no-op.
		expect(src).toContain('else if (kind === "selection") await this.appendActiveEditorContext({ requireSelection: true, focus: false });');
		// The context block cites a real path and line range.
		expect(src).toContain("vscode.workspace.asRelativePath(targetUri, false)");
		expect(src).toContain("raw.length > MAX_SELECTION_CONTEXT_CHARS");
		// Adding context must not switch workbench mode or restart the OMP owner.
		expect(src).toContain("async appendActiveEditorContext");
		const body = src.slice(src.indexOf("async appendActiveEditorContext"));
		const appendBody = body.slice(0, body.indexOf("\n\n\t\t"));
		expect(appendBody).not.toContain("setWorkbenchMode");
		expect(appendBody).not.toContain("openAgentsWindow");
	});

	it("renders the status bar from real connection, run, and approval state", () => {
		expect(src).toContain("renderAgentsStatus(this:");
		expect(src).toContain("$(bell) Cedia ");
		expect(src).toContain("$(sync~spin) Cedia running");
		expect(src).toContain("$(debug-disconnect) Cedia offline");
		// The old static label must be gone.
		expect(src).not.toContain('this.agentsStatus.text = "$(comment-discussion) Agents"');
	});

	it("fans snapshots out to every resolved surface and keeps IDE layout on focus", () => {
		// Both the activity-bar view and the dock can be open at once.
		expect(src).toContain("post(this: CediaTaskViewProviderApi, message: unknown): void {");
		expect(src).toContain("this.views.targets().map(view => view.webview)");
		expect(src).toContain("view.onDidDispose(() => { this.views.remove(view); }");
		// A focus shortcut must not tear down the IDE chrome while in IDE mode.
		expect(src).toContain("async focusAgentSurface(this: CediaTaskViewProviderApi, message: unknown): Promise<void> {");
		const body = src.slice(src.indexOf("async focusAgentSurface"));
		const focusBody = body.slice(0, body.indexOf("\n\tprivate "));
		expect(focusBody).toContain('if (this.state.workbenchMode === "ide") {');
		expect(focusBody).toContain("await this.focusDock();");
	});

	it("never blocks the mode switch on cosmetic workbench appearance", () => {
		// Awaiting the appearance write used to hang setWorkbenchMode outright
		// (the workspace-scoped update can never settle before a folder is
		// attached), so the mode was never recorded and the dock was never
		// revealed. Appearance must stay fire-and-forget.
		expect(src).toContain("void this.applyWorkbenchAppearance(mode).catch(error => this.reportError(error));");
		expect(src).not.toContain("await this.applyWorkbenchAppearance(");
		// Every workspace-scoped write inside the appearance helper is guarded.
		const body = src.slice(src.indexOf("async applyWorkbenchAppearance"));
		const helper = body.slice(0, body.indexOf("\n\t/** Reveal the docked agent view"));
		expect(helper).toContain("await target.update(section, value, vscode.ConfigurationTarget.Workspace);");
		// The guard still swallows the failure so the mode switch proceeds; it
		// now also records the reason on the Cedia log channel, because a
		// silently swallowed write hid a stalled workspace for a whole session.
		expect(helper).toContain("} catch (error) {");
		expect(helper).toContain("this.log.debug(`workbench appearance skipped for ${section}: ${errorMessage(error)}`);");
	});

	it("reveals the docked container on the coexistence default", () => {
		expect(src).toContain('await vscode.commands.executeCommand("workbench.view.extension.cediaDock");');
		expect(src).toContain("if (!startup.revealDock) return;");
		// The workbench title update must not become an unhandled rejection.
		expect(src).toContain('.update("title", title, vscode.ConfigurationTarget.Workspace)');
		expect(src).toContain('.then(undefined, () => { /* title is cosmetic */ });');
	});

	it("wires inline edit to a real prompt on the guarded send path", () => {
		const commands = manifest.contributes.commands.map((entry) => entry.command);
		expect(commands).toContain("cedia.inlineEdit");
		// Reachable from the editor context menu and the palette.
		const editorContext = manifest.contributes.menus["editor/context"] ?? [];
		expect(editorContext.map((entry) => entry.command)).toContain("cedia.inlineEdit");
		// Real Cmd+K, scoped to a selection so it does not shadow plain Cmd+K chords.
		const bindings = manifest.contributes.keybindings;
		const kbd = bindings.find((entry) => entry.command === "cedia.inlineEdit");
		expect(kbd?.mac).toBe("cmd+k");
		expect(kbd?.when).toBe("editorTextFocus && editorHasSelection");
		// The command must require a real selection and dispatch a real turn.
		expect(src).toContain("async inlineEdit(this: CediaTaskViewProviderApi): Promise<void> {");
		const body = src.slice(src.indexOf("async inlineEdit(this: CediaTaskViewProviderApi): Promise<void> {"));
		const inlineBody = body.slice(0, body.indexOf("\n\t/**"));
		expect(inlineBody).toContain("editor.selection.isEmpty");
		expect(inlineBody).toContain('await this.sendCommand("prompt", { message: outgoing });');
		expect(inlineBody).toContain("vscode.window.showInputBox(");
		// No invented edit application: OMP stays the only execution owner.
		expect(inlineBody).not.toContain("WorkspaceEdit");
		expect(inlineBody).not.toContain("applyEdit");
		// The instruction must survive a refused send and must not clobber an
		// unsent draft.
		expect(inlineBody).toContain("const existingDraft = this.state.draft.trim();");
		expect(inlineBody).toContain("const outgoing = existingDraft ? `${existingDraft}\\n\\n${prompt}` : prompt;");
		expect(inlineBody.indexOf('{ type: "draft", draft: outgoing }')).toBeLessThan(inlineBody.indexOf("await this.sendCommand"));
	});

	it("surfaces Cedia in native editor and Source Control chrome", () => {
		// Visible editor title toolbar (not just the context menu).
		const editorTitle = manifest.contributes.menus["editor/title"] ?? [];
		expect(editorTitle.map((entry) => entry.command)).toContain("cedia.inlineEdit");
		expect(editorTitle.map((entry) => entry.command)).toContain("cedia.reviewInDiff");
		// Source Control title bar and per-file context menu.
		const scmTitle = manifest.contributes.menus["scm/title"] ?? [];
		expect(scmTitle.map((entry) => entry.command)).toContain("cedia.reviewInDiff");
		expect(scmTitle.map((entry) => entry.command)).toContain("cedia.showAgents");
		const scmContext = manifest.contributes.menus["scm/resourceState/context"] ?? [];
		expect(scmContext.map((entry) => entry.command)).toContain("cedia.addFileToTask");
		expect(scmContext.map((entry) => entry.command)).toContain("cedia.reviewInDiff");
		// Line-number gutter menu: native editor action surface.
		const gutter = manifest.contributes.menus["editor/lineNumber/context"] ?? [];
		expect(gutter.map((entry) => entry.command)).toContain("cedia.inlineEdit");
		expect(gutter.map((entry) => entry.command)).toContain("cedia.addSelectionToTask");
	});

	it("never declares a duplicate command id", () => {
		const ids = manifest.contributes.commands.map((entry) => entry.command);
		expect(new Set(ids).size).toBe(ids.length);
		// Every menu entry must point at a declared command.
		for (const entries of Object.values(manifest.contributes.menus)) {
			for (const entry of entries) expect(ids).toContain(entry.command);
		}
	});

	it("accepts the Source Control resource shape, not only a Uri", () => {
		// The SCM menus pass a resource state whose `resourceUri` is the file.
		expect(src).toContain("function commandResourceUri(value: unknown): vscode.Uri | undefined {");
		expect(src).toContain("const nested = candidate.resourceUri as { scheme?: unknown } | undefined;");
		expect(src).toContain("const resolved = commandResourceUri(resource);");
	});
});
