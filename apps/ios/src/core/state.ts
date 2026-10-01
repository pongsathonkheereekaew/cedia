import type { Command, EventPage, Json, Project, Session, SessionEvent } from "../../../../packages/protocol/src/index.ts";
import { isUiInteractiveMethod, parseUiSelectOptionDetails, unsupportedUiMethodMessage } from "../../../../packages/protocol/src/ui.ts";
import {
  type CediaUiRequest,
  type MobileAction,
  type MobileEvent,
  type MobileTaskState,
  type ModelOption,
  type PendingCommand,
  type PendingUiRequest,
  type TranscriptEntry,
  type TranscriptRole,
  type ToolStatus,
  type UiPresentation,
  type UiRequestParseResult,
  isRecord,
  isSafeExternalUrl,
  nonEmptyString,
} from "./types.ts";
import { applyVirtualTerminalFrame, isCediaVirtualTerminalFrame } from "./virtual-terminal.ts";

const MAX_SEEN_EVENT_KEYS = 4_000;

export function createInitialMobileState(overrides: Partial<MobileTaskState> = {}): MobileTaskState {
  return {
    connection: "offline",
    project: null,
    projects: [],
    sessions: [],
    owners: [],
    ownersTruncated: false,
    session: null,
    transcript: [],
    virtualTerminals: [],
    events: [],
    cursor: 0,
    hasMoreEvents: false,
    uiRequests: [],
    pendingCommands: {},
    activeToolIds: [],
    models: [],
    loginProviders: [],
    presentations: [],
    draft: "",
    searchQuery: "",
    showArchived: false,
    seenEventKeys: [],
    attentionCount: 0,
    ...overrides,
  };
}

function asFrame(value: Json): Record<string, unknown> {
  return isRecord(value) ? value : { type: "unknown", value };
}

function frameType(frame: Record<string, unknown>): string {
  const candidate = frame.type ?? frame.event ?? frame.kind;
  return typeof candidate === "string" ? candidate.toLowerCase() : "unknown";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function firstString(frame: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = frame[key];
    if (nonEmptyString(value)) return value;
  }
  return undefined;
}

function nestedString(frame: Record<string, unknown>, key: string, nestedKey: string): string | undefined {
  const nested = frame[key];
  return isRecord(nested) ? stringValue(nested[nestedKey]) : undefined;
}

function frameIdentity(frame: Record<string, unknown>, fallback: string): string {
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
  ) ?? nestedString(frame, "message", "id") ?? nestedString(frame, "tool", "id") ?? fallback;
}

function messageIdentity(state: MobileTaskState, frame: Record<string, unknown>, type: string, fallback: string): string {
  const nested = isRecord(frame.message) ? frame.message : undefined;
  const explicit = frameIdentity(frame, "");
  if (explicit) return explicit;
  if (type === "message_update" && state.activeMessageId) return state.activeMessageId;
  const timestamp = nested?.timestamp;
  const role = nested?.role ?? frame.role ?? "assistant";
  if (typeof timestamp === "number" || typeof timestamp === "string") return `message:${String(role)}:${String(timestamp)}`;
  return fallback;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(item => {
    if (typeof item === "string") return [item];
    if (isRecord(item)) {
      if (typeof item.text === "string") return [item.text];
      if (typeof item.content === "string") return [item.content];
    }
    return [];
  }).join("");
}

function frameText(frame: Record<string, unknown>): string {
  const nestedMessage = isRecord(frame.message) ? frame.message : undefined;
  const nestedEvent = isRecord(frame.assistantMessageEvent) ? frame.assistantMessageEvent : undefined;
  if (nestedMessage) {
    const nested = contentText(nestedMessage.content);
    if (nested) return nested;
    if (typeof nestedMessage.text === "string") return nestedMessage.text;
  }
  if (nestedEvent) {
    if (typeof nestedEvent.delta === "string") return nestedEvent.delta;
    const partial = isRecord(nestedEvent.partial) ? contentText(nestedEvent.partial.content) : "";
    if (partial) return partial;
    if (typeof nestedEvent.content === "string") return nestedEvent.content;
  }
  for (const key of ["text", "delta", "content", "output", "message", "body", "result", "partialResult"]) {
    const value = frame[key];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      const text = value.filter((item): item is string => typeof item === "string").join("");
      if (text) return text;
    }
    if (isRecord(value)) {
      if (typeof value.text === "string") return value.text;
      const nested = contentText(value.content);
      if (nested) return nested;
    }
  }
  return "";
}

function frameArgs(frame: Record<string, unknown>): unknown {
  const nested = isRecord(frame.message) ? frame.message : undefined;
  return frame.arguments ?? frame.args ?? frame.input ?? frame.parameters ?? nested?.arguments;
}

function roleForFrame(frame: Record<string, unknown>): TranscriptRole {
  const nestedRole = isRecord(frame.message) ? frame.message.role : undefined;
  const role = nestedRole ?? frame.role;
  if (role === "user" || role === "tool" || role === "toolResult") return role === "toolResult" ? "tool" : role;
  if (role === "system" || role === "developer") return "system";
  return "assistant";
}

function hasAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some(candidate => value === candidate || value.includes(candidate));
}

function isToolFrame(type: string, frame: Record<string, unknown>): boolean {
  const nestedMessage = isRecord(frame.message) ? frame.message : undefined;
  return hasAny(type, ["tool", "function_call", "function_result", "host_tool"])
    || frame.tool !== undefined
    || frame.toolName !== undefined
    || frame.tool_name !== undefined
    || frame.toolCallId !== undefined
    || frame.tool_call_id !== undefined
    || nestedMessage?.role === "toolResult";
}

function isStartFrame(type: string): boolean {
  return hasAny(type, ["start", "begin", "created", "call"]);
}

function isEndFrame(type: string, frame: Record<string, unknown>): boolean {
  return hasAny(type, ["end", "complete", "completed", "result", "finish", "finished", "error"])
    || frame.isTerminal === true
    || frame.isError === true
    || (isRecord(frame.result) && frame.result.isError === true)
    || (isRecord(frame.partialResult) && frame.partialResult.isError === true);
}

function isDeltaFrame(type: string): boolean {
  return hasAny(type, ["delta", "update", "stream", "chunk"]);
}

function toolStatus(type: string, frame: Record<string, unknown>): ToolStatus {
  if (frame.cancelled === true || type.includes("cancel")) return "cancelled";
  if (frame.error || frame.status === "failed" || frame.isError === true || type.includes("error") || (isRecord(frame.result) && frame.result.isError === true) || (isRecord(frame.partialResult) && frame.partialResult.isError === true)) return "failed";
  if (isEndFrame(type, frame)) return "completed";
  return "running";
}

function cloneFrame(frame: Json): Record<string, unknown> {
  return asFrame(frame);
}

function appendFrame(entry: TranscriptEntry, frame: Record<string, unknown>): TranscriptEntry {
  return { ...entry, rawFrames: [...entry.rawFrames, frame] };
}

function replaceEntry(entries: readonly TranscriptEntry[], id: string, update: (entry: TranscriptEntry) => TranscriptEntry): readonly TranscriptEntry[] {
  const index = entries.findIndex(entry => entry.id === id);
  if (index < 0) return entries;
  const next = entries.slice();
  next[index] = update(entries[index]!);
  return next;
}

function addMessage(state: MobileTaskState, id: string, frame: Record<string, unknown>, type: string): MobileTaskState {
  const existing = state.transcript.find(entry => entry.id === id && entry.kind === "message");
  const start = isStartFrame(type);
  const end = isEndFrame(type, frame);
  const delta = frameText(frame);
  const nestedMessage = isRecord(frame.message) ? frame.message : undefined;
  const fullMessage = nestedMessage && nestedMessage.content !== undefined ? contentText(nestedMessage.content) : undefined;
  if (!existing) {
    const status = end ? (frame.error ? "failed" : "completed") : "streaming";
    const entry: TranscriptEntry = {
      id,
      kind: "message",
      role: roleForFrame(frame),
      text: delta,
      status,
      createdAt: stringValue(frame.timestamp) ?? stringValue(frame.createdAt),
      rawFrames: [frame],
    };
    return { ...state, transcript: [...state.transcript, entry], activeMessageId: end ? undefined : id };
  }
  const shouldAppend = !start || existing.text.length === 0;
  const status = end ? (frame.error ? "failed" : "completed") : existing.status;
  return {
    ...state,
    transcript: replaceEntry(state.transcript, id, current => ({
      ...appendFrame(current, frame),
      text: (type === "message_update" || type === "message_end") && fullMessage ? fullMessage : shouldAppend ? `${current.text}${delta}` : current.text,
      status,
    })),
    activeMessageId: end ? undefined : id,
  };
}

function addTool(state: MobileTaskState, id: string, frame: Record<string, unknown>, type: string): MobileTaskState {
  const existing = state.transcript.find(entry => entry.id === id && entry.kind === "tool");
  const status = toolStatus(type, frame);
  const output = frameText(frame);
  const nested = isRecord(frame.message) ? frame.message : undefined;
  const name = firstString(frame, "toolName", "tool_name", "name") ?? (nested ? firstString(nested, "toolName", "tool_name", "name") : undefined) ?? existing?.toolName ?? "tool";
  if (!existing) {
    const entry: TranscriptEntry = {
      id,
      kind: "tool",
      role: "tool",
      text: output,
      status: status === "running" ? "streaming" : status === "failed" ? "failed" : "completed",
      toolName: name,
      toolStatus: status,
      args: frameArgs(frame) ?? (nested ? frameArgs(nested) : undefined),
      output,
      rawFrames: [frame],
    };
    return {
      ...state,
      transcript: [...state.transcript, entry],
      activeToolIds: status === "running" ? [...state.activeToolIds, id] : state.activeToolIds,
    };
  }
  const activeToolIds = status === "running" ? state.activeToolIds : state.activeToolIds.filter(item => item !== id);
  return {
    ...state,
    transcript: replaceEntry(state.transcript, id, current => ({
      ...appendFrame(current, frame),
      text: output ? `${current.text}${current.text ? "\n" : ""}${output}` : current.text,
      output: output ? `${current.output ?? ""}${current.output ? "\n" : ""}${output}` : current.output,
      status: status === "running" ? "streaming" : status === "failed" ? "failed" : "completed",
      toolName: name,
      toolStatus: status,
      args: current.args ?? frameArgs(frame) ?? (nested ? frameArgs(nested) : undefined),
    })),
    activeToolIds,
  };
}

function addGenericEvent(state: MobileTaskState, id: string, frame: Record<string, unknown>): MobileTaskState {
  const existing = state.transcript.find(entry => entry.id === id && entry.kind === "event");
  if (existing) {
    return { ...state, transcript: replaceEntry(state.transcript, id, current => appendFrame(current, frame)) };
  }
  const entry: TranscriptEntry = {
    id,
    kind: "event",
    role: "system",
    text: frameText(frame) || frameType(frame),
    status: "completed",
    rawFrames: [frame],
  };
  return { ...state, transcript: [...state.transcript, entry] };
}

function eventKey(event: MobileEvent, frame: Record<string, unknown>): string {
  if ("sessionId" in event && typeof event.sequence === "number") {
    return `${event.sessionId}:${event.incarnation}:${event.sequence}`;
  }
  return `frame:${firstString(frame, "eventId", "event_id", "id") ?? JSON.stringify(frame)}`;
}

/**
 * Parse one pending-UI envelope.  The method decides first, against the shared
 * protocol union: a request the wire cannot carry is refused by name, so the
 * phone can state it instead of dropping a request the Mac renders.
 */
export function parsePendingUiRequest(value: unknown): UiRequestParseResult {
  if (!isRecord(value) || value.kind !== "interactive" || !nonEmptyString(value.token) || !isRecord(value.request)) {
    return { ok: false, reason: "not-interactive" };
  }
  const request = value.request;
  const method = request.method;
  if (typeof method !== "string") return { ok: false, reason: "malformed" };
  if (!isUiInteractiveMethod(method)) return { ok: false, reason: "unknown-method", method };
  if (!nonEmptyString(request.id) || !nonEmptyString(request.title)) return { ok: false, reason: "malformed" };
  const timeoutValue = request.timeout;
  const timeout = typeof timeoutValue === "number" ? timeoutValue : undefined;
  if (timeoutValue !== undefined && (typeof timeoutValue !== "number" || !Number.isSafeInteger(timeoutValue) || timeoutValue < 0)) {
    return { ok: false, reason: "malformed" };
  }
  let normalized: CediaUiRequest | undefined;
  if (method === "confirm" && typeof request.message === "string") {
    normalized = { method, id: request.id, title: request.title, message: request.message, ...(timeout === undefined ? {} : { timeout }) };
  } else if (method === "select" && Array.isArray(request.options) && request.options.length > 0 && request.options.every(nonEmptyString)) {
    const optionDetails = parseUiSelectOptionDetails(request.optionDetails, request.options.length);
    if (request.optionDetails !== undefined && optionDetails === undefined) return { ok: false, reason: "malformed" };
    normalized = {
      method,
      id: request.id,
      title: request.title,
      options: [...request.options],
      ...(optionDetails === undefined ? {} : { optionDetails }),
      ...(timeout === undefined ? {} : { timeout }),
    };
  } else if (method === "input" && (request.placeholder === undefined || typeof request.placeholder === "string")) {
    normalized = { method, id: request.id, title: request.title, ...(typeof request.placeholder === "string" ? { placeholder: request.placeholder } : {}), ...(timeout === undefined ? {} : { timeout }) };
  } else if (method === "editor" && (request.prefill === undefined || typeof request.prefill === "string") && (request.promptStyle === undefined || typeof request.promptStyle === "boolean")) {
    normalized = { method, id: request.id, title: request.title, ...(typeof request.prefill === "string" ? { prefill: request.prefill } : {}), ...(typeof request.promptStyle === "boolean" ? { promptStyle: request.promptStyle } : {}) };
  }
  if (!normalized) return { ok: false, reason: "malformed" };
  return {
    ok: true,
    request: {
      kind: "interactive",
      token: value.token,
      request: normalized,
      ...(typeof value.sessionId === "string" && value.sessionId.trim() ? { sessionId: value.sessionId.trim() } : {}),
      ...(typeof value.incarnation === "string" && value.incarnation.trim() ? { incarnation: value.incarnation.trim() } : {}),
      ...(typeof request.cwd === "string" && request.cwd.trim() ? { cwd: request.cwd.trim() } : {}),
      ...(typeof request.tool === "string" && request.tool.trim() ? { tool: request.tool.trim() } : {}),
      ...(typeof request.target === "string" && request.target.trim() ? { target: request.target.trim() } : {}),
      ...(value.status === "stale" || value.status === "timeout" || value.status === "responded_elsewhere" ? { status: value.status } : {}),
      ...(typeof value.receivedAt === "number" && Number.isFinite(value.receivedAt) ? { receivedAt: value.receivedAt } : {}),
    },
  };
}

/**
 * State one request whose method OMP cannot send.  The phone keeps the reason
 * on the one error line it renders; silently dropping the request is what let a
 * request the Mac showed vanish here.
 */
function stateStatingUnknownUiMethod(state: MobileTaskState, method: string): MobileTaskState {
  const lastError = unsupportedUiMethodMessage(method);
  return state.lastError === lastError ? state : { ...state, lastError };
}

/**
 * A `cedia_ui` frame carries either a presentation or an interactive envelope,
 * and only an interactive one becomes a pending request.  A refusal that names
 * an unknown method is handed back so the caller can state it.
 */
function interactiveFromFrame(frame: Record<string, unknown>): UiRequestParseResult | undefined {
  if (frameType(frame) !== "cedia_ui") return undefined;
  const fromEvent = parsePendingUiRequest(frame.event);
  if (fromEvent.ok || fromEvent.reason === "unknown-method") return fromEvent;
  const fromFrame = parsePendingUiRequest(frame);
  return fromFrame.ok || fromFrame.reason === "unknown-method" ? fromFrame : fromEvent;
}

function presentationFromEnvelope(value: unknown): UiPresentation | undefined {
  if (!isRecord(value) || value.kind !== "presentation" || !isRecord(value.request)) return undefined;
  const request = value.request;
  if (!nonEmptyString(request.id) || !nonEmptyString(request.method)) return undefined;
  const url = typeof request.url === "string" && isSafeExternalUrl(request.url) ? request.url : undefined;
  const launchUrl = typeof request.launchUrl === "string" && isSafeExternalUrl(request.launchUrl) ? request.launchUrl : undefined;
  return {
    id: request.id,
    method: request.method,
    ...(typeof request.message === "string" ? { message: request.message } : {}),
    ...(url ? { url } : {}),
    ...(launchUrl ? { launchUrl } : {}),
    ...(typeof request.instructions === "string" ? { instructions: request.instructions } : {}),
    ...(typeof request.title === "string" ? { title: request.title } : {}),
  };
}

function presentationFromFrame(frame: Record<string, unknown>): UiPresentation | undefined {
  if (frameType(frame) !== "cedia_ui") return undefined;
  return presentationFromEnvelope(frame.event) ?? presentationFromEnvelope(frame);
}

function applyFrame(state: MobileTaskState, frameValue: Json, key: string): MobileTaskState {
  const frame = cloneFrame(frameValue);
  const type = frameType(frame);
  if (isCediaVirtualTerminalFrame(frame)) {
    return { ...state, virtualTerminals: applyVirtualTerminalFrame(state.virtualTerminals, frame) };
  }
  const presentation = presentationFromFrame(frame);
  const ui = interactiveFromFrame(frame);
  if (presentation || ui) {
    let next = state;
    if (presentation) {
      next = { ...next, presentations: [...next.presentations.filter(item => item.id !== presentation.id), presentation].slice(-20) };
    }
    if (ui?.ok) {
      const request = ui.request;
      if (!next.uiRequests.some(item => item.token === request.token)) {
        next = { ...next, uiRequests: [...next.uiRequests, { ...request, receivedAt: request.receivedAt ?? Date.now() }], attentionCount: next.attentionCount + 1 };
      }
    } else if (ui && ui.reason === "unknown-method") {
      next = stateStatingUnknownUiMethod(next, ui.method);
    }
    return next;
  }
  if (isToolFrame(type, frame)) {
    return addTool(state, frameIdentity(frame, key), frame, type);
  }
  if (hasAny(type, ["message", "assistant", "user", "text", "response", "content"])) {
    return addMessage(state, messageIdentity(state, frame, type, key), frame, type);
  }
  return addGenericEvent(state, frameIdentity(frame, key), frame);
}

function eventBelongsToSession(state: MobileTaskState, event: SessionEvent): boolean {
  if (!state.session) return true;
  return event.sessionId === state.session.id && event.incarnation === state.session.incarnation;
}

function applyOneEvent(state: MobileTaskState, event: MobileEvent): MobileTaskState {
  const frame = asFrame(event.frame);
  const sessionId = "sessionId" in event ? event.sessionId : undefined;
  const incarnation = "incarnation" in event ? event.incarnation : undefined;
  if (sessionId && state.session && sessionId !== state.session.id) return state;
  if (incarnation && state.session && incarnation !== state.session.incarnation) return state;
  const key = eventKey(event, frame);
  if (state.seenEventKeys.includes(key)) return state;
  const sequence = "sequence" in event && typeof event.sequence === "number" ? event.sequence : undefined;
  if (sequence !== undefined && sequence <= state.cursor) return state;
  const next = applyFrame(state, event.frame, key);
  const seen = [...state.seenEventKeys, key];
  const rawEvent: SessionEvent | undefined = "sessionId" in event && typeof event.sessionId === "string" && typeof event.incarnation === "string" && typeof event.sequence === "number" && typeof event.timestamp === "string"
    ? { sessionId: event.sessionId, incarnation: event.incarnation, sequence: event.sequence, timestamp: event.timestamp, frame: event.frame }
    : undefined;
  return {
    ...next,
    events: rawEvent ? [...next.events, rawEvent] : next.events,
    cursor: sequence === undefined ? next.cursor : Math.max(next.cursor, sequence),
    seenEventKeys: seen.length > MAX_SEEN_EVENT_KEYS ? seen.slice(-MAX_SEEN_EVENT_KEYS) : seen,
  };
}

function updateCommand(state: MobileTaskState, command: PendingCommand): MobileTaskState {
  return { ...state, pendingCommands: { ...state.pendingCommands, [command.commandId]: command } };
}

function projectById(projects: readonly Project[], id: string | undefined): Project | null {
  return id ? projects.find(project => project.id === id) ?? null : null;
}

function commandStatus(status: Command["status"]): PendingCommand["status"] {
  switch (status) {
    case "claimed":
    case "acknowledged": return "sent";
    case "completed": return "completed";
    case "failed": return "failed";
    case "outcome_unknown": return "unknown";
    case "not_dispatched": return "not_dispatched";
  }
}

export function reduceMobileState(state: MobileTaskState, action: MobileAction): MobileTaskState {
  switch (action.type) {
    case "reset":
      return createInitialMobileState({ session: action.session ?? null, project: action.project ?? null });
    case "connection":
      return { ...state, connection: action.status, ...(action.error ? { lastError: action.error } : { lastError: undefined }) };
    case "projects": {
      const current = state.project;
      return { ...state, projects: action.projects, project: current ? projectById(action.projects, current.id) : action.projects[0] ?? null };
    }
    case "project":
      return { ...state, project: action.project, session: null, draft: "", transcript: [], virtualTerminals: [], events: [], cursor: 0, hasMoreEvents: false, uiRequests: [], presentations: [], loginProviders: [], seenEventKeys: [], activeToolIds: [], attentionCount: 0 };
    case "sessions":
      return { ...state, sessions: action.sessions };
    case "owners":
      return { ...state, owners: action.owners, ownersTruncated: action.truncated };
    case "session": {
      const sessionChanged = action.session?.id !== state.session?.id;
      return { ...state, session: action.session, draft: sessionChanged ? "" : state.draft, transcript: [], virtualTerminals: [], events: [], cursor: 0, hasMoreEvents: false, uiRequests: [], presentations: [], loginProviders: [], seenEventKeys: [], activeToolIds: [], attentionCount: 0 };
    }
    case "session_refresh": {
      // `session` switches tasks, so it clears the mounted conversation. A refresh is the
      // same task with a new incarnation/status/title: keep transcript, events, cursor,
      // pending UI, presentations and the draft, and only re-read the record.
      const refreshed = action.session;
      return { ...state, session: refreshed, sessions: state.sessions.map(item => item.id === refreshed.id ? refreshed : item) };
    }
    case "events": {
      const expectedSession = state.session;
      if (expectedSession) {
        const hasSessionId = action.sessionId !== undefined;
        const hasIncarnation = action.incarnation !== undefined;
        const identityMatches = (!hasSessionId || action.sessionId === expectedSession.id)
          && (!hasIncarnation || action.incarnation === expectedSession.incarnation);
        const allEventsMatch = action.page.events.every(event => eventBelongsToSession(state, event));
        // A page can arrive after the selected task has changed. Reject the
        // whole stale page, including its cursor and hasMore flag. An empty
        // page is accepted only when the caller supplies both identity fields
        // captured before the request, since it carries no event identity.
        if (!identityMatches || !allEventsMatch || (action.page.events.length === 0 && (!hasSessionId || !hasIncarnation))) return state;
      }
      let next: MobileTaskState = { ...state, hasMoreEvents: action.page.hasMore };
      for (const event of action.page.events) next = applyOneEvent(next, event);
      return { ...next, cursor: Math.max(next.cursor, action.page.cursor) };
    }
    case "event":
      return applyOneEvent(state, action.event);
    case "frame":
      return applyOneEvent(state, { frame: action.frame, sequence: action.sequence, sessionId: action.sessionId, incarnation: action.incarnation });
    case "draft":
      return { ...state, draft: action.draft };
    case "search":
      return { ...state, searchQuery: action.query };
    case "show_archived":
      return { ...state, showArchived: action.value };
    case "command_created": {
      const now = Date.now();
      const command: PendingCommand = { ...action.command, status: "queued", replayable: false, createdAt: now, updatedAt: now };
      return updateCommand(state, command);
    }
    case "command_status": {
      const current = state.pendingCommands[action.commandId];
      if (!current) return state;
      return updateCommand(state, { ...current, status: action.status, ...(action.error ? { error: action.error } : {}), updatedAt: Date.now() });
    }
    case "command_result": {
      const current = state.pendingCommands[action.command.commandId];
      if (!current) return state;
      return updateCommand(state, { ...current, status: commandStatus(action.command.status), ...(action.command.error ? { error: action.command.error } : {}), updatedAt: Date.now() });
    }
    case "ui_request": {
      const parsed = parsePendingUiRequest(action.event);
      if (!parsed.ok) return parsed.reason === "unknown-method" ? stateStatingUnknownUiMethod(state, parsed.method) : state;
      if (state.uiRequests.some(item => item.token === parsed.request.token)) return state;
      return { ...state, uiRequests: [...state.uiRequests, { ...parsed.request, receivedAt: parsed.request.receivedAt ?? Date.now() }], attentionCount: state.attentionCount + 1 };
    }
    case "ui_sync": {
      const existing = new Map(state.uiRequests.map(request => [request.token, request]));
      let unknownMethod: string | undefined;
      const requests = action.events.flatMap(event => {
        const parsed = parsePendingUiRequest(event);
        if (!parsed.ok) {
          // The host's live list is the authoritative one, so a request this
          // build cannot render is stated rather than quietly left out.
          if (parsed.reason === "unknown-method") unknownMethod = parsed.method;
          return [];
        }
        const request = parsed.request;
        // Keep the mounted object for a token that is still pending. This lets
        // the native sheet retain its draft/focus while polling GET /ui.
        const mounted = existing.get(request.token);
        if (!mounted) return [request];
        const extras: Partial<PendingUiRequest> = {
          ...(request.sessionId && request.sessionId !== mounted.sessionId ? { sessionId: request.sessionId } : {}),
          ...(request.incarnation && request.incarnation !== mounted.incarnation ? { incarnation: request.incarnation } : {}),
          ...(request.cwd && request.cwd !== mounted.cwd ? { cwd: request.cwd } : {}),
          ...(request.tool && request.tool !== mounted.tool ? { tool: request.tool } : {}),
          ...(request.target && request.target !== mounted.target ? { target: request.target } : {}),
          ...(request.status && request.status !== mounted.status ? { status: request.status } : {}),
        };
        return [Object.keys(extras).length > 0 ? { ...mounted, ...extras } : mounted];
      });
      const next = { ...state, uiRequests: requests, attentionCount: requests.length };
      return unknownMethod === undefined ? next : stateStatingUnknownUiMethod(next, unknownMethod);
    }
    case "ui_resolved":
      return { ...state, uiRequests: state.uiRequests.filter(request => request.token !== action.token), attentionCount: Math.max(0, state.attentionCount - 1) };
    case "models":
      return { ...state, models: action.models, ...(action.selectedModel ? { selectedModel: action.selectedModel } : {}) };
    case "login_providers":
      return { ...state, loginProviders: action.providers };
    case "cached_meta":
      return { ...state, cacheSavedAt: action.savedAt, cacheExpiresAt: action.expiresAt };
    case "cache_cleared":
      return { ...state, cacheSavedAt: undefined, cacheExpiresAt: undefined };
  }
}

export function applyMobileEvent(state: MobileTaskState, event: MobileEvent): MobileTaskState {
  return reduceMobileState(state, { type: "event", event });
}

export function applyEventPage(state: MobileTaskState, page: EventPage): MobileTaskState {
  return reduceMobileState(state, {
    type: "events",
    page,
    ...(state.session ? { sessionId: state.session.id, incarnation: state.session.incarnation } : {}),
  });
}

export function visibleProjects(state: MobileTaskState): readonly Project[] {
  const query = state.searchQuery.trim().toLowerCase();
  return state.projects.filter(project => (state.showArchived || !project.archived) && (!query || `${project.name} ${project.path}`.toLowerCase().includes(query)));
}

export function visibleSessions(state: MobileTaskState): readonly Session[] {
  const query = state.searchQuery.trim().toLowerCase();
  return state.sessions.filter(session => (state.showArchived || !session.archived) && (!query || session.title.toLowerCase().includes(query)));
}

export function isCacheFresh(state: Pick<MobileTaskState, "cacheExpiresAt">, now = Date.now()): boolean {
  return typeof state.cacheExpiresAt === "number" && state.cacheExpiresAt > now;
}
