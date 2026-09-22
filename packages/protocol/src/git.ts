/**
 * Cedia's git protocol.
 *
 * Why this file exists (§10 item 58, "host git service is the single git
 * implementation"): every Cedia git surface — the Agent window's right-dock Git
 * pane, the IDE's review surface, the workbench branch picker, worktree
 * receipts — must read one implementation. That implementation is the host's
 * `apps/host/src/git.ts`; this module is the wire shape it answers with, so the
 * Mac extension (and the bundle behind it) never run `git` themselves.
 *
 * The shapes mirror the Agent window's own git contract (`native-git.ts`,
 * vendored from Synara) field for field, because the pane is the largest
 * consumer: the extension's job is to translate, not to compute. Where the
 * pane's contract has a shape the host must produce exactly (a status row, a
 * branch row, a diff patch), the type here is that shape with Cedia's naming
 * so the host never has to import from the vendored bundle.
 *
 * Two routes carry all of it:
 *   POST /v1/git                     one-shot operation, `{ path, method, input }`
 *   POST /v1/git/actions             start a streaming action `{ ... }` -> `{ actionId }`
 *   GET  /v1/git/actions/:id?after=  poll `{ events, done, result? }`
 *
 * `path` is a working directory, never a git object: the host authorizes it
 * against the projects, sessions and worktrees it already knows before running
 * anything (see `GitPathRejection`).
 */

export const CEDIA_GIT_PROTOCOL_VERSION = 1 as const;

/** A rejection the host must always be able to state for an authorized path. */
export type GitPathRejection =
	/** The path is not inside any project, session workspace or worktree root. */
	| "path_not_authorized"
	/** `git rev-parse` says this is not a repository (a normal state, not an error). */
	| "not_a_repository";

// ─── Shared rows ────────────────────────────────────────────────────────────

export interface GitFileStat {
	path: string;
	insertions: number;
	deletions: number;
	binary: boolean;
}

export interface GitStatusResult {
	/** `null` for a detached HEAD and for a directory that is not a repository. */
	branch: string | null;
	hasWorkingTreeChanges: boolean;
	workingTree: { files: GitFileStat[]; insertions: number; deletions: number };
	hasUpstream: boolean;
	upstreamBranch: string | null;
	aheadCount: number;
	behindCount: number;
	/** Cedia has no GitHub client, so a status never carries PR data. */
	pr: null;
}

export interface GitBranch {
	name: string;
	isRemote?: boolean;
	remoteName?: string;
	current: boolean;
	isDefault: boolean;
	worktreePath: string | null;
}

export interface GitListBranchesResult {
	branches: GitBranch[];
	isRepo: boolean;
	hasOriginRemote: boolean;
}

export interface GitRecentCommit {
	sha: string;
	shortSha: string;
	subject: string;
	committedAt: string;
}

export interface GitListRecentCommitsResult {
	commits: GitRecentCommit[];
}

/** Which slice of history a diff or file read compares against. */
export type GitDiffScope = "workingTree" | "unstaged" | "staged" | "branch" | "ref";

export interface GitDiffRequest {
	scope?: GitDiffScope;
	compareRef?: string;
	filePath?: string;
}

export interface GitDiffResult {
	patch: string;
	truncated: boolean;
}

export interface GitDiffStatsResult {
	additions: number;
	deletions: number;
	fileCount: number;
	/** Per-file counts, so a caller can classify a single path (binary hunks
	 * appear as `insertions: 0, deletions: 0, binary: true`). */
	files: GitFileStat[];
}

export interface GitReadFileAtRevRequest {
	filePath: string;
	rev?: string;
	base?: "branch" | "index";
	maxBytes?: number;
}

export interface GitReadFileAtRevResult {
	contents: string;
	resolvedRev: string;
	missing: boolean;
	truncated: boolean;
}

export interface GitStashInfoResult {
	cwd: string;
	branch: string | null;
	stashRef: string;
	message: string;
	files: string[];
}

export interface GitPullResult {
	status: "pulled" | "skipped_up_to_date";
	branch: string;
	upstreamBranch: string | null;
}

export interface GitBlameLineRequest {
	filePath: string;
	line: number;
	rev?: string;
	base?: "branch";
}

export interface GitBlameLineResult {
	sha: string;
	shortSha: string;
	author: string;
	authorEmail: string;
	authorTime: string;
	summary: string;
	uncommitted: boolean;
}

/** A repository Cedia can name without a GitHub API call, read from `origin`. */
export interface GitHubRepositoryResult {
	repository: { nameWithOwner: string; url: string } | null;
	/** Always empty: Cedia lists no repositories, it only names the current one. */
	repositories: { nameWithOwner: string; url: string }[];
}

export interface GitCreateDetachedWorktreeRequest {
	ref: string;
	/** `null`/omitted asks the host to allocate one under its worktrees root. */
	path?: string | null;
	newBranch?: string;
	/** Carry the source checkout's uncommitted state into the new worktree. */
	copyChangesFrom?: string;
}

export interface GitWorktreeResult {
	worktree: { path: string; ref: string; branch: string | null };
}

export interface GitRemoveWorktreeRequest {
	path: string;
	force?: boolean;
	reclaimTemporaryBranch?: boolean;
}

export interface GitHandoffThreadRequest {
	threadId: string;
	cwd: string;
	targetMode: "local" | "worktree";
	/** `null` while the thread's branch is still unknown; the host resolves it. */
	currentBranch: string | null;
	worktreePath?: string | null;
	associatedWorktreePath?: string | null;
	associatedWorktreeBranch?: string | null;
	associatedWorktreeRef?: string | null;
	preferredLocalBranch?: string;
	preferredWorktreeBaseBranch?: string;
	preferredNewWorktreeName?: string;
}

export interface GitHandoffThreadResult {
	targetMode: "local" | "worktree";
	/** `null` when the handoff could not establish a branch (the pane's own shape). */
	branch: string | null;
	worktreePath: string | null;
	associatedWorktreePath: string | null;
	associatedWorktreeBranch: string | null;
	associatedWorktreeRef: string | null;
	changesTransferred: boolean;
	conflictsDetected: boolean;
	message: string | null;
}

// ─── Actions (the streaming half) ───────────────────────────────────────────

export type GitStackedAction = "commit" | "push" | "commit_push";

export interface GitActionCommitResult {
	status: "created" | "skipped_no_changes" | "skipped_not_requested";
	commitSha?: string;
	subject?: string;
}

export interface GitActionPushResult {
	status: "pushed" | "skipped_not_requested" | "skipped_up_to_date";
	branch?: string;
	upstreamBranch?: string;
	setUpstream?: boolean;
}

export interface GitActionBranchResult {
	status: "created" | "skipped_not_requested";
	name?: string;
}

export interface GitRunStackedActionResult {
	action: GitStackedAction;
	branch: GitActionBranchResult;
	commit: GitActionCommitResult;
	push: GitActionPushResult;
	pr: { status: "skipped_not_requested" };
}

export type GitActionPhase = "branch" | "commit" | "push" | "worktree" | "copy-changes";

/** One progress record. `actionId` correlates it with the request. */
export type GitActionEvent =
	| { kind: "action_started"; actionId: string; phases: GitActionPhase[] }
	| { kind: "phase_started"; actionId: string; phase: GitActionPhase; label: string }
	| { kind: "hook_output"; actionId: string; hookName: string; stream: "stdout" | "stderr"; text: string }
	| { kind: "action_finished"; actionId: string; result: GitRunStackedActionResult }
	| { kind: "action_failed"; actionId: string; phase: GitActionPhase | null; message: string }
	| { kind: "worktree_completed"; actionId: string; result: GitWorktreeResult };

export interface GitStartActionRequest {
	actionId: string;
	path: string;
	/** `stacked` = commit/push phases; `worktree` = create a detached worktree. */
	kind: "stacked" | "worktree";
	action?: GitStackedAction;
	commitMessage?: string;
	featureBranch?: boolean;
	filePaths?: string[] | null;
	/** For `kind: "worktree"`: the worktree request fields. */
	worktree?: GitCreateDetachedWorktreeRequest;
	/** For `kind: "worktree"`: the bundle's own correlation id. */
	progressId?: string;
}

export interface GitActionPollResult {
	events: GitActionEvent[];
	done: boolean;
	result?: GitRunStackedActionResult | GitWorktreeResult;
	error?: string;
}

// ─── The one-shot method table ──────────────────────────────────────────────

/**
 * Every operation the host answers synchronously, with its input and result.
 * Adding a method here is the only way to add one: the router validates against
 * this table and the extension's client is typed by it.
 */
export interface GitMethodShapes {
	status: { input: Record<string, never>; result: GitStatusResult };
	listBranches: { input: Record<string, never>; result: GitListBranchesResult };
	listRecentCommits: { input: { limit?: number }; result: GitListRecentCommitsResult };
	/** Patch text for the pane's diff views and the IDE's file review. */
	readWorkingTreeDiff: { input: GitDiffRequest; result: GitDiffResult };
	workingTreeDiffStats: { input: GitDiffRequest; result: GitDiffStatsResult };
	readFileAtRev: { input: GitReadFileAtRevRequest; result: GitReadFileAtRevResult };
	/** Raw `status --porcelain=v1 -uall` text: the IDE review surface classifies
	 * staged/unstaged/conflicts from it, and re-reads it to detect staleness. */
	porcelain: { input: Record<string, never>; result: { text: string } };
	stageFiles: { input: { paths: string[] }; result: { ok: true } };
	unstageFiles: { input: { paths: string[] }; result: { ok: true } };
	createBranch: { input: { branch: string; publish?: boolean }; result: Record<string, never> };
	checkout: { input: { branch: string }; result: Record<string, never> };
	stashInfo: { input: Record<string, never>; result: GitStashInfoResult };
	stashAndCheckout: { input: { branch: string }; result: Record<string, never> };
	stashDrop: { input: { stashRef: string }; result: Record<string, never> };
	removeIndexLock: { input: Record<string, never>; result: Record<string, never> };
	init: { input: Record<string, never>; result: Record<string, never> };
	pull: { input: Record<string, never>; result: GitPullResult };
	blameLine: { input: GitBlameLineRequest; result: GitBlameLineResult };
	githubRepository: { input: Record<string, never>; result: GitHubRepositoryResult };
	createDetachedWorktree: { input: GitCreateDetachedWorktreeRequest; result: GitWorktreeResult };
	removeWorktree: { input: GitRemoveWorktreeRequest; result: Record<string, never> };
	handoffThread: { input: GitHandoffThreadRequest; result: GitHandoffThreadResult };
}

export type GitMethod = keyof GitMethodShapes;
export type GitMethodInput<M extends GitMethod> = GitMethodShapes[M]["input"];
export type GitMethodResult<M extends GitMethod> = GitMethodShapes[M]["result"];

export const GIT_METHODS: readonly GitMethod[] = [
	"status",
	"listBranches",
	"listRecentCommits",
	"readWorkingTreeDiff",
	"workingTreeDiffStats",
	"readFileAtRev",
	"porcelain",
	"stageFiles",
	"unstageFiles",
	"createBranch",
	"checkout",
	"stashInfo",
	"stashAndCheckout",
	"stashDrop",
	"removeIndexLock",
	"init",
	"pull",
	"blameLine",
	"githubRepository",
	"createDetachedWorktree",
	"removeWorktree",
	"handoffThread",
] as const;

const GIT_METHOD_SET: Readonly<Record<string, true>> = Object.fromEntries(
	GIT_METHODS.map(method => [method, true as const]),
);

export function isGitMethod(value: unknown): value is GitMethod {
	return typeof value === "string" && Boolean(GIT_METHOD_SET[value]);
}

/** The request body of `POST /v1/git`. */
export interface GitRequest {
	path: string;
	method: GitMethod;
	input?: unknown;
}

/** What the Agent window's git contract cannot be answered with, and why.
 *
 * These are GitHub-API operations. Cedia has no GitHub client (the plan retires
 * the pull-request surface for want of a source), so they are refused with a
 * stated reason rather than faked; the surfaces that call them are removed by
 * §10 item 60's tail, not by this protocol. */
export const GIT_GITHUB_UNAVAILABLE_REASON =
	"Cedia has no GitHub client: pull requests are out of scope until a source exists";
