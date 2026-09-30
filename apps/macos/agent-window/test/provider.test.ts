import { describe, expect, it } from "bun:test";
import * as Schema from "../vendor/synara/apps/web/node_modules/effect/dist/Schema.js";

import {
  MODEL_OPTIONS_BY_PROVIDER,
  ModelSelection,
  ProviderKind,
  ProviderListModelsInput,
} from "../vendor/synara/packages/contracts/src/index";
import { getDefaultModel } from "../vendor/synara/packages/shared/src/model";
import {
  PROVIDER_DESCRIPTORS,
  providerSupportsNativeTurnSteering,
} from "../vendor/synara/packages/shared/src/providerMetadata";
import { DEFAULT_PROVIDER_ORDER } from "../vendor/synara/apps/web/src/providerOrdering";
import { PROVIDER_OPTIONS } from "../vendor/synara/apps/web/src/session-logic";
import {
  OMP_UNRESOLVED_MODEL,
  buildModelSelection,
  formatProviderModelOptionName,
  mergeDynamicModelOptions,
} from "../vendor/synara/apps/web/src/providerModelOptions";
import { normalizeOmpModelRows } from "../src/cedia-adapter.ts";

describe("OMP provider identity", () => {
  it("keeps one picker row per provider-qualified OMP model", () => {
    expect(normalizeOmpModelRows({ models: [
      { id: "deepseek-v4", provider: "openrouter", label: "DeepSeek V4", upstreamProviderName: "OpenRouter" },
      { id: "openrouter/deepseek-v4", provider: "openrouter", label: "duplicate" },
      { id: "deepseek-v4", provider: "commandcode", label: "DeepSeek V4", thinking: { efforts: ["low", "high"] }, maxTokens: 8192, contextWindow: 128000 },
    ] })).toEqual([
      {
        id: "deepseek-v4",
        provider: "openrouter",
        slug: "openrouter/deepseek-v4",
        label: "DeepSeek V4",
        available: true,
        upstreamProviderId: "openrouter",
        upstreamProviderName: "OpenRouter",
      },
      {
        id: "deepseek-v4",
        provider: "commandcode",
        slug: "commandcode/deepseek-v4",
        label: "DeepSeek V4",
        available: true,
        upstreamProviderId: "commandcode",
        upstreamProviderName: "commandcode",
        efforts: ["low", "high"],
        contextWindow: 128000,
        maxOutputTokens: 8192,
      },
    ]);
  });

  it("normalizes OMP's live thinking arrays and host descriptors without widening the ladder", () => {
    expect(normalizeOmpModelRows({ models: [
      {
        id: "claude-fable-5",
        provider: "commandcode",
        name: "Claude Fable 5",
        reasoning: true,
        thinking: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        slug: "openrouter/deepseek-v4",
        id: "deepseek-v4",
        provider: "openrouter",
        label: "DeepSeek V4",
        supportedReasoningEfforts: [
          { value: "high", label: "High" },
          { value: "max", label: "Max" },
        ],
      },
    ] })).toEqual([
      {
        id: "claude-fable-5",
        provider: "commandcode",
        slug: "commandcode/claude-fable-5",
        label: "Claude Fable 5",
        available: true,
        upstreamProviderId: "commandcode",
        upstreamProviderName: "commandcode",
        efforts: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        id: "deepseek-v4",
        provider: "openrouter",
        slug: "openrouter/deepseek-v4",
        label: "DeepSeek V4",
        available: true,
        upstreamProviderId: "openrouter",
        upstreamProviderName: "openrouter",
        efforts: ["high", "max"],
      },
    ]);
  });

  it("accepts omp in the native provider and model-selection schemas", () => {
    expect(Schema.is(ProviderKind)("omp")).toBe(true);
    expect(
      Schema.is(ModelSelection)({
        provider: "omp",
        model: "openrouter/deepseek-v4.1-flash",
      }),
    ).toBe(true);
    expect(Schema.is(ProviderListModelsInput)({ provider: "omp", threadId: "session-1" })).toBe(true);
  });

  it("has no fabricated OMP model or default model", () => {
    expect(MODEL_OPTIONS_BY_PROVIDER.omp).toEqual([]);
    expect(getDefaultModel("omp")).toBeNull();
    expect(buildModelSelection("omp", OMP_UNRESOLVED_MODEL)).toEqual({
      provider: "omp",
      model: OMP_UNRESOLVED_MODEL,
    });
  });

  it("exposes only OMP as a selectable provider", () => {
    expect(PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.kind)).toEqual(["omp"]);
    expect(DEFAULT_PROVIDER_ORDER).toEqual(["omp"]);
    expect(PROVIDER_OPTIONS).toEqual([
      { value: "omp", label: "OMP", available: true },
    ]);
    expect(providerSupportsNativeTurnSteering("omp")).toBe(true);
    expect(formatProviderModelOptionName({ provider: "omp", slug: OMP_UNRESOLVED_MODEL })).toBe(
      "Choose model",
    );
  });

  it("keeps runtime model ids and upstream provider provenance", () => {
    const options = mergeDynamicModelOptions({
      provider: "omp",
      staticOptions: MODEL_OPTIONS_BY_PROVIDER.omp,
      dynamicModels: [
        {
          slug: "openrouter/deepseek-v4.1-flash",
          name: "DeepSeek V4.1 Flash",
          upstreamProviderId: "openrouter",
          upstreamProviderName: "OpenRouter",
        },
      ],
    });

    expect(options).toEqual([
      {
        slug: "openrouter/deepseek-v4.1-flash",
        name: "DeepSeek V4.1 Flash",
        upstreamProviderId: "openrouter",
        upstreamProviderName: "OpenRouter",
      },
    ]);
  });
});
