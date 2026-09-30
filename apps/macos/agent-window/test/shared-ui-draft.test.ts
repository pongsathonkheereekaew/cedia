import { afterEach, expect, it } from "bun:test";
import { ThreadId } from "../vendor/synara/packages/contracts/src";
import { useComposerDraftStore } from "../vendor/synara/apps/web/src/composerDraftStore";
import { selectedSlashCommandForSend } from "../vendor/synara/apps/web/src/components/chat/chatSendTypes";
import { installSharedUiDraftBridge } from "../vendor/synara/apps/web/src/sharedUiDraftBridge";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const id = ThreadId.makeUnsafe("shared-draft-test");
let dispose: (() => void) | undefined;
let draftPoll: (() => void) | undefined;
let clearedDraftPoll = false;
/** The push half of §2.5 item 1: the main process publishing the other window's revision. */
function pushTransport() {
  const listeners = new Map<string, Array<(event: unknown, ...args: unknown[]) => void>>();
  const channels: string[] = [];
  return {
    channels,
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      channels.push(channel);
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
    },
    removeListener: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      listeners.set(channel, (listeners.get(channel) ?? []).filter(entry => entry !== listener));
    },
    emit: (channel: string, value: unknown) => {
      for (const listener of listeners.get(channel) ?? []) listener({}, value);
    },
    listenerCount: (channel: string) => (listeners.get(channel) ?? []).length,
  };
}
function setup() {
  draftPoll = undefined;
  clearedDraftPoll = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout, clearTimeout,
    setInterval: (callback: () => void) => { draftPoll = callback; return 41; },
    clearInterval: (timer: number) => { if (timer === 41) clearedDraftPoll = true; },
    addEventListener() {}, removeEventListener() {}, location: { hash: `#/${id}` },
  } });
  useComposerDraftStore.setState({ draftsByThreadId: {}, draftThreadsByThreadId: {}, projectDraftThreadIdByProjectId: {} });
}
afterEach(() => {
  dispose?.(); dispose = undefined;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it("does not replace an unsaved edit when focus hydration reads older state", async () => {
  setup();
  let reads = 0;
  const bridge = installSharedUiDraftBridge({ invoke: async (_channel, input) => {
    if ((input as { action: string }).action === "read") reads++;
    return { draft: null, draftThread: null, projectMappings: {} };
  } });
  dispose = bridge.dispose;
  useComposerDraftStore.getState().setPrompt(id, "unsaved local text");
  await bridge.hydrateThread(id);
  expect(reads).toBe(0);
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("unsaved local text");
  await bridge.flush();
  await bridge.hydrateThread(id);
  expect(useComposerDraftStore.getState().draftsByThreadId[id]).toBeUndefined();
});

it("serializes saves so a delayed old write cannot win after the latest flush", async () => {
  setup();
  const seen: string[] = [];
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const bridge = installSharedUiDraftBridge({ invoke: async (_channel, input) => {
    const row = input as { action: string; draft: { draft: { prompt: string } } };
    if (row.action === "write") {
      seen.push(row.draft.draft.prompt);
      if (seen.length === 1) await first;
    }
    return null;
  } });
  dispose = bridge.dispose;
  useComposerDraftStore.getState().setPrompt(id, "first");
  const flushingFirst = bridge.flush();
  await tick();
  useComposerDraftStore.getState().setPrompt(id, "second");
  let completed = false;
  const flushingSecond = bridge.flush().then(() => { completed = true; });
  await tick();
  expect(seen).toEqual(["first"]);
  expect(completed).toBe(false);
  release();
  await Promise.all([flushingFirst, flushingSecond]);
  expect(seen).toEqual(["first", "second"]);
  expect(completed).toBe(true);
});

it("carries the host revision between writes and adopts a newer revision when nothing is pending", async () => {
  setup();
  const sent: Array<{ action: string; expectedRevision?: number }> = [];
  let host = { revision: 1, text: "from the other window" };
  const bridge = installSharedUiDraftBridge({ invoke: async (_channel, input) => {
    const row = input as { action: string; expectedRevision?: number };
    sent.push({ action: row.action, ...(row.expectedRevision === undefined ? {} : { expectedRevision: row.expectedRevision }) });
    if (row.action === "write") {
      host = { revision: host.revision + 1, text: "mine" };
      return { status: "accepted", revision: host.revision };
    }
    return null;
  } });
  dispose = bridge.dispose;

  useComposerDraftStore.getState().setPrompt(id, "mine");
  await bridge.flush();
  expect(sent.filter(row => row.action === "write")).toEqual([{ action: "write", expectedRevision: 0 }]);

  useComposerDraftStore.getState().setPrompt(id, "mine again");
  await bridge.flush();
  expect(sent.filter(row => row.action === "write").at(-1)).toEqual({ action: "write", expectedRevision: 2 });
});

it("keeps the local text when another window won, and lets the window choose a side", async () => {
  setup();
  const sent: Array<{ action: string; expectedRevision?: number }> = [];
  const remote = { draft: { prompt: "other window" }, draftThread: null, projectMappings: {} };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bridge = installSharedUiDraftBridge({ invoke: async (_channel, input) => {
    const row = input as { action: string; expectedRevision?: number };
    sent.push({ action: row.action, ...(row.expectedRevision === undefined ? {} : { expectedRevision: row.expectedRevision }) });
    if (row.action === "write") {
      // The host holds revision 5; every write from this window is stale.
      await gate;
      return { status: "conflict", revision: 5, payload: remote };
    }
    return { revision: 5, payload: remote };
  } });
  dispose = bridge.dispose;

  // A local edit is already pending when the conflict lands, so nothing is overwritten.
  useComposerDraftStore.getState().setPrompt(id, "local text");
  const flushing = bridge.flush();
  await tick();
  useComposerDraftStore.getState().setPrompt(id, "local text, still typing");
  release();
  await flushing;

  const conflict = bridge.getConflict(id);
  expect(conflict?.revision).toBe(5);
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("local text, still typing");

  // A conflicted thread stops writing until the window picks a side.
  useComposerDraftStore.getState().setPrompt(id, "local text, third keystroke");
  await bridge.flush();
  expect(sent.filter(row => row.action === "write")).toHaveLength(1);

  await bridge.resolveConflict(id, "theirs");
  expect(bridge.getConflict(id)).toBeNull();
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("other window");
});

it("re-sends the local text on top of the winning revision when the window keeps its own side", async () => {
  setup();
  const sent: Array<{ action: string; expectedRevision?: number }> = [];
  const remote = { draft: { prompt: "other window" }, draftThread: null, projectMappings: {} };
  let conflictOnce = true;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bridge = installSharedUiDraftBridge({ invoke: async (_channel, input) => {
    const row = input as { action: string; expectedRevision?: number };
    sent.push({ action: row.action, ...(row.expectedRevision === undefined ? {} : { expectedRevision: row.expectedRevision }) });
    if (row.action !== "write") return { revision: 5, payload: remote };
    if (conflictOnce) {
      conflictOnce = false;
      await gate;
      return { status: "conflict", revision: 5, payload: remote };
    }
    return { status: "accepted", revision: 6 };
  } });
  dispose = bridge.dispose;

  useComposerDraftStore.getState().setPrompt(id, "mine wins");
  const flushing = bridge.flush();
  await tick();
  useComposerDraftStore.getState().setPrompt(id, "mine wins, still typing");
  release();
  await flushing;
  expect(bridge.getConflict(id)).not.toBeNull();

  await bridge.resolveConflict(id, "mine");
  expect(bridge.getConflict(id)).toBeNull();
  const writes = sent.filter(row => row.action === "write");
  expect(writes.at(-1)).toEqual({ action: "write", expectedRevision: 5 });
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("mine wins, still typing");
});

it("adopts the other window's pushed revision while nothing is pending here", async () => {
  setup();
  const transport = pushTransport();
  const bridge = installSharedUiDraftBridge({ invoke: async () => null, ...transport });
  dispose = bridge.dispose;
  expect(transport.channels).toEqual(["vscode:cedia-draft-updated"]);

  transport.emit("vscode:cedia-draft-updated", {
    status: "written",
    threadId: id,
    revision: 3,
    payload: { draft: { prompt: "typed in the other window" }, draftThread: null, projectMappings: {} },
  });
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("typed in the other window");
  expect(bridge.getConflict(id)).toBeNull();

  // The revision the other window committed is the base the next write here must name.
  transport.emit("vscode:cedia-draft-updated", { status: "written", threadId: id, revision: 2, payload: { draft: { prompt: "older" } } });
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("typed in the other window");
  expect(transport.listenerCount("vscode:cedia-draft-updated")).toBe(1);
});

it("adopts a host draft when the embedded IDE misses the other window's push", async () => {
  setup();
  let reads = 0;
  const bridge = installSharedUiDraftBridge({ invoke: async (_channel, input) => {
    if ((input as { action?: string }).action === "read") {
      reads++;
      return {
        revision: 1,
        payload: { draft: { prompt: "typed in Agents" }, draftThread: null, projectMappings: {} },
      };
    }
    return null;
  } });
  dispose = bridge.dispose;

  draftPoll?.();
  await tick();

  expect(reads).toBe(1);
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("typed in Agents");
  bridge.dispose();
  dispose = undefined;
  expect(clearedDraftPoll).toBe(true);
});

it("hydrates the newly routed task when app history changes without a hashchange event", async () => {
  setup();
  const otherId = ThreadId.makeUnsafe("other-route");
  let onRouteChange: (() => void) | undefined;
  const reads: string[] = [];
  const bridge = installSharedUiDraftBridge({ invoke: async (_channel, input) => {
    const request = input as { threadId: string; action: string };
    if (request.action !== "read") return null;
    reads.push(request.threadId);
    return {
      revision: 1,
      payload: { draft: { prompt: `host draft for ${request.threadId}` }, draftThread: null, projectMappings: {} },
    };
  } }, {
    subscribeToRouteChanges: listener => {
      onRouteChange = listener;
      return () => { onRouteChange = undefined; };
    },
  });
  dispose = bridge.dispose;

  (window as unknown as { location: { hash: string } }).location.hash = `#/${otherId}`;
  onRouteChange?.();
  await tick();

  expect(reads).toEqual([otherId]);
  expect(useComposerDraftStore.getState().draftsByThreadId[otherId]?.prompt).toBe(`host draft for ${otherId}`);
  bridge.dispose();
  dispose = undefined;
  expect(onRouteChange).toBeUndefined();
});

it("shares menu-selected command provenance across renderer reload and host revisions", async () => {
  setup();
  let hostPayload: unknown = null;
  let hostRevision = 0;
  const committedDrafts: unknown[] = [];
  const windowA = installSharedUiDraftBridge({ invoke: async (_channel, input) => {
    const row = input as { action: string; draft?: unknown };
    if (row.action === "write") {
      hostPayload = row.draft;
      committedDrafts.push(row.draft);
      hostRevision++;
      return { status: "accepted", revision: hostRevision };
    }
    return { revision: hostRevision, payload: hostPayload };
  } });
  useComposerDraftStore.getState().setPrompt(id, "/fixture from the menu");
  useComposerDraftStore.getState().setSelectedSlashCommand(id, "fixture");
  await windowA.flush();
  windowA.dispose();

  expect(committedDrafts).toHaveLength(1);
  expect((hostPayload as { draft: { selectedSlashCommand?: string } }).draft.selectedSlashCommand)
    .toBe("fixture");

  // Model a fresh renderer: only the host's committed revision remains available.
  useComposerDraftStore.setState({ draftsByThreadId: {} });
  const windowB = installSharedUiDraftBridge({ invoke: async () => ({
    revision: hostRevision,
    payload: hostPayload,
  }) });
  await windowB.hydrateThread(id);
  const restored = useComposerDraftStore.getState().draftsByThreadId[id];
  expect(restored?.prompt).toBe("/fixture from the menu");
  expect(restored?.selectedSlashCommand).toBe("fixture");
  // Even if the catalog changed while Window B was closed, its retry remains a
  // marked command for the host's current-catalog guard to refuse before dispatch.
  expect(selectedSlashCommandForSend(
    restored?.selectedSlashCommand ? { threadId: id, name: restored.selectedSlashCommand } : null,
    id,
    restored?.prompt ?? "",
  )).toBe("fixture");

  useComposerDraftStore.getState().setPrompt(id, "/fixture with edited arguments");
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.selectedSlashCommand).toBe("fixture");
  useComposerDraftStore.getState().setPrompt(id, "/different now");
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.selectedSlashCommand).toBeNull();
  windowB.dispose();
});

it("keeps both texts when a pushed revision meets an unsaved local edit", async () => {
  setup();
  const transport = pushTransport();
  const sent: Array<{ action: string; expectedRevision?: number }> = [];
  const bridge = installSharedUiDraftBridge({ invoke: async (_channel, input) => {
    const row = input as { action: string; expectedRevision?: number };
    sent.push({ action: row.action, ...(row.expectedRevision === undefined ? {} : { expectedRevision: row.expectedRevision }) });
    return { status: "accepted", revision: 4 };
  }, ...transport });
  dispose = bridge.dispose;

  useComposerDraftStore.getState().setPrompt(id, "mine, still composing");
  transport.emit("vscode:cedia-draft-updated", { status: "written", threadId: id, revision: 3, payload: { draft: { prompt: "theirs" } } });
  expect(bridge.getConflict(id)?.revision).toBe(3);
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("mine, still composing");

  // "mine" re-sends on top of the pushed revision, so the other window's text stays recoverable.
  await bridge.resolveConflict(id, "mine");
  expect(sent.at(-1)).toEqual({ action: "write", expectedRevision: 3 });
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("mine, still composing");
});

it("treats a delivered draft as a fresh revision space without discarding what is being typed", async () => {
  setup();
  const transport = pushTransport();
  const sent: Array<{ action: string; expectedRevision?: number }> = [];
  const bridge = installSharedUiDraftBridge({ invoke: async (_channel, input) => {
    const row = input as { action: string; expectedRevision?: number };
    sent.push({ action: row.action, ...(row.expectedRevision === undefined ? {} : { expectedRevision: row.expectedRevision }) });
    return { status: "accepted", revision: 1 };
  }, ...transport });
  dispose = bridge.dispose;

  // Nothing pending here: the delivered draft is simply gone.
  useComposerDraftStore.getState().setPrompt(id, "sent from the other window");
  await bridge.flush();
  transport.emit("vscode:cedia-draft-updated", { status: "delivered", threadId: id });
  expect(useComposerDraftStore.getState().draftsByThreadId[id]).toBeUndefined();

  // Typing here while a Send elsewhere delivers: an unconfirmed edit survives as the next draft,
  // whose base revision is the restarted one rather than the delivered revision.
  useComposerDraftStore.getState().setPrompt(id, "my next message");
  transport.emit("vscode:cedia-draft-updated", { status: "delivered", threadId: id });
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("my next message");
  await bridge.flush();
  expect(sent.at(-1)).toEqual({ action: "write", expectedRevision: 0 });
  expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("my next message");
});

it("stops listening when the renderer is torn down", async () => {
  setup();
  const transport = pushTransport();
  const bridge = installSharedUiDraftBridge({ invoke: async () => null, ...transport });
  bridge.dispose();
  transport.emit("vscode:cedia-draft-updated", { status: "written", threadId: id, revision: 1, payload: { draft: { prompt: "too late" } } });
  expect(transport.listenerCount("vscode:cedia-draft-updated")).toBe(0);
  expect(useComposerDraftStore.getState().draftsByThreadId[id]).toBeUndefined();
});
