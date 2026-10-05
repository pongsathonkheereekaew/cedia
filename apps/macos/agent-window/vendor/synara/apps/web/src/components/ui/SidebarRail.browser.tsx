import "../../index.css";

import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render, cleanup } from "vitest-browser-react";

import { Sidebar, SidebarProvider, SidebarRail, SidebarInstanceProvider } from "./sidebar";

const RESIZE_STORAGE_KEY = "cedia:test:sidebar-rail-resize";

function ResizeFixture() {
  const [open, setOpen] = useState(true);
  const [renderRevision, setRenderRevision] = useState(0);

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <Sidebar
        side="right"
        resizable={{ minWidth: 160, storageKey: RESIZE_STORAGE_KEY }}
        className="w-[320px]"
        style={{ "--sidebar-width": "320px" } as React.CSSProperties}
      >
        <SidebarRail />
        <div data-testid="panel-body" className="h-full w-full">
          Panel body {renderRevision}
        </div>
        <button type="button" onClick={() => setRenderRevision((value) => value + 1)}>
          Rerender
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Close sidebar
        </button>
      </Sidebar>
    </SidebarProvider>
  );
}

function dispatchPointer(
  target: Element,
  type: string,
  pointerId = 41,
  clientX = 300,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX,
      clientY: 80,
      pointerId,
      pointerType: "mouse",
    }),
  );
}

function railElement(): HTMLButtonElement {
  const rail = document.querySelector<HTMLButtonElement>(
    "[data-slot='sidebar-rail']",
  );
  if (!rail) throw new Error("Sidebar resize rail is missing");
  // Synthetic pointer events are not backed by a browser pointer stream, so
  // Chromium rejects setPointerCapture. Keep the real React pointer lifecycle
  // under test while supplying the platform primitive it expects.
  rail.setPointerCapture = () => {};
  rail.releasePointerCapture = () => {};
  return rail;
}

function expectRestoredBodyStyles(): void {
  expect(document.body.style.getPropertyValue("cursor")).toBe("crosshair");
  expect(document.body.style.getPropertyValue("user-select")).toBe("text");
  expect(document.body.style.getPropertyPriority("cursor")).toBe("important");
  expect(document.body.style.getPropertyPriority("user-select")).toBe(
    "important",
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(RESIZE_STORAGE_KEY);
  document.body.style.removeProperty("cursor");
  document.body.style.removeProperty("user-select");
});

async function renderFixture() {
  await page.viewport(1200, 800);
  return render(<ResizeFixture />);
}

it("restores inline body styles when pointer capture is lost", async () => {
  document.body.style.setProperty("cursor", "crosshair", "important");
  document.body.style.setProperty("user-select", "text", "important");
  await renderFixture();

  const rail = railElement();
  dispatchPointer(rail, "pointerdown");
  expect(document.body.style.cursor).toBe("col-resize");
  expect(document.body.style.userSelect).toBe("none");

  dispatchPointer(rail, "lostpointercapture");
  expectRestoredBodyStyles();
});

it.each(["pointerup", "pointercancel"] as const)(
  "restores inline body styles on %s",
  async (endEvent) => {
    document.body.style.setProperty("cursor", "crosshair", "important");
    document.body.style.setProperty("user-select", "text", "important");
    await renderFixture();

    const rail = railElement();
    dispatchPointer(rail, "pointerdown");
    dispatchPointer(rail, endEvent);
    expectRestoredBodyStyles();
  },
);

it("persists the pointer-up width before the queued resize frame runs", async () => {
  await renderFixture();

  const rail = railElement();
  dispatchPointer(rail, "pointerdown", 41, 300);
  // Queue a frame at 380px, then release at 400px without yielding to RAF.
  // This catches a release path that persists the last painted frame (or the
  // starting width) instead of the coordinate from the actual pointer-up.
  dispatchPointer(rail, "pointermove", 41, 240);
  dispatchPointer(rail, "pointerup", 41, 220);

  expect(window.localStorage.getItem(RESIZE_STORAGE_KEY)).toBe("400");
});

it("keeps the active drag width when a parent rerenders before pointer-up", async () => {
  window.localStorage.setItem(RESIZE_STORAGE_KEY, "320");
  await renderFixture();

  const rail = railElement();
  dispatchPointer(rail, "pointerdown", 41, 300);
  dispatchPointer(rail, "pointermove", 41, 220);

  // RightDock recreates its inline resizable options when heavy diff content
  // updates. The restore effect must not apply the previous persisted width
  // while this pointer gesture is still active.
  await page.getByRole("button", { name: "Rerender", exact: true }).click();
  await expect
    .poll(() => {
      const wrapper = rail.closest<HTMLElement>("[data-slot='sidebar-wrapper']");
      return wrapper?.style.getPropertyValue("--sidebar-width");
    })
    .toBe("400px");

  dispatchPointer(rail, "pointerup", 41, 220);
  expect(window.localStorage.getItem(RESIZE_STORAGE_KEY)).toBe("400");
});

it("restores inline body styles when the window blurs during a resize", async () => {
  document.body.style.setProperty("cursor", "crosshair", "important");
  document.body.style.setProperty("user-select", "text", "important");
  await renderFixture();

  dispatchPointer(railElement(), "pointerdown");
  window.dispatchEvent(new Event("blur"));
  expectRestoredBodyStyles();
});

it("restores inline body styles when the sidebar closes during a resize", async () => {
  document.body.style.setProperty("cursor", "crosshair", "important");
  document.body.style.setProperty("user-select", "text", "important");
  await renderFixture();

  dispatchPointer(railElement(), "pointerdown");
  await page
    .getByRole("button", { name: "Close sidebar", exact: true })
    .click();
  await expect
    .poll(() => document.body.style.getPropertyValue("cursor"))
    .toBe("crosshair");
  expectRestoredBodyStyles();
});

it("restores inline body styles when the rail unmounts during a resize", async () => {
  document.body.style.setProperty("cursor", "crosshair", "important");
  document.body.style.setProperty("user-select", "text", "important");
  const mounted = await renderFixture();

  dispatchPointer(railElement(), "pointerdown");
  await mounted.unmount();
  expectRestoredBodyStyles();
});

it("keeps the resize cursor and hit target on the seam instead of the panel body", async () => {
  await renderFixture();

  const rail = railElement();
  const panelBody = document.querySelector<HTMLElement>(
    "[data-testid='panel-body']",
  );
  if (!panelBody) throw new Error("Sidebar panel body is missing");
  const railRect = rail.getBoundingClientRect();
  const bodyRect = panelBody.getBoundingClientRect();

  expect(getComputedStyle(rail).cursor).toMatch(/resize/);
  expect(getComputedStyle(panelBody).cursor).not.toMatch(/resize/);
  expect(
    rail.contains(
      document.elementFromPoint(
        railRect.x + railRect.width / 2,
        railRect.y + 80,
      ),
    ),
  ).toBe(true);
  expect(
    rail.contains(
      document.elementFromPoint(
        bodyRect.x + bodyRect.width / 2,
        bodyRect.y + 80,
      ),
    ),
  ).toBe(false);
});

function LeftRailFixture({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const resizable = { minWidth: 208, storageKey: RESIZE_STORAGE_KEY };
  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <Sidebar side="left" collapsible="icon" resizable={resizable}>
        <div>Left panel</div>
      </Sidebar>
      <div className="relative flex-1">
        <SidebarInstanceProvider side="left" collapsible="icon" resizable={resizable}>
          <SidebarRail placement="content-seam" />
        </SidebarInstanceProvider>
      </div>
    </SidebarProvider>
  );
}

async function renderLeftRail(initiallyOpen = true) {
  await page.viewport(1200, 800);
  window.localStorage.setItem(RESIZE_STORAGE_KEY, "264");
  await render(<LeftRailFixture initiallyOpen={initiallyOpen} />);
  const rail = railElement();
  const wrapper = rail.closest<HTMLElement>("[data-slot='sidebar-wrapper']")!;
  return { rail, wrapper };
}

it("does not grow the icon sidebar on repeated clicks without dragging", async () => {
  const { rail, wrapper } = await renderLeftRail();
  for (let attempt = 0; attempt < 3; attempt++) {
    dispatchPointer(rail, "pointerdown");
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("264px");
    dispatchPointer(rail, "pointerup");
    rail.click();
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("264px");
    expect(window.localStorage.getItem(RESIZE_STORAGE_KEY)).toBe("264");
  }
});

it("resizes only the panel width, excluding the persistent icon rail", async () => {
  const { rail, wrapper } = await renderLeftRail();
  dispatchPointer(rail, "pointerdown", 41, 312);
  dispatchPointer(rail, "pointermove", 41, 352);
  dispatchPointer(rail, "pointerup", 41, 352);
  expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("304px");
  expect(window.localStorage.getItem(RESIZE_STORAGE_KEY)).toBe("304");
});

it("reopens the collapsed icon sidebar without replacing its remembered width", async () => {
  const { rail, wrapper } = await renderLeftRail(false);
  dispatchPointer(rail, "pointerdown", 41, 48);
  expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("264px");
  dispatchPointer(rail, "pointerup", 41, 48);
  rail.click();
  await expect.poll(() => document.querySelector("[data-slot='sidebar']")?.getAttribute("data-state")).toBe("expanded");
  expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("264px");
  expect(window.localStorage.getItem(RESIZE_STORAGE_KEY)).toBe("264");
});
