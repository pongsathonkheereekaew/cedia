import { describe, expect, it } from "vitest";

import {
  CODE_REVIEW_RAIL_PIN_STORAGE_KEY,
  readCodeReviewRailPinned,
  writeCodeReviewRailPinned,
} from "./Sidebar.moreNavigation";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("More navigation rail preference", () => {
  it("keeps Code Review pinned by default and round-trips an explicit unpin", () => {
    const store = storage();

    expect(readCodeReviewRailPinned(store)).toBe(true);
    writeCodeReviewRailPinned(false, store);
    expect(store.getItem(CODE_REVIEW_RAIL_PIN_STORAGE_KEY)).toBe("0");
    expect(readCodeReviewRailPinned(store)).toBe(false);

    writeCodeReviewRailPinned(true, store);
    expect(store.getItem(CODE_REVIEW_RAIL_PIN_STORAGE_KEY)).toBe("1");
    expect(readCodeReviewRailPinned(store)).toBe(true);
  });

  it("treats malformed persisted values as the safe visible default", () => {
    const store = storage();
    store.setItem(CODE_REVIEW_RAIL_PIN_STORAGE_KEY, "unexpected");
    expect(readCodeReviewRailPinned(store)).toBe(true);
  });
});
