// FILE: CediaProgressSurface.tsx
// Purpose: Render OMP's host-owned todo progress above the Cedia composer.
// Layer: Chat composer UI

import { useQuery } from "@tanstack/react-query";

import { ListTodoIcon } from "~/lib/icons";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverProgressQueryOptions,
  type CediaProgressAnswer,
  type CediaProgressPhase,
  type CediaProgressTask,
} from "../../lib/serverReactQuery";

const STATUS_LABELS: Record<CediaProgressTask["status"], string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Done",
  blocked: "Blocked",
};

function progressCounts(phases: readonly CediaProgressPhase[]) {
  return phases.flatMap((phase) => phase.tasks).reduce(
    (counts, task) => {
      if (task.status === "completed") counts.completed += 1;
      if (task.status === "in_progress") counts.inProgress += 1;
      if (task.status === "blocked") counts.blocked += 1;
      if (task.status === "pending") counts.pending += 1;
      return counts;
    },
    { completed: 0, inProgress: 0, blocked: 0, pending: 0 },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Cedia progress runtime is unavailable.";
}

export function CediaProgressPanel({ state }: { readonly state: CediaProgressAnswer }) {
  if (state.state === "unavailable") {
    return (
      <ComposerStackedPanel
        data-testid="cedia-progress-surface"
        aria-label="Cedia progress"
        className="px-2.5 py-2"
      >
        <p className="text-[12px] font-medium text-foreground/85">Progress unavailable</p>
        <p className="mt-1 min-w-0 break-words text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
      </ComposerStackedPanel>
    );
  }

  if (state.phases.length === 0) return null;

  const counts = progressCounts(state.phases);
  return (
    <ComposerStackedPanel
      data-testid="cedia-progress-surface"
      aria-label="Cedia progress"
      className="px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
        <ListTodoIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground/85">Progress</span>
        <div aria-label="Progress counts" className="flex min-w-0 flex-1 gap-x-2 overflow-x-auto whitespace-nowrap text-[11px] text-muted-foreground">
          <span>Done: {counts.completed}</span>
          <span>In progress: {counts.inProgress}</span>
          <span>Blocked: {counts.blocked}</span>
          <span>Pending: {counts.pending}</span>
        </div>
      </div>
      <div className="mt-1.5 h-40 overflow-y-auto pr-1">
        <div className="space-y-2">
          {state.phases.map((phase, phaseIndex) => (
            <section key={`${phase.name}-${phaseIndex}`} aria-label={phase.name}>
              <p className="text-[11px] font-medium text-foreground/80">{phase.name}</p>
              <ul className="mt-0.5 space-y-0.5 pl-2">
                {phase.tasks.map((task, taskIndex) => (
                  <li
                    key={`${task.content}-${taskIndex}`}
                    data-progress-status={task.status}
                    className="text-[11px] leading-relaxed text-muted-foreground"
                  >
                    <span className="mr-1 font-medium text-foreground/65">{STATUS_LABELS[task.status]}</span>
                    <span>{task.content}</span>
                    {task.status === "blocked" && task.blocker ? (
                      <span className="ml-1 text-destructive/80">({task.blocker})</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </ComposerStackedPanel>
  );
}

export function CediaProgressSurface({ sessionId }: { readonly sessionId: string }) {
  const progressQuery = useQuery(serverProgressQueryOptions(sessionId, sessionId.length > 0));
  if (progressQuery.data) return <CediaProgressPanel state={progressQuery.data} />;
  if (progressQuery.isError) {
    return <CediaProgressPanel state={{ state: "unavailable", reason: errorMessage(progressQuery.error) }} />;
  }
  return null;
}
