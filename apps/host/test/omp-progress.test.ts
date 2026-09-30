import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OmpGoalValidationError,
  parseOmpGoalSnapshot,
  OmpSubagentValidationError,
  parseOmpSubagentLifecycleFrame,
  parseOmpSubagentProgressFrame,
  parseOmpSubagentRow,
  type OmpGoalCommandRequest,
  type OmpGoalSnapshot,
} from "../../../packages/protocol/src/index.ts";
import { DeviceAuth } from "../src/auth.ts";
import { OmpProgress } from "../src/omp-progress.ts";
import { OmpPlan, type OmpPlanCommandRequest, type OmpPlanSnapshot } from "../src/omp-plan.ts";
import { createRouter } from "../src/router.ts";
import { HostError, type CediaHost } from "../src/service.ts";

const goal = {
  id: "goal-1",
  objective: "Ship the goal surface",
  status: "active" as const,
  tokenBudget: 10_000,
  tokensUsed: 100,
  timeUsedSeconds: 4,
  createdAt: 1_757_000_000_000,
  updatedAt: 1_757_000_000_500,
};

const snapshot: OmpGoalSnapshot = {
  enabled: true,
  mode: "active",
  goal,
};

describe("OMP goal projection", () => {
  it("strictly validates goal status and required accounting fields", () => {
    expect(parseOmpGoalSnapshot(snapshot)).toEqual(snapshot);
    expect(parseOmpGoalSnapshot({ ...snapshot, startedTurn: true })).toMatchObject({ startedTurn: true });
    expect(() => parseOmpGoalSnapshot({ ...snapshot, startedTurn: "yes" })).toThrow(OmpGoalValidationError);
    expect(() => parseOmpGoalSnapshot({ ...snapshot, goal: { ...goal, status: "unknown" } })).toThrow(OmpGoalValidationError);
    expect(() => parseOmpGoalSnapshot({ ...snapshot, goal: { ...goal, tokensUsed: -1 } })).toThrow(OmpGoalValidationError);
    expect(() => parseOmpGoalSnapshot({ ...snapshot, extra: true })).toThrow(OmpGoalValidationError);
  });

  it("seeds from cedia_goal and updates from every goal_updated frame", async () => {
    const calls: unknown[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaGoalVersion: 1 },
      requestCedia: async (_command: "cedia_goal", payload: unknown) => {
        calls.push(payload);
        return { type: "response", command: "cedia_goal", success: true, data: snapshot };
      },
    };
    const progress = new OmpProgress({ client });
    await progress.seed();
    expect(progress.snapshot()).toMatchObject({ state: "available", goal, revision: 1 });

    const paused = { ...goal, status: "paused" as const, updatedAt: goal.updatedAt + 1_000 };
    progress.update({ type: "goal_updated", goal: paused, state: { enabled: true, mode: "active", goal: paused } });
    expect(progress.snapshot()).toMatchObject({ state: "available", goal: paused, revision: 2 });
    expect(calls).toEqual([{ op: "get" }]);
  });

  it("reports an unadvertised runtime as unavailable without starting one", async () => {
    let requests = 0;
    const progress = new OmpProgress({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not request"); },
      },
    });
    await progress.seed();
    expect(progress.snapshot()).toMatchObject({ state: "unavailable" });
    expect(requests).toBe(0);
  });
});

describe("OMP plan projection", () => {
  const plan = { enabled: true, paused: false, planFilePath: "/tmp/plan.md", workflow: "iterative" as const, reentry: false };
  const vibe = { enabled: false };
  const review = { reviewId: 7, title: "Ship plan mode", planFilePath: "/tmp/plan.md", planContent: "# Plan", truncated: false, createdAt: 1_757_000_000_000 };
  const answer = { plan, vibe, review: null, changed: false };

  it("seeds from cedia_plan and folds state, review, and review-closed frames", async () => {
    const calls: unknown[] = [];
    const projection = new OmpPlan({ client: {
      phase: "ready",
      readyFrame: { cediaPlanVersion: 1 },
      requestCedia: async (command: "cedia_plan", payload: unknown) => {
        calls.push([command, payload]);
        return { data: answer };
      },
    } });
    await projection.seed();
    expect(projection.snapshot()).toEqual({ state: "available", revision: 1, plan, vibe, review: null });
    projection.update({ type: "cedia_plan_state", payload: { plan: { ...plan, enabled: false, reentry: true }, vibe: { enabled: true } } });
    expect(projection.snapshot()).toMatchObject({ state: "available", revision: 2, plan: { enabled: false, reentry: true }, vibe: { enabled: true } });
    projection.update({ type: "cedia_plan_review", payload: review });
    expect(projection.snapshot()).toMatchObject({ state: "available", revision: 3, review });
    projection.update({ type: "cedia_plan_review", payload: { ...review, reviewId: review.reviewId + 1 } });
    expect(projection.snapshot()).toMatchObject({ state: "available", review: { reviewId: review.reviewId + 1 } });
    projection.update({ type: "cedia_plan_review_closed", payload: { reviewId: review.reviewId, decision: "approve" } });
    expect(projection.snapshot()).toMatchObject({ state: "available", revision: 4, review: { reviewId: review.reviewId + 1 } });
    projection.update({ type: "cedia_plan_review_closed", payload: { reviewId: review.reviewId + 1, decision: "approve" } });
    expect(projection.snapshot()).toMatchObject({ state: "available", revision: 5, review: null });
    projection.update({ type: "cedia_plan_state", payload: { plan: { enabled: true, paused: true, workflow: "iterative", reentry: false }, vibe: { enabled: false } } });
    expect(projection.snapshot()).toMatchObject({ state: "available", plan: { enabled: true, paused: true, workflow: "iterative", reentry: false } });
    expect(calls).toEqual([["cedia_plan", { command: { op: "read" } }]]);
  });

  it("does not let malformed frames poison a valid plan cache", async () => {
    const projection = new OmpPlan({ client: {
      phase: "ready",
      readyFrame: { cediaPlanVersion: 1 },
      requestCedia: async () => ({ data: answer }),
    } });
    await projection.seed();
    projection.update({ type: "cedia_plan_state", payload: { plan: { ...plan, workflow: "bad" }, vibe } });
    projection.update({ type: "cedia_plan_review", payload: { ...review, truncated: "no" } });
    expect(projection.snapshot()).toEqual({ state: "available", revision: 1, plan, vibe, review: null });
  });

  it("retains a valid review that arrives before the first state frame", () => {
    const projection = new OmpPlan();
    projection.update({ type: "cedia_plan_review", payload: review });
    expect(projection.snapshot()).toMatchObject({ state: "unavailable" });
    projection.update({ type: "cedia_plan_state", payload: { plan, vibe } });
    expect(projection.snapshot()).toMatchObject({ state: "available", review });
  });

  it("answers an unadvertised runtime as unavailable without requesting it", async () => {
    let calls = 0;
    const projection = new OmpPlan({ client: {
      phase: "ready",
      readyFrame: {},
      requestCedia: async () => { calls += 1; throw new Error("must not request"); },
    } });
    await projection.seed();
    expect(projection.snapshot()).toMatchObject({ state: "unavailable" });
    expect(calls).toBe(0);
  });
});

describe("OMP subagent projection", () => {
  const progress = {
    id: "agent-1",
    index: 0,
    agent: "task",
    status: "running" as const,
    task: "Inspect the repository",
    description: "Repository inspector",
    currentTool: "rg",
    currentToolArgs: "--hidden", // deliberately dropped from Cedia's projection
    recentTools: [{ tool: "rg", args: "--hidden", endMs: 1 }], // deliberately dropped
    recentOutput: ["secret output"], // deliberately dropped
    toolCount: 2,
    requests: 3,
    tokens: 42,
    contextTokens: 100,
    contextWindow: 1000,
    cost: 0.12,
    durationMs: 500,
    resolvedModel: "fixture/model",
  };
  const row = {
    id: "agent-1",
    index: 0,
    agent: "task",
    agentSource: "bundled" as const,
    status: "running" as const,
    task: "Inspect the repository",
    assignment: "Find the relevant files",
    description: "Repository inspector",
    sessionFile: "/tmp/agent-1.jsonl",
    parentToolCallId: "tool-1",
    lastUpdate: 1_757_000_001_000,
    progress,
  };

  it("strictly projects bounded progress and rejects unknown status or fields", () => {
    expect(parseOmpSubagentRow(row)).toEqual({
      ...row,
      progress: {
        toolCount: 2,
        requests: 3,
        tokens: 42,
        cost: 0.12,
        durationMs: 500,
        currentTool: "rg",
        contextTokens: 100,
        contextWindow: 1000,
        resolvedModel: "fixture/model",
      },
    });
    expect(() => parseOmpSubagentRow({ ...row, status: "unknown" })).toThrow(OmpSubagentValidationError);
    expect(() => parseOmpSubagentRow({ ...row, unexpected: true })).toThrow(OmpSubagentValidationError);
  });

  it("parses lifecycle and progress frames without carrying raw progress text", () => {
    expect(parseOmpSubagentLifecycleFrame({ type: "subagent_lifecycle", payload: { id: "agent-1", index: 0, agent: "task", agentSource: "bundled", status: "started", parentToolCallId: "tool-1" } })).toMatchObject({
      type: "subagent_lifecycle",
      payload: { id: "agent-1", status: "started" },
    });
    const parsed = parseOmpSubagentProgressFrame({ type: "subagent_progress", payload: { index: 0, agent: "task", agentSource: "bundled", task: "Inspect the repository", assignment: "Find the relevant files", progress } });
    expect(parsed.payload.progress).toEqual({
      id: "agent-1",
      status: "running",
      toolCount: 2,
      requests: 3,
      tokens: 42,
      cost: 0.12,
      durationMs: 500,
      currentTool: "rg",
      contextTokens: 100,
      contextWindow: 1000,
      resolvedModel: "fixture/model",
    });
    expect(() => parseOmpSubagentProgressFrame({ type: "subagent_progress", payload: { index: 0, agent: "task", agentSource: "bundled", task: "Inspect", progress: { ...progress, status: "mystery" } } })).toThrow(OmpSubagentValidationError);
  });

  it("seeds the live set, folds lifecycle/progress frames, and preserves unavailability", async () => {
    const calls: Array<[string, unknown]> = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaGoalVersion: 1 },
      requestCedia: async () => ({ data: snapshot }),
      request: async (command: "get_subagents", payload?: unknown) => {
        calls.push([command, payload]);
        return { data: { subagents: [row] } };
      },
    };
    const progressProjection = new OmpProgress({ client });
    await progressProjection.seed();
    expect(progressProjection.subagents()).toMatchObject({ state: "available", revision: 1, subagents: [{ ...row, progress: {
      toolCount: 2, requests: 3, tokens: 42, cost: 0.12, durationMs: 500,
      currentTool: "rg", contextTokens: 100, contextWindow: 1000, resolvedModel: "fixture/model",
    } }] });
    progressProjection.update({ type: "subagent_progress", payload: { index: 0, agent: "task", agentSource: "bundled", task: "Updated task", progress: { ...progress, task: "Updated task", requests: 4 } } });
    expect(progressProjection.subagents()).toMatchObject({ state: "available", revision: 2, subagents: [{ id: "agent-1", task: "Updated task", assignment: row.assignment, progress: { requests: 4 } }] });
    progressProjection.update({ type: "subagent_lifecycle", payload: { id: "agent-1", index: 0, agent: "task", agentSource: "bundled", status: "completed" } });
    expect(progressProjection.subagents()).toMatchObject({ state: "available", revision: 3, subagents: [] });
    expect(calls).toEqual([["get_subagents", undefined]]);

    const unavailable = new OmpProgress({ client: { phase: "ready", readyFrame: { cediaGoalVersion: 1 }, requestCedia: async () => ({ data: snapshot }) } });
    await unavailable.seed();
    expect(unavailable.subagents()).toMatchObject({ state: "unavailable" });
    expect(unavailable.subagents()).toHaveProperty("reason");
  });

  it("ignores malformed streamed frames", () => {
    const progressProjection = new OmpProgress();
    progressProjection.update({ type: "subagent_progress", payload: { status: "bad" } });
    expect(progressProjection.subagents()).toMatchObject({ state: "unavailable" });
  });
});

describe("authenticated OMP goal routes", () => {
  const session = {
    id: "session-1",
    projectId: "project-1",
    title: "Goal task",
    cwd: "/tmp/goal-project",
    sessionFile: "/tmp/goal-session.jsonl",
    incarnation: "inc-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  type RouteSnapshot = ({ state: "available"; revision: number } & OmpGoalSnapshot) | { state: "unavailable"; reason: string };
  function fixture(initial: RouteSnapshot) {
    const directory = mkdtempSync(join(tmpdir(), "cedia-goal-route-"));
    const auth = new DeviceAuth(directory);
    let current = initial;
    const commands = new Map<string, unknown>();
    const dispatched: OmpGoalCommandRequest[] = [];
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      goalSnapshot: () => current,
      subagentsSnapshot: () => ({ state: "available", revision: 1, subagents: [] }),
      goalCommand: async (id: string, _deviceId: string, request: OmpGoalCommandRequest) => {
        if (request.incarnation !== session.incarnation && !commands.has(request.commandId)) throw new HostError("stale_incarnation", "Refresh the task before submitting this goal command");
        const prior = commands.get(request.commandId);
        if (prior) return prior;
        dispatched.push(request);
        const answer = { sessionId: id, commandId: request.commandId, deviceId: "owner", incarnation: request.incarnation, kind: "cedia_goal", payload: request, payloadHash: randomUUID(), status: "completed", result: { data: { ...snapshot, goal: request.op === "drop" ? null : goal } } };
        commands.set(request.commandId, answer);
        current = { state: "available", revision: (current.state === "available" ? current.revision : 0) + 1, ...snapshot, goal: request.op === "drop" ? null : goal };
        return answer;
      },
    } as unknown as CediaHost;
    const router = createRouter(host, auth);
    return { directory, auth, router, dispatched, current: () => current };
  }

  it("answers the cache and dispatches every goal operation idempotently", async () => {
    const f = fixture({ state: "available", revision: 1, ...snapshot });
    try {
      const get = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/goal`, token: f.auth.ownerToken });
      expect(get).toMatchObject({ status: 200, body: { state: "available", goal, revision: 1 } });
      const subagents = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/subagents`, token: f.auth.ownerToken });
      expect(subagents).toEqual({ status: 200, body: { state: "available", revision: 1, subagents: [] } });
      for (const [index, op] of (["set", "replace", "pause", "resume", "drop", "complete", "budget", "get"] as const).entries()) {
        const request: Record<string, unknown> = { commandId: `goal-${index}`, incarnation: session.incarnation, op };
        if (op === "set" || op === "replace") request.objective = `objective-${index}`;
        if (op === "budget") request.tokenBudget = 123;
        const response = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/goal`, token: f.auth.ownerToken, body: request });
        expect(response.status).toBe(200);
      }
      const before = f.dispatched.length;
      const first = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/goal`, token: f.auth.ownerToken, body: { commandId: "same", incarnation: session.incarnation, op: "pause" } });
      const second = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/goal`, token: f.auth.ownerToken, body: { commandId: "same", incarnation: session.incarnation, op: "pause" } });
      expect(second).toEqual(first);
      expect(f.dispatched).toHaveLength(before + 1);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("refuses stale incarnations and reports an unavailable runtime honestly", async () => {
    const available = fixture({ state: "available", revision: 1, ...snapshot });
    const unavailable = fixture({ state: "unavailable", reason: "No OMP runtime is running" });
    try {
      const stale = await available.router({ method: "POST", path: `/v1/sessions/${session.id}/goal`, token: available.auth.ownerToken, body: { commandId: "stale", incarnation: "old", op: "pause" } });
      expect(stale).toMatchObject({ status: 409, body: { error: { code: "stale_incarnation" } } });
      const read = await unavailable.router({ method: "GET", path: `/v1/sessions/${session.id}/goal`, token: unavailable.auth.ownerToken });
      expect(read).toEqual({ status: 200, body: { state: "unavailable", reason: "No OMP runtime is running" } });
    } finally {
      rmSync(available.directory, { recursive: true, force: true });
      rmSync(unavailable.directory, { recursive: true, force: true });
    }
  });
});

describe("authenticated OMP plan routes", () => {
  const session = {
    id: "plan-session-1",
    projectId: "project-1",
    title: "Plan task",
    cwd: "/tmp/plan-project",
    sessionFile: "/tmp/plan-session.jsonl",
    incarnation: "inc-plan-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };
  const available: OmpPlanSnapshot = { state: "available", revision: 1, plan: null, vibe: { enabled: false }, review: null };
  function fixture(initial: OmpPlanSnapshot) {
    const directory = mkdtempSync(join(tmpdir(), "cedia-plan-route-"));
    const auth = new DeviceAuth(directory);
    let current = initial;
    const dispatched: OmpPlanCommandRequest[] = [];
    const outcomes = new Map<string, unknown>();
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      planSnapshot: () => current,
      planCommand: async (_id: string, _deviceId: string, request: OmpPlanCommandRequest) => {
        const prior = outcomes.get(request.commandId);
        if (prior) return prior;
        dispatched.push(request);
        const result = { state: "available" as const, revision: dispatched.length + 1, plan: request.op === "enter" ? { enabled: true, paused: false, planFilePath: request.planFilePath ?? "", workflow: request.workflow ?? "parallel", reentry: false } : null, vibe: { enabled: request.op === "vibe.enter" }, review: null, changed: request.op !== "read", ...(request.op === "review.decide" ? { reason: "runtime refusal" } : {}) };
        outcomes.set(request.commandId, result);
        const { changed: _changed, reason: _reason, ...snapshot } = result;
        current = snapshot;
        return result;
      },
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth), dispatched, current: () => current };
  }

  it("answers unavailable reads without starting anything and dispatches plan operations idempotently", async () => {
    const unavailable = fixture({ state: "unavailable", reason: "No OMP runtime is running" });
    try {
      const read = await unavailable.router({ method: "GET", path: `/v1/sessions/${session.id}/plan`, token: unavailable.auth.ownerToken });
      expect(read).toEqual({ status: 200, body: { state: "unavailable", reason: "No OMP runtime is running" } });
    } finally { rmSync(unavailable.directory, { recursive: true, force: true }); }

    const f = fixture(available);
    try {
      for (const request of [
        { commandId: "enter", incarnation: session.incarnation, op: "enter", workflow: "iterative", planFilePath: "/tmp/plan.md" },
        { commandId: "exit", incarnation: session.incarnation, op: "exit", paused: true, confirm: true },
        { commandId: "vibe-enter", incarnation: session.incarnation, op: "vibe.enter" },
        { commandId: "vibe-exit", incarnation: session.incarnation, op: "vibe.exit" },
        { commandId: "review", incarnation: session.incarnation, op: "review.decide", reviewId: 4, decision: "refine", preserveContext: true, compactBeforeExecute: false, feedback: "tighten" },
      ] as const) {
        const response = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/plan`, token: f.auth.ownerToken, body: request });
        expect(response.status).toBe(200);
      }
      const first = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/plan`, token: f.auth.ownerToken, body: { commandId: "same", incarnation: session.incarnation, op: "vibe.enter" } });
      const second = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/plan`, token: f.auth.ownerToken, body: { commandId: "same", incarnation: session.incarnation, op: "vibe.enter" } });
      expect(second).toEqual(first);
      const noConfirm = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/plan`, token: f.auth.ownerToken, body: { commandId: "exit-no-confirm", incarnation: session.incarnation, op: "exit" } });
      expect(noConfirm.status).toBe(200);
      expect(f.dispatched).toHaveLength(7);
      const confirmedExit = f.dispatched.find(command => command.commandId === "exit");
      expect(confirmedExit && confirmedExit.op === "exit" ? confirmedExit.confirm : undefined).toBe(true);
      expect(Object.hasOwn(f.dispatched.find(command => command.commandId === "exit-no-confirm")!, "confirm")).toBe(false);
      expect(f.dispatched.find(command => command.commandId === "vibe-enter")?.op).toBe("vibe.enter");
    } finally { rmSync(f.directory, { recursive: true, force: true }); }
  });

  it("rejects unknown fields and invalid operations before reaching the host", async () => {
    const f = fixture(available);
    try {
      for (const body of [
        { commandId: "bad-field", incarnation: session.incarnation, op: "read", nope: true },
        { commandId: "bad-op", incarnation: session.incarnation, op: "explode" },
      ]) {
        const response = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/plan`, token: f.auth.ownerToken, body });
        expect(response.status).toBe(400);
      }
      expect(f.dispatched).toHaveLength(0);
    } finally { rmSync(f.directory, { recursive: true, force: true }); }
  });
});
