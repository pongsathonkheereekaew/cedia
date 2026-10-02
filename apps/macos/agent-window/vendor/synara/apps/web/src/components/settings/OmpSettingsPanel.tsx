// FILE: OmpSettingsPanel.tsx
// Purpose: Render the host-owned OMP settings inventory and revision-safe editor.
// Layer: Settings panel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import {
  ompSettingValueQueryOptions,
  ompSettingsKeysQueryOptions,
  getOmpSettingsApi,
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
  isOmpSettingsStaleRevisionError,
  ompSettingApplyLabel,
  ompSettingChoices,
  ompSettingDispositionLabel,
  parseOmpSettingInput,
  settingValueToEditorText,
  type OmpSettingKey,
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

function OmpSettingRow({ setting, active }: { readonly setting: OmpSettingKey; readonly active: boolean }) {
  const { rowRef, visible } = useLazyRowVisibility(active);
  const queryClient = useQueryClient();
  const [loadRequested, setLoadRequested] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedRevision, setSavedRevision] = useState<string | null>(null);
  const shouldLoad = active && (visible || loadRequested);
  const valueQuery = useQuery(ompSettingValueQueryOptions(setting.path, shouldLoad));
  const value = availableValue(valueQuery.data);

  useEffect(() => {
    if (!editing && value) setDraft(settingValueToEditorText(value));
  }, [editing, value?.settingsRevision]);

  const writeMutation = useMutation({
    mutationFn: async (input: { readonly value: unknown; readonly expectedRevision: string }) => {
      const written = await getOmpSettingsApi().setOmpSetting({
        path: setting.path,
        value: input.value,
        expectedRevision: input.expectedRevision,
      });
      // A successful PATCH is a readback from the host. The row still refetches below so the
      // success state is shown only after the renderer has observed the new effective value.
      return written;
    },
  });

  const beginEditing = useCallback(() => {
    if (!value || setting.disposition !== "editable") return;
    setDraft(settingValueToEditorText(value));
    setParseError(null);
    setConflict(false);
    setSavedRevision(null);
    setEditing(true);
  }, [setting.disposition, value]);

  const save = useCallback(async () => {
    if (!value || setting.disposition !== "editable") return;
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
      const written = await writeMutation.mutateAsync({ value: parsed, expectedRevision: value.settingsRevision });
      if (written.state !== "available") {
        setParseError(`No live OMP runtime: ${written.reason}`);
        return;
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
  }, [draft, queryClient, setting.disposition, setting.type, value, valueQuery, writeMutation]);

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

  const description = setting.disposition === "editable"
    ? `${setting.type}${setting.projectWritable ? " · project layer supported" : ""} · ${ompSettingApplyLabel(setting)}`
    : `${ompSettingDispositionLabel(setting.disposition)} · ${setting.reason ?? "Cedia does not edit this path."} · ${ompSettingApplyLabel(setting)}`;
  const layerState = value ? (value.configured ? "Configured layer" : "Schema default") : null;
  const valueText = value
    ? formatOmpSettingValue(value)
    : valueQuery.data?.state === "unavailable"
      ? `No live OMP runtime: ${valueQuery.data.reason}`
      : valueQuery.isError
        ? `Could not read value: ${errorMessage(valueQuery.error)}`
        : valueQuery.isPending && shouldLoad
          ? "Reading effective value…"
          : "Value not loaded yet";
  const canEdit = setting.disposition === "editable" && value !== undefined && !value.credential && !value.redacted && value.tooLarge !== true;

  return (
    <div ref={rowRef} className={SETTINGS_CARD_ROW_CLASS_NAME} data-slot="settings-row">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>{setting.path}</h3>
            <span className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {ompSettingDispositionLabel(setting.disposition)}
            </span>
          </div>
          <p className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>{description}</p>
          <div className="pt-1 text-xs text-muted-foreground">
            <span className="font-mono">{valueText}</span>
            {layerState ? <span className="ml-2">({layerState})</span> : null}
          </div>
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
}: {
  readonly paths: readonly string[];
  readonly active?: boolean;
}) {
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
        <OmpSettingRow key={setting.path} setting={setting} active={active} />
      ))}
    </>
  );
}

export function OmpSettingsPanel({ active = true }: OmpSettingsPanelProps) {
  const keysQuery = useQuery({ ...ompSettingsKeysQueryOptions(), enabled: active });
  const [filter, setFilter] = useState("");
  const answer = keysQuery.data?.state === "available" ? keysQuery.data : undefined;
  const filteredKeys = useMemo(
    () => filterOmpSettingKeys(answer?.keys ?? [], filter),
    [answer?.keys, filter],
  );
  const groups = useMemo(() => groupOmpSettingKeys(filteredKeys), [filteredKeys]);

  if (!active) return null;

  return (
    <>
      <CediaCreditPolicySurface active={active} />
      <SettingsSectionShell title="OMP settings">
        <div className="mb-3 space-y-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Setting paths and apply timing come from the live OMP inventory. Values are read only as rows enter view, and credential paths stay redacted. Each row states when a saved change takes effect, or when its timing is unclassified.
          </p>
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by setting path or tab"
            aria-label="Filter OMP settings"
            variant="soft"
            className="w-full"
          />
        </div>

        {keysQuery.isPending ? <SettingsEmptyState layout="status">Reading the live OMP settings inventory…</SettingsEmptyState> : null}
        {keysQuery.isError ? (
          <SettingsEmptyState layout="status" tone="destructive">Could not read OMP settings: {errorMessage(keysQuery.error)}</SettingsEmptyState>
        ) : null}
        {keysQuery.data?.state === "unavailable" ? (
          <SettingsEmptyState layout="status">No live OMP runtime. {keysQuery.data.reason}</SettingsEmptyState>
        ) : null}
        {answer && groups.length === 0 ? <SettingsEmptyState layout="status">No OMP settings match this filter.</SettingsEmptyState> : null}
        {answer ? groups.map((group) => (
          <section key={group.label} className="mt-6 space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h2>
            <SettingsCard>
              {group.keys.map((setting) => <OmpSettingRow key={setting.path} setting={setting} active={active} />)}
            </SettingsCard>
          </section>
        )) : null}
      </SettingsSectionShell>
    </>
  );
}
