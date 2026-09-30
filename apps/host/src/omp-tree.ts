import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpTreeNode = {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: string;
  readonly timestamp: string;
  readonly label: string;
  readonly labelTruncated: boolean;
};

export type OmpTreeLineage = {
  readonly sessionFile: string;
  readonly parentSession: string | null;
  readonly previousSessionFiles: readonly string[];
};

export type OmpTreeData = {
  readonly leafId: string | null;
  readonly nodes: readonly OmpTreeNode[];
  readonly pathIds: readonly string[];
  readonly truncated: boolean;
  readonly lineage: OmpTreeLineage;
};

export type OmpTreeNavigateResult = {
  readonly moved: boolean;
  readonly cancelled: boolean;
  readonly aborted: boolean;
  readonly askReopen: boolean;
  readonly summarized: boolean;
  readonly editorText: string | null;
  readonly editorTextTruncated: boolean;
  readonly editorImageCount: number;
  readonly leafId: string | null;
};

export type OmpTreeNavigateRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly entryId: string;
  readonly summarize?: boolean;
};

export type OmpTreeSnapshot =
  | ({ readonly state: "available" } & OmpTreeData)
  | { readonly state: "unavailable"; readonly reason: string };

export type OmpTreeNavigateSnapshot =
  | ({ readonly available: true } & OmpTreeNavigateResult)
  | { readonly available: false; readonly reason: string };

/** A validation failure from an OMP session-tree result. */
export class OmpTreeValidationError extends TypeError {
  readonly name = "OmpTreeValidationError";
  readonly code = "omp_tree_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpTreeClient = {
  readonly phase: string;
  readonly readyFrame?: Record<string, unknown>;
  readonly requestCedia: (
    command: "cedia_control",
    payload: Record<string, unknown>,
  ) => Promise<{ readonly data?: unknown }>;
  readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_TREE_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's session tree.";
export const NO_OMP_TREE_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for the session tree.";

function invalid(message: string): never {
  throw new OmpTreeValidationError(message);
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

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function nullableNonEmptyText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return nonEmptyText(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative integer`);
  return value;
}

function textList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value.map((entry, index) => text(entry, `${label}[${index}]`));
}

function parseNode(value: unknown, index: number): OmpTreeNode {
  const label = `OMP tree node ${index}`;
  const item = record(value, label);
  exact(item, ["id", "parentId", "kind", "timestamp", "label", "labelTruncated"], label);
  return {
    id: nonEmptyText(required(item, "id", label), `${label} id`),
    parentId: nullableNonEmptyText(required(item, "parentId", label), `${label} parentId`),
    kind: nonEmptyText(required(item, "kind", label), `${label} kind`),
    timestamp: nonEmptyText(required(item, "timestamp", label), `${label} timestamp`),
    label: text(required(item, "label", label), `${label} label`),
    labelTruncated: boolean(required(item, "labelTruncated", label), `${label} labelTruncated`),
  };
}

function parseLineage(value: unknown): OmpTreeLineage {
  const label = "OMP tree lineage";
  const item = record(value, label);
  exact(item, ["sessionFile", "parentSession", "previousSessionFiles"], label);
  return {
    sessionFile: nonEmptyText(required(item, "sessionFile", label), `${label} sessionFile`),
    parentSession: nullableNonEmptyText(required(item, "parentSession", label), `${label} parentSession`),
    previousSessionFiles: textList(required(item, "previousSessionFiles", label), `${label} previousSessionFiles`).map((entry, index) => nonEmptyText(entry, `${label} previousSessionFiles[${index}]`)),
  };
}

/** Parse the exact result of `tree.get`, preserving every runtime null. */
export function parseOmpTreeData(value: unknown): OmpTreeData {
  const label = "OMP tree response";
  const item = record(value, label);
  exact(item, ["leafId", "nodes", "pathIds", "truncated", "lineage"], label);
  if (!Object.hasOwn(item, "nodes")) invalid(`${label} has no nodes`);
  if (!Object.hasOwn(item, "pathIds")) invalid(`${label} has no pathIds`);
  const nodes = item.nodes;
  if (!Array.isArray(nodes)) invalid(`${label} nodes must be an array`);
  const parsedNodes = nodes.map((node, index) => parseNode(node, index));
  const parsedPathIds = textList(item.pathIds, `${label} pathIds`).map((entry, index) => nonEmptyText(entry, `${label} pathIds[${index}]`));
  if (new Set(parsedNodes.map(node => node.id)).size !== parsedNodes.length) invalid(`${label} has duplicate node ids`);
  if (new Set(parsedPathIds).size !== parsedPathIds.length) invalid(`${label} has duplicate path ids`);
  return {
    leafId: nullableText(required(item, "leafId", label), `${label} leafId`),
    nodes: parsedNodes,
    pathIds: parsedPathIds,
    truncated: boolean(required(item, "truncated", label), `${label} truncated`),
    lineage: parseLineage(required(item, "lineage", label)),
  };
}

/** Parse the exact result of `tree.navigate`, including askReopen and nullable editor text. */
export function parseOmpTreeNavigateResult(value: unknown): OmpTreeNavigateResult {
  const label = "OMP tree navigate response";
  const item = record(value, label);
  exact(item, ["moved", "cancelled", "aborted", "askReopen", "summarized", "editorText", "editorTextTruncated", "editorImageCount", "leafId"], label);
  return {
    moved: boolean(required(item, "moved", label), `${label} moved`),
    cancelled: boolean(required(item, "cancelled", label), `${label} cancelled`),
    aborted: boolean(required(item, "aborted", label), `${label} aborted`),
    askReopen: boolean(required(item, "askReopen", label), `${label} askReopen`),
    summarized: boolean(required(item, "summarized", label), `${label} summarized`),
    editorText: nullableText(required(item, "editorText", label), `${label} editorText`),
    editorTextTruncated: boolean(required(item, "editorTextTruncated", label), `${label} editorTextTruncated`),
    editorImageCount: nonNegativeInteger(required(item, "editorImageCount", label), `${label} editorImageCount`),
    leafId: nullableText(required(item, "leafId", label), `${label} leafId`),
  };
}

/** Parse the shape persisted with a durable tree navigation receipt. */
export function parseOmpTreeNavigateSnapshot(value: unknown): OmpTreeNavigateSnapshot {
  const item = record(value, "Cedia tree navigate result");
  if (item.available === false) {
    exact(item, ["available", "reason"], "Cedia tree unavailable result");
    return { available: false, reason: text(required(item, "reason", "Cedia tree unavailable result"), "Cedia tree unavailable reason") };
  }
  if (item.available !== true) invalid("Cedia tree result available must be a boolean");
  const result = parseOmpTreeNavigateResult({
    moved: item.moved,
    cancelled: item.cancelled,
    aborted: item.aborted,
    askReopen: item.askReopen,
    summarized: item.summarized,
    editorText: item.editorText,
    editorTextTruncated: item.editorTextTruncated,
    editorImageCount: item.editorImageCount,
    leafId: item.leafId,
  });
  exact(item, ["available", "moved", "cancelled", "aborted", "askReopen", "summarized", "editorText", "editorTextTruncated", "editorImageCount", "leafId"], "Cedia tree available result");
  return { available: true, ...result };
}

function responseData(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
  return value;
}

function controlAvailable(client: OmpTreeClient): boolean {
  if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
  return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

/** Run one registered tree operation, answering `undefined` when the bridge is absent. */
async function control(client: OmpTreeClient, operation: "tree.get" | "tree.navigate", payload?: Record<string, unknown>): Promise<unknown | undefined> {
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

/** Read OMP's current session tree through the capability bridge. */
export async function readOmpTree(client: OmpTreeClient): Promise<OmpTreeData | undefined> {
  const result = await control(client, "tree.get");
  return result === undefined ? undefined : parseOmpTreeData(result);
}

/** Navigate OMP's session tree and validate its own post-navigation result. */
export async function navigateOmpTree(client: OmpTreeClient, entryId: string, summarize?: boolean): Promise<OmpTreeNavigateResult | undefined> {
  if (typeof entryId !== "string" || entryId.trim().length === 0) throw new OmpTreeValidationError("OMP tree navigate entryId must be a non-empty string");
  if (summarize !== undefined && typeof summarize !== "boolean") throw new OmpTreeValidationError("OMP tree navigate summarize must be a boolean");
  const result = await control(client, "tree.navigate", { entryId, ...(summarize === undefined ? {} : { summarize }) });
  return result === undefined ? undefined : parseOmpTreeNavigateResult(result);
}

/** Per-session OMP tree projection. OMP remains the owner of tree and lineage state. */
export class OmpTree {
  #client: OmpTreeClient | undefined;
  #tree: OmpTreeData | undefined;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpTreeClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_TREE_RUNTIME_REASON;
  }

  setClient(client: OmpTreeClient | undefined): void {
    const changed = this.#client !== client;
    this.#client = client;
    if (!client || changed) this.#clearUnavailable(NO_OMP_TREE_RUNTIME_REASON);
  }

  /** Read and cache OMP's current tree without starting a runtime. */
  async read(client?: OmpTreeClient): Promise<OmpTreeData | undefined> {
    const target = client ?? this.#client;
    if (!target || target.phase !== "ready") return undefined;
    if (client !== undefined && client !== this.#client) this.setClient(client);
    const tree = await readOmpTree(target);
    if (tree !== undefined) this.#set(tree);
    return tree;
  }

  /** Navigate through OMP's owner operation. */
  async navigate(entryId: string, summarize?: boolean): Promise<OmpTreeNavigateResult> {
    const client = this.#client;
    if (!client || client.phase !== "ready") throw new Error(NO_OMP_TREE_RUNTIME_REASON);
    if (!controlAvailable(client)) throw new Error(NO_OMP_TREE_BRIDGE_REASON);
    const result = await navigateOmpTree(client, entryId, summarize);
    if (result === undefined) throw new Error(NO_OMP_TREE_BRIDGE_REASON);
    return result;
  }

  /** Refresh the tree from an already-running runtime. */
  async refresh(): Promise<OmpTreeSnapshot> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_TREE_RUNTIME_REASON);
      return this.snapshot();
    }
    if (!controlAvailable(client)) {
      this.#clearUnavailable(NO_OMP_TREE_BRIDGE_REASON);
      return this.snapshot();
    }
    const tree = await this.read();
    if (tree === undefined) this.#clearUnavailable(NO_OMP_TREE_BRIDGE_REASON);
    return this.snapshot();
  }

  snapshot(): OmpTreeSnapshot {
    const client = this.#client;
    if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_TREE_RUNTIME_REASON };
    if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_TREE_BRIDGE_REASON };
    if (this.#tree === undefined) return { state: "unavailable", reason: this.#unavailableReason };
    return { state: "available", ...this.#tree };
  }

  #set(tree: OmpTreeData): void {
    this.#tree = parseOmpTreeData(tree);
    this.#unavailableReason = "";
  }

  #clearUnavailable(reason: string): void {
    this.#tree = undefined;
    this.#unavailableReason = reason;
  }
}
