import type { ForgeReviewDetail, ForgeReviewSummary } from "~/lib/forgeReview";

/** Require matching branch names and immutable commit identities, not similar titles. */
export function relatedReviewDirection(detail: Pick<ForgeReviewDetail, "refs" | "ref">, candidate: Pick<ForgeReviewSummary, "number" | "state" | "refs">): "upstream" | "downstream" | null {
  if (candidate.number === detail.ref.number || candidate.state !== "open") return null;
  if (detail.refs.base?.branch && detail.refs.base.sha && candidate.refs.head?.branch === detail.refs.base.branch && candidate.refs.head.sha === detail.refs.base.sha) return "upstream";
  if (detail.refs.head?.branch && detail.refs.head.sha && candidate.refs.base?.branch === detail.refs.head.branch && candidate.refs.base.sha === detail.refs.head.sha) return "downstream";
  return null;
}

