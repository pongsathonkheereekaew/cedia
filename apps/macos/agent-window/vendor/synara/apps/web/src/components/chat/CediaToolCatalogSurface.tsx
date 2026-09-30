// FILE: CediaToolCatalogSurface.tsx
// Purpose: Show the runtime-owned live tool catalog: registry identity, source class and activation.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { HistoryIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import { Button } from "../ui/button";
import {
  serverToolActiveSetMutationOptions,
  serverToolCatalogQueryOptions,
  serverToolCodeModeQueryOptions,
  serverToolExtensionSetMutationOptions,
  serverToolExtensionsQueryOptions,
  serverToolRefreshSkillsMutationOptions,
  type CediaCodeModeAnswer,
  type CediaExtensionEntry,
  type CediaExtensionsAnswer,
  type CediaToolCatalogAnswer,
  type CediaToolCatalogEntry,
} from "../../lib/serverReactQuery";
import { ompSettingValueQueryOptions } from "../../lib/ompSettingsReactQuery";

function errorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "The Cedia tool catalog is unavailable.";
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0
    ? `${error.message} (${code})`
    : error.message;
}

function sourceLabel(source: CediaToolCatalogEntry["source"]): string {
  switch (source) {
    case "builtin":
      return "Built-in";
    case "mcp":
      return "MCP";
    case "sdk":
      return "SDK host";
    case "extension":
      return "Extension";
  }
}
/**
 * Provider-backed dynamic tools the runtime registers at session start only when their
 * setting is on and their backing provider or worker resolves (see the session tool setup
 * in `upstream/omp/packages/coding-agent/src/sdk.ts`). When the live catalog lacks one,
 * the panel names the requirements instead of leaving a silent hole. Re-verify against
 * that registration code before changing an entry; renderer tests pin the names against
 * the dated audit.
 */
export const DYNAMIC_TOOL_DEPENDENCIES: readonly { readonly name: string; readonly requires: string }[] = [
  { name: "generate_image", requires: "`generate_image.enabled` and an image-capable provider" },
  { name: "tts", requires: "`speechgen.enabled`" },
  // Browser and computer are eval preludes, not session tools: they never appear in the
  // catalog rows above. Their live signal is the Code Mode partition read (plan §8.2 O06):
  // a prelude the runtime reports enabled is registered, anything else names its setting.
  { name: "browser", requires: "`browser.enabled` and the runtime's browser eval prelude" },
  { name: "computer", requires: "`computer.enabled` and the runtime's computer eval prelude" },
];

/** Whether the Code Mode partition proves a prelude namespace registered this session.
 * The prelude's own enabled flag is the runtime's truth, independent of whether Code Mode's
 * direct partition is engaged. Anything unproven reads as absent, never as registered. */
export function codeModePreludeEnabled(codeMode: CediaCodeModeAnswer | null | undefined, name: string): boolean {
  if (!codeMode || codeMode.state !== "available") return false;
  return codeMode.preludes.some((prelude) => prelude.name === name && prelude.enabled);
}

/** Known provider tools absent from the live rows. Pure; covered by renderer tests. */
export function dynamicToolDependencies(
  tools: readonly CediaToolCatalogEntry[],
  codeMode?: CediaCodeModeAnswer | null,
): { readonly name: string; readonly requires: string }[] {
  return DYNAMIC_TOOL_DEPENDENCIES.filter((dep) => {
    if (dep.name === "browser" || dep.name === "computer") return !codeModePreludeEnabled(codeMode, dep.name);
    return !tools.some((tool) => tool.name === dep.name);
  });
}

/** Read a boolean OMP setting value answer; anything else (including a 403) is unknown. */
export function readSettingBoolean(data: unknown): boolean | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const value = (data as Record<string, unknown>).value;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * The sentence a dependency row shows once the setting is known. Unknown (still loading,
 * failed, or a controller refused) keeps the generic requirements text; a known value names
 * the half responsible. `generate_image` needs its setting *and* a resolved provider, while
 * `tts` registers unconditionally once its setting is on — so setting-on-but-absent can
 * only be a tool selection filter.
 */
export function dynamicToolDetail(
  dep: { readonly name: string; readonly requires: string },
  setting: boolean | undefined,
  preludeEnabled?: boolean,
): string {
  if (dep.name === "browser" || dep.name === "computer") {
    const flag = `\`${dep.name}.enabled\``;
    if (setting === undefined) {
      return `Not registered in this session. Requires ${dep.requires}. The runtime reports its eval preludes through the Code Mode partition read.`;
    }
    if (!setting) {
      return `Not registered in this session. ${flag} is off — turn it on in Settings.`;
    }
    if (preludeEnabled) {
      return `Registered in this session through the runtime's ${dep.name} eval prelude.`;
    }
    return `Not registered in this session. ${flag} is on, but the runtime did not enable the ${dep.name} prelude in this session.`;
  }
  if (setting === undefined) {
    return `Not registered in this session. Requires ${dep.requires}. The runtime registers it at session start only when the requirements resolve.`;
  }
  if (dep.name === "generate_image") {
    return setting
      ? "Not registered in this session. `generate_image.enabled` is on, but no image-capable provider resolved at session start."
      : "Not registered in this session. `generate_image.enabled` is off — turn it on in Settings.";
  }
  if (dep.name === "tts") {
    return setting
      ? "Not registered in this session even though `speechgen.enabled` is on — a tool selection filter may exclude it."
      : "Not registered in this session. `speechgen.enabled` is off — turn it on in Settings.";
  }
  return `Not registered in this session. Requires ${dep.requires}. The runtime registers it at session start only when the requirements resolve.`;
}

/** Extension state label for the catalog's Extensions section. */
export function extensionStateLabel(state: string, disabledReason?: string, shadowedBy?: string): string {
  if (state === "active") return "Active";
  if (state === "shadowed") return shadowedBy ? `Shadowed by ${shadowedBy}` : "Shadowed";
  return disabledReason ? `Disabled · ${disabledReason}` : "Disabled";
}

/** Pure extension-catalog rendering used by the hook-backed surface and renderer tests. */
export function CediaExtensionsSection({ extensions, onToggleExtension, extensionBusy = false }: {
  readonly extensions: CediaExtensionsAnswer | null;
  readonly onToggleExtension?: (entry: CediaExtensionEntry) => void;
  readonly extensionBusy?: boolean;
}) {
  if (extensions === null) {
    return (
      <div aria-label="Extensions" className="border-t border-border/60 pt-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">Reading extension catalog…</p>
      </div>
    );
  }
  if (extensions.available === false) {
    return (
      <div aria-label="Extensions" className="border-t border-border/60 pt-2">
        <p className="text-[11px] font-medium text-foreground/85">Extensions unavailable</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{extensions.reason}</p>
      </div>
    );
  }
  return (
    <div aria-label="Extensions" data-testid="cedia-extensions-section" className="border-t border-border/60 pt-2">
      <p className="text-[11px] font-medium text-foreground/85">
        Extensions · {extensions.total} discovered
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        Roots: {extensions.roots.configured.length > 0 ? extensions.roots.configured.join(", ") : "none configured"} ({extensions.roots.configuredLevel}, {extensions.roots.mode})
      </p>
      {extensions.extensions.length > 0 ? (
        <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto pr-1">
          {extensions.extensions.map((entry) => (
            <li
              key={entry.id}
              data-extension-id={entry.id}
              className="flex min-w-0 items-start gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <span className="truncate text-[11px] font-medium text-foreground/85" title={entry.displayName}>
                  {entry.displayName}
                </span>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {entry.kind} · {entry.source.providerName} · {entry.source.level} · {extensionStateLabel(entry.state, entry.disabledReason, entry.shadowedBy)}
                  {entry.description.length > 0 ? ` · ${entry.description}` : ""}
                  {entry.descriptionTruncated ? " · description truncated" : ""}
                </p>
              </div>
              {entry.state === "active" || entry.state === "disabled" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={extensionBusy}
                  onClick={() => onToggleExtension?.(entry)}
                  aria-label={entry.state === "active" ? `Disable extension ${entry.displayName}` : `Enable extension ${entry.displayName}`}
                >
                  {entry.state === "active" ? "Disable" : "Enable"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-[10px] text-muted-foreground">No extensions discovered for this task.</p>
      )}
      {extensions.truncated ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">The runtime truncated this list; more extensions are not shown.</p>
      ) : null}
    </div>
  );
}

/** Pure Code Mode partition rendering used by the hook-backed surface and renderer tests. */
export function CediaCodeModeSection({ codeMode }: { readonly codeMode: CediaCodeModeAnswer | null }) {
  if (codeMode === null) {
    return (
      <div aria-label="Code Mode partition" className="border-t border-border/60 pt-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">Reading Code Mode partition…</p>
      </div>
    );
  }
  if (codeMode.state === "unavailable") {
    return (
      <div aria-label="Code Mode partition" className="border-t border-border/60 pt-2">
        <p className="text-[11px] font-medium text-foreground/85">Code Mode unavailable</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{codeMode.reason}</p>
      </div>
    );
  }
  const direct = codeMode.directToolNames ?? [];
  return (
    <div aria-label="Code Mode partition" data-testid="cedia-codemode-section" className="border-t border-border/60 pt-2">
      <p className="text-[11px] font-medium text-foreground/85">
        Code Mode {codeMode.active ? `on · ${direct.length} direct tools` : "off"}
      </p>
      {codeMode.active && direct.length > 0 ? (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={direct.join(", ")}>
          {direct.join(", ")}
        </p>
      ) : null}
      {codeMode.preludes.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {codeMode.preludes.map((prelude) => (
            <li key={prelude.name} data-codemode-prelude={prelude.name} className="text-[10px] text-muted-foreground">
              {prelude.name} · {prelude.enabled ? "enabled" : "disabled"}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-[10px] text-muted-foreground">No eval prelude namespaces reported.</p>
      )}
    </div>
  );
}

export interface CediaToolCatalogPanelProps {
  readonly state: CediaToolCatalogAnswer | null;
  readonly codeMode?: CediaCodeModeAnswer | null;
  readonly extensions?: CediaExtensionsAnswer | null;
  readonly toggleError?: string | null;
  readonly busy?: boolean;
  readonly onToggle?: (tool: CediaToolCatalogEntry) => void;
  readonly onToggleExtension?: (entry: CediaExtensionEntry) => void;
  readonly onRefresh?: () => void;
  readonly settingValues?: Readonly<Record<string, boolean | undefined>>;
}

/** Pure catalog rendering used by the hook-backed surface and renderer tests. */
export function CediaToolCatalogPanel({ state, toggleError = null, busy = false, onToggle, onToggleExtension, onRefresh, settingValues, codeMode, extensions }: CediaToolCatalogPanelProps) {
  if (state === null) {
    return (
      <ComposerStackedPanel data-testid="cedia-tool-catalog-surface" aria-label="Tool catalog" className="px-2.5 py-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">Reading tool catalog…</p>
      </ComposerStackedPanel>
    );
  }

  if (state.state === "unavailable") {
    return (
      <ComposerStackedPanel data-testid="cedia-tool-catalog-surface" aria-label="Tool catalog" className="px-2.5 py-2">
        <p role="alert" className="text-[12px] font-medium text-foreground/85">Tool catalog unavailable</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
      </ComposerStackedPanel>
    );
  }

  const dependencies = dynamicToolDependencies(state.tools, codeMode);
  return (
    <ComposerStackedPanel data-testid="cedia-tool-catalog-surface" aria-label="Tool catalog" className="space-y-2 px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground/85">Tool catalog</span>
        <span className="text-[10px] text-muted-foreground">
          {state.activeCount} active of {state.total} registered
        </span>
        <span className="ml-auto">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => onRefresh?.()}
            aria-label="Refresh skills"
          >
            Refresh
          </Button>
        </span>
      </div>

      {toggleError ? (
        <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">
          {toggleError}
        </p>
      ) : null}
      {state.truncated ? (
        <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">
          The runtime truncated this catalog; more tools are not shown.
        </p>
      ) : null}

      {state.tools.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">The runtime registered no tools.</p>
      ) : (
        <ol aria-label="Session tools" className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {state.tools.map((tool) => (
            <li
              key={tool.name}
              data-tool-name={tool.name}
              data-tool-active={tool.active ? "true" : "false"}
              className={cn(
                "flex min-w-0 items-start gap-2 rounded-md border px-2 py-1.5",
                tool.active ? "border-primary/40 bg-primary/5" : "border-border/60 bg-background/40",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className={cn("size-1.5 shrink-0 rounded-full", tool.active ? "bg-primary" : "bg-muted-foreground/50")} aria-hidden="true" />
                  <span className="truncate text-[11px] font-medium text-foreground/85" title={tool.name}>
                    {tool.name}
                  </span>
                  {tool.active ? <span className="shrink-0 text-[10px] text-primary">Active</span> : null}
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {sourceLabel(tool.source)}
                  {tool.description.length > 0 ? ` · ${tool.description}` : ""}
                  {tool.descriptionTruncated ? " · description truncated" : ""}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => onToggle?.(tool)}
                aria-label={tool.active ? `Disable ${tool.name}` : `Enable ${tool.name}`}
              >
                {tool.active ? "Disable" : "Enable"}
              </Button>
            </li>
          ))}
        </ol>
      )}
      {dependencies.length > 0 ? (
        <div aria-label="Unavailable provider tools" className="border-t border-border/60 pt-2">
          <p className="text-[11px] font-medium text-foreground/85">Needs setup</p>
          <ul className="mt-1 space-y-1">
            {dependencies.map((dep) => (
              <li
                key={dep.name}
                data-tool-dependency={dep.name}
                className="min-w-0 rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
              >
                <span className="truncate text-[11px] font-medium text-foreground/85" title={dep.name}>
                  {dep.name}
                </span>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {dynamicToolDetail(dep, settingValues?.[dep.name], codeModePreludeEnabled(codeMode, dep.name))}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.state === "available" && codeMode !== undefined ? <CediaCodeModeSection codeMode={codeMode} /> : null}
      {state.state === "available" && extensions !== undefined ? <CediaExtensionsSection extensions={extensions} onToggleExtension={onToggleExtension} extensionBusy={busy} /> : null}
    </ComposerStackedPanel>
  );
}

export function CediaToolCatalogSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery(serverToolCatalogQueryOptions(sessionId, sessionId.length > 0));
  const codeModeQuery = useQuery(serverToolCodeModeQueryOptions(sessionId, sessionId.length > 0));
  const mutation = useMutation(serverToolActiveSetMutationOptions({ sessionId, queryClient }));
  const refresh = useMutation(serverToolRefreshSkillsMutationOptions({ sessionId, queryClient }));
  const extensionSet = useMutation(serverToolExtensionSetMutationOptions({ sessionId, queryClient }));
  const [toggleError, setToggleError] = useState<string | null>(null);

  const onToggle = useCallback(async (tool: CediaToolCatalogEntry) => {
    if (mutation.isPending) return;
    const current = catalogQuery.data;
    if (!current || current.state !== "available") return;
    const next = tool.active
      ? current.tools.filter((entry) => entry.name !== tool.name).map((entry) => entry.name)
      : [...current.tools.filter((entry) => entry.active).map((entry) => entry.name), tool.name];
    const confirmed = await ensureNativeApi().dialogs.confirm(
      tool.active
        ? `Disable ${tool.name}? The model will no longer be offered this tool until it is enabled again.`
        : `Enable ${tool.name}? The model will be offered this tool again.`,
    );
    if (!confirmed) return;
    setToggleError(null);
    try {
      await mutation.mutateAsync({ toolNames: next });
    } catch (error) {
      setToggleError(errorMessage(error));
    }
  }, [mutation, catalogQuery.data, sessionId]);

  const onRefresh = useCallback(async () => {
    if (refresh.isPending) return;
    setToggleError(null);
    try {
      await refresh.mutateAsync();
    } catch (error) {
      setToggleError(errorMessage(error));
    }
  }, [refresh]);
  const onToggleExtension = useCallback(async (entry: CediaExtensionEntry) => {
    if (extensionSet.isPending) return;
    const active = entry.state === "active";
    const confirmed = await ensureNativeApi().dialogs.confirm(
      active
        ? `Disable ${entry.displayName}? The model will no longer be offered this extension until it is enabled again.`
        : `Enable ${entry.displayName}? The model will be offered this extension again.`,
    );
    if (!confirmed) return;
    setToggleError(null);
    try {
      await extensionSet.mutateAsync({ id: entry.id, enabled: !active });
    } catch (error) {
      setToggleError(errorMessage(error));
    }
  }, [extensionSet, sessionId]);
  // Per-half diagnosis for absent provider tools. Both settings are global-only (only
  // `modelRoles` is project-writable), so the owner-only global value read is valid for
  // every task. Controllers get a 403, which reads as unknown and keeps the generic text.
  const catalogTools = catalogQuery.data?.state === "available" ? catalogQuery.data.tools : undefined;
  const generateImageSetting = useQuery(ompSettingValueQueryOptions("generate_image.enabled", catalogTools !== undefined && !catalogTools.some((tool) => tool.name === "generate_image")));
  const ttsSetting = useQuery(ompSettingValueQueryOptions("speechgen.enabled", catalogTools !== undefined && !catalogTools.some((tool) => tool.name === "tts")));
  const codeModeData = codeModeQuery.data?.state === "available" ? codeModeQuery.data : undefined;
  const needPreludeSetting = (name: string): boolean =>
    catalogTools !== undefined && !codeModePreludeEnabled(codeModeData ?? null, name);
  const browserSetting = useQuery(ompSettingValueQueryOptions("browser.enabled", needPreludeSetting("browser")));
  const computerSetting = useQuery(ompSettingValueQueryOptions("computer.enabled", needPreludeSetting("computer")));
  const settingValues: Readonly<Record<string, boolean | undefined>> = {
    generate_image: readSettingBoolean(generateImageSetting.data),
    tts: readSettingBoolean(ttsSetting.data),
    browser: readSettingBoolean(browserSetting.data),
    computer: readSettingBoolean(computerSetting.data),
  };

  const state = catalogQuery.data ?? (catalogQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(catalogQuery.error) }
    : null);
  const codeMode = codeModeQuery.data ?? (codeModeQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(codeModeQuery.error) }
    : null);
  const extensionsQuery = useQuery(serverToolExtensionsQueryOptions(sessionId, sessionId.length > 0));
  const extensions = extensionsQuery.data ?? (extensionsQuery.isError
    ? { available: false as const, reason: errorMessage(extensionsQuery.error) }
    : null);
  return (
    <CediaToolCatalogPanel
      state={state}
      codeMode={codeMode}
      extensions={extensions}
      toggleError={toggleError}
      busy={mutation.isPending || refresh.isPending || extensionSet.isPending}
      onToggle={onToggle}
      onToggleExtension={onToggleExtension}
      onRefresh={onRefresh}
      settingValues={settingValues}
    />
  );
}
