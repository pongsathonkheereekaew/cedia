import { defaultKeybindingsFile } from "../src/agent-window-keybindings.ts";
import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHostServer } from "../../host/src/server.ts";
import { HostHttpError } from "../src/api.ts";
import { agentUiStateDir, importLegacyExtensionDrafts, legacyDraftMigrationFromExtensionState, readAgentUiState, writeAgentUiState } from "../src/agent-ui-state.ts";
import { createAgentHostGateway, createAgentWindowHandler, parseAgentHostRequestTimeoutMs } from "../src/agent-window-main.ts";
import { forgeReviewDraftId } from "../agent-window/src/forge-review-context.ts";

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
  it("keeps the normal host request deadline and bounds explicit overrides", () => {
    expect(parseAgentHostRequestTimeoutMs(undefined)).toBe(30_000);
    expect(parseAgentHostRequestTimeoutMs("180000")).toBe(180_000);
    expect(() => parseAgentHostRequestTimeoutMs("0")).toThrow(/1 to 300000/);
    expect(() => parseAgentHostRequestTimeoutMs("300001")).toThrow(/1 to 300000/);
  });

  it("scopes native panels to trusted Agent Window senders", async () => {
    const { handler, trusted, calls } = fixture();
    const request = { kind: "panel", surface: "terminal", method: "open", input: { cwd: "/tmp" } };
    await expect(handler({}, request)).rejects.toThrow("Untrusted");
    expect(calls).toHaveLength(0);
    expect(await handler(trusted, request)).toEqual({ ready: true });
    await expect(handler(trusted, { ...request, surface: "arbitrary" })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
  it("finds a host this process never talked to, so a quit stops it instead of guessing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cedia-agent-window-peek-"));
    const stateDir = join(directory, "state");
    const server = await startHostServer({ stateDir });
    try {
      // No `ensure()`: the main process has no client yet, which is the packaged case where the
      // window's host traffic goes through another client. The read-only probe must still see it.
      const gateway = createAgentHostGateway({ appRoot: join(directory, "missing-app"), parentPid: process.pid, stateDir });
      expect(await gateway.peek()).toMatchObject({ phase: "ready", accepting: true });
      expect(await gateway.quit()).toMatchObject({ accepted: true });
    } finally {
      await server.close();
    }
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
      expect(await gateway.capabilities()).toMatchObject({ protocolVersion: 1, capabilities: expect.any(Array) });
      expect(await gateway.lifecycleStatus()).toMatchObject({ phase: "ready", accepting: true });
      const trusted = {};
      const bridge = createAgentWindowHandler({
        stateDir,
        authorize: event => event === trusted,
        ensure: gateway.ensure,
        request: gateway.request,
        pickFolder: async () => "/tmp",
        openIde: async () => {},
        openExternal: async () => {},
      });
      expect(await bridge(trusted, { kind: "request", method: "GET", path: "/v1/capabilities" })).toMatchObject({ capabilities: expect.any(Array) });
      expect(await bridge(trusted, { kind: "request", method: "GET", path: "/v1/lifecycle" })).toMatchObject({ phase: "ready", accepting: true });
      await expect(bridge(trusted, { kind: "request", method: "GET", path: "/v1/not-allowlisted" })).rejects.toThrow("Unsupported application route");
      // A typed host refusal travels as a tagged message: Electron's IPC keeps only the message,
      // so the renderer would otherwise receive an anonymous error with no code to act on.
      await expect(bridge(trusted, { kind: "request", method: "POST", path: "/v1/sessions", body: { projectId: "missing-project" } }))
        .rejects.toThrow("[cedia-code:not_found] Project not found");
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
  it("imports an app-side draft file into the real host with its source label", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cedia-agent-window-draft-import-"));
    const stateDir = join(directory, "state");
    const server = await startHostServer({ stateDir });
    const trusted = {};
    const gateway = createAgentHostGateway({ appRoot: join(directory, "missing-app"), parentPid: process.pid, stateDir });
    const bridge = createAgentWindowHandler({
      stateDir,
      authorize: event => event === trusted,
      ensure: gateway.ensure,
      request: gateway.request,
      pickFolder: async () => null,
      openIde: async () => {},
      openExternal: async () => {},
    });
    const legacy = { draft: { prompt: "recover this unsent text" }, draftThread: { projectId: "project-1" } };
    try {
      await writeAgentUiState(agentUiStateDir(stateDir), "draft:task-legacy", legacy);

      expect(await bridge(trusted, { kind: "uiDraft", action: "read", threadId: "task-legacy" }))
        .toEqual({ revision: 1, payload: legacy });
      const owner = server.auth.list().find(device => device.role === "owner");
      expect(owner).toBeDefined();
      expect(server.host.store.readDraft(owner!.id, "task-legacy"))
        .toMatchObject({ revision: 1, text: "recover this unsent text", content: legacy, source: "agent-ui-import" });
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("preserves a conflicting cedia.drafts copy as a labeled, recoverable host draft", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cedia-legacy-drafts-"));
    const stateDir = join(directory, "state");
    let server = await startHostServer({ stateDir });
    const trusted = {};
    const gateway = createAgentHostGateway({ appRoot: join(directory, "missing-app"), parentPid: process.pid, stateDir });
    const extensionDraft = "older extension composer text";
    const state = new Map<string, unknown>([["cedia.drafts", { "task-legacy": extensionDraft }]]);
    const extensionState = {
      get<T>(key: string): T | undefined { return state.get(key) as T | undefined; },
      async update(key: string, value: unknown): Promise<void> { state.set(key, value); },
    };
    const bridge = createAgentWindowHandler({
      stateDir,
      authorize: event => event === trusted,
      ensure: gateway.ensure,
      request: gateway.request,
      pickFolder: async () => null,
      openIde: async () => {},
      openExternal: async () => {},
    });
    const appDraft = { draft: { prompt: "newer app-side text" }, draftThread: { projectId: "project-1" } };
    try {
      await importLegacyExtensionDrafts(
        (method, path, body) => gateway.request(method, path, body),
        legacyDraftMigrationFromExtensionState(extensionState),
      );
      await writeAgentUiState(agentUiStateDir(stateDir), "draft:task-legacy", appDraft);

      expect(await bridge(trusted, { kind: "uiDraft", action: "read", threadId: "task-legacy" }))
        .toEqual({ revision: 1, payload: appDraft });
      const owner = server.auth.list().find(device => device.role === "owner");
      expect(owner).toBeDefined();
      expect(server.host.store.readDraft(owner!.id, "task-legacy"))
        .toMatchObject({ text: "newer app-side text", source: "agent-ui-import" });
      const marker = state.get("cedia.drafts.migration") as { version: number; importedIds: string[] };
      expect(marker).toEqual({ version: 1, importedIds: [expect.any(String)] });
      expect(state.get("cedia.drafts")).toEqual({ "task-legacy": extensionDraft });
      expect(server.host.store.readDraft(owner!.id, marker.importedIds[0]!))
        .toMatchObject({ text: extensionDraft, source: "cedia.drafts", content: { draft: { prompt: extensionDraft } } });

      await bridge(trusted, { kind: "uiDraft", action: "read", threadId: "task-legacy" });
      expect(state.get("cedia.drafts.migration")).toEqual(marker);

      await server.close();
      server = await startHostServer({ stateDir });
      const restartedGateway = createAgentHostGateway({ appRoot: join(directory, "missing-app"), parentPid: process.pid, stateDir });
      const afterRestart = createAgentWindowHandler({
        stateDir,
        authorize: event => event === trusted,
        ensure: restartedGateway.ensure,
        request: restartedGateway.request,
        pickFolder: async () => null,
        openIde: async () => {},
        openExternal: async () => {},
      });
      const restartedOwner = server.auth.list().find(device => device.role === "owner");
      expect(restartedOwner).toBeDefined();
      expect(await afterRestart(trusted, { kind: "uiDraft", action: "read", threadId: "task-legacy" }))
        .toEqual({ revision: 1, payload: appDraft });
      expect(server.host.store.readDraft(restartedOwner!.id, marker.importedIds[0]!))
        .toMatchObject({ text: extensionDraft, source: "cedia.drafts" });
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("preserves an app-side draft file when the host already has a different draft", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cedia-host-draft-conflict-"));
    const stateDir = join(directory, "state");
    const server = await startHostServer({ stateDir });
    const gateway = createAgentHostGateway({ appRoot: join(directory, "missing-app"), parentPid: process.pid, stateDir });
    const trusted = {};
    const bridge = createAgentWindowHandler({
      stateDir,
      authorize: event => event === trusted,
      ensure: gateway.ensure,
      request: gateway.request,
      pickFolder: async () => null,
      openIde: async () => {},
      openExternal: async () => {},
    });
    const hostDraft = { draft: { prompt: "host revision" }, draftThread: { projectId: "project-1" } };
    const oldAppDraft = { draft: { prompt: "recoverable local revision" }, draftThread: { projectId: "project-1" } };
    try {
      await gateway.request("PATCH", "drafts/task-conflict", { expectedRevision: 0, text: "host revision", content: hostDraft });
      await writeAgentUiState(agentUiStateDir(stateDir), "draft:task-conflict", oldAppDraft);

      expect(await bridge(trusted, { kind: "uiDraft", action: "read", threadId: "task-conflict" }))
        .toEqual({ revision: 1, payload: hostDraft });
      const owner = server.auth.list().find(device => device.role === "owner");
      expect(owner).toBeDefined();
      const marker = await readAgentUiState(agentUiStateDir(stateDir), "draft-import:task-conflict") as { draftId?: unknown } | null;
      expect(typeof marker?.draftId).toBe("string");
      expect(server.host.store.readDraft(owner!.id, marker!.draftId as string))
        .toMatchObject({ text: "recoverable local revision", source: "agent-ui-import-conflict", content: oldAppDraft });
      expect(await readAgentUiState(agentUiStateDir(stateDir), "draft:task-conflict")).toEqual(hostDraft);
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

  it("allowlists the read-only Forge Review routes without opening a broad provider root", async () => {
    const { handler, calls, trusted } = fixture();
    const longDraftId = forgeReviewDraftId({
      projectId: "project-1",
      provider: "github",
      hostname: "github.example.test",
      repositoryPath: "acme/a-repository-with-a-long-name_and-a-slash/for-route-coverage",
      number: 42,
    });
    expect(longDraftId.length).toBeGreaterThan(128);
    expect(longDraftId.length).toBeLessThanOrEqual(480);
    const requests = [
      { method: "GET", path: "/v1/forge-review/capabilities" },
      { method: "POST", path: "/v1/forge-review/list", body: { projectId: "project-1" } },
      { method: "POST", path: "/v1/forge-review/detail", body: { projectId: "project-1", url: "https://github.com/acme/demo/pull/42" } },
      { method: "POST", path: "/v1/forge-review/diff", body: { projectId: "project-1", url: "https://github.com/acme/demo/pull/42" } },
      { method: "POST", path: "/v1/forge-review/workflow", body: { projectId: "project-1", url: "https://github.com/acme/demo/pull/42", section: "overview" } },
      { method: "POST", path: "/v1/forge-review/mutate", body: { projectId: "project-1", url: "https://github.com/acme/demo/pull/42", commandId: "review-command", expectedHeadSha: "head-42", operation: { kind: "issue_comment", body: "draft" } } },
      { method: "GET", path: "/v1/drafts/forge-review-v1-project-1" },
      { method: "PATCH", path: "/v1/drafts/forge-review-v1-project-1", body: { expectedRevision: 0, text: "draft", content: { kind: "forge-review-draft" } } },
      { method: "GET", path: `/v1/drafts/${longDraftId}` },
    ] as const;
    for (const request of requests) {
      expect(await handler(trusted, { kind: "request", ...request })).toEqual({ projects: [] });
    }
    expect(calls).toEqual(requests.map(request => ({
      method: request.method,
      path: request.path.slice(4),
      body: "body" in request ? request.body : undefined,
    })));

    const blocked = [
      { method: "GET", path: "/v1/forge-review/list" },
      { method: "POST", path: "/v1/forge-review/capabilities" },
      { method: "PATCH", path: "/v1/forge-review/detail", body: {} },
      { method: "POST", path: "/v1/forge-review/merge", body: {} },
      { method: "POST", path: "/v1/forge-review/list/extra", body: {} },
      { method: "GET", path: "/v1/forge-review/workflow" },
      { method: "PATCH", path: "/v1/forge-review/mutate", body: {} },
      { method: "GET", path: "/v1/drafts" },
      { method: "POST", path: "/v1/drafts/forge-review-v1-project-1", body: {} },
      { method: "GET", path: "/v1/drafts/forge-review-v1-project-1/extra" },
      { method: "PATCH", path: "/v1/drafts/forge-review-v1-project-1/clear", body: {} },
    ] as const;
    for (const request of blocked) {
      await expect(handler(trusted, { kind: "request", ...request })).rejects.toThrow("Unsupported application route");
    }
    await expect(handler(trusted, { kind: "request", method: "PUT", path: "/v1/drafts/forge-review-v1-project-1", body: {} }))
      .rejects.toThrow("Unsupported application method");
    await expect(handler(trusted, { kind: "request", method: "GET", path: `/v1/drafts/${"A".repeat(481)}` }))
      .rejects.toThrow("Unsupported application route");
    expect(calls).toHaveLength(requests.length);
  });

  it("refuses URL escapes, credential management and editor impersonation", async () => {
    const { handler, calls, trusted } = fixture();
    for (const path of ["https://evil.test/v1/projects", "//evil.test/v1/projects", "/v1/sessions/../devices", "/v1/sessions/%2e%2e/devices", "/v1/sessions/%2fdevices", "/v1/remote/pair", "/v1/remote/disable", "/v1/editors/spoof", "/v1/health#fragment"]) {
      await expect(handler(trusted, { kind: "request", method: "GET", path })).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });

  it("forwards every provider auth shape the renderer drives to the host", async () => {
    const { handler, calls, trusted } = fixture();
    const requests = [
      { method: "GET", path: "/v1/providers" },
      { method: "POST", path: "/v1/providers/openai/api-key", body: { apiKey: "sk-test" } },
      { method: "DELETE", path: "/v1/providers/openai/auth" },
      { method: "POST", path: "/v1/providers/openai/login" },
      { method: "GET", path: "/v1/provider-logins/6f1c2e6a-7b1d-4a6e-9f21-2f3d4c5b6a70" },
      { method: "POST", path: "/v1/provider-logins/6f1c2e6a-7b1d-4a6e-9f21-2f3d4c5b6a70/input", body: { requestId: "prompt-1", value: "123456" } },
    ];
    for (const request of requests) expect(await handler(trusted, { kind: "request", ...request })).toEqual({ projects: [] });
    expect(calls).toEqual([
      { method: "GET", path: "providers", body: undefined },
      { method: "POST", path: "providers/openai/api-key", body: { apiKey: "sk-test" } },
      { method: "DELETE", path: "providers/openai/auth", body: undefined },
      { method: "POST", path: "providers/openai/login", body: undefined },
      { method: "GET", path: "provider-logins/6f1c2e6a-7b1d-4a6e-9f21-2f3d4c5b6a70", body: undefined },
      { method: "POST", path: "provider-logins/6f1c2e6a-7b1d-4a6e-9f21-2f3d4c5b6a70/input", body: { requestId: "prompt-1", value: "123456" } },
    ]);
  });

  it("refuses provider lookalikes instead of treating providers as a prefix", async () => {
    const { handler, calls, trusted } = fixture();
    // Shapes the renderer never drives, and the bare collection that has no host route.
    for (const path of ["/v1/provider-logins", "/v1/providers/openai/credentials", "/v1/providers/openai/api-keys", "/v1/providers/openai/logins", "/v1/providers/openai/api-key/extra", "/v1/provider-logins/login-1/input/extra", "/v1/providers//api-key", "/v1/providers/"]) {
      await expect(handler(trusted, { kind: "request", method: "GET", path })).rejects.toThrow("Unsupported application route");
    }
    // Traversal and neighbour shapes outside the allowlist.
    for (const path of ["/v1/providers/../devices", "/v1/provider-logins/%2e%2e/input", "/v1/providers/%2fdevices", "/v1/remote/gateway/extra", "/v1/remote/other", "/v1/devices/x/revoke/extra", "/v1/devices//revoke"]) {
      await expect(handler(trusted, { kind: "request", method: "GET", path })).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });

  it("forwards the selected remote-path routes the Remote panel drives to the host", async () => {
    const { handler, calls, trusted } = fixture();
    const requests = [
      { method: "GET", path: "/v1/remote/gateway" },
      { method: "POST", path: "/v1/remote/enrollment", body: { name: "Laptop" } },
      { method: "GET", path: "/v1/devices" },
      { method: "POST", path: "/v1/devices/00597ac2-ea19-4e59-a72d-8936619415f7/revoke", body: {} },
    ];
    for (const request of requests) expect(await handler(trusted, { kind: "request", ...request })).toEqual({ projects: [] });
    expect(calls).toEqual([
      { method: "GET", path: "remote/gateway", body: undefined },
      { method: "POST", path: "remote/enrollment", body: { name: "Laptop" } },
      { method: "GET", path: "devices", body: undefined },
      { method: "POST", path: "devices/00597ac2-ea19-4e59-a72d-8936619415f7/revoke", body: {} },
    ]);
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

describe("the CEDIA preference owner across the renderer boundary (§6.4)", () => {
  // These rows assert the gateway's relative path shape. A full `/v1/settings` looked right in a
  // fixture with a fake request function and asked the real host for `/v1/v1/settings`; the
  // end-to-end fixture in `host-preferences-end-to-end.test.ts` is what proves the real route.
  it("reaches the host settings route through the application allowlist", async () => {
    const { handler, calls, trusted } = fixture();
    await handler(trusted, { kind: "uiSettings", action: "read" });
    expect(calls).toEqual([{ method: "GET", path: "/settings", body: undefined }]);
    // The allowlist admits exactly this root: an unrelated one is still refused.
    await expect(handler(trusted, { kind: "request", method: "GET", path: "/v1/not-allowlisted" })).rejects.toThrow("Unsupported application route");
  });

  it("writes with the revision it was handed and publishes the committed snapshot to the other window", async () => {
    const published: unknown[] = [];
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const handler = createAgentWindowHandler({
      stateDir: join(tmpdir(), `cedia-test-settings-${process.pid}`),
      authorize: event => event === "trusted",
      request: async (method, path, body) => {
        calls.push({ method, path, ...(body === undefined ? {} : { body }) });
        return { revision: 4, values: { uiDensity: "compact" }, fields: [] };
      },
      ensure: async () => {},
      pickFolder: async () => null,
      openIde: async () => {},
      openExternal: async () => {},
      broadcastPreferences: (event, update) => { published.push({ event, update }); },
    });

    const answer = await handler("trusted", { kind: "uiSettings", action: "write", expectedRevision: 3, category: "appearance", patch: { uiDensity: "compact" } });
    expect(answer).toEqual({ status: "saved", revision: 4, values: { uiDensity: "compact" } });
    expect(calls).toEqual([{ method: "PATCH", path: "/settings", body: { expectedRevision: 3, category: "appearance", patch: { uiDensity: "compact" } } }]);
    expect(published).toEqual([{ event: "trusted", update: { revision: 4, values: { uiDensity: "compact" } } }]);

    // The same boundary refuses a category and a revision the host would never accept.
    await expect(handler("trusted", { kind: "uiSettings", action: "write", expectedRevision: 3, category: "voice", patch: {} })).rejects.toThrow("Unsupported settings category");
    await expect(handler("trusted", { kind: "uiSettings", action: "write", expectedRevision: -1, category: "appearance", patch: {} })).rejects.toThrow("Invalid settings revision");
    await expect(handler("trusted", { kind: "uiSettings", action: "delete" })).rejects.toThrow("Unsupported settings action");
  });

  it("answers a stale revision with the record that won instead of an anonymous failure", async () => {
    const published: unknown[] = [];
    const handler = createAgentWindowHandler({
      stateDir: join(tmpdir(), `cedia-test-settings-conflict-${process.pid}`),
      authorize: event => event === "trusted",
      request: async (method) => {
        if (method === "PATCH") throw new HostHttpError(409, "/v1/settings", "Settings changed elsewhere");
        return { revision: 7, values: { uiDensity: "comfortable" }, fields: [] };
      },
      ensure: async () => {},
      pickFolder: async () => null,
      openIde: async () => {},
      openExternal: async () => {},
      broadcastPreferences: (event, update) => { published.push(update); },
    });

    expect(await handler("trusted", { kind: "uiSettings", action: "write", expectedRevision: 3, category: "appearance", patch: { uiDensity: "compact" } }))
      .toEqual({ status: "conflict", revision: 7, values: { uiDensity: "comfortable" } });
    // A refused write is not a committed one: nothing is published to the other window.
    expect(published).toEqual([]);
  });
});
