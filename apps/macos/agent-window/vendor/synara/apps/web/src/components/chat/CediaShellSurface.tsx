// FILE: CediaShellSurface.tsx
// Purpose: Run one shell command or Python snippet at a time through the session itself.
// Layer: Chat composer UI

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { TerminalIcon } from "~/lib/icons";
import { newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverBashAbortMutationOptions,
  serverBashExecMutationOptions,
  serverPythonAbortMutationOptions,
  serverPythonExecMutationOptions,
  type CediaBashAbortAnswer,
  type CediaBashAnswer,
  type CediaPythonAbortAnswer,
  type CediaPythonAnswer,
} from "../../lib/serverReactQuery";

export type CediaShellLanguage = "bash" | "python";

function errorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "The Cedia shell runtime is unavailable.";
  }
  return error.message;
}

function exitLabel(result: Extract<CediaBashAnswer | CediaPythonAnswer, { state: "available" }>): string {
  if (result.cancelled) return "Cancelled";
  if ("timedOut" in result && result.timedOut) return "Timed out";
  return result.exitCode === null ? "No exit code" : `Exit ${result.exitCode}`;
}

function mediaNote(result: Extract<CediaBashAnswer | CediaPythonAnswer, { state: "available" }>): string | null {
  if ("displayOutputs" in result) {
    return result.displayOutputs > 0 ? `${result.displayOutputs} display output${result.displayOutputs === 1 ? "" : "s"} not shown` : null;
  }
  return result.images > 0 ? `${result.images} image${result.images === 1 ? "" : "s"} not shown` : null;
}

export interface CediaShellPanelProps {
  readonly command: string;
  readonly result: CediaBashAnswer | CediaPythonAnswer | null;
  readonly running?: boolean;
  readonly error?: string | null;
  readonly language?: CediaShellLanguage;
  readonly onCommand?: (command: string) => void;
  readonly onRun?: () => void;
  readonly onAbort?: () => void;
  readonly onLanguage?: (language: CediaShellLanguage) => void;
}

/** Pure shell rendering used by the hook-backed surface and renderer tests. */
export function CediaShellPanel({
  command,
  result,
  running = false,
  error = null,
  language = "bash",
  onCommand,
  onRun,
  onAbort,
  onLanguage,
}: CediaShellPanelProps) {
  const python = language === "python";
  const runLabel = python ? "Run Python code" : "Run shell command";
  const abortLabel = python ? "Abort Python run" : "Abort shell command";
  if (result?.state === "unavailable") {
    return (
      <ComposerStackedPanel
        data-testid="cedia-shell-surface"
        aria-label="Cedia shell"
        className="px-2.5 py-2"
      >
        <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{result.reason}</p>
      </ComposerStackedPanel>
    );
  }

  const finished = result?.state === "available" ? result : null;
  return (
    <ComposerStackedPanel
      data-testid="cedia-shell-surface"
      aria-label="Cedia shell"
      className="space-y-2 px-2.5 py-2"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground/85">Shell</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          Runs in the task session, not this window's terminal
        </span>
        {onLanguage ? (
          <span className="flex shrink-0 items-center gap-1" role="group" aria-label="Shell language">
            {(["bash", "python"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant={language === option ? "default" : "ghost"}
                size="xs"
                disabled={running}
                onClick={() => onLanguage(option)}
                aria-pressed={language === option}
                aria-label={`${option === "bash" ? "Bash" : "Python"} shell language`}
              >
                {option === "bash" ? "Bash" : "Python"}
              </Button>
            ))}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          value={command}
          onChange={(event) => onCommand?.(event.target.value)}
          disabled={running}
          aria-label={python ? "Python code" : "Shell command"}
          placeholder={python ? "print(1 + 2)" : "printf hello"}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 font-mono text-[11px] text-foreground/85"
        />
        {running ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onAbort?.()}
            aria-label={abortLabel}
          >
            Abort
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={command.trim().length === 0}
            onClick={() => onRun?.()}
            aria-label={runLabel}
          >
            Run
          </Button>
        )}
      </div>
      {finished ? (
        <section aria-label="Shell result" className="space-y-1">
          <p className="text-[11px] font-medium text-foreground/75">
            {exitLabel(finished)}
            {"workingDir" in finished && finished.workingDir ? <span className="font-normal text-muted-foreground"> · {finished.workingDir}</span> : null}
          </p>
          {finished.output.length > 0 ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/80">
              {finished.output}
            </pre>
          ) : null}
          <div className="flex min-w-0 flex-wrap gap-x-2 text-[10px] text-muted-foreground">
            {finished.outputTruncated ? <span>Output truncated</span> : null}
            {mediaNote(finished) ? <span>{mediaNote(finished)}</span> : null}
          </div>
        </section>
      ) : null}
      {error ? <p role="alert" className="text-[11px] leading-relaxed text-destructive">{error}</p> : null}
    </ComposerStackedPanel>
  );
}

export function CediaShellSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const [command, setCommand] = useState("");
  const [language, setLanguage] = useState<CediaShellLanguage>("bash");
  const [result, setResult] = useState<CediaBashAnswer | CediaPythonAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bashExec = useMutation(serverBashExecMutationOptions({ sessionId, queryClient }));
  const bashAbort = useMutation(serverBashAbortMutationOptions({ sessionId, queryClient }));
  const pythonExec = useMutation(serverPythonExecMutationOptions({ sessionId, queryClient }));
  const pythonAbort = useMutation(serverPythonAbortMutationOptions({ sessionId, queryClient }));
  const exec = language === "python" ? pythonExec : bashExec;
  const abort = language === "python" ? pythonAbort : bashAbort;

  const onRun = useCallback(() => {
    if (exec.isPending || command.trim().length === 0) return;
    setError(null);
    setResult(null);
    const body = language === "python" ? { commandId: newCommandId(), code: command } : { commandId: newCommandId(), command };
    void exec.mutateAsync(body as never).then(
      (answer) => {
        if (answer.state === "available") setResult(answer);
        else setError(answer.reason);
      },
      (mutationError: unknown) => {
        setError(errorMessage(mutationError));
      },
    );
  }, [exec, command, language]);

  const onAbort = useCallback(() => {
    if (abort.isPending) return;
    void abort.mutateAsync({ commandId: newCommandId() }).catch(() => undefined);
  }, [abort]);

  const onLanguage = useCallback((next: CediaShellLanguage) => {
    if (next === language) return;
    setLanguage(next);
    setResult(null);
    setError(null);
  }, [language]);

  return (
    <CediaShellPanel
      command={command}
      result={result}
      running={exec.isPending}
      error={error ?? (exec.isError ? errorMessage(exec.error) : null)}
      language={language}
      onCommand={setCommand}
      onRun={onRun}
      onAbort={onAbort}
      onLanguage={onLanguage}
    />
  );
}

export type { CediaBashAbortAnswer, CediaPythonAbortAnswer };
