import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { downloadArtifact } from "../src/artifact-transfer.ts";
import type { ArtifactReceipt } from "../../../packages/protocol/src/artifacts.ts";
test("artifact download verifies all ranges and final bytes against the immutable receipt", async () => {
  const bytes = Buffer.alloc(200_000, 42);
  // The host computes a receipt with provenance (the workspace path and the inputs
  // it hashed); the client must carry the whole row, not a trimmed copy of it.
  const receipt: ArtifactReceipt = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sessionId: "task",
    size: bytes.length,
    name: "build.bin",
    sourcePath: "dist/build.bin",
    sourceHashes: [{ path: "src/main.ts", sha256: createHash("sha256").update("source").digest("hex") }],
    createdAt: "2026-09-13",
  };
  const client = { getArtifactChunk: async (_session: string, _hash: string, offset: number) => ({ receipt, offset, data: bytes.subarray(offset, offset + 96 * 1024).toString("base64"), complete: offset + 96 * 1024 >= bytes.length }) };
  expect(await downloadArtifact(client, "task", receipt)).toEqual(bytes);
  await expect(downloadArtifact(client, "other", receipt)).rejects.toThrow("Invalid artifact receipt");
  await expect(downloadArtifact({ getArtifactChunk: async () => ({ receipt, offset: 1, data: "", complete: true }) }, "task", receipt)).rejects.toThrow();
  await expect(downloadArtifact({ getArtifactChunk: async (session, hash, offset) => { const chunk = await client.getArtifactChunk(session, hash, offset); const altered = Buffer.from(chunk.data, "base64"); if (altered.length) altered[0] = 0; return { ...chunk, data: altered.toString("base64") }; } }, "task", receipt)).rejects.toThrow("Artifact integrity failure");
});
