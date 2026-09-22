import { describe, expect, test } from "bun:test";
import { CediaApi, CediaHostError } from "../core/api.ts";
import { modelOptionSelectable } from "../core/composer-honesty.ts";
import { createInitialMobileState, reduceMobileState } from "../core/state.ts";
import type { ClientTransport } from "../core/transport.ts";

interface HostReply {
  readonly status: number;
  readonly body: unknown;
}

/**
 * A host that serves exactly the routes it is given. Use it to pin that a catalog read
 * needs no session: anything the phone asks for beyond these routes throws, so a read
 * that secretly went through `/v1/sessions/...` or started a session fails loudly.
 */
function catalogHost(replies: Record<string, HostReply>): { api: CediaApi; requests: string[] } {
  const requests: string[] = [];
  const transport: ClientTransport = {
    request: async (method, path) => {
      requests.push(`${method} ${path}`);
      const reply = replies[`${method} ${path}`];
      if (!reply) throw new Error(`the phone called ${method} ${path}, which this host does not serve`);
      return reply;
    },
  };
  return { api: new CediaApi({ transport }), requests };
}

const OMP_CATALOG = {
  models: [
    { id: "claude-sonnet-4", provider: "anthropic", slug: "anthropic/claude-sonnet-4", name: "Sonnet", label: "Claude Sonnet 4", available: true, contextWindow: 200_000 },
    { id: "gpt-5", provider: "openai", slug: "openai/gpt-5", name: "GPT-5", label: "GPT-5", available: false, reason: "Add an OpenAI API key on the Mac" },
  ],
  source: "omp",
  cached: false,
};

describe("iOS model/provider reads without a session", () => {
  test("lists models from GET /v1/models and hands the screen the picker's rows", async () => {
    const host = catalogHost({ "GET /v1/models": { status: 200, body: OMP_CATALOG } });

    const state = reduceMobileState(createInitialMobileState(), { type: "models", models: await host.api.listModels() });

    expect(state.models).toEqual([
      { id: "claude-sonnet-4", provider: "anthropic", label: "Claude Sonnet 4", available: true },
      { id: "gpt-5", provider: "openai", label: "GPT-5", available: false, reason: "Add an OpenAI API key on the Mac" },
    ]);
    expect(state.session).toBeNull();
    expect(state.connection).toBe("offline");
    expect(host.requests).toEqual(["GET /v1/models"]);
    expect(host.requests.some(request => request.includes("/v1/sessions"))).toBe(false);

    // The picker's own gates: only rows OMP advertised as available can be chosen, and
    // a refused row keeps the reason instead of becoming a blank entry.
    expect(modelOptionSelectable(state.models[0]!)).toBe(true);
    expect(modelOptionSelectable(state.models[1]!)).toBe(false);
  });

  test("lists OMP providers from GET /v1/providers without a session", async () => {
    const host = catalogHost({
      "GET /v1/providers": {
        status: 200,
        body: {
          providers: [
            { id: "anthropic", name: "Anthropic", methods: ["oauth"], available: true, authenticated: true, credentialKinds: ["oauth"] },
            { id: "openai", name: "OpenAI", methods: ["api_key"], available: false, authenticated: false, credentialKinds: [] },
          ],
        },
      },
    });

    const state = reduceMobileState(createInitialMobileState(), { type: "login_providers", providers: await host.api.listLoginProviders() });

    expect(state.loginProviders).toEqual([
      { id: "anthropic", name: "Anthropic", available: true, authenticated: true },
      { id: "openai", name: "OpenAI", available: false, authenticated: false },
    ]);
    expect(state.session).toBeNull();
    expect(host.requests).toEqual(["GET /v1/providers"]);
    expect(host.requests.some(request => request.includes("/v1/sessions"))).toBe(false);
  });

  test("reports the host's own refusal for a failed read", async () => {
    const host = catalogHost({
      "GET /v1/models": { status: 503, body: { error: { code: "provider_unavailable", message: "OMP did not answer" } } },
      "GET /v1/providers": { status: 401, body: { error: { code: "unauthorized", message: "Device credential is missing or revoked" } } },
    });

    const models = await host.api.listModels().then(() => undefined, (reason: unknown) => reason);
    if (!(models instanceof CediaHostError)) throw new Error("a refused model read must fail, not resolve");
    expect(models.status).toBe(503);
    expect(models.code).toBe("provider_unavailable");
    expect(models.message).toBe("OMP did not answer");

    const providers = await host.api.listLoginProviders().then(() => undefined, (reason: unknown) => reason);
    if (!(providers instanceof CediaHostError)) throw new Error("a refused provider read must fail, not resolve");
    expect(providers.status).toBe(401);
    expect(providers.code).toBe("unauthorized");

    // The refusal is reported, and the read did not quietly fall back to a session route.
    expect(host.requests).toEqual(["GET /v1/models", "GET /v1/providers"]);
  });

  test("never turns an unreadable answer into an empty catalogue", async () => {
    const malformedModels = catalogHost({ "GET /v1/models": { status: 200, body: { models: { "gpt-5": true } } } });
    await expect(malformedModels.api.listModels()).rejects.toThrow("invalid models catalog");

    const malformedProviders = catalogHost({ "GET /v1/providers": { status: 200, body: {} } });
    await expect(malformedProviders.api.listLoginProviders()).rejects.toThrow("invalid providers catalog");
  });

  test("keeps an honestly empty catalogue empty", async () => {
    const host = catalogHost({
      "GET /v1/models": { status: 200, body: { models: [], source: "omp", cached: false } },
      "GET /v1/providers": { status: 200, body: { providers: [] } },
    });

    await expect(host.api.listModels()).resolves.toEqual([]);
    await expect(host.api.listLoginProviders()).resolves.toEqual([]);
  });
});
