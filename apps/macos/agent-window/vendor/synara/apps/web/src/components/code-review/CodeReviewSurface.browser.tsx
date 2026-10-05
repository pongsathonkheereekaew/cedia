import "../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ProjectId } from "@synara/contracts";

import type { ForgeReviewDetail, ForgeReviewDiffResult, ForgeReviewOmpResult } from "~/lib/forgeReview";

const { forgeReviewApi, navigate } = vi.hoisted(() => ({
  forgeReviewApi: {
    capabilities: vi.fn(),
    list: vi.fn(),
    detail: vi.fn(),
    diff: vi.fn(),
    reviewWithOmp: vi.fn(),
    ask: vi.fn(),
    readTaskResult: vi.fn(),
    workflow: vi.fn(),
    mutate: vi.fn(),
    readInstructions: vi.fn(),
    writeInstructions: vi.fn(),
    readTaskAssociation: vi.fn(),
    writeTaskAssociation: vi.fn(),
    drafts: {
      read: vi.fn(),
      write: vi.fn(),
    },
  },
  navigate: vi.fn(),
}));

vi.mock("../../nativeApi", () => ({
  ensureNativeApi: () => ({
    cedia: { forgeReview: forgeReviewApi },
    shell: { openExternal: vi.fn() },
  }),
  readNativeApi: () => ({
    cedia: { forgeReview: forgeReviewApi },
    shell: { openExternal: vi.fn() },
  }),
  readNativeApiServerCapability: () => false,
  onNativeApiServerCapabilitiesChange: () => () => undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => ({}),
  useParams: () => ({}),
}));

import {
  CodeReviewDraftCommentBox,
  CodeReviewDiffBody,
  CodeReviewOmpComposer,
  CodeReviewReviewAside,
} from "./CodeReviewSurface";
import {
  CodeReviewActivityPanel,
  ReviewMutationDialog,
} from "./CodeReviewWorkflowPanel";

import { ForgeReviewOmpProvider, useForgeReviewOmp } from "./useForgeReviewOmp";

const PROJECT_ID = "project-1" as ProjectId;

function detail(overrides: Partial<ForgeReviewDetail> = {}): ForgeReviewDetail {
  return {
    provider: "github",
    number: 7,
    title: "Review fixture",
    url: "https://github.com/acme/widgets/pull/7",
    state: "open",
    draft: false,
    refs: {
      head: { branch: "feature/review", sha: "head-7" },
      base: { branch: "main", sha: "base-7" },
    },
    counts: { comments: 0, reviews: 0, commits: 1, checks: 1 },
    repository: {
      provider: "github",
      hostname: "github.com",
      path: "acme/widgets",
      url: "https://github.com/acme/widgets",
    },
    body: "A bounded review fixture.",
    ref: { number: 7, url: "https://github.com/acme/widgets/pull/7" },
    comments: [],
    reviews: [],
    commits: [],
    checks: [{ name: "CI", status: "completed", conclusion: "success" }],
    files: [],
    snapshot: {
      hash: "snapshot-7",
      capturedAt: "2026-10-03T00:00:00.000Z",
      headSha: "head-7",
      baseSha: "base-7",
      truncated: false,
    },
    ...overrides,
  };
}

function renderWithClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

async function openDraftPanel() {
  await page.getByText("Draft a comment", { exact: true }).click();
}

beforeEach(() => {
  window.localStorage.removeItem("cedia:forge-review:unresolved-commands:v1");
  window.localStorage.removeItem("cedia:forge-review:omp-commands:v1");
  forgeReviewApi.drafts.read.mockReset();
  forgeReviewApi.drafts.write.mockReset();
  forgeReviewApi.reviewWithOmp.mockReset();
  forgeReviewApi.ask.mockReset();
  forgeReviewApi.readTaskResult.mockReset();
  forgeReviewApi.workflow.mockReset();
  forgeReviewApi.mutate.mockReset();
  forgeReviewApi.readInstructions.mockReset();
  forgeReviewApi.writeInstructions.mockReset();
  forgeReviewApi.readTaskAssociation.mockReset();
  forgeReviewApi.writeTaskAssociation.mockReset();
  forgeReviewApi.readInstructions.mockResolvedValue({ projectId: PROJECT_ID, revision: 0, text: "", examples: [], updatedAt: null });
  forgeReviewApi.writeInstructions.mockResolvedValue({ projectId: PROJECT_ID, revision: 1, text: "", examples: [], updatedAt: null });
  forgeReviewApi.readTaskAssociation.mockResolvedValue(null);
  forgeReviewApi.writeTaskAssociation.mockResolvedValue(null);
  navigate.mockReset();
});

afterEach(async () => {
  await cleanup();
  localStorage.removeItem("cedia:forge-review:unresolved-commands:v1");
  localStorage.removeItem("cedia:forge-review:omp-commands:v1");
  document.body.innerHTML = "";
});

describe("Code Review draft recovery", () => {
  it("keeps text typed before a late read while adopting the server revision", async () => {
    let resolveRead!: (value: { text: string; revision: number }) => void;
    forgeReviewApi.drafts.read.mockImplementation(
      () => new Promise((resolve) => { resolveRead = resolve; }),
    );
    forgeReviewApi.drafts.write.mockResolvedValue({ text: "typed", revision: 5 });

    await renderWithClient(<CodeReviewDraftCommentBox detail={detail()} projectId={PROJECT_ID} />);
    await openDraftPanel();
    const textarea = page.getByRole("textbox", { name: "Draft a review comment" });
    await textarea.fill("typed before the server response");
    resolveRead({ text: "old server draft", revision: 4 });

    await expect.element(textarea).toHaveValue("typed before the server response");
    await expect.element(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await page.getByRole("button", { name: "Save draft" }).click();
    expect(forgeReviewApi.drafts.write).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 }));
  });

  it("hydrates the new request after switching review identity", async () => {
    forgeReviewApi.drafts.read.mockImplementation((input: { number: number }) =>
      Promise.resolve({ text: `draft-${input.number}`, revision: input.number }),
    );
    function Harness() {
      const [selected, setSelected] = useState(7);
      const current = detail({ number: selected, ref: { number: selected, url: `https://github.com/acme/widgets/pull/${selected}` }, url: `https://github.com/acme/widgets/pull/${selected}`, snapshot: { ...detail().snapshot, hash: `snapshot-${selected}` } });
      return (
        <>
          <button type="button" onClick={() => setSelected(8)}>Switch review</button>
          <CodeReviewDraftCommentBox key={selected} detail={current} projectId={PROJECT_ID} />
        </>
      );
    }
    await renderWithClient(<Harness />);
    await openDraftPanel();
    await expect.element(page.getByRole("textbox", { name: "Draft a review comment" })).toHaveValue("draft-7");
    await page.getByRole("button", { name: "Switch review" }).click();
    await openDraftPanel();
    await expect.element(page.getByRole("textbox", { name: "Draft a review comment" })).toHaveValue("draft-8");
  });

  it("preserves unsaved text and exposes a reload action after a CAS conflict", async () => {
    forgeReviewApi.drafts.read.mockResolvedValue({ text: "", revision: 2 });
    const conflict = Object.assign(new Error("Draft revision changed elsewhere"), { code: "draft_conflict" });
    forgeReviewApi.drafts.write.mockRejectedValue(conflict);
    await renderWithClient(<CodeReviewDraftCommentBox detail={detail()} projectId={PROJECT_ID} />);
    await openDraftPanel();
    const textarea = page.getByRole("textbox", { name: "Draft a review comment" });
    await textarea.fill("keep this unsaved copy");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.element(page.getByText("The shared draft changed elsewhere. Your unsaved text is still here.")).toBeVisible();
    await expect.element(textarea).toHaveValue("keep this unsaved copy");
    await expect.element(page.getByRole("button", { name: "Reload revision" })).toBeVisible();
  });

  it("reads an old anchored draft without hiding it and requires explicit re-anchoring", async () => {
    forgeReviewApi.drafts.read.mockResolvedValue({
      text: "saved against the previous head",
      revision: 4,
      content: {
        kind: "forge-review-draft",
        projectId: PROJECT_ID,
        hostname: "github.com",
        provider: "github",
        repository: "acme/widgets",
        number: 7,
        url: "https://github.com/acme/widgets/pull/7",
        snapshotHash: "old-snapshot",
        headSha: "old-head",
        baseSha: "base-7",
      },
    });
    forgeReviewApi.drafts.write.mockResolvedValue({
      text: "saved against the previous head",
      revision: 5,
      content: {
        kind: "forge-review-draft",
        projectId: PROJECT_ID,
        hostname: "github.com",
        provider: "github",
        repository: "acme/widgets",
        number: 7,
        url: "https://github.com/acme/widgets/pull/7",
        snapshotHash: "snapshot-7",
        headSha: "head-7",
        baseSha: "base-7",
      },
    });
    await renderWithClient(<CodeReviewDraftCommentBox detail={detail()} projectId={PROJECT_ID} />);
    await openDraftPanel();
    await expect.element(page.getByText("This draft belongs to an older review snapshot.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await page.getByRole("button", { name: "Start new draft from this text" }).click();
    await expect.element(page.getByText("Saved to Cedia")).toBeVisible();
    expect(forgeReviewApi.drafts.write).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4, snapshotHash: "snapshot-7", headSha: "head-7" }));
  });
});

describe("Code Review responsive metadata and OMP retry", () => {
  it("renders the asynchronous diff after loading without changing hook order", async () => {
    let resolveDiff!: (value: ForgeReviewDiffResult) => void;
    forgeReviewApi.diff.mockImplementation(
      () => new Promise((resolve) => { resolveDiff = resolve; }),
    );
    await renderWithClient(
      <CodeReviewDiffBody detail={detail()} input={{ projectId: PROJECT_ID, url: detail().url }} />,
    );
    await expect.element(page.getByText("Loading changes…")).toBeVisible();
    resolveDiff({
      provider: "github",
      repository: detail().repository,
      ref: detail().ref,
      files: [{ path: "src/demo.ts", additions: 1, deletions: 1 }],
      patch: "diff --git a/src/demo.ts b/src/demo.ts\nindex 1111111..2222222 100644\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-old\n+new\n",
      truncated: false,
      snapshot: detail().snapshot,
    });
    await expect.element(page.getByTestId("forge-review-diff-loaded")).toBeVisible();
  });

  it("keeps checks and reviews available in the compact details panel", async () => {
    await render(<CodeReviewReviewAside detail={detail()} compact />);
    expect(page.getByText("Reviews", { exact: true })).toBeVisible();
    expect(page.getByText("Checks", { exact: true })).toBeVisible();
    expect(page.getByText("CI")).toBeVisible();
  });

  it("reuses one command id when the OMP response is lost, then clears it after success", async () => {
    const firstError = new Error("temporary response loss");
    forgeReviewApi.reviewWithOmp
      .mockRejectedValueOnce(firstError)
      .mockResolvedValue({ threadId: "review-task-7", commandId: "accepted", mode: "review" } satisfies ForgeReviewOmpResult);
    await renderWithClient(<CodeReviewOmpComposer detail={detail()} input={{ projectId: PROJECT_ID, url: detail().url }} />);
    const review = page.getByRole("button", { name: "Review with OMP" });
    await review.click();
    await expect.element(page.getByText("temporary response loss")).toBeVisible();
    await review.click();
    await expect.element(page.getByText("Open OMP task")).toBeVisible();
    expect(forgeReviewApi.reviewWithOmp.mock.calls[0]?.[0].commandId).toBe(
      forgeReviewApi.reviewWithOmp.mock.calls[1]?.[0].commandId,
    );
    await review.click();
    expect(forgeReviewApi.reviewWithOmp.mock.calls[2]?.[0].commandId).not.toBe(
      forgeReviewApi.reviewWithOmp.mock.calls[1]?.[0].commandId,
    );
  });

  it("reuses the durable OMP command after remount even when association arrives later", async () => {
    forgeReviewApi.reviewWithOmp
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ threadId: "review-task-remounted", mode: "review" } satisfies ForgeReviewOmpResult);
    forgeReviewApi.readTaskAssociation
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        projectId: PROJECT_ID,
        provider: "github",
        hostname: "github.com",
        repositoryPath: "acme/widgets",
        number: 7,
        snapshotHash: "snapshot-7",
        headSha: "head-7",
        baseSha: "base-7",
        revision: 1,
        threadId: "associated-after-loss",
        updatedAt: null,
      });
    function Harness() {
      const [visible, setVisible] = useState(true);
      return <>
        <button type="button" onClick={() => setVisible((current) => !current)}>{visible ? "Leave review" : "Return to review"}</button>
        {visible ? <CodeReviewOmpComposer detail={detail()} input={{ projectId: PROJECT_ID, url: detail().url }} /> : null}
      </>;
    }
    await renderWithClient(<Harness />);
    const firstReview = page.getByRole("button", { name: "Review with OMP" });
    await firstReview.click();
    await expect.element(page.getByText("response lost")).toBeVisible();
    const firstCommandId = forgeReviewApi.reviewWithOmp.mock.calls[0]?.[0].commandId;
    await page.getByRole("button", { name: "Leave review" }).click();
    await page.getByRole("button", { name: "Return to review" }).click();
    const remountedReview = page.getByRole("button", { name: "Review with OMP" });
    await expect.element(remountedReview).toBeEnabled();
    await remountedReview.click();
    await expect.element(page.getByRole("button", { name: "Open OMP task" })).toBeVisible();
    expect(forgeReviewApi.reviewWithOmp.mock.calls[1]?.[0].commandId).toBe(firstCommandId);
  });

  it("keeps the shared OMP owner single-flight while a review is pending", async () => {
    let resolveReview!: (value: ForgeReviewOmpResult) => void;
    forgeReviewApi.reviewWithOmp.mockImplementation(
      () => new Promise((resolve) => { resolveReview = resolve; }),
    );
    function HeaderAction() {
      const omp = useForgeReviewOmp(detail(), { projectId: PROJECT_ID, url: detail().url });
      return <button onClick={() => void omp.run("review", "")}>Header review</button>;
    }
    await renderWithClient(<ForgeReviewOmpProvider detail={detail()} input={{ projectId: PROJECT_ID, url: detail().url }}><HeaderAction /><CodeReviewOmpComposer detail={detail()} input={{ projectId: PROJECT_ID, url: detail().url }} /></ForgeReviewOmpProvider>);
    const review = page.getByRole("button", { name: "Review with OMP" });
    await review.click();
    await expect.element(review).toBeDisabled();
    await page.getByRole("button", { name: "Header review" }).click();
    await expect.poll(() => forgeReviewApi.reviewWithOmp.mock.calls.length).toBe(1);
    resolveReview({ threadId: "review-task-single-flight", mode: "review" });
    await expect.element(page.getByRole("button", { name: "Open OMP task" })).toBeVisible();
  });

  it("recovers after the durable OMP request ledger temporarily rejects a write", async () => {
    forgeReviewApi.reviewWithOmp.mockResolvedValue({ threadId: "review-task-storage-retry", mode: "review" } satisfies ForgeReviewOmpResult);
    const originalSetItem = Storage.prototype.setItem;
    let rejectLedgerWrite = true;
    const storageWrite = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === "cedia:forge-review:omp-commands:v1" && rejectLedgerWrite) {
        rejectLedgerWrite = false;
        throw new Error("storage unavailable");
      }
      originalSetItem.call(this, key, value);
    });
    await renderWithClient(<CodeReviewOmpComposer detail={detail()} input={{ projectId: PROJECT_ID, url: detail().url }} />);
    const review = page.getByRole("button", { name: "Review with OMP" });
    await review.click();
    await expect.element(page.getByText("OMP review request history could not be saved")).toBeVisible();
    expect(forgeReviewApi.reviewWithOmp).not.toHaveBeenCalled();
    storageWrite.mockRestore();
    await review.click();
    await expect.element(page.getByRole("button", { name: "Open OMP task" })).toBeVisible();
    expect(forgeReviewApi.reviewWithOmp).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch an instruction read from an older revision", async () => {
    let resolveInstructions!: (value: { projectId: ProjectId; revision: number; text: string; examples: readonly string[]; updatedAt: null }) => void;
    forgeReviewApi.readInstructions.mockImplementationOnce(() => new Promise((resolve) => { resolveInstructions = resolve; }));
    const first = detail();
    function Harness() {
      const [current, setCurrent] = useState(first);
      return <><button type="button" onClick={() => setCurrent(detail({ number: 8, url: "https://github.com/acme/widgets/pull/8", ref: { number: 8, url: "https://github.com/acme/widgets/pull/8" }, snapshot: { ...first.snapshot, hash: "snapshot-8", headSha: "head-8" } }))}>Switch review</button><CodeReviewOmpComposer detail={current} input={{ projectId: PROJECT_ID, url: current.url }} /></>;
    }
    await renderWithClient(<Harness />);
    await page.getByRole("button", { name: "Review with OMP" }).click();
    await page.getByRole("button", { name: "Switch review" }).click();
    resolveInstructions({ projectId: PROJECT_ID, revision: 1, text: "old review", examples: [], updatedAt: null });
    await expect.poll(() => forgeReviewApi.reviewWithOmp.mock.calls.length).toBe(0);
  });

  it("does not apply a delayed OMP response from review A to review B", async () => {
    forgeReviewApi.drafts.read.mockResolvedValue({ text: "", revision: 1 });
    forgeReviewApi.reviewWithOmp.mockResolvedValue({ threadId: "review-task-a", mode: "review" } satisfies ForgeReviewOmpResult);
    let resolveResult!: (value: { threadId: string; status: "completed"; text: string }) => void;
    forgeReviewApi.readTaskResult.mockImplementation(
      () => new Promise((resolve) => { resolveResult = resolve; }),
    );
    function Harness() {
      const [selected, setSelected] = useState<"A" | "B">("A");
      const [open, setOpen] = useState(true);
      const activeIdentity = useRef(selected);
      const [generated, setGenerated] = useState<string | null>(null);
      useEffect(() => {
        activeIdentity.current = selected;
        setGenerated(null);
      }, [selected]);
      const current = detail({
        number: selected === "A" ? 7 : 8,
        url: `https://github.com/acme/widgets/pull/${selected === "A" ? 7 : 8}`,
        ref: { number: selected === "A" ? 7 : 8, url: `https://github.com/acme/widgets/pull/${selected === "A" ? 7 : 8}` },
        snapshot: { ...detail().snapshot, hash: `snapshot-${selected}` },
      });
      return (
        <>
          <button type="button" onClick={() => setSelected("B")}>Switch review</button>
          <CodeReviewDraftCommentBox
            key={selected}
            detail={current}
            projectId={PROJECT_ID}
            generatedText={generated}
            onGeneratedTextConsumed={() => {
              if (activeIdentity.current === selected) setGenerated(null);
            }}
          />
          <CodeReviewOmpComposer
            key={`omp-${selected}`}
            detail={current}
            input={{ projectId: PROJECT_ID, url: current.url }}
            onUseResult={(text) => {
              if (activeIdentity.current === selected) setGenerated(text);
            }}
          />
        </>
      );
    }
    await renderWithClient(<Harness />);
    await page.getByRole("button", { name: "Review with OMP" }).click();
    await expect.element(page.getByRole("button", { name: "Use OMP response in draft" })).toBeVisible();
    await page.getByRole("button", { name: "Use OMP response in draft" }).click();
    await page.getByRole("button", { name: "Switch review" }).click();
    await openDraftPanel();
    const switchedTextarea = page.getByRole("textbox", { name: "Draft a review comment" });
    await expect.element(switchedTextarea).toHaveValue("");
    resolveResult({ threadId: "review-task-a", status: "completed", text: "A response that belongs to review A" });
    await expect.element(switchedTextarea).toHaveValue("");
  });

  it("restores the OMP task association after leaving and returning to a review", async () => {
    forgeReviewApi.reviewWithOmp.mockResolvedValue({ threadId: "review-task-7", mode: "review" } satisfies ForgeReviewOmpResult);
    function Harness() {
      const [visible, setVisible] = useState(true);
      const current = detail();
      return (
        <>
          <button type="button" onClick={() => setVisible((value) => !value)}>
            {visible ? "Leave review" : "Return to review"}
          </button>
          {visible ? <CodeReviewOmpComposer detail={current} input={{ projectId: PROJECT_ID, url: current.url }} /> : null}
        </>
      );
    }
    await render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Harness /></QueryClientProvider>);
    await page.getByRole("button", { name: "Review with OMP" }).click();
    await expect.element(page.getByRole("button", { name: "Open OMP task" })).toBeVisible();
    await page.getByRole("button", { name: "Open OMP task" }).click();
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ params: { threadId: "review-task-7" } }));
    await page.getByRole("button", { name: "Leave review" }).click();
    await page.getByRole("button", { name: "Return to review" }).click();
    await expect.element(page.getByRole("button", { name: "Open OMP task" })).toBeVisible();
  });

  it("loads activity pages without replacing the first page or duplicating ids", async () => {
    forgeReviewApi.workflow
      .mockResolvedValueOnce({
        provider: "github",
        repository: detail().repository,
        number: 7,
        headSha: "head-7",
        snapshotHash: "snapshot-7",
        section: "activity",
        activity: {
          items: [
            { id: "commit-1", kind: "commit", body: "first" },
            { id: "comment-1", kind: "comment", body: "discussion" },
          ],
          nextCursor: "page-2",
          truncated: true,
        },
      })
      .mockResolvedValueOnce({
        provider: "github",
        repository: detail().repository,
        number: 7,
        headSha: "head-7",
        snapshotHash: "snapshot-7",
        section: "activity",
        activity: {
          items: [
            { id: "comment-1", kind: "comment", body: "duplicate" },
            { id: "comment-2", kind: "timeline", body: "second page" },
          ],
          truncated: false,
        },
      });
    await renderWithClient(<CodeReviewActivityPanel input={{ projectId: PROJECT_ID, url: detail().url }} />);
    await expect.element(page.getByText("first")).toBeVisible();
    await page.getByRole("button", { name: "Load more" }).click();
    await expect.element(page.getByText("second page")).toBeVisible();
    expect(page.getByText("duplicate").query()).toBeNull();
    expect(forgeReviewApi.workflow).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "page-2", section: "activity" }));
    expect(page.getByText("first").elements()).toHaveLength(1);
  });

  it("requires the current head and sends the selected review decision", async () => {
    forgeReviewApi.mutate.mockResolvedValue({ receipt: { commandId: "cmd-1", requestHash: "hash", state: "confirmed", createdAt: "now", updatedAt: "now" } });
    await renderWithClient(<ReviewMutationDialog detail={detail()} input={{ projectId: PROJECT_ID, url: detail().url }} operation={{ kind: "review", event: "COMMENT" }} open onOpenChange={vi.fn()} />);
    await page.getByRole("combobox", { name: "Review decision" }).selectOptions("APPROVE");
    await page.getByRole("button", { name: "Confirm" }).click();
    expect(forgeReviewApi.mutate).toHaveBeenCalledWith(expect.objectContaining({ expectedHeadSha: "head-7", operation: { kind: "review", event: "APPROVE" } }));
  });


});


describe("Review publication target and recovery", () => {
  it("rejects a changed PR or head while confirmation is open", async () => {
    const operation = { kind: "issue_comment" as const, body: "Draft for original PR" };
    const input = { projectId: PROJECT_ID, url: detail().url };
    const view = await render(<ReviewMutationDialog detail={detail()} input={input} operation={operation} open onOpenChange={vi.fn()} />);
    await page.getByRole("textbox", { name: "Review message" }).fill("Draft for original PR");
    await view.rerender(<ReviewMutationDialog detail={detail({ snapshot: { ...detail().snapshot, headSha: "new-head" } })} input={input} operation={operation} open onOpenChange={vi.fn()} />);
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("changed while");
    expect(forgeReviewApi.mutate).not.toHaveBeenCalled();
    await view.rerender(<ReviewMutationDialog detail={detail()} input={{ ...input, url: input.url + "2" }} operation={operation} open onOpenChange={vi.fn()} />);
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    expect(forgeReviewApi.mutate).not.toHaveBeenCalled();
  });

  it("retains an uncertain command after closing and reopening", async () => {
    forgeReviewApi.mutate.mockRejectedValue(new Error("Response lost"));
    const operation = { kind: "issue_comment" as const, body: "Uncertain feedback" };
    const input = { projectId: PROJECT_ID, url: detail().url };
    const props = { detail: detail(), input, operation, onOpenChange: vi.fn() };
    const view = await render(<ReviewMutationDialog {...props} open />);
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Response lost");
    const commandId = forgeReviewApi.mutate.mock.calls[0]![0].commandId;
    await view.rerender(<ReviewMutationDialog {...props} open={false} />);
    await view.rerender(<ReviewMutationDialog {...props} open />);
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => forgeReviewApi.mutate.mock.calls.length).toBe(2);
    expect(forgeReviewApi.mutate.mock.calls[1]![0].commandId).toBe(commandId);
  });
});
