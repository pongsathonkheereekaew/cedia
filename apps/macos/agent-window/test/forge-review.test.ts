import { describe, expect, it } from "bun:test";

import {
  formatForgeReviewCount,
  formatForgeReviewState,
  forgeReviewQueryKeys,
  type ForgeReviewSummary,
} from "../vendor/synara/apps/web/src/lib/forgeReview";

const summary = (overrides: Partial<ForgeReviewSummary> = {}): ForgeReviewSummary => ({
  provider: "github",
  number: 2,
  title: "Cedia review",
  url: "https://github.com/pongsathonkheereekaew/cedia/pull/2",
  state: "open",
  draft: false,
  refs: {},
  counts: { comments: null, reviews: null, commits: 1, checks: 0 },
  ...overrides,
});

describe("Cedia Forge Review presentation helpers", () => {
  it("distinguishes draft state from provider lifecycle state", () => {
    expect(formatForgeReviewState(summary())).toBe("Open");
    expect(formatForgeReviewState(summary({ draft: true }))).toBe("Draft");
    expect(formatForgeReviewState(summary({ state: "merged" }))).toBe("Merged");
    expect(formatForgeReviewState(summary({ state: "merged", draft: true }))).toBe("Merged");
    expect(formatForgeReviewState(summary({ state: "closed", draft: true }))).toBe("Closed");
  });

  it("keeps unknown counts honest instead of presenting fake zeroes", () => {
    expect(formatForgeReviewCount(null)).toBe("—");
    expect(formatForgeReviewCount(undefined)).toBe("—");
    expect(formatForgeReviewCount(0)).toBe("0");
  });

  it("keys detail and diff caches by immutable review identity and refs", () => {
    const input = {
      projectId: "project-a" as never,
      url: "https://gitlab.example/group/project/-/merge_requests/7",
    };
    const detail = forgeReviewQueryKeys.detail(input);
    const first = forgeReviewQueryKeys.diff({ ...input, headSha: "abc", baseSha: "def" });
    const second = forgeReviewQueryKeys.diff({ ...input, headSha: "xyz", baseSha: "def" });
    expect(detail).not.toEqual(first);
    expect(first).not.toEqual(second);
  });
});

