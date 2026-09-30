import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import { tagCediaHostErrorMessage } from "../src/host-error-codes.ts";

type Request = {
  kind: "request";
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

const queueAnswer = {
  state: "available" as const,
  revision: 4,
  steering: [{ text: "steer", truncated: false, images: 1 }],
  followUp: [{ text: "follow up", truncated: false, images: 0 }],
};

function queueBridge(answer: unknown = queueAnswer) {
  const calls: Request[] = [];
  return {
    calls,
    bridge: {
      invoke: async (_channel: string, input: Request) => {
        calls.push(input);
        if (input.path === "/v1/sessions/session-queue") {
          return {
            id: "session-queue",
            projectId: "project-queue",
            cwd: "/workspace/queue",
            sessionFile: "/tmp/session-queue.json",
            incarnation: "inc-queue",
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

describe("Cedia native queue adapter", () => {
  it("reads and drops queued submissions through the exact host routes", async () => {
    const fixture = queueBridge();
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await api.cedia.getQueue("session/queue");
    await api.cedia.dropQueued("session-queue", { mode: "last" });
    await api.cedia.dropQueued("session-queue", {
      commandId: "queue-command-2",
      incarnation: "inc-explicit",
      mode: "all",
    });

    expect(fixture.calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/sessions/session%2Fqueue/queue" },
      { kind: "request", method: "GET", path: "/v1/sessions/session-queue" },
      {
        kind: "request",
        method: "POST",
        path: "/v1/sessions/session-queue/queue/drop",
        body: expect.objectContaining({ commandId: expect.any(String), incarnation: "inc-queue", mode: "last" }),
      },
      {
        kind: "request",
        method: "POST",
        path: "/v1/sessions/session-queue/queue/drop",
        body: { commandId: "queue-command-2", incarnation: "inc-explicit", mode: "all" },
      },
    ]);
  });

  it("preserves a typed host refusal reason and code", async () => {
    const fixture = queueBridge();
    fixture.bridge.invoke = async () => {
      throw new Error(tagCediaHostErrorMessage("CEDIA_QUEUE_CONFLICT", "Queue changed; try again"));
    };
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await expect(api.cedia.dropQueued("session-queue", { mode: "all" })).rejects.toMatchObject({
      name: "CediaHostError",
      code: "CEDIA_QUEUE_CONFLICT",
      message: "Queue changed; try again",
    });
  });
});
