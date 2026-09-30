import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import { tagCediaHostErrorMessage } from "../src/host-error-codes.ts";
import {
  parseCediaHistoryAnswer,
  parseCediaTranscriptAnswer,
  serverHistoryQueryOptions,
  serverQueryKeys,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

type Request = {
  kind: "request";
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

const historyAnswer = {
  available: true,
  checkpoint: {
    messageCount: 4,
    entryId: null,
    startedAt: "2026-09-24T00:00:00.000Z",
  },
  lastRewind: {
    report: "Rewound to the runtime checkpoint.",
    reportTruncated: false,
    startedAt: "2026-09-24T00:00:00.000Z",
    rewoundAt: "2026-09-24T00:01:00.000Z",
  },
};

function historyBridge(answer: unknown = historyAnswer) {
  const calls: Request[] = [];
  return {
    calls,
    bridge: {
      invoke: async (_channel: string, input: Request) => {
        calls.push(input);
        if (input.path === "/v1/sessions/session-history") {
          return {
            id: "session-history",
            projectId: "project-history",
            cwd: "/workspace/history",
            sessionFile: "/tmp/session-history.json",
            incarnation: "inc-history",
            status: "idle",
            archived: false,
            createdAt: "2026-09-24T00:00:00.000Z",
            updatedAt: "2026-09-24T00:00:00.000Z",
          };
        }
        return answer;
      },
    },
  };
}

describe("Cedia native history adapter", () => {
  it("reads history and transcript, and fills command identity for reset controls", async () => {
    const fixture = historyBridge();
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await api.cedia.getHistory("session/history");
    await api.cedia.getTranscript("session-history");
    await api.cedia.clearContext("session-history");
    await api.cedia.freshSession("session-history");

    expect(fixture.calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/sessions/session%2Fhistory/history" },
      { kind: "request", method: "GET", path: "/v1/sessions/session-history/history/transcript" },
      { kind: "request", method: "GET", path: "/v1/sessions/session-history" },
      {
        kind: "request",
        method: "POST",
        path: "/v1/sessions/session-history/history/clear",
        body: expect.objectContaining({ commandId: expect.any(String), incarnation: "inc-history" }),
      },
      { kind: "request", method: "GET", path: "/v1/sessions/session-history" },
      {
        kind: "request",
        method: "POST",
        path: "/v1/sessions/session-history/history/fresh",
        body: expect.objectContaining({ commandId: expect.any(String), incarnation: "inc-history" }),
      },
    ]);
  });

  it("preserves a typed owner refusal from a history control", async () => {
    const fixture = historyBridge();
    fixture.bridge.invoke = async () => {
      throw new Error(tagCediaHostErrorMessage("CEDIA_HISTORY_CONFLICT", "Session is running; try again when it stops"));
    };
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await expect(api.cedia.clearContext("session-history")).rejects.toMatchObject({
      name: "CediaHostError",
      code: "CEDIA_HISTORY_CONFLICT",
      message: "Session is running; try again when it stops",
    });
  });
});

describe("Cedia history query parsers", () => {
  it("normalizes the host history and transcript answers without inventing fields", () => {
    expect(parseCediaHistoryAnswer(historyAnswer)).toEqual({
      state: "available",
      checkpoint: historyAnswer.checkpoint,
      lastRewind: historyAnswer.lastRewind,
    });
    expect(parseCediaTranscriptAnswer({ available: true, text: "hello", truncated: true, bytes: 5 })).toEqual({
      state: "available",
      text: "hello",
      truncated: true,
      bytes: 5,
    });
    expect(parseCediaHistoryAnswer({ available: false, reason: "History is unavailable" })).toEqual({
      state: "unavailable",
      reason: "History is unavailable",
    });
  });

  it("rejects malformed or incomplete host answers", () => {
    expect(() => parseCediaHistoryAnswer({ available: true, checkpoint: null })).toThrow();
    expect(() => parseCediaHistoryAnswer({ available: true, checkpoint: { messageCount: 0, entryId: null, startedAt: "" }, lastRewind: null })).toThrow();
    expect(() => parseCediaHistoryAnswer({ available: false })).toThrow();
    expect(() => parseCediaTranscriptAnswer({ available: true, text: "hello", truncated: false })).toThrow();
    expect(() => parseCediaTranscriptAnswer({ available: true, text: "hello", truncated: false, bytes: -1 })).toThrow();
    expect(() => parseCediaTranscriptAnswer({ available: false, reason: " " })).toThrow();
  });

  it("keeps history owner-triggered without a polling interval", () => {
    const options = serverHistoryQueryOptions("session-history");
    expect(options.queryKey).toEqual(serverQueryKeys.history("session-history"));
    expect(options.enabled).toBe(false);
    expect(options.refetchInterval).toBeUndefined();
    expect(options.refetchOnWindowFocus).toBe(false);
  });
});
