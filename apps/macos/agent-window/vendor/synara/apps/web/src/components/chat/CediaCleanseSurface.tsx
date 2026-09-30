// FILE: CediaCleanseSurface.tsx
// Purpose: Run project diagnostics detection plus one bounded repair batch, and show the
//          held report. Detection runs local checker commands; repair dispatches subagents
//          through the runtime's own cleanse core. The run answers the running state at
//          once and the report lands later; the transcript is never touched.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { ListChecksIcon } from "~/lib/icons";
import { newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverCleanseAbortMutationOptions,
  serverCleanseQueryOptions,
  serverCleanseRunMutationOptions,
  type CediaCleanseAgent,
  type CediaCleanseAnswer,
  type CediaCleanseChecker,
  type CediaCleanseReport,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "The Cedia cleanse runtime is unavailable.";
  }
  return error.message;
}

function checkerLabel(checker: CediaCleanseChecker): string {
  const outcome = checker.state === "running"
    ? "running"
    : checker.exitCode === 0
      ? `${checker.diagnostics} diagnostics`
      : `exit ${checker.exitCode ?? "?"}`;
  return `${checker.label} · ${outcome}`;
}

function agentLabel(agent: CediaCleanseAgent): string {
  const files = agent.files === 1 ? "1 file" : `${agent.files} files`;
  const detail = agent.detail.trim().length > 0 ? ` — ${agent.detail}` : "";
  return `${agent.name} · ${agent.status} · ${files}${detail}`;
}

function ReportSection({ report }: { readonly report: CediaCleanseReport }) {
  const statusLine =
    report.status === "clean"
      ? "Clean"
      : report.status === "cancelled"
        ? "Cancelled"
        : report.status === "unsupported"
          ? "No supported checker"
          : "Unresolved";
  return (
    <div aria-label="Cleanse report" className="border-t border-border/60 pt-2">
      <p className="text-[11px] font-medium text-foreground/85">
        {statusLine} · {report.diagnosticsTotal} diagnostic{report.diagnosticsTotal === 1 ? "" : "s"}
        {report.diagnosticsTruncated ? " (truncated)" : ""}
      </p>
      {report.checks.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {report.checks.map((check) => (
            <li key={check.id} data-cleanse-check={check.id} className="text-[10px] text-muted-foreground">
              {check.label} · {check.language} · exit {check.exitCode ?? "?"} · {check.diagnostics} diagnostics
            </li>
          ))}
        </ul>
      ) : null}
      {report.diagnostics.length > 0 ? (
        <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto pr-1">
          {report.diagnostics.map((diag, index) => (
            <li
              key={`${diag.checker}-${diag.file ?? "nofile"}-${diag.line ?? 0}-${index}`}
              data-cleanse-diagnostic={diag.checker}
              className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
            >
              <p className="truncate text-[11px] font-medium text-foreground/85" title={diag.message}>
                {diag.message}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {[diag.checker, diag.file, diag.line !== undefined ? `line ${diag.line}` : null, diag.code].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {report.skipped.length > 0 ? (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Skipped: {report.skipped.map((row) => `${row.label} (${row.reason})`).join("; ")}
        </p>
      ) : null}
    </div>
  );
}

export interface CediaCleansePanelProps {
  readonly state: CediaCleanseAnswer | null;
  readonly request?: string;
  readonly running?: boolean;
  readonly runError?: string | null;
  readonly onRequestChange?: (request: string) => void;
  readonly onRun?: () => void;
  readonly onAbort?: () => void;
}

/** Pure cleanse rendering used by the hook-backed surface and renderer tests. */
export function CediaCleansePanel({
  state,
  request = "",
  running = false,
  runError = null,
  onRequestChange,
  onRun,
  onAbort,
}: CediaCleansePanelProps) {
  const answer = state?.available === true ? state : null;
  const busy = running || answer?.state === "running";
  return (
    <ComposerStackedPanel
      data-testid="cedia-cleanse-surface"
      aria-label="Cleanse"
      className="space-y-2 px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <ListChecksIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground/85">Cleanse</span>
        <span className="text-[10px] text-muted-foreground">
          detect with local checkers, fix with bounded subagents
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <input
          type="text"
          value={request}
          disabled={busy}
          onChange={(event) => onRequestChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onRun?.();
          }}
          placeholder="What to detect and fix — empty runs every checker…"
          aria-label="Cleanse request"
          className="min-w-0 flex-1 rounded-md border border-border/60 bg-background/50 px-2 py-1.5 text-[11px] text-foreground/85 outline-none placeholder:text-muted-foreground/70"
        />
        {busy ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onAbort?.()}
            aria-label="Abort cleanse run"
          >
            Abort
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onRun?.()}
            aria-label="Run cleanse"
          >
            Run
          </Button>
        )}
      </div>

      {runError ? (
        <p role="alert" className="text-[11px] leading-relaxed text-destructive">{runError}</p>
      ) : null}

      {answer && answer.state !== "idle" ? (
        <div aria-label="Cleanse progress" className="space-y-1">
          {answer.phase !== null ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">{answer.phase}</p>
          ) : null}
          {answer.checkers.length > 0 ? (
            <ul className="space-y-0.5">
              {answer.checkers.map((checker) => (
                <li key={checker.id} data-cleanse-checker={checker.id} className="text-[10px] text-muted-foreground">
                  {checkerLabel(checker)}
                </li>
              ))}
            </ul>
          ) : null}
          {answer.agents.length > 0 ? (
            <ul className="space-y-0.5">
              {answer.agents.map((agent) => (
                <li key={agent.name} data-cleanse-agent={agent.name} className="text-[10px] text-muted-foreground">
                  {agentLabel(agent)}
                </li>
              ))}
            </ul>
          ) : null}
          {answer.state === "failed" ? (
            <p role="alert" className="text-[11px] leading-relaxed text-destructive">
              {answer.reason ?? "The cleanse run failed."}
            </p>
          ) : null}
          {answer.log.length > 0 ? (
            <details className="text-[10px] text-muted-foreground">
              <summary className="cursor-pointer">Run log ({answer.log.length})</summary>
              <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words pr-1">
                {answer.log.join("\n")}
              </pre>
            </details>
          ) : null}
          {answer.report !== null ? <ReportSection report={answer.report} /> : null}
        </div>
      ) : null}
    </ComposerStackedPanel>
  );
}

export function CediaCleanseSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const cleanseQuery = useQuery(serverCleanseQueryOptions(sessionId, sessionId.length > 0));
  const runMutation = useMutation(serverCleanseRunMutationOptions({ sessionId, queryClient }));
  const abortMutation = useMutation(serverCleanseAbortMutationOptions({ sessionId, queryClient }));
  const [request, setRequest] = useState("");
  const [runError, setRunError] = useState<string | null>(null);

  const onRun = useCallback(async () => {
    if (runMutation.isPending || abortMutation.isPending) return;
    setRunError(null);
    try {
      await runMutation.mutateAsync({
        commandId: newCommandId(),
        ...(request.trim().length > 0 ? { request: request.trim() } : { all: true }),
      });
    } catch (error) {
      setRunError(errorMessage(error));
    }
  }, [runMutation, abortMutation.isPending, request]);

  const onAbort = useCallback(async () => {
    if (runMutation.isPending || abortMutation.isPending) return;
    setRunError(null);
    try {
      await abortMutation.mutateAsync({ commandId: newCommandId() });
    } catch (error) {
      setRunError(errorMessage(error));
    }
  }, [runMutation.isPending, abortMutation]);

  const state = cleanseQuery.data ?? (cleanseQuery.isError
    ? { available: false as const, reason: errorMessage(cleanseQuery.error) }
    : null);
  return (
    <CediaCleansePanel
      state={state}
      request={request}
      running={runMutation.isPending || abortMutation.isPending}
      runError={runError}
      onRequestChange={setRequest}
      onRun={() => void onRun()}
      onAbort={() => void onAbort()}
    />
  );
}
