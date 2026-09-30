/**
 * Cedia's credit policy as the host reads it (plan §2.8).
 *
 * The guard itself runs inside the runtime; these fixtures cover the boundary Cedia owns: the
 * answer is parsed strictly (a half-parsed policy could show "off" for a session that is not
 * guarded), an absent bridge is an honest absence, and the route that publishes it is owner-only.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CediaHost } from "../src/service.ts";
import { createRouter } from "../src/router.ts";
import { DeviceAuth } from "../src/auth.ts";
import { DurableStore } from "../src/store.ts";
import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";
import {
  OmpPolicyValidationError,
  parseOmpCreditPolicy,
  readOmpCreditPolicy,
  type OmpPolicyClient,
} from "../src/omp-policy.ts";

const POLICY = {
  guardActive: true,
  stored: "yes" as const,
  effective: "no" as const,
  overridden: true,
  reason: "Cedia never spends a saved reset on its own.",
};

/** A client that answers one fixture result, or fails the way a runtime without the bridge does. */
function fixtureClient(result: unknown, error?: Error): OmpPolicyClient {
  return {
    requestCedia: async () => {
      if (error) throw error;
      return { data: { result } } as never;
    },
  } as unknown as OmpPolicyClient;
}

describe("OMP credit policy parser", () => {
  it("accepts the runtime's answer and keeps every field it needs", () => {
    expect(parseOmpCreditPolicy(POLICY)).toEqual(POLICY);
  });

  it("refuses a shape that could show a guard the runtime never claimed", () => {
    expect(() => parseOmpCreditPolicy(null)).toThrow(OmpPolicyValidationError);
    expect(() => parseOmpCreditPolicy({ ...POLICY, guardActive: "yes" })).toThrow(OmpPolicyValidationError);
    expect(() => parseOmpCreditPolicy({ ...POLICY, overridden: undefined })).toThrow(OmpPolicyValidationError);
    expect(() => parseOmpCreditPolicy({ ...POLICY, reason: "" })).toThrow(OmpPolicyValidationError);
    expect(() => parseOmpCreditPolicy({ ...POLICY, stored: "maybe" })).toThrow(OmpPolicyValidationError);
    expect(() => parseOmpCreditPolicy({ ...POLICY, effective: "maybe" })).toThrow(OmpPolicyValidationError);
  });

  it("answers the policy through the registered operation", async () => {
    expect(await readOmpCreditPolicy(fixtureClient(POLICY))).toEqual(POLICY);
  });

  it("reports an absent bridge as an absence instead of assuming a guard", async () => {
    const missing = new OmpClientStateError("no runtime");
    expect(await readOmpCreditPolicy(fixtureClient(undefined, missing))).toBeUndefined();
  });
});

describe("OMP policy route", () => {
  it("answers the live policy for the owner only", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omp-policy-route-"));
    const stateDir = join(directory, "state");
    mkdirSync(stateDir, { recursive: true });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const host = new CediaHost({ store, stateDir });
    try {
      const router = createRouter(host, auth, {
        ompPolicy: async () => ({ state: "available" as const, answer: POLICY }),
      });
      const answered = await router({ method: "GET", path: "/v1/omp/policy", token: auth.ownerToken });
      expect(answered.status).toBe(200);
      expect(answered.body).toMatchObject({
        state: "available",
        answer: { stored: "yes", effective: "no", overridden: true, guardActive: true },
      });

      // No credential at all is refused before any policy is read.
      const anonymous = await router({ method: "GET", path: "/v1/omp/policy" });
      expect(anonymous.status).toBe(401);
    } finally {
      await host.close().catch(() => {});
      store.close();
    }
  });

  it("refuses the route when no policy owner is wired, and is not reachable by another method", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omp-policy-unwired-"));
    const stateDir = join(directory, "state");
    mkdirSync(stateDir, { recursive: true });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const host = new CediaHost({ store, stateDir });
    try {
      const router = createRouter(host, auth);
      const unwired = await router({ method: "GET", path: "/v1/omp/policy", token: auth.ownerToken });
      expect(unwired.status).toBe(503);
      expect(unwired.body).toMatchObject({ error: { code: "omp_policy_unavailable" } });

      const wrongMethod = await router({ method: "POST", path: "/v1/omp/policy", token: auth.ownerToken });
      expect(wrongMethod.status).toBe(404);
    } finally {
      await host.close().catch(() => {});
      store.close();
    }
  });
});
