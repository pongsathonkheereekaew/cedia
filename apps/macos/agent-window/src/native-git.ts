import type { NativeApi } from "../vendor/synara/packages/contracts/src/ipc.ts";
import type { GitActionProgressEvent, GitWorktreeSetupProgressEvent } from "../vendor/synara/packages/contracts/src/git.ts";
import { GIT_GITHUB_UNAVAILABLE_REASON } from "../../../../packages/protocol/src/git.ts";

import { AGENT_WINDOW_CHANNEL as CEDIA_AGENT_CHANNEL } from "../../src/bridge-contract.ts";
export const CEDIA_AGENT_GIT_EVENT_CHANNEL = "vscode:cediaAgentGit";
/** Detached-worktree setup progress; the panel emits it separately from the
 * stacked-action stream because the setup card subscribes on its own. */
export const CEDIA_AGENT_WORKTREE_EVENT_CHANNEL = "vscode:cediaAgentWorktree";

export interface NativeGitBridge {
	invoke(channel: string, input?: unknown): Promise<unknown>;
	on?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
	removeListener?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

type GitApi = NativeApi["git"];

/** The panel implements this subset; the remaining contract methods reject explicitly. */
export type NativeGitApi = GitApi;

interface GitPanelRequest {
	readonly kind: "panel";
	readonly surface: "git";
	readonly method: string;
	readonly input: unknown;
}

function request<T>(bridge: NativeGitBridge, method: string, input: unknown): Promise<T> {
	return bridge.invoke(CEDIA_AGENT_CHANNEL, {
		kind: "panel",
		surface: "git",
		method,
		input,
	} satisfies GitPanelRequest) as Promise<T>;
}

function unsupported<T>(method: string): Promise<T> {
	return Promise.reject(new Error(`Unsupported native Git method '${method}'`));
}

/** Cedia has no GitHub client, so these cannot be answered at all. */
function githubUnavailable<T>(): Promise<T> {
	return Promise.reject(new Error(GIT_GITHUB_UNAVAILABLE_REASON));
}

/** One subscription shape for both git event channels: the panel sends the
 * payload as the listener's first argument, and unsubscribing is optional. */
function subscribe<T>(bridge: NativeGitBridge, channel: string, listener: (event: T) => void): () => void {
	if (!bridge.on) return () => undefined;
	const handler = (_event: unknown, ...args: unknown[]) => {
		const payload = args[0];
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
		listener(payload as T);
	};
	bridge.on(channel, handler);
	return () => bridge.removeListener?.(channel, handler);
}

export function createNativeGitApi(bridge: NativeGitBridge): NativeGitApi {
	return {
		githubRepository: input => request(bridge, "githubRepository", input),
		status: input => request(bridge, "status", input),
		listBranches: input => request(bridge, "listBranches", input),
		listRecentCommits: input => request(bridge, "listRecentCommits", input),
		createWorktree: () => unsupported("createWorktree"),
		createDetachedWorktree: input => request(bridge, "createDetachedWorktree", input),
		removeWorktree: input => request(bridge, "removeWorktree", input),
		readWorkingTreeDiff: input => request(bridge, "readWorkingTreeDiff", input),
		workingTreeDiffStats: input => request(bridge, "workingTreeDiffStats", input),
		createBranch: input => request(bridge, "createBranch", input),
		checkout: input => request(bridge, "checkout", input),
		stashAndCheckout: input => request(bridge, "stashAndCheckout", input),
		stashDrop: input => request(bridge, "stashDrop", input),
		stashInfo: input => request(bridge, "stashInfo", input),
		removeIndexLock: input => request(bridge, "removeIndexLock", input),
		init: input => request(bridge, "init", input),
		stageFiles: input => request(bridge, "stageFiles", input),
		unstageFiles: input => request(bridge, "unstageFiles", input),
		handoffThread: input => request(bridge, "handoffThread", input),
		resolvePullRequest: () => githubUnavailable(),
		pullRequestSnapshot: () => githubUnavailable(),
		preparePullRequestThread: () => githubUnavailable(),
		pull: input => request(bridge, "pull", input),
		readFileAtRev: input => request(bridge, "readFileAtRev", input),
		blameLine: input => request(bridge, "blameLine", input),
		summarizeDiff: () => unsupported("summarizeDiff"),
		runStackedAction: input => request(bridge, "runStackedAction", input),
		onActionProgress: listener => subscribe<GitActionProgressEvent>(bridge, CEDIA_AGENT_GIT_EVENT_CHANNEL, listener),
		onWorktreeSetupProgress: listener => subscribe<GitWorktreeSetupProgressEvent>(bridge, CEDIA_AGENT_WORKTREE_EVENT_CHANNEL, listener),
	} as NativeGitApi;
}
