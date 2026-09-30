// FILE: capabilityGate.ts
// Purpose: Consume the host's capability snapshot (CEDIA-PLAN §2.2/§3.B/§3.D) instead of
//          guessing from an empty catalog. A row the host reports as integration-missing is
//          absent from the working UI; an unknown or unloaded snapshot changes nothing.
// Layer: Web settings utility
// Exports: snapshot parsing, per-id state, and the visibility rule.

export type HostCapabilityAvailability = "available" | "dependency_unavailable" | "integration_missing";

export interface HostCapability {
  readonly id: string;
  readonly availability: HostCapabilityAvailability;
  readonly scope?: string;
  readonly reason?: string;
}

/**
 * What a row can say about one capability id.
 *
 * `unknown` covers both "no snapshot yet" and "the host does not advertise this id": the UI
 * keeps its current honest behaviour rather than hiding or enabling something on a guess.
 */
export type CapabilityState = "unknown" | "available" | "blocked" | "missing";

const AVAILABILITIES: ReadonlySet<string> = new Set<string>([
  "available",
  "dependency_unavailable",
  "integration_missing",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the host's capability list.
 *
 * Only recognised fields survive: an unparseable answer, an unknown availability or an
 * entry without an id yields `unknown` for that id, which is deliberately not the same as
 * "missing". The host's own vocabulary is the contract, so a future value cannot silently
 * hide a working row.
 */
export function parseCapabilitySnapshot(value: unknown): readonly HostCapability[] | undefined {
  if (!isRecord(value)) return undefined;
  const rows = value.capabilities;
  if (!Array.isArray(rows)) return undefined;
  const parsed: HostCapability[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = row.id;
    const availability = row.availability;
    if (typeof id !== "string" || id.length === 0 || id.length > 128) continue;
    if (typeof availability !== "string" || !AVAILABILITIES.has(availability)) continue;
    parsed.push({
      id,
      availability: availability as HostCapabilityAvailability,
      ...(typeof row.scope === "string" ? { scope: row.scope } : {}),
      ...(typeof row.reason === "string" && row.reason.length > 0 ? { reason: row.reason } : {}),
    });
  }
  return parsed;
}

export function capabilityState(
  capabilities: readonly HostCapability[] | undefined,
  id: string | undefined,
): CapabilityState {
  if (!id || !capabilities) return "unknown";
  const row = capabilities.find(candidate => candidate.id === id);
  if (!row) return "unknown";
  switch (row.availability) {
    case "available": return "available";
    // Implemented, but its dependency is not present. The row may stay, and it has to
    // explain itself with the host's reason (§2.8), so it is never an empty success.
    case "dependency_unavailable": return "blocked";
    case "integration_missing": return "missing";
  }
}

/** A capability the host reports as integration-missing is absent from working menus (§3.B). */
export function isCapabilityVisible(state: CapabilityState): boolean {
  return state !== "missing";
}

/** English label for a host capability id, for the status list and row reasons. */
export function capabilityLabel(id: string): string {
  const labels: Readonly<Record<string, string>> = {
    "desktop.host-lifecycle": "Application and host lifetime",
    "omp.execution": "OMP execution and control",
    "omp.settings": "OMP settings",
    "omp.live-cli-attach": "Live CLI session attach",
    "remote.tailscale": "Remote access over Tailscale",
    "app.automations": "Automations",
    "voice.speech-to-text": "Speech to text",
  };
  return labels[id] ?? id;
}
