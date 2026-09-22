import { describe, expect, it } from "bun:test";
import {
	REVIEW_NO_GIT_REASON,
	REVIEW_STALE_REASON,
	emptyReview,
	markReviewDirtyConflict,
	markReviewStale,
	REVIEW_DIRTY_REASON,
	REVIEW_NO_PROPOSAL_REASON,
	parsePorcelainStatus,
	parseUnifiedDiff,
	splitHunkColumns,
	ideLandingForWorkTab,
	reviewFromGitStatus,
	reviewPlusMinus,
	reviewSummary,
	reviewWorkspaceLabel,
	reviewCommitPreview,
	COMMIT_AND_PUSH_REASON,
	COMMIT_NO_CONTRACT_REASON,
	REVIEW_BRING_BACK_REASON,
	REVIEW_CONFLICT_REASON,
	reviewBringBackPreview,
	reviewConflictMark,
	reviewOpenMergeEnabled,
} from "../src/review-snapshot.ts";

describe("parsePorcelainStatus", () => {
	it("separates tracked, untracked, and conflict rows", () => {
		const files = parsePorcelainStatus([
			" M src/webview.ts",
			"A  apps/macos/src/review-snapshot.ts",
			"?? notes.md",
			"UU conflict.ts",
			"R  old.ts -> new.ts",
			"warning: ignore",
		].join("\n"));
		expect(files).toEqual([
			{ path: "src/webview.ts", status: "modified", tracked: true, staged: false, unstaged: true, binaryHint: false },
			{ path: "apps/macos/src/review-snapshot.ts", status: "added", tracked: true, staged: true, unstaged: false, binaryHint: false },
			{ path: "notes.md", status: "untracked", tracked: false, staged: false, unstaged: false, binaryHint: false },
			{ path: "conflict.ts", status: "conflict", tracked: true, staged: true, unstaged: true, binaryHint: false },
			{ path: "new.ts", status: "renamed", tracked: true, staged: true, unstaged: false, binaryHint: false },
		]);
	});

	it("marks common binary extensions without opening the file", () => {
		expect(parsePorcelainStatus("?? shot.png")[0]?.binaryHint).toBe(true);
	});
});

describe("reviewFromGitStatus", () => {
	it("parses unified hunks without executing them", () => {
		expect(parseUnifiedDiff("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n context\n-old\n+new\n")).toEqual([
			{ header: "@@ -1,2 +1,3 @@", lines: [" context", "-old", "+new"] },
		]);
	});

	it("keeps an honest error and does not invent files", () => {
		expect(reviewFromGitStatus("", "/tmp/repo", "fatal: not a git repository")).toEqual({
			cwd: "/tmp/repo",
			files: [],
			error: REVIEW_NO_GIT_REASON,
			stale: false,
			noGit: true,
		});
		// Item 58: the host states the same normal state in its own words, and the
		// panel must still explain a non-Git folder instead of showing no changes.
		expect(reviewFromGitStatus("", "/tmp/repo", "This folder is not a git repository")).toEqual({
			cwd: "/tmp/repo",
			files: [],
			error: REVIEW_NO_GIT_REASON,
			stale: false,
			noGit: true,
		});
		expect(reviewFromGitStatus("", "/tmp/repo", "git timed out")).toEqual({
			cwd: "/tmp/repo",
			files: [],
			error: "git timed out",
			stale: false,
			noGit: false,
		});
	});
});

describe("reviewSummary", () => {
	it("counts porcelain statuses without inventing plus/minus", () => {
		const files = parsePorcelainStatus([
			" M src/webview.ts",
			"A  apps/macos/src/review-snapshot.ts",
			" D gone.ts",
			"?? notes.md",
			"UU conflict.ts",
			"R  old.ts -> new.ts",
			"?? shot.png",
		].join("\n"));
		expect(reviewSummary(files)).toEqual({
			total: 7,
			modified: 1,
			added: 1,
			deleted: 1,
			renamed: 1,
			untracked: 2,
			conflict: 1,
			binary: 1,
			plus: 0,
			minus: 0,
		});
	});

	it("fills plus/minus only when hunks are provided", () => {
		const files = parsePorcelainStatus(" M a.ts");
		const hunks = parseUnifiedDiff("@@ -1,2 +1,3 @@\n context\n-old\n+new\n+more\n");
		expect(reviewSummary(files).plus).toBe(0);
		expect(reviewSummary(files, hunks)).toEqual({
			total: 1,
			modified: 1,
			added: 0,
			deleted: 0,
			renamed: 0,
			untracked: 0,
			conflict: 0,
			binary: 0,
			plus: 2,
			minus: 1,
		});
	});
});

describe("reviewPlusMinus", () => {
	it("counts added and removed content lines and ignores @@ and \\ markers", () => {
		expect(reviewPlusMinus(parseUnifiedDiff(
			"diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n context\n-old\n+new\n\\ No newline at end of file\n",
		))).toEqual({ plus: 1, minus: 1 });
		expect(reviewPlusMinus([{
			header: "@@ -1 +1 @@",
			lines: ["@@ leftover header", "-removed", "+added", "\\ No newline at end of file"],
		}])).toEqual({ plus: 1, minus: 1 });
	});
});

describe("markReviewStale", () => {
	it("sets stale and the default English apply-block copy without mutating the input", () => {
		const snapshot = reviewFromGitStatus(" M a.ts", "/tmp/repo");
		const stale = markReviewStale(snapshot);
		expect(snapshot.stale).toBe(false);
		expect(snapshot.staleReason).toBeUndefined();
		expect(stale.stale).toBe(true);
		expect(stale.staleReason).toBe(REVIEW_STALE_REASON);
		expect(stale.staleReason).toContain("The file changed — reload the diff. Cedia will not apply a stale hunk.");
		expect(stale.files).toEqual(snapshot.files);
		expect(markReviewStale(emptyReview("/tmp/repo"), "hash mismatch").staleReason).toBe("hash mismatch");
	});
});

describe("reviewWorkspaceLabel", () => {
	it("labels a folder when no branch is supplied and never invents one", () => {
		expect(reviewWorkspaceLabel("/Users/pond/cedia")).toBe("Folder · /Users/pond/cedia");
		expect(reviewWorkspaceLabel("/Users/pond/cedia", undefined)).toBe("Folder · /Users/pond/cedia");
		expect(reviewWorkspaceLabel("/Users/pond/cedia", "main")).toBe("main · /Users/pond/cedia");
	});
});

describe("binary review projection", () => {
	it("marks binaries without fabricating a text diff", () => {
		const files = parsePorcelainStatus(" M shot.png");
		expect(files[0]?.binaryHint).toBe(true);
		expect(reviewSummary(files)).toEqual({
			total: 1,
			modified: 1,
			added: 0,
			deleted: 0,
			renamed: 0,
			untracked: 0,
			conflict: 0,
			binary: 1,
			plus: 0,
			minus: 0,
		});
		expect(parseUnifiedDiff("diff --git a/shot.png b/shot.png\nBinary files a/shot.png and b/shot.png differ\n")).toEqual([]);
		expect(reviewPlusMinus([])).toEqual({ plus: 0, minus: 0 });
	});
});

describe("reviewCommitPreview", () => {
	it("counts staged vs unstaged and never enables auto-push", () => {
		const preview = reviewCommitPreview({
			branch: "main",
			files: [
				{ path: "a.ts", status: "modified", tracked: true, staged: true, unstaged: false, binaryHint: false },
				{ path: "b.ts", status: "untracked", tracked: false, staged: false, unstaged: false, binaryHint: false },
			],
			message: "  ",
		});
		expect(preview.staged).toBe(1);
		expect(preview.unstaged).toBe(1);
		expect(preview.emptyMessage).toBe(true);
		expect(preview.commitEnabled).toBe(false);
		expect(preview.pushEnabled).toBe(false);
		expect(preview.commitReason).toBe(COMMIT_NO_CONTRACT_REASON);
		expect(preview.pushReason).toBe(COMMIT_AND_PUSH_REASON);
	});
});

describe("markReviewDirtyConflict", () => {
	it("flags overlapping dirty buffers and does not invent an apply path", () => {
		const review = reviewFromGitStatus(" M src/webview.ts\n", "/tmp/repo");
		const marked = markReviewDirtyConflict(review, ["/tmp/repo/src/webview.ts"]);
		expect(marked.dirtyConflict).toBe(true);
		expect(marked.dirtyPaths).toEqual(["src/webview.ts"]);
		expect(marked.dirtyConflictReason).toBe(REVIEW_DIRTY_REASON);
		expect(REVIEW_NO_PROPOSAL_REASON).toContain("does not invent hunks");
	});
});

describe("conflict and bring-back honesty", () => {
	it("marks conflicts and keeps bring-back disabled until OMP advertises a checkpoint", () => {
		expect(reviewConflictMark("conflict")).toBe("U");
		expect(reviewConflictMark("untracked")).toBe("?");
		expect(reviewOpenMergeEnabled({ status: "conflict" })).toBe(true);
		expect(reviewOpenMergeEnabled({ status: "modified" })).toBe(false);
		expect(reviewBringBackPreview()).toEqual({ enabled: false, reason: REVIEW_BRING_BACK_REASON });
		expect(REVIEW_CONFLICT_REASON).toContain("will not merge");
		expect(REVIEW_BRING_BACK_REASON).toContain("will not invent a bring-back");
	});
});

describe("ideLandingForWorkTab", () => {
	it("never lands Review on SCM and explains a non-Git folder", () => {
		expect(ideLandingForWorkTab("changes", { noGit: true })).toEqual({
			view: "explorer",
			message: REVIEW_NO_GIT_REASON,
		});
		expect(ideLandingForWorkTab("changes", { noGit: true, selectedPath: "notes.md" })).toEqual({
			view: "file",
			path: "notes.md",
			message: REVIEW_NO_GIT_REASON,
		});
		expect(ideLandingForWorkTab("files")).toEqual({ view: "explorer" });
		expect(ideLandingForWorkTab("terminal")).toEqual({ view: "none" });
		expect(ideLandingForWorkTab("changes")).toEqual({ view: "explorer" });
	});
});

describe("splitHunkColumns", () => {
	it("places deletions on the left and additions on the right", () => {
		expect(splitHunkColumns([" context", "-old", "+new"])).toEqual({
			left: [" context", "-old", " "],
			right: [" context", " ", "+new"],
		});
	});
});
