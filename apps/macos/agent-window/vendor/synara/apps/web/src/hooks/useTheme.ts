// FILE: useTheme.ts
// Purpose: Persists the theme store and projects the IDE workbench theme into DOM CSS variables.
// Layer: Web appearance state hook
// Exports: useTheme for the resolved variant and the system-font toggle.
//
// Cedia §10 item 54: this window has ONE theme authority — the IDE's
// `workbench.colorTheme`, delivered as a host snapshot. The mode picker, the
// follow toggle and the pack editor are cut; `Cedia's host-theme-tokens.ts`
// maps the snapshot's anchors onto the tokens the pack layer paints as its
// fallback. Everything the window still edits here is typography.

import { useEffect, useSyncExternalStore } from "react";
import { isElectron } from "../env";
import { isIdeEmbeddedRuntime } from "../ide-mode";
import { isMacNavigatorPlatform } from "../lib/utils";
import { HOST_THEME_TOKEN_SOURCES, applyHostThemeTokens as paintHostThemeTokens } from "../../../../../../src/host-theme-tokens.ts";
import {
  DEFAULT_THEME_STATE,
  type ChromeTheme,
  type ThemeFonts,
  type ThemeMode,
  type ThemePack,
  type ThemeState,
  type ThemeVariant,
  areThemePacksEqual,
  packForIdeThemeName,
  buildThemeCssVariables,
  parseStoredThemeState,
  resolveThemePack,
  resolveThemeVariant,
  serializeThemeState,
  setThemeCodeThemeId,
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

const HOST_THEME_COLOR_LIMIT = 160;
const SAFE_HOST_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z-]+\([^;{}]+\)|[a-z]+)$/i;
// The anchor-to-token map is Cedia's (§10 item 54): it lives in the app's own
// source so theme authority is decided outside the ported surface, and the
// completeness rule over the pack's emitted tokens is a Cedia test.
const HOST_TOKEN_SOURCES = HOST_THEME_TOKEN_SOURCES;
const HOST_ANCHOR_NAMES = new Set<string>(Object.values(HOST_THEME_TOKEN_SOURCES).flat());

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
  // The IDE's workbench.colorTheme is the ONLY theme this window has (Cedia
  // §10 item 54: one theme authority end to end). There is no unlink: the
  // agent window has no theme editor, no mode picker and no pack catalog, so
  // the snapshot always wins and the stored packs are only the fallback used
  // before the first snapshot arrives (browser runs, first paint).
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
  // The map and the application live in Cedia's own source (§10 item 54); the
  // overridden names are tracked so re-projecting a pack can remove exactly
  // what this added.
  for (const name of paintHostThemeTokens(root.style, snapshot)) hostTokenOverrideNames.add(name);
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
  // With the IDE as the authority, "system" resolves to the IDE snapshot when
  // there is one and to the OS only before the first snapshot arrives.
  const hostTheme = readHostThemeSnapshot();
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
  // The host paints last, over the pack: same variant means same palette.
  if (hostTheme && variant === hostTheme.mode) applyHostThemeTokens(root, hostTheme);

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

function setSystemUiFont(enabled: boolean) {
  updateStoredThemeState((state) => ({
    ...state,
    systemUiFont: enabled,
  }));
}

/** The window's theme, as the IDE defines it.
 *
 * Only the resolved variant is exposed: the window renders the pack layer the
 * host snapshot painted over, and the only appearance choice left to the user
 * is the system-font toggle (§10 item 54 cut the mode picker, the follow toggle
 * and the pack editor; nothing else here had a consumer).
 */
export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => ({
    state: DEFAULT_THEME_STATE,
    systemDark: false,
  }));
  const resolvedTheme = resolveThemeVariant(snapshot.state.mode, snapshot.systemDark);

  // Keep the DOM synced if something bypassed the immediate module-load apply.
  useEffect(() => {
    applyThemeState(snapshot.state);
  }, [snapshot.state]);

  return {
    resolvedTheme,
    setSystemUiFont,
    systemUiFont: snapshot.state.systemUiFont,
  } as const;
}

export type { ChromeTheme, ThemeMode, ThemeState, ThemeVariant };
