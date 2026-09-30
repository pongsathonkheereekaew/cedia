import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaModelRolesControls,
} from "../vendor/synara/apps/web/src/components/settings/CediaRuntimeProviderState";
import {
  parseCediaModelRolesAnswer,
  parseCediaRoleApplyAnswer,
  serverModelRolesQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

const roles = {
  available: true as const,
  cycleOrder: ["default", "smol"],
  roles: [
    { role: "default", modelId: "fixture/fixture-model", source: "global" },
    { role: "smol", modelId: "fixture/fast-1", source: "global" },
  ],
  storage: "global",
};

describe("Cedia model roles surface", () => {
  it("lists configured roles with their models and an apply action", () => {
    const html = renderToStaticMarkup(<CediaModelRolesControls state={roles} onApply={() => {}} />);
    expect(html).toContain("smol");
    expect(html).toContain("fixture/fast-1");
    expect(html).toContain("Apply");
  });

  it("renders per-row assignment and a new-role form", () => {
    const html = renderToStaticMarkup(
      <CediaModelRolesControls state={roles} onApply={() => {}} onSet={() => {}} />,
    );
    expect(html).toContain("Set");
    expect(html).toContain("Clear");
    expect(html).toContain("Assign");
    expect(html).toContain("provider/model");
    expect(html).toContain("falls back to its default resolution");
  });

  it("renders rows in the runtime cycle order, unknown roles last", () => {
    const shuffled = {
      ...roles,
      cycleOrder: ["smol", "default"],
      roles: [
        { role: "extra", modelId: "fixture/x-1", source: "global" },
        { role: "default", modelId: "fixture/fixture-model", source: "global" },
        { role: "smol", modelId: "fixture/fast-1", source: "global" },
      ],
    };
    const html = renderToStaticMarkup(
      <CediaModelRolesControls state={shuffled} onApply={() => {}} onSet={() => {}} />,
    );
    const smolAt = html.indexOf(">smol<");
    const defaultAt = html.indexOf(">default<");
    const extraAt = html.indexOf(">extra<");
    expect(smolAt).toBeGreaterThan(-1);
    expect(defaultAt).toBeGreaterThan(-1);
    expect(extraAt).toBeGreaterThan(-1);
    expect(smolAt).toBeLessThan(defaultAt);
    expect(defaultAt).toBeLessThan(extraAt);
  });

  it("stays honest with no configured roles and with an absent runtime", () => {
    const empty = renderToStaticMarkup(
      <CediaModelRolesControls state={{ ...roles, roles: [] }} />,
    );
    expect(empty).toContain("No model roles are configured");
    const absent = renderToStaticMarkup(
      <CediaModelRolesControls state={{ available: false, reason: "no runtime" }} />,
    );
    expect(absent).toContain("no runtime");
    expect(absent).not.toContain("Apply");
  });

  it("strictly parses the roles mapping and the apply answer", () => {
    expect(parseCediaModelRolesAnswer(roles)).toEqual(roles);
    expect(parseCediaModelRolesAnswer({ available: false, reason: "no runtime" })).toEqual({
      available: false,
      reason: "no runtime",
    });
    expect(parseCediaRoleApplyAnswer({ role: "smol", provider: "fixture", model: "fast-1" })).toEqual({
      role: "smol",
      provider: "fixture",
      model: "fast-1",
    });
    expect(() => parseCediaModelRolesAnswer({ ...roles, roles: [{ role: "smol" }] })).toThrow(/model role/);
    expect(() => parseCediaModelRolesAnswer({ ...roles, extra: 1 })).toThrow(/model roles/);
    expect(() => parseCediaModelRolesAnswer({ available: true })).toThrow(/model roles/);
    expect(() => parseCediaRoleApplyAnswer({ role: "smol", provider: "fixture" })).toThrow(/applied model/);
    expect(parseCediaModelRolesAnswer({ cycleOrder: roles.cycleOrder, roles: roles.roles, storage: roles.storage })).toEqual(roles);
    expect(() => parseCediaModelRolesAnswer({ cycleOrder: [], roles: [], storage: "global", extra: 1 })).toThrow(/model roles/);
  });

  it("reads the mapping through the adapter routes with the durable envelope", async () => {
    const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string; body?: unknown };
        if (request.kind === "request") calls.push(request);
        if (request.path === "/v1/sessions/session-1" && request.method === "GET") {
          return { id: "session-1", projectId: "project-1", cwd: "/tmp", incarnation: "inc-1", createdAt: "2026-09-25T00:00:00.000Z" };
        }
        if (request.path === "/v1/sessions/session-1/roles" && request.method === "GET") {
          return { available: true, ...roles };
        }
        if (request.path === "/v1/sessions/session-1/roles/apply" && request.method === "POST") {
          return { role: "smol", provider: "fixture", model: "fast-1" };
        }
        if (request.path === "/v1/sessions/session-1/roles/set" && request.method === "POST") {
          const body = request.body as { role?: unknown; modelId?: unknown };
          if (typeof body.role !== "string" || body.role.trim().length === 0) throw new Error("role required");
          return { available: true, ...roles };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await api.cedia.getModelRoles("session-1");
    await api.cedia.applyModelRole("session-1", "smol");
    expect(calls).toContainEqual({ kind: "request", method: "GET", path: "/v1/sessions/session-1/roles" });
    const post = calls.find((call) => call.method === "POST");
    expect(post?.path).toBe("/v1/sessions/session-1/roles/apply");
    expect(post?.body).toMatchObject({ role: "smol" });
    await api.cedia.setModelRole("session-1", "smol", "fixture/fast-2");
    await api.cedia.setModelRole("session-1", "smol", null);
    const setPost = calls.filter((call) => call.method === "POST").at(-1);
    expect(setPost?.path).toBe("/v1/sessions/session-1/roles/set");
    expect(setPost?.body).toMatchObject({ role: "smol", modelId: null });
    await expect(api.cedia.setModelRole("session-1", "  ", "fixture/fast-2")).rejects.toThrow(/role name/);
    await expect(api.cedia.setModelRole("session-1", "smol", "  ")).rejects.toThrow(/model id/);
    void serverModelRolesQueryOptions;
  });
});
