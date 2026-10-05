// FILE: TaskTabs.tsx
// Purpose: Cross-project task-tab strip that replaces the thread-name header while
// the thread panel is closed (CEDIA-PLAN §3.E, item 71).
// Layer: Chat shell header
// Depends on: vendor store, task-tab projection, thread navigation callback.

import type { ThreadId } from "@synara/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { cn } from "~/lib/utils";
import { useStore } from "../../store";
import { createSidebarThreadSummariesSelector } from "../../storeSelectors";
import {
  moveTaskTabOrder,
  normalizeTaskTabOrder,
  orderTaskTabs,
  readTaskTabOrder,
  resolveTaskTabs,
  taskTabOrdersEqual,
  writeTaskTabOrder,
  type TaskTab,
  type TaskTabGroup,
} from "./taskTabs.logic";

const TASK_TAB_DOT_CLASS: Record<TaskTabGroup, string> = {
  attention: "bg-amber-500",
  running: "bg-emerald-500 motion-safe:animate-pulse",
  unseenCompleted: "bg-sky-500",
  active: "bg-muted-foreground/50",
};

/** Window state for the tab strip, read from the same sources as the header. */
export function useTaskTabs(activeThreadId: ThreadId): TaskTab[] {
  const summaries = useStore(useMemo(createSidebarThreadSummariesSelector, []));
  const projects = useStore((state) => state.projects);
  return useMemo(
    () =>
      resolveTaskTabs({
        summaries,
        activeThreadId,
        projectNameById: new Map(
          projects.map((project) => [project.id, project.name]),
        ),
      }),
    [summaries, projects, activeThreadId],
  );
}

export function TaskTabStrip({
  tabs,
  activeThreadId,
  onSelect,
}: {
  tabs: readonly TaskTab[];
  activeThreadId: ThreadId;
  onSelect: (threadId: ThreadId) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [tabOrder, setTabOrder] = useState<ThreadId[]>(() =>
    readTaskTabOrder(),
  );
  const [draggingTab, setDraggingTab] = useState<ThreadId | null>(null);
  const [keyboardGrabbedTab, setKeyboardGrabbedTab] = useState<ThreadId | null>(
    null,
  );
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const draggingTabRef = useRef<ThreadId | null>(null);
  const pointerOverTabRef = useRef<ThreadId | null>(null);
  const pointerStartRef = useRef<[number, number] | null>(null);
  const pointerMovedRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const keyboardOrderSnapshotRef = useRef<ThreadId[] | null>(null);
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const tabIdsKey = tabIds.join("\u0000");
  const orderedTabs = useMemo(
    () => orderTaskTabs(tabs, tabOrder),
    [tabs, tabOrder],
  );

  // Reconcile the local order whenever the authoritative projection adds or
  // removes a tab. This appends new tabs, prunes stale IDs, and keeps the
  // visible order stable while activity groups change underneath it.
  useEffect(() => {
    setTabOrder((current) => {
      const next = normalizeTaskTabOrder(current, tabIds);
      if (taskTabOrdersEqual(current, next)) return current;
      writeTaskTabOrder(next);
      return next;
    });
    setKeyboardGrabbedTab((current) => {
      if (!current || tabIds.includes(current)) return current;
      keyboardOrderSnapshotRef.current = null;
      return null;
    });
  }, [tabIds, tabIdsKey]);

  const reorderTabs = useCallback(
    (activeId: ThreadId, overId: ThreadId) => {
      setTabOrder((current) => {
        const next = moveTaskTabOrder(current, activeId, overId, tabIds);
        if (taskTabOrdersEqual(current, next)) return current;
        writeTaskTabOrder(next);
        return next;
      });
    },
    [tabIds, tabIdsKey],
  );

  const clearPointerDrag = useCallback(() => {
    pointerIdRef.current = null;
    draggingTabRef.current = null;
    pointerOverTabRef.current = null;
    pointerStartRef.current = null;
    pointerMovedRef.current = false;
    setDraggingTab(null);
  }, []);

  const cancelPointerDrag = useCallback(() => {
    if (pointerIdRef.current === null) return;
    // A blur/cancel/Escape is not a completed drag. Clear the click guard so
    // the next ordinary click or keyboard activation is delivered normally.
    suppressClickRef.current = false;
    clearPointerDrag();
  }, [clearPointerDrag]);

  useEffect(() => {
    const updatePointerTarget = (event: globalThis.PointerEvent) => {
      const target = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest<HTMLElement>("[data-task-tab]"))
        .find((element) => element && !!listRef.current?.contains(element));
      const id = target?.dataset.taskTab;
      pointerOverTabRef.current = id ? (id as ThreadId) : null;
    };
    const onPointerMove = (event: globalThis.PointerEvent) => {
      const activeTab = draggingTabRef.current;
      const start = pointerStartRef.current;
      if (!activeTab || !start || event.pointerId !== pointerIdRef.current)
        return;
      if (
        !pointerMovedRef.current &&
        Math.hypot(event.clientX - start[0], event.clientY - start[1]) < 4
      ) {
        return;
      }
      pointerMovedRef.current = true;
      updatePointerTarget(event);
      setDraggingTab(activeTab);
    };
    const onPointerUp = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      suppressClickRef.current = pointerMovedRef.current;
      updatePointerTarget(event);
      const activeTab = draggingTabRef.current;
      const overTab = pointerOverTabRef.current;
      if (
        activeTab &&
        overTab &&
        activeTab !== overTab &&
        pointerMovedRef.current
      ) {
        reorderTabs(activeTab, overTab);
      }
      clearPointerDrag();
    };
    const onPointerCancel = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      cancelPointerDrag();
    };
    const onWindowBlur = () => {
      cancelPointerDrag();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") cancelPointerDrag();
    };
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") cancelPointerDrag();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("keydown", onWindowKeyDown);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("keydown", onWindowKeyDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cancelPointerDrag, clearPointerDrag, reorderTabs]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeThreadId, tabs.length]);

  const focusTab = (threadId: ThreadId) => {
    const target = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[data-task-tab]") ??
        [],
    ).find((button) => button.dataset.taskTab === threadId);
    target?.focus();
  };

  const focusAdjacentTab = (tab: TaskTab, direction: -1 | 1) => {
    const currentIndex = orderedTabs.findIndex(
      (candidate) => candidate.id === tab.id,
    );
    const target = orderedTabs[currentIndex + direction];
    if (target) focusTab(target.id);
  };

  const focusBoundaryTab = (last: boolean) => {
    const target = last ? orderedTabs.at(-1) : orderedTabs[0];
    if (target) focusTab(target.id);
  };

  const moveWithKeyboard = (tab: TaskTab, direction: -1 | 1) => {
    const currentIndex = orderedTabs.findIndex(
      (candidate) => candidate.id === tab.id,
    );
    const target = orderedTabs[currentIndex + direction];
    if (!target) return;
    reorderTabs(tab.id, target.id);
    setLiveAnnouncement(
      `Moved ${tab.title} to position ${currentIndex + direction + 1} of ${orderedTabs.length}.`,
    );
  };

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: TaskTab,
  ) => {
    const horizontalDirection =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (
      horizontalDirection !== 0 &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      moveWithKeyboard(tab, horizontalDirection);
      return;
    }
    if (
      event.key === " " &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      const grabbed = keyboardGrabbedTab === tab.id;
      if (!grabbed) {
        keyboardOrderSnapshotRef.current = orderedTabs.map((entry) => entry.id);
      } else {
        keyboardOrderSnapshotRef.current = null;
      }
      setKeyboardGrabbedTab(grabbed ? null : tab.id);
      setLiveAnnouncement(
        grabbed
          ? `Dropped ${tab.title}.`
          : `Grabbed ${tab.title}. Use Alt plus Arrow Left or Arrow Right to move it, then press Space to drop.`,
      );
      return;
    }
    if (keyboardGrabbedTab === tab.id) {
      if (horizontalDirection !== 0) {
        event.preventDefault();
        moveWithKeyboard(tab, horizontalDirection);
      } else if (event.key === "Escape") {
        event.preventDefault();
        const snapshot = keyboardOrderSnapshotRef.current;
        if (snapshot) {
          setTabOrder((current) => {
            const restored = normalizeTaskTabOrder(snapshot, tabIds);
            if (taskTabOrdersEqual(current, restored)) return current;
            writeTaskTabOrder(restored);
            return restored;
          });
        }
        keyboardOrderSnapshotRef.current = null;
        setKeyboardGrabbedTab(null);
        setLiveAnnouncement(`Cancelled moving ${tab.title}.`);
      }
      return;
    }
    if (
      horizontalDirection !== 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      focusAdjacentTab(tab, horizontalDirection);
    } else if (
      (event.key === "Home" || event.key === "End") &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      focusBoundaryTab(event.key === "End");
    }
  };

  return (
    <>
      <div
        ref={listRef}
        role="tablist"
        aria-label="Tasks"
        className="flex min-w-16 flex-1 items-center gap-1 overflow-x-auto"
      >
        {orderedTabs.map((tab) => {
          const selected = tab.id === activeThreadId;
          const isDragging =
            draggingTab === tab.id || keyboardGrabbedTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              aria-grabbed={keyboardGrabbedTab === tab.id ? "true" : undefined}
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Space"
              data-task-tab={tab.id}
              draggable={false}
              title={
                tab.projectName
                  ? `${tab.title} — ${tab.projectName}`
                  : tab.title
              }
              onDragStart={(event) => event.preventDefault()}
              onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
                suppressClickRef.current = false;
                if (event.button !== 0 || orderedTabs.length < 2) return;
                pointerIdRef.current = event.pointerId;
                draggingTabRef.current = tab.id;
                pointerOverTabRef.current = tab.id;
                pointerStartRef.current = [event.clientX, event.clientY];
                pointerMovedRef.current = false;
              }}
              onKeyDown={(event) => onTabKeyDown(event, tab)}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                if (!selected) onSelect(tab.id);
              }}
              className={cn(
                "flex h-7 max-w-44 min-w-0 shrink-0 select-none items-center gap-1.5 rounded-md px-2 font-system-ui text-[length:var(--app-font-size-ui,12px)] touch-none",
                selected
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                isDragging && "cursor-grabbing opacity-50",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  TASK_TAB_DOT_CLASS[tab.group],
                )}
              />
              <span className="min-w-0 truncate font-normal">{tab.title}</span>
              {tab.projectName ? (
                <span className="shrink-0 truncate text-[10px] opacity-60">
                  {tab.projectName}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
    </>
  );
}
