import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHostServer, type StartedHostServer } from "../../host/src/server.ts";
import { CediaHostClient } from "../src/api.ts";
import {
	CEDIA_AGENT_GIT_EVENT_CHANNEL,
	CEDIA_AGENT_WORKTREE_EVENT_CHANNEL,
	createAgentGitService,
	type AgentGitService,
} from "../src/agent-window-git.ts";

/*
 * The Git pane's whole path, against a real repository.
 *
 * §10 item 58: the right-dock pane, the review surface and the branch picker
 * must all read ONE git implementation, which is the host's. The pane's own
 * bridge layer (`native-git.ts`) is a thin request forwarder now, so this test
 * drives the next layer down - the extension's git service - exactly as the
 * panel host does (`handle(event, method, input)`) against a real host server
 * and a real checkout, and reads the resulting repository state back with the
 * `git` binary. Every disabled action the pane offers is in the list below.
 *
 * The host is the same one the packaged app starts; only OMP is absent, which
 * no git method needs.
 */

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

const root = realpathSync(mkdtempSync(join(tmpdir(), "cedia-git-pane-")));
const stateDir = join(root, "host");
const workspace = join(root, "workspace");
mkdirSync(stateDir, { recursive: true });
mkdirSync(join(workspace, "src"), { recursive: true });
writeFileSync(join(workspace, "src", "main.ts"), "export const pane = 1;\n");
writeFileSync(join(workspace, "readme.md"), "Pane fixture\n");
git(workspace, ["init", "--quiet", "-b", "main"]);
git(workspace, ["config", "user.email", "cedia-pane@example.invalid"]);
git(workspace, ["config", "user.name", "Cedia pane"]);
git(workspace, ["add", "."]);
git(workspace, ["commit", "--quiet", "-m", "baseline"]);

const bare = join(root, "origin.git");
mkdirSync(bare, { recursive: true });
git(bare, ["init", "--quiet", "--bare"]);
git(workspace, ["remote", "add", "origin", bare]);
git(workspace, ["push", "--quiet", "--set-upstream", "origin", "main"]);

let server: StartedHostServer;
let client: CediaHostClient;
let service: AgentGitService;
const sent: Array<{ channel: string; event: Record<string, unknown> }> = [];

/** How the panel host hands the pane's call to the service. */
async function pane<T>(method: string, input: unknown): Promise<T> {
	return await service.handle({ sender: { send: (channel: string, event: unknown) => sent.push({ channel, event: event as Record<string, unknown> }) } }, method, input) as T;
}

beforeAll(async () => {
	server = await startHostServer({ stateDir });
	client = await CediaHostClient.fromStateDir(stateDir, { requirePrivateMode: true });
	await client.createProject(workspace, "git pane fixture");
	service = createAgentGitService({ ensureClient: async () => client, actionPollIntervalMs: 25 });
});

afterAll(async () => {
	service?.dispose();
	await server.close();
	rmSync(root, { recursive: true, force: true });
});

describe("the Git pane through the host, on a real checkout", () => {
	it("reads status, branches, commits and blame for the pane's views", async () => {
		writeFileSync(join(workspace, "readme.md"), "Pane fixture\nedited\n");
		const status = await pane<{ branch: string; hasWorkingTreeChanges: boolean; workingTree: { files: { path: string; insertions: number }[] } }>("status", { cwd: workspace });
		expect(status.branch).toBe("main");
		expect(status.hasWorkingTreeChanges).toBe(true);
		expect(status.workingTree.files.map(file => file.path)).toContain("readme.md");
		expect(status.workingTree.files.find(file => file.path === "readme.md")?.insertions).toBe(1);

		const branches = await pane<{ branches: { name: string; current: boolean }[]; isRepo: boolean; hasOriginRemote: boolean }>("listBranches", { cwd: workspace });
		expect(branches.isRepo).toBe(true);
		expect(branches.hasOriginRemote).toBe(true);
		expect(branches.branches.some(branch => branch.name === "main" && branch.current)).toBe(true);

		const commits = await pane<{ commits: { subject: string }[] }>("listRecentCommits", { cwd: workspace, limit: 5 });
		expect(commits.commits[0]?.subject).toBe("baseline");

		const blame = await pane<{ author: string; uncommitted: boolean }>("blameLine", { cwd: workspace, filePath: "src/main.ts", line: 1 });
		expect(blame.author).toBe("Cedia pane");
		expect(blame.uncommitted).toBe(false);
	});

	it("stages, unstages, and reports both through the same status", async () => {
		expect(await pane<{ ok: boolean }>("stageFiles", { cwd: workspace, paths: ["readme.md"] })).toEqual({ ok: true });
		expect(git(workspace, ["diff", "--cached", "--name-only"]).trim()).toBe("readme.md");

		expect(await pane<{ ok: boolean }>("unstageFiles", { cwd: workspace, paths: ["readme.md"] })).toEqual({ ok: true });
		expect(git(workspace, ["diff", "--cached", "--name-only"]).trim()).toBe("");
	});

	it("commits from the pane's action stream and reports every phase to the webview", async () => {
		sent.length = 0;
		const result = await pane<{ commit: { status: string; subject?: string } }>("runStackedAction", {
			actionId: "pane-commit",
			cwd: workspace,
			action: "commit",
			commitMessage: "pane commit",
			filePaths: ["readme.md"],
		});
		expect(result.commit.status).toBe("created");
		expect(result.commit.subject).toBe("pane commit");
		expect(git(workspace, ["log", "-1", "--format=%s"]).trim()).toBe("pane commit");
		const phases = sent.filter(entry => entry.channel === CEDIA_AGENT_GIT_EVENT_CHANNEL).map(entry => entry.event.kind);
		expect(phases).toEqual(["action_started", "phase_started", "action_finished"]);
		expect(sent.every(entry => entry.event.actionId === "pane-commit")).toBe(true);
	});

	it("pulls a real fast-forward, and refuses to invent a merge when the branch diverged", async () => {
		// The remote has not moved: the pane's Pull is a no-op, not an error.
		expect(await pane<{ status: string; branch: string }>("pull", { cwd: workspace })).toMatchObject({ status: "skipped_up_to_date", branch: "main" });

		// The remote moved and the local checkout did not: a fast-forward lands, and the
		// second clone is the author of the commit the pane sees arrive.
		git(workspace, ["push", "--quiet"]);
		const clone = join(root, "second");
		execFileSync("git", ["clone", "--quiet", bare, clone], { encoding: "utf8" });
		git(clone, ["config", "user.email", "cedia-pane@example.invalid"]);
		git(clone, ["config", "user.name", "Second"]);
		writeFileSync(join(clone, "readme.md"), "from the second clone\n");
		git(clone, ["commit", "--quiet", "-am", "second"]);
		git(clone, ["push", "--quiet"]);
		expect(await pane<{ status: string }>("pull", { cwd: workspace })).toMatchObject({ status: "pulled" });
		expect(git(workspace, ["log", "-1", "--format=%s"]).trim()).toBe("second");

		// Both sides moved: a fast-forward is impossible, and the pane is told so
		// instead of the host inventing a merge commit nobody asked for.
		writeFileSync(join(workspace, "readme.md"), "local work\n");
		git(workspace, ["commit", "--quiet", "-am", "local work"]);
		writeFileSync(join(clone, "readme.md"), "third\n");
		git(clone, ["commit", "--quiet", "-am", "third"]);
		git(clone, ["push", "--quiet"]);
		await expect(pane("pull", { cwd: workspace })).rejects.toThrow(/fast-forward/i);
		expect(git(workspace, ["log", "-1", "--format=%s"]).trim()).toBe("local work");
	});

	it("stashes, inspects, restores and drops — the branch picker's recovery path", async () => {
		writeFileSync(join(workspace, "readme.md"), "stashed work\n");
		await pane("createBranch", { cwd: workspace, branch: "pane/other" });
		await pane("stashAndCheckout", { cwd: workspace, branch: "pane/other" });
		expect(git(workspace, ["branch", "--show-current"]).trim()).toBe("pane/other");
		expect(git(workspace, ["stash", "list"]).trim().length).toBeGreaterThan(0);

		const info = await pane<{ stashRef: string; message: string; files: string[] }>("stashInfo", { cwd: workspace });
		expect(info.stashRef).toBe("stash@{0}");
		expect(info.files).toContain("readme.md");
		await pane("stashDrop", { cwd: workspace, stashRef: info.stashRef });
		expect(git(workspace, ["stash", "list"]).trim()).toBe("");
		await pane("checkout", { cwd: workspace, branch: "main" });
		expect(git(workspace, ["branch", "--show-current"]).trim()).toBe("main");
	});

	it("initialises a folder the pane opens as a project and removes a stale index lock", async () => {
		const fresh = join(root, "fresh");
		mkdirSync(fresh, { recursive: true });
		writeFileSync(join(fresh, "notes.txt"), "hello\n");
		await client.createProject(fresh, "fresh fixture");
		await pane("init", { cwd: fresh });
		expect(git(fresh, ["rev-parse", "--is-inside-work-tree"]).trim()).toBe("true");
		// Idempotent: the pane's row can be pressed twice.
		await pane("init", { cwd: fresh });

		// A stale lock blocks every write until the recovery action clears it.
		const lock = join(fresh, ".git", "index.lock");
		writeFileSync(lock, "");
		await pane("removeIndexLock", { cwd: fresh });
		expect(git(fresh, ["status", "--porcelain"]).trim()).toBe("?? notes.txt");
	});

	it("creates, hands off to, and removes a detached worktree with live progress", async () => {
		sent.length = 0;
		const created = await pane<{ worktree: { path: string; ref: string; branch: string | null } }>("createDetachedWorktree", {
			cwd: workspace,
			ref: "main",
			newBranch: "synara/1a2b3c4d",
			progressId: "setup-1",
		});
		expect(created.worktree.ref).toBe("main");
		expect(created.worktree.branch).toBe("synara/1a2b3c4d");
		expect(git(created.worktree.path, ["rev-parse", "--show-toplevel"]).trim()).toBe(created.worktree.path);
		const worktreeEvents = sent.filter(entry => entry.channel === CEDIA_AGENT_WORKTREE_EVENT_CHANNEL).map(entry => entry.event.kind);
		expect(worktreeEvents).toEqual(["phase_started", "phase_started", "completed"]);
		expect(sent.every(entry => entry.event.progressId === "setup-1")).toBe(true);

		// The handoff moves the thread's uncommitted work into that worktree.
		writeFileSync(join(workspace, "readme.md"), "handoff candidate\n");
		const handoff = await pane<{ targetMode: string; worktreePath: string; changesTransferred: boolean; conflictsDetected: boolean }>("handoffThread", {
			commandId: "handoff-1",
			threadId: "thread-1",
			cwd: workspace,
			targetMode: "worktree",
			currentBranch: "main",
			associatedWorktreePath: created.worktree.path,
			associatedWorktreeBranch: created.worktree.branch,
			associatedWorktreeRef: "main",
			preferredNewWorktreeName: null,
		});
		expect(handoff.conflictsDetected).toBe(false);
		expect(handoff.worktreePath).toBe(created.worktree.path);

		await pane("removeWorktree", { cwd: workspace, path: created.worktree.path, force: true, reclaimTemporaryBranch: true });
		expect(created.worktree.branch === null || !git(workspace, ["branch", "--list", created.worktree.branch]).trim().includes(created.worktree.branch)).toBe(true);
	});

	it("pushes a committed branch and tracks a remote ref from the pane's branch picker", async () => {
		// The previous case left this checkout diverged, so the pane's Push refuses
		// first - the guard is real, not decorative.
		await expect(pane("runStackedAction", { actionId: "pane-behind", cwd: workspace, action: "commit_push", commitMessage: "too early" }))
			.rejects.toThrow(/behind upstream/i);
		execFileSync("git", ["-C", workspace, "reset", "--hard", "--quiet", "origin/main"], { encoding: "utf8" });

		writeFileSync(join(workspace, "readme.md"), "push me\n");
		const pushed = await pane<{ commit: { status: string }; push: { status: string; setUpstream?: boolean } }>("runStackedAction", {
			actionId: "pane-push",
			cwd: workspace,
			action: "commit_push",
			commitMessage: "pane push",
		});
		expect(pushed.commit.status).toBe("created");
		expect(pushed.push.status).toBe("pushed");
		// The bare origin really has it: the pane's Push is not a UI-only state.
		expect(execFileSync("git", ["--git-dir", bare, "log", "-1", "--format=%s", "main"], { encoding: "utf8" }).trim()).toBe("pane push");

		// A remote row in the picker becomes a real local tracking branch.
		const clone = join(root, "remote-checkout");
		execFileSync("git", ["clone", "--quiet", bare, clone], { encoding: "utf8" });
		git(clone, ["config", "user.email", "cedia-pane@example.invalid"]);
		git(clone, ["config", "user.name", "Remote"]);
		git(clone, ["checkout", "--quiet", "-b", "feature/remote"]);
		writeFileSync(join(clone, "feature.txt"), "feature\n");
		git(clone, ["add", "."]);
		git(clone, ["commit", "--quiet", "-m", "feature"]);
		git(clone, ["push", "--quiet", "origin", "feature/remote"]);
		git(workspace, ["fetch", "--quiet", "origin"]);
		await pane("checkout", { cwd: workspace, branch: "origin/feature/remote" });
		expect(git(workspace, ["branch", "--show-current"]).trim()).toBe("feature/remote");
		expect(git(workspace, ["rev-parse", "--abbrev-ref", "@{upstream}"]).trim()).toBe("origin/feature/remote");
	});

	it("refuses a path outside the checkout before the host ever sees it", async () => {
		await expect(pane("stageFiles", { cwd: workspace, paths: ["../outside.txt"] })).rejects.toThrow(/inside the workspace/);
		await expect(pane("stageFiles", { cwd: workspace, paths: [] })).rejects.toThrow(/at least one path/);
	});

	it("refuses the pull-request methods with the reason Cedia can state", async () => {
		await expect(pane("resolvePullRequest", { cwd: workspace, reference: "#1" })).rejects.toThrow(/no GitHub client/);
		await expect(pane("pullRequestSnapshot", { cwd: workspace, reference: "#1" })).rejects.toThrow(/no GitHub client/);
		await expect(pane("preparePullRequestThread", { cwd: workspace, reference: "#1", mode: "local" })).rejects.toThrow(/no GitHub client/);
	});

	it("refuses a path the host does not own before any git process starts", async () => {
		await expect(pane("status", { cwd: root })).rejects.toThrow(/not part of a Cedia project|authoriz/i);
	});
});
