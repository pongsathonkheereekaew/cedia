import { describe, expect, it } from "vitest";

import { resolveShortcutCommand } from "./keybindings";

function modK(metaKey: boolean) {
  return {
    key: "k",
    code: "KeyK",
    metaKey,
    ctrlKey: !metaKey,
    shiftKey: false,
    altKey: false,
  };
}

describe("Cmd+K search palette", () => {
  it("opens the sidebar search palette on mod+k with no configured keybindings", () => {
    // macOS: Cmd+K, even from a focused terminal (xterm never sees Cmd chords).
    expect(
      resolveShortcutCommand(modK(true), [], {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    ).toBe("sidebar.search");
    expect(resolveShortcutCommand(modK(true), [], { platform: "MacIntel" })).toBe(
      "sidebar.search",
    );
    // Linux/Windows: Ctrl+K yields to the shell when the terminal is focused.
    expect(
      resolveShortcutCommand(modK(false), [], {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    ).toBeNull();
    expect(resolveShortcutCommand(modK(false), [], { platform: "Linux" })).toBe(
      "sidebar.search",
    );
  });

  it("opens the same palette on shift+mod+p like the IDE command palette", () => {
    const shiftModP = {
      key: "p",
      code: "KeyP",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
    };
    expect(resolveShortcutCommand(shiftModP, [], { platform: "MacIntel" })).toBe(
      "sidebar.search",
    );
    expect(
      resolveShortcutCommand(shiftModP, [], {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    ).toBe("sidebar.search");
    const linux = { ...shiftModP, metaKey: false, ctrlKey: true };
    expect(
      resolveShortcutCommand(linux, [], {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    ).toBeNull();
    expect(resolveShortcutCommand(linux, [], { platform: "Linux" })).toBe(
      "sidebar.search",
    );
  });

});
