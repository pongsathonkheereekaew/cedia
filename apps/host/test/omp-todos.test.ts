import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceAuth } from "../src/auth.ts";
import { OmpTodos } from "../src/omp-todos.ts";
import { createRouter } from "../src/router.ts";
import type { CediaHost } from "../src/service.ts";

const phases = [
  {
    name: "Implement progress",
    tasks: [
      { content: "Add the projection", status: "completed" as const },
      { content: "Wire the route", status: "in_progress" as const },
    ],
  },
  {
    name: "Verify",
    tasks: [{ content: "Run focused tests", status: "blocked" as const, blocker: "Waiting for the host fixture" }],
  },
];

describe("OMP todo projection", () => {
  it("seeds its cache from get_state", async () => {
    const calls: string[] = [];
    const projection = new OmpTodos({
      client: {
        phase: "ready",
        request: async (command: "get_state") => {
          calls.push(command);
          return { data: { sessionFile: "/tmp/session.jsonl", todoPhases: phases } };
        },
      },
    });

    await projection.seed();

    expect(projection.snapshot()).toEqual({ state: "available", revision: 1, phases });
    expect(calls).toEqual(["get_state"]);
  });

  it("folds phases from a todo tool result without changing OMP order", () => {
    const projection = new OmpTodos();

    projection.update({
      type: "tool_execution_end",
      toolName: "todo",
      result: { details: { op: "replace", storage: "session", phases } },
    });

    expect(projection.snapshot()).toEqual({ state: "available", revision: 1, phases });
  });

  it("keeps the last known phases when a frame is malformed or partial", () => {
    const projection = new OmpTodos();
    projection.update({ type: "tool_execution_end", toolName: "todo", result: { details: { phases } } });

    projection.update({
      type: "tool_execution_end",
      toolName: "todo",
      result: { details: { phases: [{ name: "poison", tasks: [{ content: "missing status" }] }] } },
    });
    projection.update({ type: "tool_execution_end", toolName: "todo", result: { details: { phases: "not-an-array" } } });
    projection.update({ type: "tool_execution_end", toolName: "bash", result: { details: { phases: [] } } });

    expect(projection.snapshot()).toEqual({ state: "available", revision: 1, phases });
  });

  it("re-reads get_state at a turn boundary when no todo tool frame arrived", async () => {
    let current = phases;
    const projection = new OmpTodos({
      client: {
        phase: "ready",
        request: async () => ({ data: { todoPhases: current } }),
      },
    });
    await projection.seed();
    current = [{ name: "After the turn", tasks: [{ content: "Branch sync", status: "completed" as const }] }];

    await projection.refresh();

    expect(projection.snapshot()).toEqual({ state: "available", revision: 2, phases: current });
  });

  it("reports an unavailable runtime without issuing a command", async () => {
    let requests = 0;
    const projection = new OmpTodos({
      client: {
        phase: "closed",
        request: async () => { requests += 1; throw new Error("must not request"); },
      },
    });

    await projection.seed();

    expect(projection.snapshot()).toMatchObject({ state: "unavailable" });
    expect(requests).toBe(0);
  });
});

describe("authenticated OMP progress route", () => {
  const session = {
    id: "progress-session",
    projectId: "project-1",
    title: "Progress task",
    cwd: "/tmp/progress-project",
    sessionFile: "/tmp/progress-session.jsonl",
    incarnation: "inc-progress-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture(snapshot: unknown) {
    const directory = mkdtempSync(join(tmpdir(), "cedia-progress-route-"));
    const auth = new DeviceAuth(directory);
    let reads = 0;
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      progressSnapshot: () => { reads += 1; return snapshot; },
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth), reads: () => reads };
  }

  it("answers the runtime phase list byte-for-byte and does not issue a command", async () => {
    const current = { state: "available" as const, revision: 7, phases };
    const f = fixture(current);
    try {
      const response = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/progress`, token: f.auth.ownerToken });
      expect(response).toEqual({ status: 200, body: current });
      expect(f.reads()).toBe(1);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("returns unavailable without starting a runtime and is owner-only", async () => {
    const f = fixture({ state: "unavailable", reason: "No OMP runtime is running" });
    const controller = f.auth.issue("progress-controller");
    try {
      const unavailable = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/progress`, token: f.auth.ownerToken });
      expect(unavailable).toEqual({ status: 200, body: { state: "unavailable", reason: "No OMP runtime is running" } });
      const forbidden = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/progress`, token: controller.token });
      expect(forbidden).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
      expect(f.reads()).toBe(1);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("refuses unknown query and body fields", async () => {
    const f = fixture({ state: "unavailable", reason: "No OMP runtime is running" });
    try {
      const query = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/progress?unexpected=true`, token: f.auth.ownerToken });
      const body = await f.router({ method: "GET", path: `/v1/sessions/${session.id}/progress`, token: f.auth.ownerToken, body: { unexpected: true } });
      expect(query).toMatchObject({ status: 400, body: { error: { code: "invalid_query" } } });
      expect(body).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      expect(f.reads()).toBe(0);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});
