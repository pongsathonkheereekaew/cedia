// FILE: cediaStatusBar.tsx
// Purpose: Cedia agent-window status bar (§10 item 55, §3.B): slim bundle-drawn
//          bottom bar — host · model · session · branch on the shared statusBar.*
//          tokens. Reads only what the adapter already projects (model/selection,
//          session status, branch) through the vendor store selectors: no second
//          data path.
// Layer: Cedia web shell chrome (vendored-app-owned file, not upstream Synara)

import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { ThreadId } from "@synara/contracts";

import { useFocusedChatContext } from "../focusedChatContext";
import { resolveThreadModelSummary } from "../lib/threadModelSummary";
import { createThreadSelector } from "../storeSelectors";
import { useStore } from "../store";
import { cn } from "~/lib/utils";

function sessionLabel(status: string | undefined, hasError: boolean): string {
  if (hasError) return "error";
  switch (status) {
    case "running":
      return "running";
    case "ready":
      return "ready";
    case "starting":
      return "starting";
    case "stopped":
      return "stopped";
    case "connecting":
      return "connecting";
    case "closed":
      return "closed";
    default:
      return "idle";
  }
}

/** Test seam: pure value mapping without hooks (the bar itself reads the store). */
export interface CediaStatusBarThreadLike {
  readonly modelSelection: { readonly provider: string; readonly model: string; readonly options?: unknown } | null | undefined;
  readonly session?: { readonly status?: string } | null;
  readonly branch?: string | null;
}

export function sessionLabelForTest(status: string | undefined, hasError: boolean): string {
  return sessionLabel(status, hasError);
}

export function statusBarValuesForTest(thread: CediaStatusBarThreadLike | undefined): {
  host: string;
  model: string;
  session: string;
  branch: string;
} | null {
  if (!thread) return null;
  const modelSummary = resolveThreadModelSummary(
    (thread.modelSelection ?? undefined) as Parameters<typeof resolveThreadModelSummary>[0],
  );
  const model = modelSummary
    ? modelSummary.statusLabel
      ? `${modelSummary.modelLabel} · ${modelSummary.statusLabel}`
      : modelSummary.modelLabel
    : "—";
  const session = sessionLabel(thread.session?.status, thread.session?.status === "error");
  const branch = thread.branch ?? "—";
  const host = thread.session?.status === "connecting" ? "connecting" : "live";
  return { host, model, session, branch };
}

export function CediaStatusBar({ className }: { className?: string }) {
  // Route-agnostic: `strict: false` resolves on thread, settings and index routes
  // alike; the focused context (split-aware) picks the live thread.
  const routeThreadId = useParams({
    strict: false,
    select: (params: Record<string, string | undefined>) =>
      params.threadId ? ThreadId.makeUnsafe(params.threadId) : null,
  });
  const { focusedThreadId } = useFocusedChatContext();
  const threadId = focusedThreadId ?? routeThreadId;
  const thread = useStore(useMemo(() => createThreadSelector(threadId), [threadId]));

  if (!thread) return null;

  const values = statusBarValuesForTest(thread);
  if (!values) return null;

  return (
    <footer
      data-testid="cedia-status-bar"
      aria-label="Agent status"
      className={cn(
        "flex h-6 w-full shrink-0 items-center gap-4 overflow-hidden px-3 text-[11px] leading-none",
        "border-t border-[var(--vscode-statusBar-border)]",
        "bg-[var(--vscode-statusBar-background)] text-[var(--vscode-statusBar-foreground)]",
        className,
      )}
    >
      <span title="Host connection" data-testid="cedia-status-host">
        <span className="opacity-70">host</span> · {values.host}
      </span>
      <span title="Active model" data-testid="cedia-status-model" className="truncate">
        <span className="opacity-70">model</span> · {values.model}
      </span>
      <span title="Session status" data-testid="cedia-status-session">
        <span className="opacity-70">session</span> · {values.session}
      </span>
      <span title="Thread branch" data-testid="cedia-status-branch" className="truncate">
        <span className="opacity-70">branch</span> · {values.branch}
      </span>
    </footer>
  );
}
