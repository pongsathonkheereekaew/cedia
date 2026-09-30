// FILE: CediaAdvisorSurface.tsx
// Purpose: Render the host-owned advisor state, spend, and bounded transcript above the composer.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { BrainIcon, HistoryIcon } from "~/lib/icons";
import { newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverAdvisorConfigMutationOptions,
  serverAdvisorConfigQueryOptions,
  serverAdvisorHistoryQueryOptions,
  serverAdvisorMutationOptions,
  serverAdvisorQueryOptions,
  type CediaAdvisorAnswer,
  type CediaAdvisorConfigAnswer,
  type CediaAdvisorConfigScope,
  type CediaAdvisorHistoryAnswer,
  type CediaAdvisorRow,
  type CediaAdvisorSnapshot,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Cedia advisor runtime is unavailable.";
}

function modelIdentity(model: CediaAdvisorSnapshot["model"]): string | null {
  return model ? `${model.provider}/${model.id}` : null;
}

function advisorIdentity(snapshot: CediaAdvisorSnapshot): string | null {
  if (snapshot.advisors.length > 1) return `${snapshot.advisors.length} advisors`;
  const model = modelIdentity(snapshot.model);
  if (model) return model;
  const singleAdvisor = snapshot.advisors[0];
  return singleAdvisor ? modelIdentity(singleAdvisor.model) : null;
}

function advisorStateLabel(snapshot: CediaAdvisorSnapshot): string {
  if (!snapshot.enabled) return "Advisor off";
  if (!snapshot.active) return "Advisor setting enabled, but no model is assigned to the 'advisor' role.";
  const identity = advisorIdentity(snapshot);
  return identity ? `Advisor on · ${identity}` : "Advisor on";
}

function UsageSummary({ summary }: { readonly summary: Pick<CediaAdvisorRow, "contextWindow" | "contextTokens" | "tokens" | "cost" | "messages"> }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      <span>Context tokens: {summary.contextTokens} / {summary.contextWindow}</span>
      <span>Total tokens: {summary.tokens.total}</span>
      <span>Cost: ${summary.cost}</span>
      <span>Messages: {summary.messages.user} user · {summary.messages.assistant} assistant · {summary.messages.total} total</span>
    </div>
  );
}

function AdvisorRow({ advisor }: { readonly advisor: CediaAdvisorRow }) {
  return (
    <li className="rounded-md border border-border/60 bg-background/50 px-2 py-1.5" data-advisor-name={advisor.name}>
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-foreground/85">{advisor.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{advisor.status}</span>
      </div>
      <UsageSummary summary={advisor} />
    </li>
  );
}

export interface CediaAdvisorConfigState {
  readonly scope: CediaAdvisorConfigScope;
  readonly answer: CediaAdvisorConfigAnswer | null;
  readonly draft: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly saved: { readonly scope: CediaAdvisorConfigScope; readonly advisors: number } | null;
  readonly editorOpen: boolean;
}

export interface CediaAdvisorPanelProps {
  readonly state: CediaAdvisorAnswer | null;
  readonly history?: CediaAdvisorHistoryAnswer | null;
  readonly busy?: boolean;
  readonly historyBusy?: boolean;
  readonly dispatchError?: string | null;
  readonly onToggle?: () => void;
  readonly onShowHistory?: () => void;
  readonly config?: CediaAdvisorConfigState | null;
  readonly onConfigScope?: (scope: CediaAdvisorConfigScope) => void;
  readonly onConfigDraft?: (text: string) => void;
  readonly onConfigOpen?: () => void;
  readonly onConfigClose?: () => void;
  readonly onConfigSave?: () => void;
}

/** Pure advisor rendering used by the hook-backed surface and its renderer tests. */
export function CediaAdvisorPanel({
  state,
  history = null,
  busy = false,
  historyBusy = false,
  dispatchError = null,
  onToggle,
  onShowHistory,
  config = null,
  onConfigScope,
  onConfigDraft,
  onConfigOpen,
  onConfigClose,
  onConfigSave,
}: CediaAdvisorPanelProps) {
  if (state?.state === "unavailable") {
    return (
      <ComposerStackedPanel
        data-testid="cedia-advisor-surface"
        aria-label="Cedia advisor"
        className="px-2.5 py-2"
      >
        <p className="text-[12px] font-medium text-foreground/85">Advisor unavailable</p>
        <p className="mt-1 min-w-0 break-words text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
      </ComposerStackedPanel>
    );
  }

  if (!state) return null;

  const snapshot = state.advisor;
  return (
    <ComposerStackedPanel
      data-testid="cedia-advisor-surface"
      aria-label="Cedia advisor"
      className="space-y-2 px-2.5 py-2"
    >
      <section aria-label="Advisor state" className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[12px] font-medium text-foreground/85">{advisorStateLabel(snapshot)}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={onToggle ?? (() => undefined)}
            aria-label={snapshot.enabled ? "Turn advisor off" : "Turn advisor on"}
          >
            {snapshot.enabled ? "Turn advisor off" : "Turn advisor on"}
          </Button>
        </div>
        <UsageSummary summary={snapshot} />
      </section>

      {snapshot.active && snapshot.advisors.length > 0 ? (
        <section aria-label="Advisors">
          <p className="mb-1 text-[11px] font-medium text-foreground/75">Advisors</p>
          <ul className="max-h-32 space-y-1 overflow-auto pr-1">
            {snapshot.advisors.map((advisor) => <AdvisorRow key={`${advisor.name}-${advisor.sessionId ?? ""}`} advisor={advisor} />)}
          </ul>
        </section>
      ) : null}

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={historyBusy}
          onClick={onShowHistory ?? (() => undefined)}
          aria-label="Read advisor transcript"
        >
          <HistoryIcon className="size-3" />
          {history ? "Refresh advisor transcript" : "Read advisor transcript"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={config?.busy}
          onClick={onConfigOpen ?? (() => undefined)}
          aria-label="Configure advisors"
        >
          Configure
        </Button>
      </div>

      {config?.editorOpen ? (
        <section aria-label="Advisor configuration" className="space-y-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="Config scope">
            {(["project", "user"] as const).map((scope) => (
              <Button
                key={scope}
                type="button"
                variant={config.scope === scope ? "default" : "ghost"}
                size="xs"
                disabled={config.busy}
                onClick={() => onConfigScope?.(scope)}
                aria-pressed={config.scope === scope}
                aria-label={`${scope === "project" ? "Project" : "User"} config scope`}
              >
                {scope === "project" ? "Project" : "User"}
              </Button>
            ))}
            {config.answer?.state === "available" ? (
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={config.answer.path}>
                {config.answer.path}
              </span>
            ) : null}
          </div>
          {config.answer?.state === "available" && !config.answer.exists ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              No file at this level yet — saving creates it.
            </p>
          ) : null}
          <textarea
            value={config.draft}
            onChange={(event) => onConfigDraft?.(event.target.value)}
            rows={8}
            spellCheck={false}
            disabled={config.busy}
            aria-label="Advisor config file text"
            placeholder={"advisors:\n  - name: reviewer\n"}
            className="w-full rounded-md border border-border/60 bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/85"
          />
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="default"
              size="xs"
              disabled={config.busy}
              onClick={onConfigSave ?? (() => undefined)}
              aria-label="Save advisor config"
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={config.busy}
              onClick={onConfigClose ?? (() => undefined)}
              aria-label="Cancel advisor config edit"
            >
              Cancel
            </Button>
            {config.saved ? (
              <span className="text-[11px] text-muted-foreground">
                Saved {config.saved.scope} config — {config.saved.advisors} advisor{config.saved.advisors === 1 ? "" : "s"} active.
              </span>
            ) : null}
          </div>
          {config.error ? (
            <p role="alert" className="text-[11px] leading-relaxed text-destructive">{config.error}</p>
          ) : null}
        </section>
      ) : null}

      {history ? (
        history.state === "unavailable" ? (
          <p role="alert" className="px-1 text-[11px] leading-relaxed text-destructive">{history.reason}</p>
        ) : (
          <section aria-label="Advisor transcript">
            {history.truncated ? (
              <p className="mb-1 text-[11px] leading-relaxed text-muted-foreground">
                This transcript was bounded and may not be complete.
              </p>
            ) : null}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 p-2 text-[11px] leading-relaxed text-foreground/80">
              {history.text ?? "Advisor is not active for this session."}
            </pre>
          </section>
        )
      ) : null}

      {dispatchError ? (
        <p role="alert" className="px-1 text-[11px] leading-relaxed text-destructive">{dispatchError}</p>
      ) : null}
    </ComposerStackedPanel>
  );
}

export function CediaAdvisorSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const advisorQuery = useQuery(serverAdvisorQueryOptions(sessionId, sessionId.length > 0));
  const mutation = useMutation(serverAdvisorMutationOptions({ sessionId, queryClient }));
  const [historyRequested, setHistoryRequested] = useState(false);
  const historyQuery = useQuery(serverAdvisorHistoryQueryOptions(sessionId, false));

  const onToggle = useCallback(() => {
    const snapshot = advisorQuery.data?.state === "available" ? advisorQuery.data.advisor : null;
    if (!snapshot || mutation.isPending) return;
    void mutation.mutateAsync({ op: "set", enabled: !snapshot.enabled }).catch(() => undefined);
  }, [advisorQuery.data, mutation]);

  const onShowHistory = useCallback(() => {
    setHistoryRequested(true);
    void historyQuery.refetch();
  }, [historyQuery]);

  const [configScope, setConfigScope] = useState<CediaAdvisorConfigScope>("project");
  const [configEditorOpen, setConfigEditorOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState("");
  const [configSaved, setConfigSaved] = useState<{ readonly scope: CediaAdvisorConfigScope; readonly advisors: number } | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const configMutation = useMutation(serverAdvisorConfigMutationOptions({ sessionId, queryClient }));
  const configQuery = useQuery(serverAdvisorConfigQueryOptions(sessionId, configScope, configEditorOpen && sessionId.length > 0));

  useEffect(() => {
    if (configQuery.data?.state === "available") {
      setConfigDraft(configQuery.data.text);
    }
  }, [configQuery.data, configScope]);

  const onConfigScope = useCallback((scope: CediaAdvisorConfigScope) => {
    setConfigScope(scope);
    setConfigSaved(null);
    setConfigError(null);
  }, []);

  const onConfigSave = useCallback(() => {
    if (configMutation.isPending) return;
    setConfigError(null);
    void configMutation.mutateAsync({ commandId: newCommandId(), scope: configScope, text: configDraft }).then(
      (answer) => {
        if (answer.state === "available") {
          setConfigSaved({ scope: answer.scope, advisors: answer.advisors ?? 0 });
        } else {
          setConfigError(answer.reason);
        }
      },
      (error: unknown) => {
        setConfigError(errorMessage(error));
      },
    );
  }, [configMutation, configScope, configDraft]);

  const configAnswer = configEditorOpen
    ? configQuery.data ?? (configQuery.isError
      ? { state: "unavailable" as const, reason: errorMessage(configQuery.error) }
      : null)
    : null;

  const state = advisorQuery.data ?? (advisorQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(advisorQuery.error) }
    : null);
  const history = historyRequested
    ? historyQuery.data ?? (historyQuery.isError
      ? { state: "unavailable" as const, reason: errorMessage(historyQuery.error) }
      : null)
    : null;
  const dispatchError = mutation.isError ? errorMessage(mutation.error) : null;

  return (
    <CediaAdvisorPanel
      state={state}
      history={history}
      busy={mutation.isPending}
      historyBusy={historyQuery.isFetching}
      dispatchError={dispatchError}
      onToggle={onToggle}
      onShowHistory={onShowHistory}
      config={{
        scope: configScope,
        answer: configAnswer,
        draft: configDraft,
        busy: configMutation.isPending || configQuery.isFetching,
        error: configError ?? (configMutation.isError ? errorMessage(configMutation.error) : null),
        saved: configSaved,
        editorOpen: configEditorOpen,
      }}
      onConfigScope={onConfigScope}
      onConfigDraft={setConfigDraft}
      onConfigOpen={() => {
        setConfigSaved(null);
        setConfigError(null);
        setConfigEditorOpen(true);
      }}
      onConfigClose={() => setConfigEditorOpen(false)}
      onConfigSave={onConfigSave}
    />
  );
}
