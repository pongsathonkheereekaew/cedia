import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CediaPlanModePanel, CediaPlanReviewPanel } from "../vendor/synara/apps/web/src/components/chat/CediaPlanSurface";
import { parseCediaPlanAnswer } from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const review = {
  reviewId: 7,
  title: "Ship the plan surface",
  planFilePath: "/workspace/.omp/ship-plan.md",
  planContent: "# Ship the plan surface\n\n1. Add controls",
  truncated: true,
  createdAt: 1_758_000_000_000,
};

describe("Cedia plan surfaces", () => {
  it("renders review content and honestly marks bounded content", () => {
    const html = renderToStaticMarkup(
      <CediaPlanReviewPanel
        review={review}
        busy={false}
        feedback=""
        onFeedbackChange={() => undefined}
        onDecision={() => undefined}
      />,
    );
    expect(html).toContain("Ship the plan surface");
    expect(html).toContain("1. Add controls");
    expect(html).toContain("bounded copy");
  });

  it("renders unavailable state as a reason without a working-looking toggle", () => {
    const html = renderToStaticMarkup(
      <CediaPlanModePanel
        state={{ state: "unavailable", reason: "OMP runtime is stopped" }}
        busy={false}
        onPlanToggle={() => undefined}
        onVibeToggle={() => undefined}
      />,
    );
    expect(html).toContain("OMP runtime is stopped");
    expect(html).not.toContain("Enter plan mode");
    expect(html).not.toContain("Exit plan mode");
  });

  it("keeps the runtime's paused plan state distinct from off", () => {
    const state = parseCediaPlanAnswer({
      state: "available",
      revision: 3,
      plan: { enabled: false, paused: true, workflow: "iterative", reentry: false },
      vibe: { enabled: false },
      review: null,
    });
    const html = renderToStaticMarkup(
      <CediaPlanModePanel
        state={state}
        busy={false}
        onPlanToggle={() => undefined}
        onVibeToggle={() => undefined}
      />,
    );
    expect(html).toContain("Paused");
    expect(html).toContain("Exit plan mode");
    expect(html).not.toContain(">Off<");
  });

  it("prevents vibe start while plan mode is active and preserves the runtime hint", () => {
    const html = renderToStaticMarkup(
      <CediaPlanModePanel
        state={{
          state: "available",
          revision: 4,
          plan: { enabled: true, paused: false, workflow: "parallel", reentry: false },
          vibe: { enabled: false },
          review: null,
        }}
        busy={false}
        onPlanToggle={() => undefined}
        onVibeToggle={() => undefined}
      />,
    );
    expect(html).toContain("title=\"Exit plan mode first.\"");
    expect(html).toContain("disabled=\"\"");
  });
});
