// FILE: hostPreferences.ts
// Purpose: Make Cedia's host the owner of the CEDIA app-preference subset (CEDIA-PLAN §6.4):
//          one revisioned record per application, projected into the window's own settings store,
//          with the other window learning a committed change instead of each window writing a
//          private copy. Drafts have the same shape (§2.5); this is the settings half.
// Layer: Renderer persistence seam
// Exports: the binding table and the sync installer.

import type { AppSettings } from "./appSettings";
import {
  APP_SETTINGS_STORAGE_KEY,
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  applyLocalAppSettingsPatch,
  normalizeChatFontSizePx,
} from "./appSettings";
import {
  LOCAL_STORAGE_CHANGE_EVENT,
  getLocalStorageItem,
  notifyLocalStorageChange,
  setLocalStorageItem,
  // Relative, like every other root-level module in this tree (`appSettings`, `editorPreferences`):
  // the root typecheck compiles these sources without the vendor `~` alias, and a test that imports
  // this file must not be the reason an alias fails to resolve.
} from "./hooks/useLocalStorage";
import { UI_DENSITY_MODES } from "./lib/appDensity";
import { CHAT_WIDTH_MODES } from "./lib/chatWidth";

const CEDIA_AGENT_CHANNEL = "vscode:cediaAgent";
/** The channel the main process publishes the other Mac window's committed preferences on. */
export const CEDIA_PREFERENCES_UPDATE_CHANNEL = "vscode:cedia-settings-updated";
const WRITE_DEBOUNCE_MS = 160;

/**
 * One key the host owns, and the window's own name for it.
 *
 * The host's vocabulary is the renderer's own (`standard|wide|full`, `updated_at|created_at`,
 * the same density words): §6.4 asks for one key per preference, and a host-only word would be a
 * value no control can produce. Everything outside this table keeps its existing owner - server
 * and provider settings belong to the connected server, and the app theme belongs to the theme
 * publisher - so this sync never becomes a second authority for them.
 */
export interface HostPreferenceBinding {
  readonly hostKey: keyof AppSettings | (string & {});
  readonly appKey: keyof AppSettings & string;
  readonly category: "appearance" | "layout" | "composer";
  readonly isValue: (value: unknown) => boolean;
}

export const HOST_PREFERENCE_BINDINGS: readonly HostPreferenceBinding[] = [
  { hostKey: "uiDensity", appKey: "uiDensity", category: "appearance", isValue: value => typeof value === "string" && (UI_DENSITY_MODES as readonly string[]).includes(value) },
  { hostKey: "chatWidth", appKey: "chatWidth", category: "appearance", isValue: value => typeof value === "string" && (CHAT_WIDTH_MODES as readonly string[]).includes(value) },
  { hostKey: "chatFontSizePx", appKey: "chatFontSizePx", category: "appearance", isValue: value => typeof value === "number" && Number.isFinite(value) },
  { hostKey: "hiddenSidebarNavItems", appKey: "hiddenSidebarNavItems", category: "layout", isValue: value => Array.isArray(value) && value.every(item => typeof item === "string") },
  { hostKey: "sidebarThreadSortOrder", appKey: "sidebarThreadSortOrder", category: "layout", isValue: value => value === "updated_at" || value === "created_at" },
  { hostKey: "composerEffortSlider", appKey: "composerEffortSlider", category: "composer", isValue: value => typeof value === "boolean" },
  { hostKey: "enableAssistantStreaming", appKey: "enableAssistantStreaming", category: "composer", isValue: value => typeof value === "boolean" },
];

export interface HostPreferenceSnapshot {
  readonly revision: number;
  readonly values: Readonly<Record<string, unknown>>;
}

export type HostPreferenceSyncStatus = "unknown" | "ready" | "unavailable" | "conflict";

export interface HostPreferenceTransport {
  invoke: (channel: string, input?: unknown) => Promise<unknown>;
  on?: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
  removeListener?: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
}

export interface HostPreferenceBridge {
  /** Read the host's record and project it into this window. */
  hydrate: () => Promise<"applied" | "unchanged" | "unavailable">;
  /** Write any pending local change now instead of waiting for the debounce. */
  flush: () => Promise<void>;
  /** The revision this window last saw, or 0 before any read. */
  revision: () => number;
  /** Keys this window changed but the host has not confirmed. */
  unsaved: () => readonly string[];
  /** Whether the most recent host read/write was acknowledged. */
  status: () => HostPreferenceSyncStatus;
  dispose: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLocalSettings(): AppSettings {
  try {
    return {
      // A fresh profile has no stored entry: start from the real defaults so the
      // normalizers below never see a partial object with undefined model lists.
      ...DEFAULT_APP_SETTINGS,
      ...(getLocalStorageItem(APP_SETTINGS_STORAGE_KEY, AppSettingsSchema) ?? {}),
    } as AppSettings;
  } catch {
    // A corrupt or undecodable entry is the hook's own fallback case; this sync must not throw.
    return { ...DEFAULT_APP_SETTINGS };
  }
}

function writeLocalSettings(next: AppSettings): void {
  setLocalStorageItem(APP_SETTINGS_STORAGE_KEY, next, AppSettingsSchema);
  notifyLocalStorageChange(APP_SETTINGS_STORAGE_KEY);
}

/** The host's values this window's store does not already show, as an app-settings patch. */
export function preferencePatchFromHost(
  settings: AppSettings,
  values: Readonly<Record<string, unknown>>,
): Partial<AppSettings> {
  const patch: Record<string, unknown> = {};
  for (const binding of HOST_PREFERENCE_BINDINGS) {
    const value = values[binding.hostKey];
    if (value === undefined || !binding.isValue(value)) continue;
    const current = (settings as Record<string, unknown>)[binding.appKey];
    if (JSON.stringify(current ?? null) === JSON.stringify(value)) continue;
    patch[binding.appKey] = value;
  }
  return patch as Partial<AppSettings>;
}

/**
 * Project the host's snapshot into this window.
 *
 * Only the bound keys move, and only when the host's value is one this window can render, so an
 * unclassified or future host value cannot put the window into a state no control can leave.
 */
export function applyHostPreferences(snapshot: HostPreferenceSnapshot): "applied" | "unchanged" {
  const local = readLocalSettings();
  const patch = preferencePatchFromHost(local, snapshot.values);
  if (Object.keys(patch).length === 0) return "unchanged";
  writeLocalSettings(applyLocalAppSettingsPatch(local, patch));
  return "applied";
}

/** The bound keys whose local value the host does not hold yet, grouped by their host category. */
export function pendingHostPatch(
  settings: AppSettings,
  snapshot: HostPreferenceSnapshot,
): ReadonlyArray<{ readonly category: "appearance" | "layout" | "composer"; readonly patch: Readonly<Record<string, unknown>> }> {
  const byCategory = new Map<string, Record<string, unknown>>();
  for (const binding of HOST_PREFERENCE_BINDINGS) {
    const held = snapshot.values[binding.hostKey];
    // A key the host's record does not carry is not one this window may define for it: the host's
    // own default stands, and an older or partial snapshot cannot make a window invent a value.
    if (held === undefined) continue;
    const current = (settings as Record<string, unknown>)[binding.appKey];
    if (current === undefined || !binding.isValue(current)) continue;
    // Both ends share one vocabulary (§6.4), so the same check that guards a host value guards a
    // local one: a word the host would refuse is never sent, and the host stays the contract.
    if (JSON.stringify(held) === JSON.stringify(current)) continue;
    const patch = byCategory.get(binding.category) ?? {};
    patch[binding.hostKey as string] = binding.appKey === "chatFontSizePx" ? normalizeChatFontSizePx(current as number) : current;
    byCategory.set(binding.category, patch);
  }
  return [...byCategory].map(([category, patch]) => ({ category: category as "appearance" | "layout" | "composer", patch }));
}

export function installHostPreferenceSync(transport: HostPreferenceTransport): HostPreferenceBridge {
  let revision = 0;
  let snapshot: HostPreferenceSnapshot = { revision: 0, values: {} };
  let syncStatus: HostPreferenceSyncStatus = "unknown";
  let timer: number | undefined;
  let writing: Promise<void> | undefined;
  let disposed = false;
  let inFlightKeys: readonly string[] = [];
  let projectingHostValues = false;

  const snapshotFrom = (value: unknown): HostPreferenceSnapshot | undefined => {
    if (!isRecord(value)) return undefined;
    const next = value.revision;
    const values = value.values;
    if (typeof next !== "number" || !Number.isSafeInteger(next) || next < 0) return undefined;
    return { revision: next, values: isRecord(values) ? values : {} };
  };

  const read = async (): Promise<HostPreferenceSnapshot | undefined> => {
    try {
      return snapshotFrom(await transport.invoke(CEDIA_AGENT_CHANNEL, { kind: "uiSettings", action: "read" }));
    } catch {
      // A host that cannot answer leaves the window's own values alone rather than resetting them.
      return undefined;
    }
  };

  const adopt = (next: HostPreferenceSnapshot): "applied" | "unchanged" => {
    let result: "applied" | "unchanged";
    projectingHostValues = true;
    try { result = applyHostPreferences(next); } finally { projectingHostValues = false; }
    revision = next.revision;
    snapshot = next;
    syncStatus = "ready";
    return result;
  };

  // Read the latest local values at acknowledgment time, not when a request
  // started. A user can edit (or revert) a key while the host is responding.
  const adoptPreservingLocalEdits = (next: HostPreferenceSnapshot): void => {
    const latest = readLocalSettings();
    const pendingKeys = new Set([
      ...inFlightKeys,
      ...pendingHostPatch(latest, snapshot).flatMap(entry => Object.keys(entry.patch)),
    ]);
    const overlay: Record<string, unknown> = {};
    for (const binding of HOST_PREFERENCE_BINDINGS) {
      if (pendingKeys.has(binding.hostKey)) overlay[binding.appKey] = latest[binding.appKey];
    }
    adopt(next.revision < revision ? snapshot : next);
    if (pendingKeys.size > 0) {
      projectingHostValues = true;
      try {
        writeLocalSettings(applyLocalAppSettingsPatch(readLocalSettings(), overlay as Partial<AppSettings>));
      } finally { projectingHostValues = false; }
    }
  };

  const hydrate = async (): Promise<"applied" | "unchanged" | "unavailable"> => {
    const next = await read();
    if (!next) {
      syncStatus = "unavailable";
      return "unavailable";
    }
    return adopt(next);
  };

  /**
   * Send what this window holds, one category at a time.
   *
   * A stale revision is answered by the host as a conflict, never a silent overwrite. The window
   * then reads the fresh record, applies it, and re-sends on top of the new revision once - the
   * user's own action is the later one, and the other window learns the result through the same
   * broadcast. If the retry conflicts too, the keys stay in `unsaved()`: the window does not
   * pretend they were saved, and it does not keep overwriting another writer.
   */
  const write = async (): Promise<void> => {
    let conflictRetries = 0;
    while (true) {
      const local = readLocalSettings();
      const pending = pendingHostPatch(local, snapshot);
      if (pending.length === 0) return;
      const { category, patch } = pending[0]!;
      // The host replies with its complete record. Keep every category this
      // window still wants to write before adopting that record; otherwise a
      // successful appearance write could clobber a queued layout/composer
      // change with the older values from the host snapshot.
      inFlightKeys = pending.flatMap(entry => Object.keys(entry.patch));
      let answer: unknown;
      try {
        answer = await transport.invoke(CEDIA_AGENT_CHANNEL, {
          kind: "uiSettings",
          action: "write",
          expectedRevision: revision,
          category,
          patch,
        });
      } catch {
        // Unavailable: the local value stays the window's own, and the next change retries.
        syncStatus = "unavailable";
        return;
      }
      const status = isRecord(answer) ? answer.status : undefined;
      if (status === "unavailable") {
        syncStatus = "unavailable";
        return;
      }
      const adopted = status === "conflict" ? (snapshotFrom(answer) ?? await read()) : snapshotFrom(answer);
      if (!adopted) {
        syncStatus = "unavailable";
        return;
      }
      if (status === "saved") {
        adoptPreservingLocalEdits(adopted);
        inFlightKeys = [];
        conflictRetries = 0;
        continue;
      }
      // Conflict: the host refused this revision and its answer carries the record that won. Take
      // that record so this window shows what the host actually holds - but keep the keys the user
      // just moved, then re-send them once on top of the new revision. That is the difference
      // between "another window changed something" (adopted) and "this window's action was undone"
      // (not adopted), and the re-send is what makes the other window learn the result too.
      const shouldRetryConflict = conflictRetries < 1;
      conflictRetries += 1;
      adoptPreservingLocalEdits(adopted);
      inFlightKeys = [];
      syncStatus = "conflict";
      if (pendingHostPatch(readLocalSettings(), adopted).length === 0) return;
      if (!shouldRetryConflict) return;
    }
  };

  const startWrite = (): Promise<void> => {
    if (writing) return writing;
    writing = write().finally(() => {
      inFlightKeys = [];
      writing = undefined;
    });
    return writing;
  };

  const scheduleWrite = (): void => {
    if (disposed) return;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      void startWrite();
    }, WRITE_DEBOUNCE_MS);
  };

  const onLocalChange = (event: unknown): void => {
    if (projectingHostValues) return;
    const key = (event as CustomEvent<{ key?: unknown }> | undefined)?.detail?.key;
    if (key !== APP_SETTINGS_STORAGE_KEY) return;
    scheduleWrite();
  };
  const onHostUpdate = (_event: unknown, ...args: unknown[]): void => {
    const next = snapshotFrom(args[0]);
    // An older publication than what this window already holds is not news.
    if (!next || next.revision <= revision) return;
    adoptPreservingLocalEdits(next);
  };

  window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, onLocalChange as EventListener);
  transport.on?.(CEDIA_PREFERENCES_UPDATE_CHANNEL, onHostUpdate);

  return {
    hydrate,
    flush: async () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      await startWrite();
    },
    revision: () => revision,
    // Computed, never tracked: a key is unsaved exactly while this window's value differs from the
    // last record the host confirmed, so a refused write cannot disappear by bookkeeping.
    unsaved: () => pendingHostPatch(readLocalSettings(), snapshot).flatMap(entry => Object.keys(entry.patch)),
    status: () => syncStatus,
    dispose: () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, onLocalChange as EventListener);
      transport.removeListener?.(CEDIA_PREFERENCES_UPDATE_CHANNEL, onHostUpdate);
    },
  };
}
