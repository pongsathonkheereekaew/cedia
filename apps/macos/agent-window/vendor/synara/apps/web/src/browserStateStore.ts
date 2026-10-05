/**
 * Lightweight browser metadata cache keyed by thread.
 *
 * The live browser surface stays in Electron; the web app only keeps enough
 * state to render tabs/toolbars and survive thread switches predictably.
 */

import type { ThreadBrowserState, ThreadId } from "@synara/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isPlainObject, sanitizeStringKeyedRecord } from "./persistedRecord";

const BROWSER_STATE_STORAGE_KEY = "synara:browser-state:v1";
const BROWSER_HISTORY_LIMIT = 12;
const EMPTY_BROWSER_HISTORY: BrowserHistoryEntry[] = [];

interface StringStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  tabId: string;
}

interface BrowserStateStore {
  threadStatesByThreadId: Record<string, ThreadBrowserState | undefined>;
  recentHistoryByThreadId: Record<string, BrowserHistoryEntry[] | undefined>;
  /**
   * URLs hidden from the lightweight New tab home for each browser owner.
   * Keep this separate from recentHistory so dismissing a card never mutates
   * live browser metadata or hides the same URL in another owner.
   */
  dismissedHistoryUrlsByThreadId: Record<string, Record<string, true> | undefined>;
  upsertThreadState: (state: ThreadBrowserState) => void;
  dismissRecentHistory: (threadId: ThreadId, url: string) => void;
  removeThreadState: (threadId: ThreadId) => void;
}

function normalizeHistoryUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed === "about:blank" ? "" : trimmed;
}

function upsertRecentHistoryEntry(
  entries: BrowserHistoryEntry[] | undefined,
  nextEntry: BrowserHistoryEntry,
): BrowserHistoryEntry[] {
  const normalizedUrl = normalizeHistoryUrl(nextEntry.url);
  if (normalizedUrl.length === 0) {
    return entries ?? [];
  }

  const nextEntries = (entries ?? []).filter(
    (entry) => normalizeHistoryUrl(entry.url) !== normalizedUrl,
  );
  nextEntries.unshift({
    ...nextEntry,
    url: normalizedUrl,
  });
  return nextEntries.slice(0, BROWSER_HISTORY_LIMIT);
}

function sameBrowserHistoryEntries(
  previousEntries: BrowserHistoryEntry[] | undefined,
  nextEntries: BrowserHistoryEntry[],
): boolean {
  if (previousEntries === nextEntries) {
    return true;
  }

  if (previousEntries == null || previousEntries.length !== nextEntries.length) {
    return false;
  }

  return previousEntries.every((entry, index) => {
    const nextEntry = nextEntries[index];
    if (!nextEntry) {
      return false;
    }
    return (
      entry.url === nextEntry.url &&
      entry.title === nextEntry.title &&
      entry.tabId === nextEntry.tabId
    );
  });
}

function sanitizeBrowserHistoryEntry(rawEntry: unknown): BrowserHistoryEntry | null {
  if (!isPlainObject(rawEntry)) {
    return null;
  }
  const { url, title, tabId } = rawEntry;
  if (typeof url !== "string" || typeof title !== "string" || typeof tabId !== "string") {
    return null;
  }
  return { url, title, tabId };
}

// Drops malformed persisted history so a corrupt entry can never reach the
// upsert path (which dereferences `entry.url`) or render as a broken tab.
export function sanitizeRecentHistoryByThreadId(
  value: unknown,
): Record<string, BrowserHistoryEntry[]> {
  return sanitizeStringKeyedRecord(value, (rawEntries) => {
    if (!Array.isArray(rawEntries)) {
      return null;
    }
    const entries = rawEntries
      .map(sanitizeBrowserHistoryEntry)
      .filter((entry): entry is BrowserHistoryEntry => entry !== null)
      .slice(0, BROWSER_HISTORY_LIMIT);
    // Drop threads whose history fully fails validation so we don't retain
    // empty placeholder keys in storage.
    return entries.length > 0 ? entries : null;
  });
}

/**
 * Validate the per-owner URL dismissal map before it reaches the renderer.
 * URLs are keys rather than values so malformed records can be discarded
 * without allowing an arbitrary value to be treated as a dismissed URL.
 */
export function sanitizeDismissedHistoryUrlsByThreadId(
  value: unknown,
): Record<string, Record<string, true>> {
  return sanitizeStringKeyedRecord(value, (rawUrls) => {
    if (!isPlainObject(rawUrls)) {
      return null;
    }
    const urls = Object.entries(rawUrls).reduce<Record<string, true>>((result, [url, value]) => {
      if (url.trim().length > 0 && value === true) {
        result[url] = true;
      }
      return result;
    }, {});
    return Object.keys(urls).length > 0 ? urls : null;
  });
}

export function createDedupedBrowserStateStorage(
  resolveStorage: () => StringStorage,
): StringStorage {
  const lastWrittenValueByName = new Map<string, string>();

  return {
    getItem: (name) => resolveStorage().getItem(name),
    setItem: (name, value) => {
      const previousValue = lastWrittenValueByName.get(name) ?? resolveStorage().getItem(name);
      if (previousValue === value) {
        lastWrittenValueByName.set(name, value);
        return;
      }
      lastWrittenValueByName.set(name, value);
      resolveStorage().setItem(name, value);
    },
    removeItem: (name) => {
      lastWrittenValueByName.delete(name);
      resolveStorage().removeItem(name);
    },
  };
}

const browserStateStorage = createDedupedBrowserStateStorage(() => localStorage);

export const useBrowserStateStore = create<BrowserStateStore>()(
  persist(
    (set) => ({
      threadStatesByThreadId: {},
      recentHistoryByThreadId: {},
      dismissedHistoryUrlsByThreadId: {},
      upsertThreadState: (state) =>
        set((current) => {
          const previousState = current.threadStatesByThreadId[state.threadId];
          // Main pushes state before some invoke Promises resolve. A delayed
          // response can therefore arrive after a newer onState snapshot; it
          // must never roll browser chrome (or the renderer binding inputs)
          // back to an older tab/runtime generation.
          if (previousState && previousState.version >= state.version) {
            return current;
          }
          const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
          const orderedTabs = activeTab
            ? [activeTab, ...state.tabs.filter((tab) => tab.id !== activeTab.id)]
            : state.tabs;
          const previousDismissedUrls =
            current.dismissedHistoryUrlsByThreadId[state.threadId] ?? {};
          // A URL that changes on an existing live tab is a deliberate visit,
          // so allow it back into Recent pages. Repeated native snapshots of
          // the same URL stay dismissed and cannot resurrect a removed card.
          const revisitedUrls = new Set<string>();
          if (previousState) {
            for (const tab of state.tabs) {
              const previousTab = previousState.tabs.find((candidate) => candidate.id === tab.id);
              const nextUrl = normalizeHistoryUrl(tab.lastCommittedUrl ?? tab.url);
              const previousUrl = previousTab
                ? normalizeHistoryUrl(previousTab.lastCommittedUrl ?? previousTab.url)
                : "";
              if (nextUrl && nextUrl !== previousUrl) {
                revisitedUrls.add(nextUrl);
              }
            }
          }
          const nextDismissedUrls = Object.keys(previousDismissedUrls).reduce<Record<string, true>>(
            (result, url) => {
              if (!revisitedUrls.has(url)) {
                result[url] = true;
              }
              return result;
            },
            {},
          );
          const previousHistory =
            current.recentHistoryByThreadId[state.threadId] ?? EMPTY_BROWSER_HISTORY;
          const nextHistory = orderedTabs.reduce(
            (entries, tab) => {
              const url = normalizeHistoryUrl(tab.lastCommittedUrl ?? tab.url);
              if (url && nextDismissedUrls[url]) {
                return entries;
              }
              return upsertRecentHistoryEntry(entries, {
                url,
                title: tab.title,
                tabId: tab.id,
              });
            },
            previousHistory,
          );
          const historyChanged = !sameBrowserHistoryEntries(previousHistory, nextHistory);
          const dismissedChanged =
            Object.keys(previousDismissedUrls).length !== Object.keys(nextDismissedUrls).length ||
            Object.keys(previousDismissedUrls).some((url) => previousDismissedUrls[url] !== nextDismissedUrls[url]);

          return {
            threadStatesByThreadId: {
              ...current.threadStatesByThreadId,
              [state.threadId]: state,
            },
            recentHistoryByThreadId: historyChanged
              ? {
                  ...current.recentHistoryByThreadId,
                  [state.threadId]: nextHistory,
                }
              : current.recentHistoryByThreadId,
            dismissedHistoryUrlsByThreadId: dismissedChanged
              ? {
                  ...current.dismissedHistoryUrlsByThreadId,
                  [state.threadId]: Object.keys(nextDismissedUrls).length > 0 ? nextDismissedUrls : undefined,
                }
              : current.dismissedHistoryUrlsByThreadId,
          };
        }),
      dismissRecentHistory: (threadId, url) =>
        set((current) => {
          const normalizedUrl = normalizeHistoryUrl(url);
          if (!normalizedUrl) {
            return current;
          }
          const previousUrls = current.dismissedHistoryUrlsByThreadId[threadId] ?? {};
          if (previousUrls[normalizedUrl]) {
            return current;
          }
          return {
            ...current,
            dismissedHistoryUrlsByThreadId: {
              ...current.dismissedHistoryUrlsByThreadId,
              [threadId]: { ...previousUrls, [normalizedUrl]: true },
            },
          };
        }),
      removeThreadState: (threadId) =>
        set((current) => {
          if (
            !Object.hasOwn(current.threadStatesByThreadId, threadId) &&
            !Object.hasOwn(current.dismissedHistoryUrlsByThreadId, threadId)
          ) {
            return current;
          }
          const nextThreadStatesByThreadId = {
            ...current.threadStatesByThreadId,
          };
          const nextRecentHistoryByThreadId = {
            ...current.recentHistoryByThreadId,
          };
          const nextDismissedHistoryUrlsByThreadId = {
            ...current.dismissedHistoryUrlsByThreadId,
          };
          delete nextThreadStatesByThreadId[threadId];
          delete nextRecentHistoryByThreadId[threadId];
          delete nextDismissedHistoryUrlsByThreadId[threadId];
          return {
            threadStatesByThreadId: nextThreadStatesByThreadId,
            recentHistoryByThreadId: nextRecentHistoryByThreadId,
            dismissedHistoryUrlsByThreadId: nextDismissedHistoryUrlsByThreadId,
          };
        }),
    }),
    {
      name: BROWSER_STATE_STORAGE_KEY,
      storage: createJSONStorage(() => browserStateStorage),
      partialize: (state) => ({
        recentHistoryByThreadId: state.recentHistoryByThreadId,
        dismissedHistoryUrlsByThreadId: state.dismissedHistoryUrlsByThreadId,
      }),
      merge: (persisted, current) => ({
        ...current,
        recentHistoryByThreadId: sanitizeRecentHistoryByThreadId(
          (persisted as { recentHistoryByThreadId?: unknown } | undefined)?.recentHistoryByThreadId,
        ),
        dismissedHistoryUrlsByThreadId: sanitizeDismissedHistoryUrlsByThreadId(
          (persisted as { dismissedHistoryUrlsByThreadId?: unknown } | undefined)
            ?.dismissedHistoryUrlsByThreadId,
        ),
      }),
    },
  ),
);

export function selectThreadBrowserState(
  threadId: ThreadId,
): (store: BrowserStateStore) => ThreadBrowserState | undefined {
  return (store) => store.threadStatesByThreadId[threadId];
}

export function selectThreadBrowserHistory(
  threadId: ThreadId,
): (store: BrowserStateStore) => BrowserHistoryEntry[] {
  return (store) => store.recentHistoryByThreadId[threadId] ?? EMPTY_BROWSER_HISTORY;
}
