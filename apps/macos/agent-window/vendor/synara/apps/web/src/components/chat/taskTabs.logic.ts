// FILE: taskTabs.logic.ts
// Purpose: Pure state-derived cross-project task-tab projection (CEDIA-PLAN §3.E, item 71).
// Layer: Chat shell header
// Depends on: sidebar thread summaries, activity classification, no store access.
//
// The strip replaces the thread-name header while the thread panel is closed so
// running work, pending answers/approvals and unfinished tasks stay reachable
// without reopening the panel. Tabs derive from authoritative task state, never
// from accumulated browsing history, and a toggle never navigates away: the
// selected thread is always retained as one tab.

import type { ProjectId, ThreadId } from "@synara/contracts";
import {
  isActivityThread,
  resolveActivityStatusGroup,
} from "../SidebarActivityView.logic";
import { hasUnseenCompletion } from "../Sidebar.logic";
import type { SidebarThreadSummary } from "../../types";

export type TaskTabGroup =
  "attention" | "running" | "unseenCompleted" | "active";

export interface TaskTab {
  id: ThreadId;
  title: string;
  projectId: ProjectId;
  projectName: string | null;
  group: TaskTabGroup;
  active: boolean;
}

/**
 * The task-tab strip is a local UI preference. Keep it outside the execution
 * stores so reordering tabs never changes task/session state on the host.
 */
export const TASK_TAB_ORDER_STORAGE_KEY = "cedia:ui:task-tab-order:v1";

type TaskTabOrderStorage = Pick<Storage, "getItem" | "setItem">;

function localTaskTabOrderStorage(): TaskTabOrderStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Private browsing and locked-down webviews can deny storage access. The
    // tab strip remains usable for the current mount in that case.
    return null;
  }
}

export function readTaskTabOrder(
  storage: TaskTabOrderStorage | null = localTaskTabOrderStorage(),
): ThreadId[] {
  if (!storage) return [];
  try {
    const value: unknown = JSON.parse(
      storage.getItem(TASK_TAB_ORDER_STORAGE_KEY) ?? "null",
    );
    if (!Array.isArray(value)) return [];
    return value.filter(
      (id): id is ThreadId => typeof id === "string" && id.trim() !== "",
    );
  } catch {
    return [];
  }
}

export function writeTaskTabOrder(
  order: readonly ThreadId[],
  storage: TaskTabOrderStorage | null = localTaskTabOrderStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(TASK_TAB_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Storage is an enhancement; a quota or permission failure must not make
    // changing the selected thread impossible.
  }
}

type TaskTabIdentity = Pick<TaskTab, "id">;
type AvailableTaskTabs = readonly ThreadId[] | readonly TaskTabIdentity[];

function taskTabIds(available: AvailableTaskTabs): ThreadId[] {
  return available.map((tab) => (typeof tab === "string" ? tab : tab.id));
}

function sameTaskTabOrder(
  left: readonly ThreadId[],
  right: readonly ThreadId[],
): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

/**
 * Retain known IDs in the user's order, remove stale/duplicate IDs, and append
 * newly visible tabs in their current projection order.
 */
export function normalizeTaskTabOrder(
  order: readonly ThreadId[],
  available: AvailableTaskTabs,
): ThreadId[] {
  const availableIds = taskTabIds(available);
  const availableSet = new Set(availableIds);
  const seen = new Set<ThreadId>();
  const normalized: ThreadId[] = [];
  for (const id of order) {
    if (availableSet.has(id) && !seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  for (const id of availableIds) {
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  return normalized;
}

/** Apply a persisted/local UI order to the currently visible task tabs. */
export function orderTaskTabs(
  tabs: readonly TaskTab[],
  order: readonly ThreadId[],
): TaskTab[] {
  const byId = new Map<ThreadId, TaskTab>();
  for (const tab of tabs) {
    if (!byId.has(tab.id)) byId.set(tab.id, tab);
  }
  return normalizeTaskTabOrder(order, tabs).flatMap((id) => {
    const tab = byId.get(id);
    return tab ? [tab] : [];
  });
}

/**
 * Move one visible tab across another and return a new normalized order. When
 * dragging/using ArrowRight over a tab that was ahead of it, the moved tab
 * lands after that target; moving left lands before it. This makes the same
 * operation work for both pointer and keyboard reordering.
 */
export function moveTaskTabOrder(
  order: readonly ThreadId[],
  activeId: ThreadId,
  overId: ThreadId,
  available: AvailableTaskTabs,
): ThreadId[] {
  const next = normalizeTaskTabOrder(order, available);
  if (activeId === overId) return next;
  const activeIndex = next.indexOf(activeId);
  const overIndex = next.indexOf(overId);
  if (activeIndex < 0 || overIndex < 0) return next;
  const movingForward = activeIndex < overIndex;
  next.splice(activeIndex, 1);
  const targetIndex = next.indexOf(overId);
  next.splice(movingForward ? targetIndex + 1 : targetIndex, 0, activeId);
  return next;
}

export function taskTabOrdersEqual(
  left: readonly ThreadId[],
  right: readonly ThreadId[],
): boolean {
  return sameTaskTabOrder(left, right);
}

const TASK_TAB_GROUP_ORDER: Record<TaskTabGroup, number> = {
  attention: 0,
  running: 1,
  unseenCompleted: 2,
  active: 3,
};

function isSettled(summary: Pick<SidebarThreadSummary, "settledAt">): boolean {
  return summary.settledAt != null;
}

export function resolveTaskTabs(input: {
  summaries: readonly SidebarThreadSummary[];
  activeThreadId: ThreadId | null;
  projectNameById: ReadonlyMap<ProjectId, string>;
  settledOverrideByThreadId?: ReadonlyMap<ThreadId, boolean>;
}): TaskTab[] {
  const seen = new Set<ThreadId>();
  const tabs: TaskTab[] = [];
  for (const summary of input.summaries) {
    if (seen.has(summary.id)) continue;
    seen.add(summary.id);
    const active =
      input.activeThreadId != null && summary.id === input.activeThreadId;
    if (!active) {
      if (summary.archivedAt != null) continue;
      if (summary.sidechatSourceThreadId != null) continue;
      if (!isActivityThread(summary)) continue;
      const settled =
        input.settledOverrideByThreadId?.get(summary.id) ?? isSettled(summary);
      // Completed (settled and already reviewed) threads leave the strip; an
      // unseen completion stays because it still needs a look.
      if (settled && !hasUnseenCompletion(summary)) continue;
    }
    const statusGroup = resolveActivityStatusGroup(summary);
    const group: TaskTabGroup =
      statusGroup === "attention"
        ? "attention"
        : statusGroup === "running"
          ? "running"
          : statusGroup === "unseenCompleted"
            ? "unseenCompleted"
            : "active";
    const title = summary.title.trim() === "" ? "Untitled" : summary.title;
    tabs.push({
      id: summary.id,
      title,
      projectId: summary.projectId,
      projectName: input.projectNameById.get(summary.projectId) ?? null,
      group,
      active,
    });
  }
  tabs.sort((a, b) => {
    const order = TASK_TAB_GROUP_ORDER[a.group] - TASK_TAB_GROUP_ORDER[b.group];
    if (order !== 0) return order;
    if (a.title !== b.title) return a.title < b.title ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return tabs;
}
