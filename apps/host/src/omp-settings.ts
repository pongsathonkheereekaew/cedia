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
  type OmpSettingsKey,
  parseOmpSettingsKeys,
  parseOmpSettingsMutation,
  parseOmpSettingsValue,
  type OmpSettingsContext,
  type OmpSettingsKeysSnapshot,
  type OmpSettingsMutation,
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
 * How Cedia treats one settings path (plan §6.4.1, S1: presentation is not permission).
 *
 * - `editable`: a normal surface may show and write it (OMP TUI row present, non-credential).
 * - `protected`: a credential path; the provider-auth surface owns it, and a generic settings
 *   control never shows or writes it.
 * - `advanced`: real and discoverable, but with no Basic row of its own. Advanced placement
 *   is presentation, not a write prohibition by itself; scoped writes land in S3.
 * - `excluded`: an explicit product exclusion with owner reason (broker/rooms/updater/voice).
 *   S1a removes the seven incorrect native-OMP exclusions per §6.4.1; explicit
 *   broker/room/update/voice exclusions (including nested activating fields) land in S1b
 *   after the pending owner answers, so they are not silently allowed here.
 */
export type OmpSettingDisposition = "editable" | "protected" | "advanced" | "excluded";

/**
 * Explicit product exclusions only, listed rather than pattern-matched so a new key
 * cannot be excluded by accident (§6.4.1 S1b, owner-accepted recommendations).
 * The seven native OMP paths unblocked in S1a stay discoverable and are absent here.
 * Kept writable by design: speech.voice + tts.localVoice (TTS output stays applicable),
 * marketplace.autoUpdate (extension marketplace, not the OMP runtime updater),
 * vault.enabled (Obsidian Vault integration, not the D3 credential vault),
 * images.urls.sshTarget/sshRemotePort (blob broker, not D2 SSH remote-access).
 */
const EXCLUDED_SETTINGS_PATHS: ReadonlyMap<string, string> = new Map([
  ["live.voice", "Owner-deferred voice input (2026-09-23): realtime voice is outside this delivery; shown only in Capability status."],
  ["stt.enabled", "Owner-deferred voice input (2026-09-23): speech-to-text is outside this delivery; stored values cannot activate voice through Advanced."],
  ["stt.language", "Owner-deferred voice input (2026-09-23): speech-to-text is outside this delivery."],
  ["stt.submitTrigger", "Owner-deferred voice input (2026-09-23): speech-to-text is outside this delivery."],
  ["collab.relayUrl", "Owner decision D1 (2026-09-25): public-room collaboration is excluded; remote access rides Tailscale, not rooms."],
  ["collab.webUrl", "Owner decision D1 (2026-09-25): public-room collaboration is excluded."],
  ["collab.displayName", "Owner decision D1 (2026-09-25): public-room collaboration is excluded."],
  ["collab.autoStart", "Owner decision D1 (2026-09-25): public-room collaboration is excluded."],
  ["update.channel", "Owner decision D5 (2026-09-25): OMP self-updater is permanently forbidden; runtime updates ship as CEDIA releases."],
  ["startup.checkUpdate", "Owner decision D5 (2026-09-25): OMP update checks belong to CEDIA releases, not the pinned runtime."],
  ["providers.tinyModelDevice", "Owner decision D5 (2026-09-25): local tiny-model provisioning is excluded."],
  ["providers.tinyModelDtype", "Owner decision D5 (2026-09-25): local tiny-model provisioning is excluded."],
  ["auth.broker.url", "Owner decision D3 (2026-09-25): running a credential vault broker service is excluded; OMP keeps provider auth and Cedia never copies credentials."],
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

/** Whether the runtime behind this client speaks the scoped settings contract. */
export async function readOmpSettingsServiceVersion(client: OmpSettingsClient): Promise<number | undefined> {
  // The adapter exposes the ready frame; a settings service answers version 1.
  const ready = (client as { readyFrame?: { cediaSettingsServiceVersion?: unknown } }).readyFrame;
  return typeof ready?.cediaSettingsServiceVersion === "number" ? ready.cediaSettingsServiceVersion : undefined;
}

/** Full schema metadata: label, help, defaults, env and group. Falls back to keys.list on old runtimes. */
export async function readOmpSettingsDescribe(client: OmpSettingsClient): Promise<OmpSettingsKeysSnapshot | undefined> {
  try {
    const result = await control(client, "settings.keys.describe");
    if (result === undefined) return undefined;
    return parseOmpSettingsKeys(result);
  } catch (error) {
    if (error instanceof OmpCommandError && error.code === "cedia_control_unknown_operation") {
      const legacy = await control(client, "settings.keys.list");
      if (legacy === undefined) return undefined;
      return parseOmpSettingsKeys(legacy);
    }
    throw error;
  }
}

export interface OmpSettingsReadScope {
  readonly context: OmpSettingsContext;
  readonly projectDir?: string;
}

/** One effective settings value in an explicit scope, or `undefined` without a bridge. */
export async function readOmpSettingsValueIn(
  client: OmpSettingsClient,
  path: string,
  read: OmpSettingsReadScope,
): Promise<OmpSettingsValue | undefined> {
  let result: unknown;
  try {
    result = await control(client, "settings.get", {
      path,
      scope: read.context.scope,
      ...(read.context.scope === "project" ? { projectDir: read.projectDir } : {}),
    });
  } catch (error) {
    if (error instanceof OmpCommandError && error.code === "cedia_control_invalid_payload")
      throw new OmpSettingsPathError(path, error.message);
    throw error;
  }
  if (result === undefined) return undefined;
  return parseOmpSettingsValue(result);
}

/** Remove one persisted override through the owner, with readback. */
export async function unsetOmpSettingsValue(
  client: OmpSettingsClient,
  request: { path: string; expectedRevision?: string },
): Promise<OmpSettingsValue | undefined> {
  let result: unknown;
  try {
    result = await control(client, "settings.unset", {
      path: request.path,
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

export interface OmpSettingsMutateResult {
  readonly values: readonly OmpSettingsValue[];
  readonly scope: "global" | "project";
}

/** Apply a validated scoped mutation through the owner, with readback of every change. */
export async function mutateOmpSettings(
  client: OmpSettingsClient,
  mutation: OmpSettingsMutation,
  projectDir?: string,
): Promise<OmpSettingsMutateResult | undefined> {
  const parsed = parseOmpSettingsMutation({ ...mutation, changes: [...mutation.changes] });
  let result: unknown;
  try {
    result = await control(client, "settings.mutate", {
      context:
        parsed.context.scope === "project"
          ? { scope: "project", projectDir }
          : { scope: "global" },
      ...(parsed.expectedRevision === undefined ? {} : { expectedRevision: parsed.expectedRevision }),
      changes: parsed.changes,
    });
  } catch (error) {
    if (error instanceof OmpCommandError && error.code === "cedia_control_stale_settings_revision")
      throw new OmpSettingsRevisionError(parsed.expectedRevision ?? "(none)", error.message);
    if (error instanceof OmpCommandError && error.code === "cedia_control_invalid_payload") {
      const first = parsed.changes[0];
      throw new OmpSettingsRejectedError(first?.path ?? "(mutation)", error.message);
    }
    throw error;
  }
  if (result === undefined) return undefined;
  if (parsed.context.scope === "project") {
    const record = result as { values?: unknown; scope?: unknown };
    if (!Array.isArray(record.values)) throw new OmpSettingsValidationError("A project mutation answers its values");
    return { values: record.values.map(entry => parseOmpSettingsValue(entry)), scope: "project" };
  }
  if (!Array.isArray(result)) throw new OmpSettingsValidationError("A global mutation answers its values");
  return { values: result.map(entry => parseOmpSettingsValue(entry)), scope: "global" };
}

export interface OmpSettingsResetPreview {
  readonly path: string;
  readonly globalConfigured: boolean;
  readonly current: OmpSettingsValue;
}

/** Preview an unset of the named paths. Writes nothing. */
export async function previewOmpSettingsReset(
  client: OmpSettingsClient,
  paths: readonly string[],
): Promise<readonly OmpSettingsResetPreview[] | undefined> {
  const result = await control(client, "settings.reset.preview", { paths: [...paths] });
  if (result === undefined) return undefined;
  const record = result as { entries?: unknown } & unknown;
  const entries = Array.isArray(result) ? result : (record as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) throw new OmpSettingsValidationError("A reset preview answers its entries");
  return entries.map(entry => {
    const item = entry as Record<string, unknown>;
    if (typeof item.path !== "string" || typeof item.globalConfigured !== "boolean" || item.current === undefined)
      throw new OmpSettingsValidationError("A reset preview entry names its path, state and current value");
    return { path: item.path, globalConfigured: item.globalConfigured, current: parseOmpSettingsValue(item.current) };
  });
}
