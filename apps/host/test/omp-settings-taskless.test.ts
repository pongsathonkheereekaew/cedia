import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OmpSettingsRevisionError } from "../src/omp-settings.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const root = resolve(import.meta.dir, "..", "..", "..");
const executable = process.env.CEDIA_OMP_BINARY ?? join(root, "dist", "omp", "omp");

/**
 * Taskless settings through the real prepared runtime (plan §6.4.1 S2/S3).
 *
 * Zero tasks exist in every case: inventory, scoped reads, airgapped writes,
 * project isolation, env masking, stale-revision conflicts and the named-task
 * guard are all proven against the configuration-only service with an isolated
 * profile, so no provider call is possible.
 */
describe("OMP taskless settings (live configuration service)", () => {
  let directory = "";
  let stateDir = "";
  let profileDir = "";
  let store: DurableStore;
  let host: CediaHost;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cedia-omp-taskless-"));
    stateDir = join(directory, "state");
    profileDir = join(directory, "profile");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(profileDir, { recursive: true });
    store = DurableStore.open({ stateDir, recover: false });
    host = new CediaHost({
      store,
      stateDir,
      ompExecutable: executable,
      ompEnv: { HOME: profileDir, PI_CODING_AGENT_DIR: profileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", PATH: process.env.PATH ?? "" },
    });
  });

  afterEach(async () => {
    await host.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("opens Settings with zero tasks and zero provider calls", async () => {
    expect(store.listSessions().length).toBe(0);
    const keys = await host.ompSettingsKeys();
    expect(keys.state).toBe("available");
    if (keys.state !== "available") return;
    expect(keys.answer.keys.length).toBeGreaterThan(500);
    const endpoint = keys.answer.keys.find(key => key.path === "searxng.endpoint");
    expect(endpoint?.label).toBe("SearXNG Endpoint");
    expect(store.listSessions().length).toBe(0);
  });

  it("reads scope, provenance and defaults without a task", async () => {
    const value = await host.ompSettingsValueIn("cycleOrder", { scope: "global" });
    expect(value.state).toBe("available");
    if (value.state !== "available") return;
    expect(value.answer).toMatchObject({ scope: "global", provenance: "default", configured: false });
    expect(value.answer.value).toEqual(["smol", "default", "slow"]);
  });

  it("shows environment-over-global masking", async () => {
    await host.close();
    store.close();
    host = new CediaHost({
      store: (store = DurableStore.open({ stateDir, recover: false })),
      stateDir,
      ompExecutable: executable,
      ompEnv: {
        HOME: profileDir,
        PI_CODING_AGENT_DIR: profileDir,
        PI_NO_PTY: "1",
        PI_NOTIFICATIONS: "off",
        PATH: process.env.PATH ?? "",
        SEARXNG_ENDPOINT: "http://127.0.0.1:9",
      },
    });
    const value = await host.ompSettingsValueIn("searxng.endpoint", { scope: "global" });
    expect(value.state).toBe("available");
    if (value.state !== "available") return;
    expect(value.answer).toMatchObject({ provenance: "env", scope: "global" });
    expect(value.answer.value).toBe("http://127.0.0.1:9");
  });

  it("keeps two projects isolated with no borrowing", async () => {
    const projectA = join(directory, "proj-a");
    const projectB = join(directory, "proj-b");
    mkdirSync(join(projectA, ".omp"), { recursive: true });
    mkdirSync(join(projectB, ".omp"), { recursive: true });
    await Bun.write(join(projectA, ".omp", "config.yml"), "cycleOrder: [a/only]\nunrelatedTool:\n  keepMe: true\n");
    await Bun.write(join(projectB, ".omp", "config.yml"), "cycleOrder: [b/only]\n");
    const recordA = store.createProject({ path: projectA, name: "proj-a" });
    const recordB = store.createProject({ path: projectB, name: "proj-b" });
    const readA = await host.ompSettingsValueIn("cycleOrder", { scope: "project", projectId: recordA.id });
    const readB = await host.ompSettingsValueIn("cycleOrder", { scope: "project", projectId: recordB.id });
    expect(readA.state).toBe("available");
    expect(readB.state).toBe("available");
    if (readA.state !== "available" || readB.state !== "available") return;
    expect(readA.answer.value).toEqual(["a/only"]);
    expect(readB.answer.value).toEqual(["b/only"]);
    expect(readA.answer.scope).toBe("project");
    // A project write preserves unknown fields and reads back project-effective.
    const written = await host.ompSettingsMutate({
      context: { scope: "project", projectId: recordA.id },
      expectedRevision: readA.answer.settingsRevision,
      changes: [{ path: "cycleOrder", operation: "set", value: ["a/updated"] }],
    });
    expect(written.scope).toBe("project");
    expect(written.values[0]?.value).toEqual(["a/updated"]);
    expect(await Bun.file(join(projectA, ".omp", "config.yml")).text()).toContain("keepMe");
    const rereadB = await host.ompSettingsValueIn("cycleOrder", { scope: "project", projectId: recordB.id });
    expect(rereadB.state).toBe("available");
    if (rereadB.state !== "available") return;
    expect(rereadB.answer.value).toEqual(["b/only"]);
  });

  it("fails stale revisions instead of overwriting", async () => {
    const first = await host.ompSettingsValueIn("cycleOrder", { scope: "global" });
    expect(first.state).toBe("available");
    if (first.state !== "available") return;
    await expect(
      host.ompSettingsMutate({
        context: { scope: "global" },
        expectedRevision: "deadbeefdeadbeefdeadbeefdeadbeef",
        changes: [{ path: "cycleOrder", operation: "set", value: ["stale"] }],
      }),
    ).rejects.toBeInstanceOf(OmpSettingsRevisionError);
    const reread = await host.ompSettingsValueIn("cycleOrder", { scope: "global" });
    expect(reread.state).toBe("available");
    if (reread.state !== "available") return;
    expect(reread.answer.value).toEqual(["smol", "default", "slow"]);
    expect(first.answer.settingsRevision).toBe(reread.answer.settingsRevision);
  });

  it("refuses secrets smuggled in structured values", async () => {
    await expect(
      host.ompSettingsMutate({
        context: { scope: "global" },
        changes: [{ path: "cycleOrder", operation: "set", value: [{ token: "sk-x" }] }],
      }),
    ).rejects.toThrow(/secret/i);
  });

  it("never borrows another task for a named session read", async () => {
    const missing = await host.ompSettingsValueIn("cycleOrder", { scope: "session", sessionId: "no-such-task" });
    expect(missing.state).toBe("unavailable");
    // The legacy session-bound read also reports absence with zero tasks.
    const legacy = await host.ompSettingsValue("cycleOrder");
    expect(legacy.state).toBe("unavailable");
  });
});
