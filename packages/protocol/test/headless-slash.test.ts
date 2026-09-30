import { describe, expect, test } from "bun:test";
import { HEADLESS_HANG_SLASH_COMMANDS, isHeadlessHangSlashCommand } from "../src/headless-slash.ts";

describe("headless-hang slash commands", () => {
	test("entries are well-formed single owners", () => {
		const names = HEADLESS_HANG_SLASH_COMMANDS.map(entry => entry.name);
		expect(new Set(names).size).toBe(names.length);
		for (const entry of HEADLESS_HANG_SLASH_COMMANDS) {
			expect(entry.name).toBe(entry.name.trim().toLowerCase());
			expect(entry.name.length).toBeGreaterThan(0);
			expect(entry.reason.length).toBeGreaterThan(0);
		}
	});

	test("matches base names only, and bare move no longer hangs", () => {
		// The fence emptied when the pinned runtime learned to answer bare `/move`
		// headless (see evidence/o02-move-headless-answered-2026-09-25/): the command
		// is back in the composer menu instead of hidden from it.
		expect(isHeadlessHangSlashCommand("move")).toBe(false);
		expect(isHeadlessHangSlashCommand("move subdir")).toBe(false);
		for (const name of ["mcp", "mcp reload", "switch", "jobs", "movement", "remove", "", "  "]) {
			expect(isHeadlessHangSlashCommand(name)).toBe(false);
		}
	});
});
