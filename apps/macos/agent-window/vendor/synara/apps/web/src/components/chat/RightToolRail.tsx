// FILE: RightToolRail.tsx
// Purpose: Persistent right-edge tool rail (CEDIA-PLAN §3.E, item 71).
// Layer: Chat right-dock chrome
// Depends on: dock launcher items (availability-filtered by the caller).

import type { RightDockPaneKind } from "~/rightDockStore.logic";
import { cn } from "~/lib/utils";
import { Loader2Icon } from "~/lib/icons";
import { SidebarIconButton } from "../SidebarIconButton";
import type { RightDockLauncherItem } from "./rightDockPaneMeta";

/**
 * Launch access for the existing dock tools. Visible with the panel open or
 * closed: picking an icon opens that tool, picking another switches to it,
 * and picking the active icon collapses the panel. Pane resources themselves
 * stay task-scoped inside the dock store; this rail only selects kinds.
 */
export function RightToolRail({
  items,
  activeKind,
  onPick,
  pendingKind,
}: {
  items: readonly RightDockLauncherItem[];
  pendingKind?: RightDockPaneKind | null;
  /** Currently visible tool kind, or null while the panel is closed. */
  activeKind: RightDockPaneKind | null;
  onPick: (kind: RightDockPaneKind) => void;
}) {
  return (
    <div
      data-right-tool-rail
      data-testid="cedia-right-rail"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      // Same strip spec as the left rail (CediaLeftIconRail in Sidebar.tsx):
      // w-12 column, gap-1, py-2 — icons align 1:1 with the left rail.
      className="relative z-[1] flex w-12 shrink-0 flex-col items-center gap-1 overflow-hidden border-0 bg-transparent py-2 [-webkit-app-region:no-drag]"
    >
      {/* No toggle here: the window header owns the single Toggle right
          sidebar control (CediaWindowHeaderDockToggle in _chat.tsx). A second
          toggle icon at the rail head duplicates it and breaks the icon grid. */}
      {items.map((item) => {
        const active = item.kind === activeKind;
        const pending = item.kind === pendingKind;
        return (
          <SidebarIconButton
            key={item.kind}
            icon={pending ? Loader2Icon : item.Icon}
            label={pending ? `Opening ${item.label}…` : item.label}
            iconClassName={cn("size-[18px]", pending && "animate-spin")}
            aria-busy={pending}
            disabled={pending}
            size="header"
            aria-pressed={active}
            tooltip={pending ? `Opening ${item.label}…` : item.label}
            tooltipSide="left"
            className={cn(
              // Same hitbox as the left rail: size-8 box + 18px glyph
              // (CediaLeftIconRail). The old w-full stretched the box to the
              // strip edge and broke icon alignment with the left rail.
              "size-8 [-webkit-app-region:no-drag]",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground/70 hover:text-foreground",
            )}
            onClick={() => onPick(item.kind)}
          />
        );
      })}
    </div>
  );
}
