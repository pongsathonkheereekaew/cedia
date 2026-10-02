// FILE: OmpSettingsPanel.logic.ts
// Purpose: Pure projections and input parsing for the OMP settings destination.
// Layer: Settings panel support

export type OmpSettingDisposition = "editable" | "protected" | "advanced" | "excluded";

export interface OmpSettingKey {
  readonly path: string;
  readonly type: string;
  readonly credential: boolean;
  readonly ui: boolean;
  readonly tab?: string;
  readonly projectWritable: boolean;
  readonly disposition: OmpSettingDisposition;
  readonly reason?: string;
  /** The values the runtime's own schema accepts for this path, when it publishes them. */
  readonly values?: readonly string[];
  /** When a change takes effect, when the runtime can prove it (§6.4). */
  readonly apply?: OmpSettingApply;
  /** The TUI label, group and help text OMP declares, when it declares them. */
  readonly label?: string;
  readonly description?: string;
  readonly group?: string;
  /** The static schema default, identical for every user; never a configured value. */
  readonly defaultJson?: unknown;
  /** The environment variable that overrides this path, when one exists. */
  readonly envVar?: string;
}

/** The timings a runtime may publish; a path without one is unclassified, not guessed. */
export type OmpSettingApply = "immediate" | "turn_boundary" | "reload" | "new_session";

export type OmpSettingScope = "global" | "project" | "session";

export interface OmpSettingValue {
  readonly path: string;
  readonly credential: boolean;
  readonly redacted: boolean;
  readonly configured: boolean;
  readonly value?: unknown;
  readonly tooLarge?: true;
  readonly bytes?: number;
  readonly settingsRevision: string;
  readonly scope?: OmpSettingScope;
  readonly provenance?: "env" | "runtime" | "overlay" | "project" | "global" | "default";
  readonly storedGlobal?: unknown;
  readonly defaultJson?: unknown;
}

/** A filter matches the schema path, tab, label, group or help text, case-insensitively. Never secret values. */
export function filterOmpSettingKeys(
  keys: readonly OmpSettingKey[],
  filter: string,
): OmpSettingKey[] {
  const normalized = filter.trim().toLocaleLowerCase();
  if (!normalized) return [...keys];
  return keys.filter((key) =>
    key.path.toLocaleLowerCase().includes(normalized) ||
    (key.tab?.toLocaleLowerCase().includes(normalized) ?? false) ||
    (key.label?.toLocaleLowerCase().includes(normalized) ?? false) ||
    (key.group?.toLocaleLowerCase().includes(normalized) ?? false) ||
    (key.description?.toLocaleLowerCase().includes(normalized) ?? false),
  );
}

/**
 * Basic is the default AI/OMP view: providers, default model and effort, model
 * roles, approval mode, context and compaction defaults, planning and agent
 * defaults. Advanced reveals the complete classified inventory. Basic placement
 * is presentation: every supported key stays searchable and writable in Advanced.
 */
const BASIC_EXACT_PATHS: ReadonlySet<string> = new Set([
  "modelRoles",
  "cycleOrder",
  "defaultThinkingLevel",
  "task.enableEffort",
  "task.maxEffort",
  "tools.approval",
  "tools.approvalMode",
  "memory.backend",
]);

const BASIC_PATH_PREFIXES: readonly string[] = ["compaction."];

export function isOmpBasicKey(key: OmpSettingKey): boolean {
  if (key.credential || key.disposition === "excluded" || key.disposition === "protected") return false;
  if (key.tab === "providers") return true;
  if (BASIC_EXACT_PATHS.has(key.path)) return true;
  return BASIC_PATH_PREFIXES.some((prefix) => key.path.startsWith(prefix));
}

/** One sentence naming the layer that supplies the effective value. */
export function ompSettingProvenanceLabel(value: OmpSettingValue): string {
  switch (value.provenance) {
    case "env":
      return "Set by the environment";
    case "runtime":
      return "Set for this run";
    case "overlay":
      return "Set by a config overlay";
    case "project":
      return "Set by the project";
    case "global":
      return "Saved in shared settings";
    default:
      return "Schema default";
  }
}

/** Whether a saved global value is masked by a stronger layer right now. */
export function isOmpSettingMasked(value: OmpSettingValue): boolean {
  if (value.credential || value.redacted || value.tooLarge === true) return false;
  if (!Object.hasOwn(value, "storedGlobal")) return false;
  try {
    return JSON.stringify(value.storedGlobal) !== JSON.stringify(value.value);
  } catch {
    return false;
  }
}

/** Keep the inventory order while putting keys without a tab into one explicit group. */
export function groupOmpSettingKeys(
  keys: readonly OmpSettingKey[],
): Array<{ readonly label: string; readonly keys: OmpSettingKey[] }> {
  const groups: Array<{ readonly label: string; readonly keys: OmpSettingKey[] }> = [];
  const byLabel = new Map<string, { readonly label: string; readonly keys: OmpSettingKey[] }>();
  for (const key of keys) {
    const label = key.tab?.trim() || "Other";
    let group = byLabel.get(label);
    if (!group) {
      group = { label, keys: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.keys.push(key);
  }
  return groups;
}

function jsonText(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

/** Format a host value for a row, with credentials taking precedence over all other fields. */
export function formatOmpSettingValue(value: OmpSettingValue): string {
  if (value.credential || value.redacted) return "Protected value";
  if (value.tooLarge === true) {
    return value.bytes === undefined ? "Too large to display" : `Too large to display (${value.bytes} bytes)`;
  }
  return `${value.configured ? "Configured" : "Default"} · ${jsonText(value.value)}`;
}

/** Convert a non-secret value into the editor's text representation. */
export function settingValueToEditorText(value: OmpSettingValue): string {
  if (value.credential || value.redacted || value.tooLarge === true || !Object.hasOwn(value, "value")) return "";
  // Enum/string controls bind their raw option value (`high`, not `"high"`). Keeping
  // strings unquoted lets a refresh hydrate a <select> and a subsequent Save round-trip
  // the value the runtime validates; arrays/records still need JSON text for their editors.
  if (typeof value.value === "string") return value.value;
  return jsonText(value.value);
}

/**
 * The choices an enum row may offer.
 *
 * OMP's inventory publishes an enum key's allowed values from the same schema that validates a
 * write. When it does not (an older runtime), the row keeps the free-text editor and the
 * runtime's own refusal is what tells the owner the value was wrong - no list is invented.
 */
export function ompSettingChoices(key: OmpSettingKey): readonly string[] | undefined {
  if (key.type.trim().toLocaleLowerCase() !== "enum") return undefined;
  const values = key.values;
  return Array.isArray(values) && values.length > 0 ? values : undefined;
}

/**
 * The one sentence a row shows about when its change takes effect.
 *
 * A runtime that publishes nothing gets the honest answer: Cedia has not classified this key,
 * so the row must not imply the change is live.
 */
export function ompSettingApplyLabel(key: OmpSettingKey): string {
  switch (key.apply) {
    case "immediate":
      return "Applies as soon as it is saved";
    case "turn_boundary":
      return "Applies to the next turn";
    case "reload":
      return "Applies after the runtime reloads";
    case "new_session":
      return "Applies to a new task";
    default:
      return "Cedia has not classified when this key takes effect";
  }
}

/** Parse text from the matching editor into the JSON value expected by OMP. */
export function parseOmpSettingInput(type: string, raw: string): unknown {
  const normalized = type.trim().toLocaleLowerCase();
  if (normalized === "string" || normalized === "enum") return raw;
  if (normalized === "number") {
    if (raw.trim() === "") throw new Error("Enter a number.");
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("Enter a finite number.");
    return value;
  }
  if (normalized === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error("Choose a boolean: true or false.");
  }
  if (normalized === "array" || normalized === "record") {
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`Enter valid JSON for this ${normalized}.`);
    }
    if (normalized === "array" && !Array.isArray(value)) throw new Error("The value must be a JSON array.");
    if (normalized === "record") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("The value must be a JSON object.");
    }
    return value;
  }
  throw new Error(`OMP does not expose an editor for type '${type}'.`);
}

export function isOmpSettingsStaleRevisionError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "omp_settings_stale_revision");
}

export function ompSettingDispositionLabel(disposition: OmpSettingDisposition): string {
  switch (disposition) {
    case "protected":
      return "Protected";
    case "advanced":
      return "Advanced";
    case "excluded":
      return "Excluded";
    default:
      return "Editable";
  }
}
