import { describe, expect, it } from "bun:test";
import { packagedProofModelSlugs } from "./packaged-proof-catalog.ts";

describe("packaged catalog proof model envelopes", () => {
	it("rejects a missing or non-array models field instead of treating it as empty", () => {
		for (const value of [{}, { models: null }, { models: {} }]) {
			expect(() => packagedProofModelSlugs(value)).toThrow(/model catalog is not an array/i);
		}
	});

	it("rejects malformed model rows instead of creating an empty or partial slug", () => {
		for (const value of [{ models: [{}] }, { models: [{ provider: "fixture" }] }, { models: [{ id: "model" }] }]) {
			expect(() => packagedProofModelSlugs(value)).toThrow(/model row/i);
		}
	});

	it("keeps provider-qualified identities and baseline rows after removal", () => {
		expect(packagedProofModelSlugs({ models: [
			{ provider: "cedia_packaged_catalog_fixture", id: "ephemeral-packaged-model" },
			{ provider: "cedia-packaged-catalog-baseline", id: "baseline-model" },
		] })).toEqual(new Set([
			"cedia_packaged_catalog_fixture/ephemeral-packaged-model",
			"cedia-packaged-catalog-baseline/baseline-model",
		]));
		expect(packagedProofModelSlugs({ models: [
			{ provider: "cedia-packaged-catalog-baseline", id: "baseline-model" },
		] })).toEqual(new Set(["cedia-packaged-catalog-baseline/baseline-model"]));
	});
});
