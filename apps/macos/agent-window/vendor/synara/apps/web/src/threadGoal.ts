import { type ThreadGoalStartBehavior, type ThreadId } from "@synara/contracts";

import { newCommandId } from "./lib/utils";
import { readNativeApi } from "./nativeApi";

export async function dispatchThreadGoal(
  threadId: ThreadId,
  goal: string,
  options: { readonly startBehavior?: ThreadGoalStartBehavior } = {},
): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Cedia API is unavailable.");
  }
  await api.orchestration.dispatchCommand({
    type: "thread.meta.update",
    commandId: newCommandId(),
    threadId,
    goal,
    ...(options.startBehavior !== undefined ? { goalStartBehavior: options.startBehavior } : {}),
  });
}

export async function dispatchThreadGoalBudget(threadId: ThreadId, tokenBudget: number): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Cedia API is unavailable.");
  }
  const hostApi = api as typeof api & { cedia?: { setGoalBudget?: (threadId: string, tokenBudget: number) => Promise<unknown> } };
  if (typeof hostApi.cedia?.setGoalBudget !== "function") {
    throw new Error("Cedia goal budget bridge is unavailable.");
  }
  await hostApi.cedia.setGoalBudget(threadId, tokenBudget);
}

export async function dispatchThreadGoalPaused(threadId: ThreadId, paused: boolean): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Cedia API is unavailable.");
  }
  await api.orchestration.dispatchCommand({
    type: "thread.meta.update",
    commandId: newCommandId(),
    threadId,
    goalPaused: paused,
  });
}
