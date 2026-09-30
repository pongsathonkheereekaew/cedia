// FILE: PrewalkArmedChip.tsx
// Purpose: Show the runtime's prewalk arming beside the composer model controls: the
//          session hands off to its prewalk model at the next edit, so the picker area
//          names it instead of letting the switch surprise. Reads the session-scoped
//          prewalk state like the other composer surfaces; renders nothing unless armed.
// Layer: Chat composer UI

import { useQuery } from "@tanstack/react-query";

import { serverPrewalkQueryOptions } from "../../lib/serverReactQuery";

/** Pure armed indicator used by the hook-backed chip and renderer tests. */
export function PrewalkArmedChipView({ armed }: { readonly armed: boolean }) {
  if (!armed) return null;
  return (
    <span
      title="Prewalk handoff armed: the session switches model at the next edit"
      data-testid="cedia-prewalk-chip"
      className="truncate text-[11px] text-muted-foreground"
    >
      prewalk · armed
    </span>
  );
}

export function PrewalkArmedChip({ sessionId }: { readonly sessionId: string | undefined }) {
  const query = useQuery(serverPrewalkQueryOptions(sessionId ?? "", Boolean(sessionId)));
  const data = query.data;
  if (!data || data.state !== "available" || !data.armed) return null;
  return <PrewalkArmedChipView armed />;
}
