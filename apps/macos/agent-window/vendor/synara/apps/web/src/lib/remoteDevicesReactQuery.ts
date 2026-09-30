// FILE: remoteDevicesReactQuery.ts
// Purpose: Query and mutation options for the selected remote path (§6.5): the loopback
//          gateway's state, one short-lived enrollment code, and the paired devices that code
//          became. Nothing here stores a credential: the code is displayed once and the device
//          list is a read of the host's own record.
// Layer: Host route data

import { mutationOptions, queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export type RemoteGatewayState =
  | { readonly state: "available"; readonly url: string }
  | { readonly state: "unavailable"; readonly reason: string };

export interface RemoteEnrollmentOffer {
  readonly code: string;
  readonly pin: string;
  readonly expiresAt: string;
}

export interface RemoteDevice {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly revokedAt?: string;
}

export interface RemoteDevicesApi {
  readonly getRemoteGatewayState: () => Promise<RemoteGatewayState>;
  readonly issueRemoteEnrollment: (name: string) => Promise<RemoteEnrollmentOffer>;
  readonly listDevices: () => Promise<readonly RemoteDevice[]>;
  readonly revokeDevice: (deviceId: string) => Promise<unknown>;
}

/** The bridge as a typed surface. A missing method is reported, never faked into an empty list. */
export function getRemoteDevicesApi(): RemoteDevicesApi {
  const api = ensureNativeApi() as unknown as { cedia?: Partial<RemoteDevicesApi> };
  const candidate = api.cedia;
  if (
    typeof candidate?.getRemoteGatewayState !== "function" ||
    typeof candidate?.issueRemoteEnrollment !== "function" ||
    typeof candidate?.listDevices !== "function" ||
    typeof candidate?.revokeDevice !== "function"
  ) {
    throw new Error("Cedia remote devices bridge is unavailable.");
  }
  return candidate as RemoteDevicesApi;
}

export const remoteDevicesQueryKeys = {
  all: ["cedia", "remote-devices"] as const,
  gateway: () => ["cedia", "remote-devices", "gateway"] as const,
  devices: () => ["cedia", "remote-devices", "devices"] as const,
};

export function remoteGatewayStateQueryOptions() {
  return queryOptions({
    queryKey: remoteDevicesQueryKeys.gateway(),
    queryFn: () => getRemoteDevicesApi().getRemoteGatewayState(),
    // The gateway's state is fixed once this host process starts, but a window can outlive a host
    // restart behind the gateway, so a focus after a short window re-reads it.
    staleTime: 30_000,
    retry: false,
  });
}

export function remoteDevicesQueryOptions() {
  return queryOptions({
    queryKey: remoteDevicesQueryKeys.devices(),
    queryFn: () => getRemoteDevicesApi().listDevices(),
    staleTime: 5_000,
    retry: false,
  });
}

export function issueRemoteEnrollmentMutationOptions() {
  return mutationOptions({
    mutationKey: ["cedia", "remote-devices", "enrollment"] as const,
    mutationFn: (name: string) => getRemoteDevicesApi().issueRemoteEnrollment(name),
  });
}

export function revokeRemoteDeviceMutationOptions() {
  return mutationOptions({
    mutationKey: ["cedia", "remote-devices", "revoke"] as const,
    mutationFn: (deviceId: string) => getRemoteDevicesApi().revokeDevice(deviceId),
  });
}
