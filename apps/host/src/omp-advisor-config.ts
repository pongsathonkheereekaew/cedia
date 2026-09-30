import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";

export type OmpAdvisorConfigScope = "project" | "user";

export type OmpAdvisorConfigData = {
	readonly scope: OmpAdvisorConfigScope;
	readonly path: string;
	readonly exists: boolean;
	readonly text: string;
	readonly advisors?: number;
};

export type OmpAdvisorConfigSnapshot =
	| ({ readonly state: "available"; readonly revision: number } & OmpAdvisorConfigData)
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpAdvisorConfigReadRequest = {
	readonly scope: OmpAdvisorConfigScope;
};

export type OmpAdvisorConfigWriteRequest = {
	readonly commandId: string;
	readonly incarnation: string;
	readonly scope: OmpAdvisorConfigScope;
	readonly text: string;
};

/** Largest config text the host accepts on the wire; the runtime enforces the same bound. */
export const MAX_ADVISOR_CONFIG_TEXT_CHARS = 64 * 1024;

/** A validation failure from an OMP advisor-config result. */
export class OmpAdvisorConfigValidationError extends TypeError {
	readonly name = "OmpAdvisorConfigValidationError";
	readonly code = "omp_advisor_config_invalid" as const;
}

/** A live OMP client with the Cedia capability bridge negotiated in its ready frame. */
export type OmpAdvisorConfigClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_control",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
	readonly capabilitiesAdvertised?: () => boolean;
};

export const NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read or write this task's advisor config.";
export const NO_OMP_ADVISOR_CONFIG_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia capability bridge for advisor config.";

function invalid(message: string): never {
	throw new OmpAdvisorConfigValidationError(message);
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

function scope(value: unknown, label: string): OmpAdvisorConfigScope {
	if (value !== "project" && value !== "user") invalid(`${label} must be project or user`);
	return value;
}

/** Parse the exact result of `advisor.config.get`/`advisor.config.set` without inventing rows. */
export function parseOmpAdvisorConfigData(value: unknown): OmpAdvisorConfigData {
	const label = "OMP advisor config response";
	const item = record(value, label);
	exact(item, ["scope", "path", "exists", "text", "advisors"], label);
	const configText = text(required(item, "text", label), `${label} text`);
	if (configText.length > MAX_ADVISOR_CONFIG_TEXT_CHARS) invalid(`${label} text exceeds ${MAX_ADVISOR_CONFIG_TEXT_CHARS} characters`);
	const advisors = item.advisors === undefined ? undefined : nonNegativeInteger(item.advisors, `${label} advisors`);
	return {
		scope: scope(required(item, "scope", label), `${label} scope`),
		path: nonEmptyText(required(item, "path", label), `${label} path`),
		exists: boolean(required(item, "exists", label), `${label} exists`),
		text: configText,
		...(advisors === undefined ? {} : { advisors }),
	};
}

/** Parse the shape persisted with a durable advisor-config command receipt. */
export function parseOmpAdvisorConfigCommandResult(value: unknown): OmpAdvisorConfigSnapshot {
	const item = record(value, "Cedia advisor config command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason"], "Cedia advisor config unavailable result");
		return { state: "unavailable", reason: text(required(item, "reason", "Cedia advisor config unavailable reason"), "Cedia advisor config unavailable reason") };
	}
	if (item.state !== "available") invalid("Cedia advisor config result state is unsupported");
	exact(item, ["state", "revision", "scope", "path", "exists", "text", "advisors"], "Cedia advisor config available result");
	const revision = nonNegativeInteger(required(item, "revision", "Cedia advisor config available result"), "Cedia advisor config revision");
	if (revision < 1) invalid("Cedia advisor config revision must be positive");
	const data = parseOmpAdvisorConfigData({
		scope: item.scope,
		path: item.path,
		exists: item.exists,
		text: item.text,
		...(item.advisors === undefined ? {} : { advisors: item.advisors }),
	});
	return { state: "available", revision, ...data };
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { readonly data?: unknown }).data;
	return value;
}

function controlAvailable(client: OmpAdvisorConfigClient): boolean {
	if (client.capabilitiesAdvertised !== undefined) return client.capabilitiesAdvertised();
	return client.readyFrame?.cediaCapabilitiesVersion === 1;
}

/** Run one registered advisor-config operation, answering `undefined` when the bridge is absent. */
async function control(client: OmpAdvisorConfigClient, operation: "advisor.config.get" | "advisor.config.set", payload?: Record<string, unknown>): Promise<unknown | undefined> {
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

/** Read one scope's raw config text through the capability bridge. */
export async function readOmpAdvisorConfig(client: OmpAdvisorConfigClient, scope: OmpAdvisorConfigScope): Promise<OmpAdvisorConfigData | undefined> {
	if (scope !== "project" && scope !== "user") throw new OmpAdvisorConfigValidationError("OMP advisor config scope must be project or user");
	const result = await control(client, "advisor.config.get", { scope });
	return result === undefined ? undefined : parseOmpAdvisorConfigData(result);
}

/** Validate, write and apply one scope's config, answering the state that follows. */
export async function writeOmpAdvisorConfig(client: OmpAdvisorConfigClient, scope: OmpAdvisorConfigScope, configText: string): Promise<OmpAdvisorConfigData | undefined> {
	if (scope !== "project" && scope !== "user") throw new OmpAdvisorConfigValidationError("OMP advisor config scope must be project or user");
	if (typeof configText !== "string") throw new OmpAdvisorConfigValidationError("OMP advisor config text must be a string");
	if (configText.length > MAX_ADVISOR_CONFIG_TEXT_CHARS) throw new OmpAdvisorConfigValidationError(`OMP advisor config text exceeds ${MAX_ADVISOR_CONFIG_TEXT_CHARS} characters`);
	const result = await control(client, "advisor.config.set", { scope, text: configText });
	return result === undefined ? undefined : parseOmpAdvisorConfigData(result);
}

/** Per-session advisor-config projection. OMP remains the owner of the file and the roster. */
export class OmpAdvisorConfig {
	#client: OmpAdvisorConfigClient | undefined;
	#config: OmpAdvisorConfigData | undefined;
	#revision = 0;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpAdvisorConfigClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON;
	}

	setClient(client: OmpAdvisorConfigClient | undefined): void {
		const changed = this.#client !== client;
		this.#client = client;
		if (!client || changed) this.#clearUnavailable(NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON);
	}

	/** Read one scope's config without starting a runtime. */
	async read(scope: OmpAdvisorConfigScope, client?: OmpAdvisorConfigClient): Promise<OmpAdvisorConfigData | undefined> {
		const target = client ?? this.#client;
		if (!target || target.phase !== "ready") return undefined;
		if (client !== undefined && client !== this.#client) this.setClient(client);
		const config = await readOmpAdvisorConfig(target, scope);
		if (config !== undefined) this.#set(config);
		return config;
	}

	/** Write one scope's config through OMP's guarded writer. */
	async write(scope: OmpAdvisorConfigScope, configText: string): Promise<OmpAdvisorConfigData>;
	async write(client: OmpAdvisorConfigClient, scope: OmpAdvisorConfigScope, configText: string): Promise<OmpAdvisorConfigData>;
	async write(clientOrScope: OmpAdvisorConfigClient | OmpAdvisorConfigScope, scopeOrText: OmpAdvisorConfigScope | string, maybeText?: string): Promise<OmpAdvisorConfigData> {
		const client = typeof clientOrScope === "string" ? this.#client : clientOrScope;
		const scope = (typeof clientOrScope === "string" ? clientOrScope : scopeOrText) as OmpAdvisorConfigScope;
		const configText = (typeof clientOrScope === "string" ? scopeOrText : maybeText) as string;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON);
		if (!controlAvailable(client)) throw new Error(NO_OMP_ADVISOR_CONFIG_BRIDGE_REASON);
		if (typeof clientOrScope !== "string" && clientOrScope !== this.#client) this.setClient(clientOrScope);
		const config = await writeOmpAdvisorConfig(client, scope, configText);
		if (config === undefined) throw new Error(NO_OMP_ADVISOR_CONFIG_BRIDGE_REASON);
		this.#set(config);
		return config;
	}

	/** Refresh one scope's config from an already-running runtime. */
	async refresh(scope: OmpAdvisorConfigScope): Promise<OmpAdvisorConfigSnapshot> {
		const client = this.#client;
		if (!client || client.phase !== "ready") {
			this.#clearUnavailable(NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON);
			return this.snapshot();
		}
		if (!controlAvailable(client)) {
			this.#clearUnavailable(NO_OMP_ADVISOR_CONFIG_BRIDGE_REASON);
			return this.snapshot();
		}
		try {
			const config = await this.read(scope);
			if (config === undefined) this.#clearUnavailable(NO_OMP_ADVISOR_CONFIG_BRIDGE_REASON);
		} catch (error) {
			this.#clearUnavailable(error instanceof Error ? error.message : String(error));
		}
		return this.snapshot();
	}

	/** Alias used by runtime startup and tests that seed a per-session projection. */
	async seed(scope: OmpAdvisorConfigScope): Promise<void> {
		await this.refresh(scope);
	}

	snapshot(): OmpAdvisorConfigSnapshot {
		const client = this.#client;
		if (!client || client.phase !== "ready") return { state: "unavailable", reason: NO_OMP_ADVISOR_CONFIG_RUNTIME_REASON };
		if (!controlAvailable(client)) return { state: "unavailable", reason: NO_OMP_ADVISOR_CONFIG_BRIDGE_REASON };
		if (this.#config === undefined) return { state: "unavailable", reason: this.#unavailableReason };
		return { state: "available", revision: this.#revision, ...this.#config };
	}

	#set(config: OmpAdvisorConfigData): void {
		this.#config = parseOmpAdvisorConfigData(config);
		this.#revision += 1;
		this.#unavailableReason = "";
	}

	#clearUnavailable(reason: string): void {
		this.#config = undefined;
		this.#unavailableReason = reason;
	}
}
