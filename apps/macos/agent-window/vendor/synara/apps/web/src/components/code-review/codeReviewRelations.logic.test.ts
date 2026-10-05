import { describe, expect, it } from "vitest";
import { relatedReviewDirection } from "./codeReviewRelations.logic";
const detail = { ref: { number: 2, url: "https://github.com/a/b/pull/2" }, refs: { base: { branch: "first", sha: "first-head" }, head: { branch: "second", sha: "second-head" } } };
describe("related review branch evidence", () => {
  it("identifies upstream and downstream only at matching branch commits", () => {
    expect(relatedReviewDirection(detail, { number: 1, state: "open", refs: { head: { branch: "first", sha: "first-head" } } })).toBe("upstream");
    expect(relatedReviewDirection(detail, { number: 3, state: "open", refs: { base: { branch: "second", sha: "second-head" } } })).toBe("downstream");
  });
  it("does not invent a stack from common names, missing hashes, or closed requests", () => {
    expect(relatedReviewDirection(detail, { number: 1, state: "open", refs: { head: { branch: "first", sha: "unrelated" } } })).toBeNull();
    expect(relatedReviewDirection(detail, { number: 1, state: "open", refs: { head: { branch: "first" } } })).toBeNull();
    expect(relatedReviewDirection(detail, { number: 1, state: "closed", refs: { head: detail.refs.base } })).toBeNull();
  });
});
