import { expect, test } from "bun:test";
import { MessageId } from "../vendor/synara/packages/contracts/src/index";
import { normalizeChatMessage } from "../vendor/synara/apps/web/src/storeNormalization";
import type { ChatMessage } from "../vendor/synara/apps/web/src/types";
import { deriveTimelineEntries, type WorkLogEntry } from "../vendor/synara/apps/web/src/workLog";

type OrderedChatMessage = ChatMessage & { transcriptOrder?: number };

function message(
  id: string,
  role: ChatMessage["role"],
  text: string,
  createdAt: string,
  transcriptOrder?: number,
): OrderedChatMessage {
  return {
    id: MessageId.makeUnsafe(id),
    role,
    text,
    createdAt,
    streaming: false,
    ...(transcriptOrder === undefined ? {} : { transcriptOrder }),
  };
}

test("OMP transcript order keeps queued user/reply pairs in visible turn order", () => {
  const messages = [
    message("user-a", "user", "Queue A", "2026-09-30T06:32:51.947Z", 1),
    message("assistant-a", "assistant", "A answer", "2026-09-30T06:32:56.045Z", 2),
    message("user-b", "user", "Queue B", "2026-09-30T06:32:56.965Z", 3),
    message("assistant-b", "assistant", "B answer", "2026-09-30T06:32:57.296Z", 4),
    // C's prompt was journaled after B's answer, but its receipt timestamp can
    // precede that answer when the queued turn is promoted.
    message("user-c", "user", "Queue C", "2026-09-30T06:32:57.102Z", 5),
    message("assistant-c", "assistant", "C answer", "2026-09-30T06:32:57.310Z", 6),
  ];

  const rows = deriveTimelineEntries(messages, [], []);

  expect(rows.map((row) => (row.kind === "message" ? row.message.text : row.kind))).toEqual([
    "Queue A",
    "A answer",
    "Queue B",
    "B answer",
    "Queue C",
    "C answer",
  ]);
});

test("OMP activity sequence stays inside its queued turn when timestamps invert", () => {
  const messages = [
    message("user-a", "user", "Queue A", "2026-09-30T06:32:51.947Z", 1),
    message("assistant-a", "assistant", "A answer", "2026-09-30T06:32:56.045Z", 2),
    message("user-b", "user", "Queue B", "2026-09-30T06:32:56.965Z", 3),
    message("assistant-b", "assistant", "B answer", "2026-09-30T06:32:57.296Z", 5),
    message("user-c", "user", "Queue C", "2026-09-30T06:32:57.102Z", 6),
    message("assistant-c", "assistant", "C answer", "2026-09-30T06:32:57.310Z", 7),
    message("user-d", "user", "Queue D", "2026-09-30T06:32:57.400Z"),
  ];
  const work: WorkLogEntry = {
    id: "tool-b",
    createdAt: "2026-09-30T06:32:57.250Z",
    sequence: 4,
    label: "B tool",
    tone: "tool",
  };

  expect(
    deriveTimelineEntries(messages, [], [work]).map((row) =>
      row.kind === "message" ? row.message.text : row.kind === "work" ? row.entry.label : row.kind,
    ),
  ).toEqual([
    "Queue A",
    "A answer",
    "Queue B",
    "B tool",
    "B answer",
    "Queue C",
    "C answer",
    "Queue D",
  ]);
});

test("message normalization preserves an authoritative transcript order", () => {
  const incoming = message(
    "normalization",
    "assistant",
    "answer",
    "2026-09-30T06:32:57.310Z",
    6,
  ) as Parameters<typeof normalizeChatMessage>[0];
  const normalized = normalizeChatMessage(incoming, undefined) as OrderedChatMessage;

  expect(normalized.transcriptOrder).toBe(6);

  const revised = normalizeChatMessage(
    { ...incoming, transcriptOrder: 7 },
    normalized,
  ) as OrderedChatMessage;
  expect(revised.transcriptOrder).toBe(7);
});

test("messages without transcript order retain chronological fallback ordering", () => {
  const messages = [
    message("older", "user", "Older", "2026-09-30T06:32:57.000Z"),
    message("newer", "assistant", "Newer", "2026-09-30T06:32:58.000Z"),
  ];

  expect(
    deriveTimelineEntries(messages, [], []).map((row) =>
      row.kind === "message" ? row.message.text : row.kind,
    ),
  ).toEqual(["Older", "Newer"]);
});
