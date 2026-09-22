import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readProviderSources } from "./provider-sources.ts";

/*
 * Every command id the extension executes must be a command that exists.
 *
 * A dead id does not throw in a way anyone notices: the rejection lands in a
 * catch, so the feature just quietly does nothing. `focusDock` shipped
 * `cediaDock.focus` for a while - `cediaDock` is a view *container*, and
 * Code-OSS registers focus commands per view as `<viewId>.focus`
 * (viewsService.ts), so "bring the agent forward" never happened.
 *
 * Core Code-OSS ids are verified by hand against the pinned checkout; these
 * assertions cover the ids this repository owns, where a rename can silently
 * break them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const sources = [readProviderSources(join(here, "../src")), readFileSync(join(here, "../src/workbench-mode.ts"), "utf8")];
const extensionSource = sources[0]!;
const manifest = JSON.parse(readFileSync(join(here, "../package.json"), "utf8")) as {
	readonly contributes: {
		readonly commands: readonly { readonly command: string }[];
		readonly viewsContainers: Record<string, readonly { readonly id: string }[]>;
		readonly views: Record<string, readonly { readonly id: string }[]>;
	};
};

const declaredCommands = new Set(manifest.contributes.commands.map(entry => entry.command));
const declaredViewIds = new Set(Object.values(manifest.contributes.views).flat().map(view => view.id));
const declaredContainerIds = new Set(Object.values(manifest.contributes.viewsContainers).flat().map(container => container.id));
// Two ways the extension reaches a command: a literal call, and a command list
// iterated into executeCommand. Both must be checked, because the dead id that
// shipped (`cediaDock.focus`) lived in the list form.
const executedIds = [...new Set(sources.flatMap(source => [
	...[...source.matchAll(/executeCommand\("([^"]+)"/g)].map(match => match[1]!),
	...[...source.matchAll(/for \(const command of \[([^\]]*)\]\)/g)].flatMap(match =>
		[...match[1]!.matchAll(/"([^"]+)"/g)].map(item => item[1]!)),
]))];

describe("executed command ids", () => {
	it("only executes Cedia ids that the manifest declares", () => {
		const cediaIds = executedIds.filter(id => id.startsWith("cedia"));
		expect(cediaIds.length).toBeGreaterThan(0);
		for (const id of cediaIds) {
			const [owner, suffix] = id.split(".");
			const isDeclaredCommand = declaredCommands.has(id);
			const isViewFocus = suffix === "focus" && declaredViewIds.has(owner!);
			expect(`${id}: ${isDeclaredCommand ? "declared command" : isViewFocus ? "declared view" : "DEAD ID"}`)
				.toBe(`${id}: ${isDeclaredCommand ? "declared command" : "declared view"}`);
		}
	});

	it("only reveals view containers the manifest declares", () => {
		const reveals = executedIds.filter(id => id.startsWith("workbench.view.extension."));
		expect(reveals.length).toBeGreaterThan(0);
		for (const id of reveals) {
			const containerId = id.slice("workbench.view.extension.".length);
			expect(`${id}: ${declaredContainerIds.has(containerId)}`).toBe(`${id}: true`);
		}
	});

	it("never focuses a container id, because containers register no focus command", () => {
		for (const containerId of declaredContainerIds) {
			const dead = `${containerId}.focus`;
			expect(`${dead}: ${executedIds.includes(dead)}`).toBe(`${dead}: false`);
		}
		// The dock must still be focusable through its view.
		expect(executedIds).toContain("cediaComposerDock.focus");
	});
});

/*
 * The webview talks to the extension with typed messages. A message the
 * extension neither parses nor handles is a button that does nothing: the
 * click posts, nothing throws, and the user sees no effect.
 */
// Item 63a: the hand-drawn task shell (webview.ts) is deleted, so there is no
// posted-message surface left to cover. The bundle talks to the extension
// through the bridge contract instead (bridge-contract.test.ts asserts those
// kind sets stay equal).
describe("webview message coverage", () => {
	it("retired the task shell: no posted-message surface remains", () => {
		expect(existsSync(join(here, "..", "src", "webview.ts"))).toBe(false);
	});
});
