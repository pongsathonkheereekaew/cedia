// FILE: sidebarSearchRequestStore.ts
// Purpose: Lets header chrome outside the Sidebar (the ChatHeader's centered
//          search field from the owner mockup) ask the thread sidebar to open
//          its search palette. The palette itself stays owned by the Sidebar.
// Layer: Web UI state store

import { create } from "zustand";

interface SidebarSearchRequestState {
  // Monotonic nonce; the Sidebar opens its search palette when it changes.
  requestNonce: number;
  requestSearch: () => void;
}

export const useSidebarSearchRequestStore = create<SidebarSearchRequestState>((set) => ({
  requestNonce: 0,
  requestSearch: () => {
    set((state) => ({ requestNonce: state.requestNonce + 1 }));
  },
}));

export function requestSidebarSearch(): void {
  useSidebarSearchRequestStore.getState().requestSearch();
}
