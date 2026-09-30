import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  admitNewTaskWorkspace,
  allocateWorkspacePort,
  copyAllowlistedIgnored,
  createWorktree,
  gitRoot,
  loadWorkspaceBootstrap,
  planRestoration,
  restoreWorktree,
  reviewWorkspace,
  saveSnapshotManifest,
  workspaceIdentity,
  workspacePath,
} from "../src/workspaces.ts";

const directories: string[] = [];
const worktrees: Array<{ root: string; destination: string }> = [];

function temporaryDirectory(prefix = "cedia-workspaces-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", ["-C", cwd, ...args], { input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

function gitFixture(): string {
  const root = temporaryDirectory();
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "cedia-fixture@example.invalid"]);
  git(root, ["config", "user.name", "Cedia fixture"]);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "main.txt"), "committed\n");
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return root;
}

afterEach(() => {
  for (const { root, destination } of worktrees.splice(0)) {
    try { git(root, ["worktree", "remove", "--force", destination]); } catch { /* fixture may already have cleaned itself */ }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("workspace boundaries", () => {
  it("accepts missing descendants inside a workspace and rejects traversal or escaping symlinks", () => {
    const root = temporaryDirectory("cedia-workspace-path-");
    mkdirSync(join(root, "inside"), { recursive: true });
    const missing = workspacePath(root, "inside/new/file.txt");
    expect(missing).toBe(join(realpathSync(root), "inside", "new", "file.txt"));
    expect(() => workspacePath(root, "../outside.txt")).toThrow(/outside/);

    const outside = temporaryDirectory("cedia-workspace-outside-");
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(root, "escape"));
    expect(() => workspacePath(root, "escape/secret.txt")).toThrow(/outside/);
  });

  it("copies tracked dirty state, nested untracked files, and safe symlinks into an isolated worktree", () => {
    const root = gitFixture();
    writeFileSync(join(root, "src", "main.txt"), "working tree change\n");
    mkdirSync(join(root, "notes", "deep"), { recursive: true });
    writeFileSync(join(root, "notes", "deep", "todo.txt"), "untracked\n");
    symlinkSync("../src/main.txt", join(root, "notes", "tracked-link"));
    const canonicalRoot = realpathSync(root);
    const destination = join(dirname(canonicalRoot), `${canonicalRoot.split("/").pop()}-task`);
    directories.push(destination);
    worktrees.push({ root, destination });

    const snapshot = createWorktree(root, destination, "abc123");
    expect(snapshot.cwd).toBe(destination);
    expect(snapshot.root).toBe(destination);
    expect(snapshot.branch).toBe("cedia/task-abc123");
    expect(snapshot.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.patchHash).toBe(createHash("sha256").update(git(root, ["diff", "--no-ext-diff", "--binary", "HEAD"])).digest("hex"));
    expect(readFileSync(join(destination, "src", "main.txt"), "utf8")).toBe("working tree change\n");
    expect(readFileSync(join(destination, "notes", "deep", "todo.txt"), "utf8")).toBe("untracked\n");
    expect(readlinkSync(join(destination, "notes", "tracked-link"))).toBe("../src/main.txt");
    expect(snapshot.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "notes/deep/todo.txt", kind: "file" }),
      expect.objectContaining({ path: "notes/tracked-link", kind: "symlink" }),
    ]));
    expect(git(root, ["status", "--short"])).toContain("src/main.txt");
    expect(git(root, ["status", "--short"])).toContain("notes/");

    const review = reviewWorkspace(destination);
    expect(review.available).toBe(true);
    expect(review.branch).toBe("cedia/task-abc123");
    expect(review.diff).toContain("working tree change");
    expect(review.untracked).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "notes/deep/todo.txt", text: "untracked\n", binary: false }),
    ]));
  });

  it("carries only the selected uncommitted files and leaves the source folder alone", () => {
    const root = gitFixture();
    writeFileSync(join(root, "src", "other.txt"), "committed\n");
    git(root, ["add", "."]);
    git(root, ["commit", "--quiet", "-m", "second"]);
    writeFileSync(join(root, "src", "main.txt"), "selected tracked change\n");
    writeFileSync(join(root, "src", "other.txt"), "unselected tracked change\n");
    mkdirSync(join(root, "notes"), { recursive: true });
    writeFileSync(join(root, "notes", "keep.txt"), "selected untracked\n");
    writeFileSync(join(root, "notes", "drop.txt"), "unselected untracked\n");
    const before = realpathSync(root);
    const destination = join(dirname(before), `${before.split("/").pop()}-selected`);
    directories.push(destination);
    worktrees.push({ root, destination });

    const snapshot = createWorktree(root, destination, "sel1", { dirtyFiles: ["src/main.txt", "notes/keep.txt"] });

    expect(snapshot.dirtyCopy).toEqual({
      mode: "selected",
      entries: [{ path: "src/main.txt", state: "applied" }, { path: "notes/keep.txt", state: "copied" }],
    });
    // Only the selection travelled: the unselected tracked file is at the starting revision and
    // the unselected untracked file does not exist in the new worktree at all.
    expect(readFileSync(join(destination, "src", "main.txt"), "utf8")).toBe("selected tracked change\n");
    expect(readFileSync(join(destination, "src", "other.txt"), "utf8")).toBe("committed\n");
    expect(existsSync(join(destination, "notes", "keep.txt"))).toBe(true);
    expect(existsSync(join(destination, "notes", "drop.txt"))).toBe(false);
    // The source keeps every byte and every uncommitted path: copying never moves a change.
    expect(readFileSync(join(root, "src", "main.txt"), "utf8")).toBe("selected tracked change\n");
    expect(readFileSync(join(root, "src", "other.txt"), "utf8")).toBe("unselected tracked change\n");
    expect(readFileSync(join(root, "notes", "drop.txt"), "utf8")).toBe("unselected untracked\n");
    expect(git(root, ["status", "--short"])).toContain("src/other.txt");
  });

  it("reports a conflicting selection per path instead of dropping it silently", () => {
    const root = gitFixture();
    writeFileSync(join(root, ".gitignore"), "ignored/\n");
    git(root, ["add", ".gitignore"]);
    git(root, ["commit", "--quiet", "-m", "ignore"]);
    mkdirSync(join(root, "ignored"), { recursive: true });
    writeFileSync(join(root, "ignored", "cache.bin"), "ignored\n");
    const before = realpathSync(root);
    const destination = join(dirname(before), `${before.split("/").pop()}-conflicts`);
    directories.push(destination);
    worktrees.push({ root, destination });

    const snapshot = createWorktree(root, destination, "sel2", {
      dirtyFiles: ["src", "ignored/cache.bin", "src/main.txt", "missing.txt"],
    });

    expect(snapshot.dirtyCopy?.mode).toBe("selected");
    expect(snapshot.dirtyCopy?.entries).toEqual([
      expect.objectContaining({ path: "src", state: "conflict", reason: expect.stringContaining("files, not directories") }),
      expect.objectContaining({ path: "ignored/cache.bin", state: "conflict", reason: expect.stringContaining("allowlist") }),
      expect.objectContaining({ path: "src/main.txt", state: "unchanged", reason: expect.stringContaining("Nothing uncommitted") }),
      expect.objectContaining({ path: "missing.txt", state: "unchanged", reason: expect.stringContaining("Nothing uncommitted") }),
    ]);
    // A conflict is a report, not a half-made workspace: the task still has its worktree.
    expect(existsSync(join(destination, "src", "main.txt"))).toBe(true);
    // Nothing was written into the project folder either.
    expect(existsSync(join(root, "missing.txt"))).toBe(false);
  });

  it("carries no uncommitted state when the caller selects none", () => {
    const root = gitFixture();
    writeFileSync(join(root, "src", "main.txt"), "change the caller did not select\n");
    writeFileSync(join(root, "loose.txt"), "untracked the caller did not select\n");
    const before = realpathSync(root);
    const destination = join(dirname(before), `${before.split("/").pop()}-clean`);
    directories.push(destination);
    worktrees.push({ root, destination });

    const snapshot = createWorktree(root, destination, "sel3", { dirtyFiles: [] });

    expect(snapshot.dirtyCopy).toEqual({ mode: "none", entries: [] });
    // The task starts from exactly the base revision, and the source keeps its change.
    expect(readFileSync(join(destination, "src", "main.txt"), "utf8")).toBe("committed\n");
    expect(existsSync(join(destination, "loose.txt"))).toBe(false);
    expect(git(root, ["status", "--short"])).toContain("loose.txt");
  });

  it("refuses a malformed selection before it creates anything", () => {
    const root = gitFixture();
    const before = realpathSync(root);
    const destination = join(dirname(before), `${before.split("/").pop()}-malformed`);
    directories.push(destination);

    for (const dirtyFiles of [["../escape.txt"], ["/etc/passwd"], ["a\\b.txt"], ["README.md", "README.md"], [""]]) {
      expect(() => createWorktree(root, destination, "sel4", { dirtyFiles })).toThrow();
      // A refused request leaves no worktree behind, so the next attempt starts clean.
      expect(existsSync(destination)).toBe(false);
    }
  });

  it("copies only allowlisted gitignored files and assigns colliding-free ports", () => {
    const root = gitFixture();
    writeFileSync(join(root, ".gitignore"), ".env\n.env.example\n");
    writeFileSync(join(root, ".env"), "SECRET=1\n");
    writeFileSync(join(root, ".env.example"), "SECRET=\n");
    mkdirSync(join(root, ".cedia"), { recursive: true });
    writeFileSync(join(root, ".cedia", "workspace.json"), JSON.stringify({ ignoreAllowlist: [".env.example"], setup: "bun install", run: "bun run dev", portStart: 42000 }) + "\n");
    const destination = join(dirname(realpathSync(root)), `${realpathSync(root).split("/").pop()}-task-bootstrap`);
    directories.push(destination);
    worktrees.push({ root, destination });
    expect(() => copyAllowlistedIgnored(root, destination, ["../escape"])).toThrow(/workspace-relative/);
    const snapshot = createWorktree(root, destination, "ports", {
      allowlist: loadWorkspaceBootstrap(root).ignoreAllowlist,
      setupScript: "bun install",
      runScript: "bun run dev",
      portStart: 42_000,
      usedPorts: [42_000],
    });
    expect(existsSync(join(destination, ".env"))).toBe(false);
    expect(readFileSync(join(destination, ".env.example"), "utf8")).toBe("SECRET=\n");
    expect(snapshot.port).toBe(42_010);
    expect(snapshot.setupScript).toBe("bun install");
    expect(allocateWorkspacePort([42_000, 42_010], 42_000)).toBe(42_020);
  });

  it("returns unavailable for non-Git folders and writes a private snapshot manifest", () => {
    const root = temporaryDirectory("cedia-workspace-plain-");
    expect(gitRoot(root)).toBeUndefined();
    expect(reviewWorkspace(root)).toEqual({ available: false });
    const manifest = join(root, "snapshot.json");
    saveSnapshotManifest(manifest, {
      cwd: root,
      root,
      branch: "local",
      baseCommit: "none",
      patchHash: "hash",
      files: [],
    });
    expect(statSync(manifest).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(manifest, "utf8"))).toMatchObject({ cwd: root, files: [] });
  });

  it("identifies the folder a task starts in without fetching anything", () => {
    const root = gitFixture();
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    const identity = workspaceIdentity(root);
    expect(identity).toMatchObject({ isGit: true, root: realpathSync(root), sourceCommit: head });
    expect(typeof identity.branch).toBe("string");

    const plain = temporaryDirectory("cedia-workspace-identity-");
    expect(workspaceIdentity(plain)).toEqual({ isGit: false, root: realpathSync(plain) });
  });

  it("admits one file-mutating task per folder and sends a concurrent Git task to a worktree", () => {
    const repository = workspaceIdentity(gitFixture());
    const plain = workspaceIdentity(temporaryDirectory("cedia-workspace-admission-"));

    // The first task in a folder may work there directly.
    expect(admitNewTaskWorkspace({ identity: repository, activeTasksInFolder: 0, requestedMode: "local" }))
      .toEqual({ ok: true, mode: "local" });
    expect(admitNewTaskWorkspace({ identity: plain, activeTasksInFolder: 0, requestedMode: "local" }))
      .toEqual({ ok: true, mode: "local" });

    // A concurrent Git task is isolated rather than refused; the refusal names the worktree.
    expect(admitNewTaskWorkspace({ identity: repository, activeTasksInFolder: 1, requestedMode: "worktree" }))
      .toEqual({ ok: true, mode: "worktree" });
    expect(admitNewTaskWorkspace({ identity: repository, activeTasksInFolder: 1, requestedMode: "local" }))
      .toMatchObject({ ok: false, code: "worktree_required" });

    // A folder that is not a repository has nowhere to isolate the second task.
    expect(admitNewTaskWorkspace({ identity: plain, activeTasksInFolder: 1, requestedMode: "local" }))
      .toMatchObject({ ok: false, code: "shared_folder_busy" });
    expect(admitNewTaskWorkspace({ identity: plain, activeTasksInFolder: 1, requestedMode: "worktree" }))
      .toMatchObject({ ok: false, code: "shared_folder_busy" });
  });

  it("reattaches a preserved task branch only when it still points at the archived revision and is free", () => {
    const archived = "a".repeat(40);
    const moved = "b".repeat(40);

    // The recorded branch is still exactly where the archive left it: the restore reattaches it.
    expect(planRestoration({ taskId: "t1", recordedBranch: "cedia/task-t1", archivedCommit: archived, recordedBranchCommit: archived, recordedBranchCheckedOut: false, existingBranches: ["main", "cedia/task-t1"] }))
      .toMatchObject({ branch: "cedia/task-t1", reattached: true });

    // Somebody moved the branch: the restore gets its own name and the old branch is not touched.
    const movedPlan = planRestoration({ taskId: "t1", recordedBranch: "cedia/task-t1", archivedCommit: archived, recordedBranchCommit: moved, recordedBranchCheckedOut: false, existingBranches: ["main", "cedia/task-t1"] });
    expect(movedPlan).toMatchObject({ branch: "cedia/restore/t1", reattached: false });
    expect(movedPlan.reason).toMatch(/no longer points/);

    // Another worktree holds the branch: reattaching it would fight that checkout.
    expect(planRestoration({ taskId: "t1", recordedBranch: "cedia/task-t1", archivedCommit: archived, recordedBranchCommit: archived, recordedBranchCheckedOut: true, existingBranches: [] }))
      .toMatchObject({ branch: "cedia/restore/t1", reattached: false });

    // A taken restoration name is never reused.
    expect(planRestoration({ taskId: "t1", archivedCommit: archived, recordedBranchCheckedOut: false, existingBranches: ["cedia/restore/t1", "cedia/restore/t1-2"] }))
      .toMatchObject({ branch: "cedia/restore/t1-3" });
  });

  it("restores the exact archived revision into a worktree instead of the source's current state", () => {
    const root = gitFixture();
    const archived = git(root, ["rev-parse", "HEAD"]).trim();
    // The source moves on after the archive; a restore must not follow it.
    writeFileSync(join(root, "src", "main.txt"), "committed\nlater\n");
    writeFileSync(join(root, "src", "new.txt"), "not in the archive\n");
    git(root, ["add", "."]);
    git(root, ["commit", "--quiet", "-m", "later"]);
    const destination = join(dirname(realpathSync(root)), `${realpathSync(root).split("/").pop()}-restored`);
    directories.push(destination);
    worktrees.push({ root, destination });

    restoreWorktree(root, destination, "cedia/restore/t1", archived);

    expect(git(destination, ["rev-parse", "HEAD"]).trim()).toBe(archived);
    expect(git(destination, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("cedia/restore/t1");
    expect(readFileSync(join(destination, "src", "main.txt"), "utf8")).toBe("committed\n");
    expect(existsSync(join(destination, "src", "new.txt"))).toBe(false);
  });
});
