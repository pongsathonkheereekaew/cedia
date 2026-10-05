import { describe, expect, it } from "bun:test";

import {
  AppSettingsSchema,
  CEDIA_LOCAL_RESET_KEYS,
  cediaLocalResetPatch,
  DEFAULT_APP_SETTINGS,
  isCediaHostRuntime,
  projectAppSettingsForRuntime,
} from "../vendor/synara/apps/web/src/appSettings";
import { DEFAULT_SERVER_SETTINGS_VIEW } from "../vendor/synara/packages/contracts/src/settings";

describe("Cedia settings ownership", () => {
  it("recognizes the Cedia namespace without requiring a host request", () => {
    expect(isCediaHostRuntime({ cedia: { getCapabilities: async () => ({}) } })).toBe(true);
    expect(isCediaHostRuntime({ cedia: { getCapabilities: "missing" } })).toBe(false);
    expect(isCediaHostRuntime({ server: {} })).toBe(false);
    expect(isCediaHostRuntime(undefined)).toBe(false);
  });

  it("keeps host-owned local values ahead of synthetic server defaults", () => {
    const local = AppSettingsSchema.makeUnsafe({ enableAssistantStreaming: false });
    const cedia = projectAppSettingsForRuntime(local, DEFAULT_SERVER_SETTINGS_VIEW, true);
    const vendor = projectAppSettingsForRuntime(local, DEFAULT_SERVER_SETTINGS_VIEW, false);

    expect(cedia.enableAssistantStreaming).toBe(false);
    expect(vendor.enableAssistantStreaming).toBe(DEFAULT_APP_SETTINGS.enableAssistantStreaming);
  });

  it("resets only Cedia app-owned rows and preserves legacy/server-owned values", () => {
    const patch = cediaLocalResetPatch(DEFAULT_APP_SETTINGS);

    expect(CEDIA_LOCAL_RESET_KEYS).toContain("enableAssistantStreaming");
    expect(patch.enableAssistantStreaming).toBe(DEFAULT_APP_SETTINGS.enableAssistantStreaming);
    expect(patch.uiDensity).toBe(DEFAULT_APP_SETTINGS.uiDensity);
    expect(patch.defaultThreadEnvMode).toBeUndefined();
    expect(patch.showAutomationRunThreads).toBeUndefined();
    expect(patch.showEnvironmentUsage).toBeUndefined();
    expect(patch.showEnvironmentPullRequest).toBeUndefined();
    expect(patch.showEnvironmentRecap).toBeUndefined();
    expect(patch.codexBinaryPath).toBeUndefined();
    expect(patch.openCodeServerPassword).toBeUndefined();
    expect(patch.onboardingCompletedAt).toBeUndefined();
  });
});
