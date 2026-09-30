// FILE: CediaBtwSurface.tsx
// Purpose: Ask an ephemeral side question against the session context and promote the
//          answer into a branched session. The answer never touches the transcript;
//          branching forks the session file through the session's own branch path and
//          the host adopts it so the transcript follows where the conversation goes.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { CircleQuestionIcon } from "~/lib/icons";
import { newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverBtwAskMutationOptions,
  serverBtwBranchMutationOptions,
  serverBtwQueryOptions,
  type CediaBtwAnswer,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "The Cedia side-question runtime is unavailable.";
  }
  return error.message;
}

export interface CediaBtwPanelProps {
  readonly state: CediaBtwAnswer | null;
  readonly question?: string;
  readonly asking?: boolean;
  readonly branching?: boolean;
  readonly askError?: string | null;
  readonly branchError?: string | null;
  readonly branchedFile?: string | null;
  readonly onQuestionChange?: (question: string) => void;
  readonly onAsk?: () => void;
  readonly onBranch?: () => void;
  readonly onCopyAnswer?: () => void;
  readonly copied?: boolean;
}

/** Pure side-question rendering used by the hook-backed surface and renderer tests. */
export function CediaBtwPanel({
  state,
  question = "",
  asking = false,
  branching = false,
  askError = null,
  branchError = null,
  branchedFile = null,
  onQuestionChange,
  onAsk,
  onBranch,
  onCopyAnswer,
  copied = false,
}: CediaBtwPanelProps) {
  const busy = asking || branching;
  const answer = state?.available === true ? state : null;
  return (
    <ComposerStackedPanel
      data-testid="cedia-btw-surface"
      aria-label="Side question"
      className="space-y-2 px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <CircleQuestionIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground/85">Side question</span>
        <span className="text-[10px] text-muted-foreground">
          answered without touching the transcript
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <input
          type="text"
          value={question}
          disabled={busy}
          onChange={(event) => onQuestionChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onAsk?.();
          }}
          placeholder="Ask about this session…"
          aria-label="Side question"
          className="min-w-0 flex-1 rounded-md border border-border/60 bg-background/50 px-2 py-1.5 text-[11px] text-foreground/85 outline-none placeholder:text-muted-foreground/70"
        />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy || question.trim().length === 0}
          onClick={() => onAsk?.()}
          aria-label="Ask side question"
        >
          {asking ? "Asking…" : "Ask"}
        </Button>
      </div>

      {askError ? (
        <p role="alert" className="text-[11px] leading-relaxed text-destructive">{askError}</p>
      ) : null}

      {answer && answer.state !== "idle" ? (
        <div aria-label="Side answer" className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
          {answer.question !== null ? (
            <p className="text-[11px] font-medium text-foreground/85">
              {answer.question}
              {answer.questionTruncated ? " · question truncated" : ""}
            </p>
          ) : null}
          {answer.state === "ready" && answer.answer !== null ? (
            <>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground/85">
                {answer.answer}
              </p>
              {answer.answerTruncated ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">Answer truncated</p>
              ) : null}
              <div className="mt-1 flex shrink-0 items-center gap-1.5">
                {answer.branchable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() => onBranch?.()}
                    aria-label="Branch side answer into a new session"
                    title="Fork the session at this answer and continue there"
                  >
                    {branching ? "Branching…" : "Branch"}
                  </Button>
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    {answer.branchUnavailableReason ?? "Branch unavailable"}
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onCopyAnswer?.()}
                  aria-label="Copy side answer"
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </>
          ) : answer.state === "failed" ? (
            <p role="alert" className="mt-0.5 text-[11px] leading-relaxed text-destructive">
              {answer.reason ?? "The side question failed."}
            </p>
          ) : null}
        </div>
      ) : null}

      {branchedFile ? (
        <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">
          Branched — the conversation continues in the forked session.
        </p>
      ) : null}
      {branchError ? (
        <p role="alert" className="text-[11px] leading-relaxed text-destructive">{branchError}</p>
      ) : null}
    </ComposerStackedPanel>
  );
}

export function CediaBtwSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const btwQuery = useQuery(serverBtwQueryOptions(sessionId, sessionId.length > 0));
  const askMutation = useMutation(serverBtwAskMutationOptions({ sessionId, queryClient }));
  const branchMutation = useMutation(serverBtwBranchMutationOptions({ sessionId, queryClient }));
  const [question, setQuestion] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchedFile, setBranchedFile] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onAsk = useCallback(async () => {
    if (askMutation.isPending || branchMutation.isPending || question.trim().length === 0) return;
    setAskError(null);
    setBranchError(null);
    setBranchedFile(null);
    setCopied(false);
    try {
      await askMutation.mutateAsync({ commandId: newCommandId(), question: question.trim() });
    } catch (error) {
      setAskError(errorMessage(error));
    }
  }, [askMutation, branchMutation.isPending, question]);

  const onBranch = useCallback(async () => {
    if (askMutation.isPending || branchMutation.isPending) return;
    setBranchError(null);
    try {
      const answer = await branchMutation.mutateAsync({ commandId: newCommandId() });
      setBranchedFile(answer.sessionFile);
      setQuestion("");
    } catch (error) {
      setBranchError(errorMessage(error));
    }
  }, [askMutation.isPending, branchMutation]);

  const onCopyAnswer = useCallback(async () => {
    const data = btwQuery.data;
    const text = data?.available === true && data.state === "ready" ? data.answer : null;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [btwQuery.data]);

  const state = btwQuery.data ?? (btwQuery.isError
    ? { available: false as const, reason: errorMessage(btwQuery.error) }
    : null);
  // The ask answers the answering state at once; the held answer lands later and the
  // query above polls while it runs. The panel stays in its asking shape until then.
  const answering = askMutation.isPending || state?.available === true && state.state === "answering";
  return (
    <CediaBtwPanel
      state={state}
      question={question}
      asking={answering}
      branching={branchMutation.isPending}
      askError={askError}
      branchError={branchError}
      branchedFile={branchedFile}
      onQuestionChange={setQuestion}
      onAsk={() => void onAsk()}
      onBranch={() => void onBranch()}
      onCopyAnswer={() => void onCopyAnswer()}
      copied={copied}
    />
  );
}
