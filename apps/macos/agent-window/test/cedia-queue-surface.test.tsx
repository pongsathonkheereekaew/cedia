import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaQueuePanel,
  type CediaQueueAnswer,
} from "../vendor/synara/apps/web/src/components/chat/CediaQueueSurface";
import {
  parseCediaQueueDropAnswer,
  parseCediaQueueAnswer,
  serverQueueQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const queue: CediaQueueAnswer = {
  state: "available",
  revision: 8,
  steering: [{ text: "steer this turn", truncated: true, images: 1 }],
  followUp: [{ text: "then follow up", truncated: false, images: 2 }],
};

describe("Cedia queue surface", () => {
  it("renders steering and follow-up text with truncation and image counts", () => {
    const html = renderToStaticMarkup(
      <CediaQueuePanel
        state={queue}
        busy={false}
        onDrop={() => undefined}
      />,
    );

    expect(html).toContain("steer this turn");
    expect(html).toContain("then follow up");
    expect(html).toContain("Text truncated");
    expect(html).toContain("1 image");
    expect(html).toContain("2 images");
    expect(html).toContain("Drop last");
    expect(html).toContain("Drop all");
  });

  it("distinguishes an empty queue from an unavailable queue", () => {
    const empty = renderToStaticMarkup(
      <CediaQueuePanel
        state={{ state: "available", revision: 9, steering: [], followUp: [] }}
        busy={false}
        onDrop={() => undefined}
      />,
    );
    expect(empty).toContain("Nothing queued");

    const unavailable = renderToStaticMarkup(
      <CediaQueuePanel
        state={{ state: "unavailable", reason: "OMP queue bridge is stopped" }}
        busy={false}
        onDrop={() => undefined}
      />,
    );
    expect(unavailable).toContain("OMP queue bridge is stopped");
    expect(unavailable).not.toContain("Nothing queued");
    expect(unavailable).not.toContain("Drop last");
    expect(unavailable).not.toContain("Drop all");
  });

  it("shows what a drop removed, including an explicit empty result", () => {
    const dropped = renderToStaticMarkup(
      <CediaQueuePanel
        state={{ state: "available", revision: 10, steering: [], followUp: [] }}
        dropped={[{ text: "removed prompt", truncated: false, images: 0 }]}
        busy={false}
        onDrop={() => undefined}
      />,
    );
    expect(dropped).toContain("Dropped");
    expect(dropped).toContain("removed prompt");

    const none = renderToStaticMarkup(
      <CediaQueuePanel
        state={{ state: "available", revision: 11, steering: [], followUp: [] }}
        dropped={[]}
        busy={false}
        onDrop={() => undefined}
      />,
    );
    expect(none).toContain("Nothing was queued");
  });

  it("shows mutation refusals and keeps queue parsing strict", () => {
    const html = renderToStaticMarkup(
      <CediaQueuePanel
        state={queue}
        dropError="Queue changed; try again (CEDIA_QUEUE_CONFLICT)"
        busy={false}
        onDrop={() => undefined}
      />,
    );
    expect(html).toContain("Queue changed; try again");
    expect(() => parseCediaQueueAnswer({
      state: "available",
      revision: 1,
      steering: [{ text: "bad", truncated: false, images: -1 }],
      followUp: [],
    })).toThrow();
    expect(() => parseCediaQueueDropAnswer({
      state: "available",
      revision: 1,
      steering: [],
      followUp: [],
    })).toThrow();
  });

  it("does not configure a polling interval", () => {
    expect(serverQueueQueryOptions("session-queue").refetchInterval).toBeUndefined();
  });
});
