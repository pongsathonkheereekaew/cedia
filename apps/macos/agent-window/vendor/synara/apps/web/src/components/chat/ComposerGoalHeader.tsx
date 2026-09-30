// FILE: ComposerGoalHeader.tsx
// Purpose: Persistent thread-goal strip stacked flush onto the top of the composer,
// mirroring the live file-changes/queued headers. Collapsed it shows a one-line
// preview that fades out at the end plus the live pursuit timer; the chevron
// expands the full objective. Edit / pause-resume / delete act on the persisted goal.
// Layer: Chat composer UI
// Exports: ComposerGoalHeader, goalElapsedMs

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useNowMs } from "~/hooks/useNowMs";
import { GoalIcon, PauseOutlineIcon, PencilIcon, PlayOutlineIcon, TrashCanIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { formatClockDuration } from "../../session-logic";
import { dispatchThreadGoalBudget } from "../../threadGoal";
import type { ThreadId } from "@synara/contracts";
import { serverGoalDetailsQueryOptions, serverQueryKeys } from "../../lib/serverReactQuery";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { IconButton } from "../ui/icon-button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  ComposerStackedPanelRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import {
  COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
} from "./composerStackedPanelStyles";

/**
 * Elapsed pursuit time for a goal, or null when the thread predates goal timing
 * (no `goalStartedAt`). While paused the clock freezes at `goalPausedAt`; the
 * server rebases `goalStartedAt` on resume so the paused span never counts.
 */
export function goalElapsedMs(
  input: {
    readonly goalStartedAt?: string | null | undefined;
    readonly goalPausedAt?: string | null | undefined;
  },
  nowMs: number,
): number | null {
  const startedMs = Date.parse(input.goalStartedAt ?? "");
  if (!Number.isFinite(startedMs)) {
    return null;
  }
  const pausedMs = Date.parse(input.goalPausedAt ?? "");
  const endMs = Number.isFinite(pausedMs) ? pausedMs : nowMs;
  return Math.max(0, endMs - startedMs);
}

interface ComposerGoalHeaderProps {
  threadId: ThreadId;
  goal: string;
  goalStartedAt?: string | null | undefined;
  goalPausedAt?: string | null | undefined;
  onEdit: () => void;
  onSetPaused: (paused: boolean) => void | Promise<void>;
  onClear: () => void | Promise<void>;
  attachedToPrevious?: boolean;
  // False while the goal is only staged on a draft thread: pursuit has not
  // started, so pausing has nothing to act on and the control is hidden.
  canPause?: boolean;
}

export function ComposerGoalHeader({
  threadId,
  goal,
  goalStartedAt,
  goalPausedAt,
  onEdit,
  onSetPaused,
  onClear,
  attachedToPrevious: attachedToPreviousProp,
  canPause = true,
}: ComposerGoalHeaderProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const detailsQuery = useQuery(serverGoalDetailsQueryOptions(threadId, open));
  const budgetMutation = useMutation({
    mutationFn: (tokenBudget: number) => dispatchThreadGoalBudget(threadId, tokenBudget),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: serverQueryKeys.goalDetails(threadId) });
    },
  });
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const paused = (goalPausedAt ?? null) !== null;
  const nowMs = useNowMs(!paused && goalStartedAt != null);
  const elapsedMs = goalElapsedMs({ goalStartedAt, goalPausedAt }, nowMs);

  useEffect(() => {
    if (detailsQuery.data?.state === "available") {
      setBudgetInput(detailsQuery.data.tokenBudget === null ? "" : String(detailsQuery.data.tokenBudget));
    }
  }, [detailsQuery.data]);

  const saveBudget = () => {
    const tokenBudget = Number(budgetInput);
    if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) {
      setBudgetError("Enter a positive whole number of tokens.");
      return;
    }
    setBudgetError(null);
    budgetMutation.mutate(tokenBudget);
  };

  return (
    <ComposerStackedPanel
      attachedToPrevious={attachedToPrevious}
      data-testid="composer-goal-header"
    >
      <ComposerStackedPanelRow>
        <ComposerStackedPanelRowMain>
          <GoalIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
          <ComposerStackedPanelRowLabel className="shrink-0">
            {canPause ? (paused ? "Goal paused" : "Pursuing goal") : "Goal"}
          </ComposerStackedPanelRowLabel>
          {open ? null : (
            <span
              data-testid="composer-goal-preview"
              // Fade-out instead of an ellipsis so the preview reads as a peek
              // into the full objective behind the chevron.
              className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-muted-foreground/80 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]"
            >
              {goal}
            </span>
          )}
          {elapsedMs !== null ? (
            <span className="shrink-0 tabular-nums text-muted-foreground/80">
              {formatClockDuration(elapsedMs)}
            </span>
          ) : null}
        </ComposerStackedPanelRowMain>
        <div className="flex shrink-0 items-center gap-0">
          <IconButton variant="ghost" size="icon-chip" label="Edit goal" onClick={onEdit}>
            <PencilIcon />
          </IconButton>
          {canPause ? (
            <IconButton
              variant="ghost"
              size="icon-chip"
              label={paused ? "Resume goal" : "Pause goal"}
              onClick={() => void onSetPaused(!paused)}
            >
              {paused ? <PlayOutlineIcon /> : <PauseOutlineIcon />}
            </IconButton>
          ) : null}
          <IconButton
            variant="ghost"
            size="icon-chip"
            label="Delete goal"
            onClick={() => void onClear()}
          >
            <TrashCanIcon />
          </IconButton>
          <IconButton
            variant="ghost"
            size="icon-chip"
            label={open ? "Collapse goal" : "Expand goal"}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <DisclosureChevron open={open} />
          </IconButton>
        </div>
      </ComposerStackedPanelRow>
      <DisclosureRegion open={open}>
        <div
          className={cn(
            COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
            COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
          )}
        >
          <p className="whitespace-pre-wrap break-words text-[12px] text-muted-foreground/80">
            {goal}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 pt-2 text-[11px] text-muted-foreground" data-testid="composer-goal-details">
            {detailsQuery.isPending ? <span>Loading goal details…</span> : null}
            {detailsQuery.isError ? <span role="alert">{detailsQuery.error instanceof Error ? detailsQuery.error.message : "Goal details are unavailable."}</span> : null}
            {detailsQuery.data?.state === "unavailable" ? <span>{detailsQuery.data.reason}</span> : null}
            {detailsQuery.data?.state === "available" ? (
              <>
                <span>{detailsQuery.data.tokensUsed.toLocaleString()} tokens used</span>
                <span>{formatClockDuration(detailsQuery.data.timeUsedSeconds * 1000)} elapsed</span>
                <label className="flex items-center gap-1.5">
                  <span>Token budget</span>
                  <input
                    aria-label="Goal token budget"
                    className="h-6 w-24 rounded border border-border bg-background px-1.5 text-foreground"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    type="number"
                    value={budgetInput}
                    onChange={(event) => { setBudgetInput(event.currentTarget.value); setBudgetError(null); }}
                  />
                </label>
                <button
                  className="h-6 rounded border border-border px-2 text-foreground hover:bg-muted disabled:opacity-50"
                  disabled={budgetMutation.isPending || budgetInput.trim().length === 0 || Number(budgetInput) === detailsQuery.data.tokenBudget}
                  onClick={saveBudget}
                  type="button"
                >
                  {budgetMutation.isPending ? "Saving…" : "Set budget"}
                </button>
                {budgetError || budgetMutation.error ? (
                  <span role="alert">{budgetError ?? (budgetMutation.error instanceof Error ? budgetMutation.error.message : "Could not update goal budget.")}</span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </DisclosureRegion>
    </ComposerStackedPanel>
  );
}
