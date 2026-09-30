import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyFrame, createInitialTaskState } from "../src/state.ts";
import {
	CEDIA_SESSION_EVENT_KINDS,
	CEDIA_SESSION_EVENT_SIGNALS,
	isCediaSessionEventSignal,
	type SessionEventSignal,
} from "../../../packages/protocol/src/index.ts";

/**
 * Acceptance fixtures for every session-event kind the pinned OMP session emits (§8.2 O01).
 *
 * The audit asked for all of them and named three recognition gaps. These cases pin the whole
 * union against the dated audit, then apply a frame of each kind so no kind can silently change
 * class: a recognised signal becomes typed state, and every other kind keeps the documented
 * generic row.
 */

const auditUnion: readonly string[] = (
	JSON.parse(readFileSync(join(import.meta.dir, "../../../docs/maintenance/evidence/omp-complete-scope-2026-09-23/rpc.json"), "utf8")) as {
		sessionEvents: { sourceUnion: string[] };
	}
).sessionEvents.sourceUnion;

function frameFor(kind: string) {
	return { type: kind, eventId: `${kind}:1` };
}

/** What the reducer must record for one kind: a typed signal, or nothing typed at all. */
function expectedSignals(kind: string): SessionEventSignal[] {
	return isCediaSessionEventSignal(kind) ? [{ kind, sequence: 1 }] : [];
}

describe("Cedia session-event kind registry", () => {
	it("covers exactly the union the dated audit extracted from the pinned source", () => {
		// A registry that drifted from the audit is the silent drop the gate refuses; a new
		// upstream kind has to be classified here before the gate can pass.
		expect([...(CEDIA_SESSION_EVENT_KINDS as readonly string[])].sort()).toEqual([...auditUnion].sort());
		expect(new Set(CEDIA_SESSION_EVENT_KINDS).size).toBe(CEDIA_SESSION_EVENT_KINDS.length);
		// The three kinds the audit names as recognition gaps are a subset of the registry, not a
		// separate list that could drift away from it.
		for (const signal of CEDIA_SESSION_EVENT_SIGNALS) expect(auditUnion).toContain(signal);
	});

	it("gives every audited kind a deterministic outcome and drops none", () => {
		for (const kind of auditUnion) {
			const state = createInitialTaskState({ connection: "connected" });
			const next = applyFrame(state, frameFor(kind), 1);
			// Nothing is silently dropped: every kind either becomes a typed signal or keeps a row,
			// and the registry that decides which is the same one the coverage gate reads.
			expect(next.sessionSignals).toEqual(expectedSignals(kind));
			expect(next.transcript).toHaveLength(1);
			expect(next.transcript[0]!.rawFrames[0]!.type).toBe(kind);
		}
	});

	it("labels the three recognition-gap signals and keeps their order and bound", () => {
		let state = createInitialTaskState({ connection: "connected" });
		const kinds = ["config_warnings_changed", "advisor_cost_changed", "advisor_yielded"] as const;
		for (const [index, kind] of kinds.entries()) state = applyFrame(state, frameFor(kind), index + 1);

		expect(state.sessionSignals).toEqual([
			{ kind: "config_warnings_changed", sequence: 1 },
			{ kind: "advisor_cost_changed", sequence: 2 },
			{ kind: "advisor_yielded", sequence: 3 },
		]);
		expect(state.transcript.map(entry => entry.text)).toEqual([
			"Config warnings changed",
			"Advisor cost changed",
			"Advisor yielded",
		]);
		// The bound keeps a long session's state small; the journal still holds every event.
		let bounded = createInitialTaskState({ connection: "connected" });
		for (let index = 0; index < 25; index += 1) bounded = applyFrame(bounded, frameFor("advisor_yielded"), index + 1);
		expect(bounded.sessionSignals).toHaveLength(20);
		expect(bounded.sessionSignals.at(-1)).toEqual({ kind: "advisor_yielded", sequence: 25 });
	});

	it("recognises the signals by name, not by the shape of an unknown frame", () => {
		// The audit's gap was three payload-free kinds; a frame with an unrelated unknown name
		// still follows the documented generic path.
		const next = applyFrame(createInitialTaskState({ connection: "connected" }), frameFor("some_future_event"), 1);
		expect(next.sessionSignals).toEqual([]);
		expect(next.transcript).toHaveLength(1);
		expect(next.transcript[0]!.text).toBe("some_future_event");
	});
});
