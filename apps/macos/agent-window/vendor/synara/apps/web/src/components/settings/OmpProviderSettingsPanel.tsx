// FILE: OmpProviderSettingsPanel.tsx
// Purpose: Show the OMP-owned runtime and live upstream model catalogue.
// Layer: Settings panel

import type {
  ProviderListModelsResult,
  ServerProviderStatus,
} from "@synara/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ProviderGlyphIcon, ProviderIcon } from "~/components/ProviderIcon";
import {
  getCediaProviderAuthApi,
  type ProviderAuthStatus,
  type ProviderLoginAttempt,
} from "~/lib/cediaProviderAuth";
import {
  CircleCheckIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RotateCcwIcon,
  TriangleAlertIcon,
  XIcon,
} from "~/lib/icons";
import { providerModelsQueryOptions } from "~/lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  SettingsCard,
  SettingsListRow,
  SettingsRow,
  SettingsSectionShell,
} from "./SettingsPanelPrimitives";
import {
  groupOmpCatalogModels,
  summarizeOmpCatalog,
  type OmpCatalogModel,
} from "./OmpProviderSettingsPanel.logic";
import { CediaRuntimeProviderState } from "./CediaRuntimeProviderState";

export type OmpProviderSettingsPanelProps = {
  readonly active: boolean;
  /** Active Cedia session whose runtime account and tier state should be shown. */
  readonly sessionId?: string | null;
};

/** Server errors are shown verbatim: the host authors them for this surface. */
function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The provider request failed.";
}

/** One line of state for a provider row, from OMP's own credential projection. */
function describeAuthProvider(provider: ProviderAuthStatus): string {
  const methods = [
    provider.methods.includes("oauth") ? "sign-in" : null,
    provider.methods.includes("api_key") ? "API key" : null,
  ].filter((entry): entry is string => entry !== null);
  const state =
    provider.credentialKinds.includes("oauth")
      ? "Signed in through OMP"
      : provider.credentialKinds.includes("api_key")
        ? "OMP holds an API key"
        : provider.origin === "env"
          ? `Authenticated by ${provider.envVar ?? "the environment"}`
          : provider.authenticated
            ? "Authenticated through OMP"
            : "Not signed in";
  return methods.length > 0 ? `${state} · ${methods.join(" or ")}` : state;
}

type OmpEnvironment = {
  readonly label?: string;
  readonly serverVersion?: string;
  readonly platform?: { readonly os?: string; readonly arch?: string };
};

function statusLabel(
  status: ServerProviderStatus | undefined,
  pending: boolean,
  failed: boolean,
): string {
  if (pending) return "Checking host";
  if (failed || !status?.available || status.status === "error") return "Unavailable";
  if (status.status === "warning") return "Needs attention";
  return "Ready";
}

function statusClassName(label: string): string {
  if (label === "Ready") return "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400";
  if (label === "Unavailable") return "bg-red-500/12 text-red-600 dark:text-red-400";
  return "bg-muted text-muted-foreground";
}

function OmpStatusPill({ label }: { readonly label: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium leading-none",
        statusClassName(label),
      )}
    >
      {label}
    </span>
  );
}

function modelRows(result: ProviderListModelsResult | undefined): OmpCatalogModel[] {
  return (result?.models ?? []).map((model) => ({
    slug: model.slug,
    name: model.name,
    ...(model.upstreamProviderId ? { upstreamProviderId: model.upstreamProviderId } : {}),
    ...(model.upstreamProviderName ? { upstreamProviderName: model.upstreamProviderName } : {}),
    ...(model.supportedReasoningEfforts
      ? { supportedReasoningEfforts: model.supportedReasoningEfforts }
      : {}),
    ...(model.contextWindowOptions ? { contextWindowOptions: model.contextWindowOptions } : {}),
  }));
}

/**
 * Provider accounts, driven by OMP's own auth API.
 *
 * OMP owns every credential: this surface asks it to start a sign-in, hands it
 * a key, or asks it to sign out, and then shows the state OMP reports back. A
 * key is never read out again, and a runtime without the bridge simply offers
 * the providers its stock login list carries.
 */
function ProviderAccountsSection({
  active,
  catalogueProviderIds,
}: {
  readonly active: boolean;
  readonly catalogueProviderIds: ReadonlySet<string>;
}) {
  const queryClient = useQueryClient();
  const authQuery = useQuery({
    queryKey: ["cedia", "provider-auth"],
    queryFn: () => getCediaProviderAuthApi().list(),
    enabled: active,
    retry: false,
  });
  const [attempt, setAttempt] = useState<ProviderLoginAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [showAll, setShowAll] = useState(false);
  const openedUrls = useRef(new Set<string>());

  const providers = useMemo(() => authQuery.data?.providers ?? [], [authQuery.data]);
  const visible = useMemo(() => {
    const rows =
      showAll || catalogueProviderIds.size === 0
        ? providers
        : providers.filter(
            (provider) => catalogueProviderIds.has(provider.id) || provider.authenticated,
          );
    // The picker's own providers come first, then the rest by name, so the rows
    // a user recognizes are the rows they see.
    return [...rows].sort((left, right) => {
      const rank =
        Number(catalogueProviderIds.has(right.id)) - Number(catalogueProviderIds.has(left.id));
      return rank !== 0 ? rank : left.name.localeCompare(right.name);
    });
  }, [catalogueProviderIds, providers, showAll]);

  // A sign-in can hand back its URL after the start call already answered, so
  // each one is opened once, when it first appears.
  const attemptUrl = attempt?.status === "pending" ? attempt.url : undefined;
  useEffect(() => {
    if (attemptUrl === undefined || openedUrls.current.has(attemptUrl)) return;
    openedUrls.current.add(attemptUrl);
    void ensureNativeApi()
      .shell.openExternal(attemptUrl)
      .catch(() => setError("Could not open the sign-in page in the browser."));
  }, [attemptUrl]);

  // OMP answers a sign-in asynchronously; polling is how this surface learns
  // that the browser step finished.
  const attemptId = attempt?.status === "pending" ? attempt.id : undefined;
  useEffect(() => {
    if (attemptId === undefined) return;
    const api = getCediaProviderAuthApi();
    const timer = window.setInterval(() => {
      void api
        .getLogin(attemptId)
        .then((next) => {
          setAttempt(next);
          if (next.status === "succeeded") {
            void queryClient.invalidateQueries({ queryKey: ["cedia", "provider-auth"] });
          }
        })
        .catch((cause: unknown) => {
          setError(messageOf(cause));
          setAttempt(null);
        });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [attemptId, queryClient]);

  const refresh = useCallback(
    (next: { providers: ProviderAuthStatus[] }) => {
      queryClient.setQueryData(["cedia", "provider-auth"], next);
      void queryClient.invalidateQueries({ queryKey: ["cedia", "omp", "models"] });
    },
    [queryClient],
  );

  const startSignIn = async (providerId: string) => {
    setError(null);
    setCode("");
    setBusy(providerId);
    try {
      setAttempt(await getCediaProviderAuthApi().login(providerId));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const finishSignIn = async (mode: "cancel" | "respond") => {
    if (attempt === null) return;
    setError(null);
    setBusy(attempt.providerId);
    try {
      const api = getCediaProviderAuthApi();
      const next =
        mode === "cancel" || attempt.prompt === undefined
          ? await api.cancel(attempt.id)
          : await api.respond(attempt.id, attempt.prompt.id, code.trim());
      setAttempt(next);
      setCode("");
      if (next.status !== "pending") {
        void queryClient.invalidateQueries({ queryKey: ["cedia", "provider-auth"] });
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async (providerId: string) => {
    const value = keyDraft.trim();
    if (value.length === 0) return;
    setError(null);
    setBusy(providerId);
    try {
      refresh(await getCediaProviderAuthApi().saveApiKey(providerId, value));
      setKeyDraft("");
      setKeyFor(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const signOut = async (providerId: string) => {
    setError(null);
    setBusy(providerId);
    try {
      refresh(await getCediaProviderAuthApi().logout(providerId));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsSectionShell
      title="Provider accounts"
      action={
        providers.length > 0 ? (
          <Button type="button" size="xs" variant="outline" onClick={() => setShowAll(value => !value)}>
            {showAll ? "Picker providers" : "All providers"}
          </Button>
        ) : undefined
      }
    >
      <SettingsCard>
        {authQuery.isPending ? (
          <div className="px-4 py-4 text-xs text-muted-foreground">Loading provider accounts…</div>
        ) : authQuery.isError ? (
          <div className="px-4 py-4 text-xs text-muted-foreground">{messageOf(authQuery.error)}</div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-4 text-xs text-muted-foreground">
            OMP reported no provider accounts for this runtime.
          </div>
        ) : (
          visible.map((provider) => {
            const signedIn =
              provider.credentialKinds.includes("oauth") || provider.credentialKinds.includes("api_key");
            const pending = attempt !== null && attempt.status === "pending" && attempt.providerId === provider.id;
            return (
              <SettingsRow
                key={provider.id}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <ProviderGlyphIcon providerId={provider.id} className="size-4 shrink-0" />
                    <span className="truncate">{provider.name}</span>
                  </span>
                }
                description={describeAuthProvider(provider)}
                status={pending && attempt !== null ? attempt.message ?? attempt.instructions : undefined}
                control={
                  <div className="flex items-center gap-1.5">
                    {provider.methods.includes("oauth") && !pending ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void startSignIn(provider.id)}
                      >
                        {signedIn ? "Sign in again" : "Sign in"}
                      </Button>
                    ) : null}
                    {provider.methods.includes("api_key") ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => {
                          setError(null);
                          setKeyDraft("");
                          setKeyFor(current => (current === provider.id ? null : provider.id));
                        }}
                      >
                        API key
                      </Button>
                    ) : null}
                    {signedIn ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void signOut(provider.id)}
                      >
                        Sign out
                      </Button>
                    ) : null}
                    {busy === provider.id ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                  </div>
                }
              >
                {pending && attempt !== null && attempt.prompt ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      type="password"
                      size="sm"
                      autoComplete="off"
                      placeholder={attempt.prompt.placeholder ?? "Paste the code from the browser"}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      aria-label={`${provider.name} sign-in code`}
                    />
                    <Button
                      type="button"
                      size="xs"
                      disabled={busy !== null || code.trim().length === 0}
                      onClick={() => void finishSignIn("respond")}
                    >
                      Submit
                    </Button>
                  </div>
                ) : null}
                {pending ? (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] text-muted-foreground">
                      {attempt?.url ? "Finish in the browser that just opened." : "Waiting for OMP…"}
                    </span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void finishSignIn("cancel")}
                    >
                      <XIcon className="size-3.5" />
                      Cancel
                    </Button>
                  </div>
                ) : null}
                {keyFor === provider.id ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      type="password"
                      size="sm"
                      autoComplete="off"
                      placeholder={`${provider.name} API key`}
                      value={keyDraft}
                      onChange={(event) => setKeyDraft(event.target.value)}
                      aria-label={`${provider.name} API key`}
                    />
                    <Button
                      type="button"
                      size="xs"
                      disabled={busy !== null || keyDraft.trim().length === 0}
                      onClick={() => void saveKey(provider.id)}
                    >
                      Save
                    </Button>
                  </div>
                ) : null}
              </SettingsRow>
            );
          })
        )}
      </SettingsCard>
      {error !== null ? (
        <p className="px-2 text-[11px] leading-relaxed text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
        OMP stores these credentials. Cedia asks it to sign in, hands it a key, or asks it to sign
        out, and never reads a credential back.
      </p>
    </SettingsSectionShell>
  );
}

function formatEnvironment(environment: OmpEnvironment | undefined): string {
  if (!environment) return "Cedia host";
  const details = [environment.label, environment.serverVersion && `v${environment.serverVersion}`]
    .filter(Boolean)
    .join(" · ");
  return details || "Cedia host";
}

export function OmpProviderSettingsPanel({ active, sessionId }: OmpProviderSettingsPanelProps) {
  const configQuery = useQuery({
    ...serverConfigQueryOptions(),
    enabled: active,
  });
  const environmentQuery = useQuery({
    queryKey: ["cedia", "omp", "environment"],
    queryFn: async () => (await ensureNativeApi().server.getEnvironment()) as OmpEnvironment,
    enabled: active,
    staleTime: 60_000,
  });
  const modelsQuery = useQuery(
    providerModelsQueryOptions({
      provider: "omp",
      enabled: active,
      priority: "foreground",
    }),
  );

  if (!active) return null;

  const status = configQuery.data?.providers.find((provider) => provider.provider === "omp");
  const statusText = statusLabel(status, configQuery.isPending, configQuery.isError);
  const models = modelRows(modelsQuery.data);
  const groups = groupOmpCatalogModels(models);
  const summary = summarizeOmpCatalog(models);
  const refreshing = modelsQuery.isFetching;
  const catalogError = modelsQuery.data?.error ?? (modelsQuery.error?.message || null);
  const catalogueProviderIds = new Set(groups.map((group) => group.id));

  return (
    <div className="space-y-6">
      <SettingsSectionShell title="OMP runtime">
        <SettingsCard>
          <SettingsRow
            title={
              <span className="flex items-center gap-2">
                <ProviderIcon provider="omp" className="size-4 shrink-0" />
                <span>OMP execution</span>
              </span>
            }
            description="OMP is Cedia's only agent provider. It handles the active task and model access for this window."
            status={status?.message}
            control={<OmpStatusPill label={statusText} />}
          />
          <SettingsRow
            title="Host"
            description="This window is connected to the local Cedia host."
            status={environmentQuery.error?.message}
            control={
              <span className="max-w-48 truncate text-xs text-muted-foreground">
                {environmentQuery.isPending
                  ? "Checking host"
                  : formatEnvironment(environmentQuery.data)}
              </span>
            }
          />
          <SettingsRow
            title="Authentication"
            description="OMP owns provider credentials. Sign-in and API keys are managed under Provider accounts below."
            control={
              <span className="text-xs font-medium text-muted-foreground">Managed by OMP</span>
            }
          />
        </SettingsCard>
      </SettingsSectionShell>

      <ProviderAccountsSection
        active={active}
        catalogueProviderIds={catalogueProviderIds}
      />

      <CediaRuntimeProviderState active={active} sessionId={sessionId} />

      <SettingsSectionShell
        title="Upstream provider catalog"
        action={
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={refreshing}
            aria-label="Refresh OMP model catalog"
            onClick={() => void modelsQuery.refetch()}
          >
            {refreshing ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <RotateCcwIcon className="size-3.5" />
            )}
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        }
      >
        <SettingsCard>
          <SettingsRow
            title="Live OMP catalog"
            description="These upstream providers and models come from OMP at runtime. They are model sources in the picker."
            status={
              modelsQuery.isPending
                ? "Loading model catalog"
                : catalogError
                  ? catalogError
                  : `${summary.providerCount} ${summary.providerCount === 1 ? "provider" : "providers"} · ${summary.modelCount} ${summary.modelCount === 1 ? "model" : "models"}`
            }
          />
          {modelsQuery.isPending ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">Loading OMP catalog…</div>
          ) : groups.length > 0 ? (
            <div className="border-t border-[color:var(--color-border)]">
              {groups.map((group) => {
                const sampleModels = group.models
                  .slice(0, 3)
                  .map((model) => model.name)
                  .join(", ");
                const remainingModelCount = group.models.length - Math.min(group.models.length, 3);
                const capabilityLabels = [
                  group.reasoningModelCount > 0
                    ? `${group.reasoningModelCount} reasoning`
                    : null,
                  group.contextWindowModelCount > 0
                    ? `${group.contextWindowModelCount} context sizes`
                    : null,
                ].filter((label): label is string => label !== null);
                return (
                  <SettingsListRow
                    key={group.id}
                    title={
                      <span className="flex min-w-0 items-center gap-2">
                        <ProviderGlyphIcon providerId={group.id} className="size-4 shrink-0" />
                        <span className="truncate">{group.name}</span>
                      </span>
                    }
                    description={
                      <span className="block min-w-0 truncate">
                        {sampleModels || "No model names reported"}
                        {remainingModelCount > 0 ? ` · +${remainingModelCount} more` : ""}
                      </span>
                    }
                    actions={
                      <span className="text-right text-[11px] text-muted-foreground">
                        <span className="block">
                          {group.models.length} {group.models.length === 1 ? "model" : "models"}
                        </span>
                        {capabilityLabels.length > 0 ? (
                          <span className="block">{capabilityLabels.join(" · ")}</span>
                        ) : null}
                      </span>
                    }
                  />
                );
              })}
            </div>
          ) : (
            <div className="border-t border-[color:var(--color-border)] px-4 py-4 text-xs text-muted-foreground">
              OMP did not advertise any models yet. Refresh after the host finishes loading its
              catalogue.
            </div>
          )}
        </SettingsCard>
        <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
          The model picker uses this same live catalogue. This page stays read-only because OMP
          owns upstream provider discovery; Cedia has no separate login or configuration file route
          for these providers.
        </p>
      </SettingsSectionShell>
    </div>
  );
}
