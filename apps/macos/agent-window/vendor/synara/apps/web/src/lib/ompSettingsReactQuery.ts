// FILE: ompSettingsReactQuery.ts
// Purpose: Query and mutation options for the host-owned OMP settings routes.
// Layer: Host route data

import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";
import type { OmpSettingScope, OmpSettingValue } from "../components/settings/OmpSettingsPanel.logic";
import type { OmpSettingKey } from "../components/settings/OmpSettingsPanel.logic";

export interface OmpSettingsScopeSelection {
  readonly scope: OmpSettingScope;
  readonly projectId?: string;
  readonly sessionId?: string;
}

export interface OmpSettingsMutation {
  readonly context: { scope: "global" } | { scope: "project"; projectId: string };
  readonly expectedRevision?: string;
  readonly changes: { path: string; operation: "set"; value?: unknown }[] | { path: string; operation: "unset" }[];
}

export interface OmpSettingsResetPreviewEntry {
  readonly path: string;
  readonly globalConfigured: boolean;
  readonly current: OmpSettingValue;
}

export interface OmpProjectRow {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly archived?: boolean;
}

export interface OmpSessionRow {
  readonly id: string;
  readonly title: string;
  readonly projectId?: string;
}

export type OmpSettingsKeysAnswer =
  | {
      readonly state: "available";
      readonly keys: readonly OmpSettingKey[];
      readonly settingsRevision: string;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export type OmpSettingValueAnswer =
  | ({ readonly state: "available" } & OmpSettingValue)
  | { readonly state: "unavailable"; readonly reason: string };

export interface OmpSettingsApi {
  readonly getOmpSettingsKeys: () => Promise<OmpSettingsKeysAnswer>;
  readonly getOmpSettingValue: (path: string) => Promise<OmpSettingValueAnswer>;
  readonly setOmpSetting: (input: {
    readonly path: string;
    readonly value: unknown;
    readonly expectedRevision?: string;
  }) => Promise<OmpSettingValueAnswer>;
  readonly getOmpSettingValueIn?: (
    path: string,
    scope: OmpSettingScope,
    projectId?: string,
    sessionId?: string,
  ) => Promise<OmpSettingValueAnswer>;
  readonly mutateOmpSettings?: (mutation: OmpSettingsMutation) => Promise<{
    readonly values: readonly OmpSettingValue[];
    readonly scope: "global" | "project";
  }>;
  readonly previewOmpSettingsReset?: (paths: string[]) => Promise<{ readonly entries: readonly OmpSettingsResetPreviewEntry[] }>;
  readonly listProjects?: () => Promise<unknown>;
  readonly listSessions?: (projectId?: string) => Promise<unknown>;
}

export function getOmpSettingsApi(): OmpSettingsApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<OmpSettingsApi> };
  if (
    typeof api.cedia?.getOmpSettingsKeys !== "function" ||
    typeof api.cedia?.getOmpSettingValue !== "function" ||
    typeof api.cedia?.setOmpSetting !== "function"
  ) {
    throw new Error("Cedia OMP settings bridge is unavailable.");
  }
  return api.cedia as OmpSettingsApi;
}

export const ompSettingsQueryKeys = {
  all: ["cedia", "omp-settings"] as const,
  keys: () => ["cedia", "omp-settings", "keys"] as const,
  value: (path: string) => ["cedia", "omp-settings", "value", path] as const,
  scopedValue: (path: string, selection: OmpSettingsScopeSelection) =>
    ["cedia", "omp-settings", "value", path, selection.scope, selection.projectId ?? "", selection.sessionId ?? ""] as const,
  projects: () => ["cedia", "omp-settings", "projects"] as const,
  sessions: (projectId?: string) => ["cedia", "omp-settings", "sessions", projectId ?? ""] as const,
};

function parseProjectRows(value: unknown): OmpProjectRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
    .map(row => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? row.id ?? ""),
      path: String(row.path ?? ""),
      ...(row.archived === true ? { archived: true as const } : {}),
    }))
    .filter(row => row.id.length > 0);
}

function parseSessionRows(value: unknown): OmpSessionRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
    .map(row => ({
      id: String(row.id ?? ""),
      title: String(row.title ?? row.id ?? ""),
      ...(typeof row.projectId === "string" && row.projectId.length > 0 ? { projectId: row.projectId } : {}),
    }))
    .filter(row => row.id.length > 0);
}

export function ompSettingsProjectsQueryOptions(enabled = true) {
  return queryOptions({
    queryKey: ompSettingsQueryKeys.projects(),
    queryFn: async (): Promise<OmpProjectRow[]> => {
      const api = getOmpSettingsApi();
      if (typeof api.listProjects !== "function") throw new Error("Project listing is unavailable in this window.");
      return parseProjectRows(await api.listProjects());
    },
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function ompSettingsSessionsQueryOptions(projectId?: string, enabled = true) {
  return queryOptions({
    queryKey: ompSettingsQueryKeys.sessions(projectId),
    queryFn: async (): Promise<OmpSessionRow[]> => {
      const api = getOmpSettingsApi();
      if (typeof api.listSessions !== "function") throw new Error("Task listing is unavailable in this window.");
      return parseSessionRows(await api.listSessions(projectId));
    },
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function ompSettingScopedValueQueryOptions(path: string, selection: OmpSettingsScopeSelection, enabled = true) {
  return queryOptions({
    queryKey: ompSettingsQueryKeys.scopedValue(path, selection),
    queryFn: async (): Promise<OmpSettingValueAnswer> => {
      const api = getOmpSettingsApi();
      if (typeof api.getOmpSettingValueIn !== "function") {
        // An older window shell reads the legacy session-bound route instead of failing silently.
        if (selection.scope !== "global" || selection.projectId || selection.sessionId) {
          return { state: "unavailable", reason: "Scoped reads need a newer window shell." } as OmpSettingValueAnswer;
        }
        return api.getOmpSettingValue(path);
      }
      return api.getOmpSettingValueIn(path, selection.scope, selection.projectId, selection.sessionId);
    },
    enabled,
    staleTime: 0,
    retry: false,
    // A write in the other window changes the shared revision: refetch on focus
    // so two windows never stare at each other's stale values.
    refetchOnWindowFocus: true,
  });
}

export async function mutateOmpSettings(mutation: OmpSettingsMutation): Promise<{
  readonly values: readonly OmpSettingValue[];
  readonly scope: "global" | "project";
}> {
  const api = getOmpSettingsApi();
  if (typeof api.mutateOmpSettings !== "function") throw new Error("Scoped writes need a newer window shell.");
  return api.mutateOmpSettings(mutation);
}

export async function previewOmpSettingsReset(paths: string[]): Promise<readonly OmpSettingsResetPreviewEntry[]> {
  const api = getOmpSettingsApi();
  if (typeof api.previewOmpSettingsReset !== "function") throw new Error("Reset previews need a newer window shell.");
  const answer = await api.previewOmpSettingsReset(paths);
  return answer.entries;
}

export function ompSettingsKeysQueryOptions() {
  return queryOptions({
    queryKey: ompSettingsQueryKeys.keys(),
    queryFn: () => getOmpSettingsApi().getOmpSettingsKeys(),
    staleTime: 5_000,
    retry: false,
  });
}

export function ompSettingValueQueryOptions(path: string, enabled = true) {
  return queryOptions({
    queryKey: ompSettingsQueryKeys.value(path),
    queryFn: () => getOmpSettingsApi().getOmpSettingValue(path),
    enabled,
    staleTime: 0,
    retry: false,
  });
}
