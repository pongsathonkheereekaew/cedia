import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LoopModeChipView,
} from "../vendor/synara/apps/web/src/components/chat/LoopModeChip";
import {
  parseCediaLoopAnswer,
  serverLoopMutationOptions,
  serverLoopQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

describe("Loop mode chip", () => {
  it("renders nothing unless loop mode is on", () => {
    expect(renderToStaticMarkup(<LoopModeChipView enabled={false} paused={false} limit={null} />)).toBe("");
    const html = renderToStaticMarkup(<LoopModeChipView enabled paused={false} limit="3 iterations remaining" />);
    expect(html).toContain('data-testid="cedia-loop-chip"');
    expect(html).toContain("loop");
    expect(html).toContain("3 iterations remaining");
    expect(html).toContain("Disable");
  });

  it("names a paused loop without offering a second pause control", () => {
    const html = renderToStaticMarkup(<LoopModeChipView enabled paused limit={null} />);
    expect(html).toContain("paused");
    expect(html).not.toContain("Pause");
  });

  it("strictly parses the loop mode answer", () => {
    expect(parseCediaLoopAnswer({ available: true, enabled: true, paused: false, limit: "3 left", condition: null, hasPrompt: true })).toEqual({
      state: "available",
      enabled: true,
      paused: false,
      limit: "3 left",
      condition: null,
      hasPrompt: true,
    });
    expect(parseCediaLoopAnswer({ available: true, enabled: false, paused: false, limit: null, condition: null, hasPrompt: false })).toEqual({
      state: "available",
      enabled: false,
      paused: false,
      limit: null,
      condition: null,
      hasPrompt: false,
    });
    expect(parseCediaLoopAnswer({ available: false, reason: "no runtime" })).toEqual({
      state: "unavailable",
      reason: "no runtime",
    });
    expect(() => parseCediaLoopAnswer({ available: true, enabled: "yes", paused: false, limit: null, condition: null, hasPrompt: false })).toThrow(/loop mode/);
    expect(() => parseCediaLoopAnswer({ available: true, enabled: false, paused: false, limit: 3, condition: null, hasPrompt: false })).toThrow(/loop mode bound/);
    expect(() => parseCediaLoopAnswer({ available: true, enabled: false })).toThrow(/invalid loop mode response/);
    expect(() => parseCediaLoopAnswer({ available: true, enabled: false, paused: false, limit: null, condition: null, hasPrompt: false, extra: 1 })).toThrow(/invalid loop mode response/);
  });

  it("re-reads a missing loop answer like the other session panels", () => {
    expect(serverLoopQueryOptions("session-1").refetchInterval).toBeDefined();
  });

  it("disables loop mode through the adapter route with the durable envelope", async () => {
    const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string; body?: unknown };
        if (request.kind === "request") calls.push(request);
        if (request.path === "/v1/sessions/session-1/loop" && request.method === "GET") {
          return { available: true, enabled: true, paused: false, limit: "3 left", condition: null, hasPrompt: true };
        }
        if (request.path === "/v1/sessions/session-1/loop" && request.method === "POST") {
          return { state: "available", enabled: false, paused: false, limit: null, condition: null, hasPrompt: false };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await api.cedia.getLoop("session-1");
    await api.cedia.disableLoop("session-1", { commandId: "cmd-1", incarnation: "inc-1" });
    expect(calls).toContainEqual({
      kind: "request",
      method: "GET",
      path: "/v1/sessions/session-1/loop",
    });
    const post = calls.find((call) => call.method === "POST");
    expect(post?.path).toBe("/v1/sessions/session-1/loop");
    expect(post?.body).toMatchObject({ commandId: "cmd-1", incarnation: "inc-1" });
    void serverLoopMutationOptions;
  });
});
