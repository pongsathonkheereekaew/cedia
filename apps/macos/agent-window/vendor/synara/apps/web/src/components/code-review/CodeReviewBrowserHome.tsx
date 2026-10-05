import type { BrowserHistoryEntry } from "~/browserStateStore";
import { GlobeIcon, GitPullRequestIcon, MessageCircleIcon, SettingsIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

type CodeReviewBrowserHomeProps = {
  history: BrowserHistoryEntry[];
  dismissedHistoryUrls: Record<string, true> | undefined;
  onOpenUrl: (url: string) => void;
  onDismissRecent: (url: string) => void;
  onShowReview: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
};

const toolCardClassName =
  "group flex min-w-0 items-center gap-3 rounded-xl border border-border/60 bg-[var(--color-background-elevated-secondary)]/55 px-4 py-3 text-sm text-foreground transition-colors duration-150 motion-reduce:transition-none hover:border-border hover:bg-[var(--color-background-elevated-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70";

const recentCardClassName =
  "group flex min-w-0 items-center gap-3 rounded-xl border border-transparent bg-transparent px-4 py-3 text-sm text-foreground transition-colors duration-150 motion-reduce:transition-none hover:border-border/60 hover:bg-[var(--color-background-elevated-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70";

export function CodeReviewBrowserHome({
  history,
  dismissedHistoryUrls,
  onOpenUrl,
  onDismissRecent,
  onShowReview,
  onNewChat,
  onOpenSettings,
}: CodeReviewBrowserHomeProps) {
  const visibleHistory = history.filter((entry) => !dismissedHistoryUrls?.[entry.url]);

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-10 px-8 py-9">
        <section aria-label="Tools">
          <h2 className="mb-4 text-sm font-medium">Tools</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" className={toolCardClassName} onClick={onShowReview}>
              <GitPullRequestIcon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              <span>Code Review</span>
            </button>
            <button type="button" className={toolCardClassName} onClick={onNewChat}>
              <MessageCircleIcon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              <span>New chat</span>
            </button>
            <button type="button" className={toolCardClassName} onClick={onOpenSettings}>
              <SettingsIcon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              <span>Settings</span>
            </button>
          </div>
        </section>

        <section aria-label="Recent pages">
          <h2 className="mb-4 text-sm font-medium">Recent pages</h2>
          {visibleHistory.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {visibleHistory.slice(0, 8).map((entry) => {
                const label = entry.title || entry.url;
                return (
                  <div
                    key={entry.url}
                    className="group relative min-w-0 rounded-xl focus-within:ring-2 focus-within:ring-ring/70"
                  >
                    <button
                      type="button"
                      title={entry.url}
                      aria-label={`Open ${label}`}
                      onClick={() => onOpenUrl(entry.url)}
                      className={cn(
                        recentCardClassName,
                        "h-full w-full flex-col items-center justify-center gap-3 px-3 py-5 text-center",
                      )}
                    >
                      <GlobeIcon className="size-7 text-muted-foreground transition-colors group-hover:text-foreground" />
                      <span className="w-full truncate text-xs">{label}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${label} from recent pages`}
                      title="Remove from recent pages"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDismissRecent(entry.url);
                      }}
                      className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[background-color,color,opacity] duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-background/80 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                    >
                      <XIcon className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enter a URL or search above. Pages you visit will appear here.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
