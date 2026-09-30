import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
  NO_OMP_BTW_BRIDGE_REASON,
  NO_OMP_BTW_RUNTIME_REASON,
  OmpBtw,
  OmpBtwValidationError,
  parseOmpBtwBranchData,
  parseOmpBtwCommandResult,
  parseOmpBtwData,
} from "../src/omp-btw.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

function controlResponse(operation: string, result: unknown) {
  return { data: { operation, capabilityRevision: "fixture-capabilities", result } };
}

const IDLE = {
  state: "idle" as const,
  question: null,
  questionTruncated: false,
  answer: null,
  answerTruncated: false,
  branchable: false,
  branchUnavailableReason: "no answered side question",
  reason: null,
};

const READY = {
  state: "ready" as const,
  question: "Why?",
  questionTruncated: false,
  answer: "Because.",
  answerTruncated: false,
  branchable: true,
  branchUnavailableReason: null,
  reason: null,
};

describe("OMP side-question projection", () => {
  it("strictly parses the bounded answer without the held objects", () => {
    expect(parseOmpBtwData(IDLE)).toEqual(IDLE);
    expect(parseOmpBtwData(READY)).toEqual(READY);
    expect(parseOmpBtwBranchData({ cancelled: false, sessionFile: "/tmp/b.jsonl" })).toEqual({ cancelled: false, sessionFile: "/tmp/b.jsonl" });
    expect(parseOmpBtwBranchData({ cancelled: true, sessionFile: null })).toEqual({ cancelled: true, sessionFile: null });
    expect(() => parseOmpBtwData({ ...IDLE, state: "answering-forever" })).toThrow(OmpBtwValidationError);
    expect(() => parseOmpBtwData({ ...IDLE, answer: 7 })).toThrow(OmpBtwValidationError);
    expect(() => parseOmpBtwData({ ...IDLE, extra: 1 })).toThrow(/unknown field/);
    expect(() => parseOmpBtwBranchData({ cancelled: false, sessionFile: "" })).toThrow(OmpBtwValidationError);
    expect(parseOmpBtwCommandResult({ available: true, ...READY })).toEqual({ available: true, ...READY });
    expect(parseOmpBtwCommandResult({ available: false, reason: "down" })).toEqual({ available: false, reason: "down" });
  });

  it("asks and promotes through the negotiated cedia_control bridge", async () => {
    const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
    let held: { answer: string } | undefined;
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push(request as { operation: string; payload?: Record<string, unknown> });
        if (request.operation === "btw.ask") {
          held = { answer: `echo ${(request.payload as { question: string }).question}` };
          return controlResponse(String(request.operation), { ...IDLE, state: "answering", question: (request.payload as { question: string }).question });
        }
        if (request.operation === "btw.state.get" && held) {
          return controlResponse(String(request.operation), { ...READY, answer: held.answer });
        }
        if (request.operation === "btw.branch") {
          if (!held) throw new Error("Cannot branch the side question: no answered side question");
          held = undefined;
          return controlResponse(String(request.operation), { cancelled: false, sessionFile: "/tmp/branched.jsonl" });
        }
        return controlResponse(String(request.operation), IDLE);
      },
    };
    const state = new OmpBtw({ client });
    expect(await state.refresh()).toEqual({ available: true, ...IDLE });
    expect(await state.ask("Why?")).toMatchObject({ state: "answering", question: "Why?" });
    expect(await state.read()).toMatchObject({ state: "ready", answer: "echo Why?", branchable: true });
    expect(await state.branch()).toEqual({ cancelled: false, sessionFile: "/tmp/branched.jsonl" });
    expect(calls.map(call => call.operation)).toEqual(["btw.state.get", "btw.ask", "btw.state.get", "btw.branch"]);
  });

  it("reports missing runtime and bridge without probing either one", async () => {
    let requests = 0;
    const stopped = new OmpBtw({
      client: {
        phase: "closed",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
      },
    });
    expect(await stopped.refresh()).toEqual({ available: false, reason: NO_OMP_BTW_RUNTIME_REASON });
    const absent = new OmpBtw({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
      },
    });
    expect(await absent.refresh()).toEqual({ available: false, reason: NO_OMP_BTW_BRIDGE_REASON });
    expect(requests).toBe(0);
  });
});

describe("controller-visible authenticated OMP side-question routes", () => {
  const session = {
    id: "btw-session",
    projectId: "project-1",
    title: "Side question task",
    cwd: "/tmp/btw-project",
    sessionFile: "/tmp/btw-session.jsonl",
    incarnation: "inc-btw-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-btw-route-"));
    const auth = new DeviceAuth(directory);
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      btwSnapshot: async () => ({ available: true as const, ...IDLE }),
      btwAsk: async () => ({ available: true as const, ...READY }),
      btwBranch: async () => ({ cancelled: false, sessionFile: "/tmp/branched.jsonl" }),
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth) };
  }

  it("answers the state to a paired controller and keeps ask/branch owner-only", async () => {
    const f = fixture();
    const controller = f.auth.issue("btw-controller");
    try {
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/btw`, token: controller.token })).toEqual({ status: 200, body: { available: true, ...IDLE } });
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/btw?debug=1`, token: controller.token })).toMatchObject({ status: 400 });
      const askBody = { commandId: "ask-1", incarnation: session.incarnation, question: "Why?" };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/ask`, token: controller.token, body: askBody })).toMatchObject({ status: 403 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/ask`, token: f.auth.ownerToken, body: askBody })).toMatchObject({ status: 200, body: { available: true, state: "ready" } });
      const branchBody = { commandId: "branch-1", incarnation: session.incarnation };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/branch`, token: controller.token, body: branchBody })).toMatchObject({ status: 403 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/branch`, token: f.auth.ownerToken, body: branchBody })).toMatchObject({ status: 200, body: { cancelled: false } });
      for (const body of [
        { commandId: "bad-1", incarnation: session.incarnation, question: "  " },
        { commandId: "bad-2", incarnation: session.incarnation },
        { commandId: "bad-3", incarnation: session.incarnation, question: "Why?", extra: true },
      ]) {
        expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/btw/ask`, token: f.auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      }
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("real CediaHost side-question routes", () => {
  function createFixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-btw-host-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Side question fixture" });
    const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: { CEDIA_NODE: process.execPath },
    });
    const auth = new DeviceAuth(directory);
    const router = createRouter(host, auth);
    const task = host.createSession(project.id, "Side question fixture");
    return { directory, store, host, auth, router, task };
  }

  it("asks, promotes into an adopted session file, and refuses a second branch", async () => {
    const f = createFixture();
    try {
      expect((await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/btw`, token: f.auth.ownerToken })).body).toMatchObject({ available: false, reason: expect.stringMatching(/No OMP runtime/) });
      await f.host.startSession(f.task.id);
      const session = f.store.getSession(f.task.id)!;
      const before = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/btw`, token: f.auth.ownerToken });
      expect(before).toMatchObject({ status: 200, body: { available: true, ...IDLE } });
      const askBody = { commandId: "cmd-btw-ask", incarnation: session.incarnation, question: "Why?" };
      const asked = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/btw/ask`, token: f.auth.ownerToken, body: askBody });
      expect(asked).toMatchObject({ status: 200, body: { available: true, state: "answering", question: "Why?", answer: null } });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/btw/ask`, token: f.auth.ownerToken, body: askBody })).toEqual(asked);
      const answered = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/btw`, token: f.auth.ownerToken });
      expect(answered).toMatchObject({ status: 200, body: { available: true, state: "ready", question: "Why?", answer: "fixture answer for Why?", branchable: true } });
      const branchBody = { commandId: "cmd-btw-branch", incarnation: session.incarnation, };
      const branched = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/btw/branch`, token: f.auth.ownerToken, body: branchBody });
      expect(branched.status).toBe(200);
      expect(branched.body).toMatchObject({ cancelled: false, sessionFile: expect.stringMatching(/branched\.jsonl$/) });
      // The host adopts the branched file, so the task record follows the conversation.
      expect(f.store.getSession(f.task.id)!.sessionFile).toMatch(/branched\.jsonl$/);
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/btw/branch`, token: f.auth.ownerToken, body: branchBody })).toEqual(branched);
      const reread = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/btw`, token: f.auth.ownerToken });
      expect(reread).toMatchObject({ status: 200, body: { available: true, state: "idle" } });
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});
