import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { GitPullRequestIcon, PinIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { ForgeReviewDetail, ForgeReviewDetailInput } from "~/lib/forgeReview";
import { REVIEW_TABS_KEY, closeReviewTab, parseReviewTabs, retainReviewTab, reviewTabId, type ReviewTab } from "./codeReviewTabs.logic";

const CHANGED = "cedia:review-tabs-changed";
let memoryTabs = "[]";
function read() {
  try { return window.localStorage.getItem(REVIEW_TABS_KEY) ?? memoryTabs; }
  catch { return memoryTabs; }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === REVIEW_TABS_KEY || event.key === null) listener(); };
  window.addEventListener("storage", storage);
  window.addEventListener(CHANGED, listener);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(CHANGED, listener); };
}
function update(transform: (tabs: readonly ReviewTab[]) => readonly ReviewTab[]) {
  const before = read();
  const after = JSON.stringify(transform(parseReviewTabs(before)));
  if (after === before) return;
  memoryTabs = after;
  try { window.localStorage.setItem(REVIEW_TABS_KEY, after); } catch { /* device-local session fallback */ }
  window.dispatchEvent(new Event(CHANGED));
}

export function useRegisterReviewTab(input: ForgeReviewDetailInput | null, detail: ForgeReviewDetail | undefined) {
  useEffect(() => {
    if (!input || !detail) return;
    // A detail response for a previous selection must not register under a new project.
    if (input.url.replace(/\/$/, "") !== detail.ref.url.replace(/\/$/, "")) return;
    update(tabs => retainReviewTab(tabs, {
      projectId: input.projectId, url: detail.ref.url, title: detail.title,
      repository: detail.repository.path, number: detail.ref.number, provider: detail.provider,
    }));
  }, [input?.projectId, input?.url, detail?.title, detail?.ref.url, detail?.ref.number, detail?.repository.path, detail?.provider]);
}

export function CodeReviewTabs({ inactive = false, onSelectReview, onBackgroundReviewChange }: { inactive?: boolean; onSelectReview?: () => void; onBackgroundReviewChange?: () => void }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { projectId?: string; url?: string };
  const raw = useSyncExternalStore(subscribe, read, () => "[]");
  const tabs = useMemo(() => parseReviewTabs(raw), [raw]);
  const selectedId = search.projectId && search.url ? reviewTabId({ projectId: search.projectId, url: search.url }) : null;
  const activeId = inactive ? null : selectedId;
  const select = (tab: ReviewTab) => { onSelectReview?.(); void navigate({ to: "/code-review", search: { projectId: tab.projectId, url: tab.url, provider: tab.provider, state: "all" } }); };
  return (
    <nav aria-label="Open code reviews" className="no-drag flex min-w-0 shrink-0 items-center gap-1 px-2 [-webkit-app-region:no-drag]">
      {tabs.map(tab => {
        const id = reviewTabId(tab);
        return (
          <div key={id} className={cn("group flex h-8 max-w-64 shrink-0 items-center rounded-lg border border-transparent text-xs", id === activeId ? "border-border/50 bg-background shadow-xs" : "text-muted-foreground hover:bg-muted/50")}>
            <button type="button" aria-current={id === activeId ? "page" : undefined} title={`${tab.repository} #${tab.number}: ${tab.title}`} onClick={() => select(tab)} className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <GitPullRequestIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{tab.title}</span>
            </button>
            <button type="button" aria-label={`${tab.pinned ? "Unpin" : "Pin"} review ${tab.repository} #${tab.number}`} aria-pressed={tab.pinned} onClick={() => update(current => current.map(item => reviewTabId(item) === id ? { ...item, pinned: !item.pinned } : item))} className={cn("shrink-0 rounded p-1 hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring", !tab.pinned && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}>
              <PinIcon className="size-3" aria-hidden />
            </button>
            <button type="button" aria-label={`Close review ${tab.repository} #${tab.number}`} onClick={() => {
              const result = closeReviewTab(parseReviewTabs(read()), id, selectedId);
              update(() => result.tabs);
              if (result.navigateTo !== undefined) {
                if (inactive) onBackgroundReviewChange?.();
                else onSelectReview?.();
                const next = result.navigateTo;
                void navigate({ to: "/code-review", search: next ? { projectId: next.projectId, url: next.url, provider: next.provider, state: "all" } : {} });
              }
            }} className="mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
              <XIcon className="size-3" aria-hidden />
            </button>
          </div>
        );
      })}
    </nav>
  );
}
