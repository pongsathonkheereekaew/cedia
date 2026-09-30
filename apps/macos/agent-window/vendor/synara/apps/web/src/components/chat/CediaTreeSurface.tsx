// FILE: CediaTreeSurface.tsx
// Purpose: Show the runtime-owned task tree and let the user navigate to one of its points.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ThreadId } from "@synara/contracts";

import { HistoryIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { useComposerDraftStore } from "../../composerDraftStore";
import { requestComposerFocus } from "../../composerFocusRequestStore";
import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverTreeNavigateMutationOptions,
  serverTreeQueryOptions,
  type CediaTreeAnswer,
  type CediaTreeNavigateAnswer,
  type CediaTreeNode,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "The Cedia session tree is unavailable.";
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0
    ? `${error.message} (${code})`
    : error.message;
}

function nodeDepth(node: CediaTreeNode, nodes: readonly CediaTreeNode[]): number {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let current = node;
  let depth = 0;
  while (current.parentId !== null && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return Math.min(depth, 8);
}

function imageLabel(count: number): string {
  return `${count} image${count === 1 ? "" : "s"}`;
}

function navigationMessage(answer: CediaTreeNavigateAnswer): string | null {
  if (answer.state === "unavailable") return `Tree navigation unavailable: ${answer.reason}`;
  if (answer.askReopen) return "The runtime parked the target and did not move this task. Reopen it to continue.";
  if (answer.cancelled) return "Navigation was cancelled; this task did not move.";
  if (answer.aborted) return "Navigation was aborted; this task did not move.";
  if (!answer.moved) return "The runtime did not move this task.";
  const parts = [
    answer.summarized
      ? "Moved to this point; the runtime summarized the conversation."
      : "Moved to this point; the conversation continues from here.",
  ];
  if (answer.editorText !== null) {
    parts.push(
      answer.editorTextTruncated
        ? "The target's own text was truncated before it was put back in the composer."
        : "The target's own text is back in the composer.",
    );
  } else if (answer.editorTextTruncated) {
    parts.push("The target's own text was truncated and could not be fully restored.");
  }
  if (answer.editorImageCount > 0) {
    parts.push(`${imageLabel(answer.editorImageCount)} were reported for the target; their bytes were not returned.`);
  }
  return parts.join(" ");
}

export interface CediaTreePanelProps {
  readonly state: CediaTreeAnswer | null;
  readonly navigation?: CediaTreeNavigateAnswer | null;
  readonly navigationError?: string | null;
  readonly busy?: boolean;
  readonly onNavigate?: (entryId: string) => void;
}

/** Pure tree rendering used by the hook-backed surface and renderer tests. */
export function CediaTreePanel({
  state,
  navigation = null,
  navigationError = null,
  busy = false,
  onNavigate,
}: CediaTreePanelProps) {
  if (state === null) {
    return (
      <ComposerStackedPanel data-testid="cedia-tree-surface" aria-label="Task tree" className="px-2.5 py-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">Reading task tree…</p>
      </ComposerStackedPanel>
    );
  }

  if (state.state === "unavailable") {
    return (
      <ComposerStackedPanel data-testid="cedia-tree-surface" aria-label="Task tree" className="px-2.5 py-2">
        <p role="alert" className="text-[12px] font-medium text-foreground/85">Task tree unavailable</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
      </ComposerStackedPanel>
    );
  }

  return (
    <ComposerStackedPanel data-testid="cedia-tree-surface" aria-label="Task tree" className="space-y-2 px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground/85">Task tree</span>
        <span className="text-[10px] text-muted-foreground">{state.nodes.length} point{state.nodes.length === 1 ? "" : "s"}</span>
      </div>

      <section aria-label="Task lineage" className="space-y-0.5 border-b border-border/60 pb-2 text-[11px] text-muted-foreground">
        <p>Own session file: <span className="break-all text-foreground/80">{state.lineage.sessionFile}</span></p>
        <p>
          {state.lineage.parentSession === null
            ? "This task is the root session."
            : <>Parent session: <span className="break-all text-foreground/80">{state.lineage.parentSession}</span></>}
        </p>
        {state.lineage.previousSessionFiles.length > 0 ? (
          <details>
            <summary className="cursor-pointer">Previous session files ({state.lineage.previousSessionFiles.length})</summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {state.lineage.previousSessionFiles.map((file) => <li key={file} className="break-all">{file}</li>)}
            </ul>
          </details>
        ) : null}
      </section>

      {state.truncated ? (
        <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">
          The runtime truncated this tree; more points are not shown.
        </p>
      ) : null}

      {state.nodes.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">The runtime returned no tree points.</p>
      ) : (
        <ol aria-label="Session tree points" className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {state.nodes.map((node) => {
            const active = state.pathIds.includes(node.id);
            const current = node.id === state.leafId;
            return (
              <li
                key={node.id}
                data-tree-node-id={node.id}
                data-tree-active={active ? "true" : "false"}
                className={cn(
                  "flex min-w-0 items-start gap-2 rounded-md border px-2 py-1.5",
                  active ? "border-primary/40 bg-primary/5" : "border-border/60 bg-background/40",
                )}
                style={{ marginInlineStart: `${nodeDepth(node, state.nodes) * 12}px` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-primary" : "bg-muted-foreground/50")} aria-hidden="true" />
                    <span className="truncate text-[11px] font-medium text-foreground/85" title={node.label}>
                      {node.label}
                    </span>
                    {current ? <span className="shrink-0 text-[10px] text-primary">Current</span> : null}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {node.kind} · {node.timestamp}
                    {node.labelTruncated ? " · label truncated" : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => onNavigate?.(node.id)}
                  aria-label={`Switch to this point${node.label.length > 0 ? `: ${node.label}` : ""}`}
                >
                  Switch to this point
                </Button>
              </li>
            );
          })}
        </ol>
      )}

      {navigationMessage(navigation ?? { state: "unavailable", reason: navigationError ?? "" }) && (navigation || navigationError) ? (
        <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">
          {navigation ? navigationMessage(navigation) : navigationError}
        </p>
      ) : null}
    </ComposerStackedPanel>
  );
}

export function CediaTreeSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const treeQuery = useQuery(serverTreeQueryOptions(sessionId, sessionId.length > 0));
  const mutation = useMutation(serverTreeNavigateMutationOptions({ sessionId, queryClient }));
  const [navigation, setNavigation] = useState<CediaTreeNavigateAnswer | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);

  const onNavigate = useCallback(async (entryId: string) => {
    if (mutation.isPending) return;
    const confirmed = await ensureNativeApi().dialogs.confirm(
      "Switch to this point? The conversation continues from there, and the target's own text will be put back in the composer.",
    );
    if (!confirmed) {
      setNavigation({
        state: "available",
        moved: false,
        cancelled: true,
        aborted: false,
        askReopen: false,
        summarized: false,
        editorText: null,
        editorTextTruncated: false,
        editorImageCount: 0,
        leafId: null,
      });
      setNavigationError(null);
      return;
    }
    setNavigation(null);
    setNavigationError(null);
    try {
      const answer = await mutation.mutateAsync({ entryId });
      setNavigation(answer);
      if (
        answer.state === "available" &&
        answer.moved &&
        !answer.askReopen &&
        !answer.cancelled &&
        !answer.aborted &&
        answer.editorText !== null
      ) {
        const thread = ThreadId.makeUnsafe(sessionId);
        useComposerDraftStore.getState().setPrompt(thread, answer.editorText);
        requestComposerFocus(thread);
      }
    } catch (error) {
      setNavigationError(errorMessage(error));
    }
  }, [mutation, sessionId]);

  const state = treeQuery.data ?? (treeQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(treeQuery.error) }
    : null);
  return (
    <CediaTreePanel
      state={state}
      navigation={navigation}
      navigationError={navigationError}
      busy={mutation.isPending}
      onNavigate={onNavigate}
    />
  );
}
