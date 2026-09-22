import { describe, expect, it } from "bun:test";
import { stateForHostTheme } from "../vendor/synara/apps/web/src/hooks/useTheme";
import { DEFAULT_THEME_STATE, setThemeCodeThemeId } from "../vendor/synara/apps/web/src/theme/theme.logic";

describe("IDE theme overlay respects user choice", () => {
  it("follows the IDE pack when storage is still default", () => {
    const projected = stateForHostTheme(DEFAULT_THEME_STATE, { mode: "dark", themeName: "Catppuccin Frapp\u00e9" });
    expect(projected.codeThemeIds.dark).toBe("catppuccin");
    // Stored mode is authoritative: system stays system and resolves via host at render time.
    expect(projected.mode).toBe("system");
  });

  it("keeps the stored pack for unknown IDE names", () => {
    const projected = stateForHostTheme(DEFAULT_THEME_STATE, { mode: "dark", themeName: "Someone's Custom" });
    expect(projected.codeThemeIds.dark).toBe(DEFAULT_THEME_STATE.codeThemeIds.dark);
  });

  it("lets a stored pack override the IDE mapping", () => {
    const customized = setThemeCodeThemeId(DEFAULT_THEME_STATE, "dark", "dracula");
    expect(customized.codeThemeIds.dark).toBe("dracula");
    const projected = stateForHostTheme(customized, { mode: "dark", themeName: "Catppuccin Frapp\u00e9" });
    expect(projected.codeThemeIds.dark).toBe("dracula");
  });

  it("keeps an explicit mode instead of forcing the host mode", () => {
    const stored = { ...DEFAULT_THEME_STATE, mode: "light" as const };
    const projected = stateForHostTheme(stored, { mode: "dark", themeName: "Catppuccin Frapp\u00e9" });
    expect(projected.mode).toBe("light");
  });
});
