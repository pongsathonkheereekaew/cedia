import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_REGISTRY, UNLISTED_COMMANDS } from "../src/task-commands.ts";
import { readProviderSources } from "./provider-sources.ts";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
	readonly contributes: { readonly commands: readonly { readonly command: string }[] };
};
const extensionSource = readProviderSources(join(here, "..", "src"));

describe("command registry", () => {
	it("enumerates every registered command from one module", () => {
		const ids = COMMAND_REGISTRY.map(entry => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.length).toBe(39);
		// activate() registers through the table, not inline literals.
		expect(extensionSource).toContain("...registerCediaCommands(vscode, provider, ideAgent)");
		expect(extensionSource).not.toMatch(/registerCommand\("cedia\./);
	});

	it("matches the manifest except the two documented internals", () => {
		const manifestIds = new Set(manifest.contributes.commands.map(entry => entry.command));
		const registryIds = new Set(COMMAND_REGISTRY.map(entry => entry.id));
		for (const id of manifestIds) expect(registryIds.has(id), `${id} registered`).toBe(true);
		const unlisted = [...registryIds].filter(id => !manifestIds.has(id));
		expect(unlisted.sort()).toEqual(["cedia.browser.suggest", "cedia.focusDock"]);
		expect(Object.keys(UNLISTED_COMMANDS).sort()).toEqual(unlisted.sort());
	});
});
