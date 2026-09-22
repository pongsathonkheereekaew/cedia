/** The bundle's anchor map: workbench theme variables → the Agent window's own tokens.
 *
 * §10 item 54, "one theme authority end to end": the IDE's `workbench.colorTheme`
 * is the only theme the Agent window has. The extension publishes a snapshot of
 * the anchors in `src/agent-theme-anchors.ts`; this table says which of the
 * app's own custom properties each anchor repaints.
 *
 * Why the table lives here rather than in the vendored hook it used to sit in:
 * theme authority is Cedia's decision, not the ported surface's, and this way
 * the completeness rule below is checked by a Cedia test instead of living
 * inside a file the upstream diff already has to carry.
 *
 * The rule the tests enforce (`apps/macos/test/host-theme-authority.test.ts`):
 * every custom property `buildThemeCssVariables` (vendor `theme.logic.ts`)
 * emits, when its value is a colour, is either a key here or listed in
 * `HOST_THEME_TOKEN_DERIVED_TOKENS`. Nothing paints from the ported palette
 * after the first host snapshot arrives.
 *
 * Values are *sources in priority order*: the first anchor that carries a usable
 * colour wins, so a theme that leaves a key unset falls back to a broader one.
 */

/** Tokens painted from the pack that no workbench anchor expresses.
 *
 * Each entry needs a reason: a `color-mix()` of other tokens inherits the host
 * palette automatically (its inputs are mapped), and a token with no workbench
 * analogue has nothing to follow.
 */
export const HOST_THEME_TOKEN_DERIVED_TOKENS: Readonly<Record<string, string>> = {
	"--app-shell-background": "transparent on a translucent shell, else a mix of --color-background-surface-under, which is mapped",
	"--app-composer-picker-backdrop-filter": "a blur radius, not a colour",
	"--app-sidebar-backdrop-filter": "a blur radius, not a colour",
	"--app-settings-backdrop-filter": "a blur radius, not a colour",
	"--app-composer-picker-surface": "a color-mix() over --popover, which is mapped",
	"--app-composer-focus-border": "a color-mix() over --color-border-focus, which is mapped",
	"--composer-surface": "a color-mix() of --color-background-control(-opaque), which is mapped",
	"--color-simple-scrim": "a translucent page scrim with no workbench analogue; both palettes use the same black",
	"--codex-base-accent": "the pack's base input, from which the derived layer is computed at build time — overriding it alone would desynchronise the derived colours",
	"--codex-base-ink": "the pack's base input (see --codex-base-accent)",
	"--codex-base-surface": "the pack's base input (see --codex-base-accent)",
	"--codex-base-contrast": "the pack's numeric contrast strength, not a colour",
	"--theme-font-code-family": "a font stack; typography is the window's own setting",
	"--theme-font-ui-family": "a font stack; typography is the window's own setting",
};

/** Agent-window token → the workbench anchors that paint it, most specific first. */
export const HOST_THEME_TOKEN_SOURCES: Readonly<Record<string, readonly string[]>> = {
	// App shells and surfaces.
	"--app-shell-background": ["--vscode-editor-background"],
	"--app-sidebar-surface": ["--vscode-sideBar-background"],
	"--app-settings-surface": ["--vscode-panel-background", "--vscode-editor-background"],
	"--app-chat-code-surface": ["--vscode-textCodeBlock-background", "--vscode-input-background"],
	"--app-user-message-background": ["--vscode-input-background", "--vscode-textCodeBlock-background"],
	"--background": ["--vscode-titleBar-activeBackground", "--vscode-editor-background"],
	"--foreground": ["--vscode-foreground", "--vscode-editor-foreground"],
	"--card": ["--vscode-panel-background", "--vscode-editorWidget-background"],
	"--card-foreground": ["--vscode-foreground", "--vscode-editor-foreground"],
	"--popover": ["--vscode-editorWidget-background", "--vscode-panel-background"],
	"--popover-foreground": ["--vscode-foreground", "--vscode-editor-foreground"],
	"--muted": ["--vscode-sideBarSectionHeader-background", "--vscode-panel-background"],
	"--muted-foreground": ["--vscode-descriptionForeground", "--vscode-foreground"],
	"--border": ["--vscode-panel-border", "--vscode-contrastBorder"],
	"--input": ["--vscode-input-background"],
	"--ring": ["--vscode-focusBorder"],

	// Accent and semantic states. `--info`/`--success`/`--warning`/`--destructive`
	// are the app's status colours; the workbench expresses the same roles as
	// link, diff-added, warning and error.
	"--accent": ["--vscode-button-background", "--vscode-focusBorder"],
	"--accent-foreground": ["--vscode-button-foreground", "--vscode-foreground"],
	"--primary": ["--vscode-button-background"],
	"--primary-foreground": ["--vscode-button-foreground", "--vscode-foreground"],
	"--secondary": ["--vscode-input-background"],
	"--secondary-foreground": ["--vscode-input-foreground", "--vscode-foreground"],
	"--info": ["--vscode-textLink-foreground", "--vscode-focusBorder"],
	"--info-foreground": ["--vscode-textLink-foreground", "--vscode-foreground"],
	"--success": ["--vscode-gitDecoration-addedResourceForeground", "--vscode-testing-iconPassed"],
	"--success-foreground": ["--vscode-editor-background", "--vscode-foreground"],
	"--warning": ["--vscode-editorWarning-foreground"],
	"--warning-foreground": ["--vscode-editor-background", "--vscode-foreground"],
	"--destructive": ["--vscode-gitDecoration-deletedResourceForeground", "--vscode-errorForeground", "--vscode-testing-iconFailed"],
	"--destructive-foreground": ["--vscode-editor-background", "--vscode-foreground"],

	// Sidebar.
	"--sidebar": ["--vscode-sideBar-background", "--vscode-editor-background"],
	"--sidebar-foreground": ["--vscode-sideBar-foreground", "--vscode-foreground"],
	"--sidebar-border": ["--vscode-sideBar-border", "--vscode-panel-border"],
	"--sidebar-accent": ["--vscode-list-hoverBackground"],
	"--sidebar-accent-active": ["--vscode-list-activeSelectionBackground"],
	"--sidebar-accent-foreground": ["--vscode-list-activeSelectionForeground", "--vscode-foreground"],
	"--sidebar-selected": ["--vscode-list-activeSelectionBackground"],
	"--sidebar-primary": ["--vscode-button-background"],
	"--sidebar-primary-foreground": ["--vscode-button-foreground", "--vscode-foreground"],
	"--sidebar-ring": ["--vscode-focusBorder"],
	"--sidebar-background": ["--vscode-sideBar-background", "--vscode-editor-background"],

	// The ported surface's own colour scale.
	"--color-background-surface": ["--vscode-editor-background", "--vscode-sideBar-background"],
	"--color-background-surface-under": ["--vscode-titleBar-activeBackground", "--vscode-editor-background"],
	"--color-background-panel": ["--vscode-panel-background", "--vscode-editorWidget-background"],
	"--color-background-control": ["--vscode-input-background"],
	"--color-background-control-opaque": ["--vscode-input-background"],
	"--color-background-editor-opaque": ["--vscode-editor-background"],
	"--color-background-elevated-primary": ["--vscode-editorWidget-background", "--vscode-panel-background"],
	"--color-background-elevated-primary-opaque": ["--vscode-editorWidget-background", "--vscode-panel-background"],
	"--color-background-elevated-secondary": ["--vscode-sideBarSectionHeader-background", "--vscode-panel-background"],
	"--color-background-elevated-secondary-opaque": ["--vscode-sideBarSectionHeader-background", "--vscode-panel-background"],
	"--color-background-user-message": ["--vscode-textCodeBlock-background", "--vscode-input-background"],
	"--color-background-accent": ["--vscode-button-background", "--vscode-focusBorder"],
	"--color-background-accent-active": ["--vscode-list-activeSelectionBackground", "--vscode-button-hoverBackground"],
	"--color-background-accent-hover": ["--vscode-button-hoverBackground", "--vscode-button-background"],
	"--color-background-button-primary": ["--vscode-button-background"],
	"--color-background-button-primary-hover": ["--vscode-button-hoverBackground", "--vscode-button-background"],
	"--color-background-button-primary-active": ["--vscode-button-hoverBackground", "--vscode-button-background"],
	"--color-background-button-primary-inactive": ["--vscode-button-secondaryBackground", "--vscode-button-background"],
	"--color-background-button-secondary": ["--vscode-button-secondaryBackground", "--vscode-input-background"],
	"--color-background-button-secondary-hover": ["--vscode-button-secondaryHoverBackground", "--vscode-list-hoverBackground"],
	"--color-background-button-secondary-active": ["--vscode-button-secondaryHoverBackground", "--vscode-list-activeSelectionBackground"],
	"--color-background-button-secondary-inactive": ["--vscode-button-secondaryBackground", "--vscode-input-background"],
	"--color-background-button-tertiary": ["--vscode-button-secondaryBackground", "--vscode-input-background"],
	"--color-background-button-tertiary-hover": ["--vscode-button-secondaryHoverBackground", "--vscode-list-hoverBackground"],
	"--color-background-button-tertiary-active": ["--vscode-button-secondaryHoverBackground", "--vscode-list-activeSelectionBackground"],
	"--color-text-foreground": ["--vscode-foreground", "--vscode-editor-foreground"],
	"--color-text-foreground-secondary": ["--vscode-descriptionForeground", "--vscode-foreground"],
	"--color-text-foreground-tertiary": ["--vscode-disabledForeground", "--vscode-descriptionForeground"],
	"--color-text-accent": ["--vscode-textLink-foreground", "--vscode-focusBorder"],
	"--color-text-button-primary": ["--vscode-button-foreground", "--vscode-foreground"],
	"--color-text-button-secondary": ["--vscode-button-secondaryForeground", "--vscode-foreground"],
	"--color-text-button-tertiary": ["--vscode-button-secondaryForeground", "--vscode-foreground"],
	"--color-icon-primary": ["--vscode-icon-foreground", "--vscode-foreground"],
	"--color-icon-secondary": ["--vscode-descriptionForeground", "--vscode-foreground"],
	"--color-icon-tertiary": ["--vscode-disabledForeground", "--vscode-descriptionForeground"],
	"--color-icon-accent": ["--vscode-textLink-foreground", "--vscode-focusBorder"],
	"--color-border": ["--vscode-panel-border", "--vscode-editorGroup-border"],
	"--color-border-light": ["--vscode-widget-border", "--vscode-panel-border"],
	"--color-border-heavy": ["--vscode-contrastBorder", "--vscode-panel-border"],
	"--color-border-focus": ["--vscode-focusBorder"],
	"--color-decoration-added": ["--vscode-gitDecoration-addedResourceForeground", "--vscode-testing-iconPassed"],
	"--color-decoration-deleted": ["--vscode-gitDecoration-deletedResourceForeground", "--vscode-testing-iconFailed"],
	"--color-editor-added": ["--vscode-gitDecoration-addedResourceForeground", "--vscode-testing-iconPassed"],
	"--color-editor-deleted": ["--vscode-gitDecoration-deletedResourceForeground", "--vscode-testing-iconFailed"],
	"--color-accent-blue": ["--vscode-textLink-foreground", "--vscode-focusBorder"],
	"--color-accent-green": ["--vscode-gitDecoration-addedResourceForeground", "--vscode-testing-iconPassed"],
	"--color-accent-red": ["--vscode-gitDecoration-deletedResourceForeground", "--vscode-errorForeground"],
	"--color-accent-yellow": ["--vscode-editorWarning-foreground"],
	"--color-accent-purple": ["--vscode-charts-purple", "--vscode-textLink-foreground"],

	// `--color-token-*` is the alias layer the shared components read.
	"--color-token-foreground": ["--vscode-foreground", "--vscode-editor-foreground"],
	"--color-token-description-foreground": ["--vscode-descriptionForeground"],
	"--color-token-disabled-foreground": ["--vscode-disabledForeground", "--vscode-descriptionForeground"],
	"--color-token-text-primary": ["--vscode-foreground", "--vscode-editor-foreground"],
	"--color-token-text-secondary": ["--vscode-descriptionForeground", "--vscode-foreground"],
	"--color-token-text-tertiary": ["--vscode-disabledForeground", "--vscode-descriptionForeground"],
	"--color-token-border": ["--vscode-panel-border", "--vscode-editorGroup-border"],
	"--color-token-border-default": ["--vscode-panel-border", "--vscode-editorGroup-border"],
	"--color-token-border-light": ["--vscode-widget-border", "--vscode-panel-border"],
	"--color-token-border-heavy": ["--vscode-contrastBorder", "--vscode-panel-border"],
	"--color-token-focus-border": ["--vscode-focusBorder"],
	"--color-token-main-surface-primary": ["--vscode-editor-background", "--vscode-sideBar-background"],
	"--color-token-side-bar-background": ["--vscode-sideBar-background", "--vscode-editor-background"],
	"--color-token-button-background": ["--vscode-button-background"],
	"--color-token-button-foreground": ["--vscode-button-foreground", "--vscode-foreground"],
	"--color-token-button-border": ["--vscode-button-border", "--vscode-panel-border"],
	"--color-token-button-secondary-hover-background": ["--vscode-button-secondaryHoverBackground", "--vscode-list-hoverBackground"],
	"--color-token-input-background": ["--vscode-input-background"],
	"--color-token-input-border": ["--vscode-input-border", "--vscode-panel-border"],
	"--color-token-input-foreground": ["--vscode-input-foreground", "--vscode-foreground"],
	"--color-token-input-placeholder-foreground": ["--vscode-input-placeholderForeground", "--vscode-descriptionForeground"],
	"--color-token-dropdown-background": ["--vscode-dropdown-background", "--vscode-input-background"],
	"--color-token-menu-background": ["--vscode-menu-background", "--vscode-editorWidget-background"],
	"--color-token-menu-border": ["--vscode-menu-border", "--vscode-panel-border"],
	"--color-token-list-active-selection-background": ["--vscode-list-activeSelectionBackground"],
	"--color-token-list-active-selection-foreground": ["--vscode-list-activeSelectionForeground", "--vscode-foreground"],
	"--color-token-list-active-selection-icon-foreground": ["--vscode-list-activeSelectionIconForeground", "--vscode-icon-foreground"],
	"--color-token-list-hover-background": ["--vscode-list-hoverBackground"],
	"--color-token-link": ["--vscode-textLink-foreground", "--vscode-focusBorder"],
	"--color-token-text-link-foreground": ["--vscode-textLink-foreground", "--vscode-focusBorder"],
	"--color-token-text-link-active-foreground": ["--vscode-textLink-activeForeground", "--vscode-textLink-foreground"],
	"--color-token-text-code-block-background": ["--vscode-textCodeBlock-background", "--vscode-input-background"],
	"--color-token-badge-background": ["--vscode-badge-background"],
	"--color-token-badge-foreground": ["--vscode-badge-foreground", "--vscode-foreground"],
	"--color-token-checkbox-active-background": ["--vscode-checkbox-selectBackground", "--vscode-button-background"],
	"--color-token-checkbox-active-foreground": ["--vscode-checkbox-selectForeground", "--vscode-foreground"],
	"--color-token-radio-active-foreground": ["--vscode-radio-activeForeground", "--vscode-button-background"],
	"--color-token-progress-bar-background": ["--vscode-progressBar-background", "--vscode-button-background"],
	"--color-token-toolbar-hover-background": ["--vscode-toolbar-hoverBackground", "--vscode-list-hoverBackground"],
	"--color-token-editor-background": ["--vscode-editor-background"],
	"--color-token-editor-foreground": ["--vscode-editor-foreground", "--vscode-foreground"],
	"--color-token-scrollbar-slider-background": ["--vscode-scrollbarSlider-background"],
	"--color-token-scrollbar-slider-hover-background": ["--vscode-scrollbarSlider-hoverBackground", "--vscode-scrollbarSlider-background"],
	"--color-token-scrollbar-slider-active-background": ["--vscode-scrollbarSlider-activeBackground", "--vscode-scrollbarSlider-hoverBackground"],

	// Terminal palette. The dock's Terminal pane renders this bundle, so it wears
	// the workbench's terminal colours, not the pack's.
	"--vscode-terminal-background": ["--vscode-terminal-background"],
	"--vscode-terminal-foreground": ["--vscode-terminal-foreground"],
	"--vscode-terminal-border": ["--vscode-terminal-border", "--vscode-panel-border"],
	"--vscode-terminal-ansiBlack": ["--vscode-terminal-ansiBlack"],
	"--vscode-terminal-ansiRed": ["--vscode-terminal-ansiRed"],
	"--vscode-terminal-ansiGreen": ["--vscode-terminal-ansiGreen"],
	"--vscode-terminal-ansiYellow": ["--vscode-terminal-ansiYellow"],
	"--vscode-terminal-ansiBlue": ["--vscode-terminal-ansiBlue"],
	"--vscode-terminal-ansiMagenta": ["--vscode-terminal-ansiMagenta"],
	"--vscode-terminal-ansiCyan": ["--vscode-terminal-ansiCyan"],
	"--vscode-terminal-ansiWhite": ["--vscode-terminal-ansiWhite"],
	"--vscode-terminal-ansiBrightBlack": ["--vscode-terminal-ansiBrightBlack"],
	"--vscode-terminal-ansiBrightRed": ["--vscode-terminal-ansiBrightRed"],
	"--vscode-terminal-ansiBrightGreen": ["--vscode-terminal-ansiBrightGreen"],
	"--vscode-terminal-ansiBrightYellow": ["--vscode-terminal-ansiBrightYellow"],
	"--vscode-terminal-ansiBrightBlue": ["--vscode-terminal-ansiBrightBlue"],
	"--vscode-terminal-ansiBrightMagenta": ["--vscode-terminal-ansiBrightMagenta"],
	"--vscode-terminal-ansiBrightCyan": ["--vscode-terminal-ansiBrightCyan"],
	"--vscode-terminal-ansiBrightWhite": ["--vscode-terminal-ansiBrightWhite"],
	"--color-token-terminal-background": ["--vscode-terminal-background"],
	"--color-token-terminal-foreground": ["--vscode-terminal-foreground"],
	"--color-token-terminal-border": ["--vscode-terminal-border", "--vscode-panel-border"],
	"--color-token-terminal-ansi-black": ["--vscode-terminal-ansiBlack"],
	"--color-token-terminal-ansi-red": ["--vscode-terminal-ansiRed"],
	"--color-token-terminal-ansi-green": ["--vscode-terminal-ansiGreen"],
	"--color-token-terminal-ansi-yellow": ["--vscode-terminal-ansiYellow"],
	"--color-token-terminal-ansi-blue": ["--vscode-terminal-ansiBlue"],
	"--color-token-terminal-ansi-magenta": ["--vscode-terminal-ansiMagenta"],
	"--color-token-terminal-ansi-cyan": ["--vscode-terminal-ansiCyan"],
	"--color-token-terminal-ansi-white": ["--vscode-terminal-ansiWhite"],
	"--color-token-terminal-ansi-bright-black": ["--vscode-terminal-ansiBrightBlack"],
	"--color-token-terminal-ansi-bright-red": ["--vscode-terminal-ansiBrightRed"],
	"--color-token-terminal-ansi-bright-green": ["--vscode-terminal-ansiBrightGreen"],
	"--color-token-terminal-ansi-bright-yellow": ["--vscode-terminal-ansiBrightYellow"],
	"--color-token-terminal-ansi-bright-blue": ["--vscode-terminal-ansiBrightBlue"],
	"--color-token-terminal-ansi-bright-magenta": ["--vscode-terminal-ansiBrightMagenta"],
	"--color-token-terminal-ansi-bright-cyan": ["--vscode-terminal-ansiBrightCyan"],
	"--color-token-terminal-ansi-bright-white": ["--vscode-terminal-ansiBrightWhite"],
};

/** Every anchor the map consumes, so the publisher's allowlist can be checked
 * against it without importing the DOM half. */
export const HOST_THEME_REQUIRED_ANCHORS: readonly string[] = [
	...new Set(Object.values(HOST_THEME_TOKEN_SOURCES).flat()),
].sort();

/** The minimal DOM surface the application needs; keeps this module testable
 * without a browser environment. */
export interface HostThemeStyleTarget {
	setProperty(name: string, value: string): void;
}

/** Host theme snapshot: mode plus the anchors that carry a colour. */
export interface HostThemeSnapshotInput {
	readonly mode: "light" | "dark";
	readonly themeName?: string;
	readonly colors?: Readonly<Record<string, string>>;
}

/** Paint the host's anchors over the pack's tokens on `root`.
 *
 * Returns the tokens it overrode, in application order, so a caller can undo
 * exactly those (the applier removes them before re-projecting a pack).
 */
export function applyHostThemeTokens(
	root: HostThemeStyleTarget,
	snapshot: HostThemeSnapshotInput | undefined,
): string[] {
	const colors = snapshot?.colors;
	if (!colors) return [];
	const applied: string[] = [];
	for (const [target, sources] of Object.entries(HOST_THEME_TOKEN_SOURCES)) {
		const value = sources
			.map(source => colors[source])
			.find(candidate => typeof candidate === "string" && candidate.trim().length > 0);
		if (value === undefined) continue;
		root.setProperty(target, value);
		applied.push(target);
	}
	return applied;
}
