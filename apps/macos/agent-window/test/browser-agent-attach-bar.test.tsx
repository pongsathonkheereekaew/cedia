import { afterEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadId } from "@synara/contracts";

import {
  BrowserAgentAttachBar,
  attachBrowserTabForAgent,
  browserDisabledWarning,
  detachBrowserTabsForAgent,
  steeringConflictWarning,
} from "../vendor/synara/apps/web/src/components/BrowserAgentAttachBar";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const threadId = ThreadId.makeUnsafe("thread-attach");

function capableBridge(calls: string[]) {
  return {
    browser: {
      agentAttach: async (input: { tabId: string }) => {
        calls.push(`attach:${input.tabId}`);
        return { cdpUrl: "http://127.0.0.1:19999", tabId: input.tabId };
      },
      agentDetach: async () => {
        calls.push("detach");
        return { attached: false };
      },
      agentEndpoint: async () => ({ attached: false, tabs: [] }),
    },
    dialogs: { confirm: async () => true },
    cedia: {
      setOmpSetting: async (input: { path: string; value: unknown }) => {
        calls.push(`steer:${input.path}=${String(input.value)}`);
        return { state: "available", path: input.path, value: input.value };
      },
    },
  };
}

describe("BrowserAgentAttachBar", () => {
  it("renders nothing without a capable bridge", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    const html = renderToStaticMarkup(<BrowserAgentAttachBar threadId={threadId} activeTabId="tab-1" />);
    expect(html).toBe("");
  });

  it("renders attach affordance and off state with a capable bridge", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { nativeApi: capableBridge([]) } });
    const html = renderToStaticMarkup(<BrowserAgentAttachBar threadId={threadId} activeTabId="tab-1" />);
    expect(html).toContain('aria-label="Attach active tab for agent driving"');
    expect(html).toContain("Agent driving off");
  });

  it("attaches then steers the runtime, and detaches then clears steering", async () => {
    const calls: string[] = [];
    const deps = {
      agentAttach: capableBridge(calls).browser.agentAttach,
      agentDetach: capableBridge(calls).browser.agentDetach,
      setBrowserCdpUrl: async (cdpUrl: string) => {
        calls.push(`steer=browser.cdpUrl=${cdpUrl}`);
      },
      confirm: async () => true,
    };
    expect(await attachBrowserTabForAgent(deps, threadId, "tab-1")).toBe(true);
    expect(await detachBrowserTabsForAgent(deps, threadId)).toBe(true);
    expect(calls).toEqual([
      "attach:tab-1",
      "steer=browser.cdpUrl=http://127.0.0.1:19999",
      "detach",
      "steer=browser.cdpUrl=",
    ]);
  });

  it("does nothing when the confirm is declined", async () => {
    const calls: string[] = [];
    const deps = {
      agentAttach: async () => { calls.push("attach"); return { cdpUrl: "x", tabId: "t" }; },
      agentDetach: async () => { calls.push("detach"); return { attached: false }; },
      setBrowserCdpUrl: async () => { calls.push("steer"); },
      confirm: async () => false,
    };
    expect(await attachBrowserTabForAgent(deps, threadId, "tab-1")).toBe(false);
    expect(await detachBrowserTabsForAgent(deps, threadId)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("steeringConflictWarning", () => {
  it("warns only when the relay is on", () => {
    expect(steeringConflictWarning(true)).toContain("takes precedence");
    expect(steeringConflictWarning(false)).toBeNull();
    expect(steeringConflictWarning(undefined)).toBeNull();
    expect(steeringConflictWarning("true")).toBeNull();
  });

  it("prepends the warning to the attach confirm", async () => {
    const seen: string[] = [];
    const deps = {
      agentAttach: async () => ({ cdpUrl: "http://127.0.0.1:1", tabId: "t" }),
      agentDetach: async () => ({ attached: false }),
      setBrowserCdpUrl: async () => {},
      confirm: async (message: string) => {
        seen.push(message);
        return false;
      },
      confirmPreamble: "Relay on.",
    };
    expect(await attachBrowserTabForAgent(deps, threadId, "t")).toBe(false);
    expect(seen).toEqual(["Relay on. Attach this tab for agent driving? OMP browser tools will attach to it instead of launching a browser. Detach when done."]);
  });
});

describe("browserDisabledWarning", () => {
  it("warns only when browser tools are disabled", () => {
    expect(browserDisabledWarning(false)).toContain("will not drive");
    expect(browserDisabledWarning(true)).toBeNull();
    expect(browserDisabledWarning(undefined)).toBeNull();
    expect(browserDisabledWarning("false")).toBeNull();
  });
});
