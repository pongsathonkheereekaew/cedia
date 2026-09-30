# OMP provider catalog refresh projection — 2026-09-28

## Result

An active TanStack Query observer now has a focused freshness fixture for the OMP model catalog.
The test starts with an OpenAI model, calls the same `refetchActiveOmpModelCatalog` helper used
when provider discovery opens, and observes the refreshed catalog projected into composer model
picker tabs and rows. Adding an Anthropic model adds its upstream tab and row; removing the
OpenAI model removes its tab and row. The test also verifies that the helper calls the model-list
API again and updates the shared query cache. A separate assertion verifies that the ten-second
refresh interval is enabled only while the OMP catalog is observed.

The model-list API is a fixture, not a live OMP runtime. A follow-up browser test mounts the real
`useProviderModelCatalog` hook under a React Query client in headless Chromium and observes the
catalog output change as fixture models are added and removed. No packaged renderer receives a
runtime catalog event.

## Verification

- `bun test apps/macos/agent-window/vendor/synara/apps/web/src/lib/providerModelCatalogFreshness.test.ts apps/macos/agent-window/test/provider-tabs.test.ts`
  — **9 passed, 0 failed, 37 expectations**.
- From `apps/macos/agent-window`, the focused Chromium run
  `vendor/synara/apps/web/node_modules/.bin/vitest run --config vendor/synara/apps/web/vitest.providers.config.ts`
  — **3 files, 8 tests passed**. This includes the mounted hook, composer tabs and provider
  settings panel. The settings-panel browser test now supplies the required `QueryClientProvider`
  around React Query mutations. The hook and tabs use fixture `window.nativeApi.provider.listModels`;
  no real provider or network is used. Node emits its existing `[DEP0205]` `module.register()`
  deprecation warning.
- No provider, paid model, packaged app, remote client or device was used.

This is one F source/fixture projection case. It does not prove all O01–O12 semantic and dynamic
scenarios, packaged desktop propagation, remote/iPhone projection, or F acceptance.
