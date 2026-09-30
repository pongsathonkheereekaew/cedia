// FILE: CediaOwnerSurface.tsx
// Purpose: Show the host's bounded known-owner listing and offer an explicit, reprobed Attach.
// Layer: Chat task controls

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverOwnerAttachMutationOptions,
  serverOwnersQueryOptions,
  type CediaOwnerAnswer,
  type CediaOwnerRow,
} from "../../lib/serverReactQuery";

export type { CediaOwnerAnswer, CediaOwnerRow } from "../../lib/serverReactQuery";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "The Cedia owner listing is unavailable.";
}

function ownerStateLabel(owner: CediaOwnerRow): string {
  if (owner.state === "attached") {
    if (owner.identity?.mode === "inspect_only") return `Live owner · inspection only · pid ${owner.identity.pid}`;
    return owner.identity ? `Live owner · pid ${owner.identity.pid}` : "Live owner";
  }
  if (owner.state === "absent") return "No live owner";
  if (owner.state === "stale") return `Stale owner record${owner.reason ? ` · ${owner.reason}` : ""}`;
  return `Owner conflict${owner.reason ? ` · ${owner.reason}` : ""}`;
}

export interface CediaOwnerPanelProps {
  readonly state: CediaOwnerAnswer | null;
  readonly selectedTaskId?: string;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onSelectTask?: (taskId: string) => void;
  readonly onAttach?: (owner: CediaOwnerRow) => void;
}

/** Pure owner-list rendering used by the hook-backed surface and renderer tests. */
export function CediaOwnerPanel({
  state,
  selectedTaskId,
  busy = false,
  error = null,
  onSelectTask,
  onAttach,
}: CediaOwnerPanelProps) {
  if (state === null) {
    return (
      <ComposerStackedPanel data-testid="cedia-owner-surface" aria-label="Cedia task owners" className="px-2.5 py-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {error ? "Owner listing unavailable" : "Reading known Cedia task owners…"}
        </p>
        {error ? <p role="alert" className="mt-1 text-[11px] leading-relaxed text-destructive">{error}</p> : null}
      </ComposerStackedPanel>
    );
  }

  return (
    <ComposerStackedPanel
      data-testid="cedia-owner-surface"
      aria-label="Cedia task owners"
      aria-busy={busy}
      className="space-y-2 px-2.5 py-2"
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-foreground/85">Known Cedia task owners</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            Select a task to inspect its local owner state. Attach re-probes it before claiming the host lease.
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">{state.owners.length} shown</span>
      </div>
      {error ? <p role="alert" className="text-[11px] leading-relaxed text-destructive">{error}</p> : null}
      {state.owners.length > 0 ? (
        <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {state.owners.map((owner) => {
            const selected = owner.taskId === selectedTaskId;
            const attachable = selected && owner.state === "attached" && owner.identity?.mode === "controller" && !owner.archived;
            return (
              <li
                key={owner.taskId}
                data-owner-task-id={owner.taskId}
                data-owner-state={owner.state}
                className="flex min-w-0 items-start gap-1 rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-sm text-left hover:bg-background/70"
                  aria-pressed={selected}
                  aria-label={`Select Cedia task owner ${owner.title}`}
                  onClick={() => onSelectTask?.(owner.taskId)}
                >
                  <span className="block truncate text-[11px] font-medium text-foreground/85" title={owner.title}>
                    {owner.title}
                  </span>
                  <span className="mt-0.5 block break-words text-[10px] leading-relaxed text-muted-foreground">
                    {ownerStateLabel(owner)}{owner.archived ? " · archived" : ""}
                  </span>
                </button>
                {attachable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    aria-label={`Attach Cedia task ${owner.title}`}
                    onClick={() => onAttach?.(owner)}
                  >
                    {busy ? "Attaching…" : "Attach"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">No persisted Cedia tasks are known.</p>
      )}
      {state.truncated ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground">The host capped this owner list; more tasks are not shown.</p>
      ) : null}
    </ComposerStackedPanel>
  );
}

export function CediaOwnerSurface({ sessionId }: { readonly sessionId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ownerQuery = useQuery(serverOwnersQueryOptions());
  const attachMutation = useMutation(serverOwnerAttachMutationOptions({ queryClient }));
  const [selectedTaskId, setSelectedTaskId] = useState(sessionId);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedTaskId(sessionId);
  }, [sessionId]);

  const attach = useCallback(async (owner: CediaOwnerRow) => {
    if (owner.state !== "attached" || owner.identity?.mode !== "controller" || owner.archived || attachMutation.isPending) return;
    setActionError(null);
    try {
      await attachMutation.mutateAsync({ taskId: owner.taskId });
      await navigate({ to: "/$threadId", params: { threadId: owner.taskId } });
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }, [attachMutation, navigate]);

  const queryError = ownerQuery.isError ? errorMessage(ownerQuery.error) : null;
  return (
    <CediaOwnerPanel
      state={ownerQuery.data ?? null}
      selectedTaskId={selectedTaskId}
      busy={attachMutation.isPending}
      error={actionError ?? queryError}
      onSelectTask={setSelectedTaskId}
      onAttach={attach}
    />
  );
}
