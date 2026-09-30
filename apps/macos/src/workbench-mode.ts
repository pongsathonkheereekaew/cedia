/** Agent ↔ IDE is presentation, not an OMP session lifecycle.
 *
 * Default is the same Cedia.app window: hide/restore Code-OSS chrome and keep
 * the open folder, host, and OMP owner. The Agents window itself is the base's,
 * and it opens `agent-sessions.code-workspace`; `cedia-agents.code-workspace` is
 * only a recognised identity, kept because a build before 2026-09-17 could have
 * left that file on disk, and recognising it costs one string comparison. */

export const CEDIA_AGENTS_WORKSPACE = "cedia-agents.code-workspace";
export const COPILOT_AGENTS_WORKSPACE = "agent-sessions.code-workspace";
export const CEDIA_EXTENSION_ID = "cedia.cedia";

export function workspaceFilePath(workspaceFile?: { fsPath?: string; path?: string } | string | null): string {
	if (!workspaceFile) return "";
	if (typeof workspaceFile === "string") return workspaceFile;
	return workspaceFile.fsPath || workspaceFile.path || "";
}

function posixPath(workspaceFile?: { fsPath?: string; path?: string } | string | null): string {
	return workspaceFilePath(workspaceFile).replace(/\\/g, "/");
}

export function isCediaAgentsWindow(workspaceFile?: { fsPath?: string; path?: string } | string | null): boolean {
	return posixPath(workspaceFile).endsWith(CEDIA_AGENTS_WORKSPACE);
}

export function isCopilotAgentsWindow(workspaceFile?: { fsPath?: string; path?: string } | string | null): boolean {
	return posixPath(workspaceFile).endsWith(COPILOT_AGENTS_WORKSPACE);
}

export function isAgentsWindow(workspaceFile?: { fsPath?: string; path?: string } | string | null): boolean {
	return isCediaAgentsWindow(workspaceFile) || isCopilotAgentsWindow(workspaceFile);
}

/**
 * The Agents window's own workspace file, which is where its settings have to land.
 *
 * Upstream opens `IAgentSessionsWorkspace` (`agent-sessions.code-workspace` in the user data home)
 * for that window, and pins it to the internal `agents` profile, which *shares the default
 * profile's settings file* (`AGENTS_WINDOW_PROFILE_FLAGS.settings` is on). That was measured, not
 * assumed: a file written to `profiles/builtin/agents/settings.json` is never read - the window
 * kept resolving the stock theme with the override sitting in it - while the same keys in this
 * workspace file take effect. So this file is the carrier for what the window has to know.
 */
export const AGENTS_WINDOW_WORKSPACE = COPILOT_AGENTS_WORKSPACE;

/** The one switch that lets an extension run in the Agents window against upstream's default. */
export const AGENTS_WINDOW_SUPPORT_SETTING = "extensions.supportAgentsWindow";

export interface ThemeProvidingExtension {
	/** Extension id, as the marketplace writes it (`publisher.name`). */
	readonly id: string;
	/** The manifest, shaped like `vscode.Extension.packageJSON` hands it over. */
	readonly packageJSON?: { readonly contributes?: { readonly themes?: readonly unknown[] } & Readonly<Record<string, unknown>> } | undefined;
}

/**
 * The extensions that paint the themes the user selected.
 *
 * The Agents window is a second workbench with its own extension enablement, and upstream turns
 * every extension there off unless it ships no code at all
 * (`canExecuteOnSessionsWindow`: `manifest.main`/`browser` disqualifies immediately). Theme
 * extensions that add their own settings section ship code, so their declarative `themes`
 * contribution is never registered in that window and `workbench.colorTheme` silently falls back
 * to the stock theme — which is exactly how the two windows stopped matching. Naming the
 * providers lets those extensions, and only those, run there.
 *
 * A theme is named by id or by the label the picker shows, and the setting may hold either.
 */
export function themeProvidingExtensionIds(
	themeIds: readonly (string | undefined)[],
	extensions: readonly ThemeProvidingExtension[],
): string[] {
	const wanted = new Set(themeIds.filter((id): id is string => typeof id === "string" && id.length > 0));
	if (wanted.size === 0) return [];
	const ids: string[] = [];
	for (const extension of extensions) {
		const themes = extension.packageJSON?.contributes?.themes;
		if (!Array.isArray(themes)) continue;
		const provides = themes.some(theme => {
			if (!theme || typeof theme !== "object") return false;
			const entry = theme as { id?: unknown; label?: unknown };
			return (typeof entry.id === "string" && wanted.has(entry.id)) || (typeof entry.label === "string" && wanted.has(entry.label));
		});
		if (provides) ids.push(extension.id.toLowerCase());
	}
	return ids.sort();
}

export interface SnapshotThemeChoice {
	readonly colorTheme?: unknown;
	readonly preferredDarkColorTheme?: unknown;
	readonly preferredLightColorTheme?: unknown;
	readonly autoDetectColorScheme?: unknown;
	readonly mode: "light" | "dark";
}

/**
 * The theme name the Agents window snapshot should carry.
 *
 * With `window.autoDetectColorScheme` the stored `workbench.colorTheme` is not what the
 * window shows: the workbench renders the preferred light/dark theme for the active kind
 * instead. Handing over the stored id would aim the agent at a theme nobody is looking at
 * (and at an id no pack rule recognises), so the resolved preferred theme wins and the
 * stored id is only the fallback.
 */
export function resolveSnapshotThemeName(choice: SnapshotThemeChoice): string | undefined {
	const pick = (value: unknown): string | undefined =>
		typeof value === "string" && value.length > 0 ? value : undefined;
	if (choice.autoDetectColorScheme === true) {
		return pick(choice.mode === "light" ? choice.preferredLightColorTheme : choice.preferredDarkColorTheme)
			?? pick(choice.colorTheme);
	}
	return pick(choice.colorTheme);
}

/**
 * Merge the theme and the extensions that paint it into the Agents window's workspace settings.
 *
 * Keeps the folder list and every setting that is already there, because the sessions workbench
 * writes its own keys (`chat.disableAIFeatures`) into the same document. A file that no longer
 * parses (hand-edited) is replaced rather than allowed to stop the window from opening.
 */
export function mergeAgentsWindowWorkspaceSettings(existing: string | undefined, settings: Readonly<Record<string, unknown>> = {}, support: Readonly<Record<string, boolean>> = {}): string {
	let current: Record<string, unknown> = {};
	if (existing) {
		try {
			const parsed: unknown = JSON.parse(existing);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
		} catch {
			current = {};
		}
	}
	const folders = Array.isArray(current["folders"]) ? current["folders"] : [];
	const previousSettings = current["settings"];
	const previous = previousSettings && typeof previousSettings === "object" && !Array.isArray(previousSettings)
		? previousSettings as Record<string, unknown>
		: {};
	const previousSupport = previous[AGENTS_WINDOW_SUPPORT_SETTING];
	return `${JSON.stringify({
		...current,
		folders,
		settings: {
			...previous,
			// `settings` wins over whatever is there: it is the theme the user is looking at now.
			...settings,
			[AGENTS_WINDOW_SUPPORT_SETTING]: {
				...((previousSupport && typeof previousSupport === "object" && !Array.isArray(previousSupport)) ? previousSupport as Record<string, unknown> : {}),
				...support,
			},
		},
	}, null, "\t")}\n`;
}

export type WorkbenchMode = "agents" | "ide";
export type NativeDestination = "explorer";

export function queuePendingNativeDestination(current: NativeDestination | undefined, next: NativeDestination): NativeDestination {
	return next ?? current;
}

export function consumePendingNativeDestination(mode: "agents" | "ide", pending?: NativeDestination): { pending?: NativeDestination; openExplorer: boolean } {
	if (mode === "ide" && pending === "explorer") return { openExplorer: true };
	if (mode === "agents" && pending) return { pending, openExplorer: false };
	return { openExplorer: false };
}

export function resolveStartupView(input: {
	readonly pending?: NativeDestination;
	readonly rememberedMode?: WorkbenchMode;
	readonly startupView: "last_task" | "agents" | "ide";
	/** False in a plain IDE window (no agents workspace file). */
	readonly inAgentsWindow: boolean;
}): { readonly mode: WorkbenchMode; readonly openExplorer: boolean; readonly revealDock: boolean; readonly pending?: NativeDestination } {
	if (input.pending) {
		const consumed = consumePendingNativeDestination("ide", input.pending);
		return {
			mode: "ide",
			openExplorer: consumed.openExplorer,
			// A pending Explorer destination still shows the agent beside it, so
			// the user does not lose the task surface when native chrome returns.
			revealDock: true,
			...(consumed.pending ? { pending: consumed.pending } : {}),
		};
	}
	// Native world (plan section 2): the agent lives in its own Agents window,
	// so a plain IDE window always keeps full Code-OSS chrome and opens clean
	// (no forced agent dock). Shell-era defaults below apply only inside the
	// agents workspace until S3 retires them.
	if (!input.inAgentsWindow) {
		return { mode: "ide", openExplorer: false, revealDock: false };
	}
	if (input.startupView === "agents") return { mode: "agents", openExplorer: false, revealDock: false };
	// An explicit IDE choice keeps the native chrome and shows the agent beside
	// it. Without this branch the option would fall through to the default below
	// and the IDE setting would be unreachable from the settings surface.
	if (input.startupView === "ide") return { mode: "ide", openExplorer: false, revealDock: true };
	if (input.startupView === "last_task") {
		const mode = input.rememberedMode === "ide" ? "ide" : "agents";
		return { mode, openExplorer: false, revealDock: mode === "ide" };
	}
	// Default: the full-window Cedia shell, which carries its own IDE switch.
	// This is the documented first screen (UI interaction spec section 2: Cedia
	// opens the Agents page by default with an easily found IDE button), and it
	// is also what an unknown or missing value means.
	return { mode: "agents", openExplorer: false, revealDock: false };
}

/** After `vscode.openFolder` this extension instance dies. Persist the destination; do not consume it here. */
export function persistDestinationAcrossReload(willReloadWindow: boolean, pending?: NativeDestination): { pending?: NativeDestination; consumeNow: boolean } {
	if (!pending) return { consumeNow: false };
	if (willReloadWindow) return { pending, consumeNow: false };
	return { pending, consumeNow: true };
}

export interface IdeLayoutSnapshot {
	readonly sidebarVisible: boolean;
	readonly auxiliaryBarVisible: boolean;
	readonly panelVisible: boolean;
	readonly activeEditorUri?: string;
	readonly showTabs?: string;
	readonly statusBarVisible?: boolean;
	readonly breadcrumbsEnabled?: boolean;
	readonly activityBarLocation?: string;
}

export const DEFAULT_IDE_LAYOUT: IdeLayoutSnapshot = {
	sidebarVisible: true,
	auxiliaryBarVisible: false,
	panelVisible: true,
	showTabs: "multiple",
	statusBarVisible: true,
};

export const AGENTS_EDITOR_SHOW_TABS = "multiple";

export function draftViewKey(projectId: string | undefined | null, sessionId: string | undefined | null): string {
	return `${projectId?.trim() || "none"}/${sessionId?.trim() || "local-new"}`;
}

export interface RetentionSnapshot {
	readonly sessionId?: string;
	readonly draft: string;
	readonly scrollEventId?: string;
	readonly attachmentRefs?: readonly string[];
	readonly mode: WorkbenchMode;
	readonly pendingDestination?: NativeDestination;
}

export interface RetentionReceipt {
	readonly sessionUnchanged: boolean;
	readonly draftRetained: boolean;
	readonly scrollRetained: boolean;
	readonly attachmentsRetained: boolean;
	readonly mode: WorkbenchMode;
	readonly pendingDestination?: NativeDestination;
}

export interface ModeSwitchProof {
	readonly capturedAt: string;
	readonly sameWindow: true;
	readonly sessionId: string;
	readonly sessionUnchanged: boolean;
	readonly draftRetained: boolean;
	readonly scrollRetained: boolean;
	readonly attachmentsRetained: boolean;
	readonly from: WorkbenchMode;
	readonly to: WorkbenchMode;
	readonly ownerUnchanged: boolean;
}

/** UI-S1 A→IDE→A / A→B→A receipt. View switch must not mint a new session owner. */
export function retentionReceipt(before: RetentionSnapshot, after: RetentionSnapshot): RetentionReceipt {
	const sessionUnchanged = (before.sessionId ?? "") === (after.sessionId ?? "");
	return {
		sessionUnchanged,
		draftRetained: sessionUnchanged && before.draft === after.draft,
		scrollRetained: sessionUnchanged && (before.scrollEventId ?? "") === (after.scrollEventId ?? ""),
		attachmentsRetained: sessionUnchanged && (before.attachmentRefs ?? []).join("\0") === (after.attachmentRefs ?? []).join("\0"),
		mode: after.mode,
		...(after.pendingDestination ? { pendingDestination: after.pendingDestination } : {}),
	};
}

export function modeSwitchProof(before: RetentionSnapshot, after: RetentionSnapshot, capturedAt = new Date().toISOString()): ModeSwitchProof {
	const receipt = retentionReceipt(before, after);
	return {
		capturedAt,
		sameWindow: true,
		sessionId: after.sessionId ?? "",
		sessionUnchanged: receipt.sessionUnchanged,
		draftRetained: receipt.draftRetained,
		scrollRetained: receipt.scrollRetained,
		attachmentsRetained: receipt.attachmentsRetained,
		from: before.mode,
		to: after.mode,
		ownerUnchanged: receipt.sessionUnchanged,
	};
}

/** Merge observed IDE chrome while the user is in IDE. Agents chrome must not overwrite this. */
export function rememberIdeChrome(layout: IdeLayoutSnapshot, change: Partial<IdeLayoutSnapshot>): IdeLayoutSnapshot {
	return normalizeIdeLayout({ ...layout, ...change }, layout);
}

export function normalizeIdeLayout(value: unknown, fallback: IdeLayoutSnapshot = DEFAULT_IDE_LAYOUT): IdeLayoutSnapshot {
	if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
	const record = value as Record<string, unknown>;
	// Cedia writes these exact values into the workspace settings while it hides
	// chrome for Agents mode. They are Cedia's own footprint, not a layout the
	// user chose, so they must never be read back as the IDE layout: on the next
	// run the workspace setting is still "none"/false, the snapshot would capture
	// it, and "IDE" would come back with no tabs and no status bar. Each of these
	// falls back instead, exactly as activityBar.location already did.
	const storedShowTabs = typeof record.showTabs === "string" ? record.showTabs : undefined;
	const storedActivityBar = typeof record.activityBarLocation === "string" ? record.activityBarLocation : undefined;
	return {
		sidebarVisible: record.sidebarVisible !== false,
		auxiliaryBarVisible: record.auxiliaryBarVisible === true,
		panelVisible: record.panelVisible !== false,
		...(typeof record.activeEditorUri === "string" ? { activeEditorUri: record.activeEditorUri } : {}),
		showTabs: storedShowTabs && storedShowTabs !== AGENTS_EDITOR_SHOW_TABS ? storedShowTabs : fallback.showTabs,
		statusBarVisible: record.statusBarVisible === false ? fallback.statusBarVisible !== false : true,
		breadcrumbsEnabled: record.breadcrumbsEnabled !== false,
		activityBarLocation: storedActivityBar && storedActivityBar !== "hidden" ? storedActivityBar : fallback.activityBarLocation,
	};
}

export function agentsChromeCommands(): readonly string[] {
	return [
		"workbench.action.closeSidebar",
		"workbench.action.closeAuxiliaryBar",
		"workbench.action.closePanel",
		"workbench.action.activityBarLocation.hide",
	];
}

export function ideChromeCommands(snapshot: IdeLayoutSnapshot): readonly string[] {
	const commands: string[] = [];
	if (snapshot.sidebarVisible) commands.push("workbench.view.explorer");
	if (snapshot.auxiliaryBarVisible) commands.push("workbench.action.focusAuxiliaryBar");
	if (snapshot.panelVisible) commands.push("workbench.action.focusPanel");
	return commands;
}

export function switchWorkbenchMode(input: {
	readonly from: WorkbenchMode;
	readonly to: WorkbenchMode;
	readonly ideLayout: IdeLayoutSnapshot;
}): { readonly mode: WorkbenchMode; readonly ideLayout: IdeLayoutSnapshot; readonly commands: readonly string[] } {
	if (input.from === input.to) return { mode: input.to, ideLayout: input.ideLayout, commands: [] };
	if (input.to === "agents") {
		return { mode: "agents", ideLayout: input.ideLayout, commands: agentsChromeCommands() };
	}
	return { mode: "ide", ideLayout: input.ideLayout, commands: ideChromeCommands(input.ideLayout) };
}


export async function runWorkbenchCommands(
	executeCommand: (command: string, ...args: unknown[]) => PromiseLike<unknown>,
	commands: readonly string[],
): Promise<void> {
	// Best-effort chrome: one unknown/rejected command must not abort the rest
	// of the mode switch or skip the appearance update that follows.
	for (const command of commands) {
		try {
			await executeCommand(command);
		} catch { /* cosmetic; the next chrome command still applies */ }
	}
}
