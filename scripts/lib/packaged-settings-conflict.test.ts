import { expect, it } from "bun:test";
import {
	SAFE_OMP_SETTING_PATH,
	chooseSafeOmpConflictPlan,
	isOmpSettingsStaleResponse,
	observesOmpStaleConflict,
} from "./packaged-settings-conflict.ts";

const key = {
	path: SAFE_OMP_SETTING_PATH,
	type: "enum",
	credential: false,
	ui: true,
	projectWritable: false,
	values: ["minimal", "low", "high"],
};

it("selects two distinct scratch-safe enum writers from the live value", () => {
	const plan = chooseSafeOmpConflictPlan([key], {
		path: SAFE_OMP_SETTING_PATH,
		credential: false,
		redacted: false,
		configured: false,
		value: "high",
		settingsRevision: "rev-1",
	});
	expect(plan).toEqual({
		path: SAFE_OMP_SETTING_PATH,
		originalValue: "high",
		nativeTarget: "low",
		routeWinner: "minimal",
		values: ["minimal", "low", "high"],
	});
});

it("rejects a protected or non-enum key instead of inventing a UI setting", () => {
	expect(() => chooseSafeOmpConflictPlan([{ ...key, credential: true }], {
		path: SAFE_OMP_SETTING_PATH,
		credential: true,
		redacted: true,
		configured: false,
		settingsRevision: "rev-1",
	})).toThrow(/credential|redacted/i);
	expect(() => chooseSafeOmpConflictPlan([{ ...key, type: "array" }], {
		path: SAFE_OMP_SETTING_PATH,
		credential: false,
		redacted: false,
		configured: false,
		value: [],
		settingsRevision: "rev-1",
	})).toThrow(/enum/i);
});

it("recognizes only the typed stale revision response and both native conflict labels", () => {
	expect(isOmpSettingsStaleResponse({ error: { code: "omp_settings_stale_revision" } })).toBe(true);
	expect(isOmpSettingsStaleResponse({ error: { code: "omp_settings_rejected" } })).toBe(false);
	expect(observesOmpStaleConflict("This value is stale and was not written. Refresh and retry")).toBe(true);
	expect(observesOmpStaleConflict("This value is stale and was not written.")).toBe(false);
});
