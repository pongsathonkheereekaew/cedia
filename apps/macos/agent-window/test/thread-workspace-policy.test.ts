import { describe, expect, it } from "bun:test";
import { buildThreadErrorToastOptions } from "../vendor/synara/apps/web/src/components/chat/useThreadErrorToast";
import {
  resolveBranchPickerBranches,
  resolveWorktreeBaseBranch,
} from "../vendor/synara/apps/web/src/components/BranchToolbar.logic";
import {
  hasBusyGitProjectTask,
  resolveWorkspaceIdentityLabel,
  workspaceErrorToastCopy,
} from "../vendor/synara/apps/web/src/lib/threadWorkspacePolicy";

const localBranch = (name: string, current = false) => ({
  name,
  current,
  isDefault: name === "main",
  isRemote: false,
  worktreePath: null,
});

const remoteBranch = (name: string) => ({
  name,
  current: false,
  isDefault: false,
  isRemote: true,
  remoteName: "origin",
  worktreePath: null,
});

describe("new-task workspace presentation", () => {
  it("offers only local refs when a worktree draft picks its base", () => {
    const choices = resolveBranchPickerBranches(
      [localBranch("main", true), remoteBranch("origin/main"), localBranch("feature")],
      true,
    );
    expect(choices.map((branch) => branch.name)).toEqual(["main", "feature"]);
    expect(resolveWorktreeBaseBranch([remoteBranch("origin/main"), localBranch("feature")], "feature")).toBe("feature");
    expect(resolveWorktreeBaseBranch([localBranch("release"), { ...localBranch("main"), isDefault: true }], "feature")).toBe("main");
    expect(
      resolveBranchPickerBranches([localBranch("main"), remoteBranch("origin/feature")], false).map(
        (branch) => branch.name,
      ),
    ).toEqual(["main", "origin/feature"]);
  });

  it("detects an active task in the same Git project for the isolated default", () => {
    expect(
      hasBusyGitProjectTask({
        projectId: "project-1",
        currentThreadId: "draft-1",
        threads: [
          {
            id: "task-1",
            projectId: "project-1",
            session: { status: "ready", orchestrationStatus: "ready" },
          },
          {
            id: "stopped-1",
            projectId: "project-1",
            session: { status: "closed", orchestrationStatus: "stopped" },
          },
        ],
      }),
    ).toBe(true);
    expect(
      hasBusyGitProjectTask({
        projectId: "project-1",
        currentThreadId: "draft-1",
        threads: [
          {
            id: "stopped-1",
            projectId: "project-1",
            session: { status: "closed", orchestrationStatus: "stopped" },
          },
        ],
      }),
    ).toBe(false);
  });

  it("names shared-folder and busy-Git identity states", () => {
    expect(
      resolveWorkspaceIdentityLabel({
        isGitRepo: false,
        envMode: "local",
        worktreePath: null,
        isBusyGitProject: false,
        isDraft: false,
      }),
    ).toMatchObject({ label: "Shared folder", testId: "shared-folder-label" });
    expect(
      resolveWorkspaceIdentityLabel({
        isGitRepo: true,
        envMode: "worktree",
        worktreePath: null,
        isBusyGitProject: true,
        isDraft: true,
      }),
    ).toMatchObject({ label: "Worktree by default", testId: "busy-git-default-reason" });
  });

  it("turns host admission failures into actionable rendered toast copy", () => {
    for (const [code, phrase] of [
      ["unknown_base_ref", "Refresh the local branch list"],
      ["worktree_required", "Select Worktree and a base branch"],
      ["shared_folder_busy", "Stop or archive the other CEDIA task"],
    ] as const) {
      const copy = workspaceErrorToastCopy(`${code}: host detail`);
      expect(copy?.description).toContain(phrase);
      expect(workspaceErrorToastCopy({ code, reason: "host detail" })?.description).toContain(phrase);
      const toast = buildThreadErrorToastOptions({
        error: `${code}: host detail`,
        onClose: () => undefined,
        onUnblock: () => undefined,
        threadId: "thread-1" as never,
        unblocking: false,
      });
      expect(toast.title).not.toBe(`${code}: host detail`);
      expect(toast.description).toContain(phrase);
      expect(toast.timeout).toBe(0);
    }
  });
});
