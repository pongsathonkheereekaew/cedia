import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CediaToolCatalogPanel,
  codeModePreludeEnabled,
  DYNAMIC_TOOL_DEPENDENCIES,
  dynamicToolDependencies,
  dynamicToolDetail,
  readSettingBoolean,
} from "../vendor/synara/apps/web/src/components/chat/CediaToolCatalogSurface";
import {
  parseCediaToolCatalogAnswer,
  missingBackendRefetchInterval,
  serverToolCatalogQueryOptions,
  serverTreeQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

const catalogAnswer = {
  available: true,
  tools: [
    {
      name: "read",
      description: "Read a file",
      descriptionTruncated: false,
      source: "builtin",
      active: true,
    },
    {
      name: "mcp__github_get_issue",
      description: "Fetch an issue",
      descriptionTruncated: true,
      source: "mcp",
      active: false,
    },
  ],
  truncated: true,
  total: 3,
  activeCount: 1,
};

describe("Cedia tool catalog", () => {
  it("strictly parses the runtime catalog rows", () => {
    const parsed = parseCediaToolCatalogAnswer(catalogAnswer);
    expect(parsed).toMatchObject({
      state: "available",
      total: 3,
      activeCount: 1,
      truncated: true,
    });
    if (parsed.state === "available") {
      expect(parsed.tools).toHaveLength(2);
      expect(parsed.tools[0]).toMatchObject({ name: "read", source: "builtin", active: true });
    }
    expect(() => parseCediaToolCatalogAnswer({ ...catalogAnswer, extra: true })).toThrow(/invalid tool catalog response/);
    expect(() => parseCediaToolCatalogAnswer({ ...catalogAnswer, tools: [{ ...catalogAnswer.tools[0], source: "future" }] })).toThrow(/entry source/);
    expect(() => parseCediaToolCatalogAnswer({ ...catalogAnswer, tools: [catalogAnswer.tools[0], catalogAnswer.tools[0]] })).toThrow(/duplicate names/);
  });

  it("renders registry rows, source class, activation, and truncation without toggles", () => {
    const html = renderToStaticMarkup(
      <CediaToolCatalogPanel state={parseCediaToolCatalogAnswer(catalogAnswer)} />,
    );
    expect(html).toContain("Tool catalog");
    expect(html).toContain("1 active of 3 registered");
    expect(html).toContain('data-tool-name="read"');
    expect(html).toContain('data-tool-active="true"');
    expect(html).toContain('data-tool-name="mcp__github_get_issue"');
    expect(html).toContain("MCP");
    expect(html).toContain("description truncated");
    expect(html).toContain("The runtime truncated this catalog; more tools are not shown.");
    expect(html).toContain("Disable");
    expect(html).toContain("Enable");
    expect(html).toContain('aria-label="Disable read"');
    expect(html).toContain('aria-label="Refresh skills"');
    expect(html).not.toContain("Switch to this point");
  });

  it("keeps the unavailable state honest", () => {
    const unavailable = renderToStaticMarkup(
      <CediaToolCatalogPanel state={{ state: "unavailable", reason: "tool catalog is disabled" }} />,
    );
    expect(unavailable).toContain("tool catalog is disabled");
    expect(unavailable).not.toContain("data-tool-name");
  });

  it("uses the tool catalog route through the adapter", async () => {
    const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
    const session = {
      id: "session-1",
      projectId: "project-1",
      title: "Task",
      cwd: "/workspace",
      sessionFile: "/state/session-1.json",
      incarnation: "inc-1",
      status: "idle",
      archived: false,
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
    };
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string; body?: unknown };
        if (request.kind === "request") calls.push(request);
        if (request.path === "/v1/sessions/session-1") return session;
        if (request.path === "/v1/sessions/session-1/tools/catalog" && request.method === "GET") return catalogAnswer;
        if (request.path === "/v1/sessions/session-1/tools/active" && request.method === "POST") return { available: true, ...catalogAnswer };
        if (request.path === "/v1/sessions/session-1/tools/refresh-skills" && request.method === "POST") return { available: true, ...catalogAnswer };
        if (request.path === "/v1/sessions/session-1/tools/extensions/set" && request.method === "POST") return { available: true, roots: { explicit: [], mode: "merge", configured: [], configuredLevel: "project" }, extensions: [], truncated: false, total: 0 };
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await api.cedia.refreshSkills("session-1");
    const refreshCall = calls.find((call) => call.path === "/v1/sessions/session-1/tools/refresh-skills");
    expect(refreshCall).toMatchObject({ kind: "request", method: "POST" });
    expect((refreshCall?.body as { commandId?: unknown }).commandId).toEqual(expect.any(String));
    await api.cedia.getToolCatalog("session-1");
    expect(calls).toContainEqual({
      kind: "request",
      method: "GET",
      path: "/v1/sessions/session-1/tools/catalog",
    });
    await api.cedia.setActiveTools("session-1", ["read"]);
    const setCall = calls.find((call) => call.path === "/v1/sessions/session-1/tools/active");
    expect(setCall).toMatchObject({ kind: "request", method: "POST" });
    expect(setCall?.body).toMatchObject({ incarnation: "inc-1", toolNames: ["read"] });
    expect((setCall?.body as { commandId?: unknown }).commandId).toEqual(expect.any(String));
    await api.cedia.setExtensionEnabled("session-1", "mcp:echo", false);
    const extSetCall = calls.find((call) => call.path === "/v1/sessions/session-1/tools/extensions/set");
    expect(extSetCall).toMatchObject({ kind: "request", method: "POST" });
    expect(extSetCall?.body).toMatchObject({ incarnation: "inc-1", id: "mcp:echo", enabled: false });
    expect((extSetCall?.body as { commandId?: unknown }).commandId).toEqual(expect.any(String));
  });

  it("names the requirements for provider tools the catalog lacks", () => {
    const html = renderToStaticMarkup(
      <CediaToolCatalogPanel state={parseCediaToolCatalogAnswer(catalogAnswer)} />,
    );
    expect(html).toContain('data-tool-dependency="generate_image"');
    expect(html).toContain('data-tool-dependency="tts"');
    expect(html).toContain("Not registered in this session");
    expect(html).toContain("generate_image.enabled");
    expect(html).toContain("speechgen.enabled");
    expect(html).not.toContain('aria-label="Enable generate_image"');
    expect(html).not.toContain('aria-label="Disable generate_image"');
    expect(html).not.toContain('aria-label="Enable tts"');
    const withImage = renderToStaticMarkup(
      <CediaToolCatalogPanel
        state={parseCediaToolCatalogAnswer({
          ...catalogAnswer,
          tools: [...catalogAnswer.tools, { name: "generate_image", description: "Make an image", descriptionTruncated: false, source: "sdk", active: true }],
        })}
      />,
    );
    expect(withImage).not.toContain('data-tool-dependency="generate_image"');
    expect(withImage).toContain('data-tool-dependency="tts"');
  });

  it("derives absent provider tools from live rows only", () => {
    expect(dynamicToolDependencies([]).map((dep) => dep.name)).toEqual(["generate_image", "tts", "browser", "computer"]);
    expect(
      dynamicToolDependencies([
        { name: "generate_image", description: "", descriptionTruncated: false, source: "sdk", active: true },
      ]),
    ).toEqual([
      { name: "tts", requires: "`speechgen.enabled`" },
      { name: "browser", requires: "`browser.enabled` and the runtime's browser eval prelude" },
      { name: "computer", requires: "`computer.enabled` and the runtime's computer eval prelude" },
    ]);
  });

  it("proves prelude namespaces through the Code Mode partition, never the catalog", () => {
    const proving = {
      state: "available" as const,
      active: false,
      directToolNames: null,
      preludes: [{ name: "browser", enabled: true }],
    };
    expect(dynamicToolDependencies([], proving).map((dep) => dep.name)).toEqual(["generate_image", "tts", "computer"]);
    expect(codeModePreludeEnabled(proving, "browser")).toBe(true);
    expect(codeModePreludeEnabled(proving, "computer")).toBe(false);
    expect(codeModePreludeEnabled(null, "browser")).toBe(false);
    expect(codeModePreludeEnabled({ state: "unavailable", reason: "down" }, "browser")).toBe(false);
    const browser = { name: "browser", requires: "`browser.enabled` and the runtime's browser eval prelude" };
    const computer = { name: "computer", requires: "`computer.enabled` and the runtime's computer eval prelude" };
    expect(dynamicToolDetail(browser, undefined)).toContain("Requires `browser.enabled`");
    expect(dynamicToolDetail(browser, false)).toContain("`browser.enabled` is off");
    expect(dynamicToolDetail(browser, true, false)).toContain("did not enable the browser prelude");
    expect(dynamicToolDetail(computer, true, false)).toContain("`computer.enabled` is on");
    const html = renderToStaticMarkup(
      <CediaToolCatalogPanel
        state={parseCediaToolCatalogAnswer(catalogAnswer)}
        codeMode={proving}
        settingValues={{ generate_image: false, tts: false, browser: true, computer: false }}
      />,
    );
    expect(html).not.toContain('data-tool-dependency="browser"');
    expect(html).toContain('data-tool-dependency="computer"');
    expect(html).toContain("`computer.enabled` is off");
  });

  it("pins dependency names against the dated audit", () => {
    const tools = JSON.parse(
      readFileSync(join(import.meta.dir, "../../../../docs/maintenance/evidence/omp-complete-scope-2026-09-23/tools.json"), "utf8"),
    ) as { dynamic?: { name?: string }[] };
    const audited = new Set((tools.dynamic ?? []).map((entry) => entry?.name));
    for (const dep of DYNAMIC_TOOL_DEPENDENCIES) {
      expect(audited.has(dep.name)).toBe(true);
    }
  });

  it("diagnoses which half is responsible once the setting is known", () => {
    const image = { name: "generate_image", requires: "`generate_image.enabled` and an image-capable provider" };
    const tts = { name: "tts", requires: "`speechgen.enabled`" };
    expect(dynamicToolDetail(image, undefined)).toContain("Requires `generate_image.enabled`");
    expect(dynamicToolDetail(image, true)).toContain("no image-capable provider resolved");
    expect(dynamicToolDetail(image, false)).toContain("is off");
    expect(dynamicToolDetail(tts, undefined)).toContain("Requires `speechgen.enabled`");
    expect(dynamicToolDetail(tts, true)).toContain("tool selection filter");
    expect(dynamicToolDetail(tts, false)).toContain("is off");
    expect(readSettingBoolean({ value: true })).toBe(true);
    expect(readSettingBoolean({ value: false })).toBe(false);
    expect(readSettingBoolean({})).toBeUndefined();
    expect(readSettingBoolean({ value: "yes" })).toBeUndefined();
    expect(readSettingBoolean(undefined)).toBeUndefined();
    expect(readSettingBoolean(null)).toBeUndefined();
  });

  it("renders the diagnosed sentence per dependency row", () => {
    const html = renderToStaticMarkup(
      <CediaToolCatalogPanel
        state={parseCediaToolCatalogAnswer(catalogAnswer)}
        settingValues={{ generate_image: true, tts: false }}
      />,
    );
    expect(html).toContain("no image-capable provider resolved");
    expect(html).toContain("`speechgen.enabled` is off");
  });

  it("re-reads missing session panels until the runtime answers", () => {
    // TanStack v5 calls the rule with the query object as its only argument.
    expect(missingBackendRefetchInterval({ state: { status: "error", data: undefined } })).toBe(5_000);
    expect(missingBackendRefetchInterval({ state: { status: "success", data: { state: "unavailable" } } })).toBe(5_000);
    expect(missingBackendRefetchInterval({ state: { status: "pending", data: undefined } })).toBe(false);
    expect(missingBackendRefetchInterval({ state: { status: "success", data: { state: "available" } } })).toBe(false);
    expect(missingBackendRefetchInterval()).toBe(false);
    expect(missingBackendRefetchInterval(undefined)).toBe(false);
    expect(serverToolCatalogQueryOptions("session-1").refetchInterval).toBe(missingBackendRefetchInterval);
    expect(serverTreeQueryOptions("session-1").refetchInterval).toBe(missingBackendRefetchInterval);
  });
});
