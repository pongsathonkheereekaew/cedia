// FILE: ompSettingsReactQuery.ts
// Purpose: Query and mutation options for the host-owned OMP settings routes.
// Layer: Host route data

import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";
import type { OmpSettingValue } from "../components/settings/OmpSettingsPanel.logic";
import type { OmpSettingKey } from "../components/settings/OmpSettingsPanel.logic";

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
};

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
