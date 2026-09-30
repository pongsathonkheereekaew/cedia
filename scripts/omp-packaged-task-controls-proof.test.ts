import { describe, expect, it } from "bun:test";
import {
	NATIVE_GATE_TIMEOUT_MS,
	applyLoginItemShim,
	evaluateNativeSendProof,
	formatPendingModelObservation,
	resolveNativeSendMode,
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

	it("requires CUA before enabling the explicit native-send mode", () => {
		expect(resolveNativeSendMode({})).toEqual({ requested: false, cuaEnabled: false, accepted: true, enabled: false });
		expect(resolveNativeSendMode({ CEDIA_TASK_CONTROLS_NATIVE_SEND: "1" })).toEqual({ requested: true, cuaEnabled: false, accepted: false, enabled: false });
		expect(resolveNativeSendMode({ CEDIA_TASK_CONTROLS_NATIVE_SEND: "1", CEDIA_TASK_CONTROLS_CUA: "1" })).toEqual({ requested: true, cuaEnabled: true, accepted: true, enabled: true });
	});

	it("accepts exactly one native task turn and one non-transient worktree with selected keep only", () => {
		const proof = evaluateNativeSendProof({
			beforeSessionIds: [],
			sessions: [{
				id: "task-1",
				cwd: "/tmp/task-1",
				workspace: {
					mode: "worktree",
					baseRef: "main",
					sourceCommit: "base-commit",
					dirtyCopy: { mode: "selected", entries: [{ path: "keep.txt", state: "applied" }] },
				},
				turns: [{ state: "running" }],
			}],
			beforeWorktrees: [{ path: "/tmp/project", branch: "main" }],
			afterWorktrees: [
			{ path: "/tmp/project", branch: "main" },
			{ path: "/tmp/task-1", branch: "cedia/task-1" },
			],
			baseCommit: "base-commit",
			sourceKeep: "dirty keep",
			sourceDrop: "dirty drop",
			worktreeKeep: "dirty keep",
			worktreeDrop: "base drop",
			expectedSourceKeep: "dirty keep",
			expectedSourceDrop: "dirty drop",
			expectedWorktreeKeep: "dirty keep",
			expectedWorktreeDrop: "base drop",
		});

		expect(proof.ok).toBe(true);
		expect(proof.sessionCount).toBe(1);
		expect(proof.submittedTurnCount).toBe(1);
		expect(proof.addedWorktreeCount).toBe(1);
		expect(proof.transientWorktreeCount).toBe(0);
		expect(proof.checks.selectedKeepOnly).toBe(true);
		expect(proof.checks.sourcePreserved).toBe(true);
		expect(proof.checks.worktreeFilesMatch).toBe(true);
	});

	it("rejects a native send that leaves a transient worktree or carries drop.txt", () => {
		const proof = evaluateNativeSendProof({
			beforeSessionIds: [],
			sessions: [{
				id: "task-1",
				cwd: "/tmp/task-1",
				workspace: {
					mode: "worktree",
					baseRef: "main",
					sourceCommit: "base-commit",
					dirtyCopy: { mode: "selected", entries: [
						{ path: "keep.txt", state: "applied" },
						{ path: "drop.txt", state: "applied" },
					] },
				},
				turns: [{ state: "running" }],
			}],
			beforeWorktrees: [{ path: "/tmp/project", branch: "main" }],
			afterWorktrees: [
			{ path: "/tmp/project", branch: "main" },
			{ path: "/tmp/synara", branch: "synara/1234abcd" },
			{ path: "/tmp/task-1", branch: "cedia/task-1" },
			],
			baseCommit: "base-commit",
			sourceKeep: "dirty keep",
			sourceDrop: "dirty drop",
			worktreeKeep: "dirty keep",
			worktreeDrop: "dirty drop",
			expectedSourceKeep: "dirty keep",
			expectedSourceDrop: "dirty drop",
			expectedWorktreeKeep: "dirty keep",
			expectedWorktreeDrop: "base drop",
		});

		expect(proof.ok).toBe(false);
		expect(proof.addedWorktreeCount).toBe(2);
		expect(proof.transientWorktreeCount).toBe(1);
		expect(proof.checks.selectedKeepOnly).toBe(false);
		expect(proof.checks.worktreeFilesMatch).toBe(false);
	});

	it("does not treat an un-dispatched turn as a native submission", () => {
		const proof = evaluateNativeSendProof({
			beforeSessionIds: [],
			sessions: [{
				id: "task-1",
				cwd: "/tmp/task-1",
				workspace: {
					mode: "worktree",
					baseRef: "main",
					sourceCommit: "base-commit",
					dirtyCopy: { mode: "none", entries: [] },
				},
				turns: [{ state: "not_dispatched" }],
			}],
			beforeWorktrees: [{ path: "/tmp/project", branch: "main" }],
			afterWorktrees: [{ path: "/tmp/project", branch: "main" }, { path: "/tmp/task-1", branch: "cedia/task-1" }],
			baseCommit: "base-commit",
			sourceKeep: "dirty keep",
			sourceDrop: "dirty drop",
			worktreeKeep: "dirty keep",
			worktreeDrop: "base drop",
			expectedSourceKeep: "dirty keep",
			expectedSourceDrop: "dirty drop",
			expectedWorktreeKeep: "dirty keep",
			expectedWorktreeDrop: "base drop",
		});

		expect(proof.ok).toBe(false);
		expect(proof.submittedTurnCount).toBe(0);
		expect(proof.checks.oneSubmittedTurn).toBe(false);
		expect(proof.checks.selectedKeepOnly).toBe(false);
	});
});
