import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpCreditsResetCredit = {
	readonly id: string;
	readonly resetType?: string;
	readonly status?: string;
	readonly grantedAt?: string;
	readonly expiresAt?: string;
	readonly title?: string;
	readonly description?: string;
};

export type OmpCreditsAccount = {
	readonly credentialId?: number;
	readonly accountId?: string;
	readonly email?: string;
	readonly availableCount: number;
	readonly credits: readonly OmpCreditsResetCredit[];
	readonly active: boolean;
	readonly error?: string;
};

export type OmpCreditsData = {
	readonly accounts: readonly OmpCreditsAccount[];
	readonly unavailable?: string;
};

export type OmpCreditsRedeemOutcome = {
	readonly ok: boolean;
	readonly code: string;
	readonly accountId?: string;
	readonly email?: string;
	readonly creditId?: string;
};

export type OmpCreditsTarget = {
	readonly credentialId?: number;
	readonly accountId?: string;
	readonly email?: string;
};

export type OmpCreditsCommandRequest = {
	readonly commandId: string;
	readonly incarnation: string;
	readonly target: OmpCreditsTarget;
};

export type OmpCreditsSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpCreditsData)
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpCreditsRedeemSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpCreditsData & { readonly lastRedeem: OmpCreditsRedeemOutcome })
	| { readonly state: "unavailable"; readonly reason: string; readonly lastRedeem?: OmpCreditsRedeemOutcome };

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpCreditsClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

/** A validation failure from an OMP credits result. */
export class OmpCreditsValidationError extends TypeError {
	readonly name = "OmpCreditsValidationError";
	readonly code = "omp_credits_invalid" as const;
}

export const NO_OMP_CREDITS_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's saved reset credits.";
export const NO_OMP_CREDITS_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for saved reset credits.";

function invalid(message: string): never {
	throw new OmpCreditsValidationError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	const keys = new Set(allowed);
	for (const key of Object.keys(value)) if (!keys.has(key)) invalid(`${label} has an unknown field ${key}`);
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

function integer(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid(`${label} must be a safe integer`);
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	const result = integer(value, label);
	if (result < 0) invalid(`${label} must be a non-negative integer`);
	return result;
}

function positiveInteger(value: unknown, label: string): number {
	const result = nonNegativeInteger(value, label);
	if (result < 1) invalid(`${label} must be a positive integer`);
	return result;
}

function parseCredit(value: unknown, index: number): OmpCreditsResetCredit {
	const label = `OMP reset credit ${index}`;
	const item = record(value, label);
	exact(item, ["id", "resetType", "status", "grantedAt", "expiresAt", "title", "description"], label);
	return {
		id: nonEmptyText(item.id, `${label} id`),
		...(Object.hasOwn(item, "resetType") ? { resetType: nonEmptyText(item.resetType, `${label} resetType`) } : {}),
		...(Object.hasOwn(item, "status") ? { status: nonEmptyText(item.status, `${label} status`) } : {}),
		...(Object.hasOwn(item, "grantedAt") ? { grantedAt: nonEmptyText(item.grantedAt, `${label} grantedAt`) } : {}),
		...(Object.hasOwn(item, "expiresAt") ? { expiresAt: nonEmptyText(item.expiresAt, `${label} expiresAt`) } : {}),
		...(Object.hasOwn(item, "title") ? { title: nonEmptyText(item.title, `${label} title`) } : {}),
		...(Object.hasOwn(item, "description") ? { description: nonEmptyText(item.description, `${label} description`) } : {}),
	};
}

function parseAccount(value: unknown, index: number): OmpCreditsAccount {
	const label = `OMP credits account ${index}`;
	const item = record(value, label);
	exact(item, ["credentialId", "accountId", "email", "availableCount", "credits", "active", "error"], label);
	if (!Object.hasOwn(item, "availableCount")) invalid(`${label} must include availableCount`);
	if (!Object.hasOwn(item, "credits")) invalid(`${label} must include credits`);
	if (!Array.isArray(item.credits)) invalid(`${label} credits must be an array`);
	if (!Object.hasOwn(item, "active")) invalid(`${label} must include active`);
	return {
		...(Object.hasOwn(item, "credentialId") ? { credentialId: nonNegativeInteger(item.credentialId, `${label} credentialId`) } : {}),
		...(Object.hasOwn(item, "accountId") ? { accountId: nonEmptyText(item.accountId, `${label} accountId`) } : {}),
		...(Object.hasOwn(item, "email") ? { email: nonEmptyText(item.email, `${label} email`) } : {}),
		availableCount: nonNegativeInteger(item.availableCount, `${label} availableCount`),
		credits: item.credits.map((credit, creditIndex) => parseCredit(credit, creditIndex)),
		active: boolean(item.active, `${label} active`),
		...(Object.hasOwn(item, "error") ? { error: nonEmptyText(item.error, `${label} error`) } : {}),
	};
}

/** Parse OMP's saved-reset listing without turning a failed listing into zero credits. */
export function parseOmpCreditsData(value: unknown): OmpCreditsData {
	const item = record(value, "OMP credits response");
	exact(item, ["accounts", "unavailable"], "OMP credits response");
	if (!Object.hasOwn(item, "accounts")) invalid("OMP credits response must include accounts");
	if (!Array.isArray(item.accounts)) invalid("OMP credits accounts must be an array");
	return {
		accounts: item.accounts.map((account, index) => parseAccount(account, index)),
		...(Object.hasOwn(item, "unavailable") ? { unavailable: nonEmptyText(item.unavailable, "OMP credits unavailable") } : {}),
	};
}

/** Parse OMP's own redeem outcome; only its `reset` code means a credit was spent. */
export function parseOmpCreditsRedeemOutcome(value: unknown): OmpCreditsRedeemOutcome {
	const item = record(value, "OMP credits redeem outcome");
	exact(item, ["ok", "code", "accountId", "email", "creditId"], "OMP credits redeem outcome");
	if (!Object.hasOwn(item, "ok")) invalid("OMP credits redeem outcome must include ok");
	if (!Object.hasOwn(item, "code")) invalid("OMP credits redeem outcome must include code");
	return {
		ok: boolean(item.ok, "OMP credits redeem ok"),
		code: nonEmptyText(item.code, "OMP credits redeem code"),
		...(Object.hasOwn(item, "accountId") ? { accountId: nonEmptyText(item.accountId, "OMP credits redeem accountId") } : {}),
		...(Object.hasOwn(item, "email") ? { email: nonEmptyText(item.email, "OMP credits redeem email") } : {}),
		...(Object.hasOwn(item, "creditId") ? { creditId: nonEmptyText(item.creditId, "OMP credits redeem creditId") } : {}),
	};
}

/** Parse a read snapshot persisted or returned by the host route. */
export function parseOmpCreditsCommandResult(value: unknown): OmpCreditsSnapshot {
	const item = record(value, "Cedia credits result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia credits unavailable result");
		return { state: "unavailable", reason: nonEmptyText(item.reason, "Cedia credits unavailable reason") };
	}
	if (item.state !== "available") invalid("Cedia credits result state is unsupported");
	exact(item, ["state", "revision", "accounts", "unavailable"], "Cedia credits available result");
	return {
		state: "available",
		revision: positiveInteger(item.revision, "Cedia credits revision"),
		...parseOmpCreditsData({
			accounts: item.accounts,
			...(Object.hasOwn(item, "unavailable") ? { unavailable: item.unavailable } : {}),
		}),
	};
}

export const parseOmpCreditsSnapshot = parseOmpCreditsCommandResult;

/** Parse a durable redeem receipt, including the outcome that was actually returned by OMP. */
export function parseOmpCreditsRedeemCommandResult(value: unknown): OmpCreditsRedeemSnapshot {
	const item = record(value, "Cedia credits redeem result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason", "lastRedeem"], "Cedia credits redeem unavailable result");
		return {
			state: "unavailable",
			reason: nonEmptyText(item.reason, "Cedia credits redeem unavailable reason"),
			...(Object.hasOwn(item, "lastRedeem") ? { lastRedeem: parseOmpCreditsRedeemOutcome(item.lastRedeem) } : {}),
		};
	}
	if (item.state !== "available") invalid("Cedia credits redeem result state is unsupported");
	exact(item, ["state", "revision", "accounts", "unavailable", "lastRedeem"], "Cedia credits redeem available result");
	if (!Object.hasOwn(item, "lastRedeem")) invalid("Cedia credits redeem result must include lastRedeem");
	const parsed = parseOmpCreditsCommandResult({
		state: "available",
		revision: item.revision,
		accounts: item.accounts,
		...(Object.hasOwn(item, "unavailable") ? { unavailable: item.unavailable } : {}),
	});
	if (parsed.state !== "available") invalid("Cedia credits redeem result state is unsupported");
	return {
		...parsed,
		lastRedeem: parseOmpCreditsRedeemOutcome(item.lastRedeem),
	};
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpCreditsClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

function targetPayload(target: OmpCreditsTarget): Record<string, unknown> {
	const names = (["credentialId", "accountId", "email"] as const).filter(name => target[name] !== undefined);
	if (names.length !== 1) invalid("OMP credits redeem needs exactly one account identifier");
	if (target.credentialId !== undefined) nonNegativeInteger(target.credentialId, "OMP credits credentialId");
	if (target.accountId !== undefined) nonEmptyText(target.accountId, "OMP credits accountId");
	if (target.email !== undefined) nonEmptyText(target.email, "OMP credits email");
	return {
		...(target.credentialId === undefined ? {} : { credentialId: target.credentialId }),
		...(target.accountId === undefined ? {} : { accountId: target.accountId }),
		...(target.email === undefined ? {} : { email: target.email }),
	};
}

/** Run one registered credits operation, answering undefined when the bridge is absent or closed. */
async function control(client: OmpCreditsClient, operation: "credits.get" | "credits.redeem", payload?: Record<string, unknown>): Promise<unknown | undefined> {
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

/** Read OMP's saved-reset projection through the negotiated capability bridge. */
export async function readOmpCredits(client: OmpCreditsClient): Promise<OmpCreditsData | undefined> {
	const result = await control(client, "credits.get");
	return result === undefined ? undefined : parseOmpCreditsData(result);
}

/** Redeem one saved reset through OMP after the owner route has authenticated and confirmed it. */
export async function redeemOmpCredits(client: OmpCreditsClient, target: OmpCreditsTarget): Promise<OmpCreditsRedeemOutcome | undefined> {
	const payload = targetPayload(target);
	const result = await control(client, "credits.redeem", {
		...payload,
		// The host route is owner-only and represents the owner's explicit UI confirmation here.
		confirm: true,
	});
	return result === undefined ? undefined : parseOmpCreditsRedeemOutcome(result);
}

/** Per-session saved-reset projection. Listing runs only when a caller explicitly invokes read(). */
export class OmpCredits {
	#client: OmpCreditsClient | undefined;
	#credits: OmpCreditsData | undefined;
	#revision = 0;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpCreditsClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_CREDITS_RUNTIME_REASON;
	}

	setClient(client: OmpCreditsClient | undefined): void {
		const changed = this.#client !== client;
		this.#client = client;
		if (!client || changed) this.#clearUnavailable(NO_OMP_CREDITS_RUNTIME_REASON);
	}

	/** Read the current saved-reset listing from an already-running runtime; there is no seed path. */
	async read(client?: OmpCreditsClient): Promise<OmpCreditsData | undefined> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") return undefined;
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const credits = await readOmpCredits(target);
		if (credits !== undefined) this.#set(credits);
		return credits;
	}

	/** Spend one saved reset; the owner route's confirmation is encoded on the runtime request. */
	async redeem(client: OmpCreditsClient, target: OmpCreditsTarget): Promise<OmpCreditsRedeemOutcome | undefined> {
		if (client.phase !== "ready") throw new Error(NO_OMP_CREDITS_RUNTIME_REASON);
		if (!controlAvailable(client)) throw new Error(NO_OMP_CREDITS_BRIDGE_REASON);
		if (client !== this.#client) this.setClient(client);
		const outcome = await redeemOmpCredits(client, target);
		if (outcome === undefined) throw new Error(NO_OMP_CREDITS_BRIDGE_REASON);
		return outcome;
	}

	snapshot(): OmpCreditsSnapshot {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_CREDITS_RUNTIME_REASON };
		if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_CREDITS_BRIDGE_REASON };
		if (this.#credits === undefined) return { state: "unavailable", reason: this.#unavailableReason };
		return { state: "available", revision: this.#revision, ...this.#credits };
	}

	#set(credits: OmpCreditsData): void {
		this.#credits = parseOmpCreditsData(credits);
		this.#revision += 1;
		this.#unavailableReason = "";
	}

	#clearUnavailable(reason: string): void {
		this.#credits = undefined;
		this.#unavailableReason = reason;
	}
}
