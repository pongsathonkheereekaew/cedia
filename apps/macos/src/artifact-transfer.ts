import { createHash } from "node:crypto";
import type { ArtifactChunk, ArtifactReceipt } from "../../../packages/protocol/src/artifacts.ts";

export async function downloadArtifact(client: { getArtifactChunk(sessionId: string, sha256: string, offset: number): Promise<ArtifactChunk> }, sessionId: string, receipt: ArtifactReceipt): Promise<Buffer> {
  if (receipt.sessionId !== sessionId || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.size) || receipt.size < 0 || receipt.size > 256 * 1024 * 1024) throw new Error("Invalid artifact receipt");
  const chunks: Buffer[] = []; let offset = 0;
  do {
    const chunk = await client.getArtifactChunk(sessionId, receipt.sha256, offset);
    if (chunk.offset !== offset || chunk.receipt.sha256 !== receipt.sha256 || chunk.receipt.size !== receipt.size || chunk.receipt.sessionId !== sessionId || typeof chunk.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.data)) throw new Error("Artifact chunk does not match its receipt");
    const bytes = Buffer.from(chunk.data, "base64");
    if (bytes.length > 96 * 1024 || offset + bytes.length > receipt.size || (!bytes.length && receipt.size !== 0)) throw new Error("Invalid artifact range");
    chunks.push(bytes); offset += bytes.length;
    if (chunk.complete !== (offset === receipt.size)) throw new Error("Incomplete artifact transfer");
  } while (offset < receipt.size);
  const bytes = Buffer.concat(chunks);
  if (createHash("sha256").update(bytes).digest("hex") !== receipt.sha256) throw new Error("Artifact integrity failure");
  return bytes;
}
