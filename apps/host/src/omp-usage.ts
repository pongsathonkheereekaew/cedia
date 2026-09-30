import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpUsageScope = {
	readonly provider?: string;
	readonly accountId?: string;
};

export type OmpUsageWindow = {
	readonly id: string;
	readonly label: string;
	readonly resetsAt?: number;
};

export type OmpUsageAmount = {
	readonly unit: string;
	readonly usedFraction?: number;
	readonly used?: number;
	readonly limit?: number;
	readonly remainingFraction?: number;
};

export type OmpUsageLimit = {
	readonly id: string;
	readonly label: string;
	readonly scope?: OmpUsageScope;
	readonly window?: OmpUsageWindow;
	readonly amount: OmpUsageAmount;
	readonly status?: string;
	readonly notes?: readonly string[];
};

export type OmpUsageCredit = {
	readonly grantedAt?: string;
	readonly expiresAt?: string;
	readonly status?: string;
};

export type OmpUsageReport = {
	readonly provider: string;
	readonly fetchedAt: number;
	readonly limits: readonly OmpUsageLimit[];
	readonly resetCredits?: {
		readonly availableCount: number;
		readonly credits?: readonly OmpUsageCredit[];
	};
	readonly notes?: readonly string[];
	readonly accountId?: string;
	readonly accountEmail?: string;
	readonly limitReached?: boolean;
};

export type OmpUsageData = {
	readonly reports: readonly OmpUsageReport[];
	readonly supported?: boolean;
	readonly unavailable?: string;
};

export type OmpUsageSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpUsageData)
	| { readonly state: "unavailable"; readonly reason: string };

/** A validation failure from an OMP usage result. */
export class OmpUsageValidationError extends TypeError {
	readonly name = "OmpUsageValidationError";
	readonly code = "omp_usage_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpUsageClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_USAGE_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's provider usage.";
export const NO_OMP_USAGE_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for provider usage.";

function invalid(message: string): never {
	throw new OmpUsageValidationError(message);
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

function finiteNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${label} must be a finite number`);
	return value;
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative integer`);
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid(`${label} must be a positive integer`);
	return value;
}

function strings(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value)) invalid(`${label} must be an array`);
	return value.map((entry, index) => text(entry, `${label}[${index}]`));
}

function parseScope(value: unknown, label: string): OmpUsageScope {
	const item = record(value, label);
	exact(item, ["provider", "accountId"], label);
	return {
		...(Object.hasOwn(item, "provider") ? { provider: text(item.provider, `${label} provider`) } : {}),
		...(Object.hasOwn(item, "accountId") ? { accountId: text(item.accountId, `${label} accountId`) } : {}),
	};
}

function parseWindow(value: unknown, label: string): OmpUsageWindow {
	const item = record(value, label);
	exact(item, ["id", "label", "resetsAt"], label);
	return {
		id: text(item.id, `${label} id`),
		label: text(item.label, `${label} label`),
		...(Object.hasOwn(item, "resetsAt") ? { resetsAt: finiteNumber(item.resetsAt, `${label} resetsAt`) } : {}),
	};
}

function parseAmount(value: unknown, label: string): OmpUsageAmount {
	const item = record(value, label);
	exact(item, ["unit", "usedFraction", "used", "limit", "remainingFraction"], label);
	return {
		unit: text(item.unit, `${label} unit`),
		...(Object.hasOwn(item, "usedFraction") ? { usedFraction: finiteNumber(item.usedFraction, `${label} usedFraction`) } : {}),
		...(Object.hasOwn(item, "used") ? { used: finiteNumber(item.used, `${label} used`) } : {}),
		...(Object.hasOwn(item, "limit") ? { limit: finiteNumber(item.limit, `${label} limit`) } : {}),
		...(Object.hasOwn(item, "remainingFraction") ? { remainingFraction: finiteNumber(item.remainingFraction, `${label} remainingFraction`) } : {}),
	};
}

function parseLimit(value: unknown, index: number): OmpUsageLimit {
	const label = `OMP usage limit ${index}`;
	const item = record(value, label);
	exact(item, ["id", "label", "scope", "window", "amount", "status", "notes"], label);
	if (!Object.hasOwn(item, "amount")) invalid(`${label} must include amount`);
	return {
		id: text(item.id, `${label} id`),
		label: text(item.label, `${label} label`),
		...(Object.hasOwn(item, "scope") ? { scope: parseScope(item.scope, `${label} scope`) } : {}),
		...(Object.hasOwn(item, "window") ? { window: parseWindow(item.window, `${label} window`) } : {}),
		amount: parseAmount(item.amount, `${label} amount`),
		...(Object.hasOwn(item, "status") ? { status: text(item.status, `${label} status`) } : {}),
		...(Object.hasOwn(item, "notes") ? { notes: strings(item.notes, `${label} notes`) } : {}),
	};
}

function parseCredit(value: unknown, index: number): OmpUsageCredit {
	const label = `OMP usage reset credit ${index}`;
	const item = record(value, label);
	exact(item, ["grantedAt", "expiresAt", "status"], label);
	return {
		...(Object.hasOwn(item, "grantedAt") ? { grantedAt: text(item.grantedAt, `${label} grantedAt`) } : {}),
		...(Object.hasOwn(item, "expiresAt") ? { expiresAt: text(item.expiresAt, `${label} expiresAt`) } : {}),
		...(Object.hasOwn(item, "status") ? { status: text(item.status, `${label} status`) } : {}),
	};
}

function parseResetCredits(value: unknown, label: string): OmpUsageReport["resetCredits"] {
	const item = record(value, label);
	exact(item, ["availableCount", "credits"], label);
	return {
		availableCount: nonNegativeInteger(item.availableCount, `${label} availableCount`),
		...(Object.hasOwn(item, "credits")
			? {
					credits: (() => {
						if (!Array.isArray(item.credits)) invalid(`${label} credits must be an array`);
						return item.credits.map((credit, index) => parseCredit(credit, index));
					})(),
			  }
			: {}),
	};
}

function parseReport(value: unknown, index: number): OmpUsageReport {
	const label = `OMP usage report ${index}`;
	const item = record(value, label);
	exact(item, ["provider", "fetchedAt", "limits", "resetCredits", "notes", "accountId", "accountEmail", "limitReached"], label);
	if (!Object.hasOwn(item, "limits")) invalid(`${label} must include limits`);
	if (!Array.isArray(item.limits)) invalid(`${label} limits must be an array`);
	return {
		provider: text(item.provider, `${label} provider`),
		fetchedAt: finiteNumber(item.fetchedAt, `${label} fetchedAt`),
		limits: item.limits.map((limit, limitIndex) => parseLimit(limit, limitIndex)),
		...(Object.hasOwn(item, "resetCredits") ? { resetCredits: parseResetCredits(item.resetCredits, `${label} resetCredits`) } : {}),
		...(Object.hasOwn(item, "notes") ? { notes: strings(item.notes, `${label} notes`) } : {}),
		...(Object.hasOwn(item, "accountId") ? { accountId: text(item.accountId, `${label} accountId`) } : {}),
		...(Object.hasOwn(item, "accountEmail") ? { accountEmail: text(item.accountEmail, `${label} accountEmail`) } : {}),
		...(Object.hasOwn(item, "limitReached") ? { limitReached: boolean(item.limitReached, `${label} limitReached`) } : {}),
	};
}

/** Parse the runtime's usage projection without converting an omitted amount into zero. */
export function parseOmpUsageData(value: unknown): OmpUsageData {
	const item = record(value, "OMP usage response");
	exact(item, ["reports", "supported", "unavailable"], "OMP usage response");
	if (!Object.hasOwn(item, "reports")) invalid("OMP usage response must include reports");
	if (!Array.isArray(item.reports)) invalid("OMP usage reports must be an array");
	return {
		reports: item.reports.map((report, index) => parseReport(report, index)),
		...(Object.hasOwn(item, "supported") ? { supported: boolean(item.supported, "OMP usage supported") } : {}),
		...(Object.hasOwn(item, "unavailable") ? { unavailable: text(item.unavailable, "OMP usage unavailable") } : {}),
	};
}

/** Parse a snapshot persisted or returned by a host route. */
export function parseOmpUsageCommandResult(value: unknown): OmpUsageSnapshot {
	const item = record(value, "Cedia usage result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia usage unavailable result");
		return { state: "unavailable", reason: text(item.reason, "Cedia usage unavailable reason") };
	}
	if (item.state !== "available") invalid("Cedia usage result state is unsupported");
	exact(item, ["state", "revision", "reports", "supported", "unavailable"], "Cedia usage available result");
	return {
		state: "available",
		revision: positiveInteger(item.revision, "Cedia usage revision"),
		...parseOmpUsageData({
			reports: item.reports,
			...(Object.hasOwn(item, "supported") ? { supported: item.supported } : {}),
			...(Object.hasOwn(item, "unavailable") ? { unavailable: item.unavailable } : {}),
		}),
	};
}

/** Alias for callers that name the parsed value by its public snapshot type. */
export const parseOmpUsageSnapshot = parseOmpUsageCommandResult;

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpUsageClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

/** Run the no-payload usage operation, answering undefined when the bridge is absent. */
async function control(client: OmpUsageClient): Promise<unknown | undefined> {
	if (!controlAvailable(client)) return undefined;
	let response: { readonly data?: unknown };
	try {
		response = await client.requestCedia("cedia_control", { operation: "usage.get" });
	} catch (error) {
		if (error instanceof OmpClientStateError) return undefined;
		throw error;
	}
	const data = record(responseData(response), "Cedia control response");
	exact(data, ["operation", "capabilityRevision", "result"], "Cedia control response");
	if (data.operation !== "usage.get") invalid(`Cedia control answered ${String(data.operation)} for usage.get`);
	if (typeof data.capabilityRevision !== "string" || data.capabilityRevision.trim().length === 0) invalid("Cedia control capability revision must be a non-empty string");
	if (!Object.hasOwn(data, "result") || data.result === undefined) invalid("Cedia control response has no result");
	return data.result;
}

/** Read OMP's provider usage projection through the negotiated capability bridge. */
export async function readOmpUsage(client: OmpUsageClient): Promise<OmpUsageData | undefined> {
	const result = await control(client);
	return result === undefined ? undefined : parseOmpUsageData(result);
}

/** Per-session usage projection. Provider IO runs only when a caller explicitly invokes read(). */
export class OmpUsage {
	#client: OmpUsageClient | undefined;
	#usage: OmpUsageData | undefined;
	#revision = 0;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpUsageClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_USAGE_RUNTIME_REASON;
	}

	setClient(client: OmpUsageClient | undefined): void {
		const changed = this.#client !== client;
		this.#client = client;
		if (!client || changed) this.#clearUnavailable(NO_OMP_USAGE_RUNTIME_REASON);
	}

	/** Read provider usage from an already-running runtime; this deliberately has no seed/refresh path. */
	async read(client?: OmpUsageClient): Promise<OmpUsageData | undefined> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") return undefined;
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const usage = await readOmpUsage(target);
		if (usage !== undefined) this.#set(usage);
		return usage;
	}

	snapshot(): OmpUsageSnapshot {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_USAGE_RUNTIME_REASON };
		if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_USAGE_BRIDGE_REASON };
		if (this.#usage === undefined) return { state: "unavailable", reason: this.#unavailableReason };
		return { state: "available", revision: this.#revision, ...this.#usage };
	}

	#set(usage: OmpUsageData): void {
		this.#usage = parseOmpUsageData(usage);
		this.#revision += 1;
		this.#unavailableReason = "";
	}

	#clearUnavailable(reason: string): void {
		this.#usage = undefined;
		this.#unavailableReason = reason;
	}
}
