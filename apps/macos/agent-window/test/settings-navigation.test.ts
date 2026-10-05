import { describe, expect, it } from "bun:test";
import {
  firstVisibleSettingsSection,
  normalizeSettingsSection,
  resolveSettingsSection,
  SETTINGS_NAV_GROUPS,
  SETTINGS_NAV_ITEMS,
  settingsSectionVisible,
  type SettingsSectionId,
} from "../vendor/synara/apps/web/src/settingsNavigation";
import { rankSettingsSearchEntries } from "../vendor/synara/apps/web/src/settingsSearchIndex";

/**
 * Settings destinations (plan §6.4.1 S4): General, AI/OMP and IDE are the
 * three top-level groups. Every section lives in exactly one group, old deep
 * links normalize to a retained destination, and a destination the host does
 * not back falls back instead of rendering dead state.
 */
describe("settings navigation destinations", () => {
  it("groups sections under General, AI/OMP, IDE and Archived", () => {
    expect(SETTINGS_NAV_GROUPS.map(group => group.id)).toEqual(["general", "ai-omp", "ide", "archived"]);
    const groups = new Map(SETTINGS_NAV_ITEMS.map(item => [item.id, item.group]));
    expect(groups.get("omp")).toBe("ai-omp");
    expect(groups.get("shortcuts")).toBe("ide");
    expect(groups.get("general")).toBe("general");
    expect(groups.get("archived")).toBe("archived");
    // Every section id appears exactly once.
    const ids = SETTINGS_NAV_ITEMS.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("normalizes old deep links to a retained destination", () => {
    expect(normalizeSettingsSection("omp")).toBe("omp");
    expect(normalizeSettingsSection("nope")).toBe("general");
    expect(normalizeSettingsSection(undefined)).toBe("general");
  });

  it("falls back when the host does not back a destination", () => {
    // An unknown snapshot changes nothing: the destination stays.
    expect(resolveSettingsSection("omp", [])).toBe("omp");
    // An explicitly missing integration falls back instead of rendering dead state.
    const missing = [{ id: "omp.settings", availability: "integration_missing" as const }];
    expect(resolveSettingsSection("omp", missing)).not.toBe("omp");
    const general: SettingsSectionId = "general";
    expect(firstVisibleSettingsSection(undefined)).toBe(general);
  });

  it("keeps the removed generic model editor hidden while preserving old links", () => {
    expect(settingsSectionVisible("models", undefined)).toBe(false);
    expect(resolveSettingsSection("models", undefined)).toBe("providers");

    const legacySearch = rankSettingsSearchEntries("saved model slugs", 12);
    expect(legacySearch.length).toBeGreaterThan(0);
    expect(legacySearch.every(entry => entry.section !== "models")).toBe(true);
    expect(legacySearch.some(entry => entry.section === "providers")).toBe(true);
  });

  it("does not advertise local-only profile or unsupported new-thread controls", () => {
    expect(settingsSectionVisible("profile", undefined)).toBe(false);
    expect(resolveSettingsSection("profile", undefined)).toBe("general");
    expect(rankSettingsSearchEntries("new thread mode", 12).some(entry => entry.section === "general")).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some(item => item.id === "profile")).toBe(true);
  });

  it("filters vendor-only environment rows from Cedia settings search", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { nativeApi: { cedia: { getCapabilities: async () => ({}) } } },
    });
    try {
      expect(rankSettingsSearchEntries("automation runs", 12)).toEqual([]);
      expect(rankSettingsSearchEntries("provider usage row", 12)).toEqual([]);
      expect(rankSettingsSearchEntries("pull request ci checks", 12)).toEqual([]);
      expect(rankSettingsSearchEntries("auto-generated chat recap", 12)).toEqual([]);
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});
