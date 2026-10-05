import { expect, it } from "bun:test";
import {
  resolveRailCarry,
  resolveRailPick,
} from "../vendor/synara/apps/web/src/components/chat/rightToolRail.logic";
import {
  createDefaultRightDockState,
  openPaneInState,
  resolveActivePane,
  setActivePaneInState,
  setDockOpenInState,
  toggleDockOpenInState,
  toggleSingletonPaneInState,
} from "../vendor/synara/apps/web/src/rightDockStore.logic";

it("reopens the retained sidechat instead of creating another fork", () => {
  const withSidechat = openPaneInState(createDefaultRightDockState(), {
    kind: "sidechat",
    paneId: "kept-sidechat",
  });
  const closed = setDockOpenInState(withSidechat, false);
  expect(resolveRailPick(closed, "sidechat")).toEqual({
    action: "select",
    paneId: "kept-sidechat",
  });
  const withBrowser = openPaneInState(withSidechat, {
    kind: "browser",
    paneId: "browser",
  });
  expect(resolveRailPick(withBrowser, "sidechat")).toEqual({
    action: "select",
    paneId: "kept-sidechat",
  });
  expect(resolveRailPick(withSidechat, "sidechat")).toEqual({
    action: "collapse",
  });
  expect(resolveRailPick(createDefaultRightDockState(), "sidechat")).toEqual({
    action: "create",
  });
});

it("carries nothing when the panel was closed", () => {
  expect(
    resolveRailCarry({ prevKind: null, availableKinds: ["terminal"] }),
  ).toEqual({
    action: "none",
  });
});

it("never carries contextual panes across tasks", () => {
  for (const kind of ["sidechat", "file", "pullRequest"] as const) {
    expect(
      resolveRailCarry({ prevKind: kind, availableKinds: ["terminal", kind] }),
    ).toEqual({
      action: "none",
    });
  }
});

it("reopens a re-resolvable tool available to the new task", () => {
  expect(
    resolveRailCarry({
      prevKind: "terminal",
      availableKinds: ["terminal", "browser"],
    }),
  ).toEqual({ action: "open", kind: "terminal" });
});

it("names the specific reason when the tool is unavailable", () => {
  expect(
    resolveRailCarry({ prevKind: "diff", availableKinds: ["terminal"] }),
  ).toEqual({
    action: "skip",
    kind: "diff",
    reason: "There are no changes to review in this task.",
  });
  expect(
    resolveRailCarry({ prevKind: "git", availableKinds: ["terminal"] }).reason,
  ).toMatch(/git repository/);
  expect(
    resolveRailCarry({ prevKind: "explorer", availableKinds: ["terminal"] })
      .reason,
  ).toMatch(/workspace/);
});

it("reuses one singleton pane per thread instead of duplicating it", () => {
  const once = openPaneInState(createDefaultRightDockState(), {
    kind: "terminal",
    paneId: "p1",
  });
  const twice = openPaneInState(once, { kind: "terminal", paneId: "p2" });
  expect(twice.panes.filter((pane) => pane.kind === "terminal")).toHaveLength(
    1,
  );
  expect(twice.open).toBe(true);
  expect(resolveActivePane(twice)?.kind).toBe("terminal");
});

it("collapses on the active icon while keeping panes for reopen", () => {
  const open = openPaneInState(createDefaultRightDockState(), {
    kind: "browser",
    paneId: "p1",
  });
  const collapsed = toggleSingletonPaneInState(open, {
    kind: "browser",
    paneId: "p9",
  });
  expect(collapsed.open).toBe(false);
  expect(collapsed.panes).toHaveLength(1);
  expect(resolveActivePane(collapsed)).toBeNull();
});

it("switches the visible tool without touching other panes", () => {
  const withTerminal = openPaneInState(createDefaultRightDockState(), {
    kind: "terminal",
    paneId: "p1",
  });
  const withBoth = openPaneInState(withTerminal, {
    kind: "browser",
    paneId: "p2",
  });
  const browser = withBoth.panes.find((pane) => pane.kind === "browser");
  const switched = setActivePaneInState(withBoth, browser!.id);
  expect(resolveActivePane(switched)?.kind).toBe("browser");
  expect(switched.panes).toHaveLength(2);
});

it("keeps each task's panes independently owned", () => {
  const taskA = openPaneInState(createDefaultRightDockState(), {
    kind: "terminal",
    paneId: "a1",
  });
  const taskB = openPaneInState(createDefaultRightDockState(), {
    kind: "browser",
    paneId: "b1",
  });
  expect(taskA.panes.map((pane) => pane.id)).toEqual(["a1"]);
  expect(taskB.panes.map((pane) => pane.id)).toEqual(["b1"]);
  const closedA = setDockOpenInState(taskA, false);
  expect(closedA.open).toBe(false);
  expect(taskB.open).toBe(true);
});

it("flips dock visibility without touching panes", () => {
  const open = openPaneInState(createDefaultRightDockState(), {
    kind: "terminal",
    paneId: "p1",
  });
  const closed = toggleDockOpenInState(open);
  expect(closed.open).toBe(false);
  expect(closed.panes).toHaveLength(1);
  expect(resolveActivePane(closed)).toBeNull();
  expect(toggleDockOpenInState(closed).open).toBe(true);
});
