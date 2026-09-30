import { describe, expect, it } from "bun:test";
import { ThreadId } from "@synara/contracts";
import {
	clearSelectedSlashCommandAfterSend,
	selectedSlashCommandForSend,
	selectedSlashQueueRefusal,
} from "../vendor/synara/apps/web/src/components/chat/chatSendTypes.ts";

const threadId = ThreadId.makeUnsafe("thread-selected-slash");

describe("selected slash command provenance", () => {
	it("keeps menu provenance across a rejected send and retry, then clears after success", () => {
		const selectedRef = { current: { threadId, name: "fixture" } };
		const rejectedName = selectedSlashCommandForSend(selectedRef.current, threadId, "/fixture arg");
		clearSelectedSlashCommandAfterSend(selectedRef, threadId, rejectedName, false);

		// The restored draft can be retried with the same menu-selected provenance.
		expect(selectedSlashCommandForSend(selectedRef.current, threadId, "/fixture arg")).toBe("fixture");
		clearSelectedSlashCommandAfterSend(selectedRef, threadId, rejectedName, true);
		expect(selectedRef.current).toBeNull();
	});

	it("does not mark a manually typed slash prompt or another thread's draft", () => {
		expect(selectedSlashCommandForSend(null, threadId, "/fixture arg")).toBeUndefined();
		expect(selectedSlashCommandForSend(
			{ threadId: ThreadId.makeUnsafe("other-thread"), name: "fixture" },
			threadId,
			"/fixture arg",
		)).toBeUndefined();
		expect(selectedSlashCommandForSend({ threadId, name: "fixture" }, threadId, "xfixture arg")).toBeUndefined();
	});

	it("fails closed before queueing a menu-selected slash draft and preserves its selection", () => {
		const selected = { threadId, name: "fixture" };
		expect(selectedSlashQueueRefusal({
			selected,
			threadId,
			text: "/fixture arg",
			hasQueueableLiveTurn: true,
			dispatchMode: "queue",
		})).toMatch(/cannot be queued/i);
		// The guard is evaluated before clearComposerInput/enqueueQueuedComposerTurn.
		expect(selectedSlashCommandForSend(selected, threadId, "/fixture arg")).toBe("fixture");
		expect(selectedSlashQueueRefusal({
			selected,
			threadId,
			text: "/fixture arg",
			hasQueueableLiveTurn: true,
			dispatchMode: "steer",
		})).toMatch(/cannot be steered/i);
		expect(selectedSlashQueueRefusal({
			selected: null,
			threadId,
			text: "/fixture arg",
			hasQueueableLiveTurn: true,
			dispatchMode: "queue",
		})).toBeUndefined();
		expect(selectedSlashQueueRefusal({
			selected: { threadId: ThreadId.makeUnsafe("other-thread"), name: "fixture" },
			threadId,
			text: "/fixture arg",
			hasQueueableLiveTurn: true,
			dispatchMode: "queue",
		})).toBeUndefined();
		expect(selectedSlashQueueRefusal({
			selected,
			threadId,
			text: "/fixture arg",
			hasQueueableLiveTurn: false,
			dispatchMode: "queue",
		})).toBeUndefined();
	});
});
