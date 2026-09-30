import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOwnerLaunchContextCurrent, ownerLaunchContextPath, readOwnerLaunchContext, writeOwnerLaunchContext } from "../src/owner-launch-context.ts";

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "cedia-owner-launch-context-"));
}

describe("owner launch context", () => {
  it("writes the exact launch schema atomically with mode 0600", () => {
    const root = temporaryDirectory();
    try {
      const directory = join(root, "sessions", "task-a");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const context = {
        taskId: "task-a",
        incarnation: "inc-a",
        sessionFile: join(directory, "session.jsonl"),
        cwd: join(root, "project"),
      } as const;

      writeOwnerLaunchContext(directory, context);

      const path = ownerLaunchContextPath(directory);
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 1, ...context, creditGuard: true });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readdirSync(directory).filter(entry => entry.endsWith(".tmp"))).toEqual([]);
      expect(readOwnerLaunchContext(directory)).toEqual({ version: 1, ...context, creditGuard: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a stale incarnation, cwd, or session file", () => {
    const root = temporaryDirectory();
    try {
      const directory = join(root, "task-a");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const context = {
        taskId: "task-a",
        incarnation: "inc-a",
        sessionFile: join(directory, "session.jsonl"),
        cwd: join(root, "project"),
      } as const;
      writeOwnerLaunchContext(directory, context);
      const loaded = readOwnerLaunchContext(directory);
      expect(loaded).toBeDefined();
      expect(isOwnerLaunchContextCurrent(loaded, context)).toBe(true);
      expect(isOwnerLaunchContextCurrent(loaded, { ...context, incarnation: "inc-b" })).toBe(false);
      expect(isOwnerLaunchContextCurrent(loaded, { ...context, sessionFile: join(directory, "other.jsonl") })).toBe(false);
      expect(isOwnerLaunchContextCurrent(loaded, { ...context, cwd: join(root, "other-project") })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed or credit-unguarded sidecars", () => {
    const root = temporaryDirectory();
    try {
      const directory = join(root, "task-a");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const path = ownerLaunchContextPath(directory);
      Bun.write(path, JSON.stringify({ version: 1, taskId: "task-a", incarnation: "inc-a", sessionFile: "/tmp/session.jsonl", cwd: "/tmp", creditGuard: false }));
      expect(readOwnerLaunchContext(directory)).toBeUndefined();
      Bun.write(path, JSON.stringify({ version: 1, taskId: "task-a", incarnation: "inc-a", sessionFile: "/tmp/session.jsonl", cwd: "/tmp", creditGuard: true, token: "must-not-be-here" }));
      expect(readOwnerLaunchContext(directory)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
