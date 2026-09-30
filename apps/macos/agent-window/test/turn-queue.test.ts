import { expect, it } from "bun:test";
import { turnQueueSummary } from "../vendor/synara/apps/web/src/lib/turnQueue";
import type { ThreadSessionTurn } from "../vendor/synara/apps/web/src/types";

const turn = (state: ThreadSessionTurn["state"], extra: Partial<ThreadSessionTurn> = {}): ThreadSessionTurn => ({
  turnIntentId: `intent-${state}`,
  state,
  ...extra,
});

it("says how much work OMP is holding, and which model is running", () => {
  expect(turnQueueSummary([turn("running", { model: "anthropic/claude-sonnet-5" }), turn("queued", { queuePosition: 1 }), turn("queued", { queuePosition: 2 })]))
    .toBe("running anthropic/claude-sonnet-5 · 2 waiting");
  // Without a reported model it counts the running turn instead of naming one it does not know.
  expect(turnQueueSummary([turn("running"), turn("prepared")])).toBe("1 running · 1 waiting");
  expect(turnQueueSummary([turn("queued"), turn("queued")])).toBe("2 waiting");
});

it("never presents an unproven outcome as finished work", () => {
  // The counts alone would read as progress, so an unresolved turn outranks them.
  expect(turnQueueSummary([turn("running"), turn("outcome_unknown", { reason: "the OMP owner vanished mid-turn" })]))
    .toBe("outcome unknown · the OMP owner vanished mid-turn");
  expect(turnQueueSummary([turn("needs_continue")])).toBe("needs continue");
});

it("says nothing when there is nothing to say, and nothing it cannot prove", () => {
  expect(turnQueueSummary([])).toBeNull();
  expect(turnQueueSummary(null)).toBeNull();
  expect(turnQueueSummary(undefined)).toBeNull();
  // Finished work is history, not a queue.
  expect(turnQueueSummary([turn("completed"), turn("cancelled"), turn("failed")])).toBeNull();
  // A state this build does not know is not a queue claim.
  expect(turnQueueSummary([{ turnIntentId: "x", state: "invented" } as unknown as ThreadSessionTurn])).toBeNull();
});
