// FILE: CapabilityStatusPanel.tsx
// Purpose: Cedia's capability status destination (CEDIA-PLAN §3.D). It lists what the host
//          reports as available, what needs setup, and what is not implemented yet - the rows
//          that are therefore absent from the working UI (§3.B). Developer detail stays in
//          the plan and the dated evidence, not here.
// Layer: Settings UI components

import { useQuery } from "@tanstack/react-query";
import { capabilityLabel, type HostCapability } from "../capabilityGate";
import { serverCapabilitiesQueryOptions } from "../lib/serverReactQuery";
import { SettingsEmptyState, SettingsRow, SettingsSection } from "./settings/SettingsPanelPrimitives";

const GROUPS: ReadonlyArray<{ availability: HostCapability["availability"]; title: string }> = [
  { availability: "available", title: "Available" },
  { availability: "dependency_unavailable", title: "Needs setup" },
  { availability: "integration_missing", title: "Not implemented yet" },
];

export function CapabilityStatusPanel() {
  const query = useQuery(serverCapabilitiesQueryOptions());
  const rows = query.data;

  if (!rows) {
    return (
      <SettingsSection title="Capability status">
        <SettingsEmptyState layout="status">
          {query.isLoading
            ? "Reading what this Cedia host supports…"
            : "This host did not report its capabilities. Working rows keep their normal behaviour until it does."}
        </SettingsEmptyState>
      </SettingsSection>
    );
  }

  return (
    <>
      {GROUPS.map((group) => {
        const entries = rows.filter((row) => row.availability === group.availability);
        if (entries.length === 0) {
          return null;
        }
        return (
          <SettingsSection key={group.availability} title={group.title}>
            {entries.map((row) => (
              <SettingsRow
                key={row.id}
                title={capabilityLabel(row.id)}
                description={row.reason ?? group.title}
                status={<span className="text-xs text-muted-foreground">{group.availability === "available" ? "Ready" : group.availability === "dependency_unavailable" ? "Needs setup" : "Pending"}</span>}
              />
            ))}
          </SettingsSection>
        );
      })}
    </>
  );
}
