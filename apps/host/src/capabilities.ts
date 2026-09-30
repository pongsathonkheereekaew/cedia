import type { CapabilityDescriptor, CapabilitySnapshot, OmpCapabilitySnapshot } from "../../../packages/protocol/src/index.ts";
import { ompCapabilityRows } from "./omp-capabilities.ts";

/** What this particular host process can actually do beyond the OMP runtime's own table. */
export interface CapabilityContext {
  /** The selected remote path's local end, when this host started one (§6.5). */
  readonly gateway?: { readonly url: string };
}

/**
 * Aggregate capability status.
 *
 * A row says what a real handler behind it can do right now, in this process. `available` means
 * the operation runs if a caller asks; `dependency_unavailable` means Cedia carries it and this
 * process lacks what it needs (a running runtime, a packaged web client); `integration_missing`
 * means no Cedia handler exists at all. The three are not interchangeable: only the last removes
 * a row from the working UI (§3.B), so a capability that exists but is idle must say so instead.
 */
const registry: readonly CapabilityDescriptor[] = [
  { id: "desktop.host-lifecycle", availability: "available", scope: "app", operations: ["adopt", "shutdown"] },
  { id: "omp.execution", availability: "available", scope: "session", operations: ["start", "send", "steer", "stop"] },
  // The inventory, the per-key disposition, the revision-checked write and the rendered
  // destination all exist; what this row reports is whether a runtime is there to answer. A row
  // that claimed "not implemented" while the surface is on screen was the stale claim.
  { id: "omp.settings", availability: "dependency_unavailable", scope: "global", reason: "No OMP runtime is running, so the settings inventory has nothing to read. Start a task and the runtime's own schema becomes readable.", operations: [] },
  { id: "omp.live-cli-attach", availability: "integration_missing", scope: "session", reason: "The pinned OMP runtime has no qualified live-owner attach endpoint.", operations: [] },
  { id: "remote.tailscale", availability: "dependency_unavailable", scope: "device", reason: "This build carries no remote web client, so the loopback gateway did not start.", operations: [] },
  { id: "app.automations", availability: "integration_missing", scope: "app", reason: "Cedia has no automation backend; the sidebar row stays off until a host schedule owner exists.", operations: [] },
  { id: "voice.speech-to-text", availability: "integration_missing", scope: "device", reason: "Speech-to-text is deferred by the product scope.", operations: [] },
];

export function capabilitySnapshot(runtime?: OmpCapabilitySnapshot, context: CapabilityContext = {}): CapabilitySnapshot {
  // The gateway row is the one row whose answer changes with how this process was started, so it
  // is decided here rather than copied from the static list.
  const capabilities: CapabilityDescriptor[] = registry.map(item => ({ ...item, operations: [...item.operations] }));
  const gatewayRow = capabilities.findIndex(item => item.id === "remote.tailscale");
  if (context.gateway !== undefined && gatewayRow >= 0) {
    const { reason: _idleReason, ...rest } = capabilities[gatewayRow]!;
    capabilities[gatewayRow] = { ...rest, availability: "available", operations: ["enroll", "session", "logout"] };
  }
  // A live runtime is what the settings row was waiting for: the inventory, one value and a
  // revision-checked write are all reachable through it, so the row stops saying "no runtime is
  // running" the moment one answers. Without one it keeps that reason.
  if (runtime !== undefined) {
    const settingsRow = capabilities.findIndex(item => item.id === "omp.settings");
    if (settingsRow >= 0) {
      const { reason: _noRuntimeReason, ...rest } = capabilities[settingsRow]!;
      capabilities[settingsRow] = { ...rest, availability: "available", operations: ["settings.keys.list", "settings.get", "settings.set"] };
    }
  }
  if (runtime !== undefined) {
    for (const row of ompCapabilityRows(runtime)) {
      const existing = capabilities.findIndex(item => item.id === row.id);
      if (existing < 0) capabilities.push({ ...row, operations: [...row.operations] });
      else capabilities[existing] = { ...row, operations: [...row.operations] };
    }
  }
  return {
    protocolVersion: 1,
    revision: "cedia-capabilities-v1",
    capabilities,
    ...(runtime === undefined ? {} : {
      omp: { state: "available" as const, capabilityRevision: runtime.capabilityRevision, ompRevision: runtime.ompRevision },
      ompCapabilityRevision: runtime.capabilityRevision,
      ompRevision: runtime.ompRevision,
    }),
  };
}

export function isCapabilityAvailable(id: string): boolean {
  return registry.some(item => item.id === id && item.availability === "available");
}
