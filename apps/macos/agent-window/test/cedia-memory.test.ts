import { describe, expect, it } from "bun:test";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import { tagCediaHostErrorMessage } from "../src/host-error-codes.ts";
import {
  parseCediaMemoryAnswer,
  parseCediaMemoryApplyAnswer,
  serverMemoryQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

type Request = {
  kind: "request";
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

const memoryAnswer = {
  state: "available" as const,
  revision: 4,
  backend: "mnemopi" as const,
  mnemopi: {
    sessionId: "session-memory",
    lastRetainedTurn: 7,
    hasRecalledForFirstTurn: true,
    recallTargets: 2,
    hasGlobalTarget: true,
  },
};

function memoryBridge(answer: unknown = memoryAnswer) {
  const calls: Request[] = [];
  return {
    calls,
    bridge: {
      invoke: async (_channel: string, input: Request) => {
        calls.push(input);
        if (input.path === "/v1/sessions/session-memory") {
          return {
            id: "session-memory",
            projectId: "project-memory",
            cwd: "/workspace/memory",
            sessionFile: "/tmp/session-memory.json",
            incarnation: "inc-memory",
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

describe("Cedia memory adapter", () => {
  it("reads memory and fills command identity when applying the selected backend", async () => {
    const fixture = memoryBridge();
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await api.cedia.getMemory("session/memory");
    await api.cedia.applyMemoryBackend("session-memory", {});

    expect(fixture.calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/sessions/session%2Fmemory/memory" },
      { kind: "request", method: "GET", path: "/v1/sessions/session-memory" },
      {
        kind: "request",
        method: "POST",
        path: "/v1/sessions/session-memory/memory/apply",
        body: { commandId: expect.any(String), incarnation: "inc-memory" },
      },
    ]);
  });

  it("preserves a typed host refusal reason and code", async () => {
    const fixture = memoryBridge();
    fixture.bridge.invoke = async () => {
      throw new Error(tagCediaHostErrorMessage("CEDIA_MEMORY_CONFLICT", "Memory changed; try again"));
    };
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await expect(api.cedia.applyMemoryBackend("session-memory", {})).rejects.toMatchObject({
      name: "CediaHostError",
      code: "CEDIA_MEMORY_CONFLICT",
      message: "Memory changed; try again",
    });
  });
});

describe("Cedia memory query contract", () => {
  it("parses both shape-only state blocks and keeps absent blocks absent", () => {
    expect(parseCediaMemoryAnswer({
      state: "available",
      revision: 2,
      backend: "hindsight",
      hindsight: {
        sessionId: "session-memory",
        bankId: "bank-main",
        banksSet: 2,
        retainTags: 1,
        recallTags: 3,
        recallTagsMatch: "all",
        lastRetainedTurn: 3,
        hasRecalledForFirstTurn: false,
      },
    })).toEqual({
      state: "available",
      revision: 2,
      backend: "hindsight",
      hindsight: {
        sessionId: "session-memory",
        bankId: "bank-main",
        banksSet: 2,
        retainTags: 1,
        recallTags: 3,
        recallTagsMatch: "all",
        lastRetainedTurn: 3,
        hasRecalledForFirstTurn: false,
      },
    });
    expect(parseCediaMemoryAnswer({ state: "available", revision: 3, backend: "off" })).toEqual({
      state: "available",
      revision: 3,
      backend: "off",
    });
  });

  it("rejects malformed blocks and only accepts an applied mutation answer when marked applied", () => {
    expect(() => parseCediaMemoryAnswer({
      state: "available",
      revision: 1,
      backend: "mnemopi",
      mnemopi: { sessionId: "s", lastRetainedTurn: 0, hasRecalledForFirstTurn: false, recallTargets: -1, hasGlobalTarget: false },
    })).toThrow();
    expect(() => parseCediaMemoryAnswer({
      state: "available",
      revision: 1,
      backend: "hindsight",
      hindsight: {
        sessionId: "s",
        bankId: "b",
        banksSet: 1,
        retainTags: 1,
        recallTags: 1,
        recallTagsMatch: "invalid",
        lastRetainedTurn: 0,
        hasRecalledForFirstTurn: false,
      },
    })).toThrow();
    expect(() => parseCediaMemoryApplyAnswer(memoryAnswer)).toThrow();
    expect(parseCediaMemoryApplyAnswer({ ...memoryAnswer, applied: true })).toMatchObject({ applied: true });
  });

  it("does not configure a polling interval", () => {
    expect(serverMemoryQueryOptions("session-memory").refetchInterval).toBeUndefined();
  });
});
