import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import { tagCediaHostErrorMessage } from "../src/host-error-codes.ts";

type Request = {
  kind: "request";
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

const advisorAnswer = {
  state: "available" as const,
  revision: 3,
  advisor: {
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
  },
};

function advisorBridge(answer: unknown = advisorAnswer) {
  const calls: Request[] = [];
  return {
    calls,
    bridge: {
      invoke: async (_channel: string, input: Request) => {
        calls.push(input);
        return answer;
      },
    },
  };
}

describe("Cedia native advisor adapter", () => {
  it("reads, switches, and reads history through the exact host routes", async () => {
    const fixture = advisorBridge();
    const api = createCediaNativeApi({ bridge: fixture.bridge });
    const body = { commandId: "advisor-command-1", incarnation: "inc-3", op: "set" as const, enabled: false };

    await api.cedia.getAdvisor("session-advisor");
    await api.cedia.setAdvisor("session-advisor", body);
    await api.cedia.getAdvisorHistory("session-advisor");

    expect(fixture.calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/sessions/session-advisor/advisor" },
      { kind: "request", method: "POST", path: "/v1/sessions/session-advisor/advisor", body },
      { kind: "request", method: "GET", path: "/v1/sessions/session-advisor/advisor/history" },
    ]);
  });

  it("preserves a typed host refusal reason and code", async () => {
    const fixture = advisorBridge();
    fixture.bridge.invoke = async () => {
      throw new Error(tagCediaHostErrorMessage("CEDIA_ADVISOR_REFUSED", "Advisor switching is unavailable"));
    };
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await expect(api.cedia.setAdvisor("session-advisor", {
      commandId: "advisor-command-2",
      incarnation: "inc-3",
      op: "set",
      enabled: true,
    })).rejects.toMatchObject({
      name: "CediaHostError",
      code: "CEDIA_ADVISOR_REFUSED",
      message: "Advisor switching is unavailable",
    });
  });
});
