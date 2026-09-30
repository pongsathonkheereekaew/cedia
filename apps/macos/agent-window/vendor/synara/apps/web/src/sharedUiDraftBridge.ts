// FILE: sharedUiDraftBridge.ts
// Purpose: Keep the serializable composer draft for one thread shared between
// the standalone Agents Window and the IDE webview.
// Layer: Renderer persistence seam
// Depends on: the host's scoped `vscode:cediaAgent` uiDraft request and Synara's
// existing composer draft persistence normalizer.

import type { ThreadId } from "@synara/contracts";

import {
  migratePersistedComposerDraftStoreState,
  partializeComposerDraftStoreState,
  toHydratedThreadDraft,
  type PersistedComposerDraftStoreState,
} from "./composerDraftPersistence";
import { useComposerDraftStore } from "./composerDraftStore";
import type { ComposerDraftStoreState } from "./composerDraftDomain";

const CEDIA_AGENT_CHANNEL = "vscode:cediaAgent";
/** The channel the main process publishes another Mac window's committed revision on (§2.5 item 1). */
// The Code-OSS preload only delivers channels in the `vscode:` namespace to the renderer
// (`validateIPC`), which is what makes this subscription possible at all.
const CEDIA_DRAFT_UPDATE_CHANNEL = "vscode:cedia-draft-updated";
const WRITE_DEBOUNCE_MS = 160;
const DRAFT_RECONCILE_INTERVAL_MS = 5_000;

export interface SharedUiDraftPayload {
  readonly draft: unknown | null;
  readonly draftThread: unknown | null;
  /** Mapping entries that point at this thread (kept narrow to avoid full-store writes). */
  readonly projectMappings?: Readonly<Record<string, string>>;
}

export interface SharedUiDraftBridge {
  hydrateThread: (threadId: string) => Promise<void>;
  flush: () => Promise<void>;
  /**
   * The other window changed a draft this one is still editing. Cedia never
   * auto-merges and never overwrites either side: the local text stays in the
   * register, the newer host revision stays on the host, and the window decides.
   */
  getConflict: (threadId: string) => SharedUiDraftConflict | null;
  /** "mine" re-sends the local text on top of the newer revision; "theirs" adopts it. */
  resolveConflict: (threadId: string, choice: "mine" | "theirs") => Promise<void>;
  dispose: () => void;
}

export interface SharedUiDraftConflict {
  readonly revision: number;
  readonly payload: SharedUiDraftPayload;
}

interface SharedUiDraftTransport {
  invoke: (channel: string, input?: unknown) => Promise<unknown>;
  /** Present in both real renderers; the push half of the shared draft needs it. */
  on?: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
  removeListener?: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
}

export interface SharedUiDraftBridgeOptions {
  /** Subscribe to the app router's route notifications (pushState has no hashchange event). */
  subscribeToRouteChanges?: (listener: () => void) => () => void;
}

interface SharedUiDraftRequest {
  readonly kind: "uiDraft";
  readonly threadId: string;
  readonly action: "read" | "write";
  readonly draft?: SharedUiDraftPayload;
  /** The host revision this write is based on; the host rejects a stale one. */
  readonly expectedRevision?: number;
}

/** What the main process answers for a read or write (plan §2.5). */
interface SharedUiDraftReadResult {
  readonly revision?: unknown;
  readonly payload?: unknown;
  readonly stale?: unknown;
}

interface SharedUiDraftWriteResult {
  readonly status?: unknown;
  readonly revision?: unknown;
  readonly payload?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadFromValue(value: unknown): SharedUiDraftPayload | null {
  if (!isRecord(value)) return null;
  const draft = value.draft;
  const draftThread = value.draftThread;
  const projectMappings = isRecord(value.projectMappings)
    ? Object.fromEntries(
        Object.entries(value.projectMappings).filter(
          ([, mapping]) => typeof mapping === "string",
        ) as Array<[string, string]>,
      )
    : undefined;
  if (draft === undefined && draftThread === undefined && projectMappings === undefined) {
    return null;
  }
  return {
    draft: draft ?? null,
    draftThread: draftThread ?? null,
    ...(projectMappings ? { projectMappings } : {}),
  };
}

function draftPayloadForThread(
  state: ComposerDraftStoreState,
  threadId: string,
): SharedUiDraftPayload {
  const persisted = partializeComposerDraftStoreState(state);
  const projectMappings = Object.fromEntries(
    Object.entries(persisted.projectDraftThreadIdByProjectId).filter(
      ([, mappedThreadId]) => mappedThreadId === threadId,
    ),
  );
  return {
    draft: persisted.draftsByThreadId[threadId as ThreadId] ?? null,
    draftThread: persisted.draftThreadsByThreadId[threadId as ThreadId] ?? null,
    // An empty mapping set is meaningful: it tells the other renderer to
    // remove stale project -> draft ownership after a draft is cleared.
    projectMappings,
  };
}

function serializedDraftForThread(state: ComposerDraftStoreState, threadId: string): string {
  return JSON.stringify(draftPayloadForThread(state, threadId));
}

function threadIdsForPayload(
  state: ComposerDraftStoreState,
  payload: SharedUiDraftPayload,
  threadId: string,
): PersistedComposerDraftStoreState {
  return migratePersistedComposerDraftStoreState({
    draftsByThreadId:
      payload.draft === null || payload.draft === undefined
        ? {}
        : { [threadId]: payload.draft },
    draftThreadsByThreadId:
      payload.draftThread === null || payload.draftThread === undefined
        ? {}
        : { [threadId]: payload.draftThread },
    projectDraftThreadIdByProjectId: payload.projectMappings ?? {},
    // Preserve the local sticky selections; the host payload is intentionally per-thread.
    stickyModelSelectionByProvider: partializeComposerDraftStoreState(state).stickyModelSelectionByProvider,
    stickyActiveProvider: partializeComposerDraftStoreState(state).stickyActiveProvider,
  });
}

function applyRemoteDraft(threadId: string, payload: SharedUiDraftPayload): void {
  const currentState = useComposerDraftStore.getState();
  const normalized = threadIdsForPayload(currentState, payload, threadId);
  const nextDrafts = { ...currentState.draftsByThreadId };
  const persistedDraft = normalized.draftsByThreadId[threadId as ThreadId];
  if (payload.draft === null) {
    delete nextDrafts[threadId as ThreadId];
  } else if (persistedDraft) {
    nextDrafts[threadId as ThreadId] = toHydratedThreadDraft(threadId as ThreadId, persistedDraft);
  }

  const nextDraftThreads = { ...currentState.draftThreadsByThreadId };
  const persistedDraftThread = normalized.draftThreadsByThreadId[threadId as ThreadId];
  if (payload.draftThread === null) {
    delete nextDraftThreads[threadId as ThreadId];
  } else if (persistedDraftThread) {
    nextDraftThreads[threadId as ThreadId] = persistedDraftThread;
  }

  const nextMappings = { ...currentState.projectDraftThreadIdByProjectId };
  if (payload.projectMappings !== undefined) {
    const remoteMappings = normalized.projectDraftThreadIdByProjectId as Readonly<Record<string, string>>;
    for (const [mappingKey, mappedThreadId] of Object.entries(nextMappings)) {
      if (mappedThreadId === threadId && remoteMappings[mappingKey] === undefined) {
        delete nextMappings[mappingKey];
      }
    }
  }
  for (const [mappingKey, mappedThreadId] of Object.entries(normalized.projectDraftThreadIdByProjectId)) {
    if (mappedThreadId === threadId) nextMappings[mappingKey] = mappedThreadId;
  }

  useComposerDraftStore.setState({
    draftsByThreadId: nextDrafts,
    draftThreadsByThreadId: nextDraftThreads,
    projectDraftThreadIdByProjectId: nextMappings,
  });
}

function currentRouteThreadId(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#/, "").replace(/^\/+/, "").split(/[/?#]/, 1)[0] ?? "";
  return /^[A-Za-z0-9_-]{1,128}$/.test(raw) ? raw : null;
}

/**
 * Install the same small synchronization loop in both renderers. LocalStorage
 * remains the fast local cache; this bridge is the cross-origin handoff source.
 */
export function installSharedUiDraftBridge(
  transport: SharedUiDraftTransport,
  options: SharedUiDraftBridgeOptions = {},
): SharedUiDraftBridge {
  const pendingTimers = new Map<string, number>();
  const revisions = new Map<string, number>();
  const snapshots = new Map<string, string>();
  // Keep one ordered write tail per thread. The host may complete requests out
  // of order; chaining prevents an older payload from winning after a newer
  // keystroke has already been flushed.
  const writes = new Map<string, Promise<void>>();
  // The revision the host last confirmed for each thread, and any draft this window
  // is holding a conflicting local edit for.
  const hostRevisions = new Map<string, number>();
  const conflicts = new Map<string, SharedUiDraftConflict>();
  let applyingRemote = false;

  const initial = partializeComposerDraftStoreState(useComposerDraftStore.getState());
  for (const threadId of new Set([
    ...Object.keys(initial.draftsByThreadId),
    ...Object.keys(initial.draftThreadsByThreadId),
  ])) {
    snapshots.set(threadId, serializedDraftForThread(useComposerDraftStore.getState(), threadId));
    revisions.set(threadId, 0);
  }

  const writeThread = (threadId: string, expectedRevision: number): Promise<void> => {
    const payload = draftPayloadForThread(useComposerDraftStore.getState(), threadId);
    const request: SharedUiDraftRequest = {
      kind: "uiDraft",
      threadId,
      action: "write",
      draft: payload,
      expectedRevision: hostRevisions.get(threadId) ?? 0,
    };
    const previous = writes.get(threadId) ?? Promise.resolve();
    const write = previous
      .catch(() => undefined)
      .then(() => transport.invoke(CEDIA_AGENT_CHANNEL, request))
      .then(result => {
        const answer = (result ?? {}) as SharedUiDraftWriteResult;
        const revision = typeof answer.revision === "number" ? answer.revision : undefined;
        if (answer.status === "accepted") {
          if (revision !== undefined) hostRevisions.set(threadId, revision);
          if ((revisions.get(threadId) ?? 0) === expectedRevision) {
            snapshots.set(threadId, JSON.stringify(payload));
          }
          return;
        }
        if (answer.status !== "conflict" || revision === undefined) {
          // Unavailable: the local register keeps the text and the main process keeps
          // its cache; the next edit or hydrate retries. Nothing is reported as saved.
          return;
        }
        hostRevisions.set(threadId, revision);
        const remote = payloadFromValue(answer.payload);
        if (!remote) return;
        if ((revisions.get(threadId) ?? 0) === expectedRevision) {
          // Nothing local is pending, so the newer revision is simply the truth.
          applyingRemote = true;
          try {
            applyRemoteDraft(threadId, remote);
            snapshots.set(threadId, serializedDraftForThread(useComposerDraftStore.getState(), threadId));
            conflicts.delete(threadId);
          } finally {
            applyingRemote = false;
          }
          return;
        }
        // The user typed here since this write started. Keep both versions and let the
        // window decide; writing now would discard the other window's text silently.
        conflicts.set(threadId, { revision, payload: remote });
      })
      .catch(() => undefined);
    const tail = write.finally(() => {
      if (writes.get(threadId) === tail) writes.delete(threadId);
    });
    writes.set(threadId, tail);
    return tail;
  };

  const scheduleWrite = (threadId: string): void => {
    // While a conflict is open this window does not write: the other window's newer
    // revision stays intact until the user picks a side.
    if (conflicts.has(threadId)) return;
    const existing = pendingTimers.get(threadId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      pendingTimers.delete(threadId);
      void writeThread(threadId, revisions.get(threadId) ?? 0);
    }, WRITE_DEBOUNCE_MS);
    pendingTimers.set(threadId, timer);
  };

  const unsubscribe = useComposerDraftStore.subscribe((state) => {
    if (applyingRemote) return;
    const persisted = partializeComposerDraftStoreState(state);
    const threadIds = new Set([
      ...Object.keys(persisted.draftsByThreadId),
      ...Object.keys(persisted.draftThreadsByThreadId),
      ...snapshots.keys(),
    ]);
    for (const threadId of threadIds) {
      const nextSnapshot = serializedDraftForThread(state, threadId);
      if (snapshots.get(threadId) === nextSnapshot) continue;
      revisions.set(threadId, (revisions.get(threadId) ?? 0) + 1);
      scheduleWrite(threadId);
    }
  });

  const hydrateThread = async (threadId: string): Promise<void> => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) return;
    const currentSnapshot = serializedDraftForThread(useComposerDraftStore.getState(), threadId);
    if (
      pendingTimers.has(threadId) ||
      writes.has(threadId) ||
      (snapshots.has(threadId) && snapshots.get(threadId) !== currentSnapshot)
    ) {
      return;
    }
    const revisionAtStart = revisions.get(threadId) ?? 0;
    let value: unknown;
    try {
      value = await transport.invoke(CEDIA_AGENT_CHANNEL, {
        kind: "uiDraft",
        threadId,
        action: "read",
      } satisfies SharedUiDraftRequest);
    } catch {
      return;
    }
    if ((revisions.get(threadId) ?? 0) !== revisionAtStart) return;
    // A conflicting local edit outranks a hydrate: the window still has to choose.
    if (conflicts.has(threadId)) return;
    const answer = (value ?? undefined) as SharedUiDraftReadResult | undefined;
    if (answer && typeof answer.revision === "number") hostRevisions.set(threadId, answer.revision);
    const payload = payloadFromValue(answer?.payload ?? value);
    if (!payload) return;
    applyingRemote = true;
    try {
      applyRemoteDraft(threadId, payload);
      snapshots.set(threadId, serializedDraftForThread(useComposerDraftStore.getState(), threadId));
    } finally {
      applyingRemote = false;
    }
  };

  const onRouteChange = (): void => {
    const threadId = currentRouteThreadId();
    if (threadId) void hydrateThread(threadId);
  };
  const unsubscribeRouteChanges = options.subscribeToRouteChanges?.(onRouteChange);
  // Keep the browser fallback for non-router clients. In the app, TanStack history
  // publishes push/replace notifications without dispatching a DOM hashchange event.
  if (!unsubscribeRouteChanges) window.addEventListener("hashchange", onRouteChange);
  window.addEventListener("focus", onRouteChange);
  const reconcileTimer = window.setInterval(onRouteChange, DRAFT_RECONCILE_INTERVAL_MS);

  /**
   * Is this window still holding an edit the host has not confirmed?
   *
   * A pending debounce, an in-flight write or a register that differs from the last confirmed
   * snapshot all mean the same thing: adopting the other window's newer payload now would
   * silently discard text the user can still see.
   */
  const hasPendingLocalEdit = (threadId: string): boolean => {
    if (pendingTimers.has(threadId) || writes.has(threadId)) return true;
    const confirmed = snapshots.get(threadId);
    // No recorded snapshot means this window holds nothing for the thread: an absent register is
    // not an unsaved edit, so the other window's revision is simply the truth.
    if (confirmed === undefined) return false;
    return confirmed !== serializedDraftForThread(useComposerDraftStore.getState(), threadId);
  };

  const adopt = (threadId: string, revision: number, payload: SharedUiDraftPayload): void => {
    applyingRemote = true;
    try {
      applyRemoteDraft(threadId, payload);
      snapshots.set(threadId, serializedDraftForThread(useComposerDraftStore.getState(), threadId));
    } finally {
      applyingRemote = false;
    }
    hostRevisions.set(threadId, revision);
  };

  /**
   * The other Mac window committed a revision, or a Send delivered the draft it named.
   *
   * This is the push half of §2.5 item 1: without it the two windows only converge when one is
   * focused, so the window that is not looking can hold text the host has already moved past.
   */
  const applyBroadcast = (value: unknown): void => {
    if (!isRecord(value)) return;
    const threadId = typeof value.threadId === "string" ? value.threadId : "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) return;
    if (value.status === "delivered") {
      // The host deleted the delivered record, so its revision space restarts at 1. A window
      // that is still composing keeps its text as the next draft; one that is not simply
      // loses a draft that has already been sent.
      if (hasPendingLocalEdit(threadId)) {
        hostRevisions.set(threadId, 0);
        return;
      }
      adopt(threadId, 0, { draft: null, draftThread: null, projectMappings: {} });
      conflicts.delete(threadId);
      return;
    }
    if (value.status !== "written") return;
    const revision = value.revision;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) return;
    if (revision <= (hostRevisions.get(threadId) ?? 0)) return;
    const payload = payloadFromValue(value.payload);
    if (!payload) return;
    if (hasPendingLocalEdit(threadId)) {
      // Keep both versions: this window typed since the last confirmed revision, so the user
      // chooses rather than the bridge discarding one of them.
      hostRevisions.set(threadId, revision);
      conflicts.set(threadId, { revision, payload });
      return;
    }
    adopt(threadId, revision, payload);
    conflicts.delete(threadId);
  };
  const onDraftUpdate = (_event: unknown, ...args: unknown[]): void => {
    applyBroadcast(args[0]);
  };
  transport.on?.(CEDIA_DRAFT_UPDATE_CHANNEL, onDraftUpdate);

  return {
    hydrateThread,
    flush: async () => {
      for (const [threadId, timer] of pendingTimers) {
        window.clearTimeout(timer);
        pendingTimers.delete(threadId);
        // A conflicted thread is deliberately left unwritten; its text stays in the
        // register until the window resolves the conflict.
        if (conflicts.has(threadId)) continue;
        void writeThread(threadId, revisions.get(threadId) ?? 0);
      }
      await Promise.all([...writes.values()]);
    },
    getConflict: (threadId: string) => conflicts.get(threadId) ?? null,
    resolveConflict: async (threadId: string, choice: "mine" | "theirs"): Promise<void> => {
      const conflict = conflicts.get(threadId);
      if (!conflict) return;
      if (choice === "theirs") {
        applyingRemote = true;
        try {
          applyRemoteDraft(threadId, conflict.payload);
          snapshots.set(threadId, serializedDraftForThread(useComposerDraftStore.getState(), threadId));
        } finally {
          applyingRemote = false;
        }
        hostRevisions.set(threadId, conflict.revision);
        conflicts.delete(threadId);
        return;
      }
      // Keep this window's text, sent on top of the revision the host reported, so the
      // other window's version stays recoverable in its own register until it hydrates.
      conflicts.delete(threadId);
      hostRevisions.set(threadId, conflict.revision);
      await writeThread(threadId, revisions.get(threadId) ?? 0);
    },
    dispose: () => {
      unsubscribe();
      transport.removeListener?.(CEDIA_DRAFT_UPDATE_CHANNEL, onDraftUpdate);
      for (const timer of pendingTimers.values()) window.clearTimeout(timer);
      pendingTimers.clear();
      window.clearInterval(reconcileTimer);
      unsubscribeRouteChanges?.();
      if (!unsubscribeRouteChanges) window.removeEventListener("hashchange", onRouteChange);
      window.removeEventListener("focus", onRouteChange);
    },
  };
}
