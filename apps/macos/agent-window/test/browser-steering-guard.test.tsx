import { afterEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadId } from "@synara/contracts";

import {
  BrowserSteeringGuard,
  reconcileBrowserSteering,
} from "../vendor/synara/apps/web/src/components/BrowserSteeringGuard";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const threadId = ThreadId.makeUnsafe("thread-steer");

function deps(calls: string[], endpoint: { attached: boolean; cdpUrl?: string } | Error) {
  return {
    agentEndpoint: async () => {
      calls.push("endpoint");
      if (endpoint instanceof Error) throw endpoint;
      return endpoint;
    },
    setBrowserCdpUrl: async (cdpUrl: string) => {
      calls.push(`steer=${cdpUrl}`);
    },
  };
}

describe("reconcileBrowserSteering", () => {
  it("re-steers to the new thread's live endpoint", async () => {
    const calls: string[] = [];
    const outcome = await reconcileBrowserSteering(
      deps(calls, { attached: true, cdpUrl: "http://127.0.0.1:11111" }),
      { split: false },
      threadId,
    );
    expect(outcome).toBe("steered");
    expect(calls).toEqual(["endpoint", "steer=http://127.0.0.1:11111"]);
  });

  it("clears steering when the new thread has nothing attached", async () => {
    const calls: string[] = [];
    const outcome = await reconcileBrowserSteering(deps(calls, { attached: false }), { split: false }, threadId);
    expect(outcome).toBe("cleared");
    expect(calls).toEqual(["endpoint", "steer="]);
  });

  it("always clears in split view, without even asking the endpoint", async () => {
    const calls: string[] = [];
    const outcome = await reconcileBrowserSteering(
      deps(calls, { attached: true, cdpUrl: "http://127.0.0.1:11111" }),
      { split: true },
      threadId,
    );
    expect(outcome).toBe("cleared");
    expect(calls).toEqual(["steer="]);
  });

  it("clears instead of steering when the relay voids the endpoint", async () => {
    const calls: string[] = [];
    const outcome = await reconcileBrowserSteering(
      {
        ...deps(calls, { attached: true, cdpUrl: "http://127.0.0.1:11111" }),
        readBackendSelection: async () => ({ relay: true, enabled: true }),
      },
      { split: false },
      threadId,
    );
    expect(outcome).toBe("cleared");
    expect(calls).toEqual(["endpoint", "steer="]);
  });

  it("clears instead of steering when browser tools are disabled", async () => {
    const calls: string[] = [];
    const outcome = await reconcileBrowserSteering(
      {
        ...deps(calls, { attached: true, cdpUrl: "http://127.0.0.1:11111" }),
        readBackendSelection: async () => ({ relay: false, enabled: false }),
      },
      { split: false },
      threadId,
    );
    expect(outcome).toBe("cleared");
    expect(calls).toEqual(["endpoint", "steer="]);
  });

  it("steers when the backend selection cannot be read", async () => {
    const calls: string[] = [];
    const outcome = await reconcileBrowserSteering(
      {
        ...deps(calls, { attached: true, cdpUrl: "http://127.0.0.1:11111" }),
        readBackendSelection: async () => {
          throw new Error("settings down");
        },
      },
      { split: false },
      threadId,
    );
    expect(outcome).toBe("steered");
    expect(calls).toEqual(["endpoint", "steer=http://127.0.0.1:11111"]);
  });

  it("leaves steering untouched when the endpoint cannot be read", async () => {
    const calls: string[] = [];
    const outcome = await reconcileBrowserSteering(deps(calls, new Error("gone")), { split: false }, threadId);
    expect(outcome).toBe("untouched");
    expect(calls).toEqual(["endpoint"]);
  });
});

describe("BrowserSteeringGuard", () => {
  it("renders nothing", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    expect(renderToStaticMarkup(<BrowserSteeringGuard threadId={threadId} split={false} />)).toBe("");
  });
});
