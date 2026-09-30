import "../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ServerProviderStatus } from "@synara/contracts";
import { page } from "vitest/browser";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const harness = vi.hoisted(() => ({
  config: null as { providers: ServerProviderStatus[] } | null,
  environment: { label: "Cedia local", serverVersion: "0.1.0" },
  models: {
    models: [
      {
        slug: "claude/sonnet",
        name: "Sonnet",
        upstreamProviderId: "anthropic",
        upstreamProviderName: "Anthropic",
        supportedReasoningEfforts: [{ value: "high", label: "high" }],
      },
      {
        slug: "gpt/5",
        name: "GPT-5",
        upstreamProviderId: "openai",
        upstreamProviderName: "OpenAI",
        contextWindowOptions: [{ value: "1m", label: "1M" }],
      },
      {
        slug: "claude/haiku",
        name: "Haiku",
        upstreamProviderId: "anthropic",
        upstreamProviderName: "Anthropic",
      },
    ],
    source: "omp",
  },
  refresh: vi.fn(async () => undefined),
  reconciled: true,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
  useQuery: (options: { queryKey?: readonly unknown[] }) => {
    const key = options.queryKey ?? [];
    if (key[0] === "server" && key[1] === "config") {
      return { data: harness.config, isPending: false, isError: false };
    }
    if (key[0] === "cedia") {
      return { data: harness.environment, isPending: false, isError: false };
    }
    return {
      data: harness.models,
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: harness.refresh,
    };
  },
}));
vi.mock("~/lib/serverReactQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/serverReactQuery")>()),
  serverConfigQueryOptions: () => ({ queryKey: ["server", "config"] }),
  serverSettingsQueryOptions: () => ({ queryKey: ["server", "settings"] }),
  hasReconciledServerProviderStatuses: () => harness.reconciled,
  serverQueryKeys: { config: () => ["server", "config"] },
}));
vi.mock("~/lib/providerDiscoveryReactQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/providerDiscoveryReactQuery")>()),
  providerModelsQueryOptions: () => ({ queryKey: ["provider-discovery", "models", "omp"] }),
}));
vi.mock("~/hooks/useProviderStatusesForLocalConfig", () => ({
  useProviderStatusesForLocalConfig: () => harness.config?.providers ?? [],
}));
vi.mock("~/hooks/useProviderStatusRefresh", () => ({
  useRefreshProviderStatusesNow: () => harness.refresh,
}));
vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({ server: {} }),
}));

import { AppSettingsSchema } from "~/appSettings";
import { ProvidersSettingsPanel } from "./ProvidersSettingsPanel";

const defaults = AppSettingsSchema.makeUnsafe({});
const props = {
  defaults,
  settings: defaults,
  updateSettings: vi.fn(),
  updateSettingsAndWait: vi.fn(async () => {}),
  active: true,
  resetEpoch: 0,
};

async function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProvidersSettingsPanel {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  harness.config = {
    providers: [
      {
        provider: "omp",
        status: "ready",
        available: true,
        authStatus: "unknown",
        authLabel: "Managed by OMP",
        checkedAt: "2026-09-16T21:46:18.000Z",
        message: "OMP execution is owned by the Cedia host",
      },
    ],
  };
  harness.refresh.mockClear();
});

it("shows the OMP runtime boundary and upstream catalog without generic CLI controls", async () => {
  await renderPanel();

  expect(page.getByText("OMP execution", { exact: true }).element()).toBeTruthy();
  expect(page.getByText("Managed by OMP").element()).toBeTruthy();
  expect(page.getByText("Anthropic").element()).toBeTruthy();
  expect(page.getByText("OpenAI").element()).toBeTruthy();
  expect(page.getByText("3 models").element()).toBeTruthy();
  expect(page.getByText("Installed CLIs").query()).toBeNull();
  expect(page.getByText("Provider activity").query()).toBeNull();
});

it("refreshes the live OMP catalog from the settings action", async () => {
  await renderPanel();
  await page.getByRole("button", { name: "Refresh OMP model catalog", exact: true }).click();
  expect(harness.refresh).toHaveBeenCalledOnce();
});
