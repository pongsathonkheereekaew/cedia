import { defaultKeybindingsFile } from "../src/agent-window-keybindings.ts";
import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHostServer } from "../../host/src/server.ts";
import { createAgentHostGateway, createAgentWindowHandler } from "../src/agent-window-main.ts";

let fixtureStateDirCounter = 0;
function fixture() {
  const calls: unknown[] = [];
  const trusted = {};
  // Isolated state: without an explicit dir the handler falls back to the real
  // user state dir, so any previously launched app would leak its theme
  // snapshot into this test. A nonexistent tmp path reads as absent.
  fixtureStateDirCounter += 1;
  const handler = createAgentWindowHandler({
    stateDir: join(tmpdir(), `cedia-test-no-snapshot-${process.pid}-${fixtureStateDirCounter}`),
    authorize: event => event === trusted,
    request: async (method, path, body) => { calls.push({ method, path, body }); return { projects: [] }; },
    ensure: async () => {},
    pickFolder: async () => "/tmp",
    openIde: async input => { calls.push(input); },
    openExternal: async url => { calls.push(url); },
    panel: async (event, surface, method, input) => { calls.push({ surface, method, input }); return { ready: true }; },
    version: "test",
  });
  return { handler, calls, trusted };
}

describe("Agent Window main-process boundary", () => {
  it("scopes native panels to trusted Agent Window senders", async () => {
    const { handler, trusted, calls } = fixture();
    const request = { kind: "panel", surface: "terminal", method: "open", input: { cwd: "/tmp" } };
    await expect(handler({}, request)).rejects.toThrow("Untrusted");
    expect(calls).toHaveLength(0);
    expect(await handler(trusted, request)).toEqual({ ready: true });
    await expect(handler(trusted, { ...request, surface: "arbitrary" })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
  it("shares the existing host and its durable session IDs without an IDE or provider call", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cedia-agent-window-"));
    const stateDir = join(directory, "state");
    const projectPath = join(directory, "project");
    await mkdir(projectPath);
    const server = await startHostServer({ stateDir });
    try {
      // A missing appRoot proves that a healthy shared host is reused instead of launching another.
      const gateway = createAgentHostGateway({ appRoot: join(directory, "missing-app"), parentPid: process.pid, stateDir });
      await Promise.all([gateway.ensure(), gateway.ensure()]);
      const project = await gateway.request("POST", "projects", { id: "project-from-renderer", path: projectPath }) as { id: string };
      const task = await gateway.request("POST", "sessions", { id: "task-from-renderer", projectId: project.id, title: "Shared task" }) as { id: string; status: string };
      expect(project.id).toBe("project-from-renderer");
      expect(task.id).toBe("task-from-renderer");
      expect(task.status).toBe("idle");
      await expect(gateway.request("POST", "sessions", { id: "../escape", projectId: project.id })).rejects.toThrow();
      await expect(gateway.request("POST", "sessions", { id: task.id, projectId: project.id })).rejects.toThrow();
      expect(server.host.store.getSession(task.id)?.title).toBe("Shared task");
      const same = await gateway.request("GET", `sessions/${task.id}`);
      expect(same).toEqual({ ...task, sidechatSourceThreadId: null });
      expect(server.stats().runningSessions).toBe(0);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("reads and writes the workbench keybindings file through the bridge", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cedia-agent-keybindings-"));
    const file = join(dir, "keybindings.json");
    const previous = process.env.CEDIA_KEYBINDINGS_FILE;
    process.env.CEDIA_KEYBINDINGS_FILE = file;
    try {
      const { handler, trusted } = (() => {
        const trustedKey = {};
        const handler = createAgentWindowHandler({
          stateDir: join(tmpdir(), `cedia-test-kb-${process.pid}-${Date.now()}`),
          authorize: event => event === trustedKey,
          request: async () => ({}),
          ensure: async () => {},
          pickFolder: async () => "/tmp",
          openIde: async () => {},
          openExternal: async () => {},
        });
        return { handler, trusted: trustedKey };
      })();
      expect(defaultKeybindingsFile("darwin", "/Users/t")).toContain("Cedia/User/keybindings.json");
      await expect(handler(trusted, { kind: "keybindings", action: "read", file: join(dir, "elsewhere.json") })).rejects.toThrow("owned by the workbench");
      await expect(handler({}, { kind: "keybindings", action: "read" })).rejects.toThrow("Untrusted");
      await expect(handler(trusted, { kind: "keybindings", action: "flip", file })).rejects.toThrow("Unsupported keybindings action");
      // Direction 1: agent-window write lands in the owned file.
      const written = await handler(trusted, { kind: "keybindings", action: "write", file, rule: { key: "mod+shift+n", command: "chat.new" } }) as { keybindings: unknown[]; issues: unknown[] };
      expect(written.keybindings).toHaveLength(1);
      expect(written.issues).toEqual([]);
      // Direction 2: a workbench-side edit of the same file reads back through the bridge.
      const raw = JSON.parse(readFileSync(file, "utf8")) as unknown[];
      raw.push({ key: "mod+k", command: "sidebar.search", when: "!terminalFocus" });
      writeFileSync(file, JSON.stringify(raw, null, 4));
      const read = await handler(trusted, { kind: "keybindings", action: "read", file }) as { keybindings: { command: string }[]; issues: unknown[] };
      expect(read.keybindings.map(row => row.command)).toEqual(["chat.new", "sidebar.search"]);
      expect(read.issues).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.CEDIA_KEYBINDINGS_FILE;
      else process.env.CEDIA_KEYBINDINGS_FILE = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("rejects an unregistered renderer before dispatching anything", async () => {
    const { handler, calls } = fixture();
    await expect(handler({}, { kind: "request", method: "GET", path: "/v1/projects" })).rejects.toThrow("Untrusted");
    expect(calls).toEqual([]);
  });

  it("proxies task operations without giving the renderer a host credential", async () => {
    const { handler, calls, trusted } = fixture();
    expect(await handler(trusted, { kind: "request", method: "GET", path: "/v1/sessions?projectId=abc" })).toEqual({ projects: [] });
    expect(calls).toEqual([{ method: "GET", path: "sessions?projectId=abc", body: undefined }]);
    const bootstrap = await handler(trusted, { kind: "bootstrap" });
    expect(bootstrap).toMatchObject({ version: "test" });
    expect(JSON.stringify(bootstrap)).not.toContain("token");
    expect(await handler(trusted, { kind: "theme" })).toBeNull();
  });

  it("refuses URL escapes, credential management and editor impersonation", async () => {
    const { handler, calls, trusted } = fixture();
    for (const path of ["https://evil.test/v1/projects", "//evil.test/v1/projects", "/v1/sessions/../devices", "/v1/sessions/%2e%2e/devices", "/v1/sessions/%2fdevices", "/v1/devices", "/v1/remote/pair", "/v1/editors/spoof", "/v1/health#fragment"]) {
      await expect(handler(trusted, { kind: "request", method: "GET", path })).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });

  it("routes an IDE request with the selected workspace and file", async () => {
    const { handler, calls, trusted } = fixture();
    await handler(trusted, { kind: "openIde", cwd: "/tmp/project", path: "src/index.ts", line: 12 });
    expect(calls).toEqual([{ cwd: "/tmp/project", path: "/tmp/project/src/index.ts", line: 12 }]);
    await expect(handler(trusted, { kind: "openIde", cwd: "/tmp/project", path: "../secret" })).rejects.toThrow();
  });

  it("allows only web links to leave the application", async () => {
    const { handler, calls, trusted } = fixture();
    await handler(trusted, { kind: "openExternal", url: "https://example.com/help" });
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "vscode://danger"]) {
      await expect(handler(trusted, { kind: "openExternal", url })).rejects.toThrow();
    }
    expect(calls).toEqual(["https://example.com/help"]);
  });

  it("keeps native zoom behind the authenticated Agent Window boundary", async () => {
    const { trusted } = fixture();
    let action: string | undefined;
    const handler = createAgentWindowHandler({
      authorize: event => event === trusted,
      request: async () => ({}),
      ensure: async () => {},
      pickFolder: async () => null,
      openIde: async () => {},
      openExternal: async () => {},
      getZoomFactor: () => 1.2,
      zoom: (_event, next) => { action = next; return next === "reset" ? 1 : 1.2; },
    });

    expect(await handler(trusted, { kind: "getZoomFactor" })).toBe(1.2);
    expect(await handler(trusted, { kind: "zoom", action: "in" })).toBe(1.2);
    expect(action).toBe("in");
    await expect(handler(trusted, { kind: "zoom", action: "sideways" })).rejects.toThrow("Invalid desktop zoom action");
    await expect(handler({}, { kind: "getZoomFactor" })).rejects.toThrow("Untrusted");
  });
});
