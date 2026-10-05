// FILE: OmpSettingsPanel.tsx
// Purpose: Render the host-owned OMP settings inventory and revision-safe editor.
// Layer: Settings panel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import {
  getOmpSettingsApi,
  mutateOmpSettings,
  ompSettingsKeysQueryOptions,
  ompSettingsProjectsQueryOptions,
  ompSettingsSessionsQueryOptions,
  ompSettingScopedValueQueryOptions,
  previewOmpSettingsReset,
  type OmpSettingsMutation,
  type OmpSettingsResetPreviewEntry,
  type OmpSettingsScopeSelection,
  type OmpSettingValueAnswer,
} from "~/lib/ompSettingsReactQuery";
import {
  serverQueryKeys,
  serverPolicyQueryOptions,
  type CediaPolicyMode,
  type CediaPolicyAnswer,
} from "~/lib/serverReactQuery";
import {
  SETTINGS_CARD_ROW_CLASS_NAME,
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
} from "~/settingsPanelStyles";

import {
  filterOmpSettingKeys,
  formatOmpSettingValue,
  groupOmpSettingKeys,
  isOmpBasicKey,
  isOmpSettingMasked,
  isOmpSettingsStaleRevisionError,
  ompSettingApplyLabel,
  ompSettingChoices,
  ompSettingDispositionLabel,
  ompSettingProvenanceLabel,
  parseOmpSettingInput,
  settingValueToEditorText,
  type OmpSettingKey,
  type OmpSettingScope,
  type OmpSettingValue,
} from "./OmpSettingsPanel.logic";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsListRow,
  SettingsSectionShell,
} from "./SettingsPanelPrimitives";

export interface OmpSettingsPanelProps {
  readonly active?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function availableValue(answer: OmpSettingValueAnswer | undefined): OmpSettingValue | undefined {
  return answer?.state === "available" ? answer : undefined;
}

function useLazyRowVisibility(active: boolean) {
  const [visible, setVisible] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !rowRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "240px" },
    );
    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [active]);

  return { rowRef, visible };
}

function SettingEditor({
  setting,
  draft,
  onChange,
}: {
  readonly setting: OmpSettingKey;
  readonly draft: string;
  readonly onChange: (next: string) => void;
}) {
  const type = setting.type.trim().toLocaleLowerCase();
  const choices = ompSettingChoices(setting);
  if (choices) {
    // The runtime publishes these values, so the control offers them instead of asking the
    // owner to type a string the same schema would refuse.
    return (
      <select
        value={choices.includes(draft) ? draft : ""}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`Edit ${setting.path}`}
        className="w-full rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-control-opaque)] px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:w-64"
      >
        <option value="" disabled>
          Choose a value
        </option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  }
  if (type === "boolean") {
    return (
      <Switch
        checked={draft === "true"}
        onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
        aria-label={`Edit ${setting.path}`}
      />
    );
  }
  if (type === "array" || type === "record") {
    return (
      <textarea
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`Edit ${setting.path}`}
        className="min-h-20 w-full rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-control-opaque)] px-2 py-1.5 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:w-72"
        spellCheck={false}
      />
    );
  }
  return (
    <Input
      type={type === "number" ? "number" : "text"}
      value={draft}
      onChange={(event) => onChange(event.target.value)}
      aria-label={`Edit ${setting.path}`}
      placeholder={type === "enum" ? "Enum value (this runtime publishes no choices; OMP validates)" : undefined}
      inputMode={type === "number" ? "decimal" : undefined}
      variant="soft"
      className="w-full sm:w-64"
    />
  );
}

function scopeBadge(selection: OmpSettingsScopeSelection): string {
  if (selection.scope === "project") return "Project";
  if (selection.scope === "session") return "Session";
  return "Shared";
}

/** Give an unpublished path a readable title without guessing at a product-specific label. */
function humanizeOmpSettingPath(path: string): string {
  const leaf = path.split(".").at(-1) ?? path;
  const words = leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return words ? words.charAt(0).toLocaleUpperCase() + words.slice(1) : path;
}

function OmpSettingRow({
  setting,
  active,
  selection,
}: {
  readonly setting: OmpSettingKey;
  readonly active: boolean;
  readonly selection: OmpSettingsScopeSelection;
}) {
  const { rowRef, visible } = useLazyRowVisibility(active);
  const queryClient = useQueryClient();
  const [loadRequested, setLoadRequested] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedRevision, setSavedRevision] = useState<string | null>(null);
  const shouldLoad = active && (visible || loadRequested);
  const valueQuery = useQuery(ompSettingScopedValueQueryOptions(setting.path, selection, shouldLoad));
  const value = availableValue(valueQuery.data);

  useEffect(() => {
    if (!editing && value) setDraft(settingValueToEditorText(value));
  }, [editing, value?.settingsRevision]);

  const writeMutation = useMutation({
    mutationFn: async (input: { readonly value: unknown; readonly expectedRevision: string }) => {
      const mutation: OmpSettingsMutation =
        selection.scope === "project" && selection.projectId
          ? {
              context: { scope: "project", projectId: selection.projectId },
              expectedRevision: input.expectedRevision,
              changes: [{ path: setting.path, operation: "set", value: input.value }],
            }
          : {
              context: { scope: "global" },
              expectedRevision: input.expectedRevision,
              changes: [{ path: setting.path, operation: "set", value: input.value }],
            };
      try {
        return await mutateOmpSettings(mutation);
      } catch (error) {
        // An older window shell has no scoped contract: fall back to the legacy
        // single-path write, which keeps its editable-only rule by construction.
        if (!(error instanceof Error) || !error.message.includes("newer window shell")) throw error;
        if (setting.disposition !== "editable") throw error;
        const written = await getOmpSettingsApi().setOmpSetting({
          path: setting.path,
          value: input.value,
          expectedRevision: input.expectedRevision,
        });
        return { values: [], scope: "global" as const, legacy: written };
      }
    },
  });

  const writable =
    (setting.disposition === "editable" || setting.disposition === "advanced") &&
    selection.scope !== "session";
  const beginEditing = useCallback(() => {
    if (!value || !writable) return;
    setDraft(settingValueToEditorText(value));
    setParseError(null);
    setConflict(false);
    setSavedRevision(null);
    setEditing(true);
  }, [value, writable]);

  const save = useCallback(async () => {
    if (!value || !writable) return;
    setParseError(null);
    setSavedRevision(null);
    let parsed: unknown;
    try {
      parsed = parseOmpSettingInput(setting.type, draft);
    } catch (error) {
      setParseError(errorMessage(error));
      return;
    }
    try {
      const outcome = await writeMutation.mutateAsync({ value: parsed, expectedRevision: value.settingsRevision });
      if ("legacy" in outcome) {
        const written = outcome.legacy as { state: string; reason?: string };
        if (written.state !== "available") {
          setParseError(`No live OMP runtime: ${written.reason ?? "unknown"}`);
          return;
        }
      }
      // A codexResets.autoRedeem write changes the stored half of the policy row. Re-read it
      // through the same read-only route instead of deriving a policy from this editable value.
      if (setting.path === "codexResets.autoRedeem") {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.policy() });
      }
      const readback = await valueQuery.refetch();
      const effective = availableValue(readback.data);
      if (!effective) {
        setParseError("The write was accepted, but Cedia could not read the effective value back.");
        return;
      }
      setEditing(false);
      setConflict(false);
      setSavedRevision(effective.settingsRevision);
    } catch (error) {
      if (isOmpSettingsStaleRevisionError(error)) {
        setConflict(true);
        setParseError("The setting changed elsewhere. Refresh before retrying so this value is never silently overwritten.");
      } else {
        setParseError(errorMessage(error));
      }
    }
  }, [draft, queryClient, setting.path, setting.type, value, valueQuery, writeMutation, writable]);

  const refreshAndRetry = useCallback(async () => {
    setConflict(false);
    setParseError(null);
    setSavedRevision(null);
    try {
      const refreshed = await valueQuery.refetch();
      const latest = availableValue(refreshed.data);
      if (latest) {
        setDraft(settingValueToEditorText(latest));
        setEditing(true);
      } else {
        setParseError("Cedia could not read the latest value. Retry when the OMP runtime is available.");
      }
    } catch (error) {
      setParseError(`Could not refresh the setting: ${errorMessage(error)}`);
    }
  }, [valueQuery]);

  const technicalDescription = setting.disposition === "editable" || setting.disposition === "advanced"
    ? `${setting.type} · ${ompSettingApplyLabel(setting)}`
    : `${ompSettingDispositionLabel(setting.disposition)} · ${setting.reason ?? "Cedia does not edit this path."} · ${ompSettingApplyLabel(setting)}`;
  const layerState = value ? `${ompSettingProvenanceLabel(value)} · ${scopeBadge(selection)} scope` : null;
  const masked = value && isOmpSettingMasked(value);
  const defaultText = setting.defaultJson === undefined ? null : `Default ${JSON.stringify(setting.defaultJson)}`;
  const envText = setting.envVar ? `Environment overrides with ${setting.envVar}` : null;
  const labelText = setting.label && setting.label !== setting.path ? setting.label : null;
  const displayLabel = labelText ?? humanizeOmpSettingPath(setting.path);
  const valueText = value
    ? formatOmpSettingValue(value)
    : valueQuery.data?.state === "unavailable"
      ? `No live OMP runtime: ${valueQuery.data.reason}`
      : valueQuery.isError
        ? `Could not read value: ${errorMessage(valueQuery.error)}`
        : valueQuery.isPending && shouldLoad
          ? "Reading effective value…"
          : "Value not loaded yet";
  const canEdit = writable && value !== undefined && !value.credential && !value.redacted && value.tooLarge !== true;

  return (
    <div ref={rowRef} className={SETTINGS_CARD_ROW_CLASS_NAME} data-slot="settings-row">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className={cn(SETTINGS_CARD_ROW_TITLE_CLASS_NAME, "break-words")}>{displayLabel}</h3>
            <span className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {ompSettingDispositionLabel(setting.disposition)}
            </span>
          </div>
          {setting.description ? <p className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>{setting.description}</p> : null}
          <div className="pt-1 text-xs text-muted-foreground">
            <span className="break-words font-mono">{valueText}</span>
            {layerState ? <span className="ml-2">({layerState})</span> : null}
          </div>
          <p className="pt-1 text-xs text-muted-foreground">{ompSettingApplyLabel(setting)}.</p>
          {masked && value && Object.hasOwn(value, "storedGlobal") ? (
            <p className="pt-1 text-xs text-muted-foreground">
              A saved shared value (<span className="font-mono">{JSON.stringify(value.storedGlobal)}</span>) is masked by a stronger layer right now.
            </p>
          ) : null}
          <details className="pt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none text-foreground/70 hover:text-foreground">
              Technical details
            </summary>
            <div className="mt-2 space-y-1">
              <p>
                Path: <code className="font-mono text-foreground/80">{setting.path}</code>
              </p>
              <p>
                Schema and apply: <span className="font-mono text-foreground/80">{technicalDescription}</span>
              </p>
              <p>
                Scope: <span className="text-foreground/80">{scopeBadge(selection)}</span>
                {selection.scope === "session"
                  ? " · inspect-only live task view"
                  : setting.projectWritable
                    ? " · project editing supported"
                    : " · project editing unavailable"}
              </p>
              {defaultText && !(value && value.configured) ? <p>{defaultText}.</p> : null}
              {envText ? <p>{envText}.</p> : null}
            </div>
          </details>
          {selection.scope === "session" ? (
            <p className="pt-1 text-xs text-muted-foreground">
              Inspect-only view of a live task. Change persistent settings in the Shared or Project scope; drive this task from its composer.
            </p>
          ) : null}
          {savedRevision ? (
            <p className="pt-1 text-xs text-muted-foreground">
              Saved and read back at revision <span className="font-mono">{savedRevision}</span>. A change may reach a running session after reload or in a new task.
            </p>
          ) : null}
          {parseError ? <p className="pt-1 text-xs text-destructive" role="alert">{parseError}</p> : null}
          {conflict ? (
            <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-destructive" role="alert">
              <span>This value is stale and was not written.</span>
              <Button size="xs" variant="destructive-outline" onClick={() => void refreshAndRetry()}>
                Refresh and retry
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          {!shouldLoad && !value && !valueQuery.isError ? (
            <Button size="xs" variant="outline" onClick={() => setLoadRequested(true)}>
              Load value
            </Button>
          ) : null}
          {canEdit && !editing ? (
            <Button size="xs" variant="outline" onClick={beginEditing}>
              Edit
            </Button>
          ) : null}
          {editing && value ? (
            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
              <SettingEditor setting={setting} draft={draft} onChange={setDraft} />
              <div className="flex justify-end gap-2">
                <Button size="xs" variant="ghost" onClick={() => { setEditing(false); setParseError(null); setConflict(false); }}>
                  Cancel
                </Button>
                <Button size="xs" variant="default" disabled={writeMutation.isPending || conflict} onClick={() => void save()}>
                  {writeMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function policyModeLabel(mode: CediaPolicyMode): string {
  return mode;
}

/** Read-only explanation of what Cedia's process applies to Codex reset redemption. */
export function CediaCreditPolicyPanel({ answer }: { readonly answer: CediaPolicyAnswer }) {
  return (
    <SettingsSectionShell title="Credit redemption policy">
      {answer.state === "unavailable" ? (
        <SettingsEmptyState layout="status">{answer.reason}</SettingsEmptyState>
      ) : (
        <SettingsCard>
          <SettingsListRow
            title="Cedia credit guard"
            description={
              <div className="space-y-1">
                <p>
                  Stored Codex reset setting: <span className="font-mono">{policyModeLabel(answer.answer.stored)}</span>
                </p>
                <p>
                  {answer.answer.guardActive ? "Effective in this Cedia process" : "Effective in this process"}: <span className="font-mono">{policyModeLabel(answer.answer.effective)}</span>
                </p>
                {answer.answer.guardActive ? (
                  answer.answer.overridden ? (
                    <p>
                      Cedia&apos;s active guard is why they differ. Reason: {answer.answer.reason}
                    </p>
                  ) : (
                    <p>
                      The stored value applies, and Cedia agrees with it. Reason: {answer.answer.reason}
                    </p>
                  )
                ) : (
                  <p>
                    No Cedia guard is set for this process, so OMP&apos;s own setting applies. Reason: {answer.answer.reason}
                  </p>
                )}
              </div>
            }
          />
        </SettingsCard>
      )}
    </SettingsSectionShell>
  );
}

function CediaCreditPolicySurface({ active }: { readonly active: boolean }) {
  const policyQuery = useQuery(serverPolicyQueryOptions(active));
  if (!active) return null;

  const answer = policyQuery.data ?? (policyQuery.isError
    ? { state: "unavailable" as const, reason: `Could not read policy: ${errorMessage(policyQuery.error)}` }
    : undefined);
  if (answer) return <CediaCreditPolicyPanel answer={answer} />;

  return (
    <SettingsSectionShell title="Credit redemption policy">
      <SettingsEmptyState layout="status">Reading the live Cedia policy…</SettingsEmptyState>
    </SettingsSectionShell>
  );
}

/**
 * A curated slice of the live OMP inventory for embedding in another section
 * (e.g. Permissions in General). Rows reuse the same revision-safe editor as
 * the full panel; paths the runtime does not publish render as an honest
 * empty state instead of invented controls.
 */
export function OmpSettingsSubset({
  paths,
  active = true,
  selection,
}: {
  readonly paths: readonly string[];
  readonly active?: boolean;
  readonly selection?: OmpSettingsScopeSelection;
}) {
  const scopeSelection = selection ?? { scope: "global" as const };
  const keysQuery = useQuery({ ...ompSettingsKeysQueryOptions(), enabled: active });
  const answer = keysQuery.data?.state === "available" ? keysQuery.data : undefined;
  const wanted = useMemo(() => {
    const selected = new Set(paths);
    return (answer?.keys ?? []).filter((key) => selected.has(key.path));
  }, [answer?.keys, paths]);

  if (!active) return null;
  if (keysQuery.isPending)
    return <SettingsEmptyState layout="status">Reading the live OMP settings…</SettingsEmptyState>;
  if (keysQuery.isError)
    return (
      <SettingsEmptyState layout="status" tone="destructive">
        Could not read OMP settings: {errorMessage(keysQuery.error)}
      </SettingsEmptyState>
    );
  if (!answer)
    return <SettingsEmptyState layout="status">No live OMP runtime.</SettingsEmptyState>;
  if (wanted.length === 0)
    return (
      <SettingsEmptyState layout="status">
        These settings are not published by this runtime.
      </SettingsEmptyState>
    );
  // No card of its own: callers embed this inside their section card.
  return (
    <>
      {wanted.map((setting) => (
        <OmpSettingRow key={setting.path} setting={setting} active={active} selection={scopeSelection} />
      ))}
    </>
  );
}

type OmpSettingsView = "basic" | "advanced";

export function OmpSettingsPanel({ active = true }: OmpSettingsPanelProps) {
  const queryClient = useQueryClient();
  const keysQuery = useQuery({ ...ompSettingsKeysQueryOptions(), enabled: active, refetchOnWindowFocus: true });
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<OmpSettingsView>("basic");
  const [scope, setScope] = useState<OmpSettingScope>("global");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<readonly OmpSettingsResetPreviewEntry[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const answer = keysQuery.data?.state === "available" ? keysQuery.data : undefined;
  const projectsQuery = useQuery({ ...ompSettingsProjectsQueryOptions(active && scope === "project") });
  const sessionsQuery = useQuery({ ...ompSettingsSessionsQueryOptions(projectId, active && scope === "session") });
  const projects = useMemo(
    () => (projectsQuery.data ?? []).filter(project => project.archived !== true),
    [projectsQuery.data],
  );
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const selection: OmpSettingsScopeSelection = useMemo(
    () => ({
      scope,
      ...(scope === "project" && projectId ? { projectId } : {}),
      ...(scope === "session" && sessionId ? { sessionId } : {}),
    }),
    [scope, projectId, sessionId],
  );
  const viewKeys = useMemo(() => {
    // Excluded keys are not working Cedia settings, even in Advanced.
    const keys = (answer?.keys ?? []).filter(key => key.disposition !== "excluded");
    if (view !== "basic") return keys;
    return keys.filter(isOmpBasicKey);
  }, [answer?.keys, view]);
  const filteredKeys = useMemo(() => filterOmpSettingKeys(viewKeys, filter), [viewKeys, filter]);
  const groups = useMemo(() => groupOmpSettingKeys(filteredKeys), [filteredKeys]);
  const scopeReady =
    scope === "global" || (scope === "project" && !!projectId) || (scope === "session" && !!sessionId);

  const runPreview = useCallback(async () => {
    setPreview(null);
    setPreviewError(null);
    try {
      // Preview the visible category: every configured global override in view.
      const paths = viewKeys
        .filter(key => key.disposition !== "protected" && key.disposition !== "excluded")
        .map(key => key.path);
      setPreview(await previewOmpSettingsReset(paths));
    } catch (error) {
      setPreviewError(errorMessage(error));
    }
  }, [viewKeys]);

  const runReset = useCallback(async () => {
    if (!preview || scope === "session") return;
    setResetting(true);
    setPreviewError(null);
    try {
      const revision = preview.find(entry => entry.globalConfigured)?.current.settingsRevision;
      const mutation: OmpSettingsMutation =
        scope === "project" && projectId
          ? {
              context: { scope: "project", projectId },
              ...(revision === undefined ? {} : { expectedRevision: revision }),
              changes: preview.filter(entry => entry.globalConfigured).map(entry => ({ path: entry.path, operation: "unset" as const })),
            }
          : {
              context: { scope: "global" },
              ...(revision === undefined ? {} : { expectedRevision: revision }),
              changes: preview.filter(entry => entry.globalConfigured).map(entry => ({ path: entry.path, operation: "unset" as const })),
            };
      if (mutation.changes.length === 0) {
        setPreview(null);
        return;
      }
      await mutateOmpSettings(mutation);
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ["cedia", "omp-settings"] });
    } catch (error) {
      setPreviewError(errorMessage(error));
    } finally {
      setResetting(false);
    }
  }, [preview, scope, projectId, queryClient]);

  if (!active) return null;

  return (
    <>
      <CediaCreditPolicySurface active={active} />
      <SettingsSectionShell title="OMP settings">
        <div className="mb-3 space-y-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Setting paths and apply timing come from the live OMP inventory, with no task required. Basic shows frequent controls; Advanced reveals the complete classified inventory, including keys without OMP rows. Values are read only as rows enter view, and credential paths stay redacted. Each row states when a saved change takes effect, or when its timing is unclassified.
          </p>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Settings view">
            {(["basic", "advanced"] as const).map(choice => (
              <Button key={choice} size="xs" variant={view === choice ? "default" : "outline"} onClick={() => setView(choice)}>
                {choice === "basic" ? "Basic" : "Advanced"}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Settings scope">
            {(["global", "project", "session"] as const).map(choice => (
              <Button
                key={choice}
                size="xs"
                variant={scope === choice ? "default" : "outline"}
                onClick={() => {
                  setScope(choice);
                  setPreview(null);
                  setPreviewError(null);
                }}
              >
                {choice === "global" ? "Shared" : choice === "project" ? "Project" : "Session"}
              </Button>
            ))}
          </div>
          {scope === "project" ? (
            <select
              value={projectId ?? ""}
              onChange={event => {
                setProjectId(event.target.value || undefined);
                setPreview(null);
              }}
              aria-label="Project scope"
              className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background-control-opaque)] px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <option value="" disabled>Choose a project</option>
              {projectsQuery.isPending ? <option value="" disabled>Reading projects…</option> : null}
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          ) : null}
          {scope === "session" ? (
            <select
              value={sessionId ?? ""}
              onChange={event => setSessionId(event.target.value || undefined)}
              aria-label="Session scope"
              className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background-control-opaque)] px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <option value="" disabled>Choose a live task</option>
              {sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
          ) : null}
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by path, label, group or help text"
            aria-label="Filter OMP settings"
            variant="soft"
            className="w-full"
          />
        </div>

        {scope !== "global" && !scopeReady ? (
          <SettingsEmptyState layout="status">
            {scope === "project"
              ? "Choose a project to inspect its configuration. Project writes resolve the trusted directory and refuse while the IDE holds its config dirty."
              : "Choose a live task for an inspect-only view. Session controls stay in the task; nothing here starts, steers or rewrites it."}
          </SettingsEmptyState>
        ) : null}
        {keysQuery.isPending ? <SettingsEmptyState layout="status">Reading the live OMP settings inventory…</SettingsEmptyState> : null}
        {keysQuery.isError ? (
          <SettingsEmptyState layout="status" tone="destructive">Could not read OMP settings: {errorMessage(keysQuery.error)}</SettingsEmptyState>
        ) : null}
        {keysQuery.data?.state === "unavailable" ? (
          <SettingsEmptyState layout="status">No OMP configuration is reachable. {keysQuery.data.reason}</SettingsEmptyState>
        ) : null}
        {answer && scopeReady && groups.length === 0 ? <SettingsEmptyState layout="status">No OMP settings match this filter.</SettingsEmptyState> : null}
        {answer && scopeReady ? groups.map((group) => (
          <section key={group.label} className="mt-6 space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h2>
            <SettingsCard>
              {group.keys.map((setting) => (
                <OmpSettingRow key={`${selection.scope}:${selection.projectId ?? ""}:${selection.sessionId ?? ""}:${setting.path}`} setting={setting} active={active} selection={selection} />
              ))}
            </SettingsCard>
          </section>
        )) : null}
        {answer && scopeReady && scope !== "session" ? (
          <div className="mt-6 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="xs" variant="outline" onClick={() => void runPreview()}>
                Preview {scope === "project" ? "project" : "shared"} reset
              </Button>
              {preview ? (
                <Button size="xs" variant="destructive-outline" disabled={resetting || preview.every(entry => !entry.globalConfigured)} onClick={() => void runReset()}>
                  {resetting ? "Resetting…" : `Reset ${preview.filter(entry => entry.globalConfigured).length} overrides`}
                </Button>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Reset removes only explicit overrides in this view and reveals the next inherited value. Credentials, files, history, devices and source resources are never part of a reset.
            </p>
            {previewError ? <p className="text-xs text-destructive" role="alert">{previewError}</p> : null}
            {preview ? (
              <SettingsCard>
                {preview.filter(entry => entry.globalConfigured).map(entry => (
                  <SettingsListRow key={entry.path} title={entry.path} description={`Currently ${JSON.stringify(entry.current.value)}`} />
                ))}
                {preview.every(entry => !entry.globalConfigured) ? (
                  <SettingsListRow title="Nothing to reset" description="No explicit overrides in this view." />
                ) : null}
              </SettingsCard>
            ) : null}
          </div>
        ) : null}
      </SettingsSectionShell>
    </>
  );
}
