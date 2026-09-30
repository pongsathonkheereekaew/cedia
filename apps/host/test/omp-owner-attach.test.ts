import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect as connectSocket, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MAX_RPC_FRAME_BYTES } from "../../../packages/omp-adapter/src/index.ts";
import { OmpRpcClient } from "../../../packages/omp-adapter/src/index.ts";
import { startCediaOwnerBridge } from "../../../upstream/omp/packages/coding-agent/src/session/cedia-owner-bridge.ts";
import { readCediaProcessStartIdentity } from "../../../packages/protocol/src/process-start-identity.ts";
import { CEDIA_OWNER_BRIDGE_VERSION, attachCediaOwnerControlClient, attachCediaOwnerReadClient, cediaOwnerRecordPath, probeCediaOwner, readCediaOwnerRecord, readCediaOwnerSummary } from "../src/owner-endpoint.ts";
import { startHostServer } from "../src/server.ts";

/**
 * §8.2 O08's owner endpoint, measured against the pinned runtime.
 *
 * The record and socket are written by the patched OMP process itself, so these cases start the
 * real runtime and then ask the host's own decision module what it sees: an owner that answers as
 * itself is attachable, and a record that cannot prove that - forged, stale, pointed outside its
 * directory, or answered by a different process - is refused without anything being started,
 * stopped or deleted.
 */

const runtime = process.env.CEDIA_OMP_BINARY ?? resolve(import.meta.dir, "../../../dist/omp/omp");
const RUNTIME_READY = existsSync(runtime);

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "cedia-owner-"));
  directories.push(directory);
  return directory;
}

function writeRecord(directory: string, record: Record<string, unknown>): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(cediaOwnerRecordPath(directory), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/**
 * A provider definition the runtime accepts with an endpoint that never answers (the discard
 * port). These cases never prompt, so nothing may reach a model at all.
 */
function writeFixtureProvider(profile: string): void {
  writeFileSync(join(profile, "models.yml"), `providers:
  fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: owner-fixture-model
        name: Cedia owner fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`);
}

const BASE_RECORD = {
  version: 1,
  protocolVersion: CEDIA_OWNER_BRIDGE_VERSION,
  sessionId: "session-owner",
  incarnation: "inc-owner",
  pid: process.pid,
  processStartIdentity: readCediaProcessStartIdentity(process.pid)!,
  ownerStartedAt: "2026-09-24T10:00:00.000Z",
  startedAt: "2026-09-24T10:00:00.000Z",
  cwd: "/workspace/demo",
  // Overridden per case; a record with no socket at all is malformed, which the reader refuses.
  socket: "/tmp/cedia-owner-placeholder/owner.sock",
  token: "fixture-token",
};

/** A local endpoint that answers with whatever this fixture is told to answer. */
function fakeOwnerSocket(socketPath: string, answer: unknown): Promise<Server> {
  const server = createServer(socket => {
    socket.setEncoding("utf8");
    socket.on("data", chunk => {
      const request = JSON.parse(String(chunk).trim()) as { id?: string };
      socket.write(`${JSON.stringify({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, id: request.id, status: { uptimeMs: 5 }, ...(answer as Record<string, unknown>) })}\n`);
    });
    socket.on("error", () => {});
  });
  return new Promise(resolveListen => server.listen(socketPath, () => resolveListen(server)));
}

function ownerExchange(socketPath: string, bytes: string): Promise<string> {
  return new Promise(resolve => {
    const client = connectSocket(socketPath);
    let response = "";
    client.setEncoding("utf8");
    client.on("data", chunk => {
      response += chunk;
      if (response.includes("\n")) { client.destroy(); resolve(response); }
    });
    client.once("error", () => resolve(response));
    client.once("close", () => resolve(response));
    client.once("connect", () => client.write(bytes));
  });
}

/** A minimal full-control owner used to prove host adoption without starting another OMP child. */
function fakeOwnerControllerSocket(socketPath: string, record: typeof BASE_RECORD, sessionFile: string, claimError?: string): Promise<Server> {
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
        if (request.request === "identify") {
          reply({ ok: true, identity: { sessionId: record.sessionId, incarnation: record.incarnation, pid: record.pid, processStartIdentity: record.processStartIdentity, ownerStartedAt: record.ownerStartedAt, cwd: record.cwd, sessionFile } });
        } else if (request.request === "status") {
          reply({ ok: true, status: { uptimeMs: 5 } });
        } else if (request.request === "claim_controller") {
          if (claimError) { reply({ ok: false, error: claimError }); continue; }
          reply({ ok: true, controllerProtocolVersion: 1, leaseId: "fixture-lease", mode: "read-write", identity: { sessionId: record.sessionId, incarnation: record.incarnation, pid: record.pid, processStartIdentity: record.processStartIdentity, ownerStartedAt: record.ownerStartedAt, cwd: record.cwd, sessionFile }, ready: {
            type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: MAX_RPC_FRAME_BYTES, maxReassembledFrameBytes: 64 * 1024 * 1024,
            cediaOwnerControllerVersion: 1, cediaOwnerControllerMaxFrameBytes: 1024 * 1024, cediaOwnerControllerMaxPending: 64,
            cediaGoalVersion: 1, cediaPlanVersion: 1, cediaCapabilitiesVersion: 1, cediaTurnBridgeVersion: 1, cediaPendingModelVersion: 1,
          } });
        } else if (request.request === "controller_command" && request.command && typeof request.command === "object") {
          const command = request.command as Record<string, unknown>;
          const commandId = id ?? "missing";
          const name = typeof command.type === "string" ? command.type : "unknown";
          const data = name === "get_state" ? { sessionFile, isStreaming: false } : {};
          socket.write(`${JSON.stringify({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, type: "controller_frame", leaseId: "fixture-lease", frame: { id: commandId, type: "response", command: name, success: true, data } })}\n`);
        } else if (request.request === "release_controller") {
          reply({ ok: true });
        }
      }
    });
    socket.on("error", () => {});
  });
  return new Promise(resolveListen => server.listen(socketPath, () => resolveListen(server)));
}

describe("Cedia owner endpoint route", () => {
  it("answers the owner only, and says absent rather than inventing an owner", async () => {
    const stateDir = fixtureDirectory();
    const server = await startHostServer({ stateDir });
    try {
      const owner = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
      const projectPath = join(stateDir, "project");
      mkdirSync(projectPath, { recursive: true });
      const project = await (await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers: owner, body: JSON.stringify({ path: projectPath }) })).json() as { id: string };
      const task = await (await fetch(`${server.descriptor.url}/v1/sessions`, { method: "POST", headers: owner, body: JSON.stringify({ projectId: project.id, title: "Owner route" }) })).json() as { id: string };

      const answer = await fetch(`${server.descriptor.url}/v1/sessions/${task.id}/owner`, { headers: owner });
      expect(answer.status).toBe(200);
      // No runtime has started for this task, so there is no owner to attach to - and the route
      // says exactly that instead of reporting a healthy endpoint.
      expect(await answer.json()).toEqual({ state: "absent" });
      const summary = await fetch(`${server.descriptor.url}/v1/sessions/${task.id}/owner/summary`, { headers: owner });
      expect(summary.status).toBe(200);
      expect(await summary.json()).toEqual({ state: "absent" });

      const controller = { Authorization: `Bearer ${server.auth.issue("non-owner").token}` };
      expect((await fetch(`${server.descriptor.url}/v1/sessions/${task.id}/owner`, { headers: controller })).status).toBe(403);
      expect((await fetch(`${server.descriptor.url}/v1/sessions/${task.id}/owner/summary`, { headers: controller })).status).toBe(403);
      expect((await fetch(`${server.descriptor.url}/v1/sessions/no-such-task/owner`, { headers: owner })).status).toBe(404);
    } finally {
      await server.close();
    }
  }, 30_000);
});

describe("Cedia owner endpoint decisions", () => {
  it("keeps the Cedia task identity separate from OMP's internal summary session id", async () => {
    const directory = fixtureDirectory();
    const socket = join(directory, "owner.sock");
    const identity = { ...BASE_RECORD, mode: "controller", socket };
    const server = await fakeOwnerSocket(socket, {
      ok: true,
      identity,
      summary: {
        sessionId: "omp-internal-session",
        isStreaming: false,
        isCompacting: false,
        queuedMessageCount: 0,
        messageCount: 0,
        creditGuardEnabled: true,
      },
    });
    chmodSync(socket, 0o600);
    try {
      writeRecord(directory, { ...BASE_RECORD, mode: "controller", socket });

      const answer = await readCediaOwnerSummary(directory, {
        expected: { sessionId: BASE_RECORD.sessionId, incarnation: BASE_RECORD.incarnation },
      });

      expect(answer).toMatchObject({
        state: "available",
        identity: { sessionId: BASE_RECORD.sessionId, incarnation: BASE_RECORD.incarnation },
        summary: { sessionId: "omp-internal-session" },
      });
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });

  it("treats a missing record as absent and a malformed record as a conflict", async () => {
    const directory = fixtureDirectory();
    expect(await probeCediaOwner(directory)).toEqual({ state: "absent" });
    expect(readCediaOwnerRecord(directory)).toBeUndefined();

    writeRecord(directory, { ...BASE_RECORD, protocolVersion: 99 });
    expect(readCediaOwnerRecord(directory)?.protocolVersion).toBe(99);
    // A record this Cedia does not understand is a conflict: it is never deleted or "repaired".
    expect(await probeCediaOwner(directory)).toMatchObject({ state: "conflict" });
    expect(readCediaOwnerRecord(directory)).toBeDefined();

    chmodSync(cediaOwnerRecordPath(directory), 0o644);
    expect(await probeCediaOwner(directory)).toMatchObject({ state: "conflict" });
    expect(readCediaOwnerRecord(directory)).toBeUndefined();
    chmodSync(cediaOwnerRecordPath(directory), 0o600);

    writeRecord(directory, { hello: "world" });
    expect(await probeCediaOwner(directory)).toMatchObject({ state: "conflict", reason: expect.stringContaining("not a record") });

    // #1270: an invalid pid never reaches the liveness probe — the record
    // parser rejects it first, so no signal is ever addressed to it.
    for (const pid of [-1, 0, 1.5, Number.NaN]) {
      writeRecord(directory, { ...BASE_RECORD, pid });
      expect(await probeCediaOwner(directory)).toMatchObject({ state: "conflict" });
    }
  });

  it("refuses a socket outside the session directory without touching it", async () => {
    const directory = fixtureDirectory();
    const outside = fixtureDirectory();
    const socket = join(outside, "owner.sock");
    const server = await fakeOwnerSocket(socket, { ok: true, identity: { ...BASE_RECORD, socket } });
    try {
      writeRecord(directory, { ...BASE_RECORD, socket });
      expect(await probeCediaOwner(directory)).toMatchObject({ state: "conflict", reason: expect.stringContaining("outside") });
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });

  it("calls a record stale when its process or socket is gone, and leaves the record alone", async () => {
    const directory = fixtureDirectory();
    writeRecord(directory, { ...BASE_RECORD, socket: join(directory, "owner.sock") });
    expect(await probeCediaOwner(directory)).toMatchObject({ state: "stale" });
    // The record is evidence of what happened; a stale one is left for the next owner to replace.
    expect(readCediaOwnerRecord(directory)).toBeDefined();

    writeRecord(directory, { ...BASE_RECORD, pid: 999_999, socket: join(directory, "owner.sock") });
    expect(await probeCediaOwner(directory)).toMatchObject({ state: "stale", reason: expect.stringContaining("999999") });
    expect(readCediaOwnerRecord(directory)).toBeDefined();
  });

  it("refuses a v2 owner record as unsupported", async () => {
    const directory = fixtureDirectory();
    writeRecord(directory, { ...BASE_RECORD, protocolVersion: 2 });

    expect(await probeCediaOwner(directory)).toMatchObject({
      state: "conflict",
      reason: expect.stringContaining("protocol 2"),
    });
    expect(readCediaOwnerRecord(directory)).toBeDefined();
  });

  it("refuses a live PID when the recorded operating-system start identity belongs to another process", async () => {
    const directory = fixtureDirectory();
    writeRecord(directory, {
      ...BASE_RECORD,
      pid: process.pid,
      processStartIdentity: "darwin-ps-lstart:forged-process-birth",
      socket: join(directory, "owner.sock"),
    });

    const result = await probeCediaOwner(directory);

    expect(result).toMatchObject({
      state: "conflict",
      reason: expect.stringContaining("process start identity"),
    });
    expect(readCediaOwnerRecord(directory)).toBeDefined();
  });

  it("calls it a conflict when the socket answers as a different process", async () => {
    const directory = fixtureDirectory();
    const socket = join(directory, "owner.sock");
    const server = await fakeOwnerSocket(socket, { ok: true, identity: { ...BASE_RECORD, pid: 4242, socket } });
    try {
      writeRecord(directory, { ...BASE_RECORD, socket });
      expect(await probeCediaOwner(directory)).toMatchObject({ state: "conflict", reason: expect.stringContaining("different process") });
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });

  it("fails closed when an endpoint response uses another protocol version", async () => {
    const directory = fixtureDirectory();
    const socket = join(directory, "owner.sock");
    const server = await fakeOwnerSocket(socket, { protocolVersion: 1, ok: true, identity: { ...BASE_RECORD, socket } });
    try {
      writeRecord(directory, { ...BASE_RECORD, socket });
      expect(await probeCediaOwner(directory)).toMatchObject({ state: "conflict", reason: expect.stringContaining("unsupported protocol") });
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });

  it("refuses a record that names another session or incarnation", async () => {
    const directory = fixtureDirectory();
    const socket = join(directory, "owner.sock");
    const server = await fakeOwnerSocket(socket, { ok: true, identity: { ...BASE_RECORD, socket } });
    try {
      writeRecord(directory, { ...BASE_RECORD, socket });
      expect(await probeCediaOwner(directory, { expected: { sessionId: "another-session" } })).toMatchObject({ state: "conflict" });
      expect(await probeCediaOwner(directory, { expected: { incarnation: "another-incarnation" } })).toMatchObject({ state: "conflict" });
      expect(await probeCediaOwner(directory, { expected: { sessionId: BASE_RECORD.sessionId, incarnation: BASE_RECORD.incarnation } }))
        .toMatchObject({ state: "attached", identity: { sessionId: BASE_RECORD.sessionId, incarnation: BASE_RECORD.incarnation } });
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });

  it("keeps an authenticated inspect-only owner visible but refuses a controller lease", async () => {
    const directory = fixtureDirectory();
    const socket = join(directory, "owner.sock");
    const identity = { ...BASE_RECORD, mode: "inspect_only", socket };
    const server = await fakeOwnerSocket(socket, { ok: true, identity });
    try {
      writeRecord(directory, { ...BASE_RECORD, mode: "inspect_only", socket });
      expect(await probeCediaOwner(directory)).toMatchObject({ state: "attached", identity: { mode: "inspect_only" } });
      expect(await attachCediaOwnerControlClient(directory)).toMatchObject({ state: "conflict", reason: expect.stringContaining("inspection only") });

      writeRecord(directory, { ...BASE_RECORD, mode: "controller", socket });
      expect(await probeCediaOwner(directory)).toMatchObject({ state: "conflict", reason: expect.stringContaining("control mode") });
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });

  it("claims a full controller lease and routes a command without starting a second owner", async () => {
    const directory = fixtureDirectory();
    const socket = join(directory, "owner.sock");
    const sessionFile = join(directory, "session.jsonl");
    const server = await fakeOwnerControllerSocket(socket, { ...BASE_RECORD, socket }, sessionFile);
    try {
      writeRecord(directory, { ...BASE_RECORD, socket, sessionFile });
      const client = await attachCediaOwnerControlClient(directory, { expected: { sessionId: BASE_RECORD.sessionId, incarnation: BASE_RECORD.incarnation } });
      expect(client).toMatchObject({ mode: "read-write", phase: "ready" });
      expect("request" in client).toBe(true);
      if (!("request" in client)) return;
      const ack = await client.request("get_state");
      expect(ack.data).toMatchObject({ sessionFile });
      client.detach();
      expect(readCediaOwnerRecord(directory)).toBeDefined();
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });

  it("classifies a live primary controller as a conflict without starting or stopping it", async () => {
    const directory = fixtureDirectory();
    const socket = join(directory, "owner.sock");
    const server = await fakeOwnerControllerSocket(socket, { ...BASE_RECORD, socket }, join(directory, "session.jsonl"), "primary_active");
    try {
      writeRecord(directory, { ...BASE_RECORD, socket });
      expect(await attachCediaOwnerControlClient(directory, { expected: { sessionId: BASE_RECORD.sessionId, incarnation: BASE_RECORD.incarnation } }))
        .toMatchObject({ state: "conflict", reason: expect.stringContaining("primary_active") });
      expect(readCediaOwnerRecord(directory)).toBeDefined();
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });
});

describe("Cedia owner bridge detach", () => {
  it("closes a pending inspector socket before owner shutdown without waiting for its read", async () => {
    const directory = fixtureDirectory();
    const bridge = await startCediaOwnerBridge({ directory, sessionId: "session-pending-read", incarnation: "inc-pending-read", cwd: directory });
    bridge.setReadBroker(() => new Promise<Record<string, unknown>>(() => {}));
    const client = connectSocket(bridge.record.socket);
    let resolveClosed!: () => void;
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    client.once("close", resolveClosed);
    client.once("connect", () => client.write(`${JSON.stringify({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, token: bridge.record.token, request: "read", kind: "summary", id: "old-summary-test" })}\n`));
    await new Promise(resolve => setTimeout(resolve, 25));

    const closedBridge = await Promise.race([
      bridge.close().then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1_000)),
    ]);
    expect(closedBridge).toBe(true);
    await closed;
    expect(process.kill(bridge.record.pid, 0)).toBe(true);
    client.destroy();
  });
});

describe.skipIf(!RUNTIME_READY)("the pinned runtime publishes a real owner endpoint", () => {
  it("writes a private record, answers the host's probe, and takes it away on close", async () => {
    const directory = fixtureDirectory();
    const profile = fixtureDirectory();
    const cwd = fixtureDirectory();
    writeFixtureProvider(profile);
    let client: OmpRpcClient | undefined;
    try {
      client = await OmpRpcClient.start({
        executable: runtime,
        cwd,
        args: ["--no-session", "--no-title", "--no-extensions", "--no-skills", "--no-rules"],
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: profile,
          PI_CODING_AGENT_DIR: profile,
          PI_NO_PTY: "1",
          PI_NOTIFICATIONS: "off",
          CEDIA_SESSION_LOCK: join(directory, "owner.sqlite"),
          CEDIA_SESSION_INCARNATION: "inc-real",
          CEDIA_POLICY_CREDIT_GUARD: "0",
          CEDIA_RPC_OWNER_BRIDGE: "1",
        },
        readyTimeoutMs: 30_000,
        requestTimeoutMs: 15_000,
      });
      const record = readCediaOwnerRecord(directory);
      expect(record).toBeDefined();
      const sessionId = record!.sessionId;
      expect(typeof sessionId).toBe("string");
      expect(record!.incarnation).toBe("inc-real");

      const [summary, concurrentSummary] = await Promise.all([
        readCediaOwnerSummary(directory, { expected: { sessionId, incarnation: "inc-real" } }),
        readCediaOwnerSummary(directory, { expected: { sessionId, incarnation: "inc-real" } }),
      ]);
      expect(summary).toMatchObject({
        state: "available",
        identity: { sessionId, incarnation: "inc-real", pid: record!.pid },
        summary: { sessionId, isStreaming: false, isCompacting: false, creditGuardEnabled: false },
      });
      expect(concurrentSummary).toMatchObject({ state: "available", summary: { sessionId } });
      if (summary.state !== "available") throw new Error("owner summary was not available");
      const readClient = await attachCediaOwnerReadClient(directory, { expected: { sessionId, incarnation: "inc-real" } });
      if (!("getState" in readClient)) throw new Error("typed owner read client did not attach");
      const [typedState, typedCommands] = await Promise.all([readClient.getState(), readClient.getAvailableCommands()]);
      expect(typedState).toMatchObject({ sessionId, isStreaming: false, creditGuardEnabled: false });
      expect(typedCommands).toMatchObject({ truncated: expect.any(Boolean) });
      expect(Array.isArray(typedCommands.commands)).toBe(true);
      expect(JSON.stringify(typedState)).not.toContain("systemPrompt");
      expect(typedState).not.toHaveProperty("sessionFile");
      expect(typedState).not.toHaveProperty("dumpTools");
      readClient.detach();
      // The read client closes its own Unix socket after the reply. The process and its original
      // stdio owner remain alive, and the ordinary owner client still talks to that same session.
      expect(process.kill(record!.pid, 0)).toBe(true);
      expect(await probeCediaOwner(directory, { expected: { sessionId, incarnation: "inc-real" } })).toMatchObject({ state: "attached" });
      expect((await client.request("get_state")).data).toMatchObject({ sessionId });

      const forged = await ownerExchange(record!.socket, `${JSON.stringify({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, token: "forged", request: "read", kind: "summary", id: "forged-test" })}\n`);
      expect(JSON.parse(forged)).toMatchObject({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, id: "forged-test", ok: false, error: "unauthorized" });
      const unsupported = await ownerExchange(record!.socket, `${JSON.stringify({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, token: record!.token, request: "rpc_read", command: "prompt", id: "unsupported-test" })}\n`);
      expect(JSON.parse(unsupported)).toMatchObject({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, id: "unsupported-test", ok: false, error: "unsupported_read" });
      const malformed = await ownerExchange(record!.socket, "not-json\n");
      expect(JSON.parse(malformed)).toMatchObject({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, ok: false, error: "malformed_request" });
      const oversized = await ownerExchange(record!.socket, `${"x".repeat(9 * 1024)}\n`);
      expect(oversized).toBe("");
      // Unauthorized, malformed and oversized clients can detach without terminating the owner.
      expect(await probeCediaOwner(directory, { expected: { sessionId, incarnation: "inc-real" } })).toMatchObject({ state: "attached" });
      expect(typeof record!.pid).toBe("number");
      // The record is the boundary: only the same user can read the token it carries.
      expect(statSync(cediaOwnerRecordPath(directory)).mode & 0o777).toBe(0o600);

      // Two clients at once: the endpoint answers both and ownership does not move.
      const [first, second] = await Promise.all([
        probeCediaOwner(directory, { expected: { sessionId } }),
        probeCediaOwner(directory, { expected: { sessionId } }),
      ]);
      expect(first).toMatchObject({ state: "attached", identity: { incarnation: "inc-real" } });
      expect(second).toMatchObject({ state: "attached" });
      expect((second as { identity: { pid: number } }).identity.pid).toBe((first as { identity: { pid: number } }).identity.pid);

      // A probe is a detach-safe exchange: the client's connection closes and the owner keeps
      // running, so a client that walks away never costs the session its owner.
      expect(await probeCediaOwner(directory, { expected: { sessionId } })).toMatchObject({ state: "attached" });

      await client.close();
      client = undefined;
      // A clean shutdown takes its endpoint with it: nothing stale is left to mislead a client.
      expect(await probeCediaOwner(directory)).toEqual({ state: "absent" });
      expect(existsSync(cediaOwnerRecordPath(directory))).toBe(false);
    } finally {
      await client?.close().catch(() => {});
    }
  }, 60_000);

  it("reports a killed owner as stale, keeps its record, and starts nothing", async () => {
    const directory = fixtureDirectory();
    const profile = fixtureDirectory();
    const cwd = fixtureDirectory();
    writeFixtureProvider(profile);
    let client: OmpRpcClient | undefined;
    try {
      client = await OmpRpcClient.start({
        executable: runtime,
        cwd,
        args: ["--no-session", "--no-title", "--no-extensions", "--no-skills", "--no-rules"],
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: profile, PI_CODING_AGENT_DIR: profile,
          PI_NO_PTY: "1", PI_NOTIFICATIONS: "off",
          CEDIA_SESSION_LOCK: join(directory, "owner.sqlite"), CEDIA_SESSION_INCARNATION: "inc-crash", CEDIA_RPC_OWNER_BRIDGE: "1",
        },
        readyTimeoutMs: 30_000, requestTimeoutMs: 15_000,
      });
      const record = readCediaOwnerRecord(directory);
      expect(record).toBeDefined();
      expect(await probeCediaOwner(directory)).toMatchObject({ state: "attached" });

      // The owner dies without running its cleanup - the crash the record has to survive honestly.
      process.kill(record!.pid, "SIGKILL");
      const deadline = Date.now() + 10_000;
      let decision = await probeCediaOwner(directory);
      while (decision.state === "attached" && Date.now() < deadline) {
        await new Promise(resolveWait => setTimeout(resolveWait, 50));
        decision = await probeCediaOwner(directory);
      }

      expect(decision).toMatchObject({ state: "stale" });
      // Nothing was spawned or cleaned up to "fix" it: the record is the evidence of the crash.
      expect(existsSync(cediaOwnerRecordPath(directory))).toBe(true);
      expect(readCediaOwnerRecord(directory)?.pid).toBe(record!.pid);
    } finally {
      await client?.close().catch(() => {});
    }
  }, 60_000);
});
