import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { getForgeReviewApi, type ForgeReviewDetail, type ForgeReviewDetailInput } from "~/lib/forgeReview";

import { relatedReviewDirection } from "./codeReviewRelations.logic";

export function CodeReviewRelatedRequests({ input, detail }: { input: ForgeReviewDetailInput; detail: ForgeReviewDetail }) {
  const navigate = useNavigate();
  const query = useInfiniteQuery({
    queryKey: ["cedia", "forge-review", "related", input.projectId, detail.repository.hostname, detail.repository.path],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getForgeReviewApi().list({ projectId: input.projectId, state: "open", limit: 50, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: page => page.nextCursor,
    enabled: detail.state === "open",
    staleTime: 30_000,
    retry: false,
  });
  if (detail.state !== "open") return null;
  const seen = new Set<number>();
  const related = (query.data?.pages.flatMap(page => page.items) ?? []).flatMap(candidate => {
    const direction = relatedReviewDirection(detail, candidate);
    if (!direction || seen.has(candidate.number)) return [];
    seen.add(candidate.number);
    return [{ candidate, direction }];
  });
  if (!related.length && !query.hasNextPage && !query.isError) return null;
  return (
    <section className="space-y-2 border-t border-border/70 pt-4" aria-label="Related pull requests">
      <h2 className="text-sm font-semibold">Related pull requests</h2>
      {related.map(({ candidate, direction }) => (
        <button key={candidate.number} type="button" onClick={() => void navigate({ to: "/code-review", search: { projectId: input.projectId, url: candidate.url, provider: candidate.provider, state: "open" } })} className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring">
          <span className="shrink-0 text-muted-foreground">#{candidate.number}</span>
          <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
          <span className="text-muted-foreground">{direction}</span>
        </button>
      ))}
      {query.isError ? <p className="text-xs text-muted-foreground" role="status">Related requests could not be loaded. <Button size="xs" variant="link" onClick={() => void query.refetch()}>Retry</Button></p> : null}
      {query.hasNextPage ? <Button size="xs" variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Check more open requests</Button> : null}
    </section>
  );
}
