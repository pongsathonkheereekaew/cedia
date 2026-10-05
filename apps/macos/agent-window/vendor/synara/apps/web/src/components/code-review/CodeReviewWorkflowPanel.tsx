import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import type {
  ForgeReviewActivityItem,
  ForgeReviewInlineComment,
  ForgeReviewMutationOperation,
  ForgeReviewMutationResult,
  ForgeReviewPermissions,
  ForgeReviewReviewThread,
  ForgeReviewWorkflowResult,
  ForgeReviewWorkflowSection,
} from "../../../../../../../../../../packages/protocol/src/forge-review-workflow.ts";
import type { ForgeReviewComment } from "../../../../../../../../../../packages/protocol/src/index.ts";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Popover, PopoverPopup, PopoverTitle } from "~/components/ui/popover";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import type { ProjectId } from "@synara/contracts";
import {
  CheckIcon,
  CircleAlertIcon,
  GitCommitIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  LoaderIcon,
  MessageCircleIcon,
  PencilIcon,
  RefreshCwIcon,
  SettingsIcon,
  UsersIcon,
  XIcon,
} from "~/lib/icons";
import {
  formatForgeReviewError,
  formatForgeReviewTimestamp,
  getForgeReviewApi,
  type ForgeReviewDetail,
  type ForgeReviewDetailInput,
} from "~/lib/forgeReview";
import { cn } from "~/lib/utils";
import {
  completeReviewMutationCommand,
  getReviewMutationCommandId,
  type ReviewMutationIdentity,
} from "./codeReviewMutationCommands";
import { useForgeReviewOmp } from "./useForgeReviewOmp";

const workflowKey = (input: ForgeReviewDetailInput, section: ForgeReviewWorkflowSection) =>
  ["cedia", "forge-review", "workflow", input.projectId, input.url, section] as const;

function apiWithWorkflow() {
  return getForgeReviewApi();
}

function newCommandId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `forge-review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function operationLabel(operation: ForgeReviewMutationOperation): string {
  switch (operation.kind) {
    case "review":
      return operation.event === "REQUEST_CHANGES" ? "request changes" : operation.event.toLowerCase();
    case "issue_comment":
      return "post a comment";
    case "reply":
      return "reply to a comment";
    case "resolve_thread":
      return operation.resolved ? "resolve a thread" : "reopen a thread";
    case "edit":
      return "edit the pull request";
    case "reviewers":
      return "change requested reviewers";
    case "draft":
      return operation.draft ? "convert to draft" : "mark ready for review";
    case "state":
      return operation.state === "closed" ? "close the pull request" : "reopen the pull request";
    case "merge":
      return `merge with ${operation.method}`;
  }
  return "remote review action";
}

function reviewPermissions(overview?: ForgeReviewWorkflowResult["overview"]): ForgeReviewPermissions {
  if (overview?.permissions?.available) return overview.permissions;
  return {
    canComment: false,
    canReview: false,
    canEdit: false,
    canRequestReviewers: false,
    canChangeState: false,
    canMerge: false,
    available: false,
    mergeMethods: [],
    reason: overview?.permissions?.reason ?? "Provider permissions are still loading.",
  };
}

export function useReviewWorkflow(
  input: ForgeReviewDetailInput,
  section: ForgeReviewWorkflowSection,
  enabled = true,
) {
  return useQuery({
    queryKey: workflowKey(input, section),
    queryFn: async () => {
      const workflow = apiWithWorkflow().workflow;
      if (!workflow) throw new Error("The Code Review workflow bridge is unavailable.");
      return workflow({ ...input, section, limit: 50 });
    },
    enabled,
    staleTime: 20_000,
    retry: false,
  });
}

function WorkflowPage<T>({
  input,
  section,
  render,
}: {
  input: ForgeReviewDetailInput;
  section: ForgeReviewWorkflowSection;
  render: (result: ForgeReviewWorkflowResult, loadMore: () => void, loadingMore: boolean) => ReactNode;
}) {
  const query = useReviewWorkflow(input, section);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loadedMore, setLoadedMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [extra, setExtra] = useState<readonly T[]>([]);
  const generationRef = useRef(0);
  useEffect(() => {
    generationRef.current += 1;
    setNextCursor(undefined);
    setLoadedMore(false);
    setLoadError(null);
    setExtra([]);
    setLoadingMore(false);
  }, [input.projectId, input.url, section]);
  const loadMore = () => {
    const cursor = nextCursor ?? (section === "activity" ? query.data?.activity?.nextCursor : query.data?.threads?.nextCursor);
    if (!cursor || loadingMore) return;
    const workflow = apiWithWorkflow().workflow;
    if (!workflow) return;
    const generation = generationRef.current;
    setLoadingMore(true);
    setLoadError(null);
    void workflow({ ...input, section, cursor, limit: 50 })
      .then((result) => {
        if (generation !== generationRef.current) return;
        setLoadedMore(true);
        setNextCursor(result.activity?.nextCursor ?? result.threads?.nextCursor);
        const nextItems = (section === "activity" ? result.activity?.items : result.threads?.items) ?? [];
        setExtra((current) => {
          const firstPageItems = section === "activity" ? query.data?.activity?.items : query.data?.threads?.items;
          const existing = new Set([
            ...(firstPageItems ?? []).map((item) => (item as { id?: string }).id),
            ...current.map((item) => (item as { id?: string }).id),
          ]);
          return [...current, ...(nextItems as readonly T[]).filter((item) => {
            const id = (item as { id?: string }).id;
            return id === undefined || !existing.has(id);
          })];
        });
      })
      .catch((error: unknown) => {
        if (generation === generationRef.current) setLoadError(formatForgeReviewError(error));
      })
      .finally(() => {
        if (generation === generationRef.current) setLoadingMore(false);
      });
  };
  if (query.isPending) return <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground"><LoaderIcon className="size-3.5 animate-spin" aria-hidden /> Loading {section}…</div>;
  if (query.isError || !query.data) return <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><CircleAlertIcon className="size-3.5 text-warning" aria-hidden /> {formatForgeReviewError(query.error)}</div>;
  const result = {
    ...query.data,
    ...(section === "activity" && query.data.activity ? { activity: { ...query.data.activity, nextCursor: loadedMore ? nextCursor : query.data.activity.nextCursor, items: [...query.data.activity.items, ...(extra as readonly ForgeReviewActivityItem[])] } } : {}),
    ...(section === "threads" && query.data.threads ? { threads: { ...query.data.threads, nextCursor: loadedMore ? nextCursor : query.data.threads.nextCursor, items: [...query.data.threads.items, ...(extra as readonly ForgeReviewReviewThread[])] } } : {}),
  };
  return <>{render(result, loadMore, loadingMore)}{loadError ? <div className="mt-2 text-xs text-destructive" role="alert">{loadError}</div> : null}</>;
}

export function CodeReviewActivityPanel({ input }: { input: ForgeReviewDetailInput }) {
  const [view, setView] = useState<"activity" | "threads">("activity");
  return (
    <section className="border-t border-border/70 pt-5" data-testid="forge-review-workflow">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Discussion & activity</h2>
        <ReviewViewTabs view={view} onChange={setView} />
      </div>
      {view === "activity" ? (
        <div id="forge-review-activity-panel" role="tabpanel" aria-labelledby="forge-review-activity-tab">
          <WorkflowPage<ForgeReviewActivityItem>
            input={input}
            section="activity"
            render={(result, loadMore, loadingMore) => <ActivityItems result={result} loadMore={loadMore} loadingMore={loadingMore} />}
          />
        </div>
      ) : (
        <div id="forge-review-threads-panel" role="tabpanel" aria-labelledby="forge-review-threads-tab">
          <WorkflowPage<ForgeReviewReviewThread>
            input={input}
            section="threads"
            render={(result, loadMore, loadingMore) => <ThreadItems result={result} loadMore={loadMore} loadingMore={loadingMore} input={input} />}
          />
        </div>
      )}
    </section>
  );
}

function ReviewViewTabs({
  view,
  onChange,
}: {
  view: "activity" | "threads";
  onChange: (view: "activity" | "threads") => void;
}) {
  const values = ["activity", "threads"] as const;
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = values.indexOf(view);
    const nextIndex = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? (currentIndex + 1) % values.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? (currentIndex + values.length - 1) % values.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? values.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    onChange(values[nextIndex]!);
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted/50 p-0.5" role="tablist" aria-label="Review activity views">
      {values.map((value) => {
        const selected = view === value;
        return (
          <button
            id={`forge-review-${value}-tab`}
            key={value}
            type="button"
            role="tab"
            tabIndex={selected ? 0 : -1}
            aria-selected={selected}
            aria-controls={`forge-review-${value}-panel`}
            onClick={() => onChange(value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "rounded-md px-2 py-1 text-[length:var(--app-font-size-ui-xs,10px)] capitalize transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

function ActivityItems({
  result,
  loadMore,
  loadingMore,
}: {
  result: ForgeReviewWorkflowResult;
  loadMore: () => void;
  loadingMore: boolean;
}) {
  const page = result.activity;
  const items = page?.items ?? [];
  return (
    <div className="mt-3 space-y-2">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No activity reported.</p>
      ) : (
        items.map((item) => <ActivityRow key={item.id} item={item} />)
      )}
      {page?.nextCursor ? (
        <Button size="xs" variant="outline" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? <LoaderIcon className="size-3 animate-spin" aria-hidden /> : <RefreshCwIcon className="size-3" aria-hidden />}
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function ThreadItems({
  result,
  loadMore,
  loadingMore,
  input,
}: {
  result: ForgeReviewWorkflowResult;
  loadMore: () => void;
  loadingMore: boolean;
  input: ForgeReviewDetailInput;
}) {
  const page = result.threads;
  const threads = page?.items ?? [];
  return (
    <div className="mt-3 space-y-2">
      {threads.length === 0 ? (
        <p className="text-xs text-muted-foreground">No inline threads reported.</p>
      ) : (
        threads.map((thread) => (
          <ThreadRow key={thread.id} thread={thread} input={input} expectedHeadSha={result.headSha} />
        ))
      )}
      {page?.nextCursor ? (
        <Button size="xs" variant="outline" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? <LoaderIcon className="size-3 animate-spin" aria-hidden /> : <RefreshCwIcon className="size-3" aria-hidden />}
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function ActivityRow({ item }: { item: ForgeReviewActivityItem }) {
  const activityLabel = item.event?.replaceAll("_", " ") ?? item.kind;
  const showActivityLabel = activityLabel.toLowerCase() !== item.kind.toLowerCase();
  const actorLabel = item.actor?.login ?? item.kind;
  return (
    <article className="flex min-w-0 items-start gap-2 rounded-lg border border-border/60 px-3 py-2">
      {item.kind === "commit" ? (
        <GitCommitIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <MessageCircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">
          {actorLabel}
          {showActivityLabel ? <span className="ml-1.5 font-normal capitalize text-muted-foreground">· {activityLabel}</span> : null}
        </div>
        {item.body ? <div className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.body}</div> : null}
        <div className="mt-0.5 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">{formatForgeReviewTimestamp(item.createdAt)}</div>
      </div>
      {item.commitSha ? <code className="shrink-0 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">{item.commitSha.slice(0, 7)}</code> : null}
    </article>
  );
}

function ThreadRow({ thread, input, expectedHeadSha }: { thread: ForgeReviewReviewThread; input: ForgeReviewDetailInput; expectedHeadSha?: string }) {
  const [comments, setComments] = useState(thread.comments);
  const [commentsNextCursor, setCommentsNextCursor] = useState(thread.commentsNextCursor);
  const [resolved, setResolved] = useState(thread.isResolved);
  useEffect(() => {
    setComments(thread.comments);
    setCommentsNextCursor(thread.commentsNextCursor);
    setResolved(thread.isResolved);
  }, [thread.comments, thread.commentsNextCursor, thread.id, thread.isResolved]);
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mutation = (operation: ForgeReviewMutationOperation, onConfirmed?: () => void) => {
    if (!expectedHeadSha) {
      setMessage("Refresh this review before changing the thread.");
      return;
    }
    const api = apiWithWorkflow();
    const mutationIdentity: ReviewMutationIdentity = { projectId: input.projectId, url: input.url, expectedHeadSha, operation };
    let commandId: string;
    try {
      commandId = getReviewMutationCommandId(mutationIdentity);
    } catch (reason: unknown) {
      setMessage(formatForgeReviewError(reason));
      return;
    }
    setPending(true);
    void api.mutate({ projectId: input.projectId, url: input.url, commandId, expectedHeadSha, operation })
      .then((result) => {
        const confirmed = result.receipt.state === "confirmed";
        setMessage(confirmed ? "Saved" : result.receipt.error?.message ?? result.receipt.state);
        if (confirmed) {
          try { completeReviewMutationCommand(mutationIdentity); } catch (reason: unknown) { setMessage(formatForgeReviewError(reason)); return; }
          onConfirmed?.();
        } else if (result.receipt.state === "failed") {
          try { completeReviewMutationCommand(mutationIdentity); } catch (reason: unknown) { setMessage(formatForgeReviewError(reason)); }
        }
      })
      .catch((error: unknown) => setMessage(formatForgeReviewError(error)))
      .finally(() => setPending(false));
  };
  const loadMoreComments = () => {
    if (!commentsNextCursor) return;
    const workflow = apiWithWorkflow().workflow;
    if (!workflow) return;
    void workflow({ ...input, section: "threads", threadId: thread.id, commentCursor: commentsNextCursor, limit: 50 }).then((result) => {
      const nextThread = result.threads?.items.find((item) => item.id === thread.id);
      if (!nextThread) return;
      setComments((current) => [...current, ...nextThread.comments.filter((comment) => !current.some((existing) => existing.id === comment.id))]);
      setCommentsNextCursor(nextThread.commentsNextCursor);
    });
  };
  const threadTitleId = `forge-review-thread-${thread.id}`;
  return (
    <article className="rounded-lg border border-border/70 p-3" aria-labelledby={threadTitleId}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={threadTitleId} className="text-xs font-medium">
            {comments[0]?.author?.login ?? "Review thread"}
          </h3>
          <p className="text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
            {thread.path ? `${thread.path}${thread.line ? `:${thread.line}` : ""}` : "General discussion"} · {resolved ? "Resolved" : "Open"}
          </p>
        </div>
        <Button
          size="xs"
          variant="ghost"
          disabled={pending || thread.viewerCanResolve === false || (resolved && thread.viewerCanUnresolve === false)}
          onClick={() => mutation({ kind: "resolve_thread", threadId: thread.id, resolved: !resolved }, () => setResolved((current) => !current))}
        >
          {resolved ? "Reopen" : "Resolve"}
        </Button>
      </header>
      <ol className="mt-2 divide-y divide-border/60" aria-label="Thread replies">
        {comments.map((comment) => <ThreadComment key={comment.id} comment={comment} />)}
      </ol>
      {commentsNextCursor ? <Button size="xs" variant="link" onClick={loadMoreComments}>Load more replies</Button> : null}
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const body = reply.trim();
          if (!body) return;
          mutation({ kind: "reply", commentId: comments[0]?.id ?? thread.id, body }, () => setReply(""));
        }}
      >
        <textarea
          aria-label={`Reply to thread ${thread.id}`}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          rows={1}
          placeholder="Reply…"
          className="min-h-8 min-w-0 flex-1 resize-y rounded-md border border-border/70 bg-background px-2 py-1 text-xs outline-none transition-colors focus-visible:border-ring/70 focus-visible:ring-1 focus-visible:ring-ring/60"
        />
        <Button type="submit" size="xs" disabled={pending || thread.viewerCanReply === false || !reply.trim()}>Reply</Button>
      </form>
      {message ? <div className="mt-1 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground" role="status" aria-live="polite">{message}</div> : null}
    </article>
  );
}

function ThreadComment({ comment }: { comment: ForgeReviewComment }) {
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-medium">{comment.author?.login ?? "Reviewer"}</span>
        <time className="text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground" dateTime={comment.createdAt}>
          {formatForgeReviewTimestamp(comment.createdAt)}
        </time>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{comment.body}</p>
    </li>
  );
}

export function ReviewInstructionPopover({ projectId, open, onOpenChange, anchor, onRun }: { projectId: ProjectId; open: boolean; onOpenChange: (open: boolean) => void; anchor?: Element | null; onRun?: (input: { instructions: string; examples: readonly string[]; model?: string }) => Promise<void> }) {
  const [text, setText] = useState("");
  const [examples, setExamples] = useState<readonly { readonly id: string; readonly text: string }[]>([]);
  const [revision, setRevision] = useState(0);
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const readSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const catalog = useProviderModelCatalog({ selectedProvider: "omp", discoveryEnabled: open, prefetchProviders: ["omp"] });
  const options = catalog.modelOptionsByProvider.omp;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (!open) {
      dirtyRef.current = false;
      return;
    }
    const requestSequence = ++readSequenceRef.current;
    dirtyRef.current = false;
    setStatus(null);
    void apiWithWorkflow().readInstructions(projectId).then((doc) => {
      if (!mountedRef.current || requestSequence !== readSequenceRef.current || dirtyRef.current) return;
      setText(doc.text);
      setExamples((doc.examples ?? []).map((value) => ({ id: newCommandId(), text: value })));
      setRevision(doc.revision);
    }).catch((error: unknown) => {
      if (mountedRef.current && requestSequence === readSequenceRef.current) setStatus(formatForgeReviewError(error));
    });
  }, [open, projectId]);
  const save = (run: boolean) => {
    setSaving(true);
    const saveText = text.trim();
    const savedExamples = examples.map((example) => example.text.trim()).filter(Boolean);
    const saveSequence = readSequenceRef.current;
    void apiWithWorkflow().writeInstructions({ projectId, text: saveText, examples: savedExamples, expectedRevision: revision })
      .then(async (doc) => {
        if (!mountedRef.current || saveSequence !== readSequenceRef.current) return;
        setRevision(doc.revision);
        if (text.trim() === saveText && examples.every((example, index) => (savedExamples[index] ?? "") === example.text.trim())) dirtyRef.current = false;
        if (run && onRun) { await onRun({ instructions: saveText, examples: savedExamples, ...(model ? { model } : {}) }); setStatus("Saved and started the OMP review."); } else setStatus(run ? "Saved. Run Review with OMP to apply these instructions to the current PR." : "Saved to this project.");
      })
      .catch((error: unknown) => { if (mountedRef.current && saveSequence === readSequenceRef.current) setStatus(formatForgeReviewError(error)); })
      .finally(() => { if (mountedRef.current && saveSequence === readSequenceRef.current) setSaving(false); });
  };
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverPopup anchor={anchor} side="bottom" align="end" className="w-[min(30rem,calc(100vw-2rem))] p-0">
      <ReviewInstructionForm
        text={text}
        examples={examples}
        model={model}
        options={options}
        status={status}
        saving={saving}
        onTextChange={(value) => { dirtyRef.current = true; setText(value); }}
        onAddExample={() => { dirtyRef.current = true; setExamples((current) => [...current, { id: newCommandId(), text: "" }]); }}
        onExampleChange={(id, value) => {
          dirtyRef.current = true;
          setExamples((current) => current.map((item) => item.id === id ? { ...item, text: value } : item));
        }}
        onRemoveExample={(id) => {
          dirtyRef.current = true;
          setExamples((current) => current.filter((item) => item.id !== id));
        }}
        onModelChange={setModel}
        onSave={save}
      />
    </PopoverPopup>
  </Popover>;
}

type ReviewInstructionExample = { readonly id: string; readonly text: string };

function ReviewInstructionForm({
  text,
  examples,
  model,
  options,
  status,
  saving,
  onTextChange,
  onAddExample,
  onExampleChange,
  onRemoveExample,
  onModelChange,
  onSave,
}: {
  text: string;
  examples: readonly ReviewInstructionExample[];
  model: string;
  options: readonly { readonly slug: string; readonly name: string }[];
  status: string | null;
  saving: boolean;
  onTextChange: (value: string) => void;
  onAddExample: () => void;
  onExampleChange: (id: string, value: string) => void;
  onRemoveExample: (id: string) => void;
  onModelChange: (value: string) => void;
  onSave: (run: boolean) => void;
}) {
  return (
    <div className="space-y-3 p-4">
      <div>
        <PopoverTitle className="text-sm">Tell OMP how to review your code</PopoverTitle>
        <p className="mt-1 text-xs text-muted-foreground">These instructions are saved per project and stay separate from the pull request.</p>
      </div>
      <textarea
        aria-label="Review instructions"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="For example: I care most about the data model. Tell me where we might be overcomplicating things."
        rows={5}
        className="w-full resize-y rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring/70 focus-visible:ring-1 focus-visible:ring-ring/60"
      />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs font-medium">
          <span>Examples</span>
          <Button size="xs" variant="outline" onClick={onAddExample}>Add example</Button>
        </div>
        {examples.map((example, index) => (
          <div key={example.id} className="flex items-start gap-2">
            <textarea
              aria-label={`Review example ${index + 1}`}
              value={example.text}
              onChange={(event) => onExampleChange(example.id, event.target.value)}
              rows={2}
              className="min-w-0 flex-1 resize-y rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs outline-none transition-colors focus-visible:border-ring/70 focus-visible:ring-1 focus-visible:ring-ring/60"
            />
            <Button size="icon-xs" variant="ghost" aria-label="Remove example" onClick={() => onRemoveExample(example.id)}>
              <XIcon className="size-3" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <span className="shrink-0 text-muted-foreground">OMP model</span>
        <select aria-label="Review model" value={model} onChange={(event) => onModelChange(event.target.value)} className="min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring/60">
          <option value="">Use current OMP model</option>
          {options.map((option) => <option key={option.slug} value={option.slug}>{option.name}</option>)}
        </select>
      </label>
      {status ? <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{status}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" disabled={saving} onClick={() => onSave(false)}>
          {saving ? <LoaderIcon className="size-3.5 animate-spin" aria-hidden /> : null}
          Save
        </Button>
        <Button size="sm" disabled={saving} onClick={() => onSave(true)}>
          {saving ? <LoaderIcon className="size-3.5 animate-spin" aria-hidden /> : <CheckIcon className="size-3.5" aria-hidden />}
          Save and run
        </Button>
      </div>
    </div>
  );
}

type ReviewMergeMethod = "merge" | "squash" | "rebase";

export function ReviewMutationDialog({ detail, input, operation, open, onOpenChange, onComplete, canReview = true, mergeMethods }: { detail: ForgeReviewDetail; input: ForgeReviewDetailInput; operation: ForgeReviewMutationOperation | null; open: boolean; onOpenChange: (open: boolean) => void; onComplete?: (result: ForgeReviewMutationResult) => void; canReview?: boolean; mergeMethods?: readonly ReviewMergeMethod[] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [mergeMethod, setMergeMethod] = useState<ReviewMergeMethod>("squash");
  const [reviewEvent, setReviewEvent] = useState<"COMMENT" | "APPROVE" | "REQUEST_CHANGES">("COMMENT");
  const availableMergeMethods = mergeMethods?.length ? mergeMethods : (["merge", "squash", "rebase"] as const);
  const targetRef = useRef<{ detail: ForgeReviewDetail; input: ForgeReviewDetailInput; expectedHeadSha: string } | null>(null);
  const activeRef = useRef(true);
  const currentTargetRef = useRef({ projectId: input.projectId, url: input.url, head: detail.snapshot.headSha ?? detail.refs.head?.sha ?? "" });
  currentTargetRef.current = { projectId: input.projectId, url: input.url, head: detail.snapshot.headSha ?? detail.refs.head?.sha ?? "" };
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
  const api = apiWithWorkflow();
  useEffect(() => {
    if (!open) { setError(null); setConfirmText(""); targetRef.current = null; return; }
    const target = targetRef.current ?? (targetRef.current = {
      detail,
      input,
      expectedHeadSha: detail.snapshot.headSha ?? detail.refs.head?.sha ?? "",
    });
    setBody(operation?.kind === "review" || operation?.kind === "issue_comment" || operation?.kind === "reply" ? operation.body ?? "" : operation?.kind === "edit" ? operation.body ?? "" : "");
    setTitle(operation?.kind === "edit" ? operation.title ?? target.detail.title : target.detail.title);
    setReviewers(operation?.kind === "reviewers" ? [...(operation.users ?? []), ...(operation.teams ?? []).map((team) => `team:${team}`)].join(", ") : "");
    setMergeMethod(operation?.kind === "merge" ? operation.method : "squash");
    setReviewEvent(operation?.kind === "review" ? operation.event : "COMMENT");
  }, [open, operation]);
  if (!operation) return null;
  const target = targetRef.current;
  const targetDetail = target?.detail ?? detail;
  const targetInput = target?.input ?? input;
  const expectedHeadSha = target?.expectedHeadSha ?? detail.snapshot.headSha ?? detail.refs.head?.sha ?? "";
  const requiresText = operation.kind === "merge" || operation.kind === "state" || operation.kind === "draft";
  const effectiveOperation: ForgeReviewMutationOperation = operation.kind === "review"
    ? { ...operation, event: reviewEvent, body: body.trim() || undefined }
    : operation.kind === "issue_comment" || operation.kind === "reply"
      ? { ...operation, body: body.trim() }
      : operation.kind === "edit"
        ? { ...operation, title: title.trim(), body: body.trim() }
        : operation.kind === "reviewers"
          ? (() => {
            const tokens = reviewers.split(",").map((item) => item.trim()).filter(Boolean);
            const users = tokens.filter((item) => !item.startsWith("-") && !item.startsWith("team:") );
            const teams = tokens.filter((item) => !item.startsWith("-") && item.startsWith("team:")).map((item) => item.replace(/^team:/iu, ""));
            const removeUsers = tokens.filter((item) => item.startsWith("-") && !item.startsWith("-team:")).map((item) => item.slice(1));
            const removeTeams = tokens.filter((item) => item.startsWith("-team:")).map((item) => item.replace(/^-team:/iu, ""));
            return { ...operation, users, teams, removeUsers, removeTeams };
          })()
          : operation.kind === "merge"
            ? { ...operation, method: mergeMethod }
            : operation;
  const confirm = () => {
    if (!expectedHeadSha) { setError("This review has no stable head SHA. Reload before changing it."); return; }
    const currentHeadSha = detail.snapshot.headSha ?? detail.refs.head?.sha ?? "";
    if (target && currentHeadSha && currentHeadSha !== target.expectedHeadSha) { setError("This review changed while the confirmation was open. Reload before sending it."); return; }
    if (target && (input.projectId !== target.input.projectId || input.url !== target.input.url)) { setError("This review changed while the confirmation was open. Reload before sending it."); return; }
    if (requiresText && confirmText.trim().toLowerCase() !== "confirm") { setError("Type confirm to authorize this remote change."); return; }
    setError(null);
    const needsReviewBody = effectiveOperation.kind === "issue_comment" || effectiveOperation.kind === "reply" || (effectiveOperation.kind === "review" && effectiveOperation.event !== "APPROVE");
    const hasInlineReviewContent = effectiveOperation.kind === "review" && Boolean(effectiveOperation.comments?.length);
    if (effectiveOperation.kind === "review" && effectiveOperation.event !== "COMMENT" && !canReview) { setError("Your provider permissions allow comments, but not approval or requested changes."); return; }
    if (needsReviewBody && !effectiveOperation.body && !hasInlineReviewContent) { setError("Add a review message or inline comment before confirming."); return; }
    if (effectiveOperation.kind === "edit" && !effectiveOperation.title) { setError("A pull request title is required."); return; }
    const mutationIdentity: ReviewMutationIdentity = { projectId: targetInput.projectId, url: targetInput.url, expectedHeadSha, operation: effectiveOperation };
    let commandId: string;
    try {
      commandId = getReviewMutationCommandId(mutationIdentity);
    } catch (reason: unknown) {
      setError(formatForgeReviewError(reason));
      return;
    }
    setPending(true);
    void api.mutate({ projectId: targetInput.projectId, url: targetInput.url, commandId, expectedHeadSha, operation: effectiveOperation })
      .then((result) => {
        if (result.receipt.state === "confirmed" || result.receipt.state === "failed") completeReviewMutationCommand(mutationIdentity);
        const current = currentTargetRef.current;
        if (!activeRef.current || current.projectId !== mutationIdentity.projectId || current.url !== mutationIdentity.url || current.head !== mutationIdentity.expectedHeadSha) return;
        onComplete?.(result);
        if (result.receipt.state === "confirmed") onOpenChange(false);
        else setError(result.receipt.error?.message ?? `The provider returned ${result.receipt.state}. Review the result before retrying.`);
      })
      .catch((reason: unknown) => { if (activeRef.current) setError(formatForgeReviewError(reason)); })
      .finally(() => { if (activeRef.current) setPending(false); });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm {operationLabel(effectiveOperation)}</DialogTitle>
          <DialogDescription>Check the pull request and branch before sending this action.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <MutationDialogFields
            targetDetail={targetDetail}
            expectedHeadSha={expectedHeadSha}
            effectiveOperation={effectiveOperation}
            canReview={canReview}
            body={body}
            title={title}
            reviewers={reviewers}
            mergeMethod={mergeMethod}
            availableMergeMethods={availableMergeMethods}
            confirmText={confirmText}
            error={error}
            requiresText={requiresText}
            onBodyChange={setBody}
            onTitleChange={setTitle}
            onReviewersChange={setReviewers}
            onMergeMethodChange={setMergeMethod}
            onReviewEventChange={setReviewEvent}
            onConfirmTextChange={setConfirmText}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pending} onClick={confirm}>
            {pending ? <LoaderIcon className="size-3.5 animate-spin" aria-hidden /> : <CheckIcon className="size-3.5" aria-hidden />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

function MutationDialogFields({
  targetDetail,
  expectedHeadSha,
  effectiveOperation,
  canReview,
  body,
  title,
  reviewers,
  mergeMethod,
  availableMergeMethods,
  confirmText,
  error,
  requiresText,
  onBodyChange,
  onTitleChange,
  onReviewersChange,
  onMergeMethodChange,
  onReviewEventChange,
  onConfirmTextChange,
}: {
  targetDetail: ForgeReviewDetail;
  expectedHeadSha: string;
  effectiveOperation: ForgeReviewMutationOperation;
  canReview: boolean;
  body: string;
  title: string;
  reviewers: string;
  mergeMethod: ReviewMergeMethod;
  availableMergeMethods: readonly ReviewMergeMethod[];
  confirmText: string;
  error: string | null;
  requiresText: boolean;
  onBodyChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onReviewersChange: (value: string) => void;
  onMergeMethodChange: (value: ReviewMergeMethod) => void;
  onReviewEventChange: (value: ReviewEvent) => void;
  onConfirmTextChange: (value: string) => void;
}) {
  const textFieldClassName = "mt-1 w-full resize-y rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs outline-none transition-colors focus-visible:border-ring/70 focus-visible:ring-1 focus-visible:ring-ring/60";
  const inputClassName = "mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs outline-none transition-colors focus-visible:border-ring/70 focus-visible:ring-1 focus-visible:ring-ring/60";
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-lg border border-border/70 bg-muted/25 p-3">
        <div className="font-medium">{targetDetail.title}</div>
        <div className="mt-1 text-muted-foreground">{targetDetail.repository.path} · #{targetDetail.ref.number}</div>
        <div className="mt-1 break-all font-mono text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">HEAD {expectedHeadSha || "unavailable"}</div>
      </div>
      <div className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-muted-foreground">
        This action updates the pull request at the HEAD shown above. If the branch moved, reload and review it again.
      </div>
      {effectiveOperation.kind === "review" ? (
        <>
          <label className="block">
            <span className="font-medium">Review decision</span>
            <select aria-label="Review decision" value={effectiveOperation.event} onChange={(event) => onReviewEventChange(event.target.value as ReviewEvent)} className={inputClassName}>
              <option value="COMMENT">Comment</option>
              <option value="APPROVE" disabled={!canReview}>Approve</option>
              <option value="REQUEST_CHANGES" disabled={!canReview}>Request changes</option>
            </select>
          </label>
          <label className="block">
            <span className="font-medium">Message</span>
            <textarea aria-label="Review message" value={body} onChange={(event) => onBodyChange(event.target.value)} rows={3} className={textFieldClassName} />
          </label>
        </>
      ) : null}
      {effectiveOperation.kind === "issue_comment" || effectiveOperation.kind === "reply" ? (
        <label className="block">
          <span className="font-medium">Message</span>
          <textarea aria-label="Review message" value={body} onChange={(event) => onBodyChange(event.target.value)} rows={3} className={textFieldClassName} />
        </label>
      ) : null}
      {effectiveOperation.kind === "edit" ? (
        <>
          <label className="block">
            <span className="font-medium">Title</span>
            <input aria-label="Pull request title" value={title} onChange={(event) => onTitleChange(event.target.value)} className={inputClassName} />
          </label>
          <label className="block">
            <span className="font-medium">Description</span>
            <textarea aria-label="Pull request description" value={body} onChange={(event) => onBodyChange(event.target.value)} rows={4} className={textFieldClassName} />
          </label>
        </>
      ) : null}
      {effectiveOperation.kind === "reviewers" ? (
        <label className="block">
          <span className="font-medium">Users or teams</span>
          <input aria-label="Reviewers" value={reviewers} onChange={(event) => onReviewersChange(event.target.value)} placeholder="alice, team:frontend, -bob, -team:backend to remove" className={inputClassName} />
        </label>
      ) : null}
      {effectiveOperation.kind === "merge" ? (
        <label className="block">
          <span className="font-medium">Merge method</span>
          <select aria-label="Merge method" value={mergeMethod} onChange={(event) => onMergeMethodChange(event.target.value as ReviewMergeMethod)} className={inputClassName}>
            {availableMergeMethods.map((method) => <option key={method} value={method}>{method === "merge" ? "Merge commit" : method === "squash" ? "Squash" : "Rebase"}</option>)}
          </select>
        </label>
      ) : null}
      {requiresText ? (
        <label className="block">
          <span className="font-medium">Type <code>confirm</code> to continue</span>
          <input aria-label="Type confirm" value={confirmText} onChange={(event) => onConfirmTextChange(event.target.value)} className={inputClassName} />
        </label>
      ) : null}
      {error ? <div role="alert" className="text-destructive">{error}</div> : null}
    </div>
  );
}

export function ReviewActionBar({ detail, input, overview, inlineComments = [], onChanged, onReviewSubmitted }: { detail: ForgeReviewDetail; input: ForgeReviewDetailInput; overview?: ForgeReviewWorkflowResult["overview"]; inlineComments?: readonly ForgeReviewInlineComment[]; onChanged?: () => void; onReviewSubmitted?: () => void }) {
  const permissions = reviewPermissions(overview);
  const canMarkReady = permissions.canChangeState && detail.state === "open" && detail.draft;
  const canChangeLifecycle = permissions.canChangeState && detail.state !== "merged";
  const [operation, setOperation] = useState<ForgeReviewMutationOperation | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [anchor, setAnchor] = useState<Element | null>(null);
  const omp = useForgeReviewOmp(detail, input);
  const ompStatus = omp.status;
  const queryClient = useQueryClient();
  const moreRef = useRef<HTMLDetailsElement>(null);
  const open = (next: ForgeReviewMutationOperation) => setOperation(next);
  const closeMore = () => { if (moreRef.current) moreRef.current.open = false; };
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["cedia", "forge-review"] }); onChanged?.(); };
  const runOmp = async (review: { instructions: string; examples: readonly string[]; model?: string }) => {
    await omp.run("review", "", review);
  };
  return <>
    <div className="flex min-w-0 items-center gap-1.5" data-testid="forge-review-actions">
      <Button size="sm" variant="outline" disabled={!permissions.canComment && !permissions.canReview} onClick={() => open({ kind: "review", event: "COMMENT", ...(inlineComments.length ? { comments: inlineComments } : {}) })}><MessageCircleIcon className="size-3.5" aria-hidden /> Review</Button>
      <Button size="sm" variant="outline" disabled={!canMarkReady} onClick={() => open({ kind: "draft", draft: false })}>Mark ready</Button>
      <Button size="icon-sm" variant="ghost" aria-label="Review instructions" ref={(node) => setAnchor(node)} onClick={() => setInstructionsOpen((current) => !current)}><SettingsIcon className="size-3.5" aria-hidden /></Button>
      <details ref={moreRef} className="relative">
        <summary className="flex h-7 cursor-pointer list-none items-center rounded-lg border border-transparent px-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground [&::-webkit-details-marker]:hidden">More</summary>
        <div className="absolute right-0 top-8 z-20 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-lg">
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50" disabled={!permissions.canComment} onClick={() => { closeMore(); open({ kind: "issue_comment", body: "" }); }}><MessageCircleIcon className="size-3.5" aria-hidden /> Comment</button>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50" disabled={!permissions.canEdit} onClick={() => { closeMore(); open({ kind: "edit", title: detail.title, body: detail.body ?? "" }); }}><PencilIcon className="size-3.5" aria-hidden /> Edit pull request</button>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50" disabled={!permissions.canRequestReviewers} onClick={() => { closeMore(); open({ kind: "reviewers" }); }}><UsersIcon className="size-3.5" aria-hidden /> Request reviewers</button>
          {detail.state === "open" && !detail.draft ? <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50" disabled={!permissions.canChangeState} onClick={() => { closeMore(); open({ kind: "draft", draft: true }); }}><GitPullRequestDraftIcon className="size-3.5" aria-hidden /> Convert to draft</button> : null}
          {detail.state !== "merged" ? <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canChangeLifecycle} onClick={() => { closeMore(); open({ kind: "state", state: detail.state === "closed" ? "open" : "closed" }); }}>{detail.state === "closed" ? "Reopen" : "Close"} pull request</button> : null}
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50" disabled={!permissions.canMerge || permissions.mergeMethods.length === 0} onClick={() => { closeMore(); open({ kind: "merge", method: permissions.mergeMethods[0] ?? "squash" }); }}><GitMergeIcon className="size-3.5" aria-hidden /> Merge pull request</button>
        </div>
      </details>
      <ReviewInstructionPopover projectId={input.projectId} open={instructionsOpen} onOpenChange={setInstructionsOpen} anchor={anchor} onRun={runOmp} />
    </div>
    {ompStatus ? <span className="max-w-48 truncate text-[10px] text-muted-foreground" role="status">{ompStatus}</span> : null}
    <ReviewMutationDialog detail={detail} input={input} operation={operation} open={operation !== null} canReview={permissions.canReview} mergeMethods={permissions.mergeMethods} onOpenChange={(value) => { if (!value) setOperation(null); }} onComplete={(result) => { if (result.receipt.state === "confirmed") { invalidate(); if (operation?.kind === "review") onReviewSubmitted?.(); } }} />
  </>;
}

export function ReviewPermissionsSummary({ permissions }: { permissions: ForgeReviewPermissions }) {
  return <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-xs"><div className="flex items-center gap-2 font-medium"><UsersIcon className="size-3.5 text-muted-foreground" aria-hidden /> Provider permissions</div><div className="mt-2 grid grid-cols-2 gap-1 text-muted-foreground"><span>{permissions.canComment ? "✓" : "—"} Comment</span><span>{permissions.canReview ? "✓" : "—"} Review</span><span>{permissions.canEdit ? "✓" : "—"} Edit PR</span><span>{permissions.canMerge ? "✓" : "—"} Merge</span></div>{permissions.reason ? <p className="mt-2 text-[10px]">{permissions.reason}</p> : null}</div>;
}

export type { ForgeReviewInlineComment };
