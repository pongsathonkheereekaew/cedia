import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import { tagCediaHostErrorMessage } from "../src/host-error-codes.ts";

type Request = {
  kind: "request";
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

function progressBridge(answer: unknown = {
  state: "available",
  revision: 8,
  phases: [{ name: "Build", tasks: [{ content: "Ship it", status: "in_progress" }] }],
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

describe("Cedia native progress adapter", () => {
  it("reads progress through the exact host route", async () => {
    const fixture = progressBridge();
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await api.cedia.getProgress("session-progress");

    expect(fixture.calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/sessions/session-progress/progress" },
    ]);
  });

  it("preserves a typed host refusal reason and code", async () => {
    const fixture = progressBridge();
    fixture.bridge.invoke = async () => {
      throw new Error(tagCediaHostErrorMessage("CEDIA_PROGRESS_UNAVAILABLE", "OMP progress is unavailable"));
    };
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await expect(api.cedia.getProgress("session-progress")).rejects.toMatchObject({
      name: "CediaHostError",
      code: "CEDIA_PROGRESS_UNAVAILABLE",
      message: "OMP progress is unavailable",
    });
  });
});
