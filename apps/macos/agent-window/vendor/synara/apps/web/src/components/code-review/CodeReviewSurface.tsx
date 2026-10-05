import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode, type SetStateAction } from "react";
import type { ProjectId } from "@synara/contracts";
import type { ForgeReviewWorkflowResult } from "../../../../../../../../../../packages/protocol/src/forge-review-workflow.ts";
import type { ForgeReviewInlineComment, ForgeReviewMutationOperation, ForgeReviewMutationResult } from "../../../../../../../../../../packages/protocol/src/forge-review-workflow.ts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CodeIcon,
  CopyIcon,
  DiffIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeConflictIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  LoaderIcon,
  MessageCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  UsersIcon,
} from "~/lib/icons";
import {
  formatForgeReviewCount,
  formatForgeReviewError,
  formatForgeReviewState,
  formatForgeReviewTimestamp,
  forgeReviewQueryKeys,
  getForgeReviewApi,
  type ForgeReviewDetail,
  type ForgeReviewDetailInput,
  type ForgeReviewDraft,
  type ForgeReviewDraftReadInput,
  type ForgeReviewDraftWriteInput,
} from "~/lib/forgeReview";
import { ensureNativeApi } from "~/nativeApi";
import { useLatestProjectStore } from "~/latestProjectStore";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";
import {
  CodeReviewActivityPanel,
  ReviewActionBar,
  ReviewMutationDialog,
  ReviewPermissionsSummary,
  useReviewWorkflow,
} from "./CodeReviewWorkflowPanel";
import { useRegisterReviewTab } from "./CodeReviewTabs";
import { CodeReviewInlineDrafts, useInlineDraftState } from "./CodeReviewInlineDrafts";
import { CodeReviewDiffBody } from "./CodeReviewDiffBody";
import { CodeReviewRelatedRequests } from "./CodeReviewRelatedRequests";
import { CodeReviewProviderMark, CodeReviewSnapshotNotice } from "./CodeReviewPresentation";
import { ForgeReviewOmpProvider, useForgeReviewOmp } from "./useForgeReviewOmp";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";

// Keep the historical Surface export for browser fixtures and downstream callers.
export { CodeReviewDiffBody };

type ReviewRouteSearch = {
  readonly projectId?: string;
  readonly url?: string;
};

function routeSearch(): ReviewRouteSearch {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return {
    ...(params.get("projectId") ? { projectId: params.get("projectId") ?? undefined } : {}),
    ...(params.get("url") ? { url: params.get("url") ?? undefined } : {}),
  };
}

function useRouteSearch(): ReviewRouteSearch {
  const search = useSearch({ strict: false }) as unknown as ReviewRouteSearch;
  return { ...routeSearch(), ...search };
}

function mergeLabel(detail: ForgeReviewDetail): { label: string; tone: "success" | "danger" | "muted" } {
  if (detail.merge?.state === "mergeable") return { label: "Can merge without conflicts", tone: "success" };
  if (detail.merge?.state === "conflicts") return { label: "Conflicts need attention", tone: "danger" };
  return { label: "Merge status unavailable", tone: "muted" };
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center p-8">
      <div role="alert" className="max-w-md rounded-xl border border-destructive/30 bg-destructive/8 p-5 text-center">
        <CircleAlertIcon className="mx-auto size-5 text-destructive" aria-hidden />
        <h2 className="mt-3 text-sm font-semibold">Code Review could not load this request</h2>
        <p className="mt-1 text-xs text-muted-foreground">{formatForgeReviewError(error)}</p>
        <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
          <RefreshCwIcon className="size-3.5" aria-hidden /> Retry
        </Button>
      </div>
    </div>
  );
}

function EmptyReviewState() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <CodeIcon className="mx-auto size-8 text-muted-foreground/60" aria-hidden />
        <h2 className="mt-4 text-base font-semibold">Select a pull or merge request</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a review from the left or paste a GitHub/GitLab link to inspect its summary and diff.
        </p>
      </div>
    </div>
  );
}

function cleanProviderMarkdown(value: string | null): string {
  if (!value) return "";
  return value
    // Provider comments are metadata, not review prose. ChatMarkdown keeps the
    // remaining HTML escaped by default, so substantive provider text remains visible.
    .replace(/<!--[\s\S]*?-->/gu, "")
    .trim();
}

function SummaryBody({ detail, input }: { detail: ForgeReviewDetail; input: ForgeReviewDetailInput }) {
  // Preserve generated provider metadata without letting its escaped badge HTML
  // dominate the review prose. The original footer remains inspectable.
  const body = detail.body ?? "";
  const footerMarker = "<!-- CURSOR_AGENT_PR_BODY_END -->";
  const footerOffset = body.includes("<!-- CURSOR_AGENT_PR_BODY_BEGIN -->") ? body.indexOf(footerMarker) : -1;
  const prose = footerOffset >= 0 ? body.slice(0, footerOffset) : body;
  const providerFooter = footerOffset >= 0 ? body.slice(footerOffset + footerMarker.length).trim() : "";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="space-y-4 px-6 py-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1">
              <CodeReviewProviderMark provider={detail.provider} />
              {detail.provider === "github" ? "GitHub" : "GitLab"}
            </span>
            <span>#{detail.ref.number}</span>
            <span aria-hidden>·</span>
            <span>{formatForgeReviewState(detail)}</span>
          </div>
          <h1 className="mt-3 text-xl font-semibold leading-tight tracking-tight">{detail.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {detail.author ? (
              <span className="font-medium text-foreground">{detail.author.name ?? detail.author.login}</span>
            ) : (
              <span>Unknown author</span>
            )}
            <span>{formatForgeReviewTimestamp(detail.updatedAt ?? detail.createdAt)}</span>
            {detail.refs.head?.branch && detail.refs.base?.branch ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <GitBranchIcon className="size-3.5" aria-hidden />
                <span className="max-w-48 truncate">{detail.refs.head.branch}</span>
                <span aria-hidden>→</span>
                <span className="max-w-48 truncate">{detail.refs.base.branch}</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Comments", formatForgeReviewCount(detail.counts.comments)],
            ["Reviews", formatForgeReviewCount(detail.counts.reviews)],
            ["Commits", formatForgeReviewCount(detail.counts.commits)],
            ["Checks", formatForgeReviewCount(detail.counts.checks)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border/70 bg-[var(--color-background-elevated-secondary)] px-3 py-2">
              <div className="text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">{label}</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
        <section className="border-t border-border/70 pt-5">
          <h2 className="text-sm font-semibold">Summary</h2>
          <div className="pr-review-markdown mt-3">
            <ChatMarkdown
              text={cleanProviderMarkdown(prose) || "_No description provided._"}
              cwd=""
              isStreaming={false}
              className="text-sm leading-6"
            />
          </div>
          {providerFooter ? (
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Provider footer</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-3">{providerFooter}</pre>
            </details>
          ) : null}
        </section>
        <CodeReviewRelatedRequests input={input} detail={detail} />
        <CodeReviewActivityPanel input={input} />
      </section>
    </div>
  );
}

function StatusIcon({ status, conclusion }: { status: string; conclusion?: string }) {
  const normalizedStatus = status.toLowerCase();
  const normalizedConclusion = conclusion?.toLowerCase();
  const failed = normalizedConclusion === "failure" || normalizedConclusion === "cancelled" || normalizedConclusion === "timed_out";
  if (failed) return <CircleAlertIcon className="size-3.5 text-status-failure" aria-hidden />;
  if (normalizedStatus === "completed" && normalizedConclusion === "success") return <CircleCheckIcon className="size-3.5 text-status-success" aria-hidden />;
  if (normalizedStatus === "in_progress" || normalizedStatus === "queued") return <LoaderIcon className="size-3.5 animate-spin text-warning" aria-hidden />;
  return <CircleAlertIcon className="size-3.5 text-muted-foreground" aria-hidden />;
}

export function CodeReviewReviewAside({ detail, compact = false, overview }: { detail: ForgeReviewDetail; compact?: boolean; overview?: ForgeReviewWorkflowResult["overview"] }) {
  const merge = mergeLabel(detail);
  return (
    <aside className={cn(
      compact
        ? "max-h-[35vh] w-full overflow-y-auto border-t border-border/70 bg-[var(--color-background-surface)]"
        : "hidden w-64 shrink-0 overflow-y-auto border-l border-border/70 bg-[var(--color-background-surface)] xl:block",
    )}>
      <div className="space-y-5 p-4">
        {overview?.permissions ? <ReviewPermissionsSummary permissions={overview.permissions} /> : null}
        <section>
          <h2 className="text-xs font-medium text-muted-foreground">Merge status</h2>
          <div className="mt-2 flex items-start gap-2 text-xs">
            {merge.tone === "success" ? <CircleCheckIcon className="mt-0.5 size-3.5 text-status-success" aria-hidden /> : merge.tone === "danger" ? <GitMergeConflictIcon className="mt-0.5 size-3.5 text-status-failure" aria-hidden /> : <CircleAlertIcon className="mt-0.5 size-3.5 text-muted-foreground" aria-hidden />}
            <span>{merge.label}</span>
          </div>
        </section>
        <AsideSection title="Comments" count={detail.comments.length}>
          {detail.comments.length === 0 ? <p className="text-xs text-muted-foreground">No comments</p> : detail.comments.slice(0, 4).map((comment) => <ActivityItem key={comment.id} title={comment.author?.login ?? "Comment"} body={comment.body} at={comment.createdAt} />)}
        </AsideSection>
        <AsideSection title="Reviews" count={detail.reviews.length}>
          {detail.reviews.length === 0 ? <p className="text-xs text-muted-foreground">No reviews</p> : detail.reviews.slice(0, 6).map((review) => <ActivityItem key={review.id} title={`${review.author?.login ?? "Reviewer"} · ${review.state.replaceAll("_", " ")}`} body={review.body} at={review.submittedAt} />)}
        </AsideSection>
        <AsideSection title="Checks" count={detail.checks.length}>
          {detail.checks.length === 0 ? <p className="text-xs text-muted-foreground">No checks reported</p> : detail.checks.map((check) => <a key={check.name} href={check.url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs hover:bg-muted/40"><StatusIcon status={check.status} conclusion={check.conclusion} /><span className="min-w-0 flex-1 truncate">{check.name}</span><span className="shrink-0 text-[10px] text-muted-foreground">{check.conclusion ?? check.status}</span></a>)}
        </AsideSection>
        <AsideSection title="Files" count={detail.files.length}>
          {detail.files.slice(0, 8).map((file) => <div key={file.path} className="flex min-w-0 items-center gap-2 py-1 text-xs"><CodeIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate">{file.path}</span></div>)}
          {detail.files.length > 8 ? <p className="text-[10px] text-muted-foreground">+{detail.files.length - 8} more files</p> : null}
        </AsideSection>
      </div>
    </aside>
  );
}

function AsideSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
      <h2 className="flex items-center justify-between text-xs font-medium text-muted-foreground"><span>{title}</span><span className="tabular-nums">{count}</span></h2>
      <div className="mt-2 space-y-1">{children}</div>
    </section>
  );
}

function ActivityItem({ title, body, at }: { title: string; body: string; at?: string }) {
  return (
    <div className="rounded-md px-1 py-1.5">
      <div className="truncate text-xs font-medium">{title}</div>
      {body ? <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{body}</p> : null}
      {at ? <div className="mt-0.5 text-[10px] text-muted-foreground/75">{formatForgeReviewTimestamp(at)}</div> : null}
    </div>
  );
}

export function CodeReviewDraftCommentBox({
  detail,
  projectId,
  generatedText = null,
  onGeneratedTextConsumed,
  onPublish,
}: {
  detail: ForgeReviewDetail;
  projectId: ProjectId;
  generatedText?: string | null;
  onGeneratedTextConsumed?: () => void;
  onPublish?: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const input = useMemo<ForgeReviewDraftReadInput>(() => ({
    projectId,
    provider: detail.provider,
    hostname: detail.repository.hostname,
    repositoryPath: detail.repository.path,
    number: detail.ref.number,
  }), [
    detail.provider,
    detail.repository.hostname,
    detail.repository.path,
    detail.ref.number,
    projectId,
  ]);
  const draftQueryKey = useMemo(
    () => [
      "cedia",
      "forge-review",
      "draft",
      input.projectId,
      input.hostname,
      input.provider,
      input.repositoryPath,
      input.number,
      detail.snapshot.hash,
    ] as const,
    [detail.snapshot.hash, input.hostname, input.number, input.projectId, input.provider, input.repositoryPath],
  );
  const draftQuery = useQuery({
    queryKey: draftQueryKey,
    queryFn: () => getForgeReviewApi().drafts.read(input),
    enabled: Boolean(input.projectId),
    staleTime: Infinity,
    retry: false,
  });
  const [text, setText] = useState("");
  const textRef = useRef("");
  const [revision, setRevision] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [draftConflict, setDraftConflict] = useState(false);
  const [expanded, setExpanded] = useState(Boolean(generatedText));
  const dirtyRef = useRef(false);
  const saveSequenceRef = useRef(0);
  useEffect(() => {
    if (!draftQuery.data) return;
    setRevision(draftQuery.data.revision);
    setDraftConflict(false);
    if (dirtyRef.current) return;
    setText(draftQuery.data.text);
    textRef.current = draftQuery.data.text;
    setSaveState(draftQuery.data.text ? "saved" : "idle");
  }, [draftQuery.data]);
  useEffect(() => {
    if (generatedText === null || generatedText === undefined) return;
    setText(generatedText);
    textRef.current = generatedText;
    dirtyRef.current = true;
    setExpanded(true);
    setSaveState("idle");
    onGeneratedTextConsumed?.();
  }, [generatedText, onGeneratedTextConsumed]);
  useEffect(() => {
    if (!draftQuery.isError) return;
    setSaveState("error");
  }, [draftQuery.isError]);

  const draftContent = (draftQuery.data as ForgeReviewDraft | undefined)?.content;
  const draftAnchor = draftContent ?? (draftQuery.data as ForgeReviewDraft | undefined);
  const staleDraft = Boolean(
    draftAnchor &&
      ((draftAnchor.snapshotHash && detail.snapshot.hash && draftAnchor.snapshotHash !== detail.snapshot.hash) ||
        (draftAnchor.headSha && detail.snapshot.headSha && draftAnchor.headSha !== detail.snapshot.headSha) ||
        (draftAnchor.baseSha && detail.snapshot.baseSha && draftAnchor.baseSha !== detail.snapshot.baseSha) ||
        (draftAnchor.url && draftAnchor.url !== detail.ref.url)),
  );

  const isDraftConflict = (error: unknown) => {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
    return code === "draft_conflict" || /revision|conflict/i.test(formatForgeReviewError(error));
  };

  const persistDraft = (allowStale: boolean) => {
    if (!draftQuery.isSuccess || draftQuery.isError || (!allowStale && staleDraft)) return;
    const requestText = text;
    const requestSequence = ++saveSequenceRef.current;
    const write: ForgeReviewDraftWriteInput = {
      ...input,
      text,
      ...(detail.snapshot.hash ? { snapshotHash: detail.snapshot.hash } : {}),
      ...(detail.snapshot.headSha ? { headSha: detail.snapshot.headSha } : {}),
      ...(detail.snapshot.baseSha ? { baseSha: detail.snapshot.baseSha } : {}),
      expectedRevision: revision,
    };
    setSaveState("saving");
    void getForgeReviewApi().drafts
      .write(write)
      .then((result) => {
        if (requestSequence !== saveSequenceRef.current) return;
        setRevision(result.revision);
        queryClient.setQueryData(draftQueryKey, result);
        if (textRef.current === requestText) {
          dirtyRef.current = false;
          setDraftConflict(false);
          setSaveState("saved");
        } else setSaveState("idle");
      })
      .catch((error: unknown) => {
        if (requestSequence !== saveSequenceRef.current) return;
        setSaveState("error");
        setDraftConflict(isDraftConflict(error));
      });
  };
  const saveDraft = () => persistDraft(false);
  const reanchorDraft = () => persistDraft(true);
  const draftStatus = draftQuery.isPending
    ? "Loading draft…"
    : draftQuery.isError
      ? "Draft unavailable"
      : staleDraft
        ? "Stale snapshot"
        : draftConflict
          ? "Needs reload"
          : saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved to Cedia"
              : "Cedia draft";
  return (
    <section className="border-t border-border/70 px-6">
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-3 text-sm [&::-webkit-details-marker]:hidden">
          <span className="font-semibold">Draft a comment</span>
          <span className="text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">{draftStatus}</span>
        </summary>
        <div className="pb-5">
          {draftQuery.isError ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-2.5 py-2 text-xs text-muted-foreground" role="alert">
              <span>{formatForgeReviewError(draftQuery.error)}</span>
              <Button size="xs" variant="link" onClick={() => void draftQuery.refetch()}>Retry</Button>
            </div>
          ) : null}
          {staleDraft ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/8 px-2.5 py-2 text-xs text-muted-foreground" role="status">
              <span>This draft belongs to an older review snapshot. Save is blocked until you explicitly re-anchor it.</span>
              <Button size="xs" variant="link" disabled={!draftQuery.isSuccess || saveState === "saving"} onClick={reanchorDraft}>
                Start new draft from this text
              </Button>
            </div>
          ) : null}
          {draftConflict ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/8 px-2.5 py-2 text-xs text-muted-foreground" role="alert">
              <span>The shared draft changed elsewhere. Your unsaved text is still here.</span>
              <Button
                size="xs"
                variant="link"
                onClick={() => {
                  void draftQuery.refetch().then(() => setDraftConflict(false));
                }}
              >
                Reload revision
              </Button>
            </div>
          ) : null}
          <textarea
            aria-label="Draft a review comment"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              textRef.current = event.target.value;
              dirtyRef.current = true;
              setSaveState("idle");
            }}
            placeholder="Write a comment for this pull or merge request…"
            className="mt-3 min-h-24 w-full resize-y rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring/60"
          />
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {onPublish ? <Button size="sm" disabled={!draftQuery.isSuccess || draftQuery.isError || staleDraft || !text.trim() || saveState === "saving"} onClick={() => onPublish(text.trim())}>Review and publish</Button> : null}
            <Button size="sm" variant="outline" disabled={!draftQuery.isSuccess || draftQuery.isError || staleDraft || saveState === "saving"} onClick={saveDraft}>
              {saveState === "saving" ? <LoaderIcon className="size-3.5 animate-spin" aria-hidden /> : <CheckIcon className="size-3.5" aria-hidden />}
              Save draft
            </Button>
          </div>
        </div>
      </details>
    </section>
  );
}

export function CodeReviewOmpComposer({ detail, input, onUseResult }: { detail: ForgeReviewDetail; input: ForgeReviewDetailInput; onUseResult?: (text: string) => void }) {
  const navigate = useNavigate();
  const modelCatalog = useProviderModelCatalog({ selectedProvider: "omp", discoveryEnabled: true, prefetchProviders: ["omp"] });
  const [reviewModel, setReviewModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const { status, pending, task, run, readResult } = useForgeReviewOmp(detail, input);
  const canReview = pending === null && !detail.snapshot.truncated;
  const review = () => void run("review", "", reviewModel ? { model: reviewModel } : undefined);
  const ask = () => void run("ask", prompt);
  const copyResult = async () => {
    const result = await readResult();
    if (!result || result.status === "truncated" || result.truncated || !result.text.trim()) return;
    onUseResult?.(result.text);
  };
  return (
    <section className="shrink-0 border-t border-border/70 bg-[var(--color-background-surface)] px-6 py-2.5">
      <h2 className="sr-only">Ask about this review</h2>
      <textarea aria-label="Ask OMP about this pull request" rows={1} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask OMP to explain the change or focus the review…" className="mt-1 min-h-9 max-h-14 w-full resize-none overflow-y-auto rounded-lg border border-border/70 bg-background px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring/60" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">OMP reviews this revision. Comments stay in Cedia.</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="sr-only">OMP model</span><select aria-label="OMP review model" value={reviewModel} onChange={(event) => setReviewModel(event.target.value)} className="h-7 max-w-36 rounded-md border border-border/70 bg-background px-1.5 text-[10px]"><option value="">Current model</option>{modelCatalog.modelOptionsByProvider.omp.map((option) => <option key={option.slug} value={option.slug}>{option.name}</option>)}</select></label>
          <Button size="sm" variant="outline" disabled={!canReview} onClick={review}>{pending === "review" ? <LoaderIcon className="size-3.5 animate-spin" aria-hidden /> : <CodeIcon className="size-3.5" aria-hidden />}Review with OMP</Button>
          <Button size="sm" disabled={!canReview || !prompt.trim()} onClick={ask}>{pending === "ask" ? <LoaderIcon className="size-3.5 animate-spin" aria-hidden /> : <ArrowUpRightIcon className="size-3.5" aria-hidden />}Ask OMP</Button>
        </div>
      </div>
      {status ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">
        <span>{status}</span>
        {task?.threadId ? <>
          <Button size="xs" variant="link" onClick={() => void navigate({ to: "/$threadId", params: { threadId: task.threadId! } })}>Open OMP task</Button>
          {onUseResult && getForgeReviewApi().readTaskResult ? <Button size="xs" variant="link" onClick={() => void copyResult()}>Use OMP response in draft</Button> : null}
        </> : null}
      </div> : null}
    </section>
  );
}

type CodeReviewSurfaceLayoutProps = {
  readonly detail: ForgeReviewDetail;
  readonly input: ForgeReviewDetailInput;
  readonly overview?: ForgeReviewWorkflowResult["overview"];
  readonly tab: "summary" | "changes";
  readonly setTab: (tab: "summary" | "changes") => void;
  readonly inlineComments: readonly ForgeReviewInlineComment[];
  readonly setInlineComments: Dispatch<SetStateAction<readonly ForgeReviewInlineComment[]>>;
  readonly inlineDraftSaveState: ReturnType<typeof useInlineDraftState>[2];
  readonly generatedDraftText: string | null;
  readonly onGeneratedTextConsumed: () => void;
  readonly onUseOmpResult: (text: string) => void;
  readonly pendingCommentOperation: ForgeReviewMutationOperation | null;
  readonly onPublishComment: (text: string) => void;
  readonly onCloseComment: () => void;
  readonly onCommentComplete: (result: ForgeReviewMutationResult) => void;
  readonly onRefresh: () => void;
};

function CodeReviewSurfaceLayout({
  detail,
  input,
  overview,
  tab,
  setTab,
  inlineComments,
  setInlineComments,
  inlineDraftSaveState,
  generatedDraftText,
  onGeneratedTextConsumed,
  onUseOmpResult,
  pendingCommentOperation,
  onPublishComment,
  onCloseComment,
  onCommentComplete,
  onRefresh,
}: CodeReviewSurfaceLayoutProps) {
  const tabs = ["summary", "changes"] as const;
  const changesCount = detail.files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletionsCount = detail.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const selectTab = (next: "summary" | "changes") => setTab(next);
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabs.indexOf(tab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex + tabs.length - 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    selectTab(nextTab);
    document.getElementById(`forge-review-tab-${nextTab}`)?.focus();
  };
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-surface)] text-foreground">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border/70 px-4">
        <div className="flex min-w-0 items-center gap-1 rounded-lg bg-[var(--color-background-elevated-secondary)] p-0.5" role="tablist" aria-label="Pull request views">
          {tabs.map((value) => (
            <button
              key={value}
              id={`forge-review-tab-${value}`}
              type="button"
              role="tab"
              aria-selected={tab === value}
              aria-controls={`forge-review-panel-${value}`}
              tabIndex={tab === value ? 0 : -1}
              onKeyDown={onTabKeyDown}
              onClick={() => selectTab(value)}
              className={cn("rounded-md px-2.5 py-1.5 text-xs capitalize outline-none focus-visible:ring-1 focus-visible:ring-ring", tab === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {value}{value === "changes" ? ` +${changesCount} −${deletionsCount}` : ""}
            </button>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{detail.repository.path} · #{detail.ref.number}</span>
        <IconButton label="Open in provider" tooltip="Open in provider" variant="chrome" onClick={() => void ensureNativeApi().shell.openExternal(detail.ref.url)}><ExternalLinkIcon className="size-3.5" aria-hidden /></IconButton>
        <IconButton label="Copy review link" tooltip="Copy review link" variant="chrome" onClick={() => void navigator.clipboard?.writeText(detail.ref.url)}><CopyIcon className="size-3.5" aria-hidden /></IconButton>
        <ReviewActionBar key={`${input.projectId}:${detail.ref.url}:${detail.snapshot.hash}`} detail={detail} input={input} inlineComments={inlineComments} overview={overview} onChanged={onRefresh} onReviewSubmitted={() => setInlineComments([])} />
      </header>
      {tab === "summary" ? <CodeReviewSnapshotNotice detail={detail} /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div id={`forge-review-panel-${tab}`} role="tabpanel" tabIndex={0} aria-labelledby={`forge-review-tab-${tab}`} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
            {tab === "summary" ? <SummaryBody detail={detail} input={input} /> : <CodeReviewDiffBody input={input} detail={detail} onAddInlineComment={(comment) => setInlineComments((current) => [...current, comment])} />}
          </div>
          <CodeReviewInlineDrafts comments={inlineComments} onChange={setInlineComments} saveState={inlineDraftSaveState} />
          <CodeReviewDraftCommentBox detail={detail} projectId={input.projectId} generatedText={generatedDraftText} onGeneratedTextConsumed={onGeneratedTextConsumed} onPublish={onPublishComment} />
          <CodeReviewOmpComposer detail={detail} input={input} onUseResult={onUseOmpResult} />
          <ReviewMutationDialog detail={detail} input={input} operation={pendingCommentOperation} open={pendingCommentOperation !== null} onOpenChange={(value) => { if (!value) onCloseComment(); }} onComplete={onCommentComplete} />
          <div className="min-w-0 xl:hidden">
            <details className="border-t border-border/70">
              <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-xs font-medium text-muted-foreground"><span>Review details</span><span className="tabular-nums">{detail.checks.length} checks · {detail.reviews.length} reviews</span></summary>
              <CodeReviewReviewAside detail={detail} compact overview={overview} />
            </details>
          </div>
        </div>
        <CodeReviewReviewAside detail={detail} overview={overview} />
      </div>
    </main>
  );
}

export function CodeReviewSurface() {
  const search = useRouteSearch();
  const projects = useStore((state) => state.projects).filter((project) => project.kind === "project");
  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);
  const projectId = (search.projectId ?? latestProjectId ?? projects[0]?.id) as ProjectId | undefined;
  const input = search.url && projectId ? { projectId, url: search.url } : null;
  const detailQuery = useQuery({
    queryKey: forgeReviewQueryKeys.detail(input),
    queryFn: () => {
      if (!input) throw new Error("Select a pull or merge request first.");
      return getForgeReviewApi().detail(input);
    },
    enabled: input !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const workflowOverviewQuery = useReviewWorkflow(
    input ?? { projectId: "" as ProjectId, url: "" },
    "overview",
    input !== null,
  );
  const inlineDraftIdentity = input && detailQuery.data
    ? `${input.projectId}:${detailQuery.data.provider}:${detailQuery.data.repository.hostname}:${detailQuery.data.repository.path}:${detailQuery.data.ref.number}:${detailQuery.data.snapshot.hash}`
    : null;
  const inlineDraftInput = useMemo(() => input && detailQuery.data ? ({
    projectId: input.projectId,
    provider: detailQuery.data.provider,
    hostname: detailQuery.data.repository.hostname,
    repositoryPath: detailQuery.data.repository.path,
    number: detailQuery.data.ref.number,
    snapshotHash: detailQuery.data.snapshot.hash,
    ...(detailQuery.data.snapshot.headSha ? { headSha: detailQuery.data.snapshot.headSha } : {}),
    ...(detailQuery.data.snapshot.baseSha ? { baseSha: detailQuery.data.snapshot.baseSha } : {}),
  }) : undefined, [detailQuery.data, input]);
  const [inlineComments, setInlineComments, inlineDraftSaveState] = useInlineDraftState(inlineDraftIdentity, inlineDraftInput);
  const [tab, setTab] = useState<"summary" | "changes">("summary");
  const [generatedDraftText, setGeneratedDraftText] = useState<string | null>(null);
  const [pendingCommentDraft, setPendingCommentDraft] = useState<string | null>(null);
  const pendingCommentOperation = useMemo<ForgeReviewMutationOperation | null>(
    () => pendingCommentDraft === null ? null : { kind: "issue_comment", body: pendingCommentDraft },
    [pendingCommentDraft],
  );
  const activeReviewIdentityRef = useRef<string | null>(null);
  const routeReviewIdentity = input ? `${input.projectId}:${input.url}` : null;
  const currentReviewIdentity = input
    ? `${routeReviewIdentity}:${detailQuery.isFetching ? "loading" : detailQuery.data?.snapshot.hash ?? "loading"}`
    : null;
  useEffect(() => setTab("summary"), [search.url]);
  useEffect(() => {
    activeReviewIdentityRef.current = currentReviewIdentity;
    setGeneratedDraftText(null);
    setPendingCommentDraft(null);
  }, [currentReviewIdentity]);
  useRegisterReviewTab(input, detailQuery.data);

  if (!input) return <EmptyReviewState />;
  if (detailQuery.isPending) {
    return <div className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderIcon className="size-3.5 animate-spin" aria-hidden /> Loading review…</div>;
  }
  if (detailQuery.isError || !detailQuery.data) return <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  const detail = detailQuery.data;
  return (
    <ForgeReviewOmpProvider key={`${input.projectId}:${detail.ref.url}:${detail.snapshot.hash}`} detail={detail} input={input}>
      <CodeReviewSurfaceLayout
        detail={detail}
        input={input}
        overview={workflowOverviewQuery.data?.overview}
        tab={tab}
        setTab={setTab}
        inlineComments={inlineComments}
        setInlineComments={setInlineComments}
        inlineDraftSaveState={inlineDraftSaveState}
        generatedDraftText={generatedDraftText}
        onGeneratedTextConsumed={() => { if (activeReviewIdentityRef.current === currentReviewIdentity) setGeneratedDraftText(null); }}
        onUseOmpResult={(text) => { if (activeReviewIdentityRef.current === currentReviewIdentity) setGeneratedDraftText(text); }}
        pendingCommentOperation={pendingCommentOperation}
        onPublishComment={setPendingCommentDraft}
        onCloseComment={() => setPendingCommentDraft(null)}
        onCommentComplete={(result) => { if (result.receipt.state === "confirmed") { setPendingCommentDraft(null); void detailQuery.refetch(); } }}
        onRefresh={() => void detailQuery.refetch()}
      />
    </ForgeReviewOmpProvider>
  );
}

export default CodeReviewSurface;
