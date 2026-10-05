import "../../index.css";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import {
  Sidebar,
  SidebarProvider,
  SIDEBAR_OFFCANVAS_MOTION_CLASS,
} from "../ui/sidebar";
import { RightDock } from "./RightDock";
import {
  createDefaultRightDockState,
  openPaneInState,
} from "~/rightDockStore.logic";

afterEach(cleanup);
function MotionFixture() {
  const [open, setOpen] = useState(true);
  const state = {
    ...openPaneInState(createDefaultRightDockState(), {
      kind: "diff",
      paneId: "review",
    }),
    open,
  };
  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <Sidebar
        side="left"
        collapsible="icon"
        className={SIDEBAR_OFFCANVAS_MOTION_CLASS}
        gapClassName={SIDEBAR_OFFCANVAS_MOTION_CLASS}
      >
        Navigation
      </Sidebar>
      <main className="min-w-0 flex-1">
        <button onClick={() => setOpen(!open)}>Toggle both panels</button>
      </main>
      <div data-testid="right-card" className="relative flex min-h-0 shrink-0">
        <RightDock
          addMenuKinds={[]}
          state={state}
          minWidth={300}
          defaultWidth="400px"
          shouldAcceptWidth={() => true}
          collapseInShell
          onCollapse={() => setOpen(false)}
          onOpenChange={setOpen}
          onAddPane={() => {}}
          onClosePane={() => {}}
          renderPane={() => <div>Review content</div>}
        />
        <aside data-right-tool-rail className="w-12 shrink-0" />
      </div>
    </SidebarProvider>
  );
}
it("keeps both panels and their layout gaps on the same open/close timing", async () => {
  await page.viewport(1440, 900);
  await render(<MotionFixture />);
  const nodes = () => [
    ...document.querySelectorAll(
      "[data-slot='sidebar-gap'], [data-slot='sidebar-container']",
    ),
  ];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? "0s" : "0.3s";
  const timings = () =>
    nodes().map((node) => ({
      duration: getComputedStyle(node).transitionDuration,
      easing: getComputedStyle(node).transitionTimingFunction,
    }));
  const expected = Array.from({ length: 4 }, () => ({
    duration,
    easing: "cubic-bezier(0.32, 0.72, 0, 1)",
  }));
  await expect.poll(timings).toEqual(expected);
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "Toggle both panels", exact: true })
      .click();
    await expect.poll(timings).toEqual(expected);
  }
});

it("collapses the card-row icon sidebar to zero width without unmounting", async () => {
  await page.viewport(1440, 900);
  // Mirrors the _chat.tsx thread sidebar: icon mode with the collapsed widths
  // overridden to 0 (the 48px rail lives outside <Sidebar>). Display:none
  // would kill the width transition the row relies on, so the root must stay
  // rendered and the reservation must reach exactly 0.
  await render(
    <SidebarProvider open={false} onOpenChange={() => {}}>
      <Sidebar
        side="left"
        collapsible="icon"
        variant="floating"
        className={
          "text-foreground " +
          SIDEBAR_OFFCANVAS_MOTION_CLASS +
          " group-data-[collapsible=icon]:w-0!"
        }
        gapClassName={
          SIDEBAR_OFFCANVAS_MOTION_CLASS + " group-data-[collapsible=icon]:w-0!"
        }
        innerClassName="group-data-[collapsible=icon]:border-0! group-data-[collapsible=icon]:shadow-none! group-data-[collapsible=icon]:bg-transparent!"
      >
        Navigation
      </Sidebar>
    </SidebarProvider>,
  );
  const root = document.querySelector<HTMLElement>("[data-slot='sidebar']")!;
  expect(getComputedStyle(root).display).not.toBe("none");
  const gap = document.querySelector<HTMLElement>("[data-slot='sidebar-gap']")!;
  const container = document.querySelector<HTMLElement>(
    "[data-slot='sidebar-container']",
  )!;
  await expect.poll(() => Math.round(gap.getBoundingClientRect().width)).toBe(0);
  await expect
    .poll(() => Math.round(container.getBoundingClientRect().width))
    .toBe(0);
});
