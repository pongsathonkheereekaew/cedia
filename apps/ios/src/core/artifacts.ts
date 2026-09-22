import { fromByteArray, toByteArray } from "base64-js";
import type { Json } from "../../../../packages/protocol/src/index.ts";
// The receipt, its source hashes and the chunk are the protocol's own rows
// (§10 item 65c), declared once in `packages/protocol/src/artifacts.ts`;
// `core/index.ts` re-exports them for the app.
import type { ArtifactChunk, ArtifactReceipt, ArtifactSourceHash } from "../../../../packages/protocol/src/artifacts.ts";

/** The host keeps immutable artifact bytes up to 256 MiB. */
export const CEDIA_HOST_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;
/**
 * A phone has a lower explicit transfer ceiling.  The list remains usable for
 * larger receipts, while preview/download refuses to materialize them in JS.
 */
export const CEDIA_MOBILE_ARTIFACT_MAX_BYTES = 32 * 1024 * 1024;
export const CEDIA_MOBILE_TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const CEDIA_ARTIFACT_CHUNK_MAX_BYTES = 96 * 1024;
export const CEDIA_ARTIFACT_MAX_SOURCE_HASHES = 1_000;

export type ArtifactKind = "text" | "image" | "audio" | "video" | "binary";

export interface ArtifactReader {
  readArtifact(sessionId: string, sha256: string, offset?: number): Promise<ArtifactChunk>;
}

export interface ArtifactTransferOptions {
  /** An explicit lower ceiling for callers that need a smaller preview. */
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
  /** Injected in tests; native/web code uses the platform implementation. */
  readonly digestSha256?: (bytes: Uint8Array) => Promise<string>;
  readonly onChunk?: (chunk: ArtifactChunk, bytes: Uint8Array) => void | Promise<void>;
}

export interface ArtifactDownload {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
  readonly shared: boolean;
}

const SHA256_RE = /^[a-f0-9]{64}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) throw new Error(`Invalid artifact ${field}`);
  return value;
}

function digestString(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256_RE.test(value)) throw new Error(`Invalid artifact ${field}`);
  return value.toLowerCase();
}

function safeSessionId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new Error("Invalid artifact task identity");
  return value;
}

/** Parse and bind a receipt to one selected task before exposing it to UI. */
export function parseArtifactReceipt(value: unknown, expectedSessionId?: string): ArtifactReceipt {
  if (!record(value)) throw new Error("Cedia host returned an invalid artifact receipt");
  const sessionId = requiredString(value.sessionId, "sessionId", 256);
  safeSessionId(sessionId);
  if (expectedSessionId !== undefined && sessionId !== expectedSessionId) throw new Error("Artifact belongs to a different task");
  const size = value.size;
  if (!Number.isSafeInteger(size) || (size as number) < 0 || (size as number) > CEDIA_HOST_ARTIFACT_MAX_BYTES) throw new Error("Invalid artifact size");
  const sourceHashes = value.sourceHashes;
  if (!Array.isArray(sourceHashes) || sourceHashes.length > CEDIA_ARTIFACT_MAX_SOURCE_HASHES) throw new Error("Invalid artifact source hashes");
  const parsedSources = sourceHashes.map(source => {
    if (!record(source)) throw new Error("Invalid artifact source hash");
    return {
      path: requiredString(source.path, "source path", 4_096),
      sha256: digestString(source.sha256, "source hash"),
    } satisfies ArtifactSourceHash;
  });
  const createdAt = requiredString(value.createdAt, "createdAt", 128);
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Invalid artifact createdAt");
  return {
    sha256: digestString(value.sha256, "hash"),
    name: requiredString(value.name, "name", 512),
    size: size as number,
    sourcePath: requiredString(value.sourcePath, "source path", 4_096),
    sessionId,
    sourceHashes: parsedSources,
    createdAt,
  };
}

/** Return the decoded byte count without allocating a second buffer. */
export function base64ByteLength(value: string): number {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Invalid artifact base64 data");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length / 4 * 3 - padding;
}

function decodeBase64(value: string): Uint8Array {
  try {
    const bytes = toByteArray(value);
    if (bytes.byteLength > CEDIA_ARTIFACT_CHUNK_MAX_BYTES) throw new Error("Artifact chunk exceeds 96 KiB");
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message === "Artifact chunk exceeds 96 KiB") throw error;
    throw new Error("Invalid artifact base64 data", { cause: error });
  }
}

/** Validate receipt identity, range, base64, and completion semantics. */
export function parseArtifactChunk(value: unknown, sessionId: string, sha256: string, expectedOffset: number): ArtifactChunk {
  safeSessionId(sessionId);
  const expectedHash = digestString(sha256, "hash");
  if (!Number.isSafeInteger(expectedOffset) || expectedOffset < 0) throw new RangeError("Invalid artifact offset");
  if (!record(value)) throw new Error("Cedia host returned an invalid artifact chunk");
  const receipt = parseArtifactReceipt(value.receipt, sessionId);
  if (receipt.sha256 !== expectedHash) throw new Error("Artifact chunk belongs to a different artifact");
  if (value.offset !== expectedOffset) throw new Error("Artifact chunk offset changed during transfer");
  if (typeof value.data !== "string") throw new Error("Invalid artifact chunk data");
  const byteLength = base64ByteLength(value.data);
  if (byteLength > CEDIA_ARTIFACT_CHUNK_MAX_BYTES) throw new Error("Artifact chunk exceeds 96 KiB");
  const bytes = decodeBase64(value.data);
  if (bytes.byteLength !== byteLength) throw new Error("Artifact chunk length is invalid");
  if (expectedOffset > receipt.size || expectedOffset + byteLength > receipt.size) throw new Error("Artifact chunk exceeds receipt size");
  if (typeof value.complete !== "boolean") throw new Error("Invalid artifact completion flag");
  const complete = value.complete as boolean;
  if (complete !== (expectedOffset + byteLength >= receipt.size)) throw new Error("Artifact completion flag is inconsistent");
  if (!complete && byteLength === 0) throw new Error("Artifact transfer made no progress");
  return { receipt, offset: expectedOffset, data: value.data, complete };
}

/** Infer a safe renderer class from the receipt name. HTML is deliberately text. */
export function artifactKind(receipt: Pick<ArtifactReceipt, "name">): ArtifactKind {
  const extension = receipt.name.toLowerCase().split(".").pop() ?? "";
  if (["txt", "md", "markdown", "json", "jsonl", "js", "jsx", "ts", "tsx", "css", "scss", "less", "html", "htm", "xml", "svg", "yaml", "yml", "toml", "ini", "conf", "env", "rs", "py", "rb", "go", "java", "kt", "swift", "c", "h", "cpp", "hpp", "sh", "bash", "zsh", "fish", "sql", "graphql", "csv", "log"].includes(extension)) return "text";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "heic", "heif"].includes(extension)) return "image";
  if (["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "opus", "caf"].includes(extension)) return "audio";
  if (["mp4", "mov", "m4v", "webm", "ogv", "avi", "mkv"].includes(extension)) return "video";
  return "binary";
}

export function artifactMimeType(receipt: Pick<ArtifactReceipt, "name">): string {
  const extension = receipt.name.toLowerCase().split(".").pop() ?? "";
  const mime: Record<string, string> = {
    txt: "text/plain", md: "text/markdown", markdown: "text/markdown", json: "application/json", jsonl: "application/jsonl", js: "text/javascript", jsx: "text/javascript", ts: "text/typescript", tsx: "text/typescript", css: "text/css", html: "text/plain", htm: "text/plain", xml: "application/xml", svg: "text/plain", yaml: "text/yaml", yml: "text/yaml", toml: "text/plain", csv: "text/csv", log: "text/plain",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif", heic: "image/heic", heif: "image/heif",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac", opus: "audio/opus", caf: "audio/x-caf",
    mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", ogv: "video/ogg", avi: "video/x-msvideo", mkv: "video/x-matroska",
  };
  return mime[extension] ?? "application/octet-stream";
}

export function artifactDisplaySize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "unknown size";
  if (size < 1_024) return `${size} B`;
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(size < 10_240 ? 1 : 0)} KB`;
  if (size < 1_024 * 1_024 * 1_024) return `${(size / (1_024 * 1_024)).toFixed(size < 10 * 1_024 * 1_024 ? 1 : 0)} MB`;
  return `${(size / (1_024 * 1_024 * 1_024)).toFixed(1)} GB`;
}

function hexDigest(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestArtifactBytes(bytes: Uint8Array): Promise<string> {
  // TS 5.9 models Uint8Array as ArrayBufferLike while Web Crypto/Expo's
  // BufferSource signatures require an owned ArrayBuffer. Copy once within
  // the explicit mobile transfer limit to keep that boundary honest.
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return hexDigest(await subtle.digest("SHA-256", owned.buffer));
  const expoCrypto = await import("expo-crypto");
  return hexDigest(await expoCrypto.digest(expoCrypto.CryptoDigestAlgorithm.SHA256, owned.buffer));
}

/** Fetch bounded immutable bytes, validating every offset and the final hash. */
export async function readArtifactBytes(reader: ArtifactReader, receipt: ArtifactReceipt, options: ArtifactTransferOptions = {}): Promise<Uint8Array> {
  const boundReceipt = parseArtifactReceipt(receipt, receipt.sessionId);
  const bound = options.maxBytes ?? CEDIA_MOBILE_ARTIFACT_MAX_BYTES;
  if (!Number.isSafeInteger(bound) || bound < 0 || bound > CEDIA_HOST_ARTIFACT_MAX_BYTES) throw new RangeError("Invalid mobile artifact limit");
  if (boundReceipt.size > bound) throw new RangeError(`Artifact exceeds the mobile preview limit (${artifactDisplaySize(bound)})`);
  const bytes = new Uint8Array(boundReceipt.size);
  let offset = 0;
  while (offset < boundReceipt.size) {
    if (options.signal?.aborted) throw new DOMException("Artifact transfer was cancelled", "AbortError");
    const chunk = await reader.readArtifact(boundReceipt.sessionId, boundReceipt.sha256, offset);
    const parsed = parseArtifactChunk(chunk, boundReceipt.sessionId, boundReceipt.sha256, offset);
    if (parsed.receipt.size !== boundReceipt.size) throw new Error("Artifact receipt changed during transfer");
    const chunkBytes = decodeBase64(parsed.data);
    bytes.set(chunkBytes, offset);
    offset += chunkBytes.byteLength;
    await options.onChunk?.(parsed, chunkBytes);
    if (parsed.complete !== (offset === boundReceipt.size)) throw new Error("Artifact transfer ended at an invalid offset");
  }
  if (offset !== boundReceipt.size) throw new Error("Artifact transfer is truncated");
  if (boundReceipt.size === 0) {
    const empty = await (options.digestSha256 ?? digestArtifactBytes)(bytes);
    if (empty.toLowerCase() !== boundReceipt.sha256) throw new Error("Artifact integrity verification failed");
  } else {
    const digest = await (options.digestSha256 ?? digestArtifactBytes)(bytes);
    if (digest.toLowerCase() !== boundReceipt.sha256) throw new Error("Artifact integrity verification failed");
  }
  return bytes;
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function artifactDataUri(receipt: Pick<ArtifactReceipt, "name">, bytes: Uint8Array): string {
  return `data:${artifactMimeType(receipt)};base64,${fromByteArray(bytes)}`;
}

function safeFilename(receipt: ArtifactReceipt): string {
  const base = receipt.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "artifact";
  return `${receipt.sha256.slice(0, 12)}-${base.slice(0, 180)}`;
}

/**
 * Explicit user-triggered export.  Native writes to the app cache in bounded
 * bytes and opens the system share sheet; web uses a one-shot download link.
 */
export async function downloadArtifact(receipt: ArtifactReceipt, bytes: Uint8Array, platform: "web" | "native"): Promise<ArtifactDownload> {
  if (bytes.byteLength !== receipt.size) throw new Error("Artifact download size does not match receipt");
  if (bytes.byteLength > CEDIA_MOBILE_ARTIFACT_MAX_BYTES) throw new RangeError("Artifact exceeds the mobile download limit");
  const name = safeFilename(receipt);
  const mimeType = artifactMimeType(receipt);
  if (platform === "web") {
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { uri: url, name, mimeType, shared: true };
  }
  const fileSystem = await import("expo-file-system");
  const directory = new fileSystem.Directory(fileSystem.Paths.cache, "cedia-artifacts");
  directory.create({ intermediates: true, idempotent: true });
  const file = new fileSystem.File(directory, name);
  file.create({ overwrite: true });
  file.write(bytes);
  const sharing = await import("expo-sharing");
  const shared = await sharing.isAvailableAsync();
  if (shared) await sharing.shareAsync(file.uri, { mimeType, dialogTitle: `Share ${receipt.name}` });
  return { uri: file.uri, name, mimeType, shared };
}

export type ArtifactJson = Record<string, Json>;
