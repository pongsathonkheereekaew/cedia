import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
  NO_OMP_LOOP_BRIDGE_REASON,
  NO_OMP_LOOP_RUNTIME_REASON,
  OmpLoop,
  OmpLoopValidationError,
  parseOmpLoopData,
} from "../src/omp-loop.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

function controlResponse(operation: string, result: unknown) {
  return { data: { operation, capabilityRevision: "fixture-capabilities", result } };
}

const OFF = { enabled: false, paused: false, limit: null, condition: null, hasPrompt: false };

describe("OMP loop projection", () => {
  it("strictly parses the loop state", () => {
    expect(parseOmpLoopData({ enabled: true, paused: false, limit: "3 iterations remaining", condition: null, hasPrompt: true })).toEqual({
      enabled: true, paused: false, limit: "3 iterations remaining", condition: null, hasPrompt: true,
    });
    expect(parseOmpLoopData(OFF)).toEqual(OFF);
    expect(() => parseOmpLoopData({ ...OFF, enabled: "yes" })).toThrow(OmpLoopValidationError);
    expect(() => parseOmpLoopData({ ...OFF, limit: 3 })).toThrow(OmpLoopValidationError);
    expect(() => parseOmpLoopData({ enabled: false })).toThrow(/paused/);
    expect(() => parseOmpLoopData({ ...OFF, extra: 1 })).toThrow(/unknown field/);
  });

  it("reads and disables through the negotiated cedia_control bridge", async () => {
    let enabled = true;
    const calls: { operation: string }[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push({ operation: String(request.operation) });
        if (request.operation === "loop.set") enabled = false;
        return controlResponse(String(request.operation), enabled
          ? { enabled: true, paused: false, limit: "3 iterations remaining", condition: null, hasPrompt: true }
          : OFF);
      },
    };
    const state = new OmpLoop({ client });
    expect(await state.refresh()).toEqual({ state: "available", enabled: true, paused: false, limit: "3 iterations remaining", condition: null, hasPrompt: true });
    expect(await state.disable()).toEqual(OFF);
    expect(calls).toEqual([{ operation: "loop.state.get" }, { operation: "loop.set" }]);
  });

  it("reports missing runtime and bridge without probing either one", async () => {
    let requests = 0;
    const stopped = new OmpLoop({
      client: {
        phase: "closed",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
      },
    });
    expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_LOOP_RUNTIME_REASON });
    const absent = new OmpLoop({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
      },
    });
    expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_LOOP_BRIDGE_REASON });
    expect(requests).toBe(0);
  });
});

describe("controller-visible authenticated OMP loop route", () => {
  const session = {
    id: "loop-session",
    projectId: "project-1",
    title: "Loop task",
    cwd: "/tmp/loop-project",
    sessionFile: "/tmp/loop-session.jsonl",
    incarnation: "inc-loop-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-loop-route-"));
    const auth = new DeviceAuth(directory);
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      loopSnapshot: async () => ({ available: true as const, enabled: true, paused: false, limit: "3 iterations remaining", condition: null, hasPrompt: true }),
      loopCommand: async () => ({ state: "available" as const, ...OFF }),
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth) };
  }

  it("answers the read to a paired controller and keeps the disable owner-only", async () => {
    const f = fixture();
    const controller = f.auth.issue("loop-controller");
    try {
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/loop`, token: controller.token })).toEqual({
        status: 200, body: { available: true, enabled: true, paused: false, limit: "3 iterations remaining", condition: null, hasPrompt: true },
      });
      const denied = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/loop`, token: controller.token, body: { commandId: "cmd-1", incarnation: session.incarnation } });
      expect(denied.status).toBe(403);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("refuses a loop command body with unknown fields", async () => {
    const f = fixture();
    try {
      const bad = await f.router({ method: "POST", path: `/v1/sessions/${session.id}/loop`, token: f.auth.ownerToken, body: { commandId: "cmd-1", incarnation: session.incarnation, enabled: false } });
      expect(bad.status).toBe(400);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("real CediaHost loop route", () => {
  function createFixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-loop-host-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Loop fixture" });
    const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: { CEDIA_NODE: process.execPath },
    });
    const auth = new DeviceAuth(directory);
    const router = createRouter(host, auth);
    const task = host.createSession(project.id, "Loop fixture");
    return { directory, store, host, auth, router, task };
  }

  it("reads live once the session starts and disables through the durable command", async () => {
    const f = createFixture();
    try {
      expect((await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/loop`, token: f.auth.ownerToken })).body).toMatchObject({ available: false, reason: expect.stringMatching(/No OMP runtime/) });
      await f.host.startSession(f.task.id);
      const session = f.store.getSession(f.task.id)!;
      const live = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/loop`, token: f.auth.ownerToken });
      expect(live).toMatchObject({ status: 200, body: { available: true, enabled: true, limit: "3 iterations remaining", hasPrompt: true } });
      const command = { commandId: "cmd-loop-1", incarnation: session.incarnation };
      const disabled = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/loop`, token: f.auth.ownerToken, body: command });
      expect(disabled).toMatchObject({ status: 200, body: { state: "available", enabled: false, hasPrompt: false } });
      const replay = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/loop`, token: f.auth.ownerToken, body: command });
      expect(replay).toMatchObject({ status: 200, body: { state: "available", enabled: false } });
      const reread = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/loop`, token: f.auth.ownerToken });
      expect(reread).toMatchObject({ status: 200, body: { available: true, enabled: false } });
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});
