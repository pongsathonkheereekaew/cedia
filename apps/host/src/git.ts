/**
 * The host's git implementation (§10 item 58, "host git service is the single git
 * implementation").
 *
 * Every Cedia git surface — the Agent window's right-dock Git pane, the IDE review surface, the
 * workbench branch picker, worktree receipts — is answered from here. Nothing else in the host
 * spawns `git`: `runGitSync` below is the same function `workspaces.ts` snapshots worktrees
 * through, so a task worktree and a pane diff can never disagree about the repository. The wire
 * shapes live in `packages/protocol/src/git.ts`, which is frozen; this module owns argv,
 * argument hardening, environment, timeouts, and the honest reporting of what git said.
 *
 * Ported from `apps/macos/src/agent-window-git.ts`, which ran git inside the extension. The
 * validators, argv, env policy (`GIT_TERMINAL_PROMPT=0 GIT_PAGER=cat LC_ALL=C`), 30s timeout and
 * 8 MiB output cap are that implementation's, unchanged: they are the argument hardening that
 * keeps a client-supplied revision, branch, path or commit message from being read as an option.
 */
import { execFile as nodeExecFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import {
	GIT_GITHUB_UNAVAILABLE_REASON,
	type GitActionEvent,
	type GitActionPhase,
	type GitActionPollResult,
	type GitBlameLineResult,
	type GitBranch,
	type GitCreateDetachedWorktreeRequest,
	type GitDiffResult,
	type GitDiffStatsResult,
	type GitFileStat,
	type GitHandoffThreadResult,
	type GitListBranchesResult,
	type GitListRecentCommitsResult,
	type GitMethod,
	type GitPullResult,
	type GitReadFileAtRevResult,
	type GitRunStackedActionResult,
	type GitStackedAction,
	type GitStashInfoResult,
	type GitStatusResult,
	type GitWorktreeResult,
	type GitHubRepositoryResult,
} from "../../../packages/protocol/src/git.ts";
import type { DurableStore } from "./store.ts";
// `workspaces.ts` runs its own git calls through `runGitSync` below, and `createDetachedWorktree`
// reuses its workspace-snapshot copy, so the two modules import each other. Both only call across
// from function bodies (never at module init) and both export function declarations, so the cycle
// initializes cleanly; the alternative — a separate snapshot module re-exported by
// `workspaces.ts` — would leave a shim behind the public path the workspaces test already pins.
import { collectUsedWorkspacePorts, createWorktree, loadWorkspaceBootstrap, within } from "./workspaces.ts";

const execFile = promisify(nodeExecFile);
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_SYNC_OUTPUT_BYTES = 64 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", LC_ALL: "C" } as const;
/** `git init`'s branch when the host creates a repository of its own. */
const DEFAULT_INIT_BRANCH = "main";
/** Live streaming actions kept in memory; older records expire after `ACTION_TTL_MS`. */
const MAX_ACTION_RECORDS = 32;
const ACTION_TTL_MS = 10 * 60_000;
const STASH_REF = /^stash@\{\d+\}$/;
const DIFF_SCOPES: Readonly<Record<string, true>> = { workingTree: true, unstaged: true, staged: true, branch: true, ref: true };
const STACKED_ACTIONS: Readonly<Record<string, true>> = { commit: true, push: true, commit_push: true };
/** Branches the host creates for its own worktrees, and therefore the only ones it reclaims. */
const MANAGED_WORKTREE_BRANCHES: readonly string[] = ["cedia/task-", "cedia/worktree-"];
/** The pane's transient worktree branch (`synara/<8 hex>` from the vendored bundle's helper). */
const TRANSIENT_WORKTREE_BRANCH = /^(?:cedia|synara)\/[0-9a-f]{8}$/;

/** The requested working directory is outside every root this host runs git in. */
export class GitPathNotAuthorizedError extends Error {}
/** `git` says this folder is not a repository; a caller must never read that as "no changes". */
export class GitNotARepositoryError extends Error {}
/** Too many streaming actions are live; the client must let one finish. */
export class GitCapacityError extends Error {}

interface GitOutput {
	readonly stdout: string;
	readonly stderr: string;
	readonly truncated: boolean;
	readonly failed?: boolean;
}

interface GitStatusHeader {
	readonly branch: string | null;
	readonly upstream: string | null;
	readonly ahead: number;
	readonly behind: number;
}

/** One progress record, before its `actionId` is attached. */
type HostGitActionEvent =
	| { kind: "action_started"; phases: GitActionPhase[] }
	| { kind: "phase_started"; phase: GitActionPhase; label: string }
	| { kind: "action_finished"; result: GitRunStackedActionResult }
	| { kind: "action_failed"; phase: GitActionPhase | null; message: string }
	| { kind: "worktree_completed"; result: GitWorktreeResult };

type EmitAction = (event: HostGitActionEvent) => void;

interface ActionRecord {
	readonly actionId: string;
	readonly events: GitActionEvent[];
	done: boolean;
	result?: GitRunStackedActionResult | GitWorktreeResult;
	error?: string;
	createdAt: number;
	updatedAt: number;
}

interface HandoffOutcome {
	readonly changed: boolean;
	readonly conflicts: boolean;
	readonly message: string | null;
}

const NO_HANDOFF: HandoffOutcome = { changed: false, conflicts: false, message: null };

/**
 * The synchronous runner `workspaces.ts` converged on. Argv, cwd, buffers and timeout are that
 * module's former private helper, byte for byte; the inherited environment is deliberately left
 * alone so workspace snapshotting behaves exactly as before (the async runner below adds the
 * host's terminal-prompt and locale policy, which snapshotting never needed).
 */
export function runGitSync(cwd: string, args: readonly string[], options: { input?: Buffer; timeoutMs?: number; maxBufferBytes?: number } = {}): Buffer {
	return execFileSync("git", ["-C", cwd, ...args], {
		...(options.input === undefined ? {} : { input: options.input }),
		maxBuffer: options.maxBufferBytes ?? MAX_SYNC_OUTPUT_BYTES,
		timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
	});
}

/** Every directory a git request may name: the projects this host knows, plus its worktrees. */
export function gitAuthorizedRoots(store: DurableStore): string[] {
	const roots = store.listProjects({ includeArchived: true }).map(project => project.path);
	roots.push(join(store.paths.stateDir, "worktrees"));
	return roots;
}

/** Resolve symlinks where the path exists, so `/var` and `/private/var` compare equal. */
function canonicalPath(path: string): string {
	try { return realpathSync(path); } catch { return resolve(path); }
}

/** Is this canonical path inside a project checkout or the host's worktrees root? */
export function isAuthorizedGitPath(store: DurableStore, path: string): boolean {
	return gitAuthorizedRoots(store).some(root => within(canonicalPath(root), path));
}

/** A request's working directory, refused unless the host already owns it. */
export function authorizeGitPath(store: DurableStore, value: unknown): string {
	const cwd = canonicalPath(validateCwd(value));
	if (!isAuthorizedGitPath(store, cwd)) throw new GitPathNotAuthorizedError("That folder is not an authorized Cedia workspace");
	return cwd;
}

// ─── Argument hardening (ported verbatim) ───────────────────────────────────

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Git request");
	return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maxLength = 16_384): string {
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
		throw new Error(`Invalid Git ${field}`);
	}
	return value;
}

function validateCwd(value: unknown): string {
	const cwd = text(value, "cwd");
	if (!isAbsolute(cwd)) throw new Error("Git cwd must be an absolute directory");
	const resolved = resolve(cwd);
	try {
		if (!statSync(resolved).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error("Git cwd must be an existing directory");
	}
	return resolved;
}

function validateRevision(value: unknown, field = "revision"): string {
	const revision = text(value, field, 256);
	if (revision.startsWith("-")) throw new Error(`Invalid Git ${field}`);
	return revision;
}

function validateBranch(value: unknown): string {
	const branch = text(value, "branch", 256);
	if (branch.startsWith("-") || branch === "." || branch === ".." || branch.includes("..")) throw new Error("Invalid Git branch");
	return branch;
}

function validatePath(value: unknown): string {
	const path = text(value, "file path", 2_048);
	if (isAbsolute(path) || path.split(/[\\/]/).some(part => part === "..")) throw new Error("Git file path must stay inside the workspace");
	return path;
}

function actionFilePaths(value: unknown): string[] | null {
	// The pane dialog sends null/omitted to mean "all changed files".
	if (value === undefined || value === null) return null;
	if (!Array.isArray(value) || value.length === 0) throw new Error("Git filePaths must contain at least one path");
	return value.map(path => validatePath(path));
}

function requiredFilePaths(value: unknown): string[] {
	const paths = actionFilePaths(value);
	if (!paths) throw new Error("Git paths must contain at least one path");
	return paths;
}

function actionCommitMessage(value: unknown): string {
	// The pane can generate a message when the field is blank. Keep that path deterministic here,
	// so a blank message never mutates the repository before validation fails.
	if (value === undefined || value === null) return "Update workspace";
	if (typeof value !== "string") throw new Error("Invalid Git commit message");
	if (value.trim().length === 0) return "Update workspace";
	if (value.length > 10_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error("Invalid Git commit message");
	return value.trim();
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
	return value === undefined || value === null ? null : text(value, field, maxLength);
}

function optionalBranch(value: unknown): string | null {
	return value === undefined || value === null ? null : validateBranch(value);
}

function optionalRevision(value: unknown, field: string): string | null {
	return value === undefined || value === null ? null : validateRevision(value, field);
}

/** A client-named directory: absolute, but not required to exist (a worktree destination is new). */
function optionalAbsolutePath(value: unknown, field: string): string | null {
	if (value === undefined || value === null) return null;
	const raw = text(value, field, 2_048);
	if (!isAbsolute(raw)) throw new Error(`Git ${field} must be an absolute directory`);
	return resolve(raw);
}

// ─── Parsing helpers (ported verbatim unless noted) ─────────────────────────

function parseCount(value: string | undefined): number {
	const count = Number(value ?? "0");
	return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function parseStatusHeader(value: string): GitStatusHeader {
	const header = value.trim().replace(/^##\s*/, "");
	if (!header || header.startsWith("HEAD (")) return { branch: null, upstream: null, ahead: 0, behind: 0 };
	const counts = /\[(.*?)\]/.exec(header)?.[1] ?? "";
	const ahead = parseCount(/\bahead\s+(\d+)/.exec(counts)?.[1]);
	const behind = parseCount(/\bbehind\s+(\d+)/.exec(counts)?.[1]);
	const withoutCounts = header.replace(/\s*\[.*\]\s*$/, "");
	const unborn = /^No commits yet on (.+)$/.exec(withoutCounts);
	if (unborn?.[1]) return { branch: unborn[1].trim(), upstream: null, ahead, behind };
	const marker = withoutCounts.indexOf("...");
	if (marker >= 0) {
		const branch = withoutCounts.slice(0, marker).trim() || null;
		const upstream = withoutCounts.slice(marker + 3).trim() || null;
		return { branch, upstream, ahead, behind };
	}
	const branch = withoutCounts.split(/\s+/)[0] || null;
	return { branch, upstream: null, ahead, behind };
}

/**
 * `--numstat` rows, keyed by current path.
 *
 * A binary hunk prints `-` for both counts, which the protocol's row reports explicitly as
 * `binary: true` with zero counts.
 */
function parseNumstat(value: string): Map<string, GitFileStat> {
	const result = new Map<string, GitFileStat>();
	const records = value.includes("\0") ? value.split("\0") : value.split(/\r?\n/);
	for (const line of records) {
		if (!line.trim()) continue;
		const fields = line.split("\t");
		if (fields.length < 3) continue;
		const rawPath = fields.slice(2).join("\t");
		const path = rawPath.includes(" -> ") ? rawPath.slice(rawPath.lastIndexOf(" -> ") + 4) : rawPath;
		if (!path) continue;
		const numeric = /^\d+$/.test(fields[0] ?? "") && /^\d+$/.test(fields[1] ?? "");
		const insertions = numeric ? Number(fields[0]) : 0;
		const deletions = numeric ? Number(fields[1]) : 0;
		const current = result.get(path);
		result.set(path, {
			path,
			insertions: (current?.insertions ?? 0) + insertions,
			deletions: (current?.deletions ?? 0) + deletions,
			binary: (current?.binary ?? false) || !numeric,
		});
	}
	return result;
}

function defaultBranchName(output: string): string | null {
	const value = output.trim();
	if (!value) return null;
	const prefix = "origin/";
	return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function parseWorktrees(value: string): Map<string, string> {
	const result = new Map<string, string>();
	let path: string | undefined;
	for (const line of value.split(/\r?\n/)) {
		if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
		if (line.startsWith("branch refs/heads/") && path) {
			result.set(line.slice("branch refs/heads/".length), path);
			path = undefined;
		}
	}
	return result;
}

/** `git worktree list --porcelain` as rows, in the order git prints them (the main worktree first). */
function parseWorktreeRows(value: string): { path: string; branch: string | null }[] {
	const rows: { path: string; branch: string | null }[] = [];
	let path: string | undefined;
	for (const line of value.split(/\r?\n/)) {
		if (line.startsWith("worktree ")) {
			if (path !== undefined) rows.push({ path, branch: null });
			path = line.slice("worktree ".length);
		} else if (line.startsWith("branch refs/heads/") && path !== undefined) {
			rows.push({ path, branch: line.slice("branch refs/heads/".length) });
			path = undefined;
		} else if (line === "detached" && path !== undefined) {
			rows.push({ path, branch: null });
			path = undefined;
		}
	}
	if (path !== undefined) rows.push({ path, branch: null });
	return rows;
}

function actionPhases(action: GitStackedAction, featureBranch = false): GitActionPhase[] {
	const phases: GitActionPhase[] = [];
	if (featureBranch) phases.push("branch");
	if (action === "commit" || action === "commit_push") phases.push("commit");
	if (action === "push" || action === "commit_push") phases.push("push");
	return phases;
}

function uniqueFeatureBranchName(branches: GitBranch[]): string {
	const existing = new Set(branches.filter(branch => !branch.isRemote).map(branch => branch.name.toLowerCase()));
	const base = "cedia/update";
	if (!existing.has(base)) return base;
	let suffix = 2;
	while (existing.has(`${base}-${suffix}`)) suffix += 1;
	return `${base}-${suffix}`;
}

function isGitStackedAction(value: unknown): value is GitStackedAction {
	return typeof value === "string" && STACKED_ACTIONS[value] === true;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** git's diagnosis, collapsed to one bounded line. */
function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim().slice(0, 400);
}

function slugBranchFragment(value: string): string {
	const slug = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 48);
	return slug || "worktree";
}

/** A branch a worktree was born on: the host's own namespaces, or the pane's transient one. */
function isManagedWorktreeBranch(branch: string): boolean {
	return MANAGED_WORKTREE_BRANCHES.some(prefix => branch.startsWith(prefix)) || TRANSIENT_WORKTREE_BRANCH.test(branch);
}

// ─── The service ────────────────────────────────────────────────────────────

export interface HostGitOptions {
	/** The host store: its projects are the authorized roots and its state directory holds them. */
	readonly store: DurableStore;
	readonly gitExecutable?: string;
	readonly timeoutMs?: number;
	readonly maxOutputBytes?: number;
	readonly now?: () => Date;
}

export interface HostGitService {
	/** One `POST /v1/git`: an authorized working directory, a method, and its input. */
	request(request: { path: unknown; method: GitMethod; input?: unknown }): Promise<unknown>;
	/** One `POST /v1/git/actions`: validate now, stream later, answer with the action id. */
	startAction(value: unknown): { actionId: string };
	/** One `GET /v1/git/actions/:id?after=`: events past the cursor, `undefined` when unknown. */
	pollAction(actionId: string, after: number): GitActionPollResult | undefined;
}

export function createHostGit(options: HostGitOptions): HostGitService {
	const store = options.store;
	const executable = options.gitExecutable ?? "git";
	const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
	const maxOutputBytes = options.maxOutputBytes ?? MAX_GIT_OUTPUT_BYTES;
	const now = options.now ?? (() => new Date());
	const stateDir = store.paths.stateDir;
	const actions = new Map<string, ActionRecord>();

	async function runGit(cwd: string, args: readonly string[], runOptions: { allowFailure?: boolean; outputLimit?: number } = {}): Promise<GitOutput> {
		const outputLimit = runOptions.outputLimit ?? maxOutputBytes;
		try {
			const result = await execFile(executable, [...args], {
				cwd,
				env: { ...process.env, ...GIT_ENV },
				encoding: "utf8",
				timeout: timeoutMs,
				maxBuffer: outputLimit,
				windowsHide: true,
			});
			return { stdout: String(result.stdout), stderr: String(result.stderr), truncated: false, failed: false };
		} catch (error) {
			if (runOptions.allowFailure) {
				const failure = error as { stdout?: unknown; stderr?: unknown; code?: unknown };
				// A child killed by the buffer cap is a truncation, not a failure to report.
				return { stdout: String(failure.stdout ?? ""), stderr: String(failure.stderr ?? ""), truncated: failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", failed: true };
			}
			const failure = error as { stderr?: unknown; message?: unknown; code?: unknown };
			const detail = String(failure.stderr ?? failure.message ?? "Git command failed").trim();
			throw new Error(detail || `Git command failed (${String(failure.code ?? "unknown")})`);
		}
	}

	// ─── Reads ────────────────────────────────────────────────────────────

	async function status(cwd: string): Promise<GitStatusResult> {
		const probe = await runGit(cwd, ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"], { allowFailure: true });
		if (probe.stderr.includes("not a git repository")) {
			// A directory that is not a repository is a normal state the pane renders as "no
			// branch yet", not an error.
			return { branch: null, hasWorkingTreeChanges: false, workingTree: { files: [], insertions: 0, deletions: 0 }, hasUpstream: false, upstreamBranch: null, aheadCount: 0, behindCount: 0, pr: null };
		}
		if (probe.failed) throw new Error(probe.stderr.trim() || "Unable to read Git status");
		if (probe.stderr && !probe.stdout) throw new Error(probe.stderr.trim() || "Unable to read Git status");
		const records = probe.stdout.includes("\0") ? probe.stdout.split("\0") : probe.stdout.split(/\r?\n/);
		const header = parseStatusHeader(records[0] ?? "");
		const entries: string[] = [];
		for (let index = 1; index < records.length; index += 1) {
			const line = records[index] ?? "";
			if (line.length < 3 || line.startsWith("##")) continue;
			const statusCode = line.slice(0, 2);
			const rawPath = line.slice(3);
			// In NUL mode rename/copy records carry the old path in the following record; the
			// first path is the current path we expose to the UI.
			if (/^[RC]/.test(statusCode) && probe.stdout.includes("\0")) index += 1;
			const path = !probe.stdout.includes("\0") && rawPath.includes(" -> ")
				? rawPath.slice(rawPath.lastIndexOf(" -> ") + 4)
				: rawPath;
			if (path) entries.push(path);
		}
		const [unstaged, staged] = await Promise.all([
			runGit(cwd, ["diff", "--no-ext-diff", "--numstat", "-z"], { allowFailure: true }),
			runGit(cwd, ["diff", "--no-ext-diff", "--cached", "--numstat", "-z"], { allowFailure: true }),
		]);
		const counts = parseNumstat(unstaged.stdout);
		for (const [path, value] of parseNumstat(staged.stdout)) {
			const current = counts.get(path);
			counts.set(path, {
				path,
				insertions: (current?.insertions ?? 0) + value.insertions,
				deletions: (current?.deletions ?? 0) + value.deletions,
				binary: (current?.binary ?? false) || value.binary,
			});
		}
		// An untracked path has no numstat row at all, so its `binary` flag stays false: numstat
		// cannot classify a file git does not diff, and reading every untracked byte on each
		// status poll would cost more than the badge is worth.
		const files = [...new Set(entries)].map(path => counts.get(path) ?? { path, insertions: 0, deletions: 0, binary: false });
		const insertions = files.reduce((sum, file) => sum + file.insertions, 0);
		const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
		return {
			branch: header.branch,
			hasWorkingTreeChanges: files.length > 0,
			workingTree: { files, insertions, deletions },
			hasUpstream: header.upstream !== null,
			upstreamBranch: header.upstream,
			aheadCount: header.ahead,
			behindCount: header.behind,
			pr: null,
		};
	}

	async function listBranches(cwd: string): Promise<GitListBranchesResult> {
		const probe = await runGit(cwd, ["rev-parse", "--git-dir"], { allowFailure: true });
		if (probe.stderr.includes("not a git repository") || !probe.stdout.trim()) return { branches: [], isRepo: false, hasOriginRemote: false };
		if (probe.failed) throw new Error(probe.stderr.trim() || "Unable to inspect Git repository");
		const [branchesOutput, origin, defaultRef, worktreeOutput, current] = await Promise.all([
			runGit(cwd, ["branch", "--all", "--no-color", "--format=%(refname)%09%(HEAD)%09%(upstream:short)"]),
			runGit(cwd, ["remote", "get-url", "origin"], { allowFailure: true }),
			runGit(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { allowFailure: true }),
			runGit(cwd, ["worktree", "list", "--porcelain"], { allowFailure: true }),
			runGit(cwd, ["branch", "--show-current"], { allowFailure: true }),
		]);
		const defaultName = defaultBranchName(defaultRef.stdout) ?? (branchesOutput.stdout.split(/\r?\n/).some(line => line.startsWith("refs/heads/main\t")) ? "main" : branchesOutput.stdout.split(/\r?\n/).some(line => line.startsWith("refs/heads/master\t")) ? "master" : null);
		const worktrees = parseWorktrees(worktreeOutput.stdout);
		const branches = branchesOutput.stdout.split(/\r?\n/).flatMap(line => {
			if (!line.trim()) return [];
			const [rawName, head] = line.split("\t");
			if (!rawName) return [];
			const isRemote = rawName.startsWith("refs/remotes/");
			const isLocal = rawName.startsWith("refs/heads/");
			if (!isRemote && !isLocal) return [];
			const name = isRemote ? rawName.slice("refs/remotes/".length) : rawName.slice("refs/heads/".length);
			if (isRemote && name.endsWith("/HEAD")) return [];
			const remoteName = isRemote ? name.split("/", 1)[0] : undefined;
			const localName = isRemote && remoteName ? name.slice(remoteName.length + 1) : name;
			return [{ name, ...(isRemote ? { isRemote: true, remoteName } : {}), current: !isRemote && (head?.trim() === "*" || current.stdout.trim() === name), isDefault: localName === defaultName, worktreePath: !isRemote ? (worktrees.get(name) ?? null) : null }];
		});
		return { branches, isRepo: true, hasOriginRemote: Boolean(origin.stdout.trim()) };
	}

	async function listRecentCommits(cwd: string, input: Record<string, unknown>): Promise<GitListRecentCommitsResult> {
		const limitValue = input.limit === undefined ? 20 : input.limit;
		if (typeof limitValue !== "number" || !Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 50) throw new Error("Invalid Git commit limit");
		const result = await runGit(cwd, ["log", `-${String(limitValue)}`, "--date=iso-strict", "--format=%H%x09%h%x09%cI%x09%s"]);
		const commits = result.stdout.split(/\r?\n/).flatMap(line => {
			if (!line) return [];
			const fields = line.split("\t");
			if (fields.length < 4 || !fields[0] || !fields[1] || !fields[2]) return [];
			return [{ sha: fields[0], shortSha: fields[1], committedAt: fields[2], subject: fields.slice(3).join("\t") }];
		});
		return { commits };
	}

	async function resolveDiffBase(cwd: string, input: Record<string, unknown>): Promise<string | null> {
		if (input.scope === "ref") return validateRevision(input.compareRef, "compareRef");
		if (input.scope !== "branch") return null;
		if (input.compareRef !== undefined) return validateRevision(input.compareRef, "compareRef");
		const upstream = await runGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { allowFailure: true });
		if (upstream.stdout.trim()) return validateRevision(upstream.stdout.trim(), "compareRef");
		const defaultRef = await runGit(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { allowFailure: true });
		if (defaultRef.stdout.trim()) return validateRevision(defaultRef.stdout.trim(), "compareRef");
		return null;
	}

	async function diffArgs(cwd: string, input: Record<string, unknown>, numstat: boolean): Promise<string[]> {
		const scope = input.scope === undefined ? "workingTree" : text(input.scope, "scope", 32);
		if (DIFF_SCOPES[scope] !== true) throw new Error("Invalid Git diff scope");
		const filePath = input.filePath === undefined ? undefined : validatePath(input.filePath);
		const args = [...(filePath ? ["--literal-pathspecs"] : []), "diff", "--no-ext-diff", "--no-color", ...(numstat ? ["--numstat"] : ["--binary"])];
		if (scope === "staged") args.push("--cached");
		if (scope === "workingTree") args.push("HEAD");
		if (scope === "branch" || scope === "ref") {
			const base = await resolveDiffBase(cwd, { ...input, scope });
			if (!base) {
				args.push("--", ...(filePath ? [filePath] : []));
				return args;
			}
			args.push(`${base}...HEAD`);
		}
		args.push("--");
		if (filePath) args.push(filePath);
		return args;
	}

	async function readWorkingTreeDiff(cwd: string, input: Record<string, unknown>): Promise<GitDiffResult> {
		const result = await runGit(cwd, await diffArgs(cwd, input, false));
		return { patch: result.stdout, truncated: result.truncated };
	}

	async function workingTreeDiffStats(cwd: string, input: Record<string, unknown>): Promise<GitDiffStatsResult> {
		const result = await runGit(cwd, await diffArgs(cwd, input, true));
		const files = [...parseNumstat(result.stdout).values()];
		let additions = 0;
		let deletions = 0;
		for (const file of files) {
			additions += file.insertions;
			deletions += file.deletions;
		}
		return { additions, deletions, fileCount: files.length, files };
	}

	async function readFileAtRev(cwd: string, input: Record<string, unknown>): Promise<GitReadFileAtRevResult> {
		const filePath = validatePath(input.filePath);
		const maxBytesValue = input.maxBytes === undefined ? 1_000_000 : input.maxBytes;
		if (typeof maxBytesValue !== "number" || !Number.isSafeInteger(maxBytesValue) || maxBytesValue < 1 || maxBytesValue > 1_000_000) throw new Error("Invalid Git file size limit");
		const base = input.base === undefined ? undefined : text(input.base, "base", 32);
		if (base !== undefined && base !== "branch" && base !== "index") throw new Error("Invalid Git file base");
		let resolvedRev: string;
		if (input.rev !== undefined) {
			resolvedRev = validateRevision(input.rev, "revision");
		} else if (base === "index") {
			resolvedRev = ":0";
		} else if (base === "branch") {
			resolvedRev = (await resolveDiffBase(cwd, { scope: "branch" })) ?? "HEAD";
		} else {
			resolvedRev = "HEAD";
		}
		const result = await runGit(cwd, ["--literal-pathspecs", "show", `${resolvedRev}:${filePath}`], { allowFailure: true, outputLimit: maxBytesValue });
		if (result.truncated) return { contents: result.stdout.slice(0, maxBytesValue), resolvedRev, missing: false, truncated: true };
		if (result.failed) {
			const detail = result.stderr.trim();
			if (/does not exist|exists on disk, but not in|path .* does not exist/i.test(detail)) return { contents: "", resolvedRev, missing: true, truncated: false };
			throw new Error(detail || "Unable to read Git file revision");
		}
		return { contents: result.stdout, resolvedRev, missing: false, truncated: false };
	}

	async function porcelain(cwd: string): Promise<{ text: string }> {
		const result = await runGit(cwd, ["status", "--porcelain=v1", "-uall"], { allowFailure: true });
		// The result carries entries only: a caller cannot tell an empty repository from a folder
		// that is not one, and the review surface must say "not a Git repository" rather than
		// silently report no changes. So this is the one method that states the rejection.
		if (result.stderr.includes("not a git repository")) throw new GitNotARepositoryError("This folder is not a git repository");
		if (result.failed) throw new Error(result.stderr.trim() || "Unable to read Git status");
		return { text: result.stdout };
	}

	async function blameLine(cwd: string, input: Record<string, unknown>): Promise<GitBlameLineResult> {
		const filePath = validatePath(input.filePath);
		const line = input.line;
		if (typeof line !== "number" || !Number.isSafeInteger(line) || line < 1 || line > 10_000_000) throw new Error("Invalid Git blame line");
		const base = input.base === undefined ? undefined : text(input.base, "base", 32);
		if (base !== undefined && base !== "branch") throw new Error("Invalid Git blame base");
		let rev: string | null = null;
		if (input.rev !== undefined) rev = validateRevision(input.rev, "revision");
		else if (base === "branch") rev = await resolveDiffBase(cwd, { scope: "branch" });
		const result = await runGit(cwd, ["blame", "--line-porcelain", "-L", `${line},${line}`, ...(rev ? [rev] : []), "--", filePath]);
		const lines = result.stdout.split(/\r?\n/);
		const sha = (lines[0] ?? "").split(" ")[0] ?? "";
		const fields = new Map<string, string>();
		for (const record of lines.slice(1)) {
			if (record.startsWith("\t")) break;
			const separator = record.indexOf(" ");
			const key = separator < 0 ? record : record.slice(0, separator);
			fields.set(key, separator < 0 ? "" : record.slice(separator + 1));
		}
		const author = fields.get("author") ?? "";
		const mail = fields.get("author-mail") ?? "";
		const seconds = Number(fields.get("author-time") ?? "");
		const uncommitted = /^0{40}$/.test(sha);
		return {
			sha,
			shortSha: sha.slice(0, 7),
			author,
			authorEmail: mail.replace(/^</, "").replace(/>$/, ""),
			authorTime: Number.isSafeInteger(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : "",
			summary: fields.get("summary") ?? "",
			uncommitted,
		};
	}

	async function githubRepository(cwd: string): Promise<GitHubRepositoryResult> {
		const origin = await runGit(cwd, ["remote", "get-url", "origin"], { allowFailure: true });
		const raw = origin.stdout.trim();
		// No origin (or an origin this host cannot name) is a normal state: Cedia has no GitHub
		// client, so the pane simply shows no repository.
		if (origin.failed || !raw) return { repository: null, repositories: [] };
		return { repository: parseOrigin(raw), repositories: [] };
	}

	async function stashInfo(cwd: string): Promise<GitStashInfoResult> {
		const list = await runGit(cwd, ["stash", "list", "--format=%gd%x09%s"]);
		const first = list.stdout.split(/\r?\n/).find(line => line.trim().length > 0);
		if (!first) throw new Error("There is no stash in this repository");
		const [rawRef, ...rest] = first.split("\t");
		const stashRef = (rawRef ?? "").trim();
		if (!stashRef) throw new Error("There is no stash in this repository");
		let files = await runGit(cwd, ["stash", "show", "--include-untracked", "--name-only", "-z", stashRef], { allowFailure: true });
		// Older git has no `--include-untracked` for `stash show`; the tracked files are still
		// worth listing rather than pretending the stash is empty.
		if (files.failed) files = await runGit(cwd, ["stash", "show", "--name-only", "-z", stashRef], { allowFailure: true });
		const message = rest.join("\t").trim();
		return { cwd, branch: (await status(cwd)).branch, stashRef, message: message || stashRef, files: files.stdout.split("\0").filter(Boolean) };
	}

	// ─── Writes ───────────────────────────────────────────────────────────

	async function stageFiles(cwd: string, input: Record<string, unknown>): Promise<{ ok: true }> {
		const paths = requiredFilePaths(input.paths);
		await runGit(cwd, ["--literal-pathspecs", "add", "--", ...paths]);
		return { ok: true };
	}

	async function unstageFiles(cwd: string, input: Record<string, unknown>): Promise<{ ok: true }> {
		const paths = requiredFilePaths(input.paths);
		const head = await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], { allowFailure: true });
		// `restore --staged` needs a HEAD to restore from; before the first commit the index is
		// emptied instead, which is what "unstage" means on an unborn branch.
		if (head.stdout.trim()) await runGit(cwd, ["--literal-pathspecs", "restore", "--staged", "--", ...paths]);
		else await runGit(cwd, ["--literal-pathspecs", "rm", "--cached", "-r", "--quiet", "--", ...paths]);
		return { ok: true };
	}

	async function init(cwd: string): Promise<Record<string, never>> {
		// Respect the repository this folder already belongs to: initialising a nested repository
		// inside a checkout would shadow it and change what every later git call answers for these
		// files. Idempotent by construction — an existing repository is left completely alone, so
		// the pane's "initialise" action can never re-point a branch or rewrite HEAD.
		const probe = await runGit(cwd, ["rev-parse", "--show-toplevel"], { allowFailure: true });
		if (!probe.failed && probe.stdout.trim()) return {};
		await runGit(cwd, ["init", "-b", DEFAULT_INIT_BRANCH, "--quiet"]);
		return {};
	}

	async function pull(cwd: string): Promise<GitPullResult> {
		const current = await status(cwd);
		if (!current.branch) throw new Error("Git pull requires a checked out branch");
		if (!current.hasUpstream) throw new Error(`Branch '${current.branch}' has no upstream to pull from`);
		// Always ask git. A fast-forward-only pull also fetches, while `status` can only compare
		// against the remote-tracking ref the last fetch left behind — so short-circuiting on
		// "0 behind" would report "up to date" for a remote that has since moved. A diverged
		// branch fails here rather than merging by surprise.
		const result = await runGit(cwd, ["pull", "--ff-only"]);
		const after = await status(cwd);
		const upToDate = /already up[- ]to[- ]date/i.test(`${result.stdout}\n${result.stderr}`);
		return { status: upToDate ? "skipped_up_to_date" : "pulled", branch: after.branch ?? current.branch, upstreamBranch: after.upstreamBranch ?? current.upstreamBranch };
	}

	async function ensureClean(cwd: string): Promise<void> {
		const current = await status(cwd);
		if (current.hasWorkingTreeChanges) throw new Error("Cannot checkout with uncommitted changes; stash or commit them first.");
	}

	async function checkoutBranch(cwd: string, branch: string): Promise<void> {
		// A remote row such as `origin/feature` must become a local tracking branch. Plain
		// `git checkout origin/feature` leaves the worktree in a detached HEAD, which makes the
		// Environment branch picker misleading.
		const local = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { allowFailure: true });
		if (!local.failed) {
			await runGit(cwd, ["checkout", "--quiet", branch]);
			return;
		}
		const remote = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/${branch}`], { allowFailure: true });
		if (remote.failed) {
			await runGit(cwd, ["checkout", "--quiet", branch]);
			return;
		}
		const remoteParts = branch.split("/");
		const localName = remoteParts.length > 1 ? remoteParts.slice(1).join("/") : branch;
		const localCounterpart = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${localName}`], { allowFailure: true });
		await runGit(cwd, localCounterpart.failed
			? ["checkout", "--quiet", "--track", branch]
			: ["checkout", "--quiet", localName]);
	}

	async function checkout(cwd: string, input: Record<string, unknown>): Promise<Record<string, never>> {
		const branch = validateBranch(input.branch);
		await ensureClean(cwd);
		await checkoutBranch(cwd, branch);
		return {};
	}

	async function createBranch(cwd: string, input: Record<string, unknown>): Promise<Record<string, never>> {
		const branch = validateBranch(input.branch);
		if (input.publish !== undefined && typeof input.publish !== "boolean") throw new Error("Invalid Git publish flag");
		await runGit(cwd, ["branch", "--", branch]);
		if (input.publish === true) await runGit(cwd, ["push", "--set-upstream", "origin", branch]);
		return {};
	}

	async function stashAndCheckout(cwd: string, input: Record<string, unknown>): Promise<Record<string, never>> {
		const branch = validateBranch(input.branch);
		const before = await status(cwd);
		const stashed = before.hasWorkingTreeChanges;
		if (stashed) await runGit(cwd, ["stash", "push", "--include-untracked", "--message", `cedia: before checkout of ${branch}`]);
		try {
			await ensureClean(cwd);
			await checkoutBranch(cwd, branch);
		} catch (error) {
			// The checkout failed after the changes were saved. Say where they are: the caller can
			// recover every byte with `git stash pop`, and silence here would lose that thread.
			if (stashed) throw new Error(`${oneLine(errorText(error))} Your changes are saved in the stash (git stash pop).`);
			throw error;
		}
		return {};
	}

	async function stashDrop(cwd: string, input: Record<string, unknown>): Promise<Record<string, never>> {
		const stashRef = text(input.stashRef, "stash ref", 64);
		if (!STASH_REF.test(stashRef)) throw new Error("Invalid Git stash ref");
		await runGit(cwd, ["stash", "drop", stashRef]);
		return {};
	}

	async function removeIndexLock(cwd: string): Promise<Record<string, never>> {
		const gitDir = (await runGit(cwd, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
		if (!gitDir) throw new Error("Unable to locate the Git directory");
		const lock = join(gitDir, "index.lock");
		// The only path this method can ever touch is `<git dir>/index.lock`. An absent lock is a
		// normal outcome (it was already released, or another surface removed it) and the protocol
		// result carries no field to report it in, so it is a no-op rather than an error.
		if (!existsSync(lock)) return {};
		// A user file is never deleted: a symlink or a directory wearing the lock's name is
		// refused instead of followed.
		const info = lstatSync(lock);
		if (!info.isFile() || info.isSymbolicLink()) throw new Error("Refusing to remove .git/index.lock: it is not a regular file");
		unlinkSync(lock);
		return {};
	}

	// ─── Worktrees ────────────────────────────────────────────────────────

	async function uniqueBranchName(cwd: string, base: string): Promise<string> {
		let candidate = base;
		let suffix = 2;
		while (!(await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], { allowFailure: true })).failed) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
			if (suffix > 100) throw new Error("Unable to find a free branch name for the worktree");
		}
		return candidate;
	}

	/** Resolve one worktree's details against the authorized roots before any git call. */
	function authorizeWorktreePath(path: string): string {
		if (!isAuthorizedGitPath(store, canonicalPath(path))) throw new GitPathNotAuthorizedError("That worktree is not an authorized Cedia workspace");
		return path;
	}

	function worktreeRequest(value: unknown): GitCreateDetachedWorktreeRequest {
		const input = value === undefined || value === null ? {} : record(value);
		const ref = validateRevision(input.ref);
		const path = optionalAbsolutePath(input.path, "worktree path");
		const newBranch = optionalBranch(input.newBranch);
		const copyChangesFrom = optionalAbsolutePath(input.copyChangesFrom, "copyChangesFrom");
		return { ref, path, ...(newBranch === null ? {} : { newBranch }), ...(copyChangesFrom === null ? {} : { copyChangesFrom }) };
	}

	async function createDetachedWorktree(cwd: string, request: GitCreateDetachedWorktreeRequest): Promise<GitWorktreeResult> {
		const id = randomUUID();
		const requested = request.path ?? null;
		if (requested) authorizeWorktreePath(requested);
		const destination = requested ?? join(stateDir, "worktrees", id);
		if (request.copyChangesFrom !== undefined) {
			// The snapshot copy is `createWorktree`'s: it carries tracked edits and untracked
			// files (symlinks included) into the new checkout and verifies both sides did not
			// change underneath it. The repository it adds to is the copy source's, which is also
			// where `ref` resolves. A snapshot always lands on a branch — a copy has a branch to
			// land on or the worktree would be unreachable from any ref — so a copy request
			// without a name gets a host-managed one, and the result reports what really happened.
			const source = authorizeGitPath(store, request.copyChangesFrom);
			const branch = request.newBranch ?? `cedia/worktree-${id.slice(0, 8)}`;
			const bootstrap = loadWorkspaceBootstrap(source);
			const snapshot = createWorktree(source, destination, id, {
				baseRef: request.ref,
				branch,
				...(bootstrap.ignoreAllowlist ? { allowlist: bootstrap.ignoreAllowlist } : {}),
				...(bootstrap.setupScript ? { setupScript: bootstrap.setupScript } : {}),
				...(bootstrap.runScript ? { runScript: bootstrap.runScript } : {}),
				...(bootstrap.portStart ? { portStart: bootstrap.portStart } : {}),
				usedPorts: collectUsedWorkspacePorts(stateDir),
			});
			return { worktree: { path: snapshot.root, ref: request.ref, branch: snapshot.branch } };
		}
		mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
		await runGit(cwd, request.newBranch
			? ["worktree", "add", "--quiet", "-b", request.newBranch, destination, request.ref]
			: ["worktree", "add", "--quiet", "--detach", destination, request.ref]);
		return { worktree: { path: destination, ref: request.ref, branch: request.newBranch ?? null } };
	}

	async function removeWorktree(input: Record<string, unknown>): Promise<Record<string, never>> {
		const target = optionalAbsolutePath(input.path, "worktree path");
		if (!target) throw new Error("Invalid Git worktree path");
		if (input.force !== undefined && typeof input.force !== "boolean") throw new Error("Invalid Git force flag");
		if (input.reclaimTemporaryBranch !== undefined && typeof input.reclaimTemporaryBranch !== "boolean") throw new Error("Invalid Git reclaim flag");
		authorizeWorktreePath(target);
		if (!existsSync(target)) throw new Error("That worktree folder does not exist");
		// The removal request carries no cwd, so the repository comes from the worktree's own
		// registration; the first porcelain row is always the main checkout that owns it.
		const listing = await runGit(target, ["worktree", "list", "--porcelain"], { allowFailure: true });
		if (listing.failed) throw new Error(listing.stderr.trim() || "Unable to inspect Git worktrees");
		const rows = parseWorktreeRows(listing.stdout);
		const main = rows[0];
		if (!main) throw new Error("Unable to inspect Git worktrees");
		const own = rows.find(row => canonicalPath(row.path) === canonicalPath(target));
		if (!own) throw new Error("That folder is not a Git worktree of this repository");
		await runGit(main.path, ["worktree", "remove", ...(input.force === true ? ["--force"] : []), target]);
		const branch = own.branch;
		if (input.reclaimTemporaryBranch === true && branch && isManagedWorktreeBranch(branch)) {
			// Only a branch the host itself created is reclaimed; a user-named branch survives.
			await runGit(main.path, ["branch", "--delete", "--force", branch], { allowFailure: true });
		}
		return {};
	}

	// ─── Thread handoff ───────────────────────────────────────────────────

	async function repositoryIdentity(path: string): Promise<string | null> {
		const probe = await runGit(path, ["rev-parse", "--git-common-dir"], { allowFailure: true });
		const value = probe.stdout.trim();
		return value ? canonicalPath(resolve(path, value)) : null;
	}

	/** Land uncommitted work in the checkout the thread is moving to, or say why it did not move. */
	async function transferUncommittedChanges(source: string, destination: string, label: string): Promise<HandoffOutcome> {
		const sourceRepo = await repositoryIdentity(source);
		const destinationRepo = await repositoryIdentity(destination);
		if (!sourceRepo || !destinationRepo || sourceRepo !== destinationRepo) throw new Error("The checkout and the worktree belong to different repositories, so no changes were moved");
		if (!(await status(source)).hasWorkingTreeChanges) return NO_HANDOFF;
		if ((await status(destination)).hasWorkingTreeChanges) {
			// Applying on top of another thread's edits would mix two workspaces' work; refusing
			// honestly is the only safe answer, and nothing has moved yet.
			return { changed: false, conflicts: true, message: "The destination checkout already has uncommitted changes; commit, stash or hand them off first." };
		}
		const stash = await runGit(source, ["stash", "push", "--include-untracked", "--message", `cedia handoff ${label}`], { allowFailure: true });
		if (stash.failed) return { changed: false, conflicts: true, message: oneLine(stash.stderr) || "Could not save the source changes." };
		const stashRef = (await runGit(source, ["stash", "list", "--format=%gd"], { allowFailure: true })).stdout
			.split(/\r?\n/)
			.map(line => line.trim())
			.find(line => line.length > 0);
		const applied = await runGit(destination, ["stash", "apply", ...(stashRef ? [stashRef] : [])], { allowFailure: true });
		if (applied.failed) {
			// The stash entry is deliberately kept: a conflicted handoff must never drop the work
			// the user asked to move, and the message says where the originals are.
			return { changed: true, conflicts: true, message: `The changes were saved as ${stashRef ?? "a stash entry"}, but applying them conflicted: ${oneLine(applied.stderr) || "git reported no detail"}` };
		}
		if (stashRef) await runGit(source, ["stash", "drop", stashRef], { allowFailure: true });
		return { changed: true, conflicts: false, message: null };
	}

	/** Put the local checkout on the branch the thread expects, or leave it and say so. */
	async function rehomeLocalCheckout(cwd: string, requested: string | null): Promise<{ branch: string | null; message: string | null }> {
		const current = await status(cwd);
		if (!requested || requested === current.branch) return { branch: current.branch, message: null };
		if (current.hasWorkingTreeChanges) return { branch: current.branch, message: `The local checkout has uncommitted changes, so it stays on ${current.branch ?? "its current revision"}.` };
		const exists = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${requested}`], { allowFailure: true });
		if (exists.failed) return { branch: current.branch, message: `Local branch ${requested} does not exist yet, so the checkout stays on ${current.branch ?? "its current revision"}.` };
		const switched = await runGit(cwd, ["checkout", "--quiet", requested], { allowFailure: true });
		if (switched.failed) return { branch: current.branch, message: oneLine(switched.stderr) || `Could not switch the local checkout to ${requested}.` };
		return { branch: requested, message: null };
	}

	async function handoffThread(cwd: string, input: Record<string, unknown>): Promise<GitHandoffThreadResult> {
		const threadId = text(input.threadId, "thread id", 128);
		const mode = input.targetMode;
		if (mode !== "local" && mode !== "worktree") throw new Error("Invalid Git handoff target mode");
		const currentBranch = optionalBranch(input.currentBranch);
		const worktreePath = optionalAbsolutePath(input.worktreePath, "worktree path");
		const associatedWorktreePath = optionalAbsolutePath(input.associatedWorktreePath, "worktree path");
		const associatedWorktreeBranch = optionalBranch(input.associatedWorktreeBranch);
		const associatedWorktreeRef = optionalRevision(input.associatedWorktreeRef, "worktree ref");
		const preferredLocalBranch = optionalBranch(input.preferredLocalBranch);
		const preferredWorktreeBaseBranch = optionalBranch(input.preferredWorktreeBaseBranch);
		const preferredNewWorktreeName = optionalText(input.preferredNewWorktreeName, "worktree name", 128);
		for (const path of [worktreePath, associatedWorktreePath]) if (path) authorizeWorktreePath(path);

		if (mode === "local") {
			const source = associatedWorktreePath ?? worktreePath;
			const target = await rehomeLocalCheckout(cwd, preferredLocalBranch ?? currentBranch);
			const outcome = source && canonicalPath(source) !== cwd ? await transferUncommittedChanges(source, cwd, threadId) : NO_HANDOFF;
			return {
				targetMode: "local",
				branch: target.branch,
				worktreePath: null,
				associatedWorktreePath,
				associatedWorktreeBranch,
				associatedWorktreeRef,
				changesTransferred: outcome.changed,
				conflictsDetected: outcome.conflicts,
				message: [target.message, outcome.message].filter((part): part is string => Boolean(part)).join(" ") || null,
			};
		}

		const existing = associatedWorktreePath && existsSync(associatedWorktreePath) ? associatedWorktreePath : null;
		const destination = existing ?? join(stateDir, "worktrees", randomUUID());
		const base = preferredWorktreeBaseBranch ?? preferredLocalBranch ?? currentBranch ?? (await status(cwd)).branch;
		let branch: string | null;
		if (existing) {
			branch = (await status(existing)).branch ?? associatedWorktreeBranch;
		} else {
			if (!base) throw new Error("Git handoff needs a base branch to create a worktree");
			branch = await uniqueBranchName(cwd, `cedia/task-${slugBranchFragment(preferredNewWorktreeName ?? threadId)}`);
			mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
			await runGit(cwd, ["worktree", "add", "--quiet", "-b", branch, destination, validateRevision(base, "base branch")]);
		}
		const outcome = canonicalPath(destination) === cwd ? NO_HANDOFF : await transferUncommittedChanges(cwd, destination, threadId);
		return {
			targetMode: "worktree",
			branch,
			worktreePath: destination,
			associatedWorktreePath: destination,
			associatedWorktreeBranch: branch,
			associatedWorktreeRef: existing ? associatedWorktreeRef ?? branch : base,
			changesTransferred: outcome.changed,
			conflictsDetected: outcome.conflicts,
			message: outcome.message,
		};
	}

	// ─── The stacked action ───────────────────────────────────────────────

	async function runStackedAction(cwd: string, input: Record<string, unknown>, emit: EmitAction): Promise<GitRunStackedActionResult> {
		const action = input.action;
		if (action === "create_pr" || action === "commit_push_pr") throw new Error(GIT_GITHUB_UNAVAILABLE_REASON);
		if (!isGitStackedAction(action)) throw new Error("Invalid Git action");
		if (input.featureBranch !== undefined && typeof input.featureBranch !== "boolean") throw new Error("Invalid Git featureBranch flag");
		const paths = actionFilePaths(input.filePaths);
		const message = actionCommitMessage(input.commitMessage);
		let branch = (await status(cwd)).branch;
		if (!branch) throw new Error("Git action requires a checked out branch");
		const wantsFeatureBranch = input.featureBranch === true;
		let branchStatus: GitRunStackedActionResult["branch"] = { status: "skipped_not_requested" };
		// The recorded phases are the ones this implementation really runs. Hook output is not
		// streamed — git's own hook text arrives on the command's stderr and therefore inside a
		// failure message — so no `hook_output` event is invented here.
		emit({ kind: "action_started", phases: actionPhases(action, wantsFeatureBranch) });
		let commitStatus: GitRunStackedActionResult["commit"] = { status: "skipped_not_requested" };
		let pushStatus: GitRunStackedActionResult["push"] = { status: "skipped_not_requested" };
		try {
			if (wantsFeatureBranch) {
				emit({ kind: "phase_started", phase: "branch", label: "Preparing feature branch" });
				const branches = await listBranches(cwd);
				const nextBranch = uniqueFeatureBranchName(branches.branches);
				// Unlike the user-facing checkout method, a stacked "new branch" action
				// intentionally carries the user's dirty files onto the new branch.
				await runGit(cwd, ["checkout", "--quiet", "-b", nextBranch]);
				branch = nextBranch;
				branchStatus = { status: "created", name: nextBranch };
			}
			if (action === "commit" || action === "commit_push") {
				emit({ kind: "phase_started", phase: "commit", label: "Commit" });
				// The dialog sends null/omits filePaths when all changed files are selected. Stage
				// that workspace explicitly so an unstaged edit is not silently reported as a
				// successful no-op.
				if (paths === null) await runGit(cwd, ["add", "-A", "--", "."]);
				else await runGit(cwd, ["--literal-pathspecs", "add", "--", ...paths]);
				const stagedNames = await runGit(cwd, [...(paths ? ["--literal-pathspecs"] : []), "diff", "--cached", "--name-only", ...(paths ? ["--", ...paths] : [])]);
				if (!stagedNames.stdout.trim()) {
					commitStatus = { status: "skipped_no_changes" };
				} else {
					const commitArgs = [...(paths ? ["--literal-pathspecs"] : []), "commit", "-m", message, ...(paths ? ["--only", "--", ...paths] : [])];
					await runGit(cwd, commitArgs);
					const sha = (await runGit(cwd, ["rev-parse", "HEAD"])).stdout.trim();
					commitStatus = { status: "created", ...(sha ? { commitSha: sha } : {}), subject: message };
				}
			}
			if (action === "push" || action === "commit_push") {
				emit({ kind: "phase_started", phase: "push", label: "Push" });
				const current = await status(cwd);
				if (current.behindCount > 0) throw new Error("Branch is behind upstream; pull or rebase before pushing.");
				if (current.aheadCount === 0 && current.hasUpstream) pushStatus = { status: "skipped_up_to_date", branch, ...(current.upstreamBranch ? { upstreamBranch: current.upstreamBranch } : {}) };
				else {
					if (!current.hasUpstream) {
						const origin = await runGit(cwd, ["remote", "get-url", "origin"], { allowFailure: true });
						if (origin.failed || !origin.stdout.trim()) throw new Error("Cannot push without an origin remote.");
					}
					const args = current.hasUpstream ? ["push"] : ["push", "--set-upstream", "origin", branch];
					await runGit(cwd, args);
					pushStatus = { status: "pushed", branch, ...(current.upstreamBranch ? { upstreamBranch: current.upstreamBranch } : {}), ...(current.hasUpstream ? {} : { setUpstream: true }) };
				}
			}
			const result: GitRunStackedActionResult = { action, branch: branchStatus, commit: commitStatus, push: pushStatus, pr: { status: "skipped_not_requested" } };
			emit({ kind: "action_finished", result });
			return result;
		} catch (error) {
			emit({ kind: "action_failed", phase: null, message: errorText(error) });
			throw error;
		}
	}

	// ─── The actions registry ─────────────────────────────────────────────

	function pruneActions(): void {
		const nowMs = now().getTime();
		for (const [id, action] of actions) if (nowMs - action.updatedAt > ACTION_TTL_MS) actions.delete(id);
	}

	async function runAction(action: ActionRecord, cwd: string, input: Record<string, unknown>): Promise<void> {
		const emit = (event: HostGitActionEvent): void => {
			action.events.push({ ...event, actionId: action.actionId });
			action.updatedAt = now().getTime();
		};
		try {
			if (input.kind === "worktree") {
				const request = worktreeRequest(input.worktree);
				if (request.newBranch) emit({ kind: "phase_started", phase: "branch", label: "Create branch" });
				emit({ kind: "phase_started", phase: "worktree", label: "Create worktree" });
				if (request.copyChangesFrom) emit({ kind: "phase_started", phase: "copy-changes", label: "Copy local changes" });
				const result = await createDetachedWorktree(cwd, request);
				emit({ kind: "worktree_completed", result });
				action.result = result;
			} else {
				action.result = await runStackedAction(cwd, input, emit);
			}
		} catch (error) {
			action.error = errorText(error);
		} finally {
			action.done = true;
			action.updatedAt = now().getTime();
		}
	}

	function startAction(value: unknown): { actionId: string } {
		const input = record(value);
		const actionId = text(input.actionId, "action id", 128);
		const cwd = authorizeGitPath(store, input.path);
		if (input.kind !== "stacked" && input.kind !== "worktree") throw new Error("Invalid Git action kind");
		if (input.progressId !== undefined && input.progressId !== null) text(input.progressId, "progress id", 128);
		// Everything the runner needs is validated before the id is handed back, so a malformed
		// request is a refusal rather than an action that dies a moment later.
		if (input.kind === "stacked") {
			if (!isGitStackedAction(input.action)) throw new Error("Invalid Git action");
			if (input.featureBranch !== undefined && typeof input.featureBranch !== "boolean") throw new Error("Invalid Git featureBranch flag");
			actionFilePaths(input.filePaths);
			actionCommitMessage(input.commitMessage);
		} else {
			worktreeRequest(input.worktree);
		}
		pruneActions();
		if (actions.size >= MAX_ACTION_RECORDS) throw new GitCapacityError("Too many git actions are already running; wait for one to finish");
		const at = now().getTime();
		const action: ActionRecord = { actionId, events: [], done: false, createdAt: at, updatedAt: at };
		actions.set(actionId, action);
		void runAction(action, cwd, input);
		return { actionId };
	}

	function pollAction(actionId: string, after: number): GitActionPollResult | undefined {
		const action = actions.get(actionId);
		if (!action) return undefined;
		return {
			events: after <= 0 ? [...action.events] : action.events.slice(after),
			done: action.done,
			...(action.result === undefined ? {} : { result: action.result }),
			...(action.error === undefined ? {} : { error: action.error }),
		};
	}

	// ─── Dispatch ─────────────────────────────────────────────────────────

	const methods: { [M in GitMethod]: (cwd: string, input: Record<string, unknown>) => Promise<unknown> } = {
		status: cwd => status(cwd),
		listBranches: cwd => listBranches(cwd),
		listRecentCommits,
		readWorkingTreeDiff,
		workingTreeDiffStats,
		readFileAtRev,
		porcelain: cwd => porcelain(cwd),
		stageFiles,
		unstageFiles,
		createBranch,
		checkout,
		stashInfo: cwd => stashInfo(cwd),
		stashAndCheckout,
		stashDrop,
		removeIndexLock: cwd => removeIndexLock(cwd),
		init: cwd => init(cwd),
		pull: cwd => pull(cwd),
		blameLine,
		githubRepository: cwd => githubRepository(cwd),
		createDetachedWorktree: (cwd, input) => createDetachedWorktree(cwd, worktreeRequest(input)),
		removeWorktree: (_cwd, input) => removeWorktree(input),
		handoffThread,
	};

	return {
		async request(request): Promise<unknown> {
			const cwd = authorizeGitPath(store, request.path);
			const input = request.input === undefined || request.input === null ? {} : record(request.input);
			return methods[request.method](cwd, input);
		},
		startAction,
		pollAction,
	};
}

/** `origin` in any form git accepts, as a GitHub-style `owner/repo` plus a browsable URL. */
function parseOrigin(value: string): { nameWithOwner: string; url: string } | null {
	// The scp-like form is only `[user@]host:path` — a scheme's `://` and a Windows drive's `\`
	// must not be read as a host separator.
	const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?![/\\])(.+)$/.exec(value.trim());
	if (scp?.[1] && scp[2]) return namedRepository(scp[1], scp[2]);
	try {
		const url = new URL(value.trim());
		if (!url.hostname) return null;
		return namedRepository(url.hostname, url.pathname);
	} catch {
		return null;
	}
}

function namedRepository(host: string, path: string): { nameWithOwner: string; url: string } | null {
	const cleaned = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
	if (!cleaned.includes("/")) return null;
	return { nameWithOwner: cleaned, url: `https://${host}/${cleaned}` };
}
