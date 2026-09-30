// FILE: threadRetention.ts
// Purpose: Say, in the owner's words, what an archive kept and where Continue resumed (CEDIA-PLAN
//          §2.6). The host records the decision; this module only reads it, so a window can never
//          imply that files came back when the host did not say so.
// Layer: Web presentation logic
// Exports: describeArchiveRetention, describeRestoration

import type { ThreadSessionArchive, ThreadSessionRestoration } from "../types";

/** The host's own word for each archive state, so the row never overstates what happened. */
const STATE_LABELS: Readonly<Record<ThreadSessionArchive["state"], string>> = {
  retained: "Kept",
  prepared: "Kept and prepared for cleanup",
  removed: "Removed after the archive ref was verified",
  restored: "Restored",
};

/**
 * One line for an archived task: what is still on disk, and what was not.
 *
 * A managed worktree keeps its own root and branch; a task that worked in the project folder has
 * neither, and saying so is the honest answer rather than an empty description.
 */
export function describeArchiveRetention(archive: ThreadSessionArchive | null | undefined): string | null {
  if (!archive || typeof archive.state !== "string" || !(archive.state in STATE_LABELS)) return null;
  const parts: string[] = [STATE_LABELS[archive.state]];
  const kept = archive.branch
    ? archive.commit
      ? `${archive.branch} at ${shortCommit(archive.commit)}`
      : archive.branch
    : archive.worktree
      ? "the task worktree"
      : "no worktree";
  parts.push(kept);
  if (archive.worktree && archive.branch) parts.push(archive.worktree);
  // A task that stopped with uncommitted or ignored files is not a clean restore, and the row says
  // which of the two it was instead of implying the folder was tidy.
  const state: string[] = [];
  if (archive.dirty) state.push("uncommitted changes");
  if (archive.ignored) state.push("ignored files");
  if (state.length > 0) parts.push(state.join(" and "));
  return parts.join(" · ");
}

/** Why the host kept anything at all, in its own words, or nothing when it did not say. */
export function archiveRetentionReason(archive: ThreadSessionArchive | null | undefined): string | null {
  if (!archive || typeof archive.reason !== "string" || archive.reason.length === 0) return null;
  return archive.reason;
}

/**
 * Where Continue put the task back.
 *
 * `reattached: false` is the case worth naming: the recorded branch had moved, so the host continued
 * on a new one rather than moving the user's branch (§2.6).
 */
export function describeRestoration(restored: ThreadSessionRestoration | null | undefined): string | null {
  if (!restored || typeof restored.worktree !== "string" || restored.worktree.length === 0) return null;
  const branch = typeof restored.branch === "string" && restored.branch.length > 0 ? restored.branch : undefined;
  const where = branch ? `${restored.worktree} on ${branch}` : restored.worktree;
  return restored.reattached === false ? `Continued in ${where}, on a new branch` : `Continued in ${where}`;
}

function shortCommit(commit: string): string {
  return commit.length > 12 ? commit.slice(0, 12) : commit;
}
