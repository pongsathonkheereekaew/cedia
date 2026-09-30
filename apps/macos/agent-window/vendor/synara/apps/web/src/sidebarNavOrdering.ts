// FILE: sidebarNavOrdering.ts
// Purpose: Keeps the primary sidebar nav (New thread, Automations) order and visibility
//          stable across the sidebar and persisted settings.
// Layer: Web settings utility
// Exports: nav item ids, default order, and normalization helpers.
// Cedia scope cut (§10 item 60): Kanban and Pull requests had no OMP/host source, so their
// nav ids leave the type — persisted orders normalize them away. Automations is gated on the
// host capability snapshot (§3.B): the row is absent while the host reports it as
// integration-missing, and keeps its honest disabled explanation when no snapshot has loaded.

import { capabilityState, isCapabilityVisible, type HostCapability } from "./capabilityGate";

export const SIDEBAR_NAV_ITEM_IDS = ["newThread", "automations"] as const;

export type SidebarNavItemId = (typeof SIDEBAR_NAV_ITEM_IDS)[number];

export const DEFAULT_SIDEBAR_NAV_ORDER: readonly SidebarNavItemId[] = SIDEBAR_NAV_ITEM_IDS;

const SIDEBAR_NAV_ITEM_ID_SET: ReadonlySet<SidebarNavItemId> = new Set(SIDEBAR_NAV_ITEM_IDS);

export function isSidebarNavItemId(value: string): value is SidebarNavItemId {
  return SIDEBAR_NAV_ITEM_ID_SET.has(value as SidebarNavItemId);
}

export function normalizeHiddenSidebarNavItems(
  hiddenItems: ReadonlyArray<string>,
): SidebarNavItemId[] {
  const seen = new Set<SidebarNavItemId>();
  const result: SidebarNavItemId[] = [];
  for (const candidate of hiddenItems) {
    if (isSidebarNavItemId(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}

export function normalizeSidebarNavOrder(order: ReadonlyArray<string>): SidebarNavItemId[] {
  const seen = new Set<SidebarNavItemId>();
  const result: SidebarNavItemId[] = [];
  for (const candidate of order) {
    if (isSidebarNavItemId(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  // Items shipped after the user persisted an order still surface, appended at the end.
  for (const item of DEFAULT_SIDEBAR_NAV_ORDER) {
    if (!seen.has(item)) {
      result.push(item);
    }
  }
  return result;
}

/** The host capability that backs each nav row. A row without one is core Cedia UI. */
export const SIDEBAR_NAV_CAPABILITY_IDS: Readonly<Partial<Record<SidebarNavItemId, string>>> = {
  automations: "app.automations",
};

/**
 * Whether a nav row belongs in the sidebar for the host's current capability snapshot.
 *
 * `undefined` means no snapshot has loaded (or the host does not advertise the id), and the
 * row keeps its existing behaviour: an honest disabled row is better than a row that
 * disappears because the host was briefly unreachable.
 */
export function sidebarNavItemVisible(
  id: SidebarNavItemId,
  capabilities: readonly HostCapability[] | undefined,
): boolean {
  return isCapabilityVisible(capabilityState(capabilities, SIDEBAR_NAV_CAPABILITY_IDS[id]));
}
