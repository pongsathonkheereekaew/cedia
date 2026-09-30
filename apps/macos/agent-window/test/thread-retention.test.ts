import { expect, it } from "bun:test";
import {
  archiveRetentionReason,
  describeArchiveRetention,
  describeRestoration,
} from "../vendor/synara/apps/web/src/lib/threadRetention";
import type { ThreadSessionArchive } from "../vendor/synara/apps/web/src/types";

const retained: ThreadSessionArchive = {
  state: "retained",
  ref: "refs/cedia/archive/task-1/1",
  commit: "0123456789abcdef0123456789abcdef01234567",
  branch: "cedia/task-1",
  worktree: "/Users/tester/Library/Application Support/Cedia/host/worktrees/task-1",
  dirty: true,
  ignored: false,
  recordedAt: "2026-09-24T10:00:00.000Z",
  reason: "Cleanup is inactive, so the worktree and its branch were kept.",
};

it("says what an archive kept, in the host's own terms", () => {
  expect(describeArchiveRetention(retained)).toBe(
    "Kept · cedia/task-1 at 0123456789ab · /Users/tester/Library/Application Support/Cedia/host/worktrees/task-1 · uncommitted changes",
  );
  expect(archiveRetentionReason(retained)).toBe("Cleanup is inactive, so the worktree and its branch were kept.");
  // A task that worked in the project folder has no worktree and no branch to name.
  expect(describeArchiveRetention({ ...retained, branch: undefined, worktree: undefined, commit: undefined, dirty: false }))
    .toBe("Kept · no worktree");
  expect(describeArchiveRetention({ ...retained, dirty: false, ignored: true })).toContain("ignored files");
});

it("says where Continue resumed, including the case where the branch had to change", () => {
  expect(describeRestoration({ at: "2026-09-24T10:05:00.000Z", worktree: "/tmp/task-1", branch: "cedia/task-1", reattached: true, reason: "The task branch still pointed at the archived commit." }))
    .toBe("Continued in /tmp/task-1 on cedia/task-1");
  expect(describeRestoration({ at: "2026-09-24T10:05:00.000Z", worktree: "/tmp/task-1", branch: "cedia/restore/task-1", reattached: false, reason: "The task branch had moved." }))
    .toBe("Continued in /tmp/task-1 on cedia/restore/task-1, on a new branch");
  expect(describeRestoration(undefined)).toBeNull();
});

it("says nothing when the host recorded nothing", () => {
  expect(describeArchiveRetention(null)).toBeNull();
  expect(describeArchiveRetention(undefined)).toBeNull();
  // A state this build does not know is not a retention claim.
  expect(describeArchiveRetention({ ...retained, state: "vanished" as never })).toBeNull();
  expect(archiveRetentionReason({ ...retained, reason: "" })).toBeNull();
});
