// FILE: cediaStatusBar.tsx
// Purpose: Cedia agent-window status bar (§10 item 55, §3.B): slim bundle-drawn
//          bottom bar — host · model · session · branch on the shared statusBar.*
//          tokens. Reads only what the adapter already projects (model/selection,
//          session status, branch) through the vendor store selectors: no second
//          data path.
// Layer: Cedia web shell chrome (vendored-app-owned file, not upstream Synara)

import { resolveThreadModelSummary } from "../lib/threadModelSummary";
import { turnQueueSummary } from "../lib/turnQueue";

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
  readonly session?: {
    readonly status?: string;
    readonly turns?: readonly { readonly state?: string; readonly model?: string; readonly reason?: string }[];
    readonly pendingModel?: {
      readonly state?: string;
      readonly requested?: { readonly provider?: string; readonly modelId?: string; readonly thinkingLevel?: string | null };
      readonly applied?: { readonly model?: string };
      readonly error?: string;
    } | null;
  } | null;
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
  pending: string | null;
  queue: string | null;
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
  return {
    host,
    model,
    session,
    branch,
    pending: pendingModelLabelForTest(thread.session?.pendingModel),
    queue: turnQueueSummary(thread.session?.turns as Parameters<typeof turnQueueSummary>[0]),
  };
}

/**
 * What a held model/effort change says, or nothing when the task holds none.
 *
 * §2.4: a request OMP has not committed is never drawn as the model in effect. `awaiting` names
 * what was asked for, `in-effect` names what OMP reported committing (with `via` when the runtime
 * applied it at once instead of at its own turn boundary), and `refused` repeats the rejection.
 */
export function pendingModelLabelForTest(
  pending:
    | {
        readonly state?: string;
        readonly requested?: { readonly provider?: string; readonly modelId?: string; readonly thinkingLevel?: string | null };
        readonly applied?: { readonly model?: string; readonly via?: string };
        readonly error?: string;
      }
    | null
    | undefined,
): string | null {
  if (!pending || typeof pending.state !== "string") return null;
  const requested = [pending.requested?.provider, pending.requested?.modelId].filter(Boolean).join("/");
  switch (pending.state) {
    case "awaiting":
      return requested ? `awaiting OMP · ${requested}` : "awaiting OMP";
    case "in-effect": {
      const applied = pending.applied?.model ?? requested;
      const via = pending.applied?.via === "immediate" ? " · applied at once" : "";
      return applied ? `in effect · ${applied}${via}` : `in effect${via}`;
    }
    case "refused":
      return pending.error ? `refused · ${pending.error}` : "refused by the runtime";
    default:
      return null;
  }
}

export function CediaStatusBar({ className }: { className?: string }) {
  // Mockup cutover: the target layout has no footer status bar. Kept as a
  // NO-OP (not deleted) so the _chat.tsx call site and the pure value-mapping
  // test seams (statusBarValuesForTest et al.) keep working untouched.
  void className;
  return null;
}
