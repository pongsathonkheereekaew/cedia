import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
  NO_OMP_EXTENSIONS_BRIDGE_REASON,
  NO_OMP_EXTENSIONS_RUNTIME_REASON,
  OmpExtensions,
  OmpExtensionsValidationError,
  parseOmpExtensionsData,
} from "../src/omp-management.ts";
import {
  NO_OMP_TOOL_CATALOG_BRIDGE_REASON,
  NO_OMP_TOOL_CATALOG_RUNTIME_REASON,
  OmpToolCatalog,
  OmpToolCatalogValidationError,
  parseOmpToolActiveSetSnapshot,
  parseOmpToolCatalogData,
  refreshOmpSkills,
  setOmpActiveTools,
  type OmpToolCatalogData,
} from "../src/omp-management.ts";
import {
  NO_OMP_CODE_MODE_BRIDGE_REASON,
  NO_OMP_CODE_MODE_RUNTIME_REASON,
  OmpCodeMode,
  OmpCodeModeValidationError,
  parseOmpCodeModeData,
} from "../src/omp-management.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const catalog: OmpToolCatalogData = {
  tools: [
    { name: "read", description: "Read a file", descriptionTruncated: false, source: "builtin", active: true },
    { name: "mcp__github_get_issue", description: "Fetch an issue", descriptionTruncated: false, source: "mcp", active: true },
    { name: "custom-widget", description: "Extension widget", descriptionTruncated: false, source: "extension", active: false },
  ],
  truncated: false,
  total: 3,
  activeCount: 2,
};

function controlResponse(operation: string, result: unknown) {
  return { data: { operation, capabilityRevision: "cap-tools-1", result } };
}

describe("OMP tool catalog projection", () => {
  it("strictly parses catalog rows without flattening activation state", () => {
    expect(parseOmpToolCatalogData(catalog)).toEqual(catalog);
    expect(() => parseOmpToolCatalogData({ ...catalog, tools: [{ ...catalog.tools[0], source: "future" }] })).toThrow(OmpToolCatalogValidationError);
    expect(() => parseOmpToolCatalogData({ ...catalog, tools: [{ ...catalog.tools[0], active: "yes" }] })).toThrow(/active/);
    expect(() => parseOmpToolCatalogData({ ...catalog, tools: [catalog.tools[0], catalog.tools[0]] })).toThrow(/duplicate/);
    expect(() => parseOmpToolCatalogData({ ...catalog, extra: true })).toThrow(/unknown field/);
    expect(() => parseOmpToolCatalogData({ ...catalog, total: -1 })).toThrow(/total/);
  });

  it("reads through the negotiated cedia_control bridge", async () => {
    const calls: { operation: string }[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push({ operation: String(request.operation) });
        return controlResponse(String(request.operation), catalog);
      },
    };
    const state = new OmpToolCatalog({ client });
    expect(await state.refresh()).toEqual({ state: "available", ...catalog });
    expect(calls).toEqual([{ operation: "tools.catalog.get" }]);
  });

  it("writes the enabled set through tools.active.set and parses the catalog that follows", async () => {
    const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push(request as { operation: string; payload?: Record<string, unknown> });
        const names = ((request.payload as Record<string, unknown>).toolNames as string[]);
        return controlResponse("tools.active.set", {
          tools: catalog.tools.map(tool => ({ ...tool, active: names.includes(tool.name) })),
          truncated: false,
          total: 3,
          activeCount: names.length,
        });
      },
    };
    const result = await setOmpActiveTools(client, ["read"]);
    expect(calls).toEqual([{ operation: "tools.active.set", payload: { toolNames: ["read"] } }]);
    expect(result).toMatchObject({ total: 3, activeCount: 1 });
    expect(result?.tools.find(tool => tool.name === "read")?.active).toBe(true);
    expect(result?.tools.find(tool => tool.name === "custom-widget")?.active).toBe(false);
    await expect(setOmpActiveTools(client, [""])).rejects.toThrow(OmpToolCatalogValidationError);
    expect(parseOmpToolActiveSetSnapshot({ available: true, ...catalog })).toEqual({ available: true, ...catalog });
    expect(parseOmpToolActiveSetSnapshot({ available: false, reason: "no runtime" })).toEqual({ available: false, reason: "no runtime" });
    expect(() => parseOmpToolActiveSetSnapshot({ available: true, ...catalog, extra: true })).toThrow(/unknown field/);
  });

  it("refreshes skills through tools.refresh-skills and parses the catalog that follows", async () => {
    const calls: { operation: string; payload?: Record<string, unknown> }[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push(request as { operation: string; payload?: Record<string, unknown> });
        return controlResponse("tools.refresh-skills", catalog);
      },
    };
    expect(await refreshOmpSkills(client)).toEqual(catalog);
    expect(calls).toEqual([{ operation: "tools.refresh-skills" }]);
    const state = new OmpToolCatalog({ client });
    expect(await state.refreshSkills()).toEqual(catalog);
  });

  it("reports missing runtime and bridge without probing either one", async () => {
    let requests = 0;
    const stopped = new OmpToolCatalog({
      client: {
        phase: "closed",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
      },
    });
    expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_TOOL_CATALOG_RUNTIME_REASON });
    const absent = new OmpToolCatalog({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
      },
    });
    expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_TOOL_CATALOG_BRIDGE_REASON });
    expect(requests).toBe(0);
  });
});

describe("OMP Code Mode partition projection", () => {
  const OFF = { active: false, directToolNames: null, preludes: [{ name: "browser", enabled: true }] };

  it("strictly parses names and flags without prelude sources", () => {
    expect(parseOmpCodeModeData({
      active: true,
      directToolNames: ["read", "glob"],
      preludes: [{ name: "browser", enabled: true }, { name: "computer", enabled: false }],
    })).toEqual({
      active: true,
      directToolNames: ["read", "glob"],
      preludes: [{ name: "browser", enabled: true }, { name: "computer", enabled: false }],
    });
    expect(parseOmpCodeModeData(OFF)).toEqual(OFF);
    expect(() => parseOmpCodeModeData({ ...OFF, active: "yes" })).toThrow(OmpCodeModeValidationError);
    expect(() => parseOmpCodeModeData({ ...OFF, directToolNames: ["read", 7] })).toThrow(OmpCodeModeValidationError);
    expect(() => parseOmpCodeModeData({ ...OFF, preludes: [{ name: "browser" }] })).toThrow(OmpCodeModeValidationError);
    expect(() => parseOmpCodeModeData({ active: false })).toThrow(/directToolNames/);
    expect(() => parseOmpCodeModeData({ active: false, directToolNames: null })).toThrow(/preludes/);
    expect(() => parseOmpCodeModeData({ ...OFF, javascript: "x = 1" })).toThrow(/unknown field/);
  });

  it("reads through the negotiated cedia_control bridge", async () => {
    const calls: { operation: string }[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push({ operation: String(request.operation) });
        return controlResponse(String(request.operation), OFF);
      },
    };
    const state = new OmpCodeMode({ client });
    expect(await state.refresh()).toEqual({ state: "available", ...OFF });
    expect(calls).toEqual([{ operation: "tools.codemode.get" }]);
  });

  it("reports missing runtime and bridge without probing either one", async () => {
    let requests = 0;
    const stopped = new OmpCodeMode({
      client: {
        phase: "closed",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
      },
    });
    expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_CODE_MODE_RUNTIME_REASON });
    const absent = new OmpCodeMode({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
      },
    });
    expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_CODE_MODE_BRIDGE_REASON });
    expect(requests).toBe(0);
  });
});

describe("controller-visible authenticated OMP tool Code Mode route", () => {
  const session = {
    id: "codemode-session",
    projectId: "project-1",
    title: "Code Mode task",
    cwd: "/tmp/codemode-project",
    sessionFile: "/tmp/codemode-session.jsonl",
    incarnation: "inc-codemode-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-codemode-route-"));
    const auth = new DeviceAuth(directory);
    const mode = { available: true as const, active: false, directToolNames: null, preludes: [{ name: "browser", enabled: true }] };
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      toolCodeModeSnapshot: async () => mode,
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth), mode };
  }

  it("answers the partition to a paired controller and refuses query/body/method fields", async () => {
    const f = fixture();
    const controller = f.auth.issue("codemode-controller");
    try {
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/codemode`, token: controller.token })).toEqual({ status: 200, body: f.mode });
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/codemode?debug=1`, token: controller.token })).toMatchObject({ status: 400 });
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/codemode`, token: controller.token, body: { extra: true } })).toMatchObject({ status: 400 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/codemode`, token: controller.token })).toMatchObject({ status: 405 });
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("OMP extension catalog projection", () => {
  const ROWS = {
    roots: { explicit: [], mode: "merge", configured: ["/tmp/p"], configuredLevel: "project" },
    extensions: [
      { id: "mcp:echo", kind: "mcp", name: "echo", displayName: "echo", description: "Echo", descriptionTruncated: false, path: "/tmp/p/.omp/mcp.json", source: { provider: "mcp", providerName: "MCP", level: "project" }, state: "active" },
      { id: "skill:helper", kind: "skill", name: "helper", displayName: "helper", description: "Help", descriptionTruncated: false, path: "/tmp/p/.omp/skills", source: { provider: "local", providerName: "Local", level: "project" }, state: "disabled", disabledReason: "item-disabled" },
    ],
    truncated: false,
    total: 2,
  };

  it("strictly parses records, roots, and states without the raw discovery bag", () => {
    expect(parseOmpExtensionsData(ROWS)).toEqual(ROWS);
    expect(() => parseOmpExtensionsData({ ...ROWS, extensions: [{ ...ROWS.extensions[0], state: "vibing" }] })).toThrow(OmpExtensionsValidationError);
    expect(() => parseOmpExtensionsData({ ...ROWS, extensions: [{ ...ROWS.extensions[0], raw: {} }] })).toThrow(/unknown field/);
    expect(() => parseOmpExtensionsData({ ...ROWS, extensions: [{ ...ROWS.extensions[0], source: { provider: "mcp" } }] })).toThrow(OmpExtensionsValidationError);
    expect(() => parseOmpExtensionsData({ ...ROWS, roots: { ...ROWS.roots, configuredLevel: "everywhere" } })).toThrow(OmpExtensionsValidationError);
    expect(() => parseOmpExtensionsData({ ...ROWS, extensions: [{ ...ROWS.extensions[0], id: "mcp:echo" }, { ...ROWS.extensions[0], id: "mcp:echo" }] })).toThrow(/duplicate/);
    expect(() => parseOmpExtensionsData({ ...ROWS, total: -1 })).toThrow(OmpExtensionsValidationError);
  });

  it("reads through the negotiated cedia_control bridge", async () => {
    const calls: { operation: string }[] = [];
    const client = {
      phase: "ready" as const,
      readyFrame: { cediaCapabilitiesVersion: 1 },
      requestCedia: async (_command: "cedia_control", request: Record<string, unknown>) => {
        calls.push({ operation: String(request.operation) });
        return { data: { operation: String(request.operation), capabilityRevision: "cap-ext-1", result: ROWS } };
      },
    };
    const state = new OmpExtensions({ client });
    expect(await state.refresh()).toEqual({ state: "available", ...ROWS });
    expect(calls).toEqual([{ operation: "extensions.list" }]);
  });

  it("reports missing runtime and bridge without probing either one", async () => {
    let requests = 0;
    const stopped = new OmpExtensions({
      client: {
        phase: "closed",
        readyFrame: { cediaCapabilitiesVersion: 1 },
        requestCedia: async () => { requests += 1; throw new Error("must not probe stopped runtime"); },
      },
    });
    expect(await stopped.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_EXTENSIONS_RUNTIME_REASON });
    const absent = new OmpExtensions({
      client: {
        phase: "ready",
        readyFrame: {},
        requestCedia: async () => { requests += 1; throw new Error("must not probe absent bridge"); },
      },
    });
    expect(await absent.refresh()).toEqual({ state: "unavailable", reason: NO_OMP_EXTENSIONS_BRIDGE_REASON });
    expect(requests).toBe(0);
  });
});

describe("controller-visible authenticated OMP extension catalog route", () => {
  const session = {
    id: "extensions-session",
    projectId: "project-1",
    title: "Extensions task",
    cwd: "/tmp/extensions-project",
    sessionFile: "/tmp/extensions-session.jsonl",
    incarnation: "inc-extensions-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-extensions-route-"));
    const auth = new DeviceAuth(directory);
    const mode = { available: true as const, roots: { explicit: [], mode: "merge", configured: [], configuredLevel: "user" }, extensions: [], truncated: false, total: 0 };
    const setCalls: unknown[] = [];
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      toolExtensionsSnapshot: async () => mode,
      toolsExtensionSet: async (_id: string, _device: string, request: unknown) => { setCalls.push(request); return mode; },
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth), mode, setCalls };
    return { directory, auth, router: createRouter(host, auth), mode };
  }

  it("answers the catalog to a paired controller and refuses query/body/method fields", async () => {
    const f = fixture();
    const controller = f.auth.issue("extensions-controller");
    try {
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/extensions`, token: controller.token })).toEqual({ status: 200, body: f.mode });
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/extensions?debug=1`, token: controller.token })).toMatchObject({ status: 400 });
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/extensions`, token: controller.token, body: { extra: true } })).toMatchObject({ status: 400 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/extensions`, token: controller.token })).toMatchObject({ status: 405 });
      const setBody = { commandId: "ext-set-1", incarnation: session.incarnation, id: "mcp:echo", enabled: false };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/extensions/set`, token: controller.token, body: setBody })).toMatchObject({ status: 403 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/extensions/set`, token: f.auth.ownerToken, body: setBody })).toEqual({ status: 200, body: f.mode });
      expect(f.setCalls).toEqual([setBody]);
      for (const body of [
        { commandId: "bad-1", incarnation: session.incarnation, id: "", enabled: false },
        { commandId: "bad-2", incarnation: session.incarnation, id: "mcp:echo", enabled: "no" },
        { commandId: "bad-3", incarnation: session.incarnation, id: "mcp:echo" },
        { commandId: "bad-4", incarnation: session.incarnation, id: "mcp:echo", enabled: false, extra: true },
      ]) {
        expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/extensions/set`, token: f.auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      }
      expect(f.setCalls).toHaveLength(1);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("controller-visible authenticated OMP tool catalog route", () => {
  const session = {
    id: "tools-session",
    projectId: "project-1",
    title: "Tools task",
    cwd: "/tmp/tools-project",
    sessionFile: "/tmp/tools-session.jsonl",
    incarnation: "inc-tools-1",
    status: "idle" as const,
    archived: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-tools-route-"));
    const auth = new DeviceAuth(directory);
    const activeCalls: Record<string, unknown>[] = [];
    const refreshCalls: Record<string, unknown>[] = [];
    const host = {
      store: { getSession: (id: string) => id === session.id ? session : undefined },
      toolCatalogSnapshot: async () => ({ available: true as const, ...catalog }),
      toolsActiveSet: async (_id: string, _deviceId: string, request: Record<string, unknown>) => {
        activeCalls.push(request);
        return { available: true as const, ...catalog };
      },
      toolsRefreshSkills: async (_id: string, _deviceId: string, request: Record<string, unknown>) => {
        refreshCalls.push(request);
        return { available: true as const, ...catalog };
      },
    } as unknown as CediaHost;
    return { directory, auth, router: createRouter(host, auth), activeCalls, refreshCalls };
  }

  it("answers the catalog to a paired controller and refuses query/body fields", async () => {
    const f = fixture();
    const controller = f.auth.issue("tools-controller");
    try {
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller.token })).toEqual({ status: 200, body: { available: true, ...catalog } });
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog?debug=1`, token: controller.token })).toMatchObject({ status: 400 });
      expect(await f.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller.token, body: { extra: true } })).toMatchObject({ status: 400 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller.token })).toMatchObject({ status: 405 });
      const setBody = { commandId: "tools-active-1", incarnation: session.incarnation, toolNames: ["read"] };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/active`, token: f.auth.ownerToken, body: setBody })).toEqual({ status: 200, body: { available: true, ...catalog } });
      expect(f.activeCalls).toEqual([setBody]);
      // A paired controller may read but never write the enabled set.
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/active`, token: controller.token, body: setBody })).toMatchObject({ status: 403 });
      for (const body of [
        { commandId: "bad-1", incarnation: session.incarnation, toolNames: "read" },
        { commandId: "bad-2", incarnation: session.incarnation, toolNames: [""] },
        { commandId: "bad-3", incarnation: session.incarnation, toolNames: ["read"], extra: true },
        { commandId: "bad-4", incarnation: session.incarnation },
      ]) {
        expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/active`, token: f.auth.ownerToken, body })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      }
      expect(f.activeCalls).toHaveLength(1);
      const refreshBody = { commandId: "tools-refresh-1", incarnation: session.incarnation };
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/refresh-skills`, token: f.auth.ownerToken, body: refreshBody })).toEqual({ status: 200, body: { available: true, ...catalog } });
      expect(f.refreshCalls).toEqual([refreshBody]);
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/refresh-skills`, token: controller.token, body: refreshBody })).toMatchObject({ status: 403 });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${session.id}/tools/refresh-skills`, token: f.auth.ownerToken, body: { ...refreshBody, extra: true } })).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
      expect(f.refreshCalls).toHaveLength(1);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("real CediaHost Code Mode route", () => {
  function createFixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-codemode-host-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Code Mode fixture" });
    const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: { CEDIA_NODE: process.execPath },
    });
    const auth = new DeviceAuth(directory);
    const router = createRouter(host, auth);
    const task = host.createSession(project.id, "Code Mode fixture");
    return { directory, store, host, auth, router, task };
  }

  it("reads the live partition once the session starts", async () => {
    const f = createFixture();
    try {
      expect((await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/tools/codemode`, token: f.auth.ownerToken })).body).toMatchObject({ available: false, reason: expect.stringMatching(/No OMP runtime/) });
      await f.host.startSession(f.task.id);
      const controller = f.auth.issue("codemode-controller");
      const live = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/tools/codemode`, token: controller.token });
      expect(live).toMatchObject({
        status: 200,
        body: { available: true, active: false, directToolNames: null, preludes: [{ name: "browser", enabled: true }] },
      });
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("real CediaHost extension catalog route", () => {
  function createFixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-extensions-host-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Extensions fixture" });
    const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: { CEDIA_NODE: process.execPath },
    });
    const auth = new DeviceAuth(directory);
    const router = createRouter(host, auth);
    const task = host.createSession(project.id, "Extensions fixture");
    return { directory, store, host, auth, router, task };
  }

  it("reads the live catalog once the session starts", async () => {
    const f = createFixture();
    try {
      expect((await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/tools/extensions`, token: f.auth.ownerToken })).body).toMatchObject({ available: false, reason: expect.stringMatching(/No OMP runtime/) });
      await f.host.startSession(f.task.id);
      const controller = f.auth.issue("extensions-controller");
      const live = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/tools/extensions`, token: controller.token });
      expect(live).toMatchObject({
        status: 200,
        body: {
          available: true,
          roots: { mode: "merge", configuredLevel: "project" },
          extensions: [{ id: "mcp:fixture-echo", kind: "mcp", state: "active" }],
          total: 1,
        },
      });
      const incarnation = f.store.getSession(f.task.id)!.incarnation;
      const setBody = { commandId: "ext-live-set", incarnation, id: "mcp:fixture-echo", enabled: false };
      const toggled = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tools/extensions/set`, token: f.auth.ownerToken, body: setBody });
      expect(toggled).toMatchObject({ status: 200, body: { available: true, extensions: [{ id: "mcp:fixture-echo", state: "disabled" }] } });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tools/extensions/set`, token: f.auth.ownerToken, body: setBody })).toEqual(toggled);
      const reenabled = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tools/extensions/set`, token: f.auth.ownerToken, body: { commandId: "ext-live-reset", incarnation, id: "mcp:fixture-echo", enabled: true } });
      expect(reenabled).toMatchObject({ status: 200, body: { available: true, extensions: [{ id: "mcp:fixture-echo", state: "active" }] } });
      const refused = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tools/extensions/set`, token: f.auth.ownerToken, body: { commandId: "ext-live-missing", incarnation, id: "mcp:missing", enabled: false } });
      expect(refused).toMatchObject({ status: 200, body: { available: false, reason: expect.stringMatching(/Unknown extension/) } });
    } finally {
      await f.host.close().catch(() => {});
      f.store.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});

describe("real CediaHost tool routes", () => {
  function createFixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-tools-host-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Tools fixture" });
    const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: {
        CEDIA_NODE: process.execPath,
      },
    });
    const auth = new DeviceAuth(directory);
    const router = createRouter(host, auth);
    const task = host.createSession(project.id, "Tools fixture");
    return { directory, store, host, auth, router, task };
  }

  it("reads the live catalog, writes the enabled set once, and replays the durable receipt", async () => {
    const f = createFixture();
    try {
      const controller = f.auth.issue("tools-controller");
      expect((await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/tools/catalog`, token: controller.token })).body).toMatchObject({ available: false, reason: expect.stringMatching(/No OMP runtime/) });
      await f.host.startSession(f.task.id);
      const live = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/tools/catalog`, token: controller.token });
      expect(live).toMatchObject({ status: 200, body: { available: true, total: 3, activeCount: 2 } });
      const incarnation = f.store.getSession(f.task.id)!.incarnation;
      const body = { commandId: "tools-host-active", incarnation, toolNames: ["read"] };
      const first = await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tools/active`, token: f.auth.ownerToken, body });
      expect(first).toMatchObject({ status: 200, body: { available: true, total: 3, activeCount: 1 } });
      expect(first.body).toMatchObject({ tools: expect.arrayContaining([expect.objectContaining({ name: "write", active: false })]) });
      expect(await f.router({ method: "POST", path: `/v1/sessions/${f.task.id}/tools/active`, token: f.auth.ownerToken, body })).toEqual(first);
      const stale = await f.router({
        method: "POST",
        path: `/v1/sessions/${f.task.id}/tools/active`,
        token: f.auth.ownerToken,
        body: { commandId: "tools-host-stale", incarnation: "incarnation-from-another-run", toolNames: ["read"] },
      });
      expect(stale.status).toBe(409);
      const refreshed = await f.router({ method: "GET", path: `/v1/sessions/${f.task.id}/tools/catalog`, token: controller.token });
      expect(refreshed.body).toMatchObject({ available: true, activeCount: 1 });
      const refreshFirst = await f.router({
        method: "POST",
        path: `/v1/sessions/${f.task.id}/tools/refresh-skills`,
        token: f.auth.ownerToken,
        body: { commandId: "tools-host-refresh", incarnation },
      });
      expect(refreshFirst).toMatchObject({ status: 200, body: { available: true, total: 3 } });
      expect(await f.router({
        method: "POST",
        path: `/v1/sessions/${f.task.id}/tools/refresh-skills`,
        token: f.auth.ownerToken,
        body: { commandId: "tools-host-refresh", incarnation },
      })).toEqual(refreshFirst);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});
