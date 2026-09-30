import { expect, test } from "bun:test";
import { openNativeAgentIntent } from "../src/native-handoff";

test("IDE return selects the exact durable task, even when another project was active", async () => {
  const navigated: string[] = [];
  const reads: string[] = [];
  const api = { orchestration: {
    getShellSnapshot: async () => { throw new Error("Should not choose another task"); },
    getThreadDetailSnapshot: async ({ threadId }: { threadId: string }) => { reads.push(threadId); return {}; },
    dispatchCommand: async () => { throw new Error("Should not create a duplicate"); },
  } };
  await openNativeAgentIntent(api, undefined, { scheme: "cedia", authority: "session", path: "/existing-task" }, id => navigated.push(id));
  expect(reads).toEqual(["existing-task"]);
  expect(navigated).toEqual(["existing-task"]);
});

test("folder handoff reuses an existing project and task", async () => {
  const navigated: string[] = [];
  const api = { orchestration: {
    getShellSnapshot: async () => ({ projects: [{ id: "p", workspaceRoot: "/workspace" }], threads: [{ id: "t", projectId: "p", archivedAt: null }] }),
    getThreadDetailSnapshot: async () => ({}),
    dispatchCommand: async () => { throw new Error("Should not create a duplicate"); },
  } };
  await openNativeAgentIntent(api, { scheme: "file", path: "/workspace" }, undefined, id => navigated.push(id));
  expect(navigated).toEqual(["t"]);
  await openNativeAgentIntent(api, undefined, undefined, id => navigated.push(id));
  expect(navigated).toEqual(["t"]);
});

test("window-local task navigation keeps each task runtime distinct without an OMP retarget command", async () => {
  const navigated: string[] = [];
  const reads: string[] = [];
  const commands: unknown[] = [];
  const api = { orchestration: {
    getShellSnapshot: async () => { throw new Error("Task navigation must not enumerate or replace the task runtimes"); },
    getThreadDetailSnapshot: async ({ threadId }: { threadId: string }) => { reads.push(threadId); return { id: threadId }; },
    dispatchCommand: async (input: unknown) => { commands.push(input); return {}; },
  } };

  await openNativeAgentIntent(api, undefined, { scheme: "cedia", authority: "session", path: "/task-a" }, id => navigated.push(id));
  await openNativeAgentIntent(api, undefined, { scheme: "cedia", authority: "session", path: "/task-b" }, id => navigated.push(id));

  expect(reads).toEqual(["task-a", "task-b"]);
  expect(navigated).toEqual(["task-a", "task-b"]);
  expect(new Set(navigated).size).toBe(2);
  // A window-local selection only changes which durable task is shown. It does not
  // dispatch switch_session, abort, or any retarget command against either owner.
  expect(commands).toEqual([]);
});
