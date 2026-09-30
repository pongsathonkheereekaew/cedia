import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostLifecycle, readLifecycleIdentity, readLifecycleSnapshot } from "../src/lifecycle.ts";

describe("host lifecycle lease", () => {
  it("renews a compatible identity and rejects stale or mismatched adoption", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "cedia-lifecycle-"));
    try {
      const lifecycle = new HostLifecycle(stateDir, "started-once");
      const identity = lifecycle.identity();
      const adopted = lifecycle.adopt({ ...identity, appGeneration: "new-generation" }, stateDir, 1);
      expect(adopted.generation).not.toBe(identity.generation);
      expect(lifecycle.identity().appGeneration).toBe("new-generation");
      expect(() => lifecycle.adopt({ ...identity, generation: "stale", appGeneration: "third" }, stateDir, 1)).toThrow("stale or incompatible");
      expect(() => lifecycle.adopt({ ...lifecycle.identity(), appGeneration: "third" }, `${stateDir}-other`, 1)).toThrow("stale or incompatible");
      expect(readLifecycleIdentity(join(stateDir, "lifecycle.json"))).toMatchObject(lifecycle.identity());
      expect(JSON.parse(readFileSync(join(stateDir, "lifecycle.json"), "utf8")).phase).toBe("ready");
    } finally { rmSync(stateDir, { recursive: true, force: true }); }
  });

  it("rejects admissions after explicit quit starts", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "cedia-lifecycle-"));
    try {
      const lifecycle = new HostLifecycle(stateDir, "started-once");
      const firstQuit = lifecycle.requestQuit();
      expect(firstQuit.phase).toBe("quitting");
      expect(() => lifecycle.assertAccepting()).toThrow("no longer accepts commands");
      expect(lifecycle.accepting()).toBe(false);
      expect(lifecycle.requestQuit()).toEqual(firstQuit);
      expect(lifecycle.beginQuit()).toEqual(firstQuit);
      expect(() => lifecycle.adopt(lifecycle.identity(), stateDir, 1)).toThrow("stale or incompatible");
    } finally { rmSync(stateDir, { recursive: true, force: true }); }
  });

  it("reopens admission on a cancel and never reopens a stopped host", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "cedia-lifecycle-"));
    try {
      const lifecycle = new HostLifecycle(stateDir, "started-once");
      expect(lifecycle.resume().phase).toBe("ready");
      const fenced = lifecycle.requestQuit();
      expect(fenced.phase).toBe("quitting");
      const reopened = lifecycle.resume();
      expect(reopened.phase).toBe("ready");
      expect(lifecycle.accepting()).toBe(true);
      expect(lifecycle.resume().phase).toBe("ready");
      expect(readLifecycleSnapshot(join(stateDir, "lifecycle.json"))).toMatchObject({ phase: "ready" });
      // A stopped host is a completed shutdown, not a decision the owner can take back.
      lifecycle.requestQuit();
      lifecycle.completeQuit();
      expect(() => lifecycle.resume()).toThrow("stopped");
      expect(lifecycle.accepting()).toBe(false);
      expect(readLifecycleSnapshot(join(stateDir, "lifecycle.json"))).toMatchObject({ phase: "stopped" });
    } finally { rmSync(stateDir, { recursive: true, force: true }); }
  });

  it("persists a stopped phase after completion and rejects adoption after stopping", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "cedia-lifecycle-"));
    try {
      const lifecycle = new HostLifecycle(stateDir, "started-once");
      lifecycle.requestQuit();
      const stopped = lifecycle.completeQuit();
      expect(stopped.phase).toBe("stopped");
      expect(lifecycle.accepting()).toBe(false);
      expect(readLifecycleSnapshot(join(stateDir, "lifecycle.json"))).toEqual(stopped);
      expect(() => lifecycle.adopt(lifecycle.identity(), stateDir, 1)).toThrow("stale or incompatible");
      expect(lifecycle.completeQuit()).toEqual(stopped);
      expect(readLifecycleSnapshot(join(stateDir, "lifecycle.json"))).toEqual(stopped);
    } finally { rmSync(stateDir, { recursive: true, force: true }); }
  });
});
