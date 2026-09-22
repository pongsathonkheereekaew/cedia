/*
 * Pure projection from Cedia host state to the shapes the native chat UI
 * expects. Kept free of the `vscode` module so it can be unit-tested with
 * fixtures; the registration layer lives in chat-sessions.ts.
 */

import { Buffer } from "node:buffer";
import type { CommandRequest, Project, Session } from "../../../packages/protocol/src/index.ts";
import type { CediaUiRequest } from "../../../packages/protocol/src/ui.ts";
import type { TranscriptEntry } from "./state.ts";
import type { ThinkingParams } from "./thinking-params.ts";

/**
 * Item URI scheme. It intentionally differs from {@link CEDIA_CHAT_SESSION_TYPE}
 * (`cedia` vs `cedia.omp`, matching upstream's scheme/type split): the scheme
 * keys item resources and the content provider, while the controller type keys
 * the option-group store. Patch 0011 bridges the two (dual-index on publish)
 * so the picker reads the OMP catalog under either key. Window-local only;
 * the host store is keyed by session id.
 */
export const CEDIA_CHAT_SESSION_SCHEME = "cedia";
/**
 * One id for the whole surface: the chat session type, the contributed
 * `chatSessions` entry and the default chat participant all use it, because the
 * workbench resolves the participant against the session contribution
 * (`getAllChatSessionContributions().find(c => c.type === id)`).
 */
export const CEDIA_CHAT_SESSION_TYPE = "cedia.omp";
export const CEDIA_CHAT_PARTICIPANT_ID = "cedia.omp";
/**
 * Label for a session that does not exist on the host yet.
 *
 * One value for both halves of a draft: the item the first Send creates takes it when the
 * prompt carries no words, and the empty draft session answers with it while it is still
 * unsent. Matches the sessions bridge's own draft label (`extensionSessionsProvider`).
 */
export const CEDIA_DRAFT_TITLE = "New task";
/**
 * Vendor Cedia registers its language models under (`lm.registerLanguageModelChatProvider`).
 *
 * The extension host builds a model identifier as `<vendor>/<model id>` and
 * resolves a request's model by that exact string, so the workbench pickers that
 * project the same OMP catalogue have to hand back the same string: patch 0010
 * (sessions bridge) and patch 0011 (chat-widget picker) both prefix with this
 * vendor, and {@link ompModelIdFromPickId} turns a pick back into the OMP id the
 * host's `set_model` expects. The value must never drift from those patches.
 */
export const CEDIA_OMP_MODEL_VENDOR = "cedia-omp";

/** Picker/LM identifier for one OMP model: `<vendor>/<model id>`. */
export function ompModelPickId(modelId: string): string {
	return `${CEDIA_OMP_MODEL_VENDOR}/${modelId}`;
}

/**
 * The OMP model id behind a pick, or the value unchanged when it carries no
 * vendor prefix (option-group items and older picks are bare ids).
 */
export function ompModelIdFromPickId(value: string): string {
	const prefix = `${CEDIA_OMP_MODEL_VENDOR}/`;
	return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** Semantic session state; the registration layer maps it to `vscode.ChatSessionStatus`. */
export type SessionState = "in-progress" | "completed" | "failed";

export interface SessionItemShape {
	readonly id: string;
	readonly label: string;
	readonly description: string | undefined;
	readonly state: SessionState;
	/**
	 * The host's archived flag, carried so the native list can keep the row out of
	 * its workspace group: the section a row lands in is the list's decision, and
	 * the host's own flag is the only thing that can tell it.
	 */
	readonly archived: boolean;
	readonly timing: { readonly created: number; readonly lastRequestStarted?: number; readonly lastRequestEnded?: number };
}

/** One tool row behind a turn's {@link TurnPlan.toolNames}, id included. */
export interface TurnToolEntry {
	readonly id: string;
	readonly entry: TranscriptEntry;
}

/** Provider-independent description of one transcript turn. */
export interface TurnPlan {
	readonly kind: "request" | "response";
	readonly text: string;
	readonly toolNames: readonly string[];
	/** Present for responses whose tools came from the transcript, so history can carry their ids. */
	readonly toolEntries?: readonly TurnToolEntry[];
}

/** One tool row projected into the card the native chat renders. */
export interface OmpToolCard {
	readonly toolName: string;
	readonly invocation: string;
	readonly past: string;
	readonly input: string;
	readonly output: string;
	readonly isError: boolean;
	readonly isComplete: boolean;
}

function clampCardText(text: string, limit: number): string {
	return text.length <= limit ? text : `${text.slice(0, limit)}\n… (truncated)`;
}

export function toolCardFromEntry(entry: TranscriptEntry): OmpToolCard | undefined {
	if (entry.kind !== "tool") return undefined;
	const toolName = entry.toolName?.trim() || "tool";
	let input = "";
	if (entry.args !== undefined) {
		try {
			input = JSON.stringify(entry.args) ?? String(entry.args);
		} catch {
			input = String(entry.args);
		}
	}
	return {
		toolName,
		invocation: toolName,
		past: `${toolName} ${entry.toolStatus ?? "completed"}`,
		input: clampCardText(input, 1200),
		output: clampCardText(entry.output ?? "", 4000),
		isError: entry.toolStatus === "failed",
		isComplete: entry.toolStatus === "completed" || entry.toolStatus === "failed" || entry.toolStatus === "cancelled",
	};
}

export function sessionUriString(sessionId: string): string {
	return `${CEDIA_CHAT_SESSION_SCHEME}://session/${encodeURIComponent(sessionId)}`;
}

export function sessionIdFromUri(uri: { readonly scheme: string; readonly authority?: string; readonly path: string }): string | undefined {
	if (uri.scheme !== CEDIA_CHAT_SESSION_SCHEME || uri.authority !== "session") return undefined;
	const id = decodeURIComponent(uri.path.replace(/^\//, ""));
	return id.length > 0 ? id : undefined;
}

/**
 * True for the workbench's draft resource for a Cedia session.
 *
 * The workbench builds a new contributed session as
 * `<session type>:/untitled-<uuid>` (`getNewChatSessionResource`), so a Cedia draft carries
 * {@link CEDIA_CHAT_SESSION_TYPE} as its scheme rather than the item scheme
 * {@link CEDIA_CHAT_SESSION_SCHEME}. Such a resource has no host id and no transcript: it is
 * only an unsent composer until its first Send materializes a real session through
 * `newChatSessionItemHandler`.
 */
export function isCediaDraftUri(uri: { readonly scheme: string; readonly authority?: string; readonly path: string }): boolean {
	return (uri.scheme === CEDIA_CHAT_SESSION_SCHEME || uri.scheme === CEDIA_CHAT_SESSION_TYPE) && uri.path.startsWith("/untitled-");
}

/**
 * Host status -> UI state. `idle` and `stopped` are both "the host is not
 * working on this", which the UI shows as completed; only a host that demands
 * reconciliation is reported as failed, because that is the state that needs
 * the user's attention.
 */
export function sessionState(status: Session["status"]): SessionState {
	switch (status) {
		case "running": return "in-progress";
		case "recovery_required": return "failed";
		default: return "completed";
	}
}

function millis(value: string | undefined): number {
	if (!value) return 0;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function sessionItemShape(session: Session, projectName?: string): SessionItemShape {
	const updated = millis(session.updatedAt) || undefined;
	return {
		id: session.id,
		label: session.title,
		description: projectName,
		state: sessionState(session.status),
		archived: session.archived === true,
		timing: {
			created: millis(session.createdAt),
			lastRequestStarted: updated,
			lastRequestEnded: session.status === "running" ? undefined : updated,
		},
	};
}

export function projectNameFor(projects: readonly Project[], session: Session): string | undefined {
	return projects.find(project => project.id === session.projectId)?.name;
}

/**
 * Group a reduced transcript into user requests and the assistant/tool work that
 * answered them. Anything the host did not record is left out, never invented.
 */
export function turnPlansFromTranscript(transcript: readonly TranscriptEntry[]): readonly TurnPlan[] {
	const plans: TurnPlan[] = [];
	for (const entry of transcript) {
		if (entry.role === "user") {
			plans.push({ kind: "request", text: entry.text, toolNames: [] });
			continue;
		}
		if (entry.role === "system") continue;
		// A tool row keeps its output out of the assistant's markdown (it is not
		// prose) and its text out too (the row's text is the label itself, so
		// appending both would duplicate it); the row itself travels in
		// `toolEntries`, with its id, so history can draw its card.
		const isTool = entry.kind === "tool";
		const toolName = isTool ? (entry.toolName ?? entry.text) : undefined;
		const last = plans.at(-1);
		if (last?.kind === "response") {
			const toolEntries = isTool ? [...(last.toolEntries ?? []), { id: entry.id, entry }] : last.toolEntries;
			plans[plans.length - 1] = {
				kind: "response",
				text: [last.text, isTool ? "" : entry.text].filter(Boolean).join("\n\n"),
				toolNames: toolName ? [...last.toolNames, toolName] : last.toolNames,
				...(toolEntries && toolEntries.length > 0 ? { toolEntries } : {}),
			};
			continue;
		}
		plans.push({
			kind: "response",
			text: isTool ? "" : entry.text,
			toolNames: toolName ? [toolName] : [],
			...(isTool ? { toolEntries: [{ id: entry.id, entry }] } : {}),
		});
	}
	return plans;
}

/** One composer reference as the extension sees it (structural: `vscode.ChatPromptReference`). */
export interface CediaPromptReference {
	readonly name?: string;
	readonly value?: unknown;
}

/** OMP's prompt image shape (`ImageContent`): base64 data plus its mime type. */
export interface OmpPromptImage {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
}

/** True for a reference value that carries binary data (`vscode.ChatReferenceBinaryData`). */
function isBinaryReferenceValue(value: unknown): boolean {
	const record = asRecord(value);
	return record !== undefined && typeof record.mimeType === "string" && typeof record.data === "function";
}

/**
 * Read composer image references into OMP's prompt images. A reference whose
 * `data()` throws or rejects is skipped; the rest of the turn still goes.
 */
export async function promptImagesFromReferences(references: readonly CediaPromptReference[] | undefined): Promise<OmpPromptImage[]> {
	const images: OmpPromptImage[] = [];
	for (const reference of references ?? []) {
		const value = reference.value;
		if (!isBinaryReferenceValue(value)) continue;
		const binary = value as { readonly mimeType: string; data: () => unknown };
		try {
			const bytes = await binary.data();
			if (!(bytes instanceof Uint8Array)) continue;
			images.push({ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: binary.mimeType });
		} catch {
			continue;
		}
	}
	return images;
}

/**
 * Name the non-image references so their context is not dropped silently.
 * Binary images are excluded: their bytes travel in OMP's `images` field, and a
 * label would only duplicate the attachment as text. Order is preserved.
 */
export function attachedContextLabels(references: readonly CediaPromptReference[] | undefined): string[] {
	const labels: string[] = [];
	const seen = new Set<string>();
	for (const reference of references ?? []) {
		const value = reference.value;
		if (isBinaryReferenceValue(value)) continue;
		const record = asRecord(value);
		const label = nonEmpty(reference.name) ?? nonEmpty(record?.fsPath) ?? nonEmpty(record?.path);
		if (!label || seen.has(label)) continue;
		seen.add(label);
		labels.push(label);
	}
	return labels;
}

export function promptWithAttachedContext(prompt: string, labels: readonly string[]): string {
	if (labels.length === 0) return prompt;
	return `${prompt}\n\nAttached context:\n${labels.map(label => `- ${label}`).join("\n")}`;
}

/**
 * Build the `prompt` command. The message carries prompt text plus any
 * non-image reference labels already folded in by `promptWithAttachedContext`;
 * composer images travel in OMP's own `images` field. `streamingBehavior`
 * remains unthreaded.
 */
export function promptRequest(session: Session, prompt: string, commandId: string, images?: readonly OmpPromptImage[]): CommandRequest {
	const payloadImages = images && images.length > 0
		? images.map(image => ({ type: image.type, data: image.data, mimeType: image.mimeType }))
		: undefined;
	return { commandId, incarnation: session.incarnation, command: "prompt", payload: { message: prompt, ...(payloadImages ? { images: payloadImages } : {}) } };
}

export function abortRequest(session: Session, commandId: string): CommandRequest {
	return { commandId, incarnation: session.incarnation, command: "abort" };
}

/** One OMP model as advertised by `get_available_models` (pure, no provider calls). */
export interface OmpAdvertisedModel {
	readonly id: string;
	readonly provider?: string;
	readonly label: string;
	readonly available: boolean;
	readonly reason?: string;
	/** OMP's advertised input window, when it reports one (tokens). */
	readonly contextWindow?: number;
	/** OMP's advertised output budget, when it reports one (tokens). */
	readonly maxOutputTokens?: number;
	/** The reasoning ladder OMP advertises for this model, when it advertises one. */
	readonly thinking?: OmpModelThinking;
}

/**
 * One model's reasoning ladder, as OMP's `get_available_models` row spells it.
 *
 * Measured 2026-09-18 against the live catalogue (873 rows): 175 rows carry
 * `{"efforts":["minimal","low","medium","high"],"mode":"effort"}`, 47 add `xhigh`, 214 carry none.
 * This is the only place the *ladder* is advertised — `get_state` reports the current
 * `thinkingLevel` and no ladder at all — so a reasoning control built from `get_state` alone could
 * never appear. The ladder is per model and needs no session, which is what lets a draft offer it.
 */
export interface OmpModelThinking {
	readonly efforts: readonly string[];
	readonly mode?: string;
	readonly requiresEffort?: boolean;
}

/**
 * A model's OMP selector: `<provider>/<model id>`, or the bare id when OMP reports no provider.
 *
 * This is how OMP names a model to itself - `set_model` takes exactly this spelling and the session
 * journal records it (`model_change {model: "openrouter/deepseek/deepseek-v4.1-flash"}`) - and it is
 * what makes a row unique: the same model id can be advertised by several providers (measured
 * 2026-09-18: `deepseek/deepseek-v4.1-flash` is on both `openrouter` and `commandcode`), so the bare
 * id names a model only when one provider carries it.
 */
export function ompModelSelector(model: Pick<OmpAdvertisedModel, "id" | "provider">): string {
	if (!model.provider) return model.id;
	// OMP answers in both shapes: the catalogue row can already be provider-qualified
	// (`cursor/claude-4.6-opus-high`) while another row of the same model arrives bare. Only the bare
	// one needs the prefix, or the same model would come back as `cursor/cursor/...`.
	const prefix = `${model.provider}/`;
	return model.id.startsWith(prefix) ? model.id : `${prefix}${model.id}`;
}

/**
 * The codicon the workbench picker should draw for a provider's models.
 *
 * The picker draws `metadata.statusIcon` on every row and, compact, on the composer trigger
 * (`modelProviderIcons.ts`, `modelPickerWidget.ts`), and its own identity heuristic only knows
 * claude/gemini/kimi/xai/microsoft/openai - so before Cedia sent this field, none of its providers
 * (openrouter, cursor, commandcode, opencode-go, opencode-zen, google-antigravity, openai-codex) had a
 * mark in the Agents window. Only codicons are available here; providers this fork has a brand
 * codicon for use it, and the rest take a distinct shape instead of one generic sparkle. The dock's
 * own picker, which Cedia draws, uses the real brand marks instead (`provider-icons.ts`).
 */
const PROVIDER_STATUS_ICON_IDS: Record<string, string> = {
	openai: "openai",
	"openai-codex": "openai",
	anthropic: "claude",
	claude: "claude",
	google: "google-gemini",
	"google-antigravity": "google-gemini",
	"google-vertex": "google-gemini",
	moonshotai: "kimi",
	moonshot: "kimi",
	kimi: "kimi",
	"x-ai": "xai",
	xai: "xai",
	grok: "xai",
	microsoft: "microsoft",
	cursor: "cursor",
	// No brand codicon ships for these, so each gets a shape of its own: a gateway in front of many
	// vendors, a CLI coding agent, and a terminal-driven provider.
	openrouter: "globe",
	opencode: "plug",
	"opencode-go": "plug",
	"opencode-zen": "plug",
	commandcode: "terminal",
};

/** The icon id for a provider, or undefined so the caller draws nothing rather than a wrong brand. */
export function providerStatusIconId(provider: string | undefined): string | undefined {
	return provider ? PROVIDER_STATUS_ICON_IDS[provider.trim().toLowerCase()] : undefined;
}

/** One catalogue row as a picker row: the model, its identity, and the name to draw. */
export interface OmpModelRow {
	readonly model: OmpAdvertisedModel;
	/**
	 * The row's identity. OMP's own model id, except when several providers advertise that same id:
	 * the workbench keeps one row per identifier, so the first row keeps the bare id and every later
	 * one is named by its provider-qualified selector. Without this, the second provider's model is
	 * silently dropped from the picker and cannot be chosen at all - measured live 2026-09-18, the
	 * catalogue advertises `gpt-5.6-luna`, `gpt-5.6-terra`, `muse-spark-1.3*`, `mimo-v2.5*` and about
	 * twenty more ids from more than one provider (`[LM] Model cedia-omp/gpt-5.6-luna is already
	 * registered. Skipping.`).
	 */
	readonly id: string;
	readonly label: string;
}

/**
 * Give every advertised model a unique row identity, keeping OMP's own spelling wherever it is
 * already unambiguous.
 *
 * The bare id stays untouched for the first row of each model id, so nothing that was picked or
 * remembered before this exists changes spelling. Later rows of the same id take their selector,
 * which is what `set_model` and the resolver already speak. Two rows that spell the same provider
 * and model the same way are the same row twice and only one is kept.
 */
export function ompModelRows(models: readonly OmpAdvertisedModel[]): OmpModelRow[] {
	const taken = new Set<string>();
	const seen = new Set<string>();
	const firstLabelById = new Map<string, string>();
	const rows: OmpModelRow[] = [];
	for (const model of models) {
		// The same provider and model listed twice is one row, however the id is spelled.
		const providerAndId = `${model.provider ?? ""}\u0000${model.id}`;
		if (seen.has(providerAndId)) {
			continue;
		}
		seen.add(providerAndId);
		const firstLabel = firstLabelById.get(model.id);
		const shared = firstLabel !== undefined;
		const id = shared ? ompModelSelector(model) : model.id;
		if (taken.has(id)) {
			continue;
		}
		taken.add(id);
		if (!shared) {
			firstLabelById.set(model.id, model.label);
		}
		// Two providers can also give their rows the same label ("DeepSeek V4.1 Flash"); the provider
		// is what tells them apart, so it is named only where the label alone would not.
		const label = shared && model.label === firstLabel ? `${model.label} · ${model.provider ?? "unknown"}` : model.label;
		rows.push({ model, id, label });
	}
	return rows;
}

/** The session's context occupancy as OMP reports it in `get_state.contextUsage`. */
export interface OmpContextUsage {
	readonly tokens: number;
	readonly contextWindow?: number;
}

/** Minimal login-provider shape needed to mark `needs_auth` honestly. */
export interface OmpLoginProvider {
	readonly id: string;
	readonly authenticated?: boolean;
}

/** Honest projection of the OMP catalog: never invents a fallback model. */
export interface OmpModelSnapshot {
	readonly models: readonly OmpAdvertisedModel[];
	readonly selectedModelId?: string;
	/**
	 * The provider the selected row belongs to, when `get_state` named one that advertises it.
	 *
	 * Present so a reader that needs the *row* (the picker's marked item, the reasoning ladder)
	 * can resolve an id more than one provider carries instead of refusing to choose.
	 */
	readonly selectedModelProvider?: string;
	/**
	 * The reasoning level OMP reports for the selected model, when it reports one.
	 *
	 * Read from the same `get_state` answer as the model, and only kept when a row was selected:
	 * it is what the composer's effort chip shows as its selection before a first turn, and the
	 * ladder it is checked against is that row's own.
	 */
	readonly selectedThinkingLevel?: string;
	readonly hasModels: boolean;
}

/** Picker-safe projection of one advertised model (no OMP internals leak). */
export interface OmpModelPickerItem {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly tooltip?: string;
	/**
	 * The model this item names, in the shape the workbench's own session picker reads
	 * (`IChatSessionProviderOptionModelMetadata`). `vendor` is the OMP provider that runs the model:
	 * the workbench groups and badges picker rows by it, and an item's `description` does not survive
	 * to that surface (the API documents `description` as tooltip-only), so this is the channel that
	 * actually carries the provider.
	 */
	readonly modelMetadata?: {
		readonly id: string;
		readonly name: string;
		readonly vendor?: string;
		readonly family?: string;
	};
}

/**
 * Minimal option group shared by the native and webview pickers.
 *
 * `models` is the catalogue group; `reasoning` is the per-model thinking-level group, which is why
 * the id and name are open strings rather than the literal pair the first group used to be.
 */
export interface OmpModelPickerGroup {
	readonly id: string;
	readonly name: string;
	readonly items: readonly OmpModelPickerItem[];
	readonly selected?: OmpModelPickerItem;
	readonly description?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function unwrapData(value: unknown): unknown {
	const record = asRecord(value);
	if (record && "data" in record) return unwrapData(record.data);
	return value;
}

function modelArrayFrom(value: unknown): readonly unknown[] {
	const unwrapped = unwrapData(value);
	if (Array.isArray(unwrapped)) return unwrapped;
	const record = asRecord(unwrapped);
	const models = record?.models;
	return Array.isArray(models) ? models : [];
}

/**
 * Normalize an OMP `get_available_models` ack/result into picker-ready models.
 * Accepts the raw `result ?? ack` value (which may be `{data:{models:[...]}}`,
 * `{models:[...]}` or a bare array) and drops rows without an id rather than
 * inventing one. `label` prefers OMP's `label`, then `name`, then
 * `provider/id`. `available` defaults to true; OMP only opts out explicitly.
 */
export function normalizeOmpModels(value: unknown): OmpAdvertisedModel[] {
	return modelArrayFrom(value).flatMap((entry): OmpAdvertisedModel[] => {
		const item = asRecord(entry);
		if (!item) return [];
		const id = nonEmpty(item.id) ?? nonEmpty(item.modelId);
		if (!id) return [];
		const provider = nonEmpty(item.provider);
		const label = nonEmpty(item.label) ?? nonEmpty(item.name) ?? (provider ? `${provider} / ${id}` : id);
		const reason = nonEmpty(item.reason);
		// Size numbers are advertised, never derived: a model that does not report a
		// window stays unknown (0 = neutral unknown downstream) instead of guessing.
		const contextWindow = positiveNumber(item.contextWindow);
		const maxOutputTokens = positiveNumber(item.maxTokens) ?? positiveNumber(item.maxOutputTokens);
		const thinking = ompModelThinking(item.thinking);
		return [{
			id,
			...(provider ? { provider } : {}),
			label,
			available: item.available !== false,
			...(reason ? { reason } : {}),
			...(contextWindow !== undefined ? { contextWindow } : {}),
			...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
			...(thinking ? { thinking } : {}),
		}];
	});
}

/**
 * One row's reasoning ladder, or undefined when the row advertises none.
 *
 * An empty `efforts` list is treated as no ladder: a model whose ladder OMP has not decided must keep
 * the control away (§11 gate 4) rather than show an empty one.
 */
function ompModelThinking(value: unknown): OmpModelThinking | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const efforts = Array.isArray(record.efforts)
		? record.efforts.filter((effort): effort is string => typeof effort === "string" && effort.trim().length > 0)
		: [];
	if (efforts.length === 0) return undefined;
	const mode = nonEmpty(record.mode);
	return {
		efforts,
		...(mode ? { mode } : {}),
		...(record.requiresEffort === true ? { requiresEffort: true } : {}),
	};
}

/** A positive finite number, or undefined for anything else (never NaN/Infinity/0). */
function positiveNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Read OMP's current context occupancy from a `get_state` ack/result
 * (`data.contextUsage = { tokens, contextWindow, percent }`). Returns undefined
 * when OMP does not report it rather than inventing a size.
 */
export function contextUsageFromOmpState(value: unknown): OmpContextUsage | undefined {
	const data = asRecord(unwrapData(value));
	const usage = asRecord(data?.contextUsage);
	if (!usage) return undefined;
	const tokens = typeof usage.tokens === "number" && Number.isFinite(usage.tokens) && usage.tokens >= 0 ? usage.tokens : undefined;
	if (tokens === undefined) return undefined;
	const contextWindow = positiveNumber(usage.contextWindow);
	return { tokens, ...(contextWindow !== undefined ? { contextWindow } : {}) };
}

/**
 * OMP's current model as `get_state` reports it: the id, plus the provider when the answer names
 * one.
 *
 * The provider is what makes an ambiguous id usable. OMP advertises some ids from more than one
 * provider - measured 2026-09-18: `deepseek/deepseek-v4.1-flash` comes from both `openrouter` and
 * `commandcode` - while the reasoning ladder belongs to the catalogue *row*, not the bare id. Since
 * `get_state` answers `{ id, provider }` for the model it is running, keeping only the id forced
 * every row-based reader to refuse to choose (`rowsNamingPick`), which is what left the composer's
 * reasoning chip empty for a model that advertises levels.
 */
export interface OmpCurrentModel {
	readonly id: string;
	/** The provider OMP says runs it, when the answer names one. */
	readonly provider?: string;
	/**
	 * The reasoning level OMP reports for that model, when the answer names one.
	 *
	 * It rides along because it arrives in the same `get_state` answer as the model itself, and the
	 * composer's effort chip has nothing else to show as its selection before a first turn: the
	 * ladder is per model, and OMP's own level for the model the first turn would run is the only
	 * value it advertises. `thinkingPickerGroupForModel` drops it again when the ladder does not
	 * contain it, so a level left over from another model can never be shown as this one's.
	 */
	readonly thinkingLevel?: string;
}

/**
 * Read OMP's current model from a `get_state` ack/result. OMP v18 puts it under
 * `data.model` (`{id, provider, ...}`); older shapes used a top-level string.
 * Returns undefined when nothing usable was advertised rather than guessing.
 */
export function currentModelFromOmpState(value: unknown): OmpCurrentModel | undefined {
	const unwrapped = unwrapData(value);
	const root = asRecord(unwrapped);
	if (!root) {
		const id = typeof unwrapped === "string" ? nonEmpty(unwrapped) : undefined;
		return id ? { id } : undefined;
	}
	const model = root.model;
	if (typeof model === "string") {
		const id = nonEmpty(model);
		if (id) return withThinkingLevel({ id }, root);
	}
	const record = asRecord(model);
	if (record) {
		const id = nonEmpty(record.id) ?? nonEmpty(record.modelId);
		if (id) {
			const provider = nonEmpty(record.provider);
			return withThinkingLevel(provider ? { id, provider } : { id }, root);
		}
	}
	for (const key of ["modelId", "currentModel", "current_model", "selectedModel", "selected_model", "model_id"] as const) {
		const id = nonEmpty(root[key]);
		if (id) return withThinkingLevel({ id }, root);
	}
	return undefined;
}

/**
 * Add the level the same `get_state` answer reports to a model already read out of it.
 *
 * OMP spells the level at the top of its state (`data.thinkingLevel`, with the snake-case and
 * `thinking` variants `thinking-params.ts` already accepts), beside the `model` record rather than
 * inside it.
 */
function withThinkingLevel(model: OmpCurrentModel, root: Record<string, unknown>): OmpCurrentModel {
	for (const key of ["thinkingLevel", "thinking_level", "thinking"] as const) {
		const level = nonEmpty(root[key]);
		if (level) return { ...model, thinkingLevel: level };
	}
	return model;
}

/** The bare id of OMP's current model, for readers that need only the id. */
export function currentModelIdFromOmpState(value: unknown): string | undefined {
	return currentModelFromOmpState(value)?.id;
}

/**
 * Project normalized OMP models plus the `get_state` current id into an honest
 * snapshot. The current id is kept only when it is still advertised; otherwise
 * it is dropped (no billed fallback). `loginProviders` marks
 * provider-unauthenticated rows with a needs-auth reason, mirroring
 * `capability-catalog.ts#modelEntry`, without changing membership.
 *
 * `currentProvider` is the provider the same `get_state` answer named. It only ever breaks a tie
 * between rows that share an id - the case `rowsNamingPick` refuses to guess on, and the reason the
 * composer's reasoning chip stayed empty for a model more than one provider advertises. Nothing is
 * invented when the answer names no provider: the selection stays unresolved, exactly as before.
 */
export function projectOmpModelSnapshot(
	models: readonly OmpAdvertisedModel[],
	currentModelId?: string,
	loginProviders?: readonly OmpLoginProvider[],
	currentProvider?: string,
): OmpModelSnapshot {
	const auth = new Map((loginProviders ?? []).map(provider => [provider.id, provider.authenticated]));
	const annotated = models.map((model): OmpAdvertisedModel => {
		const unauthenticated = model.provider !== undefined && auth.get(model.provider) === false;
		if (unauthenticated && model.reason === undefined) {
			return { ...model, reason: "Provider is not authenticated" };
		}
		return model;
	});
	// OMP answers `get_state` with the selector a session is running and `get_available_models`
	// with its catalogue row, and the two do not always spell the same model the same way: the
	// current id can arrive bare (`claude-4.6-opus-high`) while the row is provider-qualified
	// (`cursor/claude-4.6-opus-high`). Matching only exact ids dropped the current model out of
	// the snapshot, so the composer's pill fell back to the catalogue's first row and a draft's
	// pick could no longer be resolved when the session was created. A unique provider-qualified
	// suffix names the same model, so it is accepted; an ambiguous suffix is still refused,
	// because guessing which provider the user meant is the billed fallback this function exists
	// to avoid.
	const selectedRow = currentModelId
		? ompModelRowForPick({ models: annotated, hasModels: annotated.length > 0 }, currentModelId, currentProvider)
		: undefined;
	const selected = currentModelId
		? (annotated.some(model => model.id === currentModelId)
			? currentModelId
			: selectedRow?.id)
		: undefined;
	return {
		models: annotated,
		...(selected ? { selectedModelId: selected } : {}),
		// The row's own provider, never the answer's: a provider that does not advertise this model
		// is not its provider, and the row readers downstream have to agree with the catalogue.
		...(selectedRow?.provider ? { selectedModelProvider: selectedRow.provider } : {}),
		hasModels: annotated.length > 0,
	};
}

/**
 * Build the minimal `models` option group from a snapshot. Empty catalogs
 * produce an empty group (honest-disabled downstream); nothing is invented.
 */
export function modelPickerGroupFromSnapshot(snapshot: OmpModelSnapshot): OmpModelPickerGroup {
	const rows = ompModelRows(snapshot.models);
	const items: OmpModelPickerItem[] = rows.map(row => ({
		id: row.id,
		name: row.label,
		...(row.model.provider ? { description: row.model.provider } : {}),
		...(row.model.reason ? { tooltip: row.model.reason } : {}),
		// The provider travels in `modelMetadata.vendor` too, because that is the field the workbench's
		// session picker reads for grouping and badging; `description` above stays for the surfaces
		// that do read it (Cedia's own dock picker).
		...(row.model.provider ? { modelMetadata: { id: row.id, name: row.label, vendor: row.model.provider, ...(row.model.provider ? { family: row.model.id } : {}) } } : {}),
	}));
	const selectedRow = snapshot.selectedModelId
		? ompModelRowForPick(snapshot, snapshot.selectedModelId, snapshot.selectedModelProvider)
		: undefined;
	// The selected row is named by the identity this projection gave it, which is the bare id unless
	// another provider already claimed that id.
	const selected = selectedRow
		? items[rows.findIndex(row => row.model === selectedRow || (row.model.id === selectedRow.id && row.model.provider === selectedRow.provider))]
		: undefined;
	return {
		id: "models",
		name: "Models",
		items,
		...(selected ? { selected } : {}),
	};
}

/**
 * The catalogue row that names `pickedId`, or `undefined` when none does.
 *
 * Exact ids win. Failing that, a row whose id is the picked one behind exactly one provider
 * prefix is the same model under OMP's other spelling, so it is the row the picker should mark
 * and the row whose provider `set_model` needs. Two rows ending in the same id are different
 * models on different providers, and nothing here may choose between them.
 */
export function ompModelRowForPick(
	snapshot: OmpModelSnapshot,
	pickedId: string,
	preferredProvider?: string,
): OmpAdvertisedModel | undefined {
	return uniqueRowForPick(rowsNamingPick(snapshot, pickedId), preferredProvider);
}

/**
 * Every catalogue row that names `pickedId`.
 *
 * Measured live 2026-09-18: `deepseek/deepseek-v4.1-flash` is advertised by both `openrouter`
 * (which this machine has no credentials for) and `commandcode` (which it has). Taking the first
 * row sent the turn to openrouter, whose answer was `401 User not found`, so an id more than one
 * provider carries is not a model until something names one of them. Exact ids win over the
 * provider-qualified spellings of the same model, which is OMP's other way of writing one row.
 */
function rowsNamingPick(snapshot: OmpModelSnapshot, pickedId: string): OmpAdvertisedModel[] {
	const exact = snapshot.models.filter(model => model.id === pickedId);
	if (exact.length > 0) return exact;
	// OMP's own selector spelling names exactly one row, which is how the picker's identifier arrives
	// once it carries the provider (`openrouter/deepseek/deepseek-v4.1-flash`).
	const selectors = snapshot.models.filter(model => model.provider !== undefined && ompModelSelector(model) === pickedId);
	if (selectors.length > 0) return selectors;
	return snapshot.models.filter(model => model.id.endsWith(`/${pickedId}`));
}

/**
 * Whether OMP's own answer says a turn could run on this row.
 *
 * `available: false` is OMP saying the row is not usable, and `reason` is the annotation
 * {@link projectOmpModelSnapshot} adds for a provider the host reports as unauthenticated. This only
 * breaks a tie between rows that share an id: a lone row is returned whatever it says, because the
 * picker already shows that same reason against it.
 */
function rowCanRun(row: OmpAdvertisedModel): boolean {
	return row.available !== false && row.reason === undefined;
}

/** The one row that names a pick, or nothing when several do and none of them stands out. */
function uniqueRowForPick(
	rows: readonly OmpAdvertisedModel[],
	preferredProvider?: string,
): OmpAdvertisedModel | undefined {
	if (rows.length === 1) return rows[0];
	if (preferredProvider !== undefined && preferredProvider.trim().length > 0) {
		// The picker's own description is the provider it drew for the row (Cedia's projection carries
		// OMP's provider there), so it names the row the user actually clicked.
		const preferred = rows.filter(row => row.provider === preferredProvider);
		if (preferred.length === 1) return preferred[0];
	}
	const runnable = rows.filter(rowCanRun);
	return runnable.length === 1 ? runnable[0] : undefined;
}

/**
 * The providers that advertise `pickedId`, in catalogue order.
 *
 * A pick that cannot be applied because more than one provider advertises it has to say so: the
 * user picked a name, and the name is not enough to say which provider runs it.
 */
export function ompModelPickProviders(snapshot: OmpModelSnapshot, pickedId: string): string[] {
	return [...new Set(rowsNamingPick(snapshot, pickedId).map(model => model.provider).filter((provider): provider is string => !!provider))];
}

/**
 * Why a failed transcript entry failed, in the provider's own words.
 *
 * OMP records an assistant message that ended on a provider error with the message it received
 * (`errorMessage`, and a shorter `errorClassificationMessage` alongside it), and the message
 * carries no text at all. The native chat rendered entries by their text, so such a turn painted
 * an empty chat and read as a normal completion - the user saw neither the model's answer nor the
 * reason there was none. The provider's sentence is the honest content for that row; Cedia's own
 * sentence only says that the turn stopped.
 */
export function entryFailureText(entry: TranscriptEntry): string | undefined {
	if (entry.status !== "failed") return undefined;
	for (const frame of [...entry.rawFrames].reverse()) {
		const record = asRecord(frame);
		// A host event carries the message either at its top level or under `message`, and the
		// write-through ack nests both under `data`.
		const message = asRecord(record?.message) ?? asRecord(asRecord(record?.data)?.message);
		const text = nonEmpty(message?.errorMessage) ?? nonEmpty(record?.errorMessage)
			?? nonEmpty(message?.errorClassificationMessage) ?? nonEmpty(record?.errorClassificationMessage);
		if (text) return text;
	}
	return undefined;
}

/**
 * The OMP model a composer's picked language model names, or `undefined` when OMP has no such model.
 *
 * The Agents window's composer draws the workbench's own language-model picker, which is fed by
 * every model provider the user has installed (their Cursor, opencode-go, openrouter and other
 * extensions) as well as by Cedia's register of OMP's catalogue. Cedia's turn does not run those
 * models: OMP runs the turn inside its own session, so the picked model only takes effect if Cedia
 * writes it to the host with `set_model`. Until 2026-09-18 nothing read the pick at all, so a
 * composer could show one model while the host ran another - measured live: the pill read
 * `DeepSeek V4.1 Flash` while the turn ran `cursor/claude-4.6-opus-high`. This resolves the pick
 * against OMP's catalogue with the same rules the option group uses, and returns nothing when the
 * pick belongs to a provider OMP does not run, so the caller can say so instead of pretending.
 */
export function ompModelForPickedLanguageModel(
	snapshot: OmpModelSnapshot,
	picked: { readonly id?: unknown; readonly vendor?: unknown } | undefined,
): { readonly provider: string; readonly modelId: string } | undefined {
	const id = nonEmpty(picked?.id);
	if (!id) return undefined;
	// The picker's vendor is the provider the row was drawn under, so it is what tells two rows with
	// the same model id apart when the catalogue advertises both.
	const row = ompModelRowForPick(snapshot, id, nonEmpty(picked?.vendor));
	if (!row) return undefined;
	const provider = resolveOmpModelPickProvider(snapshot, id, nonEmpty(picked?.vendor));
	return provider ? { provider, modelId: row.id } : undefined;
}

/** The option group Cedia's model catalogue is published under. */
export const CEDIA_OMP_MODELS_GROUP_ID = "models";

/** The option group the advertised thinking levels of the current model are published under. */
export const CEDIA_OMP_THINKING_GROUP_ID = "reasoning";

/**
 * OMP's advertised thinking levels for the session's current model, as a composer option group.
 *
 * The levels are per model, not per window: OMP's `get_state` answers with the ones the model it is
 * running accepts, so this group is rebuilt from that answer and follows the model whenever Cedia
 * republishes the session's options. Nothing is invented when OMP advertises none — no group is
 * published at all, because a reasoning control offering levels the model does not have is the fake
 * button §5 forbids (and `thinking-params.ts` keeps the same rule for the dock).
 */
export function thinkingPickerGroupFromParams(params: ThinkingParams): OmpModelPickerGroup | undefined {
	const items: OmpModelPickerItem[] = params.options
		.filter(option => option.enabled)
		.map(option => ({ id: option.id, name: option.label }));
	if (!params.advertised || items.length === 0) return undefined;
	const selected = params.current ? items.find(item => item.id === params.current) : undefined;
	return {
		id: CEDIA_OMP_THINKING_GROUP_ID,
		name: "Reasoning",
		items,
		...(selected ? { selected } : {}),
	};
}

/**
 * The reasoning group for one model, from the ladder that model's own catalogue row advertises.
 *
 * `get_state` names the level OMP is running (`thinkingLevel`) and no ladder, so a session's group
 * comes from here with that answer supplying only the current value; a draft has no `get_state` to
 * ask, and this is why the chip can still be shown and chosen before the first turn. `current` is
 * kept only when the ladder contains it, so a level left over from another model cannot be shown as
 * this one's selection.
 */
export function thinkingPickerGroupForModel(model: OmpAdvertisedModel, current?: string): OmpModelPickerGroup | undefined {
	const efforts = model.thinking?.efforts ?? [];
	if (efforts.length === 0) return undefined;
	const items: OmpModelPickerItem[] = efforts.map(effort => ({ id: effort, name: effortLabel(effort) }));
	const selected = current ? items.find(item => item.id === current) : undefined;
	return {
		id: CEDIA_OMP_THINKING_GROUP_ID,
		name: "Reasoning",
		items,
		...(selected ? { selected } : {}),
	};
}

/**
 * A ladder rung as the composer should read it. OMP spells them in lower case (`xhigh`); the
 * reference shows title case, and `xhigh` is the one rung whose plain title case (`Xhigh`) is not
 * what anyone calls it.
 */
function effortLabel(effort: string): string {
	if (effort.toLowerCase() === "xhigh") return "Extra High";
	return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function setThinkingLevelRequest(session: Session, level: string, commandId: string): CommandRequest {
	return { commandId, incarnation: session.incarnation, command: "set_thinking_level", payload: { level } };
}

/**
 * The model a composer has picked, read out of a session's input state.
 *
 * A Cedia draft has no host session yet, so the workbench keeps the composer's choice as a session
 * *option* and hands it back here as `previousInputState` (including at session creation, where it
 * is the only place a draft's pick can be read). The value arrives either as the bare OMP id
 * (`deepseek/deepseek-v4.1-flash`) or already carrying Cedia's vendor prefix (`cedia-omp/...`):
 * the option item carries the bare id while the picker publishes the prefixed identifier, and both
 * name the same model, so both are accepted and the bare id is returned.
 */
export function selectedModelIdFromInputState(inputState: unknown): string | undefined {
	const groups = asRecord(inputState)?.groups;
	if (!Array.isArray(groups)) return undefined;
	const group = groups.map(asRecord).find(candidate => candidate?.id === CEDIA_OMP_MODELS_GROUP_ID);
	const id = nonEmpty(asRecord(group?.selected)?.id);
	return id ? ompModelIdFromPickId(id) : undefined;
}

export function getAvailableModelsRequest(session: Session, commandId: string): CommandRequest {
	return { commandId, incarnation: session.incarnation, command: "get_available_models", payload: {} };
}

/**
 * The reasoning level a composer has picked, read out of a session's input state.
 *
 * The same path the model pick takes (`selectedModelIdFromInputState`): a draft has no host session to
 * write `set_thinking_level` to, so the workbench keeps the composer's choice as a session option and
 * hands it back at session creation.
 */
export function selectedThinkingLevelFromInputState(inputState: unknown): string | undefined {
	const groups = asRecord(inputState)?.groups;
	if (!Array.isArray(groups)) return undefined;
	const group = groups.map(asRecord).find(candidate => candidate?.id === CEDIA_OMP_THINKING_GROUP_ID);
	return nonEmpty(asRecord(group?.selected)?.id);
}

export function getModelRolesRequest(session: Session, commandId: string): CommandRequest {
	return { commandId, incarnation: session.incarnation, command: "cedia_get_model_roles", payload: {} };
}

export function setModelRoleRequest(session: Session, role: string, modelId: string | null, commandId: string): CommandRequest {
	return { commandId, incarnation: session.incarnation, command: "cedia_set_model_role", payload: { role, modelId } };
}

/** One configured model role as OMP reports it: which model does which job. */
export interface OmpModelRole {
	readonly role: string;
	/** `provider/model` selector, or `@otherRole` when the role aliases another. */
	readonly modelId: string;
	/** Layer the effective value came from, for an honest provenance display. */
	readonly source: string;
}

/** Roles plus the order the model switcher steps through, as OMP resolves them. */
export interface OmpModelRoles {
	readonly cycleOrder: readonly string[];
	readonly roles: readonly OmpModelRole[];
	readonly storage?: string;
}

/**
 * Normalize a `cedia_get_model_roles` ack/result. Roles without an id are
 * dropped rather than invented, and `cycleOrder` keeps only entries that also
 * resolved to a role so the picker cannot step onto an empty slot.
 */
export function normalizeOmpModelRoles(value: unknown): OmpModelRoles {
	const data = asRecord(unwrapData(value));
	const rawRoles = Array.isArray(data?.roles) ? data.roles : [];
	const roles = rawRoles.flatMap((entry): OmpModelRole[] => {
		const item = asRecord(entry);
		const role = nonEmpty(item?.role);
		const modelId = nonEmpty(item?.modelId);
		if (!role || !modelId) return [];
		return [{ role, modelId, source: nonEmpty(item?.source) ?? "default" }];
	});
	const known = new Set(roles.map(role => role.role));
	const rawOrder = Array.isArray(data?.cycleOrder) ? data.cycleOrder : [];
	const cycleOrder = rawOrder.flatMap(entry => {
		const role = nonEmpty(entry);
		return role && known.has(role) ? [role] : [];
	});
	const storage = nonEmpty(data?.storage);
	return { cycleOrder, roles, ...(storage ? { storage } : {}) };
}

/**
 * The display label for a role, matching the vocabulary OMP's own carousel uses
 * (`MODEL_ROLES` in the OMP source: smol is "Fast", slow is "Thinking", plan is
 * "Architect"). An unknown custom role shows its own id rather than a guess.
 */
const MODEL_ROLE_LABELS: Record<string, string> = {
	default: "Default",
	smol: "Fast",
	slow: "Thinking",
	vision: "Vision",
	plan: "Architect",
	commit: "Commit",
	tiny: "Tiny",
	task: "Subtask",
	advisor: "Advisor",
};

export function modelRoleLabel(role: string): string {
	return MODEL_ROLE_LABELS[role] ?? role;
}

/**
 * Name the roles each catalog model holds, keyed by `provider/modelId`.
 *
 * A role selector may be another role (`@slow`) rather than a concrete model, so
 * an alias is resolved through the same map before grouping — otherwise the
 * aliased role would silently vanish and the user would see a role that exists in
 * OMP but nowhere in Cedia. A role that resolves to nothing is dropped instead of
 * listed against a model it does not own.
 *
 * The key is provider-qualified because a bare id is ambiguous: OMP's catalog can
 * carry the same short id under two providers, and matching on the id alone would
 * annotate the wrong row.
 */
export function rolesByModelSelector(roles: OmpModelRoles): ReadonlyMap<string, readonly string[]> {
	const byRole = new Map(roles.roles.map(role => [role.role, role.modelId]));
	const grouped = new Map<string, string[]>();
	for (const role of roles.roles) {
		let selector = role.modelId;
		// Follow `@role` aliases, bounded by the alias count so a cycle terminates.
		for (let hop = 0; selector.startsWith("@") && hop < roles.roles.length; hop++) {
			selector = byRole.get(selector.slice(1)) ?? "";
		}
		if (!selector || selector.startsWith("@")) continue;
		const labels = grouped.get(selector);
		if (labels) labels.push(modelRoleLabel(role.role));
		else grouped.set(selector, [modelRoleLabel(role.role)]);
	}
	return grouped;
}

/**
 * Build one picker group per configured role, so a role's model can be chosen
 * where models are chosen.
 *
 * Each item's id is `role\u0000modelSelector`, because the write-back handler
 * receives only the group id and the picked value: encoding both lets a single
 * handler assign any role without guessing which group produced the value. The
 * leading "clear" item is what makes an assignment removable, which is how a role
 * returns to OMP's own default resolution instead of being pinned forever.
 */
export function getOmpStateRequest(session: Session, commandId: string): CommandRequest {
	return { commandId, incarnation: session.incarnation, command: "get_state", payload: {} };
}

export function setOmpModelRequest(session: Session, provider: string, modelId: string, commandId: string): CommandRequest {
	return { commandId, incarnation: session.incarnation, command: "set_model", payload: { provider, modelId } };
}

export function getLoginProvidersRequest(session: Session, commandId: string): CommandRequest {
	return { commandId, incarnation: session.incarnation, command: "get_login_providers", payload: {} };
}

function providerArrayFrom(value: unknown): readonly unknown[] {
	const unwrapped = unwrapData(value);
	if (Array.isArray(unwrapped)) return unwrapped;
	const record = asRecord(unwrapped);
	const providers = record?.providers;
	return Array.isArray(providers) ? providers : [];
}

/**
 * Normalize a `get_login_providers` ack/result into `{id, authenticated}` rows.
 * Accepts `{data:{providers:[...]}}`, `{providers:[...]}`, `{data:[...]}` or a
 * bare array; drops rows without an id. `authenticated` is kept only when OMP
 * sent a boolean — a missing flag stays undefined so the snapshot does not
 * invent a needs-auth annotation.
 */
export function normalizeOmpLoginProviders(value: unknown): OmpLoginProvider[] {
	return providerArrayFrom(value).flatMap((entry): OmpLoginProvider[] => {
		const item = asRecord(entry);
		if (!item) return [];
		const id = nonEmpty(item.id);
		if (!id) return [];
		return [{
			id,
			...(typeof item.authenticated === "boolean" ? { authenticated: item.authenticated } : {}),
		}];
	});
}

/**
 * Resolve the OMP provider for a picker selection against a snapshot.
 * Prefers the advertised catalog row; falls back to the picker's own
 * description (which carries the provider for known rows). Returns undefined
 * when neither knows the provider so the caller can fail honestly instead of
 * guessing `set_model:{provider,...}`.
 */
export function resolveOmpModelPickProvider(
	snapshot: OmpModelSnapshot,
	pickedId: string,
	pickedDescription?: unknown,
): string | undefined {
	// The description travels in as well: it is the provider the picker drew for that row, so it
	// names the row when the catalogue carries the same id more than once.
	const rows = rowsNamingPick(snapshot, pickedId);
	const advertised = uniqueRowForPick(rows, nonEmpty(pickedDescription));
	if (advertised?.provider) return advertised.provider;
	// The catalogue knows this id but cannot single out a provider (two rows carry it, or the row
	// itself reports no provider). The id's own prefix is not evidence here, because the rows that
	// carry it are exactly what disagree, so nothing is invented.
	if (rows.length > 0) return undefined;
	// A row that carries no provider field still names its provider when the id is OMP's
	// qualified spelling (`cursor/claude-4.6-opus-high`), which is what `set_model` wants.
	const qualified = pickedId.includes("/") ? pickedId.slice(0, pickedId.indexOf("/")) : undefined;
	if (qualified) return qualified;
	return typeof pickedDescription === "string" && pickedDescription.trim().length > 0
		? pickedDescription.trim()
		: undefined;
}

/** One question the native chat carousel can present for a host UI request. */
export interface OmpUiQuestion {
	readonly id: string;
	readonly kind: "text" | "single_select";
	readonly title: string;
	readonly message?: string;
	readonly options?: ReadonlyArray<{ readonly id: string; readonly label: string; readonly value: string | boolean }>;
}

/**
 * Project a host UI request into one native carousel question.
 *
 * Every method the wire can carry is answered here; a select is always single
 * choice, because OMP's `select` has no multi-value form and its options are
 * plain strings that are their own labels. Confirm options mirror the dock's
 * order and wording (`Allow`, then `Deny`).
 */
export function uiQuestionFromRequest(request: CediaUiRequest): OmpUiQuestion {
	switch (request.method) {
		case "confirm":
			return {
				id: request.id,
				kind: "single_select",
				title: request.title,
				message: request.message,
				options: [
					{ id: "allow", label: "Allow", value: true },
					{ id: "deny", label: "Deny", value: false },
				],
			};
		case "select":
			return {
				id: request.id,
				kind: "single_select",
				title: request.title,
				options: request.options.map(option => ({ id: option, label: option, value: option })),
			};
		case "input":
			return { id: request.id, kind: "text", title: request.title, ...(request.placeholder !== undefined ? { message: request.placeholder } : {}) };
		case "editor":
			return { id: request.id, kind: "text", title: request.title, ...(request.prefill !== undefined ? { message: request.prefill } : {}) };
	}
}

/** The answer key the carousel and the host response must agree on: the request id. */
export function uiCarouselQuestionId(request: CediaUiRequest): string {
	return request.id;
}

/**
 * The workbench answers select questions with an `IChatQuestionAnswerValue`
 * object (`{selectedValue}` / `{selectedValues, freeformValue}`) and it
 * stringifies option values on the way over (`ChatResponseQuestionCarouselPart.from`),
 * so `true` arrives as `"true"`. Unwrap those shapes; a bare value passes through.
 */
function unwrapCarouselAnswer(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
	const record = value as Record<string, unknown>;
	if (Array.isArray(record.selectedValues) && record.selectedValues.length > 0) return record.selectedValues;
	if (typeof record.selectedValue === "string" && record.selectedValue.length > 0) return record.selectedValue;
	if (typeof record.freeformValue === "string" && record.freeformValue.length > 0) return record.freeformValue;
	if (Array.isArray(record.selectedValues)) return record.selectedValues;
	return value;
}

/**
 * Map whatever the workbench hands back from the carousel into the answer shape
 * the host accepts. The workbench may answer with a bare value or an array;
 * anything empty or of the wrong shape is a cancellation rather than an
 * invented answer.
 */
export function uiAnswerValue(request: CediaUiRequest, value: unknown): string | boolean | { readonly cancelled: true } {
	const answer = unwrapCarouselAnswer(value);
	if (answer === undefined || answer === null || answer === "") return { cancelled: true };
	if (Array.isArray(answer)) {
		// No method Cedia renders collects more than one value, so a multi-value
		// answer is a shape this surface never asked for.
		return { cancelled: true };
	}
	switch (request.method) {
		case "confirm":
			if (typeof answer === "boolean") return answer;
			if (typeof answer !== "string") return { cancelled: true };
			if (answer === "true") return true;
			if (answer === "false") return false;
			return { cancelled: true };
		case "select":
		case "input":
		case "editor":
			return typeof answer === "string" ? answer : { cancelled: true };
	}
}
