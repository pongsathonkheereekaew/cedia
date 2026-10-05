// FILE: rightToolRail.logic.ts
// Purpose: Pure helpers for the persistent right tool rail (CEDIA-PLAN §3.E, item 71).
// Layer: Chat right-dock UI primitives
// Depends on: right-dock pane kinds only — no store access.
//
// The rail offers launch access; resources stay task-scoped. When the task
// changes with the panel open, the selected tool kind (and only a re-resolvable
// kind) carries to the new task, which reuses its own pane or opens a fresh
// one. Contextual panes (sidechat threads, file paths, pull requests) are
// never carried: their identity belongs to the old task.

import {
  resolveActivePane,
  type RightDockPaneKind,
  type RightDockThreadState,
} from "../../rightDockStore.logic";

export function resolveRailPick(
  state: RightDockThreadState,
  kind: RightDockPaneKind,
):
  | { action: "collapse" }
  | { action: "select"; paneId: string }
  | { action: "create" } {
  if (state.open && resolveActivePane(state)?.kind === kind)
    return { action: "collapse" };
  const existing = state.panes.find((pane) => pane.kind === kind);
  if (existing) return { action: "select", paneId: existing.id };
  return { action: "create" };
}

/** Tool kinds the rail can re-resolve for a new task from the kind alone. */
const RAIL_CARRYABLE_KINDS: ReadonlySet<RightDockPaneKind> = new Set([
  "diff",
  "terminal",
  "browser",
  "explorer",
  "device",
  "git",
]);

const RAIL_UNAVAILABLE_REASONS: Record<RightDockPaneKind, string> = {
  browser: "The browser is unavailable for this task.",
  device: "Simulator support is unavailable on this machine.",
  diff: "There are no changes to review in this task.",
  explorer: "This task has no workspace open.",
  file: "That file belongs to the previous task.",
  terminal: "The terminal is unavailable for this task.",
  sidechat: "That side chat belongs to the previous task.",
  git: "This task is not in a git repository.",
  pullRequest: "That pull request belongs to the previous task.",
};

export type RailCarryDecision =
  | { action: "open"; kind: RightDockPaneKind }
  | { action: "skip"; kind: RightDockPaneKind; reason: string }
  | { action: "none" };

/**
 * Decide what a task switch does to the tool panel. `prevKind` is the
 * previously visible tool (null when the panel was closed — resolved by the
 * caller via `resolveActivePane`, which already folds `open` in).
 */
export function resolveRailCarry(input: {
  prevKind: RightDockPaneKind | null;
  availableKinds: readonly RightDockPaneKind[];
}): RailCarryDecision {
  if (input.prevKind === null) return { action: "none" };
  if (!RAIL_CARRYABLE_KINDS.has(input.prevKind)) return { action: "none" };
  if (input.availableKinds.includes(input.prevKind)) {
    return { action: "open", kind: input.prevKind };
  }
  return {
    action: "skip",
    kind: input.prevKind,
    reason:
      RAIL_UNAVAILABLE_REASONS[input.prevKind] ??
      "That tool isn't available for this task.",
  };
}
