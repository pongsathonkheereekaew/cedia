// FILE: chatIndexRoute.logic.ts
// Purpose: The "/" landing's restore policy — which remembered thread route the home-chat
//          surface may reopen.
// Layer: Route UI logic helpers
// Exports: home-chat restore-route resolution.

import type { ProjectId, ThreadId } from "@synara/contracts";

import { resolveRestorableThreadRoute, type LastThreadRoute } from "../chatRouteRestore";

export function resolveChatIndexRestoreRoute(input: {
  readonly lastThreadRoute: LastThreadRoute | null;
  readonly availableSplitViewIds: ReadonlySet<string>;
  readonly threadIds: readonly ThreadId[];
  readonly sidebarThreadSummaryById: Readonly<
    Record<
      string,
      | {
          readonly projectId: ProjectId;
          readonly sidechatSourceThreadId?: ThreadId | null;
        }
      | undefined
    >
  >;
  /**
   * Still-unsent chat drafts. They have a route id but no sidebar summary yet, so the summary
   * lookup below never matches them — a cold start on "/" can reopen an unsent draft instead of
   * always minting a new one.
   */
  readonly draftProjectIdByThreadId: ReadonlyMap<string, ProjectId>;
  /**
   * Populated panes from the split named by `lastThreadRoute`. `undefined` means the current
   * client state could not resolve that split, so a split-scoped restore must fail closed.
   */
  readonly rememberedSplitViewThreadIds: readonly ThreadId[] | undefined;
}): LastThreadRoute | null {
  const { draftProjectIdByThreadId, sidebarThreadSummaryById } = input;

  const availableThreadIds = new Set<string>();
  for (const threadId of [...input.threadIds, ...draftProjectIdByThreadId.keys()]) {
    // Fail closed: a thread we can't classify is not restorable from "/". Summaries are built
    // from the same snapshot as threadIds, so this only ever excludes a thread if that invariant
    // breaks — and then a fresh draft beats restoring into the wrong surface.
    const threadSummary = sidebarThreadSummaryById[threadId];
    if (threadSummary?.sidechatSourceThreadId) continue;
    const projectId = threadSummary?.projectId ?? draftProjectIdByThreadId.get(threadId);
    if (projectId === undefined) continue;
    availableThreadIds.add(threadId);
  }

  const restorableRoute = resolveRestorableThreadRoute({
    lastThreadRoute: input.lastThreadRoute,
    availableThreadIds,
    availableSplitViewIds: input.availableSplitViewIds,
  });
  if (!restorableRoute?.splitViewId) {
    return restorableRoute;
  }

  const splitThreadIds = input.rememberedSplitViewThreadIds;
  if (
    splitThreadIds === undefined ||
    splitThreadIds.length === 0 ||
    splitThreadIds.some((threadId) => !availableThreadIds.has(threadId))
  ) {
    return { threadId: restorableRoute.threadId };
  }

  return restorableRoute;
}
