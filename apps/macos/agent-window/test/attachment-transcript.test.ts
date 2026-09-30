import { describe, expect, it } from "bun:test";
import { Schema } from "../vendor/synara/packages/contracts/node_modules/effect/dist/index.js";
import {
  isSafeReadModelImagePreview,
  type OrchestrationThreadDetailSnapshot,
  OrchestrationMessage,
  type OrchestrationMessage as ReadModelMessage,
} from "@synara/contracts";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import {
  mergeReadModelThreadDetailWithLiveHotPath,
  normalizeChatMessage,
  normalizeThreadFromReadModel,
} from "../vendor/synara/apps/web/src/storeNormalization";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
  0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString("base64");
const LARGE_BASE64 = Buffer.alloc(256 * 1024).toString("base64");

const PROJECT = {
  id: "project-image",
  path: "/workspace/image",
  name: "Image transcript",
  pinned: false,
  archived: false,
  createdAt: "2026-09-30T00:00:00.000Z",
};

const SESSION = {
  id: "session-image",
  projectId: PROJECT.id,
  title: "Image transcript",
  cwd: PROJECT.path,
  sessionFile: "/state/session-image.json",
  incarnation: "inc-image",
  status: "idle" as const,
  archived: false,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:01:00.000Z",
};

type OmpImage = { type: "image"; data: string; mimeType: string };
type OmpText = { type: "text"; text: string };
type OmpContent = readonly (OmpText | OmpImage)[];
type TranscriptOptions = {
  userMessageId?: string;
  endContent?: OmpContent;
};

function imageContent(data: string, mimeType: string): OmpImage {
  return { type: "image", data, mimeType };
}

function transcriptEvents(content: OmpContent, options: TranscriptOptions = {}) {
  const userMessageId = options.userMessageId ?? "user:message/1";
  const endContent = options.endContent ?? content;
  // OMP repeats the authoritative message content on start/end. The adapter must project one
  // attachment from the latest message content, not one attachment per lifecycle frame.
  return [
    {
      sessionId: SESSION.id,
      incarnation: SESSION.incarnation,
      sequence: 1,
      timestamp: "2026-09-30T00:02:00.000Z",
      frame: {
        type: "message_start",
        message: { id: userMessageId, role: "user", content },
      },
    },
    {
      sessionId: SESSION.id,
      incarnation: SESSION.incarnation,
      sequence: 2,
      timestamp: "2026-09-30T00:02:01.000Z",
      frame: {
        type: "message_end",
        message: { id: userMessageId, role: "user", content: endContent },
      },
    },
    {
      sessionId: SESSION.id,
      incarnation: SESSION.incarnation,
      sequence: 3,
      timestamp: "2026-09-30T00:02:02.000Z",
      frame: {
        type: "message_start",
        message: {
          id: "assistant:message/1",
          role: "assistant",
          content: [imageContent(PNG_BASE64, "image/png")],
        },
      },
    },
    {
      sessionId: SESSION.id,
      incarnation: SESSION.incarnation,
      sequence: 4,
      timestamp: "2026-09-30T00:02:03.000Z",
      frame: {
        type: "tool_execution_end",
        toolCallId: "tool-image-1",
        result: { content: [imageContent(PNG_BASE64, "image/png")] },
      },
    },
  ];
}

function fakeBridge(content: OmpContent, options: TranscriptOptions = {}) {
  const events = transcriptEvents(content, options);
  const bridge = {
    invoke: async (_channel: string, request: { path?: string; method?: string }) => {
      if (request.path === `/v1/sessions/${SESSION.id}`) return SESSION;
      if (request.path === "/v1/projects") return [PROJECT];
      if (request.path?.startsWith(`/v1/sessions/${SESSION.id}/events`)) {
        return { events, cursor: events.at(-1)?.sequence ?? 0, hasMore: false };
      }
      if (request.path === `/v1/sessions/${SESSION.id}/goal`) {
        return { state: "available", revision: 1, enabled: false, goal: null };
      }
      if (request.path === `/v1/sessions/${SESSION.id}/subagents`) {
        return { state: "available", revision: 1, subagents: [] };
      }
      throw new Error(`Unexpected ${request.method ?? "?"} ${request.path ?? "?"}`);
    },
  };
  return { bridge, events };
}

async function readThread(content: OmpContent, options: TranscriptOptions = {}) {
  const { bridge } = fakeBridge(content, options);
  const api = createCediaNativeApi({ bridge });
  return await api.orchestration.getThreadDetailSnapshot({ threadId: SESSION.id }) as OrchestrationThreadDetailSnapshot;
}

function userMessage(snapshot: OrchestrationThreadDetailSnapshot): ReadModelMessage {
  const message = snapshot.thread.messages.find((candidate) => candidate.role === "user");
  if (!message) throw new Error("fixture did not produce a user message");
  return message;
}

describe("OMP image transcript projection", () => {
  it("projects one user image from raw message content and keeps a safe preview after reload", async () => {
    const content = [
      { type: "text" as const, text: "Please inspect this screenshot" },
      imageContent(PNG_BASE64, "image/png"),
    ];
    const firstSnapshot = await readThread(content);
    const firstMessage = userMessage(firstSnapshot);

    expect(firstMessage.attachments).toHaveLength(1);
    const firstAttachment = firstMessage.attachments[0];
    expect(firstAttachment).toMatchObject({
      type: "image",
      name: "Image 1.png",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
      previewUrl: `data:image/png;base64,${PNG_BASE64}`,
    });
    expect(firstAttachment.id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(firstSnapshot.thread.messages.find((message) => message.role === "assistant")?.attachments).toBeUndefined();
    const decodedMessage = Schema.decodeUnknownSync(OrchestrationMessage)(firstMessage);
    expect(decodedMessage.attachments?.[0]?.previewUrl).toBe(firstAttachment.previewUrl);

    const firstThread = normalizeThreadFromReadModel(firstSnapshot.thread, undefined, firstSnapshot.snapshotSequence);
    const secondSnapshot = await readThread(content);
    const secondThread = normalizeThreadFromReadModel(
      secondSnapshot.thread,
      firstThread,
      secondSnapshot.snapshotSequence,
    );
    const secondAttachment = secondThread.messages.find((message) => message.role === "user")?.attachments?.[0];

    expect(secondAttachment?.id).toBe(firstAttachment.id);
    expect(secondAttachment?.previewUrl).toBe(firstAttachment.previewUrl);
    expect(normalizeThreadFromReadModel(secondSnapshot.thread, secondThread, secondSnapshot.snapshotSequence)).toBe(secondThread);
  });

  it("reuses validated bytes for an unchanged cached transcript entry", async () => {
    let dataReads = 0;
    const image: OmpImage = {
      type: "image",
      get data() {
        dataReads += 1;
        return LARGE_BASE64;
      },
      mimeType: "image/png",
    };
    const fixture = fakeBridge([{ type: "text", text: "cached" }, image]);
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await api.orchestration.getThreadDetailSnapshot({ threadId: SESSION.id });
    const firstReadCount = dataReads;
    expect(firstReadCount).toBeGreaterThan(0);
    await api.orchestration.getThreadDetailSnapshot({ threadId: SESSION.id });

    expect(dataReads).toBe(firstReadCount);
  });

  it("takes the latest authoritative user content when a message lifecycle replaces its image", async () => {
    const replacementBase64 = Buffer.from([0, 1, 2, 3]).toString("base64");
    const snapshot = await readThread(
      [{ type: "text", text: "replace" }, imageContent(PNG_BASE64, "image/png")],
      {
        endContent: [{ type: "text", text: "replace" }, imageContent(replacementBase64, "image/png")],
      },
    );
    const attachment = userMessage(snapshot).attachments?.[0];

    expect(attachment.previewUrl).toBe(`data:image/png;base64,${replacementBase64}`);
    expect(attachment.sizeBytes).toBe(4);
  });

  it("keeps punctuation-distinct message ids distinct after safe id encoding", async () => {
    const content = [{ type: "text" as const, text: "ids" }, imageContent(PNG_BASE64, "image/png")];
    const slash = userMessage(await readThread(content, { userMessageId: "user:a/b" })).attachments?.[0]?.id;
    const colon = userMessage(await readThread(content, { userMessageId: "user:a:b" })).attachments?.[0]?.id;

    expect(slash).not.toBe(colon);
  });

  it("drops malformed, unsupported, and over-limit image payloads", async () => {
    const overLimit = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
    for (const image of [
      imageContent("not base64", "image/png"),
      imageContent(PNG_BASE64, "image/svg+xml"),
      imageContent(overLimit, "image/png"),
    ]) {
      const snapshot = await readThread([{ type: "text", text: "bad image" }, image]);
      expect(userMessage(snapshot).attachments ?? []).toEqual([]);
    }
  });

  it("keeps the legacy attachment route when a read-model image has no inline preview", () => {
    const message = {
      id: "legacy-message",
      role: "user" as const,
      text: "legacy",
      turnId: null,
      streaming: false,
      source: "native" as const,
      createdAt: "2026-09-30T00:00:00.000Z",
      updatedAt: "2026-09-30T00:00:00.000Z",
      attachments: [{
        type: "image" as const,
        id: "legacy-image",
        name: "legacy.png",
        mimeType: "image/png",
        sizeBytes: PNG_BYTES.byteLength,
      }],
    };
    const normalized = normalizeChatMessage(message as ReadModelMessage, undefined);
    expect(normalized.attachments?.[0]?.previewUrl).toBe("/attachments/legacy-image");
  });

  it("retains a validated inline preview through a stale and live-hot-path snapshot", async () => {
    const snapshot = await readThread([
      { type: "text", text: "live image" },
      imageContent(PNG_BASE64, "image/png"),
    ]);
    const firstThread = normalizeThreadFromReadModel(snapshot.thread, undefined, snapshot.snapshotSequence);
    const staleThread = {
      ...snapshot.thread,
      messages: snapshot.thread.messages.map((message) =>
        message.role === "user"
          ? {
              ...message,
              attachments: message.attachments?.map((attachment) =>
                attachment.type === "image"
                  ? (({ previewUrl: _previewUrl, ...withoutPreview }) => withoutPreview)(attachment)
                  : attachment,
              ),
            }
          : message,
      ),
    };
    const staleNormalized = normalizeThreadFromReadModel(staleThread, firstThread, snapshot.snapshotSequence + 1);
    const stalePreview = staleNormalized.messages.find((message) => message.role === "user")?.attachments?.[0]?.previewUrl;
    expect(stalePreview).toBe(`data:image/png;base64,${PNG_BASE64}`);

    const unsafeMessage = {
      ...userMessage(snapshot),
      attachments: userMessage(snapshot).attachments?.map((attachment) =>
        attachment.type === "image"
          ? { ...attachment, previewUrl: "javascript:alert(1)" }
          : attachment,
      ),
    } as unknown as ReadModelMessage;
    const unsafeNormalized = normalizeChatMessage(
      unsafeMessage,
      firstThread.messages.find((message) => message.role === "user"),
    );
    const unsafeId = firstThread.messages.find((message) => message.role === "user")?.attachments?.[0]?.id;
    expect(unsafeNormalized.attachments?.[0]?.previewUrl).toBe(`/attachments/${unsafeId}`);

    const livePrevious = {
      ...firstThread,
      messages: firstThread.messages.map((message) =>
        message.role === "user" ? { ...message, text: `${message.text} still streaming`, streaming: true } : message,
      ),
    };
    const mergedReadModel = mergeReadModelThreadDetailWithLiveHotPath(staleThread, livePrevious);
    const merged = normalizeThreadFromReadModel(mergedReadModel, livePrevious, snapshot.snapshotSequence + 2);
    expect(merged.messages.find((message) => message.role === "user")?.attachments?.[0]?.previewUrl).toBe(stalePreview);
  });

  it("rejects remote, SVG, and malformed inline previews at the read-model boundary", () => {
    const base = {
      id: "message-preview",
      role: "user" as const,
      text: "preview",
      turnId: null,
      streaming: false,
      source: "native" as const,
      createdAt: "2026-09-30T00:00:00.000Z",
      updatedAt: "2026-09-30T00:00:00.000Z",
    };
    const invalidPreviews = [
      "https://example.test/image.png",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png;base64,not-base64",
    ];
    for (const previewUrl of invalidPreviews) {
      expect(isSafeReadModelImagePreview(previewUrl)).toBe(false);
      expect(() => Schema.decodeUnknownSync(OrchestrationMessage)({
        ...base,
        attachments: [{ type: "image", id: "preview-image", name: "Image 1.png", mimeType: "image/png", sizeBytes: PNG_BYTES.byteLength, previewUrl }],
      })).toThrow();
    }
  });
});
