import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { workspacePath } from "./workspaces.ts";
import type { ArtifactChunk, ArtifactReceipt, ArtifactSourceHash } from "../../../packages/protocol/src/artifacts.ts";

/** Immutable copied bytes; no mutable workspace URL can masquerade as a build receipt. */
export class ArtifactStore {
  readonly #root: string;
  constructor(stateDir: string) { this.#root = join(stateDir, "artifacts"); mkdirSync(this.#root, { recursive: true, mode: 0o700 }); }
  capture(sessionId: string, cwd: string, path: string, sourcePaths: string[] = []): ArtifactReceipt {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Invalid task identity");
    if (sourcePaths.length > 1000) throw new Error("Too many source inputs");
    const bytes = this.#read(cwd, path);
    const sha256 = this.#hash(bytes);
    const sourceHashes: ArtifactSourceHash[] = sourcePaths.map(path => ({ path, sha256: this.#hash(this.#read(cwd, path)) }));
    const directory = join(this.#root, sessionId); mkdirSync(directory, { recursive: true, mode: 0o700 });
    const receipt: ArtifactReceipt = { sha256, name: basename(path), size: bytes.length, sourcePath: path, sessionId, sourceHashes, createdAt: new Date().toISOString() };
    const content = join(directory, sha256);
    if (!existsSync(content)) this.#write(content, bytes);
    const metadata = join(directory, `${sha256}.json`);
    if (!existsSync(metadata)) this.#write(metadata, Buffer.from(JSON.stringify(receipt)));
    return this.receipt(sessionId, sha256);
  }
  list(sessionId: string): ArtifactReceipt[] {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Invalid task identity");
    const directory = join(this.#root, sessionId);
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).slice(0, 1000)
      .map(name => this.receipt(sessionId, name.slice(0, -5))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  receipt(sessionId: string, sha256: string): ArtifactReceipt {
    this.#validate(sessionId, sha256);
    return JSON.parse(readFileSync(join(this.#root, sessionId, `${sha256}.json`), "utf8")) as ArtifactReceipt;
  }
  read(sessionId: string, sha256: string, offset = 0, length = 96 * 1024): ArtifactChunk {
    const receipt = this.receipt(sessionId, sha256);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 96 * 1024) throw new Error("Invalid artifact range");
    const bytes = readFileSync(join(this.#root, sessionId, sha256));
    if (offset > bytes.length) throw new Error("Artifact offset is outside the file");
    if (this.#hash(bytes) !== sha256) throw new Error("Artifact integrity failure");
    return { receipt, offset, data: bytes.subarray(offset, offset + length).toString("base64"), complete: offset + length >= bytes.length };
  }
  #validate(sessionId: string, hash: string) { if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid artifact identity"); }
  #hash(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
  #read(cwd: string, name: string) {
    const path = workspacePath(cwd, name); const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 256 * 1024 * 1024) throw new Error("Artifact must be a regular file of at most 256 MiB");
    const bytes = readFileSync(path);
    if (bytes.length > 256 * 1024 * 1024) throw new Error("Artifact grew beyond the size limit");
    return bytes;
  }
  #write(path: string, bytes: Buffer) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try {
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, path);
      const directory = openSync(dirname(path), "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } finally { try { unlinkSync(temporary); } catch { /* rename already removed the temporary file */ } }
  }
}
