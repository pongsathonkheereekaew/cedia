import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

// `readNativeApi()` branches on this marker; Cedia's bootstraps install it before the bundle
// loads, so the composer takes the local-id path here too.
let nativeWindow: { nativeApi?: unknown } | undefined;
beforeAll(() => {
  const globals = globalThis as { window?: { nativeApi?: unknown } };
  if (!globals.window) globals.window = {};
  nativeWindow = globals.window;
  nativeWindow.nativeApi = { cediaTestMarker: true };
});
afterAll(() => {
  const globals = globalThis as { window?: unknown };
  if (nativeWindow !== undefined && globals.window === nativeWindow) delete globals.window;
  nativeWindow = undefined;
});

const SESSION = {
  id: "session-send",
  projectId: "project-1",
  title: "Send",
  cwd: "/workspace/demo",
  sessionFile: "/state/session-send.json",
  incarnation: "inc-1",
  status: "running",
  archived: false,
  createdAt: "2026-09-24T10:00:00.000Z",
  updatedAt: "2026-09-24T10:01:00.000Z",
};

interface RecordedRequest { method: string; path: string; body?: unknown }
interface DraftCall { action: string; threadId: string; commandId?: string; revision?: number; text?: string }

/** A host that answers the session row and the command envelope, plus the draft bridge. */
function fixture(options: { reservation?: unknown; reservationFails?: boolean; clearFails?: boolean } = {}) {
  const calls: RecordedRequest[] = [];
  const draftCalls: DraftCall[] = [];
  const bridge = {
    invoke: async (_channel: string, request: Record<string, unknown>) => {
      if (request.kind === "uiDraft") {
        const row = request as { action: string; threadId: string; commandId?: string; revision?: number; text?: string };
        draftCalls.push({
          action: row.action,
          threadId: row.threadId,
          ...(row.commandId === undefined ? {} : { commandId: row.commandId }),
          ...(row.revision === undefined ? {} : { revision: row.revision }),
          ...(row.text === undefined ? {} : { text: row.text }),
        });
        if (row.action === "reserve") {
          if (options.reservationFails) throw new Error("Cedia native bridge is missing");
          return options.reservation ?? { status: "none" };
        }
        if (options.clearFails) throw new Error("clear request failed");
        return { cleared: true };
      }
      calls.push(request as unknown as RecordedRequest);
      if (request.path === `/v1/sessions/${SESSION.id}`) return SESSION;
      if (String(request.path).endsWith("/commands") && request.method === "POST") {
        const body = request.body as { commandId: string; command: string };
        return { status: "completed", commandId: body.commandId, incarnation: SESSION.incarnation };
      }
      throw new Error(`Unexpected request ${String(request.path)}`);
    },
  };
  return { api: createCediaNativeApi({ bridge: bridge as never }), calls, draftCalls };
}

const turn = (commandId: string) => ({
  type: "thread.turn.start",
  commandId,
  threadId: SESSION.id,
  message: { text: "hello" },
});

it("reserves the draft revision before dispatch and releases it after acceptance", async () => {
  const { api, calls, draftCalls } = fixture({ reservation: { status: "reserved", commandId: "canonical-command", revision: 4 } });

  await api.orchestration.dispatchCommand(turn("window-command"));

  expect(draftCalls).toEqual([
    { action: "reserve", threadId: SESSION.id, commandId: "window-command", text: "hello" },
    { action: "clear", threadId: SESSION.id, revision: 4 },
  ]);
  const posted = calls.find(call => call.path.endsWith("/commands"));
  expect((posted?.body as { commandId: string }).commandId).toBe("canonical-command");
});

it("stops a send whose revision was already sent with different text", async () => {
  const { api, calls, draftCalls } = fixture({ reservation: { status: "conflict" } });

  await expect(api.orchestration.dispatchCommand(turn("window-command"))).rejects.toThrow(/different text/i);

  expect(calls.filter(call => call.path.endsWith("/commands"))).toHaveLength(0);
  expect(draftCalls.filter(call => call.action === "clear")).toHaveLength(0);
});

it("sends with its own command id when the draft owner cannot answer", async () => {
  const { api, calls, draftCalls } = fixture({ reservationFails: true });

  await api.orchestration.dispatchCommand(turn("window-command"));

  const posted = calls.find(call => call.path.endsWith("/commands"));
  expect((posted?.body as { commandId: string }).commandId).toBe("window-command");
  // Nothing was reserved, so nothing is released either.
  expect(draftCalls.filter(call => call.action === "clear")).toHaveLength(0);
});

it("reports a failed post-acceptance draft clear without undoing the accepted send", async () => {
  const { api } = fixture({
    reservation: { status: "reserved", commandId: "canonical-command", revision: 4 },
    clearFails: true,
  });
  const warn = spyOn(console, "warn").mockImplementation(() => {});

  try {
    await api.orchestration.dispatchCommand(turn("window-command"));
    expect(warn).toHaveBeenCalledWith("Cedia could not release a delivered composer draft.", expect.any(Error));
  } finally {
    warn.mockRestore();
  }
});
