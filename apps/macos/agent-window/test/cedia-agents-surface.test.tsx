import { afterEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaAgentsPanel,
  type CediaAgentsAnswer,
  type CediaAgentTranscriptAnswer,
} from "../vendor/synara/apps/web/src/components/chat/CediaAgentsSurface";
import {
  parseCediaAgentConfigAnswer,
  parseCediaAgentConfigsAnswer,
  parseCediaAgentKillAnswer,
  parseCediaAgentReviveAnswer,
  serverAgentsConfigMutationOptions,
  serverAgentsKillMutationOptions,
  serverAgentsReviveMutationOptions,
  serverQueryKeys,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const roster: CediaAgentsAnswer = {
  state: "available",
  revision: 4,
  agents: [
    {
      id: "root",
      name: "Planner",
      kind: "orchestrator",
      status: "running",
      createdAt: 1,
      lastActivity: 2,
      sessionFile: "/tmp/root.json",
    },
    {
      id: "child",
      name: "Implementer",
      kind: "worker",
      parentId: "root",
      status: "waiting",
      createdAt: 3,
      lastActivity: 4,
      activity: "writing the adapter",
      sessionFile: "/tmp/child.json",
    },
    {
      id: "no-transcript",
      name: "Reviewer",
      kind: "reviewer",
      status: "done",
      createdAt: 5,
      lastActivity: 6,
    },
  ],
};

function panel(overrides: Partial<React.ComponentProps<typeof CediaAgentsPanel>> = {}) {
  return renderToStaticMarkup(<CediaAgentsPanel state={roster} {...overrides} />);
}

describe("Cedia agents surface", () => {
  it("shows kind, status, activity, and nested ancestry", () => {
    const html = panel();
    expect(html).toContain("Planner");
    expect(html).toContain("orchestrator");
    expect(html).toContain("running");
    expect(html).toContain("Implementer");
    expect(html).toContain("worker");
    expect(html).toContain("waiting");
    expect(html).toContain("writing the adapter");
    expect(html).toContain("Child of Planner");
    expect(html).toContain('data-agent-child="true"');
  });

  it("labels an agent without a transcript and offers no transcript control", () => {
    const html = panel();
    expect(html).toContain("Reviewer");
    expect(html).toContain("No transcript available");
    expect(html).not.toContain('data-agent-transcript="no-transcript"');
  });

  it("renders an empty roster as nothing to show", () => {
    const html = renderToStaticMarkup(
      <CediaAgentsPanel state={{ state: "available", revision: 5, agents: [] }} />,
    );
    expect(html).toContain("Nothing to show");
    expect(html).not.toContain("Planner");
  });

  it("renders only the host reason when the roster is unavailable", () => {
    const html = renderToStaticMarkup(
      <CediaAgentsPanel state={{ state: "unavailable", reason: "OMP runtime is stopped" }} />,
    );
    expect(html).toContain("OMP runtime is stopped");
    expect(html).not.toContain("Planner");
    expect(html).not.toContain("No agents");
  });

  it("renders transcript roles, text, non-text part counts, and a reset notice", () => {
    const transcript: CediaAgentTranscriptAnswer = {
      state: "available",
      agentId: "child",
      sessionFile: "/tmp/child.json",
      fromByte: 0,
      nextByte: 4,
      reset: true,
      messages: [{ role: "assistant", text: "Implemented it", otherParts: 2 }],
      truncated: false,
    };
    const html = panel({ selectedAgentId: "child", transcript });
    expect(html).toContain("assistant");
    expect(html).toContain("Implemented it");
    expect(html).toContain("2 non-text parts");
    expect(html).toContain("Transcript reset by the runtime");
  });

  it("appends a truncated transcript page and offers load more", () => {
    const firstPage: CediaAgentTranscriptAnswer = {
      state: "available",
      agentId: "child",
      sessionFile: "/tmp/child.json",
      fromByte: 0,
      nextByte: 4,
      reset: false,
      messages: [{ role: "user", text: "First page", otherParts: 0 }],
      truncated: true,
    };
    expect(panel({ selectedAgentId: "child", transcript: firstPage })).toContain("Load more");
    const secondPage: CediaAgentTranscriptAnswer = {
      ...firstPage,
      fromByte: 4,
      nextByte: 8,
      messages: [{ role: "assistant", text: "Second page", otherParts: 0 }],
      truncated: false,
    };
    const html = panel({ selectedAgentId: "child", transcriptPages: [firstPage, secondPage] });
    expect(html).toContain("First page");
    expect(html).toContain("Second page");
    expect(html).toContain("page was cut by the runtime");
  });
});

describe("Cedia agent lifecycle controls", () => {
  const mixed: CediaAgentsAnswer = {
    state: "available",
    revision: 7,
    agents: [
      { id: "live", name: "Runner", kind: "sub", status: "running", createdAt: 1, lastActivity: 2, sessionFile: "/tmp/live.json" },
      { id: "parked", name: "Sleeper", kind: "sub", status: "parked", createdAt: 3, lastActivity: 4 },
      { id: "dead", name: "Gone", kind: "sub", status: "aborted", createdAt: 5, lastActivity: 6 },
      { id: "watcher", name: "Watcher", kind: "advisor", status: "idle", createdAt: 7, lastActivity: 8 },
    ],
  };

  it("offers Kill to live rows, Revive to parked rows, and nothing to terminal or advisor rows", () => {
    const html = renderToStaticMarkup(
      <CediaAgentsPanel state={mixed} onKillAgent={() => {}} onReviveAgent={() => {}} />,
    );
    expect(html).toContain('aria-label="Kill agent Runner"');
    expect(html).toContain('aria-label="Revive agent Sleeper"');
    expect(html).not.toContain("Kill agent Gone");
    expect(html).not.toContain("Revive agent Gone");
    expect(html).not.toContain("Kill agent Watcher");
    expect(html).not.toContain("Revive agent Watcher");
    expect(html).not.toContain("Kill agent Sleeper");
  });

  it("renders the lifecycle error without touching the roster", () => {
    const html = renderToStaticMarkup(
      <CediaAgentsPanel state={mixed} agentError="Unknown agent: ghost" />,
    );
    expect(html).toContain("Unknown agent: ghost");
    expect(html).toContain('data-agent-id="live"');
  });

  it("parses kill/revive answers strictly", () => {
    expect(parseCediaAgentKillAnswer({ available: true, id: "a", aborted: true, released: true })).toEqual({
      available: true, id: "a", aborted: true, released: true,
    });
    expect(() => parseCediaAgentKillAnswer({ available: true, id: "a", aborted: true })).toThrow(/kill response/);
    expect(parseCediaAgentReviveAnswer({ available: true, id: "a", revived: false })).toEqual({
      available: true, id: "a", revived: false,
    });
    expect(() => parseCediaAgentReviveAnswer({ available: true, id: "a", revived: "yes" })).toThrow(/revive response/);
    expect(parseCediaAgentReviveAnswer({ available: false, reason: "gone" })).toEqual({ available: false, reason: "gone" });
  });

  it("drives kill/revive mutations through the owner-only routes and re-reads the roster", async () => {
    const posts: Array<{ path?: string; body?: unknown }> = [];
    const session = {
      id: "session-1", projectId: "project-1", title: "Task", cwd: "/workspace",
      sessionFile: "/state/session-1.json", incarnation: "inc-1", status: "idle",
      archived: false, createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
    };
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string; body?: unknown };
        if (request.path === "/v1/sessions/session-1" && request.method !== "POST") return session;
        if (request.kind === "request" && request.method === "POST" && typeof request.path === "string" && request.path.endsWith("/agents/kill")) {
          posts.push({ path: request.path, body: request.body });
          return { available: true, id: "live", aborted: true, released: true };
        }
        if (request.kind === "request" && request.method === "POST" && typeof request.path === "string" && request.path.endsWith("/agents/revive")) {
          posts.push({ path: request.path, body: request.body });
          return { available: true, id: "parked", revived: true };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge: bridge as never });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { nativeApi: api } });
    const invalidated: unknown[] = [];
    const queryClient = { invalidateQueries: async (filter: unknown) => { invalidated.push(filter); } };
    const killOptions = serverAgentsKillMutationOptions({ sessionId: "session-1", queryClient: queryClient as never });
    const killed = await killOptions.mutationFn({ id: "live" });
    expect(killed).toMatchObject({ available: true, id: "live", aborted: true, released: true });
    expect(posts[0]?.body).toMatchObject({ incarnation: "inc-1", id: "live" });
    killOptions.onSuccess!(killed, { id: "live" }, undefined as never);
    const reviveOptions = serverAgentsReviveMutationOptions({ sessionId: "session-1", queryClient: queryClient as never });
    const revived = await reviveOptions.mutationFn({ id: "parked" });
    expect(revived).toMatchObject({ available: true, id: "parked", revived: true });
    reviveOptions.onSuccess!(revived, { id: "parked" }, undefined as never);
    expect(invalidated).toEqual([
      { queryKey: serverQueryKeys.agents("session-1") },
      { queryKey: serverQueryKeys.agents("session-1") },
    ]);
  });
});

describe("agents config section", () => {
  const configs = {
    state: "available" as const,
    agents: [
      { name: "task", source: "bundled", enabled: false, model: "fixture/model" },
      { name: "reviewer", source: "bundled", enabled: true },
    ],
  };

  it("renders Roster and Config section tabs", () => {
    const html = panel();
    expect(html).toContain('aria-label="Show roster section"');
    expect(html).toContain('aria-label="Show configuration section"');
  });

  it("renders the config table with effective values and Configure buttons", () => {
    const html = panel({ activeTab: "config", configState: configs, onConfigureAgent: () => {} });
    expect(html).toContain("disabled, model fixture/model");
    expect(html).toContain('aria-label="Configure agent task"');
    expect(html).toContain('aria-label="Configure agent reviewer"');
  });

  it("offers no Configure button without a configure handler", () => {
    const html = panel({ activeTab: "config", configState: configs });
    expect(html).not.toContain("Configure agent task");
  });

  it("shows the config absence reason honestly", () => {
    const html = panel({
      activeTab: "config",
      configState: { state: "unavailable", reason: "No OMP runtime is running" },
    });
    expect(html).toContain("No OMP runtime is running");
  });

  it("parses config list and config answers strictly", () => {
    expect(parseCediaAgentConfigsAnswer(configs)).toEqual(configs);
    expect(() => parseCediaAgentConfigsAnswer({ state: "available", agents: [{ name: "x" }] })).toThrow();
    expect(parseCediaAgentConfigAnswer({ available: true, agent: "task", enabled: false, model: "m" })).toEqual({
      available: true, agent: "task", enabled: false, model: "m",
    });
    expect(parseCediaAgentConfigAnswer({ available: false, reason: "Unknown agent: x" })).toEqual({
      available: false, reason: "Unknown agent: x",
    });
    expect(() => parseCediaAgentConfigAnswer({ available: true, agent: "task" })).toThrow();
  });

  it("names its own mutation key", () => {
    const options = serverAgentsConfigMutationOptions({ sessionId: "s", queryClient: {} as never });
    expect(options.mutationKey).toEqual(["server", "mutation", "agents", "config", "s"]);
  });
});
