// FILE: CediaQueueSurface.tsx
// Purpose: Show and remove OMP's own steering and follow-up queue above the composer.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { ListChecksIcon } from "~/lib/icons";
import { newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverQueueMutationOptions,
  serverQueueQueryOptions,
  type CediaQueueAnswer,
  type CediaQueueEntry,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "The Cedia queue runtime is unavailable.";
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0
    ? `${error.message} (${code})`
    : error.message;
}

function imageLabel(images: number): string | null {
  if (images <= 0) return null;
  return `${images} image${images === 1 ? "" : "s"}`;
}

function QueueEntry({ entry, index }: { readonly entry: CediaQueueEntry; readonly index: number }) {
  return (
    <li
      data-queue-index={index}
      className="rounded-md border border-border/60 bg-background/50 px-2 py-1.5"
    >
      <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground/85">{entry.text}</p>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
        {entry.truncated ? <span>Text truncated</span> : null}
        {imageLabel(entry.images) ? <span>{imageLabel(entry.images)}</span> : null}
      </div>
    </li>
  );
}

function QueueGroup({ label, entries }: { readonly label: string; readonly entries: readonly CediaQueueEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-label={label}>
      <p className="mb-1 text-[11px] font-medium text-foreground/75">{label}</p>
      <ul className="max-h-32 space-y-1 overflow-auto pr-1">
        {entries.map((entry, index) => <QueueEntry key={`${label}-${index}`} entry={entry} index={index} />)}
      </ul>
    </section>
  );
}

export interface CediaQueuePanelProps {
  readonly state: CediaQueueAnswer | null;
  readonly dropped?: readonly CediaQueueEntry[] | null;
  readonly dropError?: string | null;
  readonly busy?: boolean;
  readonly onDrop?: (mode: "last" | "all") => void;
}

/** Pure queue rendering used by the hook-backed surface and renderer tests. */
export function CediaQueuePanel({
  state,
  dropped,
  dropError = null,
  busy = false,
  onDrop,
}: CediaQueuePanelProps) {
  if (state?.state === "unavailable") {
    return (
      <ComposerStackedPanel
        data-testid="cedia-queue-surface"
        aria-label="Cedia queue"
        className="px-2.5 py-2"
      >
        <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
      </ComposerStackedPanel>
    );
  }

  if (!state) return null;

  const hasQueuedEntries = state.steering.length > 0 || state.followUp.length > 0;
  const droppedRows = dropped === undefined ? state.dropped ?? null : dropped;
  return (
    <ComposerStackedPanel
      data-testid="cedia-queue-surface"
      aria-label="Cedia queue"
      className="space-y-2 px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <ListChecksIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12px] font-medium text-foreground/85">Queue</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => onDrop?.("last")}
            aria-label="Drop last queued submission"
          >
            Drop last
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => onDrop?.("all")}
            aria-label="Drop all queued submissions"
          >
            Drop all
          </Button>
        </div>
      </div>

      {hasQueuedEntries ? (
        <div className="space-y-2">
          <QueueGroup label="Steering" entries={state.steering} />
          <QueueGroup label="Follow-up" entries={state.followUp} />
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">Nothing queued</p>
      )}

      {droppedRows !== null ? (
        <section aria-label="Dropped queue submissions" className="border-t border-border/60 pt-2">
          <p className="mb-1 text-[11px] font-medium text-foreground/75">Dropped</p>
          {droppedRows.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">Nothing was queued</p>
          ) : (
            <ul className="max-h-32 space-y-1 overflow-auto pr-1">
              {droppedRows.map((entry, index) => <QueueEntry key={`dropped-${index}`} entry={entry} index={index} />)}
            </ul>
          )}
        </section>
      ) : null}

      {dropError ? <p role="alert" className="text-[11px] leading-relaxed text-destructive">{dropError}</p> : null}
    </ComposerStackedPanel>
  );
}

export function CediaQueueSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const queueQuery = useQuery(serverQueueQueryOptions(sessionId, sessionId.length > 0));
  const mutation = useMutation(serverQueueMutationOptions({ sessionId, queryClient }));
  const [dropped, setDropped] = useState<readonly CediaQueueEntry[] | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const onDrop = useCallback(async (mode: "last" | "all") => {
    if (mutation.isPending) return;
    setDropped(null);
    setDropError(null);
    try {
      const answer = await mutation.mutateAsync({ commandId: newCommandId(), mode });
      if (answer.state === "available") {
        setDropped(answer.dropped ?? []);
      } else {
        setDropError(answer.reason);
      }
    } catch (error) {
      setDropError(errorMessage(error));
    }
  }, [mutation]);

  const state = queueQuery.data ?? (queueQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(queueQuery.error) }
    : null);
  return (
    <CediaQueuePanel
      state={state}
      dropped={dropped}
      dropError={dropError}
      busy={mutation.isPending}
      onDrop={onDrop}
    />
  );
}
