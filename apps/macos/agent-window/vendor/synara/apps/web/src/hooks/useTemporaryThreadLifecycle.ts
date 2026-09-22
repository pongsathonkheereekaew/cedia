// FILE: useTemporaryThreadLifecycle.ts
// Purpose: Puts a temporary thread away when focus leaves it — archived, not deleted.
// Layer: Web route lifecycle hook
// Exports: useTemporaryThreadLifecycle
//
// Cedia deviation (§10 item 1d): upstream DELETES the temporary thread here, which
// is safe on a server that models a draft as scratch. A Cedia thread is a durable
// host session from the moment it exists, and the host's DELETE removes the record
// and its transcript for good — so a draft the user glanced away from was lost, and
// an observed case showed a `New task` row gone from the host store the same day.
// The automatic path therefore archives: the thread leaves the sidebar (archived
// rows are hidden), survives a restart, and is restorable from Settings → Archived.
// Only explicit user deletion (`activeThreadDelete`, the Archived panel's own rows)
// still dispatches `thread.delete`.

import type { ThreadId } from "@synara/contracts";
import { useEffect, useRef } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { archiveThreadFromClient } from "../lib/threadArchive";
import { resolveTemporaryThreadIdToDelete } from "../lib/temporaryThread";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import { useTemporaryThreadStore } from "../temporaryThreadStore";
import { useTerminalStateStore } from "../terminalStateStore";
import { getThreadFromState } from "../threadDerivation";

export function useTemporaryThreadLifecycle(activeThreadId: ThreadId | null): void {
  const clearDraftThread = useComposerDraftStore((store) => store.clearDraftThread);
  const clearTerminalState = useTerminalStateStore((store) => store.clearTerminalState);
  const removeThreadFromSplitViews = useSplitViewStore((store) => store.removeThreadFromSplitViews);
  const temporaryThreadIds = useTemporaryThreadStore((store) => store.temporaryThreadIds);
  const clearTemporaryThread = useTemporaryThreadStore((store) => store.clearTemporaryThread);
  const initialDraftIsTemporary = useComposerDraftStore(
    (store) =>
      activeThreadId !== null && store.draftThreadsByThreadId[activeThreadId]?.isTemporary === true,
  );
  const previousThreadStateRef = useRef<{
    threadId: ThreadId | null;
    wasTemporary: boolean;
  }>({
    threadId: activeThreadId,
    wasTemporary:
      (activeThreadId ? temporaryThreadIds[activeThreadId] === true : false) ||
      initialDraftIsTemporary,
  });
  const disposingThreadIdsRef = useRef<Set<ThreadId>>(new Set());

  useEffect(() => {
    const previousThreadState = previousThreadStateRef.current;
    const draftThreadsByThreadId = useComposerDraftStore.getState().draftThreadsByThreadId;
    previousThreadStateRef.current = {
      threadId: activeThreadId,
      wasTemporary: activeThreadId
        ? temporaryThreadIds[activeThreadId] === true ||
          draftThreadsByThreadId[activeThreadId]?.isTemporary === true
        : false,
    };

    const temporaryThreadId = resolveTemporaryThreadIdToDelete({
      previousThreadId: previousThreadState.threadId,
      nextThreadId: activeThreadId,
      previousThreadWasTemporary: previousThreadState.wasTemporary,
      draftThreadsByThreadId,
    });
    if (!temporaryThreadId || disposingThreadIdsRef.current.has(temporaryThreadId)) {
      return;
    }

    disposingThreadIdsRef.current.add(temporaryThreadId);
    void disposeTemporaryThread({
      temporaryThreadId,
      disposingThreadIds: disposingThreadIdsRef.current,
      clearDraftThread,
      clearTerminalState,
      removeThreadFromSplitViews,
      clearTemporaryThread,
    });
  }, [
    activeThreadId,
    clearDraftThread,
    clearTerminalState,
    clearTemporaryThread,
    removeThreadFromSplitViews,
    temporaryThreadIds,
  ]);
}

// Module-level so the try/finally stays outside the compiled hook body —
// React Compiler does not yet support try/finally and would otherwise skip
// optimizing the whole hook.
async function disposeTemporaryThread(input: {
  temporaryThreadId: ThreadId;
  disposingThreadIds: Set<ThreadId>;
  clearDraftThread: (threadId: ThreadId) => void;
  clearTerminalState: (threadId: ThreadId) => void;
  removeThreadFromSplitViews: (threadId: ThreadId) => void;
  clearTemporaryThread: (threadId: ThreadId) => void;
}): Promise<void> {
  const { temporaryThreadId } = input;
  try {
    const api = readNativeApi();
    const storeState = useStore.getState();
    const serverThread = getThreadFromState(storeState, temporaryThreadId) ?? null;

    if (api) {
      if (serverThread?.session && serverThread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId: temporaryThreadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      await api.terminal
        .close({ threadId: temporaryThreadId, deleteHistory: true })
        .catch(() => undefined);

      if (serverThread) {
        // Archive, never delete: the transcript belongs to the user, and losing
        // focus is not a request to destroy it. A failure here keeps the draft
        // markers cleared below, so the thread simply stays in the sidebar.
        await archiveThreadFromClient(api.orchestration, temporaryThreadId).catch(() => undefined);
      }
    }

    input.clearDraftThread(temporaryThreadId);
    input.clearTerminalState(temporaryThreadId);
    input.removeThreadFromSplitViews(temporaryThreadId);
    input.clearTemporaryThread(temporaryThreadId);
  } finally {
    input.disposingThreadIds.delete(temporaryThreadId);
  }
}
