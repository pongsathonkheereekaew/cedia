// Dock drag-resize regression: the resize rail must win the hit test at its
// own midpoint. Parked outside the dock container clip (e.g. -left-3), the
// center card covers it and every real pointerdown misses the handle.
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
  type RightDockPaneKind,
} from "~/rightDockStore.logic";

const items = resolveRightDockLauncherItems({
  hasWorkspace: true,
  hasGitRepository: true,
  hasReview: true,
  hasDeviceSupport: false,
});

function Harness() {
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
      data-sidebar-side="left"
      className="relative flex h-screen w-full min-w-0 overflow-hidden"
    >
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
          onOpenChange={(nextOpen) => setState((s) => setDockOpenInState(s, nextOpen))}
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

it("drags the open dock wider and narrower through the real hit-test path", async () => {
  await page.viewport(1280, 800);
  // Below the row cap: the widen step must have headroom (maxWidth is a hard
  // ceiling for the live drag, so a dock restored AT the cap reads as frozen
  // on the first outward move). minWidth 300 keeps the restore clamp honest.
  localStorage.setItem("chat_right_dock_width", "400");
  await render(<Harness />);
  const gapWidth = () =>
    Math.round(
      document
        .querySelector<HTMLElement>("[data-testid='right-card'] [data-slot='sidebar-gap']")!
        .getBoundingClientRect().width,
    );
  await expect.poll(gapWidth).toBe(400);
  const dragRail = (pointerId: number, deltaX: number) => {
    const railButton = document.querySelector<HTMLElement>(
      "[data-testid='right-card'] [data-slot='sidebar-container'] button[data-slot='sidebar-rail']",
    )!;
    const button = railButton as HTMLButtonElement;
    button.setPointerCapture = () => {};
    button.releasePointerCapture = () => {};
    const rect = railButton.getBoundingClientRect();
    const clientX = rect.x + rect.width / 2;
    const clientY = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    expect(hit === railButton || (hit !== null && railButton.contains(hit))).toBe(true);
    const target = hit ?? railButton;
    const dispatchPointer = (type: string, x: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          button: 0,
          clientX: x,
          clientY,
          pointerType: "mouse",
        }),
      );
    dispatchPointer("pointerdown", clientX);
    dispatchPointer("pointermove", clientX + deltaX);
    dispatchPointer("pointerup", clientX + deltaX);
  };
  dragRail(77, -100);
  await expect.poll(gapWidth).toBe(440);
  dragRail(78, 100);
  await expect.poll(gapWidth).toBe(340);
});

it("vetoes no widening drag below the 440px row cap", async () => {
  // shouldAcceptWidth regression: the wrapper is the dock's own flex shell
  // (clientWidth == current width), so comparing the candidate against it
  // vetoes every widen and the drag freezes at its starting width.
  await page.viewport(1280, 800);
  localStorage.setItem("chat_right_dock_width", "352");
  await render(<Harness />);
  const dockGap = () =>
    document.querySelector<HTMLElement>("[data-testid='right-card'] [data-slot='sidebar-gap']")!;
  const gapWidth = () => Math.round(dockGap().getBoundingClientRect().width);
  await expect.poll(gapWidth).toBe(352);
  const railButton = document.querySelector<HTMLElement>(
    "[data-testid='right-card'] [data-slot='sidebar-container'] button[data-slot='sidebar-rail']",
  )!;
  const button = railButton as HTMLButtonElement;
  button.setPointerCapture = () => {};
  button.releasePointerCapture = () => {};
  const rect = railButton.getBoundingClientRect();
  const clientX = rect.x + rect.width / 2;
  const clientY = rect.y + rect.height / 2;
  const dispatchPointer = (type: string, x: number) =>
    railButton.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 79,
        button: 0,
        clientX: x,
        clientY,
        pointerType: "mouse",
      }),
    );
  dispatchPointer("pointerdown", clientX);
  dispatchPointer("pointermove", clientX - 48);
  dispatchPointer("pointerup", clientX - 48);
  await expect.poll(gapWidth).toBe(400);
});
