import { describe, expect, it } from "bun:test";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import { deriveWorkLogEntries } from "../vendor/synara/apps/web/src/session-logic";
import { deriveComposerSubagentStripItems } from "../vendor/synara/apps/web/src/components/chat/ComposerSubagentStrip.logic";

type Request = { kind: "request"; method: "GET" | "POST"; path: string; body?: unknown };

const project = { id: "project-goal", path: "/workspace/goal", name: "Goal", pinned: false, archived: false, createdAt: "2026-09-24T00:00:00.000Z" };
const session = {
  id: "session-goal",
  projectId: project.id,
  title: "Goal task",
  cwd: project.path,
  sessionFile: "/state/goal.jsonl",
  incarnation: "inc-goal",
  status: "idle" as const,
  archived: false,
  createdAt: "2026-09-24T00:01:00.000Z",
  updatedAt: "2026-09-24T00:02:00.000Z",
};

const activeGoal = {
  id: "goal-1",
  objective: "Ship the goal projection",
  status: "active" as const,
  tokensUsed: 3,
  timeUsedSeconds: 2,
  createdAt: 1_757_000_000_000,
  updatedAt: 1_757_000_000_500,
};

function bridge(options: { readonly events?: readonly unknown[]; readonly goal?: unknown; readonly subagents?: readonly unknown[] } = {}) {
  const calls: Request[] = [];
  let currentGoal: unknown = options.goal ?? { enabled: true, mode: "active", goal: activeGoal };
  const subagents = options.subagents ?? [];
  const events = options.events ?? [];
  return {
    calls,
    bridge: {
      invoke: async (_channel: string, input: Request) => {
        if ((input as unknown as { kind?: string }).kind === "bootstrap") return { platform: "darwin", homeDir: "/Users/tester", worktreesDir: "/tmp/worktrees", version: "test" };
        calls.push(input);
        if (input.path === "/v1/projects") return [project];
        if (input.path === `/v1/sessions?projectId=${project.id}`) return [session];
        if (input.path === `/v1/sessions/${session.id}` && input.method === "GET") return session;
        if (input.path.startsWith(`/v1/sessions/${session.id}/events`)) return { events, cursor: events.length, hasMore: false };
        if (input.path === `/v1/sessions/${session.id}/goal` && input.method === "GET") return { state: "available", ...currentGoal, revision: 1 };
        if (input.path === `/v1/sessions/${session.id}/subagents` && input.method === "GET") return { state: "available", revision: 1, subagents };
        if (input.path === `/v1/sessions/${session.id}/goal` && input.method === "POST") {
          const body = input.body as { op: string; objective?: string };
          if (body.op === "drop") currentGoal = { enabled: false, mode: "exiting", goal: null };
          else if (body.op === "set" || body.op === "replace") currentGoal = { enabled: true, mode: "active", goal: { ...activeGoal, objective: body.objective ?? activeGoal.objective } };
          else if (body.op === "pause") currentGoal = { enabled: true, mode: "active", goal: { ...activeGoal, status: "paused" } };
          return { sessionId: session.id, commandId: (body as { commandId: string }).commandId, incarnation: session.incarnation, kind: "cedia_goal", payload: body, status: "completed", result: { data: currentGoal } };
        }
        throw new Error(`Unexpected ${input.method} ${input.path}`);
      },
    },
  };
}

describe("Cedia OMP goal projection", () => {
  it("uses the latest goal_updated frame for goal timing and status", async () => {
    const fixture = bridge({ events: [{ sessionId: session.id, incarnation: session.incarnation, sequence: 1, timestamp: "2026-09-24T00:03:00.000Z", frame: { type: "goal_updated", goal: activeGoal, state: { enabled: true, mode: "active", goal: activeGoal } } }] });
    const api = createCediaNativeApi({ bridge: fixture.bridge });
    const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
    expect(detail.thread).toMatchObject({
      goal: activeGoal.objective,
      goalStartedAt: new Date(activeGoal.createdAt).toISOString(),
      goalPausedAt: null,
    });
  });

  it("projects the pause timestamp only while OMP reports a paused goal", async () => {
    const paused = { ...activeGoal, status: "paused" as const, updatedAt: activeGoal.updatedAt + 5_000 };
    const fixture = bridge({ events: [{ sessionId: session.id, incarnation: session.incarnation, sequence: 1, timestamp: "2026-09-24T00:03:00.000Z", frame: { type: "goal_updated", goal: paused, state: { enabled: false, mode: "active", goal: paused } } }] });
    const api = createCediaNativeApi({ bridge: fixture.bridge });
    const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
    expect(detail.thread).toMatchObject({
      goal: paused.objective,
      goalStartedAt: new Date(paused.createdAt).toISOString(),
      goalPausedAt: new Date(paused.updatedAt).toISOString(),
    });
  });

  it("falls back to the host goal read when no goal frame has arrived", async () => {
    const fixture = bridge();
    const api = createCediaNativeApi({ bridge: fixture.bridge });
    const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
    expect(detail.thread.goal).toBe(activeGoal.objective);
    expect(fixture.calls.some(call => call.path?.endsWith("/goal") && call.method === "GET")).toBe(true);
  });

  it("maps goal metadata edits to native set/replace, pause/resume and drop operations", async () => {
    const fixture = bridge();
    const api = createCediaNativeApi({ bridge: fixture.bridge });
    await api.orchestration.dispatchCommand({ type: "thread.meta.update", commandId: "goal-set", threadId: session.id, goal: "A new objective" });
    await api.orchestration.dispatchCommand({ type: "thread.meta.update", commandId: "goal-pause", threadId: session.id, goalPaused: true });
    await api.orchestration.dispatchCommand({ type: "thread.meta.update", commandId: "goal-resume", threadId: session.id, goalPaused: false });
    await api.orchestration.dispatchCommand({ type: "thread.meta.update", commandId: "goal-drop", threadId: session.id, goal: "" });
    const goalCalls = fixture.calls.filter(call => call.path?.endsWith("/goal") && call.method === "POST").map(call => (call.body as { op: string; objective?: string }).op);
    expect(goalCalls).toEqual(["replace", "pause", "resume", "drop"]);
  });

  it("projects live OMP subagents into the vendor work-log decoder shape", async () => {
    const fixture = bridge({ subagents: [{
      id: "agent-1",
      index: 0,
      agent: "task",
      agentSource: "bundled",
      status: "running",
      task: "Inspect the repository",
      assignment: "Find the relevant files",
      description: "Repository inspector",
      lastUpdate: 1_757_000_001_000,
      progress: { toolCount: 2, requests: 3, tokens: 42, cost: 0.12, durationMs: 500, currentTool: "rg", resolvedModel: "fixture/model" },
    }] });
    const api = createCediaNativeApi({ bridge: fixture.bridge });
    const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
    const activities = detail.thread.activities as Array<Record<string, unknown>>;
    const subagentActivity = activities.find(activity => (activity.payload as Record<string, unknown> | undefined)?.itemType === "collab_agent_tool_call");
    expect(subagentActivity).toBeDefined();
    const workEntries = deriveWorkLogEntries(activities as never, undefined);
    const strip = deriveComposerSubagentStripItems({ workEntries, liveTurnId: null });
    // The strip shows OMP's own agent name as the role, not where the definition came from, and
    // the row's own message carries what the agent was asked to do.
    expect(strip).toMatchObject([{
      kind: "subagent",
      providerThreadId: "agent-1",
      primaryLabel: "Task",
      role: "task",
      modelLabel: "fixture/model",
      statusKind: "running",
      isActive: true,
    }]);
    expect(strip[0]?.fullLabel).toBe("Task");
    expect(detail.thread).toMatchObject({ subagentAgentId: null, subagentNickname: null, subagentRole: null });
  });
});
