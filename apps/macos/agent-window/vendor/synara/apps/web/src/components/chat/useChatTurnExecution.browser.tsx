// FILE: useChatTurnExecution.browser.tsx
// Purpose: Bounded browser regressions for the native OMP first-send worktree path.
// Layer: Vitest browser tests

import { createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import type { NativeApi, ProjectId, ThreadId } from "@synara/contracts";
import { createWorktreeSetupResolution } from "../ChatView.logic";
import { useChatTurnExecution } from "./useChatTurnExecution";

const harnessState = vi.hoisted(() => ({
  draftDirtyFiles: undefined as readonly string[] | null | undefined,
  nativeApi: null as NativeApi | null,
}));

vi.mock("~/nativeApi", () => ({
  readNativeApi: () => harnessState.nativeApi,
}));

vi.mock("~/projectInstructionsStore", () => ({
  useProjectInstructionsStore: {
    getState: () => ({ instructionsByProjectId: {} }),
  },
  mergeProjectInstructionsIntoThreadNotes: ({ threadNotes }: { threadNotes: string }) => threadNotes,
}));

vi.mock("~/pinnedMessages", () => ({
  dispatchThreadNotes: vi.fn(),
}));

vi.mock("~/threadGoal", () => ({
  dispatchThreadGoal: vi.fn(),
}));

vi.mock("../../composer-logic", () => ({
  collapseExpandedComposerCursor: (_prompt: string, cursor: number) => cursor,
  detectComposerTrigger: () => null,
}));

vi.mock("../../composerDraftStore", () => ({
  markPromotedDraftThreads: vi.fn(),
  useComposerDraftStore: {
    getState: () => ({
      getDraftThread: () =>
        harnessState.draftDirtyFiles === undefined
          ? undefined
          : { dirtyFiles: harnessState.draftDirtyFiles },
    }),
  },
}));

vi.mock("../../lib/composerSend", () => ({
  cloneComposerImageAttachment: (image: unknown) => image,
  stageUploadComposerAttachments: vi.fn(),
}));

vi.mock("../../lib/queuedComposerDrain", () => ({
  armQueuedComposerSteerGate: vi.fn(),
}));

vi.mock("../../pendingTurnDispatch", () => ({
  clearPendingTurnDispatch: vi.fn(),
}));

vi.mock("../../store", () => ({
  useStore: {
    getState: () => ({}),
  },
}));

vi.mock("./projectScriptRuntime", () => ({
  waitForSetupScriptTerminalActivity: vi.fn(),
}));

type Command = { type: string; [key: string]: unknown };

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const THREAD_ID = "omp-draft-thread" as ThreadId;
const PROJECT_ID = "project-omp" as ProjectId;
const PROJECT_CWD = "/workspace/project";
const HOST_WORKTREE = "/workspace/.cedia/worktrees/omp-draft-thread";

function createApi(input: {
  readonly commands: Command[];
  readonly getThreadDetailSnapshot: NativeApi["orchestration"]["getThreadDetailSnapshot"];
  readonly removeWorktree?: ReturnType<typeof vi.fn>;
}): NativeApi {
  const api = {
    git: {
      onWorktreeSetupProgress: () => () => undefined,
      removeWorktree: input.removeWorktree ?? vi.fn(async () => undefined),
    },
    orchestration: {
      getThreadDetailSnapshot: input.getThreadDetailSnapshot,
      dispatchCommand: vi.fn(async (command: Command) => {
        input.commands.push(command);
        return { sequence: input.commands.length };
      }),
    },
  } as unknown as NativeApi;
  harnessState.nativeApi = api;
  return api;
}

function fakeThread() {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "OMP draft",
    modelSelection: { provider: "omp", model: "omp/test" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    envMode: "worktree",
    dirtyFiles: ["stale-from-thread.ts"],
    codexThreadId: null,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-09-30T00:00:00.000Z",
    latestTurn: null,
    turnDiffSummaries: [],
    activities: [],
    lastKnownPr: null,
  };
}

function canonicalHostSnapshot() {
  return {
    thread: {
      envMode: "worktree",
      branch: "cedia/omp-draft-thread",
      worktreePath: HOST_WORKTREE,
      workingDirectory: HOST_WORKTREE,
      associatedWorktreePath: HOST_WORKTREE,
      associatedWorktreeBranch: "cedia/omp-draft-thread",
      associatedWorktreeRef: "main",
    },
  };
}

function stagedAttachments() {
  return {
    cleanup: vi.fn(async () => undefined),
    runWithDispatch: async <T,>(dispatch: (attachments: never[]) => Promise<T>) => dispatch([]),
  };
}

function createPreparedTurn(overrides: Record<string, unknown> = {}) {
  return {
    nextThreadEnvMode: "worktree",
    nextThreadBranch: null,
    nextThreadWorktreePath: null,
    nextAssociatedWorktreePath: null,
    nextAssociatedWorktreeBranch: null,
    nextAssociatedWorktreeRef: null,
    api: harnessState.nativeApi,
    targetProjectCwdForSend: PROJECT_CWD,
    threadIdForSend: THREAD_ID,
    worktreeSetupResolution: createWorktreeSetupResolution(),
    baseBranchForWorktree: "main",
    worktreeCopiesLocalChanges: false,
    worktreeSetupScriptName: "Setup",
    selectedModelSelectionForSend: { provider: "omp", model: "omp/test" },
    selectedModelForSend: "omp/test",
    targetProjectDefaultModelSelectionForSend: null,
    targetProjectIdForSend: PROJECT_ID,
    title: "OMP draft",
    nextRuntimeModeForSend: "full-access",
    interactionModeForSend: "default",
    nextThreadWorkingDirectory: null,
    activeThread: fakeThread(),
    targetProjectKindForSend: "project",
    setupScriptForWorktree: {
      id: "setup", name: "Setup", command: "bun setup", icon: "configure", runOnWorktreeCreate: true,
    },
    messageCreatedAt: "2026-09-30T00:00:01.000Z",
    turnAttachmentsPromise: Promise.resolve(stagedAttachments()),
    messageIdForSend: "message-1",
    providerOptionsForDispatchForSend: undefined,
    outgoingMessageText: "hello from OMP",
    cediaSelectedSlashCommand: undefined,
    mentionedSkillsForSend: [],
    mentionedPluginMentionsForSend: [],
    dispatchMode: "queue",
    sourceProposedPlanForSend: null,
    shouldResumeSettledLocalThread: false,
    currentActiveGitBranchForSend: null,
    queuedChatTurn: null,
    promptForSend: "hello from OMP",
    composerImagesSnapshot: [],
    composerFilesSnapshot: [],
    composerAssistantSelectionsSnapshot: [],
    composerBrowserAnnotationsSnapshot: [],
    composerFileCommentsSnapshot: [],
    composerTerminalContextsSnapshot: [],
    composerPastedTextsSnapshot: [],
    composerPullRequestContextsSnapshot: [],
    composerSkillsSnapshot: [],
    composerMentionsSnapshot: [],
    ...overrides,
  };
}

function createHookHarness(input: {
  readonly onReady: (execute: (turn: unknown) => Promise<boolean>) => void;
  readonly calls: ReturnType<typeof createCalls>;
}) {
  function Harness() {
    const execute = useChatTurnExecution({
      isServerThread: false,
      setStoreThreadWorkspace: input.calls.setStoreThreadWorkspace,
      clearLocalDispatchWorktreeSetup: input.calls.clearLocalDispatchWorktreeSetup,
      createWorktreeMutation: input.calls.createWorktreeMutation,
      beginLocalDispatch: input.calls.beginLocalDispatch,
      isLocalDraftThread: true,
      threadNotes: "",
      runProjectScript: input.calls.runProjectScript,
      persistThreadSettingsForNextTurn: input.calls.persistThreadSettingsForNextTurn,
      rememberCustomBinaryPathForDispatch: input.calls.rememberCustomBinaryPathForDispatch,
      assistantDeliveryMode: "streaming",
      setSettledThreadBranchWarningDismissedThreadId: vi.fn(),
      armLocalDispatchAckFallback: input.calls.armLocalDispatchAckFallback,
      setQueuedSteerGate: vi.fn(),
      threadId: THREAD_ID,
      planSidebarDismissedForTurnRef: { current: null },
      setPlanSidebarOpen: vi.fn(),
      setRestoredQueuedSourceProposedPlan: vi.fn(),
      failLocalDispatchWorktreeSetup: input.calls.failLocalDispatchWorktreeSetup,
      setOptimisticUserMessages: input.calls.setOptimisticUserMessages,
      promptRef: input.calls.promptRef,
      composerImagesRef: input.calls.composerImagesRef,
      composerFilesRef: input.calls.composerFilesRef,
      composerAssistantSelectionsRef: input.calls.composerAssistantSelectionsRef,
      composerBrowserAnnotationsRef: input.calls.composerBrowserAnnotationsRef,
      composerFileCommentsRef: input.calls.composerFileCommentsRef,
      composerTerminalContextsRef: input.calls.composerTerminalContextsRef,
      composerPastedTextsRef: input.calls.composerPastedTextsRef,
      composerPullRequestContextsRef: input.calls.composerPullRequestContextsRef,
      setPrompt: input.calls.setPrompt,
      setComposerCursor: vi.fn(),
      addComposerImagesToDraft: vi.fn(),
      addComposerFilesToDraft: vi.fn(),
      addComposerAssistantSelectionToDraft: vi.fn(),
      addComposerDraftBrowserAnnotations: vi.fn(),
      addComposerFileCommentToDraft: vi.fn(),
      addComposerTerminalContextsToDraft: vi.fn(),
      addComposerPastedTextsToDraft: vi.fn(),
      addComposerPullRequestContextsToDraft: vi.fn(),
      updateSelectedComposerSkills: vi.fn(),
      updateSelectedComposerMentions: vi.fn(),
      setComposerTrigger: vi.fn(),
      setThreadError: input.calls.setThreadError,
      sendInFlightRef: input.calls.sendInFlightRef,
      worktreeSetupResolutionRef: input.calls.worktreeSetupResolutionRef,
      scheduleFailedWorktreeSetupDispatchReset: input.calls.scheduleFailedWorktreeSetupDispatchReset,
      resetLocalDispatch: input.calls.resetLocalDispatch,
    });
    useEffect(() => input.onReady(execute as (turn: unknown) => Promise<boolean>), [execute]);
    return null;
  }
  return Harness;
}

function createCalls() {
  return {
    beginLocalDispatch: vi.fn(),
    clearLocalDispatchWorktreeSetup: vi.fn(),
    createWorktreeMutation: { mutateAsync: vi.fn() },
    runProjectScript: vi.fn(async () => null),
    persistThreadSettingsForNextTurn: vi.fn(async () => undefined),
    rememberCustomBinaryPathForDispatch: vi.fn(),
    armLocalDispatchAckFallback: vi.fn(),
    failLocalDispatchWorktreeSetup: vi.fn(),
    setOptimisticUserMessages: vi.fn(),
    setStoreThreadWorkspace: vi.fn(),
    setThreadError: vi.fn(),
    scheduleFailedWorktreeSetupDispatchReset: vi.fn(),
    resetLocalDispatch: vi.fn(),
    setPrompt: vi.fn(),
    promptRef: { current: "" },
    composerImagesRef: { current: [] },
    composerFilesRef: { current: [] },
    composerAssistantSelectionsRef: { current: [] },
    composerBrowserAnnotationsRef: { current: [] },
    composerFileCommentsRef: { current: [] },
    composerTerminalContextsRef: { current: [] },
    composerPastedTextsRef: { current: [] },
    composerPullRequestContextsRef: { current: [] },
    sendInFlightRef: { current: true },
    worktreeSetupResolutionRef: { current: null },
  };
}

async function mountExecutor(calls: ReturnType<typeof createCalls>) {
  let execute: ((turn: unknown) => Promise<boolean>) | null = null;
  const mounted = await render(
    createElement(createHookHarness({
      calls,
      onReady: (nextExecute) => {
        execute = nextExecute;
      },
    })),
  );
  await vi.waitFor(() => expect(execute).not.toBeNull());
  return {
    mounted,
    execute: execute!,
  };
}

describe("useChatTurnExecution native OMP worktree send", () => {
  beforeEach(() => { harnessState.draftDirtyFiles = ["keep.ts"]; });
  afterEach(async () => { await cleanup(); harnessState.nativeApi = null; });
  it.each([{ dirtyFiles: [] }, { dirtyFiles: ["keep.ts"] }])("skips renderer worktree creation, carries $dirtyFiles, and runs setup in the canonical host path", async ({ dirtyFiles }) => {
    const commands: Command[] = [];
    const calls = createCalls();
    const api = createApi({
      commands,
      getThreadDetailSnapshot: vi.fn(async () => canonicalHostSnapshot()),
    });
    const setupScript = {
      id: "setup",
      name: "Setup",
      command: "bun setup",
      icon: "configure",
      runOnWorktreeCreate: true,
    } as const;
    calls.runProjectScript.mockImplementation(async (_script, options) => {
      expect(options).toMatchObject({ cwd: HOST_WORKTREE, worktreePath: HOST_WORKTREE });
      return null;
    });
    harnessState.draftDirtyFiles = dirtyFiles;
    const { mounted, execute } = await mountExecutor(calls);
    const turn = createPreparedTurn({
      api,
      setupScriptForWorktree: setupScript,
    });
    const result = await execute(turn);

    expect(result).toBe(true);
    expect(calls.createWorktreeMutation.mutateAsync).not.toHaveBeenCalled();
    expect(commands.map((command) => command.type)).toEqual(["thread.create", "thread.turn.start"]);
    expect(commands[0]).toMatchObject({
      type: "thread.create",
      envMode: "worktree",
      baseRef: "main",
      dirtyFiles,
    });
    expect(commands[1]).toMatchObject({
      type: "thread.turn.start",
      runtimeMode: "full-access",
    });
    expect(calls.setStoreThreadWorkspace).toHaveBeenCalledWith(
      THREAD_ID,
      expect.objectContaining({
        envMode: "worktree",
        worktreePath: HOST_WORKTREE,
        workingDirectory: HOST_WORKTREE,
        branch: "cedia/omp-draft-thread",
      }),
    );
    expect(calls.runProjectScript).toHaveBeenCalledTimes(1);
    expect(api.git.removeWorktree).not.toHaveBeenCalled();
    await mounted.unmount();
  });

  it("honors Cancel before host promotion without creating a task or turn, and restores the prompt", async () => {
    const commands: Command[] = [];
    const calls = createCalls();
    const resolution = createWorktreeSetupResolution();
    resolution.resolve("cancel");
    const api = createApi({
      commands,
      getThreadDetailSnapshot: vi.fn(async () => canonicalHostSnapshot()),
    });
    harnessState.draftDirtyFiles = [];
    const { mounted, execute } = await mountExecutor(calls);
    const result = await execute(createPreparedTurn({ api, worktreeSetupResolution: resolution }));

    expect(result).toBe(false);
    expect(commands).toEqual([]);
    expect(calls.createWorktreeMutation.mutateAsync).not.toHaveBeenCalled();
    expect(calls.setPrompt).toHaveBeenCalledWith("hello from OMP");
    expect(calls.setThreadError).not.toHaveBeenCalled();
    expect(api.git.removeWorktree).not.toHaveBeenCalled();
    expect(calls.runProjectScript).not.toHaveBeenCalled();
    await mounted.unmount();
  });

  it("does not start or delete the host task when Cancel arrives during readback", async () => {
    const commands: Command[] = [];
    const calls = createCalls();
    const snapshot = deferred<ReturnType<typeof canonicalHostSnapshot>>();
    const resolution = createWorktreeSetupResolution();
    const api = createApi({
      commands,
      getThreadDetailSnapshot: vi.fn(() => snapshot.promise),
    });
    const { mounted, execute } = await mountExecutor(calls);
    const execution = execute(createPreparedTurn({ api, worktreeSetupResolution: resolution }));
    await vi.waitFor(() => expect(api.orchestration.getThreadDetailSnapshot).toHaveBeenCalledTimes(1));
    resolution.resolve("cancel");
    snapshot.resolve(canonicalHostSnapshot());

    expect(await execution).toBe(false);
    expect(commands.map((command) => command.type)).toEqual(["thread.create"]);
    expect(calls.setThreadError).not.toHaveBeenCalled();
    expect(calls.setPrompt).toHaveBeenCalledWith("hello from OMP");
    expect(api.git.removeWorktree).not.toHaveBeenCalled();
    expect(calls.runProjectScript).not.toHaveBeenCalled();
    await mounted.unmount();
  });

  it("does not start or delete the host task when Work locally arrives during readback", async () => {
    const commands: Command[] = [];
    const calls = createCalls();
    const snapshot = deferred<ReturnType<typeof canonicalHostSnapshot>>();
    const resolution = createWorktreeSetupResolution();
    const api = createApi({
      commands,
      getThreadDetailSnapshot: vi.fn(() => snapshot.promise),
    });
    const { mounted, execute } = await mountExecutor(calls);
    const execution = execute(createPreparedTurn({ api, worktreeSetupResolution: resolution }));
    await vi.waitFor(() => expect(api.orchestration.getThreadDetailSnapshot).toHaveBeenCalledTimes(1));
    resolution.resolve("work-locally");
    snapshot.resolve(canonicalHostSnapshot());

    expect(await execution).toBe(false);
    expect(commands.map((command) => command.type)).toEqual(["thread.create"]);
    expect(calls.setThreadError).toHaveBeenCalledWith(
      THREAD_ID,
      "CEDIA already created this worktree task. Continue that task or start a separate local task.",
    );
    expect(calls.setPrompt).toHaveBeenCalledWith("hello from OMP");
    expect(api.git.removeWorktree).not.toHaveBeenCalled();
    expect(calls.runProjectScript).not.toHaveBeenCalled();
    await mounted.unmount();
  });

  it.each([
    ["null", async () => null],
    ["rejected", async () => Promise.reject(new Error("snapshot unavailable"))],
    [
      "noncanonical",
      async () => ({
        thread: {
          envMode: "worktree",
          branch: "cedia/omp-draft-thread",
          worktreePath: PROJECT_CWD,
          workingDirectory: PROJECT_CWD,
        },
      }),
    ],
  ])("blocks the turn on %s host readback without deleting the promoted task", async (_name, readback) => {
    const commands: Command[] = [];
    const calls = createCalls();
    const api = createApi({
      commands,
      getThreadDetailSnapshot: vi.fn(readback as NativeApi["orchestration"]["getThreadDetailSnapshot"]),
    });
    const { mounted, execute } = await mountExecutor(calls);
    const result = await execute(createPreparedTurn({ api }));

    expect(result).toBe(false);
    expect(commands.map((command) => command.type)).toEqual(["thread.create"]);
    expect(calls.setThreadError).toHaveBeenCalled();
    expect(calls.setPrompt).toHaveBeenCalledWith("hello from OMP");
    expect(api.git.removeWorktree).not.toHaveBeenCalled();
    expect(calls.runProjectScript).not.toHaveBeenCalled();
    await mounted.unmount();
  });
});
