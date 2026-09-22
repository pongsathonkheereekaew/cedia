import { describe, expect, it } from "bun:test";

import {
  isShortcutRowEditing,
  keybindingSaveRequest,
  shortcutCaptureCommand,
} from "../vendor/synara/apps/web/src/components/settings/KeyboardShortcutsSettingsPanel.logic";

// The shipped panel's own row set opens with "Show keybindings", the reference row that
// carries `command: null` because the sheet's Mod+/ chord is not rebindable.
const COMMAND_LESS_ROW = null;
const NEW_COMMAND = "sidebar.toggle" as const;

describe("Keybindings row editor predicate", () => {
  it("keeps the editor closed for a command-less row when nothing is being edited", () => {
    // Settings → Keybindings on mount: both the row's command and the panel's editing
    // target are null, which an identity check alone reads as "this row is being edited".
    expect(isShortcutRowEditing(COMMAND_LESS_ROW, null, false)).toBe(false);
  });

  it("opens the editor only for the row whose command is the editing target", () => {
    expect(isShortcutRowEditing("chat.new", "chat.new", false)).toBe(true);
  });

  it("keeps the editor closed for the other rows and for the new-binding form", () => {
    expect(isShortcutRowEditing("chat.new", "terminal.toggle", false)).toBe(false);
    expect(isShortcutRowEditing("chat.new", null, false)).toBe(false);
    expect(isShortcutRowEditing(COMMAND_LESS_ROW, "chat.new", false)).toBe(false);
    expect(isShortcutRowEditing("chat.new", "chat.new", true)).toBe(false);
  });
});

describe("Keybindings capture target", () => {
  it("ignores a capture on a row that is not being edited", () => {
    const editingCommand = null;
    const isAdding = false;
    expect(isShortcutRowEditing(COMMAND_LESS_ROW, editingCommand, isAdding)).toBe(false);
    expect(shortcutCaptureCommand(editingCommand, isAdding, NEW_COMMAND)).toBeNull();
  });

  it("captures for the row being edited and for the new-binding form", () => {
    expect(shortcutCaptureCommand("chat.new", false, NEW_COMMAND)).toBe("chat.new");
    expect(shortcutCaptureCommand(null, true, NEW_COMMAND)).toBe(NEW_COMMAND);
  });
});

describe("Keybindings save payload", () => {
  it("carries the row's command with the captured chord and condition", () => {
    const replacing = { command: "chat.new", key: "mod+n", when: "!terminalFocus" };
    expect(
      keybindingSaveRequest({
        command: "chat.new",
        key: " Mod+K ",
        when: " !terminalFocus ",
        replacing,
      }),
    ).toEqual({
      rule: { command: "chat.new", key: "mod+k", when: "!terminalFocus" },
      replacing,
    });
  });

  it("omits the condition and the replaced rule when there are none", () => {
    expect(
      keybindingSaveRequest({
        command: "terminal.toggle",
        key: "mod+`",
        when: "   ",
        replacing: null,
      }),
    ).toEqual({ rule: { command: "terminal.toggle", key: "mod+`" } });
  });

  it("stays inert while no chord has been captured", () => {
    expect(
      keybindingSaveRequest({ command: "chat.new", key: "  ", when: "", replacing: null }),
    ).toBeNull();
  });
});
