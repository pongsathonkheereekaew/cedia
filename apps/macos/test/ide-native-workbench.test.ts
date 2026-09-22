import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { CEDIA_LIGHT_WORKBENCH_COLORS, CEDIA_WORKBENCH_COLORS } from "../src/cedia-theme.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fireActiveColorThemeChange, installVscodeStub, resetVscodeStub, stubState, stubUri } from "./helpers/vscode-stub.ts";
import { readProviderSources } from "./provider-sources.ts";

/*
 * Behavioral coverage for the ide-native workbench surface.
 *
 * The other Mac tests assert that strings exist in `extension.ts`. This file
 * activates the real extension against a recorded `vscode` API and drives the
 * commands a Cursor-class IDE user reaches for, so "declared in the manifest"
 * cannot pass for "works". The host is deliberately unreachable:
 * `hostNodePath`/`hostScriptPath` are empty and the extension path carries no
 * `runtime/`, so `ConfiguredHostProcess.start()` throws before spawning and no
 * real host, OMP process, or user state directory is touched.
 */

const vscodeApi: any = installVscodeStub();

const tempRoot = mkdtempSync(join(tmpdir(), "cedia-ide-native-"));
// The fixture workbench is a real directory tree, and leaving one behind per run is how this
// file used to fill the temp directory with hundreds of stale copies.
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));
// The registered IDE provider loads its renderer from the extension package.
// Keep a tiny valid asset in the fixture so the activation-boundary test can
// exercise the ready/RPC handshake without depending on a packaged build.
mkdirSync(join(tempRoot, "extension", "agent-ui"), { recursive: true });
writeFileSync(join(tempRoot, "extension", "agent-ui", "ide.html"), "<!doctype html><html><head></head><body></body></html>");
const workspace = join(tempRoot, "workspace");
mkdirSync(join(workspace, "src"), { recursive: true });
const sourceFile = join(workspace, "src", "greet.ts");
const sourceText = 'export function hello(name: string) {\n  return "hi " + name;\n}\n';
const diskText = sourceText.replace('"hi "', '"hello "');
// A tracked binary file, committed clean first so the later edits below are
// unstaged changes on both files.
const binaryFile = join(workspace, "assets", "logo.png");
mkdirSync(join(workspace, "assets"), { recursive: true });
writeFileSync(binaryFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
writeFileSync(sourceFile, sourceText);
execFileSync("git", ["init", "-q"], { cwd: workspace });
execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: workspace });
execFileSync("git", ["config", "user.name", "t"], { cwd: workspace });
execFileSync("git", ["add", "-A"], { cwd: workspace });
execFileSync("git", ["commit", "-qm", "init"], { cwd: workspace });
// Leave unstaged changes so the review path has something real to open: a text
// hunk in greet.ts and a byte change in the binary file.
writeFileSync(sourceFile, diskText);
writeFileSync(binaryFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x04, 0x05, 0x06]));
const headText = execFileSync("git", ["-C", workspace, "show", "HEAD:src/greet.ts"], { encoding: "utf8" });

// A text file that is new and untracked: the diff must read as all-added from
// an empty original rather than Cedia inventing an original.
const untrackedFile = join(workspace, "src", "new-file.ts");
writeFileSync(untrackedFile, "export const fresh = true;\n");

stubState.workspaceRoot = workspace;
stubState.documents.set(sourceFile, { text: diskText, languageId: "typescript" });
stubState.config.set("cedia.hostStateDir", join(tempRoot, "hostState"));
stubState.config.set("cedia.hostNodePath", "");
stubState.config.set("cedia.hostScriptPath", "");

const extension: any = await import("../src/extension.ts");

/**
 * The activation path now registers CediaIdeAgentProvider for the dock. The
 * editor/controller behavior below still belongs to CediaTaskViewProvider, so
 * those tests drive an explicit controller instance instead of treating the
 * IDE webview as if it were the retired task-shell webview.
 */
let legacyController: any | undefined;
let legacyView: any | undefined;

function context(): any {
	return {
		extensionPath: join(tempRoot, "extension"),
		extensionUri: stubUri(`file://${join(tempRoot, "extension")}`),
		globalStorageUri: stubUri(`file://${join(tempRoot, "globalStorage", "cedia.cedia")}`),
		storageUri: stubUri(`file://${join(tempRoot, "workspaceStorage")}`),
		subscriptions: [],
		globalState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {}, keys: () => [] },
		workspaceState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {}, keys: () => [] },
		extension: { id: "cedia.cedia", packageJSON: { name: "cedia", publisher: "cedia", version: "0.1.0" } },
	};
}

/** Workbench appearance keys the extension writes. `resetVscodeStub` keeps the
 * config map (files set it once before the first activation), so a test would
 * otherwise start from whatever the previous test's mode switch left behind -
 * and the IDE snapshot is captured *from* these keys, so stale values leak into
 * the restored layout. Clearing them models a fresh window. */
const APPEARANCE_KEYS = [
	"workbench.activityBar.location",
	"workbench.statusBar.visible",
	"workbench.editor.showTabs",
	"workbench.editor.editorActionsLocation",
	"workbench.layoutControl.enabled",
	"workbench.colorCustomizations",
	"window.commandCenter",
	"window.title",
	"window.autoDetectColorScheme",
	"breadcrumbs.enabled",
];

async function activateAndSettle(themeKind = 2, rejectWorkspaceWrites = false, workspaceFileUri: any = undefined, installedExtensions: any[] = []): Promise<void> {
	legacyController?.dispose();
	legacyController = undefined;
	legacyView = undefined;
	resetVscodeStub();
	// After the reset, which clears the installed list along with the recordings.
	stubState.installedExtensions.push(...installedExtensions);
	stubState.workspaceFileUri = workspaceFileUri;
	// resetVscodeStub returns the theme to dark; callers that need light set it
	// here so the activation reads the intended kind.
	stubState.themeKind = themeKind;
	// The default Agents window can open with no folder attached, where
	// workspace-scope writes reject.
	stubState.rejectWorkspaceWrites = rejectWorkspaceWrites;
	for (const key of APPEARANCE_KEYS) stubState.config.delete(key);
	extension.activate(context());
	await new Promise(resolve => setTimeout(resolve, 60));
}

interface WebviewHarness {
	view: any;
	receive(message: unknown): Promise<unknown>;
}

function createWebviewHarness(): WebviewHarness {
	let receiver: ((message: unknown) => unknown) | undefined;
	const webview = {
		html: "",
		options: {},
		cspSource: "",
		asWebviewUri: (uri: unknown) => uri,
		postMessage: async (message: unknown) => {
			stubState.posted.push(message);
			return true;
		},
		onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
			receiver = listener;
			return { dispose() {} };
		},
	};
	return {
		view: {
			webview,
			onDidDispose: () => ({ dispose() {} }),
			onDidChangeVisibility: () => ({ dispose() {} }),
			show() {},
		},
		receive: async (message: unknown) => receiver?.(message),
	};
}

function bindLegacyControllerCommands(controller: any): void {
	// Keep the command assertions pointed at the controller under test. The
	// activation's commands remain the production boundary and are exercised by
	// the explicit IDE bridge test below and by the native smoke test.
	stubState.commands.set("cedia.addSelectionToTask", () => controller.addSelectionToTask());
	stubState.commands.set("cedia.addTerminalSelectionToTask", () => controller.addTerminalSelectionToTask());
	stubState.commands.set("cedia.explainSelection", () => controller.runSelectionAction("explain"));
	stubState.commands.set("cedia.fixSelection", () => controller.runSelectionAction("fix"));
	stubState.commands.set("cedia.showDiff", () => controller.nativeAction("diff"));
	stubState.commands.set("cedia.keepAgentEdit", () => controller.keepAgentEdit());
	stubState.commands.set("cedia.revertAgentEdit", () => controller.revertAgentEdit());
	stubState.commands.set("cedia.reviewAgentEdit", () => controller.reviewAgentEdit());
	stubState.commands.set("cedia.inlineEdit", () => controller.inlineEdit());
	stubState.commands.set("cedia.addFileToTask", (resource?: unknown) => controller.addFileToTask(resource));
}

function ensureLegacyController(): any {
	if (legacyController) return legacyController;
	legacyController = new extension.CediaTaskViewProvider(context());
	// The activation-owned provider registered these before the explicit
	// controller exists. Replace the recordings for the controller-focused
	// tests so diff content and lens decisions come from the same instance.
	stubState.contentProviders.set("cedia-agent-edit", legacyController.agentEditBeforeProvider());
	stubState.codeActions.length = 0;
	stubState.codeLenses.length = 0;
	// Activation registers these providers for the production controller. Add
	// equivalent registrations for the explicit controller so edit/lens tests
	// observe the same public behavior without reaching into private fields.
	stubState.codeActions.push({
		selector: "*",
		provider: { provideCodeActions: (document: any, range: any) => legacyController.codeActionsFor(document, range) },
		metadata: { providedCodeActionKinds: [vscodeApi.CodeActionKind?.QuickFix] },
	});
	stubState.codeLenses.push({
		selector: { scheme: "file" },
		provider: legacyController.agentEditLensesProvider(),
	});
	return legacyController;
}

/** The review surfaces read Git through the host (item 58), and this harness has
 * no reachable host.  Point the controller's review command and content provider
 * at a client that answers the git routes, and hand back the recorded calls so
 * the request itself can be asserted. */
function bindReviewSurface(answers: Record<string, unknown>): { method: string; input: unknown }[] {
	const controller = ensureLegacyController();
	const calls: { method: string; input: unknown }[] = [];
	controller.client = {
		health: async () => ({ protocolVersion: 1 }),
		requestApplication: async (method: string, route: string, body?: unknown) => {
			if (!body || typeof body !== "object" || !("method" in body) || typeof body.method !== "string") {
				throw new Error(`not a git request: ${JSON.stringify(body)}`);
			}
			calls.push({ method: body.method, input: "input" in body ? body.input : undefined });
			const answer = answers[body.method];
			if (answer === undefined) throw new Error(`unexpected git call ${body.method} over ${route}`);
			return answer;
		},
	};
	stubState.contentProviders.set("cedia-review", controller.diffContentProvider());
	stubState.commands.set("cedia.reviewInDiff", (resource?: unknown) => controller.reviewActiveFileInDiff(resource));
	return calls;
}

/** Resolve the controller's task webview explicitly. The registered dock view
 * is a CediaIdeAgentProvider now and intentionally has no task snapshot API. */
function resolveViews(): void {
	const controller = ensureLegacyController();
	if (!legacyView) {
		legacyView = createWebviewHarness().view;
		controller.resolveWebviewView(legacyView);
	}
	bindLegacyControllerCommands(controller);
}

/** Resolve the actual registered IDE dock and return its message receiver. */
async function resolveIdeView(): Promise<WebviewHarness> {
	const entry = stubState.views.find(view => view.id === "cediaComposerDock");
	if (!entry) throw new Error("cediaComposerDock was not registered");
	const harness = createWebviewHarness();
	await entry.provider.resolveWebviewView(harness.view);
	return harness;
}

/** The editor holds the current buffer, which may be unsaved: this is the text
 * an IDE-native citation must quote, not the file on disk. */
function openEditor(startLine: number, endLine: number): void {
	const lines = sourceText.split("\n");
	stubState.activeEditor = {
		document: {
			uri: stubUri(`file://${sourceFile}`),
			fileName: sourceFile,
			languageId: "typescript",
			getText: (range?: any) => (range ? lines.slice(range.start.line, range.end.line + 1).join("\n") : sourceText),
		},
		selection: {
			isEmpty: false,
			start: { line: startLine, character: 0 },
			end: { line: endLine, character: lines[endLine]!.length },
		},
	};
}

/** An editor holding a buffer that Cedia just edited through the bridge: the
 * shape `recordAgentEdit` and the decoration helpers read off a real editor. */
function agentEditedEditor(version: number, text: string, onSave: () => void): any {
	const lines = text.split("\n");
	return {
		document: {
			uri: stubUri(`file://${sourceFile}`),
			fileName: sourceFile,
			languageId: "typescript",
			version,
			isDirty: true,
			lineCount: lines.length,
			lineAt: (line: number) => ({ range: { end: { line, character: (lines[line] ?? "").length } } }),
			getText: () => text,
			positionAt: (offset: number) => ({ line: 0, character: offset }),
			save: async () => { onSave(); return true; },
		},
		selection: { isEmpty: true, start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
		setDecorations: (type: unknown, ranges: unknown[]) => { stubState.decorations.push({ type, ranges }); },
	};
}

/** The provider is registered with the stub as a webview view provider, so the
 * editor-bridge entry point can be driven the way the bridge drives it. */
function provider(): any {
	return ensureLegacyController();
}

const appliedEditSummary = {
	path: sourceFile,
	uri: `file://${sourceFile}`,
	requestId: "cedia-edit-1",
	version: 2,
	textBefore: sourceText,
	edits: [{ range: { start: { line: 1, character: 9 }, end: { line: 1, character: 15 } }, text: "hello" }],
};

function lastSnapshotDraft(): string {
	// Item 63a: the snapshot post is gone with the task shell — read the draft
	// from the controller's live state instead of a posted message.
	if (legacyController) {
		try {
			const state = (legacyController as { getStateForTest?: () => { draft?: string } }).getStateForTest?.();
			if (typeof state?.draft === "string") return state.draft;
		} catch { /* fall through to the posted-message scan */ }
	}
	for (const message of [...stubState.posted].reverse()) {
		const value = message as { type?: string; state?: { draft?: string } };
		if (value?.type === "snapshot" && typeof value.state?.draft === "string") return value.state.draft;
	}
	return "";
}

function prefills(): string[] {
	return stubState.posted
		.filter((message): message is { type: string; text: string } => (message as { type?: string }).type === "prefill")
		.map(message => message.text);
}

describe("ide-native workbench surface", () => {
	it("registers the editor, selection, review, and mode commands as real handlers", async () => {
		await activateAndSettle();
		for (const id of [
			"cedia.inlineEdit",
			"cedia.addSelectionToTask",
			"cedia.addFileToTask",
			"cedia.reviewInDiff",
			"cedia.showAgents",
			"cedia.showIde",
			"cedia.showDiff",
			"cedia.openTerminal",
			"cedia.reviewAgentEdit",
		]) {
			expect(typeof stubState.commands.get(id)).toBe("function");
		}
		// One agent surface per window: the dock. The full-page shell view is retired.
		expect(stubState.views.map(view => view.id)).toEqual(["cediaComposerDock"]);
		expect(stubState.contentProviders.has("cedia-review")).toBe(true);
		expect(stubState.contentProviders.has("cedia-agent-edit")).toBe(true);
	});
	it("routes an editor citation through the registered IDE agent bridge", async () => {
		await activateAndSettle();
		const ide = await resolveIdeView();
		await ide.receive({ type: "cedia-agent-ready" });
		openEditor(0, 1);
		await stubState.commands.get("cedia.addSelectionToTask")!();

		const action = [...stubState.posted].reverse().find((message): message is { type: string; action: string; text: string } => {
			const value = message as { type?: string; action?: string; text?: string };
			return value.type === "cedia-agent-action" && value.action === "appendContext";
		});
		expect(action).toBeDefined();
		expect(action!.text).toContain("src/greet.ts#L1-L2");
		expect(action!.text).toContain('return "hi " + name;');
	});
	it("registers a real handler for every command the manifest declares", async () => {
		await activateAndSettle();
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			contributes: {
				commands: { command: string }[];
				menus: Record<string, { command: string }[]>;
			};
		};
		// A declared command with no handler is a palette entry that does
		// nothing: it appears, the user picks it, and no error is raised.
		const declared = manifest.contributes.commands.map(entry => entry.command);
		expect(declared.length).toBeGreaterThan(20);
		expect(declared.filter(id => typeof stubState.commands.get(id) !== "function")).toEqual([]);
		// Every menu entry must be wired to a command that is actually
		// registered, not merely declared, or the menu item is inert.
		const menuCommands = [...new Set(Object.values(manifest.contributes.menus).flat().map(entry => entry.command))];
		expect(menuCommands.length).toBeGreaterThan(5);
		for (const id of menuCommands) expect(`${id}: ${typeof stubState.commands.get(id)}`).toBe(`${id}: function`);
	});
	it("opens a plain IDE window on full chrome by default, keeping agents in their own window", async () => {
		await activateAndSettle();
		const startup = stubState.executed.map(entry => entry.id);
		// Native world (plan section 2): a plain window is an IDE window, so
		// startup must not strip Code-OSS chrome. The agent lives in the base
		// sessions window opened via cedia.showAgents.
		expect(startup).not.toContain("workbench.action.closeSidebar");
		expect(startup).not.toContain("workbench.action.activityBarLocation.hide");
		expect(stubState.config.get("workbench.activityBar.location")).not.toBe("hidden");
		expect(stubState.config.get("workbench.statusBar.visible")).not.toBe(false);
		expect(stubState.config.get("workbench.editor.showTabs")).not.toBe("none");

		// ...and showIde is a safe no-op when the chrome was never stripped.
		stubState.executed.length = 0;
		await stubState.commands.get("cedia.showIde")!();
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(stubState.executed.map(entry => entry.id)).not.toContain("workbench.action.closeSidebar");
		expect(stubState.config.get("workbench.activityBar.location")).not.toBe("hidden");
		expect(stubState.config.get("workbench.statusBar.visible")).not.toBe(false);
	});
	it("keeps the user's own theme in the Agents window instead of painting its own", async () => {
		// The editor and the agent window are the same application, so one theme is
		// what a user expects in both. Cedia's own palette here made the editor look
		// like it changed colour when it switched modes.
		await activateAndSettle();
		expect(stubState.config.get("workbench.colorCustomizations")).toBeUndefined();
		expect(stubState.globalConfig.get("workbench.colorCustomizations")).toBeUndefined();
	});
	it("leaves chrome colours alone when the user set their own", async () => {
		// The user's own palette sits at the global scope. Cedia must not answer
		// with its own palette, and must not touch what the user wrote.
		stubState.globalConfig.set("workbench.colorCustomizations", { "editor.background": "#101010" });
		await activateAndSettle();
		expect(stubState.config.get("workbench.colorCustomizations")).toBeUndefined();
		expect(stubState.globalConfig.get("workbench.colorCustomizations")).toEqual({ "editor.background": "#101010" });
		stubState.globalConfig.delete("workbench.colorCustomizations");
	});
	it("leaves the theme alone when the theme kind changes", async () => {
		// A theme switch repaints the workbench; Cedia adds nothing on top of it, so
		// the light/dark/high-contrast theme the user picked is the one that shows.
		await activateAndSettle();
		fireActiveColorThemeChange(1);
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(stubState.config.get("workbench.colorCustomizations")).toBeUndefined();
		fireActiveColorThemeChange(2);
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(stubState.config.get("workbench.colorCustomizations")).toBeUndefined();
		expect(stubState.globalConfig.get("workbench.colorCustomizations")).toBeUndefined();
	});
	it("follows the OS light/dark setting the way the reference does", async () => {
		// Cursor ships window.autoDetectColorScheme on, so its chrome follows
		// the desktop. Without this Cedia's light palette is unreachable.
		await activateAndSettle();
		expect(stubState.config.get("window.autoDetectColorScheme")).toBe(true);
	});
	it("leaves the OS theme-following choice alone when the user set it", async () => {
		stubState.globalConfig.set("window.autoDetectColorScheme", false);
		await activateAndSettle();
		expect(stubState.config.get("window.autoDetectColorScheme")).toBeUndefined();
		stubState.globalConfig.delete("window.autoDetectColorScheme");
	});
	it("clears the palette Cedia itself wrote, at the scope it wrote it", async () => {
		// Older builds wrote Cedia's palette; leaving it behind would keep the window
		// wearing colours the user never chose. The check is Cedia's whole signature,
		// so a user's own customisations are not mistaken for it.
		stubState.config.set("workbench.colorCustomizations", { ...CEDIA_WORKBENCH_COLORS });
		await activateAndSettle();
		expect(stubState.config.get("workbench.colorCustomizations")).toBeUndefined();
	});
	it("clears Cedia's own palette from a folderless window's global scope", async () => {
		// This first screen can only write at global scope, which is where the
		// footprint of an older build lives.
		stubState.globalConfig.set("workbench.colorCustomizations", { ...CEDIA_WORKBENCH_COLORS });
		await activateAndSettle(2, true);
		expect(stubState.globalConfig.get("workbench.colorCustomizations")).toBeUndefined();
	});
	it("cites the real editor selection into the task draft", async () => {
		await activateAndSettle();
		resolveViews();
		openEditor(0, 1);
		await stubState.commands.get("cedia.addSelectionToTask")!();
		const draft = lastSnapshotDraft();
		expect(draft).toContain("src/greet.ts#L1-L2");
		// The cited body is the unsaved buffer, not the file on disk.
		expect(draft).toContain('return "hi " + name;');
		expect(draft).not.toContain('"hello "');
		expect(prefills().at(-1)).toContain("src/greet.ts#L1-L2");
		expect(stubState.statusMessages.some(message => message.includes("src/greet.ts#L1-L2"))).toBe(true);
	});
	it("brings the agent dock forward with the real view focus command", async () => {
		await activateAndSettle();
		resolveViews();
		openEditor(0, 1);
		stubState.executed.length = 0;
		await stubState.commands.get("cedia.addSelectionToTask")!();
		const commands = stubState.executed.map(entry => entry.id);
		// `cediaDock` is the container, which registers no focus command; the view
		// is `cediaComposerDock`, so that is what can actually be focused.
		expect(commands).toContain("cediaComposerDock.focus");
		expect(commands).not.toContain("cediaDock.focus");
	});
	it("cites a whole file when the Explorer passes a resource", async () => {
		await activateAndSettle();
		resolveViews();
		await stubState.commands.get("cedia.addFileToTask")!(stubUri(`file://${sourceFile}`));
		const draft = lastSnapshotDraft();
		// No editor selection: the whole file is cited, not an invented range.
		expect(draft).toContain("src/greet.ts#L1-L4");
		expect(draft).toContain("export function hello(name: string) {");
	});
	it("keeps an inline edit instruction when the host is unreachable", async () => {
		await activateAndSettle();
		resolveViews();
		openEditor(1, 1);
		vscodeApi.window.showInputBox = async () => "add a retry with backoff";
		await expect(stubState.commands.get("cedia.inlineEdit")!()).rejects.toBeDefined();
		// The promise rejects because dispatch needs the host, but the user's
		// instruction and the selection citation must already be in the draft.
		const draft = lastSnapshotDraft();
		expect(draft).toContain("Edit src/greet.ts#L2: add a retry with backoff");
		expect(draft).toContain('return "hi " + name;');
	});
	it("opens the review in the native diff editor with the Git original", async () => {
		await activateAndSettle();
		const calls = bindReviewSurface({
			workingTreeDiffStats: { additions: 1, deletions: 1, fileCount: 1, files: [{ path: "src/greet.ts", insertions: 1, deletions: 1, binary: false }] },
			readWorkingTreeDiff: { patch: "", truncated: false },
			readFileAtRev: { contents: headText, resolvedRev: "HEAD", missing: false, truncated: false },
		});
		await stubState.commands.get("cedia.reviewInDiff")!(stubUri(`file://${sourceFile}`));
		const diff = stubState.executed.find(entry => entry.id === "vscode.diff");
		expect(diff).toBeDefined();
		const original = diff!.args[0] as { toString(): string };
		expect(original.toString()).toBe("cedia-review:/HEAD/src/greet.ts");
		expect(diff!.args[1]).toMatchObject({ scheme: "file", fsPath: sourceFile });
		const provider = stubState.contentProviders.get("cedia-review")!;
		await expect(provider.provideTextDocumentContent(original)).resolves.toBe(headText);
		// Every read came from the host, each naming the file the diff is about.
		expect(calls).toContainEqual({ method: "readWorkingTreeDiff", input: { scope: "unstaged", filePath: "src/greet.ts" } });
		expect(calls).toContainEqual({ method: "workingTreeDiffStats", input: { scope: "workingTree", filePath: "src/greet.ts" } });
		expect(calls).toContainEqual({ method: "readFileAtRev", input: { filePath: "src/greet.ts", rev: "HEAD" } });
	});
	it("renders a real status bar item that opens the task", async () => {
		await activateAndSettle();
		resolveViews();
		// refresh() reaches the host asynchronously; wait for the failure to land
		// before reading the rendered state.
		await new Promise(resolve => setTimeout(resolve, 80));
		const item = stubState.statusItems.at(-1)!;
		expect(item.command).toBe("cedia.showAgents");
		expect(item.visible).toBe(true);
		// The host is unreachable in this harness, so the item must say so
		// instead of advertising a connection Cedia does not have.
		expect(item.text).toContain("Cedia");
		expect(item.text).toContain("offline");
		expect(item.tooltip).toContain("not reachable");
	});
	it("opens a real terminal for the terminal action", async () => {
		await activateAndSettle();
		await stubState.commands.get("cedia.openTerminal")!();
		const terminal = stubState.terminals.at(-1);
		expect(terminal).toBeDefined();
		// A real Code-OSS terminal is created and revealed, not a webview stand-in.
		expect(terminal!.showCount).toBeGreaterThan(0);
		expect(terminal!.disposed).toBe(false);
	});
	it("opens an omp terminal for provider sign-in without touching task state", async () => {
		await activateAndSettle();
		await stubState.commands.get("cedia.ompSignIn")!();
		const terminal = stubState.terminals.at(-1);
		expect(terminal).toBeDefined();
		expect(terminal!.name).toContain("OMP sign-in");
		expect(terminal!.showCount).toBeGreaterThan(0);
		// Plain `omp` on purpose: inherited environment means the same
		// credential store the user's own terminal logins and the host read.
		expect(terminal!.sentText).toEqual(["omp"]);
	});
	it("reveals the Explorer and keeps IDE chrome for the Files action", async () => {
		await activateAndSettle();
		stubState.executed.length = 0;
		await stubState.commands.get("cedia.openFiles")!();
		// The chrome writes are deliberately not awaited by the mode switch (a
		// stalled settings write must not hang it), so let them land.
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(stubState.executed.map(entry => entry.id)).toContain("workbench.view.explorer");
		// The Files action is a native navigation, not a chrome replacement.
		expect(stubState.config.get("workbench.activityBar.location")).toBe("default");
		expect(stubState.config.get("workbench.statusBar.visible")).toBe(true);
		expect(stubState.config.get("workbench.editor.showTabs")).toBe("multiple");
	});
	it("refuses a binary file instead of opening a text diff of bytes", async () => {
		await activateAndSettle();
		const calls = bindReviewSurface({
			workingTreeDiffStats: { additions: 0, deletions: 0, fileCount: 1, files: [{ path: "assets/logo.png", insertions: 0, deletions: 0, binary: true }] },
			readWorkingTreeDiff: { patch: "", truncated: false },
		});
		await stubState.commands.get("cedia.reviewInDiff")!(stubUri(`file://${binaryFile}`));
		// Honesty: the host reports this path as binary, so no diff editor may open.
		expect(stubState.executed.some(entry => entry.id === "vscode.diff")).toBe(false);
		expect(stubState.statusMessages.some(message => message.toLowerCase().includes("binary"))).toBe(true);
		// The refusal came from the host's per-file binary flag, not from a guess.
		expect(calls).toContainEqual({ method: "readWorkingTreeDiff", input: { scope: "unstaged", filePath: "assets/logo.png" } });
		expect(calls).toContainEqual({ method: "workingTreeDiffStats", input: { scope: "workingTree", filePath: "assets/logo.png" } });
	});
	it("opens an untracked text file as all-added from an empty original", async () => {
		await activateAndSettle();
		const calls = bindReviewSurface({
			workingTreeDiffStats: { additions: 1, deletions: 0, fileCount: 1, files: [{ path: "src/new-file.ts", insertions: 1, deletions: 0, binary: false }] },
			readWorkingTreeDiff: { patch: "", truncated: false },
			readFileAtRev: { contents: "", resolvedRev: "HEAD", missing: true, truncated: false },
		});
		await stubState.commands.get("cedia.reviewInDiff")!(stubUri(`file://${untrackedFile}`));
		const diff = stubState.executed.find(entry => entry.id === "vscode.diff");
		expect(diff).toBeDefined();
		const provider = stubState.contentProviders.get("cedia-review")!;
		// The host reports no version of this path at HEAD, so the left side stays
		// empty instead of Cedia inventing content for it.
		await expect(provider.provideTextDocumentContent(diff!.args[0])).resolves.toBe("");
		expect(calls).toContainEqual({ method: "readFileAtRev", input: { filePath: "src/new-file.ts", rev: "HEAD" } });
	});
	it("reads the Changes list from the host's porcelain text", async () => {
		await activateAndSettle();
		const calls = bindReviewSurface({ porcelain: { text: " M src/greet.ts\n?? src/new-file.ts\n" } });
		const controller: { review: { files: { path: string; status: string }[] }; refreshReview(): Promise<void> } = ensureLegacyController();
		await controller.refreshReview();
		expect(calls).toEqual([{ method: "porcelain", input: {} }]);
		// The classification still comes from the same porcelain parser, now fed
		// by the host instead of a local `git status` (item 58).
		expect(controller.review.files.map(file => [file.path, file.status])).toEqual([
			["src/greet.ts", "modified"],
			["src/new-file.ts", "untracked"],
		]);
	});
	it("opens the Changes view from the Diff action", async () => {
		await activateAndSettle();
		resolveViews();
		await stubState.commands.get("cedia.showDiff")!();
		// Item 63a: the snapshot post is gone with the task shell — read the live
		// work-panel state from the controller instead of a posted message.
		const panel = (ensureLegacyController() as { getWorkPanelForTest?: () => { open: boolean; activeTab: string } }).getWorkPanelForTest?.();
		expect(panel).toBeDefined();
		expect(panel!.open).toBe(true);
		expect(panel!.activeTab).toBe("changes");
	});
	it("refuses a review target outside the task workspace", async () => {
		await activateAndSettle();
		await stubState.commands.get("cedia.reviewInDiff")!(stubUri("file:///tmp/outside-cedia-review.ts"));
		expect(stubState.executed.some(entry => entry.id === "vscode.diff")).toBe(false);
		expect(stubState.statusMessages.some(message => message.includes("outside"))).toBe(true);
	});
	it("refuses a selection from an untitled document", async () => {
		await activateAndSettle();
		resolveViews();
		stubState.activeEditor = {
			document: { uri: stubUri("untitled:Untitled-1"), fileName: "Untitled-1", languageId: "plaintext", getText: () => "scratch" },
			selection: { isEmpty: false, start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
		};
		await stubState.commands.get("cedia.addSelectionToTask")!();
		// The draft is untouched: an untitled buffer has no real path to cite, so
		// Cedia explains instead of quoting invented content.
		expect(lastSnapshotDraft()).toBe("");
		expect(stubState.statusMessages.some(message => message.includes("workspace file"))).toBe(true);
	});
	it("keeps the task draft across an Agents and back to IDE switch", async () => {
		await activateAndSettle();
		resolveViews();
		openEditor(0, 1);
		await stubState.commands.get("cedia.addSelectionToTask")!();
		const before = lastSnapshotDraft();
		expect(before).toContain("src/greet.ts#L1-L2");

		await stubState.commands.get("cedia.showAgents")!();
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(lastSnapshotDraft()).toBe(before);

		await stubState.commands.get("cedia.showIde")!();
		await new Promise(resolve => setTimeout(resolve, 20));
		// Switching presentation must not mint a new session owner or drop text.
		expect(lastSnapshotDraft()).toBe(before);
	});
	it("invokes every palette command without a reachable host", async () => {
		await activateAndSettle();
		resolveViews();
		// Host-dependent commands (refresh, pairing, devices) are covered by their
		// own paths and intentionally excluded here: they wait on the host.
		const palette = [
			"cedia.openComposer",
			"cedia.showAgents",
			"cedia.showIde",
			"cedia.newTask",
			"cedia.openFolder",
			"cedia.skipToTask",
			"cedia.openFiles",
			"cedia.showDiff",
			"cedia.openTerminal",
			"cedia.openSettings",
			"cedia.searchTasks",
			"cedia.taskActions",
			"cedia.ompControls",
			"cedia.addSelectionToTask",
			"cedia.addFileToTask",
			"cedia.reviewInDiff",
			"cedia.inlineEdit",
		];
		for (const id of palette) {
			const handler = stubState.commands.get(id);
			expect(typeof handler).toBe("function");
			// A palette entry that throws is a broken command, not a graceful
			// "nothing to do yet".
			let rejected: unknown;
			try {
				await Promise.resolve(handler!());
			} catch (error) {
				rejected = error;
			}
			expect(`${id}: ${rejected instanceof Error ? rejected.message : rejected ?? "ok"}`).toBe(`${id}: ok`);
		}
	});
	it("opens the native Agents window for showAgents and restores chrome for showIde", async () => {
		await activateAndSettle();
		await stubState.commands.get("cedia.showAgents")!();
		await new Promise(resolve => setTimeout(resolve, 20));
		// The agent surface is the base sessions window (plan S1c), so
		// showAgents opens that window instead of stripping this one's chrome.
		expect(stubState.executed.map(entry => entry.id)).toContain("workbench.action.openAgentsWindow");
		expect(stubState.executed.map(entry => entry.id)).not.toContain("workbench.action.closeSidebar");

		stubState.executed.length = 0;
		await stubState.commands.get("cedia.showIde")!();
		await new Promise(resolve => setTimeout(resolve, 20));
		// Nothing was stripped, so restore is a safe no-op that leaves the
		// chrome values alone instead of rewriting them.
		expect(stubState.executed.map(entry => entry.id)).not.toContain("workbench.action.closeSidebar");
		expect(stubState.config.get("workbench.activityBar.location")).not.toBe("hidden");
		expect(stubState.config.get("workbench.statusBar.visible")).not.toBe(false);
	});
	it("places the customization entry points in the Agents sidebar, not the composer", async () => {
		// Section 3 of the plan lists `Customize` in the Agents sidebar. The base
		// already carries the switch between the two real placements, so Cedia flips
		// that default instead of adding a second entry point. This is the one
		// Cedia patch that touches src/vs/workbench/**; every consumer of the setting
		// lives under src/vs/sessions/**, so the IDE window is not affected.
		const fileName = "0019-cedia-customize-in-sidebar.patch";
		const patchText = readFileSync(join(import.meta.dir, "..", "..", "..", "patches", "desktop", fileName), "utf8");
		expect(patchText).toContain("[ChatConfiguration.CustomizationEntryPoints]: {");
		expect(patchText).toContain(`-			default: product.quality !== 'stable',`);
		expect(patchText).toContain("+			default: false,");
		// Exactly one file, and it is the settings registry.
		expect(patchText.match(/^diff --git /gm)?.length).toBe(1);
		expect(patchText).toContain("chat.shared.contribution.ts");

		const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "patches", "desktop", "manifest.json"), "utf8")) as { patches: { file: string; sha256: string }[] };
		const entry = manifest.patches.find(item => item.file === fileName);
		expect(entry).toBeTruthy();
		expect(createHash("sha256").update(patchText).digest("hex")).toBe(entry!.sha256);
	});
	it("only enables proposed APIs that the pinned product.json allows", async () => {
		// VS Code disables an extension outright when it declares a proposal the
		// product does not allow, so the two declarations are pinned together.
		const manifestPath = join(import.meta.dir, "..", "package.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { enabledApiProposals?: string[] };
		const proposals = manifest.enabledApiProposals ?? [];
		expect(proposals.length).toBeGreaterThan(0);

		const productPath = join(import.meta.dir, "..", "..", "..", "desktop", "product.json");
		if (!existsSync(productPath)) return; // Code-OSS checkout is ignored; skip when absent.
		const product = JSON.parse(readFileSync(productPath, "utf8")) as { extensionEnabledApiProposals?: Record<string, string[]> };
		const allowed = new Set(product.extensionEnabledApiProposals?.["cedia.cedia"] ?? []);
		for (const proposal of proposals) expect(allowed.has(proposal)).toBe(true);
	});
	it("offers the same Delete in the dock's session menu", async () => {
		// The plan's item 24: delete used to be Agents-window-only, so the dock offered
		// Archive and no Delete even though the host route existed. Both surfaces now go
		// through the same extension path, and the dock's own item confirms first because
		// the host delete removes the record and the transcript it wrote.
		// Item 63a: the hand-drawn shell (webview.ts) and its message union are
		// deleted;
		// the Delete path lives on as the dock menu → deleteChatSessions route
		// (the registered `cedia.session.delete` command, wired in activate()).
		const registry = readFileSync(join(import.meta.dir, "..", "src", "task-commands.ts"), "utf8");
		expect(registry).toContain(`{ id: "cedia.session.delete"`);
		expect(registry).toContain("provider.deleteChatSessions(hint)");
	});
	it("keeps the Copilot-flavoured composer controls out of the Agents window", async () => {
		// Three plan chrome decisions: the tool picker, the permission picker and the
		// "Configure Custom Agents..." entry all describe Copilot-chat behaviour, and this
		// window runs on OMP. Each is scoped out with the sessions-window context key, so the
		// IDE window keeps it.
		const root = join(import.meta.dir, "..", "..", "..");
		const patchText = readFileSync(join(root, "patches", "desktop", "0033-cedia-agents-no-copilot-composer-controls.patch"), "utf8");
		// Hunk 1 (the permission-picker gate in chatExecuteActions.ts) retired with
		// item 56: the base carries that exact gate upstream now, so the patch no
		// longer touches the file. The tool-picker and custom-agents gates stay.
		for (const needle of [
			"chatToolActions.ts",
			"chatModeActions.ts",
			"Cedia: this configures the base's tool set",
			"Cedia: custom agents are a Copilot-chat concept",
		]) {
			expect(patchText).toContain(needle);
		}
		expect(patchText).not.toContain("chatExecuteActions.ts");
		expect(patchText.match(/^\+.*IsSessionsWindowContext\.toNegated\(\)/gm)?.length).toBe(3);
		expect(patchText).not.toContain("src/vs/sessions/");

		const manifest = JSON.parse(readFileSync(join(root, "patches", "desktop", "manifest.json"), "utf8")) as { patches: { file: string; sha256: string }[] };
		const entry = manifest.patches.find(item => item.file === "0033-cedia-agents-no-copilot-composer-controls.patch");
		expect(entry).toBeTruthy();
		expect(createHash("sha256").update(patchText).digest("hex")).toBe(entry!.sha256);
	});
	it("does not start the base Agent Host in the Agents window", async () => {
		// The Agent Host utility process hosts the Copilot/Claude/Codex harnesses, and
		// S1 removed that layer; its node-side graph still requires Copilot services
		// that no longer exist (`agentHostCustomizationEnablementService depends on
		// copilotApiService which is NOT registered`), so a process started from the
		// window dies on boot, restarts five times and raises "The Agent Host failed to
		// start". The window must not prewarm it at all.
		const root = join(import.meta.dir, "..", "..", "..");
		const patchText = readFileSync(join(root, "patches", "desktop", "0032-cedia-no-base-agent-host.patch"), "utf8");
		for (const needle of [
			"the window does not prewarm the base Agent Host",
			"does not start the agent host while enabled",
			"does not forward assignment context to a host that is never started",
		]) {
			expect(patchText).toContain(needle);
		}
		// The prewarm call itself is removed by the patch (a diff carries the old line),
		// so the source no longer starts the process anywhere.
		expect(patchText).toMatch(/^-\t\tthis\.agentHostService\.startAgentHost\(\);$/m);

		const manifest = JSON.parse(readFileSync(join(root, "patches", "desktop", "manifest.json"), "utf8")) as { patches: { file: string; sha256: string }[] };
		const entry = manifest.patches.find(item => item.file === "0032-cedia-no-base-agent-host.patch");
		expect(entry).toBeTruthy();
		expect(createHash("sha256").update(patchText).digest("hex")).toBe(entry!.sha256);
	});
	it("keeps the Cedia title when the Agents window has no folder to write into", async () => {
		// The first Agents screen can open with no folder attached, where every
		// workspace-scope write rejects. The window then kept whatever the base
		// had put in the title bar, which reads as an internal Code-OSS window
		// instead of the product. (The shell document whose name used to show up
		// there is retired; the fallback is still the only thing that names a
		// folder-less window.)
		await activateAndSettle(2, true, { fsPath: "/tmp/cedia-agents.code-workspace", path: "/tmp/cedia-agents.code-workspace" });
		// A rejected workspace write is retried at the global scope, which the
		// stub records separately from workspace-scope values.
		expect(stubState.globalConfig.get("window.title")).toBe("New task — Cedia");
		expect(stubState.globalConfig.get("workbench.editor.editorActionsLocation")).toBe("hidden");
		// Colours are not part of that fallback any more: this screen wears the theme
		// the user picked, the same one the IDE window wears.
		expect(stubState.globalConfig.get("workbench.colorCustomizations")).toBeUndefined();
	});
	it("hands the Agents window the theme and the extension that paints it", async () => {
		// The Agents window is a second workbench: it has its own extension enablement, which
		// switches off anything shipping code (every theme with a settings section of its own), and
		// it reads its settings from its own workspace file rather than from the agents profile's
		// settings.json. Without this carry it fell back to the stock theme and the two windows
		// disagreed on colour.
		stubState.config.set("workbench.colorTheme", "Catppuccin Frappé");
		stubState.config.set("workbench.preferredDarkColorTheme", "Catppuccin Mocha");
		stubState.config.set("extensions.supportAgentsWindow", { "someone.else": true });
		await activateAndSettle(2, false, undefined, [
			{ id: "Catppuccin.catppuccin-vsc", packageJSON: { contributes: { themes: [{ label: "Catppuccin Frappé", path: "./themes/frappe.json" }], configuration: {} } } },
			{ id: "someone.unrelated", packageJSON: { contributes: { themes: [{ label: "Unrelated Dark", path: "./dark.json" }] } } },
		]);
		const written = JSON.parse(stubState.files.get(join(tempRoot, "agent-sessions.code-workspace"))!) as { folders: unknown[]; settings: Record<string, unknown> };
		expect(written.settings["workbench.colorTheme"]).toBe("Catppuccin Frappé");
		expect(written.settings["workbench.preferredDarkColorTheme"]).toBe("Catppuccin Mocha");
		// The user's own entry survives, and the theme's provider is added by matching the label
		// the picker shows - Cedia does not know the extension's name.
		expect(written.settings["extensions.supportAgentsWindow"]).toEqual({
			"someone.else": true,
			"catppuccin.catppuccin-vsc": true,
		});
		// The window's own defaults travel with the theme: the reference's sidebar has no
		// empty "Chats" group, so this window does not draw one.
		expect(written.settings["sessions.list.showEmptyDefaultGroups"]).toBe(false);
		expect(written.folders).toEqual([]);
		for (const key of ["workbench.colorTheme", "workbench.preferredDarkColorTheme", "extensions.supportAgentsWindow"]) stubState.config.delete(key);
	});
	it("cites the real terminal selection into the task draft", async () => {
		await activateAndSettle();
		resolveViews();
		stubState.activeTerminal = { name: "zsh", selection: "$ bun test\n1 fail\n  TypeError: boom\n" };
		await stubState.commands.get("cedia.addTerminalSelectionToTask")!();
		const draft = lastSnapshotDraft();
		expect(draft).toContain("terminal:zsh");
		// The fenced body is the terminal's real selection, verbatim.
		expect(draft).toContain("TypeError: boom");
		expect(prefills().at(-1)).toContain("terminal:zsh");
		expect(stubState.statusMessages.some(message => message.includes("terminal:zsh"))).toBe(true);
	});
	it("refuses a terminal citation without a focused terminal or a selection", async () => {
		await activateAndSettle();
		resolveViews();
		stubState.activeTerminal = undefined;
		await stubState.commands.get("cedia.addTerminalSelectionToTask")!();
		expect(stubState.statusMessages.some(message => message.includes("Focus a terminal first"))).toBe(true);
		expect(lastSnapshotDraft()).toBe("");

		stubState.statusMessages.length = 0;
		stubState.activeTerminal = { name: "zsh", selection: "   \n" };
		await stubState.commands.get("cedia.addTerminalSelectionToTask")!();
		expect(stubState.statusMessages.some(message => message.includes("Select terminal output first"))).toBe(true);
		// A blank selection must not become an empty fence in the draft.
		expect(lastSnapshotDraft()).toBe("");
	});
	it("offers no code action while there is no real task surface", async () => {
		await activateAndSettle();
		resolveViews();
		const provider = stubState.codeActions.at(-1);
		expect(provider).toBeDefined();
		// No project, client, or session: the lightbulb must stay empty rather
		// than offer a command that would fail on invoke.
		const actions = provider!.provider.provideCodeActions(
			{ uri: stubUri(`file://${sourceFile}`) },
			{ isEmpty: false },
		);
		expect(actions).toEqual([]);
	});
	it("stages an Explain turn for the real selection before dispatch", async () => {
		await activateAndSettle();
		resolveViews();
		openEditor(0, 1);
		// Dispatch needs the host, so the promise rejects; the cited turn must
		// already be in the draft rather than being silently lost.
		await expect(stubState.commands.get("cedia.explainSelection")!()).rejects.toBeDefined();
		const draft = lastSnapshotDraft();
		expect(draft).toContain("Explain what this selected code does");
		// The real path and line range, and the unsaved buffer as the body.
		expect(draft).toContain("(src/greet.ts#L1-L2)");
		expect(draft).toContain('return "hi " + name;');
		expect(draft).not.toContain('"hello "');
	});
	it("stages a Fix turn and refuses one without a selection", async () => {
		await activateAndSettle();
		resolveViews();
		openEditor(0, 1);
		await expect(stubState.commands.get("cedia.fixSelection")!()).rejects.toBeDefined();
		expect(lastSnapshotDraft()).toContain("Find the defect in this selected code");

		// An empty selection is refused with a reason instead of being sent as a
		// whole-file citation or dropped without a word.
		stubState.statusMessages.length = 0;
		stubState.activeEditor = {
			document: { uri: stubUri(`file://${sourceFile}`), fileName: sourceFile, languageId: "typescript", getText: () => sourceText },
			selection: { isEmpty: true, start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
		};
		await stubState.commands.get("cedia.explainSelection")!();
		expect(stubState.statusMessages.some(message => message.includes("Select the code first"))).toBe(true);
	});
	it("marks an edit Cedia applied, then keeps it through the real command", async () => {
		await activateAndSettle();
		resolveViews();
		let saved = false;
		const editor = agentEditedEditor(2, diskText, () => { saved = true; });
		stubState.activeEditor = editor;
		vscodeApi.window.visibleTextEditors = [editor];
		stubState.context.length = 0;

		provider().recordAgentEdit(appliedEditSummary);

		// A real decoration type was created and one range was painted on the
		// editor that actually holds the edited buffer.
		expect(stubState.decorationTypes.length).toBeGreaterThan(0);
		expect(stubState.decorations.at(-1)!.ranges.length).toBe(1);
		// The menus learn that an edit is waiting, so the title buttons appear.
		expect(stubState.context.at(-1)).toEqual({ key: "cedia.agentEditPending", value: true });
		expect(stubState.statusMessages.some(message => message.includes("changed by Cedia"))).toBe(true);

		await stubState.commands.get("cedia.keepAgentEdit")!();
		expect(saved).toBe(true);
		// Kept: the mark is gone and the buttons withdraw.
		expect(stubState.decorations.at(-1)!.ranges).toEqual([]);
		expect(stubState.context.at(-1)).toEqual({ key: "cedia.agentEditPending", value: false });
	});
	it("takes a Cedia edit back while the buffer still holds Cedia's version", async () => {
		await activateAndSettle();
		resolveViews();
		let saved = false;
		const editor = agentEditedEditor(2, diskText, () => { saved = true; });
		stubState.activeEditor = editor;
		vscodeApi.window.visibleTextEditors = [editor];
		stubState.context.length = 0;
		provider().recordAgentEdit(appliedEditSummary);

		await stubState.commands.get("cedia.revertAgentEdit")!();

		// The buffer is restored to the exact pre-edit text, and nothing was
		// written to disk: taking an edit back is not saving it.
		const applied = stubState.appliedEdits.at(-1) as { replacements?: { text: string }[] } | undefined;
		expect(applied?.replacements?.[0]?.text).toBe(sourceText);
		expect(saved).toBe(false);
		expect(stubState.context.at(-1)).toEqual({ key: "cedia.agentEditPending", value: false });
	});
	it("refuses to take a Cedia edit back once the buffer moved on", async () => {
		await activateAndSettle();
		resolveViews();
		const editor = agentEditedEditor(2, diskText, () => {});
		stubState.activeEditor = editor;
		vscodeApi.window.visibleTextEditors = [editor];
		provider().recordAgentEdit(appliedEditSummary);
		const before = stubState.appliedEdits.length;

		// Someone edited after Cedia, so restoring the old text would take their
		// change with it. Cedia declines and names Undo instead.
		editor.document.version = 3;
		await stubState.commands.get("cedia.revertAgentEdit")!();

		expect(stubState.appliedEdits.length).toBe(before);
		expect(stubState.statusMessages.some(message => message.includes("Use Undo instead"))).toBe(true);
	});
	it("refuses keep and take-back when this file has no Cedia edit waiting", async () => {
		await activateAndSettle();
		resolveViews();
		const editor = agentEditedEditor(1, sourceText, () => {});
		stubState.activeEditor = editor;
		vscodeApi.window.visibleTextEditors = [editor];

		await stubState.commands.get("cedia.keepAgentEdit")!();
		expect(stubState.statusMessages.some(message => message.includes("no Cedia edit waiting"))).toBe(true);

		stubState.statusMessages.length = 0;
		await stubState.commands.get("cedia.revertAgentEdit")!();
		expect(stubState.statusMessages.some(message => message.includes("no Cedia edit waiting"))).toBe(true);
	});
	it("opens a native diff of exactly what Cedia changed", async () => {
		await activateAndSettle();
		resolveViews();
		const editor = agentEditedEditor(2, diskText, () => {});
		stubState.activeEditor = editor;
		vscodeApi.window.visibleTextEditors = [editor];
		stubState.executed.length = 0;
		provider().recordAgentEdit(appliedEditSummary);

		await stubState.commands.get("cedia.reviewAgentEdit")!();

		// A real Code-OSS diff editor, titled so both sides are unambiguous, and
		// the read-only left side is the exact pre-edit text Cedia recorded.
		const diff = stubState.executed.at(-1)!;
		expect(diff.id).toBe("vscode.diff");
		expect(String(diff.args[2])).toContain("(before Cedia ↔ after Cedia)");
		const content = await stubState.contentProviders.get("cedia-agent-edit")!.provideTextDocumentContent(diff.args[0]);
		expect(content).toBe(sourceText);
	});
	it("refuses to review a Cedia edit once the buffer moved on", async () => {
		await activateAndSettle();
		resolveViews();
		const editor = agentEditedEditor(2, diskText, () => {});
		stubState.activeEditor = editor;
		vscodeApi.window.visibleTextEditors = [editor];
		provider().recordAgentEdit(appliedEditSummary);
		stubState.executed.length = 0;

		// Someone changed the buffer after Cedia, so a diff against the pre-edit
		// text would show their change as Cedia's. Cedia declines.
		editor.document.version = 3;
		await stubState.commands.get("cedia.reviewAgentEdit")!();

		expect(stubState.executed.some(entry => entry.id === "vscode.diff")).toBe(false);
		expect(stubState.statusMessages.some(message => message.includes("would also show your own change"))).toBe(true);
	});
	it("refuses to review when this file has no Cedia edit waiting", async () => {
		await activateAndSettle();
		resolveViews();
		const editor = agentEditedEditor(1, sourceText, () => {});
		stubState.activeEditor = editor;
		vscodeApi.window.visibleTextEditors = [editor];

		await stubState.commands.get("cedia.reviewAgentEdit")!();
		expect(stubState.statusMessages.some(message => message.includes("no Cedia edit waiting"))).toBe(true);
	});
	it("offers the two decisions on the change itself as in-editor lenses", async () => {
		await activateAndSettle();
		resolveViews();
		const editor = agentEditedEditor(2, diskText, () => {});
		stubState.activeEditor = editor;
		vscodeApi.window.visibleTextEditors = [editor];
		expect(stubState.codeLenses.length).toBe(1);
		expect(stubState.codeLenses[0]!.selector).toEqual({ scheme: "file" });
		const lensProvider = stubState.codeLenses[0]!.provider;
		// The engine caches lens results until onDidChangeCodeLenses fires, so the
		// provider must expose the event and fire it whenever pending state moves.
		let invalidations = 0;
		expect(typeof lensProvider.onDidChangeCodeLenses).toBe("function");
		lensProvider.onDidChangeCodeLenses!(() => { invalidations += 1; });

		// Nothing pending: no lens is advertised, so the editor never offers a
		// decision that would refuse.
		expect(lensProvider.provideCodeLenses(editor.document)).toEqual([]);

		provider().recordAgentEdit(appliedEditSummary);
		expect(invalidations).toBe(1);
		const lenses = lensProvider.provideCodeLenses(editor.document) as { range: { start: { line: number } }; command: { command: string; title: string } }[];
		expect(lenses.map(lens => lens.command.command)).toEqual(["cedia.keepAgentEdit", "cedia.revertAgentEdit"]);
		// The summary's edit lands on line 1, so the lenses sit on the change.
		expect(lenses.map(lens => lens.range.start.line)).toEqual([1, 1]);
		// The painted mark is the same changed line, not the edit's reported span.
		const painted = stubState.decorations.at(-1)!.ranges as { range: { start: { line: number } } }[];
		expect(painted.map(options => options.range.start.line)).toEqual([1]);
		// The first offer is reported on the Cedia channel, so a real session can
		// prove the engine asked for the lenses even though a lens has no AX node.
		expect(stubState.logLines.filter(line => String(line.message).includes("agent edit lenses offered")).length).toBe(1);
		lensProvider.provideCodeLenses(editor.document);
		expect(stubState.logLines.filter(line => String(line.message).includes("agent edit lenses offered")).length).toBe(1);

		// One vocabulary: the lens titles are the manifest command titles, so a
		// rename cannot leave the editor showing a different name than the menu.
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			contributes: { commands: { command: string; title: string }[] };
		};
		const titles = new Map(manifest.contributes.commands.map(entry => [entry.command, entry.title]));
		for (const lens of lenses) {
			const manifestTitle = titles.get(lens.command.command);
			expect(manifestTitle).toBeDefined();
			expect(lens.command.title).toBe(manifestTitle!);
		}

		// Keeping drops the pending record, so the lenses withdraw with the mark.
		await stubState.commands.get("cedia.keepAgentEdit")!();
		expect(invalidations).toBe(2);
		expect(lensProvider.provideCodeLenses(editor.document)).toEqual([]);
	});
	it("names the Agents window's add-tab control the way the reference does", () => {
		// The reference's `+` in the Agents window reads "Open new tab menu" (its own aria-label
		// in the glass bundle). The base hardcoded "Add Tab" for both windows, so the patch has
		// to branch on the sessions-window context and keep the base wording for the IDE.
		const fileName = "0027-cedia-agents-open-new-tab-menu.patch";
		const patchText = readFileSync(join(import.meta.dir, "..", "..", "..", "patches", "desktop", fileName), "utf8");
		expect(patchText).toContain(`localize('cedia.openNewTabMenu', "Open new tab menu")`);
		expect(patchText).toContain("IsSessionsWindowContext.getValue(this.contextKeyService)");
		// The IDE branch survives: the base wording is still there for that window.
		expect(patchText).toContain(`localize('addTab', "Add Tab")`);
		// One of the few Cedia patches that reaches into src/vs/workbench/**, which is only safe
		// because every decision is guarded by the sessions-window context key.
		expect(patchText).toContain("a/src/vs/workbench/browser/parts/editor/editorTabsControl.ts");

		const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "patches", "desktop", "manifest.json"), "utf8")) as { patches: { file: string; sha256: string }[] };
		const entry = manifest.patches.find(item => item.file === fileName);
		expect(entry).toBeTruthy();
		expect(createHash("sha256").update(patchText).digest("hex")).toBe(entry!.sha256);
	});
	it("retires no patch by leaving a stale file behind", () => {
		// The Apps-panel browser-visibility fix could not ship as its own later patch:
		// `prepare-desktop.ts` proves "already applied" by reverse-checking each patch,
		// and 0021 CREATES `agentHomeUtilityEditor.ts`, so a later edit to that file
		// makes 0021's own reverse-check fail by construction. The fix lives inside 0021
		// instead, and this pins that the retired patch file is really gone.
		const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "patches", "desktop", "manifest.json"), "utf8")) as { patches: { file: string }[] };
		expect(manifest.patches.map(entry => entry.file)).not.toContain("0027-cedia-apps-panel-browser-visible.patch");
	});

});
