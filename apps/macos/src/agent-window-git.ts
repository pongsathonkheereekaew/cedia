/** The Agent window's Git pane as a client of the host's git service (§10 item 58).
 *
 * Every git operation this panel performs is answered by `apps/host/src/git.ts`
 * over `POST /v1/git`, `POST /v1/git/actions` and `GET /v1/git/actions/:id`; the
 * extension owns no argv, no `git` process and no repository knowledge beyond
 * the validation of what the renderer asked for.  This module is that client:
 * it validates the pane's input, forwards the documented request, and translates
 * the host's answer into the pane's own contract
 * (`agent-window/vendor/synara/packages/contracts/src/git.ts`) so the renderer
 * keeps decoding exactly what it always did.
 *
 * Streaming actions (stacked commit/push and detached-worktree creation) run on
 * the host; this client polls their event stream and re-emits each event to the
 * submitting webview in the pane's vocabulary.
 */

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
	GIT_GITHUB_UNAVAILABLE_REASON,
	type GitActionEvent,
	type GitActionPhase,
	type GitActionPollResult,
	type GitDiffRequest,
	type GitDiffScope,
	type GitHandoffThreadRequest,
	type GitMethod,
	type GitMethodInput,
	type GitMethodResult,
	type GitReadFileAtRevRequest,
	type GitRequest,
	type GitRunStackedActionResult as HostGitRunStackedActionResult,
	type GitStartActionRequest,
	type GitWorktreeResult as HostGitWorktreeResult,
} from "../../../packages/protocol/src/git.ts";
import type {
	GitActionProgressEvent,
	GitActionProgressPhase,
	GitBlameLineResult,
	GitCreateDetachedWorktreeResult,
	GitHandoffThreadResult,
	GitHubRepositoryResult,
	GitListBranchesResult,
	GitListRecentCommitsResult,
	GitPullResult,
	GitReadFileAtRevResult,
	GitReadWorkingTreeDiffResult,
	GitRunStackedActionResult,
	GitStackedAction,
	GitStageFilesResult,
	GitStashInfoResult,
	GitStatusResult,
	GitUnstageFilesResult,
	GitWorktreeSetupPhase,
	GitWorktreeSetupProgressEvent,
	GitWorkingTreeDiffStatsResult,
} from "../agent-window/vendor/synara/packages/contracts/src/git.ts";

export const CEDIA_AGENT_GIT_EVENT_CHANNEL = "vscode:cediaAgentGit";
/** Detached-worktree progress has its own channel: the pane's setup card
 * subscribes to it separately from the stacked-action toast. */
export const CEDIA_AGENT_WORKTREE_EVENT_CHANNEL = "vscode:cediaAgentWorktree";

const GIT_ROUTE = "git";
const GIT_ACTIONS_ROUTE = "git/actions";
const DEFAULT_ACTION_POLL_INTERVAL_MS = 150;
/** A host that stops answering must not leave the pane's action polling forever. */
const DEFAULT_ACTION_POLL_TIMEOUT_MS = 30 * 60_000;
const MAX_GIT_RECENT_COMMIT_LIMIT = 50;
const MAX_GIT_FILE_BYTES = 1_000_000;

/** The host surface this panel needs.  `CediaHostClient` satisfies it as-is. */
export interface AgentGitHostClient {
	requestApplication<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}

export interface AgentGitServiceOptions {
	/** How this service reaches the host; both callers already hold one. */
	readonly ensureClient: () => Promise<AgentGitHostClient>;
	readonly actionPollIntervalMs?: number;
	readonly actionPollTimeoutMs?: number;
}

interface AgentSender {
	readonly send: (channel: string, event: unknown) => void;
	readonly isDestroyed?: () => boolean;
}

/** The pane's phases; the host's `worktree`/`copy-changes` phases are not
 * stacked-action phases, so they carry no event on this channel. */
const PANE_ACTION_PHASES: Readonly<Record<GitActionPhase, GitActionProgressPhase | null>> = {
	branch: "branch",
	commit: "commit",
	push: "push",
	worktree: null,
	"copy-changes": null,
};

/** The setup card's phases, in the bundle's vocabulary. */
const PANE_WORKTREE_PHASES: Readonly<Record<GitActionPhase, GitWorktreeSetupPhase | null>> = {
	branch: "branch",
	worktree: "worktree",
	"copy-changes": "copy-changes",
	commit: null,
	push: null,
};

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

function flag(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") throw new Error(`Invalid Git ${field} flag`);
	return value;
}

function actionFilePaths(value: unknown): string[] | null {
	// The Synara dialog uses null/omitted to mean "all changed files".
	if (value === undefined || value === null) return null;
	if (!Array.isArray(value) || value.length === 0) throw new Error("Git filePaths must contain at least one path");
	return value.map(path => validatePath(path));
}

function actionCommitMessage(value: unknown): string {
	// Synara can generate a message when the field is blank.  Keep that decision
	// here, where the dialog is, so a blank dialog never sends a blank message.
	if (value === undefined || value === null) return "Update workspace";
	if (typeof value !== "string") throw new Error("Invalid Git commit message");
	if (value.trim().length === 0) return "Update workspace";
	if (value.length > 10_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error("Invalid Git commit message");
	return value.trim();
}

function stackedAction(value: unknown): "commit" | "push" | "commit_push" {
	switch (value) {
	case "commit":
	case "push":
	case "commit_push":
		return value;
	case "create_pr":
	case "commit_push_pr":
		throw new Error(GIT_GITHUB_UNAVAILABLE_REASON);
	default:
		throw new Error("Invalid Git action");
	}
}

function diffScope(value: unknown): GitDiffScope {
	switch (value) {
	case "workingTree":
	case "unstaged":
	case "staged":
	case "branch":
	case "ref":
		return value;
	default:
		throw new Error("Invalid Git diff scope");
	}
}

function commitLimit(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_GIT_RECENT_COMMIT_LIMIT) {
		throw new Error("Invalid Git commit limit");
	}
	return value;
}

function fileBase(value: unknown): "branch" | "index" {
	if (value === "branch" || value === "index") return value;
	throw new Error("Invalid Git file base");
}

function fileMaxBytes(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_GIT_FILE_BYTES) {
		throw new Error("Invalid Git file size limit");
	}
	return value;
}

function blameBase(value: unknown): "branch" | undefined {
	if (value === undefined || value === null) return undefined;
	if (value === "branch") return "branch";
	throw new Error("Invalid Git blame base");
}

function handoffMode(value: unknown): "local" | "worktree" {
	if (value === "local" || value === "worktree") return value;
	throw new Error("Invalid Git handoff target mode");
}

function requiredFilePaths(value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0) throw new Error("Git paths must contain at least one path");
	return value.map(path => validatePath(path));
}

function stashReference(value: unknown): string {
	const reference = text(value, "stash reference", 128);
	// Only a stash entry, never a revision or a pathspec: this reference is fed
	// straight to `git stash drop`.
	if (!/^stash@\{\d+\}$/.test(reference)) throw new Error("Invalid Git stash reference");
	return reference;
}

function optionalBranchOrNull(value: unknown, field: string): string | null {
	return value === undefined || value === null ? null : validateBranch(value);
}

function optionalPathOrNull(value: unknown, field: string): string | null {
	if (value === undefined || value === null) return null;
	const path = text(value, field, 4096);
	if (!isAbsolute(path)) throw new Error(`Git ${field} must be an absolute path`);
	return resolve(path);
}

function optionalRevisionOrNull(value: unknown, field: string): string | null {
	return value === undefined || value === null ? null : validateRevision(value, field);
}

function optionalTextOrNull(value: unknown, field: string, maxLength: number): string | null {
	return value === undefined || value === null ? null : text(value, field, maxLength);
}

/** Spread an optional field so an absent value omits the key instead of sending `undefined`. */
function optional<K extends string, V>(key: K, value: V | null | undefined): Record<K, V> | Record<string, never> {
	return value === undefined || value === null ? {} : { [key]: value } as Record<K, V>;
}

function senderFromEvent(event: unknown): AgentSender {
	const value = record(event);
	const candidate = value.sender;
	if (!candidate || typeof candidate !== "object" || typeof (candidate as AgentSender).send !== "function") throw new Error("Invalid Agent Window sender");
	const sender = candidate as AgentSender;
	if (sender.isDestroyed?.()) throw new Error("Agent Window sender is destroyed");
	return sender;
}

function send(sender: AgentSender, channel: string, event: unknown): void {
	if (sender.isDestroyed?.()) return;
	try {
		sender.send(channel, event);
	} catch {
		// The renderer closed while the action was running.
	}
}

/** The pane's `GitReadWorkingTreeDiffInput`/`workingTreeDiffStats` scope, with
 * the bundle's own default made explicit so the host cannot answer a different
 * slice than the renderer asked for. */
function diffRequest(input: Record<string, unknown>): GitDiffRequest {
	const filePath = input.filePath === undefined ? undefined : validatePath(input.filePath);
	return {
		scope: diffScope(input.scope ?? "workingTree"),
		...(input.compareRef === undefined ? {} : { compareRef: validateRevision(input.compareRef, "compareRef") }),
		...(filePath === undefined ? {} : { filePath }),
	};
}

function paneStackedResult(result: HostGitRunStackedActionResult): GitRunStackedActionResult {
	const translated: GitRunStackedActionResult = {
		action: result.action,
		branch: { status: result.branch.status, name: result.branch.name },
		commit: { status: result.commit.status, commitSha: result.commit.commitSha, subject: result.commit.subject },
		push: { status: result.push.status, branch: result.push.branch, upstreamBranch: result.push.upstreamBranch, setUpstream: result.push.setUpstream },
		// The host has no GitHub client either, so a stacked action reports no PR step.
		pr: { status: result.pr.status },
	};
	return translated;
}

function paneWorktreeResult(result: HostGitWorktreeResult): GitCreateDetachedWorktreeResult {
	const translated: GitCreateDetachedWorktreeResult = {
		worktree: { path: result.worktree.path, ref: result.worktree.ref, branch: result.worktree.branch },
	};
	return translated;
}

function isStackedResult(value: HostGitRunStackedActionResult | HostGitWorktreeResult | undefined): value is HostGitRunStackedActionResult {
	return value !== undefined && "action" in value && "commit" in value;
}

function isWorktreeResult(value: HostGitRunStackedActionResult | HostGitWorktreeResult | undefined): value is HostGitWorktreeResult {
	return value !== undefined && "worktree" in value;
}

interface StackedActionBase {
	readonly actionId: string;
	readonly cwd: string;
	readonly action: GitStackedAction;
}

/** One host action event in the pane's stacked-action vocabulary.  A phase the
 * pane cannot express yields no event rather than an unknown phase. */
function paneActionEvent(event: GitActionEvent, base: StackedActionBase): GitActionProgressEvent | null {
	switch (event.kind) {
	case "action_started": {
		const phases: GitActionProgressPhase[] = [];
		for (const phase of event.phases) {
			const mapped = PANE_ACTION_PHASES[phase];
			if (mapped !== null) phases.push(mapped);
		}
		return { ...base, kind: "action_started", phases };
	}
	case "phase_started": {
		const phase = PANE_ACTION_PHASES[event.phase];
		return phase === null ? null : { ...base, kind: "phase_started", phase, label: event.label };
	}
	case "hook_output":
		return { ...base, kind: "hook_output", hookName: event.hookName, stream: event.stream, text: event.text };
	case "action_finished":
		return { ...base, kind: "action_finished", result: paneStackedResult(event.result) };
	case "action_failed": {
		const phase = event.phase === null ? null : PANE_ACTION_PHASES[event.phase];
		return { ...base, kind: "action_failed", phase, message: event.message };
	}
	case "worktree_completed":
		// Worktree events belong to the worktree channel, not to this action's toast.
		return null;
	}
}

/** One host action event in the pane's worktree-setup vocabulary, carrying the
 * caller's own `progressId` because the host's stream is correlated by action. */
function paneWorktreeEvent(event: GitActionEvent, progressId: string | null): GitWorktreeSetupProgressEvent | null {
	switch (event.kind) {
	case "phase_started": {
		const phase = PANE_WORKTREE_PHASES[event.phase];
		return phase === null ? null : { progressId, kind: "phase_started", phase };
	}
	case "worktree_completed":
		return { progressId, kind: "completed", result: paneWorktreeResult(event.result) };
	case "action_started":
	case "hook_output":
	case "action_finished":
	case "action_failed":
		return null;
	}
}

interface PollOptions {
	readonly client: AgentGitHostClient;
	readonly actionId: string;
	readonly intervalMs: number;
	readonly timeoutMs: number;
	readonly isDisposed: () => boolean;
	readonly onEvent: (event: GitActionEvent) => void;
}

/** Follow one host action to its terminal record, forwarding every event as it
 * arrives.  `after` is a count of events already delivered, not a timestamp. */
async function pollAction(options: PollOptions): Promise<GitActionPollResult> {
	const startedAt = Date.now();
	let cursor = 0;
	for (;;) {
		if (options.isDisposed()) throw new Error("Git service is disposed");
		const page = await options.client.requestApplication<GitActionPollResult>(
			"GET",
			`${GIT_ACTIONS_ROUTE}/${encodeURIComponent(options.actionId)}?after=${cursor}`,
		);
		cursor += page.events.length;
		for (const event of page.events) options.onEvent(event);
		if (page.done) return page;
		if (Date.now() - startedAt >= options.timeoutMs) {
			throw new Error(`Git action did not finish within ${Math.round(options.timeoutMs / 1000)}s`);
		}
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, options.intervalMs);
		await promise;
	}
}

export interface AgentGitService {
	handle(event: unknown, method: string, input: unknown): Promise<unknown>;
	dispose(): void;
}

export function createAgentGitService(options: AgentGitServiceOptions): AgentGitService {
	const pollIntervalMs = options.actionPollIntervalMs ?? DEFAULT_ACTION_POLL_INTERVAL_MS;
	const pollTimeoutMs = options.actionPollTimeoutMs ?? DEFAULT_ACTION_POLL_TIMEOUT_MS;
	let disposed = false;

	/** Trust boundary: the host router validates against `GitMethodShapes`, so the
	 * answer for a method is that method's result. */
	async function oneShot<M extends GitMethod>(path: string, method: M, input: GitMethodInput<M>): Promise<GitMethodResult<M>> {
		const client = await ensure();
		const request: GitRequest = { path, method, input };
		return await client.requestApplication<GitMethodResult<M>>("POST", GIT_ROUTE, request);
	}

	async function ensure(): Promise<AgentGitHostClient> {
		if (disposed) throw new Error("Git service is disposed");
		return await options.ensureClient();
	}

	async function status(input: Record<string, unknown>): Promise<GitStatusResult> {
		const cwd = validateCwd(input.cwd);
		const result = await oneShot(cwd, "status", {});
		// The pane's file row has no `binary` field; the review surface infers
		// binariness from `workingTreeDiffStats` when it needs it.
		const translated: GitStatusResult = {
			branch: result.branch,
			hasWorkingTreeChanges: result.hasWorkingTreeChanges,
			workingTree: {
				files: result.workingTree.files.map(file => ({ path: file.path, insertions: file.insertions, deletions: file.deletions })),
				insertions: result.workingTree.insertions,
				deletions: result.workingTree.deletions,
			},
			hasUpstream: result.hasUpstream,
			upstreamBranch: result.upstreamBranch,
			aheadCount: result.aheadCount,
			behindCount: result.behindCount,
			pr: result.pr,
		};
		return translated;
	}

	async function listBranches(input: Record<string, unknown>): Promise<GitListBranchesResult> {
		const cwd = validateCwd(input.cwd);
		const result = await oneShot(cwd, "listBranches", {});
		const translated: GitListBranchesResult = {
			branches: result.branches.map(branch => ({
				name: branch.name,
				isRemote: branch.isRemote,
				remoteName: branch.remoteName,
				current: branch.current,
				isDefault: branch.isDefault,
				worktreePath: branch.worktreePath,
			})),
			isRepo: result.isRepo,
			hasOriginRemote: result.hasOriginRemote,
		};
		return translated;
	}

	async function listRecentCommits(input: Record<string, unknown>): Promise<GitListRecentCommitsResult> {
		const cwd = validateCwd(input.cwd);
		const result = await oneShot(cwd, "listRecentCommits", input.limit === undefined ? {} : { limit: commitLimit(input.limit) });
		const translated: GitListRecentCommitsResult = {
			commits: result.commits.map(commit => ({ sha: commit.sha, shortSha: commit.shortSha, subject: commit.subject, committedAt: commit.committedAt })),
		};
		return translated;
	}

	async function readWorkingTreeDiff(input: Record<string, unknown>): Promise<GitReadWorkingTreeDiffResult> {
		const cwd = validateCwd(input.cwd);
		const result = await oneShot(cwd, "readWorkingTreeDiff", diffRequest(input));
		const translated: GitReadWorkingTreeDiffResult = { patch: result.patch, truncated: result.truncated };
		return translated;
	}

	async function workingTreeDiffStats(input: Record<string, unknown>): Promise<GitWorkingTreeDiffStatsResult> {
		const cwd = validateCwd(input.cwd);
		const result = await oneShot(cwd, "workingTreeDiffStats", diffRequest(input));
		// The pane's badge needs three totals; the per-file rows are the host's
		// concern and are read only by the IDE review surface.
		const translated: GitWorkingTreeDiffStatsResult = { additions: result.additions, deletions: result.deletions, fileCount: result.fileCount };
		return translated;
	}

	async function readFileAtRev(input: Record<string, unknown>): Promise<GitReadFileAtRevResult> {
		const cwd = validateCwd(input.cwd);
		const request: GitReadFileAtRevRequest = {
			filePath: validatePath(input.filePath),
			...(input.rev === undefined ? {} : { rev: validateRevision(input.rev, "revision") }),
			...(input.base === undefined ? {} : { base: fileBase(input.base) }),
			...(input.maxBytes === undefined ? {} : { maxBytes: fileMaxBytes(input.maxBytes) }),
		};
		const result = await oneShot(cwd, "readFileAtRev", request);
		const translated: GitReadFileAtRevResult = {
			contents: result.contents,
			resolvedRev: result.resolvedRev,
			missing: result.missing,
			truncated: result.truncated,
		};
		return translated;
	}

	async function createBranch(input: Record<string, unknown>): Promise<undefined> {
		const cwd = validateCwd(input.cwd);
		await oneShot(cwd, "createBranch", {
			branch: validateBranch(input.branch),
			...(input.publish === undefined ? {} : { publish: flag(input.publish, "publish") }),
		});
		return undefined;
	}

	async function checkout(input: Record<string, unknown>): Promise<undefined> {
		const cwd = validateCwd(input.cwd);
		await oneShot(cwd, "checkout", { branch: validateBranch(input.branch) });
		return undefined;
	}

	async function githubRepository(input: Record<string, unknown>): Promise<GitHubRepositoryResult> {
		const cwd = validateCwd(input.cwd);
		const result = await oneShot(cwd, "githubRepository", {});
		// Cedia reads `origin` locally and lists nothing: there is no GitHub API
		// client to enumerate repositories with.
		const translated: GitHubRepositoryResult = {
			repository: result.repository,
			repositories: result.repositories.map(repository => ({ nameWithOwner: repository.nameWithOwner, url: repository.url })),
		};
		return translated;
	}

	async function stageFiles(input: Record<string, unknown>): Promise<GitStageFilesResult> {
		const cwd = validateCwd(input.cwd);
		const result = await oneShot(cwd, "stageFiles", { paths: requiredFilePaths(input.paths) });
		const translated: GitStageFilesResult = { ok: result.ok };
		return translated;
	}

	async function unstageFiles(input: Record<string, unknown>): Promise<GitUnstageFilesResult> {
		const cwd = validateCwd(input.cwd);
		const result = await oneShot(cwd, "unstageFiles", { paths: requiredFilePaths(input.paths) });
		const translated: GitUnstageFilesResult = { ok: result.ok };
		return translated;
	}

	async function stashInfo(input: Record<string, unknown>): Promise<GitStashInfoResult> {
		const cwd = validateCwd(input.cwd);
		const result = await oneShot(cwd, "stashInfo", {});
		const translated: GitStashInfoResult = {
			cwd: result.cwd,
			branch: result.branch,
			stashRef: result.stashRef,
			message: result.message,
			files: [...result.files],
		};
		return translated;
	}

	async function stashAndCheckout(input: Record<string, unknown>): Promise<undefined> {
		const cwd = validateCwd(input.cwd);
		await oneShot(cwd, "stashAndCheckout", { branch: validateBranch(input.branch) });
		return undefined;
	}

	async function stashDrop(input: Record<string, unknown>): Promise<undefined> {
		const cwd = validateCwd(input.cwd);
		await oneShot(cwd, "stashDrop", { stashRef: stashReference(input.stashRef) });
		return undefined;
	}

	async function removeIndexLock(input: Record<string, unknown>): Promise<undefined> {
		const cwd = validateCwd(input.cwd);
		await oneShot(cwd, "removeIndexLock", {});
		return undefined;
	}

	async function init(input: Record<string, unknown>): Promise<undefined> {
		const cwd = validateCwd(input.cwd);
		await oneShot(cwd, "init", {});
		return undefined;
	}

	async function pull(input: Record<string, unknown>): Promise<GitPullResult> {
		const cwd = validateCwd(input.cwd);
		const result = await oneShot(cwd, "pull", {});
		const translated: GitPullResult = {
			status: result.status,
			branch: result.branch,
			upstreamBranch: result.upstreamBranch,
		};
		return translated;
	}

	async function blameLine(input: Record<string, unknown>): Promise<GitBlameLineResult> {
		const cwd = validateCwd(input.cwd);
		const line = input.line;
		if (typeof line !== "number" || !Number.isSafeInteger(line) || line < 1) throw new Error("Invalid Git blame line");
		const result = await oneShot(cwd, "blameLine", {
			filePath: validatePath(input.filePath),
			line,
			...(input.rev === undefined ? {} : { rev: validateRevision(input.rev, "revision") }),
			...optional("base", blameBase(input.base)),
		});
		const translated: GitBlameLineResult = {
			sha: result.sha,
			shortSha: result.shortSha,
			author: result.author,
			authorEmail: result.authorEmail,
			authorTime: result.authorTime,
			summary: result.summary,
			uncommitted: result.uncommitted,
		};
		return translated;
	}

	async function removeWorktree(input: Record<string, unknown>): Promise<undefined> {
		// A worktree is an absolute path outside the checkout, and it carries its
		// own repository registration, so only the path and the flags travel; the
		// host authorizes the path against the worktree root it owns.
		validateCwd(input.cwd);
		const path = optionalPathOrNull(input.path, "worktree path");
		if (path === null) throw new Error("Invalid Git worktree path");
		await oneShot(path, "removeWorktree", {
			path,
			...optional("force", input.force === undefined ? undefined : flag(input.force, "force")),
			...optional("reclaimTemporaryBranch", input.reclaimTemporaryBranch === undefined ? undefined : flag(input.reclaimTemporaryBranch, "reclaimTemporaryBranch")),
		});
		return undefined;
	}

	async function handoffThread(input: Record<string, unknown>): Promise<GitHandoffThreadResult> {
		const request: GitHandoffThreadRequest = {
			threadId: text(input.threadId, "thread id", 128),
			cwd: validateCwd(input.cwd),
			targetMode: handoffMode(input.targetMode),
			currentBranch: optionalBranchOrNull(input.currentBranch, "current branch"),
			worktreePath: optionalPathOrNull(input.worktreePath, "worktree path"),
			associatedWorktreePath: optionalPathOrNull(input.associatedWorktreePath, "worktree path"),
			associatedWorktreeBranch: optionalBranchOrNull(input.associatedWorktreeBranch, "worktree branch"),
			associatedWorktreeRef: optionalRevisionOrNull(input.associatedWorktreeRef, "worktree ref"),
			...optional("preferredLocalBranch", optionalBranchOrNull(input.preferredLocalBranch, "local branch")),
			...optional("preferredWorktreeBaseBranch", optionalBranchOrNull(input.preferredWorktreeBaseBranch, "base branch")),
			...optional("preferredNewWorktreeName", optionalTextOrNull(input.preferredNewWorktreeName, "worktree name", 128)),
		};
		const result = await oneShot(request.cwd, "handoffThread", request);
		const translated: GitHandoffThreadResult = {
			targetMode: result.targetMode,
			branch: result.branch,
			worktreePath: result.worktreePath,
			associatedWorktreePath: result.associatedWorktreePath,
			associatedWorktreeBranch: result.associatedWorktreeBranch,
			associatedWorktreeRef: result.associatedWorktreeRef,
			changesTransferred: result.changesTransferred,
			conflictsDetected: result.conflictsDetected,
			message: result.message,
		};
		return translated;
	}

	async function runStackedAction(event: unknown, input: Record<string, unknown>): Promise<GitRunStackedActionResult> {
		const sender = senderFromEvent(event);
		const actionId = text(input.actionId, "action id", 128);
		const cwd = validateCwd(input.cwd);
		const action = stackedAction(input.action);
		const request: GitStartActionRequest = {
			actionId,
			path: cwd,
			kind: "stacked",
			action,
			commitMessage: actionCommitMessage(input.commitMessage),
			filePaths: actionFilePaths(input.filePaths),
			...(input.featureBranch === undefined ? {} : { featureBranch: flag(input.featureBranch, "featureBranch") }),
		};
		const base: StackedActionBase = { actionId, cwd, action };
		let failed = false;
		let finished = false;
		const emit = (payload: GitActionProgressEvent): void => send(sender, CEDIA_AGENT_GIT_EVENT_CHANNEL, payload);
		try {
			const client = await ensure();
			await client.requestApplication("POST", GIT_ACTIONS_ROUTE, request);
			const page = await pollAction({
				client,
				actionId,
				intervalMs: pollIntervalMs,
				timeoutMs: pollTimeoutMs,
				isDisposed: () => disposed,
				onEvent: hostEvent => {
					if (hostEvent.kind === "action_failed") failed = true;
					if (hostEvent.kind === "action_finished") finished = true;
					const translated = paneActionEvent(hostEvent, base);
					if (translated) emit(translated);
				},
			});
			if (page.error !== undefined) throw new Error(page.error);
			if (!isStackedResult(page.result)) throw new Error("Cedia host ended the Git action without a result");
			const result = paneStackedResult(page.result);
			// The terminal record is authoritative even when the stream stopped
			// before its own `action_finished` record arrived.
			if (!finished) emit({ ...base, kind: "action_finished", result });
			return result;
		} catch (error) {
			if (!failed) emit({ ...base, kind: "action_failed", phase: null, message: error instanceof Error ? error.message : String(error) });
			throw error;
		}
	}

	async function createDetachedWorktree(event: unknown, input: Record<string, unknown>): Promise<GitCreateDetachedWorktreeResult> {
		const sender = senderFromEvent(event);
		const cwd = validateCwd(input.cwd);
		const progressId = input.progressId === undefined ? null : text(input.progressId, "progress id", 128);
		const request: GitStartActionRequest = {
			actionId: randomUUID(),
			path: cwd,
			kind: "worktree",
			worktree: {
				ref: validateRevision(input.ref, "ref"),
				...(input.path === undefined || input.path === null ? {} : { path: text(input.path, "worktree path", 4_096) }),
				...(input.newBranch === undefined ? {} : { newBranch: validateBranch(input.newBranch) }),
				...(input.copyChangesFrom === undefined ? {} : { copyChangesFrom: text(input.copyChangesFrom, "copy changes from", 4_096) }),
			},
			...(progressId === null ? {} : { progressId }),
		};
		const client = await ensure();
		await client.requestApplication("POST", GIT_ACTIONS_ROUTE, request);
		let completed = false;
		const page = await pollAction({
			client,
			actionId: request.actionId,
			intervalMs: pollIntervalMs,
			timeoutMs: pollTimeoutMs,
			isDisposed: () => disposed,
			onEvent: hostEvent => {
				if (hostEvent.kind === "worktree_completed") completed = true;
				const translated = paneWorktreeEvent(hostEvent, progressId);
				if (translated) send(sender, CEDIA_AGENT_WORKTREE_EVENT_CHANNEL, translated);
			},
		});
		if (page.error !== undefined) throw new Error(page.error);
		if (!isWorktreeResult(page.result)) throw new Error("Cedia host ended the worktree action without a worktree result");
		const result = paneWorktreeResult(page.result);
		if (!completed) send(sender, CEDIA_AGENT_WORKTREE_EVENT_CHANNEL, { progressId, kind: "completed", result });
		return result;
	}

	return {
		handle: async (event: unknown, method: string, rawInput: unknown): Promise<unknown> => {
			if (disposed) throw new Error("Git service is disposed");
			const input = record(rawInput);
			switch (method) {
			case "status": return await status(input);
			case "listBranches": return await listBranches(input);
			case "listRecentCommits": return await listRecentCommits(input);
			case "readWorkingTreeDiff": return await readWorkingTreeDiff(input);
			case "workingTreeDiffStats": return await workingTreeDiffStats(input);
			case "readFileAtRev": return await readFileAtRev(input);
			case "createBranch": return await createBranch(input);
			case "checkout": return await checkout(input);
			case "stageFiles": return await stageFiles(input);
			case "unstageFiles": return await unstageFiles(input);
			case "stashInfo": return await stashInfo(input);
			case "stashAndCheckout": return await stashAndCheckout(input);
			case "stashDrop": return await stashDrop(input);
			case "removeIndexLock": return await removeIndexLock(input);
			case "init": return await init(input);
			case "pull": return await pull(input);
			case "blameLine": return await blameLine(input);
			case "removeWorktree": return await removeWorktree(input);
			case "handoffThread": return await handoffThread(input);
			case "githubRepository": return await githubRepository(input);
			case "runStackedAction": return await runStackedAction(event, input);
			case "createDetachedWorktree": return await createDetachedWorktree(event, input);
			// The bundle has no caller for either of these, so Cedia has no
			// behaviour to answer with: the worktree flow uses the detached form
			// above, and no surface summarizes a diff.
			case "createWorktree": throw new Error("Git worktree creation from an existing branch has no caller in the Agent window");
			case "summarizeDiff": throw new Error("Git diff summarization has no caller in the Agent window");
			case "resolvePullRequest":
			case "pullRequestSnapshot":
			case "preparePullRequestThread":
				throw new Error(GIT_GITHUB_UNAVAILABLE_REASON);
			default: throw new Error(`Unsupported Git method '${method}'`);
			}
		},
		dispose: () => { disposed = true; },
	};
}
