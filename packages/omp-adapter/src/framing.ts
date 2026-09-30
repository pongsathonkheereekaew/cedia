/**
 * Framing logic adapted from OMP's MIT-licensed
 * `packages/coding-agent/src/modes/rpc/rpc-frame.ts` at
 * `fc671eba383f2a7208500836673b485c0dc7073d` (v18.4.3).
 * The retained upstream notice is recorded in
 * `docs/maintenance/evidence/omp-rpc-2026-09-12/README.md`.
 */
import { TextDecoder } from "node:util";
import {
	MAX_RPC_FRAME_BYTES,
	MAX_RPC_REASSEMBLED_BYTES,
	type OmpFrame,
	type RpcChunkFrame,
} from "./types.ts";

/** Chunk payload size used by OMP's protocol-v2 encoder. */
export const RPC_CHUNK_PAYLOAD_BYTES = 256 * 1024;

const MAX_RPC_CHUNK_COUNT = Math.ceil(MAX_RPC_REASSEMBLED_BYTES / RPC_CHUNK_PAYLOAD_BYTES);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChunkFrame(value: unknown): value is RpcChunkFrame {
	return isRecord(value) && value.type === "rpc_chunk";
}

function decodeBase64(data: unknown): Buffer {
	if (
		typeof data !== "string" ||
		data.length === 0 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
	)
		throw new Error("invalid rpc chunk data");
	const bytes = Buffer.from(data, "base64");
	if (bytes.toString("base64") !== data) throw new Error("invalid rpc chunk data");
	return bytes;
}

interface PendingChunks {
	chunkId: string;
	count: number;
	byteLength: number;
	nextIndex: number;
	chunks: Buffer[];
	receivedBytes: number;
}

/**
 * Reassembles OMP protocol-v2 chunk frames.
 *
 * OMP sends chunks contiguously and in order.  A regular frame interleaved
 * with an incomplete sequence is rejected so a stale or reordered payload can
 * never be silently attached to the wrong request.
 */
export class RpcFrameDecoder {
	#pending?: PendingChunks;

	push(value: unknown): OmpFrame | undefined {
		if (!isChunkFrame(value)) {
			if (this.#pending) throw new Error("rpc chunk sequence interrupted");
			if (!isRecord(value)) throw new Error("rpc frame must be an object");
			return value;
		}

		const { chunkId, index, count, byteLength, data } = value;
		if (
			typeof chunkId !== "string" ||
			chunkId.length === 0 ||
			chunkId.length > 128 ||
			!Number.isSafeInteger(index) ||
			!Number.isSafeInteger(count) ||
			!Number.isSafeInteger(byteLength) ||
			index < 0 ||
			count < 2 ||
			count > MAX_RPC_CHUNK_COUNT ||
			index >= count ||
			byteLength < MAX_RPC_FRAME_BYTES ||
			byteLength > MAX_RPC_REASSEMBLED_BYTES
		)
			throw new Error("invalid rpc chunk metadata");

		const bytes = decodeBase64(data);
		if (bytes.byteLength > RPC_CHUNK_PAYLOAD_BYTES) throw new Error("rpc chunk payload exceeds the transport limit");

		if (!this.#pending) {
			if (index !== 0) throw new Error("rpc chunk sequence must start at index 0");
			this.#pending = { chunkId, count, byteLength, nextIndex: 0, chunks: [], receivedBytes: 0 };
		}

		const pending = this.#pending;
		if (
			pending.chunkId !== chunkId ||
			pending.count !== count ||
			pending.byteLength !== byteLength ||
			pending.nextIndex !== index
		)
			throw new Error("rpc chunk sequence mismatch");

		pending.chunks.push(bytes);
		pending.receivedBytes += bytes.byteLength;
		pending.nextIndex++;
		if (pending.receivedBytes > pending.byteLength) throw new Error("rpc chunk sequence exceeds declared length");
		if (pending.nextIndex < pending.count) return undefined;
		if (pending.receivedBytes !== pending.byteLength) throw new Error("rpc chunk sequence length mismatch");

		this.#pending = undefined;
		let decoded: string;
		try {
			decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pending.chunks));
		} catch (cause) {
			throw new Error("rpc chunk payload is not valid UTF-8", { cause });
		}

		let frame: unknown;
		try {
			frame = JSON.parse(decoded);
		} catch (cause) {
			throw new Error("rpc chunk payload is not valid JSON", { cause });
		}
		if (!isRecord(frame)) throw new Error("rpc frame must be an object");
		return frame;
	}

	/** Fail closed when input ends halfway through a chunk sequence. */
	finish(): void {
		if (this.#pending) throw new Error("rpc chunk sequence ended before completion");
	}
}

/**
 * Incremental UTF-8 JSONL parser with a physical frame ceiling.
 *
 * Parsing operates on bytes rather than decoded strings so a multi-byte UTF-8
 * character split across Node stream chunks remains valid and the 1 MiB limit
 * cannot be bypassed with replacement characters.
 */
export class NdjsonFrameDecoder {
	#partial = Buffer.alloc(0);

	push(chunk: Uint8Array): unknown[] {
		const bytes = Buffer.from(chunk);
		const frames: unknown[] = [];
		let offset = 0;

		while (offset < bytes.byteLength) {
			const newline = bytes.indexOf(0x0a, offset);
			if (newline < 0) {
				const tail = bytes.subarray(offset);
				this.#appendPartial(tail);
				break;
			}

			const line = bytes.subarray(offset, newline + 1);
			const complete = this.#partial.byteLength === 0 ? line : Buffer.concat([this.#partial, line]);
			this.#partial = Buffer.alloc(0);
			if (complete.byteLength > MAX_RPC_FRAME_BYTES) throw new Error("rpc frame exceeds 1 MiB transport limit");
			frames.push(this.#parseLine(complete));
			offset = newline + 1;
		}

		return frames;
	}

	/** Parse a final line when stdout closes without a trailing newline. */
	finish(): unknown[] {
		if (this.#partial.byteLength === 0) return [];
		if (this.#partial.byteLength > MAX_RPC_FRAME_BYTES) throw new Error("rpc frame exceeds 1 MiB transport limit");
		const line = this.#partial;
		this.#partial = Buffer.alloc(0);
		if (line.every(byte => byte === 0x20 || byte === 0x09 || byte === 0x0d)) return [];
		return [this.#parseLine(line)];
	}

	#appendPartial(bytes: Uint8Array): void {
		if (this.#partial.byteLength + bytes.byteLength > MAX_RPC_FRAME_BYTES)
			throw new Error("rpc frame exceeds 1 MiB transport limit");
		if (bytes.byteLength === 0) return;
		this.#partial = this.#partial.byteLength === 0 ? Buffer.from(bytes) : Buffer.concat([this.#partial, bytes]);
	}

	#parseLine(line: Uint8Array): unknown {
		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(line);
		} catch (cause) {
			throw new Error("rpc frame is not valid UTF-8", { cause });
		}
		if (text.endsWith("\n")) text = text.slice(0, -1);
		if (text.endsWith("\r")) text = text.slice(0, -1);
		if (text.trim().length === 0) return {};
		try {
			return JSON.parse(text);
		} catch (cause) {
			throw new Error("rpc frame is not valid JSON", { cause });
		}
	}
}
