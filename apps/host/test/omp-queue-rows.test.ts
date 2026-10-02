import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DeviceAuth } from "../src/auth.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const root = resolve(import.meta.dir, "..", "..", "..");
const executable = process.env.CEDIA_OMP_BINARY ?? join(root, "dist", "omp", "omp");

const MODELS_YML = `providers:
  fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: queue-row-model
        name: Queue row fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

/**
 * Per-row queue surgery through OMP's targeted primitives (plan §8.2 O01).
 *
 * A turn held at a never-answering endpoint keeps its queue addressable: one
 * follow-up is removed by text with its turn intent settling cancelled, and a
 * second is promoted into steering. Zero provider traffic is possible by
 * construction — the endpoint never answers.
 */
describe("OMP queue row remove and promote (live session runtime)", () => {
  it("removes one row and promotes another without touching the rest", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-queue-rows-"));
    const stateDir = join(directory, "state");
    const profileDir = join(directory, "profile");
    const projectPath = join(directory, "work");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(profileDir, "models.yml"), MODELS_YML, { mode: 0o600 });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const deviceId = auth.list().find(device => device.role === "owner")!.id;
    const host = new CediaHost({
      store,
      stateDir,
      ompExecutable: executable,
      ompEnv: { HOME: profileDir, PI_CODING_AGENT_DIR: profileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", PATH: process.env.PATH ?? "" },
    });
    try {
      const project = store.createProject({ path: projectPath, name: "queue rows" });
      const session = host.createSession(project.id, "queue rows");
      const started = await host.startSession(session.id);
      // The default role resolves to the hanging fixture model.
      await host.ompSettingsMutate({
        context: { scope: "global" },
        changes: [{ path: "modelRoles", operation: "set", value: { default: "fixture/queue-row-model" } }],
      });
      // A turn that never settles: the provider endpoint never answers.
      const turn = host.command(started.id, deviceId, {
        command: "prompt",
        commandId: randomUUID(),
        incarnation: started.incarnation,
        payload: { message: "hold this turn open" },
      });
      turn.catch(() => undefined);
      // Wait until the turn is visibly running before queueing behind it.
      const deadline = Date.now() + 30_000;
      for (;;) {
        const view = host.sessionView(host.store.getSession(started.id)!);
        if (view.status === "running") break;
        if (Date.now() > deadline) throw new Error("the fixture turn never started running");
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      const first = await host.command(started.id, deviceId, {
        command: "follow_up",
        commandId: randomUUID(),
        incarnation: started.incarnation,
        payload: { message: "queued row one" },
      });
      expect(first.status).not.toBe("failed");
      const second = await host.command(started.id, deviceId, {
        command: "follow_up",
        commandId: randomUUID(),
        incarnation: started.incarnation,
        payload: { message: "queued row two" },
      });
      expect(second.status).not.toBe("failed");
      const listed = await host.queueSnapshot(started.id);
      expect(listed.state).toBe("available");

      const removed = await host.queueRemoveMessage(started.id, deviceId, {
        commandId: randomUUID(),
        incarnation: started.incarnation,
        message: "queued row one",
        queue: "followUp",
      });
      expect(removed.state).toBe("available");
      if (removed.state !== "available") return;
      expect(removed.removed).toBe(true);
      expect(removed.followUp.map(row => row.text)).not.toContain("queued row one");
      expect(removed.followUp.map(row => row.text)).toContain("queued row two");
      // The removed submission's turn intent settles cancelled, never ghost-waiting.
      const intents = store.listTurnIntents(started.id);
      const gone = intents.filter(intent => {
        const command = store.getCommand(started.id, intent.commandId);
        return (command?.payload as { message?: unknown } | undefined)?.message === "queued row one";
      });
      expect(gone.length).toBeGreaterThan(0);
      for (const intent of gone) expect(intent.state).toBe("cancelled");

      const promoted = await host.queuePromoteMessage(started.id, deviceId, {
        commandId: randomUUID(),
        incarnation: started.incarnation,
        message: "queued row two",
      });
      expect(promoted.state).toBe("available");
      if (promoted.state !== "available") return;
      expect(promoted.promoted).toBe(true);
      expect(promoted.steering.map(row => row.text)).toContain("queued row two");

      // Removing what is gone answers false, honestly.
      const missing = await host.queueRemoveMessage(started.id, deviceId, {
        commandId: randomUUID(),
        incarnation: started.incarnation,
        message: "queued row one",
        queue: "followUp",
      });
      expect(missing.state).toBe("available");
      if (missing.state !== "available") return;
      expect(missing.removed).toBe(false);
      await host.command(started.id, deviceId, {
        command: "abort",
        commandId: randomUUID(),
        incarnation: started.incarnation,
        payload: {},
      }).catch(() => undefined);
      await turn.catch(() => undefined);
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("refuses malformed row commands before touching a runtime", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-queue-rows-route-"));
    const stateDir = join(directory, "state");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(join(directory, "work"), { recursive: true });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const host = new CediaHost({ store, stateDir });
    const router = createRouter(host, auth, {});
    const project = store.createProject({ path: join(directory, "work"), name: "routes" });
    const session = host.createSession(project.id, "routes");
    const removePath = `/v1/sessions/${session.id}/queue/remove`;
    const promotePath = `/v1/sessions/${session.id}/queue/promote`;
    try {
      const noMessage = await router({
        method: "POST",
        path: removePath,
        token: auth.ownerToken,
        body: { commandId: "c1", incarnation: "i1", message: "", queue: "followUp" },
      });
      expect(noMessage).toMatchObject({ status: 400 });
      const badQueue = await router({
        method: "POST",
        path: removePath,
        token: auth.ownerToken,
        body: { commandId: "c1", incarnation: "i1", message: "x", queue: "sideways" },
      });
      expect(badQueue).toMatchObject({ status: 400 });
      const strayQueue = await router({
        method: "POST",
        path: promotePath,
        token: auth.ownerToken,
        body: { commandId: "c1", incarnation: "i1", message: "x", queue: "followUp" },
      });
      expect(strayQueue).toMatchObject({ status: 400 });
      const longText = await router({
        method: "POST",
        path: removePath,
        token: auth.ownerToken,
        body: { commandId: "c1", incarnation: "i1", message: "x".repeat(4097), queue: "followUp" },
      });
      expect(longText).toMatchObject({ status: 400 });
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
