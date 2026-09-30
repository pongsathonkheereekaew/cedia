import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";
import {
  NO_OMP_AGENT_EMPTY_TRANSCRIPT_REASON,
  NO_OMP_AGENT_NO_SESSION_REASON,
  NO_OMP_AGENT_UNKNOWN_REASON,
  NO_OMP_AGENTS_BRIDGE_REASON,
  OmpAgents,
  OmpAgentsValidationError,
  parseOmpAgentConfigList,
  parseOmpAgentConfigResult,
  parseOmpAgentKillResult,
  parseOmpAgentReviveResult,
  parseOmpAgentsData,
  projectOmpAgentTranscript,
  type OmpAgentsData,
} from "../src/omp-agents.ts";
import { createRouter } from "../src/router.ts";

const agents: OmpAgentsData = {
  agents: [
    {
      id: "agent-1",
      name: "Worker",
      kind: "subagent",
      parentId: "root",
      status: "running",
      createdAt: 100,
      lastActivity: 200,
      activity: "Reading files",
      sessionFile: "/tmp/worker-session.jsonl",
    },
    {
      id: "agent-2",
      name: "Queued",
      kind: "subagent",
      status: "queued",
      createdAt: 101,
      lastActivity: 150,
    },
  ],
};

function controlResponse(operation: string, result: unknown) {
  return { data: { operation, capabilityRevision: "cap-1", result } };
}

describe("OMP agents projection", () => {
  it("strictly parses rows with optional activity and session file", () => {
    expect(parseOmpAgentsData(agents)).toEqual(agents);
    expect(() => parseOmpAgentsData({ ...agents, extra: true })).toThrow(/unknown field/);
    expect(() => parseOmpAgentsData({ agents: [{ ...agents.agents[0], createdAt: -1 }] })).toThrow(/createdAt/);
  });

  it("reads agents.get through cedia_control and pages a named child transcript", async () => {
    const calls: { command: string; request: unknown }[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push({ command: "cedia_control", request });
        return controlResponse(String(request.operation), agents);
      },
      request: async (_command: "get_subagent_messages", request: Record<string, unknown>) => {
        calls.push({ command: "get_subagent_messages", request });
        return {
          data: {
            sessionFile: "/tmp/worker-session.jsonl",
            fromByte: request.fromByte,
            nextByte: 42,
            reset: false,
            entries: [],
            messages: [
              { role: "assistant", content: [{ type: "text", text: "hello " }, { type: "image", url: "x" }, { type: "text", text: "world" }] },
              { role: "tool", content: [] },
            ],
          },
        };
      },
    };
    const state = new OmpAgents({ client });
    expect((await state.refresh()).state).toBe("available");
    expect(await state.transcript("agent-1", 7)).toEqual({
      state: "available",
      agentId: "agent-1",
      sessionFile: "/tmp/worker-session.jsonl",
      fromByte: 7,
      nextByte: 42,
      reset: false,
      messages: [{ role: "assistant", text: "hello world", otherParts: 1 }, { role: "tool", text: "", otherParts: 1 }],
      truncated: false,
    });
    expect(calls.at(-1)).toEqual({ command: "get_subagent_messages", request: { sessionFile: "/tmp/worker-session.jsonl", fromByte: 7 } });
  });

  it("bounds messages and text while preserving the runtime next byte", () => {
    const long = "x".repeat(8_193);
    const messages = Array.from({ length: 51 }, (_, index) => ({
      role: index === 0 ? "assistant" : "user",
      content: [{ type: "text", text: index === 0 ? long : String(index) }],
    }));
    expect(projectOmpAgentTranscript({
      sessionFile: "/tmp/worker-session.jsonl",
      fromByte: 4,
      nextByte: 99,
      reset: true,
      entries: [],
      messages,
    }, "agent-1")).toEqual({
      state: "available",
      agentId: "agent-1",
      sessionFile: "/tmp/worker-session.jsonl",
      fromByte: 4,
      nextByte: 99,
      reset: true,
      messages: [{ role: "assistant", text: "x".repeat(8_192), otherParts: 0 }, ...messages.slice(1, 50).map(message => ({ role: message.role, text: String(messages.indexOf(message)), otherParts: 0 }))],
      truncated: true,
    });
  });

  it("refuses a silent empty transcript for a child with no output yet, but keeps paging", async () => {
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => controlResponse(String(request.operation), agents),
      request: async (_command: "get_subagent_messages", request: Record<string, unknown>) => ({
        data: { sessionFile: "/tmp/worker-session.jsonl", fromByte: request.fromByte, nextByte: 0, reset: false, entries: [], messages: [] },
      }),
    };
    const state = new OmpAgents({ client });
    expect(await state.transcript("agent-1", 0)).toEqual({ state: "unavailable", reason: NO_OMP_AGENT_EMPTY_TRANSCRIPT_REASON("agent-1") });
    expect(await state.transcript("agent-1", 9)).toMatchObject({ state: "available", messages: [] });
  });

  it("does not issue a transcript command for an unknown or transcript-less agent", async () => {
    let transcriptCalls = 0;
    const state = new OmpAgents({
      client: {
        phase: "ready",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => controlResponse("agents.get", agents),
        request: async () => { transcriptCalls += 1; throw new Error("must not read transcript"); },
      },
    });
    expect(await state.transcript("missing", 0)).toEqual({ state: "unavailable", reason: NO_OMP_AGENT_UNKNOWN_REASON("missing") });
    expect(await state.transcript("agent-2", 0)).toEqual({ state: "unavailable", reason: NO_OMP_AGENT_NO_SESSION_REASON("agent-2") });
    expect(transcriptCalls).toBe(0);
  });

  it("drives agents.kill/revive through cedia_control with strict payloads", async () => {
    const calls: { operation: string; payload?: unknown }[] = [];
    const client = {
      phase: "ready",
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push({ operation: String(request.operation), payload: request.payload });
        if (request.operation === "agents.kill") return controlResponse("agents.kill", { id: "agt-running", aborted: true, released: true });
        return controlResponse("agents.revive", { id: "agt-parked", revived: true });
      },
      request: async () => { throw new Error("must not read transcript"); },
    };
    const state = new OmpAgents({ client });
    expect(await state.kill("agt-running")).toEqual({ id: "agt-running", aborted: true, released: true });
    expect(await state.revive("agt-parked")).toEqual({ id: "agt-parked", revived: true });
    expect(calls).toEqual([
      { operation: "agents.kill", payload: { id: "agt-running" } },
      { operation: "agents.get", payload: undefined },
      { operation: "agents.revive", payload: { id: "agt-parked" } },
      { operation: "agents.get", payload: undefined },
    ]);
    expect(() => parseOmpAgentKillResult({ available: true, id: "a", aborted: true, released: true, extra: 1 })).toThrow(OmpAgentsValidationError);
    expect(() => parseOmpAgentReviveResult({ available: true, id: "a" })).toThrow(OmpAgentsValidationError);
    expect(parseOmpAgentKillResult({ available: false, reason: "nope" })).toEqual({ available: false, reason: "nope" });
    const bare = new OmpAgents();
    await expect(bare.kill("x")).rejects.toThrow(/No OMP runtime/);
    await expect(bare.revive("x")).rejects.toThrow(/No OMP runtime/);
  });

  it("reports a missing runtime instead of an empty roster or transcript", async () => {
    const state = new OmpAgents();
    const roster = await state.refresh();
    const transcript = await state.transcript("agent-1", 0);
    expect(roster.state).toBe("unavailable");
    expect(transcript.state).toBe("unavailable");
    if (roster.state === "unavailable") expect(roster.reason).toMatch(/No OMP runtime/);
    if (transcript.state === "unavailable") expect(transcript.reason).toMatch(/No OMP runtime/);
  });

  it("reports an absent capability bridge without issuing cedia_control", async () => {
    let requests = 0;
    const state = new OmpAgents({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
        request: async () => { requests += 1; throw new Error("must not read transcript"); },
      },
    });
    expect(await state.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_AGENTS_BRIDGE_REASON });
    expect(requests).toBe(0);
  });
});

describe("authenticated OMP agents routes", () => {
  const session = {
    id: "agents-session",
    projectId: "project-1",
    title: "Agents task",
    cwd: "/tmp/agents-project",
    sessionFile: "/tmp/agents-session.jsonl",
    incarnation: "inc-agents-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-agents-route-"));
    const auth = new DeviceAuth(directory);
    const calls: string[] = [];
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      agentsSnapshot: async () => {
        calls.push("roster");
        return { state: "available" as const, revision: 3, agents: agents.agents };
      },
      agentTranscript: async (_id: string, agentId: string, fromByte: number) => {
        calls.push(`transcript:${agentId}:${fromByte}`);
        return { state: "available" as const, agentId, sessionFile: "/tmp/worker-session.jsonl", fromByte, nextByte: 8, reset: false, messages: [], truncated: false };
      },
      agentsKill: async (_id: string, _device: string, body: { id: string }) => {
        calls.push(`kill:${body.id}`);
        return { available: true as const, id: body.id, aborted: true, released: true };
      },
      agentsRevive: async (_id: string, _device: string, body: { id: string }) => {
        calls.push(`revive:${body.id}`);
        return { available: true as const, id: body.id, revived: true };
      },
      agentsConfig: async (_id: string, _device: string, body: { agent: string }) => {
        calls.push(`config:${body.agent}`);
        return { available: true as const, agent: body.agent, enabled: false };
      },
      agentsConfigList: async () => {
        calls.push("config-list");
        return { state: "available" as const, agents: [{ name: "task", source: "bundled", enabled: true }] };
      },
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth), calls };
  }

  it("answers roster and transcript to the owner and validates query fields first", async () => {
    const f = fixture();
    const controller = f.auth.issue("agents-controller");
    try {
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: f.auth.ownerToken })).toEqual({
        status: 200,
        body: { state: "available", revision: 3, agents: agents.agents },
      });
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/agent-1/transcript?fromByte=7`, token: f.auth.ownerToken })).toMatchObject({
        status: 200,
        body: { state: "available", agentId: "agent-1", fromByte: 7 },
      });
      expect((await f.router({ method: "GET", path: `/v1/sessions/${session.id}/agents?nope=1`, token: f.auth.ownerToken })).status).toBe(400);
      expect((await f.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/agent-1/transcript?fromByte=-1`, token: f.auth.ownerToken })).status).toBe(400);
      expect((await f.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/agent-1/transcript?fromByte=1.5`, token: f.auth.ownerToken })).status).toBe(400);
      expect(f.calls).toEqual(["roster", "transcript:agent-1:7"]);
      expect((await f.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: controller.token })).status).toBe(403);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("routes kill/revive posts to the owner with strict bodies", async () => {
    const f = fixture();
    const controller = f.auth.issue("agents-controller");
    try {
      const incarnation = session.incarnation;
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/kill`, token: f.auth.ownerToken, body: { commandId: "kill-1", incarnation, id: "agent-1" } })).toEqual({
        status: 200,
        body: { available: true, id: "agent-1", aborted: true, released: true },
      });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/revive`, token: f.auth.ownerToken, body: { commandId: "revive-1", incarnation, id: "agent-2" } })).toEqual({
        status: 200,
        body: { available: true, id: "agent-2", revived: true },
      });
      expect(f.calls).toEqual(["kill:agent-1", "revive:agent-2"]);
      expect((await f.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/kill`, token: f.auth.ownerToken })).status).toBe(405);
      expect((await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/kill?nope=1`, token: f.auth.ownerToken, body: { commandId: "kill-2", incarnation, id: "agent-1" } })).status).toBe(400);
      expect((await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/kill`, token: f.auth.ownerToken, body: { commandId: "kill-3", incarnation, id: "" } })).status).toBe(400);
      expect((await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/kill`, token: f.auth.ownerToken, body: { commandId: "kill-4", incarnation } })).status).toBe(400);
      expect((await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/revive`, token: controller.token, body: { commandId: "revive-2", incarnation, id: "agent-2" } })).status).toBe(403);
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/config`, token: f.auth.ownerToken })).toEqual({
        status: 200,
        body: { state: "available", agents: [{ name: "task", source: "bundled", enabled: true }] },
      });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/config`, token: f.auth.ownerToken, body: { commandId: "config-1", incarnation, agent: "task", enabled: false } })).toEqual({
        status: 200,
        body: { available: true, agent: "task", enabled: false },
      });
      expect(f.calls).toEqual(["kill:agent-1", "revive:agent-2", "config-list", "config:task"]);
      expect((await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/config`, token: f.auth.ownerToken, body: { commandId: "config-2", incarnation, agent: "task" } })).status).toBe(400);
      expect((await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/config`, token: f.auth.ownerToken, body: { commandId: "config-3", incarnation, agent: "", enabled: true } })).status).toBe(400);
      expect((await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/config`, token: f.auth.ownerToken, body: { commandId: "config-4", incarnation, agent: "task", enabled: "yes" } })).status).toBe(400);
      expect((await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/config?nope=1`, token: f.auth.ownerToken, body: { commandId: "config-5", incarnation, agent: "task", enabled: true } })).status).toBe(400);
      expect((await f.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/config`, token: controller.token })).status).toBe(403);
      expect((await f.router({ method: "POST", path: `/v1/sessions/${session.id}/agents/config`, token: controller.token, body: { commandId: "config-6", incarnation, agent: "task", enabled: true } })).status).toBe(403);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("real CediaHost agents kill/revive routes", () => {
  function createFixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-agents-host-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Agents fixture" });
    const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: { CEDIA_NODE: process.execPath },
    });
    const auth = new DeviceAuth(directory);
    const router = createRouter(host, auth);
    const task = host.createSession(project.id, "Agents fixture");
    return { directory, store, host, auth, router, task };
  }

  it("kills, replays, revives and refuses unknown agents through the durable envelope", async () => {
    const f = createFixture();
    try {
      expect((await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/agents`, token: f.auth.ownerToken })).body).toMatchObject({ state: "unavailable", reason: expect.stringMatching(/No OMP runtime/) });
      await f.host.startSession(f.task.id);
      const live = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/agents`, token: f.auth.ownerToken });
      expect(live).toMatchObject({
        status: 200,
        body: { state: "available", agents: [{ id: "agt-running" }, { id: "agt-parked" }] },
      });
      const incarnation = f.store.getSession(f.task.id)!.incarnation;
      const killed = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/agents/kill`, token: f.auth.ownerToken, body: { commandId: "agt-kill-1", incarnation, id: "agt-running" } });
      expect(killed).toMatchObject({ status: 200, body: { available: true, id: "agt-running", aborted: true, released: true } });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/agents/kill`, token: f.auth.ownerToken, body: { commandId: "agt-kill-1", incarnation, id: "agt-running" } })).toEqual(killed);
      const revived = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/agents/revive`, token: f.auth.ownerToken, body: { commandId: "agt-revive-1", incarnation, id: "agt-parked" } });
      expect(revived).toMatchObject({ status: 200, body: { available: true, id: "agt-parked", revived: true } });
      const refused = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/agents/kill`, token: f.auth.ownerToken, body: { commandId: "agt-kill-missing", incarnation, id: "agt-missing" } });
      expect(refused).toMatchObject({ status: 200, body: { available: false, reason: expect.stringMatching(/Unknown agent/) } });
      const stale = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/agents/revive`, token: f.auth.ownerToken, body: { commandId: "agt-revive-stale", incarnation: "stale-incarnation", id: "agt-parked" } });
      expect(stale).toMatchObject({ status: 409, body: { error: { code: "stale_incarnation" } } });
      const configList = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/agents/config`, token: f.auth.ownerToken });
      expect(configList).toMatchObject({
        status: 200,
        body: {
          state: "available",
          agents: [
            { name: "task", source: "bundled", enabled: true },
            { name: "reviewer", source: "bundled", enabled: false, model: "fixture/model" },
          ],
        },
      });
      const configured = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/agents/config`, token: f.auth.ownerToken, body: { commandId: "agt-config-1", incarnation, agent: "task", enabled: false, model: "fixture/model" } });
      expect(configured).toMatchObject({ status: 200, body: { available: true, agent: "task", enabled: false, model: "fixture/model" } });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/agents/config`, token: f.auth.ownerToken, body: { commandId: "agt-config-1", incarnation, agent: "task", enabled: false, model: "fixture/model" } })).toEqual(configured);
      const configRefused = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/agents/config`, token: f.auth.ownerToken, body: { commandId: "agt-config-missing", incarnation, agent: "no-such-agent", enabled: true } });
      expect(configRefused).toMatchObject({ status: 200, body: { available: false, reason: expect.stringMatching(/Unknown agent/) } });
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("OMP agent config projection", () => {
  it("strictly parses the config list and config answers", () => {
    expect(parseOmpAgentConfigList({ agents: [{ name: "task", source: "bundled", enabled: true, model: "m" }] })).toEqual([
      { name: "task", source: "bundled", enabled: true, model: "m" },
    ]);
    expect(() => parseOmpAgentConfigList({ agents: [{ name: "task" }] })).toThrow(/source/);
    expect(parseOmpAgentConfigResult({ available: true, agent: "task", enabled: false })).toEqual({
      available: true, agent: "task", enabled: false,
    });
    expect(parseOmpAgentConfigResult({ available: false, reason: "Unknown agent: x" })).toEqual({
      available: false, reason: "Unknown agent: x",
    });
    expect(() => parseOmpAgentConfigResult({ available: true, agent: "task" })).toThrow(/enabled/);
  });
});
