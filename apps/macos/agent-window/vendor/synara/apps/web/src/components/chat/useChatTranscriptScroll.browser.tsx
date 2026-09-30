import type { LegendListRef } from "@legendapp/list/react";
import { ThreadId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useChatTranscriptScroll } from "./useChatTranscriptScroll";

const EMPTY_TIMELINE: [] = [];
const waitForFrames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

describe("transcript follow after switching threads", () => {
  it("follows an idle destination after leaving a detached transcript", async () => {
    // Ported from upstream #1308 (reset scroll ownership before following a
    // new thread). Sibling tests from #1285 (blocking-question cancellation)
    // are intentionally not ported: that feature is out of scope.
    // Detached nodes have no layout, so model an overflowing viewport directly.
    const node = document.createElement("div");
    Object.defineProperties(node, {
      scrollHeight: { value: 1_000 },
      clientHeight: { value: 200 },
      scrollTop: { value: 300, writable: true },
    });
    const scrollToEnd = vi.fn(async () => {
      node.scrollTop = 800;
    });
    const listRef = {
      current: {
        scrollToEnd,
        getScrollableNode: () => node,
      } as unknown as LegendListRef,
    };
    let controls: ReturnType<typeof useChatTranscriptScroll> | undefined;
    function Harness({ threadId }: { threadId: string }) {
      controls = useChatTranscriptScroll({
        activeThreadId: ThreadId.makeUnsafe(threadId),
        legendListRef: listRef,
        timelineEntries: EMPTY_TIMELINE,
        hasStreamingAssistantText: false,
        composerTranscriptInsetPx: 0,
        isInactiveSplitPane: false,
      });
      return null;
    }
    const screen = await render(<Harness threadId="first" />);
    try {
      await waitForFrames();
      controls!.onTranscriptNavigate();
      await screen.rerender(<Harness threadId="first" />);
      await waitForFrames();
      expect(controls!.isUserScrollDetached).toBe(true);

      for (const threadId of ["second", "first"]) {
        node.scrollTop = 300;
        scrollToEnd.mockClear();
        await screen.rerender(<Harness threadId={threadId} />);
        await waitForFrames();
        expect(controls!.isUserScrollDetached).toBe(false);
        expect(scrollToEnd).toHaveBeenCalledTimes(1);
        expect(node.scrollTop).toBe(800);
        // Detach again so the return trip starts from a detached reader too.
        controls!.onTranscriptNavigate();
        await screen.rerender(<Harness threadId={threadId} />);
      }
    } finally {
      await screen.unmount();
    }
  });
});
