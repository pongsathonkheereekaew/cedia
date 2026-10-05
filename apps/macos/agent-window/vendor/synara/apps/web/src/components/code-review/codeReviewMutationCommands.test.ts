import { describe, expect, it } from "bun:test";
import { completeReviewMutationCommand, getReviewMutationCommandId, type ReviewMutationIdentity } from "./codeReviewMutationCommands";

const request: ReviewMutationIdentity = { projectId: "p", url: "https://github.com/acme/repo/pull/1", expectedHeadSha: "head-a", operation: { kind: "issue_comment", body: "Review comment" } };
function storage() {
  let value: string | null = null;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
}
describe("unresolved review command persistence", () => {
  it("retains the same command after an unknown outcome and a fresh caller", () => {
    const disk = storage();
    const first = getReviewMutationCommandId(request, disk);
    expect(getReviewMutationCommandId({ ...request }, disk)).toBe(first);
    expect(getReviewMutationCommandId({ operation: request.operation, expectedHeadSha: request.expectedHeadSha, url: request.url, projectId: request.projectId }, disk)).toBe(first);
    completeReviewMutationCommand(request, disk);
    expect(getReviewMutationCommandId(request, disk)).not.toBe(first);
  });
  it("keeps PR, revision and edited feedback identities separate", () => {
    const disk = storage();
    const first = getReviewMutationCommandId(request, disk);
    expect(getReviewMutationCommandId({ ...request, expectedHeadSha: "head-b" }, disk)).not.toBe(first);
    expect(getReviewMutationCommandId({ ...request, url: request.url + "2" }, disk)).not.toBe(first);
    expect(getReviewMutationCommandId({ ...request, operation: { kind: "issue_comment", body: "Different comment" } }, disk)).not.toBe(first);
  });
  it("fails before publishing if durable storage is unavailable or corrupt", () => {
    expect(() => getReviewMutationCommandId(request, { getItem: () => null, setItem: () => { throw new Error("disk full"); } })).toThrow("disk full");
    expect(() => getReviewMutationCommandId(request, { getItem: () => "[]", setItem: () => {} })).toThrow("history");
  });
});
