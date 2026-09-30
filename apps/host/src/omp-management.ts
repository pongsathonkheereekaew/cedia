import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpToolSource = "builtin" | "mcp" | "sdk" | "extension";

export type OmpToolCatalogEntry = {
  readonly name: string;
  readonly description: string;
  readonly descriptionTruncated: boolean;
  readonly source: OmpToolSource;
  readonly active: boolean;
};

export type OmpToolCatalogData = {
  readonly tools: readonly OmpToolCatalogEntry[];
  readonly truncated: boolean;
  readonly total: number;
  readonly activeCount: number;
};

export type OmpToolCatalogSnapshot =
  | ({ readonly state: "available" } & OmpToolCatalogData)
  | { readonly state: "unavailable"; readonly reason: string };

export type OmpToolRefreshRequest = {
  readonly commandId: string;
  readonly incarnation: string;
};

export type OmpToolActiveSetRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly toolNames: readonly string[];
};

export type OmpToolActiveSetSnapshot =
  | ({ readonly available: true } & OmpToolCatalogData)
  | { readonly available: false; readonly reason: string };

/** A validation failure from an OMP tool-catalog result. */
export class OmpToolCatalogValidationError extends TypeError {
  readonly name = "OmpToolCatalogValidationError";
  readonly code = "omp_tool_catalog_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpToolCatalogClient = {
  readonly phase: string;
  readonly readyFrame?: Record<string, unknown>;
  readonly requestCedia: (
    command: "cedia_control",
    payload: Record<string, unknown>,
  ) => Promise<{ readonly data?: unknown }>;
  readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_TOOL_CATALOG_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's tool catalog.";
export const NO_OMP_TOOL_CATALOG_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for the tool catalog.";

function invalid(message: string): never {
  throw new OmpToolCatalogValidationError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) if (!keys.has(key)) invalid(`${label} has an unknown field ${key}`);
}

function required(value: Record<string, unknown>, key: string, label: string): unknown {
  if (!Object.hasOwn(value, key)) invalid(`${label} has no ${key}`);
  return value[key];
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string`);
  return value;
}

function nonEmptyText(value: unknown, label: string): string {
  const result = text(value, label);
  if (result.trim().length === 0) invalid(`${label} must be a non-empty string`);
  return result;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative integer`);
  return value;
}

function source(value: unknown, label: string): OmpToolSource {
  if (value === "builtin" || value === "mcp" || value === "sdk" || value === "extension") return value;
  invalid(`${label} must be one of builtin, mcp, sdk or extension`);
}

function parseEntry(value: unknown, index: number): OmpToolCatalogEntry {
  const label = `OMP tool catalog entry ${index}`;
  const item = record(value, label);
  exact(item, ["name", "description", "descriptionTruncated", "source", "active"], label);
  return {
    name: nonEmptyText(required(item, "name", label), `${label} name`),
    description: text(required(item, "description", label), `${label} description`),
    descriptionTruncated: boolean(required(item, "descriptionTruncated", label), `${label} descriptionTruncated`),
    source: source(required(item, "source", label), `${label} source`),
    active: boolean(required(item, "active", label), `${label} active`),
  };
}

/** Parse the exact result of `tools.catalog.get`, rejecting unknown fields per row. */
export function parseOmpToolCatalogData(value: unknown): OmpToolCatalogData {
  const label = "OMP tool catalog response";
  const item = record(value, label);
  exact(item, ["tools", "truncated", "total", "activeCount"], label);
  const tools = required(item, "tools", label);
  if (!Array.isArray(tools)) invalid(`${label} tools must be an array`);
  const parsed = tools.map((entry, index) => parseEntry(entry, index));
  if (new Set(parsed.map(entry => entry.name)).size !== parsed.length) invalid(`${label} has duplicate tool names`);
  return {
    tools: parsed,
    truncated: boolean(required(item, "truncated", label), `${label} truncated`),
    total: nonNegativeInteger(required(item, "total", label), `${label} total`),
    activeCount: nonNegativeInteger(required(item, "activeCount", label), `${label} activeCount`),
  };
}

function responseData(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
  return value;
}

function controlAvailable(client: OmpToolCatalogClient): boolean {
  if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
  return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

/** Run one registered tool-catalog operation, answering `undefined` when the bridge is absent. */
async function control(client: OmpToolCatalogClient, operation: "tools.catalog.get" | "tools.active.set" | "tools.refresh-skills" | "tools.codemode.get" | "extensions.list" | "extensions.set", payload?: Record<string, unknown>): Promise<unknown | undefined> {
  if (!controlAvailable(client)) return undefined;
  let response: { readonly data?: unknown };
  try {
    response = await client.requestCedia("cedia_control", {
      operation,
      ...(payload === undefined ? {} : { payload }),
    });
  } catch (error) {
    if (error instanceof OmpClientStateError) return undefined;
    throw error;
  }
  const data = record(responseData(response), "Cedia control response");
  exact(data, ["operation", "capabilityRevision", "result"], "Cedia control response");
  if (data.operation !== operation) invalid(`Cedia control answered ${String(data.operation)} for ${operation}`);
  if (typeof data.capabilityRevision !== "string" || data.capabilityRevision.trim().length === 0) invalid("Cedia control capability revision must be a non-empty string");
  if (!Object.hasOwn(data, "result") || data.result === undefined) invalid("Cedia control response has no result");
  return data.result;
}

/** Read OMP's live tool catalog through the capability bridge. */
export async function readOmpToolCatalog(client: OmpToolCatalogClient): Promise<OmpToolCatalogData | undefined> {
  const result = await control(client, "tools.catalog.get");
  return result === undefined ? undefined : parseOmpToolCatalogData(result);
}

/** Re-run OMP's skill rediscovery and validate the catalog that follows. */
export async function refreshOmpSkills(client: OmpToolCatalogClient): Promise<OmpToolCatalogData | undefined> {
  const result = await control(client, "tools.refresh-skills");
  return result === undefined ? undefined : parseOmpToolCatalogData(result);
}

/** Select OMP's enabled tools through its own activation path and validate the catalog that follows. */
export async function setOmpActiveTools(client: OmpToolCatalogClient, toolNames: readonly string[]): Promise<OmpToolCatalogData | undefined> {
  if (toolNames.some(name => typeof name !== "string" || name.trim().length === 0)) throw new OmpToolCatalogValidationError("OMP active tool names must be non-empty strings");
  const result = await control(client, "tools.active.set", { toolNames: [...toolNames] });
  return result === undefined ? undefined : parseOmpToolCatalogData(result);
}

/** Parse the shape persisted with a durable active-set receipt. */
export function parseOmpToolActiveSetSnapshot(value: unknown): OmpToolActiveSetSnapshot {
  const item = record(value, "Cedia tool active-set result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia tool unavailable result");
    return { available: false, reason: text(required(item, "reason", "Cedia tool unavailable result"), "Cedia tool unavailable reason") };
  }
  if (item.available !== true) invalid("Cedia tool result available must be a boolean");
  const result = parseOmpToolCatalogData({
    tools: item.tools,
    truncated: item.truncated,
    total: item.total,
    activeCount: item.activeCount,
  });
  exact(item, ["available", "tools", "truncated", "total", "activeCount"], "Cedia tool available result");
  return { available: true, ...result };
}

export type OmpExtensionSource = {
  readonly provider: string;
  readonly providerName: string;
  readonly level: string;
};

export type OmpExtensionEntry = {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly descriptionTruncated: boolean;
  readonly path: string;
  readonly source: OmpExtensionSource;
  readonly state: string;
  readonly disabledReason?: string;
  readonly shadowedBy?: string;
};

export type OmpExtensionRoots = {
  readonly explicit: readonly string[];
  readonly mode: string;
  readonly configured: readonly string[];
  readonly configuredLevel: string;
};

export type OmpExtensionsData = {
  readonly roots: OmpExtensionRoots;
  readonly extensions: readonly OmpExtensionEntry[];
  readonly truncated: boolean;
  readonly total: number;
};

export type OmpExtensionsSnapshot =
  | ({ readonly state: "available" } & OmpExtensionsData)
  | { readonly state: "unavailable"; readonly reason: string };

/** A validation failure from an OMP extension-catalog result. Uses the catalog error code family. */
export class OmpExtensionsValidationError extends TypeError {
  readonly name = "OmpExtensionsValidationError";
  readonly code = "omp_tool_catalog_invalid" as const;
}

export const NO_OMP_EXTENSIONS_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's extension catalog.";
export const NO_OMP_EXTENSIONS_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for the extension catalog.";

function extensionsInvalid(message: string): never {
  throw new OmpExtensionsValidationError(message);
}

function parseExtensionSource(value: unknown): OmpExtensionSource {
  const label = "OMP extension source";
  if (!value || typeof value !== "object" || Array.isArray(value)) extensionsInvalid(`${label} must be an object`);
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!["provider", "providerName", "level"].includes(key)) extensionsInvalid(`${label} has an unknown field ${key}`);
  const provider = item.provider;
  const providerName = item.providerName;
  const level = item.level;
  if (typeof provider !== "string" || provider.trim().length === 0) extensionsInvalid(`${label} provider must be a non-empty string`);
  if (typeof providerName !== "string" || providerName.trim().length === 0) extensionsInvalid(`${label} providerName must be a non-empty string`);
  if (level !== "user" && level !== "project" && level !== "native") extensionsInvalid(`${label} level must be user, project or native`);
  return { provider, providerName, level };
}

function parseExtensionEntry(value: unknown, index: number): OmpExtensionEntry {
  const label = `OMP extension entry ${index}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) extensionsInvalid(`${label} must be an object`);
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) {
    if (!["id", "kind", "name", "displayName", "description", "descriptionTruncated", "path", "source", "state", "disabledReason", "shadowedBy"].includes(key)) extensionsInvalid(`${label} has an unknown field ${key}`);
  }
  const id = item.id;
  const kind = item.kind;
  const name = item.name;
  const displayName = item.displayName;
  const description = item.description;
  const path = item.path;
  const state = item.state;
  if (typeof id !== "string" || id.trim().length === 0) extensionsInvalid(`${label} id must be a non-empty string`);
  if (typeof kind !== "string" || kind.trim().length === 0) extensionsInvalid(`${label} kind must be a non-empty string`);
  if (typeof name !== "string" || name.trim().length === 0) extensionsInvalid(`${label} name must be a non-empty string`);
  if (typeof displayName !== "string" || displayName.trim().length === 0) extensionsInvalid(`${label} displayName must be a non-empty string`);
  if (typeof description !== "string") extensionsInvalid(`${label} description must be a string`);
  if (typeof path !== "string") extensionsInvalid(`${label} path must be a string`);
  if (state !== "active" && state !== "disabled" && state !== "shadowed") extensionsInvalid(`${label} state must be active, disabled or shadowed`);
  const entry: OmpExtensionEntry = {
    id, kind, name, displayName, description,
    descriptionTruncated: item.descriptionTruncated === true,
    path,
    source: parseExtensionSource(item.source),
    state,
  };
  if (item.descriptionTruncated !== undefined && typeof item.descriptionTruncated !== "boolean") extensionsInvalid(`${label} descriptionTruncated must be a boolean`);
  if (item.disabledReason !== undefined) {
    if (typeof item.disabledReason !== "string") extensionsInvalid(`${label} disabledReason must be a string`);
    return { ...entry, disabledReason: item.disabledReason };
  }
  if (item.shadowedBy !== undefined) {
    if (typeof item.shadowedBy !== "string") extensionsInvalid(`${label} shadowedBy must be a string`);
    return { ...entry, shadowedBy: item.shadowedBy };
  }
  return entry;
}

/** Parse the exact result of `extensions.list`: records and roots, never sources. */
export function parseOmpExtensionsData(value: unknown): OmpExtensionsData {
  const label = "OMP extension catalog response";
  if (!value || typeof value !== "object" || Array.isArray(value)) extensionsInvalid(`${label} must be an object`);
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!["roots", "extensions", "truncated", "total"].includes(key)) extensionsInvalid(`${label} has an unknown field ${key}`);
  const roots = item.roots;
  if (!roots || typeof roots !== "object" || Array.isArray(roots)) extensionsInvalid(`${label} roots must be an object`);
  const rootsRow = roots as Record<string, unknown>;
  for (const key of Object.keys(rootsRow)) if (!["explicit", "mode", "configured", "configuredLevel"].includes(key)) extensionsInvalid(`${label} roots has an unknown field ${key}`);
  const strings = (field: unknown, name: string): readonly string[] => {
    if (!Array.isArray(field) || field.some(entry => typeof entry !== "string")) extensionsInvalid(`${label} roots ${name} must be strings`);
    return field as string[];
  };
  const mode = rootsRow.mode;
  const configuredLevel = rootsRow.configuredLevel;
  if (typeof mode !== "string" || mode.trim().length === 0) extensionsInvalid(`${label} roots mode must be a non-empty string`);
  if (configuredLevel !== "user" && configuredLevel !== "project") extensionsInvalid(`${label} roots configuredLevel must be user or project`);
  const rawExtensions = item.extensions;
  if (!Array.isArray(rawExtensions)) extensionsInvalid(`${label} extensions must be an array`);
  const extensions = rawExtensions.map((entry, index) => parseExtensionEntry(entry, index));
  if (new Set(extensions.map(entry => entry.id)).size !== extensions.length) extensionsInvalid(`${label} has duplicate extension ids`);
  if (item.truncated !== undefined && typeof item.truncated !== "boolean") extensionsInvalid(`${label} truncated must be a boolean`);
  const total = item.total;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) extensionsInvalid(`${label} total must be a non-negative integer`);
  return {
    roots: { explicit: strings(rootsRow.explicit, "explicit"), mode, configured: strings(rootsRow.configured, "configured"), configuredLevel },
    extensions,
    truncated: item.truncated === true,
    total,
  };
}

/** Read OMP's extension records plus the live root policy through the capability bridge. */
export async function readOmpExtensions(client: OmpToolCatalogClient): Promise<OmpExtensionsData | undefined> {
  const result = await control(client, "extensions.list");
  if (result === undefined) return undefined;
  try {
    return parseOmpExtensionsData(result);
  } catch (error) {
    if (error instanceof OmpToolCatalogValidationError) throw error;
    throw new OmpExtensionsValidationError(error instanceof Error ? error.message : String(error));
  }
}

/** Per-session OMP extension-catalog projection. OMP remains the owner of discovery. */
export class OmpExtensions {
  #client: OmpToolCatalogClient | undefined;
  #extensions: OmpExtensionsData | undefined;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpToolCatalogClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_EXTENSIONS_RUNTIME_REASON;
  }

  setClient(client: OmpToolCatalogClient | undefined): void {
    const changed = this.#client !== client;
    this.#client = client;
    if (!client || changed) this.#clearUnavailable(NO_OMP_EXTENSIONS_RUNTIME_REASON);
  }

  /** Read and cache OMP's extension records without starting a runtime. */
  async read(client?: OmpToolCatalogClient): Promise<OmpExtensionsData | undefined> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") return undefined;
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const extensions = await readOmpExtensions(target);
    if (extensions !== undefined) this.#set(extensions);
    return extensions;
  }

  /** Refresh the records from an already-running runtime. */
  async refresh(): Promise<OmpExtensionsSnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_EXTENSIONS_RUNTIME_REASON);
      return this.snapshot();
    }
    if (!controlAvailable(client)) {
      this.#clearUnavailable(NO_OMP_EXTENSIONS_BRIDGE_REASON);
      return this.snapshot();
    }
    try {
      const extensions = await this.read();
      if (extensions === undefined) this.#clearUnavailable(NO_OMP_EXTENSIONS_BRIDGE_REASON);
    } catch (error) {
      this.#clearUnavailable(error instanceof Error ? error.message : String(error));
    }
    return this.snapshot();
  }

  /** Alias used by runtime startup and tests that seed a per-session projection. */
  async seed(): Promise<void> {
    await this.refresh();
  }

  /** Toggle one extension through OMP's owner operation and cache the catalog that follows. */
  async setEnabled(id: string, enabled: boolean): Promise<OmpExtensionsData> {
    const client = this.#client;
    if (!client || client.phase !== "ready") throw new Error(NO_OMP_EXTENSIONS_RUNTIME_REASON);
    if (!controlAvailable(client)) throw new Error(NO_OMP_EXTENSIONS_BRIDGE_REASON);
    const result = await setOmpExtensionEnabled(client, id, enabled);
    if (result === undefined) throw new Error(NO_OMP_EXTENSIONS_BRIDGE_REASON);
    this.#set(result);
    return result;
  }

  snapshot(): OmpExtensionsSnapshot {
    const client = this.#client;
    if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_EXTENSIONS_RUNTIME_REASON };
    if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_EXTENSIONS_BRIDGE_REASON };
    if (this.#extensions === undefined) return { state: "unavailable", reason: this.#unavailableReason };
    return { state: "available", ...this.#extensions };
  }

  #set(extensions: OmpExtensionsData): void {
    this.#extensions = parseOmpExtensionsData(extensions);
    this.#unavailableReason = "";
  }

  #clearUnavailable(reason: string): void {
    this.#extensions = undefined;
    this.#unavailableReason = reason;
  }
}

export type OmpExtensionSetRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly id: string;
  readonly enabled: boolean;
};

/** Parse the exact result of `extensions.set`: the catalog that follows the toggle. */
export function parseOmpExtensionSetSnapshot(value: unknown): OmpExtensionsData {
  return parseOmpExtensionsData(value);
}

export type OmpExtensionSetResult =
  | ({ readonly available: true } & OmpExtensionsData)
  | { readonly available: false; readonly reason: string };

/** Parse the durable route result of `extensions.set`: the available wrapper around the catalog. */
export function parseOmpExtensionSetResult(value: unknown): OmpExtensionSetResult {
  const item = record(value, "Cedia extension set result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia extension unavailable result");
    return { available: false, reason: text(required(item, "reason", "Cedia extension unavailable result"), "Cedia extension unavailable reason") };
  }
  if (item.available !== true) invalid("Cedia extension result available must be a boolean");
  const result = parseOmpExtensionsData({
    roots: item.roots,
    extensions: item.extensions,
    truncated: item.truncated,
    total: item.total,
  });
  exact(item, ["available", "roots", "extensions", "truncated", "total"], "Cedia extension available result");
  return { available: true, ...result };
}

/** Toggle one extension through the capability bridge. */
export async function setOmpExtensionEnabled(
  client: OmpToolCatalogClient,
  id: string,
  enabled: boolean,
): Promise<OmpExtensionsData | undefined> {
  if (typeof id !== "string" || id.trim().length === 0) throw new OmpExtensionsValidationError("OMP extension toggle needs an extension id");
  if (typeof enabled !== "boolean") throw new OmpExtensionsValidationError("OMP extension toggle needs a boolean");
  const result = await control(client, "extensions.set", { id, enabled });
  return result === undefined ? undefined : parseOmpExtensionsData(result);
}

/** Per-session OMP tool-catalog projection. OMP remains the owner of registry and activation state. */
/** Per-session OMP tool-catalog projection. OMP remains the owner of registry and activation state. */
export class OmpToolCatalog {
  #client: OmpToolCatalogClient | undefined;
  #catalog: OmpToolCatalogData | undefined;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpToolCatalogClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_TOOL_CATALOG_RUNTIME_REASON;
  }

  setClient(client: OmpToolCatalogClient | undefined): void {
    const changed = this.#client !== client;
    this.#client = client;
    if (!client || changed) this.#clearUnavailable(NO_OMP_TOOL_CATALOG_RUNTIME_REASON);
  }

  /** Read and cache OMP's live catalog without starting a runtime. */
  async read(client?: OmpToolCatalogClient): Promise<OmpToolCatalogData | undefined> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") return undefined;
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const catalog = await readOmpToolCatalog(target);
    if (catalog !== undefined) this.#set(catalog);
    return catalog;
  }

  /** Refresh skills through OMP's owner operation. */
  async refreshSkills(): Promise<OmpToolCatalogData> {
    const client = this.#client;
    if (!client || client.phase !== "ready") throw new Error(NO_OMP_TOOL_CATALOG_RUNTIME_REASON);
    if (!controlAvailable(client)) throw new Error(NO_OMP_TOOL_CATALOG_BRIDGE_REASON);
    const result = await refreshOmpSkills(client);
    if (result === undefined) throw new Error(NO_OMP_TOOL_CATALOG_BRIDGE_REASON);
    return result;
  }

  /** Write the enabled set through OMP's owner operation. */
  async setActive(toolNames: readonly string[]): Promise<OmpToolCatalogData> {
    const client = this.#client;
    if (!client || client.phase !== "ready") throw new Error(NO_OMP_TOOL_CATALOG_RUNTIME_REASON);
    if (!controlAvailable(client)) throw new Error(NO_OMP_TOOL_CATALOG_BRIDGE_REASON);
    const result = await setOmpActiveTools(client, toolNames);
    if (result === undefined) throw new Error(NO_OMP_TOOL_CATALOG_BRIDGE_REASON);
    return result;
  }

  /** Refresh the catalog from an already-running runtime. */
  async refresh(): Promise<OmpToolCatalogSnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_TOOL_CATALOG_RUNTIME_REASON);
      return this.snapshot();
    }
    if (!controlAvailable(client)) {
      this.#clearUnavailable(NO_OMP_TOOL_CATALOG_BRIDGE_REASON);
      return this.snapshot();
    }
    const catalog = await this.read();
    if (catalog === undefined) this.#clearUnavailable(NO_OMP_TOOL_CATALOG_BRIDGE_REASON);
    return this.snapshot();
  }

  snapshot(): OmpToolCatalogSnapshot {
    const client = this.#client;
    if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_TOOL_CATALOG_RUNTIME_REASON };
    if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_TOOL_CATALOG_BRIDGE_REASON };
    if (this.#catalog === undefined) return { state: "unavailable", reason: this.#unavailableReason };
    return { state: "available", ...this.#catalog };
  }

  #set(catalog: OmpToolCatalogData): void {
    this.#catalog = parseOmpToolCatalogData(catalog);
    this.#unavailableReason = "";
  }

  #clearUnavailable(reason: string): void {
    this.#catalog = undefined;
    this.#unavailableReason = reason;
  }
}

export type OmpCodeModePrelude = {
  readonly name: string;
  readonly enabled: boolean;
};

export type OmpCodeModeData = {
  readonly active: boolean;
  readonly directToolNames: readonly string[] | null;
  readonly preludes: readonly OmpCodeModePrelude[];
};

export type OmpCodeModeSnapshot =
  | ({ readonly state: "available" } & OmpCodeModeData)
  | { readonly state: "unavailable"; readonly reason: string };

export const NO_OMP_CODE_MODE_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's Code Mode partition.";
export const NO_OMP_CODE_MODE_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for the Code Mode partition.";

/** A validation failure from an OMP Code Mode result. Uses the catalog error code family. */
export class OmpCodeModeValidationError extends TypeError {
  readonly name = "OmpCodeModeValidationError";
  readonly code = "omp_tool_catalog_invalid" as const;
}

function codeModeInvalid(message: string): never {
  throw new OmpCodeModeValidationError(message);
}

function parseCodeModePrelude(value: unknown, index: number): OmpCodeModePrelude {
  const label = `OMP Code Mode prelude ${index}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) codeModeInvalid(`${label} must be an object`);
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!["name", "enabled"].includes(key)) codeModeInvalid(`${label} has an unknown field ${key}`);
  const name = item.name;
  if (typeof name !== "string" || name.trim().length === 0) codeModeInvalid(`${label} name must be a non-empty string`);
  const enabled = item.enabled;
  if (typeof enabled !== "boolean") codeModeInvalid(`${label} enabled must be a boolean`);
  return { name, enabled };
}

/** Parse the exact result of `tools.codemode.get`: names and flags only, never prelude sources. */
export function parseOmpCodeModeData(value: unknown): OmpCodeModeData {
  const label = "OMP Code Mode response";
  const item = record(value, label);
  exact(item, ["active", "directToolNames", "preludes"], label);
  const active = required(item, "active", label);
  if (typeof active !== "boolean") codeModeInvalid(`${label} active must be a boolean`);
  const direct = required(item, "directToolNames", label);
  let directToolNames: readonly string[] | null = null;
  if (direct !== null) {
    if (!Array.isArray(direct)) codeModeInvalid(`${label} directToolNames must be an array or null`);
    directToolNames = direct.map((name, index) => {
      if (typeof name !== "string" || name.trim().length === 0) codeModeInvalid(`${label} direct tool ${index} must be a non-empty string`);
      return name;
    });
  }
  const preludes = required(item, "preludes", label);
  if (!Array.isArray(preludes)) codeModeInvalid(`${label} preludes must be an array`);
  return { active, directToolNames, preludes: preludes.map((entry, index) => parseCodeModePrelude(entry, index)) };
}

/** Read OMP's Code Mode partition through the capability bridge. */
export async function readOmpCodeMode(client: OmpToolCatalogClient): Promise<OmpCodeModeData | undefined> {
  const result = await control(client, "tools.codemode.get");
  if (result === undefined) return undefined;
  try {
    return parseOmpCodeModeData(result);
  } catch (error) {
    if (error instanceof OmpToolCatalogValidationError) throw error;
    throw new OmpCodeModeValidationError(error instanceof Error ? error.message : String(error));
  }
}

/** Per-session OMP Code Mode projection. OMP remains the owner of the partition. */
export class OmpCodeMode {
  #client: OmpToolCatalogClient | undefined;
  #mode: OmpCodeModeData | undefined;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpToolCatalogClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_CODE_MODE_RUNTIME_REASON;
  }

  setClient(client: OmpToolCatalogClient | undefined): void {
    const changed = this.#client !== client;
    this.#client = client;
    if (!client || changed) this.#clearUnavailable(NO_OMP_CODE_MODE_RUNTIME_REASON);
  }

  /** Read and cache OMP's Code Mode partition without starting a runtime. */
  async read(client?: OmpToolCatalogClient): Promise<OmpCodeModeData | undefined> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") return undefined;
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const mode = await readOmpCodeMode(target);
    if (mode !== undefined) this.#set(mode);
    return mode;
  }

  /** Refresh the partition from an already-running runtime. */
  async refresh(): Promise<OmpCodeModeSnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_CODE_MODE_RUNTIME_REASON);
      return this.snapshot();
    }
    if (!controlAvailable(client)) {
      this.#clearUnavailable(NO_OMP_CODE_MODE_BRIDGE_REASON);
      return this.snapshot();
    }
    try {
      const mode = await this.read();
      if (mode === undefined) this.#clearUnavailable(NO_OMP_CODE_MODE_BRIDGE_REASON);
    } catch (error) {
      this.#clearUnavailable(error instanceof Error ? error.message : String(error));
    }
    return this.snapshot();
  }

  /** Alias used by runtime startup and tests that seed a per-session projection. */
  async seed(): Promise<void> {
    await this.refresh();
  }

  snapshot(): OmpCodeModeSnapshot {
    const client = this.#client;
    if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_CODE_MODE_RUNTIME_REASON };
    if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_CODE_MODE_BRIDGE_REASON };
    if (this.#mode === undefined) return { state: "unavailable", reason: this.#unavailableReason };
    return { state: "available", ...this.#mode };
  }

  #set(mode: OmpCodeModeData): void {
    this.#mode = parseOmpCodeModeData(mode);
    this.#unavailableReason = "";
  }

  #clearUnavailable(reason: string): void {
    this.#mode = undefined;
    this.#unavailableReason = reason;
  }
}
