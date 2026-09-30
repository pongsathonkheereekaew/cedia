// Cedia slice test for upstream #1290 remainder (stable Git selectors +
// search-list field equality). Mirrors the release assertions for the ported
// helpers; the upstream unit test files are not vendored, so the ported
// behavior is pinned here instead.
// Upstream: https://github.com/Emanuele-web04/synara/pull/1290
import { assert, describe, expect, it } from "vitest";

import type { MessageId, ThreadId } from "@synara/contracts";

import type { AppState } from "./store";
import {
  areSidebarSearchThreadListsEqual,
  type SidebarSearchThread,
} from "./components/SidebarSearchPalette.logic";
import { createThreadGitActionsMetadataSelector } from "./storeSelectors";
import type { ThreadShell } from "./types";

const threadIdA = "thread-a" as ThreadId;
const messageId = "message-1" as MessageId;

const shellA = { id: threadIdA, projectId: "project-1", title: "A" } as ThreadShell;

function makeState(slices: {
  threadIds?: readonly ThreadId[];
  threadShellById?: Readonly<Record<string, ThreadShell>>;
  messageIdsByThreadId?: Readonly<Record<string, readonly MessageId[]>>;
}): AppState {
  return {
    threadIds: slices.threadIds ?? [],
    threadShellById: slices.threadShellById ?? {},
    messageIdsByThreadId: slices.messageIdsByThreadId ?? {},
  } as AppState;
}

describe("areSidebarSearchThreadListsEqual", () => {
  const thread = (overrides: Partial<SidebarSearchThread> = {}): SidebarSearchThread => ({
    id: "thread-1",
    title: "Title",
    projectId: "project-1",
    projectName: "Project",
    projectRemoteName: "org/project",
    provider: "codex",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: undefined,
    messages: [],
    ...overrides,
  });

  it("treats rebuilt lists with identical fields and message references as equal", () => {
    const messages = [{ text: "hello" }];
    assert.isTrue(areSidebarSearchThreadListsEqual([thread({ messages })], [thread({ messages })]));
  });

  it("detects a changed field, a changed message array, or a different length", () => {
    const messages = [{ text: "hello" }];
    assert.isFalse(
      areSidebarSearchThreadListsEqual(
        [thread({ messages })],
        [thread({ messages, title: "Renamed" })],
      ),
    );
    assert.isFalse(
      areSidebarSearchThreadListsEqual(
        [thread({ messages })],
        [thread({ messages: [{ text: "hello" }] })],
      ),
    );
    assert.isFalse(areSidebarSearchThreadListsEqual([thread()], [thread(), thread()]));
  });
});

describe("createThreadGitActionsMetadataSelector", () => {
  it("keeps git action metadata stable while streaming messages change", () => {
    const selectGitActionsMetadata = createThreadGitActionsMetadataSelector(threadIdA);
    const threadIds = [threadIdA];
    const threadShellById = {
      [threadIdA]: {
        ...shellA,
        branch: "feature",
        worktreePath: "/repo/.worktrees/feature",
        associatedWorktreeBranch: "feature",
        createBranchFlowCompleted: true,
      },
    };

    const before = selectGitActionsMetadata(makeState({ threadIds, threadShellById }));
    const after = selectGitActionsMetadata(
      makeState({
        threadIds,
        threadShellById,
        messageIdsByThreadId: { [threadIdA]: [messageId] },
      }),
    );

    expect(after).toBe(before);
    expect(after).toEqual({
      worktreePath: "/repo/.worktrees/feature",
      branch: "feature",
      associatedWorktreeBranch: "feature",
      createBranchFlowCompleted: true,
      title: "A",
    });
  });

  it("re-derives when a git field or the title changes and empties for unknown threads", () => {
    const selectGitActionsMetadata = createThreadGitActionsMetadataSelector(threadIdA);
    const before = selectGitActionsMetadata(
      makeState({ threadIds: [threadIdA], threadShellById: { [threadIdA]: shellA } }),
    );
    const after = selectGitActionsMetadata(
      makeState({
        threadIds: [threadIdA],
        threadShellById: { [threadIdA]: { ...shellA, title: "Renamed", branch: "main" } },
      }),
    );
    expect(after).not.toBe(before);
    expect(after.title).toBe("Renamed");
    expect(after.branch).toBe("main");
    expect(selectGitActionsMetadata(makeState({}))).toEqual({
      worktreePath: null,
      branch: null,
      associatedWorktreeBranch: null,
      createBranchFlowCompleted: false,
      title: undefined,
    });
    expect(createThreadGitActionsMetadataSelector(null)(makeState({}))).toBe(
      createThreadGitActionsMetadataSelector(undefined)(makeState({})),
    );
  });
});
