import { afterEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaExtensionsSection,
  extensionStateLabel,
} from "../vendor/synara/apps/web/src/components/chat/CediaToolCatalogSurface";
import {
  parseCediaExtensionsAnswer,
  serverQueryKeys,
  serverToolExtensionSetMutationOptions,
  serverToolExtensionsQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const ANSWER = {
  available: true as const,
  roots: { explicit: [], mode: "merge", configured: ["/tmp/p"], configuredLevel: "project" },
  extensions: [
    { id: "mcp:echo", kind: "mcp", name: "echo", displayName: "Echo", description: "Echo server", descriptionTruncated: false, path: "/tmp/p/.omp/mcp.json", source: { provider: "mcp", providerName: "MCP", level: "project" }, state: "active" },
    { id: "skill:helper", kind: "skill", name: "helper", displayName: "helper", description: "", descriptionTruncated: false, path: "/tmp/p/.omp/skills", source: { provider: "local", providerName: "Local", level: "project" }, state: "disabled", disabledReason: "item-disabled" },
  ],
  truncated: false,
  total: 2,
};

describe("Extension catalog section", () => {
  it("renders records with roots, states, and reasons", () => {
    const html = renderToStaticMarkup(<CediaExtensionsSection extensions={ANSWER} />);
    expect(html).toContain('data-testid="cedia-extensions-section"');
    expect(html).toContain("2 discovered");
    expect(html).toContain("/tmp/p");
    expect(html).toContain("Echo");
    expect(html).toContain("Active");
    expect(html).toContain("Disabled · item-disabled");
    expect(extensionStateLabel("shadowed", undefined, "mcp:echo")).toContain("Shadowed by mcp:echo");
    expect(extensionStateLabel("active")).toBe("Active");
  });

  it("stays honest with no extensions and with an absent runtime", () => {
    const empty = renderToStaticMarkup(
      <CediaExtensionsSection extensions={{ ...ANSWER, extensions: [], total: 0 }} />,
    );
    expect(empty).toContain("No extensions discovered");
    const absent = renderToStaticMarkup(
      <CediaExtensionsSection extensions={{ available: false, reason: "no runtime" }} />,
    );
    expect(absent).toContain("Extensions unavailable");
    expect(absent).toContain("no runtime");
  });

  it("strictly parses the catalog and refuses the raw discovery bag", () => {
    expect(parseCediaExtensionsAnswer(ANSWER)).toEqual(ANSWER);
    expect(parseCediaExtensionsAnswer({ available: false, reason: "no runtime" })).toEqual({
      available: false,
      reason: "no runtime",
    });
    expect(() => parseCediaExtensionsAnswer({ ...ANSWER, extensions: [{ ...ANSWER.extensions[0], state: "vibing" }] })).toThrow(/extension entry/);
    expect(() => parseCediaExtensionsAnswer({ ...ANSWER, extensions: [{ ...ANSWER.extensions[0], raw: {} }] })).toThrow(/extension entry/);
    expect(() => parseCediaExtensionsAnswer({ ...ANSWER, extensions: [{ ...ANSWER.extensions[0], source: { provider: "mcp" } }] })).toThrow(/extension source/);
    expect(() => parseCediaExtensionsAnswer({ ...ANSWER, roots: { ...ANSWER.roots, configuredLevel: "everywhere" } })).toThrow(/extension roots/);
    expect(() => parseCediaExtensionsAnswer({ ...ANSWER, total: -1 })).toThrow(/extension catalog/);
    expect(() => parseCediaExtensionsAnswer({ ...ANSWER, extra: 1 })).toThrow(/extension catalog/);
  });

  it("re-reads a missing catalog answer like the other session panels", () => {
    expect(serverToolExtensionsQueryOptions("session-1").refetchInterval).toBeDefined();
  });

  it("offers a per-row enable/disable toggle except where another extension shadows the row", () => {
    const shadowed = {
      ...ANSWER,
      extensions: [
        ...ANSWER.extensions,
        { id: "skill:shadowed", kind: "skill", name: "shadowed", displayName: "shadowed", description: "", descriptionTruncated: false, path: "/tmp/p/.omp/skills", source: { provider: "local", providerName: "Local", level: "project" }, state: "shadowed", shadowedBy: "mcp:echo" },
      ],
      total: 3,
    };
    const seen: string[] = [];
    const html = renderToStaticMarkup(
      <CediaExtensionsSection extensions={shadowed} onToggleExtension={(entry) => seen.push(entry.id)} />,
    );
    expect(html).toContain('aria-label="Disable extension Echo"');
    expect(html).toContain('aria-label="Enable extension helper"');
    expect(html).not.toContain("extension shadowed");
    expect(html).toContain("Shadowed by mcp:echo");
  });

  it("drives the toggle through the owner-only durable set route and re-reads the catalog", async () => {
    const posts: Array<{ path?: string; body?: unknown }> = [];
    const toggled = { ...ANSWER, extensions: [{ ...ANSWER.extensions[0], state: "disabled", disabledReason: "item-disabled" }], total: 1 };
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string; body?: unknown };
        if (request.path === "/v1/sessions/session-1" && request.method !== "POST") {
          return { id: "session-1", projectId: "project-1", title: "Task", cwd: "/workspace", sessionFile: "/state/session-1.json", incarnation: "inc-1", status: "idle", archived: false, createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z" };
        }
        if (request.kind === "request" && request.method === "POST" && request.path === "/v1/sessions/session-1/tools/extensions/set") {
          posts.push({ path: request.path, body: request.body });
          return { available: true, ...toggled };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge: bridge as never });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { nativeApi: api } });
    const invalidated: unknown[] = [];
    const queryClient = { invalidateQueries: async (filter: unknown) => { invalidated.push(filter); } };
    const options = serverToolExtensionSetMutationOptions({ sessionId: "session-1", queryClient: queryClient as never });
    const answer = await options.mutationFn({ id: "mcp:echo", enabled: false });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ id: "mcp:echo", enabled: false });
    expect((posts[0]?.body as { commandId?: unknown }).commandId).toEqual(expect.any(String));
    expect(answer).toMatchObject({ available: true, total: 1 });
    options.onSuccess!(answer, { id: "mcp:echo", enabled: false }, undefined as never);
    expect(invalidated).toEqual([{ queryKey: serverQueryKeys.toolExtensions("session-1") }]);
  });

  it("reads the catalog through the adapter route", async () => {
    const calls: Array<{ method?: string; path?: string }> = [];
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string };
        if (request.kind === "request") calls.push(request);
        if (request.path === "/v1/sessions/session-1/tools/extensions" && request.method === "GET") {
          return { available: true, ...ANSWER };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await api.cedia.getExtensions("session-1");
    expect(calls).toContainEqual({
      kind: "request",
      method: "GET",
      path: "/v1/sessions/session-1/tools/extensions",
    });
  });
});
