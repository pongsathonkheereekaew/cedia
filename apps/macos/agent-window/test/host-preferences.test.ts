import { afterEach, expect, it } from "bun:test";
import { AppSettingsSchema, DEFAULT_APP_SETTINGS, APP_SETTINGS_STORAGE_KEY } from "../vendor/synara/apps/web/src/appSettings";
import {
  applyHostPreferences,
  installHostPreferenceSync,
  pendingHostPatch,
  preferencePatchFromHost,
} from "../vendor/synara/apps/web/src/hostPreferences";
import { getLocalStorageItem, removeLocalStorageItem, setLocalStorageItem } from "../vendor/synara/apps/web/src/hooks/useLocalStorage";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let dispose: (() => void) | undefined;

interface FakeWindow {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
  dispatchEvent: (event: Event) => boolean;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  listenerCount: (type: string) => number;
  settingsChanges: () => number;
}

function setupWindow(): FakeWindow {
  const listeners = new Map<string, Set<EventListener>>();
  let settingsChanges = 0;
  const fake: FakeWindow = {
    addEventListener: (type, listener) => { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set); },
    removeEventListener: (type, listener) => { listeners.get(type)?.delete(listener); },
    dispatchEvent: (event) => {
      if (event.type === "synara:local_storage_change") settingsChanges += 1;
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
    setTimeout,
    clearTimeout,
    listenerCount: type => listeners.get(type)?.size ?? 0,
    settingsChanges: () => settingsChanges,
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

function transportWith(handler: (input: Record<string, unknown>) => unknown) {
  const calls: Array<Record<string, unknown>> = [];
  const listeners = new Map<string, Array<(event: unknown, ...args: unknown[]) => void>>();
  return {
    calls,
    invoke: async (_channel: string, input?: unknown) => {
      const request = input as Record<string, unknown>;
      calls.push(request);
      return handler(request);
    },
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
    },
    removeListener: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      listeners.set(channel, (listeners.get(channel) ?? []).filter(entry => entry !== listener));
    },
    publish: (channel: string, value: unknown) => {
      for (const listener of listeners.get(channel) ?? []) listener({}, value);
    },
    listenerCount: (channel: string) => (listeners.get(channel) ?? []).length,
  };
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

it("projects only the bound keys the host owns", () => {
  const local = { ...DEFAULT_APP_SETTINGS, uiDensity: "spacious", chatWidth: "full", timestampFormat: "24-hour" } as never;
  // The host's record moves the keys it owns and nothing else.
  expect(preferencePatchFromHost(local, { uiDensity: "compact", chatWidth: "standard", sidebarThreadSortOrder: "created_at", appTheme: "dark" }))
    .toEqual({ uiDensity: "compact", chatWidth: "standard", sidebarThreadSortOrder: "created_at" });
  // A value this window cannot render is not applied, and neither is the theme (the theme publisher owns it).
  expect(preferencePatchFromHost(local, { chatWidth: "enormous", hiddenSidebarNavItems: [1, 2] })).toEqual({});
  expect(preferencePatchFromHost(local, { uiDensity: "spacious" })).toEqual({});
});

it("takes the host's record into the window's own settings store and leaves the rest alone", () => {
  setupWindow();
  seedLocal({ uiDensity: "spacious", timestampFormat: "24-hour" });
  expect(applyHostPreferences({ revision: 2, values: { uiDensity: "compact", chatWidth: "wide" } })).toBe("applied");
  expect(readLocal()).toMatchObject({ uiDensity: "compact", chatWidth: "wide", timestampFormat: "24-hour" });
  expect(applyHostPreferences({ revision: 2, values: { uiDensity: "compact", chatWidth: "wide" } })).toBe("unchanged");
});

it("hydrates a fresh profile with no stored entry instead of throwing", () => {
  setupWindow();
  removeLocalStorageItem(APP_SETTINGS_STORAGE_KEY);
  expect(applyHostPreferences({ revision: 1, values: { uiDensity: "compact" } })).toBe("applied");
  expect(readLocal()).toMatchObject({ uiDensity: "compact", chatWidth: DEFAULT_APP_SETTINGS.chatWidth });
});

it("groups what this window holds by the host's own category", () => {
  const local = { ...DEFAULT_APP_SETTINGS, uiDensity: "compact", hiddenSidebarNavItems: ["automations"], enableAssistantStreaming: false } as never;
  const snapshot = { revision: 1, values: { uiDensity: "spacious", hiddenSidebarNavItems: [], enableAssistantStreaming: true } };
  expect(pendingHostPatch(local, snapshot)).toEqual([
    { category: "appearance", patch: { uiDensity: "compact" } },
    { category: "layout", patch: { hiddenSidebarNavItems: ["automations"] } },
    { category: "composer", patch: { enableAssistantStreaming: false } },
  ]);
  expect(pendingHostPatch({ ...local, uiDensity: "spacious", hiddenSidebarNavItems: [], enableAssistantStreaming: true } as never, snapshot)).toEqual([]);
});

it("sends this window's change with the revision it read, and only for keys the host owns", async () => {
  setupWindow();
  seedLocal({ uiDensity: "spacious" });
  const transport = transportWith(input => {
    if (input.action === "read") return { revision: 3, values: { uiDensity: "spacious" } };
    return { status: "saved", revision: 4, values: { uiDensity: "compact" } };
  });
  const bridge = installHostPreferenceSync(transport);
  dispose = bridge.dispose;
  expect(await bridge.hydrate()).toBe("unchanged");
  expect(bridge.revision()).toBe(3);

  seedLocal({ uiDensity: "compact" });
  await bridge.flush();
  expect(transport.calls.filter(call => call.action === "write")).toEqual([
    { kind: "uiSettings", action: "write", expectedRevision: 3, category: "appearance", patch: { uiDensity: "compact" } },
  ]);
  expect(bridge.revision()).toBe(4);
  expect(bridge.unsaved()).toEqual([]);

  // A key the host does not own never becomes a host write.
  seedLocal({ uiDensity: "compact", timestampFormat: "24-hour" });
  await bridge.flush();
  expect(transport.calls.filter(call => call.action === "write")).toHaveLength(1);
});

it("drains pending appearance, layout, and composer changes without clobbering later categories", async () => {
  setupWindow();
  seedLocal({ uiDensity: "spacious", sidebarThreadSortOrder: "updated_at", composerEffortSlider: true });
  let revision = 4;
  const values: Record<string, unknown> = {
    uiDensity: "spacious",
    sidebarThreadSortOrder: "updated_at",
    composerEffortSlider: true,
  };
  const transport = transportWith(input => {
    if (input.action === "read") return { revision, values: { ...values } };
    Object.assign(values, input.patch);
    revision += 1;
    return { status: "saved", revision, values: { ...values } };
  });
  const bridge = installHostPreferenceSync(transport);
  dispose = bridge.dispose;
  await bridge.hydrate();

  seedLocal({ uiDensity: "compact", sidebarThreadSortOrder: "created_at", composerEffortSlider: false });
  await bridge.flush();

  expect(transport.calls.filter(call => call.action === "write").map(call => call.category)).toEqual([
    "appearance",
    "layout",
    "composer",
  ]);
  expect(readLocal()).toMatchObject({
    uiDensity: "compact",
    sidebarThreadSortOrder: "created_at",
    composerEffortSlider: false,
  });
  expect(bridge.unsaved()).toEqual([]);
  expect(bridge.status()).toBe("ready");
});

it("applies the other window's committed revision when the main process publishes it", async () => {
  const fake = setupWindow();
  seedLocal({ uiDensity: "spacious" });
  const transport = transportWith(() => ({ revision: 1, values: { uiDensity: "spacious" } }));
  const bridge = installHostPreferenceSync(transport);
  dispose = bridge.dispose;
  await bridge.hydrate();

  transport.publish("vscode:cedia-settings-updated", { revision: 2, values: { uiDensity: "compact", chatWidth: "full" } });
  expect(readLocal()).toMatchObject({ uiDensity: "compact", chatWidth: "full" });
  expect(bridge.revision()).toBe(2);

  // An older publication is not news, and the window raised the same change signal it raises for
  // its own writes so every mounted settings control re-reads.
  const before = fake.settingsChanges();
  transport.publish("vscode:cedia-settings-updated", { revision: 1, values: { uiDensity: "spacious" } });
  expect(readLocal()).toMatchObject({ uiDensity: "compact" });
  expect(fake.settingsChanges()).toBe(before);
});

it("keeps this window's change and adopts the other window's when the host refuses a stale revision", async () => {
  setupWindow();
  seedLocal({ uiDensity: "spacious", chatWidth: "standard" });
  let revision = 1;
  const values: Record<string, unknown> = { uiDensity: "spacious", chatWidth: "standard" };
  let conflicts = 1;
  // The main process answers a stale write with the record that won, exactly as the host's own 409
  // is translated for the draft routes; the window never has to parse an error string.
  const transport = transportWith(input => {
    if (input.action === "read") return { revision, values: { ...values } };
    if (conflicts > 0) {
      conflicts -= 1;
      revision = 2;
      values.uiDensity = "comfortable";
      // The other window also changed a key this one did not touch.
      values.chatWidth = "full";
      return { status: "conflict", revision, values: { ...values } };
    }
    revision += 1;
    Object.assign(values, input.patch);
    return { status: "saved", revision, values: { ...values } };
  });
  const bridge = installHostPreferenceSync(transport);
  dispose = bridge.dispose;
  await bridge.hydrate();
  expect(bridge.revision()).toBe(1);

  seedLocal({ uiDensity: "compact", chatWidth: "standard" });
  await bridge.flush();
  expect(transport.calls.map(call => call.action)).toEqual(["read", "write", "write"]);
  expect(transport.calls.filter(call => call.action === "write").map(call => call.expectedRevision)).toEqual([1, 2]);
  // The refused write was re-sent on top of the winning revision, so the user's own action stands...
  expect(readLocal()).toMatchObject({ uiDensity: "compact", chatWidth: "full" });
  expect(bridge.unsaved()).toEqual([]);
  expect(bridge.revision()).toBe(3);
});

it("keeps a change it could not save visible instead of reporting it as saved", async () => {
  setupWindow();
  seedLocal({ uiDensity: "spacious" });
  const transport = transportWith(input => {
    if (input.action === "read") return { revision: 2, values: { uiDensity: "comfortable" } };
    return { status: "conflict", revision: 2, values: { uiDensity: "comfortable" } };
  });
  const bridge = installHostPreferenceSync(transport);
  dispose = bridge.dispose;
  await bridge.hydrate();

  seedLocal({ uiDensity: "compact" });
  await bridge.flush();
  expect(bridge.unsaved()).toEqual(["uiDensity"]);
  expect(bridge.status()).toBe("conflict");
  expect(readLocal()).toMatchObject({ uiDensity: "compact" });
});

it("is unavailable, not destructive, when the host cannot answer", async () => {
  setupWindow();
  seedLocal({ uiDensity: "spacious" });
  const bridge = installHostPreferenceSync({ invoke: async () => { throw new Error("no host"); } });
  dispose = bridge.dispose;
  expect(await bridge.hydrate()).toBe("unavailable");
  expect(bridge.status()).toBe("unavailable");
  expect(readLocal()).toMatchObject({ uiDensity: "spacious" });
});

it("stops listening when the renderer is torn down", async () => {
  const fake = setupWindow();
  const transport = transportWith(() => ({ revision: 1, values: {} }));
  const bridge = installHostPreferenceSync(transport);
  bridge.dispose();
  transport.publish("vscode:cedia-settings-updated", { revision: 2, values: { uiDensity: "compact" } });
  expect(fake.listenerCount("synara:local_storage_change")).toBe(0);
  expect(transport.listenerCount("vscode:cedia-settings-updated")).toBe(0);
});
