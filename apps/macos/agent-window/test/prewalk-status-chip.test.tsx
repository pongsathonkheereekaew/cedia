import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PrewalkArmedChipView,
} from "../vendor/synara/apps/web/src/components/chat/PrewalkArmedChip";
import {
  parseCediaPrewalkAnswer,
  serverPrewalkQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

describe("Prewalk armed chip", () => {
  it("renders nothing unless armed", () => {
    expect(renderToStaticMarkup(<PrewalkArmedChipView armed={false} />)).toBe("");
    const html = renderToStaticMarkup(<PrewalkArmedChipView armed />);
    expect(html).toContain('data-testid="cedia-prewalk-chip"');
    expect(html).toContain("prewalk");
    expect(html).toContain("armed");
  });

  it("strictly parses the prewalk state answer", () => {
    expect(parseCediaPrewalkAnswer({ available: true, armed: true })).toEqual({
      state: "available",
      armed: true,
    });
    expect(parseCediaPrewalkAnswer({ available: true, armed: false })).toEqual({
      state: "available",
      armed: false,
    });
    expect(parseCediaPrewalkAnswer({ available: false, reason: "no runtime" })).toEqual({
      state: "unavailable",
      reason: "no runtime",
    });
    expect(() => parseCediaPrewalkAnswer({ available: true, armed: "yes" })).toThrow(/prewalk state/);
    expect(() => parseCediaPrewalkAnswer({ available: true })).toThrow(/invalid prewalk state response/);
    expect(() => parseCediaPrewalkAnswer({ available: true, armed: false, extra: 1 })).toThrow(/invalid prewalk state response/);
  });

  it("re-reads a missing prewalk answer like the other session panels", () => {
    expect(serverPrewalkQueryOptions("session-1").refetchInterval).toBeDefined();
  });

  it("reads prewalk state through the adapter route", async () => {
    const calls: Array<{ method?: string; path?: string }> = [];
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string };
        if (request.kind === "request") calls.push(request);
        if (request.path === "/v1/sessions/session-1/prewalk" && request.method === "GET") {
          return { available: true, armed: true };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await api.cedia.getPrewalk("session-1");
    expect(calls).toContainEqual({
      kind: "request",
      method: "GET",
      path: "/v1/sessions/session-1/prewalk",
    });
  });
});
