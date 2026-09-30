import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
  NO_OMP_OMFG_BRIDGE_REASON,
  NO_OMP_OMFG_RUNTIME_REASON,
  OmpOmfg,
  OmpOmfgValidationError,
  parseOmpOmfgCommandResult,
  parseOmpOmfgData,
  parseOmpOmfgSaveCommandResult,
  parseOmpOmfgSaveData,
} from "../src/omp-omfg.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

function controlResponse(operation: string, result: unknown) {
  return { data: { operation, capabilityRevision: "fixture-capabilities", result } };
}

const IDLE = {
  state: "idle" as const,
  complaint: null,
  complaintTruncated: false,
  draft: null,
  draftTruncated: false,
  ruleName: null,
  validated: false,
  validationFeedback: null,
  savedPath: null,
  reason: null,
};

const READY = {
  state: "ready" as const,
  complaint: "Stop that.",
  complaintTruncated: false,
  draft: "# no-eval\n",
  draftTruncated: false,
  ruleName: "no-eval",
  validated: true,
  validationFeedback: null,
  savedPath: null,
  reason: null,
};

const SAVED = { saved: true, scope: "project" as const, name: "no-eval", path: "/tmp/no-eval.md", validated: true };

describe("OMP rule-forging projection", () => {
  it("strictly parses the bounded draft without held objects", () => {
    expect(parseOmpOmfgData(IDLE)).toEqual(IDLE);
    expect(parseOmpOmfgData(READY)).toEqual(READY);
    expect(parseOmpOmfgSaveData(SAVED)).toEqual(SAVED);
    expect(() => parseOmpOmfgData({ ...IDLE, state: "forging" })).toThrow(OmpOmfgValidationError);
    expect(() => parseOmpOmfgData({ ...IDLE, draft: 7 })).toThrow(OmpOmfgValidationError);
    expect(() => parseOmpOmfgData({ ...IDLE, extra: 1 })).toThrow(/unknown field/);
    expect(() => parseOmpOmfgSaveData({ ...SAVED, scope: "everywhere" })).toThrow(OmpOmfgValidationError);
    expect(() => parseOmpOmfgSaveData({ ...SAVED, path: 7 })).toThrow(OmpOmfgValidationError);
    expect(parseOmpOmfgCommandResult({ available: true, ...READY })).toEqual({ available: true, ...READY });
    expect(parseOmpOmfgCommandResult({ available: false, reason: "down" })).toEqual({ available: false, reason: "down" });
    expect(parseOmpOmfgSaveCommandResult(SAVED)).toEqual(SAVED);
    expect(parseOmpOmfgSaveCommandResult({ available: false, reason: "down" })).toEqual({ available: false, reason: "down" });
  });

  it("drafts, saves, and aborts through the negotiated cedia_control bridge", async () => {
    const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
    let held: { draft: string } | undefined;
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push(request as { operation: string; payload?: Record<string, unknown> });
        if (request.operation === "omfg.draft") {
          held = { draft: "# no-eval\n" };
          return controlResponse(String(request.operation), { ...IDLE, state: "drafting", complaint: "Stop that." });
        }
        if (request.operation === "omfg.save") {
          if (!held) throw new Error("No rule draft to save: draft one first.");
          held = undefined;
          return controlResponse(String(request.operation), SAVED);
        }
        if (request.operation === "omfg.abort") {
          return controlResponse(String(request.operation), IDLE);
        }
        return controlResponse(String(request.operation), held ? READY : IDLE);
      },
    };
    const state = new OmpOmfg({ client });
    expect(await state.refresh()).toEqual({ available: true, ...IDLE });
    expect(await state.draft("Stop that.")).toMatchObject({ state: "drafting", complaint: "Stop that." });
    expect(await state.save("project")).toEqual(SAVED);
    expect(await state.abort()).toMatchObject({ state: "idle" });
    expect(calls.map(call => call.operation)).toEqual(["omfg.state.get", "omfg.draft", "omfg.save", "omfg.abort"]);
  });

  it("reports missing runtime and bridge without probing either one", async () => {
    let requests = 0;
    const stopped = new OmpOmfg({
      client: {
        phase: "closed",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
      },
    });
    expect(await stopped.refresh()).toEqual({ available: false, reason: NO_OMP_OMFG_RUNTIME_REASON });
    const absent = new OmpOmfg({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
      },
    });
    expect(await absent.refresh()).toEqual({ available: false, reason: NO_OMP_OMFG_BRIDGE_REASON });
    expect(requests).toBe(0);
  });
});

describe("controller-visible authenticated OMP rule-forging routes", () => {
  const session = {
    id: "omfg-session",
    projectId: "project-1",
    title: "Rule task",
    cwd: "/tmp/omfg-project",
    sessionFile: "/tmp/omfg-session.jsonl",
    incarnation: "inc-omfg-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omfg-route-"));
    const auth = new DeviceAuth(directory);
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      omfgSnapshot: async () => ({ available: true as const, ...IDLE }),
      omfgDraft: async () => ({ available: true as const, ...IDLE, state: "drafting" as const }),
      omfgSave: async () => ({ ...SAVED }),
      omfgAbort: async () => ({ available: true as const, ...IDLE }),
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth) };
  }

  it("answers the state to a paired controller and keeps draft/save/abort owner-only", async () => {
    const f = fixture();
    const controller = f.auth.issue("omfg-controller");
    try {
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/omfg`, token: controller.token })).toEqual({ status: 200, body: { available: true, ...IDLE } });
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/omfg?debug=1`, token: controller.token })).toMatchObject({ status: 400 });
      const draftBody = { commandId: "draft-1", incarnation: session.incarnation, complaint: "Stop that." };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/draft`, token: controller.token, body: draftBody })).toMatchObject({ status: 403 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/draft`, token: f.auth.ownerToken, body: draftBody })).toMatchObject({ status: 200, body: { available: true, state: "drafting" } });
      const saveBody = { commandId: "save-1", incarnation: session.incarnation, scope: "project" };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/save`, token: controller.token, body: saveBody })).toMatchObject({ status: 403 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/save`, token: f.auth.ownerToken, body: saveBody })).toMatchObject({ status: 200, body: SAVED });
      const abortBody = { commandId: "abort-1", incarnation: session.incarnation };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/abort`, token: controller.token, body: abortBody })).toMatchObject({ status: 403 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/abort`, token: f.auth.ownerToken, body: abortBody })).toMatchObject({ status: 200, body: { available: true, state: "idle" } });
      for (const body of [
        { commandId: "bad-1", incarnation: session.incarnation, complaint: "  " },
        { commandId: "bad-2", incarnation: session.incarnation },
        { commandId: "bad-3", incarnation: session.incarnation, complaint: "x", extra: true },
      ]) {
        expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/draft`, token: f.auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      }
      for (const body of [
        { commandId: "bad-4", incarnation: session.incarnation, scope: "everywhere" },
        { commandId: "bad-5", incarnation: session.incarnation, scope: "project", overwrite: "yes" },
        { commandId: "bad-6", incarnation: session.incarnation },
      ]) {
        expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/omfg/save`, token: f.auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      }
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("real CediaHost rule-forging routes", () => {
  function createFixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omfg-host-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Rule fixture" });
    const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: { CEDIA_NODE: process.execPath },
    });
    const auth = new DeviceAuth(directory);
    const router = createRouter(host, auth);
    const task = host.createSession(project.id, "Rule fixture");
    return { directory, store, host, auth, router, task };
  }

  it("drafts, saves, consumes, and refuses a second save", async () => {
    const f = createFixture();
    try {
      expect((await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/omfg`, token: f.auth.ownerToken })).body).toMatchObject({ available: false, reason: expect.stringMatching(/No OMP runtime/) });
      await f.host.startSession(f.task.id);
      const session = f.store.getSession(f.task.id)!;
      const before = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/omfg`, token: f.auth.ownerToken });
      expect(before).toMatchObject({ status: 200, body: { available: true, ...IDLE } });
      const draftBody = { commandId: "cmd-omfg-draft", incarnation: session.incarnation, complaint: "Stop that." };
      const drafted = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/omfg/draft`, token: f.auth.ownerToken, body: draftBody });
      expect(drafted).toMatchObject({ status: 200, body: { available: true, state: "ready", ruleName: "fixture-rule" } });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/omfg/draft`, token: f.auth.ownerToken, body: draftBody })).toEqual(drafted);
      const saveBody = { commandId: "cmd-omfg-save", incarnation: session.incarnation, scope: "project" };
      const saved = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/omfg/save`, token: f.auth.ownerToken, body: saveBody });
      expect(saved).toMatchObject({ status: 200, body: { saved: true, scope: "project", name: "fixture-rule", validated: true } });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/omfg/save`, token: f.auth.ownerToken, body: saveBody })).toEqual(saved);
      // The save consumed the draft: a second save with a new id is refused, not rewritten.
      const resave = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/omfg/save`, token: f.auth.ownerToken, body: { commandId: "cmd-omfg-save-2", incarnation: session.incarnation, scope: "project" } });
      expect(resave).toMatchObject({ status: 200, body: { available: false, reason: expect.stringMatching(/No rule draft/) } });
      const reread = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/omfg`, token: f.auth.ownerToken });
      expect(reread).toMatchObject({ status: 200, body: { available: true, state: "idle" } });
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});
