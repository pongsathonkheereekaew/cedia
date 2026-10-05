import "../../index.css";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { ProjectId, ThreadId } from "@synara/contracts";
import { TASK_TAB_ORDER_STORAGE_KEY, type TaskTab } from "./taskTabs.logic";
import { TaskTabStrip } from "./TaskTabs";

afterEach(() => {
  cleanup();
  localStorage.removeItem(TASK_TAB_ORDER_STORAGE_KEY);
});

function threadId(value: string): ThreadId {
  return value as ThreadId;
}

function tab(id: string, title = id, active = false): TaskTab {
  return {
    id: threadId(id),
    title,
    projectId: "project-a" as ProjectId,
    projectName: "Alpha",
    group: "active",
    active,
  };
}

const tabs = [
  tab("thread-1", "One", true),
  tab("thread-2", "Two"),
  tab("thread-3", "Three"),
];

async function mount() {
  const onSelect = vi.fn();
  await render(
    <TaskTabStrip
      tabs={tabs}
      activeThreadId={threadId("thread-1")}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

function tabOrder(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-task-tab]"),
    (element) => element.dataset.taskTab!,
  );
}

function pointerGesture(
  source: HTMLElement,
  target: HTMLElement,
  finish: "pointerup" | "pointercancel",
) {
  const start = source.getBoundingClientRect();
  const end = target.getBoundingClientRect();
  source.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: start.x + start.width / 2,
      clientY: start.y + start.height / 2,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientX: end.x + end.width / 2,
      clientY: end.y + end.height / 2,
    }),
  );
  window.dispatchEvent(
    new PointerEvent(finish, {
      bubbles: true,
      pointerId: 1,
      clientX: end.x + end.width / 2,
      clientY: end.y + end.height / 2,
    }),
  );
}

it("reorders with a pointer, persists the order, and suppresses the release click", async () => {
  const { onSelect } = await mount();
  const source = document.querySelector<HTMLElement>(
    '[data-task-tab="thread-1"]',
  )!;
  const target = document.querySelector<HTMLElement>(
    '[data-task-tab="thread-3"]',
  )!;
  pointerGesture(source, target, "pointerup");
  source.click();

  await expect.poll(tabOrder).toEqual(["thread-2", "thread-3", "thread-1"]);
  expect(JSON.parse(localStorage.getItem(TASK_TAB_ORDER_STORAGE_KEY)!)).toEqual(
    ["thread-2", "thread-3", "thread-1"],
  );
  expect(onSelect).not.toHaveBeenCalled();
});

it("cancels a pointer reorder without changing the order", async () => {
  await mount();
  const source = document.querySelector<HTMLElement>(
    '[data-task-tab="thread-1"]',
  )!;
  const target = document.querySelector<HTMLElement>(
    '[data-task-tab="thread-3"]',
  )!;
  pointerGesture(source, target, "pointercancel");
  expect(tabOrder()).toEqual(["thread-1", "thread-2", "thread-3"]);
  expect(JSON.parse(localStorage.getItem(TASK_TAB_ORDER_STORAGE_KEY)!)).toEqual(
    ["thread-1", "thread-2", "thread-3"],
  );
});

it("supports keyboard grab and Alt+Arrow movement", async () => {
  await mount();
  const source = document.querySelector<HTMLButtonElement>(
    '[data-task-tab="thread-2"]',
  )!;
  source.focus();
  source.dispatchEvent(
    new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
  );
  await expect
    .poll(() =>
      document
        .querySelector<HTMLElement>('[data-task-tab="thread-2"]')
        ?.getAttribute("aria-grabbed"),
    )
    .toBe("true");
  source.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowRight",
      altKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );

  await expect.poll(tabOrder).toEqual(["thread-1", "thread-3", "thread-2"]);
  expect(
    document
      .querySelector<HTMLElement>('[data-task-tab="thread-2"]')
      ?.getAttribute("aria-grabbed"),
  ).toBe("true");
});

it("restores the order when a grabbed keyboard reorder is cancelled", async () => {
  await mount();
  const source = document.querySelector<HTMLButtonElement>(
    '[data-task-tab="thread-2"]',
  )!;
  source.focus();
  source.dispatchEvent(
    new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
  );
  await expect
    .poll(() =>
      document
        .querySelector<HTMLElement>('[data-task-tab="thread-2"]')
        ?.getAttribute("aria-grabbed"),
    )
    .toBe("true");
  source.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }),
  );
  await expect.poll(tabOrder).toEqual(["thread-1", "thread-3", "thread-2"]);

  source.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  await expect.poll(tabOrder).toEqual(["thread-1", "thread-2", "thread-3"]);
  expect(
    document
      .querySelector<HTMLElement>('[data-task-tab="thread-2"]')
      ?.getAttribute("aria-grabbed"),
  ).toBeNull();
  expect(JSON.parse(localStorage.getItem(TASK_TAB_ORDER_STORAGE_KEY)!)).toEqual(
    ["thread-1", "thread-2", "thread-3"],
  );
});

it("uses plain tablist arrows and Home/End for focus without reordering", async () => {
  await mount();
  const source = document.querySelector<HTMLButtonElement>(
    '[data-task-tab="thread-2"]',
  )!;
  source.focus();
  source.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
      cancelable: true,
    }),
  );
  await expect
    .poll(() => (document.activeElement as HTMLElement)?.dataset.taskTab)
    .toBe("thread-1");
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    }),
  );
  await expect
    .poll(() => (document.activeElement as HTMLElement)?.dataset.taskTab)
    .toBe("thread-3");
  expect(tabOrder()).toEqual(["thread-1", "thread-2", "thread-3"]);
});

it("clears a pointer drag on window blur so the next click still selects", async () => {
  const { onSelect } = await mount();
  const source = document.querySelector<HTMLButtonElement>(
    '[data-task-tab="thread-2"]',
  )!;
  const target = document.querySelector<HTMLElement>(
    '[data-task-tab="thread-3"]',
  )!;
  const start = source.getBoundingClientRect();
  const end = target.getBoundingClientRect();
  source.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 2,
      clientX: start.x + start.width / 2,
      clientY: start.y + start.height / 2,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 2,
      clientX: end.x + end.width / 2,
      clientY: end.y + end.height / 2,
    }),
  );
  await expect
    .poll(() => source.classList.contains("cursor-grabbing"))
    .toBe(true);
  window.dispatchEvent(new Event("blur"));
  await expect
    .poll(() => source.classList.contains("cursor-grabbing"))
    .toBe(false);
  source.click();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(threadId("thread-2"));
  expect(tabOrder()).toEqual(["thread-1", "thread-2", "thread-3"]);
});
