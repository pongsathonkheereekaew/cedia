import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { ProviderListModelsResult } from "@synara/contracts";
import {
  buildProviderTabRows,
  resolveComposerModelPickerUpstreamTabs,
} from "../components/chat/ComposerModelPicker.logic";
import { mergeDynamicModelOptions } from "../providerModelOptions";
import {
  OMP_MODEL_CATALOG_REFRESH_INTERVAL_MS,
  providerDiscoveryQueryKeys,
  providerModelsQueryOptions,
  refetchActiveOmpModelCatalog,
} from "./providerDiscoveryReactQuery";

function catalog(slugs: string[]): ProviderListModelsResult {
  return {
    models: slugs.map((slug) => ({
      slug,
      name: slug,
      upstreamProviderId: slug.split("/", 1)[0],
    })),
    source: "omp",
    cached: false,
  };
}

describe("open OMP model catalog freshness", () => {
  it("refetches the live OMP catalog and projects additions and removals into picker tabs and rows", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = providerDiscoveryQueryKeys.models("omp", null, null, null, null);
    let liveCatalog = catalog(["openai/gpt-5"]);
    let listModelsCalls = 0;
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        nativeApi: {
          provider: {
            listModels: async () => {
              listModelsCalls += 1;
              return liveCatalog;
            },
          },
        },
      },
    });
    const options = providerModelsQueryOptions({ provider: "omp", enabled: true });
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => undefined);

    const project = () => {
      const dynamicModels = observer.getCurrentResult().data?.models ?? [];
      const modelOptions = mergeDynamicModelOptions({
        provider: "omp",
        staticOptions: [],
        dynamicModels,
      });
      const tabs = resolveComposerModelPickerUpstreamTabs(modelOptions);
      return {
        tabs: tabs.map((tab) => tab.tab),
        rows: tabs.flatMap((tab) =>
          buildProviderTabRows({
            provider: "omp",
            options: modelOptions,
            query: "",
            selectedModel: null,
            upstreamProviderId: tab.upstreamProviderId,
          }).map((row) => row.key),
        ),
      };
    };

    try {
      await observer.refetch();
      expect(project()).toEqual({
        tabs: ["upstream:openai"],
        rows: ["omp:openai/gpt-5"],
      });

      liveCatalog = catalog(["openai/gpt-5", "anthropic/sonnet-4"]);
      await refetchActiveOmpModelCatalog(client);
      expect(project()).toEqual({
        tabs: ["upstream:openai", "upstream:anthropic"],
        rows: ["omp:openai/gpt-5", "omp:anthropic/sonnet-4"],
      });

      liveCatalog = catalog(["anthropic/sonnet-4"]);
      await refetchActiveOmpModelCatalog(client);
      expect(project()).toEqual({
        tabs: ["upstream:anthropic"],
        rows: ["omp:anthropic/sonnet-4"],
      });
      expect(listModelsCalls).toBe(3);
      expect(client.getQueryData(queryKey)).toEqual(liveCatalog);
    } finally {
      unsubscribe();
      client.clear();
      if (previousWindow) {
        Object.defineProperty(globalThis, "window", previousWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  it("polls only an open OMP catalog observer", () => {
    const openOmp = providerModelsQueryOptions({
      provider: "omp",
      enabled: true,
      refreshWhileObserved: true,
    });
    const closedOmp = providerModelsQueryOptions({
      provider: "omp",
      enabled: true,
      refreshWhileObserved: false,
    });
    const openOpenCode = providerModelsQueryOptions({
      provider: "opencode",
      enabled: true,
      refreshWhileObserved: true,
    });

    expect(openOmp.refetchInterval).toBe(OMP_MODEL_CATALOG_REFRESH_INTERVAL_MS);
    expect(closedOmp.refetchInterval).toBeUndefined();
    expect(openOpenCode.refetchInterval).toBeUndefined();
  });
});
