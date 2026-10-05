import { expect, it } from "bun:test";
import type { ThreadId } from "../vendor/synara/packages/contracts/src/baseSchemas";
import {
  moveTaskTabOrder,
  normalizeTaskTabOrder,
  orderTaskTabs,
  resolveTaskTabs,
  type TaskTab,
} from "../vendor/synara/apps/web/src/components/chat/taskTabs.logic";
import type { SidebarThreadSummary } from "../vendor/synara/apps/web/src/types";

let seq = 0;
function summary(
  overrides: Partial<SidebarThreadSummary> = {},
): SidebarThreadSummary {
  seq += 1;
  return {
    id: `thread-${seq}`,
    projectId: "project-a",
    title: `Task ${seq}`,
    modelSelection: { provider: "opencode-go" },
    interactionMode: "agent",
    branch: null,
    worktreePath: null,
    session: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    latestTurn: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    hasLiveTailWork: false,
    ...overrides,
  } as SidebarThreadSummary;
}

function liveTurn() {
  return {
    turnId: "turn-1",
    state: "running",
    requestedAt: "2026-10-02T00:00:00.000Z",
    startedAt: "2026-10-02T00:01:00.000Z",
    completedAt: null,
  };
}

function settledTurn() {
  return {
    turnId: "turn-1",
    state: "completed",
    requestedAt: "2026-10-02T00:00:00.000Z",
    startedAt: "2026-10-02T00:01:00.000Z",
    completedAt: "2026-10-02T00:02:00.000Z",
  };
}

const names = new Map([["project-a", "Alpha"]]);

function threadId(value: string): ThreadId {
  return value as ThreadId;
}

function tab(id: string, title = id): TaskTab {
  return {
    id: threadId(id),
    title,
    projectId: "project-a",
    projectName: "Alpha",
    group: "active",
    active: false,
  };
}

it("includes running work in the running group", () => {
  const running = summary({ hasLiveTailWork: true, latestTurn: liveTurn() });
  const tabs = resolveTaskTabs({
    summaries: [running],
    activeThreadId: null,
    projectNameById: names,
  });
  expect(tabs.map((t) => t.id)).toEqual([running.id]);
  expect(tabs[0]?.group).toBe("running");
});

it("surfaces pending approvals as attention while the session can answer", () => {
  const pending = summary({
    hasPendingApprovals: true,
    latestTurn: settledTurn(),
    session: { status: "idle", orchestrationStatus: "idle" },
  });
  const tabs = resolveTaskTabs({
    summaries: [pending],
    activeThreadId: null,
    projectNameById: names,
  });
  expect(tabs.map((t) => t.id)).toEqual([pending.id]);
  expect(tabs[0]?.group).toBe("attention");
});

it("keeps stopped but unsettled work on the strip", () => {
  const stopped = summary({
    latestTurn: settledTurn(),
    lastVisitedAt: "2026-10-02T00:03:00.000Z",
  });
  const tabs = resolveTaskTabs({
    summaries: [stopped],
    activeThreadId: null,
    projectNameById: names,
  });
  expect(tabs.map((t) => t.id)).toEqual([stopped.id]);
  expect(tabs[0]?.group).toBe("active");
});

it("drops settled-and-reviewed threads but keeps unseen completions", () => {
  const reviewed = summary({
    latestTurn: settledTurn(),
    settledAt: "2026-10-02T00:04:00.000Z",
    lastVisitedAt: "2026-10-02T00:05:00.000Z",
  });
  const unseen = summary({
    latestTurn: settledTurn(),
    settledAt: "2026-10-02T00:04:00.000Z",
  });
  const tabs = resolveTaskTabs({
    summaries: [reviewed, unseen],
    activeThreadId: null,
    projectNameById: names,
  });
  expect(tabs.map((t) => t.id)).toEqual([unseen.id]);
  expect(tabs[0]?.group).toBe("unseenCompleted");
});

it("excludes archived, sidechat, automation-run and draft threads", () => {
  const threads = [
    summary({
      archivedAt: "2026-10-02T00:00:00.000Z",
      latestTurn: settledTurn(),
    }),
    summary({ sidechatSourceThreadId: "thread-0", latestTurn: settledTurn() }),
    summary({ parentThreadId: "thread-0", latestTurn: settledTurn() }),
    summary({ title: "Draft" }),
  ];
  const tabs = resolveTaskTabs({
    summaries: threads,
    activeThreadId: null,
    projectNameById: names,
  });
  expect(tabs).toEqual([]);
});

it("always retains the selected thread, even archived or draft", () => {
  const archived = summary({
    archivedAt: "2026-10-02T00:00:00.000Z",
    latestTurn: settledTurn(),
  });
  const draft = summary({ title: "Draft" });
  const forArchived = resolveTaskTabs({
    summaries: [archived],
    activeThreadId: archived.id,
    projectNameById: names,
  });
  expect(forArchived.map((t) => t.id)).toEqual([archived.id]);
  expect(forArchived[0]?.active).toBe(true);
  const forDraft = resolveTaskTabs({
    summaries: [draft],
    activeThreadId: draft.id,
    projectNameById: names,
  });
  expect(forDraft.map((t) => t.id)).toEqual([draft.id]);
});

it("deduplicates by thread identity", () => {
  const thread = summary({ hasLiveTailWork: true, latestTurn: liveTurn() });
  const tabs = resolveTaskTabs({
    summaries: [thread, { ...thread }],
    activeThreadId: null,
    projectNameById: names,
  });
  expect(tabs.map((t) => t.id)).toEqual([thread.id]);
});

it("orders attention before running before the rest", () => {
  const stopped = summary({
    title: "B stopped",
    latestTurn: settledTurn(),
    lastVisitedAt: "2026-10-02T00:03:00.000Z",
  });
  const running = summary({
    title: "C running",
    hasLiveTailWork: true,
    latestTurn: liveTurn(),
  });
  const pending = summary({
    title: "A pending",
    hasPendingUserInput: true,
    latestTurn: settledTurn(),
    session: { status: "idle", orchestrationStatus: "idle" },
  });
  const tabs = resolveTaskTabs({
    summaries: [stopped, running, pending],
    activeThreadId: null,
    projectNameById: names,
  });
  expect(tabs.map((t) => t.title)).toEqual([
    "A pending",
    "C running",
    "B stopped",
  ]);
});

it("labels tabs with their project name and falls back without one", () => {
  const known = summary({ hasLiveTailWork: true, latestTurn: liveTurn() });
  const unknown = summary({
    projectId: "project-zzz",
    hasLiveTailWork: true,
    latestTurn: liveTurn(),
  });
  const tabs = resolveTaskTabs({
    summaries: [known, unknown],
    activeThreadId: null,
    projectNameById: names,
  });
  expect(tabs.find((t) => t.id === known.id)?.projectName).toBe("Alpha");
  expect(tabs.find((t) => t.id === unknown.id)?.projectName).toBeNull();
});

it("honours a settled override map", () => {
  const thread = summary({
    latestTurn: settledTurn(),
    lastVisitedAt: "2026-10-02T00:03:00.000Z",
  });
  const open = resolveTaskTabs({
    summaries: [thread],
    activeThreadId: null,
    projectNameById: names,
  });
  expect(open).toHaveLength(1);
  const closed = resolveTaskTabs({
    summaries: [thread],
    activeThreadId: null,
    projectNameById: names,
    settledOverrideByThreadId: new Map([[thread.id, true]]),
  });
  expect(closed).toEqual([]);
});

it("normalizes a saved order by pruning stale IDs and appending new tabs", () => {
  expect(
    normalizeTaskTabOrder(
      [threadId("thread-3"), threadId("missing"), threadId("thread-3")],
      [
        threadId("thread-1"),
        threadId("thread-2"),
        threadId("thread-3"),
        threadId("thread-4"),
      ],
    ),
  ).toEqual([
    threadId("thread-3"),
    threadId("thread-1"),
    threadId("thread-2"),
    threadId("thread-4"),
  ]);
});

it("moves a tab before a target when moving backwards without mutating the saved order", () => {
  const saved = [
    threadId("thread-1"),
    threadId("thread-2"),
    threadId("thread-3"),
  ];
  expect(
    moveTaskTabOrder(saved, threadId("thread-3"), threadId("thread-1"), saved),
  ).toEqual([threadId("thread-3"), threadId("thread-1"), threadId("thread-2")]);
  expect(saved).toEqual([
    threadId("thread-1"),
    threadId("thread-2"),
    threadId("thread-3"),
  ]);
});

it("lands after a target when moving forward through the tab strip", () => {
  expect(
    moveTaskTabOrder(
      [threadId("thread-1"), threadId("thread-2"), threadId("thread-3")],
      threadId("thread-1"),
      threadId("thread-3"),
      [threadId("thread-1"), threadId("thread-2"), threadId("thread-3")],
    ),
  ).toEqual([threadId("thread-2"), threadId("thread-3"), threadId("thread-1")]);
});

it("applies the persisted order while retaining current tab metadata", () => {
  const tabs = [
    tab("thread-1", "One"),
    tab("thread-2", "Two"),
    tab("thread-3", "Three"),
  ];
  const ordered = orderTaskTabs(tabs, [
    threadId("thread-3"),
    threadId("thread-1"),
  ]);
  expect(ordered.map((entry) => entry.id)).toEqual([
    threadId("thread-3"),
    threadId("thread-1"),
    threadId("thread-2"),
  ]);
  expect(ordered[0]?.title).toBe("Three");
});
