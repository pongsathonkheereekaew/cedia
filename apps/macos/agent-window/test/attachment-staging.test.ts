import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { stageUploadComposerAttachments } from "../vendor/synara/apps/web/src/lib/composerSend";

// The native-runtime marker `readNativeApi()` checks: Cedia's bootstraps install
// window.nativeApi before the bundle loads, so staging must take the local-id path.
// Scoped to this suite: other test files run in the same process and branch on
// `typeof window`, so the stub exists only while these tests run.
let nativeWindow: { nativeApi?: unknown } | undefined;

beforeAll(() => {
	const globals = globalThis as { window?: { nativeApi?: unknown } };
	if (!globals.window) globals.window = {};
	nativeWindow = globals.window;
	nativeWindow.nativeApi = { cediaTestMarker: true };
});

afterAll(() => {
	const globals = globalThis as { window?: unknown };
	if (nativeWindow !== undefined && globals.window === nativeWindow) delete globals.window;
	nativeWindow = undefined;
});

describe("native staging never uploads (Cedia §10 item 61)", () => {
	it("stages the locally created ids without a server round-trip", async () => {
		const file = new File([new Uint8Array([104, 105])], "shot.png", { type: "image/png" });
		const staged = await stageUploadComposerAttachments({
			threadId: "thread-1",
			images: [
				{
					type: "image",
					id: "img-1",
					name: "shot.png",
					mimeType: "image/png",
					sizeBytes: 2,
					previewUrl: "blob:preview",
					file,
				},
			],
			assistantSelections: [],
		});

		// Metadata only: the attachment-server route is never fetched — the ids are
		// the composer's own, and the adapter reads bytes from the stores.
		expect(staged.attachments).toEqual([
			{ type: "image", id: "img-1", name: "shot.png", mimeType: "image/png", sizeBytes: 2 },
		]);
		const dispatched = await staged.runWithDispatch(async (attachments) => attachments);
		expect(dispatched).toHaveLength(1);
	});

	it("keeps assistant selections inline alongside staged ids", async () => {
		const staged = await stageUploadComposerAttachments({
			threadId: "thread-1",
			images: [],
			assistantSelections: [
				{
					type: "assistant-selection",
					assistantMessageId: "msg-1",
					text: "the selected answer",
				} as never,
			],
		});
		expect(staged.attachments).toEqual([
			expect.objectContaining({ type: "assistant-selection", text: "the selected answer" }),
		]);
	});
});
