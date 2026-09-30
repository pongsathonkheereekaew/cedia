import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CediaRuntimeModelStateNotice } from "../vendor/synara/apps/web/src/components/chat/CediaRuntimeModelState";
import {
  CediaAccountsList,
  CediaServiceTierControls,
  resolveCediaRuntimeSessionId,
} from "../vendor/synara/apps/web/src/components/settings/CediaRuntimeProviderState";
import type { CediaModelStateAnswer } from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const state: CediaModelStateAnswer = {
  available: true,
  model: { provider: "openai", id: "gpt-5" },
  effort: { configured: "auto", autoResolved: "high", isAuto: true },
  serviceTiers: { families: ["codex"], tiers: ["standard"], current: [{ family: "codex", tier: null }] },
};

describe("Cedia runtime model state surface", () => {
  it("uses the open task session for settings and keeps the no-task case honest", () => {
    expect(
      resolveCediaRuntimeSessionId(null, { id: "task-open", session: { status: "ready" } }),
    ).toBe("task-open");
    expect(resolveCediaRuntimeSessionId(null, null)).toBeNull();
    expect(resolveCediaRuntimeSessionId(null, { id: "task-draft", session: null })).toBeNull();
  });

  it("shows configured and auto-resolved effort without guessing unknown values", () => {
    const html = renderToStaticMarkup(
      <CediaRuntimeModelStateNotice
        state={state}
        sentModel="openai/old-model"
      />,
    );
    expect(html).toContain("Model: openai/gpt-5");
    expect(html).toContain("Configured effort: auto");
    expect(html).toContain("Auto · resolved: high");
    expect(html).toContain("Runtime model differs from this window");

    const unknown = renderToStaticMarkup(
      <CediaRuntimeModelStateNotice
        state={{ ...state, model: null, effort: { configured: null, autoResolved: null, isAuto: false } }}
      />,
    );
    expect(unknown).toContain("Model: unknown");
    expect(unknown).toContain("Configured effort: unknown");
    expect(unknown).not.toContain("Configured effort: medium");
  });

  it("shows the host reason when runtime state is unavailable", () => {
    const html = renderToStaticMarkup(
      <CediaRuntimeModelStateNotice state={{ available: false, reason: "OMP is stopped" }} />,
    );
    expect(html).toContain("Runtime model state unavailable: OMP is stopped");
    expect(html).not.toContain("Configured effort");
  });

  it("distinguishes unsupported and empty provider account lists", () => {
    const unsupported = renderToStaticMarkup(
      <CediaAccountsList
        state={{ available: true, supported: false, provider: "openai", accounts: [], truncated: false }}
      />,
    );
    expect(unsupported).toContain("This provider has no account list.");
    expect(unsupported).not.toContain("No provider accounts are available.");

    const empty = renderToStaticMarkup(
      <CediaAccountsList
        state={{ available: true, supported: true, provider: "openai", accounts: [], truncated: false }}
      />,
    );
    expect(empty).toContain("No provider accounts are available.");
    expect(empty).not.toContain("This provider has no account list.");

    const rows = renderToStaticMarkup(
      <CediaAccountsList
        state={{
          available: true,
          supported: true,
          provider: "openai",
          accounts: [{ credentialId: 3, label: "owner@example.test", active: true }, { credentialId: 4, label: null, active: false }],
          truncated: false,
        }}
        onPin={() => undefined}
      />,
    );
    expect(rows).toContain("owner@example.test");
    expect(rows).toContain("In use");
    expect(rows).toContain("Credential 4");
    expect(rows).toContain(">Pin<");
  });

  it("offers only runtime-published tiers and keeps no-vocabulary state read-only", () => {
    const html = renderToStaticMarkup(
      <CediaServiceTierControls state={state} onSet={() => undefined} />,
    );
    expect(html).toContain("No override");
    expect(html).toContain("standard");
    expect(html).not.toContain("premium");

    const readOnly = renderToStaticMarkup(
      <CediaServiceTierControls
        state={{
          ...state,
          serviceTiers: { families: [], tiers: [], current: [{ family: "codex", tier: "priority" }] },
        }}
        onSet={() => undefined}
      />,
    );
    expect(readOnly).toContain("runtime published no service-tier vocabulary");
    expect(readOnly).toContain("codex: priority");
    expect(readOnly).not.toContain("<select");

    const unadvertisedFamily = renderToStaticMarkup(
      <CediaServiceTierControls
        state={{
          ...state,
          serviceTiers: {
            families: ["codex"],
            tiers: ["standard"],
            current: [{ family: "other", tier: "standard" }],
          },
        }}
        onSet={() => undefined}
      />,
    );
    expect(unadvertisedFamily).toContain("other");
    expect(unadvertisedFamily).toContain("Current value is read-only.");
    expect(unadvertisedFamily).not.toContain('aria-label="other service tier"');
  });
});
