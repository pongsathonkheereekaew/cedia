import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpModel = {
	readonly provider: string;
	readonly id: string;
};

export type OmpModelEffort = {
	readonly configured: string | null;
	readonly autoResolved: string | null;
	readonly isAuto: boolean;
};

export type OmpServiceTier = {
	readonly family: string;
	readonly tier: string | null;
};

export type OmpServiceTiers = {
	readonly families: readonly string[];
	readonly tiers: readonly string[];
	readonly current: readonly OmpServiceTier[];
};

export type OmpModelStateData = {
	readonly model: OmpModel | null;
	readonly effort: OmpModelEffort;
	readonly serviceTiers: OmpServiceTiers;
};

export type OmpAccountsAccount = {
	readonly credentialId: number;
	readonly label: string | null;
	readonly active: boolean;
};

export type OmpAccounts = {
	readonly supported: boolean;
	readonly provider: string | null;
	readonly accounts: readonly OmpAccountsAccount[];
	readonly truncated: boolean;
};

export type OmpServiceTierResult = {
	readonly family: string;
	readonly tier: string | null;
	readonly serviceTiers: OmpServiceTiers;
};

export type OmpAccountPinResult = {
	readonly pinned: boolean;
	readonly list: OmpAccounts;
};

export type OmpAvailable<T> = T | { readonly available: false; readonly reason: string };

/**
 * The wire answer for the two reads: the data with an explicit `available: true`, or the host's own
 * reason. The reads share this shape with the other session-scoped reads (history, context), so a
 * client can tell absence from data without inspecting the payload's fields.
 */
export function asAvailableAnswer<T extends object>(
	value: OmpAvailable<T>,
): ({ readonly available: true } & T) | { readonly available: false; readonly reason: string } {
	if ((value as { readonly available?: unknown }).available === false) {
		return value as { readonly available: false; readonly reason: string };
	}
	return { available: true, ...(value as T) };
}


export type OmpAccountPinCommandRequest = {
	readonly commandId: string;
	readonly incarnation: string;
	readonly credentialId: number;
};

export type OmpServiceTierCommandRequest = {
	readonly commandId: string;
	readonly incarnation: string;
	readonly family: string;
	readonly tier: string | null;
};

export type OmpModelRoleSource = "runtime" | "overlay" | "project" | "global" | "default";

export type OmpModelRoleEntry = {
  readonly role: string;
  readonly modelId: string;
  readonly source: OmpModelRoleSource;
};

export type OmpModelRolesData = {
  readonly cycleOrder: readonly string[];
  readonly roles: readonly OmpModelRoleEntry[];
  readonly storage: string;
};

export type OmpRoleApplyData = {
  readonly role: string;
  readonly provider: string;
  readonly model: string;
};

export type OmpRoleApplyCommandRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly role: string;
};

export type OmpRoleSetCommandRequest = {
  readonly commandId: string;
  readonly incarnation: string;
  readonly role: string;
  readonly modelId: string | null;
};

/** A validation failure from a runtime-owned model/account answer. */
export class OmpModelStateValidationError extends TypeError {
	readonly name = "OmpModelStateValidationError";
	readonly code = "omp_model_state_invalid" as const;
}

export const NO_OMP_MODEL_STATE_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's model state.";
export const NO_OMP_MODEL_STATE_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for model state.";
export const NO_OMP_ACCOUNTS_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's provider accounts.";
export const NO_OMP_ACCOUNTS_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for provider accounts.";

/** A live OMP client with the Cedia control bridge negotiated in its ready frame. */
export type OmpModelStateClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

function invalid(message: string): never {
	throw new OmpModelStateValidationError(message);
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

function nullableText(value: unknown, label: string): string | null {
	if (value === null) return null;
	return text(value, label);
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
	return value;
}

function credentialId(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative safe integer`);
	return value;
}

function strings(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value)) invalid(`${label} must be an array`);
	return value.map((entry, index) => text(entry, `${label}[${index}]`));
}

function parseModel(value: unknown, label: string): OmpModel | null {
	if (value === null) return null;
	const item = record(value, label);
	exact(item, ["provider", "id"], label);
	return { provider: text(required(item, "provider", label), `${label} provider`), id: text(required(item, "id", label), `${label} id`) };
}

export function parseOmpServiceTiers(value: unknown, label = "OMP service tiers"): OmpServiceTiers {
	const item = record(value, label);
	exact(item, ["families", "tiers", "current"], label);
	const families = strings(required(item, "families", label), `${label} families`);
	const tiers = strings(required(item, "tiers", label), `${label} tiers`);
	const rawCurrent = required(item, "current", label);
	if (!Array.isArray(rawCurrent)) invalid(`${label} current must be an array`);
	const current = rawCurrent.map((value, index) => {
		const currentLabel = `${label} current[${index}]`;
		const row = record(value, currentLabel);
		exact(row, ["family", "tier"], currentLabel);
		return {
			family: text(required(row, "family", currentLabel), `${currentLabel} family`),
			tier: nullableText(required(row, "tier", currentLabel), `${currentLabel} tier`),
		};
	});
	return { families, tiers, current };
}

/** Parse the exact result of `model.state.get`. */
export function parseOmpModelState(value: unknown): OmpModelStateData {
	const item = record(value, "OMP model state response");
	exact(item, ["model", "effort", "serviceTiers"], "OMP model state response");
	const effort = record(required(item, "effort", "OMP model state response"), "OMP model state effort");
	exact(effort, ["configured", "autoResolved", "isAuto"], "OMP model state effort");
	return {
		model: parseModel(required(item, "model", "OMP model state response"), "OMP model state model"),
		effort: {
			configured: nullableText(required(effort, "configured", "OMP model state effort"), "OMP model state effort configured"),
			autoResolved: nullableText(required(effort, "autoResolved", "OMP model state effort"), "OMP model state effort autoResolved"),
			isAuto: boolean(required(effort, "isAuto", "OMP model state effort"), "OMP model state effort isAuto"),
		},
		serviceTiers: parseOmpServiceTiers(required(item, "serviceTiers", "OMP model state response")),
	};
}

/** Parse the exact result of `auth.accounts.list`. */
export function parseOmpAccounts(value: unknown): OmpAccounts {
	const item = record(value, "OMP accounts response");
	exact(item, ["supported", "provider", "accounts", "truncated"], "OMP accounts response");
	const rawAccounts = required(item, "accounts", "OMP accounts response");
	if (!Array.isArray(rawAccounts)) invalid("OMP accounts accounts must be an array");
	return {
		supported: boolean(required(item, "supported", "OMP accounts response"), "OMP accounts supported"),
		provider: nullableText(required(item, "provider", "OMP accounts response"), "OMP accounts provider"),
		accounts: rawAccounts.map((value, index) => {
			const label = `OMP account ${index}`;
			const account = record(value, label);
			exact(account, ["credentialId", "label", "active"], label);
			return {
				credentialId: credentialId(required(account, "credentialId", label), `${label} credentialId`),
				label: nullableText(required(account, "label", label), `${label} label`),
				active: boolean(required(account, "active", label), `${label} active`),
			};
		}),
		truncated: boolean(required(item, "truncated", "OMP accounts response"), "OMP accounts truncated"),
	};
}

/** Parse the exact result of `model.service-tier.set`. */
export function parseOmpServiceTierResult(value: unknown): OmpServiceTierResult {
	const item = record(value, "OMP service-tier response");
	exact(item, ["family", "tier", "serviceTiers"], "OMP service-tier response");
	return {
		family: text(required(item, "family", "OMP service-tier response"), "OMP service-tier family"),
		tier: nullableText(required(item, "tier", "OMP service-tier response"), "OMP service-tier tier"),
		serviceTiers: parseOmpServiceTiers(required(item, "serviceTiers", "OMP service-tier response")),
	};
}

/** Parse the exact result of `model.roles.get`. */
export function parseOmpModelRoles(value: unknown): OmpModelRolesData {
  const label = "OMP model roles response";
  const item = record(value, label);
  exact(item, ["cycleOrder", "roles", "storage"], label);
  const rawOrder = required(item, "cycleOrder", label);
  if (!Array.isArray(rawOrder)) invalid(`${label} cycleOrder must be an array`);
  const cycleOrder = rawOrder.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) invalid(`${label} cycleOrder[${index}] must be a non-empty string`);
    return entry;
  });
  const rawRoles = required(item, "roles", label);
  if (!Array.isArray(rawRoles)) invalid(`${label} roles must be an array`);
  const layers = ["runtime", "overlay", "project", "global", "default"] as const;
  const roles = rawRoles.map((entry, index) => {
    const entryLabel = `${label} roles[${index}]`;
    const row = record(entry, entryLabel);
    exact(row, ["role", "modelId", "source"], entryLabel);
    const role = required(row, "role", entryLabel);
    const modelId = required(row, "modelId", entryLabel);
    const source = required(row, "source", entryLabel);
    if (typeof role !== "string" || role.trim().length === 0) invalid(`${entryLabel} role must be a non-empty string`);
    if (typeof modelId !== "string" || modelId.trim().length === 0) invalid(`${entryLabel} modelId must be a non-empty string`);
    if (typeof source !== "string" || !(layers as readonly string[]).includes(source)) invalid(`${entryLabel} source must be a role provenance layer`);
    return { role, modelId, source: source as OmpModelRoleSource };
  });
  const storage = required(item, "storage", label);
  if (typeof storage !== "string" || storage.trim().length === 0) invalid(`${label} storage must be a non-empty string`);
  return { cycleOrder, roles, storage };
}

/** Parse the exact result of `model.roles.apply`: the role and the model that followed. */
export function parseOmpRoleApplyResult(value: unknown): OmpRoleApplyData {
  const label = "OMP role apply response";
  const item = record(value, label);
  exact(item, ["role", "provider", "model"], label);
  return {
    role: text(required(item, "role", label), `${label} role`),
    provider: text(required(item, "provider", label), `${label} provider`),
    model: text(required(item, "model", label), `${label} model`),
  };
}

export const parseOmpModelRolesCommandResult = parseOmpModelRoles;
export const parseOmpRoleApplyCommandResult = parseOmpRoleApplyResult;

/** Parse the exact result of `auth.account.pin`. */
export function parseOmpAccountPinResult(value: unknown): OmpAccountPinResult {
	const item = record(value, "OMP account pin response");
	exact(item, ["pinned", "list"], "OMP account pin response");
	return {
		pinned: boolean(required(item, "pinned", "OMP account pin response"), "OMP account pin pinned"),
		list: parseOmpAccounts(required(item, "list", "OMP account pin response")),
	};
}

// The command-oriented aliases keep the parser names parallel with the other host bridges.
export const parseOmpModelStateCommandResult = parseOmpModelState;
export const parseOmpAccountsCommandResult = parseOmpAccounts;
export const parseOmpServiceTierCommandResult = parseOmpServiceTierResult;
export const parseOmpAccountPinCommandResult = parseOmpAccountPinResult;
export const parseOmpModelStateData = parseOmpModelState;
export const parseOmpAccountsData = parseOmpAccounts;

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpModelStateClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

async function control(client: OmpModelStateClient, operation: string, payload?: Record<string, unknown>): Promise<unknown | undefined> {
	if (!controlAvailable(client)) return undefined;
	let response: { readonly data?: unknown };
	try {
		response = await client.requestCedia("cedia_control", { operation, ...(payload === undefined ? {} : { payload }) });
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

export async function readOmpModelState(client: OmpModelStateClient): Promise<OmpModelStateData | undefined> {
	const result = await control(client, "model.state.get");
	return result === undefined ? undefined : parseOmpModelState(result);
}

export async function readOmpAccounts(client: OmpModelStateClient): Promise<OmpAccounts | undefined> {
	const result = await control(client, "auth.accounts.list");
	return result === undefined ? undefined : parseOmpAccounts(result);
}

export async function setOmpServiceTier(client: OmpModelStateClient, family: string, tier: string | null): Promise<OmpServiceTierResult | undefined> {
	text(family, "OMP service-tier family");
	if (tier !== null) text(tier, "OMP service-tier tier");
	const result = await control(client, "model.service-tier.set", { family, tier });
	return result === undefined ? undefined : parseOmpServiceTierResult(result);
}

export async function readOmpModelRoles(client: OmpModelStateClient): Promise<OmpModelRolesData | undefined> {
  const result = await control(client, "model.roles.get");
  return result === undefined ? undefined : parseOmpModelRoles(result);
}

export async function applyOmpRole(client: OmpModelStateClient, roleValue: string): Promise<OmpRoleApplyData | undefined> {
  if (typeof roleValue !== "string" || roleValue.trim().length === 0) throw new OmpModelStateValidationError("OMP role apply needs a role name");
  const result = await control(client, "model.roles.apply", { role: roleValue });
  return result === undefined ? undefined : parseOmpRoleApplyResult(result);
}

/** Assign (or, with null, clear) one role mapping; answers the roles table that follows. */
export async function setOmpModelRole(client: OmpModelStateClient, roleValue: string, modelIdValue: string | null): Promise<OmpModelRolesData | undefined> {
  if (typeof roleValue !== "string" || roleValue.trim().length === 0) throw new OmpModelStateValidationError("OMP role set needs a role name");
  if (modelIdValue !== null && (typeof modelIdValue !== "string" || modelIdValue.trim().length === 0)) throw new OmpModelStateValidationError("OMP role set needs a model id, or null to clear the role");
  const result = await control(client, "model.roles.set", { role: roleValue, modelId: modelIdValue });
  return result === undefined ? undefined : parseOmpModelRoles(result);
}

export async function pinOmpAccount(client: OmpModelStateClient, credentialIdValue: number): Promise<OmpAccountPinResult | undefined> {
	credentialId(credentialIdValue, "OMP account credentialId");
	const result = await control(client, "auth.account.pin", { credentialId: credentialIdValue });
	return result === undefined ? undefined : parseOmpAccountPinResult(result);
}

/** Per-session runtime-owned model, service-tier and provider-account surface. */
export class OmpModelState {
	#client: OmpModelStateClient | undefined;

	constructor(options: { readonly client?: OmpModelStateClient } = {}) {
		this.#client = options.client;
	}

	setClient(client: OmpModelStateClient | undefined): void {
		this.#client = client;
	}

	async model(): Promise<OmpAvailable<OmpModelStateData>> {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { available: false, reason: NO_OMP_MODEL_STATE_RUNTIME_REASON };
		if (!controlAvailable(client)) return { available: false, reason: NO_OMP_MODEL_STATE_BRIDGE_REASON };
		const result = await readOmpModelState(client);
		return result === undefined ? { available: false, reason: NO_OMP_MODEL_STATE_BRIDGE_REASON } : result;
	}

	async accounts(): Promise<OmpAvailable<OmpAccounts>> {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { available: false, reason: NO_OMP_ACCOUNTS_RUNTIME_REASON };
		if (!controlAvailable(client)) return { available: false, reason: NO_OMP_ACCOUNTS_BRIDGE_REASON };
		const result = await readOmpAccounts(client);
		return result === undefined ? { available: false, reason: NO_OMP_ACCOUNTS_BRIDGE_REASON } : result;
	}

	async pin(credentialIdValue: number): Promise<OmpAccountPinResult | undefined> {
		const client = this.#client;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_ACCOUNTS_RUNTIME_REASON);
		if (!controlAvailable(client)) return undefined;
		return pinOmpAccount(client, credentialIdValue);
	}

	async serviceTier(family: string, tier: string | null): Promise<OmpServiceTierResult | undefined> {
		const client = this.#client;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_MODEL_STATE_RUNTIME_REASON);
		if (!controlAvailable(client)) return undefined;
		return setOmpServiceTier(client, family, tier);
	}

	async roles(): Promise<OmpAvailable<OmpModelRolesData>> {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { available: false, reason: NO_OMP_MODEL_STATE_RUNTIME_REASON };
		if (!controlAvailable(client)) return { available: false, reason: NO_OMP_MODEL_STATE_BRIDGE_REASON };
		const result = await readOmpModelRoles(client);
		return result === undefined ? { available: false, reason: NO_OMP_MODEL_STATE_BRIDGE_REASON } : result;
	}

	async applyRole(roleValue: string): Promise<OmpRoleApplyData | undefined> {
		const client = this.#client;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_MODEL_STATE_RUNTIME_REASON);
		if (!controlAvailable(client)) return undefined;
		return applyOmpRole(client, roleValue);
	}

	async setRole(roleValue: string, modelIdValue: string | null): Promise<OmpModelRolesData | undefined> {
		const client = this.#client;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_MODEL_STATE_RUNTIME_REASON);
		if (!controlAvailable(client)) return undefined;
		return setOmpModelRole(client, roleValue, modelIdValue);
	}
}
