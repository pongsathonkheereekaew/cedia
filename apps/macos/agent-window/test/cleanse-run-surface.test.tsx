import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaCleansePanel,
} from "../vendor/synara/apps/web/src/components/chat/CediaCleanseSurface";
import {
  cleanseRunningRefetchInterval,
  parseCediaCleanseAnswer,
  serverCleanseQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

const DONE = {
  available: true as const,
  state: "done" as const,
  request: "all discovered checkers",
  phase: null,
  checkers: [{ id: "typescript", label: "TypeScript", state: "done" as const, exitCode: 0, diagnostics: 2, durationMs: 40 }],
  agents: [{ name: "CleanseA1", files: 1, status: "done", detail: "" }],
  log: ["Clean: all detected diagnostics are resolved."],
  report: {
    status: "clean" as const,
    checks: [{ id: "typescript", label: "TypeScript", language: "TypeScript", exitCode: 0, diagnostics: 0 }],
    checksTruncated: false,
    diagnostics: [
      { checker: "typescript", file: "a.ts", line: 3, column: 5, code: "TS2322", severity: "error", message: "Type mismatch." },
    ],
    diagnosticsTruncated: false,
    diagnosticsTotal: 1,
    skipped: [{ label: "go vet", language: "Go", reason: "no go.mod" }],
  },
  reason: null,
};

describe("Cleanse run surface", () => {
  it("renders progress rows and the bounded held report", () => {
    const html = renderToStaticMarkup(<CediaCleansePanel state={DONE} request="" onRun={() => {}} onAbort={() => {}} />);
    expect(html).toContain('data-testid="cedia-cleanse-surface"');
    expect(html).toContain("Cleanse");
    expect(html).toContain("TypeScript");
    expect(html).toContain("CleanseA1");
    expect(html).toContain("Type mismatch.");
    expect(html).toContain("TS2322");
    expect(html).toContain("Skipped:");
  });

  it("offers abort while running and run while idle", () => {
    const running = renderToStaticMarkup(
      <CediaCleansePanel state={{ ...DONE, state: "running", report: null }} request="" onRun={() => {}} onAbort={() => {}} />,
    );
    expect(running).toContain("Abort");
    expect(running).not.toContain("Run cleanse");
    const idle = renderToStaticMarkup(<CediaCleansePanel state={{ ...DONE, state: "idle", checkers: [], agents: [], log: [], report: null }} request="" />);
    expect(idle).toContain("Run cleanse");
    expect(idle).not.toContain("Abort");
  });

  it("stays honest on failure and without a runtime", () => {
    const failed = renderToStaticMarkup(
      <CediaCleansePanel state={{ ...DONE, state: "failed", report: null, reason: "model exploded" }} request="" />,
    );
    expect(failed).toContain("model exploded");
    const absent = renderToStaticMarkup(<CediaCleansePanel state={{ available: false, reason: "no runtime" }} request="" />);
    expect(absent).not.toContain("TypeScript");
  });

  it("strictly parses the run state and refuses repair bodies", () => {
    expect(parseCediaCleanseAnswer(DONE)).toEqual(DONE);
    expect(parseCediaCleanseAnswer({ available: false, reason: "no runtime" })).toEqual({
      available: false,
      reason: "no runtime",
    });
    expect(() => parseCediaCleanseAnswer({ ...DONE, state: "polishing" })).toThrow(/run state/);
    expect(() => parseCediaCleanseAnswer({ ...DONE, checkers: [{ id: "ts" }] })).toThrow(/checker/);
    expect(() => parseCediaCleanseAnswer({ ...DONE, report: { ...DONE.report!, output: "x".repeat(10) } })).toThrow(/report/);
    expect(() => parseCediaCleanseAnswer({ ...DONE, extra: 1 })).toThrow(/cleanse response/);
  });

  it("polls while a batch runs and never once it settles", () => {
    expect(cleanseRunningRefetchInterval({ state: { data: { available: true, state: "running" } } })).toBe(3_000);
    expect(cleanseRunningRefetchInterval({ state: { data: { available: true, state: "done" } } })).toBe(false);
    expect(cleanseRunningRefetchInterval({ state: { data: { available: true, state: "failed" } } })).toBe(false);
    expect(cleanseRunningRefetchInterval(undefined)).toBe(false);
    expect(serverCleanseQueryOptions("session-1").refetchOnWindowFocus).toBe(true);
  });

  it("runs and aborts through the adapter routes with the durable envelope", async () => {
    const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string; body?: unknown };
        if (request.kind === "request") calls.push(request);
        if (request.path === "/v1/sessions/session-1/cleanse" && request.method === "GET") {
          return { available: true, state: "idle", request: null, phase: null, checkers: [], agents: [], log: [], report: null, reason: null };
        }
        if (request.path === "/v1/sessions/session-1/cleanse/run" && request.method === "POST") {
          return { available: true, state: "running", request: "all discovered checkers", phase: "detecting", checkers: [], agents: [], log: [], report: null, reason: null };
        }
        if (request.path === "/v1/sessions/session-1/cleanse/abort" && request.method === "POST") {
          return { available: true, state: "idle", request: null, phase: null, checkers: [], agents: [], log: [], report: null, reason: null };
        }
        if (request.path === "/v1/sessions/session-1" && request.method === "GET") {
          return { id: "session-1", projectId: "project-1", cwd: "/tmp", incarnation: "inc-1", createdAt: "2026-09-25T00:00:00.000Z" };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await api.cedia.getCleanse("session-1");
    await api.cedia.runCleanse("session-1", { commandId: "cmd-1", incarnation: "inc-1", all: true });
    await api.cedia.abortCleanse("session-1", { commandId: "cmd-2", incarnation: "inc-1" });
    expect(calls).toContainEqual({ kind: "request", method: "GET", path: "/v1/sessions/session-1/cleanse" });
    const run = calls.find((call) => call.path === "/v1/sessions/session-1/cleanse/run");
    expect(run?.body).toMatchObject({ commandId: "cmd-1", all: true });
    const abort = calls.find((call) => call.path === "/v1/sessions/session-1/cleanse/abort");
    expect(abort?.body).toMatchObject({ commandId: "cmd-2", incarnation: "inc-1" });
  });
});
