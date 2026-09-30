// FILE: CediaPlanSurface.tsx
// Purpose: Native Cedia plan-mode controls and host-owned plan review actions.
// Layer: Chat composer UI
// The host is the only owner of plan state. This component only renders the typed answer and
// forwards actions through the cedia native namespace; it never treats a refused operation as
// successful.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { ListTodoIcon, ZapIcon } from "~/lib/icons";
import { newCommandId, cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverPlanMutationOptions,
  serverPlanQueryOptions,
  type CediaPlanAnswer,
  type CediaPlanReview,
} from "../../lib/serverReactQuery";

export type CediaPlanDecision = "approve" | "refine" | "cancel";

function planFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "The host refused the plan operation.";
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? `${error.message} (${code})` : error.message;
}

export interface CediaPlanModePanelProps {
  readonly state: CediaPlanAnswer | null;
  readonly busy: boolean;
  readonly onPlanToggle: () => void;
  readonly onVibeToggle: () => void;
  readonly onPlanConfirmExit?: () => void;
}

/** The compact mode row. Unavailable state intentionally has no toggle affordance. */
export function CediaPlanModePanel({
  state,
  busy,
  onPlanToggle,
  onVibeToggle,
  onPlanConfirmExit,
}: CediaPlanModePanelProps) {
  if (state?.state === "unavailable") {
    // Plain rows inside the outer ComposerStackedPanel: an inner bordered card
    // here double-frames the panel (the Progress/Advisor unavailable states
    // already render this way).
    return (
      <div aria-label="Cedia plan mode" data-testid="cedia-plan-mode-panel">
        <p className="text-[12px] font-medium text-foreground/85">Plan mode unavailable</p>
        <p className="mt-1 min-w-0 break-words text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <section
        aria-label="Cedia plan mode"
        data-testid="cedia-plan-mode-panel"
        className="rounded-lg border border-border/70 bg-background/50 px-3 py-2"
      >
        <p className="text-[12px] text-muted-foreground">Reading plan mode…</p>
      </section>
    );
  }

  const planEnabled = state.plan?.enabled === true;
  const planPaused = state.plan?.paused === true;
  const vibeStartBlocked = (planEnabled || planPaused) && !state.vibe.enabled;
  return (
    <section
      aria-label="Cedia plan mode"
      data-testid="cedia-plan-mode-panel"
      className="rounded-lg border border-border/70 bg-background/50 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <ListTodoIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12px] font-medium text-foreground/85">Plan mode</span>
          <span className="text-[11px] text-muted-foreground">
            {planPaused ? "Paused" : planEnabled ? "On" : "Off"}
          </span>
          {state.plan?.planFilePath ? (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={state.plan.planFilePath}>
              · {planFileName(state.plan.planFilePath)}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={onPlanToggle}
            aria-label={planPaused ? "Exit plan mode" : planEnabled ? "Exit plan mode" : "Enter plan mode"}
          >
            {planPaused ? "Exit plan mode" : planEnabled ? "Exit plan mode" : "Enter plan mode"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy || vibeStartBlocked}
            onClick={onVibeToggle}
            aria-label={
              vibeStartBlocked
                ? "Vibe mode unavailable: Exit plan mode first."
                : state.vibe.enabled
                  ? "Turn vibe mode off"
                  : "Turn vibe mode on"
            }
            title={vibeStartBlocked ? "Exit plan mode first." : undefined}
          >
            <ZapIcon className="size-3" />
            Vibe {state.vibe.enabled ? "on" : "off"}
          </Button>
        </div>
      </div>
      {state.plan ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {planPaused
            ? "Plan mode is paused"
            : `${state.plan.workflow} workflow${state.plan.reentry ? " · re-entry enabled" : ""}`}
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">No plan file is active.</p>
      )}
      {onPlanConfirmExit ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="mt-1"
          disabled={busy}
          onClick={onPlanConfirmExit}
        >
          Exit and discard unapproved plan
        </Button>
      ) : null}
    </section>
  );
}

export interface CediaPlanReviewPanelProps {
  readonly review: CediaPlanReview;
  readonly busy: boolean;
  readonly feedback: string;
  readonly onFeedbackChange: (feedback: string) => void;
  readonly onDecision: (
    decision: CediaPlanDecision,
    options?: { readonly feedback?: string; readonly preserveContext?: boolean; readonly compactBeforeExecute?: boolean },
  ) => void;
}

/** Host-owned review content and the one-decision action row. */
export function CediaPlanReviewPanel({
  review,
  busy,
  feedback,
  onFeedbackChange,
  onDecision,
}: CediaPlanReviewPanelProps) {
  return (
    <section
      aria-label="Plan review"
      aria-busy={busy}
      data-testid="cedia-plan-review-panel"
      className="rounded-lg border border-border/70 bg-background/70 px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/90">{review.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{planFileName(review.planFilePath)}</p>
        </div>
        <span className="shrink-0 text-[11px] font-medium text-foreground/65">Review</span>
      </div>
      {review.truncated ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          This review shows a bounded copy of the plan.
        </p>
      ) : null}
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 p-2 text-[11px] leading-relaxed text-foreground/80">
        {review.planContent}
      </pre>
      <Textarea
        aria-label="Plan refinement feedback"
        className="mt-2 min-h-16 resize-y text-[12px]"
        value={feedback}
        onChange={(event) => onFeedbackChange(event.target.value)}
        placeholder="Optional feedback for refining the plan"
        disabled={busy}
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button type="button" size="xs" disabled={busy} onClick={() => onDecision("approve")}>
          Approve and execute
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          disabled={busy}
          onClick={() => onDecision("approve", { preserveContext: true, compactBeforeExecute: true })}
        >
          Approve and compact context
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy || feedback.trim().length === 0}
          onClick={() => onDecision("refine", { feedback: feedback.trim() })}
        >
          Refine plan
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => onDecision("cancel")}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

export function CediaPlanSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const planQuery = useQuery(serverPlanQueryOptions(sessionId, sessionId.length > 0));
  const mutation = useMutation(serverPlanMutationOptions({ sessionId, queryClient }));
  const [feedback, setFeedback] = useState("");
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [exitNeedsConfirm, setExitNeedsConfirm] = useState(false);
  const decisionReviewIdRef = useRef<number | null>(null);

  const dispatch = useCallback(
    async (input: {
      readonly op: "enter" | "exit" | "vibe.enter" | "vibe.exit" | "review.decide";
      readonly reviewId?: number;
      readonly decision?: CediaPlanDecision;
      readonly confirm?: boolean;
      readonly preserveContext?: boolean;
      readonly compactBeforeExecute?: boolean;
      readonly feedback?: string;
    }) => {
      if (input.op === "review.decide") {
        if (input.reviewId === undefined || decisionReviewIdRef.current === input.reviewId) return;
        decisionReviewIdRef.current = input.reviewId;
      }
      setDispatchError(null);
      setExitNeedsConfirm(false);
      try {
        await mutation.mutateAsync({ commandId: newCommandId(), ...input });
        if (input.op === "review.decide") setFeedback("");
      } catch (error) {
        setDispatchError(errorMessage(error));
        if (input.op === "exit") setExitNeedsConfirm(true);
      } finally {
        if (input.op === "review.decide" && decisionReviewIdRef.current === input.reviewId) {
          decisionReviewIdRef.current = null;
        }
      }
    },
    [mutation],
  );

  const available = planQuery.data?.state === "available" ? planQuery.data : null;
  const review = available?.review ?? null;
  const reviewBusy = review !== null && decisionReviewIdRef.current === review.reviewId && mutation.isPending;
  const busy = mutation.isPending;

  return (
    <ComposerStackedPanel data-testid="cedia-plan-surface" className={cn("space-y-2 px-2.5 py-2")}>
      <CediaPlanModePanel
        state={planQuery.data ?? null}
        busy={busy}
        onPlanToggle={() => {
          void dispatch({ op: available?.plan?.enabled || available?.plan?.paused ? "exit" : "enter" });
        }}
        onVibeToggle={() => {
          if ((available?.plan?.enabled || available?.plan?.paused) && !available.vibe.enabled) return;
          void dispatch({ op: available?.vibe.enabled ? "vibe.exit" : "vibe.enter" });
        }}
        onPlanConfirmExit={
          exitNeedsConfirm && (available?.plan?.enabled === true || available?.plan?.paused === true)
            ? () => {
                void dispatch({ op: "exit", confirm: true });
              }
            : undefined
        }
      />
      {review ? (
        <CediaPlanReviewPanel
          review={review}
          busy={reviewBusy}
          feedback={feedback}
          onFeedbackChange={setFeedback}
          onDecision={(decision, options) => {
            if (decision === "refine" && !options?.feedback?.trim()) return;
            void dispatch({
              op: "review.decide",
              reviewId: review.reviewId,
              decision,
              ...(decision === "refine" ? { feedback: options?.feedback?.trim() } : {}),
              ...(decision === "approve" ? {
                ...(options?.preserveContext === undefined ? {} : { preserveContext: options.preserveContext }),
                ...(options?.compactBeforeExecute === undefined ? {} : { compactBeforeExecute: options.compactBeforeExecute }),
              } : {}),
            });
          }}
        />
      ) : null}
      {planQuery.isError || dispatchError ? (
        <p role="alert" className="px-1 text-[11px] leading-relaxed text-destructive">
          {dispatchError ?? errorMessage(planQuery.error)}
        </p>
      ) : null}
    </ComposerStackedPanel>
  );
}
