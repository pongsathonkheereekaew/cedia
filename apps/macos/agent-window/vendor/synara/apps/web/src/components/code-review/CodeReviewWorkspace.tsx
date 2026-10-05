import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ThreadId, type ThreadBrowserState } from "@synara/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { GlobeIcon, PlusIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useHandleNewChat } from "~/hooks/useHandleNewChat";
import { readNativeApi } from "~/nativeApi";
import { useBrowserStateStore } from "~/browserStateStore";
import { BrowserPanel } from "../BrowserPanel";
import { SidebarHeaderNavigationControls } from "../SidebarHeaderNavigationControls";
import { CHAT_SURFACE_HEADER_PADDING_X_CLASS, CHAT_SURFACE_HEADER_ROW_CLASS_NAME } from "../chat/chatHeaderControls";
import { CodeReviewBrowserHome } from "./CodeReviewBrowserHome";
import { CodeReviewTabs } from "./CodeReviewTabs";

// Native browser accepts UI owner keys. This is not an OMP thread: the main
// browser variant deliberately exposes no agent attachment or draft actions.
const OWNER = ThreadId.makeUnsafe("cedia-main-browser:code-review");

export function CodeReviewWorkspace({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { handleNewChat } = useHandleNewChat();
  const search = useSearch({ strict: false }) as { projectId?: string; url?: string };
  const [browsing, setBrowsing] = useState(false);
  const [started, setStarted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const viewIntent = useRef(0);
  const backgroundReviewChange = useRef(false);
  const showReview = useCallback(() => { viewIntent.current++; setBrowsing(false); }, []);
  const state = useBrowserStateStore(s => s.threadStatesByThreadId[OWNER]);
  const history = useBrowserStateStore(s => s.recentHistoryByThreadId[OWNER]);
  const dismissedHistoryUrls = useBrowserStateStore(
    (s) => s.dismissedHistoryUrlsByThreadId[OWNER],
  );
  const api = readNativeApi();
  const accept = useCallback((next: ThreadBrowserState) => useBrowserStateStore.getState().upsertThreadState(next), []);
  useEffect(() => {
    if (backgroundReviewChange.current) { backgroundReviewChange.current = false; return; }
    showReview();
  }, [search.projectId, search.url, showReview]);
  useEffect(() => {
    let current = true;
    void api?.browser.getState({ threadId: OWNER }).then(next => { if (current) accept(next); }).catch(() => {});
    return () => { current = false; };
  }, [api, accept]);
  const run = async (action: () => Promise<ThreadBrowserState>, showBrowser = true) => {
    if (busy.current) return;
    const intent = ++viewIntent.current;
    busy.current = true; setPending(true); setError(null);
    try {
      const next = await action(); accept(next);
      if (showBrowser && intent === viewIntent.current) { setStarted(true); setBrowsing(next.tabs.length > 0); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update browser tab."); }
    finally { busy.current = false; setPending(false); }
  };
  const newTab = () => {
    if (!api) { setError("Browser is unavailable in this window."); return; }
    void run(() => api.browser.newTab({ threadId: OWNER, activate: true }));
  };
  const openUrl = (url: string) => {
    if (!api || !state?.activeTabId) return;
    void run(() => api.browser.navigate({ threadId: OWNER, tabId: state.activeTabId!, url }));
  };
  const home = (
    <CodeReviewBrowserHome
      history={history ?? []}
      dismissedHistoryUrls={dismissedHistoryUrls}
      onOpenUrl={openUrl}
      onDismissRecent={(url) => useBrowserStateStore.getState().dismissRecentHistory(OWNER, url)}
      onShowReview={showReview}
      onNewChat={() => {
        void handleNewChat({ fresh: true }).catch((cause) =>
          setError(cause instanceof Error ? cause.message : "Unable to create a chat."),
        );
      }}
      onOpenSettings={() => void navigate({ to: "/settings" })}
    />
  );
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
    <header className={`${CHAT_SURFACE_HEADER_ROW_CLASS_NAME} cedia-chrome-header drag-region ${CHAT_SURFACE_HEADER_PADDING_X_CLASS}`} aria-label="Code Review window header">
      <div className="pointer-events-auto"><SidebarHeaderNavigationControls /></div>
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto [-webkit-app-region:no-drag]">
        <CodeReviewTabs inactive={browsing} onSelectReview={showReview} onBackgroundReviewChange={() => { backgroundReviewChange.current = true; }} />
        {state?.tabs.map(tab => <div key={tab.id} className={cn("flex h-8 max-w-60 shrink-0 items-center rounded-lg border border-transparent text-xs", browsing && state.activeTabId === tab.id ? "border-border/50 bg-background shadow-xs" : "text-muted-foreground hover:bg-muted/50")}>
          <button disabled={pending} aria-label={`Select browser tab ${tab.title || "New tab"}`} aria-current={browsing && state.activeTabId === tab.id ? "page" : undefined} title={tab.url} onClick={() => api && void run(() => api.browser.selectTab({ threadId: OWNER, tabId: tab.id }))} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 focus-visible:ring-1 focus-visible:ring-ring"><GlobeIcon className="size-3.5 shrink-0" /><span className="truncate">{tab.title || "New tab"}</span></button>
          <button disabled={pending} aria-label={`Close browser tab ${tab.title || "New tab"}`} onClick={() => api && void run(() => api.browser.closeTab({ threadId: OWNER, tabId: tab.id }), browsing)} className="mr-1 shrink-0 rounded p-1 hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"><XIcon className="size-3" /></button>
        </div>)}
        <button type="button" disabled={pending} aria-label="New tab" title="New tab" onClick={newTab} className="mx-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"><PlusIcon className="size-4" /></button>
      </div>
    </header>
    {error && <div role="alert" className="border-b border-border px-4 py-2 text-sm text-destructive">{error}</div>}
    <div className={cn("min-h-0 min-w-0 flex-1", browsing ? "hidden" : "flex")} inert={browsing}>{children}</div>
    {started && <div className={cn("min-h-0 min-w-0 flex-1", browsing ? "flex" : "hidden")} inert={!browsing}><BrowserPanel mode="sidebar" threadId={OWNER} isVisible={browsing} onClosePanel={showReview} mainTab={{ onNewTab: newTab, home }} /></div>}
  </div>;
}
