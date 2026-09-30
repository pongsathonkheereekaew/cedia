// FILE: useNowMs.ts
// Purpose: Shared lightweight wall-clock tick for live elapsed labels.
// Layer: Web hook
// Exports: useNowMs

import { useEffect, useState } from "react";
import { startVisibleInterval } from "../lib/visibleInterval";

export function useNowMs(enabled: boolean, intervalMs = 1_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // Presentation-only ticking (see lib/visibleInterval): suspends while the
    // document is hidden and refreshes once on resume. Ported from upstream
    // #1258; never use this hook for provider work or transport liveness.
    return startVisibleInterval(() => {
      setNowMs(Date.now());
    }, intervalMs);
  }, [enabled, intervalMs]);

  return nowMs;
}
