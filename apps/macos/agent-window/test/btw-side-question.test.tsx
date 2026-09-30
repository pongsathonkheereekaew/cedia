import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaBtwPanel,
} from "../vendor/synara/apps/web/src/components/chat/CediaBtwSurface";
import {
  btwAnsweringRefetchInterval,
  parseCediaBtwAnswer,
  parseCediaBtwBranchAnswer,
  serverBtwQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

const READY = {
  available: true as const,
  state: "ready" as const,
  question: "Why?",
  questionTruncated: false,
  answer: "Because.",
  answerTruncated: false,
  branchable: true,
  branchUnavailableReason: null,
  reason: null,
};

describe("Side-question surface", () => {
  it("asks from the panel and offers branch plus copy on a ready answer", () => {
    const html = renderToStaticMarkup(
      <CediaBtwPanel state={READY} question="Why?" onAsk={() => {}} onBranch={() => {}} onCopyAnswer={() => {}} />,
    );
    expect(html).toContain('data-testid="cedia-btw-surface"');
    expect(html).toContain("Side question");
    expect(html).toContain("Because.");
    expect(html).toContain("Branch");
    expect(html).toContain("Copy");
  });

  it("names the branch refusal instead of offering a doomed branch", () => {
    const html = renderToStaticMarkup(
      <CediaBtwPanel
        state={{ ...READY, branchable: false, branchUnavailableReason: "a turn is still running" }}
        question="Why?"
      />,
    );
    expect(html).not.toContain("Branch");
    expect(html).toContain("a turn is still running");
  });

  it("stays honest while idle, failed, or without a runtime", () => {
    const idle = renderToStaticMarkup(<CediaBtwPanel state={{ ...READY, state: "idle", question: null, answer: null, branchable: false, branchUnavailableReason: "no answered side question" }} question="" />);
    expect(idle).toContain("Ask about this session");
    expect(idle).not.toContain("Because.");
    const failed = renderToStaticMarkup(
      <CediaBtwPanel state={{ ...READY, state: "failed", answer: null, branchable: false, branchUnavailableReason: "no answered side question", reason: "model exploded" }} question="Why?" />,
    );
    expect(failed).toContain("model exploded");
    const absent = renderToStaticMarkup(<CediaBtwPanel state={{ available: false, reason: "no runtime" }} question="" />);
    expect(absent).not.toContain("Because.");
  });

  it("strictly parses the side-question state and the branch answer", () => {
    expect(parseCediaBtwAnswer(READY)).toEqual(READY);
    expect(parseCediaBtwAnswer({ available: false, reason: "no runtime" })).toEqual({
      available: false,
      reason: "no runtime",
    });
    expect(parseCediaBtwBranchAnswer({ cancelled: false, sessionFile: "/tmp/b.jsonl" })).toEqual({
      cancelled: false,
      sessionFile: "/tmp/b.jsonl",
    });
    expect(() => parseCediaBtwAnswer({ ...READY, state: "answering-forever" })).toThrow(/side-question state/);
    expect(() => parseCediaBtwAnswer({ ...READY, answer: 7 })).toThrow(/side answer/);
    expect(() => parseCediaBtwAnswer({ ...READY, extra: 1 })).toThrow(/side-question response/);
    expect(() => parseCediaBtwBranchAnswer({ cancelled: false, sessionFile: "" })).toThrow(/branch file/);
    expect(() => parseCediaBtwBranchAnswer({ available: false, reason: "down" })).toThrow(/down/);
  });

  it("re-reads like the other session panels", () => {
    expect(serverBtwQueryOptions("session-1").refetchOnWindowFocus).toBe(true);
  });

  it("polls while an ask runs and never once it settles", () => {
    const answering = { state: { data: { available: true, state: "answering" } } };
    const ready = { state: { data: { available: true, state: "ready" } } };
    const failed = { state: { data: { available: true, state: "failed" } } };
    const idle = { state: { data: null } };
    expect(btwAnsweringRefetchInterval(answering)).toBe(2_000);
    expect(btwAnsweringRefetchInterval(ready)).toBe(false);
    expect(btwAnsweringRefetchInterval(failed)).toBe(false);
    expect(btwAnsweringRefetchInterval(idle)).toBe(false);
    expect(btwAnsweringRefetchInterval(undefined)).toBe(false);
  });

  it("asks and branches through the adapter routes with the durable envelope", async () => {
    const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string; body?: unknown };
        if (request.kind === "request") calls.push(request);
        if (request.path === "/v1/sessions/session-1/btw" && request.method === "GET") {
          return { available: true, ...READY, state: "idle", question: null, answer: null, branchable: false, branchUnavailableReason: "no answered side question" };
        }
        if (request.path === "/v1/sessions/session-1/btw/ask" && request.method === "POST") {
          return { available: true, ...READY };
        }
        if (request.path === "/v1/sessions/session-1/btw/branch" && request.method === "POST") {
          return { cancelled: false, sessionFile: "/tmp/branched.jsonl" };
        }
        if (request.path === "/v1/sessions/session-1" && request.method === "GET") {
          return { id: "session-1", projectId: "project-1", cwd: "/tmp", incarnation: "inc-1", createdAt: "2026-09-25T00:00:00.000Z" };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await api.cedia.getBtw("session-1");
    await api.cedia.askBtw("session-1", { commandId: "cmd-1", incarnation: "inc-1", question: "Why?" });
    await api.cedia.branchBtw("session-1", { commandId: "cmd-2", incarnation: "inc-1" });
    expect(calls).toContainEqual({ kind: "request", method: "GET", path: "/v1/sessions/session-1/btw" });
    const ask = calls.find((call) => call.path === "/v1/sessions/session-1/btw/ask");
    expect(ask?.body).toMatchObject({ commandId: "cmd-1", question: "Why?" });
    const branch = calls.find((call) => call.path === "/v1/sessions/session-1/btw/branch");
    expect(branch?.body).toMatchObject({ commandId: "cmd-2", incarnation: "inc-1" });
  });
});
