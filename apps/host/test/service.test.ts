import { afterEach, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_RPC_FRAME_BYTES, RPC_COMMAND_TYPES, type RpcCommandType } from "../../../packages/omp-adapter/src/types.ts";
import type { Json } from "../../../packages/protocol/src/index.ts";
import { readCediaProcessStartIdentity } from "../../../packages/protocol/src/process-start-identity.ts";
import { DeviceAuth } from "../src/auth.ts";
import { EditorConnections } from "../src/editors.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";
import { CEDIA_OWNER_BRIDGE_VERSION, cediaOwnerRecordPath } from "../src/owner-endpoint.ts";
import { ownerLaunchContextPath, readOwnerLaunchContext } from "../src/owner-launch-context.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
const fakeHostScript = fileURLToPath(new URL("./fixtures/fake-host.mjs", import.meta.url));
const fixtureNode = process.env.CEDIA_FIXTURE_NODE
  ?? (existsSync("/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node")
    ? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node"
    : process.execPath);
const lockFixture = fileURLToPath(new URL("./fixtures/runtime-lock-holder.mjs", import.meta.url));
const realOmp = process.env.CEDIA_OMP_BINARY ?? fileURLToPath(new URL("../../../dist/omp/omp", import.meta.url));
const cediaOwnerOmp = realOmp;
const currentProcessStartIdentity = readCediaProcessStartIdentity(process.pid)!;

interface FixtureHost {
  directory: string;
  host: CediaHost;
  store: DurableStore;
  sessionId: string;
  incarnation?: string;
}

const fixtures: FixtureHost[] = [];
const directories: string[] = [];

function temporaryDirectory(prefix = "cedia-host-service-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

/**
 * A launcher whose `--version` probe takes ~300ms. The shared fixture answers the probe
 * instantly, so stretching it here is the only deterministic way to observe the window
 * in which the host is waiting on the probe and has not rotated the incarnation yet.
 */
function slowProbeExecutable(): string {
  const path = join(temporaryDirectory("cedia-slow-probe-"), "omp-slow-probe");
  writeFileSync(path, `#!/bin/sh\nif [ "\${1:-}" = "--version" ]; then sleep 0.3; printf 'omp/18.4.3\\n'; exit 0; fi\nexec "$CEDIA_NODE" "${fakeHostScript}" "$@"\n`, { mode: 0o755 });
  return path;
}

function makeHost(mode = "normal", ompExecutable = fixture, extraEnv: NodeJS.ProcessEnv = {}): FixtureHost {
  const directory = temporaryDirectory();
  const projectPath = join(directory, "project");
  mkdirSync(projectPath, { recursive: true });
  const store = DurableStore.open({ stateDir: directory, recover: false });
  const project = store.createProject({ path: projectPath, name: "Fixture project" });
  const host = new CediaHost({
    store,
    stateDir: directory,
    ompExecutable,
    nativeBridge: mode === "native-permission",
    ompEnv: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_HOST_MODE: mode, ...extraEnv },
  });
  const session = host.createSession(project.id, "Fixture task");
  const fixtureHost = { directory, host, store, sessionId: session.id };
  fixtures.push(fixtureHost);
  return fixtureHost;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Cedia host state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** Full-control owner fixture: enough of O08 to exercise CediaHost adoption without spawning OMP. */
function startOwnerControllerFixture(socketPath: string, session: { id: string; incarnation: string; cwd: string; sessionFile: string }, mode?: "controller" | "inspect_only"): Promise<Server> {
  const identity = { sessionId: session.id, incarnation: session.incarnation, pid: process.pid, processStartIdentity: currentProcessStartIdentity, ownerStartedAt: "2026-09-28T00:00:00.000Z", cwd: session.cwd, sessionFile: session.sessionFile, ...(mode === undefined ? {} : { mode }) };
  return new Promise(resolveListen => {
    const server = createServer(socket => {
      let buffered = "";
      socket.setEncoding("utf8");
      socket.on("data", chunk => {
        buffered += String(chunk);
        for (;;) {
          const newline = buffered.indexOf("\n");
          if (newline < 0) return;
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          const request = JSON.parse(line) as Record<string, unknown>;
          const id = typeof request.id === "string" ? request.id : undefined;
          const reply = (value: Record<string, unknown>) => socket.write(`${JSON.stringify({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, ...(id === undefined ? {} : { id }), ...value })}\n`);
          if (request.request === "identify") reply({ ok: true, identity });
          else if (request.request === "status") reply({ ok: true, ...(mode === undefined ? {} : { identity }), status: { uptimeMs: 10 } });
          else if (request.request === "claim_controller") reply({ ok: true, controllerProtocolVersion: 1, leaseId: "host-fixture-lease", mode: "read-write", identity, ready: {
            type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: MAX_RPC_FRAME_BYTES, maxReassembledFrameBytes: 64 * 1024 * 1024,
            cediaOwnerControllerVersion: 1, cediaOwnerControllerMaxFrameBytes: 1024 * 1024, cediaOwnerControllerMaxPending: 64,
            cediaGoalVersion: 1, cediaPlanVersion: 1, cediaCapabilitiesVersion: 1, cediaTurnBridgeVersion: 1, cediaPendingModelVersion: 1,
          } });
          else if (request.request === "controller_command" && request.command && typeof request.command === "object") {
            const command = request.command as Record<string, unknown>;
            const commandId = id ?? "missing";
            const name = typeof command.type === "string" ? command.type : "unknown";
            const data = name === "get_state" ? { sessionFile: session.sessionFile, isStreaming: false } : {};
            socket.write(`${JSON.stringify({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, type: "controller_frame", leaseId: "host-fixture-lease", frame: { id: commandId, type: "response", command: name, success: true, data } })}\n`);
          } else if (request.request === "release_controller") reply({ ok: true });
        }
      });
      socket.on("error", () => {});
    });
    server.listen(socketPath, () => resolveListen(server));
  });
}

function waitForOutput(child: ChildProcess, expected: RegExp, timeoutMs = 2_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${expected}: ${output}`)), timeoutMs);
    const onData = (chunk: Buffer | string) => {
      output += String(chunk);
      if (expected.test(output)) finish();
    };
    const onError = (error: Error) => finish(error);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      if (error) reject(error); else resolve(output);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
  });
}

function waitForExit(child: ChildProcess, timeoutMs = 2_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fixture process did not exit")), timeoutMs);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
  });
}

afterEach(async () => {
  for (const fixtureHost of fixtures.splice(0)) {
    await fixtureHost.host.close().catch(() => {});
    fixtureHost.store.close();
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("CediaHost", () => {
  it("writes the task launch context with the final session identity", () => {
    const fixtureHost = makeHost();
    const session = fixtureHost.store.getSession(fixtureHost.sessionId);
    if (!session) throw new Error("fixture session missing");
    const directory = join(fixtureHost.directory, "sessions", session.id);
    expect(readOwnerLaunchContext(directory)).toEqual({
      version: 1,
      taskId: session.id,
      incarnation: session.incarnation,
      sessionFile: session.sessionFile,
      cwd: session.cwd,
      creditGuard: true,
    });
    expect(statSync(ownerLaunchContextPath(directory)).mode & 0o777).toBe(0o600);
  });

  it("updates the task launch context when the incarnation rotates", async () => {
    const fixtureHost = makeHost();
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    const directory = join(fixtureHost.directory, "sessions", started.id);
    expect(readOwnerLaunchContext(directory)).toEqual({
      version: 1,
      taskId: started.id,
      incarnation: started.incarnation,
      sessionFile: started.sessionFile,
      cwd: started.cwd,
      creditGuard: true,
    });
  });

  it("keeps the task launch context current across archive and restore", () => {
    const fixtureHost = makeHost();
    const before = fixtureHost.store.getSession(fixtureHost.sessionId);
    if (!before) throw new Error("fixture session missing");
    const directory = join(fixtureHost.directory, "sessions", before.id);
    fixtureHost.host.archiveSession(before.id);
    expect(readOwnerLaunchContext(directory)).toEqual({
      version: 1,
      taskId: before.id,
      incarnation: before.incarnation,
      sessionFile: before.sessionFile,
      cwd: before.cwd,
      creditGuard: true,
    });
    fixtureHost.host.restoreSession(before.id);
    expect(readOwnerLaunchContext(directory)).toEqual({
      version: 1,
      taskId: before.id,
      incarnation: before.incarnation,
      sessionFile: before.sessionFile,
      cwd: before.cwd,
      creditGuard: true,
    });
  });

  it("lists known owner states for the local owner without exposing endpoint credentials or paths", async () => {
    const fixtureHost = makeHost();
    let projectNumber = 0;
    const createTask = (title: string) => {
      const projectPath = join(fixtureHost.directory, `owner-project-${++projectNumber}`);
      mkdirSync(projectPath, { recursive: true });
      const project = fixtureHost.store.createProject({ path: projectPath, name: title });
      return fixtureHost.host.createSession(project.id, title);
    };
    const live = createTask("Live owner");
    const stale = createTask("Stale owner");
    const conflict = createTask("Conflicting owner");
    const liveDirectory = join(fixtureHost.directory, "sessions", live.id);
    mkdirSync(liveDirectory, { recursive: true });
    const liveSocket = join(liveDirectory, "owner.sock");
    const socketServer = await startOwnerControllerFixture(liveSocket, live);
    const ownerStartedAt = "2026-09-28T00:00:00.000Z";
    writeFileSync(cediaOwnerRecordPath(liveDirectory), `${JSON.stringify({
      version: 1, protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, sessionId: live.id, incarnation: live.incarnation,
      pid: process.pid, processStartIdentity: currentProcessStartIdentity, ownerStartedAt, startedAt: ownerStartedAt, cwd: live.cwd,
      sessionFile: live.sessionFile, socket: liveSocket, token: "must-not-leak",
    })}\n`, { mode: 0o600 });

    const staleDirectory = join(fixtureHost.directory, "sessions", stale.id);
    mkdirSync(staleDirectory, { recursive: true });
    writeFileSync(cediaOwnerRecordPath(staleDirectory), `${JSON.stringify({
      version: 1, protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, sessionId: stale.id, incarnation: stale.incarnation,
      pid: 2_000_000_000, processStartIdentity: "darwin-ps-lstart:v1:Mon Sep 28 00:00:00 2026", ownerStartedAt, startedAt: ownerStartedAt, cwd: stale.cwd,
      socket: join(staleDirectory, "owner.sock"), token: "must-not-leak",
    })}\n`, { mode: 0o600 });

    const conflictDirectory = join(fixtureHost.directory, "sessions", conflict.id);
    mkdirSync(conflictDirectory, { recursive: true });
    writeFileSync(cediaOwnerRecordPath(conflictDirectory), `${JSON.stringify({
      version: 1, protocolVersion: 99, sessionId: conflict.id, incarnation: conflict.incarnation,
      pid: process.pid, processStartIdentity: currentProcessStartIdentity, ownerStartedAt, startedAt: ownerStartedAt, cwd: conflict.cwd,
      socket: join(conflictDirectory, "owner.sock"), token: "must-not-leak",
    })}\n`, { mode: 0o600 });

    const auth = new DeviceAuth(fixtureHost.directory);
    const router = createRouter(fixtureHost.host, auth);
    try {
      const response = await router({ method: "GET", path: "/v1/owners", token: auth.ownerToken });
      expect(response.status).toBe(200);
      const body = response.body as { owners: Array<Record<string, unknown>>; truncated: boolean };
      expect(body.truncated).toBe(false);
      expect(body.owners.map(row => [row.taskId, row.state])).toEqual(expect.arrayContaining([
        [fixtureHost.sessionId, "absent"], [live.id, "attached"], [stale.id, "stale"], [conflict.id, "conflict"],
      ]));
      const liveRow = body.owners.find(row => row.taskId === live.id)!;
      expect(liveRow.identity).toEqual({ sessionId: live.id, incarnation: live.incarnation, pid: process.pid, ownerStartedAt, mode: "controller" });
      expect(JSON.stringify(body)).not.toContain("must-not-leak");
      expect(JSON.stringify(body)).not.toContain(liveSocket);
      expect(JSON.stringify(body)).not.toContain(live.sessionFile);
      expect(JSON.stringify(body)).not.toContain(live.cwd);

      const controllerToken = auth.issue("owner-list-controller").token;
      expect(await router({ method: "GET", path: "/v1/owners", token: controllerToken })).toMatchObject({ status: 403 });
      expect(await router({ method: "GET", path: "/v1/owners?state=attached", token: auth.ownerToken })).toMatchObject({ status: 400 });
      expect(await router({ method: "GET", path: "/v1/owners", token: auth.ownerToken, body: {} })).toMatchObject({ status: 400 });
      const sessions = await router({ method: "GET", path: "/v1/sessions", token: auth.ownerToken });
      expect((sessions.body as unknown[]).length).toBe(body.owners.length);
    } finally {
      await new Promise<void>(resolveClose => socketServer.close(() => resolveClose()));
    }
  });

  it("refuses an owner conflict before probing or rotating the session", async () => {
    const fixtureHost = makeHost();
    const session = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    writeFileSync(cediaOwnerRecordPath(join(fixtureHost.directory, "sessions", session.id)), `${JSON.stringify({
      version: 1,
      protocolVersion: 99,
      sessionId: session.id,
      incarnation: session.incarnation,
      pid: process.pid,
      processStartIdentity: currentProcessStartIdentity,
      ownerStartedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      cwd: session.cwd,
      socket: join(fixtureHost.directory, "sessions", session.id, "owner.sock"),
      token: "conflict-fixture",
    })}\n`, { mode: 0o600 });
    await expect(fixtureHost.host.startSession(session.id)).rejects.toMatchObject({ code: "owner_conflict" });
    expect(fixtureHost.store.getSession(session.id)?.incarnation).toBe(session.incarnation);
    expect(existsSync(join(fixtureHost.directory, "sessions", session.id, "owner.sqlite"))).toBe(false);
  });

  it("lists an inspect-only TUI but refuses to adopt it or start another executor", async () => {
    const fixtureHost = makeHost();
    const session = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    const directory = join(fixtureHost.directory, "sessions", session.id);
    const socket = join(directory, "owner.sock");
    const server = await startOwnerControllerFixture(socket, session, "inspect_only");
    const ownerStartedAt = "2026-09-28T00:00:00.000Z";
    try {
      writeFileSync(cediaOwnerRecordPath(directory), `${JSON.stringify({
        version: 1, protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, mode: "inspect_only", sessionId: session.id,
        incarnation: session.incarnation, pid: process.pid, processStartIdentity: currentProcessStartIdentity, ownerStartedAt,
        startedAt: ownerStartedAt, cwd: session.cwd, sessionFile: session.sessionFile,
        socket, token: "inspect-fixture",
      })}\n`, { mode: 0o600 });
      const owners = await fixtureHost.host.knownOwnerStates();
      expect(owners.owners.find(row => row.taskId === session.id)).toMatchObject({ state: "attached", identity: { mode: "inspect_only" } });
      await expect(fixtureHost.host.startSession(session.id)).rejects.toMatchObject({ code: "owner_conflict", message: expect.stringContaining("inspection only") });
      expect(fixtureHost.store.getSession(session.id)?.incarnation).toBe(session.incarnation);
      expect(existsSync(join(directory, "owner.sqlite"))).toBe(false);
    } finally {
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    }
  });

  it("adopts a live owner without probing or spawning, then detaches without stopping it", async () => {
    const directory = temporaryDirectory("cedia-owner-adopt-");
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Owner adoption project" });
    const marker = join(directory, "version-probed");
    const executable = join(directory, "must-not-run");
    writeFileSync(executable, `#!/bin/sh\necho invoked > ${marker}\nexit 91\n`, { mode: 0o755 });
    const host = new CediaHost({ store, stateDir: directory, ompExecutable: executable });
    const session = host.createSession(project.id, "Owner adoption");
    fixtures.push({ directory, host, store, sessionId: session.id });
    const sessionDirectory = join(directory, "sessions", session.id);
    const socketPath = join(sessionDirectory, "owner.sock");
    const server = await startOwnerControllerFixture(socketPath, session);
    try {
      writeFileSync(cediaOwnerRecordPath(sessionDirectory), `${JSON.stringify({
        version: 1, protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, sessionId: session.id, incarnation: session.incarnation,
        pid: process.pid, processStartIdentity: currentProcessStartIdentity, ownerStartedAt: "2026-09-28T00:00:00.000Z", startedAt: "2026-09-28T00:00:00.000Z",
        cwd: session.cwd, sessionFile: session.sessionFile, socket: socketPath, token: "host-owner-token",
      })}\n`, { mode: 0o600 });
      const started = await host.startSession(session.id);
      expect(started.incarnation).toBe(session.incarnation);
      expect(started.status).toBe("idle");
      expect(existsSync(marker)).toBe(false);
      expect(await host.command(session.id, "owner", { commandId: "owner-adopt-state", incarnation: session.incarnation, command: "get_state", payload: {} })).toMatchObject({ status: "completed" });
      await expect(host.stopSession(session.id)).rejects.toMatchObject({ code: "owner_attached" });
      await expect(host.deleteSession(session.id)).rejects.toMatchObject({ code: "owner_attached" });
      await host.close();
      expect(store.getSession(session.id)?.status).toBe("idle");
    } finally {
      await new Promise<void>(done => server.close(() => done()));
    }
  });

  it("keeps both task runtimes independently owned while window-local navigation changes the selected task", async () => {
    const fixtureHost = makeHost();
    const first = await fixtureHost.host.startSession(fixtureHost.sessionId);
    const secondProjectPath = join(temporaryDirectory("cedia-task-navigation-project-"), "project");
    mkdirSync(secondProjectPath, { recursive: true });
    const secondProject = fixtureHost.store.createProject({ path: secondProjectPath, name: "Second project" });
    const secondTask = fixtureHost.host.createSession(secondProject.id, "Second task");
    const second = await fixtureHost.host.startSession(secondTask.id);

    // These are the two durable task records a window selects between. Their OMP
    // runtimes have separate owner identities and session files before any UI read.
    expect(first.id).toBe(fixtureHost.sessionId);
    expect(second.id).toBe(secondTask.id);
    expect(first.id).not.toBe(second.id);
    expect(first.incarnation).not.toBe(second.incarnation);
    expect(first.sessionFile).not.toBe(second.sessionFile);

    const firstBefore = fixtureHost.store.getSession(first.id)!;
    const secondBefore = fixtureHost.store.getSession(second.id)!;
    expect(firstBefore.sessionFile).toBe(first.sessionFile);
    expect(secondBefore.sessionFile).toBe(second.sessionFile);

    // A window-local selection reads the target task and changes only the selected
    // view. Reading the second task must not stop, retarget, or abort the first owner.
    const auth = new DeviceAuth(fixtureHost.directory);
    const router = createRouter(fixtureHost.host, auth);
    expect(await router({ method: "GET", path: `/v1/sessions/${first.id}`, token: auth.ownerToken })).toMatchObject({ status: 200, body: { id: first.id } });
    expect(await router({ method: "GET", path: `/v1/sessions/${second.id}`, token: auth.ownerToken })).toMatchObject({ status: 200, body: { id: second.id } });
    const firstRead = await fixtureHost.host.command(first.id, "owner", {
      commandId: "window-local-navigation-first",
      incarnation: first.incarnation,
      command: "get_state",
      payload: {},
    });
    const secondRead = await fixtureHost.host.command(second.id, "owner", {
      commandId: "window-local-navigation-second",
      incarnation: second.incarnation,
      command: "get_state",
      payload: {},
    });
    expect(firstRead.status).toBe("completed");
    expect(secondRead.status).toBe("completed");
    expect(fixtureHost.store.getSession(first.id)?.sessionFile).toBe(first.sessionFile);
    expect(fixtureHost.store.getSession(second.id)?.sessionFile).toBe(second.sessionFile);

    const commandNames = [first.id, second.id].flatMap(id => fixtureHost.store.readEvents(id).events.map(event => (event.frame as { command?: unknown }).command)).filter((name): name is string => typeof name === "string");
    expect(commandNames).not.toContain("switch_session");
    expect(commandNames).not.toContain("abort");
  });

  it("forks a sidechat through OMP into its own session directory and keeps the source intact", async () => {
    const forkArgsLog = join(temporaryDirectory("cedia-fork-args-"), "args.json");
    const fixtureHost = makeHost("fork", fixture, { CEDIA_FAKE_FORK_ARGS_LOG: forkArgsLog });
    const source = await fixtureHost.host.startSession(fixtureHost.sessionId);
    const sourceFile = source.sessionFile;

    const child = await fixtureHost.host.forkSession(source.id, "Sidechat", "sidechat-child");
    expect(child).toMatchObject({ id: "sidechat-child", title: "Sidechat", projectId: source.projectId, cwd: source.cwd });
    expect(child.sidechatSourceThreadId).toBe(source.id);
    expect(child.sessionFile).not.toBe(join(fixtureHost.directory, "sessions", child.id, "session.jsonl"));
    expect(child.sessionFile).toContain(join(fixtureHost.directory, "sessions", child.id));
    expect(JSON.parse(readFileSync(forkArgsLog, "utf8"))).toMatchObject({ source: sourceFile, sessionDir: join(fixtureHost.directory, "sessions", child.id) });
    expect(fixtureHost.store.getSession(source.id)?.sessionFile).toBe(sourceFile);
    expect(JSON.parse(readFileSync(join(fixtureHost.directory, "sessions", child.id, "sidechat.json"), "utf8"))).toMatchObject({ sourceThreadId: source.id });

    const inherited = fixtureHost.store.readEvents(child.id).events.find(event => (event.frame as { command?: string }).command === "get_messages");
    expect(inherited?.frame).toMatchObject({ type: "response", command: "get_messages", success: true, data: { messages: [{ role: "user", text: "inherited" }] } });

    const repeated = await fixtureHost.host.forkSession(source.id, "Ignored title", child.id);
    expect(repeated.id).toBe(child.id);
    expect(repeated.title).toBe("Sidechat");
    // §3.C admits one task per folder, so the second source task gets its own project folder.
    const otherPath = join(temporaryDirectory("cedia-fork-other-project-"), "project");
    mkdirSync(otherPath, { recursive: true });
    const otherProject = fixtureHost.store.createProject({ path: otherPath, name: "Other project" });
    const other = fixtureHost.host.createSession(otherProject.id, "Other source");
    await expect(fixtureHost.host.forkSession(other.id, "Wrong", child.id)).rejects.toMatchObject({ code: "sidechat_conflict" });
  });

  it("rejects a fork whose OMP state escapes the child directory and cleans only the child", async () => {
    const outside = join(temporaryDirectory("cedia-fork-outside-"), "outside.jsonl");
    const fixtureHost = makeHost("fork-outside", fixture, { CEDIA_FAKE_FORK_SESSION_FILE: outside });
    const source = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    const sourceFile = source.sessionFile;
    await expect(fixtureHost.host.forkSession(source.id, "Broken sidechat", "sidechat-bad")).rejects.toMatchObject({ code: "session_mismatch" });
    expect(fixtureHost.store.getSession(source.id)?.sessionFile).toBe(sourceFile);
    expect(fixtureHost.store.getSession("sidechat-bad")).toBeUndefined();
    expect(existsSync(join(fixtureHost.directory, "sessions", "sidechat-bad"))).toBe(false);
  });

  it("materializes an empty source through OMP before forking without adding a prompt", async () => {
    const fixtureHost = makeHost("fork");
    const source = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    expect(existsSync(source.sessionFile)).toBe(false);
    const child = await fixtureHost.host.forkSession(source.id, "Empty sidechat", "empty-sidechat");
    expect(existsSync(source.sessionFile)).toBe(true);
    expect(child.sidechatSourceThreadId).toBe(source.id);
    const sourceEvents = fixtureHost.store.readEvents(source.id).events;
    expect(fixtureHost.store.getSession(source.id)?.status).toBe("idle");
    expect(sourceEvents.some(event => (event.frame as { command?: string }).command === "prompt")).toBe(false);
  });

  it("shares one managed source runtime when empty-source sidechats fork concurrently", async () => {
    const fixtureHost = makeHost("fork");
    const source = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    const [left, right] = await Promise.all([
      fixtureHost.host.forkSession(source.id, "Left sidechat", "left-sidechat"),
      fixtureHost.host.forkSession(source.id, "Right sidechat", "right-sidechat"),
    ]);
    expect(left.sessionFile).not.toBe(join(fixtureHost.directory, "sessions", left.id, "session.jsonl"));
    expect(right.sessionFile).not.toBe(join(fixtureHost.directory, "sessions", right.id, "session.jsonl"));
    expect(fixtureHost.store.getSession(source.id)?.status).toBe("idle");
    expect(fixtureHost.store.readEvents(source.id).events.some(event => (event.frame as { command?: string }).command === "prompt")).toBe(false);
  });

  it("waits for a concurrent idempotent fork instead of returning the pre-fork session path", async () => {
    const fixtureHost = makeHost("fork");
    const source = await fixtureHost.host.startSession(fixtureHost.sessionId);
    const [first, second] = await Promise.all([
      fixtureHost.host.forkSession(source.id, "Sidechat", "concurrent-sidechat"),
      fixtureHost.host.forkSession(source.id, "Ignored title", "concurrent-sidechat"),
    ]);
    expect(first.sessionFile).toBe(second.sessionFile);
    expect(second.sessionFile).not.toBe(join(fixtureHost.directory, "sessions", "concurrent-sidechat", "session.jsonl"));
  });

  it("starts one OMP session, keeps ACK separate from prompt completion, and deduplicates commands", async () => {
    const fixtureHost = makeHost();
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    fixtureHost.incarnation = started.incarnation;
    expect(started.status).toBe("idle");

    const request = {
      commandId: "prompt-1",
      incarnation: started.incarnation,
      command: "prompt" as const,
      payload: { message: "hello fixture" },
    };
    const acknowledged = await fixtureHost.host.command(fixtureHost.sessionId, "owner", request);
    expect(acknowledged).toMatchObject({ commandId: "prompt-1", kind: "prompt" });
    expect(["acknowledged", "completed"]).toContain(acknowledged.status);
    await waitFor(() => fixtureHost.store.getCommand(fixtureHost.sessionId, "prompt-1")?.status === "completed");
    const completed = fixtureHost.store.getCommand(fixtureHost.sessionId, "prompt-1");
    expect(completed).toMatchObject({ status: "completed", result: { type: "prompt_result" } });
    expect(completed).toBeDefined();

    const duplicate = await fixtureHost.host.command(fixtureHost.sessionId, "owner", request);
    expect(duplicate).toEqual(completed!);
    const events = fixtureHost.store.readEvents(fixtureHost.sessionId).events;
    expect(events.some(event => (event.frame as { type?: string }).type === "agent_start")).toBe(true);
    expect(events.some(event => (event.frame as { type?: string }).type === "prompt_result")).toBe(true);

    const stopped = await fixtureHost.host.stopSession(fixtureHost.sessionId);
    expect(stopped.status).toBe("stopped");
  });

  it("fails closed for stale selected slash commands before claiming or dispatching a prompt", async () => {
    const commandLog = join(temporaryDirectory("cedia-slash-command-log-"), "commands.jsonl");
    const fixtureHost = makeHost("normal", fixture, { CEDIA_FAKE_COMMAND_LOG: commandLog });
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    await waitFor(() => fixtureHost.host.slashCommands(fixtureHost.sessionId).length === 2);
    expect(fixtureHost.host.slashCommands(fixtureHost.sessionId)).toContain("baseline-command");
    await expect(fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "stale-selected-slash",
      incarnation: started.incarnation,
      command: "prompt",
      payload: { message: "/removed arg", cediaSelectedSlashCommand: "removed" },
    })).rejects.toMatchObject({ code: "stale_slash_command", status: 409 });
    expect(fixtureHost.store.getCommand(fixtureHost.sessionId, "stale-selected-slash")).toBeUndefined();
    expect(readFileSync(commandLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line).type)).not.toContain("prompt");

    const selected = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "valid-selected-slash",
      incarnation: started.incarnation,
      command: "prompt",
      payload: { message: "/fixture-command arg", cediaSelectedSlashCommand: "fixture-command" },
    });
    expect(selected.kind).toBe("prompt");
    await waitFor(() => fixtureHost.store.getCommand(fixtureHost.sessionId, "valid-selected-slash")?.status === "completed");

    const literal = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "literal-slash-text",
      incarnation: started.incarnation,
      command: "prompt",
      payload: { message: "/ordinary literal prompt" },
    });
    expect(literal.kind).toBe("prompt");
    expect(readFileSync(commandLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line).type)).toContain("prompt");
  });

  it("projects a submitted turn from acceptance to OMP's own ending, and never past its evidence", async () => {
    const fixtureHost = makeHost();
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    fixtureHost.incarnation = started.incarnation;

    const request = {
      commandId: "turn-1",
      incarnation: started.incarnation,
      command: "prompt" as const,
      payload: { message: "hello fixture" },
    };
    await fixtureHost.host.command(fixtureHost.sessionId, "owner", request);

    // Cedia accepted this turn, so it exists - linked to the command that carries it and
    // carrying the same payload hash, but not yet claiming OMP finished anything.
    const accepted = fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-1");
    expect(accepted).toMatchObject({ commandId: "turn-1", deviceId: "owner", acceptedSequence: 1 });
    expect(accepted?.payloadHash).toBe(fixtureHost.store.getCommand(fixtureHost.sessionId, "turn-1")?.payloadHash);

    await waitFor(() => fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-1")?.state === "completed");
    const completed = fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-1")!;
    // The state the client sees is evidence-backed: it names the OMP event it came from, and
    // the model the runtime reported running that turn.
    expect(completed.evidenceSequence).toBeGreaterThan(0);
    expect(completed).toMatchObject({ model: "fixture/fixture-model", thinkingLevel: "medium" });

    // A replayed submission is the same turn, not a second one.
    await fixtureHost.host.command(fixtureHost.sessionId, "owner", request);
    expect(fixtureHost.store.listTurnIntents(fixtureHost.sessionId)).toHaveLength(1);

    // A read of the task carries the same projection.
    const view = fixtureHost.host.sessionView(fixtureHost.store.getSession(fixtureHost.sessionId)!);
    expect(view.turns?.map(turn => turn.state)).toEqual(["completed"]);
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
  });

  it("pauses a turn that never reached OMP instead of claiming or replaying it", async () => {
    const unstarted = makeHost();
    const started = await unstarted.host.startSession(unstarted.sessionId);
    // The OMP owner is gone, so nothing can be dispatched; the host must say so rather than
    // leave a turn looking submitted.
    await unstarted.host.stopSession(unstarted.sessionId);
    const never = await unstarted.host.command(unstarted.sessionId, "owner", {
      commandId: "turn-never",
      incarnation: started.incarnation,
      command: "prompt" as const,
      payload: { message: "never dispatched" },
    });
    expect(never.status).toBe("not_dispatched");
    expect(unstarted.store.getTurnIntentByCommand(unstarted.sessionId, "turn-never")).toMatchObject({ state: "needs_continue" });
  });

  it("names a submission on the wire and takes the runtime's own queue order when the bridge is available", async () => {
    const log = join(temporaryDirectory("cedia-turn-bridge-log-"), "commands.jsonl");
    const fixtureHost = makeHost("hold-turn", fixture, { CEDIA_FAKE_COMMAND_LOG: log });
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    fixtureHost.incarnation = started.incarnation;

    await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "turn-bridge-1",
      incarnation: started.incarnation,
      command: "prompt" as const,
      payload: { message: "named submission" },
    });
    await waitFor(() => fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-bridge-1")?.state === "running");
    const running = fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-bridge-1")!;
    expect(running.reason).toMatch(/named/);

    // The submission reached OMP named, so the runtime can echo that identity on its boundaries.
    const sent = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as { type?: string; cediaIntentId?: string });
    expect(sent.find(entry => entry.type === "prompt")).toMatchObject({ cediaIntentId: running.turnIntentId });

    // A submission behind the running turn takes the position the runtime reports, not a guess.
    await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "turn-bridge-2",
      incarnation: started.incarnation,
      command: "follow_up" as const,
      payload: { message: "queued behind" },
    });
    await waitFor(() => fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-bridge-2")?.queuePosition === 1);
    expect(fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-bridge-2")).toMatchObject({ state: "queued", queuePosition: 1 });
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
  });

  it("settles a turn intent when its queued OMP submission is dropped", async () => {
    const fixtureHost = makeHost("hold-turn");
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    fixtureHost.incarnation = started.incarnation;

    await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "drop-queue-running",
      incarnation: started.incarnation,
      command: "prompt" as const,
      payload: { message: "keep the local request held" },
    });
    await waitFor(() => fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "drop-queue-running")?.state === "running");

    await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "drop-queue-follow-up",
      incarnation: started.incarnation,
      command: "follow_up" as const,
      payload: { message: "return this from the OMP queue" },
    });
    await waitFor(() => fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "drop-queue-follow-up")?.state === "queued");

    const dropSnapshot = await fixtureHost.host.queueDrop(fixtureHost.sessionId, "owner", {
      commandId: "drop-queue-command",
      incarnation: started.incarnation,
      mode: "last",
    });

    const settled = fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "drop-queue-follow-up");
    expect(settled?.state).toBe("cancelled");
    expect(settled?.reason).toContain("Owner removed this queued turn from the OMP queue");
    expect(dropSnapshot.state).toBe("available");
    expect(JSON.stringify(dropSnapshot)).not.toContain("turn-drop-queue-follow-up");
    const dropCommand = fixtureHost.store.getCommand(fixtureHost.sessionId, "drop-queue-command");
    expect(JSON.stringify(dropCommand?.ack)).not.toContain("turn-drop-queue-follow-up");
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
  });

  it("holds a model change for the next turn and only calls it in effect when OMP commits it", async () => {
    const fixtureHost = makeHost();
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    fixtureHost.incarnation = started.incarnation;

    // An unusable selection is refused at acceptance and recorded with the runtime's reason.
    await expect(fixtureHost.host.setPendingModel(fixtureHost.sessionId, { revision: 1, provider: "fixture", modelId: "no-such-model" }))
      .rejects.toMatchObject({ code: "pending_model_refused" });
    const refused = fixtureHost.host.sessionView(fixtureHost.store.getSession(fixtureHost.sessionId)!);
    expect(refused.pendingModel).toMatchObject({ revision: 1, state: "refused" });
    expect(refused.pendingModel?.error).toMatch(/no-such-model/);

    // A valid selection is held, and the task says so rather than claiming it is active.
    const accepted = await fixtureHost.host.setPendingModel(fixtureHost.sessionId, { revision: 2, provider: "fixture", modelId: "fixture-model-2" });
    expect(accepted).toMatchObject({ revision: 2, state: "awaiting", requested: { provider: "fixture", modelId: "fixture-model-2" } });
    expect(fixtureHost.host.sessionView(fixtureHost.store.getSession(fixtureHost.sessionId)!).pendingModel).toMatchObject({ revision: 2, state: "awaiting" });

    // The next turn commits it: OMP reports the revision it applied, and only then does Cedia
    // call the change in effect - with the model the runtime says it is running.
    await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "turn-after-pending",
      incarnation: started.incarnation,
      command: "prompt" as const,
      payload: { message: "run on the new model" },
    });
    await waitFor(() => fixtureHost.host.sessionView(fixtureHost.store.getSession(fixtureHost.sessionId)!).pendingModel?.state === "in-effect");
    const inEffect = fixtureHost.host.sessionView(fixtureHost.store.getSession(fixtureHost.sessionId)!).pendingModel;
    expect(inEffect).toMatchObject({ revision: 2, state: "in-effect", applied: { model: "fixture/fixture-model-2" } });
    expect(fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-after-pending")).toMatchObject({ model: "fixture/fixture-model-2" });
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
  });

  it("applies a model change at once, and says so, on a runtime with no pending-change boundary", async () => {
    const log = join(temporaryDirectory("cedia-pending-fallback-log-"), "commands.jsonl");
    const fixtureHost = makeHost("no-pending-model", fixture, { CEDIA_FAKE_COMMAND_LOG: log });
    fixtureHost.incarnation = (await fixtureHost.host.startSession(fixtureHost.sessionId)).incarnation;

    const applied = await fixtureHost.host.setPendingModel(fixtureHost.sessionId, { revision: 1, provider: "fixture", modelId: "fixture-model-2" });
    // The record never claims the runtime deferred something it cannot defer.
    expect(applied).toMatchObject({ revision: 1, state: "in-effect", applied: { via: "immediate", model: "fixture/fixture-model-2" } });
    const sent = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as { type?: string; payload?: Record<string, unknown> });
    // The wire command carries the model at the top level, exactly as OMP's own `set_model` expects.
    expect(sent.find(entry => entry.type === "set_model")).toMatchObject({ provider: "fixture", modelId: "fixture-model-2" });
    expect(sent.some(entry => entry.type === "cedia_pending_model")).toBe(false);
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
  });

  it("keeps a turn running only while OMP says so, and refuses a second turn behind it", async () => {
    const fixtureHost = makeHost("hold-turn");
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    fixtureHost.incarnation = started.incarnation;

    await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "turn-running",
      incarnation: started.incarnation,
      command: "prompt" as const,
      payload: { message: "first" },
    });
    await waitFor(() => fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-running")?.state === "running");

    // A second turn cannot start behind the running one; it is paused for an explicit continue.
    const second = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "turn-behind",
      incarnation: started.incarnation,
      command: "prompt" as const,
      payload: { message: "second" },
    });
    expect(second.status).toBe("not_dispatched");
    expect(fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-behind")).toMatchObject({ state: "needs_continue", acceptedSequence: 2 });

    // Stop interrupts the running turn and pauses the one behind it; neither becomes a claim
    // that work happened.
    await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "abort-1",
      incarnation: started.incarnation,
      command: "abort" as const,
      payload: {},
    });
    expect(fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-running")).toMatchObject({ state: "cancelled" });
    expect(fixtureHost.store.getTurnIntentByCommand(fixtureHost.sessionId, "turn-behind")).toMatchObject({ state: "needs_continue" });
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
  });

  it("does not persist running while OMP is still starting and lands on idle", async () => {
    const fixtureHost = makeHost("delay-ready");
    const initial = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    const starting = fixtureHost.host.startSession(fixtureHost.sessionId);
    // Wait for the incarnation rotation so this read proves the status that the old code
    // wrote at exactly that point. The ready frame is still pending.
    await waitFor(() => fixtureHost.store.getSession(fixtureHost.sessionId)?.incarnation !== initial.incarnation);
    expect(fixtureHost.store.getSession(fixtureHost.sessionId)?.status).not.toBe("running");
    const started = await starting;
    expect(started.status).toBe("idle");
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
  });

  it("refuses commands transiently while a start is in flight and accepts them after", async () => {
    const fixtureHost = makeHost("delay-ready");
    const initial = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    const starting = fixtureHost.host.startSession(fixtureHost.sessionId);
    await waitFor(() => fixtureHost.store.getSession(fixtureHost.sessionId)?.incarnation !== initial.incarnation);
    const incarnation = fixtureHost.store.getSession(fixtureHost.sessionId)!.incarnation;
    await expect(fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "during-start",
      incarnation,
      command: "prompt",
      payload: { message: "hi" },
    })).rejects.toMatchObject({ code: "session_starting" });
    // Transient means transient: the refusal leaves no row for a client to replay forever.
    expect(fixtureHost.store.getCommand(fixtureHost.sessionId, "during-start")).toBeUndefined();
    const started = await starting;
    const accepted = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "during-start",
      incarnation: started.incarnation,
      command: "prompt",
      payload: { message: "hi" },
    });
    expect(["acknowledged", "completed"]).toContain(accepted.status);
  });

  it("still returns an existing command row while a start is in flight", async () => {
    const fixtureHost = makeHost("delay-ready");
    const initial = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    const before = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "replay-during-start",
      incarnation: initial.incarnation,
      command: "prompt",
      payload: { message: "queued" },
    });
    expect(before.status).toBe("not_dispatched");
    const starting = fixtureHost.host.startSession(fixtureHost.sessionId);
    await waitFor(() => fixtureHost.store.getSession(fixtureHost.sessionId)?.incarnation !== initial.incarnation);
    const replayed = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "replay-during-start",
      incarnation: initial.incarnation,
      command: "prompt",
      payload: { message: "queued" },
    });
    expect(replayed).toEqual(before);
    await starting;
  });

  it("keeps the event loop serving reads while the version probe is in flight", async () => {
    const fixtureHost = makeHost("normal", slowProbeExecutable());
    const initial = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    const starting = fixtureHost.host.startSession(fixtureHost.sessionId);
    // The probe is still running, so the rotation below it has not happened. A synchronous
    // probe would have frozen this thread past both, and the read would see the new
    // incarnation (or could not run at all until the start resolved).
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(fixtureHost.store.getSession(fixtureHost.sessionId)?.incarnation).toBe(initial.incarnation);
    const started = await starting;
    expect(started.status).toBe("idle");
    expect(started.incarnation).not.toBe(initial.incarnation);
  });

  it("claims commands before dispatch and marks a live OMP loss as unknown without replay", async () => {
    const fixtureHost = makeHost();
    const session = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    const notDispatched = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "before-start",
      incarnation: session.incarnation,
      command: "prompt",
      payload: { message: "queued" },
    });
    expect(notDispatched.status).toBe("not_dispatched");

    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    const unknownFixture = makeHost("exit-after-ack");
    const unknownStarted = await unknownFixture.host.startSession(unknownFixture.sessionId);
    const unknown = await unknownFixture.host.command(unknownFixture.sessionId, "owner", {
      commandId: "lost-1",
      incarnation: unknownStarted.incarnation,
      command: "prompt",
      payload: { message: "the process will exit" },
    });
    expect(["acknowledged", "completed"]).toContain(unknown.status);
    await waitFor(() => unknownFixture.store.getSession(unknownFixture.sessionId)?.status === "recovery_required");
    expect(unknownFixture.store.getCommand(unknownFixture.sessionId, "lost-1")?.status).toBe("outcome_unknown");
    await expect(unknownFixture.host.startSession(unknownFixture.sessionId)).rejects.toMatchObject({ code: "recovery_required" });
    expect(unknownFixture.host.reconcile(unknownFixture.sessionId, true).status).toBe("stopped");
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
    expect(started.status).toBe("idle");
  });

  it("reconciles an unknown turn only after removing its dead matching owner record", async () => {
    const fixtureHost = makeHost();
    const session = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    const ownerDirectory = join(fixtureHost.directory, "sessions", session.id);
    mkdirSync(ownerDirectory, { recursive: true });
    const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    if (!owner.pid) throw new Error("fixture owner did not start");
    try {
      const processStartIdentity = readCediaProcessStartIdentity(owner.pid);
      if (!processStartIdentity) throw new Error("fixture owner process identity unavailable");
      const recordPath = cediaOwnerRecordPath(ownerDirectory);
      const ownerRecord = {
        version: 1,
        protocolVersion: CEDIA_OWNER_BRIDGE_VERSION,
        mode: "controller",
        sessionId: session.id,
        incarnation: session.incarnation,
        pid: owner.pid,
        processStartIdentity,
        ownerStartedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        cwd: session.cwd,
        sessionFile: session.sessionFile,
        socket: join(ownerDirectory, "owner.sock"),
        token: "dead-owner-fixture-token",
      };
      const writeOwnerRecord = () => writeFileSync(recordPath, `${JSON.stringify(ownerRecord)}\n`, { mode: 0o600 });
      writeOwnerRecord();
      fixtureHost.store.updateSession(session.id, { status: "recovery_required" });
      expect(() => fixtureHost.host.reconcile(session.id, true)).toThrow("cannot safely clear");
      expect(existsSync(recordPath)).toBe(true);
      owner.kill("SIGKILL");
      await new Promise<void>(resolveExit => owner.once("exit", () => resolveExit()));

      await expect(fixtureHost.host.startSession(session.id)).rejects.toMatchObject({ code: "recovery_required" });
      expect(existsSync(recordPath)).toBe(true);
      ownerRecord.incarnation = "another-incarnation";
      writeOwnerRecord();
      expect(() => fixtureHost.host.reconcile(session.id, true)).toThrow("does not match this task incarnation");
      expect(existsSync(recordPath)).toBe(true);
      ownerRecord.incarnation = session.incarnation;
      writeOwnerRecord();
      expect(fixtureHost.host.reconcile(session.id, true).status).toBe("stopped");
      expect(existsSync(recordPath)).toBe(false);
      const restarted = await fixtureHost.host.startSession(session.id);
      expect(restarted.status).toBe("idle");
      await fixtureHost.host.stopSession(session.id);
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
    }
  });

  it("treats a local-only prompt ACK as completion and does not wait for an agent event", async () => {
    const fixtureHost = makeHost("local-only");
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    const command = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "local-only-1",
      incarnation: started.incarnation,
      command: "prompt",
      payload: { message: "/local-command" },
    });
    expect(command.status).toBe("completed");
    expect(command.result).toMatchObject({ meaning: "OMP command acknowledged", data: { agentInvoked: false } });
    // A second turn is accepted immediately because the local command never
    // became an active model turn.
    const second = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "local-only-2",
      incarnation: started.incarnation,
      command: "prompt",
      payload: { message: "/another-local-command" },
    });
    expect(second.status).toBe("completed");
  });

  it("classifies every pinned RPC command as ACK-complete, turn-ack, or not_dispatched", async () => {
    const fixtureHost = makeHost();
    const session = fixtureHost.store.getSession(fixtureHost.sessionId)!;
    const offline = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "offline-get-state",
      incarnation: session.incarnation,
      command: "get_state",
    });
    expect(offline.status).toBe("not_dispatched");

    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    const sessionFile = fixtureHost.store.getSession(fixtureHost.sessionId)!.sessionFile;
    const payloads: Record<RpcCommandType, { [key: string]: Json }> = {
      negotiate_protocol: { protocolVersion: 2 },
      prompt: { message: "o11-prompt" },
      steer: { message: "o11-steer" },
      follow_up: { message: "o11-follow-up" },
      abort: {},
      abort_and_prompt: { message: "o11-abort-and-prompt" },
      new_session: {},
      get_state: {},
      set_fast_mode: { enabled: false },
      get_available_commands: {},
      set_todos: { phases: [] },
      set_host_tools: { tools: [] },
      set_host_uri_schemes: { schemes: [] },
      set_subagent_subscription: { level: "off" },
      get_subagents: {},
      get_subagent_messages: {},
      set_model: { provider: "cedia-fixture", modelId: "cedia-fixture-model" },
      cycle_model: {},
      get_available_models: {},
      set_thinking_level: { level: "off" },
      cycle_thinking_level: {},
      set_steering_mode: { mode: "all" },
      set_follow_up_mode: { mode: "all" },
      set_interrupt_mode: { mode: "immediate" },
      compact: {},
      set_auto_compaction: { enabled: false },
      set_auto_retry: { enabled: false },
      abort_retry: {},
      bash: { command: "printf o11" },
      abort_bash: {},
      get_session_stats: {},
      export_html: {},
      switch_session: { sessionPath: sessionFile },
      branch: { entryId: "entry-1" },
      get_branch_messages: {},
      get_last_assistant_text: {},
      set_session_name: { name: "o11-fixture" },
      handoff: { customInstructions: "o11-handoff" },
      get_messages: {},
      get_messages_page: { limit: 10 },
      get_entries: {},
      get_tree: {},
      open_session: { sessionDir: sessionFile },
      set_event_filter: { events: null },
      get_available_thinking_levels: {},
      get_login_providers: {},
      login: { providerId: "cedia-fixture" },
    };
    expect(Object.keys(payloads)).toEqual([...RPC_COMMAND_TYPES]);

    for (const command of RPC_COMMAND_TYPES) {
      const result = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
        commandId: `o11-${command}`,
        incarnation: started.incarnation,
        command,
        payload: payloads[command],
      });
      if (command === "prompt") {
        expect(["acknowledged", "completed"]).toContain(result.status);
        await waitFor(() => fixtureHost.store.getCommand(fixtureHost.sessionId, `o11-${command}`)?.status === "completed");
        continue;
      }
      if (command === "abort_and_prompt") {
        expect(result.status).toBe("acknowledged");
        continue;
      }
      expect(result.status).toBe("completed");
      expect(result.result).toMatchObject({ meaning: "OMP command acknowledged" });
    }
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
  });

  it("projects the runtime's set_todos ACK and leaves the list unchanged for unrelated commands", async () => {
    const fixtureHost = makeHost();
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    const phases = [
      { name: "First", tasks: [{ content: "Accepted by OMP", status: "completed" as const }] },
      { name: "Second", tasks: [{ content: "Still pending", status: "pending" as const }] },
    ];
    const request = {
      commandId: "set-todos-progress",
      incarnation: started.incarnation,
      command: "set_todos" as const,
      payload: { phases },
    };
    const set = await fixtureHost.host.command(fixtureHost.sessionId, "owner", request);
    expect(set).toMatchObject({ status: "completed", ack: { data: { todoPhases: phases } } });
    expect(fixtureHost.host.progressSnapshot(fixtureHost.sessionId)).toEqual({ state: "available", revision: 2, phases });
    const auth = new DeviceAuth(fixtureHost.directory);
    const router = createRouter(fixtureHost.host, auth);
    expect(await router({ method: "GET", path: `/v1/sessions/${fixtureHost.sessionId}/progress`, token: auth.ownerToken })).toEqual({
      status: 200,
      body: { state: "available", revision: 2, phases },
    });

    // A durable command replay returns the original receipt and keeps the same projection.
    expect(await fixtureHost.host.command(fixtureHost.sessionId, "owner", request)).toEqual(set);
    expect(fixtureHost.host.progressSnapshot(fixtureHost.sessionId)).toEqual({ state: "available", revision: 2, phases });

    const unrelated = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "unrelated-bash",
      incarnation: started.incarnation,
      command: "bash",
      payload: { command: "printf unrelated" },
    });
    expect(unrelated.status).toBe("completed");
    expect(fixtureHost.host.progressSnapshot(fixtureHost.sessionId)).toEqual({ state: "available", revision: 2, phases });
  });

  it("completes a handoff ACK without requiring a later agent_end frame", async () => {
    const fixtureHost = makeHost("handoff-no-end");
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    const command = await fixtureHost.host.command(fixtureHost.sessionId, "owner", {
      commandId: "handoff-1",
      incarnation: started.incarnation,
      command: "handoff",
      payload: { customInstructions: "fixture handoff" },
    });
    expect(command.status).toBe("completed");
    expect(command.result).toMatchObject({ meaning: "OMP command acknowledged", data: { fixture: "handoff-no-end" } });
  });

  it("serializes concurrent stop/start calls and never starts over an unexpected closed process", async () => {
    const fixtureHost = makeHost();
    const firstStart = fixtureHost.host.startSession(fixtureHost.sessionId);
    const stop = fixtureHost.host.stopSession(fixtureHost.sessionId);
    const restart = fixtureHost.host.startSession(fixtureHost.sessionId);
    const [first, stopped, restarted] = await Promise.all([firstStart, stop, restart]);
    expect(first.status).toBe("idle");
    expect(stopped.status).toBe("stopped");
    expect(restarted.status).toBe("idle");
    expect(restarted.incarnation).not.toBe(first.incarnation);
    expect(fixtureHost.store.getSession(fixtureHost.sessionId)?.status).toBe("idle");
    await fixtureHost.host.stopSession(fixtureHost.sessionId);

    const unexpected = makeHost("exit-after-start");
    const unexpectedStarted = await unexpected.host.startSession(unexpected.sessionId);
    expect(unexpectedStarted.status).toBe("idle");
    await waitFor(() => unexpected.store.getSession(unexpected.sessionId)?.status === "recovery_required");
    await expect(unexpected.host.startSession(unexpected.sessionId)).rejects.toMatchObject({ code: "recovery_required" });
  });

  it("deletes a session: runtime stopped, record gone, the host's own files removed", async () => {
    const fixtureHost = makeHost();
    await fixtureHost.host.startSession(fixtureHost.sessionId);
    const sessionDirectory = join(fixtureHost.directory, "sessions", fixtureHost.sessionId);
    expect(existsSync(sessionDirectory)).toBe(true);
    await fixtureHost.host.deleteSession(fixtureHost.sessionId);
    expect(fixtureHost.store.getSession(fixtureHost.sessionId)).toBeUndefined();
    expect(existsSync(sessionDirectory)).toBe(false);
    // The id is gone for good: a second delete is a not-found, not a silent success.
    await expect(fixtureHost.host.deleteSession(fixtureHost.sessionId)).rejects.toMatchObject({ code: "not_found" });
    // The runtime is no longer tracked, so a later start cannot resurrect it.
    await expect(fixtureHost.host.startSession(fixtureHost.sessionId)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("real OMP session ownership", () => {
  it("adopts a surviving CEDIA owner after primary transport EOF without spawning another process", async () => {
    if (!existsSync(cediaOwnerOmp)) return;
    const stateDir = temporaryDirectory("cedia-real-owner-adopt-");
    const projectPath = temporaryDirectory("cedia-real-owner-project-");
    writeFileSync(join(stateDir, "models.yml"), `providers:\n  fixture:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: owner-model\n        name: Owner fixture\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`, { mode: 0o600 });
    const store = DurableStore.open({ stateDir, recover: false });
    const project = store.createProject({ path: projectPath, name: "Owner adoption" });
    const host = new CediaHost({ store, stateDir, ompExecutable: cediaOwnerOmp, ownerBridge: true,
      ompArgs: ["--no-skills", "--no-rules", "--no-extensions"],
      ompEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: stateDir, PI_CODING_AGENT_DIR: stateDir,
        PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" } });
    const session = host.createSession(project.id, "Adopt after EOF");
    const directory = dirname(session.sessionFile);
    const child = spawn(cediaOwnerOmp, ["--mode", "rpc-ui", "--no-title", "--no-extensions", "--no-skills", "--no-rules",
      "--cwd", projectPath, "--session", session.sessionFile, "--session-dir", directory,
      "--trusted-extension", fileURLToPath(new URL("../src/runtime-lock.ts", import.meta.url))], {
      cwd: projectPath,
      env: { ...process.env, HOME: stateDir, PI_CODING_AGENT_DIR: stateDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off",
        CEDIA_SESSION_LOCK: join(directory, "owner.sqlite"), CEDIA_HOST_SESSION_ID: session.id,
        CEDIA_SESSION_INCARNATION: session.incarnation, CEDIA_POLICY_CREDIT_GUARD: "1",
        CEDIA_RPC_OWNER_BRIDGE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      await waitFor(() => existsSync(cediaOwnerRecordPath(directory)), 10_000);
      const record = JSON.parse(readFileSync(cediaOwnerRecordPath(directory), "utf8")) as { pid: number; sessionId: string };
      expect(record.sessionId).toBe(session.id);
      // The owner publishes its record inside its startup burst (~57KB incl.
      // available_commands_update). EOF + pipe teardown mid-burst breaks the runtime's
      // output writer and it exits(1) before adoption (18.4.3 behavior). Gate EOF on
      // output quiescence: update seen AND no stdout bytes for a beat. Integration-only
      // wait: startup burst length is a property of the platform clock, not ours.
      let started = "";
      let lastBytesAt = Date.now();
      child.stdout.on("data", (chunk: Buffer) => { started += String(chunk); if (started.length > 65536) started = started.slice(-32768); lastBytesAt = Date.now(); });
      await waitFor(() => started.includes("available_commands_update") && Date.now() - lastBytesAt > 750, 20_000);
      child.stdin.end();
      child.stdout.destroy();
      child.stderr.destroy();
      await new Promise(resolve => setTimeout(resolve, 100));
      const adopted = await host.startSession(session.id);
      expect(adopted.incarnation).toBe(session.incarnation);
      expect(adopted.status).toBe("idle");
      expect(process.kill(record.pid, 0)).toBe(true);
      expect((await host.ownerAttachment(session.id)).state).toBe("attached");
      await host.close();
      expect(process.kill(record.pid, 0)).toBe(true);
    } finally {
      await host.close().catch(() => {});
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
        child.kill("SIGKILL");
        await exited;
      }
      store.close();
    }
  }, 30_000);

  it("denies a second OMP process on the same session lock before host tools are initialized", async () => {
    // Keep this integration provider-free: no prompt is sent, and OMP is
    // configured with isolated local directories and disabled discovery.
    if (!existsSync(realOmp)) return;
    const projectPath = temporaryDirectory("cedia-real-omp-project-");
    const firstDir = temporaryDirectory("cedia-real-omp-first-");
    const secondDir = temporaryDirectory("cedia-real-omp-second-");
    const environment = {
      PATH: process.env.PATH ?? `${dirname(realOmp)}:/usr/bin:/bin`,
      HOME: firstDir,
      PI_CODING_AGENT_DIR: firstDir,
      PI_NO_PTY: "1",
      PI_NOTIFICATIONS: "off",
    };
    const localModels = `providers:\n  cedia-lock-fixture:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: cedia-lock-fixture-model\n        name: Cedia lock fixture\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`;
    writeFileSync(join(firstDir, "models.yml"), localModels, { mode: 0o600 });
    writeFileSync(join(secondDir, "models.yml"), localModels, { mode: 0o600 });
    const firstStore = DurableStore.open({ stateDir: firstDir, recover: false });
    const secondStore = DurableStore.open({ stateDir: secondDir, recover: false });
    const firstProject = firstStore.createProject({ path: projectPath, name: "Real OMP first" });
    const secondProject = secondStore.createProject({ path: projectPath, name: "Real OMP second" });
    const firstHost = new CediaHost({ store: firstStore, stateDir: firstDir, ompExecutable: realOmp,
      ompArgs: ["--no-skills", "--no-rules", "--no-extensions"], ompEnv: environment });
    const secondHost = new CediaHost({ store: secondStore, stateDir: secondDir, ompExecutable: realOmp,
      ompArgs: ["--no-skills", "--no-rules", "--no-extensions"], ompEnv: { ...environment, HOME: secondDir, PI_CODING_AGENT_DIR: secondDir } });
    const firstSession = firstHost.createSession(firstProject.id, "Real OMP lock owner");
    const secondSession = secondHost.createSession(secondProject.id, "Real OMP lock contender");
    // Seed an empty session file so both OMP processes can open the same
    // session inode while each Cedia store keeps its own metadata. The lock
    // database is hard-linked as well, making the extension's BEGIN EXCLUSIVE
    // conflict deterministic without asking OMP to open an external path.
    writeFileSync(firstSession.sessionFile, "", { mode: 0o600 });
    try {
      const started = await firstHost.startSession(firstSession.id);
      expect(started.status).toBe("idle");
      linkSync(firstSession.sessionFile, secondSession.sessionFile);
      linkSync(join(dirname(firstSession.sessionFile), "owner.sqlite"), join(dirname(secondSession.sessionFile), "owner.sqlite"));
      const contention = await secondHost.startSession(secondSession.id).catch(error => error);
      expect(contention).toBeInstanceOf(Error);
      expect(String(contention)).toMatch(/owned|lock|exited/i);
      // Lock contention is an unresolved owner state. The host restores the original durable row
      // instead of manufacturing a stopped transition that could invite a replacement spawn.
      expect(secondStore.getSession(secondSession.id)?.status).toBe("idle");
    } finally {
      await secondHost.close().catch(() => {});
      await firstHost.close().catch(() => {});
      firstStore.close();
      secondStore.close();
    }
  }, 30_000); // Two real OMP cold starts can exceed Bun's 5-second unit-test default.

  it("starts standalone OMP with the packaged editor and permission bridges", async () => {
    const standalone = join(fileURLToPath(new URL("../../..", import.meta.url)), "dist/omp-standalone/omp");
    if (!existsSync(standalone)) return;
    const directory = temporaryDirectory("cedia-editor-bridge-");
    const projectPath = join(directory, "project");
    mkdirSync(projectPath);
    writeFileSync(join(directory, "models.yml"), `providers:\n  probe:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: probe-model\n        name: Probe\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`, { mode: 0o600 });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Editor bridge" });
    const editors = new EditorConnections();
    const host = new CediaHost({
      store,
      stateDir: directory,
      editors,
      ompExecutable: standalone,
      editorBridge: true,
      nativeBridge: true,
      ompArgs: ["--no-skills", "--no-rules", "--no-extensions"],
      ompEnv: {
        PATH: "/usr/bin:/bin",
        HOME: directory,
        PI_CODING_AGENT_DIR: directory,
        PI_NO_PTY: "1",
        PI_NOTIFICATIONS: "off",
      },
    });
    try {
      const session = host.createSession(project.id, "Editor bridge session");
      const started = await host.startSession(session.id);
      expect(started.status).toBe("idle");
      const state = await host.command(session.id, "owner", {
        commandId: "bridge-state",
        incarnation: started.incarnation,
        command: "get_state",
      });
      expect(state.status).toBe("completed");
      await host.stopSession(session.id);
    } finally {
      await host.close().catch(() => {});
      store.close();
    }
  }, 30_000);
});

describe("OMP runtime lock extension", () => {
  it("keeps the session owner lock in the OMP process and releases it after a crash", async () => {
    const sqliteProbe = spawnSync(fixtureNode, ["-e", "import('node:sqlite').then(() => process.exit(0)).catch(() => process.exit(1))"], { encoding: "utf8" });
    if (sqliteProbe.status !== 0) return;
    const directory = temporaryDirectory("cedia-runtime-lock-");
    const lockPath = join(directory, "owner.sqlite");
    const environment = { ...process.env, CEDIA_SESSION_LOCK: lockPath };
    const holder = spawn(fixtureNode, [lockFixture], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    await waitForOutput(holder, /LOCKED/);

    const contender = spawn(fixtureNode, [lockFixture], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    const contenderOutput = await waitForOutput(contender, /still owned|LOCKED/);
    const contenderExit = await waitForExit(contender);
    expect(contenderOutput).toMatch(/still owned/);
    expect(contenderExit.code).toBe(73);

    holder.kill("SIGKILL");
    await waitForExit(holder);
    const afterCrash = spawn(fixtureNode, [lockFixture], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    await waitForOutput(afterCrash, /LOCKED/);
    afterCrash.kill("SIGKILL");
    await waitForExit(afterCrash);
  });
});


it("binds native permission options and exact arguments before returning a structured OMP decision", async () => {
  const fixture = makeHost("native-permission");
  const session = await fixture.host.startSession(fixture.sessionId);
  await fixture.host.command(session.id, "owner", { commandId: "permission-prompt", incarnation: session.incarnation, command: "prompt", payload: { message: "fixture" } });
  await waitFor(() => fixture.host.pendingUi(session.id).length > 0);
  const pending = fixture.host.pendingUi(session.id)[0] as { token: string; request: { method: string } };
  expect(pending.request.method).toBe("select");
  expect(fixture.store.readEvents(session.id).events.some(event => JSON.stringify(event.frame).includes('printf fixture'))).toBe(true);
  await fixture.host.respond(session.id, "owner", { commandId: "permission-answer", incarnation: session.incarnation, token: pending.token, answer: "1. Allow once" });
  await waitFor(() => fixture.store.readEvents(session.id).events.some(event => event.frame && typeof event.frame === "object" && !Array.isArray(event.frame) && event.frame.type === "fixture_permission_outcome"));
  const outcome = fixture.store.readEvents(session.id).events.find(event => event.frame && typeof event.frame === "object" && !Array.isArray(event.frame) && event.frame.type === "fixture_permission_outcome");
  expect(outcome?.frame).toMatchObject({ outcome: { outcome: "selected", optionId: "allow_once", kind: "allow_once" } });
  await expect(fixture.host.respond(session.id, "owner", { commandId: "stale-answer", incarnation: session.incarnation, token: pending.token, answer: "1. Allow once" })).resolves.toMatchObject({ status: "not_dispatched" });
});

it("lets exactly one of two competing clients win a single confirm request", async () => {
  const fixture = makeHost("native-permission");
  const session = await fixture.host.startSession(fixture.sessionId);
  await fixture.host.command(session.id, "owner", { commandId: "two-client-prompt", incarnation: session.incarnation, command: "prompt", payload: { message: "fixture" } });
  await waitFor(() => fixture.host.pendingUi(session.id).length > 0);
  const pending = fixture.host.pendingUi(session.id)[0] as { token: string; request: { method: string } };
  expect(pending.request.method).toBe("select");
  const winner = await fixture.host.respond(session.id, "owner", { commandId: "client-a-answer", incarnation: session.incarnation, token: pending.token, answer: "1. Allow once" });
  expect(winner.status).toBe("completed");
  expect(fixture.host.pendingUi(session.id)).toHaveLength(0);
  const loser = await fixture.host.respond(session.id, "second-client", { commandId: "client-b-answer", incarnation: session.incarnation, token: pending.token, answer: "2. Reject" });
  expect(loser.status).toBe("not_dispatched");
  expect(loser.error).toContain("was already answered.");
  expect(fixture.store.getCommand(session.id, "client-a-answer")?.status).toBe("completed");
  expect(fixture.store.getCommand(session.id, "client-b-answer")?.status).toBe("not_dispatched");
  await waitFor(() => fixture.store.readEvents(session.id).events.some(event => event.frame && typeof event.frame === "object" && !Array.isArray(event.frame) && event.frame.type === "fixture_permission_outcome"));
  const outcomes = fixture.store.readEvents(session.id).events.filter(event => event.frame && typeof event.frame === "object" && !Array.isArray(event.frame) && event.frame.type === "fixture_permission_outcome");
  expect(outcomes).toHaveLength(1);
  expect(outcomes[0]?.frame).toMatchObject({ outcome: { outcome: "selected", optionId: "allow_once", kind: "allow_once" } });
});

describe("OMP runtime version gate", () => {
  /**
   * The gate exists so a task can never be started on a runtime the adapter contract
   * was not written against. A later patch of the baseline's minor line is the case a
   * developer machine actually hits: refusing it made the composer fail at startSession
   * before any prompt was sent.
   */
  function hostWithOmpVersion(version: string): { host: CediaHost; sessionId: string; store: DurableStore } {
    const directory = temporaryDirectory("cedia-host-omp-version-");
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "Version gate project" });
    const host = new CediaHost({
      store,
      stateDir: directory,
      ompExecutable: fixture,
      ompEnv: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_HOST_MODE: "normal", CEDIA_FAKE_OMP_VERSION: version },
    });
    const session = host.createSession(project.id, "Version gate task");
    return { host, sessionId: session.id, store };
  }

  it("starts a session on a later patch of the supported line", async () => {
    const fixtureHost = hostWithOmpVersion("omp/18.4.4");
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    expect(started.status).toBe("idle");
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
  });

  it("runs on a newer minor line instead of refusing its number", async () => {
    // The baseline is a floor, not a pin: the contract now stands at 18.4.3,
    // and what a runtime supports is read from its ready
    // frame (the Cedia bridges are capability-gated there) rather than from its version.
    const fixtureHost = hostWithOmpVersion("omp/18.5.0");
    const started = await fixtureHost.host.startSession(fixtureHost.sessionId);
    expect(started.status).toBe("idle");
    await fixtureHost.host.stopSession(fixtureHost.sessionId);
  });

  it("refuses a runtime older than the baseline, naming what it expects", async () => {
    const fixtureHost = hostWithOmpVersion("omp/18.4.2");
    await expect(fixtureHost.host.startSession(fixtureHost.sessionId)).rejects.toMatchObject({
      code: "unsupported_omp",
      message: expect.stringContaining("18.4.3 or later"),
    });
    // Nothing ran: the gate refuses before the session is mutated, so it stays idle.
    expect(fixtureHost.store.getSession(fixtureHost.sessionId)?.status).toBe("idle");
  });

  it("refuses output that is not an OMP version at all", async () => {
    const fixtureHost = hostWithOmpVersion("not-an-omp");
    await expect(fixtureHost.host.startSession(fixtureHost.sessionId)).rejects.toMatchObject({ code: "unsupported_omp" });
  });
});
