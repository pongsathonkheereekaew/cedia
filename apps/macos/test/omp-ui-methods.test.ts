import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyFrame, createInitialTaskState, parseCediaUiRequest } from "../src/state.ts";
import { UI_METHOD_CLASSES, uiMethodClass, type UiMethodClass } from "../../../packages/protocol/src/ui.ts";

/**
 * Acceptance fixtures for every extension-UI method the pinned OMP can send (§8.2 O05).
 *
 * The audit classified eleven methods and asked that each one reach a real Cedia surface. These
 * cases drive the production parsers for all eleven, and pin the classification in
 * `UI_METHOD_CLASSES` against the audit so neither side can drift.
 */

const audited = (
	JSON.parse(readFileSync(join(import.meta.dir, "../../../docs/maintenance/evidence/omp-complete-scope-2026-09-23/rpc.json"), "utf8")) as {
		extensionUiMethods: { method: string; class: string }[];
	}
).extensionUiMethods;

/** The audit's own wording, mapped onto Cedia's three classes. */
function auditedClass(auditClass: string): UiMethodClass {
	if (auditClass === "interactive") return "interactive";
	if (auditClass === "cancellation") return "cancellation";
	if (auditClass.startsWith("customUI")) return "presentation";
	throw new Error(`Unknown audited class ${auditClass}`);
}

const REQUEST_FIELDS: Record<string, Record<string, unknown>> = {
	select: { options: ["one", "two"] },
	confirm: { message: "Proceed?" },
	input: { placeholder: "a value" },
	editor: { prefill: "text", promptStyle: true },
};

const PRESENTATION_FIELDS: Record<string, Record<string, unknown>> = {
	notify: { message: "done", notifyType: "info" },
	setStatus: { statusKey: "build", statusText: "running" },
	setWidget: { widgetKey: "panel", widgetLines: ["line one", "line two"], widgetPlacement: "belowEditor" },
	setTitle: { title: "Cedia task" },
	set_editor_text: { text: "buffer contents" },
	open_url: { url: "https://example.invalid/docs", launchUrl: "https://example.invalid/docs", instructions: "Open it" },
};

function requestEnvelope(method: string, token: string) {
	return { type: "cedia_ui", event: { kind: "interactive", token, request: { method, id: `${method}-1`, title: "Title", ...(REQUEST_FIELDS[method] ?? {}) } } };
}

function presentationEnvelope(method: string) {
	return { type: "cedia_ui", event: { kind: "presentation", request: { method, id: `${method}-1`, ...(PRESENTATION_FIELDS[method] ?? {}) } } };
}

describe("Cedia extension-UI method coverage", () => {
	it("classifies exactly the methods the dated audit lists, in the same class", () => {
		expect(Object.keys(UI_METHOD_CLASSES).sort()).toEqual(audited.map(row => row.method).sort());
		for (const row of audited) expect(uiMethodClass(row.method)).toBe(auditedClass(row.class));
		expect(Object.keys(UI_METHOD_CLASSES)).toHaveLength(11);
	});

	it("carries every audited method through its real Cedia path", () => {
		for (const row of audited) {
			const methodClass = auditedClass(row.class);
			if (methodClass === "interactive") {
				const envelope = requestEnvelope(row.method, `tok-${row.method}`);
				expect(parseCediaUiRequest(envelope.event).ok).toBe(true);
				const state = applyFrame(createInitialTaskState({ connection: "connected" }), envelope, 1);
				expect(state.uiRequests).toHaveLength(1);
				expect(state.uiRequests[0]).toMatchObject({ token: `tok-${row.method}`, request: { method: row.method } });
			} else if (methodClass === "presentation") {
				const state = applyFrame(createInitialTaskState({ connection: "connected" }), presentationEnvelope(row.method), 1);
				expect(state.presentations).toHaveLength(1);
				expect(state.presentations[0]).toMatchObject({ method: row.method, id: `${row.method}-1` });
			} else {
				// Cancellation is carried by the host's server-cancel notification, which clears the
				// request it names rather than leaving it pending forever.
				const opened = applyFrame(createInitialTaskState({ connection: "connected" }), requestEnvelope("confirm", "tok-cancel"), 1);
				expect(opened.uiRequests).toHaveLength(1);
				const cancelled = applyFrame(opened, { type: "cedia_ui", event: { kind: "server-cancel", token: "tok-cancel" } }, 2);
				expect(cancelled.uiRequests).toHaveLength(0);
			}
		}
	});

	it("does not present a method the registry has not classified", () => {
		const state = applyFrame(createInitialTaskState({ connection: "connected" }), { type: "cedia_ui", event: { kind: "presentation", request: { method: "someFutureMethod", id: "x" } } }, 1);
		// A presentation row is a notice, not a question: a client that does not know the method
		// renders nothing rather than inventing a layout for it (packages/protocol/src/ui.ts).
		expect(state.presentations).toHaveLength(0);
		expect(state.uiRequests).toHaveLength(0);
		expect(state.lastError).toBeUndefined();
	});
});
