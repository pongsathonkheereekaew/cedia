import { GitHubIcon, TriangleAlertIcon } from "~/lib/icons";
import type { ForgeProvider, ForgeReviewDetail, ForgeReviewDiffResult } from "~/lib/forgeReview";

/** Provider identity follows the host palette in both the queue and detail. */
export function CodeReviewProviderMark({ provider }: { provider: ForgeProvider }) {
  return provider === "github" ? (
    <GitHubIcon className="size-4 shrink-0" aria-hidden />
  ) : (
    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-muted text-[9px] font-medium text-muted-foreground" aria-hidden>
      GL
    </span>
  );
}

/** Shared revision warning; provider truncation and a moved head are distinct. */
export function CodeReviewSnapshotNotice({ detail, diff }: { detail: ForgeReviewDetail; diff?: ForgeReviewDiffResult }) {
  const stale = Boolean(diff && (
    (detail.snapshot.headSha && diff.snapshot.headSha && detail.snapshot.headSha !== diff.snapshot.headSha) ||
    (detail.snapshot.baseSha && diff.snapshot.baseSha && detail.snapshot.baseSha !== diff.snapshot.baseSha)
  ));
  if (!detail.snapshot.truncated && !diff?.truncated && !stale) return null;
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-warning/30 bg-warning/8 px-5 py-2 text-xs text-muted-foreground" role="status">
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      <span>{stale
        ? "The pull request changed while this diff was loading. Refresh before asking OMP to review it."
        : "The provider truncated this snapshot. Some files or activity may be missing."}</span>
    </div>
  );
}
