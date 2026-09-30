import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
  NO_OMP_CLEANSE_BRIDGE_REASON,
  NO_OMP_CLEANSE_RUNTIME_REASON,
  OmpCleanse,
  OmpCleanseValidationError,
  parseOmpCleanseCommandResult,
  parseOmpCleanseData,
} from "../src/omp-cleanse.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

function controlResponse(operation: string, result: unknown) {
  return { data: { operation, capabilityRevision: "fixture-capabilities", result } };
}

const IDLE = {
  state: "idle" as const,
  request: null,
  phase: null,
  checkers: [],
  agents: [],
  log: [],
  report: null,
  reason: null,
};

const DONE = {
  state: "done" as const,
  request: "all discovered checkers",
  phase: null,
  checkers: [{ id: "typescript", label: "TypeScript", state: "done" as const, exitCode: 0, diagnostics: 0, durationMs: 12 }],
  agents: [],
  log: ["Clean: 1 checker passed."],
  report: {
    status: "clean" as const,
    checks: [{ id: "typescript", label: "TypeScript", language: "TypeScript", exitCode: 0, diagnostics: 0 }],
    checksTruncated: false,
    diagnostics: [],
    diagnosticsTruncated: false,
    diagnosticsTotal: 0,
    skipped: [],
  },
  reason: null,
};

describe("OMP cleanse projection", () => {
  it("strictly parses the bounded run state without repair bodies", () => {
    expect(parseOmpCleanseData(IDLE)).toEqual(IDLE);
    expect(parseOmpCleanseData(DONE)).toEqual(DONE);
    expect(() => parseOmpCleanseData({ ...IDLE, state: "polishing" })).toThrow(OmpCleanseValidationError);
    expect(() => parseOmpCleanseData({ ...IDLE, checkers: [{ id: "ts" }] })).toThrow(OmpCleanseValidationError);
    expect(() => parseOmpCleanseData({ ...IDLE, log: ["ok", 7] })).toThrow(OmpCleanseValidationError);
    expect(() => parseOmpCleanseData({ ...IDLE, report: { status: "clean" } })).toThrow(OmpCleanseValidationError);
    expect(() => parseOmpCleanseData({ ...IDLE, extra: 1 })).toThrow(/unknown field/);
    expect(parseOmpCleanseCommandResult({ available: true, ...DONE })).toEqual({ available: true, ...DONE });
    expect(parseOmpCleanseCommandResult({ available: false, reason: "down" })).toEqual({ available: false, reason: "down" });
  });

  it("runs, lands, and aborts through the negotiated cedia_control bridge", async () => {
    const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
    let running = false;
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push(request as { operation: string; payload?: Record<string, unknown> });
        if (request.operation === "cleanse.run") {
          running = true;
          return controlResponse(String(request.operation), { ...IDLE, state: "running" as const, request: "all discovered checkers", phase: "detecting" });
        }
        if (request.operation === "cleanse.abort") {
          running = false;
          return controlResponse(String(request.operation), IDLE);
        }
        return controlResponse(String(request.operation), running ? { ...IDLE, state: "running" as const } : DONE);
      },
    };
    const state = new OmpCleanse({ client });
    expect(await state.refresh()).toEqual({ available: true, ...DONE });
    expect(await state.run({})).toMatchObject({ state: "running", request: "all discovered checkers" });
    expect(await state.abort()).toMatchObject({ state: "idle" });
    expect(calls.map(call => call.operation)).toEqual(["cleanse.state.get", "cleanse.run", "cleanse.abort"]);
  });

  it("reports missing runtime and bridge without probing either one", async () => {
    let requests = 0;
    const stopped = new OmpCleanse({
      client: {
        phase: "closed",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
      },
    });
    expect(await stopped.refresh()).toEqual({ available: false, reason: NO_OMP_CLEANSE_RUNTIME_REASON });
    const absent = new OmpCleanse({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
      },
    });
    expect(await absent.refresh()).toEqual({ available: false, reason: NO_OMP_CLEANSE_BRIDGE_REASON });
    expect(requests).toBe(0);
  });
});

describe("controller-visible authenticated OMP cleanse routes", () => {
  const session = {
    id: "cleanse-session",
    projectId: "project-1",
    title: "Cleanse task",
    cwd: "/tmp/cleanse-project",
    sessionFile: "/tmp/cleanse-session.jsonl",
    incarnation: "inc-cleanse-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-cleanse-route-"));
    const auth = new DeviceAuth(directory);
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      cleanseSnapshot: async () => ({ available: true as const, ...IDLE }),
      cleanseRun: async () => ({ available: true as const, ...IDLE, state: "running" as const }),
      cleanseAbort: async () => ({ available: true as const, ...IDLE }),
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth) };
  }

  it("answers the state to a paired controller and keeps run/abort owner-only", async () => {
    const f = fixture();
    const controller = f.auth.issue("cleanse-controller");
    try {
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/cleanse`, token: controller.token })).toEqual({ status: 200, body: { available: true, ...IDLE } });
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/cleanse?debug=1`, token: controller.token })).toMatchObject({ status: 400 });
      const runBody = { commandId: "run-1", incarnation: session.incarnation, all: true };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/run`, token: controller.token, body: runBody })).toMatchObject({ status: 403 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/run`, token: f.auth.ownerToken, body: runBody })).toMatchObject({ status: 200, body: { available: true, state: "running" } });
      const abortBody = { commandId: "abort-1", incarnation: session.incarnation };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/abort`, token: controller.token, body: abortBody })).toMatchObject({ status: 403 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/abort`, token: f.auth.ownerToken, body: abortBody })).toMatchObject({ status: 200, body: { available: true, state: "idle" } });
      for (const body of [
        { commandId: "bad-1", incarnation: session.incarnation, maxAgents: 0 },
        { commandId: "bad-2", incarnation: session.incarnation, request: "  " },
        { commandId: "bad-3", incarnation: session.incarnation, all: "yes" },
        { commandId: "bad-4", incarnation: session.incarnation, request: "x", extra: true },
      ]) {
        expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/run`, token: f.auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      }
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("real CediaHost cleanse routes", () => {
  function createFixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-cleanse-host-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Cleanse fixture" });
    const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: { CEDIA_NODE: process.execPath },
    });
    const auth = new DeviceAuth(directory);
    const router = createRouter(host, auth);
    const task = host.createSession(project.id, "Cleanse fixture");
    return { directory, store, host, auth, router, task };
  }

  it("dispatches at once, lands the held report, and aborts to idle", async () => {
    const f = createFixture();
    try {
      expect((await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/cleanse`, token: f.auth.ownerToken })).body).toMatchObject({ available: false, reason: expect.stringMatching(/No OMP runtime/) });
      await f.host.startSession(f.task.id);
      const session = f.store.getSession(f.task.id)!;
      const before = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/cleanse`, token: f.auth.ownerToken });
      expect(before).toMatchObject({ status: 200, body: { available: true, ...IDLE } });
      const runBody = { commandId: "cmd-cleanse-run", incarnation: session.incarnation, all: true };
      const run = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/cleanse/run`, token: f.auth.ownerToken, body: runBody });
      expect(run).toMatchObject({ status: 200, body: { available: true, state: "running" } });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/cleanse/run`, token: f.auth.ownerToken, body: runBody })).toEqual(run);
      const landed = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/cleanse`, token: f.auth.ownerToken });
      expect(landed).toMatchObject({ status: 200, body: { available: true, state: "done", report: { status: "clean" } } });
      const abortBody = { commandId: "cmd-cleanse-abort", incarnation: session.incarnation };
      const aborted = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/cleanse/abort`, token: f.auth.ownerToken, body: abortBody });
      expect(aborted).toMatchObject({ status: 200, body: { available: true, state: "done" } });
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});
