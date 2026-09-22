import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BRIDGE_REQUEST_KINDS, BUNDLE_SEND_KINDS } from "../src/bridge-contract.ts";

const BUNDLE_SRC = join(import.meta.dir, "..", "agent-window", "src");

describe("bridge contract", () => {
	it("keeps the handler kinds and the bundle sends equal", () => {
		expect([...BUNDLE_SEND_KINDS].sort()).toEqual([...BRIDGE_REQUEST_KINDS].sort());
	});

	it("sends no kind the contract does not list", () => {
		const allowed = new Set<string>(BUNDLE_SEND_KINDS);
		const files = readdirSync(BUNDLE_SRC).filter(file => file.endsWith(".ts"));
		const sent = new Set<string>();
		for (const file of files) {
			const text = readFileSync(join(BUNDLE_SRC, file), "utf8");
			for (const match of text.matchAll(/kind:\s*"([a-zA-Z]+)"/g)) sent.add(match[1]!);
		}
		// Event-stream item kinds, not bridge request kinds.
		for (const item of ["snapshot", "project", "event", "context-window.updated"]) sent.delete(item);
		const outside = [...sent].filter(kind => !allowed.has(kind));
		expect(outside).toEqual([]);
	});

	it("imports the channel from one module, never a string repeat", () => {
		const files = readdirSync(BUNDLE_SRC).filter(file => file.endsWith(".ts"));
		const repeats = files.filter(file => {
			const text = readFileSync(join(BUNDLE_SRC, file), "utf8");
			// Sub-channels (browser/device/files/terminal/git events) are their own
			// contract; only the bare request channel must come from the module.
			const bare = text.replace(/vscode:cediaAgent\w+/g, "");
			return bare.includes('"vscode:cediaAgent"') || bare.includes("'vscode:cediaAgent'");
		});
		expect(repeats).toEqual([]);
	});
});
