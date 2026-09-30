import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import { tagCediaHostErrorMessage } from "../src/host-error-codes.ts";

type Request = {
  kind: "request";
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

const contextAnswer = {
  state: "available" as const,
  revision: 3,
  usage: {
    contextWindow: 128_000,
    anchored: true,
    usedTokens: 1_200,
    systemPromptTokens: 100,
    systemToolsTokens: 200,
    systemContextTokens: 300,
    skillsTokens: 400,
    messagesTokens: 200,
  },
  compacting: false,
  speculation: "idle" as const,
};

function contextBridge(answer: unknown = contextAnswer) {
  const calls: Request[] = [];
  return {
    calls,
    bridge: {
      invoke: async (_channel: string, input: Request) => {
        calls.push(input);
        if (input.path === "/v1/sessions/session-context") {
          return {
            id: "session-context",
            projectId: "project-context",
            cwd: "/workspace/context",
            sessionFile: "/tmp/session-context.json",
            incarnation: "inc-context",
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

describe("Cedia native context adapter", () => {
  it("reads context and fills command identity for both controls", async () => {
    const fixture = contextBridge();
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await api.cedia.getContext("session/context");
    await api.cedia.dropContextImages("session-context", {});
    await api.cedia.abortCompaction("session-context", { commandId: "abort-1", incarnation: "inc-explicit" });

    expect(fixture.calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/sessions/session%2Fcontext/context" },
      { kind: "request", method: "GET", path: "/v1/sessions/session-context" },
      { kind: "request", method: "POST", path: "/v1/sessions/session-context/context/drop-images", body: expect.objectContaining({ commandId: expect.any(String), incarnation: "inc-context" }) },
      { kind: "request", method: "POST", path: "/v1/sessions/session-context/context/abort-compaction", body: { commandId: "abort-1", incarnation: "inc-explicit" } },
    ]);
  });

  it("preserves a typed host refusal reason and code", async () => {
    const fixture = contextBridge();
    fixture.bridge.invoke = async () => {
      throw new Error(tagCediaHostErrorMessage("CEDIA_CONTEXT_CONFLICT", "Context changed; try again"));
    };
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await expect(api.cedia.abortCompaction("session-context", {})).rejects.toMatchObject({
      name: "CediaHostError",
      code: "CEDIA_CONTEXT_CONFLICT",
      message: "Context changed; try again",
    });
  });

  it("posts a context shake with generated command identity and the session incarnation", async () => {
    const fixture = contextBridge({
      ...contextAnswer,
      shake: { mode: "images", toolResultsDropped: 0, blocksDropped: 0, imagesDropped: 2, tokensFreed: 80 },
    });
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await api.cedia.shakeContext("session-context", { mode: "images" });

    expect(fixture.calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/sessions/session-context" },
      {
        kind: "request",
        method: "POST",
        path: "/v1/sessions/session-context/context/shake",
        body: expect.objectContaining({ commandId: expect.any(String), incarnation: "inc-context", mode: "images" }),
      },
    ]);
  });
});
