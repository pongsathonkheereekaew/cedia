import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readProviderSources } from "./provider-sources.ts";

/*
 * A menu or keybinding whose `when` names a context key that does not exist is
 * invisible forever: nothing throws, the entry simply never appears. The only
 * real authority for which keys exist is the pinned Code-OSS checkout, so this
 * test resolves every key-position identifier in our contributions against it
 * instead of trusting that the name was remembered correctly.
 *
 * The `vscode.d.ts` reference in src/ already makes the desktop checkout a hard
 * requirement for this package, so requiring it here adds no new constraint.
 */

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..", "..", "..", "desktop", "src", "vs");
const manifest = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
	readonly contributes: {
		readonly menus: Record<string, readonly { readonly command: string; readonly when?: string }[]>;
		readonly keybindings: readonly { readonly command: string; readonly key?: string; readonly mac?: string; readonly when?: string }[];
		readonly views: Record<string, readonly { readonly id: string }[]>;
	};
};

/** Keys this repository owns and sets itself with `setContext`. */
const ownKeys = new Set(["cedia.taskAvailable", "cedia.agentEditPending"]);

/** Identifiers in *key* position: the start of the expression, or directly
 * after `&&`, `||`, `!` or `(`. Values compared against a key (the right side
 * of `==`) are deliberately not returned: `view == cediaComposerDock` names a
 * key `view` with the value `cediaComposerDock`, and only `view` must exist. */
function keyPositionIds(when: string): string[] {
	const withoutStrings = when.replace(/'[^']*'|"[^"]*"/g, "''");
	return [...withoutStrings.matchAll(/(?:^|[&|(!]\s*)([A-Za-z_][A-Za-z0-9_.]*)/g)].map(match => match[1]!);
}

function contributionWhens(): { where: string; id: string }[] {
	const found: { where: string; id: string }[] = [];
	for (const [menu, entries] of Object.entries(manifest.contributes.menus)) {
		for (const entry of entries) {
			if (!entry.when) continue;
			for (const id of keyPositionIds(entry.when)) found.push({ where: `menus.${menu} (${entry.command})`, id });
		}
	}
	for (const binding of manifest.contributes.keybindings) {
		if (!binding.when) continue;
		for (const id of keyPositionIds(binding.when)) found.push({ where: `keybindings (${binding.command})`, id });
	}
	return found;
}

describe("menu and keybinding context keys", () => {
	// Item 57: the bundle's own resolver reads `keybindings.json` rows, not the
	// workbench registry, so the check below stays workbench-only. The
	// agent-surface `when` vocabulary is Cedia-owned (backlog/command-map.md);
	// unknown identifiers are rejected at the bridge as invalid-entry issues
	// (agent-window-keybindings.test.ts), which is the conflict gate for that
	// surface: a row can never be silently dead the way an unknown workbench
	// context key would be.
	const referenced = contributionWhens();

	it("references at least one key, so the extraction cannot silently pass", () => {
		expect(referenced.length).toBeGreaterThan(5);
	});

	it("every key-position identifier exists as a context key in the pinned engine", () => {
		expect(existsSync(desktop)).toBe(true);
		const native = [...new Set(referenced.map(entry => entry.id).filter(id => !ownKeys.has(id)))];
		expect(native.length).toBeGreaterThan(0);
		// One search for every key at once: the output tells us which of the
		// names the engine actually declares as a quoted string literal.
		const pattern = native.map(id => `'${id}'`).join("|");
		const output = execFileSync("rg", ["-o", "-N", "--no-filename", "--no-messages", "-g", "!**/test/**", pattern, desktop], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
		const declared = new Set([...output.matchAll(/'([A-Za-z_][A-Za-z0-9_.]*)'/g)].map(match => match[1]!));
		const missing = native.filter(id => !declared.has(id));
		expect(missing).toEqual([]);
	});

	it("keeps the owned keys in step with what the extension actually sets", () => {
		const source = readProviderSources(join(here, "..", "src"));
		for (const key of ownKeys) {
			// A key we gate menus on must really be set, or the whole group is dead.
			expect(source).toContain(`executeCommand("setContext", "${key}"`);
		}
	});
});
