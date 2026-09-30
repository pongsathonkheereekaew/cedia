// FILE: RemoteDevicesPanel.tsx
// Purpose: The selected remote path's owner surface (§6.4 "General > Remote", §6.5). It reads
//          the loopback gateway's own state, issues one short-lived enrollment code, and lists
//          the paired devices with the single action that ends a pairing. It never stores a
//          credential and never shows a code the host did not just mint.
// Layer: Settings panel
// Exports: RemoteDevicesPanel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  SettingsEmptyState,
  SettingsListRow,
  SettingsSection,
  SettingsSectionShell,
} from "./SettingsPanelPrimitives";
import {
  issueRemoteEnrollmentMutationOptions,
  remoteDevicesQueryKeys,
  remoteDevicesQueryOptions,
  remoteGatewayStateQueryOptions,
  revokeRemoteDeviceMutationOptions,
  type RemoteEnrollmentOffer,
} from "../../lib/remoteDevicesReactQuery";

/** The enrolment answer, kept only in this panel's state: it is shown once and then discarded. */
function EnrollmentOfferCard({ offer }: { offer: RemoteEnrollmentOffer }) {
  const expires = new Date(offer.expiresAt);
  return (
    <SettingsSectionShell title="Enrollment code">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          Read this out or scan it on the device you are pairing. It works once and expires at{" "}
          {Number.isNaN(expires.getTime()) ? offer.expiresAt : expires.toLocaleTimeString()}.
        </p>
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div className="font-mono text-lg tracking-widest">{offer.pin}</div>
          <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{offer.code}</div>
        </div>
        <p className="text-xs text-muted-foreground">
          Cedia does not keep this code. Closing this panel discards it; ask for another one if it
          expires.
        </p>
      </div>
    </SettingsSectionShell>
  );
}

export function RemoteDevicesPanel({ active = true }: { readonly active?: boolean }) {
  const [deviceName, setDeviceName] = useState("");
  const [offer, setOffer] = useState<RemoteEnrollmentOffer | undefined>(undefined);
  const queryClient = useQueryClient();
  const gateway = useQuery({ ...remoteGatewayStateQueryOptions(), enabled: active });
  const devices = useQuery({ ...remoteDevicesQueryOptions(), enabled: active && gateway.data?.state === "available" });
  const issue = useMutation(issueRemoteEnrollmentMutationOptions());
  const revoke = useMutation({
    ...revokeRemoteDeviceMutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: remoteDevicesQueryKeys.devices() });
    },
  });

  if (gateway.data?.state === "unavailable") {
    return (
      <SettingsSection title="Remote">
        <SettingsEmptyState layout="status">{gateway.data.reason}</SettingsEmptyState>
      </SettingsSection>
    );
  }

  if (gateway.isLoading || !gateway.data) {
    return (
      <SettingsSection title="Remote">
        <SettingsEmptyState layout="status">
          {gateway.isError ? "This host did not answer with its remote state." : "Reading the remote gateway…"}
        </SettingsEmptyState>
      </SettingsSection>
    );
  }

  const paired = devices.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Remote">
        <SettingsListRow
          title="Gateway"
          description={`This Mac serves the remote client on ${gateway.data.url}. Point Tailscale Serve at that address to reach it from your tailnet.`}
          actions={<span className="text-xs text-muted-foreground">Tailscale gateway</span>}
        />
        <SettingsListRow
          title="Enroll a device"
          description="Ask for a short-lived code, then enter it on the device you are pairing. Each code works once."
          actions={
            <div className="flex items-center gap-2">
              <Input
                aria-label="Device name"
                className="w-40"
                placeholder="Device name"
                value={deviceName}
                onChange={event => setDeviceName(event.target.value)}
              />
              <Button
                disabled={issue.isPending}
                onClick={() => {
                  issue.mutate(deviceName.trim() || "Remote device", {
                    onSuccess: result => setOffer(result),
                  });
                }}
              >
                {issue.isPending ? "Creating…" : "Create code"}
              </Button>
            </div>
          }
        />
        {issue.isError ? (
          <SettingsEmptyState layout="status" tone="destructive">
            {issue.error instanceof Error ? issue.error.message : "The host refused to issue a code."}
          </SettingsEmptyState>
        ) : null}
      </SettingsSection>

      {offer ? <EnrollmentOfferCard offer={offer} /> : null}

      <SettingsSectionShell title="Paired devices">
        <div className="flex flex-col">
          {devices.isLoading ? (
            <SettingsEmptyState layout="status">Reading paired devices…</SettingsEmptyState>
          ) : paired.length === 0 ? (
            <SettingsEmptyState layout="status">
              No device is paired yet. Create a code above and enter it on the device.
            </SettingsEmptyState>
          ) : (
            paired.map(device => (
              <SettingsListRow
                key={device.id}
                title={device.name}
                description={
                  device.revokedAt
                    ? "This device is revoked and can no longer call this Mac."
                    : device.role === "owner"
                      ? "Local owner. This Mac cannot be revoked."
                      : "Paired controller"
                }
                actions={
                  device.revokedAt || device.role === "owner" ? null : (
                    <Button
                      variant="destructive"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(device.id)}
                    >
                      Revoke
                    </Button>
                  )
                }
              />
            ))
          )}
        </div>
      </SettingsSectionShell>

      {revoke.isError ? (
        <SettingsEmptyState layout="status" tone="destructive">
          {revoke.error instanceof Error ? revoke.error.message : "The host refused to revoke that device."}
        </SettingsEmptyState>
      ) : null}
    </div>
  );
}
