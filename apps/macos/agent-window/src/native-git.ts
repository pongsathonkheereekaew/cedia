import type { NativeApi } from "../vendor/synara/packages/contracts/src/ipc.ts";
import type { GitActionProgressEvent } from "../vendor/synara/packages/contracts/src/git.ts";

import { AGENT_WINDOW_CHANNEL as CEDIA_AGENT_CHANNEL } from "../../src/bridge-contract.ts";
export const CEDIA_AGENT_GIT_EVENT_CHANNEL = "vscode:cediaAgentGit";

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

function unsupportedEvent(method: string): never {
	throw new Error(`Unsupported native Git event '${method}'`);
}

function eventPayload(args: readonly unknown[]): GitActionProgressEvent | null {
	const payload = args[0];
	return payload && typeof payload === "object" && !Array.isArray(payload)
		? payload as GitActionProgressEvent
		: null;
}

export function createNativeGitApi(bridge: NativeGitBridge): NativeGitApi {
	return {
		githubRepository: () => unsupported("githubRepository"),
		status: input => request(bridge, "status", input),
		listBranches: input => request(bridge, "listBranches", input),
		listRecentCommits: input => request(bridge, "listRecentCommits", input),
		createWorktree: () => unsupported("createWorktree"),
		createDetachedWorktree: () => unsupported("createDetachedWorktree"),
		removeWorktree: () => unsupported("removeWorktree"),
		readWorkingTreeDiff: input => request(bridge, "readWorkingTreeDiff", input),
		workingTreeDiffStats: input => request(bridge, "workingTreeDiffStats", input),
		createBranch: input => request(bridge, "createBranch", input),
		checkout: input => request(bridge, "checkout", input),
		stashAndCheckout: () => unsupported("stashAndCheckout"),
		stashDrop: () => unsupported("stashDrop"),
		stashInfo: () => unsupported("stashInfo"),
		removeIndexLock: () => unsupported("removeIndexLock"),
		init: () => unsupported("init"),
		stageFiles: () => unsupported("stageFiles"),
		unstageFiles: () => unsupported("unstageFiles"),
		handoffThread: () => unsupported("handoffThread"),
		resolvePullRequest: () => unsupported("resolvePullRequest"),
		pullRequestSnapshot: () => unsupported("pullRequestSnapshot"),
		preparePullRequestThread: () => unsupported("preparePullRequestThread"),
		pull: () => unsupported("pull"),
		readFileAtRev: input => request(bridge, "readFileAtRev", input),
		blameLine: () => unsupported("blameLine"),
		summarizeDiff: () => unsupported("summarizeDiff"),
		runStackedAction: input => request(bridge, "runStackedAction", input),
		onActionProgress: listener => {
			if (!bridge.on) return () => undefined;
			const handler = (_event: unknown, ...args: unknown[]) => {
				const payload = eventPayload(args);
				if (payload) listener(payload);
			};
			bridge.on(CEDIA_AGENT_GIT_EVENT_CHANNEL, handler);
			return () => bridge.removeListener?.(CEDIA_AGENT_GIT_EVENT_CHANNEL, handler);
		},
		onWorktreeSetupProgress: () => unsupportedEvent("onWorktreeSetupProgress"),
	} as NativeGitApi;
}
