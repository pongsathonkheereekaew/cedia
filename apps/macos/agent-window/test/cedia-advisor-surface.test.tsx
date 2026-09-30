import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaAdvisorPanel,
  type CediaAdvisorAnswer,
  type CediaAdvisorHistoryAnswer,
} from "../vendor/synara/apps/web/src/components/chat/CediaAdvisorSurface";
import { parseCediaAdvisorAnswer, parseCediaAdvisorHistoryAnswer } from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const baseAdvisor = {
  enabled: true,
  active: true,
  configured: true,
  model: { provider: "omp", id: "advisor-model", name: "Advisor model" },
  contextWindow: 32_000,
  contextTokens: 240,
  tokens: { input: 100, output: 20, reasoning: 5, cacheRead: 10, cacheWrite: 2, total: 137 },
  cost: 0.12,
  messages: { user: 2, assistant: 3, total: 5 },
  advisors: [],
  changed: false,
} as const;

function answer(advisor: CediaAdvisorAnswer["advisor"]): CediaAdvisorAnswer {
  return { state: "available", revision: 1, advisor };
}

describe("Cedia advisor surface", () => {
  it("renders the runtime's three switch state wordings", () => {
    expect(renderToStaticMarkup(<CediaAdvisorPanel state={answer(baseAdvisor)} />)).toContain("Advisor on");
    expect(renderToStaticMarkup(<CediaAdvisorPanel state={answer({ ...baseAdvisor, active: false })} />).replaceAll("&#x27;", "'")).toContain(
      "Advisor setting enabled, but no model is assigned to the 'advisor' role.",
    );
    expect(renderToStaticMarkup(<CediaAdvisorPanel state={answer({ ...baseAdvisor, enabled: false, active: false })} />)).toContain("Advisor off");
  });

  it("does not render the stale roster while the runtime says the advisor is off", () => {
    const html = renderToStaticMarkup(
      <CediaAdvisorPanel
        state={answer({
          ...baseAdvisor,
          enabled: false,
          active: false,
          advisors: [{
            name: "default",
            status: "running",
            contextWindow: 8_000,
            contextTokens: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            cost: 0,
            messages: { user: 0, assistant: 0, total: 0 },
          }],
        })}
      />,
    );
    expect(html).toContain("Advisor off");
    expect(html).not.toContain("Advisors");
    expect(html).not.toContain('data-advisor-name="default"');
  });

  it("renders advisor status, context, spend, and message counts verbatim", () => {
    const html = renderToStaticMarkup(
      <CediaAdvisorPanel
        state={answer({
          ...baseAdvisor,
          advisors: [{
            name: "planner",
            status: "waiting for the next turn",
            model: { provider: "omp", id: "planner-model" },
            contextWindow: 8_000,
            contextTokens: 321,
            tokens: { input: 70, output: 11, reasoning: 3, cacheRead: 4, cacheWrite: 1, total: 89 },
            cost: 0.07,
            messages: { user: 1, assistant: 2, total: 3 },
          }],
        })}
      />,
    );
    expect(html).toContain("planner");
    expect(html).toContain("waiting for the next turn");
    expect(html).toContain("321 / 8000");
    expect(html).toContain("89");
    expect(html).toContain("$0.07");
    expect(html).toContain("1 user");
    expect(html).toContain("2 assistant");
  });

  it("renders the inactive transcript sentence and bounded notice", () => {
    const inactive: CediaAdvisorHistoryAnswer = { state: "available", text: null, truncated: false };
    const bounded: CediaAdvisorHistoryAnswer = { state: "available", text: "advisor transcript", truncated: true };
    expect(renderToStaticMarkup(<CediaAdvisorPanel state={answer(baseAdvisor)} history={inactive} />)).toContain(
      "Advisor is not active for this session.",
    );
    const html = renderToStaticMarkup(<CediaAdvisorPanel state={answer(baseAdvisor)} history={bounded} />);
    expect(html).toContain("advisor transcript");
    expect(html).toContain("bounded");
    expect(html).toContain("may not be complete");
  });

  it("renders an unavailable reason without a switch or empty advisor", () => {
    const html = renderToStaticMarkup(
      <CediaAdvisorPanel state={{ state: "unavailable", reason: "OMP advisor runtime is stopped" }} />,
    );
    expect(html).toContain("OMP advisor runtime is stopped");
    expect(html).not.toContain("Turn advisor on");
    expect(html).not.toContain("Turn advisor off");
    expect(html).not.toContain("No advisors");
  });

  it("parses the advisor and transcript routes defensively", () => {
    expect(parseCediaAdvisorAnswer({ state: "available", revision: 4, advisor: baseAdvisor })).toEqual({
      state: "available",
      revision: 4,
      advisor: baseAdvisor,
    });
    expect(parseCediaAdvisorHistoryAnswer({ state: "available", text: null, truncated: false })).toEqual({
      state: "available",
      text: null,
      truncated: false,
    });
  });
});
