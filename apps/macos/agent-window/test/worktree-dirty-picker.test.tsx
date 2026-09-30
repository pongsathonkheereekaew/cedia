import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadId } from "@synara/contracts";

import { buildLocalDraftThread } from "../vendor/synara/apps/web/src/components/ChatView.logic";
import {
  resolveDirtyFileSelection,
  WorktreeDirtyFileList,
} from "../vendor/synara/apps/web/src/components/WorktreeDirtyFilePicker";
import { buildDraftThreadState } from "../vendor/synara/apps/web/src/composerDraftDomain";
import {
  normalizeCurrentPersistedComposerDraftStoreState,
  partializeComposerDraftStoreState,
} from "../vendor/synara/apps/web/src/composerDraftPersistence";

const files = [
  { path: "hello.txt", insertions: 3, deletions: 1 },
  { path: "src/app.ts", insertions: 10, deletions: 0 },
];

describe("dirty-file selection defaults", () => {
  it("carries every dirty file until the user touches the picker", () => {
    expect(resolveDirtyFileSelection(files, undefined)).toEqual(["hello.txt", "src/app.ts"]);
    expect(resolveDirtyFileSelection(files, null)).toEqual(["hello.txt", "src/app.ts"]);
  });

  it("keeps an explicit selection verbatim, including carry-none", () => {
    expect(resolveDirtyFileSelection(files, ["src/app.ts"])).toEqual(["src/app.ts"]);
    expect(resolveDirtyFileSelection(files, [])).toEqual([]);
  });
});

describe("dirty-file checklist", () => {
  it("checks everything by default and names each path once", () => {
    const html = renderToStaticMarkup(
      <WorktreeDirtyFileList files={files} selection={undefined} onToggle={() => {}} onSelectAll={() => {}} onClear={() => {}} />,
    );
    expect(html).toContain("Carry changes into worktree (2 of 2)");
    expect(html).toContain("hello.txt");
    expect(html).toContain("src/app.ts");
    expect(html.match(/checked=""/g)?.length ?? 0).toBe(2);
    expect(html).toContain("Carry all dirty files");
    expect(html).toContain("Carry no dirty files");
  });

  it("reflects a partial selection without touching the host default", () => {
    const html = renderToStaticMarkup(
      <WorktreeDirtyFileList files={files} selection={["src/app.ts"]} onToggle={() => {}} onSelectAll={() => {}} onClear={() => {}} />,
    );
    expect(html).toContain("Carry changes into worktree (1 of 2)");
    expect(html.match(/checked=""/g)?.length ?? 0).toBe(1);
  });
});

describe("dirty-file selection reaches the send pipeline", () => {
  const threadId = ThreadId.makeUnsafe("draft-1");

  it("the draft builder keeps the selection set through the workspace patch", () => {
    const state = buildDraftThreadState({
      projectId: "project-1" as never,
      options: { branch: "feature", dirtyFiles: ["hello.txt"] },
      createdAtMode: "preserve-existing-on-empty",
    });
    expect(state.dirtyFiles).toEqual(["hello.txt"]);
    const kept = buildDraftThreadState({
      projectId: "project-1" as never,
      existingThread: state,
      options: { branch: "feature" },
      createdAtMode: "preserve-existing-on-empty",
    });
    expect(kept.dirtyFiles).toEqual(["hello.txt"]);
    const cleared = buildDraftThreadState({
      projectId: "project-1" as never,
      existingThread: state,
      options: { branch: "feature", dirtyFiles: [] },
      createdAtMode: "preserve-existing-on-empty",
    });
    expect(cleared.dirtyFiles).toEqual([]);
  });

  it("the local draft thread carries the selection to thread.create", () => {
    const thread = buildLocalDraftThread(
      threadId,
      {
        projectId: "project-1",
        createdAt: "2026-09-19T00:00:00.000Z",
        runtimeMode: "approval-required",
        interactionMode: "default",
        entryPoint: "chat",
        branch: "feature",
        worktreePath: null,
        envMode: "worktree",
        dirtyFiles: ["hello.txt"],
      } as never,
      { provider: "omp", model: "fixture/fixture-model" } as never,
      null,
    );
    expect(thread.dirtyFiles).toEqual(["hello.txt"]);
  });

  it("persists selected and carry-none choices across the shared draft round trip", () => {
    const state = {
      draftsByThreadId: {},
      draftThreadsByThreadId: {
        [threadId]: buildDraftThreadState({
          projectId: "project-1" as never,
          options: {
            branch: "feature",
            envMode: "worktree",
            dirtyFiles: ["hello.txt"],
          },
          createdAtMode: "preserve-existing-on-empty",
        }),
        [ThreadId.makeUnsafe("draft-none")]: buildDraftThreadState({
          projectId: "project-1" as never,
          options: {
            branch: "feature",
            envMode: "worktree",
            dirtyFiles: [],
          },
          createdAtMode: "preserve-existing-on-empty",
        }),
      },
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    } as never;

    const persisted = partializeComposerDraftStoreState(state);
    const hydrated = normalizeCurrentPersistedComposerDraftStoreState(
      JSON.parse(JSON.stringify(persisted)),
    );

    expect(hydrated.draftThreadsByThreadId[threadId]?.dirtyFiles).toEqual(["hello.txt"]);
    expect(hydrated.draftThreadsByThreadId[ThreadId.makeUnsafe("draft-none")]?.dirtyFiles).toEqual(
      [],
    );
  });
});
