import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DurableStore } from "../src/store.ts";
import { createForgeReview, patchHeaderPaths, type ForgeCommandRequest, type ForgeCommandResult } from "../src/forge-review.ts";
import { DeviceAuth } from "../src/auth.ts";
import { CediaHost } from "../src/service.ts";
import { createRouter } from "../src/router.ts";
import type { ForgeReviewDiffResult, ForgeReviewDetail, ForgeReviewListResult } from "../../../packages/protocol/src/index.ts";

interface Fixture {
  readonly directory: string;
  readonly store: DurableStore;
  readonly calls: ForgeCommandRequest[];
}

const fixtures: Fixture[] = [];
const hosts: CediaHost[] = [];

function result(stdout = "", code: number | string | null = 0, stderr = ""): ForgeCommandResult {
  return { stdout, stderr, code, timedOut: false, truncated: false };
}

function githubDetail(): Record<string, unknown> {
  return {
    number: 42,
    title: "Improve review surface",
    url: "https://github.com/acme/widget/pull/42",
    state: "OPEN",
    isDraft: false,
    author: { login: "pond", name: "Pond" },
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T01:00:00.000Z",
    body: "Review this change.\n\nKeep the draft anchored to the current head.",
    headRefName: "feature/review",
    headRefOid: "head-42",
    baseRefName: "main",
    baseRefOid: "base-42",
    comments: [{ id: 7, body: "Looks good", author: { login: "reviewer" }, createdAt: "2026-10-03T01:01:00.000Z" }],
    reviews: [{ id: 8, body: "Please add a test", state: "CHANGES_REQUESTED", author: { login: "reviewer" }, commit_id: "head-42" }],
    commits: [{ oid: "head-42", message: "Implement review", author: { login: "pond" }, committedDate: "2026-10-03T00:30:00.000Z" }],
    statusCheckRollup: [{ name: "tests", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/acme/widget/actions/runs/1" }],
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    files: [{ path: "src/review.ts", additions: 4, deletions: 1 }],
  };
}

function makeFixture(options: { readonly provider?: "github" | "gitlab"; readonly hostname?: string } = {}): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "cedia-forge-review-"));
  const projectPath = join(directory, "project");
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(projectPath, "README.md"), "fixture\n");
  const store = DurableStore.open({ stateDir: directory, recover: false });
  store.createProject({ id: "project-1", path: projectPath, name: "Widget" });
  const calls: ForgeCommandRequest[] = [];
  const provider = options.provider ?? "github";
  const hostname = options.hostname ?? (provider === "github" ? "github.com" : "gitlab.com");
  const fixture: Fixture = { directory, store, calls };
  fixtures.push(fixture);
  const service = createForgeReview({
    store,
    ...(provider === "github" ? { githubHosts: [hostname] } : { gitlabHosts: [hostname] }),
    now: () => new Date("2026-10-03T02:00:00.000Z"),
    runner: async request => {
      calls.push(request);
      if (request.command === "git") return result(provider === "github" ? `git@${hostname}:acme/widget.git\n` : `git@${hostname}:acme/group/widget.git\n`);
      if (request.args[0] === "auth") return result();
      if (provider === "github" && request.args[0] === "pr" && request.args[1] === "list") return result(JSON.stringify([githubDetail(), { ...githubDetail(), number: 43, title: "Second review", url: "https://github.com/acme/widget/pull/43" }]));
      if (provider === "github" && request.args[0] === "pr" && request.args[1] === "view") return result(JSON.stringify(githubDetail()));
      if (provider === "github" && request.args[0] === "pr" && request.args[1] === "diff") return result("diff --git a/src/review.ts b/src/review.ts\n--- a/src/review.ts\n+++ b/src/review.ts\n@@\n-old\n+new\n");
      if (provider === "gitlab" && request.args[0] === "mr" && request.args[1] === "list") return result(JSON.stringify([{ iid: 7, title: "Nested MR", web_url: `https://${hostname}/acme/group/widget/-/merge_requests/7`, state: "opened", author: { username: "pond" }, source_branch: "feature", sha: "head-7", target_branch: "main", diff_refs: { base_sha: "base-7", head_sha: "head-7" }, user_notes_count: 2 }]));
      if (provider === "gitlab" && request.args[0] === "mr" && request.args[1] === "view") return result(JSON.stringify({ iid: 7, title: "Nested MR", web_url: `https://${hostname}/acme/group/widget/-/merge_requests/7`, state: "opened", author: { username: "pond" }, source_branch: "feature", sha: "head-7", target_branch: "main", diff_refs: { base_sha: "base-7", head_sha: "head-7" }, description: "MR body", notes: [{ id: 9, body: "Comment", author: { username: "reviewer" } }], approvals: [], commits: [], pipelines: [], changes: [{ new_path: "src/review.ts", additions: 2, deletions: 1 }] }));
      if (provider === "gitlab" && request.args[0] === "mr" && request.args[1] === "diff") return result("diff --git a/src/review.ts b/src/review.ts\n-old\n+new\n");
      return result("", 1, "unexpected command");
    },
  });
  (fixture as Fixture & { service?: typeof service }).service = service;
  return fixture;
}

function service(fixture: Fixture): ReturnType<typeof createForgeReview> {
  return (fixture as Fixture & { service?: ReturnType<typeof createForgeReview> }).service!;
}

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close().catch(() => {});
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

describe("Forge Review host adapter", () => {
  it("decodes UTF-8 octal escapes in quoted Git diff paths", () => {
    expect(patchHeaderPaths(String.raw`diff --git "a/\303\251.ts" "b/\303\251.ts"`)).toEqual(["a/é.ts", "b/é.ts"]);
    expect(patchHeaderPaths(String.raw`diff --git "a/tab\tand\\slash.ts" "b/tab\tand\\slash.ts"`)).toEqual(["a/tab\tand\\slash.ts", "b/tab\tand\\slash.ts"]);
  });
  it("uses fixed gh argv and returns immutable GitHub review data", async () => {
    const fixture = makeFixture();
    const detail = await service(fixture).detail({ projectId: "project-1", url: "https://github.com/acme/widget/pull/42" });
    expect(detail).toMatchObject({ provider: "github", number: 42, body: "Review this change.\n\nKeep the draft anchored to the current head.", snapshot: { headSha: "head-42", baseSha: "base-42", hash: expect.any(String) } });
    expect(detail.comments).toHaveLength(1);
    expect(detail.reviews[0]).toMatchObject({ state: "changes_requested", commitSha: "head-42" });
    const view = fixture.calls.find(call => call.args[0] === "pr" && call.args[1] === "view");
    expect(view).toMatchObject({ command: "gh", args: ["pr", "view", "42", "--repo", "github.com/acme/widget", "--json", expect.any(String)], timeoutMs: expect.any(Number) });
    expect(view?.args.join(" ")).not.toContain("--shell");
  });

  it("bounds list output and rejects a repository outside the selected project", async () => {
    const fixture = makeFixture();
    const listed = await service(fixture).list({ projectId: "project-1", state: "all", limit: 1 });
    expect(listed.items).toHaveLength(1);
    expect(listed.truncated).toBe(true);
    await expect(service(fixture).detail({ projectId: "project-1", url: "https://github.com/acme/other/pull/42" })).rejects.toMatchObject({ code: "repository_mismatch", status: 403 });
  });

  it("binds a diff to current head/base and rejects stale anchors", async () => {
    const fixture = makeFixture();
    const diff = await service(fixture).diff({ projectId: "project-1", url: "https://github.com/acme/widget/pull/42", headSha: "head-42", baseSha: "base-42" });
    expect(diff).toMatchObject({ patch: expect.stringContaining("+new"), files: [{ path: "src/review.ts" }], snapshot: { headSha: "head-42", baseSha: "base-42" } });
    await expect(service(fixture).diff({ projectId: "project-1", url: "https://github.com/acme/widget/pull/42", headSha: "old-head" })).rejects.toMatchObject({ code: "stale_snapshot", status: 409 });
  });

  it("rejects a force-push that races the diff command", async () => {
    const fixture = makeFixture();
    let viewCount = 0;
    const raced = createForgeReview({
      store: fixture.store,
      runner: async request => {
        if (request.command === "git") return result("git@github.com:acme/widget.git\n");
        if (request.args[0] === "auth") return result();
        if (request.args[0] === "pr" && request.args[1] === "view") {
          viewCount += 1;
          return result(JSON.stringify({ ...githubDetail(), headRefOid: viewCount === 1 ? "head-42" : "head-after-force-push" }));
        }
        if (request.args[0] === "pr" && request.args[1] === "diff") return result("diff --git a/a b/a\n+new\n");
        return result("", 1, "unexpected command");
      },
    });
    await expect(raced.diff({ projectId: "project-1", url: "https://github.com/acme/widget/pull/42", headSha: "head-42" })).rejects.toMatchObject({ code: "stale_snapshot", status: 409 });
  });

  it("supports nested GitLab groups through the injected glab runner", async () => {
    const fixture = makeFixture({ provider: "gitlab" });
    const detail = await service(fixture).detail({ projectId: "project-1", url: "https://gitlab.com/acme/group/widget/-/merge_requests/7" });
    expect(detail).toMatchObject({ provider: "gitlab", number: 7, refs: { head: { sha: "head-7" }, base: { sha: "base-7" } } });
    expect(detail.comments[0]).toMatchObject({ id: "9", body: "Comment" });
    const view = fixture.calls.find(call => call.args[0] === "mr" && call.args[1] === "view");
    expect(view?.args).toEqual(["mr", "view", "7", "--repo", "https://gitlab.com/acme/group/widget", "--output", "json"]);
  });

  it("uses documented GitLab state flags and keeps a configured self-host URL", async () => {
    const fixture = makeFixture({ provider: "gitlab", hostname: "gitlab.example.test" });
    for (const state of ["open", "closed", "merged", "all"] as const) {
      const start = fixture.calls.length;
      await service(fixture).list({ projectId: "project-1", state, limit: 10 });
      const listCall = fixture.calls.slice(start).find(call => call.args[0] === "mr" && call.args[1] === "list");
      expect(listCall?.args).toContain("--repo");
      expect(listCall?.args).toContain("https://gitlab.example.test/acme/group/widget");
      expect(listCall?.args).toContain("--per-page");
      const expectedFlag = state === "open" ? undefined : state === "closed" ? "--closed" : state === "merged" ? "--merged" : "--all";
      if (expectedFlag === undefined) expect(listCall?.args).not.toContain("--closed");
      else expect(listCall?.args).toContain(expectedFlag);
    }
  });

  it("paginates GitLab lists at the provider's 100-row cap before marking an extra row", async () => {
    const fixture = makeFixture({ provider: "gitlab" });
    const row = (iid: number) => ({ iid, title: `MR ${iid}`, web_url: `https://gitlab.com/acme/group/widget/-/merge_requests/${iid}`, state: "opened", author: { username: "pond" }, source_branch: "feature", sha: `head-${iid}`, target_branch: "main", diff_refs: { base_sha: "base", head_sha: `head-${iid}` } });
    const paged = createForgeReview({
      store: fixture.store,
      runner: async request => {
        fixture.calls.push(request);
        if (request.command === "git") return result("git@gitlab.com:acme/group/widget.git\n");
        if (request.args[0] === "auth") return result();
        if (request.args[0] === "api") return result("", 1, "viewer endpoint unavailable");
        if (request.args[0] === "mr" && request.args[1] === "list") {
          const page = Number(request.args[request.args.indexOf("--page") + 1]);
          return result(JSON.stringify(page === 1 ? Array.from({ length: 100 }, (_, index) => row(index + 1)) : [row(101)]));
        }
        return result("", 1, "unexpected command");
      },
    });
    const listed = await paged.list({ projectId: "project-1", limit: 100 });
    expect(listed.items).toHaveLength(100);
    expect(listed.truncated).toBe(true);
    const listCalls = fixture.calls.filter(call => call.args[0] === "mr" && call.args[1] === "list");
    expect(listCalls).toHaveLength(2);
    expect(listCalls[0]?.args).toContain("100");
    expect(listCalls[0]?.args).not.toContain("101");
    expect(listCalls[1]?.args).toContain("--page");
  });

  it("normalizes GitLab API detail collections and leaves unavailable facts empty", async () => {
    const fixture = makeFixture({ provider: "gitlab" });
    const reviewed = createForgeReview({
      store: fixture.store,
      runner: async request => {
        fixture.calls.push(request);
        if (request.command === "git") return result("git@gitlab.com:acme/group/widget.git\n");
        if (request.args[0] === "auth") return result();
        if (request.args[0] === "mr" && request.args[1] === "view") return result(JSON.stringify({
          iid: 7,
          title: "API-backed MR",
          web_url: "https://gitlab.com/acme/group/widget/-/merge_requests/7",
          state: "opened",
          author: { username: "pond" },
          source_branch: "feature",
          sha: "head-7",
          target_branch: "main",
          diff_refs: { base_sha: "base-7", head_sha: "head-7" },
          description: "First line\n\nSecond line",
        }));
        if (request.args[0] === "api") {
          const endpoint = request.args.find(argument => argument.startsWith("projects/")) ?? "";
          if (endpoint.includes("/discussions?")) return result(JSON.stringify([{ notes: [{ id: 11, body: "Discussion", author: { username: "reviewer" } }] }]));
          if (endpoint.includes("/commits?")) return result(JSON.stringify([{ id: "commit-7", message: "Add review fixture", author: { username: "pond" } }]));
          if (endpoint.endsWith("/approvals")) return result(JSON.stringify({ approved_by: [{ user: { id: 77, username: "reviewer" } }] }));
          if (endpoint.includes("/pipelines?")) return result(JSON.stringify([{ id: 9, status: "success", ref: "feature", web_url: "https://gitlab.com/pipeline/9" }]));
          if (endpoint.includes("/changes?")) return result(JSON.stringify({ changes: [{ new_path: "src/api.ts", additions: 3, deletions: 1 }] }));
        }
        return result("", 1, "fixture endpoint unavailable");
      },
    });
    const detail = await reviewed.detail({ projectId: "project-1", url: "https://gitlab.com/acme/group/widget/-/merge_requests/7" });
    expect(detail.body).toBe("First line\n\nSecond line");
    expect(detail.comments).toMatchObject([{ id: "11", body: "Discussion" }]);
    expect(detail.reviews).toMatchObject([{ id: "77", state: "approved" }]);
    expect(detail.commits).toMatchObject([{ sha: "commit-7", message: "Add review fixture" }]);
    expect(detail.checks).toMatchObject([{ name: "feature", status: "completed" }]);
    expect(detail.files).toMatchObject([{ path: "src/api.ts", additions: 3, deletions: 1 }]);
  });

  it("paginates GitLab detail collections and fails honestly at the bounded cap", async () => {
    const fixture = makeFixture({ provider: "gitlab" });
    const baseDetail = {
      iid: 7,
      title: "Paginated MR",
      web_url: "https://gitlab.com/acme/group/widget/-/merge_requests/7",
      state: "opened",
      author: { username: "pond" },
      source_branch: "feature",
      sha: "head-7",
      target_branch: "main",
      diff_refs: { base_sha: "base-7", head_sha: "head-7" },
      approvals: [],
      commits: [],
      pipelines: [],
      changes: [],
    };
    const paged = createForgeReview({
      store: fixture.store,
      runner: async request => {
        fixture.calls.push(request);
        if (request.command === "git") return result("git@gitlab.com:acme/group/widget.git\n");
        if (request.args[0] === "auth") return result();
        if (request.args[0] === "mr" && request.args[1] === "view") return result(JSON.stringify(baseDetail));
        if (request.args[0] === "api") {
          const endpoint = request.args.find(argument => argument.startsWith("projects/")) ?? "";
          const page = Number(/page=(\d+)/.exec(endpoint)?.[1] ?? 1);
          if (endpoint.includes("/discussions?")) {
            const rows = page === 1 ? Array.from({ length: 100 }, (_, index) => ({ notes: [{ id: index + 1, body: `Comment ${index + 1}`, author: { username: "reviewer" } }] })) : [{ notes: [{ id: 101, body: "Comment 101", author: { username: "reviewer" } }] }];
            return result(JSON.stringify(rows));
          }
          if (endpoint.includes("/commits?")) return result("[]");
          if (endpoint.endsWith("/approvals")) return result(JSON.stringify({ approved_by: [] }));
          if (endpoint.includes("/pipelines?")) return result("[]");
          if (endpoint.includes("/changes?")) return result(JSON.stringify({ changes: [] }));
          if (endpoint.includes("/diffs?")) return result(JSON.stringify({ diffs: [] }));
        }
        return result("", 1, "unexpected command");
      },
    });
    const detail = await paged.detail({ projectId: "project-1", url: "https://gitlab.com/acme/group/widget/-/merge_requests/7" });
    expect(detail.comments).toHaveLength(101);
    expect(fixture.calls.some(call => call.args[0] === "api" && (call.args.find(argument => argument.startsWith("projects/")) ?? "").includes("/discussions?page=2"))).toBe(true);

    const capped = createForgeReview({
      store: fixture.store,
      runner: async request => {
        if (request.command === "git") return result("git@gitlab.com:acme/group/widget.git\n");
        if (request.args[0] === "auth") return result();
        if (request.args[0] === "mr" && request.args[1] === "view") return result(JSON.stringify(baseDetail));
        if (request.args[0] === "api") {
          const endpoint = request.args.find(argument => argument.startsWith("projects/")) ?? "";
          const page = Number(/page=(\d+)/.exec(endpoint)?.[1] ?? 1);
          if (endpoint.includes("/discussions?")) return result(JSON.stringify(Array.from({ length: page === 11 ? 1 : 100 }, (_, index) => ({ notes: [{ id: (page - 1) * 100 + index + 1, body: "bounded", author: { username: "reviewer" } }] }))));
          if (endpoint.includes("/commits?")) return result("[]");
          if (endpoint.endsWith("/approvals")) return result(JSON.stringify({ approved_by: [] }));
          if (endpoint.includes("/pipelines?")) return result("[]");
          if (endpoint.includes("/changes?")) return result(JSON.stringify({ changes: [] }));
          if (endpoint.includes("/diffs?")) return result(JSON.stringify({ diffs: [] }));
        }
        return result("", 1, "unexpected command");
      },
    });
    await expect(capped.detail({ projectId: "project-1", url: "https://gitlab.com/acme/group/widget/-/merge_requests/7" })).rejects.toMatchObject({ code: "output_truncated", status: 502 });
  });

  it("does not turn unavailable GitLab detail APIs into empty collections", async () => {
    const fixture = makeFixture({ provider: "gitlab" });
    const unavailable = createForgeReview({
      store: fixture.store,
      runner: async request => {
        if (request.command === "git") return result("git@gitlab.com:acme/group/widget.git\n");
        if (request.args[0] === "auth") return result();
        if (request.args[0] === "mr" && request.args[1] === "view") return result(JSON.stringify({ iid: 7, title: "Unavailable MR", web_url: "https://gitlab.com/acme/group/widget/-/merge_requests/7", state: "opened", author: { username: "pond" }, source_branch: "feature", sha: "head-7", target_branch: "main", diff_refs: { base_sha: "base-7", head_sha: "head-7" } }));
        if (request.args[0] === "api") return result("", 1, "forbidden");
        return result("", 1, "unexpected command");
      },
    });
    await expect(unavailable.detail({ projectId: "project-1", url: "https://gitlab.com/acme/group/widget/-/merge_requests/7" })).rejects.toMatchObject({ code: "provider_unavailable", status: 503 });
  });

  it("reports provider output truncation instead of returning an incomplete list", async () => {
    const fixture = makeFixture();
    const bounded = createForgeReview({
      store: fixture.store,
      runner: async request => {
        if (request.command === "git") return result("git@github.com:acme/widget.git\n");
        if (request.args[0] === "auth") return result();
        if (request.args[0] === "pr" && request.args[1] === "list") return { ...result("["), truncated: true };
        return result("", 1, "unexpected command");
      },
    });
    await expect(bounded.list({ projectId: "project-1" })).rejects.toMatchObject({ code: "output_truncated", status: 502 });
  });

  it("reports missing provider authentication without exposing stderr", async () => {
    const fixture = makeFixture();
    const serviceWithAuthFailure = createForgeReview({
      store: fixture.store,
      runner: async request => request.command === "git" ? result("git@github.com:acme/widget.git\n") : request.args[0] === "auth" ? result("", 1, "token=secret") : result(),
    });
    await expect(serviceWithAuthFailure.list({ projectId: "project-1" })).rejects.toMatchObject({ code: "unauthenticated", status: 401 });
    try { await serviceWithAuthFailure.list({ projectId: "project-1" }); } catch (error) { expect(String(error)).not.toContain("secret"); }
  });

  it("validates the diff anchors at the authenticated router boundary", async () => {
    const fixture = makeFixture();
    const auth = new DeviceAuth(join(fixture.directory, "devices"));
    const host = new CediaHost({ store: fixture.store, stateDir: fixture.directory });
    hosts.push(host);
    let received: unknown;
    const router = createRouter(host, auth, {
      forgeReview: {
        capabilities: async () => ({ providers: [], writes: [] }),
        list: async () => ({} as ForgeReviewListResult),
        detail: async () => ({} as ForgeReviewDetail),
        diff: async request => { received = request; return {} as ForgeReviewDiffResult; },
      },
    });
    const response = await router({
      method: "POST",
      path: "/v1/forge-review/diff",
      token: auth.ownerToken,
      body: { projectId: "project-1", url: "https://github.com/acme/widget/pull/42", headSha: "head-42", baseSha: "base-42" },
    });
    expect(response.status).toBe(200);
    expect(received).toEqual({ projectId: "project-1", url: "https://github.com/acme/widget/pull/42", headSha: "head-42", baseSha: "base-42" });
  });
});
