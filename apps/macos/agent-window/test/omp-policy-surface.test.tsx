import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createCediaNativeApi } from "../src/cedia-adapter";
import { tagCediaHostErrorMessage } from "../src/host-error-codes";
import {
  CediaCreditPolicyPanel,
} from "../vendor/synara/apps/web/src/components/settings/OmpSettingsPanel";
import {
  parseCediaPolicyAnswer,
  serverPolicyQueryOptions,
  type CediaPolicyAnswer,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const policy = {
  guardActive: true,
  stored: "yes" as const,
  effective: "no" as const,
  overridden: true,
  reason: "Cedia never spends a saved reset on its own.",
};

function renderedText(html: string): string {
  return html.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'");
}

describe("OMP credit policy settings surface", () => {
  it("reads policy through the adapter's owner route and preserves typed host errors", async () => {
    const calls: Array<{ method?: string; path?: string }> = [];
    const bridge = {
      invoke: async (_channel: string, request: { method?: string; path?: string }) => {
        calls.push(request);
        return { state: "available", answer: policy };
      },
    };
    const api = createCediaNativeApi({ bridge: bridge as never });

    await expect(api.cedia.getPolicy()).resolves.toEqual({ state: "available", answer: policy });
    expect(calls).toEqual([{ kind: "request", method: "GET", path: "/v1/omp/policy" }]);

    const failingApi = createCediaNativeApi({
      bridge: {
        invoke: async () => {
          throw new Error(tagCediaHostErrorMessage("omp_policy_unavailable", "OMP policy is unavailable"));
        },
      } as never,
    });
    await expect(failingApi.cedia.getPolicy()).rejects.toMatchObject({
      code: "omp_policy_unavailable",
      message: "OMP policy is unavailable",
    });
  });

  it("parses available and unavailable answers, and refuses malformed policy data", () => {
    expect(parseCediaPolicyAnswer({ state: "available", answer: policy })).toEqual({
      state: "available",
      answer: policy,
    });
    expect(parseCediaPolicyAnswer({ state: "unavailable", reason: "OMP runtime is stopped" })).toEqual({
      state: "unavailable",
      reason: "OMP runtime is stopped",
    });
    expect(() => parseCediaPolicyAnswer({ state: "available", answer: { ...policy, effective: "maybe" } })).toThrow();
    expect(() => parseCediaPolicyAnswer({ state: "available", answer: { ...policy, reason: "" } })).toThrow();
    expect(() => parseCediaPolicyAnswer({ state: "unavailable", reason: "" })).toThrow();
  });

  it("re-reads on focus without configuring a polling interval", () => {
    const options = serverPolicyQueryOptions();
    expect(options.queryKey).toEqual(["server", "policy"]);
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.refetchInterval).toBeUndefined();
  });

  it("explains a guarded override with stored and effective values", () => {
    const html = renderToStaticMarkup(<CediaCreditPolicyPanel answer={{ state: "available", answer: policy }} />);
    const text = renderedText(html);

    expect(text).toContain("Stored Codex reset setting: yes");
    expect(text).toContain("Effective in this Cedia process: no");
    expect(text).toContain("Cedia's active guard is why they differ");
    expect(text).toContain(policy.reason);
  });

  it("says when the owner's no setting applies and Cedia agrees", () => {
    const answer: CediaPolicyAnswer = {
      state: "available",
      answer: {
        guardActive: true,
        stored: "no",
        effective: "no",
        overridden: false,
        reason: "The stored value is already no.",
      },
    };
    const html = renderToStaticMarkup(<CediaCreditPolicyPanel answer={answer} />);
    const text = renderedText(html);

    expect(text).toContain("The stored value applies, and Cedia agrees with it");
    expect(text).toContain("Stored Codex reset setting: no");
    expect(text).toContain("Effective in this Cedia process: no");
  });

  it("explains an unguarded process without claiming a Cedia guard", () => {
    const html = renderToStaticMarkup(<CediaCreditPolicyPanel answer={{
      state: "available",
      answer: {
        guardActive: false,
        stored: "yes",
        effective: "yes",
        overridden: false,
        reason: "No Cedia credit guard is set for this process.",
      },
    }} />);
    const text = renderedText(html);

    expect(text).toContain("No Cedia guard is set for this process, so OMP's own setting applies");
    expect(text).toContain("Effective in this process: yes");
    expect(text).not.toContain("Effective in this Cedia process");
    expect(text).not.toContain("Cedia's active guard is why they differ");
  });

  it("shows only the host reason when policy is unavailable", () => {
    const html = renderToStaticMarkup(<CediaCreditPolicyPanel answer={{
      state: "unavailable",
      reason: "OMP runtime is stopped",
    }} />);

    expect(html).toContain("OMP runtime is stopped");
    expect(html).not.toContain("Stored Codex reset setting");
    expect(html).not.toContain("Effective in this Cedia process");
    expect(html).not.toContain("Cedia's active guard");
  });
});
