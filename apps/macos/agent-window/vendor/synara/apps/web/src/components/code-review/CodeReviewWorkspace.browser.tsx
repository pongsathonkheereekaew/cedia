import "../../index.css";
import { type ThreadBrowserState } from "@synara/contracts";
import { cleanup, render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBrowserStateStore } from "~/browserStateStore";
import { CodeReviewWorkspace } from "./CodeReviewWorkspace";

const fixture = vi.hoisted(() => ({ gate: null as Promise<void> | null, count: 0, newChat: vi.fn(async () => null), navigate: vi.fn(), state: { threadId: "cedia-main-browser:code-review", version: 1, open: false, activeTabId: null, tabs: [], lastError: null } as unknown as ThreadBrowserState }));
vi.mock("~/hooks/useHandleNewChat", () => ({ useHandleNewChat: () => ({ handleNewChat: fixture.newChat }) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => fixture.navigate, useSearch: () => ({}) }));
vi.mock("./CodeReviewTabs", () => ({ CodeReviewTabs: ({ onSelectReview }: { onSelectReview: () => void }) => <button onClick={onSelectReview}>Existing review</button> }));
vi.mock("../SidebarHeaderNavigationControls", () => ({ SidebarHeaderNavigationControls: () => null }));
vi.mock("../BrowserPanel", () => ({ BrowserPanel: ({ isVisible, mainTab }: { isVisible: boolean; mainTab: { home: React.ReactNode } }) => <div className="relative flex-1" data-testid="native-browser" data-visible={String(isVisible)}>{mainTab.home}</div> }));
vi.mock("~/nativeApi", () => { const api = { browser: {
  getState: async () => fixture.state,
  newTab: async () => { await fixture.gate; const id = `tab-${++fixture.count}`; fixture.state = { ...fixture.state, version: fixture.state.version + 1, activeTabId: id, tabs: [...fixture.state.tabs, { id, title: "New tab", url: "about:blank" } as ThreadBrowserState["tabs"][number]] }; return fixture.state; },
  selectTab: async ({ tabId }: { tabId: string }) => (fixture.state = { ...fixture.state, version: fixture.state.version + 1, activeTabId: tabId }),
  closeTab: async ({ tabId }: { tabId: string }) => { const tabs = fixture.state.tabs.filter(t => t.id !== tabId); return fixture.state = { ...fixture.state, version: fixture.state.version + 1, tabs, activeTabId: tabs.at(-1)?.id ?? null }; },
} }; return { readNativeApi: () => api }; });
beforeEach(() => {
  fixture.gate = null;
  fixture.count = 0;
  fixture.state = { ...fixture.state, version: 1, tabs: [], activeTabId: null };
  useBrowserStateStore.setState({ threadStatesByThreadId: {}, recentHistoryByThreadId: {}, dismissedHistoryUrlsByThreadId: {} });
});
afterEach(cleanup);
it("opens peer browser tabs, returns to review, and closes the final tab without losing review", async () => {
  await page.viewport(1200, 800);
  await render(<div className="h-screen"><CodeReviewWorkspace><div>Review content</div></CodeReviewWorkspace></div>);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Select browser tab New tab" })).toBeVisible();
  await expect.element(page.getByText("Review content", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  expect(fixture.state.tabs).toHaveLength(2);
  await page.getByRole("button", { name: "Existing review" }).click();
  await expect.element(page.getByText("Review content", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Select browser tab New tab" }).first().click();
  await page.getByRole("button", { name: "Close browser tab New tab" }).first().click();
  await page.getByRole("button", { name: "Close browser tab New tab" }).click();
  await expect.element(page.getByText("Review content", { exact: true })).toBeVisible();
  expect(fixture.state.tabs).toHaveLength(0);
});

it("does not let a delayed new tab override a newer review selection", async () => {
  let finish!: () => void;
  fixture.gate = new Promise<void>(resolve => { finish = resolve; });
  await page.viewport(1200, 800);
  await render(<div className="h-screen"><CodeReviewWorkspace><div>Review content</div></CodeReviewWorkspace></div>);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("button", { name: "Existing review" }).click();
  finish();
  await expect.element(page.getByRole("button", { name: "Select browser tab New tab" })).toBeVisible();
  await expect.element(page.getByText("Review content", { exact: true })).toBeVisible();
});

it("creates a fresh chat instead of routing through last-session restoration", async () => {
  fixture.newChat.mockClear();
  await render(<div className="h-screen"><CodeReviewWorkspace><div>Review content</div></CodeReviewWorkspace></div>);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  expect(fixture.newChat).toHaveBeenCalledWith({ fresh: true });
});

it("gives recent pages a dismiss action without changing live tabs or other owners", async () => {
  const url = "https://example.com";
  fixture.state = {
    ...fixture.state,
    activeTabId: "qa-tab",
    tabs: [{ id: "qa-tab", title: "Example Domain", url, lastCommittedUrl: url } as ThreadBrowserState["tabs"][number]],
  };
  useBrowserStateStore.setState({
    recentHistoryByThreadId: {
      "cedia-main-browser:code-review": [{ url, title: "Example Domain", tabId: "qa-tab" }],
      "another-owner": [{ url, title: "Example Domain", tabId: "other-tab" }],
    },
  });

  await render(<div className="h-screen"><CodeReviewWorkspace><div>Review content</div></CodeReviewWorkspace></div>);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Open Example Domain", exact: true })).toBeVisible();

  const recentCard = page.getByRole("button", { name: "Open Example Domain", exact: true });
  const restingBackground = getComputedStyle(recentCard.element()).backgroundColor;
  await recentCard.hover();
  await expect.poll(() => getComputedStyle(recentCard.element()).backgroundColor).not.toBe(restingBackground);

  const liveTabCount = fixture.state.tabs.length;
  await page.getByRole("button", { name: "Remove Example Domain from recent pages", exact: true }).click();
  await expect.element(page.getByText("Enter a URL or search above. Pages you visit will appear here.", { exact: true })).toBeVisible();
  expect(fixture.state.tabs).toHaveLength(liveTabCount);
  const persisted = JSON.parse(localStorage.getItem("synara:browser-state:v1") ?? "{}");
  expect(persisted.state.dismissedHistoryUrlsByThreadId["cedia-main-browser:code-review"][url]).toBe(true);
  expect(useBrowserStateStore.getState().dismissedHistoryUrlsByThreadId["cedia-main-browser:code-review"]?.[url]).toBe(true);
  expect(useBrowserStateStore.getState().recentHistoryByThreadId["another-owner"]).toHaveLength(1);

  // The same native snapshot must not resurrect a card that was dismissed in
  // this owner; changing the URL later is treated as an intentional revisit.
  useBrowserStateStore.getState().upsertThreadState({ ...fixture.state, version: fixture.state.version + 1 });
  expect(useBrowserStateStore.getState().recentHistoryByThreadId["cedia-main-browser:code-review"]).toHaveLength(1);
  expect(useBrowserStateStore.getState().dismissedHistoryUrlsByThreadId["cedia-main-browser:code-review"]?.[url]).toBe(true);

  const navigated = {
    ...fixture.state,
    version: fixture.state.version + 2,
    tabs: fixture.state.tabs.map(tab => tab.id === "qa-tab" ? { ...tab, url: "https://example.org", lastCommittedUrl: "https://example.org" } : tab),
  };
  useBrowserStateStore.getState().upsertThreadState(navigated);
  useBrowserStateStore.getState().upsertThreadState({ ...fixture.state, version: navigated.version + 1 });
  expect(useBrowserStateStore.getState().dismissedHistoryUrlsByThreadId["cedia-main-browser:code-review"]?.[url]).toBeUndefined();
});
