import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentWindowHandler, createSharedDraftAccess, draftTextOf } from "../src/agent-window-main.ts";
import { CEDIA_DRAFT_UPDATE_CHANNEL, CEDIA_PREFERENCES_UPDATE_CHANNEL, publishDraftUpdate } from "../src/agent-window-bridge.ts";
import { HostHttpError } from "../src/api.ts";
import { writeAgentUiState, agentUiStateDir } from "../src/agent-ui-state.ts";

/** A tiny in-memory stand-in for the host's draft routes, including the submission claim. */
function fakeHost() {
  let record: { revision: number; content: unknown } | undefined;
  const submitted = new Map<number, { commandId: string; payloadHash: string }>();
  let unreachable = false;
  const calls: string[] = [];
  return {
    calls,
    set unreachable(value: boolean) { unreachable = value; },
    get record() { return record; },
    request: async (method: string, path: string, body?: unknown): Promise<unknown> => {
      calls.push(`${method} ${path}`);
      if (unreachable) throw new Error("connect ECONNREFUSED");
      if (method === "POST" && path.endsWith("/submissions")) {
        const claim = body as { expectedRevision: number; commandId: string; payloadHash: string };
        if (!record || record.revision !== claim.expectedRevision) throw new HostHttpError(409, path, "Draft changed elsewhere");
        const existing = submitted.get(claim.expectedRevision);
        if (existing) {
          if (existing.payloadHash !== claim.payloadHash) throw new HostHttpError(409, path, "This revision was already sent with different text");
          return { accepted: true, created: false, submission: { submissionId: `s-${claim.expectedRevision}`, draftId: "task-1", revision: claim.expectedRevision, commandId: existing.commandId, createdAt: "2026-09-24T00:00:00.000Z" }, draft: record };
        }
        submitted.set(claim.expectedRevision, { commandId: claim.commandId, payloadHash: claim.payloadHash });
        return { accepted: true, created: true, submission: { submissionId: `s-${claim.expectedRevision}`, draftId: "task-1", revision: claim.expectedRevision, commandId: claim.commandId, createdAt: "2026-09-24T00:00:00.000Z" }, draft: record };
      }
      if (method === "POST" && path.endsWith("/clear")) {
        const request = body as { expectedRevision: number };
        if (record && record.revision === request.expectedRevision) {
          record = undefined;
          return { cleared: true };
        }
        return { cleared: false, ...(record ? { draft: record } : {}) };
      }
      if (method === "GET") {
        if (!record) throw new HostHttpError(404, path, "No draft yet");
        return { revision: record.revision, content: record.content };
      }
      const patch = body as { expectedRevision: number; content: unknown };
      if (!record) {
        if (patch.expectedRevision !== 0) throw new HostHttpError(409, path, "Draft changed elsewhere");
        record = { revision: 1, content: patch.content };
        return { revision: 1, content: patch.content };
      }
      if (patch.expectedRevision !== record.revision) throw new HostHttpError(409, path, "Draft changed elsewhere");
      record = { revision: record.revision + 1, content: patch.content };
      return { revision: record.revision, content: record.content };
    },
  };
}

async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), "cedia-shared-draft-"));
  return {
    stateDir,
    access: createSharedDraftAccess({ request: (async () => undefined) as never, stateDir }),
  };
}

it("extracts the readable composer text from the renderer payload", () => {
  expect(draftTextOf({ draft: { prompt: "hello" }, draftThread: {} })).toBe("hello");
  expect(draftTextOf({ draft: {} })).toBe("");
  expect(draftTextOf({ draft: { prompt: 7 } })).toBe("");
  expect(draftTextOf(null)).toBe("");
  expect(draftTextOf("not a payload")).toBe("");
});

it("imports the pre-host draft into the host exactly once", async () => {
  const { stateDir } = await fixture();
  const host = fakeHost();
  const access = createSharedDraftAccess({ request: host.request as never, stateDir });
  try {
    const legacy = { draft: { prompt: "written before the host owned drafts" }, draftThread: { projectId: "p1" } };
    await writeAgentUiState(agentUiStateDir(stateDir), "draft:task-1", legacy);

    expect(await access.read("task-1")).toEqual({ revision: 1, payload: legacy });
    expect(host.calls).toEqual(["GET drafts/task-1", "PATCH drafts/task-1"]);

    // The host answers now, so the local file is never imported a second time.
    expect(await access.read("task-1")).toEqual({ revision: 1, payload: legacy });
    expect(host.calls).toEqual(["GET drafts/task-1", "PATCH drafts/task-1", "GET drafts/task-1"]);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("reports a conflict with the winning payload instead of overwriting it", async () => {
  const { stateDir } = await fixture();
  const host = fakeHost();
  const access = createSharedDraftAccess({ request: host.request as never, stateDir });
  try {
    const first = { draft: { prompt: "from window A" } };
    const second = { draft: { prompt: "from window B" } };
    expect(await access.write("task-1", first, 0)).toEqual({ status: "accepted", revision: 1 });
    expect(await access.write("task-1", second, 1)).toEqual({ status: "accepted", revision: 2 });

    // A stale writer (window A still believes revision 1) must not win.
    expect(await access.write("task-1", first, 1)).toEqual({ status: "conflict", revision: 2, payload: second });
    expect(host.record).toEqual({ revision: 2, content: second });
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("keeps the text when the host is unreachable and serves it from the cache", async () => {
  const { stateDir } = await fixture();
  const host = fakeHost();
  const access = createSharedDraftAccess({ request: host.request as never, stateDir });
  try {
    const payload = { draft: { prompt: "offline draft" } };
    host.unreachable = true;
    expect(await access.write("task-1", payload, 0)).toEqual({ status: "unavailable" });
    expect(await access.read("task-1")).toEqual({ revision: 0, payload, stale: true });

    // The cached draft is still the file the workspace handoff reads.
    host.unreachable = false;
    expect(await access.write("task-1", payload, 0)).toEqual({ status: "accepted", revision: 1 });
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("reserves one command per draft revision and refuses the same revision with different text", async () => {
  const { stateDir } = await fixture();
  const host = fakeHost();
  const access = createSharedDraftAccess({ request: host.request as never, stateDir });
  try {
    // A task with no draft record has nothing to reserve; the send keeps its own command id.
    expect(await access.reserve("task-1", "cmd-a", "hello")).toEqual({ status: "none" });

    await access.write("task-1", { draft: { prompt: "hello" } }, 0);
    expect(await access.reserve("task-1", "cmd-a", "hello")).toEqual({ status: "reserved", commandId: "cmd-a", revision: 1 });
    // The same revision and text sent again resolves to the command the host bound first.
    expect(await access.reserve("task-1", "cmd-b", "hello")).toEqual({ status: "reserved", commandId: "cmd-a", revision: 1 });
    // Different text for that same identity is a conflict, not a second turn.
    expect(await access.reserve("task-1", "cmd-c", "something else")).toEqual({ status: "conflict" });
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("releases a delivered draft only while its revision still matches", async () => {
  const { stateDir } = await fixture();
  const host = fakeHost();
  const access = createSharedDraftAccess({ request: host.request as never, stateDir });
  try {
    await access.write("task-1", { draft: { prompt: "first" } }, 0);
    expect(await access.release("task-1", 1)).toBe(true);
    expect(await access.read("task-1")).toBeNull();

    // A newer edit made while the turn was being accepted survives the clear.
    await access.write("task-1", { draft: { prompt: "first" } }, 0);
    await access.write("task-1", { draft: { prompt: "typed later" } }, 1);
    expect(await access.release("task-1", 1)).toBe(false);
    expect((await access.read("task-1"))?.revision).toBe(2);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("never lets the reservation path throw when the host cannot answer", async () => {
  const { stateDir } = await fixture();
  const host = fakeHost();
  const access = createSharedDraftAccess({ request: host.request as never, stateDir });
  try {
    host.unreachable = true;
    expect(await access.reserve("task-1", "cmd-a", "hello")).toEqual({ status: "none" });
    expect(await access.release("task-1", 1)).toBe(false);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("exposes the reservation and the release through the Agent Window handler", async () => {
  const { stateDir } = await fixture();
  const host = fakeHost();
  const handler = createAgentWindowHandler({
    stateDir,
    authorize: () => true,
    ensure: async () => {},
    request: host.request as never,
    pickFolder: async () => null,
    openIde: async () => {},
    openExternal: async () => {},
  });
  try {
    await handler(null, { kind: "uiDraft", threadId: "task-1", action: "write", expectedRevision: 0, draft: { draft: { prompt: "send me" } } });
    expect(await handler(null, { kind: "uiDraft", threadId: "task-1", action: "reserve", commandId: "cmd-1", text: "send me" }))
      .toEqual({ status: "reserved", commandId: "cmd-1", revision: 1 });
    expect(await handler(null, { kind: "uiDraft", threadId: "task-1", action: "clear", revision: 1 })).toEqual({ cleared: true });
    // A clear without a revision cannot silently drop whatever is there now.
    await expect(handler(null, { kind: "uiDraft", threadId: "task-1", action: "clear", revision: 0 })).rejects.toThrow("Invalid draft revision");
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("tells the other Mac window the revision the host just committed, and the delivery that emptied it", async () => {
  const { stateDir } = await fixture();
  const host = fakeHost();
  const published: Array<{ event: unknown; update: unknown }> = [];
  const access = createSharedDraftAccess({
    request: host.request as never,
    stateDir,
    broadcast: (event, update) => { published.push({ event, update }); },
  });
  const sender = { sender: "window-a" };
  try {
    const payload = { draft: { prompt: "typed in window A" } };
    expect(await access.write("task-1", payload, 0, sender)).toEqual({ status: "accepted", revision: 1 });
    expect(published).toEqual([{ event: sender, update: { status: "written", threadId: "task-1", revision: 1, payload } }]);

    expect(await access.release("task-1", 1, sender)).toBe(true);
    expect(published.at(-1)).toEqual({ event: sender, update: { status: "delivered", threadId: "task-1" } });

    // A refused release publishes nothing: the draft is still there and the other window must
    // not be told it was delivered.
    await access.write("task-1", payload, 0, sender);
    await access.write("task-1", { draft: { prompt: "typed later" } }, 1, sender);
    expect(await access.release("task-1", 1, sender)).toBe(false);
    expect(published.at(-1)).toMatchObject({ update: { status: "written", revision: 2 } });
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("starts the next draft instead of refusing forever once a Send delivered the previous one", async () => {
  const { stateDir } = await fixture();
  const host = fakeHost();
  const access = createSharedDraftAccess({ request: host.request as never, stateDir });
  try {
    await access.write("task-1", { draft: { prompt: "first turn" } }, 0);
    // Hydrating the task spends the one-time pre-host import, which is the ordering that used to
    // make every later write answer `unavailable` instead of reaching the host again.
    expect((await access.read("task-1"))?.revision).toBe(1);
    expect(await access.release("task-1", 1)).toBe(true);
    // The host deletes a delivered record, so the revision space restarts. A window that still
    // names the delivered revision is the first edit of the next draft, not a stale writer.
    expect(await access.write("task-1", { draft: { prompt: "second turn" } }, 1))
      .toEqual({ status: "accepted", revision: 1 });
    expect(host.record).toEqual({ revision: 1, content: { draft: { prompt: "second turn" } } });
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("publishes the committed revision through the Agent Window handler", async () => {
  const { stateDir } = await fixture();
  const host = fakeHost();
  const published: unknown[] = [];
  const handler = createAgentWindowHandler({
    stateDir,
    authorize: () => true,
    ensure: async () => {},
    request: host.request as never,
    pickFolder: async () => null,
    openIde: async () => {},
    openExternal: async () => {},
    broadcastDraft: (_event, update) => { published.push(update); },
  });
  try {
    await handler({ sender: "window-a" }, { kind: "uiDraft", threadId: "task-1", action: "write", expectedRevision: 0, draft: { draft: { prompt: "hello" } } });
    await handler({ sender: "window-a" }, { kind: "uiDraft", threadId: "task-1", action: "clear", revision: 1 });
    expect(published).toEqual([
      { status: "written", threadId: "task-1", revision: 1, payload: { draft: { prompt: "hello" } } },
      { status: "delivered", threadId: "task-1" },
    ]);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("sends a committed revision to every other window and never back to the sender", () => {
  const sent: Array<{ id: string; channel: string; value: unknown }> = [];
  const windowFor = (id: string, contents?: unknown) => ({
    webContents: contents ?? { id, send: (channel: string, value: unknown) => { sent.push({ id, channel, value }); } },
  });
  const sender = { id: "a" };
  publishDraftUpdate({ sender }, { status: "delivered", threadId: "task-1" }, [
    windowFor("a", sender),
    windowFor("b"),
    { webContents: undefined },
    { webContents: { send: () => { throw new Error("the window closed mid-publish"); } } },
  ]);
  expect(sent).toEqual([{ id: "b", channel: CEDIA_DRAFT_UPDATE_CHANNEL, value: { status: "delivered", threadId: "task-1" } }]);
});

it("keeps every renderer-facing event channel in the namespace the preload delivers", () => {
  // Measured by running the packaged window: the Code-OSS preload's `validateIPC` throws
  // `Unsupported event IPC channel '<name>'` for any subscription outside `vscode:`, which made the
  // packaged Agents window fail to start when these were named `cedia:`. A fixture cannot see that
  // rule, so it is pinned here.
  for (const channel of [CEDIA_DRAFT_UPDATE_CHANNEL, CEDIA_PREFERENCES_UPDATE_CHANNEL]) {
    expect(channel.startsWith("vscode:")).toBe(true);
  }
});
