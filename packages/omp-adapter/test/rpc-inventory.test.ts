import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RPC_COMMAND_TYPES } from "../src/types.ts";

describe("OMP RPC inventory lock", () => {
	it("keeps the adapter command tuple identical to the pinned source inventory", () => {
		const inventory = JSON.parse(readFileSync(join(import.meta.dir, "../../../docs/maintenance/evidence/omp-complete-scope-2026-09-29/rpc.json"), "utf8")) as { commands: { name: string }[] };
		const stock = inventory.commands.map(row => row.name).filter(name => !name.startsWith("cedia_"));
		expect(new Set([...RPC_COMMAND_TYPES] as string[])).toEqual(new Set(stock));
		expect(RPC_COMMAND_TYPES).toHaveLength(47);
	});
});
