/**
 * OMP's settings schema, read through the negotiated capability bridge.
 *
 * Two rules shape this module:
 *
 * 1. The runtime is the only authority. The inventory comes from OMP's own
 *    schema and the value comes from OMP's own resolution, so Cedia cannot drift
 *    from the layers OMP actually reads.
 * 2. A secret is never forwarded. The runtime already answers a credential path
 *    with `redacted: true`; this module re-validates that invariant instead of
 *    trusting it, so a runtime that changed its mind cannot leak through Cedia.
 */
import { OmpClientStateError, OmpCommandError, type OmpRpcClient } from "../../../packages/omp-adapter/src/client.ts";
import type { CediaUiCommandType, RpcAck } from "../../../packages/omp-adapter/src/types.ts";
import {
  OmpSettingsValidationError,
  parseOmpSettingsKeys,
  parseOmpSettingsValue,
  type OmpSettingsKey,
  type OmpSettingsKeysSnapshot,
  type OmpSettingsValue,
} from "../../../packages/protocol/src/index.ts";

export { OmpSettingsValidationError } from "../../../packages/protocol/src/index.ts";

/** A settings path the running runtime does not define. */
export class OmpSettingsPathError extends Error {
  readonly name = "OmpSettingsPathError";
  readonly code = "omp_settings_unknown_path" as const;
  readonly path: string;
  constructor(path: string, message: string) {
    super(message);
    this.path = path;
  }
}

/** A write refused because the effective settings moved since the caller read them. */
export class OmpSettingsRevisionError extends Error {
  readonly name = "OmpSettingsRevisionError";
  readonly code = "omp_settings_stale_revision" as const;
  readonly expectedRevision: string;
  readonly actualRevision: string;
  constructor(expectedRevision: string, actualRevision: string) {
    super(`The effective settings moved: expected revision ${expectedRevision}, the runtime reports ${actualRevision}`);
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

/** A write the runtime refused for a reason that is not staleness: a bad value, or a bad field. */
export class OmpSettingsRejectedError extends Error {
  readonly name = "OmpSettingsRejectedError";
  readonly code = "omp_settings_rejected" as const;
  readonly path: string;
  constructor(path: string, message: string) {
    super(message);
    this.path = path;
  }
}

/** A path Cedia's settings surface does not write, with the reason it is not editable. */
export class OmpSettingsNotEditableError extends Error {
  readonly name = "OmpSettingsNotEditableError";
  readonly code = "omp_settings_not_editable" as const;
  readonly path: string;
  readonly disposition: OmpSettingDisposition;
  constructor(path: string, disposition: OmpSettingDisposition, reason: string) {
    super(`${path} is ${disposition}: ${reason}`);
    this.path = path;
    this.disposition = disposition;
  }
}

/**
 * How Cedia treats one settings path (plan §6.4, "Only verified editable keys appear").
 *
 * - `editable`: a normal surface may show and write it.
 * - `protected`: a credential path; the provider-auth surface owns it, and a generic settings
 *   control never shows or writes it.
 * - `advanced`: real and reachable, but with no settings row of its own.
 * - `excluded`: the plan excludes it from the settings surface (provider endpoint/order/enabled
 *   fields).
 */
export type OmpSettingDisposition = "editable" | "protected" | "advanced" | "excluded";

/**
 * Paths §6.4 excludes from the settings surface, listed rather than pattern-matched so a new key
 * cannot be excluded by accident: provider endpoints, ordering and enabled/hidden fields.
 */
const EXCLUDED_SETTINGS_PATHS: ReadonlyMap<string, string> = new Map([
  ["enabledProviders", "§6.4 excludes provider enabled/hidden fields from the settings surface."],
  ["disabledProviders", "§6.4 excludes provider enabled/hidden fields from the settings surface."],
  ["modelProviderOrder", "§6.4 excludes provider ordering from the settings surface."],
  ["providers.webSearchOrder", "§6.4 excludes provider ordering from the settings surface."],
  ["providers.imageOrder", "§6.4 excludes provider ordering from the settings surface."],
  ["providers.antigravityEndpoint", "§6.4 excludes provider endpoint settings from the settings surface."],
  ["searxng.endpoint", "§6.4 excludes endpoint settings from the settings surface."],
  ["compaction.remoteEndpoint", "§6.4 excludes endpoint settings from the settings surface."],
  ["dev.autoqaPush.endpoint", "§6.4 excludes endpoint settings from the settings surface."],
]);

/** The disposition Cedia gives one settings key, with the reason whenever it is not `editable`. */
export function ompSettingDisposition(key: OmpSettingsKey): { disposition: OmpSettingDisposition; reason?: string } {
  const excluded = EXCLUDED_SETTINGS_PATHS.get(key.path);
  if (excluded !== undefined) return { disposition: "excluded", reason: excluded };
  if (key.credential)
    return {
      disposition: "protected",
      reason: "A credential path: the provider-auth surface owns it, and a settings control never reads or writes it.",
    };
  if (key.ui) return { disposition: "editable" };
  return { disposition: "advanced", reason: "No settings row of its own; reachable here and through OMP's config CLI." };
}

/** The only adapter surface this owner needs. */
export type OmpSettingsClient = Pick<OmpRpcClient, "requestCedia">;

/** Run one registered operation, answering `undefined` when the bridge is absent. */
async function control(client: OmpSettingsClient, operation: string, payload?: Record<string, unknown>): Promise<unknown | undefined> {
  let ack: RpcAck;
  try {
    ack = await client.requestCedia("cedia_control" as CediaUiCommandType, {
      operation,
      ...(payload === undefined ? {} : { payload }),
    });
  } catch (error) {
    // A runtime without the capability bridge is an honest absence, not an empty
    // settings list: the caller decides how to report it.
    if (error instanceof OmpClientStateError) return undefined;
    throw error;
  }
  const data = ack.data;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new OmpSettingsValidationError("The runtime answered a capability control without a result object");
  const result = (data as { result?: unknown }).result;
  if (result === undefined) throw new OmpSettingsValidationError("The runtime answered a capability control without a result");
  return result;
}

/** Every settings path the running runtime defines, or `undefined` when it has no bridge. */
export async function readOmpSettingsKeys(client: OmpSettingsClient): Promise<OmpSettingsKeysSnapshot | undefined> {
  const result = await control(client, "settings.keys.list");
  if (result === undefined) return undefined;
  return parseOmpSettingsKeys(result);
}

/** One effective settings value, or `undefined` when the runtime has no bridge. */
export async function readOmpSettingsValue(client: OmpSettingsClient, path: string): Promise<OmpSettingsValue | undefined> {
  let result: unknown;
  try {
    result = await control(client, "settings.get", { path });
  } catch (error) {
    // The runtime refuses a path its schema does not define. Translate that one
    // refusal into a typed answer so the host can say "unknown key" instead of
    // reporting a transport failure.
    if (error instanceof OmpCommandError && error.code === "cedia_control_invalid_payload")
      throw new OmpSettingsPathError(path, error.message);
    throw error;
  }
  if (result === undefined) return undefined;
  return parseOmpSettingsValue(result);
}

/**
 * Write one settings path through the runtime.
 *
 * The runtime validates the path, the value's schema type and — when `expectedRevision` is named —
 * that the effective settings have not moved. Its refusals are translated into their own typed
 * errors, so callers answer 409 for staleness and a rejected write for anything else.
 */
export async function writeOmpSettingsValue(
  client: OmpSettingsClient,
  request: { path: string; value: unknown; expectedRevision?: string },
): Promise<OmpSettingsValue | undefined> {
  let result: unknown;
  try {
    result = await control(client, "settings.set", {
      path: request.path,
      value: request.value,
      ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }),
    });
  } catch (error) {
    if (error instanceof OmpCommandError && error.code === "cedia_control_stale_settings_revision")
      throw new OmpSettingsRevisionError(request.expectedRevision ?? "(none)", error.message);
    if (error instanceof OmpCommandError && error.code === "cedia_control_invalid_payload")
      throw new OmpSettingsRejectedError(request.path, error.message);
    throw error;
  }
  if (result === undefined) return undefined;
  return parseOmpSettingsValue(result);
}
