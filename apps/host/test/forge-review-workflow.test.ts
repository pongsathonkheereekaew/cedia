import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { createForgeReview, type ForgeCommandRequest, type ForgeCommandResult } from "../src/forge-review.ts";
import { createForgeReviewWorkflow } from "../src/forge-review-workflow.ts";
import { DurableStore } from "../src/store.ts";

const fixtures: Array<{ directory: string; store: DurableStore }> = [];

function result(stdout: string, code: number | string | null = 0, stderr = ""): ForgeCommandResult {
  return { stdout, stderr, code, timedOut: false, truncated: false };
}

const detail = {
  number: 42,
  title: "Workflow fixture",
  url: "https://github.com/acme/widget/pull/42",
  state: "OPEN",
  isDraft: false,
  author: { login: "reviewer" },
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T01:00:00Z",
  body: "body",
  headRefName: "feature",
  headRefOid: "head-42",
  baseRefName: "main",
  baseRefOid: "base-42",
  mergedAt: null,
  reviewRequests: [],
  comments: [],
  reviews: [],
  commits: [],
  statusCheckRollup: [],
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  changedFiles: 1,
  files: [{ path: "src/a.ts", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" }],
};

function makeFixture(runner?: (request: ForgeCommandRequest) => Promise<ForgeCommandResult | undefined>): { store: DurableStore; calls: ForgeCommandRequest[]; service: ReturnType<typeof createForgeReview>; workflow: ReturnType<typeof createForgeReviewWorkflow> } {
  const directory = mkdtempSync(join(tmpdir(), "cedia-forge-workflow-"));
  const projectPath = join(directory, "project");
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(directory, "seed"), "fixture");
  const store = DurableStore.open({ stateDir: directory, recover: false });
  store.createProject({ id: "project-1", path: projectPath, name: "Widget" });
  const calls: ForgeCommandRequest[] = [];
  const defaultRunner = async (request: ForgeCommandRequest): Promise<ForgeCommandResult> => {
    if (request.command === "git") return result("git@github.com:acme/widget.git\n");
    if (request.args[0] === "auth") return result("");
    if (request.args[0] === "pr" && request.args[1] === "view") return result(JSON.stringify(detail));
    if (request.args[0] === "pr" && request.args[1] === "diff") return result("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n");
    if (request.args[0] === "api" && request.args[1] === "repos/acme/widget") return result(JSON.stringify({ permissions: { pull: true, push: true, maintain: true, admin: false }, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }));
    if (request.args[0] === "api" && request.args[1] === "user") return result(JSON.stringify({ login: "reviewer" }));
    if (request.args[0] === "api" && request.args[1] === "graphql" && request.stdin?.includes("reviewThreads")) {
      return result(JSON.stringify({
        data: { repository: { pullRequest: { reviewThreads: {
          nodes: [{ id: "thread-1", isResolved: false, isOutdated: false, viewerCanReply: true, viewerCanResolve: true, comments: {
            nodes: [{ id: "comment-node", fullDatabaseId: 7, body: "Inline", path: "src/a.ts", line: 1, side: "RIGHT", url: "https://github.com/acme/widget/pull/42#discussion_r7", createdAt: "2026-10-03T01:00:00Z", updatedAt: "2026-10-03T01:00:00Z", author: { login: "reviewer" }, commit: { oid: "head-42" } }],
            pageInfo: { hasNextPage: false },
          } }],
          pageInfo: { hasNextPage: false },
        } } } },
      }));
    }
    if (request.args[0] === "api" && request.args[1] === "graphql") return result(JSON.stringify({ data: { resolveReviewThread: { thread: { id: "thread-1", isResolved: true } } } }));
    if (request.args[0] === "api") return result(JSON.stringify({ id: 99, html_url: "https://github.com/acme/widget/pull/42#issuecomment-99" }));
    return result("", 1, "unexpected fixture command");
  };
  const actualRunner = async (request: ForgeCommandRequest): Promise<ForgeCommandResult> => {
    calls.push(request);
    const override = runner ? await runner(request) : undefined;
    return override ?? defaultRunner(request);
  };
  const service = createForgeReview({ store, runner: actualRunner });
  const workflow = createForgeReviewWorkflow({ store, review: service, runner: actualRunner });
  fixtures.push({ directory, store });
  return { store, calls, service, workflow };
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) { fixture.store.close(); rmSync(fixture.directory, { recursive: true, force: true }); }
});

describe("GitHub Forge workflow host", () => {
  it("reads overview permissions and GraphQL review threads with viewer capabilities", async () => {
    const fixture = makeFixture();
    const overview = await fixture.workflow.workflow({ projectId: "project-1", url: detail.url, section: "overview" });
    expect(overview.overview?.permissions).toMatchObject({ available: true, canComment: true, canReview: false, canEdit: true });
    const threads = await fixture.workflow.workflow({ projectId: "project-1", url: detail.url, section: "threads" });
    expect(threads.threads?.items[0]).toMatchObject({ id: "thread-1", viewerCanReply: true, viewerCanResolve: true, comments: [{ id: "7", path: "src/a.ts" }] });
  });

  it("keeps author edit/state permissions separate from repository merge permission", async () => {
    const fixture = makeFixture(async request => {
      if (request.command === "gh" && request.args[0] === "api" && request.args[1] === "repos/acme/widget") {
        return result(JSON.stringify({ permissions: { pull: true }, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }));
      }
      return undefined;
    });
    const overview = await fixture.workflow.workflow({ projectId: "project-1", url: detail.url, section: "overview" });
    expect(overview.overview?.permissions).toMatchObject({ available: true, canEdit: true, canChangeState: true, canRequestReviewers: true, canMerge: false });
  });

  it("retains long activity bodies and commit anchors", async () => {
    const body = "x".repeat(5_000);
    const fixture = makeFixture(async request => {
      if (request.command === "gh" && request.args[0] === "api" && request.args[1]?.startsWith("repos/acme/widget/issues/42/timeline")) {
        return result(JSON.stringify([{ id: "timeline-1", event: "committed", body, sha: "head-42" }]));
      }
      return undefined;
    });
    const activity = await fixture.workflow.workflow({ projectId: "project-1", url: detail.url, section: "activity" });
    expect(activity.activity?.items[0]).toMatchObject({ id: "timeline-1", body, commitSha: "head-42" });
  });

  it("projects GitHub commit timeline messages, authors and commit dates", async () => {
    const fixture = makeFixture(async request => {
      if (request.command === "gh" && request.args[1]?.startsWith("repos/acme/widget/issues/42/timeline")) {
        return result(JSON.stringify([{ node_id: "commit-1", event: "committed", message: "Fix review layout", sha: "head-42", author: { name: "Contributor", date: "2026-10-01T01:00:00Z" }, committer: { date: "2026-10-01T02:00:00Z" } }]));
      }
      return undefined;
    });
    const response = await fixture.workflow.workflow({ projectId: "project-1", url: detail.url, section: "activity" });
    expect(response.activity?.items[0]).toMatchObject({ kind: "commit", body: "Fix review layout", actor: { login: "Contributor" }, createdAt: "2026-10-01T02:00:00Z", commitSha: "head-42" });
  });

  it("claims a review command once and replays the durable receipt", async () => {
    const fixture = makeFixture();
    const request = { projectId: "project-1", url: detail.url, commandId: "review-1", expectedHeadSha: "head-42", operation: { kind: "issue_comment" as const, body: "fixture comment" } };
    const first = await fixture.workflow.mutate(request);
    const callCount = fixture.calls.length;
    const second = await fixture.workflow.mutate(request);
    expect(first.receipt.state).toBe("confirmed");
    expect(second.receipt).toEqual(first.receipt);
    expect(fixture.calls.length).toBe(callCount);
  });

  it("returns an unknown receipt after a write timeout and never retries it", async () => {
    const fixture = makeFixture(async request => request.args[0] === "api" && request.args[1]?.includes("/comments") ? { ...result("", null), timedOut: true } : undefined);
    const request = { projectId: "project-1", url: detail.url, commandId: "comment-timeout", expectedHeadSha: "head-42", operation: { kind: "issue_comment" as const, body: "fixture comment" } };
    const first = await fixture.workflow.mutate(request);
    const callCount = fixture.calls.length;
    const second = await fixture.workflow.mutate(request);
    expect(first.receipt.state).toBe("outcome_unknown");
    expect(second.receipt.state).toBe("outcome_unknown");
    expect(fixture.calls.length).toBe(callCount);
  });

  it("rejects a stale inline anchor before the review endpoint and fences command reuse", async () => {
    const fixture = makeFixture();
    const stale = {
      projectId: "project-1",
      url: detail.url,
      commandId: "inline-stale",
      expectedHeadSha: "head-42",
      operation: { kind: "review" as const, event: "COMMENT" as const, comments: [{ path: "src/a.ts", line: 99, side: "RIGHT" as const, body: "stale" }] },
    };
    await expect(fixture.workflow.mutate(stale)).rejects.toMatchObject({ code: "stale_anchor", status: 409 });
    const reviewCalls = fixture.calls.filter(call => call.args[0] === "api" && call.args[1] === "repos/acme/widget/pulls/42/reviews");
    expect(reviewCalls).toHaveLength(0);
    await expect(fixture.workflow.mutate({ ...stale, operation: { kind: "issue_comment" as const, body: "different" } })).rejects.toMatchObject({ code: "command_conflict", status: 409 });
  });

  it("surfaces GraphQL provider errors instead of returning an empty thread page", async () => {
    const fixture = makeFixture(async request => request.args[0] === "api" && request.args[1] === "graphql" && request.stdin?.includes("reviewThreads")
      ? result(JSON.stringify({ errors: [{ message: "forbidden" }] }))
      : undefined);
    await expect(fixture.workflow.workflow({ projectId: "project-1", url: detail.url, section: "threads" })).rejects.toMatchObject({ code: "provider_failed", status: 502 });
  });

  it("keeps reviewer bucket pagination on the same provider search semantics", async () => {
    const fixture = makeFixture(async request => {
      if (request.args[0] !== "api" || !request.args[1]?.startsWith("search/issues")) return undefined;
      return request.args[1].includes("page=2")
        ? result(JSON.stringify({ items: [] }))
        : result(JSON.stringify({ items: [{ number: 42, title: "Authored", html_url: detail.url, state: "open", draft: false, user: { login: "reviewer" }, head: { ref: "feature", sha: "head-42" }, base: { ref: "main", sha: "base-42" }, mergeable_state: "clean" }] }));
    });
    const first = await fixture.service.list({ projectId: "project-1", bucket: "authored", cursor: "1", limit: 1 });
    expect(first.bucket).toBe("authored");
    expect(first.nextCursor).toBe("2");
    expect(fixture.calls.some(call => call.args[1]?.startsWith("search/issues") && call.args[1]?.includes("author%3Areviewer"))).toBe(true);
    const second = await fixture.service.list({ projectId: "project-1", bucket: "authored", cursor: first.nextCursor, limit: 1 });
    expect(second.items).toHaveLength(0);
    expect(second.nextCursor).toBeUndefined();
  });
});
