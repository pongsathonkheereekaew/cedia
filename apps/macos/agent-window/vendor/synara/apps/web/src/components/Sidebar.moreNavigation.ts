// FILE: Sidebar.moreNavigation.ts
// Purpose: Persists device-local navigation choices exposed by the Cedia More menu.
// Layer: Sidebar UI preference (not a host setting or execution preference).

export const CODE_REVIEW_RAIL_PIN_STORAGE_KEY = "cedia:ui:code-review-rail-pinned:v1";
const CODE_REVIEW_RAIL_PIN_CHANGED_EVENT = "cedia:code-review-rail-pin-changed";

type MoreNavigationStorage = Pick<Storage, "getItem" | "setItem">;

function localMoreNavigationStorage(): MoreNavigationStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // A locked-down webview must still be able to render the More menu.
    return null;
  }
}

/** Code Review remains visible unless the user explicitly removes it from the rail. */
export function readCodeReviewRailPinned(
  storage: MoreNavigationStorage | null = localMoreNavigationStorage(),
): boolean {
  if (!storage) return true;
  try {
    const value = storage.getItem(CODE_REVIEW_RAIL_PIN_STORAGE_KEY);
    return value !== "0";
  } catch {
    return true;
  }
}

export function writeCodeReviewRailPinned(
  pinned: boolean,
  storage: MoreNavigationStorage | null = localMoreNavigationStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CODE_REVIEW_RAIL_PIN_STORAGE_KEY, pinned ? "1" : "0");
  } catch {
    return;
  }

  // Storage events do not fire in the document that performed the write. The
  // local event keeps a second mounted shell in the same window in sync while
  // the storage listener below covers another window/tab.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CODE_REVIEW_RAIL_PIN_CHANGED_EVENT));
  }
}

export function subscribeCodeReviewRailPinned(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === CODE_REVIEW_RAIL_PIN_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(CODE_REVIEW_RAIL_PIN_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CODE_REVIEW_RAIL_PIN_CHANGED_EVENT, listener);
  };
}
