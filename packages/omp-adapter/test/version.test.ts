import { describe, expect, it } from "bun:test";
import { isSupportedOmpVersion, OMP_BASELINE_VERSION } from "../src/types.ts";

describe("OMP runtime version policy", () => {
	/**
	 * The baseline is a floor, not a pin: Cedia follows OMP, so a machine whose runtime is
	 * newer than the release the contract was written against runs normally, and what that
	 * runtime supports is read from its own `ready` frame (the Cedia bridges are
	 * capability-gated there) instead of being guessed from its number.
	 */
	it("accepts the baseline and every later patch of its line", () => {
		expect(isSupportedOmpVersion(`omp/${OMP_BASELINE_VERSION}`)).toBe(true);
		expect(isSupportedOmpVersion("omp/18.4.4")).toBe(true);
		expect(isSupportedOmpVersion("omp/18.4.22")).toBe(true);
	});

	it("accepts a newer minor line, which is what an updated machine reports", () => {
		// The live case history: the floor moved 18.1.18 -> 18.4.3 on 2026-09-29,
		// and refusing a newer machine runtime made startSession fail before a single prompt was sent.
		expect(isSupportedOmpVersion("omp/18.5.0")).toBe(true);
		expect(isSupportedOmpVersion("omp/18.5.1")).toBe(true);
		expect(isSupportedOmpVersion("omp/18.10.3")).toBe(true);
	});

	it("accepts a newer major line", () => {
		// A version string cannot tell Cedia what a runtime does; the ready frame can, and the
		// contract suites are what judge a new line. Refusing by number would strand a user who
		// updated their own OMP.
		expect(isSupportedOmpVersion("omp/19.0.0")).toBe(true);
	});

	it("tolerates surrounding whitespace from the binary's own output", () => {
		expect(isSupportedOmpVersion("omp/18.4.4\n")).toBe(true);
		expect(isSupportedOmpVersion("  omp/18.4.4  ")).toBe(true);
	});

	it("rejects anything older than the baseline", () => {
		// Older than the baseline means the adapter contract was never run against it.
		expect(isSupportedOmpVersion("omp/18.4.2")).toBe(false);
		expect(isSupportedOmpVersion("omp/18.1.22")).toBe(false);
		expect(isSupportedOmpVersion("omp/17.9.9")).toBe(false);
	});

	it("rejects anything that is not an OMP version string", () => {
		expect(isSupportedOmpVersion("18.4.4")).toBe(false);
		expect(isSupportedOmpVersion("omp/18.4")).toBe(false);
		expect(isSupportedOmpVersion("")).toBe(false);
		expect(isSupportedOmpVersion("omp/18.4.4-rc1")).toBe(false);
	});
});
