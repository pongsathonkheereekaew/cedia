/**
 * Cedia's artifact protocol.
 *
 * Why this file exists (§10 item 65c): the receipt and the chunk were declared
 * three times — the host's `apps/host/src/artifacts.ts`, the Mac extension's
 * `artifact-transfer.ts`, and the phone's `core/artifacts.ts` — and the two
 * client copies had already drifted: the Mac one silently dropped `sourcePath`
 * and `sourceHashes`, which are exactly the provenance a user needs to tell a
 * build receipt from a random file. The producer is the contract, so the host's
 * shape lives here and every reader imports it.
 *
 * The host's artifact routes carry all of it:
 *   GET  /v1/sessions/:id/artifacts              list receipts, newest first
 *   POST /v1/sessions/:id/artifacts { path, sourcePaths? }  capture one
 *   GET  /v1/sessions/:id/artifacts/:sha256?offset=         one chunk
 */

/** One workspace input the captured bytes were built from. */
export interface ArtifactSourceHash {
  readonly path: string;
  readonly sha256: string;
}

/**
 * Immutable copied bytes, as the host stores them.
 *
 * `sha256` is the hash of the bytes themselves; `sourcePath` and
 * `sourceHashes` are provenance — what the capture was read from and hashed
 * against — never a claim that the workspace still holds those bytes.
 */
export interface ArtifactReceipt {
  readonly sha256: string;
  readonly name: string;
  readonly size: number;
  readonly sourcePath: string;
  readonly sessionId: string;
  readonly sourceHashes: readonly ArtifactSourceHash[];
  readonly createdAt: string;
}

/**
 * One bounded slice of an artifact's bytes, base64 in `data`.
 *
 * `complete` is `offset + data.length >= receipt.size`: the last chunk a
 * transfer needs, so a client never infers completion from an empty chunk.
 */
export interface ArtifactChunk {
  readonly receipt: ArtifactReceipt;
  readonly offset: number;
  readonly data: string;
  readonly complete: boolean;
}
