import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { useLatestProjectStore } from "~/latestProjectStore";
import {
  formatForgeReviewCount,
  formatForgeReviewError,
  formatForgeReviewState,
  formatForgeReviewTimestamp,
  forgeReviewQueryKeys,
  getForgeReviewApi,
  type ForgeProvider,
  type ForgeReviewListBucket,
  type ForgeReviewListState,
  type ForgeReviewSummary,
} from "~/lib/forgeReview";
import { cn } from "~/lib/utils";
import {
  CircleAlertIcon,
  CodeIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  LoaderIcon,
  RefreshCwIcon,
  SearchIcon,
} from "~/lib/icons";
import { CodeReviewProviderMark } from "./CodeReviewPresentation";
import { useStore } from "~/store";
import type { ProjectId } from "@synara/contracts";

type ReviewRouteSearch = {
  readonly projectId?: string;
  readonly url?: string;
  readonly provider?: ForgeProvider;
  readonly state?: ForgeReviewListState;
};

const fieldClassName =
  "h-8 w-full rounded-lg border border-border/70 bg-background px-2 text-[length:var(--app-font-size-ui,12px)] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring/70 focus-visible:ring-1 focus-visible:ring-ring/60";

const filterButtonClassName =
  "inline-flex min-w-0 items-center justify-center rounded-md px-2 py-1 text-[length:var(--app-font-size-ui-xs,10px)] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60";

const reviewStateLabels: Record<ForgeReviewListState, string> = {
  open: "Open",
  all: "All",
  closed: "Closed",
  merged: "Merged",
};

const reviewGroupLabels: Record<ForgeReviewListBucket, string> = {
  all: "All reviews",
  authored: "Authored by me",
  needs_review: "Needs my review",
  team: "Team queue",
};

function readSearch(): ReviewRouteSearch {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const provider = params.get("provider");
  const state = params.get("state");
  return {
    ...(params.get("projectId") ? { projectId: params.get("projectId") ?? undefined } : {}),
    ...(params.get("url") ? { url: params.get("url") ?? undefined } : {}),
    ...(provider === "github" || provider === "gitlab" ? { provider } : {}),
    ...(state === "open" || state === "closed" || state === "merged" || state === "all"
      ? { state }
      : {}),
  };
}

function useReviewSearch(): ReviewRouteSearch {
  // The route owns the validated query in production. Reading it as a narrow value here keeps
  // this reusable sidebar safe when mounted by the shell before the route transition settles.
  const search = useSearch({ strict: false }) as unknown as ReviewRouteSearch;
  const browserSearch = readSearch();
  return {
    ...browserSearch,
    ...search,
  };
}

function updateReviewSearch(
  next: Partial<ReviewRouteSearch>,
  navigate: ReturnType<typeof useNavigate>,
  routeSearch?: ReviewRouteSearch,
) {
  // The app uses a hash router in the desktop shell, so window.location.search
  // is often empty even while TanStack Router has a validated search object.
  // Merge both sources before changing one field to keep provider/state/project
  // filters intact when selecting another row.
  const current = { ...readSearch(), ...(routeSearch ?? {}) };
  const merged = { ...current, ...next };
  const search: ReviewRouteSearch = {
    ...(merged.projectId ? { projectId: merged.projectId } : {}),
    ...(merged.url ? { url: merged.url } : {}),
    ...(merged.provider ? { provider: merged.provider } : {}),
    ...(merged.state && merged.state !== "open" ? { state: merged.state } : {}),
  };
  void navigate({ to: "/code-review", search });
}

function ProviderGlyph({ provider }: { provider: ForgeProvider }) {
  return <CodeReviewProviderMark provider={provider} />;
}

function ReviewRow({
  review,
  selected,
  onSelect,
}: {
  review: ForgeReviewSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const stateLabel = formatForgeReviewState(review);
  const count = review.counts.comments;
  return (
    <button
      type="button"
      data-forge-review-row
      data-review-url={review.url}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "group flex w-full min-w-0 flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
        selected
          ? "bg-[var(--color-background-elevated-secondary)]"
          : "hover:bg-[var(--color-background-elevated-secondary)]/70",
      )}
    >
      <span className="flex min-w-0 items-start gap-2">
        {review.draft ? (
          <GitPullRequestDraftIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <GitPullRequestIcon className="mt-0.5 size-3.5 shrink-0 text-status-success" />
        )}
        <span className="min-w-0 flex-1 overflow-hidden break-words text-[length:var(--app-font-size-ui,12px)] font-medium leading-4 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
          {review.title}
        </span>
        <span className="shrink-0 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
          #{review.number}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 pl-5 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
        <ProviderGlyph provider={review.provider} />
        <span className="truncate">{review.author?.login ?? "Unknown author"}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">{stateLabel}</span>
        {count !== null ? (
          <>
            <span aria-hidden>·</span>
            <span className="shrink-0">{formatForgeReviewCount(count)} comments</span>
          </>
        ) : null}
      </span>
      <span className="pl-5 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground/75">
        {formatForgeReviewTimestamp(review.updatedAt ?? review.createdAt)}
      </span>
    </button>
  );
}

export function CodeReviewSidebar() {
  const navigate = useNavigate();
  const search = useReviewSearch();
  const projects = useStore((state) => state.projects).filter((project) => project.kind === "project");
  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);
  const projectId = (search.projectId ?? latestProjectId ?? projects[0]?.id) as ProjectId | undefined;
  const [query, setQuery] = useState(search.url ?? "");
  const [titleFilter, setTitleFilter] = useState("");
  const [group, setGroup] = useState<ForgeReviewListBucket>("all");
  const [team, setTeam] = useState("");
  const state = search.state ?? "open";
  useEffect(() => {
    setQuery(search.url ?? "");
    if (search.url) setTitleFilter("");
  }, [search.url]);
  const apiQuery = useInfiniteQuery({
    queryKey: projectId
      ? forgeReviewQueryKeys.list({
          projectId,
          state,
          bucket: group,
          ...(group === "team" && team.trim() ? { team: team.trim() } : {}),
          ...(search.provider ? { provider: search.provider } : {}),
          ...(search.url ? { url: search.url } : {}),
        })
      : [...forgeReviewQueryKeys.all, "missing-project"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      if (!projectId) throw new Error("Choose a project with a GitHub or GitLab remote first.");
      return getForgeReviewApi().list({
        projectId,
        state,
        limit: 100,
        bucket: group,
        ...(group === "team" && team.trim() ? { team: team.trim() } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(search.provider ? { provider: search.provider } : {}),
        ...(search.url ? { url: search.url } : {}),
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(projectId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const capabilitiesQuery = useQuery({
    queryKey: forgeReviewQueryKeys.capabilities(),
    queryFn: () => getForgeReviewApi().capabilities(),
    staleTime: 60_000,
    retry: false,
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (apiQuery.data?.pages.flatMap((page) => page.items) ?? []).filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }, [apiQuery.data]);
  const visibleItems = useMemo(() => {
    const term = titleFilter.trim().toLowerCase();
    return items.filter((review) => {
      if (term && !review.title.toLowerCase().includes(term) && String(review.number) !== term) return false;
      return true;
    });
  }, [group, items, titleFilter]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (/^https?:\/\//iu.test(value)) {
      setTitleFilter("");
      updateReviewSearch({ state: "all", url: value || undefined, ...(projectId ? { projectId } : {}) }, navigate, search);
    } else {
      setTitleFilter(value);
      updateReviewSearch({ url: undefined, ...(projectId ? { projectId } : {}) }, navigate, search);
    }
  };

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col border-r border-border/70 bg-[var(--color-background-surface)]">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <CodeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h1 className="truncate text-sm font-semibold">Code Review</h1>
        </div>

      </header>

      <div className="shrink-0 space-y-2 border-b border-border/70 p-3">
        <form onSubmit={submitSearch} className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            aria-label="Search or paste a pull or merge request URL"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search or paste a PR/MR link"
            className={cn(fieldClassName, "bg-[var(--color-background-elevated-secondary)] pl-8 pr-2")}
          />
        </form>
        {projects.length > 0 ? (
          <select
            aria-label="Project"
            value={projectId ?? ""}
            onChange={(event) => updateReviewSearch({ projectId: event.target.value, url: undefined }, navigate, search)}
            className={fieldClassName}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
            Add a project with a GitHub or GitLab remote to review pull requests.
          </p>
        )}
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Pull request state">
          {(["open", "all", "closed", "merged"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={state === value}
              onClick={() => updateReviewSearch({ state: value, url: undefined }, navigate, search)}
              className={cn(
                filterButtonClassName,
                state === value
                  ? "bg-[var(--color-background-button-secondary)] text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {reviewStateLabels[value]}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="forge-review-queue">Review queue</label>
        <select
          id="forge-review-queue"
          aria-label="Review queue"
          value={group}
          onChange={(event) => setGroup(event.target.value as ForgeReviewListBucket)}
          className={fieldClassName}
        >
          {(["all", "authored", "needs_review", "team"] as const).map((value) => (
            <option key={value} value={value}>
              {reviewGroupLabels[value]}
            </option>
          ))}
        </select>
        {group === "team" ? (
          <input
            aria-label="Team slug"
            value={team}
            onChange={(event) => setTeam(event.target.value)}
            placeholder="Team slug (org/team)"
            className={fieldClassName}
          />
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {capabilitiesQuery.data?.providers.some((provider) => provider.state === "available") ? null :
          capabilitiesQuery.isPending ? null : (
            <div className="mb-2 rounded-lg border border-warning/30 bg-warning/8 px-2.5 py-2 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
              <div className="flex items-center gap-1.5 text-foreground">
                <CircleAlertIcon className="size-3.5 text-warning" aria-hidden />
                Connect GitHub or GitLab to load review data.
              </div>
              {capabilitiesQuery.data?.providers
                .filter((provider) => provider.state !== "available")
                .map((provider) => (
                  <div key={`${provider.provider}:${provider.hostname}`} className="mt-1">
                    {provider.hostname}: {provider.reason ?? provider.state}
                  </div>
                ))}
            </div>
          )}
        {apiQuery.isPending ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <LoaderIcon className="size-3.5 animate-spin" aria-hidden /> Loading reviews…
          </div>
        ) : apiQuery.isError && !apiQuery.data ? (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/8 px-2.5 py-2 text-xs text-muted-foreground">
            {formatForgeReviewError(apiQuery.error)}
            <button type="button" className="mt-2 block text-foreground underline" onClick={() => void apiQuery.refetch()}>
              Retry
            </button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-muted-foreground">
            {search.url || titleFilter ? "No pull or merge request matched that search." : "No reviews in this view."}
          </div>
        ) : (
          <div className="space-y-0.5">
            <h2 className="px-2 py-1 text-[length:var(--app-font-size-ui-xs,10px)] font-medium text-muted-foreground">
              {group === "all" ? `${reviewStateLabels[state]} reviews` : reviewGroupLabels[group]}
            </h2>
            {visibleItems.map((review) => (
              <ReviewRow
                key={`${review.provider}:${review.url}`}
                review={review}
                selected={search.url === review.url}
                onSelect={() => updateReviewSearch({ url: review.url, projectId }, navigate, search)}
              />
            ))}

          </div>
        )}
        {apiQuery.isFetchNextPageError ? <p role="alert" className="px-2 py-2 text-xs text-destructive">{formatForgeReviewError(apiQuery.error)}</p> : null}
        {apiQuery.hasNextPage ? (
          <button type="button" disabled={apiQuery.isFetchingNextPage} onClick={() => void apiQuery.fetchNextPage()} className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-border/70 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-60">
            <RefreshCwIcon className={cn("size-3.5", apiQuery.isFetchingNextPage && "animate-spin")} aria-hidden />
            {apiQuery.isFetchNextPageError ? "Retry loading more" : "Load more"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

export default CodeReviewSidebar;
