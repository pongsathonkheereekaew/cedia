import { OmpRpcClient } from "../../../packages/omp-adapter/src/client.ts";
import type { ModelCatalogModel, ModelCatalogResult, ModelReasoningEffort } from "../../../packages/protocol/src/models.ts";

const MODEL_CATALOG_CACHE_MS = 30_000;

export interface OmpModelCatalogOptions {
	readonly ompExecutable?: string;
	readonly ompEnv?: NodeJS.ProcessEnv;
	readonly ompArgs?: readonly string[];
	readonly cwd?: string;
	readonly now?: () => number;
}

export interface OmpModelCatalog {
	list(): Promise<ModelCatalogResult>;
	invalidate(): void;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function positive(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function unwrap(value: unknown): unknown {
	const row = record(value);
	if (!row) return value;
	if (Object.hasOwn(row, "data")) return unwrap(row.data);
	if (Object.hasOwn(row, "result")) return unwrap(row.result);
	if (Object.hasOwn(row, "ack")) return unwrap(row.ack);
	return value;
}

function rawModels(value: unknown): readonly unknown[] {
	const unwrapped = unwrap(value);
	if (Array.isArray(unwrapped)) return unwrapped;
	const row = record(unwrapped);
	for (const key of ["models", "availableModels", "available_models"] as const) {
		if (Array.isArray(row?.[key])) return row[key] as unknown[];
	}
	return [];
}

function providerQualifiedSlug(provider: string | undefined, id: string): string {
	if (!provider) return id;
	const prefix = `${provider}/`;
	return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

function reasoningEfforts(row: Record<string, unknown>): readonly ModelReasoningEffort[] | undefined {
	const thinking = record(row.thinking) ?? record(row.reasoning);
	// OMP's `models --json`/`get_available_models` response uses a direct
	// `thinking: string[]` ladder. Host-normalized responses use descriptor
	// arrays instead, while older adapters may still send nested `efforts`.
	// Keep the first explicitly supplied list so model-specific restrictions
	// are never widened by a fallback ladder.
	const values = Array.isArray(row.thinking)
		? row.thinking
		: Array.isArray(row.supportedReasoningEfforts)
			? row.supportedReasoningEfforts
			: Array.isArray(row.supported_reasoning_efforts)
				? row.supported_reasoning_efforts
				: Array.isArray(thinking?.efforts)
					? thinking.efforts
					: Array.isArray(row.efforts)
						? row.efforts
						: Array.isArray(row.reasoningEfforts)
							? row.reasoningEfforts
							: [];
	const efforts = new Map<string, string>();
	for (const value of values) {
		const descriptor = record(value);
		const id = typeof value === "string"
			? text(value)
			: text(descriptor?.value) ?? text(descriptor?.id);
		if (id && !efforts.has(id)) efforts.set(id, text(descriptor?.label) ?? id);
	}
	if (efforts.size === 0) return undefined;
	return [...efforts].map(([value, label]) => ({ value, label }));
}

/**
 * Normalize every accepted OMP model-catalog envelope into Synara's dynamic
 * provider-model shape. This is pure so the renderer and host can be checked
 * against the same provider-qualified identity rules without spawning OMP.
 */
export function normalizeOmpModelCatalog(value: unknown): ModelCatalogModel[] {
	const bySlug = new Map<string, ModelCatalogModel>();
	for (const item of rawModels(value)) {
		const row = record(item);
		if (!row) continue;
		const id = text(row.id) ?? text(row.modelId);
		if (!id) continue;
		const provider = text(row.provider) ?? text(row.providerId) ?? text(row.upstreamProviderId);
		const slug = providerQualifiedSlug(provider, id);
		if (bySlug.has(slug)) continue;
		const label = text(row.label) ?? text(row.name) ?? slug;
		const efforts = reasoningEfforts(row);
		const thinking = record(row.thinking) ?? record(row.reasoning);
		const defaultReasoningEffort = text(row.defaultReasoningEffort)
			?? text(row.defaultEffort)
			?? text(thinking?.defaultEffort)
			?? text(thinking?.default);
		const contextWindow = positive(row.contextWindow) ?? positive(row.context_window);
		const maxOutputTokens = positive(row.maxOutputTokens) ?? positive(row.maxTokens) ?? positive(row.max_output_tokens);
		const upstreamProviderId = text(row.upstreamProviderId) ?? provider;
		const upstreamProviderName = text(row.upstreamProviderName) ?? text(row.providerName) ?? provider;
		const reason = text(row.reason);
		const description = text(row.description) ?? reason;
		bySlug.set(slug, {
			id,
			...(provider ? { provider } : {}),
			slug,
			name: label,
			label,
			available: row.available !== false,
			...(reason ? { reason } : {}),
			...(description ? { description } : {}),
			...(upstreamProviderId ? { upstreamProviderId } : {}),
			...(upstreamProviderName ? { upstreamProviderName } : {}),
			...(efforts ? { supportedReasoningEfforts: efforts } : {}),
			...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
			...(contextWindow ? {
				contextWindow,
				contextWindowOptions: [{ value: String(contextWindow), label: String(contextWindow), isDefault: true as const }],
			} : {}),
			...(maxOutputTokens ? { maxOutputTokens } : {}),
		});
	}
	return [...bySlug.values()];
}

const VALUE_FLAGS = new Set(["--cwd", "--session", "--session-dir", "--resume", "-r", "--export"]);
const FORBIDDEN_FLAGS = new Set(["--continue", "-c"]);

export function metadataArgs(options: OmpModelCatalogOptions, cwd: string): string[] {
	const supplied = [...(options.ompArgs ?? [])];
	const passthrough: string[] = [];
	for (let index = 0; index < supplied.length; index += 1) {
		const value = supplied[index];
		if (!value) continue;
		const flag = value.includes("=") ? value.slice(0, value.indexOf("=")) : value;
		if (FORBIDDEN_FLAGS.has(flag) || VALUE_FLAGS.has(flag) || VALUE_FLAGS.has(flag.replace(/^--/, "-"))) {
			if (!value.includes("=") && VALUE_FLAGS.has(flag)) index += 1;
			continue;
		}
		if (flag === "--session" || flag === "--session-dir" || flag === "--resume" || flag === "--export") continue;
		passthrough.push(value);
	}
	return [
		"--no-session",
		"--no-skills",
		"--no-rules",
		"--no-extensions",
		"--no-title",
		"--cwd",
		cwd,
		...passthrough,
	];
}

export function createOmpModelCatalog(options: OmpModelCatalogOptions = {}): OmpModelCatalog {
	const now = options.now ?? Date.now;
	const cwd = text(options.cwd) ?? process.cwd();
	let cached: { readonly expiresAt: number; readonly models: readonly ModelCatalogModel[] } | undefined;
	let inflight: Promise<ModelCatalogResult> | undefined;

	const list = async (): Promise<ModelCatalogResult> => {
		const current = cached;
		if (current && current.expiresAt > now()) {
			return { source: "omp", models: current.models, cached: true };
		}
		if (inflight) return inflight;
		const operation = (async (): Promise<ModelCatalogResult> => {
			const client = await OmpRpcClient.start({
				executable: options.ompExecutable,
				env: options.ompEnv,
				cwd,
				args: metadataArgs(options, cwd),
				readyTimeoutMs: 20_000,
				requestTimeoutMs: 30_000,
			});
			try {
				const ack = await client.request("get_available_models", {});
				const models = normalizeOmpModelCatalog(ack.data);
				cached = { expiresAt: now() + MODEL_CATALOG_CACHE_MS, models };
				return { source: "omp", models, cached: false };
			} finally {
				await client.close();
			}
		})();
		inflight = operation;
		try {
			return await operation;
		} finally {
			if (inflight === operation) inflight = undefined;
		}
	};

	return { list, invalidate: () => { cached = undefined; } };
}
