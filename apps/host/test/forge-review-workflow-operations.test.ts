import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import type {
  ForgeReviewMutationOperation,
  ForgeReviewMutationRequest,
  ForgeReviewMutationReceipt,
} from "../../../packages/protocol/src/forge-review-workflow.ts";
import { createForgeReview, type ForgeCommandRequest, type ForgeCommandResult } from "../src/forge-review.ts";
import { createForgeReviewWorkflow } from "../src/forge-review-workflow.ts";
import { DurableStore } from "../src/store.ts";

const projectId = "project-1";
const pullUrl = "https://github.com/acme/widget/pull/42";
const headSha = "head-42";
const fixtures: Array<{ directory: string; store: DurableStore }> = [];

function result(stdout: string, code: number | string | null = 0, stderr = ""): ForgeCommandResult {
  return { stdout, stderr, code, timedOut: false, truncated: false };
}

const pullView = {
  number: 42,
  title: "Workflow fixture",
  url: pullUrl,
  state: "OPEN",
  isDraft: false,
  author: { login: "author" },
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T01:00:00Z",
  body: "body",
  headRefName: "feature",
  headRefOid: headSha,
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

type Override = (request: ForgeCommandRequest) => Promise<ForgeCommandResult | undefined> | ForgeCommandResult | undefined;

interface FixtureOptions {
  readonly override?: Override;
  readonly viewerLogin?: string;
  readonly viewerCanReply?: boolean;
  readonly viewerCanResolve?: boolean;
  readonly viewerCanUnresolve?: boolean;
}

function isApiWrite(request: ForgeCommandRequest): boolean {
  if (request.command !== "gh" || request.args[0] !== "api") return false;
  const methodIndex = request.args.indexOf("--method");
  const method = methodIndex < 0 ? "GET" : request.args[methodIndex + 1];
  return method !== undefined && method !== "GET";
}

function apiPath(request: ForgeCommandRequest): string | undefined {
  return request.command === "gh" && request.args[0] === "api" ? request.args[1] : undefined;
}

function input(request: ForgeCommandRequest): Record<string, unknown> {
  if (request.stdin === undefined) throw new Error(`Expected JSON input for ${apiPath(request) ?? "non-api command"}`);
  return JSON.parse(request.stdin) as Record<string, unknown>;
}

function threadPayload(options: FixtureOptions): unknown {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [{
              id: "thread-1",
              isResolved: false,
              isOutdated: false,
              viewerCanReply: options.viewerCanReply ?? true,
              viewerCanResolve: options.viewerCanResolve ?? true,
              viewerCanUnresolve: options.viewerCanUnresolve ?? true,
              comments: {
                nodes: [{
                  id: "comment-node",
                  fullDatabaseId: 7,
                  body: "Inline",
                  path: "src/a.ts",
                  line: 1,
                  side: "RIGHT",
                  url: "https://github.com/acme/widget/pull/42#discussion_r7",
                  createdAt: "2026-10-03T01:00:00Z",
                  updatedAt: "2026-10-03T01:00:00Z",
                  author: { login: "author" },
                  commit: { oid: headSha },
                }],
                pageInfo: { hasNextPage: false },
              },
            }],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    },
  };
}

function makeFixture(options: FixtureOptions = {}): { store: DurableStore; calls: ForgeCommandRequest[]; workflow: ReturnType<typeof createForgeReviewWorkflow> } {
  const directory = mkdtempSync(join(tmpdir(), "cedia-forge-workflow-operations-"));
  const projectPath = join(directory, "project");
  mkdirSync(projectPath, { recursive: true });
  const store = DurableStore.open({ stateDir: directory, recover: false });
  store.createProject({ id: projectId, path: projectPath, name: "Widget" });
  const calls: ForgeCommandRequest[] = [];
  const defaultRunner = async (request: ForgeCommandRequest): Promise<ForgeCommandResult> => {
    if (request.command === "git") return result("git@github.com:acme/widget.git\n");
    if (request.args[0] === "auth") return result("");
    if (request.args[0] === "pr" && request.args[1] === "view") return result(JSON.stringify(pullView));
    if (request.args[0] === "pr" && request.args[1] === "diff") return result("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n");
    if (request.args[0] === "api" && request.args[1] === "repos/acme/widget") return result(JSON.stringify({ permissions: { pull: true, push: true, triage: true, maintain: true, admin: false }, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }));
    if (request.args[0] === "api" && request.args[1] === "user") return result(JSON.stringify({ login: options.viewerLogin ?? "reviewer" }));
    if (request.args[0] === "api" && request.args[1] === "repos/acme/widget/pulls/42") return result(JSON.stringify({ node_id: "PR_node_42" }));
    if (request.args[0] === "api" && request.args[1] === "graphql" && request.stdin?.includes("reviewThreads")) return result(JSON.stringify(threadPayload(options)));
    if (request.args[0] === "api" && request.args[1] === "graphql") return result(JSON.stringify({ data: { workflowMutation: { pullRequest: { isDraft: false } } } }));
    if (request.args[0] === "api") return result(JSON.stringify({ id: 99, node_id: "node-99", html_url: `${pullUrl}#comment-99`, state: "open" }));
    return result("", 1, "unexpected fixture command");
  };
  const runner = async (request: ForgeCommandRequest): Promise<ForgeCommandResult> => {
    calls.push(request);
    const override = await options.override?.(request);
    return override ?? defaultRunner(request);
  };
  const review = createForgeReview({ store, runner });
  const workflow = createForgeReviewWorkflow({ store, review, runner });
  fixtures.push({ directory, store });
  return { store, calls, workflow };
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

function request(commandId: string, operation: ForgeReviewMutationOperation, expectedHead = headSha): ForgeReviewMutationRequest {
  return { projectId, url: pullUrl, commandId, expectedHeadSha: expectedHead, operation };
}

function writeCall(calls: readonly ForgeCommandRequest[], path: string, method: string): ForgeCommandRequest {
  const call = calls.find(item => apiPath(item) === path && item.args[item.args.indexOf("--method") + 1] === method);
  if (!call) throw new Error(`Missing ${method} ${path} call`);
  return call;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonical(record[key])]));
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

describe("GitHub workflow mutation payloads", () => {
  it("posts an issue comment with the exact body", async () => {
    const fixture = makeFixture();
    const resultValue = await fixture.workflow.mutate(request("issue-comment", { kind: "issue_comment", body: "Please fix this." }));
    expect(resultValue.receipt.state).toBe("confirmed");
    expect(input(writeCall(fixture.calls, "repos/acme/widget/issues/42/comments", "POST"))).toEqual({ body: "Please fix this." });
  });

  it.each(["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const)("posts a %s review bound to the expected head", async event => {
    const fixture = makeFixture();
    await fixture.workflow.mutate(request(`review-${event.toLowerCase()}`, {
      kind: "review",
      event,
      body: "Review body",
      comments: [{ path: "src/a.ts", line: 1, side: "RIGHT", body: "Inline note" }],
    }));
    const payload = input(writeCall(fixture.calls, "repos/acme/widget/pulls/42/reviews", "POST"));
    expect(payload).toMatchObject({ commit_id: headSha, event, body: "Review body", comments: [{ path: "src/a.ts", line: 1, side: "RIGHT", body: "Inline note" }] });
  });

  it("replies to the numeric review comment after confirming its thread", async () => {
    const fixture = makeFixture();
    await fixture.workflow.mutate(request("reply-comment", { kind: "reply", commentId: "7", body: "Reply body" }));
    expect(input(writeCall(fixture.calls, "repos/acme/widget/pulls/42/comments", "POST"))).toEqual({ body: "Reply body", in_reply_to: 7 });
    expect(fixture.calls.some(call => apiPath(call) === "graphql" && call.stdin?.includes("reviewThreads"))).toBe(true);
  });

  it.each([
    [true, "resolveReviewThread"],
    [false, "unresolveReviewThread"],
  ] as const)("uses the thread permission and GraphQL mutation for resolved=%s", async (resolved, mutation) => {
    const fixture = makeFixture();
    await fixture.workflow.mutate(request(`thread-${resolved}`, { kind: "resolve_thread", threadId: "thread-1", resolved }));
    const call = fixture.calls.find(item => apiPath(item) === "graphql" && item.stdin?.includes(mutation));
    expect(call).toBeDefined();
    expect(input(call!).variables).toEqual({ input: { threadId: "thread-1" } });
  });

  it("edits title and body together through the pull request endpoint", async () => {
    const fixture = makeFixture();
    await fixture.workflow.mutate(request("edit-pull", { kind: "edit", title: "Updated title", body: "Updated body" }));
    expect(input(writeCall(fixture.calls, "repos/acme/widget/pulls/42", "PATCH"))).toEqual({ title: "Updated title", body: "Updated body" });
  });

  it.each([
    [{ users: ["alice"], teams: ["reviewers"] }, "POST"],
    [{ removeUsers: ["alice"], removeTeams: ["reviewers"] }, "DELETE"],
  ] as const)("sends reviewer %s through the requested-reviewers endpoint", async (operation, method) => {
    const fixture = makeFixture();
    await fixture.workflow.mutate(request(`reviewers-${method}`, { kind: "reviewers", ...operation }));
    expect(input(writeCall(fixture.calls, "repos/acme/widget/pulls/42/requested_reviewers", method))).toEqual(method === "POST"
      ? { reviewers: ["alice"], team_reviewers: ["reviewers"] }
      : { reviewers: ["alice"], team_reviewers: ["reviewers"] });
  });

  it.each([
    [true, "ConvertPullRequestToDraftInput"],
    [false, "MarkPullRequestReadyForReviewInput"],
  ] as const)("uses GraphQL to set draft=%s", async (draft, mutation) => {
    const fixture = makeFixture();
    await fixture.workflow.mutate(request(`draft-${draft}`, { kind: "draft", draft }));
    const call = fixture.calls.find(item => apiPath(item) === "graphql" && item.stdin?.includes(mutation));
    expect(call).toBeDefined();
    expect(input(call!).variables).toEqual({ input: { pullRequestId: "PR_node_42" } });
  });

  it.each(["open", "closed"] as const)("changes pull request state to %s", async state => {
    const fixture = makeFixture();
    await fixture.workflow.mutate(request(`state-${state}`, { kind: "state", state }));
    expect(input(writeCall(fixture.calls, "repos/acme/widget/pulls/42", "PATCH"))).toEqual({ state });
  });

  it.each(["merge", "squash", "rebase"] as const)("merges with the allowed %s method and expected SHA", async method => {
    const fixture = makeFixture();
    await fixture.workflow.mutate(request(`merge-${method}`, { kind: "merge", method, commitMessage: "Merge fixture" }));
    expect(input(writeCall(fixture.calls, "repos/acme/widget/pulls/42/merge", "PUT"))).toEqual({ sha: headSha, merge_method: method, commit_message: "Merge fixture" });
  });

  it("rejects malformed booleans, state, reviewer arrays, ids, and methods before invoking the runner", async () => {
    const malformed = [
      { kind: "issue_comment", body: 42 },
      { kind: "review", event: "COMMENT", comments: [{ path: "src/a.ts", line: true, side: "RIGHT", body: "bad" }] },
      { kind: "reply", commentId: "comment-node", body: "bad" },
      { kind: "resolve_thread", threadId: "thread-1", resolved: "yes" },
      { kind: "reviewers", users: ["alice", 42] },
      { kind: "draft", draft: "yes" },
      { kind: "state", state: "merged" },
      { kind: "merge", method: "fast-forward" },
    ];
    for (const [index, operation] of malformed.entries()) {
      const fixture = makeFixture();
      await expect(fixture.workflow.mutate(request(`malformed-${index}`, operation as unknown as ForgeReviewMutationOperation))).rejects.toMatchObject({ code: "invalid_request" });
      expect(fixture.calls).toHaveLength(0);
    }
  });

  it("rejects a stale expected head before any mutating API call", async () => {
    const fixture = makeFixture();
    await expect(fixture.workflow.mutate(request("stale-head", { kind: "issue_comment", body: "must not post" }, "head-old"))).rejects.toMatchObject({ code: "stale_snapshot", status: 409 });
    expect(fixture.calls.some(isApiWrite)).toBe(false);
  });

  it("honors author review permissions before posting an approval", async () => {
    const fixture = makeFixture({ viewerLogin: "author" });
    await expect(fixture.workflow.mutate(request("self-approval", { kind: "review", event: "APPROVE" }))).rejects.toMatchObject({ code: "permission_denied", status: 403 });
    expect(fixture.calls.some(isApiWrite)).toBe(false);
  });

  it.each([
    ["throws", async () => { throw new Error("network reset"); }],
    ["returns a transient nonzero result", () => result("", 1, "network reset")],
  ] as const)("records an unknown outcome for a write that %s and never retries", async (_label, failure) => {
    const fixture = makeFixture({
      override: requestValue => apiPath(requestValue) === "repos/acme/widget/issues/42/comments" ? failure() : undefined,
    });
    const operation = request("unknown-write", { kind: "issue_comment", body: "network uncertain" });
    const first = await fixture.workflow.mutate(operation);
    const writes = fixture.calls.filter(isApiWrite).length;
    const second = await fixture.workflow.mutate(operation);
    expect(first.receipt.state).toBe("outcome_unknown");
    expect(second.receipt).toEqual(first.receipt);
    expect(fixture.calls.filter(isApiWrite)).toHaveLength(writes);
    expect(writes).toBe(1);
  });

  it("recovers a staged pending receipt as outcome_unknown without replaying the write", async () => {
    const fixture = makeFixture();
    const operation = { kind: "issue_comment" as const, body: "staged" };
    const pendingRequest = request("staged-pending", operation);
    const requestHash = hash({ projectId, url: pullUrl, expectedHeadSha: headSha, operation });
    const timestamp = "2026-10-03T02:00:00.000Z";
    const receipt: ForgeReviewMutationReceipt = { commandId: pendingRequest.commandId, requestHash, state: "pending", createdAt: timestamp, updatedAt: timestamp };
    const receiptDirectory = join(fixture.store.paths.stateDir, "forge-review-receipts");
    mkdirSync(receiptDirectory, { recursive: true });
    writeFileSync(join(receiptDirectory, `${hash(pendingRequest.commandId)}.json`), JSON.stringify(receipt));

    const recovered = await fixture.workflow.mutate(pendingRequest);
    expect(recovered.receipt.state).toBe("outcome_unknown");
    expect(recovered.receipt.error?.code).toBe("mutation_unknown");
    expect(fixture.calls).toHaveLength(0);
  });
});
