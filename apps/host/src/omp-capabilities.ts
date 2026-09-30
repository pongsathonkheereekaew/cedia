import { OmpClientStateError, type OmpRpcClient } from "../../../packages/omp-adapter/src/client.ts";
import type { CediaUiCommandType, RpcAck } from "../../../packages/omp-adapter/src/types.ts";
import {
  OmpCapabilityValidationError,
  parseOmpCapabilitySnapshot,
  type CapabilityDescriptor,
  type OmpCapabilitySnapshot,
} from "../../../packages/protocol/src/index.ts";

export { OmpCapabilityValidationError } from "../../../packages/protocol/src/index.ts";

/** The only adapter surface this owner needs to inspect runtime metadata. */
export type OmpCapabilityClient = Pick<OmpRpcClient, "requestCedia">;

export class OmpCapabilityRevisionError extends Error {
  readonly name = "OmpCapabilityRevisionError";
  readonly code = "omp_capability_revision_mismatch" as const;
  readonly expectedRevision: string;
  readonly actualRevision: string;

  constructor(expectedRevision: string, actualRevision: string) {
    super(`The OMP capability table changed: expected ${expectedRevision}, received ${actualRevision}`);
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

/** Read a live table without starting a runtime or falling back to a guessed table. */
export async function readOmpCapabilities(client: OmpCapabilityClient, expectedRevision?: string): Promise<OmpCapabilitySnapshot | undefined> {
  let ack: RpcAck;
  try {
    // The adapter's command union is extended by the pinned-runtime integration. Keeping the
    // cast local lets this owner compile against an older checkout while preserving the typed
    // request at the adapter boundary once that command is present.
    ack = await client.requestCedia("cedia_get_capabilities" as CediaUiCommandType, {});
  } catch (error) {
    if (error instanceof OmpClientStateError) return undefined;
    throw error;
  }
  let snapshot: OmpCapabilitySnapshot;
  try {
    snapshot = parseOmpCapabilitySnapshot(ack.data);
  } catch (error) {
    if (error instanceof Error && error.name === "OmpCapabilityValidationError") throw error;
    throw new OmpCapabilityValidationError(error instanceof Error ? error.message : String(error));
  }
  if (expectedRevision !== undefined && snapshot.capabilityRevision !== expectedRevision)
    throw new OmpCapabilityRevisionError(expectedRevision, snapshot.capabilityRevision);
  return snapshot;
}

export const readOmpCapabilitySnapshot = readOmpCapabilities;

/** Project OMP descriptors into the existing host aggregate's vocabulary. */
export function ompCapabilityRows(snapshot: OmpCapabilitySnapshot): readonly CapabilityDescriptor[] {
  return snapshot.capabilities.map(descriptor => ({
    id: descriptor.id,
    availability: descriptor.state,
    scope: descriptor.scope,
    ...(descriptor.reason === undefined ? {} : { reason: descriptor.reason }),
    operations: descriptor.state === "available" ? [descriptor.id] : [],
  }));
}
