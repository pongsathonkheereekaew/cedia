import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
  NO_OMP_TREE_BRIDGE_REASON,
  NO_OMP_TREE_RUNTIME_REASON,
  OmpTree,
  OmpTreeValidationError,
  parseOmpTreeData,
  parseOmpTreeNavigateResult,
  type OmpTreeData,
  type OmpTreeNavigateResult,
} from "../src/omp-tree.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const tree: OmpTreeData = {
  leafId: "entry-3",
  nodes: [
    { id: "root", parentId: null, kind: "session", timestamp: "2026-09-24T00:00:00.000Z", label: "Task", labelTruncated: false },
    { id: "entry-3", parentId: "root", kind: "assistant", timestamp: "2026-09-24T00:01:00.000Z", label: "Latest answer", labelTruncated: false },
  ],
  pathIds: ["root", "entry-3"],
  truncated: false,
  lineage: {
    sessionFile: "/tmp/tree-session.jsonl",
    parentSession: null,
    previousSessionFiles: [],
  },
};

const navigation: OmpTreeNavigateResult = {
  moved: true,
  cancelled: false,
  aborted: false,
  askReopen: false,
  summarized: true,
  editorText: "Reopened entry",
  editorTextTruncated: false,
  editorImageCount: 0,
  leafId: "entry-2",
};

function controlResponse(operation: string, result: unknown) {
  return { data: { operation, capabilityRevision: "cap-tree-1", result } };
}

describe("OMP tree projection", () => {
  it("strictly parses tree and navigation results without flattening nulls", () => {
    expect(parseOmpTreeData(tree)).toEqual(tree);
    expect(parseOmpTreeNavigateResult(navigation)).toEqual(navigation);
    expect(() => parseOmpTreeData({ ...tree, nodes: [{ ...tree.nodes[0], labelTruncated: "no" }] })).toThrow(OmpTreeValidationError);
    expect(() => parseOmpTreeData({ ...tree, lineage: { ...tree.lineage, previousSessionFiles: [null] } })).toThrow(/previousSessionFiles/);
    expect(() => parseOmpTreeData({ ...tree, extra: true })).toThrow(/unknown field/);
    expect(() => parseOmpTreeNavigateResult({ ...navigation, editorText: 1 })).toThrow(/editorText/);
    expect(() => parseOmpTreeNavigateResult({ ...navigation, editorImageCount: null })).toThrow(/editorImageCount/);
  });

  it("reads and navigates through the negotiated cedia_control bridge", async () => {
    const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push(request as { operation: string; payload?: Record<string, unknown> });
        return controlResponse(String(request.operation), request.operation === "tree.get" ? tree : navigation);
      },
    };
    const state = new OmpTree({ client });
    expect(await state.refresh()).toEqual({ state: "available", ...tree });
    expect(await state.navigate("entry-2", true)).toEqual(navigation);
    expect(calls).toEqual([
      { operation: "tree.get" },
      { operation: "tree.navigate", payload: { entryId: "entry-2", summarize: true } },
    ]);
  });

  it("reports missing runtime and bridge without probing either one", async () => {
    let requests = 0;
    const stopped = new OmpTree({
      client: {
        phase: "closed",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
      },
    });
    expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_TREE_RUNTIME_REASON });
    const absent = new OmpTree({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
      },
    });
    expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_TREE_BRIDGE_REASON });
    expect(requests).toBe(0);
  });
});

describe("controller-visible authenticated OMP tree routes", () => {
  const session = {
    id: "tree-session",
    projectId: "project-1",
    title: "Tree task",
    cwd: "/tmp/tree-project",
    sessionFile: "/tmp/tree-session.jsonl",
    incarnation: "inc-tree-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-tree-route-"));
    const auth = new DeviceAuth(directory);
    const calls: Record<string, unknown>[] = [];
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      treeSnapshot: async () => ({ available: true as const, ...tree }),
      treeNavigate: async (_id: string, _deviceId: string, request: Record<string, unknown>) => { calls.push(request); return { available: true as const, ...navigation }; },
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth), calls };
  }

  it("answers both routes to a paired controller and preserves askReopen as a non-move", async () => {
    const f = fixture();
    const controller = f.auth.issue("tree-controller");
    try {
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/tree`, token: controller.token })).toEqual({ status: 200, body: { available: true, ...tree } });
      const body = { commandId: "tree-navigate-1", incarnation: session.incarnation, entryId: "entry-2", summarize: true };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tree/navigate`, token: controller.token, body })).toEqual({ status: 200, body: { available: true, ...navigation } });
      expect(f.calls).toEqual([body]);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("refuses unknown fields, missing entry ids, non-boolean summarize, and stale incarnations", async () => {
    const f = fixture();
    try {
      for (const body of [
        { commandId: "unknown", incarnation: session.incarnation, entryId: "entry-2", extra: true },
        { commandId: "missing-entry", incarnation: session.incarnation },
        { commandId: "empty-entry", incarnation: session.incarnation, entryId: "" },
        { commandId: "bad-summarize", incarnation: session.incarnation, entryId: "entry-2", summarize: "yes" },
      ]) {
        expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tree/navigate`, token: f.auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      }
      expect(f.calls).toHaveLength(0);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("real CediaHost tree routes", () => {
  function createFixture(mode?: string) {
    const directory = mkdtempSync(join(tmpdir(), "cedia-tree-host-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Tree fixture" });
    const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
    const commandLog = join(directory, "commands.log");
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: {
        CEDIA_NODE: process.execPath,
        CEDIA_FAKE_COMMAND_LOG: commandLog,
        ...(mode === undefined ? {} : { CEDIA_FAKE_HOST_MODE: mode }),
      },
    });
    const auth = new DeviceAuth(directory);
    const router = createRouter(host, auth);
    const task = host.createSession(project.id, "Tree fixture");
    return { directory, store, host, auth, router, task, commandLog };
  }

  it("answers the live tree, navigates once, and replays the durable receipt", async () => {
    const f = createFixture();
    try {
      expect((await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/tree`, token: f.auth.ownerToken })).body).toMatchObject({ available: false, reason: expect.stringMatching(/No OMP runtime/) });
      await f.host.startSession(f.task.id);
      const controller = f.auth.issue("tree-controller");
      const live = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/tree`, token: controller.token });
      expect(live).toMatchObject({ status: 200, body: { available: true, leafId: "entry-3", pathIds: ["root", "entry-3"], lineage: { parentSession: null, previousSessionFiles: [] } } });
      const incarnation = f.store.getSession(f.task.id)!.incarnation;
      const body = { commandId: "tree-host-navigate", incarnation, entryId: "entry-2", summarize: true };
      const first = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tree/navigate`, token: controller.token, body });
      expect(first).toMatchObject({ status: 200, body: { available: true, moved: true, askReopen: false, summarized: true, leafId: "entry-2" } });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tree/navigate`, token: controller.token, body })).toEqual(first);
      const commands = readFileSync(f.commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string });
      expect(commands.filter(command => command.type === "cedia_control" && command.operation === "tree.get")).toHaveLength(1);
      expect(commands.filter(command => command.type === "cedia_control" && command.operation === "tree.navigate")).toHaveLength(1);
      expect(f.store.getCommand(f.task.id, body.commandId)).toMatchObject({ kind: "cedia_tree_navigate", status: "completed", payload: { entryId: "entry-2", summarize: true }, result: { data: { available: true, moved: true } } });
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("answers unavailable without a runtime and does not create a runtime call", async () => {
    const f = createFixture();
    try {
      const incarnation = f.store.getSession(f.task.id)!.incarnation;
      const read = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/tree`, token: f.auth.ownerToken });
      const body = { commandId: "tree-no-runtime", incarnation, entryId: "entry-2" };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tree/navigate`, token: f.auth.ownerToken, body: { commandId: "tree-stale", incarnation: "old", entryId: "entry-2" } })).toMatchObject({ status: 409, body: { error: { code: "stale_incarnation" } } });
      const navigate = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tree/navigate`, token: f.auth.ownerToken, body });
      expect(read).toMatchObject({ status: 200, body: { available: false, reason: expect.stringMatching(/No OMP runtime/) } });
      expect(navigate).toMatchObject({ status: 200, body: { available: false, reason: expect.stringMatching(/No OMP runtime/) } });
      expect(existsSync(f.commandLog)).toBe(false);
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("surfaces askReopen as a non-move and refuses a command-id payload conflict", async () => {
    const f = createFixture("tree-ask-reopen");
    try {
      await f.host.startSession(f.task.id);
      const incarnation = f.store.getSession(f.task.id)!.incarnation;
      const body = { commandId: "tree-ask-reopen", incarnation, entryId: "entry-2" };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tree/navigate`, token: f.auth.ownerToken, body })).toMatchObject({ status: 200, body: { available: true, moved: false, askReopen: true } });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tree/navigate`, token: f.auth.ownerToken, body: { ...body, entryId: "entry-3" } })).toMatchObject({ status: 409, body: { error: { code: "command_conflict" } } });
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("surfaces the runtime's unknown-entry refusal as a typed 409 and replays it", async () => {
    const f = createFixture("tree-navigate-error");
    try {
      await f.host.startSession(f.task.id);
      const incarnation = f.store.getSession(f.task.id)!.incarnation;
      const body = { commandId: "tree-refused", incarnation, entryId: "missing-entry" };
      const first = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tree/navigate`, token: f.auth.ownerToken, body });
      expect(first).toEqual({ status: 409, body: { error: { code: "omp_refused", message: "Fixture tree entry does not exist" } } });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tree/navigate`, token: f.auth.ownerToken, body })).toEqual(first);
      const commands = readFileSync(f.commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string });
      expect(commands.filter(command => command.type === "cedia_control" && command.operation === "tree.navigate")).toHaveLength(1);
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed runtime answers without coercing them", async () => {
    const getFixture = createFixture("tree-malformed-get");
    const navigateFixture = createFixture("tree-malformed-navigate");
    try {
      await getFixture.host.startSession(getFixture.task.id);
      await navigateFixture.host.startSession(navigateFixture.task.id);
      const get = await getFixture.router({ method: "GET", path: `/v1/sessions/${getFixture.task.id}/tree`, token: getFixture.auth.ownerToken });
      const incarnation = navigateFixture.store.getSession(navigateFixture.task.id)!.incarnation;
      const navigate = await navigateFixture.router({ method: "POST", path: `/v1/sessions/${navigateFixture.task.id}/tree/navigate`, token: navigateFixture.auth.ownerToken, body: { commandId: "tree-malformed", incarnation, entryId: "entry-2" } });
      expect(get).toMatchObject({ status: 502, body: { error: { code: "omp_tree_invalid", message: expect.stringMatching(/labelTruncated/) } } });
      expect(navigate).toMatchObject({ status: 502, body: { error: { code: "omp_tree_invalid", message: expect.stringMatching(/editorImageCount/) } } });
    } finally {
      await getFixture.host.close().catch(() => {});
      await navigateFixture.host.close().catch(() => {});
      getFixture.store.close();
      navigateFixture.store.close();
      rmSync(getFixture.directory, { recursive: true, force: true });
      rmSync(navigateFixture.directory, { recursive: true, force: true });
    }
  });
});
