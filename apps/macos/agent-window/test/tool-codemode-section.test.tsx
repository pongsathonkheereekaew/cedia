import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaCodeModeSection,
} from "../vendor/synara/apps/web/src/components/chat/CediaToolCatalogSurface";
import {
  parseCediaCodeModeAnswer,
  serverToolCodeModeQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

describe("Code Mode partition section", () => {
  it("renders an engaged partition with direct names and prelude flags", () => {
    const html = renderToStaticMarkup(
      <CediaCodeModeSection
        codeMode={{
          state: "available",
          active: true,
          directToolNames: ["read", "glob"],
          preludes: [{ name: "browser", enabled: true }],
        }}
      />,
    );
    expect(html).toContain('data-testid="cedia-codemode-section"');
    expect(html).toContain("Code Mode on");
    expect(html).toContain("read, glob");
    expect(html).toContain("browser");
    expect(html).toContain("enabled");
  });

  it("renders a disengaged partition without a direct list", () => {
    const html = renderToStaticMarkup(
      <CediaCodeModeSection
        codeMode={{ state: "available", active: false, directToolNames: null, preludes: [] }}
      />,
    );
    expect(html).toContain("Code Mode off");
    expect(html).toContain("No eval prelude namespaces reported.");
  });

  it("renders absence with the runtime reason", () => {
    const html = renderToStaticMarkup(
      <CediaCodeModeSection codeMode={{ state: "unavailable", reason: "no runtime" }} />,
    );
    expect(html).toContain("Code Mode unavailable");
    expect(html).toContain("no runtime");
  });

  it("strictly parses the Code Mode answer and refuses prelude sources", () => {
    expect(
      parseCediaCodeModeAnswer({ available: true, active: false, directToolNames: null, preludes: [{ name: "browser", enabled: true }] }),
    ).toEqual({
      state: "available",
      active: false,
      directToolNames: null,
      preludes: [{ name: "browser", enabled: true }],
    });
    expect(parseCediaCodeModeAnswer({ available: false, reason: "no runtime" })).toEqual({
      state: "unavailable",
      reason: "no runtime",
    });
    expect(() => parseCediaCodeModeAnswer({ available: true, active: "yes", directToolNames: null, preludes: [] })).toThrow(/Code Mode/);
    expect(() => parseCediaCodeModeAnswer({ available: true, active: false, directToolNames: ["read", 7], preludes: [] })).toThrow(/direct list/);
    expect(() => parseCediaCodeModeAnswer({ available: true, active: false, directToolNames: null, preludes: [{ name: "browser", enabled: true, javascript: "x=1" }] })).toThrow(/prelude/);
    expect(() => parseCediaCodeModeAnswer({ available: true, active: false, directToolNames: null })).toThrow(/Code Mode/);
    expect(() => parseCediaCodeModeAnswer({ available: true, active: false, directToolNames: null, preludes: [], extra: 1 })).toThrow(/Code Mode/);
  });

  it("re-reads a missing Code Mode answer like the other session panels", () => {
    expect(serverToolCodeModeQueryOptions("session-1").refetchInterval).toBeDefined();
  });

  it("reads the partition through the adapter route", async () => {
    const calls: Array<{ method?: string; path?: string }> = [];
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string };
        if (request.kind === "request") calls.push(request);
        if (request.path === "/v1/sessions/session-1/tools/codemode" && request.method === "GET") {
          return { available: true, active: false, directToolNames: null, preludes: [] };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await api.cedia.getCodeMode("session-1");
    expect(calls).toContainEqual({
      kind: "request",
      method: "GET",
      path: "/v1/sessions/session-1/tools/codemode",
    });
  });
});
