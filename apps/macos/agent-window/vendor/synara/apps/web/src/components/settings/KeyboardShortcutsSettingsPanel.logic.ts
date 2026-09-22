// FILE: KeyboardShortcutsSettingsPanel.logic.ts
// Purpose: Row-editor predicate and save payload for the Keybindings editor, kept free of
//          React so a row can only open an editor and save a chord it owns a command for.
// Layer: Component logic helper
// Exports: isShortcutRowEditing, shortcutCaptureCommand, keybindingSaveRequest
// Depends on: @synara/contracts keybinding types

import type { KeybindingCommand, KeybindingRule } from "@synara/contracts";

/**
 * A row opens its inline editor only while it is the panel's editing target and the row
 * owns a command of its own. Reference rows carry `command: null` (`shortcuts.show`), and
 * the panel's idle editing target is also `null`, so comparing the two directly opened an
 * editor for those rows that had no command to save under.
 */
export function isShortcutRowEditing(
  command: KeybindingCommand | null,
  editingCommand: KeybindingCommand | null,
  isAdding: boolean,
): command is KeybindingCommand {
  return command !== null && !isAdding && command === editingCommand;
}

/** The command the open editor captures a chord for, or null while no editor is open. */
export function shortcutCaptureCommand(
  editingCommand: KeybindingCommand | null,
  isAdding: boolean,
  newCommand: KeybindingCommand,
): KeybindingCommand | null {
  if (isAdding) return newCommand;
  return editingCommand;
}

export interface KeybindingSaveRequest {
  readonly rule: KeybindingRule;
  readonly replacing?: KeybindingRule;
}

/**
 * Builds the rule persisted for one captured chord. The command travels with the request
 * rather than being read back from panel state, so a save can never be issued without the
 * command whose row produced it. A blank chord returns null, which keeps Save inert.
 */
export function keybindingSaveRequest(input: {
  command: KeybindingCommand;
  key: string;
  when: string;
  replacing: KeybindingRule | null;
}): KeybindingSaveRequest | null {
  const key = input.key.trim().toLowerCase();
  if (!key) return null;
  const when = input.when.trim();
  return {
    rule: {
      command: input.command,
      key,
      ...(when ? { when } : {}),
    },
    ...(input.replacing ? { replacing: input.replacing } : {}),
  };
}
