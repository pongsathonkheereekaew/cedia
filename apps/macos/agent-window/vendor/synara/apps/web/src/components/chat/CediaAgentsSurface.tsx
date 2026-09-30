// FILE: CediaAgentsSurface.tsx
// Purpose: Render the runtime-owned agent roster and a selected child transcript above the composer.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { UsersIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import { ensureNativeApi } from "../../nativeApi";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverAgentConfigsQueryOptions,
  serverAgentTranscriptQueryOptions,
  serverAgentsConfigMutationOptions,
  serverAgentsKillMutationOptions,
  serverAgentsQueryOptions,
  serverAgentsReviveMutationOptions,
  type CediaAgentConfigInput,
  type CediaAgentConfigRow,
  type CediaAgentConfigsAnswer,
  type CediaAgentRow,
  type CediaAgentTranscriptAnswer,
  type CediaAgentsAnswer,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Cedia agents runtime is unavailable.";
}

function AgentRow({
  agent,
  parentName,
  selected,
  busy = false,
  onSelect,
  onKill,
  onRevive,
}: {
  readonly agent: CediaAgentRow;
  readonly parentName?: string;
  readonly selected: boolean;
  readonly busy?: boolean;
  readonly onSelect?: () => void;
  readonly onKill?: (agent: CediaAgentRow) => void;
  readonly onRevive?: (agent: CediaAgentRow) => void;
}) {
  const child = parentName !== undefined;
  const details = (
    <>
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-foreground/85">{agent.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{agent.status}</span>
      </div>
      <div className="flex min-w-0 flex-wrap gap-x-2 text-[11px] text-muted-foreground">
        <span>{agent.kind}</span>
        {agent.activity ? <span className="truncate">{agent.activity}</span> : null}
      </div>
      {child ? <p className="text-[10px] text-muted-foreground/80">Child of {parentName}</p> : null}
      {agent.kind !== "advisor" && agent.status === "parked" && onRevive ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => onRevive(agent)}
          aria-label={`Revive agent ${agent.name}`}
        >
          Revive
        </Button>
      ) : null}
      {agent.kind !== "advisor" && agent.status !== "parked" && agent.status !== "aborted" && onKill ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => onKill(agent)}
          aria-label={`Kill agent ${agent.name}`}
        >
          Kill
        </Button>
      ) : null}
    </>
  );

  return (
    <li
      className={child ? "ml-3 border-l border-border/60 pl-2" : undefined}
      data-agent-child={child ? "true" : undefined}
      data-agent-id={agent.id}
    >
      {agent.sessionFile ? (
        <button
          type="button"
          className="block w-full rounded-md border border-border/60 bg-background/50 px-2 py-1.5 text-left hover:bg-background/80"
          data-agent-transcript={agent.id}
          aria-pressed={selected}
          aria-label={`Read transcript for ${agent.name}`}
          onClick={onSelect}
        >
          {details}
        </button>
      ) : (
        <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
          {details}
          <p className="mt-0.5 text-[10px] text-muted-foreground">No transcript available</p>
        </div>
      )}
    </li>
  );
}

function TranscriptMessage({
  role,
  text,
  otherParts,
  index,
}: {
  readonly role: string;
  readonly text: string;
  readonly otherParts: number;
  readonly index: string;
}) {
  return (
    <li className="rounded-md border border-border/60 bg-background/50 px-2 py-1.5" data-transcript-message={index}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{role}</div>
      <pre className="mt-0.5 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-foreground/85">{text}</pre>
      {otherParts > 0 ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{otherParts} non-text parts</p>
      ) : null}
    </li>
  );
}

function Transcript({
  agent,
  pages,
  busy,
  onLoadMore,
}: {
  readonly agent: CediaAgentRow | undefined;
  readonly pages: readonly CediaAgentTranscriptAnswer[];
  readonly busy: boolean;
  readonly onLoadMore?: () => void;
}) {
  if (!agent || pages.length === 0) return null;
  const unavailable = pages.findLast((page) => page.state === "unavailable");
  if (unavailable?.state === "unavailable") {
    return (
      <section aria-label="Agent transcript" className="space-y-1.5 border-t border-border/60 pt-2">
        <p className="text-[11px] font-medium text-foreground/75">{agent.name} transcript</p>
        <p role="alert" className="text-[11px] leading-relaxed text-destructive">{unavailable.reason}</p>
      </section>
    );
  }

  const availablePages = pages.filter((page): page is Extract<CediaAgentTranscriptAnswer, { state: "available" }> => page.state === "available");
  if (availablePages.length === 0) return null;
  const lastPage = availablePages.at(-1);
  if (!lastPage) return null;
  return (
    <section aria-label="Agent transcript" className="space-y-1.5 border-t border-border/60 pt-2">
      <p className="text-[11px] font-medium text-foreground/75">{agent.name} transcript</p>
      {availablePages.some((page) => page.reset) ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground">Transcript reset by the runtime; showing the page from the beginning.</p>
      ) : null}
      <ol className="max-h-48 space-y-1 overflow-auto pr-1">
        {availablePages.flatMap((page) => page.messages.map((message, index) => (
          <TranscriptMessage
            key={`${page.fromByte}-${index}`}
            index={`${page.fromByte}-${index}`}
            role={message.role}
            text={message.text}
            otherParts={message.otherParts}
          />
        )))}
      </ol>
      {availablePages.some((page) => page.truncated) ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] leading-relaxed text-muted-foreground">This transcript page was cut by the runtime.</p>
          {lastPage.truncated ? (
            <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onLoadMore}>
              {busy ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export interface CediaAgentsPanelProps {
  readonly state: CediaAgentsAnswer | null;
  readonly selectedAgentId?: string | null;
  readonly onSelectAgent?: (agentId: string) => void;
  readonly transcript?: CediaAgentTranscriptAnswer | null;
  readonly transcriptPages?: readonly CediaAgentTranscriptAnswer[];
  readonly transcriptBusy?: boolean;
  readonly onLoadMore?: () => void;
  readonly agentError?: string | null;
  readonly agentBusy?: boolean;
  readonly onKillAgent?: (agent: CediaAgentRow) => void;
  readonly onReviveAgent?: (agent: CediaAgentRow) => void;
  readonly activeTab?: "agents" | "config";
  readonly onTabChange?: (tab: "agents" | "config") => void;
  readonly configState?: CediaAgentConfigsAnswer | null;
  readonly configBusy?: boolean;
  readonly onConfigureAgent?: (agent: CediaAgentConfigRow, input: CediaAgentConfigInput) => void;
}

function ConfigRow({
  agent,
  busy = false,
  onConfigure,
}: {
  readonly agent: CediaAgentConfigRow;
  readonly busy?: boolean;
  readonly onConfigure?: (agent: CediaAgentConfigRow, input: CediaAgentConfigInput) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState(agent.enabled);
  const [model, setModel] = useState(agent.model ?? "");
  const [prewalk, setPrewalk] = useState(agent.prewalk ?? "");
  const [advisor, setAdvisor] = useState(agent.advisor ?? "");
  useEffect(() => {
    setEnabled(agent.enabled);
    setModel(agent.model ?? "");
    setPrewalk(agent.prewalk ?? "");
    setAdvisor(agent.advisor ?? "");
  }, [agent.enabled, agent.model, agent.prewalk, agent.advisor]);
  const effective = [
    agent.enabled ? "enabled" : "disabled",
    agent.model ? `model ${agent.model}` : null,
    agent.prewalk ? `prewalk ${agent.prewalk}` : null,
    agent.advisor ? `advisor ${agent.advisor}` : null,
  ].filter((part) => part !== null).join(", ");
  return (
    <li className="rounded-md border border-border/60 bg-background/50 px-2 py-1.5" data-agent-config={agent.name}>
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-foreground/85">{agent.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{agent.source}</span>
      </div>
      <p className="truncate text-[11px] text-muted-foreground">{effective}</p>
      {onConfigure ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => setExpanded((current) => !current)}
          aria-label={`Configure agent ${agent.name}`}
          aria-expanded={expanded}
        >
          {expanded ? "Close" : "Configure"}
        </Button>
      ) : null}
      {expanded && onConfigure ? (
        <form
          className="mt-1.5 space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            onConfigure(agent, { agent: agent.name, enabled, model, prewalk, advisor });
          }}
        >
          <label className="flex items-center gap-2 text-[11px] text-foreground/85">
            <input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} aria-label={`Enable agent ${agent.name}`} />
            Enabled
          </label>
          {(
            [
              ["Model override", model, setModel, "default model"],
              ["Prewalk override", prewalk, setPrewalk, "default prewalk"],
              ["Advisor override", advisor, setAdvisor, "default advisor"],
            ] as const
          ).map(([label, value, setValue, placeholder]) => (
            <label key={label} className="block text-[11px] text-foreground/85">
              {label}
              <input
                type="text"
                value={value}
                disabled={busy}
                placeholder={placeholder}
                onChange={(event) => setValue(event.target.value)}
                aria-label={`${label} for ${agent.name}`}
                className="mt-0.5 block w-full rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] text-foreground/85 outline-none"
              />
            </label>
          ))}
          <p className="text-[10px] leading-relaxed text-muted-foreground">Empty clears that override.</p>
          <Button type="submit" variant="ghost" size="xs" disabled={busy} aria-label={`Save configuration for ${agent.name}`}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>
      ) : null}
    </li>
  );
}

/** Pure agents rendering used by the hook-backed surface and renderer tests. */
export function CediaAgentsPanel({
  state,
  selectedAgentId = null,
  onSelectAgent,
  transcript = null,
  transcriptPages,
  transcriptBusy = false,
  onLoadMore,
  agentError = null,
  agentBusy = false,
  onKillAgent,
  onReviveAgent,
  activeTab = "agents",
  onTabChange,
  configState = null,
  configBusy = false,
  onConfigureAgent,
}: CediaAgentsPanelProps) {
  if (state?.state === "unavailable") {
    return (
      <ComposerStackedPanel data-testid="cedia-agents-surface" aria-label="Cedia agents" className="px-2.5 py-2">
        <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
      </ComposerStackedPanel>
    );
  }

  if (!state) return null;
  const agentById = new Map(state.agents.map((agent) => [agent.id, agent]));
  const selectedAgent = selectedAgentId ? agentById.get(selectedAgentId) : undefined;
  const pages = transcriptPages ?? (transcript ? [transcript] : []);
  return (
    <ComposerStackedPanel data-testid="cedia-agents-surface" aria-label="Cedia agents" className="space-y-2 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <UsersIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground/85">Agents</span>
        <div role="tablist" aria-label="Agents sections" className="ml-auto flex shrink-0 gap-1">
          {(["agents", "config"] as const).map((tab) => (
            <Button
              key={tab}
              type="button"
              variant="ghost"
              size="xs"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => onTabChange?.(tab)}
              aria-label={`Show ${tab === "agents" ? "roster" : "configuration"} section`}
            >
              {tab === "agents" ? "Roster" : "Config"}
            </Button>
          ))}
        </div>
      </div>
      {agentError ? (
        <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">
          {agentError}
        </p>
      ) : null}
      {activeTab === "config" ? (
        configState?.state === "unavailable" ? (
          <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{configState.reason}</p>
        ) : !configState ? null : configState.agents.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">No agents discovered</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-auto pr-1">
            {configState.agents.map((agent) => (
              <ConfigRow key={agent.name} agent={agent} busy={configBusy || agentBusy} onConfigure={onConfigureAgent} />
            ))}
          </ul>
        )
      ) : state.agents.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">Nothing to show</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-auto pr-1">
          {state.agents.map((agent) => {
            const parent = agent.parentId ? agentById.get(agent.parentId) : undefined;
            return (
              <AgentRow
                key={agent.id}
                agent={agent}
                parentName={parent?.name}
                selected={selectedAgentId === agent.id}
                busy={agentBusy}
                onSelect={agent.sessionFile ? () => onSelectAgent?.(agent.id) : undefined}
                onKill={onKillAgent}
                onRevive={onReviveAgent}
              />
            );
          })}
        </ul>
      )}
      <Transcript
        agent={selectedAgent}
        pages={pages}
        busy={transcriptBusy}
        onLoadMore={onLoadMore}
      />
    </ComposerStackedPanel>
  );
}

export function CediaAgentsSurface({ sessionId }: { readonly sessionId: string }) {
  const agentsQuery = useQuery(serverAgentsQueryOptions(sessionId, sessionId.length > 0));
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [fromByte, setFromByte] = useState(0);
  const [transcriptPages, setTranscriptPages] = useState<CediaAgentTranscriptAnswer[]>([]);

  const selectedAgent = agentsQuery.data?.state === "available"
    ? agentsQuery.data.agents.find((agent) => agent.id === selectedAgentId)
    : undefined;

  useEffect(() => {
    if (selectedAgentId && !selectedAgent) {
      setSelectedAgentId(null);
      setTranscriptPages([]);
    }
  }, [selectedAgent, selectedAgentId]);

  const transcriptQuery = useQuery(
    serverAgentTranscriptQueryOptions(
      sessionId,
      selectedAgentId ?? "",
      fromByte,
      selectedAgentId !== null && selectedAgent !== undefined,
    ),
  );

  useEffect(() => {
    if (!transcriptQuery.data || !selectedAgentId) return;
    const page = transcriptQuery.data;
    const key = `${selectedAgentId}:${page.state === "available" ? page.fromByte : "unavailable"}`;
    setTranscriptPages((current) => {
      const existingIndex = current.findIndex((existing) =>
        `${selectedAgentId}:${existing.state === "available" ? existing.fromByte : "unavailable"}` === key,
      );
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = page;
        return next;
      }
      if (page.state === "available" && page.reset) return [page];
      return fromByte === 0 ? [page] : [...current, page];
    });
  }, [fromByte, selectedAgentId, transcriptQuery.data]);

  const onSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setFromByte(0);
    setTranscriptPages([]);
  };
  const queryClient = useQueryClient();
  const killMutation = useMutation(serverAgentsKillMutationOptions({ sessionId, queryClient }));
  const reviveMutation = useMutation(serverAgentsReviveMutationOptions({ sessionId, queryClient }));
  const configMutation = useMutation(serverAgentsConfigMutationOptions({ sessionId, queryClient }));
  const [activeTab, setActiveTab] = useState<"agents" | "config">("agents");
  const configsQuery = useQuery(serverAgentConfigsQueryOptions(sessionId, sessionId.length > 0 && activeTab === "config"));
  const [agentError, setAgentError] = useState<string | null>(null);

  const onKillAgent = useCallback(async (agent: CediaAgentRow) => {
    if (killMutation.isPending) return;
    const confirmed = await ensureNativeApi().dialogs.confirm(
      `Kill ${agent.name}? Its running turn stops and the row is released.`,
    );
    if (!confirmed) return;
    setAgentError(null);
    try {
      await killMutation.mutateAsync({ id: agent.id });
    } catch (error) {
      setAgentError(error instanceof Error && error.message.trim().length > 0 ? error.message : "The Cedia agent kill is unavailable.");
    }
  }, [killMutation, sessionId]);

  const onReviveAgent = useCallback(async (agent: CediaAgentRow) => {
    if (reviveMutation.isPending) return;
    const confirmed = await ensureNativeApi().dialogs.confirm(
      `Revive ${agent.name}? It resumes through the lifecycle's own restore.`,
    );
    if (!confirmed) return;
    setAgentError(null);
    try {
      await reviveMutation.mutateAsync({ id: agent.id });
    } catch (error) {
      setAgentError(error instanceof Error && error.message.trim().length > 0 ? error.message : "The Cedia agent revive is unavailable.");
    }
  }, [reviveMutation, sessionId]);

  const onConfigureAgent = useCallback(async (agent: CediaAgentConfigRow, input: CediaAgentConfigInput) => {
    if (configMutation.isPending) return;
    const changes = [
      `enabled ${input.enabled === false ? "off" : "on"}`,
      `model ${input.model && input.model.trim().length > 0 ? input.model.trim() : "default"}`,
      `prewalk ${input.prewalk && input.prewalk.trim().length > 0 ? input.prewalk.trim() : "default"}`,
      `advisor ${input.advisor && input.advisor.trim().length > 0 ? input.advisor.trim() : "default"}`,
    ].join(", ");
    const confirmed = await ensureNativeApi().dialogs.confirm(
      `Configure ${agent.name}? ${changes}. Empty fields clear that override.`,
    );
    if (!confirmed) return;
    setAgentError(null);
    try {
      await configMutation.mutateAsync(input);
    } catch (error) {
      setAgentError(error instanceof Error && error.message.trim().length > 0 ? error.message : "The Cedia agent config is unavailable.");
    }
  }, [configMutation, sessionId]);
  const lastPage = transcriptPages[transcriptPages.length - 1];
  const onLoadMore = () => {
    if (transcriptQuery.isFetching || lastPage?.state !== "available" || !lastPage.truncated) return;
    if (lastPage.nextByte <= lastPage.fromByte) return;
    setFromByte(lastPage.nextByte);
  };

  const state = agentsQuery.data ?? (agentsQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(agentsQuery.error) }
    : null);
  const configState = configsQuery.data ?? (configsQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(configsQuery.error) }
    : null);
  const pages = transcriptPages.length > 0
    ? transcriptPages
    : transcriptQuery.isError && selectedAgent
      ? [{ state: "unavailable" as const, reason: errorMessage(transcriptQuery.error) }]
      : transcriptPages;
  return (
    <CediaAgentsPanel
      state={state}
      selectedAgentId={selectedAgentId}
      onSelectAgent={onSelectAgent}
      transcriptPages={pages}
      transcriptBusy={transcriptQuery.isFetching}
      onLoadMore={onLoadMore}
      agentError={agentError}
      agentBusy={killMutation.isPending || reviveMutation.isPending || configMutation.isPending}
      onKillAgent={onKillAgent}
      onReviveAgent={onReviveAgent}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      configState={configState}
      configBusy={configMutation.isPending}
      onConfigureAgent={onConfigureAgent}
    />
  );
}
