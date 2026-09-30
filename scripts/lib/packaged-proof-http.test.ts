import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { dereferencePackagedResponse, type ResponseChunkReader } from "./packaged-proof-http.ts";

function referenceFor(text: string): { cediaResponseReference: { sha256: string; length: number } } {
	return {
		cediaResponseReference: {
			sha256: createHash("sha256").update(text).digest("hex"),
			length: text.length,
		},
	};
}

describe("packaged proof response references", () => {
	it("reassembles chunked JSON and asks for each contiguous offset", async () => {
		// The host's reference length is UTF-16 string length while its digest is
		// over UTF-8 bytes; astral characters exercise both sides of that contract.
		const body = { commands: "🙂".repeat(70_000) };
		const text = JSON.stringify(body);
		const reference = referenceFor(text);
		const offsets: number[] = [];
		const readChunk: ResponseChunkReader = async (sha256, offset) => {
			offsets.push(offset);
			return {
				sha256,
				offset,
				length: text.length,
				text: text.slice(offset, offset + 24_000),
			};
		};

		await expect(dereferencePackagedResponse(reference, readChunk)).resolves.toEqual(body);
		expect(offsets).toEqual(Array.from({ length: Math.ceil(text.length / 24_000) }, (_, index) => index * 24_000));
	});

	it("rejects references outside the bounded response contract", async () => {
		const readChunk: ResponseChunkReader = async () => ({ sha256: "a".repeat(64), offset: 0, length: 1, text: "{}" });
		for (const reference of [
			{ sha256: "not-a-hash", length: 1 },
			{ sha256: "a".repeat(64), length: -1 },
			{ sha256: "a".repeat(64), length: Number.MAX_SAFE_INTEGER },
		]) {
			await expect(dereferencePackagedResponse({ cediaResponseReference: reference }, readChunk)).rejects.toThrow(/invalid response reference/i);
		}
	});

	it("rejects malformed chunks and integrity failures", async () => {
		const text = JSON.stringify({ commands: "x".repeat(25_000) });
		const reference = referenceFor(text);
		await expect(dereferencePackagedResponse(reference, async (sha256, offset) => ({
			sha256,
			offset: offset + 1,
			length: text.length,
			text: text.slice(offset, offset + 24_000),
		}))).rejects.toThrow(/invalid response chunk/i);
		await expect(dereferencePackagedResponse(reference, async (sha256, offset) => ({
			sha256,
			offset,
			length: text.length,
			text: "x".repeat(24_001),
		}))).rejects.toThrow(/invalid response chunk/i);

		await expect(dereferencePackagedResponse(reference, async (sha256, offset) => ({
			sha256,
			offset,
			length: text.length,
			text: text.slice(offset, offset + 24_000),
		}))).resolves.toEqual({ commands: "x".repeat(25_000) });

		const corrupted = { ...reference, cediaResponseReference: { ...reference.cediaResponseReference, sha256: "b".repeat(64) } };
		await expect(dereferencePackagedResponse(corrupted, async (_sha256, offset) => ({
			sha256: corrupted.cediaResponseReference.sha256,
			offset,
			length: text.length,
			text: text.slice(offset, offset + 24_000),
		}))).rejects.toThrow(/integrity|malformed|JSON/i);
	});
});
