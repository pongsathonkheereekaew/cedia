import { useEffect, useRef, useState, type SetStateAction } from "react";

import type { ForgeReviewInlineComment } from "../../../../../../../../../../packages/protocol/src/forge-review-workflow.ts";
import { Button } from "~/components/ui/button";
import { CheckIcon, LoaderIcon, MessageCircleIcon, XIcon } from "~/lib/icons";
import { getForgeReviewApi, type ForgeReviewInlineDraftInput } from "~/lib/forgeReview";

export type InlineReviewDraft = ForgeReviewInlineComment;

export function CodeReviewInlineDrafts({ comments, onChange, saveState = "idle" }: { comments: readonly InlineReviewDraft[]; onChange: (comments: readonly InlineReviewDraft[]) => void; saveState?: "idle" | "saving" | "saved" | "conflict" }) {
  if (comments.length === 0) return null;
  return <section className="border-t border-border/70 px-6 py-4" aria-label="Inline review drafts">
    <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-1.5 text-sm font-semibold"><MessageCircleIcon className="size-3.5 text-muted-foreground" aria-hidden /> Inline comments</h2><span className="text-[10px] text-muted-foreground">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved to Cedia" : saveState === "conflict" ? "Needs reload" : `${comments.length} draft${comments.length === 1 ? "" : "s"}`}</span></div>
    <div className="mt-3 space-y-2">{comments.map((comment, index) => <InlineDraftRow key={`${comment.path}:${comment.line}:${comment.side}:${index}`} comment={comment} onChange={(next) => onChange(comments.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => onChange(comments.filter((_, itemIndex) => itemIndex !== index))} />)}</div>
  </section>;
}

function InlineDraftRow({ comment, onChange, onRemove }: { comment: InlineReviewDraft; onChange: (comment: InlineReviewDraft) => void; onRemove: () => void }) {
  return <div className="rounded-lg border border-border/70 bg-background p-3"><div className="flex items-center justify-between gap-2"><code className="min-w-0 truncate text-[10px] text-muted-foreground">{comment.path}:{comment.line} · {comment.side === "RIGHT" ? "new" : "old"}</code><Button size="icon-xs" variant="ghost" aria-label="Remove inline draft" onClick={onRemove}><XIcon className="size-3" aria-hidden /></Button></div><textarea aria-label={`Inline comment ${comment.path}:${comment.line}`} value={comment.body} onChange={(event) => onChange({ ...comment, body: event.target.value })} rows={2} className="mt-2 w-full resize-y rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring/60" /></div>;
}

export function useInlineDraftState(identity: string | null, remoteInput?: ForgeReviewInlineDraftInput) {
  const [comments, setComments] = useState<readonly InlineReviewDraft[]>([]);
  const [revision, setRevision] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "conflict">("idle");
  const commentsRef = useRef<readonly InlineReviewDraft[]>(comments);
  const revisionRef = useRef(revision);
  const writeSequenceRef = useRef(0);
  const identityRef = useRef(identity);
  const remoteInputRef = useRef(remoteInput);
  identityRef.current = identity;
  remoteInputRef.current = remoteInput;
  commentsRef.current = comments;
  revisionRef.current = revision;
  useEffect(() => {
    const readSequence = ++writeSequenceRef.current;
    if (!identity || typeof window === "undefined") { commentsRef.current = []; setComments([]); return; }
    try {
      const parsed = JSON.parse(window.localStorage.getItem(`cedia:forge-review-inline:${identity}`) ?? "[]") as unknown;
      const localComments = Array.isArray(parsed) ? parsed.filter((item): item is InlineReviewDraft => typeof item === "object" && item !== null && typeof (item as { path?: unknown }).path === "string" && typeof (item as { line?: unknown }).line === "number" && typeof (item as { body?: unknown }).body === "string" && ((item as { side?: unknown }).side === "LEFT" || (item as { side?: unknown }).side === "RIGHT")) : [];
      commentsRef.current = localComments;
      setComments(localComments);
    } catch { setComments([]); }
    const remote = remoteInputRef.current;
    if (!remote) return;
    void getForgeReviewApi().inlineDrafts.read(remote).then((draft) => {
      if (identityRef.current !== identity || writeSequenceRef.current !== readSequence) return;
      commentsRef.current = draft.comments;
      revisionRef.current = draft.revision;
      setComments(draft.comments);
      setRevision(draft.revision);
      setSaveState(draft.comments.length ? "saved" : "idle");
    }).catch(() => undefined);
  }, [identity]);
  const update = (nextValue: SetStateAction<readonly InlineReviewDraft[]>) => {
    const next = typeof nextValue === "function" ? nextValue(commentsRef.current) : nextValue;
    const writeSequence = ++writeSequenceRef.current;
    commentsRef.current = next;
    setComments(next);
    if (identity && typeof window !== "undefined") window.localStorage.setItem(`cedia:forge-review-inline:${identity}`, JSON.stringify(next));
    const remote = remoteInputRef.current;
    if (!remote) return;
    setSaveState("saving");
    const expectedRevision = revisionRef.current;
    void getForgeReviewApi().inlineDrafts.write({ ...remote, comments: next, expectedRevision }).then((draft) => {
      if (writeSequenceRef.current !== writeSequence) return;
      revisionRef.current = draft.revision;
      setRevision(draft.revision);
      setSaveState("saved");
    }).catch(() => {
      if (writeSequenceRef.current === writeSequence) setSaveState("conflict");
    });
  };
  return [comments, update, saveState] as const;
}

export function InlineDraftStatus({ state }: { state: "idle" | "saving" | "saved" | "conflict" }) {
  if (state === "idle") return null;
  return <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">{state === "saving" ? <LoaderIcon className="size-3 animate-spin" aria-hidden /> : <CheckIcon className="size-3" aria-hidden />}{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Reload required"}</span>;
}
