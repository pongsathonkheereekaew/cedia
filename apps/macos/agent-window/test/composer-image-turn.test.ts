import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ThreadId } from "@synara/contracts";
import { useComposerDraftStore } from "../vendor/synara/apps/web/src/composerDraftStore";
import {
  prepareComposerImageAttachmentsFromFiles,
  stageUploadComposerAttachments,
} from "../vendor/synara/apps/web/src/lib/composerSend";
import { IMAGE_ONLY_BOOTSTRAP_PROMPT } from "../vendor/synara/apps/web/src/lib/terminalContext";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";

// The native-runtime marker `readNativeApi()` checks: Cedia's bootstraps install
// window.nativeApi before the bundle loads, so staging takes the local-id path.
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

/** The 1×1 PNG the packaged receipt pastes; the turn must carry these exact bytes. */
const PASTED_PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
	0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
	0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const SESSION = {
	id: "session-image",
	projectId: "project-1",
	title: "Image turn",
	cwd: "/workspace/demo",
	sessionFile: "/state/session-image.json",
	incarnation: "inc-1",
	status: "idle" as const,
	archived: false,
	createdAt: "2026-09-23T10:00:00.000Z",
	updatedAt: "2026-09-23T10:01:00.000Z",
};

interface RecordedRequest {
	method: string;
	path: string;
	body?: unknown;
}

/** A host that answers the two routes a turn needs, and records every command it is sent. */
function fakeBridge() {
	const calls: RecordedRequest[] = [];
	const host = {
		id: SESSION.id,
		projectId: SESSION.projectId,
		title: SESSION.title,
		cwd: SESSION.cwd,
		sessionFile: SESSION.sessionFile,
		incarnation: SESSION.incarnation,
		status: "running",
		archived: false,
		createdAt: SESSION.createdAt,
		updatedAt: SESSION.updatedAt,
	};
	const bridge = {
		invoke: async (_channel: string, request: RecordedRequest) => {
			// The adapter also asks the bridge for the shared draft before a send; that row has
			// no path, so it stays out of this list.
			const requestKind = (request as RecordedRequest & { kind?: string }).kind;
			if (requestKind !== "uiDraft") calls.push(request);
			if (request.path === `/v1/sessions/${SESSION.id}`) return host;
			if (request.path === `/v1/models`) return { source: "omp", models: [] };
			if (request.path.endsWith("/commands") && request.method === "POST") {
				const body = request.body as { commandId: string; command: string; payload?: unknown };
				return {
					sessionId: SESSION.id,
					commandId: body.commandId,
					incarnation: host.incarnation,
					kind: body.command,
					payload: body.payload ?? null,
					status: "acknowledged",
				};
			}
			throw new Error(`Unexpected ${request.method} ${request.path}`);
		},
	};
	return { bridge, calls, host };
}

function promptCommands(calls: readonly RecordedRequest[]) {
	return calls.filter(
		(call) => call.path.endsWith("/commands") && (call.body as { command?: string })?.command === "prompt",
	);
}

/**
 * The composer's own send path for a pasted image, in the order ChatView drives it:
 * the paste intake creates the draft image (§10 item 61's chip), `stageUpload` stages
 * its id for the turn, the send clears the composer draft, and the turn is dispatched
 * with the staged attachments.
 */
async function sendPastedImage(input: { text: string }) {
	const threadId = ThreadId.makeUnsafe(SESSION.id);
	const paste = await prepareComposerImageAttachmentsFromFiles({
		files: [new File([PASTED_PNG_BYTES], "cedia-panel-fixture.png", { type: "image/png" })],
		existingAttachmentCount: 0,
	});
	expect(paste.error).toBeNull();
	expect(paste.images).toHaveLength(1);
	useComposerDraftStore.getState().addImages(threadId, paste.images);

	const staged = await stageUploadComposerAttachments({
		threadId: SESSION.id,
		images: useComposerDraftStore.getState().draftsByThreadId[threadId]?.images ?? [],
		assistantSelections: [],
	});
	useComposerDraftStore.getState().clearComposerContent(SESSION.id, { preservePreviewUrls: true });

	const { bridge, calls } = fakeBridge();
	const api = createCediaNativeApi({ bridge });
	await staged.runWithDispatch((attachments) =>
		api.orchestration.dispatchCommand({
			type: "thread.turn.start",
			commandId: "cmd-image-turn",
			threadId: SESSION.id,
			message: {
				messageId: "msg-image-1",
				role: "user",
				// The send path's own seed rule: a turn with no typed text still carries
				// OMP's image-only bootstrap prompt.
				text: input.text.length > 0 ? input.text : IMAGE_ONLY_BOOTSTRAP_PROMPT,
				attachments,
			},
		}),
	);
	return { calls, image: paste.images[0]! };
}

describe("a pasted composer image reaches the OMP turn (Cedia §10 item 61)", () => {
	it("carries the pasted bytes in images[] after the send clears the composer draft", async () => {
		const { calls } = await sendPastedImage({ text: "Panel fixture image prompt" });
		const prompts = promptCommands(calls);

		expect(prompts).toHaveLength(1);
		const payload = (prompts[0]!.body as { payload: { message: string; images?: Array<{ type: string; data: string; mimeType: string }> } }).payload;
		expect(payload.images).toHaveLength(1);
		const image = payload.images![0]!;
		expect(image.type).toBe("image");
		expect(image.mimeType).toBe("image/png");
		// OMP's images[] is base64; the pasted 1×1 PNG must arrive byte for byte.
		expect(new Uint8Array(Buffer.from(image.data, "base64"))).toEqual(PASTED_PNG_BYTES);
		expect(payload.message).toBe("Panel fixture image prompt");
	});

	it("still sends an image-only turn the bootstrap message OMP can read", async () => {
		const { calls } = await sendPastedImage({ text: "" });
		const prompts = promptCommands(calls);

		expect(prompts).toHaveLength(1);
		const payload = (prompts[0]!.body as { payload: { message: string; images?: unknown[] } }).payload;
		expect(payload.images).toHaveLength(1);
		expect(payload.message).toBe(IMAGE_ONLY_BOOTSTRAP_PROMPT);
	});

	it("releases the staged bytes once the turn settles", async () => {
		const { image } = await sendPastedImage({ text: "Panel fixture image prompt" });
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		await expect(
			api.orchestration.dispatchCommand({
				type: "thread.turn.start",
				commandId: "cmd-image-reuse",
				threadId: SESSION.id,
				message: {
					text: "again",
					attachments: [{ type: "image", id: image.id, name: image.name, mimeType: image.mimeType, sizeBytes: image.sizeBytes }],
				},
			}),
		).rejects.toThrow("could not read the bytes");
		expect(promptCommands(calls)).toHaveLength(0);
	});
});
