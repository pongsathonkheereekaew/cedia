// FILE: useTheme.ts
// Purpose: Persists the Codex-style theme store and projects the active pack into DOM CSS variables.
// Layer: Web appearance state hook
// Exports: useTheme for mode, resolved variant, theme-pack import/export, and active theme metadata.

import { useEffect, useSyncExternalStore } from "react";
import { isElectron } from "../env";
import { isIdeEmbeddedRuntime } from "../ide-mode";
import { isMacNavigatorPlatform } from "../lib/utils";
import {
  DEFAULT_THEME_STATE,
  type ChromeTheme,
  type ThemeFonts,
  type ThemeMode,
  type ThemePack,
  type ThemeState,
  type ThemeVariant,
  areThemePacksEqual,
  isCodeThemeAvailable,
  packForIdeThemeName,
  buildThemeCssVariables,
  canParseThemeShareString,
  createThemeShareString,
  parseStoredThemeState,
  resetThemeVariant as resetThemeVariantState,
  resolveThemePack,
  resolveThemeVariant,
  serializeThemeState,
  setThemeCodeThemeId,
  setThemeFonts,
  updateChromeTheme,
  updateThemePackFromShareString,
} from "../theme/theme.logic";

type ThemeSnapshot = {
  state: ThemeState;
  systemDark: boolean;
};

type HostThemeSnapshot = {
  mode: "light" | "dark";
  themeName?: string;
  colors?: Record<string, string>;
};

const STORAGE_KEY = "synara:theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let lastSnapshotKey = "";
let lastDesktopTheme: ThemeMode | null = null;
let hostThemePollTimer: number | undefined;
let hostThemePollUsers = 0;
let hostTokenOverrideNames = new Set<string>();

const HOST_THEME_COLOR_LIMIT = 48;
const SAFE_HOST_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z-]+\([^;{}]+\)|[a-z]+)$/i;
const HOST_TOKEN_SOURCES: Readonly<Record<string, readonly string[]>> = {
  "--app-shell-background": ["--vscode-editor-background"],
  "--app-sidebar-surface": ["--vscode-sideBar-background"],
  "--app-settings-surface": ["--vscode-panel-background", "--vscode-editor-background"],
  "--app-chat-code-surface": ["--vscode-textCodeBlock-background", "--vscode-input-background"],
  "--app-user-message-background": ["--vscode-input-background", "--vscode-textCodeBlock-background"],
  "--color-background-surface": ["--vscode-editor-background", "--vscode-sideBar-background"],
  "--color-background-surface-under": ["--vscode-titleBar-activeBackground", "--vscode-editor-background"],
  "--color-background-panel": ["--vscode-panel-background", "--vscode-editorWidget-background"],
  "--color-background-control": ["--vscode-input-background"],
  "--color-background-control-opaque": ["--vscode-input-background"],
  "--color-background-elevated-primary": ["--vscode-editorWidget-background", "--vscode-panel-background"],
  "--color-background-elevated-primary-opaque": ["--vscode-editorWidget-background", "--vscode-panel-background"],
  "--color-background-elevated-secondary": ["--vscode-sideBarSectionHeader-background", "--vscode-panel-background"],
  "--color-background-accent": ["--vscode-button-background", "--vscode-focusBorder"],
  "--color-background-accent-hover": ["--vscode-button-hoverBackground", "--vscode-button-background"],
  "--color-background-button-primary": ["--vscode-button-background"],
  "--color-background-button-primary-hover": ["--vscode-button-hoverBackground", "--vscode-button-background"],
  "--color-background-button-secondary": ["--vscode-input-background", "--vscode-list-activeSelectionBackground"],
  "--color-background-button-secondary-hover": ["--vscode-list-hoverBackground"],
  "--color-text-foreground": ["--vscode-foreground", "--vscode-editor-foreground"],
  "--color-text-foreground-secondary": ["--vscode-descriptionForeground", "--vscode-foreground"],
  "--color-text-foreground-tertiary": ["--vscode-disabledForeground", "--vscode-descriptionForeground"],
  "--color-text-accent": ["--vscode-textLink-foreground", "--vscode-focusBorder"],
  "--color-text-button-primary": ["--vscode-button-foreground", "--vscode-foreground"],
  "--color-text-button-secondary": ["--vscode-input-foreground", "--vscode-foreground"],
  "--color-border": ["--vscode-panel-border", "--vscode-editorGroup-border"],
  "--color-border-light": ["--vscode-widget-border", "--vscode-panel-border"],
  "--color-border-heavy": ["--vscode-contrastBorder", "--vscode-panel-border"],
  "--color-border-focus": ["--vscode-focusBorder"],
  "--color-decoration-added": ["--vscode-gitDecoration-addedResourceForeground", "--vscode-testing-iconPassed"],
  "--color-decoration-deleted": ["--vscode-gitDecoration-deletedResourceForeground", "--vscode-testing-iconFailed"],
  "--foreground": ["--vscode-foreground", "--vscode-editor-foreground"],
  "--background": ["--vscode-titleBar-activeBackground", "--vscode-editor-background"],
  "--card": ["--vscode-panel-background", "--vscode-editorWidget-background"],
  "--card-foreground": ["--vscode-foreground", "--vscode-editor-foreground"],
  "--input": ["--vscode-input-background"],
  "--muted": ["--vscode-sideBarSectionHeader-background", "--vscode-panel-background"],
  "--muted-foreground": ["--vscode-descriptionForeground", "--vscode-foreground"],
  "--popover": ["--vscode-editorWidget-background", "--vscode-panel-background"],
  "--popover-foreground": ["--vscode-foreground", "--vscode-editor-foreground"],
  "--primary": ["--vscode-button-background"],
  "--primary-foreground": ["--vscode-button-foreground", "--vscode-foreground"],
  "--ring": ["--vscode-focusBorder"],
  "--secondary": ["--vscode-input-background"],
  "--secondary-foreground": ["--vscode-input-foreground", "--vscode-foreground"],
  "--sidebar": ["--vscode-sideBar-background", "--vscode-editor-background"],
  "--sidebar-accent": ["--vscode-list-hoverBackground"],
  "--sidebar-accent-active": ["--vscode-list-activeSelectionBackground"],
  "--sidebar-selected": ["--vscode-list-activeSelectionBackground"],
  "--sidebar-accent-foreground": ["--vscode-list-activeSelectionForeground", "--vscode-foreground"],
  "--sidebar-border": ["--vscode-sideBar-border", "--vscode-panel-border"],
  "--sidebar-foreground": ["--vscode-sideBar-foreground", "--vscode-foreground"],
  // Aliases used by the shared Synara component tokens.
  "--color-token-foreground": ["--vscode-foreground", "--vscode-editor-foreground"],
  "--color-token-description-foreground": ["--vscode-descriptionForeground"],
  "--color-token-disabled-foreground": ["--vscode-disabledForeground", "--vscode-descriptionForeground"],
  "--color-token-border": ["--vscode-panel-border", "--vscode-editorGroup-border"],
  "--color-token-border-light": ["--vscode-widget-border", "--vscode-panel-border"],
  "--color-token-border-heavy": ["--vscode-contrastBorder", "--vscode-panel-border"],
  "--color-token-focus-border": ["--vscode-focusBorder"],
  "--color-token-main-surface-primary": ["--vscode-editor-background", "--vscode-sideBar-background"],
  "--color-token-side-bar-background": ["--vscode-sideBar-background", "--vscode-editor-background"],
  "--color-token-button-background": ["--vscode-button-background"],
  "--color-token-button-foreground": ["--vscode-button-foreground", "--vscode-foreground"],
  "--color-token-button-secondary-hover-background": ["--vscode-list-hoverBackground"],
  "--color-token-input-background": ["--vscode-input-background"],
  "--color-token-input-border": ["--vscode-input-border", "--vscode-panel-border"],
  "--color-token-input-foreground": ["--vscode-input-foreground", "--vscode-foreground"],
  "--color-token-dropdown-background": ["--vscode-dropdown-background", "--vscode-input-background"],
  "--color-token-menu-background": ["--vscode-menu-background", "--vscode-editorWidget-background"],
  "--color-token-list-active-selection-background": ["--vscode-list-activeSelectionBackground"],
  "--color-token-list-active-selection-foreground": ["--vscode-list-activeSelectionForeground", "--vscode-foreground"],
  "--color-token-list-hover-background": ["--vscode-list-hoverBackground"],
  "--color-token-link": ["--vscode-textLink-foreground", "--vscode-focusBorder"],
};

// ─── Store wiring ─────────────────────────────────────────────────────────

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function hasThemeStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function normalizeHostThemeSnapshot(value: unknown): HostThemeSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (row.mode !== "light" && row.mode !== "dark") return undefined;
  const colors: Record<string, string> = {};
  if (row.colors && typeof row.colors === "object" && !Array.isArray(row.colors)) {
    for (const [name, raw] of Object.entries(row.colors as Record<string, unknown>)) {
      if (!(Object.values(HOST_TOKEN_SOURCES).flat() as string[]).includes(name) || typeof raw !== "string") continue;
      const color = raw.trim().slice(0, 256);
      if (color && SAFE_HOST_COLOR.test(color) && !/url\s*\(/i.test(color) && (typeof CSS === "undefined" || CSS.supports("color", color))) colors[name] = color;
      if (Object.keys(colors).length >= HOST_THEME_COLOR_LIMIT) break;
    }
  }
  const themeName = typeof row.themeName === "string" && row.themeName.trim().length > 0
    ? row.themeName.trim().slice(0, 128)
    : undefined;
  return {
    mode: row.mode,
    ...(themeName ? { themeName } : {}),
    ...(Object.keys(colors).length > 0 ? { colors } : {}),
  };
}

function readHostThemeSnapshot(): HostThemeSnapshot | undefined {
  return normalizeHostThemeSnapshot((globalThis as { __CEDIA_HOST_THEME__?: unknown }).__CEDIA_HOST_THEME__);
}

function hostColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const hex = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value.trim());
  if (hex) return `#${hex[1]!.toLowerCase()}`;
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value.trim());
  if (!rgb) return undefined;
  const channel = (raw: string) => Math.max(0, Math.min(255, Math.round(Number(raw)))).toString(16).padStart(2, "0");
  return `#${channel(rgb[1]!)}${channel(rgb[2]!)}${channel(rgb[3]!)}`;
}

function firstHostColor(snapshot: HostThemeSnapshot | undefined, ...names: string[]): string | undefined {
  for (const name of names) {
    const color = hostColor(snapshot?.colors?.[name]);
    if (color) return color;
  }
  return undefined;
}

function isDefaultVariantPack(state: ThemeState, variant: ThemeVariant): boolean {
  return areThemePacksEqual(resolveThemePack(state, variant), resolveThemePack(DEFAULT_THEME_STATE, variant));
}

export function stateForHostTheme(state: ThemeState, snapshot: HostThemeSnapshot | undefined): ThemeState {
  // The Follow-IDE toggle is the explicit link. Off means the agent theme is
  // fully independent: the snapshot is ignored and stored packs render as-is.
  // (Pack edits switch the toggle off, so a customization can never silently
  // stop matching; the toggle flipping is the visible signal.)
  if (!state.followHostTheme) return state;
  if (!snapshot) return isIdeEmbeddedRuntime() ? { ...state, mode: "system" as const } : state;
  const variant = snapshot.mode;
  // The IDE names its theme (VS Code `workbench.colorTheme`); project it onto this
  // app's closest pack so the agent follows the IDE, not just its light/dark
  // mode and accent tints. Unknown names keep the stored pack. A pack the user
  // already changed stays theirs — following is a default, not an override — so
  // mapping lands only while that variant is still the pristine default. This
  // overlay only projects for display; storage keeps the user's own packs
  // underneath, so switching the toggle off restores their look.
  const mappedPack = isDefaultVariantPack(state, variant)
    ? packForIdeThemeName(snapshot.themeName, variant)
    : undefined;
  let next = state;
  if (mappedPack) {
    next = setThemeCodeThemeId(next, variant, mappedPack);
  }
  const previous = next.chromeThemes[variant];
  const patch: Partial<ChromeTheme> = {
    ...(firstHostColor(snapshot, "--vscode-button-background", "--vscode-textLink-foreground", "--vscode-focusBorder") ? { accent: firstHostColor(snapshot, "--vscode-button-background", "--vscode-textLink-foreground", "--vscode-focusBorder") } : {}),
    ...(firstHostColor(snapshot, "--vscode-foreground", "--vscode-editor-foreground") ? { ink: firstHostColor(snapshot, "--vscode-foreground", "--vscode-editor-foreground") } : {}),
    ...(firstHostColor(snapshot, "--vscode-editor-background", "--vscode-sideBar-background") ? { surface: firstHostColor(snapshot, "--vscode-editor-background", "--vscode-sideBar-background") } : {}),
  };
  const added = firstHostColor(snapshot, "--vscode-gitDecoration-addedResourceForeground", "--vscode-testing-iconPassed");
  const removed = firstHostColor(snapshot, "--vscode-gitDecoration-deletedResourceForeground", "--vscode-testing-iconFailed");
  const skill = firstHostColor(snapshot, "--vscode-textLink-foreground", "--vscode-focusBorder");
  if (added || removed || skill) {
    patch.semanticColors = {
      ...previous.semanticColors,
      ...(added ? { diffAdded: added } : {}),
      ...(removed ? { diffRemoved: removed } : {}),
      ...(skill ? { skill } : {}),
    };
  }
  const hasPalette = Object.keys(patch).length > 0;
  return {
    ...next,
    ...(hasPalette ? { chromeThemes: { ...next.chromeThemes, [variant]: { ...previous, ...patch } } } : {}),
  };
}

function applyHostThemeTokens(root: HTMLElement, snapshot: HostThemeSnapshot | undefined): void {
  const colors = snapshot?.colors;
  if (!colors) return;
  for (const [target, sources] of Object.entries(HOST_TOKEN_SOURCES)) {
    const value = sources.map(source => colors[source]).find(candidate => typeof candidate === "string" && candidate.trim().length > 0);
    if (value) {
      root.style.setProperty(target, value);
      hostTokenOverrideNames.add(target);
    }
  }
}

function pollHostThemeSnapshot(): void {
  if (isIdeEmbeddedRuntime() || typeof window === "undefined") return;
  const bridge = window.desktopBridge as typeof window.desktopBridge & {
    getThemeSnapshot?: () => Promise<unknown>;
  };
  if (typeof bridge?.getThemeSnapshot !== "function") return;
  void bridge.getThemeSnapshot().then(value => {
    const snapshot = normalizeHostThemeSnapshot(value);
    // A missing file means the extension has not written its fallback yet;
    // keep the bootstrap snapshot instead of clearing a usable palette.
    if (!snapshot || JSON.stringify(snapshot) === JSON.stringify(readHostThemeSnapshot() ?? null)) return;
    (globalThis as { __CEDIA_HOST_THEME__?: HostThemeSnapshot }).__CEDIA_HOST_THEME__ = snapshot;
    applyThemeState(readStoredThemeState(), true);
    emitChange();
  }).catch(() => undefined);
}

function startHostThemePolling(): () => void {
  if (isIdeEmbeddedRuntime() || typeof window === "undefined") return () => {};
  hostThemePollUsers += 1;
  if (hostThemePollTimer === undefined) {
    pollHostThemeSnapshot();
    hostThemePollTimer = window.setInterval(pollHostThemeSnapshot, 1_000);
  }
  return () => {
    hostThemePollUsers = Math.max(0, hostThemePollUsers - 1);
    if (hostThemePollUsers === 0 && hostThemePollTimer !== undefined) {
      window.clearInterval(hostThemePollTimer);
      hostThemePollTimer = undefined;
    }
  };
}

function getSystemDark(): boolean {
  // Unlinked System follows the OS, not the IDE snapshot.
  const hostTheme = readStoredThemeState().followHostTheme ? readHostThemeSnapshot() : undefined;
  if (hostTheme) return hostTheme.mode === "dark";
  if (isIdeEmbeddedRuntime() && typeof document !== "undefined") {
    return document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
  }
  return typeof window !== "undefined" && window.matchMedia(MEDIA_QUERY).matches;
}

function readStoredThemeState(): ThemeState {
  if (!hasThemeStorage()) {
    return DEFAULT_THEME_STATE;
  }

  try {
    return parseStoredThemeState(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_STATE;
  }
}

function writeStoredThemeState(state: ThemeState) {
  if (!hasThemeStorage()) {
    return;
  }

  localStorage.setItem(STORAGE_KEY, serializeThemeState(state));
}

function getSnapshot(): ThemeSnapshot {
  const stored = readStoredThemeState();
  const state = stateForHostTheme(stored, readHostThemeSnapshot());
  const systemDark = state.mode === "system" ? getSystemDark() : false;
  const hostKey = JSON.stringify(readHostThemeSnapshot() ?? null);
  const snapshotKey = `${serializeThemeState(state)}|${systemDark ? "dark" : "light"}|${hostKey}`;

  if (lastSnapshot && lastSnapshotKey === snapshotKey) {
    return lastSnapshot;
  }

  lastSnapshotKey = snapshotKey;
  lastSnapshot = { state, systemDark };
  return lastSnapshot;
}

function updateStoredThemeState(update: (state: ThemeState) => ThemeState) {
  const nextState = update(readStoredThemeState());
  writeStoredThemeState(nextState);
  applyThemeState(nextState, true);
  emitChange();
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  listeners.push(listener);

  const mediaQuery = window.matchMedia(MEDIA_QUERY);
  const handleMediaChange = () => {
    const state = readStoredThemeState();
    if (state.mode === "system") {
      applyThemeState(state, true);
    }
    emitChange();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    applyThemeState(readStoredThemeState(), true);
    emitChange();
  };

  const hostThemeObserver = isIdeEmbeddedRuntime() ? new MutationObserver(() => {
    applyThemeState(readStoredThemeState(), true);
    emitChange();
  }) : null;
  hostThemeObserver?.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  const handleHostTheme = () => {
    applyThemeState(readStoredThemeState(), true);
    emitChange();
  };
  window.addEventListener("cedia:host-theme", handleHostTheme);
  const stopHostThemePolling = startHostThemePolling();
  mediaQuery.addEventListener("change", handleMediaChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    hostThemeObserver?.disconnect();
    window.removeEventListener("cedia:host-theme", handleHostTheme);
    stopHostThemePolling();
    listeners = listeners.filter((currentListener) => currentListener !== listener);
    mediaQuery.removeEventListener("change", handleMediaChange);
    window.removeEventListener("storage", handleStorage);
  };
}

// ─── DOM projection ───────────────────────────────────────────────────────

function applyThemeState(state: ThemeState, suppressTransitions = false) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  const root = document.documentElement;
  // Some server-rendered tests stub only the tiny DOM surface they need.
  if (
    typeof root.classList?.toggle !== "function" ||
    typeof root.style?.setProperty !== "function" ||
    typeof root.style?.removeProperty !== "function"
  ) {
    return;
  }

  if (suppressTransitions) {
    root.classList.add("no-transitions");
  }

  for (const name of hostTokenOverrideNames) root.style.removeProperty(name);
  hostTokenOverrideNames = new Set();
  const hostTheme = readHostThemeSnapshot();
  const projectedState = stateForHostTheme(state, hostTheme);
  const variant = resolveThemeVariant(projectedState.mode, getSystemDark());
  const activeTheme = resolveThemePack(projectedState, variant);
  const cssVariableBuild = buildThemeCssVariables(activeTheme, variant, {
    electron: isElectron,
    isMac: isMacNavigatorPlatform(),
    systemUiFont: projectedState.systemUiFont,
  });

  root.classList.toggle("dark", variant === "dark");
  root.setAttribute("data-code-theme-id", activeTheme.codeThemeId);
  root.setAttribute("data-theme-mode", projectedState.mode);
  root.setAttribute("data-theme-variant", variant);
  root.setAttribute("data-window-material", cssVariableBuild.material);

  for (const [name, value] of Object.entries(cssVariableBuild.variables)) {
    if (value.trim().length === 0) {
      root.style.removeProperty(name);
      continue;
    }
    root.style.setProperty(name, value);
  }
  const shouldFollowTokens = Boolean(hostTheme) && state.followHostTheme && variant === hostTheme?.mode;
  if (shouldFollowTokens) applyHostThemeTokens(root, hostTheme);

  syncDesktopTheme(projectedState.mode);

  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal.
    // oxlint-disable-next-line no-unused-expressions
    root.offsetHeight;
    requestAnimationFrame(() => {
      root.classList.remove("no-transitions");
    });
  }
}

function syncDesktopTheme(theme: ThemeMode) {
  if (typeof window === "undefined") {
    return;
  }

  const bridge = window.desktopBridge;
  if (!bridge || lastDesktopTheme === theme) {
    return;
  }

  lastDesktopTheme = theme;
  void bridge.setTheme(theme).catch(() => {
    if (lastDesktopTheme === theme) {
      lastDesktopTheme = null;
    }
  });
}

// Apply immediately on module load to minimize flash before React mounts.
if (typeof document !== "undefined") {
  applyThemeState(readStoredThemeState());
}

// ─── Public hook ──────────────────────────────────────────────────────────

function setTheme(nextTheme: ThemeMode) {
  updateStoredThemeState((state) => ({
    ...state,
    mode: nextTheme,
  }));
}

function setSystemUiFont(enabled: boolean) {
  updateStoredThemeState((state) => ({
    ...state,
    systemUiFont: enabled,
  }));
}

function resetThemeVariant(variant: ThemeVariant) {
  updateStoredThemeState((state) => resetThemeVariantState(state, variant));
}

function resetAllThemes() {
  updateStoredThemeState(() => DEFAULT_THEME_STATE);
}

function setFollowHostTheme(follow: boolean) {
  updateStoredThemeState((state) => ({
    ...state,
    followHostTheme: follow,
  }));
}

function withHostUnlink(next: ThemeState): ThemeState {
  return next.followHostTheme ? { ...next, followHostTheme: false } : next;
}

function updateThemePack(variant: ThemeVariant, patch: Partial<ChromeTheme>) {
  updateStoredThemeState((state) => withHostUnlink(updateChromeTheme(state, variant, patch)));
}

function updateThemeFonts(variant: ThemeVariant, patch: Partial<ThemeFonts>) {
  updateStoredThemeState((state) => withHostUnlink(setThemeFonts(state, variant, patch)));
}

function setCodeThemeId(variant: ThemeVariant, codeThemeId: string) {
  updateStoredThemeState((state) => withHostUnlink(setThemeCodeThemeId(state, variant, codeThemeId)));
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => ({
    state: DEFAULT_THEME_STATE,
    systemDark: false,
  }));
  const theme = snapshot.state.mode;
  const resolvedTheme = resolveThemeVariant(theme, snapshot.systemDark);
  const activeTheme = resolveThemePack(snapshot.state, resolvedTheme);
  const darkTheme = resolveThemePack(snapshot.state, "dark");
  const lightTheme = resolveThemePack(snapshot.state, "light");
  const defaultActiveTheme = resolveThemePack(DEFAULT_THEME_STATE, resolvedTheme);
  const isDefaultActiveTheme = areThemePacksEqual(activeTheme, defaultActiveTheme);

  const canImportThemeString = (value: string, variant: ThemeVariant = resolvedTheme) =>
    canParseThemeShareString(value, variant);

  const importThemeString = (value: string, variant: ThemeVariant = resolvedTheme) => {
    updateStoredThemeState((state) => withHostUnlink(updateThemePackFromShareString(state, value, variant)));
  };

  const exportThemeString = (variant: ThemeVariant = resolvedTheme) =>
    createThemeShareString(variant, resolveThemePack(snapshot.state, variant));

  const resetActiveTheme = () => {
    updateStoredThemeState((state) => resetThemeVariantState(state, resolvedTheme));
  };

  const isDefaultThemePack = (variant: ThemeVariant) =>
    areThemePacksEqual(
      resolveThemePack(snapshot.state, variant),
      resolveThemePack(DEFAULT_THEME_STATE, variant),
    );

  // Keep the DOM synced if something bypassed the immediate module-load apply.
  useEffect(() => {
    applyThemeState(snapshot.state);
  }, [snapshot.state]);

  return {
    activeTheme,
    canImportThemeString,
    systemUiFont: snapshot.state.systemUiFont,
    setSystemUiFont,
    darkTheme,
    defaultActiveTheme,
    exportThemeString,
    followHostTheme: snapshot.state.followHostTheme,
    importThemeString,
    isDefaultActiveTheme,
    isDefaultThemePack,
    lightTheme,
    resetActiveTheme,
    resetAllThemes,
    resetThemeVariant,
    resolvedTheme,
    setCodeThemeId,
    setFollowHostTheme,
    setTheme,
    theme,
    themeState: snapshot.state,
    updateThemeFonts,
    updateThemePack,
  } as const;
}

export type { ChromeTheme, ThemeFonts, ThemeMode, ThemePack, ThemeState, ThemeVariant };
