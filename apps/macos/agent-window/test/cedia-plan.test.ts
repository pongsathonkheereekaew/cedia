import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import { tagCediaHostErrorMessage } from "../src/host-error-codes.ts";

type Request = {
  kind: "request";
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

function planBridge(answer: unknown = {
  state: "available",
  revision: 4,
  plan: { enabled: true, planFilePath: "/workspace/.omp/plan.md", workflow: "parallel", reentry: false },
  vibe: { enabled: false },
  review: null,
}) {
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

describe("Cedia native plan adapter", () => {
  it("reads and writes the session plan through the exact host routes and body", async () => {
    const fixture = planBridge();
    const api = createCediaNativeApi({ bridge: fixture.bridge });
    const enter = { commandId: "plan-command-1", incarnation: "inc-4", op: "enter" as const };
    const exit = { commandId: "plan-command-2", incarnation: "inc-4", op: "exit" as const };
    const body = { commandId: "plan-command-3", incarnation: "inc-4", op: "review.decide" as const, reviewId: 9, decision: "approve" as const };

    await api.cedia.getPlan("session-plan");
    await api.cedia.setPlan("session-plan", enter);
    await api.cedia.setPlan("session-plan", exit);
    await api.cedia.setPlan("session-plan", body);

    expect(fixture.calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/sessions/session-plan/plan" },
      { kind: "request", method: "POST", path: "/v1/sessions/session-plan/plan", body: enter },
      { kind: "request", method: "POST", path: "/v1/sessions/session-plan/plan", body: exit },
      { kind: "request", method: "POST", path: "/v1/sessions/session-plan/plan", body },
    ]);
  });

  it("preserves the host's typed refusal reason and code", async () => {
    const fixture = planBridge();
    fixture.bridge.invoke = async () => {
      throw new Error(tagCediaHostErrorMessage("CEDIA_PLAN_REFUSED", "Plan mode is unavailable"));
    };
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await expect(api.cedia.setPlan("session-plan", {
      commandId: "plan-command-4",
      incarnation: "inc-4",
      op: "enter",
    })).rejects.toMatchObject({
      name: "CediaHostError",
      code: "CEDIA_PLAN_REFUSED",
      message: "Plan mode is unavailable",
    });
  });
});
