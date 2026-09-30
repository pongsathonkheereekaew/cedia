import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceAuth } from "../src/auth.ts";
import {
  NO_OMP_ADVISOR_BRIDGE_REASON,
  NO_OMP_ADVISOR_RUNTIME_REASON,
  OmpAdvisor,
  parseOmpAdvisorData,
  parseOmpAdvisorHistory,
  readOmpAdvisor,
  readOmpAdvisorHistory,
  setOmpAdvisor,
  type OmpAdvisorData,
} from "../src/omp-advisor.ts";
import { createRouter } from "../src/router.ts";
import type { CediaHost } from "../src/service.ts";

const advisor: OmpAdvisorData = {
  enabled: true,
  active: true,
  configured: true,
  contextWindow: 128_000,
  contextTokens: 4_096,
  tokens: { input: 100, output: 20, reasoning: 10, cacheRead: 30, cacheWrite: 2, total: 162 },
  cost: 0.0123,
  messages: { user: 3, assistant: 4, total: 7 },
  advisors: [
    {
      name: "reviewer",
      status: "running",
      model: { provider: "openai", id: "gpt-review", name: "Review" },
      contextWindow: 64_000,
      contextTokens: 1_234,
      tokens: { input: 50, output: 10, reasoning: 4, cacheRead: 8, cacheWrite: 1, total: 73 },
      cost: 0.004,
      messages: { user: 1, assistant: 2, total: 3 },
      sessionId: "advisor-session-1",
    },
  ],
  changed: false,
};

function controlResponse(operation: string, result: unknown) {
  return { data: { operation, capabilityRevision: "cap-1", result } };
}

describe("OMP advisor projection", () => {
  it("strictly parses snapshot fields and reduces each advisor model", () => {
    const { model: _model, ...withoutModel } = advisor;
    const parsed = parseOmpAdvisorData(withoutModel);
    expect(parsed).toEqual(advisor);
    expect(parsed.model).toBeUndefined();
    expect(parsed.advisors[0]?.model).toEqual({ provider: "openai", id: "gpt-review", name: "Review" });
  });

  it("rejects a snapshot with an unrecognised field", () => {
    expect(() => parseOmpAdvisorData({ ...advisor, extra: true })).toThrow(/unknown field/);
  });

  it("parses a null transcript and a truncated transcript", () => {
    expect(parseOmpAdvisorHistory({ text: null, truncated: false })).toEqual({ text: null, truncated: false });
    expect(parseOmpAdvisorHistory({ text: "bounded", truncated: true })).toEqual({ text: "bounded", truncated: true });
  });

  it("uses cedia_control for get, set and history", async () => {
    const operations: { operation: string; payload?: Record<string, unknown> }[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        operations.push(request as { operation: string; payload?: Record<string, unknown> });
        if (request.operation === "advisor.history") return controlResponse(String(request.operation), { text: null, truncated: false });
        return controlResponse(String(request.operation), { ...advisor, changed: request.operation === "advisor.set" });
      },
    };
    expect(await readOmpAdvisor(client)).toEqual(advisor);
    expect(await readOmpAdvisorHistory(client, true)).toEqual({ text: null, truncated: false });
    expect((await setOmpAdvisor(client, false))?.changed).toBe(true);
    expect(operations).toEqual([
      { operation: "advisor.get" },
      { operation: "advisor.history", payload: { compact: true } },
      { operation: "advisor.set", payload: { enabled: false } },
    ]);
  });

  it("answers bridge absence without issuing control calls", async () => {
    let requests = 0;
    const client = {
      phase: "ready" as const,
      readyFrame: {},
      requestCedia: async () => {
        requests += 1;
        throw new Error("must not call absent bridge");
      },
    };
    expect(await readOmpAdvisor(client)).toBeUndefined();
    expect(await readOmpAdvisorHistory(client)).toBeUndefined();
    expect(requests).toBe(0);

    const state = new OmpAdvisor({ client });
    await state.seed();
    expect(state.snapshot()).toEqual({ state: "unavailable", reason: NO_OMP_ADVISOR_BRIDGE_REASON });
  });

  it("treats a ready client without a negotiated marker as bridge absence", async () => {
    let requests = 0;
    const client = {
      phase: "ready" as const,
      requestCedia: async () => {
        requests += 1;
        throw new Error("must not call an unadvertised bridge");
      },
    };
    expect(await readOmpAdvisor(client)).toBeUndefined();
    const state = new OmpAdvisor({ client });
    await state.seed();
    expect(state.snapshot()).toEqual({ state: "unavailable", reason: NO_OMP_ADVISOR_BRIDGE_REASON });
    expect(requests).toBe(0);
  });

  it("turns a malformed runtime snapshot into an unavailable projection", async () => {
    const state = new OmpAdvisor({
      client: {
        phase: "ready",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => controlResponse("advisor.get", { ...advisor, malformed: true }),
      },
    });
    await state.seed();
    expect(state.snapshot()).toMatchObject({ state: "unavailable" });
    expect((state.snapshot() as { state: "unavailable"; reason: string }).reason).toMatch(/unknown field/);
  });

  it("answers a stopped runtime without issuing control calls", async () => {
    let requests = 0;
    const client = {
      phase: "closed" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async () => {
        requests += 1;
        throw new Error("must not call stopped runtime");
      },
    };
    const state = new OmpAdvisor({ client });
    await state.seed();
    expect(state.snapshot()).toEqual({ state: "unavailable", reason: NO_OMP_ADVISOR_RUNTIME_REASON });
    expect(await state.history()).toEqual({ state: "unavailable", reason: NO_OMP_ADVISOR_RUNTIME_REASON });
    expect(requests).toBe(0);
  });
});

describe("authenticated OMP advisor routes", () => {
  const session = {
    id: "advisor-session",
    projectId: "project-1",
    title: "Advisor task",
    cwd: "/tmp/advisor-project",
    sessionFile: "/tmp/advisor-session.jsonl",
    incarnation: "inc-advisor-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-advisor-route-"));
    const auth = new DeviceAuth(directory);
    const requests: { kind: string; request?: unknown }[] = [];
    const outcome = { state: "available" as const, revision: 3, advisor: { ...advisor, changed: true } };
    let recorded: typeof outcome | undefined;
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      advisorSnapshot: () => ({ state: "available" as const, revision: 2, advisor }),
      advisorHistory: async (_id: string, compact?: boolean) => {
        requests.push({ kind: "history", request: compact });
        return { state: "available" as const, text: compact ? "compact history" : null, truncated: compact };
      },
      advisorCommand: async (_id: string, _deviceId: string, request: unknown) => {
        if (recorded === undefined) {
          requests.push({ kind: "command", request });
          recorded = outcome;
        }
        return recorded;
      },
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth), requests, outcome };
  }

  it("answers snapshot and transcript to the owner only", async () => {
    const f = fixture();
    const controller = f.auth.issue("advisor-controller");
    try {
      const snapshot = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor`, token: f.auth.ownerToken });
      expect(snapshot).toEqual({ status: 200, body: { state: "available", revision: 2, advisor } });
      const history = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/history?compact=true`, token: f.auth.ownerToken });
      expect(history).toEqual({ status: 200, body: { state: "available", text: "compact history", truncated: true } });
      const denied = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor`, token: controller.token });
      expect(denied).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("validates set envelopes before calling the host and forwards the exact payload", async () => {
    const f = fixture();
    try {
      const response = await f.router({
        method: "POST",
        path: `/v1/sessions/${session.id}/advisor`,
        token: f.auth.ownerToken,
        body: { commandId: "advisor-command-1", incarnation: session.incarnation, op: "set", enabled: false },
      });
      expect(response).toEqual({ status: 200, body: f.outcome });
      expect(f.requests).toEqual([{ kind: "command", request: { commandId: "advisor-command-1", incarnation: session.incarnation, op: "set", enabled: false } }]);

      const replay = await f.router({
        method: "POST",
        path: `/v1/sessions/${session.id}/advisor`,
        token: f.auth.ownerToken,
        body: { commandId: "advisor-command-1", incarnation: session.incarnation, op: "set", enabled: false },
      });
      expect(replay).toEqual(response);
      expect(f.requests).toHaveLength(1);

      const unknown = await f.router({
        method: "POST",
        path: `/v1/sessions/${session.id}/advisor`,
        token: f.auth.ownerToken,
        body: { commandId: "advisor-command-2", incarnation: session.incarnation, op: "set", enabled: false, extra: true },
      });
      const invalidOp = await f.router({
        method: "POST",
        path: `/v1/sessions/${session.id}/advisor`,
        token: f.auth.ownerToken,
        body: { commandId: "advisor-command-3", incarnation: session.incarnation, op: "get", enabled: false },
      });
      expect(unknown).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      expect(invalidOp).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      expect(f.requests).toHaveLength(1);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});
