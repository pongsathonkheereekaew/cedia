import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultKeybindingsFile,
	KEYBINDING_WHEN_IDENTIFIERS,
	parseKeybindingValue,
	parseWhenExpressionText,
	readKeybindingsFile,
	resolveKeybindingRules,
	STATIC_KEYBINDING_COMMANDS,
	stripJsonComments,
	writeKeybindingRule,
} from "../src/agent-window-keybindings.ts";

function memFs(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	return {
		readFile: (path: string) => files.get(path),
		writeFile: (path: string, contents: string) => { files.set(path, contents); },
		files,
	};
}

describe("agent-window keybindings file", () => {
	it("pins the command allowlist against the vendored contract source", () => {
		const vendored = readFileSync(
			join(import.meta.dir, "..", "agent-window", "vendor/synara/packages/contracts/src/keybindings.ts"),
			"utf8",
		);
		const match = /STATIC_KEYBINDING_COMMANDS = \[(.*?)\] as const/s.exec(vendored);
		expect(match?.[1]).toBeTruthy();
		const names = [...match![1]!.matchAll(/"([^"]+)"/g)].map(entry => entry[1]!);
		expect([...STATIC_KEYBINDING_COMMANDS] as string[]).toEqual(names);
	});

	it("resolves a mixed file: valid rows pass, bad rows become issues", () => {
		const { keybindings, issues } = resolveKeybindingRules([
			{ key: "mod+shift+n", command: "chat.new", when: "!terminalFocus" },
			{ key: "cmd+k", command: "sidebar.search" },
			{ key: "mod+x", command: "nope.unknown" },
			{ key: "mod+y", command: "chat.new", when: "editorTextFocus" },
			{ key: "not a key at all ++++", command: "chat.new" },
			"junk",
		]);
		expect(keybindings).toHaveLength(2);
		expect(keybindings[0]).toMatchObject({
			command: "chat.new",
			shortcut: { key: "n", modKey: true, shiftKey: true },
		});
		expect(keybindings[0]?.whenAst).toEqual({ type: "not", node: { type: "identifier", name: "terminalFocus" } });
		expect(keybindings[1]?.shortcut).toMatchObject({ key: "k", modKey: true });
		expect(issues.map(issue => issue.kind)).toEqual([
			"keybindings.invalid-entry",
			"keybindings.invalid-entry",
			"keybindings.invalid-entry",
			"keybindings.invalid-entry",
		]);
		expect(issues[1]?.message).toContain("editorTextFocus");
	});

	it("accepts script commands and every documented when identifier", () => {
		for (const name of KEYBINDING_WHEN_IDENTIFIERS) {
			if (name === "true" || name === "false") continue;
			expect(parseWhenExpressionText(name)).toEqual({ type: "identifier", name });
		}
		const { keybindings, issues } = resolveKeybindingRules([
			{ key: "mod+1", command: "script.lint.run" },
			{ key: "mod+2", command: "script.toolongidentifier1234567890.run" },
			{ key: "mod+3", command: "chat.new", when: "terminalFocus && !terminalWorkspaceOpen || isMac" },
		]);
		expect(issues.map(issue => issue.message)).toEqual([
			expect.stringContaining("unknown command"),
		]);
		expect(keybindings).toHaveLength(2);
	});

	it("parses the key grammar the bundle capture writes", () => {
		expect(parseKeybindingValue("mod+shift+n")).toMatchObject({ key: "n", modKey: true, shiftKey: true });
		expect(parseKeybindingValue("CMD+K")).toMatchObject({ key: "k", modKey: true });
		expect(parseKeybindingValue("ctrl+alt+p")).toMatchObject({ ctrlKey: true, altKey: true, key: "p" });
		expect(parseKeybindingValue("ctrl+tab")).toMatchObject({ ctrlKey: true, key: "tab" });
		expect(parseKeybindingValue("space")).toMatchObject({ key: "space" });
		expect(parseKeybindingValue("escape")).toMatchObject({ key: "esc" });
		expect(parseKeybindingValue("mod")).toBeUndefined();
		expect(parseKeybindingValue("mod+shift+ctrl+x")).toBeUndefined();
		expect(parseKeybindingValue("mod+mod+x")).toBeUndefined();
	});

	it("reads a workbench-touched file: comments and trailing commas survive", () => {
		const fs = memFs({
			"/tmp/kb.json": `// edited in the workbench\n[\n  { "key": "mod+n", "command": "chat.new", },\n]\n`,
		});
		const readout = readKeybindingsFile("/tmp/kb.json", fs);
		expect(readout.keybindings).toHaveLength(1);
		expect(readout.issues).toEqual([]);
		const missing = readKeybindingsFile("/tmp/absent.json", fs);
		expect(missing).toMatchObject({ keybindings: [], issues: [] });
		const broken = memFs({ "/tmp/kb.json": `[oops` });
		expect(readKeybindingsFile("/tmp/kb.json", broken).issues[0]?.kind).toBe("keybindings.malformed-config");
		expect(stripJsonComments(`{"a": "x//y" // trailing\n}`)).toContain(`"x//y"`);
	});

	it("upsert replaces the edited row and appends new ones", () => {
		const fs = memFs({ "/tmp/kb.json": JSON.stringify([{ key: "mod+n", command: "chat.new" }]) });
		const first = writeKeybindingRule("/tmp/kb.json", { key: "mod+shift+n", command: "chat.new" }, { key: "mod+n", command: "chat.new" }, fs);
		expect(first.keybindings).toHaveLength(1);
		expect(first.keybindings[0]?.shortcut).toMatchObject({ key: "n", shiftKey: true });
		const second = writeKeybindingRule("/tmp/kb.json", { key: "mod+k", command: "sidebar.search", when: "!terminalFocus" }, undefined, fs);
		expect(second.keybindings).toHaveLength(2);
		expect(() => writeKeybindingRule("/tmp/kb.json", { key: "mod+z", command: "nope" }, undefined, fs)).toThrow("unknown command");
		expect(() => writeKeybindingRule("/tmp/kb.json", { key: "mod+z", command: "chat.new", when: "editorTextFocus" }, undefined, fs)).toThrow("editorTextFocus");
	});

	it("defaults to the workbench user file per platform", () => {
		expect(defaultKeybindingsFile("darwin", "/Users/t")).toBe("/Users/t/Library/Application Support/Cedia/User/keybindings.json");
		expect(defaultKeybindingsFile("win32", "C:\\u")).toContain("Cedia/User/keybindings.json");
		expect(defaultKeybindingsFile("linux", "/home/t")).toBe("/home/t/.config/Cedia/User/keybindings.json");
	});

	it("round-trips through a real temp file", () => {
		const dir = mkdtempSync(join(tmpdir(), "cedia-kb-"));
		const file = join(dir, "keybindings.json");
		writeFileSync(file, "[]");
		const readout = writeKeybindingRule(file, { key: "mod+k", command: "sidebar.search" }, undefined);
		expect(readout.keybindings).toHaveLength(1);
		expect(readKeybindingsFile(file).keybindings).toHaveLength(1);
	});
	it("runs the item-57 conflict gate: bundle dispatch context is inside the vocabulary", () => {
		const text = readFileSync(
			join(import.meta.dir, "..", "agent-window", "vendor/synara/apps/web/src/components/chat/useChatKeyboardShortcuts.ts"),
			"utf8",
		);
		const block = /const shortcutContext = \{([^}]*)\}/s.exec(text)?.[1] ?? "";
		const provided = new Set([...block.matchAll(/(\w+)\s*[:,]/g)].map(match => match[1]!));
		for (const name of ["terminalFocus", "terminalOpen", "terminalWorkspaceOpen", "terminalWorkspaceTerminalOnly", "terminalWorkspaceTerminalTabActive", "terminalWorkspaceChatTabActive"]) {
			expect(provided.has(name), `dispatch context provides ${name}`).toBe(true);
		}
		const vocabulary = new Set<string>(KEYBINDING_WHEN_IDENTIFIERS);
		expect([...provided].filter(name => !vocabulary.has(name))).toEqual([]);
	});
});
