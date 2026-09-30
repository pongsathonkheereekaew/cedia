import { afterEach, expect, it } from "bun:test";
import { createCediaNativeApi } from "../src/cedia-adapter";
import { parseCapabilitySnapshot } from "../vendor/synara/apps/web/src/capabilityGate";
import { serverCapabilitiesQueryOptions } from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const snapshot = {
  protocolVersion: 1,
  revision: "cedia-capabilities-v1",
  capabilities: [{ id: "app.automations", availability: "integration_missing", scope: "app", reason: "no automation backend", operations: [] }],
};

/** The real adapter over a bridge that only answers the capability route. */
function apiFor(answer: () => unknown, calls: Array<{ method: string; path: string }>) {
  const bridge = {
    invoke: async (_channel: string, request: { kind?: string; method?: string; path?: string }) => {
      if (request.kind === "bootstrap") {
        return { platform: "darwin", homeDir: "/Users/tester", worktreesDir: "/tmp/worktrees", version: "test-host" };
      }
      calls.push({ method: request.method ?? "GET", path: request.path ?? "" });
      if (request.path === "/v1/capabilities") return answer();
      throw new Error(`Unexpected request ${request.path}`);
    },
  };
  const api = createCediaNativeApi({ bridge: bridge as never });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { nativeApi: api } });
  return api;
}

it("reads the host snapshot through the Cedia namespace and the shared query cache", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const api = apiFor(() => snapshot, calls);

  expect(await api.cedia.getCapabilities()).toEqual(snapshot);
  const options = serverCapabilitiesQueryOptions();
  const parsed = await options.queryFn!({} as never);

  expect(parsed).toEqual(parseCapabilitySnapshot(snapshot));
  expect(calls).toEqual([{ method: "GET", path: "/v1/capabilities" }, { method: "GET", path: "/v1/capabilities" }]);
});

it("leaves every row unknown when the host cannot answer", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  apiFor(() => { throw new Error("host unreachable"); }, calls);
  const options = serverCapabilitiesQueryOptions();

  expect(await options.queryFn!({} as never)).toBeUndefined();
});
