import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaContextPanel,
  type CediaMemoryAnswer,
} from "../vendor/synara/apps/web/src/components/chat/CediaContextSurface";

const context = {
  state: "available" as const,
  revision: 1,
  compacting: false,
  speculation: "idle" as const,
};

describe("Cedia context memory section", () => {
  it("renders the runtime backend and Mnemopi state without memory content", () => {
    const memory: CediaMemoryAnswer = {
      state: "available",
      revision: 2,
      backend: "mnemopi",
      applied: true,
      mnemopi: {
        sessionId: "session-memory",
        lastRetainedTurn: 7,
        hasRecalledForFirstTurn: true,
        recallTargets: 2,
        hasGlobalTarget: true,
      },
    };
    const html = renderToStaticMarkup(
      <CediaContextPanel state={context} memory={memory} onApplyMemory={() => undefined} />,
    );

    expect(html).toContain("Memory");
    expect(html).toContain("Mnemopi");
    expect(html).toContain("Last retained turn: 7");
    expect(html).toContain("First-turn recall: happened");
    expect(html).toContain("Recall targets: 2");
    expect(html).toContain("Global target: present");
    expect(html).toContain("Apply backend");
    expect(html).toContain("Backend applied to this session.");
    expect(html).not.toContain("remembered");
  });

  it("renders Hindsight state and an honest absence when the backend has no live block", () => {
    const hindsight: CediaMemoryAnswer = {
      state: "available",
      revision: 3,
      backend: "hindsight",
      hindsight: {
        sessionId: "session-memory",
        bankId: "bank-main",
        banksSet: 2,
        retainTags: 1,
        recallTags: 3,
        recallTagsMatch: "all_strict",
        lastRetainedTurn: 4,
        hasRecalledForFirstTurn: false,
      },
    };
    const activeWithoutBlock: CediaMemoryAnswer = {
      state: "available",
      revision: 4,
      backend: "local",
    };
    const hHtml = renderToStaticMarkup(<CediaContextPanel state={context} memory={hindsight} />);
    const absentHtml = renderToStaticMarkup(<CediaContextPanel state={context} memory={activeWithoutBlock} />);

    expect(hHtml).toContain("Hindsight");
    expect(hHtml).toContain("Bank: bank-main");
    expect(hHtml).toContain("Banks: 2");
    expect(hHtml).toContain("Retain tags: 1");
    expect(hHtml).toContain("Recall tags: 3");
    expect(hHtml).toContain("Tag match: all_strict");
    expect(hHtml).toContain("Last retained turn: 4");
    expect(absentHtml).toContain("The runtime reports no live memory state.");
    expect(absentHtml).not.toContain("Recall targets");
  });

  it("shows only an unavailable memory reason and no memory controls", () => {
    const html = renderToStaticMarkup(
      <CediaContextPanel
        state={context}
        memory={{ state: "unavailable", reason: "OMP memory runtime is stopped" }}
      />,
    );

    expect(html).toContain("OMP memory runtime is stopped");
    expect(html).not.toContain("Apply backend");
  });
});
