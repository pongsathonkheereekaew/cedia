import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_GITHUB_UNAVAILABLE_REASON } from "../../../packages/protocol/src/git.ts";
import {
	CEDIA_AGENT_GIT_EVENT_CHANNEL,
	CEDIA_AGENT_WORKTREE_EVENT_CHANNEL,
	createAgentGitService,
	type AgentGitHostClient,
} from "../src/agent-window-git.ts";
import { createNativeGitApi } from "../agent-window/src/native-git.ts";

/**
 * The pane is a client of the host's git service now: this file asserts the
 * requests the extension sends and the contract shapes it answers with.  What
 * a real repository does (status, checkout, commit semantics) belongs to the
 * host's own tests.
 */

const CWD = mkdtempSync(join(tmpdir(), "cedia-agent-git-"));
afterAll(async () => { await rm(CWD, { recursive: true, force: true }); });

interface HostCall {
	readonly method: string;
	readonly path: string;
	readonly body: unknown;
}

/** A recording host: every call is kept, and `respond` decides the answer. */
function hostStub(respond: (call: HostCall) => unknown) {
	const calls: HostCall[] = [];
	const client: AgentGitHostClient = {
		async requestApplication<T>(method: string, path: string, body?: unknown): Promise<T> {
			const call: HostCall = { method, path, body };
			calls.push(call);
			return await respond(call) as T;
		},
	};
	return { calls, client };
}

/** The git method name a recorded call carried: the body is `{ path, method, input }`. */
function gitMethod(call: HostCall): string {
	const body = call.body;
	if (!body || typeof body !== "object" || !("method" in body) || typeof body.method !== "string") {
		throw new Error(`recorded call is not a git request: ${JSON.stringify(call)}`);
	}
	return body.method;
}

/** Answers the one-shot route by method name, so a test states only the result. */
function results(byMethod: Record<string, unknown>) {
	return (call: HostCall): unknown => {
		const value = byMethod[gitMethod(call)];
		if (value === undefined) throw new Error(`unexpected host call: ${JSON.stringify(call)}`);
		return value;
	};
}

function senderOf() {
	const events: { channel: string; event: unknown }[] = [];
	return {
		events,
		sender: { send: (channel: string, event: unknown) => { events.push({ channel, event }); } },
	};
}

describe("Cedia git pane host requests", () => {
	it("maps the host status rows into the pane's shape, dropping the host's binary flag", async () => {
		const host = hostStub(results({
			status: {
				branch: "main",
				hasWorkingTreeChanges: true,
				workingTree: { files: [{ path: "a.txt", insertions: 3, deletions: 1, binary: false }], insertions: 3, deletions: 1 },
				hasUpstream: true,
				upstreamBranch: "origin/main",
				aheadCount: 1,
				behindCount: 2,
				pr: null,
			},
		}));
		const service = createAgentGitService({ ensureClient: async () => host.client });
		try {
			const status = await service.handle({}, "status", { cwd: CWD });
			expect(status).toEqual({
				branch: "main",
				hasWorkingTreeChanges: true,
				workingTree: { files: [{ path: "a.txt", insertions: 3, deletions: 1 }], insertions: 3, deletions: 1 },
				hasUpstream: true,
				upstreamBranch: "origin/main",
				aheadCount: 1,
				behindCount: 2,
				pr: null,
			});
			expect(host.calls).toEqual([{ method: "POST", path: "git", body: { path: CWD, method: "status", input: {} } }]);
		} finally {
			service.dispose();
		}
	});

	it("forwards branches, commits and the local origin the pane asks for", async () => {
		const host = hostStub(results({
			listBranches: { branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }], isRepo: true, hasOriginRemote: true },
			listRecentCommits: { commits: [{ sha: "abc", shortSha: "abc", subject: "initial", committedAt: "2026-01-01T00:00:00Z" }] },
			githubRepository: { repository: { nameWithOwner: "cedia/cedia", url: "https://example.test/cedia/cedia" }, repositories: [] },
		}));
		const service = createAgentGitService({ ensureClient: async () => host.client });
		try {
			expect(await service.handle({}, "listBranches", { cwd: CWD })).toEqual({
				branches: [{ name: "main", isRemote: undefined, remoteName: undefined, current: true, isDefault: true, worktreePath: null }],
				isRepo: true,
				hasOriginRemote: true,
			});
			expect(await service.handle({}, "listRecentCommits", { cwd: CWD, limit: 5 })).toEqual({
				commits: [{ sha: "abc", shortSha: "abc", subject: "initial", committedAt: "2026-01-01T00:00:00Z" }],
			});
			expect(await service.handle({}, "githubRepository", { cwd: CWD })).toEqual({
				repository: { nameWithOwner: "cedia/cedia", url: "https://example.test/cedia/cedia" },
				repositories: [],
			});
			expect(host.calls.map(call => call.body)).toEqual([
				{ path: CWD, method: "listBranches", input: {} },
				{ path: CWD, method: "listRecentCommits", input: { limit: 5 } },
				{ path: CWD, method: "githubRepository", input: {} },
			]);
		} finally {
			service.dispose();
		}
	});

	it("forwards diffs, stats and file reads with the pane's own scope default", async () => {
		const host = hostStub((call) => {
			const method = gitMethod(call);
			if (method === "readWorkingTreeDiff") return { patch: "diff --git a/a.txt b/a.txt\n", truncated: false };
			if (method === "workingTreeDiffStats") return { additions: 2, deletions: 1, fileCount: 1, files: [{ path: "a.txt", insertions: 2, deletions: 1, binary: false }] };
			if (method === "readFileAtRev") return { contents: "hello\n", resolvedRev: "HEAD", missing: false, truncated: false };
			throw new Error(`unexpected host call: ${method}`);
		});
		const service = createAgentGitService({ ensureClient: async () => host.client });
		try {
			expect(await service.handle({}, "readWorkingTreeDiff", { cwd: CWD, scope: "unstaged", filePath: "a.txt" })).toEqual({
				patch: "diff --git a/a.txt b/a.txt\n",
				truncated: false,
			});
			// The badge has no per-file rows in the pane's contract.
			expect(await service.handle({}, "workingTreeDiffStats", { cwd: CWD })).toEqual({ additions: 2, deletions: 1, fileCount: 1 });
			expect(await service.handle({}, "readFileAtRev", { cwd: CWD, filePath: "a.txt", base: "index", maxBytes: 4_096 })).toEqual({
				contents: "hello\n",
				resolvedRev: "HEAD",
				missing: false,
				truncated: false,
			});
			expect(host.calls.map(call => call.body)).toEqual([
				{ path: CWD, method: "readWorkingTreeDiff", input: { scope: "unstaged", filePath: "a.txt" } },
				{ path: CWD, method: "workingTreeDiffStats", input: { scope: "workingTree" } },
				{ path: CWD, method: "readFileAtRev", input: { filePath: "a.txt", base: "index", maxBytes: 4_096 } },
			]);
		} finally {
			service.dispose();
		}
	});

	it("forwards branch creation and checkout, and answers void for both", async () => {
		const host = hostStub(results({ createBranch: {}, checkout: {} }));
		const service = createAgentGitService({ ensureClient: async () => host.client });
		try {
			expect(await service.handle({}, "createBranch", { cwd: CWD, branch: "feature/demo", publish: true })).toBeUndefined();
			expect(await service.handle({}, "checkout", { cwd: CWD, branch: "feature/demo" })).toBeUndefined();
			expect(host.calls.map(call => call.body)).toEqual([
				{ path: CWD, method: "createBranch", input: { branch: "feature/demo", publish: true } },
				{ path: CWD, method: "checkout", input: { branch: "feature/demo" } },
			]);
		} finally {
			service.dispose();
		}
	});

	it("refuses input the host must never be asked to authorize", async () => {
		const host = hostStub(results({ status: {} }));
		const service = createAgentGitService({ ensureClient: async () => host.client });
		try {
			await expect(service.handle({}, "status", { cwd: "relative/path" })).rejects.toThrow(/absolute/i);
			await expect(service.handle({}, "status", {})).rejects.toThrow(/cwd/i);
			await expect(service.handle({}, "readWorkingTreeDiff", { cwd: CWD, filePath: "../escape.txt" })).rejects.toThrow(/workspace/i);
			await expect(service.handle({}, "readFileAtRev", { cwd: CWD, filePath: "a.txt", rev: "--upload-pack=touch /tmp/x" })).rejects.toThrow(/revision/i);
			await expect(service.handle({}, "readWorkingTreeDiff", { cwd: CWD, scope: "everything" })).rejects.toThrow(/scope/i);
			await expect(service.handle({}, "listRecentCommits", { cwd: CWD, limit: 500 })).rejects.toThrow(/limit/i);
			expect(host.calls).toEqual([]);
		} finally {
			service.dispose();
		}
	});

	it("reports a host that cannot be reached instead of answering", async () => {
		const service = createAgentGitService({ ensureClient: async () => { throw new Error("Cedia host is unreachable"); } });
		try {
			await expect(service.handle({}, "status", { cwd: CWD })).rejects.toThrow("Cedia host is unreachable");
		} finally {
			service.dispose();
		}
	});
});

describe("Cedia git pane stacked actions", () => {
	it("polls the host action and forwards its events in the pane's vocabulary", async () => {
		const result = {
			action: "commit_push",
			branch: { status: "skipped_not_requested" },
			commit: { status: "created", commitSha: "abc123", subject: "Save from Cedia" },
			push: { status: "pushed", branch: "main", upstreamBranch: "origin/main" },
			pr: { status: "skipped_not_requested" },
		};
		// The real stream's shape: the phases announced up front, then each phase
		// as it starts, then the terminal record.
		const pages = [
			{ events: [
				{ kind: "action_started", actionId: "action-1", phases: ["commit", "push"] },
				{ kind: "phase_started", actionId: "action-1", phase: "commit", label: "Commit" },
			], done: false },
			{ events: [{ kind: "phase_started", actionId: "action-1", phase: "push", label: "Push" }], done: false },
			{ events: [{ kind: "action_finished", actionId: "action-1", result }], done: true, result },
		];
		const host = hostStub(call => call.method === "GET" ? pages.shift() : { actionId: "action-1" });
		const service = createAgentGitService({ ensureClient: async () => host.client, actionPollIntervalMs: 1 });
		const { events, sender } = senderOf();
		try {
			const answered = await service.handle({ sender }, "runStackedAction", {
				actionId: "action-1",
				cwd: CWD,
				action: "commit_push",
				commitMessage: "Save from Cedia",
				filePaths: ["a.txt"],
			});
			expect(answered).toEqual(result);
			expect(host.calls.map(call => `${call.method} ${call.path}`)).toEqual([
				"POST git/actions",
				"GET git/actions/action-1?after=0",
				"GET git/actions/action-1?after=2",
				"GET git/actions/action-1?after=3",
			]);
			expect(host.calls[0]?.body).toEqual({
				actionId: "action-1",
				path: CWD,
				kind: "stacked",
				action: "commit_push",
				commitMessage: "Save from Cedia",
				filePaths: ["a.txt"],
			});
			expect(events).toEqual([
				{ channel: CEDIA_AGENT_GIT_EVENT_CHANNEL, event: { actionId: "action-1", cwd: CWD, action: "commit_push", kind: "action_started", phases: ["commit", "push"] } },
				{ channel: CEDIA_AGENT_GIT_EVENT_CHANNEL, event: { actionId: "action-1", cwd: CWD, action: "commit_push", kind: "phase_started", phase: "commit", label: "Commit" } },
				{ channel: CEDIA_AGENT_GIT_EVENT_CHANNEL, event: { actionId: "action-1", cwd: CWD, action: "commit_push", kind: "phase_started", phase: "push", label: "Push" } },
				{ channel: CEDIA_AGENT_GIT_EVENT_CHANNEL, event: { actionId: "action-1", cwd: CWD, action: "commit_push", kind: "action_finished", result } },
			]);
		} finally {
			service.dispose();
		}
	});

	it("emits action_failed once and rejects when the host reports the action failed", async () => {
		const host = hostStub(call => call.method === "GET"
			? { events: [{ kind: "action_failed", actionId: "action-2", phase: "push", message: "Branch is behind upstream" }], done: true, error: "Branch is behind upstream" }
			: { actionId: "action-2" });
		const service = createAgentGitService({ ensureClient: async () => host.client, actionPollIntervalMs: 1 });
		const { events, sender } = senderOf();
		try {
			await expect(service.handle({ sender }, "runStackedAction", { actionId: "action-2", cwd: CWD, action: "push" })).rejects.toThrow("Branch is behind upstream");
			expect(events).toEqual([{
				channel: CEDIA_AGENT_GIT_EVENT_CHANNEL,
				event: { actionId: "action-2", cwd: CWD, action: "push", kind: "action_failed", phase: "push", message: "Branch is behind upstream" },
			}]);
		} finally {
			service.dispose();
		}
	});

	it("emits action_failed and rejects when the host cannot start the action at all", async () => {
		const host = hostStub(() => { throw new Error("Cedia host is unreachable"); });
		const service = createAgentGitService({ ensureClient: async () => host.client });
		const { events, sender } = senderOf();
		try {
			await expect(service.handle({ sender }, "runStackedAction", { actionId: "action-3", cwd: CWD, action: "commit" })).rejects.toThrow("Cedia host is unreachable");
			expect(events).toEqual([{
				channel: CEDIA_AGENT_GIT_EVENT_CHANNEL,
				event: { actionId: "action-3", cwd: CWD, action: "commit", kind: "action_failed", phase: null, message: "Cedia host is unreachable" },
			}]);
		} finally {
			service.dispose();
		}
	});

	it("refuses a pull-request action and never asks the host to run it", async () => {
		const host = hostStub(results({}));
		const service = createAgentGitService({ ensureClient: async () => host.client });
		const { events, sender } = senderOf();
		try {
			await expect(service.handle({ sender }, "runStackedAction", { actionId: "action-4", cwd: CWD, action: "create_pr" })).rejects.toThrow(GIT_GITHUB_UNAVAILABLE_REASON);
			expect(events).toEqual([]);
			expect(host.calls).toEqual([]);
		} finally {
			service.dispose();
		}
	});

	it("refuses a destroyed sender before touching the host", async () => {
		const host = hostStub(results({}));
		const service = createAgentGitService({ ensureClient: async () => host.client });
		try {
			await expect(service.handle({ sender: { send: () => undefined, isDestroyed: () => true } }, "runStackedAction", { actionId: "action-5", cwd: CWD, action: "commit" })).rejects.toThrow(/destroyed/i);
			expect(host.calls).toEqual([]);
		} finally {
			service.dispose();
		}
	});

	it("stops polling a host that never finishes", async () => {
		const host = hostStub(() => ({ events: [], done: false }));
		const service = createAgentGitService({ ensureClient: async () => host.client, actionPollIntervalMs: 1, actionPollTimeoutMs: 20 });
		const { sender } = senderOf();
		try {
			await expect(service.handle({ sender }, "runStackedAction", { actionId: "action-6", cwd: CWD, action: "commit" })).rejects.toThrow(/did not finish within/i);
		} finally {
			service.dispose();
		}
	});

	it("abandons an in-flight action when the service is disposed", async () => {
		const polled = Promise.withResolvers<void>();
		const host = hostStub(() => {
			polled.resolve();
			return { events: [], done: false };
		});
		const service = createAgentGitService({ ensureClient: async () => host.client, actionPollIntervalMs: 1 });
		const { sender } = senderOf();
		const pending = service.handle({ sender }, "runStackedAction", { actionId: "action-7", cwd: CWD, action: "commit" });
		// The first poll has happened and the loop is waiting on its interval.
		await polled.promise;
		service.dispose();
		await expect(pending).rejects.toThrow(/disposed/i);
		expect(host.calls.length).toBeGreaterThan(0);
	});
});

describe("Cedia git pane worktrees", () => {
	it("runs a detached creation as an action and keeps the caller's progressId", async () => {
		const worktree = { worktree: { path: "/state/worktrees/one", ref: "main", branch: "synara/abcd1234" } };
		const pages = [
			{ events: [
				{ kind: "phase_started", actionId: "worktree-action", phase: "branch", label: "Preparing branch" },
				{ kind: "phase_started", actionId: "worktree-action", phase: "worktree", label: "Creating worktree" },
			], done: false },
			{ events: [{ kind: "worktree_completed", actionId: "worktree-action", result: worktree }], done: true, result: worktree },
		];
		const host = hostStub(call => call.method === "GET" ? pages.shift() : { actionId: "worktree-action" });
		const service = createAgentGitService({ ensureClient: async () => host.client, actionPollIntervalMs: 1 });
		const { events, sender } = senderOf();
		try {
			const answered = await service.handle({ sender }, "createDetachedWorktree", {
				cwd: CWD,
				ref: "main",
				path: null,
				newBranch: "synara/abcd1234",
				copyChangesFrom: CWD,
				progressId: "progress-9",
			});
			expect(answered).toEqual(worktree);
			const posted = host.calls[0]?.body;
			if (!posted || typeof posted !== "object" || !("actionId" in posted) || typeof posted.actionId !== "string") {
				throw new Error("the worktree action was never started");
			}
			expect(posted.actionId.length).toBeGreaterThan(0);
			expect(host.calls[0]?.body).toEqual({
				actionId: posted.actionId,
				path: CWD,
				kind: "worktree",
				worktree: { ref: "main", newBranch: "synara/abcd1234", copyChangesFrom: CWD },
				progressId: "progress-9",
			});
			// The setup card is correlating on its own id, not the host's action id.
			expect(events).toEqual([
				{ channel: CEDIA_AGENT_WORKTREE_EVENT_CHANNEL, event: { progressId: "progress-9", kind: "phase_started", phase: "branch" } },
				{ channel: CEDIA_AGENT_WORKTREE_EVENT_CHANNEL, event: { progressId: "progress-9", kind: "phase_started", phase: "worktree" } },
				{ channel: CEDIA_AGENT_WORKTREE_EVENT_CHANNEL, event: { progressId: "progress-9", kind: "completed", result: worktree } },
			]);
		} finally {
			service.dispose();
		}
	});

	it("rejects a worktree action the host fails, without inventing a completion", async () => {
		const host = hostStub(call => call.method === "GET"
			? { events: [], done: true, error: "cannot create worktree" }
			: { actionId: "worktree-action" });
		const service = createAgentGitService({ ensureClient: async () => host.client, actionPollIntervalMs: 1 });
		const { events, sender } = senderOf();
		try {
			await expect(service.handle({ sender }, "createDetachedWorktree", { cwd: CWD, ref: "main", path: null })).rejects.toThrow("cannot create worktree");
			expect(events).toEqual([]);
		} finally {
			service.dispose();
		}
	});
});

describe("Cedia git pane refusals", () => {
	it("refuses what the bundle has no caller for, and the GitHub operations Cedia cannot answer", async () => {
		const host = hostStub(results({}));
		const service = createAgentGitService({ ensureClient: async () => host.client });
		try {
			await expect(service.handle({}, "createWorktree", { cwd: CWD })).rejects.toThrow(/no caller/i);
			await expect(service.handle({}, "summarizeDiff", { cwd: CWD })).rejects.toThrow(/no caller/i);
			await expect(service.handle({}, "resolvePullRequest", { cwd: CWD })).rejects.toThrow(GIT_GITHUB_UNAVAILABLE_REASON);
			await expect(service.handle({}, "pullRequestSnapshot", { cwd: CWD })).rejects.toThrow(GIT_GITHUB_UNAVAILABLE_REASON);
			await expect(service.handle({}, "preparePullRequestThread", { cwd: CWD })).rejects.toThrow(GIT_GITHUB_UNAVAILABLE_REASON);
			// A method Cedia does answer is never silently refused: an invalid request
			// for one reports its own validation, and nothing reaches the host.
			await expect(service.handle({}, "stageFiles", { cwd: CWD })).rejects.toThrow(/at least one path/);
			expect(host.calls).toEqual([]);
		} finally {
			service.dispose();
		}
	});
});

describe("Cedia native git bridge", () => {
	it("maps renderer git calls to the guarded panel and both event channels", async () => {
		const calls: { channel: string; input: unknown }[] = [];
		const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
		const bridge = {
			invoke: async (channel: string, input: unknown) => {
				calls.push({ channel, input });
				return { branch: "main", hasWorkingTreeChanges: false };
			},
			on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => { listeners.set(channel, listener); },
			removeListener: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
				if (listeners.get(channel) === listener) listeners.delete(channel);
			},
		};
		const api = createNativeGitApi(bridge);
		await api.status({ cwd: "/tmp/project" });
		await api.githubRepository({ cwd: "/tmp/project" });
		await api.createDetachedWorktree({ cwd: "/tmp/project", ref: "main", path: null, progressId: "p1" });
		expect(calls.map(call => call.input)).toEqual([
			{ kind: "panel", surface: "git", method: "status", input: { cwd: "/tmp/project" } },
			{ kind: "panel", surface: "git", method: "githubRepository", input: { cwd: "/tmp/project" } },
			{ kind: "panel", surface: "git", method: "createDetachedWorktree", input: { cwd: "/tmp/project", ref: "main", path: null, progressId: "p1" } },
		]);
		expect(calls.every(call => call.channel === "vscode:cediaAgent")).toBe(true);

		const received: unknown[] = [];
		const dispose = api.onActionProgress(event => received.push(event));
		const disposeWorktree = api.onWorktreeSetupProgress(event => received.push(event));
		listeners.get(CEDIA_AGENT_GIT_EVENT_CHANNEL)?.({}, { kind: "action_started" });
		listeners.get(CEDIA_AGENT_WORKTREE_EVENT_CHANNEL)?.({}, { kind: "phase_started", progressId: "p1", phase: "branch" });
		dispose();
		disposeWorktree();
		expect(received).toEqual([
			{ kind: "action_started" },
			{ kind: "phase_started", progressId: "p1", phase: "branch" },
		]);
		// Each subscription owns its own listener; unsubscribing both leaves neither behind.
		expect(listeners.size).toBe(0);
	});

	it("refuses the PR methods with Cedia's stated reason", async () => {
		const bridge = { invoke: async () => undefined };
		const api = createNativeGitApi(bridge);
		await expect(api.resolvePullRequest({ cwd: "/tmp/project", reference: "1" })).rejects.toThrow(GIT_GITHUB_UNAVAILABLE_REASON);
		await expect(api.pullRequestSnapshot({ cwd: "/tmp/project", reference: "1" })).rejects.toThrow(GIT_GITHUB_UNAVAILABLE_REASON);
		await expect(api.preparePullRequestThread({ cwd: "/tmp/project", reference: "1", mode: "local" })).rejects.toThrow(GIT_GITHUB_UNAVAILABLE_REASON);
	});
});
