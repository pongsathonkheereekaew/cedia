import { describe, expect, it } from "bun:test";
import {
	NATIVE_GATE_TIMEOUT_MS,
	applyLoginItemShim,
	formatPendingModelObservation,
	validateStagedAppPath,
} from "./omp-packaged-task-controls-proof.ts";

describe("packaged task-controls proof helpers", () => {
	it("keeps the native gate deadline at ten minutes", () => {
		expect(NATIVE_GATE_TIMEOUT_MS).toBe(10 * 60 * 1_000);
	});

	it("formats each pending-model state without treating a request as active", () => {
		expect(formatPendingModelObservation({
			state: "awaiting",
			requested: { provider: "fixture", modelId: "fixture-model-2" },
		})).toBe("awaiting OMP · fixture/fixture-model-2");
		expect(formatPendingModelObservation({
			state: "in-effect",
			requested: { provider: "fixture", modelId: "fixture-model-2" },
			applied: { model: "fixture/fixture-model-2", via: "turn-boundary" },
		})).toBe("in effect · fixture/fixture-model-2");
		expect(formatPendingModelObservation({ state: "refused", error: "unknown model" })).toBe("refused · unknown model");
		expect(formatPendingModelObservation({ state: "awaiting" })).toBe("awaiting OMP");
		expect(formatPendingModelObservation(undefined)).toBeNull();
	});

	it("only accepts a staged app under the temporary directory", () => {
		expect(validateStagedAppPath("/private/tmp/cedia-proof/Cedia.app", "/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app", "/private/tmp")).toEqual({
			accepted: true,
			reason: "staged scratch app",
		});
		expect(validateStagedAppPath("/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app", "/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app", "/private/tmp")).toEqual({
			accepted: false,
			reason: "the installed Cedia.app is not a scratch app",
		});
		expect(validateStagedAppPath("/Users/pond/Desktop/Cedia.app", "/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app", "/private/tmp")).toEqual({
			accepted: false,
			reason: "staged app is outside the temporary directory",
		});
		expect(validateStagedAppPath("/private/tmp/cedia-proof/Cedia", "/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app", "/private/tmp")).toEqual({
			accepted: false,
			reason: "staged app must end in Cedia.app",
		});
	});

	it("patches only the reviewed Login Item calls and leaves drift fail-closed", () => {
		const source = [
			"const api = {",
			"setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),",
			"};",
			"wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;",
		].join("\n");
		const patched = applyLoginItemShim(source);
		expect(patched).toContain("intercept-set-login-item");
		expect(patched).toContain("simulated-login-state");
		expect(() => applyLoginItemShim(source.replace("setLoginItemSettings", "setLoginItemSetting"))).toThrow(/reviewed Login Item/);
	});
});
