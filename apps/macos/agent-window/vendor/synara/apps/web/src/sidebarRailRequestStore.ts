// FILE: sidebarRailRequestStore.ts
// Purpose: Lets the standalone 48px icon rail (mounted by the shell outside the
//          sidebar card) ask the thread sidebar to run rail actions. The sidebar
//          keeps owning the flyout, search palette, activity view, and new-thread
//          target; the rail only sends requests. Mirrors sidebarSearchRequestStore.
// Layer: Web UI state store

import { create } from "zustand";

import type { RailFlyoutSection } from "./components/Sidebar.railFlyout.logic";

export type SidebarRailRequestKind =
  | "flyout-hover"
  | "flyout-leave"
  | "section-click"
  | "new-thread-hover"
  | "new-thread"
  | "search"
  | "activity"
  | "code-review"
  | "settings"
  | "ensure-detail-open";

export interface SidebarRailRequest {
  // Monotonic nonce; the Sidebar dispatches the request when it changes.
  nonce: number;
  kind: SidebarRailRequestKind;
  section: RailFlyoutSection | null;
}

interface SidebarRailRequestState {
  request: SidebarRailRequest;
  sendRailRequest: (kind: SidebarRailRequestKind, section?: RailFlyoutSection) => void;
}

export const useSidebarRailRequestStore = create<SidebarRailRequestState>((set) => ({
  request: { nonce: 0, kind: "flyout-leave", section: null },
  sendRailRequest: (kind, section) => {
    set((state) => ({
      request: { nonce: state.request.nonce + 1, kind, section: section ?? null },
    }));
  },
}));

export function requestSidebarRail(
  kind: SidebarRailRequestKind,
  section?: RailFlyoutSection,
): void {
  useSidebarRailRequestStore.getState().sendRailRequest(kind, section);
}
