export interface ReviewTab {
  readonly projectId: string;
  readonly url: string;
  readonly title: string;
  readonly repository: string;
  readonly number: number;
  readonly provider: "github" | "gitlab";
  readonly pinned: boolean;
}
export const REVIEW_TABS_KEY = "cedia:ui:review-tabs:v1";
export const MAX_REVIEW_TABS = 32;
export const reviewTabId = (tab: Pick<ReviewTab, "projectId" | "url">) =>
  JSON.stringify([tab.projectId, tab.url.replace(/\/$/, "")]);

export function parseReviewTabs(raw: string | null): readonly ReviewTab[] {
  try {
    const values: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(values)) return [];
    const tabs: ReviewTab[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      if (!value || typeof value !== "object") continue;
      const tab = value as Record<string, unknown>;
      if (typeof tab.projectId !== "string" || !tab.projectId || tab.projectId.length > 256 ||
          typeof tab.url !== "string" || tab.url.length > 4096 ||
          typeof tab.title !== "string" || tab.title.length > 1024 ||
          typeof tab.repository !== "string" || tab.repository.length > 1024 ||
          !Number.isSafeInteger(tab.number) || Number(tab.number) < 1 ||
          (tab.provider !== "github" && tab.provider !== "gitlab")) continue;
      let url: URL;
      try { url = new URL(tab.url); } catch { continue; }
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) continue;
      const item: ReviewTab = { projectId: tab.projectId, url: tab.url, title: tab.title,
        repository: tab.repository, number: Number(tab.number), provider: tab.provider,
        pinned: tab.pinned === true };
      const id = reviewTabId(item);
      if (seen.has(id)) continue;
      seen.add(id);
      tabs.push(item);
      if (tabs.length === MAX_REVIEW_TABS) break;
    }
    return tabs;
  } catch { return []; }
}

export function retainReviewTab(tabs: readonly ReviewTab[], incoming: Omit<ReviewTab, "pinned">): readonly ReviewTab[] {
  const id = reviewTabId(incoming);
  const found = tabs.find(tab => reviewTabId(tab) === id);
  if (found) return tabs.map(tab => reviewTabId(tab) === id ? { ...incoming, pinned: tab.pinned } : tab);
  const next = [...tabs, { ...incoming, pinned: false }];
  if (next.length > MAX_REVIEW_TABS) {
    const evict = next.findIndex(tab => !tab.pinned && reviewTabId(tab) !== id);
    if (evict >= 0) next.splice(evict, 1);
    else next.splice(0, 1);
  }
  return next;
}

export function closeReviewTab(tabs: readonly ReviewTab[], id: string, activeId: string | null) {
  const index = tabs.findIndex(tab => reviewTabId(tab) === id);
  const remaining = tabs.filter(tab => reviewTabId(tab) !== id);
  return { tabs: remaining, navigateTo: id === activeId ? remaining[Math.min(index, remaining.length - 1)] ?? null : undefined };
}
