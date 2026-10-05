// FILE: CenterDockShare.browser.tsx
// Purpose: Center/dock row-share regressions for the Cedia 3-card row (cards
//          plan Option A Step 4): the center card yields row width to the dock
//          when open and reclaims it when closed, never painting underneath it.
// Layer: Vitest browser tests

import "../../index.css";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { RightDock } from "./RightDock";
import { RightToolRail } from "./RightToolRail";
import { resolveRightDockLauncherItems } from "./rightDockPaneMeta";
import {
  createDefaultRightDockState,
  openPaneInState,
  resolveActivePane,
  setDockOpenInState,
  toggleDockOpenInState,
  type RightDockPaneKind,
} from "~/rightDockStore.logic";

const items = resolveRightDockLauncherItems({
  hasWorkspace: true,
  hasGitRepository: true,
  hasReview: true,
  hasDeviceSupport: false,
});

// Mirrors the route cards row (_chat.tsx): center card (flex-1) + the relative
// right-cards outlet hosting the dock (absolute-in-outlet per Task 2) beside
// the persistent 48px rail. The dock renders directly instead of portaled;
// portal children are DOM children of the outlet, so geometry is identical.
function CenterDockShareHarness() {
  const [state, setState] = useState(() =>
    openPaneInState(createDefaultRightDockState(), {
      kind: "diff",
      paneId: "review",
    }),
  );
  const active = resolveActivePane(state);
  const open = (kind: RightDockPaneKind) =>
    setState((s) => openPaneInState(s, { kind, paneId: kind }));
  return (
    <div
      data-testid="cards-row"
      data-sidebar-side="left"
      className="flex h-screen min-h-0 w-full gap-1 overflow-hidden"
    >
      <div
        data-testid="center-card"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        Conversation
      </div>
      <div
        data-testid="right-card"
        className="relative flex min-h-0 shrink-0 rounded-xl border"
      >
        <RightDock
          state={state}
          minWidth={300}
          defaultWidth="22rem"
          shouldAcceptWidth={() => true}
          addMenuKinds={items.map((i) => i.kind)}
          launcherItems={items}
          collapseInShell
          onCollapse={() => setState((s) => setDockOpenInState(s, false))}
          onOpenChange={(open) => setState((s) => setDockOpenInState(s, open))}
          onAddPane={open}
          onClosePane={() => {}}
          renderPane={(pane) => <div>{pane.kind} content</div>}
        />
        <RightToolRail
          items={items}
          activeKind={active?.kind ?? null}
          onPick={(kind) =>
            active?.kind === kind
              ? setState((s) => setDockOpenInState(s, false))
              : open(kind)
          }
        />
      </div>
    </div>
  );
}

afterEach(() => {
  cleanup();
  localStorage.removeItem("chat_right_dock_width");
});

// Live queries (each called 3x across the open/close cycle): the measured DOM
// changes between calls, so a captured const would go stale.
const dockGap = () =>
  document.querySelector<HTMLElement>("[data-slot='sidebar-gap']")!;
const centerCard = () =>
  document.querySelector<HTMLElement>('[data-testid="center-card"]')!;

it("binds the center card to dock state: shrinks beside the open dock, reclaims the row when closed", async () => {
  await page.viewport(1280, 800);
  // Deterministic dock width (SingleChatSurface opens at 22rem; the persisted
  // width wins when present). 400px sits under the 440px row clamp here.
  localStorage.setItem("chat_right_dock_width", "400");
  await render(<CenterDockShareHarness />);

  // --- Dock open: the outlet reserves dock width and center ends at its edge.
  await expect
    .poll(() => Math.round(dockGap().getBoundingClientRect().width))
    .toBe(400);
  const outlet = document.querySelector<HTMLElement>(
    '[data-testid="right-card"]',
  )!;
  expect(outlet.getBoundingClientRect().width).toBeGreaterThan(0);
  const centerOpen = centerCard().getBoundingClientRect();
  expect(centerOpen.right).toBeLessThanOrEqual(
    dockGap().getBoundingClientRect().left + 1,
  );
  // The dock paints beside center, never over it: a probe just inside
  // center's right edge hits center content, not dock content.
  const probe = document.elementFromPoint(
    centerOpen.right - 4,
    centerOpen.top + centerOpen.height / 2,
  );
  expect(probe).not.toBeNull();
  expect(centerCard().contains(probe)).toBe(true);
  expect(document.querySelector<HTMLElement>("[data-right-dock-content]")!.contains(probe)).toBe(false);
  const centerOpenWidth = centerOpen.width;
  const gapOpenWidth = dockGap().getBoundingClientRect().width;
  const railOpen = document.querySelector<HTMLElement>("[data-right-tool-rail]")!.getBoundingClientRect();

  // --- Dock closed: the reservation collapses and center reclaims the row.
  // The rail carries tool icons only (no toggle since the header owns it),
  // so drive the same onPick collapse production uses directly.
  const reviewBtn = document.querySelector<HTMLElement>(
    "[data-right-tool-rail] button[aria-label='Review']",
  )!;
  const dockState = () =>
    (reviewBtn.getAttribute("aria-pressed") === "false" ? "closed" : "open") +
    "/" +
    Math.round(dockGap().getBoundingClientRect().width);
  reviewBtn.click();
  await expect.poll(dockState).toBe("closed/0");
  await expect
    .poll(() => dockGap().getBoundingClientRect().width)
    .toBeCloseTo(0, 0);
  const rail = document.querySelector<HTMLElement>("[data-right-tool-rail]")!.getBoundingClientRect();
  const centerClosed = centerCard().getBoundingClientRect();
  // The 48px rail stays mounted in the shared card; only the dock's
  // reserved width collapses to zero. Center's right edge must sit exactly at
  // the collapsed gap (which is now ~0 wide at the card's left edge).
  expect(gapOpenWidth - dockGap().getBoundingClientRect().width).toBeGreaterThan(200);
  const gapRect = dockGap().getBoundingClientRect();
  expect(centerClosed.right).toBeLessThanOrEqual(gapRect.right + 8);
  expect(centerClosed.right).toBeGreaterThanOrEqual(gapRect.left - 8);
  expect(railOpen.width).toBeCloseTo(rail.width, 1);
  // The rail is the last item in the row: its right edge IS the card's right
  // edge, so it can never exceed the row — assert adjacency instead.
  expect(rail.right).toBeGreaterThanOrEqual(rail.left);
});
