import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GitActionEvent, GitActionPollResult, GitListBranchesResult, GitListRecentCommitsResult, GitMethod, GitPullResult, GitReadFileAtRevResult, GitStatusResult, GitWorktreeResult, GitHubRepositoryResult, GitBlameLineResult, GitDiffResult, GitDiffStatsResult, GitHandoffThreadResult, GitStashInfoResult } from "../../../packages/protocol/src/git.ts";
import { GitPathNotAuthorizedError, createHostGit, type HostGitService } from "../src/git.ts";
import { DurableStore } from "../src/store.ts";

const directories: string[] = [];
const stores: DurableStore[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

function configure(cwd: string): void {
  git(cwd, ["config", "user.email", "cedia-fixture@example.invalid"]);
  git(cwd, ["config", "user.name", "Cedia fixture"]);
}

interface GitFixture {
  readonly root: string;
  readonly plain: string;
  readonly stateDir: string;
  readonly service: HostGitService;
  readonly branch: string;
}

/**
 * A repository with history, a *staged, uncommitted* rename (the `R` record porcelain and
 * numstat carry an extra path for) and a binary file.
 */
function fixture(): GitFixture {
  const stateDir = temporaryDirectory("cedia-git-state-");
  const root = realpathSync(temporaryDirectory("cedia-git-repo-"));
  git(root, ["init", "--quiet"]);
  configure(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "main.txt"), "one\n");
  writeFileSync(join(root, "docs-old.txt"), "notes\n");
  writeFileSync(join(root, "assets.bin"), Buffer.from([0, 1, 2, 3, 0, 5]));
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  writeFileSync(join(root, "src", "second.txt"), "second file\n");
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "second"]);
  git(root, ["mv", "docs-old.txt", "docs-new.txt"]);
  const store = DurableStore.open({ stateDir, recover: false });
  stores.push(store);
  store.createProject({ path: root, name: "Repo" });
  // A second authorized project that is *not* a repository, for the normal-state answers.
  const plain = realpathSync(temporaryDirectory("cedia-git-plain-"));
  store.createProject({ path: plain, name: "Plain" });
  return { root, plain, stateDir, service: createHostGit({ store }), branch: git(root, ["branch", "--show-current"]).trim() };
}

async function call<T>(service: HostGitService, path: string, method: GitMethod, input: Record<string, unknown> = {}): Promise<T> {
  return await service.request({ path, method, input }) as T;
}

/** Poll a streaming action the way the pane's client does, then read it at cursor 0. */
async function waitForAction(service: HostGitService, actionId: string): Promise<{ events: GitActionEvent[]; poll: GitActionPollResult }> {
  let poll = service.pollAction(actionId, 0);
  const deadline = Date.now() + 5_000;
  while (!poll?.done && Date.now() < deadline) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 5);
    await promise;
    poll = service.pollAction(actionId, 0);
  }
  if (!poll?.done) throw new Error(`Git action ${actionId} did not finish`);
  return { events: poll.events, poll };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("host git service", () => {
  it("reports working tree state, branches and history without a GitHub client", async () => {
    const { root, service, branch } = fixture();
    writeFileSync(join(root, "src", "main.txt"), "two\n");
    writeFileSync(join(root, "assets.bin"), Buffer.from([9, 9, 0, 9]));
    writeFileSync(join(root, "fresh.txt"), "untracked\n");

    const status = await call<GitStatusResult>(service, root, "status");
    expect(status.branch).toBe(branch);
    expect(status.pr).toBeNull();
    expect(status.hasUpstream).toBe(false);
    expect(status.hasWorkingTreeChanges).toBe(true);
    // Insertions and deletions come from both `diff` and `diff --cached`, binary hunks count as
    // zero lines, and an untracked path has no counts at all.
    expect(status.workingTree.files).toEqual(expect.arrayContaining([
      { path: "src/main.txt", insertions: 1, deletions: 1, binary: false },
      { path: "assets.bin", insertions: 0, deletions: 0, binary: true },
      { path: "fresh.txt", insertions: 0, deletions: 0, binary: false },
    ]));
    expect(status.workingTree.insertions).toBe(1);
    expect(status.workingTree.deletions).toBe(1);

    const branches = await call<GitListBranchesResult>(service, root, "listBranches");
    expect(branches.isRepo).toBe(true);
    expect(branches.hasOriginRemote).toBe(false);
    expect(branches.branches).toEqual([expect.objectContaining({ name: branch, current: true, isDefault: true, worktreePath: root })]);

    const commits = await call<GitListRecentCommitsResult>(service, root, "listRecentCommits", { limit: 5 });
    expect(commits.commits.map(commit => commit.subject)).toEqual(["second", "fixture"]);
    expect(commits.commits[0]?.sha).toBe(git(root, ["rev-parse", "HEAD"]).trim());
    expect(commits.commits[0]?.committedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("answers a folder that is not a repository as a normal state", async () => {
    const { plain, service } = fixture();

    const status = await call<GitStatusResult>(service, plain, "status");
    expect(status).toEqual({ branch: null, hasWorkingTreeChanges: false, workingTree: { files: [], insertions: 0, deletions: 0 }, hasUpstream: false, upstreamBranch: null, aheadCount: 0, behindCount: 0, pr: null });
    expect(await call<GitListBranchesResult>(service, plain, "listBranches")).toEqual({ branches: [], isRepo: false, hasOriginRemote: false });
    // `porcelain` has no field to say "not a repository", so it states the rejection instead of
    // reporting an empty change list the review surface would read as "clean".
    await expect(call(service, plain, "porcelain")).rejects.toThrow(/not a git repository/);
  });

  it("reads diffs, stats and file revisions, including a rename and a binary hunk", async () => {
    const { root, service } = fixture();
    writeFileSync(join(root, "src", "main.txt"), "two\n");
    writeFileSync(join(root, "assets.bin"), Buffer.from([9, 9, 0, 9]));

    const patch = await call<GitDiffResult>(service, root, "readWorkingTreeDiff", { scope: "workingTree" });
    expect(patch.truncated).toBe(false);
    expect(patch.patch).toContain("src/main.txt");
    expect(patch.patch).toContain("+two");
    expect(patch.patch).toContain("GIT binary patch");
    // The staged half of the working tree is the rename, named by its current path.
    const staged = await call<GitDiffResult>(service, root, "readWorkingTreeDiff", { scope: "staged" });
    expect(staged.patch).toContain("docs-new.txt");
    expect(staged.patch).not.toContain("src/main.txt");

    const stats = await call<GitDiffStatsResult>(service, root, "workingTreeDiffStats", { scope: "workingTree" });
    expect(stats.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/main.txt", insertions: 1, deletions: 1, binary: false }),
      expect.objectContaining({ path: "assets.bin", binary: true }),
    ]));
    expect(stats.fileCount).toBe(stats.files.length);
    expect(stats.additions).toBe(1);
    expect(stats.deletions).toBe(1);

    const file = await call<GitReadFileAtRevResult>(service, root, "readFileAtRev", { filePath: "src/main.txt" });
    expect(file).toEqual({ contents: "one\n", resolvedRev: "HEAD", missing: false, truncated: false });
    expect(await call<GitReadFileAtRevResult>(service, root, "readFileAtRev", { filePath: "src/absent.txt" })).toMatchObject({ missing: true, contents: "" });
    expect(await call<GitReadFileAtRevResult>(service, root, "readFileAtRev", { filePath: "assets.bin", rev: "HEAD" })).toMatchObject({ missing: false });
    // A one-byte cap truncates rather than failing the read.
    expect(await call<GitReadFileAtRevResult>(service, root, "readFileAtRev", { filePath: "src/main.txt", maxBytes: 2 })).toEqual({ contents: "on", resolvedRev: "HEAD", missing: false, truncated: true });
  });

  it("stages and unstages files, moving them across the index and working tree columns", async () => {
    const { root, service } = fixture();
    writeFileSync(join(root, "src", "main.txt"), "staged content\n");

    const before = await call<{ text: string }>(service, root, "porcelain");
    expect(before.text.split("\n")).toContain(" M src/main.txt");

    await call(service, root, "stageFiles", { paths: ["src/main.txt"] });
    const staged = await call<{ text: string }>(service, root, "porcelain");
    expect(staged.text.split("\n")).toContain("M  src/main.txt");
    expect(staged.text.split("\n")).not.toContain(" M src/main.txt");
    expect((await call<GitDiffResult>(service, root, "readWorkingTreeDiff", { scope: "staged" })).patch).toContain("+staged content");
    expect((await call<GitDiffResult>(service, root, "readWorkingTreeDiff", { scope: "unstaged" })).patch).toBe("");

    await call(service, root, "unstageFiles", { paths: ["src/main.txt"] });
    const unstaged = await call<{ text: string }>(service, root, "porcelain");
    expect(unstaged.text.split("\n")).toContain(" M src/main.txt");
    expect(unstaged.text.split("\n")).not.toContain("M  src/main.txt");
    expect((await call<GitDiffResult>(service, root, "readWorkingTreeDiff", { scope: "staged" })).patch).not.toContain("staged content");

    await expect(call(service, root, "stageFiles", { paths: [] })).rejects.toThrow(/at least one path/);
    await expect(call(service, root, "stageFiles", { paths: ["../escape.txt"] })).rejects.toThrow(/inside the workspace/);
  });

  it("stashes, checks out and drops, and reports when there is no stash", async () => {
    const { root, service, branch } = fixture();
    await expect(call(service, root, "stashInfo")).rejects.toThrow(/no stash/);

    await call(service, root, "createBranch", { branch: "cedia-other" });
    writeFileSync(join(root, "src", "main.txt"), "work in progress\n");
    writeFileSync(join(root, "notes.txt"), "untracked\n");
    await call(service, root, "stashAndCheckout", { branch: "cedia-other" });

    const status = await call<GitStatusResult>(service, root, "status");
    expect(status.branch).toBe("cedia-other");
    expect(status.branch).not.toBe(branch);
    expect(status.hasWorkingTreeChanges).toBe(false);
    expect(readFileSync(join(root, "src", "main.txt"), "utf8")).toBe("one\n");
    expect(existsSync(join(root, "notes.txt"))).toBe(false);

    const info = await call<GitStashInfoResult>(service, root, "stashInfo");
    expect(info.stashRef).toBe("stash@{0}");
    expect(info.branch).toBe("cedia-other");
    expect(info.files).toEqual(expect.arrayContaining(["src/main.txt", "notes.txt"]));

    await call(service, root, "stashDrop", { stashRef: info.stashRef });
    await expect(call(service, root, "stashInfo")).rejects.toThrow(/no stash/);
    await expect(call(service, root, "stashDrop", { stashRef: "HEAD~1" })).rejects.toThrow(/Invalid Git stash ref/);
  });

  it("removes only the index lock and refuses anything else wearing its name", async () => {
    const { root, service } = fixture();
    const lock = join(root, ".git", "index.lock");
    const userFile = join(root, "keep.txt");
    writeFileSync(userFile, "user file\n");

    // Nothing to remove is a no-op, not a failure.
    await call(service, root, "removeIndexLock");
    expect(existsSync(lock)).toBe(false);
    expect(readFileSync(userFile, "utf8")).toBe("user file\n");

    writeFileSync(lock, "");
    await call(service, root, "removeIndexLock");
    expect(existsSync(lock)).toBe(false);
    expect(readFileSync(userFile, "utf8")).toBe("user file\n");

    // A symlink is never followed: the link stays and its target is untouched.
    symlinkSync(userFile, lock);
    await expect(call(service, root, "removeIndexLock")).rejects.toThrow(/not a regular file/);
    expect(readFileSync(userFile, "utf8")).toBe("user file\n");
  });

  it("initialises a fresh folder once and leaves an existing repository alone", async () => {
    const { root, plain, service, branch } = fixture();
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    await call(service, root, "init");
    expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(git(root, ["branch", "--show-current"]).trim()).toBe(branch);

    // A folder inside a checkout keeps that checkout: `init` never plants a nested repository.
    const nested = join(root, "nested");
    mkdirSync(nested);
    await call(service, nested, "init");
    expect(existsSync(join(nested, ".git"))).toBe(false);

    const fresh = plain;
    await call(service, fresh, "init");
    await call(service, fresh, "init");
    expect(git(fresh, ["rev-parse", "--show-toplevel"]).trim()).toBe(realpathSync(fresh));
    expect((await call<GitStatusResult>(service, fresh, "status")).branch).toBe("main");
    expect(git(fresh, ["branch", "--show-current"]).trim()).toBe("main");

    // Before the first commit there is no HEAD to restore from, so unstaging empties the index.
    writeFileSync(join(fresh, "new.txt"), "first\n");
    await call(service, fresh, "stageFiles", { paths: ["new.txt"] });
    expect((await call<{ text: string }>(service, fresh, "porcelain")).text.split("\n")).toContain("A  new.txt");
    await call(service, fresh, "unstageFiles", { paths: ["new.txt"] });
    const after = await call<{ text: string }>(service, fresh, "porcelain");
    expect(after.text.split("\n")).toContain("?? new.txt");
    expect(after.text.split("\n")).not.toContain("A  new.txt");
  });

  it("pulls fast-forward only and reports an already current branch", async () => {
    const remote = join(temporaryDirectory("cedia-git-remote-"), "origin.git");
    git(dirname(remote), ["init", "--bare", "--quiet", remote]);
    const workParent = temporaryDirectory("cedia-git-work-");
    git(workParent, ["clone", "--quiet", remote, "work"]);
    const work = realpathSync(join(workParent, "work"));
    configure(work);
    writeFileSync(join(work, "app.txt"), "first\n");
    git(work, ["add", "."]);
    git(work, ["commit", "--quiet", "-m", "first"]);
    git(work, ["push", "--quiet", "--set-upstream", "origin", "HEAD"]);

    const otherParent = temporaryDirectory("cedia-git-other-");
    git(otherParent, ["clone", "--quiet", remote, "other"]);
    const other = join(otherParent, "other");
    configure(other);

    const stateDir = temporaryDirectory("cedia-git-state-");
    const store = DurableStore.open({ stateDir, recover: false });
    stores.push(store);
    store.createProject({ path: work, name: "Clone" });
    const service = createHostGit({ store });

    // The remote-tracking ref is current, and the pull still asks git.
    expect(await call<GitPullResult>(service, work, "pull")).toMatchObject({ status: "skipped_up_to_date", branch: "main" });

    writeFileSync(join(other, "app.txt"), "second\n");
    git(other, ["add", "."]);
    git(other, ["commit", "--quiet", "-m", "second"]);
    git(other, ["push", "--quiet"]);
    const pulled = await call<GitPullResult>(service, work, "pull");
    expect(pulled.status).toBe("pulled");
    expect(pulled.branch).toBe("main");
    expect(pulled.upstreamBranch).toBe("origin/main");
    expect(readFileSync(join(work, "app.txt"), "utf8")).toBe("second\n");

    // A branch with no upstream cannot be pulled.
    git(work, ["checkout", "--quiet", "-b", "detached-work"]);
    await expect(call(service, work, "pull")).rejects.toThrow(/no upstream/);
  });

  it("blames a committed line and flags a working tree line as uncommitted", async () => {
    const { root, service } = fixture();
    const blame = await call<GitBlameLineResult>(service, root, "blameLine", { filePath: "src/second.txt", line: 1 });
    expect(blame.sha).toBe(git(root, ["rev-parse", "HEAD"]).trim());
    expect(blame.shortSha).toBe(blame.sha.slice(0, 7));
    expect(blame.author).toBe("Cedia fixture");
    expect(blame.authorEmail).toBe("cedia-fixture@example.invalid");
    expect(blame.summary).toBe("second");
    expect(blame.authorTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(blame.uncommitted).toBe(false);

    writeFileSync(join(root, "src", "second.txt"), "edited in the working tree\n");
    expect(await call<GitBlameLineResult>(service, root, "blameLine", { filePath: "src/second.txt", line: 1 })).toMatchObject({ uncommitted: true });
    await expect(call(service, root, "blameLine", { filePath: "src/second.txt", line: 0 })).rejects.toThrow(/Invalid Git blame line/);
  });

  it("names the origin repository for ssh and https remotes, and nothing without one", async () => {
    const { root, service } = fixture();
    expect(await call<GitHubRepositoryResult>(service, root, "githubRepository")).toEqual({ repository: null, repositories: [] });

    git(root, ["remote", "add", "origin", "git@github.com:cedia/example.git"]);
    expect(await call<GitHubRepositoryResult>(service, root, "githubRepository")).toEqual({ repository: { nameWithOwner: "cedia/example", url: "https://github.com/cedia/example" }, repositories: [] });

    git(root, ["remote", "set-url", "origin", "https://github.com/cedia/example.git"]);
    expect(await call<GitHubRepositoryResult>(service, root, "githubRepository")).toEqual({ repository: { nameWithOwner: "cedia/example", url: "https://github.com/cedia/example" }, repositories: [] });

    // A local path is not a repository Cedia can name.
    git(root, ["remote", "set-url", "origin", "/tmp/somewhere/example.git"]);
    expect(await call<GitHubRepositoryResult>(service, root, "githubRepository")).toEqual({ repository: null, repositories: [] });
  });

  it("creates detached worktrees, hands uncommitted work across and removes them again", async () => {
    const { root, stateDir, service, branch } = fixture();
    const head = git(root, ["rev-parse", "HEAD"]).trim();

    const detached = await call<GitWorktreeResult>(service, root, "createDetachedWorktree", { ref: head });
    expect(detached.worktree.branch).toBeNull();
    expect(dirname(detached.worktree.path)).toBe(join(stateDir, "worktrees"));
    expect(git(detached.worktree.path, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("HEAD");
    await call(service, root, "removeWorktree", { path: detached.worktree.path, force: true, reclaimTemporaryBranch: true });
    expect(existsSync(detached.worktree.path)).toBe(false);

    // A copy carries the uncommitted state into the new checkout and stays on its branch.
    writeFileSync(join(root, "src", "main.txt"), "carried into the worktree\n");
    const copied = await call<GitWorktreeResult>(service, root, "createDetachedWorktree", { ref: head, newBranch: "cedia-wt-copy", copyChangesFrom: root });
    expect(copied.worktree.branch).toBe("cedia-wt-copy");
    expect(readFileSync(join(copied.worktree.path, "src", "main.txt"), "utf8")).toBe("carried into the worktree\n");
    expect(readFileSync(join(root, "src", "main.txt"), "utf8")).toBe("carried into the worktree\n");

    // A user-named branch survives removal; only the host's own namespaces are reclaimed.
    await call(service, root, "removeWorktree", { path: copied.worktree.path, force: true, reclaimTemporaryBranch: true });
    expect(existsSync(copied.worktree.path)).toBe(false);
    expect(git(root, ["branch", "--list", "cedia-wt-copy"]).trim()).toContain("cedia-wt-copy");

    // Handoff to a worktree moves the changes out of the local checkout.
    writeFileSync(join(root, "src", "main.txt"), "handoff edit\n");
    const intoWorktree = await call<GitHandoffThreadResult>(service, root, "handoffThread", {
      threadId: "thread-1",
      cwd: root,
      targetMode: "worktree",
      currentBranch: branch,
      worktreePath: null,
      associatedWorktreePath: null,
      associatedWorktreeBranch: null,
      associatedWorktreeRef: null,
      preferredLocalBranch: branch,
      preferredWorktreeBaseBranch: branch,
      preferredNewWorktreeName: "Thread One",
    });
    const worktreePath = intoWorktree.worktreePath;
    expect(worktreePath).not.toBeNull();
    expect(intoWorktree.targetMode).toBe("worktree");
    expect(intoWorktree.branch).toBe("cedia/task-thread-one");
    expect(intoWorktree.changesTransferred).toBe(true);
    expect(intoWorktree.conflictsDetected).toBe(false);
    expect(intoWorktree.message).toBeNull();
    expect(readFileSync(join(worktreePath!, "src", "main.txt"), "utf8")).toBe("handoff edit\n");
    expect(readFileSync(join(root, "src", "main.txt"), "utf8")).toBe("one\n");

    // Handoff back to local carries them the other way, and the checkout keeps its branch.
    const back = await call<GitHandoffThreadResult>(service, root, "handoffThread", {
      threadId: "thread-1",
      cwd: root,
      targetMode: "local",
      currentBranch: intoWorktree.branch,
      worktreePath,
      associatedWorktreePath: intoWorktree.associatedWorktreePath,
      associatedWorktreeBranch: intoWorktree.associatedWorktreeBranch,
      associatedWorktreeRef: intoWorktree.associatedWorktreeRef,
      preferredLocalBranch: branch,
    });
    expect(back.worktreePath).toBeNull();
    expect(back.branch).toBe(branch);
    expect(back.changesTransferred).toBe(true);
    expect(back.conflictsDetected).toBe(false);
    expect(readFileSync(join(root, "src", "main.txt"), "utf8")).toBe("handoff edit\n");

    const managed = intoWorktree.branch!;
    await call(service, root, "removeWorktree", { path: worktreePath!, force: true, reclaimTemporaryBranch: true });
    expect(existsSync(worktreePath!)).toBe(false);
    expect(git(root, ["branch", "--list", managed]).trim()).toBe("");
  });

  it("refuses work that does not belong to an authorized root", async () => {
    const { root, stateDir, service, branch } = fixture();
    const outside = temporaryDirectory("cedia-git-outside-");
    await expect(call(service, outside, "status")).rejects.toBeInstanceOf(GitPathNotAuthorizedError);
    // The state directory itself is not a root: only its worktrees folder is.
    await expect(call(service, stateDir, "status")).rejects.toBeInstanceOf(GitPathNotAuthorizedError);
    await expect(call(service, root, "createDetachedWorktree", { ref: branch, path: join(outside, "worktree") })).rejects.toBeInstanceOf(GitPathNotAuthorizedError);
    await expect(call(service, root, "removeWorktree", { path: outside })).rejects.toBeInstanceOf(GitPathNotAuthorizedError);
    await expect(call(service, root, "handoffThread", { threadId: "t", cwd: root, targetMode: "local", currentBranch: null, worktreePath: outside })).rejects.toBeInstanceOf(GitPathNotAuthorizedError);
  });

  it("streams a stacked action's phases and its terminal result", async () => {
    const { root, service } = fixture();
    writeFileSync(join(root, "src", "main.txt"), "committed by the action\n");
    const started = service.startAction({ actionId: "action-commit", path: root, kind: "stacked", action: "commit", commitMessage: "committed by the action" });
    expect(started).toEqual({ actionId: "action-commit" });
    expect(service.pollAction("action-unknown", 0)).toBeUndefined();

    const { events, poll } = await waitForAction(service, "action-commit");
    expect(events.map(event => event.kind)).toEqual(["action_started", "phase_started", "action_finished"]);
    expect(events[0]).toEqual({ kind: "action_started", actionId: "action-commit", phases: ["commit"] });
    expect(events[1]).toMatchObject({ kind: "phase_started", actionId: "action-commit", phase: "commit" });
    expect(poll.done).toBe(true);
    expect(poll.error).toBeUndefined();
    expect(poll.result).toMatchObject({
      action: "commit",
      branch: { status: "skipped_not_requested" },
      commit: { status: "created", subject: "committed by the action" },
      push: { status: "skipped_not_requested" },
      pr: { status: "skipped_not_requested" },
    });
    expect(git(root, ["log", "-1", "--format=%s"]).trim()).toBe("committed by the action");
    // The cursor only delivers what the caller has not seen.
    expect(service.pollAction("action-commit", events.length)).toEqual({ events: [], done: true, result: poll.result });
  });

  it("reports a failing action as an event and as the poll's error", async () => {
    const { root, service } = fixture();
    service.startAction({ actionId: "action-push", path: root, kind: "stacked", action: "push" });
    const { events, poll } = await waitForAction(service, "action-push");
    expect(events.at(-1)).toMatchObject({ kind: "action_failed", actionId: "action-push" });
    expect(poll.done).toBe(true);
    expect(poll.error).toContain("origin");
  });

  it("streams the worktree action's real phases and its result", async () => {
    const { root, service, branch } = fixture();
    writeFileSync(join(root, "src", "main.txt"), "streamed copy\n");
    service.startAction({
      actionId: "action-worktree",
      path: root,
      kind: "worktree",
      progressId: "progress-1",
      worktree: { ref: branch, newBranch: "cedia-wt-stream", copyChangesFrom: root },
    });
    const { events, poll } = await waitForAction(service, "action-worktree");
    expect(events.map(event => event.kind)).toEqual(["phase_started", "phase_started", "phase_started", "worktree_completed"]);
    expect(events.map(event => (event.kind === "phase_started" ? event.phase : null))).toEqual(["branch", "worktree", "copy-changes", null]);
    expect(poll.error).toBeUndefined();
    const completed = events.at(-1);
    expect(completed).toMatchObject({ kind: "worktree_completed", actionId: "action-worktree" });
    const result = poll.result as GitWorktreeResult;
    expect(result.worktree.branch).toBe("cedia-wt-stream");
    expect(readFileSync(join(result.worktree.path, "src", "main.txt"), "utf8")).toBe("streamed copy\n");
  });
});
