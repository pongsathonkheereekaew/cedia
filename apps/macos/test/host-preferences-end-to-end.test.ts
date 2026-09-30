import { afterEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHostServer } from "../../host/src/server.ts";
import { createAgentWindowHandler } from "../src/agent-window-main.ts";

// The renderer half: the vendor settings store, written the way the app writes it.
import { AppSettingsSchema, DEFAULT_APP_SETTINGS, APP_SETTINGS_STORAGE_KEY } from "../agent-window/vendor/synara/apps/web/src/appSettings";
import { installHostPreferenceSync } from "../agent-window/vendor/synara/apps/web/src/hostPreferences";
import {
  LOCAL_STORAGE_CHANGE_EVENT,
  getLocalStorageItem,
  notifyLocalStorageChange,
  setLocalStorageItem,
} from "../agent-window/vendor/synara/apps/web/src/hooks/useLocalStorage";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let dispose: (() => void) | undefined;

function setupWindow() {
  const listeners = new Set<EventListener>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    addEventListener: (type: string, listener: EventListener) => { if (type === LOCAL_STORAGE_CHANGE_EVENT) listeners.add(listener); },
    removeEventListener: (type: string, listener: EventListener) => { listeners.delete(listener); },
    dispatchEvent: (event: Event) => { for (const listener of listeners) listener(event); return true; },
    setTimeout, clearTimeout,
  } });
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

it("carries a window's setting change to the real host over the real main-process handler", async () => {
  setupWindow();
  const stateDir = await mkdtemp(join(tmpdir(), "cedia-host-prefs-"));
  const server = await startHostServer({ stateDir });
  const owner = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${server.descriptor.url}/v1${path}`, {
      method,
      headers: owner,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}`);
    return await response.json();
  };
  const handler = createAgentWindowHandler({
    stateDir,
    authorize: () => true,
    ensure: async () => {},
    request: request as never,
    pickFolder: async () => null,
    openIde: async () => {},
    openExternal: async () => {},
  });
  try {
    setLocalStorageItem(APP_SETTINGS_STORAGE_KEY, { ...DEFAULT_APP_SETTINGS, uiDensity: "comfortable" }, AppSettingsSchema);
    const bridge = installHostPreferenceSync({ invoke: async (_channel, input) => await handler(null, input) });
    dispose = bridge.dispose;
    expect(await bridge.hydrate()).toBe("unchanged");

    // The user moves the control: the app writes its own store and raises its own change signal.
    setLocalStorageItem(APP_SETTINGS_STORAGE_KEY, { ...DEFAULT_APP_SETTINGS, uiDensity: "spacious" }, AppSettingsSchema);
    notifyLocalStorageChange(APP_SETTINGS_STORAGE_KEY);
    await bridge.flush();

    const stored = await request("GET", "/settings") as { revision: number; values: Record<string, unknown> };
    expect(stored.revision).toBeGreaterThanOrEqual(1);
    expect(stored.values.uiDensity).toBe("spacious");
    expect(bridge.unsaved()).toEqual([]);
    // The window's own store still shows what the user chose.
    expect((getLocalStorageItem(APP_SETTINGS_STORAGE_KEY, AppSettingsSchema) as { uiDensity?: string })?.uiDensity).toBe("spacious");
  } finally {
    await server.close();
    await rm(stateDir, { recursive: true, force: true });
  }
});
