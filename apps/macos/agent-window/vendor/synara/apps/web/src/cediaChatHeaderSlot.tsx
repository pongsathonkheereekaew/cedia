// Cedia single header: module-level slot so the ChatView pane (inside
// <Outlet />) can publish its real ChatHeader element to the route-level
// window header above the cards. The route shell never unmounts under pane
// navigations, so the slot survives them. No context: ChatView <-> _chat.tsx
// would be a route/component import cycle.

import { useEffect, useState, type ReactNode } from "react";

type SlotState = {
  node: ReactNode;
};

const state: SlotState = { node: null };
const listeners = new Set<() => void>();

function publish(node: ReactNode) {
  state.node = node;
  for (const listener of listeners) listener();
}

export function useCediaChatHeaderSlot(): ReactNode {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state.node;
}

/** Pane-side registration: ChatView publishes its ChatHeader element each render. */
export function CediaChatHeaderPortal({ node }: { node: ReactNode }) {
  useEffect(() => {
    publish(node);
    return () => publish(null);
  }, [node]);
  return null;
}
