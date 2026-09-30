import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaOmfgPanel,
} from "../vendor/synara/apps/web/src/components/chat/CediaOmfgSurface";
import {
  omfgDraftingRefetchInterval,
  parseCediaOmfgAnswer,
  parseCediaOmfgSaveAnswer,
  serverOmfgQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

const READY = {
  available: true as const,
  state: "ready" as const,
  complaint: "Stop that.",
  complaintTruncated: false,
  draft: "# no-eval\nUse the safer pattern.",
  draftTruncated: false,
  ruleName: "no-eval",
  validated: true,
  validationFeedback: null,
  savedPath: null,
  reason: null,
};

describe("Rule-forging surface", () => {
  it("reviews the bounded draft and offers scope, overwrite, save, and amend", () => {
    const html = renderToStaticMarkup(
      <CediaOmfgPanel state={READY} complaint="Stop that." scope="project" onDraft={() => {}} onSave={() => {}} onAmend={() => {}} />,
    );
    expect(html).toContain('data-testid="cedia-omfg-surface"');
    expect(html).toContain("Forge rule");
    expect(html).toContain("no-eval");
    expect(html).toContain("validated");
    expect(html).toContain("This project");
    expect(html).toContain("Overwrite existing");
    expect(html).toContain("Save");
    expect(html).toContain("Amend");
  });

  it("names unvalidated drafts instead of offering a blind save", () => {
    const html = renderToStaticMarkup(
      <CediaOmfgPanel
        state={{ ...READY, validated: false, validationFeedback: "no match in history" }}
        complaint="Stop that."
      />,
    );
    expect(html).toContain("unvalidated");
    expect(html).toContain("Save");
  });

  it("stays honest while drafting, failed, or without a runtime", () => {
    const drafting = renderToStaticMarkup(
      <CediaOmfgPanel state={{ ...READY, state: "drafting", draft: null, ruleName: null }} complaint="Stop that." />,
    );
    expect(drafting).toContain("Drafting");
    const failed = renderToStaticMarkup(
      <CediaOmfgPanel state={{ ...READY, state: "failed", draft: null, ruleName: null, reason: "model exploded" }} complaint="Stop that." />,
    );
    expect(failed).toContain("model exploded");
    const idle = renderToStaticMarkup(<CediaOmfgPanel state={{ ...READY, state: "idle", complaint: null, draft: null, ruleName: null, validated: false }} complaint="" />);
    expect(idle).toContain("What keeps going wrong");
    expect(idle).not.toContain("no-eval");
    const absent = renderToStaticMarkup(<CediaOmfgPanel state={{ available: false, reason: "no runtime" }} complaint="" />);
    expect(absent).not.toContain("no-eval");
  });

  it("strictly parses the forging state and the save answer", () => {
    expect(parseCediaOmfgAnswer(READY)).toEqual(READY);
    expect(parseCediaOmfgAnswer({ available: false, reason: "no runtime" })).toEqual({
      available: false,
      reason: "no runtime",
    });
    expect(parseCediaOmfgSaveAnswer({ saved: true, scope: "global", name: "x", path: "/tmp/x.md", validated: false })).toEqual({
      saved: true,
      scope: "global",
      name: "x",
      path: "/tmp/x.md",
      validated: false,
    });
    expect(() => parseCediaOmfgAnswer({ ...READY, state: "forging" })).toThrow(/rule-forging state/);
    expect(() => parseCediaOmfgAnswer({ ...READY, draft: 7 })).toThrow(/rule draft/);
    expect(() => parseCediaOmfgAnswer({ ...READY, extra: 1 })).toThrow(/rule-forging response/);
    expect(() => parseCediaOmfgSaveAnswer({ saved: true, scope: "everywhere", name: "x", path: "/tmp/x.md", validated: true })).toThrow(/save scope/);
    expect(() => parseCediaOmfgSaveAnswer({ saved: false, scope: "project", name: "x", path: "/tmp/x.md", validated: true })).toThrow(/unconfirmed/);
  });

  it("polls while a draft runs and never once it settles", () => {
    expect(omfgDraftingRefetchInterval({ state: { data: { available: true, state: "drafting" } } })).toBe(2_000);
    expect(omfgDraftingRefetchInterval({ state: { data: { available: true, state: "ready" } } })).toBe(false);
    expect(omfgDraftingRefetchInterval({ state: { data: { available: true, state: "failed" } } })).toBe(false);
    expect(omfgDraftingRefetchInterval(undefined)).toBe(false);
    expect(serverOmfgQueryOptions("session-1").refetchOnWindowFocus).toBe(true);
  });

  it("drafts, saves, and aborts through the adapter routes with the durable envelope", async () => {
    const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string; body?: unknown };
        if (request.kind === "request") calls.push(request);
        if (request.path === "/v1/sessions/session-1/omfg" && request.method === "GET") {
          return { available: true, state: "idle", complaint: null, complaintTruncated: false, draft: null, draftTruncated: false, ruleName: null, validated: false, validationFeedback: null, savedPath: null, reason: null };
        }
        if (request.path === "/v1/sessions/session-1/omfg/draft" && request.method === "POST") {
          return { available: true, state: "drafting", complaint: "Stop that.", complaintTruncated: false, draft: null, draftTruncated: false, ruleName: null, validated: false, validationFeedback: null, savedPath: null, reason: null };
        }
        if (request.path === "/v1/sessions/session-1/omfg/save" && request.method === "POST") {
          return { saved: true, scope: "project", name: "no-eval", path: "/tmp/no-eval.md", validated: true };
        }
        if (request.path === "/v1/sessions/session-1/omfg/abort" && request.method === "POST") {
          return { available: true, state: "idle", complaint: null, complaintTruncated: false, draft: null, draftTruncated: false, ruleName: null, validated: false, validationFeedback: null, savedPath: null, reason: null };
        }
        if (request.path === "/v1/sessions/session-1" && request.method === "GET") {
          return { id: "session-1", projectId: "project-1", cwd: "/tmp", incarnation: "inc-1", createdAt: "2026-09-25T00:00:00.000Z" };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await api.cedia.getOmfg("session-1");
    await api.cedia.draftOmfg("session-1", { commandId: "cmd-1", incarnation: "inc-1", complaint: "Stop that." });
    await api.cedia.saveOmfg("session-1", { commandId: "cmd-2", incarnation: "inc-1", scope: "project" });
    await api.cedia.abortOmfg("session-1", { commandId: "cmd-3", incarnation: "inc-1" });
    expect(calls).toContainEqual({ kind: "request", method: "GET", path: "/v1/sessions/session-1/omfg" });
    const draft = calls.find((call) => call.path === "/v1/sessions/session-1/omfg/draft");
    expect(draft?.body).toMatchObject({ commandId: "cmd-1", complaint: "Stop that." });
    const save = calls.find((call) => call.path === "/v1/sessions/session-1/omfg/save");
    expect(save?.body).toMatchObject({ commandId: "cmd-2", scope: "project" });
  });
});
