import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
// The host runs git in exactly one place (see `apps/host/src/git.ts`); snapshotting a worktree
// uses that module's synchronous runner.
import { runGitSync } from "./git.ts";

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
  port?: number;
  setupScript?: string;
  runScript?: string;
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
}

const DEFAULT_PORT_START = 41_000;
const PORT_SPAN = 10;

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
/** Create an isolated task worktree including the selected source's uncommitted state. */
export function createWorktree(source: string, destination: string, taskId: string, options: CreateWorktreeOptions = {}): WorkspaceSnapshot {
  const root = gitRoot(source);
  if (!root) throw new Error("This folder is not a Git repository; use local mode");
  const baseCommit = runGitSync(root, ["rev-parse", options.baseRef ?? "HEAD"]).toString().trim();
  const patch = runGitSync(root, ["diff", "--no-ext-diff", "--binary", "HEAD"]);
  const untracked = runGitSync(root, ["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
  const branch = options.branch ?? `cedia/task-${taskId}`;
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
    if (!runGitSync(root, ["diff", "--no-ext-diff", "--binary", "HEAD"]).equals(patch)) throw new Error("Tracked source changed during snapshot; retry from a stable revision");
    const ignored = copyAllowlistedIgnored(root, destination, options.allowlist ?? []);
    const port = allocateWorkspacePort(options.usedPorts ?? [], options.portStart ?? DEFAULT_PORT_START);
    const result: WorkspaceSnapshot = { cwd: resolve(destination, relative(root, realpathSync(source))), root: destination,
      branch, baseCommit, patchHash: createHash("sha256").update(patch).digest("hex"), files: prepared.map(file => ({ path: file.name, sha256: file.hash, kind: file.kind })),
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
