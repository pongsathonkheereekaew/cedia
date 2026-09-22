import { AGENT_THEME_COLOR_SET } from "./agent-theme-anchors.ts";
import { agentUiStateDir, readAgentUiState, writeAgentUiState } from "./agent-ui-state.ts";

/** The small, renderer-safe part of the active Code-OSS theme shared with the
 * standalone Agent window.  The embedded renderer may add effective
 * `--vscode-*` values; the extension always supplies mode/name as a fallback. */
export interface AgentThemeSnapshot {
  readonly mode: "light" | "dark";
  /** Display name only; the effective CSS colors remain authoritative. */
  readonly themeName?: string;
  readonly colors?: Readonly<Record<string, string>>;
}

const MAX_THEME_NAME = 128;
const MAX_COLOR_VALUE = 256;
/** The snapshot carries every anchor the bundle can paint from (78 today); the
 * cap is a sanity bound on the sanitised payload size, not a palette budget. */
const MAX_COLORS = 160;
const SAFE_COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\([^;{}]+\)|[a-z]+)$/i;
export { AGENT_THEME_COLOR_KEYS } from "./agent-theme-anchors.ts";


function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Validate data arriving from a webview before it is persisted for another
 * renderer.  CSS variable names are deliberately limited to the shared anchor
 * list (`agent-theme-anchors.ts`); this file is not an arbitrary style
 * injection channel. Every anchor the bundle's map consumes must be listed
 * there or it is dropped here, before the bundle ever sees it. */
export function normalizeAgentThemeSnapshot(value: unknown): AgentThemeSnapshot | undefined {
  const row = record(value);
  if (!row || (row.mode !== "light" && row.mode !== "dark")) return undefined;
  const themeName = typeof row.themeName === "string" && row.themeName.trim().length > 0
    ? row.themeName.trim().slice(0, MAX_THEME_NAME)
    : undefined;
  const colors: Record<string, string> = {};
  const input = record(row.colors);
  if (input) {
    for (const [name, raw] of Object.entries(input)) {
      if (!AGENT_THEME_COLOR_SET.has(name) || typeof raw !== "string") continue;
      const color = raw.trim().slice(0, MAX_COLOR_VALUE);
      if (color.length > 0 && SAFE_COLOR_VALUE.test(color) && !/url\s*\(/i.test(color)) colors[name] = color;
      if (Object.keys(colors).length >= MAX_COLORS) break;
    }
  }
  return {
    mode: row.mode,
    ...(themeName ? { themeName } : {}),
    ...(Object.keys(colors).length > 0 ? { colors } : {}),
  };
}

export async function writeAgentThemeSnapshot(stateDir: string | undefined, value: unknown): Promise<void> {
  const normalized = normalizeAgentThemeSnapshot(value);
  if (!normalized) return;
  const previous = normalized.colors ? undefined : await readAgentThemeSnapshot(stateDir);
  const snapshot = previous?.mode === normalized.mode && previous.themeName === normalized.themeName && previous.colors
    ? { ...normalized, colors: previous.colors } : normalized;
  await writeAgentUiState(agentUiStateDir(stateDir), "host-theme", snapshot);
}

export async function readAgentThemeSnapshot(stateDir: string | undefined): Promise<AgentThemeSnapshot | undefined> {
  try {
    return normalizeAgentThemeSnapshot(await readAgentUiState(agentUiStateDir(stateDir), "host-theme"));
  } catch {
    // A corrupt or partially written snapshot should never prevent the Agent
    // window from opening; the renderer falls back to its own system theme.
    return undefined;
  }
}
