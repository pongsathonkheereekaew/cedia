// Cedia slice test for upstream #1290 remainder (attention-candidate replay
// short-circuit). Pins the observable contract of both branches: unchanged
// references emit nothing, and content-identical-but-new references agree.
// Upstream: https://github.com/Emanuele-web04/synara/pull/1290
import { describe, expect, it } from "vitest";

import type { Thread } from "../types";
import { collectThreadAttentionCandidates } from "./taskCompletion.logic";

const thread = (overrides: Record<string, unknown> = {}): Thread =>
  ({
    id: "thread-1",
    projectId: "project-1",
    title: "Title",
    activities: [],
    pendingInteractions: [],
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestTurn: null,
    ...overrides,
  }) as Thread;

describe("collectThreadAttentionCandidates replay short-circuit", () => {
  it("emits nothing when the same thread object is passed twice", () => {
    const same = thread();
    expect(collectThreadAttentionCandidates([same], [same])).toEqual([]);
  });

  it("agrees when references are new but nothing derivable changed", () => {
    const previous = thread();
    const rebuilt = thread({ activities: [], pendingInteractions: [] });
    expect(collectThreadAttentionCandidates([previous], [rebuilt])).toEqual([]);
  });

  it("ignores threads with no previous snapshot", () => {
    expect(collectThreadAttentionCandidates([], [thread()])).toEqual([]);
  });
});
