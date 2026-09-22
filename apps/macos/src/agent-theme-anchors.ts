/** The workbench theme variables Cedia shares with the Agent window.
 *
 * Why this file exists: §10 item 54 makes the IDE's `workbench.colorTheme` the
 * single theme authority. Three places have to agree on which variables that
 * authority is expressed in — the extension that publishes the snapshot
 * (`agent-theme.ts`), the webview bootstrap that reads them out of the
 * embedded workbench (`agent-window/src/ide-bootstrap.ts`), and the bundle's
 * anchor-to-token map (`agent-window/src/host-theme-tokens.ts`) — so the list
 * lives here, imports nothing, and each of those three reads it instead of
 * keeping a copy that can drift.
 *
 * The set is closed under the mapping: every anchor the bundle's map consumes
 * MUST be listed here, or the extension drops it from the snapshot before the
 * bundle ever sees it. `apps/macos/test/host-theme-authority.test.ts` asserts
 * exactly that, plus that every anchor `cedia-theme.ts`'s token scale resolves
 * through is present.
 *
 * Values are workbench colour ids in camelCase-minus-the-dot form, which is how
 * Code-OSS publishes them (`workbench.colorCustomizations` keys map one-to-one).
 */
export const AGENT_THEME_COLOR_KEYS = [
	// Surfaces and chrome.
	"--vscode-editor-background",
	"--vscode-editor-foreground",
	"--vscode-foreground",
	"--vscode-descriptionForeground",
	"--vscode-disabledForeground",
	"--vscode-sideBar-background",
	"--vscode-sideBar-foreground",
	"--vscode-sideBar-border",
	"--vscode-sideBarSectionHeader-background",
	"--vscode-panel-background",
	"--vscode-panel-border",
	"--vscode-titleBar-activeBackground",
	"--vscode-statusBar-background",
	"--vscode-statusBar-foreground",
	"--vscode-statusBar-border",
	"--vscode-editorGroup-border",
	"--vscode-widget-border",

	// Controls.
	"--vscode-input-background",
	"--vscode-input-foreground",
	"--vscode-input-border",
	"--vscode-input-placeholderForeground",
	"--vscode-dropdown-background",
	"--vscode-menu-background",
	"--vscode-menu-border",
	"--vscode-checkbox-selectBackground",
	"--vscode-checkbox-selectForeground",
	"--vscode-radio-activeForeground",
	"--vscode-progressBar-background",
	"--vscode-toolbar-hoverBackground",
	"--vscode-button-background",
	"--vscode-button-foreground",
	"--vscode-button-hoverBackground",
	"--vscode-button-border",
	"--vscode-button-secondaryBackground",
	"--vscode-button-secondaryForeground",
	"--vscode-button-secondaryHoverBackground",
	"--vscode-badge-background",
	"--vscode-badge-foreground",
	"--vscode-icon-foreground",

	// Text, focus and selection.
	"--vscode-textCodeBlock-background",
	"--vscode-editorWidget-background",
	"--vscode-focusBorder",
	"--vscode-contrastBorder",
	"--vscode-textLink-foreground",
	"--vscode-textLink-activeForeground",
	"--vscode-list-hoverBackground",
	"--vscode-list-activeSelectionBackground",
	"--vscode-list-activeSelectionForeground",
	"--vscode-list-activeSelectionIconForeground",
	"--vscode-scrollbarSlider-background",
	"--vscode-scrollbarSlider-hoverBackground",
	"--vscode-scrollbarSlider-activeBackground",

	// Semantics: diff decorations, diagnostics, accents.
	"--vscode-gitDecoration-addedResourceForeground",
	"--vscode-gitDecoration-deletedResourceForeground",
	"--vscode-testing-iconPassed",
	"--vscode-testing-iconFailed",
	"--vscode-errorForeground",
	"--vscode-editorWarning-foreground",
	"--vscode-charts-purple",

	// Terminal. The dock's Terminal pane renders the bundle's terminal, so its
	// palette follows the workbench terminal colours rather than the pack's.
	"--vscode-terminal-background",
	"--vscode-terminal-foreground",
	"--vscode-terminal-border",
	"--vscode-terminal-ansiBlack",
	"--vscode-terminal-ansiRed",
	"--vscode-terminal-ansiGreen",
	"--vscode-terminal-ansiYellow",
	"--vscode-terminal-ansiBlue",
	"--vscode-terminal-ansiMagenta",
	"--vscode-terminal-ansiCyan",
	"--vscode-terminal-ansiWhite",
	"--vscode-terminal-ansiBrightBlack",
	"--vscode-terminal-ansiBrightRed",
	"--vscode-terminal-ansiBrightGreen",
	"--vscode-terminal-ansiBrightYellow",
	"--vscode-terminal-ansiBrightBlue",
	"--vscode-terminal-ansiBrightMagenta",
	"--vscode-terminal-ansiBrightCyan",
	"--vscode-terminal-ansiBrightWhite",
] as const;

/** The same anchors as a set, for the snapshot sanitisers on both sides. */
export const AGENT_THEME_COLOR_SET: ReadonlySet<string> = new Set(AGENT_THEME_COLOR_KEYS);
