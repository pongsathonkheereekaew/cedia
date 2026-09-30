import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_SERVER_SETTINGS_VIEW, type NativeApi } from "@synara/contracts";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { refetchActiveOmpModelCatalog } from "../lib/providerDiscoveryReactQuery";
import { serverQueryKeys } from "../lib/serverReactQuery";
import { useProviderModelCatalog } from "./useProviderModelCatalog";

function modelCatalog(slugs: string[]) {
  return {
    models: slugs.map((slug) => ({
      slug,
      name: slug,
      upstreamProviderId: slug.split("/", 1)[0],
    })),
    source: "omp" as const,
    cached: false,
  };
}

let queryClient: QueryClient | undefined;
let previousNativeApi: NativeApi | undefined;
let previousAppSettings: string | null = null;
let previousSettingsMigration: string | null = null;

function CatalogRows() {
  const catalog = useProviderModelCatalog({
    selectedProvider: "omp",
    discoveryEnabled: true,
  });

  return createElement(
    "div",
    null,
    ...catalog.modelOptionsByProvider.omp.map((model) =>
      createElement("span", { key: model.slug, "data-model": model.slug }, model.name),
    ),
  );
}

afterEach(() => {
  cleanup();
  queryClient?.clear();
  queryClient = undefined;
  if (previousNativeApi) {
    window.nativeApi = previousNativeApi;
  } else {
    Reflect.deleteProperty(window, "nativeApi");
  }
  previousNativeApi = undefined;
  if (previousAppSettings === null) {
    window.localStorage.removeItem("synara:app-settings:v1");
  } else {
    window.localStorage.setItem("synara:app-settings:v1", previousAppSettings);
  }
  if (previousSettingsMigration === null) {
    window.localStorage.removeItem("synara:server-settings-migrated:v1");
  } else {
    window.localStorage.setItem("synara:server-settings-migrated:v1", previousSettingsMigration);
  }
  previousAppSettings = null;
  previousSettingsMigration = null;
});

it("updates the mounted OMP composer catalog as runtime models are added and removed", async () => {
  previousNativeApi = window.nativeApi;
  previousAppSettings = window.localStorage.getItem("synara:app-settings:v1");
  previousSettingsMigration = window.localStorage.getItem("synara:server-settings-migrated:v1");
  window.localStorage.removeItem("synara:app-settings:v1");
  window.localStorage.setItem("synara:server-settings-migrated:v1", "1");

  let liveCatalog = modelCatalog(["openai/gpt-5"]);
  window.nativeApi = {
    provider: { listModels: async () => liveCatalog },
  } as unknown as NativeApi;

  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  queryClient.setQueryData(serverQueryKeys.settings(), DEFAULT_SERVER_SETTINGS_VIEW);

  const mounted = await render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(CatalogRows),
    ),
  );

  await vi.waitFor(() => {
    expect(mounted.container.querySelector('[data-model="openai/gpt-5"]')).not.toBeNull();
  });

  liveCatalog = modelCatalog(["openai/gpt-5", "anthropic/sonnet-4"]);
  await refetchActiveOmpModelCatalog(queryClient);
  await vi.waitFor(() => {
    expect(mounted.container.querySelector('[data-model="anthropic/sonnet-4"]')).not.toBeNull();
  });

  liveCatalog = modelCatalog(["anthropic/sonnet-4"]);
  await refetchActiveOmpModelCatalog(queryClient);
  await vi.waitFor(() => {
    expect(mounted.container.querySelector('[data-model="openai/gpt-5"]')).toBeNull();
    expect(mounted.container.querySelector('[data-model="anthropic/sonnet-4"]')).not.toBeNull();
  });
});
