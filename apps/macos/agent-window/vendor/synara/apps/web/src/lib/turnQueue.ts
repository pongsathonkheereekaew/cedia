// FILE: turnQueue.ts
// Purpose: Say, in one line, how much work OMP is holding for a task and whether any turn's outcome
//          is still unknown (CEDIA-PLAN §2.4 / O01). The host records the turns; this only reads the
//          projection, so a surface can never invent a queued turn or present an unknown outcome as
//          a completed one.
// Layer: Web presentation logic
// Exports: turnQueueSummary

import type { ThreadSessionTurn } from "../types";

/** States that mean the task still has work in front of the user. */
const RUNNING: ReadonlySet<ThreadSessionTurn["state"]> = new Set(["running"]);
const WAITING: ReadonlySet<ThreadSessionTurn["state"]> = new Set(["prepared", "queued"]);
/** States whose outcome Cedia must not present as finished. */
const UNRESOLVED: ReadonlySet<ThreadSessionTurn["state"]> = new Set(["needs_continue", "outcome_unknown"]);

/**
 * One line for the task's turn queue, or `null` when there is nothing to say.
 *
 * A turn whose outcome Cedia cannot prove outranks the counts: "1 outcome unknown" is the honest
 * answer, and the counts alone would read as progress.
 */
export function turnQueueSummary(turns: readonly ThreadSessionTurn[] | null | undefined): string | null {
  if (!Array.isArray(turns) || turns.length === 0) return null;
  let running = 0;
  let waiting = 0;
  let unresolved: ThreadSessionTurn | undefined;
  let runningTurn: ThreadSessionTurn | undefined;
  for (const turn of turns) {
    if (typeof turn?.state !== "string") continue;
    if (UNRESOLVED.has(turn.state)) unresolved ??= turn;
    if (RUNNING.has(turn.state)) {
      running += 1;
      runningTurn ??= turn;
    }
    if (WAITING.has(turn.state)) waiting += 1;
  }
  if (unresolved) {
    const what = unresolved.state === "outcome_unknown" ? "outcome unknown" : "needs continue";
    return unresolved.reason ? `${what} · ${unresolved.reason}` : what;
  }
  const parts: string[] = [];
  if (running > 0) parts.push(runningTurn?.model ? `running ${runningTurn.model}` : `${running} running`);
  if (waiting > 0) parts.push(`${waiting} waiting`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
