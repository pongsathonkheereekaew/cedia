import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import { tagCediaHostErrorMessage } from "../src/host-error-codes.ts";
import {
  parseCediaAccountsAnswer,
  parseCediaModelStateAnswer,
  parseCediaPinAccountAnswer,
  parseCediaServiceTierAnswer,
  serverAccountsQueryOptions,
  serverModelStateQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

type Request = {
  kind: "request";
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

const modelState = {
  available: true as const,
  model: { provider: "openai", id: "gpt-5" },
  effort: { configured: "high", autoResolved: null, isAuto: false },
  serviceTiers: {
    families: ["codex"],
    tiers: ["standard", "priority"],
    current: [{ family: "codex", tier: "priority" }],
  },
};

const accounts = {
  available: true as const,
  supported: true,
  provider: "openai",
  accounts: [
    { credentialId: 7, label: "owner@example.test", active: true },
    { credentialId: 8, label: null, active: false },
  ],
  truncated: false,
};

const accountsProjection = {
  supported: accounts.supported,
  provider: accounts.provider,
  accounts: accounts.accounts,
  truncated: accounts.truncated,
};

function fixtureBridge(answer: unknown = modelState) {
  const calls: Request[] = [];
  return {
    calls,
    bridge: {
      invoke: async (_channel: string, input: Request) => {
        calls.push(input);
        if (input.path === "/v1/sessions/session%2Fstate" || input.path === "/v1/sessions/session%2Faccounts") {
          return {
            id: input.path.endsWith("state") ? "session/state" : "session/accounts",
            projectId: "project",
            cwd: "/workspace",
            sessionFile: "/tmp/session.json",
            incarnation: "inc-7",
            status: "idle",
            archived: false,
            createdAt: "2026-09-24T00:00:00.000Z",
            updatedAt: "2026-09-24T00:00:00.000Z",
          };
        }
        return answer;
      },
    },
  };
}

describe("Cedia O03 model and account adapter", () => {
  it("reads model state and accounts, and fills durable command identity for owner writes", async () => {
    const fixture = fixtureBridge();
    fixture.bridge.invoke = async (_channel: string, input: Request) => {
      fixture.calls.push(input);
      if (input.method === "GET" && input.path === "/v1/sessions/session%2Fstate/model-state") return modelState;
      if (input.method === "GET" && input.path === "/v1/sessions/session%2Faccounts/accounts") return accounts;
      if (input.method === "GET" && input.path === "/v1/sessions/session-write") {
        return {
          id: "session-write",
          projectId: "project",
          cwd: "/workspace",
          sessionFile: "/tmp/session.json",
          incarnation: "inc-write",
          status: "idle",
          archived: false,
          createdAt: "2026-09-24T00:00:00.000Z",
          updatedAt: "2026-09-24T00:00:00.000Z",
        };
      }
      return { pinned: true, list: accountsProjection };
    };
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await api.cedia.getModelState("session/state");
    await api.cedia.getAccounts("session/accounts");
    await api.cedia.pinAccount("session-write", 8);
    await api.cedia.setServiceTier("session-write", "codex", null);

    expect(fixture.calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/sessions/session%2Fstate/model-state" },
      { kind: "request", method: "GET", path: "/v1/sessions/session%2Faccounts/accounts" },
      { kind: "request", method: "GET", path: "/v1/sessions/session-write" },
      {
        kind: "request",
        method: "POST",
        path: "/v1/sessions/session-write/accounts/pin",
        body: { commandId: expect.any(String), incarnation: "inc-write", credentialId: 8 },
      },
      { kind: "request", method: "GET", path: "/v1/sessions/session-write" },
      {
        kind: "request",
        method: "POST",
        path: "/v1/sessions/session-write/service-tier",
        body: { commandId: expect.any(String), incarnation: "inc-write", family: "codex", tier: null },
      },
    ]);
  });

  it("preserves a typed owner refusal for account pinning", async () => {
    const fixture = fixtureBridge();
    fixture.bridge.invoke = async () => {
      throw new Error(tagCediaHostErrorMessage("CEDIA_ACCOUNT_PIN_REFUSED", "Only the owner may pin an account"));
    };
    const api = createCediaNativeApi({ bridge: fixture.bridge });

    await expect(api.cedia.pinAccount("session-write", 8)).rejects.toMatchObject({
      name: "CediaHostError",
      code: "CEDIA_ACCOUNT_PIN_REFUSED",
      message: "Only the owner may pin an account",
    });
  });
});

describe("Cedia O03 model and account parsers", () => {
  it("keeps null model and effort values explicit, including auto-resolved effort", () => {
    expect(parseCediaModelStateAnswer({
      ...modelState,
      model: null,
      effort: { configured: null, autoResolved: "high", isAuto: true },
    })).toEqual({
      ...modelState,
      model: null,
      effort: { configured: null, autoResolved: "high", isAuto: true },
    });
  });

  it("distinguishes unsupported accounts from an empty supported list", () => {
    expect(parseCediaAccountsAnswer({ ...accounts, supported: false, accounts: [] })).toMatchObject({ supported: false, accounts: [] });
    expect(parseCediaAccountsAnswer({ ...accounts, accounts: [] })).toMatchObject({ supported: true, accounts: [] });
    expect(() => parseCediaAccountsAnswer({ ...accounts, accounts: [{ credentialId: 1, label: "x" }] })).toThrow();
    expect(() => parseCediaAccountsAnswer({ ...accounts, accounts: [{ credentialId: -1, label: null, active: false }] })).toThrow();
  });

  it("rejects malformed model state and mutation projections", () => {
    expect(() => parseCediaModelStateAnswer({ ...modelState, effort: { configured: "high", autoResolved: null } })).toThrow();
    expect(() => parseCediaModelStateAnswer({ ...modelState, serviceTiers: { ...modelState.serviceTiers, current: [{ family: "codex" }] } })).toThrow();
    expect(parseCediaPinAccountAnswer({ pinned: true, list: accountsProjection })).toEqual({ pinned: true, list: accountsProjection });
    expect(parseCediaServiceTierAnswer({ family: "codex", tier: null, serviceTiers: modelState.serviceTiers })).toEqual({
      family: "codex",
      tier: null,
      serviceTiers: modelState.serviceTiers,
    });
    expect(() => parseCediaPinAccountAnswer({ pinned: true, list: { ...accounts, accounts: [{ credentialId: 1 }] } })).toThrow();
    expect(() => parseCediaServiceTierAnswer({ family: "codex", tier: "bad", serviceTiers: modelState.serviceTiers })).toThrow();
  });

  it("keeps host unavailable reasons and avoids a polling interval", () => {
    expect(parseCediaModelStateAnswer({ available: false, reason: "OMP is stopped" })).toEqual({ available: false, reason: "OMP is stopped" });
    expect(parseCediaAccountsAnswer({ available: false, reason: "Accounts require an owner session" })).toEqual({ available: false, reason: "Accounts require an owner session" });
    expect(serverModelStateQueryOptions("session-model").refetchInterval).toBeUndefined();
    expect(serverAccountsQueryOptions("session-accounts").refetchInterval).toBe(false);
  });
});
