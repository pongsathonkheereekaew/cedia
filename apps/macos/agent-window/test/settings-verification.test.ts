import { afterEach, describe, expect, it } from "bun:test";

import {
  AppSettingsSchema,
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
} from "../vendor/synara/apps/web/src/appSettings";
import {
  installHostPreferenceSync,
  type HostPreferenceTransport,
} from "../vendor/synara/apps/web/src/hostPreferences";
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../vendor/synara/apps/web/src/hooks/useLocalStorage";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

interface FakeWindow {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
  dispatchEvent: (event: Event) => boolean;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

function setupWindow(): FakeWindow {
  const listeners = new Map<string, Set<EventListener>>();
  const fake: FakeWindow = {
    addEventListener: (type, listener) => {
      const entries = listeners.get(type) ?? new Set<EventListener>();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent: (event) => {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
    setTimeout,
    clearTimeout,
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fake });
  return fake;
}

function seedLocal(overrides: Record<string, unknown> = {}): void {
  setLocalStorageItem(APP_SETTINGS_STORAGE_KEY, { ...DEFAULT_APP_SETTINGS, ...overrides }, AppSettingsSchema);
}

function readLocal(): Record<string, unknown> {
  return (getLocalStorageItem(APP_SETTINGS_STORAGE_KEY, AppSettingsSchema) ?? {}) as Record<string, unknown>;
}

afterEach(() => {
  removeLocalStorageItem(APP_SETTINGS_STORAGE_KEY);
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("settings verification", () => {
  it("does not overwrite a newer local edit when a host write resolves", async () => {
    setupWindow();
    seedLocal({ uiDensity: "spacious" });

    let resolveWrite: ((value: unknown) => void) | undefined;
    let writeCount = 0;
    let writeStarted: (() => void) | undefined;
    const writeCalled = new Promise<void>((resolve) => { writeStarted = resolve; });
    const transport: HostPreferenceTransport = {
      invoke: async (_channel, input) => {
        const request = input as { action?: string };
        if (request.action === "read") return { revision: 1, values: { uiDensity: "spacious" } };
        writeCount += 1;
        if (writeCount === 1) {
          writeStarted?.();
          return await new Promise<unknown>((resolve) => { resolveWrite = resolve; });
        }
        const patch = (request as { patch?: Record<string, unknown> }).patch ?? {};
        return { status: "saved", revision: 3, values: { uiDensity: patch.uiDensity ?? "comfortable" } };
      },
    };
    const bridge = installHostPreferenceSync(transport);
    await bridge.hydrate();

    seedLocal({ uiDensity: "compact" });
    const firstFlush = bridge.flush();
    await writeCalled;

    // This edit happens while the host is still acknowledging the previous one.
    seedLocal({ uiDensity: "comfortable" });
    resolveWrite?.({ status: "saved", revision: 2, values: { uiDensity: "compact" } });
    await firstFlush;

    bridge.dispose();
    expect(readLocal()).toMatchObject({ uiDensity: "comfortable" });
  });

  it("keeps an intentional revert when another window publishes during a write", async () => {
    setupWindow();
    seedLocal({ uiDensity: "spacious" });

    const listeners = new Map<string, Array<(event: unknown, ...args: unknown[]) => void>>();
    const calls: Array<Record<string, unknown>> = [];
    let resolveWrite: ((value: unknown) => void) | undefined;
    let writeStarted: (() => void) | undefined;
    let writeCount = 0;
    const writeCalled = new Promise<void>((resolve) => { writeStarted = resolve; });
    const transport: HostPreferenceTransport = {
      invoke: async (_channel, input) => {
        const request = input as Record<string, unknown>;
        calls.push(request);
        if (request.action === "read") return { revision: 1, values: { uiDensity: "spacious" } };
        writeCount += 1;
        if (writeCount === 1) {
          writeStarted?.();
          return await new Promise<unknown>((resolve) => { resolveWrite = resolve; });
        }
        return { status: "saved", revision: 3, values: { uiDensity: "spacious" } };
      },
      on: (channel, listener) => {
        listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
      },
      removeListener: (channel, listener) => {
        listeners.set(channel, (listeners.get(channel) ?? []).filter(entry => entry !== listener));
      },
    };
    const publish = (channel: string, value: unknown) => {
      for (const listener of listeners.get(channel) ?? []) listener({}, value);
    };
    const bridge = installHostPreferenceSync(transport);
    await bridge.hydrate();

    seedLocal({ uiDensity: "compact" });
    const flush = bridge.flush();
    await writeCalled;

    publish("vscode:cedia-settings-updated", { revision: 2, values: { uiDensity: "comfortable" } });
    // The user deliberately returns to the value that was present before the in-flight write.
    seedLocal({ uiDensity: "spacious" });
    resolveWrite?.({ status: "conflict", revision: 2, values: { uiDensity: "comfortable" } });
    await flush;

    bridge.dispose();
    expect(calls.filter(call => call.action === "write").map(call => call.patch)).toEqual([
      { uiDensity: "compact" },
      { uiDensity: "spacious" },
    ]);
    expect(readLocal()).toMatchObject({ uiDensity: "spacious" });
  });
  it("does not restart exhausted conflict retries from its own projection events", async () => {
    setupWindow();
    seedLocal({ uiDensity: "spacious" });
    let writes = 0;
    const bridge = installHostPreferenceSync({
      invoke: async (_channel, input) => {
        const request = input as { action?: string };
        if (request.action === "read") return { revision: 1, values: { uiDensity: "spacious" } };
        writes += 1;
        return { status: "conflict", revision: writes + 1, values: { uiDensity: "spacious" } };
      },
    });
    try {
      await bridge.hydrate();
      seedLocal({ uiDensity: "compact" });
      await bridge.flush();
      await new Promise(resolve => setTimeout(resolve, 380));
      expect(writes).toBe(2);
      expect(bridge.status()).toBe("conflict");
      expect(bridge.unsaved()).toContain("uiDensity");
    } finally { bridge.dispose(); }
  });

});
