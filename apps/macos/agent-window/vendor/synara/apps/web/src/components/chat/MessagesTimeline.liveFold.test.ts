// Cedia slice test for upstream #1274 (fold the live tool run into one
// accordion line; fold multi-file edits by rendered rows, not calls).
// Mirrors the release assertions for the ported logic; the upstream unit test
// files are not vendored, so the ported behavior is pinned here instead.
// Upstream: https://github.com/Emanuele-web04/synara/pull/1274
import { MessageId } from "@synara/contracts";
import { describe, expect, it } from "vitest";
import {
  capOpenWorkEntryRenderChunks,
  planWorkEntryRenderChunks,
  resolveWorkEntryChunkFold,
  type CollapsedTurnItem,
} from "./MessagesTimeline.logic";
import type { WorkLogEntry } from "../../session-logic";

const toolItem = (
  id: string,
  overrides: Partial<WorkLogEntry> = {},
): Extract<CollapsedTurnItem, { kind: "work" }> => ({
  kind: "work",
  id,
  entry: {
    id,
    createdAt: "2026-01-01T00:00:00Z",
    label: `tool ${id}`,
    tone: "tool",
    ...overrides,
  },
});

const narrationItem = (id: string): CollapsedTurnItem => ({
  kind: "narration",
  id,
  message: {
    id: MessageId.makeUnsafe(id),
    role: "assistant",
    text: "narration",
    createdAt: "2026-01-01T00:00:00Z",
    streaming: false,
  },
});

const planSignature = (
  entries: ReadonlyArray<WorkLogEntry>,
  options: { tailIsLive: boolean },
): string[] =>
  planWorkEntryRenderChunks(entries, options).map((chunk) => {
    const ids = chunk.entries.map((entry) => entry.id).join("+");
    if (chunk.liveEntry) return `live(${chunk.liveEntry.id}):${ids}`;
    return chunk.summary === null ? `open:${ids}` : `collapsed:${ids}`;
  });

describe("planWorkEntryRenderChunks", () => {
  it("never collapses a run that still has running work", () => {
    expect(
      planSignature(
        [
          toolItem("w1", { toolStatus: "running" }).entry,
          toolItem("w2").entry,
          toolItem("think", { tone: "thinking" }).entry,
          toolItem("w3").entry,
          toolItem("w4").entry,
        ],
        { tailIsLive: false },
      ),
    ).toEqual(["live(w2):w1+w2", "open:think", "collapsed:w3+w4"]);
  });

  it("keeps singleton runs open: nothing to summarize", () => {
    expect(
      planSignature(
        [toolItem("w1").entry, toolItem("think", { tone: "thinking" }).entry, toolItem("w2").entry],
        { tailIsLive: false },
      ),
    ).toEqual(["open:w1", "open:think", "open:w2"]);
  });
})
describe("capOpenWorkEntryRenderChunks", () => {
  const singletonRuns = [
    toolItem("w1").entry,
    toolItem("w2").entry,
    toolItem("think1", { tone: "thinking" }).entry,
    toolItem("w3").entry,
    toolItem("think2", { tone: "thinking" }).entry,
    toolItem("w4").entry,
    toolItem("think3", { tone: "thinking" }).entry,
    toolItem("w5").entry,
  ];

  it("preserves collapsed summaries and uncapped boundaries while limiting open entries", () => {
    const result = capOpenWorkEntryRenderChunks(
      planWorkEntryRenderChunks(singletonRuns, { tailIsLive: false }),
      {
        expanded: false,
        maxVisibleEntries: 2,
        keep: "last",
        shouldCapEntry: (entry) => entry.tone === "tool",
      },
    );

    expect(result.chunks.map((chunk) => chunk.entries.map((entry) => entry.id))).toEqual([
      ["w1", "w2"],
      ["think1"],
      [],
      ["think2"],
      ["w4"],
      ["think3"],
      ["w5"],
    ]);
    expect(result.hasOverflow).toBe(true);
    expect(result.hiddenEntryCount).toBe(1);
  });

  it("never caps a live run: it already renders as one line", () => {
    const chunks = planWorkEntryRenderChunks(
      [toolItem("w1").entry, toolItem("w2").entry, toolItem("w3").entry],
      { tailIsLive: true },
    );

    const result = capOpenWorkEntryRenderChunks(chunks, {
      expanded: false,
      maxVisibleEntries: 2,
      keep: "last",
    });

    expect(result.chunks).toEqual(chunks);
    expect(result.hasOverflow).toBe(false);
  });

  it("restores every open entry when expanded while retaining overflow state", () => {
    const result = capOpenWorkEntryRenderChunks(
      planWorkEntryRenderChunks(singletonRuns, { tailIsLive: false }),
      { expanded: true, maxVisibleEntries: 2, keep: "last" },
    );

    expect(result.chunks.flatMap((chunk) => chunk.entries.map((entry) => entry.id))).toEqual(
      singletonRuns.map((entry) => entry.id),
    );
    expect(result.hasOverflow).toBe(true);
    expect(result.hiddenEntryCount).toBe(0);
  });
})
describe("multi-file edit folding", () => {
  const patch = toolItem("patch", {
    itemType: "file_change",
    changedFiles: ["a.swift", "b.swift", "c.swift"],
  }).entry;

  it("folds a lone patch that would list a column of edited-file rows", () => {
    const [settled] = planWorkEntryRenderChunks([patch], { tailIsLive: false });

    expect(settled?.summary?.label).toBe("Edited 3 files");
    expect(resolveWorkEntryChunkFold(settled!)?.entries).toEqual([patch]);
  });

  it("keeps the patch's file rows behind its live line", () => {
    const [live] = planWorkEntryRenderChunks([patch], { tailIsLive: true });

    expect(live?.liveEntry).toBe(patch);
    expect(resolveWorkEntryChunkFold(live!)?.entries).toEqual([patch]);
  });

  it("leaves a single-file edit as a plain row", () => {
    const edit = toolItem("edit", { itemType: "file_change", changedFiles: ["a.swift"] }).entry;
    const [chunk] = planWorkEntryRenderChunks([edit], { tailIsLive: false });

    expect(resolveWorkEntryChunkFold(chunk!)).toBeNull();
  });
})
describe("resolveWorkEntryChunkFold", () => {
  it("reveals only the calls before the one a live line wears", () => {
    const [chunk] = planWorkEntryRenderChunks(
      [toolItem("w1").entry, toolItem("w2").entry, toolItem("w3").entry],
      { tailIsLive: true },
    );
    const fold = resolveWorkEntryChunkFold(chunk!);

    expect(fold?.entries.map((entry) => entry.id)).toEqual(["w1", "w2"]);
    expect(fold?.keySuffix).toBe(":live");
  });

  it("reveals every call of a settled summary and leaves singletons unfolded", () => {
    const [settled] = planWorkEntryRenderChunks([toolItem("w1").entry, toolItem("w2").entry], {
      tailIsLive: false,
    });
    const [singleton] = planWorkEntryRenderChunks([toolItem("w1").entry], { tailIsLive: true });

    expect(resolveWorkEntryChunkFold(settled!)?.entries.map((entry) => entry.id)).toEqual([
      "w1",
      "w2",
    ]);
    expect(resolveWorkEntryChunkFold(settled!)?.keySuffix).toBe("");
    expect(resolveWorkEntryChunkFold(singleton!)).toBeNull();
  });
})
