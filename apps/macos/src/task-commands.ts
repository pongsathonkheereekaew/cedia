import type * as vscode from "vscode";
import type { CediaIdeAgentProvider } from "./agent-ide-webview.ts";
import type { CediaTaskViewProvider } from "./extension.ts";

/** One entry in the extension's command registry (item 66). */
export interface CommandEntry {
	readonly id: string;
	readonly run: (provider: CediaTaskViewProvider, ideAgent: CediaIdeAgentProvider) => (...args: never[]) => unknown;
}

/**
 * Every command `activate()` registers, enumerable from one module.
 *
 * Two entries are intentionally unlisted in package.json: `cedia.browser.suggest`
 * (internal — the Apps panel's address bar calls it directly, it has no palette
 * meaning) and `cedia.focusDock` (internal focus helper). Both still register so
 * existing callers keep working; the manifest diff is asserted in
 * `command-registry.test.ts`.
 */
export const COMMAND_REGISTRY: readonly CommandEntry[] = [
	{ id: "cedia.openComposer", run: (_provider, ideAgent) => (query?: unknown) => {
		if (typeof query === "string" && query.trim()) return ideAgent.appendContext(query);
		return ideAgent.focus();
	} },
	{ id: "cedia.showAgents", run: (_provider, ideAgent) => () => ideAgent.openAgents() },
	{ id: "cedia.showIde", run: (provider) => () => provider.showIde() },
	{ id: "cedia.newTask", run: (_provider, ideAgent) => () => ideAgent.focus("newTask") },
	{ id: "cedia.openFolder", run: (provider) => () => provider.openFolderFlow() },
	{ id: "cedia.models.configureRoles", run: (provider) => () => provider.configureModelRoles() },
	{ id: "cedia.project.setPinned", run: (provider) => (folderPath?: string) => provider.setProjectPinned(folderPath) },
	{ id: "cedia.project.rename", run: (provider) => (hint?: string) => provider.renameProject(hint) },
	{ id: "cedia.project.archiveChats", run: (provider) => (folderPath?: string) => provider.archiveProjectChats(folderPath) },
	{ id: "cedia.project.remove", run: (provider) => (folderPath?: string) => provider.removeProject(folderPath) },
	{ id: "cedia.session.delete", run: (provider) => (hint?: unknown) => provider.deleteChatSessions(hint) },
	{ id: "cedia.project.createWorktree", run: (provider) => (folderPath?: string) => provider.createWorktreeForProject(folderPath) },
	{ id: "cedia.project.reveal", run: (provider) => (hint?: string) => provider.revealProject(hint) },
	{ id: "cedia.project.add", run: (provider) => () => provider.addProjectFlow() },
	{ id: "cedia.browser.suggest", run: (provider) => (term?: string) => provider.suggestSearchTerms(term) },
	{ id: "cedia.refresh", run: (provider) => () => provider.refreshNow() },
	{ id: "cedia.openFiles", run: (provider) => () => provider.nativeAction("files") },
	{ id: "cedia.showDiff", run: (provider) => () => provider.nativeAction("diff") },
	{ id: "cedia.openTerminal", run: (provider) => () => provider.nativeAction("terminal") },
	{ id: "cedia.openSettings", run: (provider) => () => provider.openCediaSettings() },
	{ id: "cedia.ompSignIn", run: (provider) => () => provider.ompSignIn() },
	{ id: "cedia.searchTasks", run: (provider) => () => provider.focusSearch() },
	{ id: "cedia.skipToTask", run: (provider) => () => provider.skipToTask() },
	{ id: "cedia.pairDevice", run: (provider) => () => provider.pairDevice() },
	{ id: "cedia.connectIPhone", run: (provider) => () => provider.pairDevice() },
	{ id: "cedia.manageDevices", run: (provider) => () => provider.manageDevices() },
	{ id: "cedia.ompControls", run: (provider) => () => provider.ompControls() },
	{ id: "cedia.taskActions", run: (provider) => () => provider.taskActions() },
	{ id: "cedia.reviewInDiff", run: (provider) => (resource?: vscode.Uri) => provider.reviewActiveFileInDiff(resource) },
	{ id: "cedia.addSelectionToTask", run: (provider) => () => provider.addSelectionToTask() },
	{ id: "cedia.addTerminalSelectionToTask", run: (provider) => () => provider.addTerminalSelectionToTask() },
	{ id: "cedia.explainSelection", run: (provider) => () => provider.runSelectionAction("explain") },
	{ id: "cedia.fixSelection", run: (provider) => () => provider.runSelectionAction("fix") },
	{ id: "cedia.keepAgentEdit", run: (provider) => () => provider.keepAgentEdit() },
	{ id: "cedia.revertAgentEdit", run: (provider) => () => provider.revertAgentEdit() },
	{ id: "cedia.reviewAgentEdit", run: (provider) => () => provider.reviewAgentEdit() },
	{ id: "cedia.inlineEdit", run: (provider) => () => provider.inlineEdit() },
	{ id: "cedia.addFileToTask", run: (provider) => (resource?: vscode.Uri) => provider.addFileToTask(resource) },
	{ id: "cedia.focusDock", run: (provider) => () => provider.focusDock() },
];

/** Commands with no palette listing (internal wiring, not user entry points). */
export const UNLISTED_COMMANDS: Readonly<Record<string, true>> = {
	"cedia.browser.suggest": true,
	"cedia.focusDock": true,
};

export function registerCediaCommands(
	api: typeof vscode,
	provider: CediaTaskViewProvider,
	ideAgent: CediaIdeAgentProvider,
): vscode.Disposable[] {
	return COMMAND_REGISTRY.map(entry => api.commands.registerCommand(entry.id, entry.run(provider, ideAgent) as (...args: unknown[]) => unknown));
}
