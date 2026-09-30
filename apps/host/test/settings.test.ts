import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsConflictError, SettingsStore } from "../src/settings.ts";

const dirs: string[] = [];
function store(): SettingsStore { const dir = mkdtempSync(join(tmpdir(), "cedia-settings-")); dirs.push(dir); return new SettingsStore(dir); }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("host Cedia settings", () => {
  it("writes allowlisted category patches with compare-and-swap revisions and durable readback", () => {
    const first = store();
    const initial = first.read();
    const updated = first.patch(initial.revision, "appearance", { appTheme: "dark", chatFontSizePx: 14 });
    expect(updated).toMatchObject({ revision: 1, values: { appTheme: "dark", chatFontSizePx: 14 } });
    expect(() => first.patch(initial.revision, "appearance", { appTheme: "light" })).toThrow(SettingsConflictError);
    const reopened = new SettingsStore(dirs[0]!);
    expect(reopened.read()).toMatchObject({ revision: 1, values: updated.values });
  });

  it("rejects unknown, wrong-category, malformed and out-of-range settings", () => {
    const settings = store();
    const revision = settings.read().revision;
    expect(() => settings.patch(revision, "appearance", { provider: "codex" })).toThrow("Unsupported Cedia preference");
    expect(() => settings.patch(revision, "appearance", { sidebarThreadSortOrder: "updated_at" })).toThrow("Unsupported Cedia preference");
    // The layout category carries the renderer's own values; a word no control can produce is refused.
    expect(settings.patch(revision, "layout", { sidebarThreadSortOrder: "created_at" })).toMatchObject({ values: { sidebarThreadSortOrder: "created_at" } });
    expect(() => settings.patch(settings.read().revision, "layout", { sidebarThreadSortOrder: "alphabetical" })).toThrow("Invalid Cedia preference");
    expect(() => settings.patch(settings.read().revision, "appearance", { chatWidth: "enormous" })).toThrow("Invalid Cedia preference");
    expect(() => settings.patch(revision, "appearance", { chatFontSizePx: 1000 })).toThrow("Invalid Cedia preference");
    expect(() => settings.patch(revision, "voice", {})).toThrow("Unsupported settings category");
  });
});
