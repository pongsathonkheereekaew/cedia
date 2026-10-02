import { describe, expect, it } from "bun:test";
import {
  firstVisibleSettingsSection,
  normalizeSettingsSection,
  resolveSettingsSection,
  SETTINGS_NAV_GROUPS,
  SETTINGS_NAV_ITEMS,
  type SettingsSectionId,
} from "../vendor/synara/apps/web/src/settingsNavigation";

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
});
