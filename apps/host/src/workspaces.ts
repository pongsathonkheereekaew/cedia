import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
// The host runs git in exactly one place (see `apps/host/src/git.ts`); snapshotting a worktree
// uses that module's synchronous runner.
import { probeGit, runGitSync } from "./git.ts";

export function within(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path));
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}
export function workspacePath(cwd: string, name: string): string {
  const root = realpathSync(cwd);
  const lexicalRoot = resolve(cwd);
  const supplied = resolve(lexicalRoot, name);
  const candidate = within(lexicalRoot, supplied) ? resolve(root, relative(lexicalRoot, supplied)) : supplied;
  if (!within(root, candidate)) throw new Error("Path is outside this workspace");
  let ancestor = candidate;
  while (!existsSync(ancestor)) {
    // A dangling symlink is not a safe missing directory.
    try { if (lstatSync(ancestor).isSymbolicLink()) throw new Error("Dangling workspace symlink"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    ancestor = dirname(ancestor);
  }
  const existing = realpathSync(ancestor);
  if (!within(root, existing)) throw new Error("Path resolves outside this workspace");
  return candidate;
}
export function gitRoot(cwd: string): string | undefined {
  try { return runGitSync(cwd, ["rev-parse", "--show-toplevel"]).toString().trim(); } catch { return undefined; }
}

export interface WorkspaceSnapshot {
  cwd: string;
  root: string;
  branch: string;
  baseCommit: string;
  patchHash: string;
  files: { path: string; sha256: string; kind: "file" | "symlink" }[];
  /** What this worktree carried from the source folder's uncommitted state (§3.C). */
  dirtyCopy?: DirtyCopyReceipt;
  port?: number;
  setupScript?: string;
  runScript?: string;
}

/**
 * Which uncommitted project paths a new worktree carries (§3.C).
 *
 * The mode is part of the record: `all` is the historical default (a task continues whatever
 * the user had in the folder), `none` starts from exactly the base revision, and `selected`
 * carries the named paths. `entries` is empty for `all`/`none` because there is nothing
 * per-path to report.
 */
export interface DirtyCopyReceipt {
  readonly mode: "all" | "none" | "selected";
  readonly entries: readonly { readonly path: string; readonly state: "applied" | "copied" | "unchanged" | "conflict"; readonly reason?: string }[];
}

export interface WorkspaceBootstrap {
  readonly ignoreAllowlist?: readonly string[];
  readonly setupScript?: string;
  readonly runScript?: string;
  readonly portStart?: number;
}

export interface CreateWorktreeOptions {
  readonly allowlist?: readonly string[];
  readonly setupScript?: string;
  readonly runScript?: string;
  readonly portStart?: number;
  readonly usedPorts?: readonly number[];
  /** Revision the new worktree starts from; `HEAD` when omitted. */
  readonly baseRef?: string;
  /** Branch the new worktree is created on; `cedia/task-<taskId>` when omitted. */
  readonly branch?: string;
  /**
   * Which uncommitted project files the new worktree carries. Omitted carries the whole
   * uncommitted state, which is what a task has always done; `[]` carries nothing.
   */
  readonly dirtyFiles?: readonly string[];
}

/** What a task records about the folder it starts from (plan §2.2, §3.C). */
export interface WorkspaceIdentity {
  readonly isGit: boolean;
  readonly root: string;
  /** The branch the task starts from; absent on a detached HEAD. */
  readonly branch?: string;
  /** The commit the task starts from. A task never guesses this later. */
  readonly sourceCommit?: string;
}

/**
 * Identify the folder a new task starts in: Git or not, which branch, which commit.
 *
 * Read-only and offline on purpose - Cedia never fetches or pulls implicitly, so the recorded
 * commit is exactly what the user had when the task began.
 */
export function workspaceIdentity(path: string): WorkspaceIdentity {
  const root = probeGit(path, ["rev-parse", "--show-toplevel"]);
  if (!root) {
    // Git answers with a real path, so the non-repository answer does too; a folder that is
    // gone keeps its resolved spelling rather than failing the caller.
    let resolved = resolve(path);
    try { resolved = realpathSync(resolved); } catch { /* a missing folder keeps its spelling */ }
    return { isGit: false, root: resolved };
  }
  const branch = probeGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const sourceCommit = probeGit(root, ["rev-parse", "HEAD"]);
  return {
    isGit: true,
    root,
    ...(branch && branch !== "HEAD" ? { branch } : {}),
    ...(sourceCommit ? { sourceCommit } : {}),
  };
}

export interface NewTaskWorkspaceState {
  readonly identity: WorkspaceIdentity;
  /** Non-archived tasks the host already holds in the same folder. */
  readonly activeTasksInFolder: number;
  readonly requestedMode: "local" | "worktree";
}

export type NewTaskWorkspaceAdmission =
  | { readonly ok: true; readonly mode: "local" | "worktree" }
  | { readonly ok: false; readonly code: "worktree_required" | "shared_folder_busy"; readonly reason: string };

/**
 * Admit a new task into a folder (plan §3.C).
 *
 * One Cedia file-mutating task per folder: a concurrent Git task belongs in its own worktree,
 * and a concurrent task in a folder that is not a repository has nowhere to be isolated, so it
 * waits until the other task is archived. A refusal names the reason instead of silently
 * sharing or silently switching the user's chosen mode.
 */
export function admitNewTaskWorkspace(state: NewTaskWorkspaceState): NewTaskWorkspaceAdmission {
  if (state.requestedMode === "worktree") {
    if (!state.identity.isGit) {
      return {
        ok: false,
        code: "shared_folder_busy",
        reason: "This folder is not a Git repository, so Cedia cannot isolate the task in a worktree. Archive the other task first.",
      };
    }
    return { ok: true, mode: "worktree" };
  }
  if (state.activeTasksInFolder === 0) return { ok: true, mode: "local" };
  if (state.identity.isGit) {
    return {
      ok: false,
      code: "worktree_required",
      reason: "Another task is already working in this folder. Start this one in its own worktree so neither task overwrites the other.",
    };
  }
  return {
    ok: false,
    code: "shared_folder_busy",
    reason: "Another task is already working in this folder and it is not a Git repository, so only one Cedia task may edit it at a time. Archive the other task first.",
  };
}

const DEFAULT_PORT_START = 41_000;
const PORT_SPAN = 10;

export interface RestorationPlan {
  /** Branch the restoration worktree is created on. */
  readonly branch: string;
  /** True when the recorded task branch itself was reattached instead of a new one. */
  readonly reattached: boolean;
  /** Why this branch was chosen, in the user's words. */
  readonly reason: string;
}

/**
 * Choose the branch a restoration worktree uses (plan §2.6 "Continue").
 *
 * The preserved task branch is reattached only when it still points at the archived commit and
 * no worktree holds it. Otherwise the restore gets a branch of its own and the recorded branch
 * is left exactly where it is: restoring a task never moves a branch someone else may be using.
 */
export function planRestoration(options: {
  readonly taskId: string;
  readonly recordedBranch?: string;
  readonly archivedCommit: string;
  readonly recordedBranchCommit?: string;
  readonly recordedBranchCheckedOut: boolean;
  readonly existingBranches: readonly string[];
}): RestorationPlan {
  const recorded = options.recordedBranch;
  if (recorded && !options.recordedBranchCheckedOut && options.recordedBranchCommit === options.archivedCommit) {
    return {
      branch: recorded,
      reattached: true,
      reason: `The task branch ${recorded} still points at the archived revision and no worktree holds it, so the restore reattaches it.`,
    };
  }
  const taken = new Set(options.existingBranches);
  const base = `cedia/restore/${options.taskId}`;
  let branch = base;
  for (let index = 2; taken.has(branch); index += 1) branch = `${base}-${index}`;
  const reason = recorded === undefined
    ? "The task recorded no branch, so the restore uses a branch of its own."
    : options.recordedBranchCheckedOut
      ? `Branch ${recorded} is checked out in another worktree, so the restore uses its own branch and leaves that one alone.`
      : `Branch ${recorded} no longer points at the archived revision, so the restore uses its own branch and leaves it where it is.`;
  return { branch, reattached: false, reason };
}

/**
 * Check an exact archived revision out into a managed worktree, and nothing else.
 *
 * Restoring differs from creating a task: the archived revision is the contract, so the
 * source repository's current uncommitted state is deliberately not copied in.
 */
export function restoreWorktree(source: string, destination: string, branch: string, commit: string, options: { readonly reattach?: boolean } = {}): void {
  const root = gitRoot(source);
  if (!root) throw new Error("This folder is not a Git repository, so the archived task cannot be restored into a worktree");
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  // Reattaching checks out the preserved branch itself; any other name is a new branch created
  // at the archived revision, so a branch the user moved is never moved back.
  if (options.reattach === true) runGitSync(root, ["worktree", "add", destination, branch]);
  else runGitSync(root, ["worktree", "add", "-b", branch, destination, commit]);
}

export function loadWorkspaceBootstrap(projectPath: string): WorkspaceBootstrap {
  const configPath = join(resolve(projectPath), ".cedia", "workspace.json");
  if (!existsSync(configPath)) return {};
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const allowlist = Array.isArray(parsed.ignoreAllowlist) ? parsed.ignoreAllowlist.filter((item): item is string => typeof item === "string") : undefined;
  return {
    ...(allowlist ? { ignoreAllowlist: allowlist } : {}),
    ...(typeof parsed.setup === "string" ? { setupScript: parsed.setup } : {}),
    ...(typeof parsed.run === "string" ? { runScript: parsed.run } : {}),
    ...(typeof parsed.portStart === "number" && Number.isSafeInteger(parsed.portStart) ? { portStart: parsed.portStart } : {}),
  };
}

export function allocateWorkspacePort(used: readonly number[], start = DEFAULT_PORT_START): number {
  const taken = new Set(used.filter(port => Number.isSafeInteger(port) && port > 0));
  let port = start;
  while (taken.has(port)) port += PORT_SPAN;
  if (port > 65_000) throw new Error("No free workspace port in the allocated range");
  return port;
}

export function collectUsedWorkspacePorts(stateDir: string): number[] {
  const root = join(stateDir, "worktrees");
  if (!existsSync(root)) return [];
  const ports: number[] = [];
  for (const name of readdirSync(root)) {
    const manifest = join(stateDir, "sessions", name, "workspace.json");
    if (!existsSync(manifest)) continue;
    try {
      const snapshot = JSON.parse(readFileSync(manifest, "utf8")) as { port?: unknown };
      if (typeof snapshot.port === "number" && Number.isSafeInteger(snapshot.port)) ports.push(snapshot.port);
    } catch { /* Ignore a corrupt sibling manifest; allocation still fail-closed on collision. */ }
  }
  return ports;
}

function assertAllowlistedPath(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\0") || trimmed.split(/[\\/]/).some(part => part === "..")) {
    throw new Error(`Ignored allowlist path is not a workspace-relative file: ${name}`);
  }
  return trimmed;
}

export function copyAllowlistedIgnored(sourceRoot: string, destinationRoot: string, allowlist: readonly string[]): { path: string; sha256: string }[] {
  const copied: { path: string; sha256: string }[] = [];
  for (const raw of allowlist) {
    const name = assertAllowlistedPath(raw);
    const source = workspacePath(sourceRoot, name);
    if (!existsSync(source)) continue;
    let ignored = false;
    try {
      runGitSync(sourceRoot, ["check-ignore", "-q", "--", name], { timeoutMs: 10_000 });
      ignored = true;
    } catch (error) {
      // `check-ignore -q` exits 1 for "this path is not ignored"; any other failure is real.
      const notIgnored = error !== null && typeof error === "object" && "status" in error && error.status === 1;
      if (!notIgnored) throw error;
    }
    if (!ignored) continue;
    const stat = lstatSync(source);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`Allowlisted ignored file is not a small regular file: ${name}`);
    const bytes = readFileSync(source);
    const target = workspacePath(destinationRoot, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { mode: 0o600 });
    copied.push({ path: name, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return copied;
}
/**
 * The project folder's uncommitted paths, read once so a selection is classified against a
 * single answer. `-z` never quotes a path and `--no-renames` keeps one record per path.
 */
function readDirtyStatus(root: string): Map<string, string> {
  const raw = runGitSync(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]).toString("utf8");
  const status = new Map<string, string>();
  for (const record of raw.split("\0")) {
    if (record.length < 4) continue;
    status.set(record.slice(3), record.slice(0, 2));
  }
  return status;
}

function isIgnoredPath(root: string, name: string): boolean {
  try {
    runGitSync(root, ["check-ignore", "-q", "--", name], { timeoutMs: 10_000 });
    return true;
  } catch (error) {
    // `check-ignore -q` exits 1 for "this path is not ignored"; anything else is a real failure.
    const notIgnored = error !== null && typeof error === "object" && "status" in error && error.status === 1;
    if (!notIgnored) throw error;
    return false;
  }
}

/**
 * Validate the requested paths before anything is created, so a malformed list refuses the
 * request instead of leaving a half-made task. Malformed means the caller's mistake; a path
 * that exists but cannot be carried is reported per entry instead.
 */
function normalizeDirtySelection(names: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string" || name.length === 0 || name.length > 4096) throw new Error("A copied file must be named by a non-empty project-relative path");
    if (isAbsolute(name) || name.includes("\\") || name.includes("\0")) throw new Error(`Copied file paths are project-relative: ${name}`);
    if (name.split("/").some(part => part === "" || part === "." || part === "..")) throw new Error(`Copied file paths cannot traverse outside the project: ${name}`);
    if (seen.has(name)) throw new Error(`Duplicate copied file path: ${name}`);
    seen.add(name);
  }
  return [...names];
}

/**
 * What happened to one selected path (§3.C).
 *
 * The status map is the one read before the worktree existed, so this reports what the
 * selection could carry rather than re-reading a folder the copy has already aged. Nothing
 * here writes to the source folder: the addressee is the new worktree.
 */
function classifyDirtySelection(root: string, name: string, status: Map<string, string>): DirtyCopyReceipt["entries"][number] {
  const code = status.get(name);
  if (code === "??") return { path: name, state: "copied" };
  if (code !== undefined) return { path: name, state: "applied" };
  if (isIgnoredPath(root, name)) {
    return { path: name, state: "conflict", reason: "This path is ignored by Git; ignored files are carried by the workspace allowlist, not by a file selection." };
  }
  const stat = lstatSync(workspacePath(root, name), { throwIfNoEntry: false });
  if (stat?.isDirectory()) return { path: name, state: "conflict", reason: "Cedia copies files, not directories." };
  return { path: name, state: "unchanged", reason: "Nothing uncommitted at this path; the worktree already has it at the starting revision." };
}

/** Create an isolated task worktree including the selected source's uncommitted state. */
export function createWorktree(source: string, destination: string, taskId: string, options: CreateWorktreeOptions = {}): WorkspaceSnapshot {
  const root = gitRoot(source);
  if (!root) throw new Error("This folder is not a Git repository; use local mode");
  const selection = options.dirtyFiles === undefined ? undefined : normalizeDirtySelection(options.dirtyFiles);
  const baseCommit = runGitSync(root, ["rev-parse", options.baseRef ?? "HEAD"]).toString().trim();
  const branch = options.branch ?? `cedia/task-${taskId}`;
  // The default carries the whole uncommitted working tree, which is what a task has always
  // begun with. A selection (`dirtyFiles`) names the paths instead, and `[]` carries none.
  const status = selection === undefined ? undefined : readDirtyStatus(root);
  const tracked = selection === undefined
    ? []
    : selection.filter(name => status!.get(name) !== undefined && status!.get(name) !== "??");
  const untracked = selection === undefined
    ? runGitSync(root, ["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean)
    : selection.filter(name => status!.get(name) === "??");
  const diffPaths = selection === undefined ? [] : tracked;
  const patch = selection !== undefined && tracked.length === 0
    ? Buffer.alloc(0)
    : runGitSync(root, ["diff", "--no-ext-diff", "--binary", "HEAD", ...(diffPaths.length === 0 ? [] : ["--", ...diffPaths])]);
  const prepared: { name: string; source: string; kind: "file" | "symlink"; hash: string }[] = [];
  let bytes = patch.length;
  for (const name of untracked) {
    const path = workspacePath(root, name);
    const stat = lstatSync(path);
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Unsupported snapshot entry: ${name}`);
    const kind = stat.isSymbolicLink() ? "symlink" : "file";
    const content = kind === "symlink" ? Buffer.from(readlinkSync(path)) : readFileSync(path);
    bytes += content.length;
    if (bytes > 256 * 1024 * 1024) throw new Error("Workspace snapshot exceeds 256 MiB; select a smaller source snapshot");
    prepared.push({ name, source: path, kind, hash: createHash("sha256").update(content).digest("hex") });
  }
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  runGitSync(root, ["worktree", "add", "-b", branch, destination, baseCommit]);
  try {
    if (patch.length) runGitSync(destination, ["apply", "--binary", "-"], { input: patch });
    for (const file of prepared) {
      const target = workspacePath(destination, file.name);
      mkdirSync(dirname(target), { recursive: true });
      if (file.kind === "symlink") {
        const link = readlinkSync(file.source);
        if (isAbsolute(link) || !within(destination, resolve(dirname(target), link))) throw new Error(`Symlink escapes task workspace: ${file.name}`);
        symlinkSync(link, target);
      } else copyFileSync(file.source, target);
      const actual = createHash("sha256").update(file.kind === "symlink" ? readlinkSync(target) : readFileSync(target)).digest("hex");
      if (actual !== file.hash) throw new Error(`Source changed during snapshot: ${file.name}`);
    }
    // Verify the tracked change still matches what was read, but only when this mode carries
    // one: an empty pathspec would otherwise compare the whole repository against nothing.
    if ((selection === undefined || tracked.length > 0)
      && !runGitSync(root, ["diff", "--no-ext-diff", "--binary", "HEAD", ...(diffPaths.length === 0 ? [] : ["--", ...diffPaths])]).equals(patch)) {
      throw new Error("Tracked source changed during snapshot; retry from a stable revision");
    }
    const ignored = copyAllowlistedIgnored(root, destination, options.allowlist ?? []);
    const port = allocateWorkspacePort(options.usedPorts ?? [], options.portStart ?? DEFAULT_PORT_START);
    const result: WorkspaceSnapshot = { cwd: resolve(destination, relative(root, realpathSync(source))), root: destination,
      branch, baseCommit, patchHash: createHash("sha256").update(patch).digest("hex"), files: prepared.map(file => ({ path: file.name, sha256: file.hash, kind: file.kind })),
      // What this task carried is part of the workspace record, not a log line: a conflict has
      // to stay readable after the task is created (§3.C "reports copy conflicts").
      dirtyCopy: selection === undefined
        ? { mode: "all", entries: [] }
        : { mode: selection.length === 0 ? "none" : "selected", entries: selection.map(name => classifyDirtySelection(root, name, status!)) },
      port, ...(options.setupScript ? { setupScript: options.setupScript } : {}), ...(options.runScript ? { runScript: options.runScript } : {}) };
    if (ignored.length) result.files.push(...ignored.map(file => ({ path: file.path, sha256: file.sha256, kind: "file" as const })));
    return result;
  } catch (error) {
    // Only remove the new, unexposed fixture worktree created by this operation.
    try { runGitSync(root, ["worktree", "remove", "--force", destination]); runGitSync(root, ["branch", "-D", branch]); } catch { /* Report original failure; never reset source. */ }
    throw error;
  }
}

export function reviewWorkspace(cwd: string): { available: boolean; branch?: string; diff?: string; untracked?: { path: string; text?: string; binary: boolean }[] } {
  const root = gitRoot(cwd);
  if (!root) return { available: false };
  const names = runGitSync(root, ["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
  const untracked = names.slice(0, 200).map(name => {
    const path = workspacePath(root, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) return { path: name, binary: true };
    const bytes = readFileSync(path);
    const binary = bytes.includes(0);
    return { path: name, binary, ...(binary ? {} : { text: bytes.toString("utf8") }) };
  });
  return { available: true, branch: runGitSync(root, ["branch", "--show-current"]).toString().trim(),
    diff: runGitSync(root, ["diff", "--no-ext-diff", "HEAD"]).toString(), untracked };
}

export function saveSnapshotManifest(path: string, snapshot: WorkspaceSnapshot): void {
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
}
