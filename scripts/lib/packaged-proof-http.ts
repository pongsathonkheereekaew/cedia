import { createHash } from "node:crypto";

const MAX_RESPONSE_LENGTH = 64 * 1024 * 1024;
const MAX_CHUNK_LENGTH = 24_000;

export interface ResponseChunk {
	readonly sha256: string;
	readonly offset: number;
	readonly length: number;
	readonly text: string;
}

export type ResponseChunkReader = (sha256: string, offset: number) => Promise<unknown>;

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function invalid(message: string): Error {
	return new Error(`Invalid response reference${message ? `: ${message}` : ""}`);
}

function reference(value: unknown): { sha256: string; length: number } {
	const row = record(value);
	if (!row || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(row.sha256)
		|| typeof row.length !== "number" || !Number.isSafeInteger(row.length) || row.length < 1 || row.length > MAX_RESPONSE_LENGTH) {
		throw invalid("invalid metadata");
	}
	return { sha256: row.sha256.toLowerCase(), length: row.length };
}

function chunk(value: unknown, expected: { sha256: string; length: number; offset: number }): ResponseChunk {
	const row = record(value);
	if (!row || typeof row.sha256 !== "string" || row.sha256.toLowerCase() !== expected.sha256
		|| row.offset !== expected.offset || row.length !== expected.length || typeof row.text !== "string"
		|| row.text.length === 0 || row.text.length > MAX_CHUNK_LENGTH
		|| expected.offset + row.text.length > expected.length) {
		throw new Error("Invalid response chunk");
	}
	return row as unknown as ResponseChunk;
}

/** Follow and verify the host's bounded response-reference transport. */
export async function dereferencePackagedResponse(body: unknown, readChunk: ResponseChunkReader): Promise<unknown> {
	const row = record(body);
	if (!row || !Object.hasOwn(row, "cediaResponseReference")) return body;
	const ref = reference(row.cediaResponseReference);
	let offset = 0;
	let text = "";
	while (offset < ref.length) {
		const page = chunk(await readChunk(ref.sha256, offset), { ...ref, offset });
		text += page.text;
		offset += page.text.length;
	}
	if (text.length !== ref.length || createHash("sha256").update(text).digest("hex") !== ref.sha256) {
		throw new Error("Response reference integrity failure");
	}
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error("Response reference contains malformed JSON", { cause: error });
	}
}
