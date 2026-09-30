// FILE: threadWorkspacePolicy.ts
// Purpose: Pure client rules for task workspace identity and admission feedback.
// Layer: Web workspace presentation
// Depends on: projected thread/session fields only; no host or Git calls.

export type WorkspaceTaskLike = {
  id: string;
  projectId: string;
  archivedAt?: string | null;
  session?: {
    status?: string | null;
    orchestrationStatus?: string | null;
  } | null;
};

export type WorkspaceIdentityLabel = {
  label: string;
  description: string;
  testId: "shared-folder-label" | "busy-git-default-reason";
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const row = error as { code?: unknown; message?: unknown; reason?: unknown };
    const code = typeof row.code === "string" ? row.code : "";
    const message = typeof row.message === "string" ? row.message : "";
    const reason = typeof row.reason === "string" ? row.reason : "";
    if (code && (message || reason)) return `${code}: ${message || reason}`;
    if (code) return code;
    if (message) return message;
    if (reason) return reason;
  }
  return String(error ?? "");
}

/**
 * The host admits a second task only when the existing session is archived or stopped.
 * Keep this predicate intentionally small: a task with a session is a file-mutating owner
 * from the UI's point of view, even while it is idle between turns.
 */
export function isActiveWorkspaceTask(thread: WorkspaceTaskLike): boolean {
  return (
    thread.archivedAt == null &&
    thread.session != null &&
    thread.session.status !== "closed" &&
    thread.session.orchestrationStatus !== "stopped"
  );
}

/** Whether another CEDIA task currently owns the project's file-mutating slot. */
export function hasBusyGitProjectTask(input: {
  projectId: string;
  currentThreadId: string;
  threads: readonly WorkspaceTaskLike[];
}): boolean {
  return input.threads.some(
    (thread) =>
      thread.id !== input.currentThreadId &&
      thread.projectId === input.projectId &&
      isActiveWorkspaceTask(thread),
  );
}

/** Copy used for the persistent task identity pill and draft workspace reason. */
export function resolveWorkspaceIdentityLabel(input: {
  isGitRepo: boolean;
  envMode: "local" | "worktree";
  worktreePath: string | null;
  isBusyGitProject: boolean;
  isDraft: boolean;
}): WorkspaceIdentityLabel | null {
  if (!input.isGitRepo && input.envMode === "local" && input.worktreePath == null) {
    return {
      label: "Shared folder",
      description:
        "This task works in the original folder. There is no Git base branch to select, and only one CEDIA task may edit this non-Git folder at a time.",
      testId: "shared-folder-label",
    };
  }
  if (
    input.isDraft &&
    input.isGitRepo &&
    input.isBusyGitProject &&
    input.envMode === "worktree" &&
    input.worktreePath == null
  ) {
    return {
      label: "Worktree by default",
      description:
        "Another CEDIA task is using this Git project, so this task will start in an isolated worktree.",
      testId: "busy-git-default-reason",
    };
  }
  return null;
}

/**
 * Turn host admission failures into copy that names the next user action. The raw host
 * detail remains in `description` so a support/debug report can still copy it.
 */
export function workspaceErrorToastCopy(error: unknown): {
  title: string;
  description: string;
} | null {
  const detail = errorText(error);
  if (detail.includes("shared_folder_busy")) {
    return {
      title: "Folder is already in use",
      description: `${detail}\nStop or archive the other CEDIA task, or choose another folder before sending again.`,
    };
  }
  if (detail.includes("worktree_required")) {
    return {
      title: "Choose an isolated worktree",
      description: `${detail}\nSelect Worktree and a base branch before sending this task.`,
    };
  }
  if (detail.includes("unknown_base_ref")) {
    return {
      title: "Base branch is unavailable",
      description: `${detail}\nRefresh the local branch list and choose a branch that exists here. CEDIA will not fetch or pull.`,
    };
  }
  return null;
}
