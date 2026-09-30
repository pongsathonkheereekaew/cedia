// FILE: LoopModeChip.tsx
// Purpose: Show the terminal owner's loop mode beside the composer model controls and
//          let the owner turn it off: while enabled the next prompt re-submits after
//          every yield. Enabling stays on the typed `/loop` prompt path; this surface
//          reads the state and carries only the disable half. Renders nothing unless
//          loop mode is on.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  serverLoopMutationOptions,
  serverLoopQueryOptions,
  type CediaLoopAnswer,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "The Cedia loop mode runtime is unavailable.";
  }
  return error.message;
}

export interface LoopModeChipProps {
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly limit: string | null;
  readonly busy?: boolean;
  readonly onDisable?: () => void;
}

/** Pure loop rendering used by the hook-backed chip and renderer tests. */
export function LoopModeChipView({ enabled, paused, limit, busy = false, onDisable }: LoopModeChipProps) {
  if (!enabled) return null;
  const detail = [paused ? "paused" : null, limit].filter((part): part is string => part !== null).join(" · ");
  return (
    <span
      data-testid="cedia-loop-chip"
      className="flex shrink-0 items-center gap-1.5"
      title="Loop mode on: the next prompt re-submits after every yield. Type /loop with bounds to change it."
    >
      <span className="truncate text-[11px] text-muted-foreground">
        loop · on{detail.length > 0 ? ` (${detail})` : ""}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={busy}
        onClick={() => onDisable?.()}
        aria-label="Disable loop mode"
      >
        Disable
      </Button>
    </span>
  );
}

function loopProps(answer: CediaLoopAnswer | null | undefined): LoopModeChipProps | null {
  if (!answer || answer.state !== "available" || !answer.enabled) return null;
  return { enabled: true, paused: answer.paused, limit: answer.limit };
}

export function LoopModeChip({ sessionId }: { readonly sessionId: string | undefined }) {
  const queryClient = useQueryClient();
  const loopQuery = useQuery(serverLoopQueryOptions(sessionId ?? "", Boolean(sessionId)));
  const mutation = useMutation(serverLoopMutationOptions({ sessionId: sessionId ?? "", queryClient }));
  const [loopError, setLoopError] = useState<string | null>(null);

  const disable = useCallback(async () => {
    if (mutation.isPending) return;
    setLoopError(null);
    try {
      await mutation.mutateAsync({ commandId: newCommandId() });
    } catch (error) {
      setLoopError(errorMessage(error));
    }
  }, [mutation]);

  const props = loopProps(loopQuery.data ?? null);
  if (!props && !mutation.isPending) return null;
  if (!props) return null;
  return (
    <>
      <LoopModeChipView
        enabled={props.enabled}
        paused={props.paused}
        limit={props.limit}
        busy={mutation.isPending}
        onDisable={() => void disable()}
      />
      {loopError ? (
        <span role="alert" className="shrink-0 text-[11px] leading-relaxed text-destructive">{loopError}</span>
      ) : null}
    </>
  );
}
