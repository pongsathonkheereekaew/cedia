import { describe, expect, it } from "bun:test";

import {
  filterOmpSettingKeys,
  formatOmpSettingValue,
  groupOmpSettingKeys,
  isOmpSettingsStaleRevisionError,
  ompSettingApplyLabel,
  ompSettingChoices,
  parseOmpSettingInput,
  settingValueToEditorText,
} from "./OmpSettingsPanel.logic";

const keys = [
  {
    path: "models.default",
    type: "enum",
    credential: false,
    ui: true,
    tab: "Models",
    projectWritable: false,
    disposition: "editable" as const,
  },
  {
    path: "auth.token",
    type: "string",
    credential: true,
    ui: false,
    projectWritable: false,
    disposition: "protected" as const,
    reason: "Credentials are owned by Provider accounts.",
  },
  {
    path: "terminal.theme",
    type: "string",
    credential: false,
    ui: false,
    projectWritable: false,
    disposition: "advanced" as const,
    reason: "No settings row of its own.",
  },
];

describe("OMP settings panel logic", () => {
  it("filters by path or tab and groups rows under their tab or Other", () => {
    expect(filterOmpSettingKeys(keys, "model").map((key) => key.path)).toEqual(["models.default"]);
    expect(filterOmpSettingKeys(keys, "other").map((key) => key.path)).toEqual([]);
    expect(groupOmpSettingKeys(keys)).toEqual([
      { label: "Models", keys: [keys[0]] },
      { label: "Other", keys: [keys[1], keys[2]] },
    ]);
  });

  it("formats effective values without ever formatting a credential value", () => {
    expect(formatOmpSettingValue({ path: "auth.token", credential: true, redacted: true, configured: true, settingsRevision: "r1" })).toBe("Protected value");
    expect(formatOmpSettingValue({ path: "models.default", credential: false, redacted: false, configured: false, value: "smol", settingsRevision: "r1" })).toBe("Default · \"smol\"");
    expect(formatOmpSettingValue({ path: "cycleOrder", credential: false, redacted: false, configured: true, value: ["default", "smol"], settingsRevision: "r1" })).toBe("Configured · [\"default\",\"smol\"]");
    expect(formatOmpSettingValue({ path: "large", credential: false, redacted: false, configured: true, tooLarge: true, bytes: 123, settingsRevision: "r1" })).toBe("Too large to display (123 bytes)");
  });

  it("parses editor input into the runtime's JSON value types", () => {
    expect(parseOmpSettingInput("array", '["default"]')).toEqual(["default"]);
    expect(parseOmpSettingInput("record", '{"enabled":true}')).toEqual({ enabled: true });
    expect(parseOmpSettingInput("number", "3.5")).toBe(3.5);
    expect(parseOmpSettingInput("boolean", "true")).toBe(true);
    expect(parseOmpSettingInput("enum", "smol")).toBe("smol");
    expect(() => parseOmpSettingInput("array", "{}")) .toThrow(/array/i);
    expect(() => parseOmpSettingInput("number", "not-a-number")).toThrow(/number/i);
    expect(() => parseOmpSettingInput("boolean", "yes")).toThrow(/boolean/i);
  });

  it("keeps an explicit editor representation for a retry", () => {
    // String/enum controls bind raw values (a <select> option is `high`, not `"high"`).
    // A refresh must therefore hydrate the editor with the value the runtime accepts.
    expect(settingValueToEditorText({ path: "defaultThinkingLevel", credential: false, redacted: false, configured: false, value: "high", settingsRevision: "r1" })).toBe("high");
    expect(settingValueToEditorText({ path: "models.default", credential: false, redacted: false, configured: true, value: "smol", settingsRevision: "r1" })).toBe("smol");
    expect(settingValueToEditorText({ path: "cycleOrder", credential: false, redacted: false, configured: true, value: ["default"], settingsRevision: "r1" })).toBe('["default"]');
    expect(settingValueToEditorText({ path: "enabled", credential: false, redacted: false, configured: true, value: true, settingsRevision: "r1" })).toBe("true");
  });

  it("offers the runtime's own enum values, and only when it publishes them", () => {
    // The panel renders a real choice list exactly when the runtime's schema declares one.
    expect(ompSettingChoices({ ...keys[0]!, values: ["smol", "slow"] })).toEqual(["smol", "slow"]);
    // No published list keeps the free-text editor: nothing is invented for an older runtime.
    expect(ompSettingChoices(keys[0]!)).toBeUndefined();
    expect(ompSettingChoices({ ...keys[0]!, values: [] })).toBeUndefined();
    // A non-enum path never gets a choice list even if one arrives.
    expect(ompSettingChoices({ ...keys[2]!, values: ["a", "b"] })).toBeUndefined();
  });

  it("says when a change takes effect, and says so plainly when it is unclassified", () => {
    expect(ompSettingApplyLabel({ ...keys[0]!, apply: "immediate" })).toBe("Applies as soon as it is saved");
    expect(ompSettingApplyLabel({ ...keys[0]!, apply: "turn_boundary" })).toBe("Applies to the next turn");
    expect(ompSettingApplyLabel({ ...keys[0]!, apply: "reload" })).toBe("Applies after the runtime reloads");
    expect(ompSettingApplyLabel({ ...keys[0]!, apply: "new_session" })).toBe("Applies to a new task");
    // No published timing is never rendered as if the change were already live.
    expect(ompSettingApplyLabel(keys[0]!)).toBe("Cedia has not classified when this key takes effect");
  });

  it("recognizes only the typed stale-revision failure as a conflict", () => {
    expect(isOmpSettingsStaleRevisionError(Object.assign(new Error("moved"), { code: "omp_settings_stale_revision" }))).toBe(true);
    expect(isOmpSettingsStaleRevisionError(Object.assign(new Error("other"), { code: "omp_settings_rejected" }))).toBe(false);
  });
});
