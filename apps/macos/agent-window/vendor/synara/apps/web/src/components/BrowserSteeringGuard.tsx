// FILE: BrowserSteeringGuard.tsx
// Purpose: Keep OMP browser steering pointed at most one visible thread (plan §8.2 O10).
// Layer: Route container helper (renders nothing)
//
// browser.cdpUrl is a global setting, but CDP endpoints are per-thread. Without a guard,
// switching threads leaves steering pointed at the old thread, and that thread's
// background turns would drive the wrong tabs. On every route-thread change this guard
// reconciles: a split view (two visible threads, no unambiguous driver) always clears;
// otherwise an attached endpoint re-steers, and a thread with nothing attached clears.
// All bridge/settings failures resolve to "leave steering untouched" — the guard must
// never break route mounting.

import { useEffect } from "react";
import type { ThreadId } from "@synara/contracts";

import { readNativeApi } from "~/nativeApi";
import { getOmpSettingsApi } from "../lib/ompSettingsReactQuery";

export interface BrowserSteeringDeps {
  readonly agentEndpoint: (input: {
    threadId: ThreadId;
  }) => Promise<{ attached: boolean; cdpUrl?: string }>;
  readonly setBrowserCdpUrl: (cdpUrl: string) => Promise<unknown>;
  /** Backend selection that can void steering; absent when unreadable. */
  readonly readBackendSelection?: () => Promise<{ relay: unknown; enabled: unknown }>;
}

export type SteeringOutcome = "steered" | "cleared" | "untouched";

/** Reconcile global browser steering with the newly visible thread. */
export async function reconcileBrowserSteering(
  deps: BrowserSteeringDeps,
  options: { split: boolean },
  threadId: ThreadId,
): Promise<SteeringOutcome> {
  if (options.split) {
    await deps.setBrowserCdpUrl("");
    return "cleared";
  }
  let status: { attached: boolean; cdpUrl?: string };
  try {
    status = await deps.agentEndpoint({ threadId });
  } catch {
    return "untouched";
  }
  if (status.attached && status.cdpUrl) {
    // Steering only wins when the endpoint is actually consulted: relay beats it
    // and a disabled prelude never calls. Steering into either is pointless, so
    // clear instead. An unreadable selection keeps the old behavior (steer).
    if (deps.readBackendSelection) {
      try {
        const selection = await deps.readBackendSelection();
        if (selection.relay === true || selection.enabled === false) {
          await deps.setBrowserCdpUrl("");
          return "cleared";
        }
      } catch {
        // Fall through to endpoint-based steering.
      }
    }
    await deps.setBrowserCdpUrl(status.cdpUrl);
    return "steered";
  }
  await deps.setBrowserCdpUrl("");
  return "cleared";
}

function liveDeps(): BrowserSteeringDeps | null {
  const bridge = readNativeApi();
  if (typeof bridge?.browser?.agentEndpoint !== "function") return null;
  const agentEndpoint = bridge.browser.agentEndpoint;
  return {
    agentEndpoint: (input) => agentEndpoint(input),
    setBrowserCdpUrl: (cdpUrl) => getOmpSettingsApi().setOmpSetting({ path: "browser.cdpUrl", value: cdpUrl }),
    readBackendSelection: async () => {
      const api = getOmpSettingsApi();
      const [relay, enabled] = await Promise.all([
        api.getOmpSettingValue("browser.relay"),
        api.getOmpSettingValue("browser.enabled"),
      ]);
      return {
        relay: relay.state === "available" ? relay.value : undefined,
        enabled: enabled.state === "available" ? enabled.value : undefined,
      };
    },
  };
}

export function BrowserSteeringGuard({
  threadId,
  split,
}: {
  readonly threadId: ThreadId;
  readonly split: boolean;
}) {
  useEffect(() => {
    const deps = liveDeps();
    if (!deps) return;
    reconcileBrowserSteering(deps, { split }, threadId).catch(() => {
      // Steering is best-effort hygiene; the route must mount regardless.
    });
  }, [threadId, split]);
  return null;
}
