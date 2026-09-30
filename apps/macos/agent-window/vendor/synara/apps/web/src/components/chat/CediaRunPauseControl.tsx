// FILE: CediaRunPauseControl.tsx
// Purpose: Pause and resume the process run-pause gate beside Stop, with a Paused badge.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { PauseOutlineIcon, PlayOutlineIcon } from "~/lib/icons";
import { newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  serverPauseMutationOptions,
  serverPauseQueryOptions,
  type CediaPauseAnswer,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "The Cedia run pause runtime is unavailable.";
  }
  return error.message;
}

export interface RunPauseButtonsProps {
  readonly paused: boolean;
  readonly busy?: boolean;
  readonly onPause?: () => void;
  readonly onResume?: () => void;
}

/** Pure pause rendering used by the hook-backed control and renderer tests. */
export function RunPauseButtons({
  paused,
  busy = false,
  onPause,
  onResume,
}: RunPauseButtonsProps) {
  if (paused) {
    return (
      <span
        data-testid="run-pause-control"
        className="flex shrink-0 items-center gap-1.5"
      >
        <span className="text-[11px] text-muted-foreground">Paused</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => onResume?.()}
          aria-label="Resume run"
        >
          <PlayOutlineIcon className="size-3.5" />
          Resume
        </Button>
      </span>
    );
  }
  return (
    <span data-testid="run-pause-control" className="contents">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={busy}
        onClick={() => onPause?.()}
        aria-label="Pause run"
        title="Freeze the run where it stands without aborting it. Resume continues from the same point."
      >
        <PauseOutlineIcon className="size-3.5" />
        Pause
      </Button>
    </span>
  );
}

function pauseState(answer: CediaPauseAnswer | null | undefined): boolean {
  return answer?.state === "available" ? answer.paused : false;
}

export function CediaRunPauseControl({
  sessionId,
  running,
}: {
  readonly sessionId: string;
  readonly running: boolean;
}) {
  const queryClient = useQueryClient();
  const pauseQuery = useQuery(serverPauseQueryOptions(sessionId, sessionId.length > 0));
  const mutation = useMutation(serverPauseMutationOptions({ sessionId, queryClient }));
  const [pauseError, setPauseError] = useState<string | null>(null);

  const act = useCallback(async (next: boolean) => {
    if (mutation.isPending) return;
    setPauseError(null);
    try {
      await mutation.mutateAsync({ commandId: newCommandId(), paused: next });
    } catch (error) {
      setPauseError(errorMessage(error));
    }
  }, [mutation]);

  // An unavailable gate hides the control rather than faking one; Stop still interrupts.
  // A paused gate keeps its Resume visible even with no turn running: aborting a parked run
  // completes the turn while the gate stays engaged.
  const paused = pauseState(pauseQuery.data ?? null);
  if (!running && !paused && !mutation.isPending) return null;
  if (pauseQuery.data?.state === "unavailable") return null;
  return (
    <>
      <RunPauseButtons
        paused={paused}
        busy={mutation.isPending}
        onPause={() => void act(true)}
        onResume={() => void act(false)}
      />
      {pauseError ? (
        <span role="alert" className="shrink-0 text-[11px] leading-relaxed text-destructive">{pauseError}</span>
      ) : null}
    </>
  );
}
