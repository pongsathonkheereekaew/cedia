/**
 * Pure state model for the Cedia task surface.
 *
 * OMP frames are retained verbatim in every transcript row.  The reducer only
 * projects stable message/tool identities for rendering; it does not invent a
 * second transcript or infer a completed side effect from an acknowledgement.
 */

import type {
	Command,
	EventPage,
	Json,
	Project,
	Session,
	SessionEvent,
} from "../../../packages/protocol/src/index.ts";
import { isUiInteractiveMethod, parseUiSelectOptionDetails, unsupportedUiMethodMessage, type PendingUiRequest, type UiRequestParseResult } from "../../../packages/protocol/src/ui.ts";
import type { LoginProviderOption } from "../../../packages/protocol/src/models.ts";
import { draftViewKey } from "./workbench-mode.ts";
import { createWorkPanelState, reduceWorkPanel, type WorkPanelAction, type WorkPanelState } from "./work-panel.ts";

export type RawFrame = Record<string, unknown>;

export type ConnectionStatus = "offline" | "connecting" | "connected" | "running" | "unknown";
export type TranscriptRole = "user" | "assistant" | "tool" | "system";
export type TranscriptKind = "message" | "tool" | "event";
export type ToolStatus = "running" | "completed" | "failed" | "cancelled" | "unknown";

export interface TranscriptEntry {
	readonly id: string;
	readonly kind: TranscriptKind;
	readonly role: TranscriptRole;
	readonly text: string;
	readonly status: "streaming" | "completed" | "failed" | "unknown";
	readonly toolName?: string;
	readonly toolStatus?: ToolStatus;
	readonly args?: unknown;
	readonly output?: string;
	readonly createdAt?: string;
	readonly rawFrames: readonly RawFrame[];
}

export interface SlashCommandOption {
	readonly name: string;
	readonly description?: string;
	readonly source?: string;
}

/**
 * The login picker's provider row is the protocol's projection of the
 * provider-auth row (§10 item 65c), so the reducer, the menus and the phone
 * cannot disagree about which provider is signed in.
 */
export type { LoginProviderOption };

export interface UiPresentation {
	readonly id: string;
	readonly method: string;
	readonly message?: string;
	readonly url?: string;
	readonly launchUrl?: string;
	readonly instructions?: string;
	readonly title?: string;
	readonly notifyType?: "info" | "warning" | "error";
	readonly statusKey?: string;
	readonly statusText?: string;
	readonly widgetKey?: string;
	readonly widgetLines?: readonly string[];
	readonly widgetPlacement?: "aboveEditor" | "belowEditor";
	readonly text?: string;
}

export interface ModelOption {
	readonly id: string;
	readonly provider?: string;
	readonly label: string;
	readonly available?: boolean;
	readonly reason?: string;
	readonly [key: string]: unknown;
}

export interface PendingCommand {
	readonly commandId: string;
	readonly incarnation: string;
	readonly command: string;
	readonly payload?: Record<string, Json>;
	readonly status: "queued" | "sent" | "completed" | "failed" | "unknown" | "not_dispatched";
	readonly replayable: false;
	readonly error?: string;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface TaskState {
	readonly connection: ConnectionStatus;
	readonly lastError?: string;
	readonly project: Project | null;
	readonly projects: readonly Project[];
	readonly sessions: readonly Session[];
	readonly session: Session | null;
	readonly transcript: readonly TranscriptEntry[];
	readonly cursor: number;
	readonly hasMoreEvents: boolean;
	readonly uiRequests: readonly PendingUiRequest[];
	readonly pendingCommands: Readonly<Record<string, PendingCommand>>;
	readonly models: readonly ModelOption[];
	readonly selectedModel?: string;
	readonly loginProviders: readonly LoginProviderOption[];
	readonly presentations: readonly UiPresentation[];
	readonly slashCommands: readonly SlashCommandOption[];
	readonly draft: string;
	readonly drafts: Readonly<Record<string, string>>;
	readonly workbenchMode: "agents" | "ide";
	readonly transcriptScrolls: Readonly<Record<string, { readonly offset: number; readonly eventId?: string }>>;
	readonly followLatest: boolean;
	readonly workPanel: WorkPanelState;
	readonly activeMessageId?: string;
	/** Latest message identity for each OMP message role in this incarnation.
	 * OMP message lifecycle events intentionally do not carry a message id; the
	 * reducer keeps this small map so cumulative updates/end frames reconcile to
	 * the message_start row instead of creating one row per event. */
	readonly messageStreams: Readonly<Record<string, string>>;
	readonly activeToolIds: readonly string[];
	readonly seenEventKeys: readonly string[];
}

export type CediaEvent = SessionEvent | { readonly sequence?: number; readonly frame: Json };

export type TaskAction =
	| { readonly type: "reset"; readonly session?: Session | null; readonly project?: Project | null }
	| { readonly type: "connection"; readonly status: ConnectionStatus; readonly error?: string; readonly markUnknown?: boolean }
	| { readonly type: "projects"; readonly projects: readonly Project[] }
	| { readonly type: "sessions"; readonly sessions: readonly Session[] }
	| { readonly type: "session"; readonly session: Session | null }
	| { readonly type: "events"; readonly page: EventPage }
	| { readonly type: "event"; readonly event: CediaEvent }
	| { readonly type: "frame"; readonly frame: Json; readonly sequence?: number; readonly sessionId?: string; readonly incarnation?: string }
	| { readonly type: "draft"; readonly draft: string }
	| { readonly type: "workbench_mode"; readonly mode: "agents" | "ide" }
	| { readonly type: "transcript_scroll"; readonly key: string; readonly offset: number; readonly eventId?: string; readonly followLatest: boolean }
	| { readonly type: "work_panel"; readonly action: WorkPanelAction }
	| { readonly type: "command_created"; readonly command: Pick<PendingCommand, "commandId" | "incarnation" | "command" | "payload"> }
	| { readonly type: "command_result"; readonly command: Command }
	| { readonly type: "command_status"; readonly commandId: string; readonly status: PendingCommand["status"]; readonly error?: string }
	| { readonly type: "ui_request"; readonly event: unknown }
	| { readonly type: "ui_sync"; readonly requests: readonly PendingUiRequest[] }
	| { readonly type: "ui_resolved"; readonly token: string }
	| { readonly type: "models"; readonly models: readonly ModelOption[]; readonly selectedModel?: string }
	| { readonly type: "login_providers"; readonly providers: readonly LoginProviderOption[] }
	| { readonly type: "slash_commands"; readonly commands: readonly SlashCommandOption[] }
	| { readonly type: "history_page"; readonly entries: readonly TranscriptEntry[] };

export function normalizeSlashCommands(value: unknown): SlashCommandOption[] {
	if (value && typeof value === "object" && !Array.isArray(value) && "data" in value) {
		return normalizeSlashCommands((value as Record<string, unknown>).data);
	}
	const source = value && typeof value === "object" && !Array.isArray(value) && "commands" in value
		? (value as { commands: unknown }).commands
		: value;
	if (!Array.isArray(source)) return [];
	return source.flatMap((item): SlashCommandOption[] => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const record = item as Record<string, unknown>;
		const name = typeof record.name === "string" ? record.name.trim() : "";
		if (!name) return [];
		const commandSource = typeof record.source === "string" ? record.source.trim() : "";
		return [{ name, ...(typeof record.description === "string" ? { description: record.description } : {}), ...(commandSource ? { source: commandSource } : {}) }];
	});
}

export function createInitialTaskState(overrides: Partial<TaskState> = {}): TaskState {
	return {
		connection: "offline",
		project: null,
		projects: [],
		sessions: [],
		session: null,
		transcript: [],
		cursor: 0,
		hasMoreEvents: false,
		uiRequests: [],
		pendingCommands: {},
		models: [],
		loginProviders: [],
		presentations: [],
		slashCommands: [],
		draft: "",
		drafts: {},
		workbenchMode: "agents",
		transcriptScrolls: {},
		followLatest: true,
		workPanel: createWorkPanelState(),
		messageStreams: {},
		activeToolIds: [],
		seenEventKeys: [],
		...overrides,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function timestampValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) {
		try {
			return new Date(value).toISOString();
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function finiteTimeout(value: unknown): value is number | undefined {
	return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647);
}

function cloneFrame(frame: Json): RawFrame {
	if (!isRecord(frame)) return { type: "unknown", value: frame };
	return frame;
}

function frameType(frame: RawFrame): string {
	const type = frame.type ?? frame.event ?? frame.kind;
	return typeof type === "string" ? type : "unknown";
}

/**
 * Whether a frame is transport for a terminal panel rather than chat activity.
 *
 * The virtual terminal's frames are folded into a screen by the surfaces that
 * draw one - the host's checkpoint registry, `terminal.ts` for the IDE panel,
 * `apps/ios/src/core/virtual-terminal.ts` for the phone - and the checkpoint
 * protocol tells a client where to resume. They are not conversation: a single
 * turn emits ~140 screen updates, and recording one transcript row per update
 * buried the chat under raw escape sequences.
 *
 * The whole `cedia_terminal_` family is skipped rather than a list of the four
 * frames seen so far, so a new one cannot leak into the transcript by being
 * forgotten here.
 */
export function isTerminalTransportFrame(type: string): boolean {
	return type.startsWith("cedia_terminal_");
}

function firstString(frame: RawFrame, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = frame[key];
		if (nonEmptyString(value)) return value;
	}
	return undefined;
}

function nestedString(frame: RawFrame, key: string, nestedKey: string): string | undefined {
	const nested = frame[key];
	return isRecord(nested) ? stringValue(nested[nestedKey]) : undefined;
}

function nestedRecord(frame: RawFrame, key: string): RawFrame | undefined {
	const nested = frame[key];
	return isRecord(nested) ? nested : undefined;
}

function messageRecord(frame: RawFrame): RawFrame | undefined {
	return nestedRecord(frame, "message");
}

function messageRole(frame: RawFrame): string | undefined {
	return stringValue(messageRecord(frame)?.role) ?? stringValue(frame.role);
}

/**
 * OMP content is deliberately richer than the flattened text used by the
 * legacy Cedia projection.  Keep this extractor conservative: render text
 * blocks, recurse through tool-result `content`, and leave images/details in
 * the raw frame for a future artifact renderer.
 */
function textFromValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value.map(textFromValue).filter(value => value.length > 0).join("");
	}
	if (!isRecord(value)) return "";
	if (typeof value.text === "string") return value.text;
	if (typeof value.output === "string") return value.output;
	if ("content" in value) return textFromValue(value.content);
	if ("result" in value) return textFromValue(value.result);
	return "";
}

function contentText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return textFromValue(value);
	return value.map(block => {
		if (typeof block === "string") return block;
		if (!isRecord(block)) return "";
		// Thinking is intentionally not surfaced as assistant transcript text.
		if (block.type === "thinking" || block.type === "redactedThinking") return "";
		return textFromValue(block);
	}).filter(value => value.length > 0).join("");
}

function messageContentText(frame: RawFrame): string | undefined {
	const message = messageRecord(frame);
	if (!message || !("content" in message)) return undefined;
	return contentText(message.content);
}

function assistantEvent(frame: RawFrame): RawFrame | undefined {
	return nestedRecord(frame, "assistantMessageEvent");
}

interface MessageTextProjection {
	readonly text: string;
	/** True when `text` came from OMP's cumulative message snapshot. */
	readonly cumulative: boolean;
}

function messageTextProjection(frame: RawFrame): MessageTextProjection {
	const snapshot = messageContentText(frame);
	if (snapshot !== undefined) {
		// A provider may emit an empty snapshot immediately before a text delta.
		// Prefer that delta for the current frame while retaining cumulative mode
		// whenever the snapshot has real text.
		if (snapshot.length > 0) return { text: snapshot, cumulative: true };
		const event = assistantEvent(frame);
		const delta = event && typeof event.delta === "string" ? event.delta : undefined;
		if (delta) return { text: delta, cumulative: false };
		return { text: "", cumulative: true };
	}
	const event = assistantEvent(frame);
	if (event) {
		if (typeof event.delta === "string") return { text: event.delta, cumulative: false };
		if (typeof event.content === "string") return { text: event.content, cumulative: false };
	}
	for (const key of ["text", "delta", "content", "output", "message"]) {
		if (!(key in frame)) continue;
		const text = textFromValue(frame[key]);
		if (text) return { text, cumulative: false };
	}
	return { text: "", cumulative: false };
}

function frameIdentity(frame: RawFrame, fallback: string): string {
	return firstString(
		frame,
		"messageId",
		"message_id",
		"toolCallId",
		"tool_call_id",
		"callId",
		"call_id",
		"itemId",
		"item_id",
		"id",
	) ?? nestedString(frame, "message", "id") ?? nestedString(frame, "message", "responseId") ?? nestedString(frame, "tool", "id") ?? fallback;
}

function textFromFrame(frame: RawFrame): string {
	return messageTextProjection(frame).text || textFromValue(frame.result) || textFromValue(frame.partialResult) || "";
}

function frameArgs(frame: RawFrame): unknown {
	return frame.arguments ?? frame.args ?? frame.input ?? frame.parameters;
}

function toolCallIdFromFrame(frame: RawFrame): string | undefined {
	return firstString(frame, "toolCallId", "tool_call_id", "callId", "call_id")
		?? nestedString(frame, "message", "toolCallId")
		?? nestedString(frame, "result", "toolCallId")
		?? nestedString(frame, "partialResult", "toolCallId");
}

function toolPayload(frame: RawFrame, mode: "start" | "update" | "end"): unknown {
	if (mode === "update" && "partialResult" in frame) return frame.partialResult;
	if (mode === "end" && "result" in frame) return frame.result;
	return frame.output ?? frame.content;
}

function toolPayloadIsError(frame: RawFrame, mode: "start" | "update" | "end"): boolean {
	if (frame.isError === true || frame.error === true || frame.status === "failed" || frame.status === "error") return true;
	const payload = toolPayload(frame, mode);
	return isRecord(payload) && payload.isError === true;
}

function toolPayloadIsCancelled(frame: RawFrame, mode: "start" | "update" | "end"): boolean {
	if (frame.cancelled === true || frame.status === "cancelled" || frame.status === "aborted") return true;
	const payload = toolPayload(frame, mode);
	return isRecord(payload) && (payload.cancelled === true || payload.status === "cancelled" || payload.status === "aborted");
}

function mergeToolOutput(current: string | undefined, next: string, mode: "start" | "update" | "end"): string | undefined {
	if (!next) return current;
	if (!current || mode === "start") return next;
	if (next === current || next.startsWith(current)) return next;
	if (current.startsWith(next)) return current;
	return `${current}${current ? "\n" : ""}${next}`;
}

interface FrameContext {
	readonly sessionId?: string;
	readonly incarnation?: string;
}

function incarnationFor(state: TaskState, context?: FrameContext): string {
	return context?.incarnation ?? state.session?.incarnation ?? "unknown";
}

function messageStreamKey(state: TaskState, role: string, context?: FrameContext): string {
	return `${incarnationFor(state, context)}:${role}`;
}

function messageLifecycleId(state: TaskState, frame: RawFrame, sequence: number | undefined, context: FrameContext | undefined, mode: "start" | "update" | "end"): { id: string; streams: Readonly<Record<string, string>> } {
	const role = messageRole(frame) ?? "assistant";
	const streamKey = messageStreamKey(state, role, context);
	const explicit = frameIdentity(frame, "");
	const prior = state.messageStreams[streamKey];
	// OMP may expose a response id only on a later snapshot. Once a
	// message_start identity has been chosen, keep using it for updates/end
	// frames; otherwise that late metadata would fork the transcript row.
	let id = mode === "start" ? explicit : prior || explicit;
	if (!id && mode === "update") {
		const candidate = lastMessageId(state);
		if (candidate) id = candidate;
	}
	if (!id && mode === "end") {
		const candidate = state.transcript.findLast(entry => entry.kind === "message" && entry.role === role && entry.status === "streaming")?.id;
		if (candidate) id = candidate;
	}
	if (!id) id = `${incarnationFor(state, context)}:message:${sequence ?? state.transcript.length}`;
	return { id, streams: { ...state.messageStreams, [streamKey]: id } };
}

function appendFrame(entry: TranscriptEntry, frame: RawFrame): TranscriptEntry {
	return { ...entry, rawFrames: [...entry.rawFrames, frame] };
}

function replaceById(entries: readonly TranscriptEntry[], id: string, update: (entry: TranscriptEntry) => TranscriptEntry): readonly TranscriptEntry[] {
	const index = entries.findIndex(entry => entry.id === id);
	if (index < 0) return entries;
	const next = entries.slice();
	next[index] = update(entries[index]!);
	return next;
}

function lastMessageId(state: TaskState): string | undefined {
	for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
		const entry = state.transcript[index];
		if (entry?.kind === "message" && entry.status === "streaming") return entry.id;
	}
	return state.activeMessageId;
}

function lastToolId(state: TaskState): string | undefined {
	for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
		if (state.transcript[index]?.kind === "tool") return state.transcript[index]!.id;
	}
	return undefined;
}

function addOrUpdateMessage(state: TaskState, id: string, frame: RawFrame, mode: "start" | "update" | "end"): TaskState {
	const roleValue = messageRole(frame);
	const role = roleValue === "user" || roleValue === "system" || roleValue === "tool" ? roleValue : "assistant";
	const projection = messageTextProjection(frame);
	const existing = state.transcript.find(entry => entry.id === id);
	if (!existing) {
		const status = mode === "end" ? "completed" : mode === "update" ? "streaming" : "streaming";
		const entry: TranscriptEntry = {
			id,
			kind: "message",
			role,
			text: projection.text,
			status,
			createdAt: timestampValue(messageRecord(frame)?.timestamp) ?? timestampValue(frame.timestamp) ?? timestampValue(frame.createdAt),
			rawFrames: [frame],
		};
		return { ...state, transcript: [...state.transcript, entry], activeMessageId: status === "streaming" ? id : state.activeMessageId };
	}
	const fragment = mode === "update" ? projection.text : mode === "start" && existing.text.length === 0 ? projection.text : "";
	const nextStatus = mode === "end"
		? (frame.error || frame.errorMessage || messageRecord(frame)?.errorMessage || messageRecord(frame)?.stopReason === "error" ? "failed" : "completed")
		: existing.status;
	const nextText = projection.cumulative ? projection.text : fragment ? `${existing.text}${fragment}` : existing.text;
	return {
		...state,
		transcript: replaceById(state.transcript, id, current => ({
			...appendFrame(current, frame),
			text: nextText,
			status: nextStatus,
		})),
		activeMessageId: mode === "end" && state.activeMessageId === id ? undefined : state.activeMessageId ?? id,
	};
}

function addOrUpdateTool(state: TaskState, id: string, frame: RawFrame, mode: "start" | "update" | "end", rawFrame: RawFrame = frame): TaskState {
	const existing = state.transcript.find(entry => entry.id === id && entry.kind === "tool");
	const toolName = firstString(frame, "toolName", "tool_name", "name") ?? existing?.toolName ?? "tool";
	const failed = toolPayloadIsError(frame, mode);
	const cancelled = toolPayloadIsCancelled(frame, mode);
	const status: ToolStatus = mode === "start"
		? existing?.toolStatus ?? "running"
		: mode === "update"
			? failed ? "failed" : cancelled ? "cancelled" : existing?.toolStatus ?? "running"
			: failed ? "failed" : cancelled ? "cancelled" : "completed";
	const output = textFromValue(toolPayload(frame, mode)) || textFromFrame(frame);
	if (!existing) {
		const entry: TranscriptEntry = {
			id,
			kind: "tool",
			role: "tool",
			text: output,
			status: status === "failed" ? "failed" : status === "completed" || status === "cancelled" ? "completed" : "streaming",
			toolName,
			toolStatus: status,
			args: frameArgs(frame),
			output,
			rawFrames: [rawFrame],
		};
		return {
			...state,
			transcript: [...state.transcript, entry],
			activeToolIds: status === "running" ? [...state.activeToolIds, id] : state.activeToolIds,
		};
	}
	const activeToolIds = status === "running" ? state.activeToolIds : state.activeToolIds.filter(value => value !== id);
	return {
		...state,
		transcript: replaceById(state.transcript, id, current => {
			const mergedOutput = mergeToolOutput(current.output, output, mode);
			return {
				...appendFrame(current, rawFrame),
				text: mergedOutput ?? current.text,
				output: mergedOutput,
			status: status === "failed" ? "failed" : status === "completed" || status === "cancelled" ? "completed" : "streaming",
			toolName,
			toolStatus: status,
			args: current.args ?? frameArgs(frame),
			};
		}),
		activeToolIds,
	};
}

function optionalRequestText(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function uiRequestExtras(value: Record<string, unknown>, request: Record<string, unknown>): Pick<PendingUiRequest, "sessionId" | "incarnation" | "cwd" | "tool" | "target" | "status"> {
	const status = request.status ?? value.status;
	const allowed = status === "stale" || status === "timeout" || status === "responded_elsewhere" || status === "cancelled" || status === "approved" || status === "denied" || status === "pending";
	return {
		...(optionalRequestText(value.sessionId) ? { sessionId: String(value.sessionId) } : {}),
		...(optionalRequestText(value.incarnation) ? { incarnation: String(value.incarnation) } : {}),
		...(optionalRequestText(request.cwd) ? { cwd: String(request.cwd) } : optionalRequestText(value.cwd) ? { cwd: String(value.cwd) } : {}),
		...(optionalRequestText(request.tool) ? { tool: String(request.tool) } : {}),
		...(optionalRequestText(request.target) ? { target: String(request.target) } : {}),
		...(allowed ? { status: status as PendingUiRequest["status"] } : {}),
	};
}

function uiRequestFromEnvelope(value: unknown): UiRequestParseResult {
	// The method decides first, against the shared protocol union: a request the
	// wire cannot carry is refused by name instead of being called malformed.
	if (!isRecord(value) || value.kind !== "interactive" || !nonEmptyString(value.token) || !isRecord(value.request)) {
		return { ok: false, reason: "not-interactive" };
	}
	const request = value.request;
	const method = request.method;
	if (typeof method !== "string") return { ok: false, reason: "malformed" };
	if (!isUiInteractiveMethod(method)) return { ok: false, reason: "unknown-method", method };
	if (!nonEmptyString(request.id) || !nonEmptyString(request.title) || !finiteTimeout(request.timeout)) {
		return { ok: false, reason: "malformed" };
	}
	const extras = uiRequestExtras(value, request);
	switch (method) {
		case "confirm":
			return typeof request.message === "string"
				? { ok: true, request: { kind: "interactive", token: value.token, request: { method, id: request.id, title: request.title, message: request.message, ...(request.timeout === undefined ? {} : { timeout: request.timeout }) }, ...extras } }
				: { ok: false, reason: "malformed" };
		case "select": {
			if (!Array.isArray(request.options) || request.options.length === 0 || !request.options.every(nonEmptyString)) {
				return { ok: false, reason: "malformed" };
			}
			const optionDetails = parseUiSelectOptionDetails(request.optionDetails, request.options.length);
			if (request.optionDetails !== undefined && optionDetails === undefined) return { ok: false, reason: "malformed" };
			return { ok: true, request: { kind: "interactive", token: value.token, request: { method, id: request.id, title: request.title, options: [...request.options], ...(optionDetails === undefined ? {} : { optionDetails }), ...(request.timeout === undefined ? {} : { timeout: request.timeout }) }, ...extras } };
		}
		case "input":
			return request.placeholder === undefined || typeof request.placeholder === "string"
				? { ok: true, request: { kind: "interactive", token: value.token, request: { method, id: request.id, title: request.title, ...(typeof request.placeholder === "string" ? { placeholder: request.placeholder } : {}), ...(request.timeout === undefined ? {} : { timeout: request.timeout }) }, ...extras } }
				: { ok: false, reason: "malformed" };
		case "editor":
			return (request.prefill === undefined || typeof request.prefill === "string") && (request.promptStyle === undefined || typeof request.promptStyle === "boolean")
				? { ok: true, request: { kind: "interactive", token: value.token, request: { method, id: request.id, title: request.title, ...(typeof request.prefill === "string" ? { prefill: request.prefill } : {}), ...(typeof request.promptStyle === "boolean" ? { promptStyle: request.promptStyle } : {}) }, ...extras } }
				: { ok: false, reason: "malformed" };
	}
}

/**
 * Parse one pending-UI envelope.  A request is either represented completely or
 * refused with the reason, so an unknown method is stated rather than dropped.
 */
export function parseCediaUiRequest(value: unknown): UiRequestParseResult {
	return uiRequestFromEnvelope(value);
}

export function isCediaUiRequest(value: unknown): value is PendingUiRequest {
	return uiRequestFromEnvelope(value).ok;
}

/**
 * State one request whose method OMP cannot send.  The Mac keeps the reason as
 * its single error line rather than dropping the request; the same violation
 * repeating (a poll of the host's pending list) leaves the state untouched.
 */
function stateStatingUnknownUiMethod(state: TaskState, method: string): TaskState {
	const lastError = unsupportedUiMethodMessage(method);
	return state.lastError === lastError ? state : { ...state, lastError };
}

function presentationFromEnvelope(value: unknown): UiPresentation | undefined {
	if (!isRecord(value) || value.kind !== "presentation" || !isRecord(value.request)) return undefined;
	const request = value.request;
	const { id, method } = request;
	if (!nonEmptyString(id) || !nonEmptyString(method)) return undefined;
	switch (method) {
		case "notify": {
			const message = request.message;
			const notifyType = request.notifyType;
			if (!nonEmptyString(message)) return undefined;
			if (notifyType !== undefined && notifyType !== "info" && notifyType !== "warning" && notifyType !== "error") return undefined;
			return { id, method, message, ...(notifyType === undefined ? {} : { notifyType }) };
		}
		case "setStatus": {
			const statusKey = request.statusKey;
			const statusText = request.statusText;
			if (!nonEmptyString(statusKey)) return undefined;
			if (statusText !== undefined && typeof statusText !== "string") return undefined;
			return { id, method, statusKey, ...(typeof statusText === "string" ? { statusText } : {}) };
		}
		case "setWidget": {
			const widgetKey = request.widgetKey;
			const widgetLines = request.widgetLines;
			const widgetPlacement = request.widgetPlacement;
			if (!nonEmptyString(widgetKey)) return undefined;
			if (widgetLines !== undefined && (!Array.isArray(widgetLines) || !widgetLines.every(line => typeof line === "string"))) return undefined;
			if (widgetPlacement !== undefined && widgetPlacement !== "aboveEditor" && widgetPlacement !== "belowEditor") return undefined;
			return {
				id,
				method,
				widgetKey,
				...(Array.isArray(widgetLines) ? { widgetLines: [...widgetLines] } : {}),
				...(widgetPlacement === "aboveEditor" || widgetPlacement === "belowEditor" ? { widgetPlacement } : {}),
			};
		}
		case "setTitle": {
			const title = request.title;
			if (!nonEmptyString(title)) return undefined;
			return { id, method, title };
		}
		case "set_editor_text": {
			const text = request.text;
			if (typeof text !== "string") return undefined;
			return { id, method, text };
		}
		case "open_url": {
			const url = request.url;
			const launchUrl = request.launchUrl;
			const instructions = request.instructions;
			if (!nonEmptyString(url)) return undefined;
			if (launchUrl !== undefined && typeof launchUrl !== "string") return undefined;
			if (instructions !== undefined && typeof instructions !== "string") return undefined;
			return {
				id,
				method,
				url,
				...(typeof launchUrl === "string" ? { launchUrl } : {}),
				...(typeof instructions === "string" ? { instructions } : {}),
			};
		}
		default:
			return undefined;
	}
}

function eventKey(event: CediaEvent, fallbackFrame: RawFrame): string {
	if ("sessionId" in event && typeof event.sequence === "number") return `${event.sessionId}:${event.incarnation}:${event.sequence}`;
	const explicit = firstString(fallbackFrame, "eventId", "event_id");
	return explicit ? `frame:${explicit}` : "";
}

/** Apply one OMP stream frame, retaining unknown frames in a generic row. */
export function applyFrame(state: TaskState, frameValue: Json, sequence?: number, context?: FrameContext): TaskState {
	if (
		state.session &&
		((context?.sessionId !== undefined && state.session.id !== context.sessionId) ||
			(context?.incarnation !== undefined && state.session.incarnation !== context.incarnation))
	) return state;
	const frame = cloneFrame(frameValue);
	const type = frameType(frame);
	// A terminal panel's transport never becomes a transcript row. Returning the
	// state unchanged also leaves the seen-key bookkeeping alone: the frame was
	// not consumed by the transcript, so there is nothing to remember about it.
	if (isTerminalTransportFrame(type)) return state;
	const key = sequence === undefined
		? eventKey({ frame: frameValue }, frame)
		: context?.sessionId || context?.incarnation ? `${context.sessionId ?? "session"}:${context.incarnation ?? "incarnation"}:${sequence}` : `sequence:${sequence}`;
	if (key && state.seenEventKeys.includes(key)) return state;
	const seen = key ? [...state.seenEventKeys, key].slice(-10_000) : state.seenEventKeys;
	let next: TaskState = { ...state, seenEventKeys: seen };
	if (type === "response" && frame.command === "get_messages" && frame.success === true && isRecord(frame.data) && Array.isArray(frame.data.messages)) {
		// A fork's inherited history comes from OMP's session manager, not from
		// renderer-provided imported messages. Reuse the normal message reducer.
		//
		// Each historical message needs its own start/end pair. A bare `message_end`
		// per message looks equivalent and is not: `messageLifecycleId` reuses the
		// previous id for a role once a stream is open (`messageStreams[incarnation:role]`),
		// so every user row after the first overwrote the first, and a rebuild of a
		// four-message transcript kept only the last turn. That silently truncated the
		// history a rewind is supposed to preserve - measured 2026-09-23 with
		// `applyFrame(createInitialTaskState(), {command: "get_messages", messages: [4]})`
		// returning two entries.
		for (const [index, message] of frame.data.messages.entries()) {
			if (!isRecord(message) || typeof message.role !== "string") continue;
			const identity = typeof message.id === "string" ? message.id : `${key || "snapshot"}:history:${index}`;
			// Distinct `eventId`s per frame, shared `id`: `applyFrame` treats a repeated
			// eventId as already-applied, so a bare `{...start, type: "message_end"}` is
			// skipped and every row stays `streaming`.
			next = applyFrame(next, { type: "message_start", eventId: `${identity}:start`, id: identity, message: message as Json }, undefined, context);
			next = applyFrame(next, { type: "message_end", eventId: `${identity}:end`, id: identity, message: message as Json }, undefined, context);
		}
		return next;
	}
	if (type === "cedia_ui" && isRecord(frame.event)) {
		const parsed = uiRequestFromEnvelope(frame.event);
		if (parsed.ok && !next.uiRequests.some(request => request.token === parsed.request.token)) {
			next = { ...next, uiRequests: [...next.uiRequests, parsed.request] };
		} else if (!parsed.ok && parsed.reason === "unknown-method") {
			next = stateStatingUnknownUiMethod(next, parsed.method);
		}
		const presentation = presentationFromEnvelope(frame.event);
		if (presentation) {
			const presentations = [...next.presentations.filter(item => item.id !== presentation.id), presentation].slice(-20);
			next = { ...next, presentations };
		}
		if (frame.event.kind === "server-cancel" || frame.event.kind === "timeout") {
			const token = typeof frame.event.token === "string" ? frame.event.token : undefined;
			if (token) next = { ...next, uiRequests: next.uiRequests.filter(request => request.token !== token) };
		}
		return next;
	}
	if (type === "available_commands_update") {
		return { ...next, slashCommands: normalizeSlashCommands(frame) };
	}
	if (type === "message_start" || type === "message_update" || type === "message_end") {
		const mode = type === "message_start" ? "start" : type === "message_update" ? "update" : "end";
		const role = messageRole(frame);
		if (role === "toolResult") {
			const message = messageRecord(frame)!;
			const toolCallId = toolCallIdFromFrame(frame) ?? frameIdentity(message, `tool:${sequence ?? next.transcript.length}`);
			const projected: RawFrame = {
				type,
				toolCallId,
				toolName: stringValue(message.toolName) ?? "tool",
				result: { content: message.content, isError: message.isError === true },
				isError: message.isError === true,
			};
			return addOrUpdateTool(next, toolCallId, projected, mode, frame);
		}
		const identity = messageLifecycleId(next, frame, sequence, context, mode);
		return { ...addOrUpdateMessage({ ...next, messageStreams: identity.streams }, identity.id, frame, mode), messageStreams: identity.streams };
	}
	if (type === "tool_execution_start" || type === "tool_execution_update" || type === "tool_execution_end") {
		const id = toolCallIdFromFrame(frame) ?? frameIdentity(frame, `tool:${sequence ?? next.transcript.length}`);
		return addOrUpdateTool(next, id, frame, type === "tool_execution_start" ? "start" : type === "tool_execution_update" ? "update" : "end");
	}
	const id = frameIdentity(frame, `event:${sequence ?? next.transcript.length}`);
	const entry: TranscriptEntry = {
		id,
		kind: "event",
		role: "system",
		text: textFromFrame(frame) || type,
		status: frame.error ? "failed" : "completed",
		rawFrames: [frame],
	};
	return { ...next, transcript: [...next.transcript, entry] };
}

export function applyEvent(state: TaskState, event: CediaEvent): TaskState {
	if ("sessionId" in event && state.session && (state.session.id !== event.sessionId || state.session.incarnation !== event.incarnation)) return state;
	const frame = event.frame;
	const sequence = "sequence" in event && typeof event.sequence === "number" ? event.sequence : undefined;
	const context = "sessionId" in event ? { sessionId: event.sessionId, incarnation: event.incarnation } : undefined;
	const next = applyFrame(state, frame, sequence, context);
	return sequence === undefined ? next : { ...next, cursor: Math.max(next.cursor, sequence) };
}

export function applyEventPage(state: TaskState, page: EventPage): TaskState {
	let next = state;
	for (const event of page.events) next = applyEvent(next, event);
	return { ...next, cursor: Math.max(next.cursor, page.cursor), hasMoreEvents: page.hasMore };
}

function pendingStatus(status: Command["status"]): PendingCommand["status"] {
	switch (status) {
		case "claimed":
		case "acknowledged": return "sent";
		case "completed": return "completed";
		case "failed": return "failed";
		case "not_dispatched": return "not_dispatched";
		case "outcome_unknown": return "unknown";
	}
}

function commandToPending(command: Command, prior?: PendingCommand): PendingCommand {
	return {
		commandId: command.commandId,
		incarnation: command.incarnation,
		command: command.kind,
		payload: isRecord(command.payload) ? command.payload as Record<string, Json> : undefined,
		status: pendingStatus(command.status),
		replayable: false,
		error: command.error,
		createdAt: prior?.createdAt ?? Date.now(),
		updatedAt: Date.now(),
	};
}

export function reduceTaskState(state: TaskState, action: TaskAction): TaskState {
	switch (action.type) {
		case "reset": {
			const outgoing = draftViewKey(state.project?.id, state.session?.id);
			const incoming = draftViewKey(action.project?.id, action.session?.id);
			const drafts = { ...state.drafts, [outgoing]: state.draft };
			return createInitialTaskState({
				session: action.session ?? null,
				project: action.project ?? null,
				connection: state.connection === "running" ? "connected" : state.connection,
				// Navigation resets the transcript projection but keeps the sidebar
				// cache, drafts, and command journal so reconnect never forgets IDs.
				projects: state.projects,
				sessions: state.sessions,
				pendingCommands: state.pendingCommands,
				models: state.models,
				loginProviders: state.loginProviders,
				workbenchMode: state.workbenchMode,
				drafts,
				draft: drafts[incoming] ?? "",
				transcriptScrolls: state.transcriptScrolls,
				followLatest: !(incoming in state.transcriptScrolls),
				workPanel: reduceWorkPanel(state.workPanel, { type: "switch_task", taskKey: incoming }),
			});
		}
		case "connection": {
			const pending = { ...state.pendingCommands };
			if (action.markUnknown || action.status === "offline" || action.status === "unknown") {
				for (const [id, command] of Object.entries(pending)) {
					if (command.status === "queued" || command.status === "sent") pending[id] = { ...command, status: "unknown", updatedAt: Date.now(), error: action.error ?? "connection lost; outcome must be checked" };
				}
			}
			return { ...state, connection: action.status, lastError: action.error ?? (["connected", "running"].includes(action.status) ? undefined : state.lastError), pendingCommands: pending };
		}
		case "projects": return { ...state, projects: [...action.projects] };
		case "sessions": return { ...state, sessions: [...action.sessions] };
		case "session": return { ...state, session: action.session, connection: !action.session && state.connection === "running" ? "connected" : state.connection, cursor: action.session?.id === state.session?.id ? state.cursor : 0 };
		case "events": return applyEventPage(state, action.page);
		case "event": return applyEvent(state, action.event);
		case "frame": return applyFrame(state, action.frame, action.sequence, { sessionId: action.sessionId, incarnation: action.incarnation });
		case "draft": {
			const key = draftViewKey(state.project?.id, state.session?.id);
			return { ...state, draft: action.draft, drafts: { ...state.drafts, [key]: action.draft } };
		}
		case "workbench_mode": return { ...state, workbenchMode: action.mode };
		case "work_panel": return { ...state, workPanel: reduceWorkPanel(state.workPanel, action.action) };
		case "transcript_scroll":
			return {
				...state,
				followLatest: action.followLatest,
				transcriptScrolls: { ...state.transcriptScrolls, [action.key]: { offset: action.offset, ...(action.eventId ? { eventId: action.eventId } : {}) } },
			};
		case "command_created": {
			const now = Date.now();
			const existing = state.pendingCommands[action.command.commandId];
			if (existing) return state;
			return { ...state, pendingCommands: { ...state.pendingCommands, [action.command.commandId]: { ...action.command, status: "queued", replayable: false, createdAt: now, updatedAt: now } } };
		}
		case "command_result": {
			const prior = state.pendingCommands[action.command.commandId];
			return { ...state, pendingCommands: { ...state.pendingCommands, [action.command.commandId]: commandToPending(action.command, prior) } };
		}
		case "command_status": {
			const prior = state.pendingCommands[action.commandId];
			if (!prior) return state;
			return { ...state, pendingCommands: { ...state.pendingCommands, [action.commandId]: { ...prior, status: action.status, ...(action.error === undefined ? {} : { error: action.error }), updatedAt: Date.now() } } };
		}
		case "ui_request": {
			const parsed = uiRequestFromEnvelope(action.event);
			if (!parsed.ok) return parsed.reason === "unknown-method" ? stateStatingUnknownUiMethod(state, parsed.method) : state;
			if (state.uiRequests.some(item => item.token === parsed.request.token)) return state;
			return {
				...state,
				uiRequests: [...state.uiRequests, {
					...parsed.request,
					sessionId: state.session?.id,
					incarnation: state.session?.incarnation,
				}],
			};
		}
		case "ui_sync": {
			const requests = action.requests.filter((request, index, all) => all.findIndex(item => item.token === request.token) === index);
			return { ...state, uiRequests: [...requests] };
		}
		case "ui_resolved": return { ...state, uiRequests: state.uiRequests.filter(item => item.token !== action.token) };
		case "models": return { ...state, models: [...action.models], ...(action.selectedModel === undefined ? {} : { selectedModel: action.selectedModel }) };
		case "login_providers": return { ...state, loginProviders: [...action.providers] };
		case "slash_commands": return { ...state, slashCommands: [...action.commands] };
		case "history_page": {
			const seen = new Set(state.transcript.map(entry => entry.id));
			const prepend = action.entries.filter(entry => entry.id && !seen.has(entry.id));
			return prepend.length ? { ...state, transcript: [...prepend, ...state.transcript] } : state;
		}
	}
	return state;
}
