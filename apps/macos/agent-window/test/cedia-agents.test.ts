import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter";

const sessionId = "session/one";

function bridgeFor(answer: unknown, error?: Error) {
  const calls: Array<{ path?: string; method?: string }> = [];
  return {
    calls,
    bridge: {
      invoke: async (_channel: string, request: { path?: string; method?: string }) => {
        calls.push(request);
        if (error) throw error;
        return answer;
      },
    },
  };
}

describe("Cedia agents adapter", () => {
  it("reads the roster through the exact encoded host path", async () => {
    const fixture = bridgeFor({ state: "available", revision: 3, agents: [] });
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await expect(api.cedia.getAgents(sessionId)).resolves.toEqual({
      state: "available",
      revision: 3,
      agents: [],
    });
    expect(fixture.calls).toEqual([{ kind: "request", method: "GET", path: "/v1/sessions/session%2Fone/agents" }]);
  });

  it("reads a transcript with an explicit offset and defaults the offset to zero", async () => {
    const fixture = bridgeFor({
      state: "available",
      agentId: "agent/child",
      sessionFile: "/tmp/child.json",
      fromByte: 0,
      nextByte: 4,
      reset: false,
      messages: [],
      truncated: false,
    });
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await api.cedia.getAgentTranscript(sessionId, "agent/child", 37);
    await api.cedia.getAgentTranscript(sessionId, "agent/child");

    expect(fixture.calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/sessions/session%2Fone/agents/agent%2Fchild/transcript?fromByte=37" },
      { kind: "request", method: "GET", path: "/v1/sessions/session%2Fone/agents/agent%2Fchild/transcript?fromByte=0" },
    ]);
  });

  it("kills and revives through the durable owner-only envelope", async () => {
    const calls: Array<{ path?: string; method?: string; body?: unknown }> = [];
    const session = {
      id: "session/one",
      projectId: "project-1",
      title: "Task",
      cwd: "/workspace",
      sessionFile: "/state/session.json",
      incarnation: "inc-9",
      status: "idle",
      archived: false,
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
    };
    const bridge = {
      invoke: async (_channel: string, request: { kind?: string; method?: string; path?: string; body?: unknown }) => {
        calls.push(request);
        if (request.path === "/v1/sessions/session%2Fone" && request.method !== "POST") return session;
        if (request.path === "/v1/sessions/session%2Fone/agents/kill") return { available: true, id: "a-1", aborted: true, released: true };
        if (request.path === "/v1/sessions/session%2Fone/agents/revive") return { available: true, id: "a-2", revived: true };
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await expect(api.cedia.killAgent(sessionId, "a-1")).resolves.toEqual({ available: true, id: "a-1", aborted: true, released: true });
    await expect(api.cedia.reviveAgent(sessionId, "a-2")).resolves.toEqual({ available: true, id: "a-2", revived: true });
    const kill = calls.find(call => call.path === "/v1/sessions/session%2Fone/agents/kill");
    expect(kill).toMatchObject({ kind: "request", method: "POST" });
    expect(kill?.body).toMatchObject({ incarnation: "inc-9", id: "a-1" });
    expect((kill?.body as { commandId?: unknown }).commandId).toEqual(expect.any(String));
    const revive = calls.find(call => call.path === "/v1/sessions/session%2Fone/agents/revive");
    expect(revive?.body).toMatchObject({ incarnation: "inc-9", id: "a-2" });
  });

  it("preserves a typed host refusal reason and code", async () => {
    const fixture = bridgeFor(undefined, new Error("[cedia-code:agents_unavailable] OMP runtime is stopped"));
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await expect(api.cedia.getAgents(sessionId)).rejects.toMatchObject({
      code: "agents_unavailable",
      message: "OMP runtime is stopped",
      name: "CediaHostError",
    });
  });
});
