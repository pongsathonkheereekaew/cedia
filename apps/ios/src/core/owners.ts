import { isRecord, nonEmptyString } from "./types.ts";

/** Owner probe states served by GET /v1/owners (apps/host/src/owner-endpoint.ts). */
export type OwnerProbeState = "attached" | "absent" | "stale" | "conflict";

export type OwnerEndpointMode = "controller" | "inspect_only";

export interface OwnerIdentity {
  readonly sessionId: string;
  readonly incarnation: string;
  readonly pid: number;
  readonly ownerStartedAt: string;
  readonly mode: OwnerEndpointMode;
}

export interface OwnerEntry {
  readonly taskId: string;
  readonly title: string;
  readonly archived: boolean;
  readonly state: OwnerProbeState;
  readonly reason?: string;
  readonly identity?: OwnerIdentity;
}

export interface OwnerListing {
  readonly owners: readonly OwnerEntry[];
  readonly truncated: boolean;
}

function parseMode(value: unknown): OwnerEndpointMode | undefined {
  return value === "controller" || value === "inspect_only" ? value : undefined;
}

function parseIdentity(value: unknown): OwnerIdentity | undefined {
  if (!isRecord(value)) return undefined;
  const mode = parseMode(value.mode);
  if (!nonEmptyString(value.sessionId) || !nonEmptyString(value.incarnation) || !nonEmptyString(value.ownerStartedAt)) return undefined;
  if (typeof value.pid !== "number" || !Number.isSafeInteger(value.pid)) return undefined;
  // A record without mode predates inspect-only owners and is controller-capable.
  return { sessionId: value.sessionId, incarnation: value.incarnation, pid: value.pid, ownerStartedAt: value.ownerStartedAt, mode: mode ?? "controller" };
}

function parseEntry(value: unknown): OwnerEntry | undefined {
  if (!isRecord(value)) return undefined;
  const state = value.state;
  if (state !== "attached" && state !== "absent" && state !== "stale" && state !== "conflict") return undefined;
  if (!nonEmptyString(value.taskId) || !nonEmptyString(value.title) || typeof value.archived !== "boolean") return undefined;
  const reason = nonEmptyString(value.reason) ? value.reason : undefined;
  if (value.reason !== undefined && reason === undefined) return undefined;
  if (state === "attached") {
    const identity = parseIdentity(value.identity);
    if (!identity) return undefined;
    return { taskId: value.taskId, title: value.title, archived: value.archived, state, ...(reason === undefined ? {} : { reason }), identity };
  }
  if ((state === "stale" || state === "conflict") && reason === undefined) return undefined;
  return { taskId: value.taskId, title: value.title, archived: value.archived, state, ...(reason === undefined ? {} : { reason }) };
}

/** Strict parser for the GET /v1/owners body. Unknown shapes are refused, never rendered. */
export function parseOwnerListing(body: unknown): OwnerListing {
  if (!isRecord(body) || !Array.isArray(body.owners) || typeof body.truncated !== "boolean") {
    throw new Error("Cedia host returned an invalid owner listing");
  }
  return { owners: body.owners.map(parseEntry).filter(entry => entry !== undefined), truncated: body.truncated };
}

export interface OwnerRowPresentation {
  /** Short badge: Live, View only, Ended, Elsewhere, or Idle. */
  readonly badge: string;
  /** One-line explanation; stale/conflict carry the host's bounded reason. */
  readonly detail: string;
  /** Starting the task adopts a controller-capable live owner; anything else must not offer it. */
  readonly canAttach: boolean;
  /** Opening navigates to the task transcript, which never needs the owner. */
  readonly canOpen: boolean;
}

/**
 * The panel lists only tasks with something to discover: a live owner, a stale
 * record, or a conflict. Idle tasks without an owner stay in the task list.
 */
export function isDiscoverableOwner(entry: OwnerEntry): boolean {
  return entry.state !== "absent";
}

export function ownerRowPresentation(entry: OwnerEntry): OwnerRowPresentation {
  switch (entry.state) {
    case "attached":
      if (entry.identity?.mode === "inspect_only") {
        return { badge: "View only", detail: "Owned for inspection elsewhere; starting here is refused", canAttach: false, canOpen: true };
      }
      return { badge: "Live", detail: "Running owner elsewhere; Attach adopts it here", canAttach: true, canOpen: true };
    case "stale":
      return { badge: "Ended", detail: entry.reason ?? "Owner record left behind", canAttach: false, canOpen: true };
    case "conflict":
      return { badge: "Elsewhere", detail: entry.reason ?? "Owned by a different session", canAttach: false, canOpen: true };
    case "absent":
      return { badge: "Idle", detail: "No live owner", canAttach: false, canOpen: true };
  }
}
