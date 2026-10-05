import "../../index.css";
import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { RightDock } from "./RightDock";
import { RightToolRail } from "./RightToolRail";
import { resolveRightDockLauncherItems } from "./rightDockPaneMeta";
import {
  createDefaultRightDockState,
  closePaneInState,
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
function Harness({ empty = false }: { empty?: boolean }) {
  const [state, setState] = useState(() =>
    empty
      ? createDefaultRightDockState()
      : openPaneInState(createDefaultRightDockState(), {
          kind: "diff",
          paneId: "review",
        }),
  );
  const active = resolveActivePane(state);
  const open = (kind: RightDockPaneKind) =>
    setState((s) => openPaneInState(s, { kind, paneId: kind }));
  // Mirrors the route cards row (_chat.tsx): ONE shared card (ChatRightCards in
  // SingleChatSurface) holds the dock + rail as siblings — no second card edge
  // between them, and the ONLY Toggle right sidebar control lives in the
  // window header here (production) so the rail carries tool icons only.
  // The data-sidebar-side="left" shell gives the maxDockWidth observer the
  // same anchors production uses (shell minus left sidebar minus rail, 440px cap).
  return (
    <div
      data-sidebar-side="left"
      className="relative flex h-screen w-full min-w-0 overflow-hidden"
    >
      {/* Test-only header toggle: absolute overlay so it takes no row
          width (production owns this in the window header). */}
      <button
        type="button"
        aria-label="Toggle right sidebar"
        aria-pressed={state.open}
        className="absolute left-0 top-0 z-10"
        onClick={() => setState(toggleDockOpenInState)}
      >
        Toggle
      </button>
      <main className="min-w-0 flex-1">Conversation</main>
      <div data-testid="right-card" className="relative flex min-h-0 min-w-0 shrink-0 overflow-hidden rounded-xl border">
        <RightDock
          state={state}
          minWidth={300}
          defaultWidth="400px"
          shouldAcceptWidth={() => true}
          addMenuKinds={items.map((i) => i.kind)}
          launcherItems={items}
          collapseInShell
          onCollapse={() => setState((s) => setDockOpenInState(s, false))}
          onOpenChange={(open) => setState((s) => setDockOpenInState(s, open))}
          onAddPane={open}
          onClosePane={(paneId) => setState((s) => closePaneInState(s, paneId))}
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
  document.documentElement.classList.remove("dark");
  localStorage.removeItem("chat_right_dock_width");
});
it("keeps the shared card whole: panel content stays left of the rail", async () => {
  await page.viewport(1200, 800);
  await render(<Harness />);
  const rail = page
    .getByRole("toolbar", { name: "Tools", exact: true })
    .element();
  await expect
    .poll(() => {
      const panel = document.querySelector("[data-right-dock-content]")!;
      return (
        panel.getBoundingClientRect().right <=
        rail.getBoundingClientRect().left + 1
      );
    })
    .toBe(true);
  // No in-card maximize anymore: the rail stays visible and interactive in
  // every dock state (never inert on the Sidebar root).
  await expect
    .element(page.getByRole("toolbar", { name: "Tools", exact: true }))
    .toBeVisible();
  expect((rail as HTMLElement).inert).toBe(false);
  expect(
    document.querySelector("[data-right-dock-content]")!.getBoundingClientRect()
      .right,
  ).toBeLessThanOrEqual(rail.getBoundingClientRect().left + 1);
});
it("header toggle and Review reopen and collapse one panel with keyboard access", async () => {
  await page.viewport(1200, 800);
  await render(<Harness />);
  const toggle = page.getByRole("button", {
    name: "Toggle right sidebar",
    exact: true,
  });
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  expect(
    page.getByText("diff content", { exact: true }).elements(),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  (toggle.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
});

it("opens the launcher on a fresh task without creating a Review tab", async () => {
  await page.viewport(900, 700);
  await render(<Harness empty />);
  await page
    .getByRole("button", { name: "Toggle right sidebar", exact: true })
    .click();
  await expect
    .element(page.getByRole("navigation", { name: "Open a panel" }))
    .toBeVisible();
  expect(
    page.getByText("diff content", { exact: true }).elements(),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const content = document.querySelector("[data-right-dock-content]")!;
  await expect.poll(() => content.textContent ?? "").toContain("diff content");
  const rail = page
    .getByRole("toolbar", { name: "Tools", exact: true })
    .element();
  expect(
    document.querySelector("[data-right-dock-content]")!.getBoundingClientRect()
      .right,
  ).toBeLessThanOrEqual(rail.getBoundingClientRect().left + 1);
  const review = page
    .getByRole("button", { name: "Review", exact: true })
    .element();
  const rect = review.getBoundingClientRect();
  expect(
    review.contains(
      document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      ),
    ),
  ).toBe(true);
});

it("keeps the single pane tab visible so it can be closed", async () => {
  await page.viewport(900, 700);
  await render(<Harness />);

  await expect.element(page.getByText("Diff", { exact: true })).toBeVisible();
  const closeDiff = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Close Diff"]',
  );
  expect(closeDiff).not.toBeNull();
  closeDiff!.click();
  await expect
    .element(page.getByRole("navigation", { name: "Open a panel" }))
    .toBeVisible();
  expect(page.getByText("diff content", { exact: true }).elements()).toHaveLength(0);

  await page.getByRole("button", { name: "Review", exact: true }).click();
  expect(
    document.querySelector('button[aria-label="Close Diff"]'),
  ).not.toBeNull();
});

it.each(["light", "dark"])(
  "slides the shared card beside the rail without sweeping under it (%s)",
  async (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    await page.viewport(1200, 800);
    await render(<Harness />);
    const card = document.querySelector<HTMLElement>('[data-testid="right-card"]')!;
    const panel = document.querySelector("[data-right-dock-content]")!;
    const toggle = page.getByRole("button", {
      name: "Toggle right sidebar",
      exact: true,
    });
    // Width-driven drawer: the whole shared card narrows in place (right edge
    // stays shell-flush) and the panel never extends past the rail's left
    // edge — no sweep underneath it at any frame.
    const sample = async () => {
      const bounds: number[] = [];
      const shellRight = document
        .querySelector("[data-sidebar-side='left']")!
        .getBoundingClientRect().right;
      const until = performance.now() + 400;
      while (performance.now() < until) {
        await new Promise(requestAnimationFrame);
        const cardRect = card.getBoundingClientRect();
        const railRect = document
          .querySelector("[data-right-tool-rail]")!
          .getBoundingClientRect();
        bounds.push(panel.getBoundingClientRect().right - railRect.left);
        expect(cardRect.right).toBeCloseTo(shellRight, 1);
        expect(cardRect.left).toBeLessThanOrEqual(railRect.left + 1);
      }
      return Math.max(...bounds);
    };
    for (let cycle = 0; cycle < 2; cycle++) {
      const samples = sample();
      await toggle.click();
      expect(await samples).toBeLessThanOrEqual(1);
    }
  },
);

it("keeps a readable conversation beside a saved dock width in a narrow shell", async () => {
  await page.viewport(1013, 748);
  // 340px persisted: fits the narrow shell beside a 320px conversation
  // (1013 − 300 sidebar = 713; 713 − 340 − 48 rail = 325 ≥ 320), so the
  // row preserves both without shrinking either.
  localStorage.setItem("chat_right_dock_width", JSON.stringify(340));
  function NarrowShellHarness() {
    const [state, setState] = useState(() =>
      openPaneInState(createDefaultRightDockState(), {
        kind: "diff",
        paneId: "review",
      }),
    );
    const active = resolveActivePane(state);
    const open = (kind: RightDockPaneKind) =>
      setState((s) => openPaneInState(s, { kind, paneId: kind }));
    // ONE shared card like production (ChatRightCards): dock + rail as
    // siblings inside a single bordered card — the rail is no longer a bare
    // strip outside the outlet, and there is no clip-path overlay geometry.
    return (
      // Viewport-width shell: the row measures against the real 1013px
      // viewport (page.viewport below), so dock clamps and rail edges are
      // absolute — no fixed-width harness fighting the viewport.
      <div
        data-testid="narrow-shell"
        data-sidebar-side="left"
        className="flex h-full w-full min-w-0 overflow-hidden"
      >
        <aside
          data-slot="sidebar"
          data-side="left"
          data-testid="left-sidebar"
          style={{ flex: "0 0 300px", width: 300 }}
        />
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <main data-testid="conversation" className="min-w-0 flex-1">
            Conversation
          </main>
          <div data-testid="right-card" className="relative flex min-h-0 min-w-0 shrink-0 overflow-hidden">
            <RightDock
              state={state}
              minWidth={300}
              defaultWidth="400px"
              shouldAcceptWidth={() => true}
              addMenuKinds={items.map((i) => i.kind)}
              launcherItems={items}
              collapseInShell
              onCollapse={() => setState((s) => setDockOpenInState(s, false))}
              onOpenChange={(open) =>
                setState((s) => setDockOpenInState(s, open))
              }
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
      </div>
    );
  }

  await render(<NarrowShellHarness />);
  const shell = document.querySelector<HTMLElement>("[data-testid='narrow-shell']")!;
  const conversation = document.querySelector<HTMLElement>(
    '[data-testid="conversation"]',
  )!;
  const panel = document.querySelector<HTMLElement>(
    "[data-right-dock-content]",
  )!;
  const dockContainer = document.querySelector<HTMLElement>(
    "[data-slot='sidebar-container']",
  )!;
  const dockGap = document.querySelector<HTMLElement>(
    "[data-slot='sidebar-gap']",
  )!;
  const rail = page
    .getByRole("toolbar", { name: "Tools", exact: true })
    .element();
  // The narrow shell (1013 − 300 sidebar = 713 for center + right card)
  // cannot fit the 544px persisted dock + 48px rail beside a 320px
  // conversation on first paint — the maxDockWidth clamp only bites once it
  // measures the real shell. Settle order: dock clamps first, then the
  // conversation reclaims its 320px.
  await expect
    .poll(() => dockContainer.getBoundingClientRect().width)
    .toBeLessThanOrEqual(440);
  await expect
    .poll(() => conversation.getBoundingClientRect().width)
    .toBeGreaterThanOrEqual(320);
  expect(Math.round(dockGap.getBoundingClientRect().width)).toBe(
    Math.round(dockContainer.getBoundingClientRect().width),
  );
  // The rail is the last item in the fixed-width shell: adjacency to the
  // conversation (no overlap, no drift) is the contract — not the absolute
  // viewport edge, which the harness no longer pins.
  expect(rail.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    conversation.getBoundingClientRect().right - 1,
  );

  // Widen the shell itself (the fixed-width harness owns the width, not the
  // viewport) so the 440px row clamp, not the narrow shell, decides the dock.
  document.querySelector<HTMLElement>("[data-testid='narrow-shell']")!.style.width = "1440px";
  // The 440px row clamp (maxDockWidth) caps the restored width: the saved 420
  // stays persisted (a later widen still restores it) but the painted dock and
  // its reserved gap clamp to 420 in the wide shell.
  await expect
    .poll(() => Math.round(dockContainer.getBoundingClientRect().width))
    .toBe(340);
  expect(Math.round(dockGap.getBoundingClientRect().width)).toBe(340);
  expect(localStorage.getItem("chat_right_dock_width")).toBe("340");

  // No in-card maximize anymore: the dock fills its card by default, and the
  // rail stays interactive in every state (never inert on the Sidebar root).
  expect(rail.inert).toBe(false);
});

it("opens the closed dock by dragging the content-seam rail inward", async () => {
  await page.viewport(1200, 800);
  localStorage.setItem("chat_right_dock_width", "440");
  await render(<Harness />);
  await page.getByRole("button", { name: "Toggle right sidebar", exact: true }).click();
  // In-flow width drawer: close collapses the gap reservation to ~0 and the
  // rail (inside the shared card) stays the visible reopen affordance.
  const gap = () =>
    document.querySelector<HTMLElement>("[data-slot='sidebar-gap']")!;
  // The rail is the last item in the shared card — it ends where the card
  // ends. The Harness toggle is an absolute overlay (zero row width), so the
  // card spans [0,1200] like production's row.
  const cardEl = document.querySelector<HTMLElement>('[data-testid="right-card"]')!;
  const cardRect = cardEl.getBoundingClientRect();
  const rail = document.querySelector<HTMLElement>("[data-right-tool-rail]")!;
  const bounds = rail.getBoundingClientRect();
  expect(bounds.width).toBeCloseTo(48, 2);
  // Dragging inward from the rail reopens at the remembered 440px width.
  const seam = document.querySelector<HTMLElement>(
    "[data-slot='sidebar-container'] button[aria-label='Resize Sidebar'], [data-slot='sidebar-container'] button[aria-label='Toggle Sidebar']",
  )!;
  const target = seam as HTMLButtonElement;
  target.setPointerCapture = () => {};
  target.releasePointerCapture = () => {};
  const pointer = (type: string, clientX: number) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 71, button: 0,
    clientX, clientY: 400, pointerType: "mouse",
  }));
  // A click is also a supported reopen action, but pointer-down alone must
  // neither resize nor open the retained dock.
  pointer("pointerdown", bounds.x + 4);
  expect(localStorage.getItem("chat_right_dock_width")).toBe("440");
  pointer("pointermove", bounds.x - 52);
  pointer("pointerup", bounds.x - 52);
  await expect
    .poll(() =>
      Math.round(
        document
          .querySelector("[data-right-dock-content]")!
          .closest("[data-slot=sidebar-container]")!
          .getBoundingClientRect().width,
      ),
    )
    .toBe(440);
  expect(localStorage.getItem("chat_right_dock_width")).toBe("440");
});

