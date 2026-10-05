import { createFileRoute } from "@tanstack/react-router";

import { CodeReviewSurface } from "~/components/code-review/CodeReviewSurface";
import { CodeReviewWorkspace } from "~/components/code-review/CodeReviewWorkspace";

export interface CodeReviewRouteSearch {
  readonly projectId?: string;
  readonly url?: string;
  readonly provider?: "github" | "gitlab";
  readonly state?: "open" | "closed" | "merged" | "all";
}

function CodeReviewRouteView() {
  return <CodeReviewWorkspace><CodeReviewSurface /></CodeReviewWorkspace>;
}

export const Route = createFileRoute("/_chat/code-review")({
  validateSearch: (search: Record<string, unknown>): CodeReviewRouteSearch => ({
    ...(typeof search.projectId === "string" && search.projectId.length > 0
      ? { projectId: search.projectId }
      : {}),
    ...(typeof search.url === "string" && search.url.length > 0 ? { url: search.url } : {}),
    ...(search.provider === "github" || search.provider === "gitlab"
      ? { provider: search.provider }
      : {}),
    ...(search.state === "open" ||
    search.state === "closed" ||
    search.state === "merged" ||
    search.state === "all"
      ? { state: search.state }
      : {}),
  }),
  component: CodeReviewRouteView,
});
