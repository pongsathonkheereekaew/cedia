import * as vscode from "vscode";
import { resolve } from "node:path";
import { writeAgentThemeSnapshot } from "./agent-theme.ts";
import { AGENTS_WINDOW_WORKSPACE, allThemeProvidingExtensionIds, isAgentsWindow, mergeAgentsWindowWorkspaceSettings, resolveSnapshotThemeName } from "./workbench-mode.ts";

/** Item 66: activation wiring extracted from extension.ts. */

/** The settings that decide which theme the Agents window paints. */
export const AGENTS_WINDOW_THEME_SETTING_KEYS = [
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
export async function syncAgentsWindowTheme(globalStorage: vscode.Uri, stateDir?: string): Promise<void> {
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

