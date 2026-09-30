/**
 * Cedia's own URI scheme, handed to the runtime (plan §8.2 O05 and §10 item 37).
 *
 * A host URI scheme is only honest when a reader exists behind it - the plan's own rule is that a
 * scheme with no reader would be a fake capability. The reader here is the host's artifact store:
 * `capture` copies bytes into a private directory keyed by their SHA-256 and verifies the hash on
 * every read, so `cedia://artifact/<sha256>` reaches content a workspace path cannot promise - the
 * exact bytes that were captured, even after the original file changed or disappeared, with the
 * integrity check the store already performs. That is why this scheme is read-only and immutable:
 * there is nothing to write back into a content-addressed receipt.
 */
import type { OmpHostUriReadResult } from "../../../packages/omp-adapter/src/host.ts";
import type { ArtifactStore } from "./artifacts.ts";

/** The scheme Cedia registers with the runtime. */
export const CEDIA_HOST_URI_SCHEME = "cedia";

/** The path part that names an artifact, so `cedia://artifact/<sha256>`. */
export const CEDIA_ARTIFACT_URI_HOST = "artifact";

/** Bound on one read. The artifact store's own chunk ceiling is 96 KiB; this stays inside it. */
export const CEDIA_ARTIFACT_URI_MAX_BYTES = 96 * 1024;

/**
 * Resolve a `cedia://artifact/<sha256>` URL to its artifact identity, or `undefined` for anything
 * else. A URL with another host, a missing or extra segment, an embedded query/fragment or an id
 * that is not a 64-character lowercase hex digest is refused rather than guessed at.
 */
export function parseCediaArtifactUri(raw: string): { readonly sha256: string } | undefined {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return undefined;
	}
	if (url.protocol !== `${CEDIA_HOST_URI_SCHEME}:`) return undefined;
	if (url.hostname !== CEDIA_ARTIFACT_URI_HOST) return undefined;
	if (url.search !== "" || url.hash !== "") return undefined;
	const segments = url.pathname.split("/").filter(part => part.length > 0);
	if (segments.length !== 1) return undefined;
	const sha256 = segments[0]!;
	if (!/^[a-f0-9]{64}$/.test(sha256)) return undefined;
	return { sha256 };
}

/** True when a byte sequence can be handed to a text reader without mangling it. */
function asText(bytes: Buffer): string | undefined {
	const text = bytes.toString("utf8");
	// A NUL byte is the cheapest honest signal that this is not text; a decoder that replaced
	// undecodable sequences would hand the agent a quietly corrupted document.
	if (text.includes("\u0000")) return undefined;
	return text;
}

/**
 * Read one artifact through the scheme, scoped to the task that is asking.
 *
 * The task id comes from the runtime's own session, never from the URL, so one task cannot read
 * another task's receipts; the store re-checks the id shape and the digest, and verifies the bytes
 * against their hash before they are returned.
 */
export function readCediaArtifactUri(store: ArtifactStore, sessionId: string, raw: string): OmpHostUriReadResult {
	const target = parseCediaArtifactUri(raw);
	if (target === undefined) {
		throw new Error(`Cedia serves cedia://artifact/<sha256> only, and ${raw} is not one of those`);
	}
	const chunk = store.read(sessionId, target.sha256, 0, CEDIA_ARTIFACT_URI_MAX_BYTES);
	const bytes = Buffer.from(chunk.data, "base64");
	const text = asText(bytes);
	if (text === undefined) {
		throw new Error("That artifact is not text; read it as bytes instead of through the text reader");
	}
	return {
		content: text,
		contentType: "text/plain",
		immutable: true,
		notes: [
			`captured from ${chunk.receipt.sourcePath} at ${chunk.receipt.createdAt}`,
			`${chunk.receipt.size} bytes, sha256 ${chunk.receipt.sha256}`,
			chunk.complete ? "complete" : `truncated to the first ${CEDIA_ARTIFACT_URI_MAX_BYTES} bytes`,
		],
	};
}
