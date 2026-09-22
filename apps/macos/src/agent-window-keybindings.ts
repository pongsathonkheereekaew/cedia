import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Item 57: the bundle's Settings → Keybindings section reads and writes the real
 * `Cedia/User/keybindings.json` through the extension bridge. This module is the
 * main-process side: file I/O plus validation/resolution into the
 * `ResolvedKeybindingsConfig` shape the bundle's resolver consumes.
 *
 * Why the parser lives here (not imported from the bundle): the bundle resolver
 * (`vendor/synara/apps/web/src/keybindings.ts`) is renderer code with DOM/platform
 * deps (`navigator.platform`) and no node entry point, and `apps/macos` has no
 * `effect` dependency to decode the contract Schemas at runtime. So this module
 * hand-rolls the same grammar over the same limits (MAX_KEYBINDING_VALUE_LENGTH,
 * MAX_KEYBINDING_WHEN_LENGTH, MAX_WHEN_EXPRESSION_DEPTH, MAX_KEYBINDINGS_COUNT)
 * with zero dependencies. `agent-window-keybindings.test.ts` pins the command
 * allowlist against the vendored `STATIC_KEYBINDING_COMMANDS` so the two cannot
 * drift silently.
 *
 * File syntax is bundle-flavoured, not workbench-flavoured: entries are
 * `{key: "mod+shift+n", command: "chat.new", when: "!terminalFocus"}`. The
 * workbench owns the path but ignores commands it does not know, so bundle rows
 * are inert there while the `cedia.*` workbench bindings stay in package
 * contributes. Comments and trailing commas are accepted on read (the workbench
 * editor writes them); write-back normalizes to plain JSON.
 */

export interface KeybindingRuleInput {
	readonly key: string;
	readonly command: string;
	readonly when?: string;
}

export interface KeybindingShortcut {
	readonly key: string;
	readonly metaKey: boolean;
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly modKey: boolean;
}

export type KeybindingWhenNode =
	| { readonly type: "identifier"; readonly name: string }
	| { readonly type: "not"; readonly node: KeybindingWhenNode }
	| { readonly type: "and"; readonly left: KeybindingWhenNode; readonly right: KeybindingWhenNode }
	| { readonly type: "or"; readonly left: KeybindingWhenNode; readonly right: KeybindingWhenNode };

export interface ResolvedKeybinding {
	readonly command: string;
	readonly shortcut: KeybindingShortcut;
	readonly whenAst?: KeybindingWhenNode;
}

export interface KeybindingsIssue {
	readonly kind: "keybindings.malformed-config" | "keybindings.invalid-entry";
	readonly message: string;
	readonly index?: number;
}

export interface KeybindingsReadout {
	readonly configPath: string;
	readonly keybindings: ResolvedKeybinding[];
	readonly issues: KeybindingsIssue[];
}

const MAX_VALUE_LENGTH = 64;
const MAX_WHEN_LENGTH = 256;
const MAX_WHEN_DEPTH = 64;
const MAX_COUNT = 256;

/**
 * Agent-surface `when` vocabulary (backlog/command-map.md). The bundle dispatch
 * sites build exactly this context (`useChatKeyboardShortcuts`,
 * `useDiffChangeNavigationShortcuts`, thread-jump hints): terminal state flags
 * plus the derived `isMac`. `true`/`false` literals are accepted so a row can be
 * parked without deleting it. Anything else is an invalid entry, never silently
 * false — an unknown identifier would be invisible forever.
 */
export const KEYBINDING_WHEN_IDENTIFIERS = [
	"terminalFocus",
	"terminalOpen",
	"terminalWorkspaceOpen",
	"terminalWorkspaceTerminalOnly",
	"terminalWorkspaceTerminalTabActive",
	"terminalWorkspaceChatTabActive",
	"isMac",
	"true",
	"false",
] as const;

/** Mirror of the vendored `STATIC_KEYBINDING_COMMANDS`; parity pinned by test. */
export const STATIC_KEYBINDING_COMMANDS = [
	"sidebar.toggle",
	"sidebar.search",
	"sidebar.activity",
	"sidebar.addProject",
	"sidebar.importThread",
	"space.previous",
	"space.next",
	"space.jump.1",
	"space.jump.2",
	"space.jump.3",
	"space.jump.4",
	"space.jump.5",
	"space.jump.6",
	"space.jump.7",
	"space.jump.8",
	"space.jump.9",
	"terminal.toggle",
	"terminal.split",
	"terminal.splitRight",
	"terminal.splitLeft",
	"terminal.splitDown",
	"terminal.splitUp",
	"terminal.new",
	"terminal.close",
	"terminal.workspace.newFullWidth",
	"terminal.workspace.closeActive",
	"terminal.workspace.terminal",
	"terminal.workspace.chat",
	"browser.toggle",
	"device.toggle",
	"diff.toggle",
	"diff.change.next",
	"diff.change.previous",
	"composer.focus.toggle",
	"chat.find",
	"modelPicker.toggle",
	"model.next",
	"model.previous",
	"traitsPicker.toggle",
	"settings.usage",
	"chat.new",
	"chat.newLatestProject",
	"chat.newChat",
	"chat.newLocal",
	"chat.newTerminal",
	"chat.newClaude",
	"chat.newCodex",
	"chat.newCursor",
	"chat.split",
	"view.recent.next",
	"view.recent.previous",
	"thread.jump.1",
	"thread.jump.2",
	"thread.jump.3",
	"thread.jump.4",
	"thread.jump.5",
	"thread.jump.6",
	"thread.jump.7",
	"thread.jump.8",
	"thread.jump.9",
	"thread.copyId",
	"chat.visible.next",
	"chat.visible.previous",
	"editor.openFavorite",
	"editor.file.save",
	"git.commitAndPush",
] as const;

const STATIC_COMMANDS: Readonly<Record<string, true>> = Object.fromEntries(STATIC_KEYBINDING_COMMANDS.map(command => [command, true as const]));
const SCRIPT_COMMAND_PATTERN = /^script\.[a-z0-9][a-z0-9-]{0,23}\.run$/;
const WHEN_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;

export function defaultKeybindingsFile(platform = process.platform, home = homedir()): string {
	const trimmed = home.replace(/[\\/]+$/, "");
	if (platform === "darwin") return join(trimmed, "Library", "Application Support", "Cedia", "User", "keybindings.json");
	if (platform === "win32") return join(trimmed, "AppData", "Roaming", "Cedia", "User", "keybindings.json");
	return join(trimmed, ".config", "Cedia", "User", "keybindings.json");
}

/** Strip `//` and `/* *\/` comments plus trailing commas without parsing strings as code. */
export function stripJsonComments(source: string): string {
	let out = "";
	let index = 0;
	let inString = false;
	let quote = "";
	while (index < source.length) {
		const char = source[index]!;
		if (inString) {
			out += char;
			if (char === "\\") { out += source[index + 1] ?? ""; index += 2; continue; }
			if (char === quote) inString = false;
			index += 1;
			continue;
		}
		if (char === '"' || char === "'") { inString = true; quote = char; out += char; index += 1; continue; }
		if (char === "/" && source[index + 1] === "/") {
			while (index < source.length && source[index] !== "\n") index += 1;
			continue;
		}
		if (char === "/" && source[index + 1] === "*") {
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
			index += 2;
			continue;
		}
		out += char;
		index += 1;
	}
	return out.replace(/,\s*([}\]])/g, "$1");
}

const KEY_ALIASES: Readonly<Record<string, string>> = {
	" ": "space",
	"space": "space",
	"escape": "esc",
	"esc": "esc",
	"arrowup": "arrowup",
	"arrowdown": "arrowdown",
	"arrowleft": "arrowleft",
	"arrowright": "arrowright",
	"enter": "enter",
	"tab": "tab",
	"backspace": "backspace",
	"delete": "delete",
	"home": "home",
	"end": "end",
	"pageup": "pageup",
	"pagedown": "pagedown",
};

function normalizeKeyToken(token: string): string | undefined {
	const lower = token.toLowerCase();
	if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
	if (lower.length === 1) return lower;
	if (/^f(?:[1-9]|1\d|2[0-4])$/.test(lower)) return lower;
	return undefined;
}

/** `mod+shift+n` → shortcut flags. Accepts `cmd`/`ctrl` spellings from hand edits. */
export function parseKeybindingValue(value: string): KeybindingShortcut | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_VALUE_LENGTH) return undefined;
	const tokens = trimmed.split("+").map(token => token.trim()).filter(token => token.length > 0);
	if (tokens.length < 1 || tokens.length > 3) return undefined;
	const keyToken = tokens[tokens.length - 1]!;
	const key = normalizeKeyToken(keyToken);
	if (!key) return undefined;
	let metaKey = false;
	let ctrlKey = false;
	let shiftKey = false;
	let altKey = false;
	let modKey = false;
	const seen = new Set<string>();
	for (const token of tokens.slice(0, -1)) {
		const lower = token.toLowerCase();
		const canonical = lower === "cmd" || lower === "command" ? "mod"
			: lower === "control" ? "ctrl"
			: lower === "option" ? "alt"
			: lower;
		if (!["mod", "ctrl", "meta", "alt", "shift"].includes(canonical) || seen.has(canonical)) return undefined;
		seen.add(canonical);
		if (canonical === "mod") modKey = true;
		else if (canonical === "ctrl") ctrlKey = true;
		else if (canonical === "meta") metaKey = true;
		else if (canonical === "alt") altKey = true;
		else shiftKey = true;
	}
	if (seen.size !== tokens.length - 1) return undefined;
	return { key, metaKey, ctrlKey, shiftKey, altKey, modKey };
}

interface WhenParserState {
	readonly text: string;
	position: number;
	depth: number;
}

function skipWhenSpace(state: WhenParserState): void {
	while (state.position < state.text.length && /\s/.test(state.text[state.position]!)) state.position += 1;
}

function parseWhenExpression(state: WhenParserState): KeybindingWhenNode | undefined {
	return parseWhenOr(state);
}

function parseWhenOr(state: WhenParserState): KeybindingWhenNode | undefined {
	let left = parseWhenAnd(state);
	if (!left) return undefined;
	for (;;) {
		skipWhenSpace(state);
		if (!state.text.startsWith("||", state.position)) return left;
		state.position += 2;
		const right = parseWhenAnd(state);
		if (!right) return undefined;
		left = { type: "or", left, right };
	}
}

function parseWhenAnd(state: WhenParserState): KeybindingWhenNode | undefined {
	let left = parseWhenUnary(state);
	if (!left) return undefined;
	for (;;) {
		skipWhenSpace(state);
		if (!state.text.startsWith("&&", state.position)) return left;
		state.position += 2;
		const right = parseWhenUnary(state);
		if (!right) return undefined;
		left = { type: "and", left, right };
	}
}

function parseWhenUnary(state: WhenParserState): KeybindingWhenNode | undefined {
	if (state.depth > MAX_WHEN_DEPTH) return undefined;
	skipWhenSpace(state);
	const char = state.text[state.position];
	if (char === "!") {
		state.position += 1;
		state.depth += 1;
		const node = parseWhenUnary(state);
		state.depth -= 1;
		return node ? { type: "not", node } : undefined;
	}
	if (char === "(") {
		state.position += 1;
		state.depth += 1;
		const node = parseWhenOr(state);
		state.depth -= 1;
		if (!node) return undefined;
		skipWhenSpace(state);
		if (state.text[state.position] !== ")") return undefined;
		state.position += 1;
		return node;
	}
	const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(state.text.slice(state.position));
	if (!match) return undefined;
	state.position += match[0].length;
	return { type: "identifier", name: match[0] };
}

/** Free-text `when` → AST. Unknown identifiers are rejected by the caller, not here. */
export function parseWhenExpressionText(value: string): KeybindingWhenNode | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_WHEN_LENGTH) return undefined;
	const state: WhenParserState = { text: trimmed, position: 0, depth: 0 };
	const node = parseWhenExpression(state);
	if (!node) return undefined;
	skipWhenSpace(state);
	return state.position === trimmed.length ? node : undefined;
}

function whenIdentifiers(node: KeybindingWhenNode, into: Set<string>): void {
	if (node.type === "identifier") { into.add(node.name); return; }
	if (node.type === "not") { whenIdentifiers(node.node, into); return; }
	whenIdentifiers(node.left, into);
	whenIdentifiers(node.right, into);
}

const KNOWN_WHEN: Readonly<Record<string, true>> = Object.fromEntries(KEYBINDING_WHEN_IDENTIFIERS.map(name => [name, true as const]));

export function isValidCommand(command: unknown): command is string {
	return typeof command === "string" && (Boolean(STATIC_COMMANDS[command]) || SCRIPT_COMMAND_PATTERN.test(command));
}

interface RawRule {
	readonly key?: unknown;
	readonly command?: unknown;
	readonly when?: unknown;
}

/** Boundary parse for one persisted row: named shape, fields stay unknown. */
function asRule(value: unknown): RawRule | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RawRule : undefined;
}

/** Validate one raw entry → resolved rule or an invalid-entry issue. */
export function resolveRuleEntry(entry: unknown, index: number): { rule?: ResolvedKeybinding; issue?: KeybindingsIssue } {
	const raw = asRule(entry);
	if (!raw || typeof raw.key !== "string" || typeof raw.command !== "string") {
		return { issue: { kind: "keybindings.invalid-entry", message: `Entry ${index} must be an object with string "key" and "command".`, index } };
	}
	const { key, command, when } = raw;
	if (key.trim().length > MAX_VALUE_LENGTH) {
		return { issue: { kind: "keybindings.invalid-entry", message: `Entry ${index} key exceeds ${MAX_VALUE_LENGTH} characters.`, index } };
	}
	const shortcut = parseKeybindingValue(key);
	if (!shortcut) {
		return { issue: { kind: "keybindings.invalid-entry", message: `Entry ${index} has an unparsable key "${key}".`, index } };
	}
	if (!isValidCommand(command)) {
		return { issue: { kind: "keybindings.invalid-entry", message: `Entry ${index} names an unknown command "${command}".`, index } };
	}
	let whenAst: KeybindingWhenNode | undefined;
	if (when !== undefined) {
		if (typeof when !== "string" || when.trim().length === 0 || when.trim().length > MAX_WHEN_LENGTH) {
			return { issue: { kind: "keybindings.invalid-entry", message: `Entry ${index} has an invalid "when" condition.`, index } };
		}
		const parsed = parseWhenExpressionText(when);
		if (!parsed) {
			return { issue: { kind: "keybindings.invalid-entry", message: `Entry ${index} has an unparsable "when" condition.`, index } };
		}
		const names = new Set<string>();
		whenIdentifiers(parsed, names);
		const outside = [...names].filter(name => !KNOWN_WHEN[name]);
		if (outside.length > 0) {
			return { issue: { kind: "keybindings.invalid-entry", message: `Entry ${index} uses unknown context key(s): ${[...new Set(outside)].join(", ")}.`, index } };
		}
		whenAst = parsed;
	}
	return { rule: { command, shortcut, ...(whenAst ? { whenAst } : {}) } };
}

export function resolveKeybindingRules(entries: unknown): { keybindings: ResolvedKeybinding[]; issues: KeybindingsIssue[] } {
	if (!Array.isArray(entries)) {
		return { keybindings: [], issues: [{ kind: "keybindings.malformed-config", message: "Expected a JSON array of keybinding rules." }] };
	}
	const keybindings: ResolvedKeybinding[] = [];
	const issues: KeybindingsIssue[] = [];
	entries.slice(0, MAX_COUNT).forEach((entry, index) => {
		const result = resolveRuleEntry(entry, index);
		if (result.rule) keybindings.push(result.rule);
		else if (result.issue) issues.push(result.issue);
	});
	if (entries.length > MAX_COUNT) {
		issues.push({ kind: "keybindings.invalid-entry", message: `Only the first ${MAX_COUNT} entries are used.` });
	}
	return { keybindings, issues };
}

export interface FileSystem {
	readFile(path: string): string | undefined;
	writeFile(path: string, contents: string): void;
}

const nodeFileSystem: FileSystem = {
	readFile: (path: string) => {
		try { return readFileSync(path, "utf8"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	},
	writeFile: (path: string, contents: string) => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, contents, "utf8");
	},
};

function loadRawEntries(file: string, fs: FileSystem): { entries: unknown; issues: KeybindingsIssue[] } {
	let raw: string | undefined;
	try { raw = fs.readFile(file); }
	catch { return { entries: undefined, issues: [{ kind: "keybindings.malformed-config", message: "The keybindings file could not be read." }] }; }
	if (raw === undefined) return { entries: [], issues: [] };
	if (raw.trim().length === 0) return { entries: [], issues: [] };
	let parsed: unknown;
	try { parsed = JSON.parse(stripJsonComments(raw)); }
	catch { return { entries: undefined, issues: [{ kind: "keybindings.malformed-config", message: "The keybindings file is not valid JSON." }] }; }
	return { entries: parsed, issues: [] };
}

export function readKeybindingsFile(file: string, fs: FileSystem = nodeFileSystem): KeybindingsReadout {
	const loaded = loadRawEntries(file, fs);
	if (loaded.entries === undefined) return { configPath: file, keybindings: [], issues: loaded.issues };
	const resolved = resolveKeybindingRules(loaded.entries);
	return { configPath: file, keybindings: resolved.keybindings, issues: [...loaded.issues, ...resolved.issues] };
}

function sameRule(left: KeybindingRuleInput, right: RawRule): boolean {
	const rightWhen = typeof right.when === "string" ? right.when.trim() : undefined;
	const leftWhen = typeof left.when === "string" && left.when.trim().length > 0 ? left.when.trim() : undefined;
	return right.command === left.command && right.key === left.key.trim().toLowerCase() && rightWhen === leftWhen;
}

/**
 * Upsert one rule: replace the `replacing` rule when it matches, else replace
 * the first same-command+key row, else append. Returns the fresh readout so the
 * caller's next `getConfig` agrees with what the workbench file watcher picks up.
 */
export function writeKeybindingRule(
	file: string,
	rule: unknown,
	replacing: unknown,
	fs: FileSystem = nodeFileSystem,
): KeybindingsReadout {
	const incoming = asRule(rule);
	if (!incoming || typeof incoming.key !== "string" || typeof incoming.command !== "string") {
		throw new Error("A keybinding rule needs a string key and command.");
	}
	const normalized: KeybindingRuleInput = {
		key: incoming.key.trim().toLowerCase(),
		command: incoming.command,
		...(typeof incoming.when === "string" && incoming.when.trim().length > 0 ? { when: incoming.when.trim() } : {}),
	};
	const check = resolveRuleEntry({ ...normalized }, -1);
	if (!check.rule) throw new Error(check.issue?.message ?? "Invalid keybinding rule.");
	const loaded = loadRawEntries(file, fs);
	if (loaded.entries === undefined) throw new Error(loaded.issues[0]?.message ?? "The keybindings file is not valid JSON.");
	const entries = Array.isArray(loaded.entries) ? [...loaded.entries] : [];
	const target = asRule(replacing);
	const targetRule: KeybindingRuleInput | undefined = target
		? { key: String(target.key ?? ""), command: String(target.command ?? ""), ...(typeof target.when === "string" ? { when: target.when } : {}) }
		: undefined;
	let index = targetRule ? entries.findIndex(entry => {
		const candidate = asRule(entry);
		return candidate !== undefined && sameRule(targetRule, candidate);
	}) : -1;
	if (index === -1) {
		index = entries.findIndex(entry => {
			const candidate = asRule(entry);
			return candidate !== undefined && candidate.command === normalized.command && candidate.key === normalized.key;
		});
	}
	const stored = { key: normalized.key, command: normalized.command, ...(normalized.when ? { when: normalized.when } : {}) };
	if (index === -1) {
		if (entries.length >= MAX_COUNT) throw new Error(`Keybindings are capped at ${MAX_COUNT} entries.`);
		entries.push(stored);
	} else {
		entries[index] = stored;
	}
	fs.writeFile(file, `${JSON.stringify(entries, null, 4)}\n`);
	return readKeybindingsFile(file, fs);
}
