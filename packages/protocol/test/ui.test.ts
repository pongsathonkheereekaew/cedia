import { describe, expect, test } from "bun:test";
import { UI_INTERACTIVE_METHODS, isUiInteractiveMethod, parseUiSelectOptionDetails, unsupportedUiMethodMessage } from "../src/ui.ts";

describe("interactive UI method table", () => {
	test("names exactly the four methods OMP can send", () => {
		expect(Object.keys(UI_INTERACTIVE_METHODS).sort()).toEqual(["confirm", "editor", "input", "select"]);
		for (const method of ["select", "confirm", "input", "editor"]) expect(isUiInteractiveMethod(method)).toBe(true);
		// Own keys only: an inherited property name is never a method, and a row
		// that never exists on the wire (`password`, `notify`) is never accepted.
		for (const method of ["password", "multi_select", "schemaform", "cancel", "notify", "toString", "constructor", ""]) {
			expect(isUiInteractiveMethod(method)).toBe(false);
		}
	});

	test("states one reason both clients can show", () => {
		expect(unsupportedUiMethodMessage("password")).toBe(
			'Cedia cannot show this request: the host sent unsupported method "password"; OMP can send select, confirm, input, editor.',
		);
	});

	test("reads OMP's positional select metadata and refuses any other shape", () => {
		expect(parseUiSelectOptionDetails(undefined, 2)).toBeUndefined();
		expect(parseUiSelectOptionDetails([{ description: "a" }], 2)).toBeUndefined();
		expect(parseUiSelectOptionDetails([{ description: "a" }, "b"], 2)).toBeUndefined();
		expect(parseUiSelectOptionDetails([{ description: 7 }, {}], 2)).toBeUndefined();
		expect(parseUiSelectOptionDetails([{ description: "a" }, {}], 2)).toEqual([{ description: "a" }, {}]);
	});
});
