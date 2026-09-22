// FILE: cediaStagedAttachments.ts
// Purpose: The composer image bytes a staged turn still has to hand the local runtime.
// Layer: Web composer utility.
// Depends on: nothing but the blobs it is handed.

/**
 * Cedia §10 item 61 (native runtime). Upstream stages an attachment by uploading its
 * bytes to the Synara attachment server, so the id it puts on the turn stays
 * resolvable for that turn's whole life. Cedia has no attachment server: the stage
 * step only names ids, and the agent-window adapter reads the bytes out of the
 * composer draft when it builds the OMP prompt. But the composer's send path clears
 * that draft — text, images and their persisted blobs — *before* the turn is
 * dispatched, so the bytes the stage step relied on were already gone when the
 * adapter asked for them. Measured 2026-09-23 in the packaged run: the pasted image
 * rendered its chip and enabled Send, yet every click ended in `Cedia could not read
 * the bytes for attached image '…'` and no `prompt` command ever reached the host.
 *
 * Staging therefore hands the files themselves to this registry, keyed by the thread
 * and image id it stages, and releases them when the dispatch settles — the same
 * lifetime an uploaded attachment has upstream.
 */
const stagedFilesByThread = new Map<string, Map<string, File>>();

/** Registers the images a turn was staged with. The release drops only what it registered. */
export function stageComposerImageFiles(
	threadId: string,
	images: readonly { readonly id: string; readonly file?: File | undefined }[],
): () => void {
	const staged = stagedFilesByThread.get(threadId) ?? new Map<string, File>();
	const registered: Array<{ id: string; file: File }> = [];
	for (const image of images) {
		if (!image.file) continue;
		staged.set(image.id, image.file);
		registered.push({ id: image.id, file: image.file });
	}
	if (registered.length === 0) return () => undefined;
	stagedFilesByThread.set(threadId, staged);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		for (const image of registered) {
			// A later turn may have re-staged the same id; drop only this turn's file.
			if (staged.get(image.id) === image.file) staged.delete(image.id);
		}
		if (staged.size === 0) stagedFilesByThread.delete(threadId);
	};
}

/** The bytes staged for `imageId` on `threadId`, or null once that turn has settled. */
export function stagedComposerImageFile(threadId: string, imageId: string): File | null {
	return stagedFilesByThread.get(threadId)?.get(imageId) ?? null;
}
