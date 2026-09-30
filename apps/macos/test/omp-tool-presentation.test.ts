import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyEventPage, createInitialTaskState } from "../src/state.ts";
import type { SessionEvent } from "../../../packages/protocol/src/index.ts";

/**
 * Acceptance fixtures for every audited tool name (§8.2 O05).
 *
 * OMP owns the tool registry and executes a tool inside a turn (the audit's own boundary rule:
 * `omp_owns` lists `tool_registry` and `execution`). Cedia owns the presentation seam, so every
 * audited name - a built-in, a hidden control, an alias or a dynamic MCP/custom tool - travels the
 * same tool-card path. These cases apply one full lifecycle per name and assert the card keeps the
 * name OMP sent, the outcome, and every raw frame.
 */

const audit = JSON.parse(
	readFileSync(join(import.meta.dir, "../../../docs/maintenance/evidence/omp-complete-scope-2026-09-23/tools.json"), "utf8"),
) as {
	registry: { builtin: { name: string }[]; hidden: { name: string }[]; aliases: Record<string, string> };
	dynamic: { name: string }[];
};

const auditedNames: readonly string[] = [
	...audit.registry.builtin.map(row => row.name),
	...audit.registry.hidden.map(row => row.name),
	...Object.keys(audit.registry.aliases),
	...audit.dynamic.map(row => row.name),
];

/** One complete tool lifecycle for a name, journaled the way the host delivers it. */
function lifecycle(name: string): SessionEvent[] {
	const frame = (index: number, body: Record<string, unknown>) => ({
		sessionId: "s",
		incarnation: "i",
		sequence: index,
		timestamp: "2026-09-24T00:00:00Z",
		frame: { toolCallId: "call-1", toolName: name, ...body },
	});
	return [
		frame(1, { type: "tool_execution_start", args: { input: "value" } }),
		frame(2, { type: "tool_execution_update", partialResult: { content: [{ type: "text", text: "streaming" }] } }),
		frame(3, { type: "tool_execution_end", result: { content: [{ type: "text", text: "finished" }] }, isError: false }),
	];
}

describe("Cedia tool presentation coverage", () => {
	it("has at least one name of every audited kind to prove the path with", () => {
		expect(audit.registry.builtin.length).toBeGreaterThan(20);
		expect(Object.keys(audit.registry.aliases).length).toBeGreaterThan(0);
		expect(audit.dynamic.length).toBeGreaterThan(0);
		expect(auditedNames.length).toBe(audit.registry.builtin.length + audit.registry.hidden.length + Object.keys(audit.registry.aliases).length + audit.dynamic.length);
	});

	it("renders one complete card per audited tool name, including aliases and dynamic tools", () => {
		for (const name of auditedNames) {
			const state = applyEventPage(createInitialTaskState({ connection: "connected" }), { events: lifecycle(name), cursor: 3, hasMore: false });
			expect(state.transcript).toHaveLength(1);
			expect(state.transcript[0]).toMatchObject({ id: "call-1", kind: "tool", toolName: name, toolStatus: "completed" });
			expect(state.transcript[0]?.output).toContain("streaming");
			expect(state.transcript[0]?.output).toContain("finished");
			// The card keeps every frame OMP sent, so a renderer can re-derive anything it needs.
			expect(state.transcript[0]?.rawFrames).toHaveLength(3);
			expect(state.activeToolIds).toHaveLength(0);
		}
	});

	it("keeps a failed tool's outcome instead of presenting it as a success", () => {
		const events: SessionEvent[] = [
			{ sessionId: "s", incarnation: "i", sequence: 1, timestamp: "t", frame: { type: "tool_execution_start", toolCallId: "c", toolName: "bash" } },
			{ sessionId: "s", incarnation: "i", sequence: 2, timestamp: "t", frame: { type: "tool_execution_end", toolCallId: "c", toolName: "bash", result: { content: [{ type: "text", text: "exit 1" }], isError: true }, isError: true } },
		];
		const state = applyEventPage(createInitialTaskState({ connection: "connected" }), { events, cursor: 2, hasMore: false });
		expect(state.transcript[0]).toMatchObject({ toolName: "bash", toolStatus: "failed", status: "failed" });
	});

	it("names an unaudited tool instead of dropping it, so a new tool cannot go unnoticed", () => {
		// A tool OMP adds later still reaches a card; the coverage gate is what reports it as
		// unclassified, not the renderer that renders what it was sent.
		const state = applyEventPage(createInitialTaskState({ connection: "connected" }), { events: lifecycle("brand_new_tool"), cursor: 3, hasMore: false });
		expect(state.transcript[0]).toMatchObject({ toolName: "brand_new_tool", toolStatus: "completed" });
	});
});
