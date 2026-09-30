import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
  NO_OMP_PREWALK_BRIDGE_REASON,
  NO_OMP_PREWALK_RUNTIME_REASON,
  OmpPrewalk,
  OmpPrewalkValidationError,
  parseOmpPrewalkState,
} from "../src/omp-prewalk.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

function controlResponse(operation: string, result: unknown) {
  return { data: { operation, capabilityRevision: "fixture-capabilities", result } };
}

describe("OMP prewalk projection", () => {
  it("strictly parses the armed flag", () => {
    expect(parseOmpPrewalkState({ armed: true })).toEqual({ armed: true });
    expect(parseOmpPrewalkState({ armed: false })).toEqual({ armed: false });
    expect(() => parseOmpPrewalkState({ armed: "yes" })).toThrow(OmpPrewalkValidationError);
    expect(() => parseOmpPrewalkState({})).toThrow(/armed/);
    expect(() => parseOmpPrewalkState({ armed: true, extra: 1 })).toThrow(/unknown field/);
  });

  it("reads through the negotiated cedia_control bridge", async () => {
    const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push(request as { operation: string; payload?: Record<string, unknown> });
        return controlResponse(String(request.operation), { armed: true });
      },
    };
    const state = new OmpPrewalk({ client });
    expect(await state.refresh()).toEqual({ state: "available", armed: true });
    expect(calls).toEqual([{ operation: "prewalk.state.get" }]);
  });

  it("reports missing runtime and bridge without probing either one", async () => {
    let requests = 0;
    const stopped = new OmpPrewalk({
      client: {
        phase: "closed",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
      },
    });
    expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_PREWALK_RUNTIME_REASON });
    const absent = new OmpPrewalk({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
      },
    });
    expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_PREWALK_BRIDGE_REASON });
    expect(requests).toBe(0);
  });
});

describe("controller-visible authenticated OMP prewalk route", () => {
  const session = {
    id: "prewalk-session",
    projectId: "project-1",
    title: "Prewalk task",
    cwd: "/tmp/prewalk-project",
    sessionFile: "/tmp/prewalk-session.jsonl",
    incarnation: "inc-prewalk-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-prewalk-route-"));
    const auth = new DeviceAuth(directory);
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      prewalkSnapshot: async () => ({ available: true as const, armed: true }),
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth) };
  }

  it("answers the route to a paired controller", async () => {
    const f = fixture();
    const controller = f.auth.issue("prewalk-controller");
    try {
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/prewalk`, token: controller.token })).toEqual({ status: 200, body: { available: true, armed: true } });
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("real CediaHost prewalk route", () => {
  function createFixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-prewalk-host-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Prewalk fixture" });
    const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: { CEDIA_NODE: process.execPath },
    });
    const auth = new DeviceAuth(directory);
    const router = createRouter(host, auth);
    const task = host.createSession(project.id, "Prewalk fixture");
    return { directory, store, host, auth, router, task };
  }

  it("answers unavailable without a runtime and live once the session starts", async () => {
    const f = createFixture();
    try {
      expect((await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/prewalk`, token: f.auth.ownerToken })).body).toMatchObject({ available: false, reason: expect.stringMatching(/No OMP runtime/) });
      await f.host.startSession(f.task.id);
      const controller = f.auth.issue("prewalk-controller");
      const live = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/prewalk`, token: controller.token });
      expect(live).toMatchObject({ status: 200, body: { available: true, armed: true } });
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});
