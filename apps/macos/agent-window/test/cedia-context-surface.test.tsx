import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaContextPanel,
  type CediaContextAnswer,
} from "../vendor/synara/apps/web/src/components/chat/CediaContextSurface";
import {
  parseCediaContextAbortAnswer,
  parseCediaContextAnswer,
  parseCediaContextDropAnswer,
  parseCediaContextShakeAnswer,
  serverContextQueryOptions,
  type CediaHistoryAnswer,
  type CediaTranscriptAnswer,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const context: CediaContextAnswer = {
  state: "available",
  revision: 8,
  usage: {
    contextWindow: 128_000,
    anchored: true,
    usedTokens: 1_200,
    systemPromptTokens: 100,
    systemToolsTokens: 200,
    systemContextTokens: 300,
    skillsTokens: 400,
    messagesTokens: 200,
  },
  compacting: true,
  speculation: "armed",
};

describe("Cedia context surface", () => {
  it("renders usage, runtime maintenance, and active controls", () => {
    const html = renderToStaticMarkup(
      <CediaContextPanel state={context} busy={false} onCancelCompaction={() => undefined} onDropImages={() => undefined} />,
    );

    expect(html).toContain("1,200 / 128,000 tokens");
    expect(html).toContain("Anchored");
    expect(html).toContain("Prompt: 100");
    expect(html).toContain("Tools: 200");
    expect(html).toContain("Context: 300");
    expect(html).toContain("Skills: 400");
    expect(html).toContain("Messages: 200");
    expect(html).toContain("Compaction: active");
    expect(html).toContain("Speculation: armed");
    expect(html).toContain("Cancel compaction");
    expect(html).toContain("Drop images");
  });

  it("renders absent usage as unavailable without inventing zeroes", () => {
    const html = renderToStaticMarkup(
      <CediaContextPanel
        state={{ state: "available", revision: 9, compacting: false, speculation: "idle" }}
        onCancelCompaction={() => undefined}
        onDropImages={() => undefined}
      />,
    );

    expect(html).toContain("Context size not available");
    expect(html).not.toContain("0 / 0");
    expect(html).not.toContain("Prompt: 0");
    expect(html).not.toContain("Cancel compaction");
  });

  it("requires a confirmation affordance for dropping images and reports the answer", () => {
    const pending = renderToStaticMarkup(
      <CediaContextPanel state={context} dropConfirmationPending onDropImages={() => undefined} />,
    );
    expect(pending).toContain("Confirm drop");
    expect(pending).toContain("stored transcript");

    const answered = renderToStaticMarkup(
      <CediaContextPanel state={{ ...context, compacting: false }} removedImages={0} onDropImages={() => undefined} />,
    );
    expect(answered).toContain("No images to remove");
  });

  it("requires a strategy confirmation and reports the runtime shake result", () => {
    const pending = renderToStaticMarkup(
      <CediaContextPanel
        state={context}
        shakeConfirmationPending
        shakeConfirmationMode="elide"
        onReduceContext={() => undefined}
      />,
    );
    expect(pending).toContain("Confirm reduce");
    expect(pending).toContain("Elide tool results");
    expect(pending).toContain("rewrites the stored transcript");

    const answered = renderToStaticMarkup(
      <CediaContextPanel
        state={{
          ...context,
          shake: {
            mode: "elide",
            toolResultsDropped: 2,
            blocksDropped: 1,
            tokensFreed: 900,
            artifactId: "artifact-1",
          },
        }}
        onReduceContext={() => undefined}
      />,
    );
    expect(answered).toContain("Strategy: Elide tool results");
    expect(answered).toContain("Tool results dropped: 2");
    expect(answered).toContain("Blocks dropped: 1");
    expect(answered).toContain("Tokens reclaimed: 900");
    expect(answered).toContain("Artifact: artifact-1");

    const empty = renderToStaticMarkup(
      <CediaContextPanel
        state={{
          ...context,
          shake: { mode: "thinking", toolResultsDropped: 0, blocksDropped: 0, thinkingBlocksDropped: 0, tokensFreed: 0 },
        }}
        onReduceContext={() => undefined}
      />,
    );
    expect(empty).toContain("Nothing to reduce");
    expect(empty).toContain("Tokens reclaimed: 0");
  });

  it("renders only the host reason when unavailable", () => {
    const html = renderToStaticMarkup(
      <CediaContextPanel state={{ state: "unavailable", reason: "OMP context runtime is stopped" }} />,
    );
    expect(html).toContain("OMP context runtime is stopped");
    expect(html).not.toContain("Drop images");
    expect(html).not.toContain("Cancel compaction");
  });

  it("parses usage defensively and leaves absent usage absent", () => {
    expect(parseCediaContextAnswer({ state: "available", revision: 1, compacting: false, speculation: "idle" })).toEqual({
      state: "available",
      revision: 1,
      compacting: false,
      speculation: "idle",
    });
    expect(() => parseCediaContextAnswer({ state: "available", revision: 1, usage: { contextWindow: 0 }, compacting: false, speculation: "idle" })).toThrow();
    expect(parseCediaContextDropAnswer({ ...context, removed: 0 })).toMatchObject({ removed: 0 });
    expect(() => parseCediaContextDropAnswer(context)).toThrow();
    expect(parseCediaContextAbortAnswer(context)).toEqual(context);
    expect(() => parseCediaContextAbortAnswer({ ...context, removed: 1 })).toThrow();

    const shake = {
      ...context,
      shake: { mode: "images", toolResultsDropped: 0, blocksDropped: 0, imagesDropped: 3, tokensFreed: 120, artifactId: "artifact-2" },
    };
    expect(parseCediaContextShakeAnswer(shake)).toMatchObject({ shake: shake.shake });
    expect(() => parseCediaContextShakeAnswer({ ...context, shake: { ...shake.shake, mode: "everything" } })).toThrow();
    expect(() => parseCediaContextShakeAnswer(context)).toThrow();
  });

  it("does not configure a polling interval", () => {
    expect(serverContextQueryOptions("session-context").refetchInterval).toBeUndefined();
  });

  it("renders runtime checkpoint and rewind facts in the History section", () => {
    const history: CediaHistoryAnswer = {
      state: "available",
      checkpoint: {
        messageCount: 4,
        entryId: "entry-4",
        startedAt: "2026-09-24T00:00:00.000Z",
      },
      lastRewind: {
        report: "Restored the runtime checkpoint.",
        reportTruncated: true,
        startedAt: "2026-09-24T00:00:00.000Z",
        rewoundAt: "2026-09-24T00:01:00.000Z",
      },
    };
    const html = renderToStaticMarkup(<CediaContextPanel state={context} history={history} onReadHistory={() => undefined} />);

    expect(html).toContain("History");
    expect(html).toContain("4 messages");
    expect(html).toContain("2026-09-24T00:00:00.000Z");
    expect(html).toContain("2026-09-24T00:01:00.000Z");
    expect(html).toContain("Restored the runtime checkpoint.");
    expect(html).toContain("rewind report was truncated");
  });

  it("states plainly when the runtime has no checkpoint or rewind yet", () => {
    const history: CediaHistoryAnswer = { state: "available", checkpoint: null, lastRewind: null };
    const html = renderToStaticMarkup(<CediaContextPanel state={context} history={history} />);

    expect(html).toContain("No checkpoint or rewind has been recorded yet.");
    expect(html).not.toContain("0 messages");
  });

  it("shows the host reason when history is unavailable", () => {
    const html = renderToStaticMarkup(
      <CediaContextPanel state={context} history={{ state: "unavailable", reason: "History is unavailable while the task is running" }} />,
    );

    expect(html).toContain("History is unavailable while the task is running");
    expect(html).not.toContain("No checkpoint or rewind");
  });

  it("warns when the runtime transcript is truncated", () => {
    const transcript: CediaTranscriptAnswer = {
      state: "available",
      text: "partial transcript",
      truncated: true,
      bytes: 18,
    };
    const html = renderToStaticMarkup(
      <CediaContextPanel state={context} transcript={transcript} onCopyTranscript={() => undefined} />,
    );

    expect(html).toContain("partial transcript");
    expect(html).toContain("truncated");
    expect(html).toContain("Copy transcript");
  });

  it("requires explicit confirmation for both destructive history controls", () => {
    const clear = renderToStaticMarkup(
      <CediaContextPanel state={context} clearConfirmationPending onClearContext={() => undefined} />,
    );
    const fresh = renderToStaticMarkup(
      <CediaContextPanel state={context} freshConfirmationPending onFreshSession={() => undefined} />,
    );

    expect(clear).toContain("Confirm clear");
    expect(clear).toContain("clears the conversation context in place");
    expect(fresh).toContain("Confirm rotate");
    expect(fresh).toContain("fresh provider session");
  });
});
