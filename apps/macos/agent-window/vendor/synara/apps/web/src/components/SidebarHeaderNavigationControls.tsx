// FILE: SidebarHeaderNavigationControls.tsx
// Purpose: Single source for the leading chrome cluster (sidebar toggle + route arrows).
// Layer: Shared web shell chrome
// Depends on: Sidebar state plus AppNavigationButtons

import { AppNavigationButtons } from "./AppNavigationButtons";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { cn } from "~/lib/utils";
import { isIdeEmbeddedRuntime } from "../ide-mode";

/**
 * The leading chrome cluster: the sidebar toggle followed by the route nav arrows.
 *
 * It renders in two distinct places — inside the OPEN sidebar header (where it
 * slides off-canvas with the sidebar) and in host top bars AFTER an off-canvas
 * close (chat/settings/plugin headers). Keeping it in ONE component is
 * what makes those two states visually identical: same trigger tone, icon size,
 * and gap, so toggling the sidebar never changes the button's brightness or the
 * cluster spacing. The wrapper layout (hidden/md:flex, ml-auto, …) varies per host,
 * so it is passed in via `className`; the inner controls stay constant.
 */
export function SidebarLeadingControls({ className }: { className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]", className)}>
      <SidebarTrigger
        className="size-7 shrink-0 text-muted-foreground/75 hover:text-foreground"
        aria-label="Toggle thread sidebar"
      />
      <AppNavigationButtons className="ms-0" />
    </div>
  );
}

/**
 * Host-header variant of {@link SidebarLeadingControls}: only appears once the
 * in-sidebar cluster is gone (sidebar collapsed, or mobile where the drawer floats
 * over content). When the sidebar is open on desktop the in-sidebar header owns the
 * cluster, so this renders nothing to avoid a duplicate set of controls.
 */
export function SidebarHeaderNavigationControls() {
  const { isMobile, open, shellNavigationOwner } = useSidebar();

  // The IDE owns its compact chrome. Do not leave a hidden placeholder or a
  // second trigger in route headers when the standalone agent shell is embedded.
  if (isIdeEmbeddedRuntime()) {
    return null;
  }

  if (shellNavigationOwner) {
    // Cedia (item 71): toggle and arrows live only in the fixed shell, static
    // in both states — mounting anything here at toggle time snapped the title
    // while the geometry animated (flicker). The title clears the floating
    // cluster with animated padding (see ChatHeader) instead of mount swaps.
    // Mobile keeps the drawer pattern (null).
    return null;
  }

  if (!isMobile && open) {
    return null;
  }

  return <SidebarLeadingControls />;
}
