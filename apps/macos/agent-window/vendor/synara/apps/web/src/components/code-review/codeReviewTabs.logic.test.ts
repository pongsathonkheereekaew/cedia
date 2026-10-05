import { describe, expect, it } from "vitest";
import { closeReviewTab, parseReviewTabs, retainReviewTab, reviewTabId, type ReviewTab } from "./codeReviewTabs.logic";
const tab: ReviewTab = { projectId: "p1", url: "https://github.com/a/b/pull/1", title: "One", repository: "a/b", number: 1, provider: "github", pinned: true };
describe("review tab identity and persistence", () => {
  it("retains project boundaries and pins while updating metadata", () => {
    const items = retainReviewTab([tab], { ...tab, title: "Updated" });
    expect(items).toEqual([{ ...tab, title: "Updated" }]);
    expect(retainReviewTab(items, { ...tab, projectId: "p2" })).toHaveLength(2);
  });
  it("closes the active tab to its neighbor without navigating on background close", () => {
    const second = { ...tab, url: "https://github.com/a/b/pull/2", number: 2 };
    expect(closeReviewTab([tab, second], reviewTabId(tab), reviewTabId(tab)).navigateTo).toEqual(second);
    expect(closeReviewTab([tab, second], reviewTabId(second), reviewTabId(tab)).navigateTo).toBeUndefined();
    expect(closeReviewTab([tab], reviewTabId(tab), reviewTabId(tab)).navigateTo).toBeNull();
  });
  it("does not restore unsafe URLs or duplicate identities", () => {
    expect(parseReviewTabs(JSON.stringify([tab, tab, { ...tab, url: "javascript:alert(1)" }]))).toEqual([tab]);
    expect(parseReviewTabs("bad")).toEqual([]);
  });
});
