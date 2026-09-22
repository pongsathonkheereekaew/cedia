import { describe, expect, test } from "bun:test";
import type { EventPage, Json, Project, Session } from "../../../../packages/protocol/src/index.ts";
import { applyEventPage, applyMobileEvent, createInitialMobileState, isCacheFresh, parsePendingUiRequest, reduceMobileState } from "../core/state.ts";

const project: Project = { id: "p1", path: "/work/aetheria", name: "Aetheria", pinned: false, archived: false, createdAt: "2026-09-12T00:00:00.000Z" };
const session: Session = { id: "s1", projectId: project.id, title: "Card pass", cwd: project.path, sessionFile: "/state/s1/session.jsonl", incarnation: "inc-1", status: "running", archived: false, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" };

function event(sequence: number, frame: Json, incarnation = session.incarnation) {
  return { sessionId: session.id, incarnation, sequence, timestamp: `2026-09-12T00:00:0${sequence}.000Z`, frame };
}

describe("mobile transcript projection", () => {
  test("uses one stable row for OMP full accumulating message updates", () => {
    let state = createInitialMobileState({ session });
    state = applyEventPage(state, { events: [
      event(1, { type: "message_start", message: { role: "assistant", content: [], timestamp: 100 } }),
      event(2, { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hello" }], timestamp: 100 }, assistantMessageEvent: { type: "text_delta", delta: "Hello" } }),
      event(3, { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }], timestamp: 100 }, assistantMessageEvent: { type: "text_delta", delta: " world" } }),
      event(4, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }], timestamp: 100, stopReason: "stop" } }),
    ], cursor: 4, hasMore: false });
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]?.text).toBe("Hello world");
    expect(state.transcript[0]?.status).toBe("completed");
    expect(state.events).toHaveLength(4);
  });

  test("appends assistant deltas when a message update has no content blocks", () => {
    let state = createInitialMobileState({ session });
    state = applyEventPage(state, { events: [
      event(1, { type: "message_start", message: { role: "assistant", content: [], timestamp: 200 } }),
      event(2, { type: "message_update", message: { role: "assistant", content: [], timestamp: 200 }, assistantMessageEvent: { delta: "Hello" } }),
      event(3, { type: "message_update", message: { role: "assistant", content: [], timestamp: 200 }, assistantMessageEvent: { delta: " world" } }),
    ], cursor: 3, hasMore: false });
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]?.text).toBe("Hello world");
  });

  test("projects tool execution start, partial result and isError terminal", () => {
    let state = createInitialMobileState({ session });
    state = applyEventPage(state, { events: [
      event(1, { type: "tool_execution_start", toolCallId: "call-1", toolName: "write", args: { path: "card.ts" } }),
      event(2, { type: "tool_execution_update", toolCallId: "call-1", toolName: "write", args: { path: "card.ts" }, partialResult: { content: [{ type: "text", text: "writing" }] } }),
      event(3, { type: "tool_execution_end", toolCallId: "call-1", toolName: "write", result: { content: [{ type: "text", text: "denied" }], isError: true }, isError: true }),
    ], cursor: 3, hasMore: false });
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]?.toolName).toBe("write");
    expect(state.transcript[0]?.toolStatus).toBe("failed");
    expect(state.transcript[0]?.output).toContain("denied");
    expect(state.activeToolIds).toEqual([]);
  });

  test("ignores stale incarnations and duplicate cursors", () => {
    let state = createInitialMobileState({ session });
    state = applyMobileEvent(state, event(1, { type: "message_end", message: { role: "assistant", content: "current" } }, "old-incarnation"));
    expect(state.transcript).toHaveLength(0);
    state = applyMobileEvent(state, event(1, { type: "message_end", message: { role: "assistant", content: "current" } }));
    state = applyMobileEvent(state, event(1, { type: "message_end", message: { role: "assistant", content: "current" } }));
    expect(state.transcript).toHaveLength(1);
    expect(state.cursor).toBe(1);
  });

  test("projects login URLs as presentations and never treats javascript as openable", () => {
    let state = createInitialMobileState({ session });
    state = applyMobileEvent(state, event(1, { type: "cedia_ui", event: { kind: "presentation", request: { id: "url-1", method: "open_url", url: "https://example.test/login", instructions: "Open manually" } } }));
    expect(state.presentations).toEqual([{ id: "url-1", method: "open_url", url: "https://example.test/login", instructions: "Open manually" }]);
    expect(state.uiRequests).toHaveLength(0);
    state = applyMobileEvent(state, event(2, { type: "cedia_ui", event: { kind: "presentation", request: { id: "bad", method: "open_url", url: "javascript:alert(1)" } } }));
    expect(state.presentations.find(item => item.id === "bad")?.url).toBeUndefined();
    state = reduceMobileState(state, { type: "login_providers", providers: [{ id: "openai", name: "OpenAI", available: true, authenticated: false }] });
    expect(state.loginProviders).toEqual([{ id: "openai", name: "OpenAI", available: true, authenticated: false }]);
  });

  test("keeps interactive events until explicitly resolved", () => {
    let state = createInitialMobileState({ session });
    state = applyMobileEvent(state, event(1, { type: "cedia_ui", event: { kind: "interactive", token: "t1", request: { method: "select", id: "i1", title: "Choose", options: ["A", "B"] } } }));
    expect(state.uiRequests[0]?.token).toBe("t1");
    expect(state.attentionCount).toBe(1);
    state = reduceMobileState(state, { type: "ui_resolved", token: "t1" });
    expect(state.uiRequests).toHaveLength(0);
    expect(state.attentionCount).toBe(0);
  });

  test("syncs live UI broker state without replacing same-token requests", () => {
    let state = createInitialMobileState({ session });
    const eventValue = event(1, { type: "cedia_ui", event: { kind: "interactive", token: "t1", request: { method: "input", id: "i1", title: "Name", placeholder: "Project" } } });
    state = applyMobileEvent(state, eventValue);
    const original = state.uiRequests[0];
    state = reduceMobileState(state, { type: "ui_sync", events: [{ kind: "interactive", token: "t1", request: { method: "input", id: "i1", title: "Name", placeholder: "Project" } }] });
    expect(state.uiRequests[0]).toBe(original);
    state = reduceMobileState(state, { type: "ui_sync", events: [] });
    expect(state.uiRequests).toHaveLength(0);
  });
});

describe("mobile pending UI requests", () => {
  const unsupported = "Cedia cannot show this request: the host sent unsupported method";

  test("round-trips every interactive method the wire can carry", () => {
    const requests = [
      { method: "confirm", id: "c1", title: "Allow?", message: "run it" },
      { method: "select", id: "s1", title: "Pick", options: ["a", "b"], optionDetails: [{ description: "first" }, {}], timeout: 1_000 },
      { method: "input", id: "i1", title: "Name", placeholder: "type here", timeout: 0 },
      { method: "editor", id: "e1", title: "Edit", prefill: "draft", promptStyle: true },
    ] as const;
    for (const request of requests) {
      const parsed = parsePendingUiRequest({ kind: "interactive", token: `tok-${request.id}`, request });
      expect(parsed.ok).toBe(true);
      expect(parsed.ok && parsed.request.request).toEqual(request);
      expect(parsed.ok && parsed.request.token).toBe(`tok-${request.id}`);
    }
  });

  test("states an unknown method instead of dropping the request", () => {
    const refusals = [
      { method: "password", id: "p1", title: "Secret" },
      { method: "multi_select", id: "m1", title: "Pick", options: ["a", "b"] },
      { method: "schemaform", id: "sf1", title: "Form" },
    ];
    for (const request of refusals) {
      const envelope = { kind: "interactive", token: `tok-${request.id}`, request };
      expect(parsePendingUiRequest(envelope)).toEqual({ ok: false, reason: "unknown-method", method: request.method });
      // The host's live list is authoritative, so a request the Mac renders may
      // not vanish here: the phone says why it cannot show it.
      const state = reduceMobileState(createInitialMobileState({ session }), { type: "ui_sync", events: [envelope] });
      expect(state.uiRequests).toHaveLength(0);
      expect(state.lastError).toBe(`${unsupported} "${request.method}"; OMP can send select, confirm, input, editor.`);
    }
    const live = applyMobileEvent(createInitialMobileState({ session }), event(1, { type: "cedia_ui", event: { kind: "interactive", token: "tok-p", request: { method: "password", id: "p1", title: "Secret" } } }));
    expect(live.uiRequests).toHaveLength(0);
    expect(live.lastError).toBe(`${unsupported} "password"; OMP can send select, confirm, input, editor.`);
    // A repeated poll of the same violation does not churn the state object.
    const once = reduceMobileState(createInitialMobileState({ session }), { type: "ui_sync", events: [{ kind: "interactive", token: "tok-p", request: { method: "password", id: "p1", title: "Secret" } }] });
    expect(reduceMobileState(once, { type: "ui_sync", events: [{ kind: "interactive", token: "tok-p", request: { method: "password", id: "p1", title: "Secret" } }] })).toEqual(once);
  });

  test("names a malformed or non-interactive envelope rather than calling it unknown", () => {
    expect(parsePendingUiRequest({ kind: "presentation", token: "t1", request: { method: "notify", id: "n1", message: "hi" } })).toEqual({ ok: false, reason: "not-interactive" });
    expect(parsePendingUiRequest({ kind: "interactive", token: "t1", request: { method: "confirm", id: "c1", title: "Allow?" } })).toEqual({ ok: false, reason: "malformed" });
    expect(parsePendingUiRequest({ kind: "interactive", token: "t1", request: { method: "select", id: "s1", title: "Pick", options: ["a", "b"], optionDetails: [{ description: "first" }] } })).toEqual({ ok: false, reason: "malformed" });
  });

  test("keeps the select descriptions the sheet renders, and drops fields the wire cannot carry", () => {
    const parsed = parsePendingUiRequest({
      kind: "interactive",
      token: "t1",
      request: { method: "select", id: "s1", title: "Pick", options: ["a"], optionDetails: [{ description: "first", label: "Alpha" }] },
    });
    expect(parsed.ok && parsed.request.request).toEqual({ method: "select", id: "s1", title: "Pick", options: ["a"], optionDetails: [{ description: "first" }] });
  });
});

describe("mobile list and cache state", () => {
  test("filters project/task search and archived rows", () => {
    let state = createInitialMobileState({ project, projects: [project, { ...project, id: "p2", name: "Archived", archived: true }], sessions: [session, { ...session, id: "s2", title: "Archived task", archived: true }] });
    expect(state.projects.filter(item => !item.archived)).toHaveLength(1);
    state = reduceMobileState(state, { type: "show_archived", value: true });
    expect(state.showArchived).toBe(true);
    state = reduceMobileState(state, { type: "search", query: "archived" });
    expect(state.searchQuery).toBe("archived");
  });

  test("rejects event pages for a different session through the reducer", () => {
    const page: EventPage = { events: [{ ...event(1, { type: "notice", message: "wrong" }), sessionId: "other" }], cursor: 1, hasMore: false };
    const state = applyEventPage(createInitialMobileState({ session }), page);
    expect(state.events).toHaveLength(0);
    expect(state.cursor).toBe(0);
  });

  test("does not let an untagged empty page from an old request advance the selected task", () => {
    const state = createInitialMobileState({ session });
    const next = reduceMobileState(state, { type: "events", page: { events: [], cursor: 99, hasMore: false } });
    expect(next.cursor).toBe(0);
  });

  test("rejects a delayed page after switching to another session", () => {
    const otherSession = { ...session, id: "s2", incarnation: "inc-2" };
    const state = createInitialMobileState({ session: otherSession, cursor: 3, hasMoreEvents: true });
    const delayed = reduceMobileState(state, {
      type: "events",
      sessionId: session.id,
      incarnation: session.incarnation,
      page: { events: [event(4, { type: "notice", message: "old task" })], cursor: 4, hasMore: false },
    });
    expect(delayed).toBe(state);
  });

  test("allows an explicitly identified empty page to advance its own cursor", () => {
    const state = createInitialMobileState({ session });
    const next = reduceMobileState(state, { type: "events", page: { events: [], cursor: 99, hasMore: false }, sessionId: session.id, incarnation: session.incarnation });
    expect(next.cursor).toBe(99);
  });

  test("reports cache freshness from an explicit expiry", () => {
    expect(isCacheFresh({ cacheExpiresAt: 2_000 }, 1_999)).toBe(true);
    expect(isCacheFresh({ cacheExpiresAt: 2_000 }, 2_000)).toBe(false);
  });

  test("resets in-memory draft when the selected session changes so prior text cannot flash", () => {
    let state = createInitialMobileState({ session, draft: "previous task text" });
    state = reduceMobileState(state, { type: "session", session: { ...session, id: "s2" } });
    expect(state.draft).toBe("");
    expect(state.session?.id).toBe("s2");
  });

  test("keeps the draft when the same session is updated", () => {
    let state = createInitialMobileState({ session, draft: "keep me" });
    state = reduceMobileState(state, { type: "session", session: { ...session, status: "idle" } });
    expect(state.draft).toBe("keep me");
  });

  test("session_refresh re-reads the record without clearing the mounted task", () => {
    let state = createInitialMobileState({ session, sessions: [session, { ...session, id: "s2" }], draft: "keep me" });
    state = applyMobileEvent(state, event(1, { type: "message_end", message: { role: "assistant", content: "hello" } }));
    state = applyEventPage(state, {
      events: [event(2, { type: "cedia_ui", event: { kind: "interactive", token: "t1", request: { method: "confirm", id: "i1", title: "Proceed", message: "Continue?" } } })],
      cursor: 2,
      hasMore: true,
    });
    const refreshed = { ...session, incarnation: "inc-2", status: "idle" as const, title: "Card pass recovered" };
    const next = reduceMobileState(state, { type: "session_refresh", session: refreshed });
    expect(next.session).toEqual(refreshed);
    expect(next.sessions).toEqual([refreshed, { ...session, id: "s2" }]);
    expect(next.transcript).toBe(state.transcript);
    expect(next.events).toBe(state.events);
    expect(next.cursor).toBe(2);
    expect(next.hasMoreEvents).toBe(true);
    expect(next.uiRequests).toBe(state.uiRequests);
    expect(next.attentionCount).toBe(state.attentionCount);
    expect(next.draft).toBe("keep me");
    const switched = reduceMobileState(state, { type: "session", session: { ...session, id: "s2" } });
    expect(switched.transcript).toHaveLength(0);
    expect(switched.events).toHaveLength(0);
    expect(switched.cursor).toBe(0);
    expect(switched.uiRequests).toHaveLength(0);
    expect(switched.draft).toBe("");
  });

  test("clears cache timestamps without inventing a connection enum", () => {
    const state = createInitialMobileState({ session, cacheSavedAt: 10, cacheExpiresAt: 20 });
    const next = reduceMobileState(state, { type: "cache_cleared" });
    expect(next.cacheSavedAt).toBeUndefined();
    expect(next.cacheExpiresAt).toBeUndefined();
    expect(next.connection).toBe(state.connection);
  });
});
