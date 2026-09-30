/**
 * Durable metadata and command/event store for the Cedia host.
 *
 * OMP remains the execution and transcript authority.  This store keeps only
 * Cedia's durable projection: projects, session ownership metadata, command
 * idempotency/ack state, and a journal of frames needed by the host and mobile
 * clients.  That journal is bounded per session by
 * {@link MAX_SESSION_EVENTS} and {@link MAX_SESSION_EVENT_BYTES}; when the caps
 * force the oldest frames out, every reader of the session's events is told so
 * (`historyTruncated`) instead of being handed a shorter history silently.  It
 * deliberately has no provider, process, or network responsibilities.
 */

import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	realpathSync,
	renameSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
	Command,
	CommandStatus,
	DraftAttachment,
	DraftSnapshot,
	DraftSubmission,
	EventPage,
	Json,
	Project,
	Session,
	SessionCleanupState,
	SessionWorkspaceMetadata,
	SessionEvent,
	TurnIntent,
	TurnState,
} from "../../../packages/protocol/src/index.ts";

/** Current on-disk schema. Newer versions are refused rather than guessed. */
export const DURABLE_STORE_SCHEMA_VERSION = 6 as const;
export const DEFAULT_EVENT_PAGE_SIZE = 200 as const;
export const MAX_EVENT_PAGE_SIZE = 1_000 as const;
export const DEFAULT_COMMAND_PAGE_SIZE = 100 as const;
export const MAX_COMMAND_PAGE_SIZE = 10_000 as const;
/** Turn intents are bookkeeping; the view carries a bounded recent window of them. */
export const DEFAULT_TURN_PAGE_SIZE = 20 as const;
export const MAX_TURN_PAGE_SIZE = 1_000 as const;

/**
 * Per-session journal retention.
 *
 * A fork journals its whole inherited transcript as one `get_messages` frame, so
 * a single hydration frame costs a transcript rather than an event. Measured
 * against OMP 18.2.8 on the author's machine: a 141 KB transcript hydrated as an
 * 86 KB frame (41 messages), a 2.31 MB transcript as a 2.16 MB frame (372), and
 * the largest local session (37.9 MB, 686 messages) as a 2.19 MB frame. Across
 * the 305 real OMP session files there, a transcript held 39 entries at the
 * median, 848 at p90, 3,525 at p99, and 19,578 at most.
 *
 * Both caps are set to keep a normal session whole: the count cap sits just
 * above the heaviest transcript observed, and the byte cap works out to ~1.7 KB
 * per event, between the measured mean hydration message (2.1-5.8 KB) and an
 * ordinary wire frame (tens to hundreds of bytes). A session that crosses a cap
 * is a genuinely extreme one - or a fork of one - and it now loses its oldest
 * frames instead of growing the state directory without bound.
 */
export const MAX_SESSION_EVENTS = 20_000 as const;
/** 32 MiB, the byte half of the same bound. */
export const MAX_SESSION_EVENT_BYTES = 33_554_432 as const;

const OWNER_LOCK_FILENAME = "owner-lock.sqlite";
const JOURNAL_FILENAME = "journal.sqlite";
const DEFAULT_SESSION_TITLE = "New task";
const COMMAND_ID_MAX_BYTES = 512;
const DEVICE_ID_MAX_BYTES = 512;
const INCARNATION_MAX_BYTES = 512;
const KIND_MAX_BYTES = 512;
const ERROR_MAX_BYTES = 16_384;
const TURN_INTENT_COLUMNS = "session_id, turn_intent_id, command_id, device_id, incarnation, payload_hash, accepted_sequence, state, queue_position, evidence_sequence, model, thinking_level, reason, created_at, updated_at";
const DRAFT_ID_MAX_BYTES = 512;
const DRAFT_TEXT_MAX_CHARS = 262_144;
const DRAFT_ATTACHMENT_MAX_COUNT = 32;
const DRAFT_ATTACHMENT_ID_MAX_BYTES = 512;
const DRAFT_ATTACHMENT_NAME_MAX_BYTES = 1_024;
const DRAFT_SOURCE_MAX_BYTES = 512;
const DRAFT_SESSION_ID_MAX_BYTES = 512;
/** The renderer's serialized composer draft; the same 2 MiB the bridge accepts. */
const DRAFT_CONTENT_MAX_CHARS = 2 * 1024 * 1024;
/** Columns read for every task row, including the durable workspace/cleanup projection. */
const SESSION_COLUMNS = "id, project_id, title, cwd, session_file, incarnation, status, pinned, archived, created_at, updated_at, workspace_task_id, workspace_project_id, workspace_repository_id, workspace_root, workspace_actual_cwd, workspace_source_commit, workspace_task_branch, integration_target_ref, integration_target_commit, integration_observed_commit, restoration_ref, restoration_sha, cleanup_generation, cleanup_state, cleanup_last_failure";

type Row = Record<string, unknown>;
type StoreStatus = Session["status"];

export interface DurableStoreOptions {
	/** Private directory containing owner-lock.sqlite and journal.sqlite. */
	stateDir: string;
	/** Recover claimed/acknowledged commands and running sessions on startup. */
	recover?: boolean;
}

export interface CreateProjectInput {
	id?: string;
	path: string;
	name?: string;
	pinned?: boolean;
	archived?: boolean;
}

export interface UpdateProjectPatch {
	path?: string;
	name?: string;
	pinned?: boolean;
	archived?: boolean;
}

export interface ListProjectsOptions {
	includeArchived?: boolean;
}

export interface CreateSessionInput {
	id?: string;
	projectId: string;
	title?: string;
	cwd?: string;
	sessionFile?: string;
	incarnation?: string;
	status?: StoreStatus;
	archived?: boolean;
}

export interface UpdateSessionPatch {
	pinned?: boolean;
	title?: string;
	cwd?: string;
	sessionFile?: string;
	incarnation?: string;
	status?: StoreStatus;
	archived?: boolean;
}

/** Durable workspace facts and cleanup state written with the task row. */
export interface SessionWorkspaceMetadataPatch {
	taskId?: string;
	projectId?: string;
	repositoryId?: string | null;
	worktreeRoot?: string | null;
	actualCwd?: string;
	sourceCommit?: string | null;
	taskBranch?: string | null;
	integrationTargetRef?: string | null;
	integrationTargetCommit?: string | null;
	integrationObservedCommit?: string | null;
	restorationRef?: string | null;
	restorationSha?: string | null;
	cleanupGeneration?: number;
	cleanupState?: SessionCleanupState;
	lastFailure?: string | null;
}

export interface ListSessionsOptions {
	includeArchived?: boolean;
}

export interface ClaimCommandInput {
	sessionId: string;
	commandId: string;
	deviceId: string;
	incarnation: string;
	kind: string;
	payload: Json;
}

export interface ClaimCommandResult {
	command: Command;
	created: boolean;
}

export interface BeginTurnIntentInput {
	sessionId: string;
	turnIntentId: string;
	commandId: string;
	deviceId: string;
	incarnation: string;
	payloadHash: string;
}

export interface TurnTransitionFields {
	queuePosition?: number;
	evidenceSequence?: number;
	model?: string;
	thinkingLevel?: string;
	reason?: string;
}

export interface WriteDraftInput {
	deviceId: string;
	draftId: string;
	expectedRevision: number;
	text: string;
	attachments: readonly DraftAttachment[];
	content?: Json;
	sessionId?: string;
	source?: string;
}

export type DraftWriteResult =
	| { outcome: "written"; draft: DraftSnapshot }
	| { outcome: "conflict"; draft?: DraftSnapshot }
	| { outcome: "created"; draft: DraftSnapshot };

export interface ClaimDraftSubmissionInput {
	deviceId: string;
	draftId: string;
	revision: number;
	commandId: string;
	payloadHash: string;
}

export interface ClaimDraftSubmissionResult {
	submission: DraftSubmission;
	created: boolean;
}

export interface ClearDraftInput {
	deviceId: string;
	draftId: string;
	revision: number;
}

export interface ImportDraftEntry {
	draftId: string;
	text: string;
	attachments?: readonly DraftAttachment[];
	content?: Json;
	sessionId?: string;
	source: string;
}

export interface CommandTransitionFields {
	ack?: Json;
	result?: Json;
	error?: string;
}

export interface StorePaths {
	stateDir: string;
	journalPath: string;
	ownerLockPath: string;
}

/**
 * One page of a session's journal, plus the two facts retention owes a reader.
 *
 * Narrows the protocol {@link EventPage}'s optional retention fields to required:
 * this store always bounds a session's journal, so every page it hands out
 * carries them.
 */
export interface SessionEventPage extends EventPage {
	/** Oldest sequence the journal still holds; 0 when the session has no events at all. */
	firstSequence: number;
	/** True when retention dropped the session's oldest events: this page is not the whole history. */
	historyTruncated: boolean;
}

/** Stable, machine-readable errors raised by the durable store. */
export class DurableStoreError extends Error {
	readonly code: string;
	readonly cause?: unknown;

	constructor(code: string, message: string, cause?: unknown) {
		super(message);
		this.name = "DurableStoreError";
		this.code = code;
		this.cause = cause;
	}
}

export class DurableStoreOwnershipError extends DurableStoreError {
	constructor(message = "Another Cedia host already owns this state directory", cause?: unknown) {
		super("store-owned", message, cause);
		this.name = "DurableStoreOwnershipError";
	}
}

export class DurableStoreSchemaError extends DurableStoreError {
	constructor(message: string, cause?: unknown) {
		super("schema", message, cause);
		this.name = "DurableStoreSchemaError";
	}
}

export class DurableStoreProjectNotFoundError extends DurableStoreError {
	constructor(projectId: string) {
		super("project-not-found", `Project not found: ${projectId}`);
		this.name = "DurableStoreProjectNotFoundError";
	}
}

export class DurableStoreSessionNotFoundError extends DurableStoreError {
	constructor(sessionId: string) {
		super("session-not-found", `Session not found: ${sessionId}`);
		this.name = "DurableStoreSessionNotFoundError";
	}
}

export class DurableStoreCommandNotFoundError extends DurableStoreError {
	constructor(sessionId: string, commandId: string) {
		super("command-not-found", `Command not found: ${sessionId}/${commandId}`);
		this.name = "DurableStoreCommandNotFoundError";
	}
}

export class DurableStoreCommandConflictError extends DurableStoreError {
	constructor(sessionId: string, commandId: string) {
		super("command-conflict", `Command id already exists with a different canonical request: ${sessionId}/${commandId}`);
		this.name = "DurableStoreCommandConflictError";
	}
}

export class DurableStoreCommandTransitionError extends DurableStoreError {
	constructor(message: string) {
		super("command-transition", message);
		this.name = "DurableStoreCommandTransitionError";
	}
}

export class DurableStoreTurnNotFoundError extends DurableStoreError {
	constructor(sessionId: string, turnIntentId: string) {
		super("turn-not-found", `Turn intent not found: ${sessionId}/${turnIntentId}`);
		this.name = "DurableStoreTurnNotFoundError";
	}
}

export class DurableStoreDraftConflictError extends DurableStoreError {
	constructor(message: string) {
		super("draft-conflict", message);
		this.name = "DurableStoreDraftConflictError";
	}
}

/**
 * Serialize JSON values deterministically while rejecting values that are not
 * safe to persist. This does not invoke user `toJSON` methods or access
 * getters, and therefore cannot mutate state during hashing.
 */
export function canonicalizeJson(value: unknown): string {
	const active = new WeakSet<object>();

	const encode = (input: unknown, path: string): string => {
		if (input === null) return "null";
		switch (typeof input) {
			case "string":
				return JSON.stringify(input);
			case "boolean":
				return input ? "true" : "false";
			case "number":
				if (!Number.isFinite(input)) throw new TypeError(`JSON value at ${path} must be finite`);
				return JSON.stringify(input);
			case "undefined":
				throw new TypeError(`JSON value at ${path} cannot be undefined`);
			case "bigint":
			case "symbol":
			case "function":
				throw new TypeError(`JSON value at ${path} has unsupported type ${typeof input}`);
		}

		if (typeof input !== "object" || input === null) {
			throw new TypeError(`JSON value at ${path} is not serializable`);
		}
		if (active.has(input)) throw new TypeError(`JSON value at ${path} contains a cycle`);
		active.add(input);
		try {
			if (Array.isArray(input)) {
				if (Object.getPrototypeOf(input) !== Array.prototype) {
					throw new TypeError(`JSON array at ${path} must have the default array prototype`);
				}
				for (const key of Reflect.ownKeys(input)) {
					if (typeof key === "symbol") throw new TypeError(`JSON array at ${path} has a symbol key`);
					if (key !== "length" && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= input.length)) {
						throw new TypeError(`JSON array at ${path} has a non-index property: ${key}`);
					}
				}
				const parts: string[] = [];
				for (let index = 0; index < input.length; index += 1) {
					if (!Object.prototype.hasOwnProperty.call(input, index)) {
						throw new TypeError(`JSON array at ${path} is sparse`);
					}
					const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
					if (!descriptor || !("value" in descriptor)) {
						throw new TypeError(`JSON array at ${path}[${index}] must be a data property`);
					}
					parts.push(encode(descriptor.value, `${path}[${index}]`));
				}
				return `[${parts.join(",")}]`;
			}

			const prototype = Object.getPrototypeOf(input);
			if (prototype !== Object.prototype && prototype !== null) {
				throw new TypeError(`JSON object at ${path} must have a plain or null prototype`);
			}
			const ownKeys = Reflect.ownKeys(input);
			if (ownKeys.some(key => typeof key === "symbol")) {
				throw new TypeError(`JSON object at ${path} has a symbol key`);
			}
			const keys = ownKeys as string[];
			for (const key of keys) {
				const descriptor = Object.getOwnPropertyDescriptor(input, key);
				if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
					throw new TypeError(`JSON object at ${path}.${key} must have an enumerable data property`);
				}
			}
			keys.sort();
			const parts: string[] = [];
			for (const key of keys) {
				const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
				parts.push(`${JSON.stringify(key)}:${encode(descriptor.value, `${path}.${key}`)}`);
			}
			return `{${parts.join(",")}}`;
		} finally {
			active.delete(input);
		}
	};

	return encode(value, "$" );
}

/** Hash of the complete command identity, not only its payload. */
export function commandPayloadHash(input: Pick<ClaimCommandInput, "deviceId" | "incarnation" | "kind" | "payload">): string {
	const canonical = canonicalizeJson({
		deviceId: input.deviceId,
		incarnation: input.incarnation,
		kind: input.kind,
		payload: input.payload,
	});
	return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function nowIso(): string {
	return new Date().toISOString();
}

function requireString(value: unknown, label: string, maxBytes = 4_096): string {
	if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
	if (Buffer.byteLength(value, "utf8") > maxBytes) throw new TypeError(`${label} exceeds ${maxBytes} bytes`);
	return value;
}

function boolToSql(value: boolean): number {
	return value ? 1 : 0;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
	return value;
}

function sqlToBool(value: unknown, label: string): boolean {
	if (value !== 0 && value !== 1) throw new DurableStoreSchemaError(`Invalid boolean in ${label}`);
	return value === 1;
}

function getRowString(row: Row, key: string): string {
	return requireString(row[key], key);
}

function parseJson(value: unknown, label: string): Json {
	if (typeof value !== "string") throw new DurableStoreSchemaError(`Invalid JSON column: ${label}`);
	try {
		const parsed: unknown = JSON.parse(value);
		// Validate again so a manually edited database cannot inject unsafe shapes
		// into callers even if it predates the current canonicalizer.
		canonicalizeJson(parsed);
		return parsed as Json;
	} catch (error) {
		if (error instanceof DurableStoreError) throw error;
		throw new DurableStoreSchemaError(`Invalid JSON column: ${label}`, error);
	}
}

function validateStatus(value: unknown): StoreStatus {
	if (
		value !== "idle" &&
		value !== "running" &&
		value !== "stopped" &&
		value !== "recovery_required"
	) throw new TypeError(`Invalid session status: ${String(value)}`);
	return value;
}

function validateCleanupState(value: unknown): SessionCleanupState {
	if (value !== "retained" && value !== "archive_requested" && value !== "prepared" && value !== "removed") {
		throw new DurableStoreSchemaError(`Invalid cleanup state: ${String(value)}`);
	}
	return value;
}

function validateCommandStatus(value: unknown): CommandStatus {
	if (
		value !== "claimed" &&
		value !== "acknowledged" &&
		value !== "completed" &&
		value !== "failed" &&
		value !== "outcome_unknown" &&
		value !== "not_dispatched"
	) throw new DurableStoreSchemaError(`Invalid command status: ${String(value)}`);
	return value;
}

function validatePage(value: number, label: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new RangeError(`${label} must be an integer between 1 and ${maximum}`);
	}
	return value;
}

function validateTurnState(value: unknown): TurnState {
	if (
		value !== "prepared" &&
		value !== "queued" &&
		value !== "running" &&
		value !== "completed" &&
		value !== "failed" &&
		value !== "cancelled" &&
		value !== "needs_continue" &&
		value !== "outcome_unknown"
	) throw new DurableStoreSchemaError(`Invalid turn state: ${String(value)}`);
	return value;
}

function validateAfter(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("after must be a non-negative safe integer");
	return value;
}

function validateDirectory(path: string, mode: number): string {
	const resolved = resolve(requireString(path, "stateDir"));
	if (existsSync(resolved)) {
		const info = lstatSync(resolved);
		if (!info.isDirectory()) throw new DurableStoreError("state-dir", `State path is not a directory: ${resolved}`);
	} else {
		mkdirSync(resolved, { recursive: true, mode });
	}
	chmodSync(resolved, mode);
	return resolved;
}

function secureDatabasePath(path: string, mode: number): void {
	if (existsSync(path)) {
		const info = lstatSync(path);
		if (info.isSymbolicLink()) throw new DurableStoreError("unsafe-path", `Refusing symlink database path: ${path}`);
		if (!info.isFile()) throw new DurableStoreError("unsafe-path", `Database path is not a file: ${path}`);
	}
	chmodSync(path, mode);
}

function rejectUnsafeExistingDatabasePath(path: string): void {
	if (!existsSync(path)) return;
	const info = lstatSync(path);
	if (info.isSymbolicLink()) throw new DurableStoreError("unsafe-path", `Refusing symlink database path: ${path}`);
	if (!info.isFile()) throw new DurableStoreError("unsafe-path", `Database path is not a file: ${path}`);
}

function projectFromRow(row: Row): Project {
	return {
		id: getRowString(row, "id"),
		path: getRowString(row, "path"),
		name: getRowString(row, "name"),
		pinned: sqlToBool(row.pinned, "projects.pinned"),
		archived: sqlToBool(row.archived, "projects.archived"),
		createdAt: getRowString(row, "created_at"),
	};
}

function sessionFromRow(row: Row): Session {
	const session: Session = {
		id: getRowString(row, "id"),
		projectId: getRowString(row, "project_id"),
		title: getRowString(row, "title"),
		cwd: getRowString(row, "cwd"),
		sessionFile: getRowString(row, "session_file"),
		incarnation: getRowString(row, "incarnation"),
		status: validateStatus(row.status),
		pinned: sqlToBool(row.pinned, "sessions.pinned"),
		archived: sqlToBool(row.archived, "sessions.archived"),
		createdAt: getRowString(row, "created_at"),
		updatedAt: getRowString(row, "updated_at"),
	};
	if (row.workspace_task_id !== null && row.workspace_task_id !== undefined) {
		const generation = row.cleanup_generation;
		if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 0) throw new DurableStoreSchemaError("Invalid sessions.cleanup_generation");
		const state = validateCleanupState(row.cleanup_state ?? "retained");
		const projectId = getRowString(row, "workspace_project_id");
		const actualCwd = getRowString(row, "workspace_actual_cwd");
		const metadata: SessionWorkspaceMetadata = {
			taskId: getRowString(row, "workspace_task_id"),
			projectId,
			actualCwd,
			cleanupGeneration: generation,
			cleanupState: state,
			...(typeof row.workspace_repository_id === "string" ? { repositoryId: row.workspace_repository_id } : {}),
			...(typeof row.workspace_root === "string" ? { worktreeRoot: row.workspace_root } : {}),
			...(typeof row.workspace_source_commit === "string" ? { sourceCommit: row.workspace_source_commit } : {}),
			...(typeof row.workspace_task_branch === "string" ? { taskBranch: row.workspace_task_branch } : {}),
			...(typeof row.integration_target_ref === "string" ? { integrationTargetRef: row.integration_target_ref } : {}),
			...(typeof row.integration_target_commit === "string" ? { integrationTargetCommit: row.integration_target_commit } : {}),
			...(typeof row.integration_observed_commit === "string" ? { integrationObservedCommit: row.integration_observed_commit } : {}),
			...(typeof row.restoration_ref === "string" ? { restorationRef: row.restoration_ref } : {}),
			...(typeof row.restoration_sha === "string" ? { restorationSha: row.restoration_sha } : {}),
			...(typeof row.cleanup_last_failure === "string" ? { lastFailure: row.cleanup_last_failure } : {}),
		};
		session.workspaceMetadata = metadata;
	}
	return session;
}

function commandFromRow(row: Row): Command {
	const command: Command = {
		sessionId: getRowString(row, "session_id"),
		commandId: getRowString(row, "command_id"),
		deviceId: getRowString(row, "device_id"),
		incarnation: getRowString(row, "incarnation"),
		kind: getRowString(row, "kind"),
		payload: parseJson(row.payload_json, "commands.payload_json"),
		payloadHash: getRowString(row, "payload_hash"),
		status: validateCommandStatus(row.status),
		createdAt: getRowString(row, "created_at"),
		updatedAt: getRowString(row, "updated_at"),
	};
	if (row.ack_json !== null && row.ack_json !== undefined) command.ack = parseJson(row.ack_json, "commands.ack_json");
	if (row.result_json !== null && row.result_json !== undefined) command.result = parseJson(row.result_json, "commands.result_json");
	if (row.error !== null && row.error !== undefined) command.error = requireString(row.error, "commands.error", ERROR_MAX_BYTES);
	return command;
}

function turnFromRow(row: Row): TurnIntent {
	const turn: TurnIntent = {
		turnIntentId: getRowString(row, "turn_intent_id"),
		commandId: getRowString(row, "command_id"),
		deviceId: getRowString(row, "device_id"),
		incarnation: getRowString(row, "incarnation"),
		payloadHash: getRowString(row, "payload_hash"),
		acceptedSequence: requireSequence(row.accepted_sequence, "turn accepted sequence"),
		state: validateTurnState(row.state),
		createdAt: getRowString(row, "created_at"),
		updatedAt: getRowString(row, "updated_at"),
	};
	if (row.queue_position !== null && row.queue_position !== undefined) turn.queuePosition = requireSequence(row.queue_position, "turn queue position");
	if (row.evidence_sequence !== null && row.evidence_sequence !== undefined) turn.evidenceSequence = requireSequence(row.evidence_sequence, "turn evidence sequence", 0);
	if (row.model !== null && row.model !== undefined) turn.model = requireString(row.model, "turn model", KIND_MAX_BYTES);
	if (row.thinking_level !== null && row.thinking_level !== undefined) turn.thinkingLevel = requireString(row.thinking_level, "turn thinking level", KIND_MAX_BYTES);
	if (row.reason !== null && row.reason !== undefined) turn.reason = requireString(row.reason, "turn reason", ERROR_MAX_BYTES);
	return turn;
}

function requireSequence(value: unknown, label: string, minimum = 1): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new DurableStoreSchemaError(`Invalid ${label}`);
	return value;
}

function eventFromRow(row: Row): SessionEvent {
	const sequence = row.sequence;
	if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
		throw new DurableStoreSchemaError("Invalid event sequence");
	}
	return {
		sessionId: getRowString(row, "session_id"),
		incarnation: getRowString(row, "incarnation"),
		sequence,
		timestamp: getRowString(row, "timestamp"),
		frame: parseJson(row.frame_json, "events.frame_json"),
	};
}

function validateDraftRevision(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
	return value as number;
}

function validateDraftText(value: unknown): string {
	if (typeof value !== "string") throw new TypeError("draft text must be a string");
	if (value.length > DRAFT_TEXT_MAX_CHARS) throw new TypeError(`draft text exceeds ${DRAFT_TEXT_MAX_CHARS} characters`);
	return value;
}

/**
 * The cross-window draft payload. The host never interprets it, so the only
 * requirements are that it is JSON-serializable and bounded: a draft must not be
 * able to grow the state directory without limit.
 */
function validateDraftContent(value: unknown): Json {
	let serialized: string | undefined;
	try { serialized = JSON.stringify(value); } catch (error) { throw new TypeError(`draft content must be JSON-serializable: ${error instanceof Error ? error.message : "unknown error"}`); }
	if (serialized === undefined) throw new TypeError("draft content must be JSON-serializable");
	if (serialized.length > DRAFT_CONTENT_MAX_CHARS) throw new TypeError(`draft content exceeds ${DRAFT_CONTENT_MAX_CHARS} characters`);
	return value as Json;
}

function validateDraftAttachments(value: unknown): DraftAttachment[] {
	if (!Array.isArray(value)) throw new TypeError("draft attachments must be an array");
	if (value.length > DRAFT_ATTACHMENT_MAX_COUNT) throw new TypeError(`draft attachments must contain at most ${DRAFT_ATTACHMENT_MAX_COUNT} entries`);
	return value.map((entry, index) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError(`draft attachment ${index} must be an object`);
		const candidate = entry as Record<string, unknown>;
		const id = requireString(candidate.id, `draft attachment ${index} id`, DRAFT_ATTACHMENT_ID_MAX_BYTES);
		if (candidate.kind !== "image" && candidate.kind !== "file" && candidate.kind !== "text") throw new TypeError(`draft attachment ${index} kind is invalid`);
		const attachment: DraftAttachment = { id, kind: candidate.kind };
		if (candidate.name !== undefined) (attachment as { name?: string }).name = requireString(candidate.name, `draft attachment ${index} name`, DRAFT_ATTACHMENT_NAME_MAX_BYTES);
		if (candidate.byteLength !== undefined) {
			if (!Number.isSafeInteger(candidate.byteLength) || (candidate.byteLength as number) < 0) throw new TypeError(`draft attachment ${index} byteLength must be a non-negative safe integer`);
			(attachment as { byteLength?: number }).byteLength = candidate.byteLength as number;
		}
		return attachment;
	});
}

function draftFromRow(row: Row): DraftSnapshot {
	const revision = row.revision;
	if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw new DurableStoreSchemaError("Invalid draft revision");
	const text = validateDraftText(row.text);
	if (typeof row.attachments_json !== "string") throw new DurableStoreSchemaError("Invalid drafts.attachments_json");
	let parsed: unknown;
	try { parsed = JSON.parse(row.attachments_json); } catch (error) { throw new DurableStoreSchemaError("Invalid drafts.attachments_json", error); }
	let attachments: DraftAttachment[];
	try { attachments = validateDraftAttachments(parsed); } catch (error) { throw new DurableStoreSchemaError("Invalid drafts.attachments_json", error); }
	const sessionId = row.session_id === null || row.session_id === undefined ? undefined : requireString(row.session_id, "drafts.session_id", DRAFT_SESSION_ID_MAX_BYTES);
	const source = row.source === null || row.source === undefined ? undefined : requireString(row.source, "drafts.source", DRAFT_SOURCE_MAX_BYTES);
	const content = row.content_json === null || row.content_json === undefined ? undefined : validateDraftContent(parseJson(row.content_json, "drafts.content_json"));
	return {
		draftId: getRowString(row, "draft_id"),
		revision: revision as number,
		text,
		attachments,
		updatedAt: getRowString(row, "updated_at"),
		...(content === undefined ? {} : { content }),
		...(sessionId === undefined ? {} : { sessionId }),
		...(source === undefined ? {} : { source }),
	};
}

function draftSubmissionFromRow(row: Row): DraftSubmission {
	const revision = row.revision;
	if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw new DurableStoreSchemaError("Invalid draft submission revision");
	return {
		submissionId: getRowString(row, "submission_id"),
		draftId: getRowString(row, "draft_id"),
		revision: revision as number,
		commandId: requireString(row.command_id, "draft_submissions.command_id", COMMAND_ID_MAX_BYTES),
		createdAt: getRowString(row, "created_at"),
	};
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  session_file TEXT NOT NULL,
  incarnation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'stopped', 'recovery_required')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  workspace_task_id TEXT,
  workspace_project_id TEXT,
  workspace_repository_id TEXT,
  workspace_root TEXT,
  workspace_actual_cwd TEXT,
  workspace_source_commit TEXT,
  workspace_task_branch TEXT,
  integration_target_ref TEXT,
  integration_target_commit TEXT,
  integration_observed_commit TEXT,
  restoration_ref TEXT,
  restoration_sha TEXT,
  cleanup_generation INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_generation >= 0),
  cleanup_state TEXT NOT NULL DEFAULT 'retained' CHECK (cleanup_state IN ('retained', 'archive_requested', 'prepared', 'removed')),
  cleanup_last_failure TEXT
);
CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_id, archived, updated_at);
CREATE TABLE IF NOT EXISTS commands (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  incarnation TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'acknowledged', 'completed', 'failed', 'outcome_unknown', 'not_dispatched')),
  ack_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, command_id)
);
CREATE INDEX IF NOT EXISTS commands_session_created_idx ON commands(session_id, created_at DESC, command_id DESC);
CREATE TABLE IF NOT EXISTS events (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  incarnation TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  timestamp TEXT NOT NULL,
  frame_json TEXT NOT NULL,
  PRIMARY KEY (session_id, sequence)
);
CREATE TABLE IF NOT EXISTS turn_intents (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_intent_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  incarnation TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  accepted_sequence INTEGER NOT NULL CHECK (accepted_sequence > 0),
  state TEXT NOT NULL CHECK (state IN ('prepared', 'queued', 'running', 'completed', 'failed', 'cancelled', 'needs_continue', 'outcome_unknown')),
  queue_position INTEGER CHECK (queue_position IS NULL OR queue_position > 0),
  evidence_sequence INTEGER CHECK (evidence_sequence IS NULL OR evidence_sequence >= 0),
  model TEXT,
  thinking_level TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, turn_intent_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS turn_intents_command_idx ON turn_intents(session_id, command_id);
CREATE INDEX IF NOT EXISTS turn_intents_session_sequence_idx ON turn_intents(session_id, accepted_sequence DESC);
CREATE TABLE IF NOT EXISTS drafts (
  device_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  text TEXT NOT NULL,
  attachments_json TEXT NOT NULL,
  content_json TEXT,
  session_id TEXT,
  source TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, draft_id)
);
CREATE TABLE IF NOT EXISTS draft_submissions (
  device_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  submission_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, draft_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS draft_submissions_submission_id_idx ON draft_submissions(submission_id);
`;

function isDatabaseBusy(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const code = (error as { code?: unknown }).code;
	return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || String((error as { message?: unknown }).message ?? "").includes("database is locked");
}

/**
 * A single-owner, synchronous SQLite store. `DatabaseSync` is intentionally
 * used here: every mutating method completes its SQLite transaction before it
 * returns to the host runtime, making claim-before-dispatch straightforward.
 */
export class DurableStore {
	private readonly stateDir: string;
	private readonly journalPath: string;
	private readonly ownerLockPath: string;
	private readonly db: DatabaseSync;
	private readonly ownerDb: DatabaseSync;
	/**
	 * Bytes each session's journal holds right now, so retention can decide whether
	 * an append crossed the byte cap without re-reading every retained frame.
	 * Seeded from the table on a session's first append and then maintained exactly:
	 * the owner lock makes this process the only writer, and retention only deletes
	 * a prefix (whose freed bytes come back from the delete itself).
	 */
	private readonly retainedJournalBytes = new Map<string, number>();
	private closed = false;

	private constructor(paths: StorePaths, db: DatabaseSync, ownerDb: DatabaseSync) {
		this.stateDir = paths.stateDir;
		this.journalPath = paths.journalPath;
		this.ownerLockPath = paths.ownerLockPath;
		this.db = db;
		this.ownerDb = ownerDb;
	}

	/** Open, acquire ownership, migrate, and optionally recover before use. */
	static open(options: DurableStoreOptions): DurableStore {
		const stateDir = validateDirectory(options.stateDir, 0o700);
		const journalPath = join(stateDir, JOURNAL_FILENAME);
		const ownerLockPath = join(stateDir, OWNER_LOCK_FILENAME);
		let ownerDb: DatabaseSync | undefined;
		let db: DatabaseSync | undefined;
		try {
			rejectUnsafeExistingDatabasePath(ownerLockPath);
			ownerDb = new DatabaseSync(ownerLockPath);
			secureDatabasePath(ownerLockPath, 0o600);
			ownerDb.exec("PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS owner_guard (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, acquired_at TEXT NOT NULL);");
			try {
				ownerDb.exec("BEGIN EXCLUSIVE");
				ownerDb.prepare("INSERT OR REPLACE INTO owner_guard (id, pid, acquired_at) VALUES (1, ?, ?)").run(process.pid, nowIso());
			} catch (error) {
				if (isDatabaseBusy(error)) throw new DurableStoreOwnershipError(undefined, error);
				throw error;
			}

			rejectUnsafeExistingDatabasePath(journalPath);
			db = new DatabaseSync(journalPath);
			secureDatabasePath(journalPath, 0o600);
			db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
			initializeSchema(db, journalPath);
			const store = new DurableStore({ stateDir, journalPath, ownerLockPath }, db, ownerDb);
			try {
				if (options.recover !== false) store.recoverPending();
			} catch (error) {
				store.close();
				throw error;
			}
			db = undefined;
			ownerDb = undefined;
			return store;
		} catch (error) {
			try { db?.close(); } catch { /* best effort */ }
			if (ownerDb) {
				try { ownerDb.exec("ROLLBACK"); } catch { /* best effort */ }
				try { ownerDb.close(); } catch { /* best effort */ }
			}
			if (error instanceof DurableStoreError) throw error;
			if (isDatabaseBusy(error)) throw new DurableStoreOwnershipError(undefined, error);
			throw error;
		}
	}

	get paths(): StorePaths {
		return { stateDir: this.stateDir, journalPath: this.journalPath, ownerLockPath: this.ownerLockPath };
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		try { this.db.close(); } finally {
			try { this.ownerDb.exec("ROLLBACK"); } catch { /* no active transaction */ }
			this.ownerDb.close();
		}
	}

	private assertOpen(): void {
		if (this.closed) throw new DurableStoreError("closed", "Durable store is closed");
	}

	private transaction<T>(work: () => T): T {
		this.assertOpen();
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const value = work();
			this.db.exec("COMMIT");
			return value;
		} catch (error) {
			try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ }
			throw error;
		}
	}

	private getProjectOrThrow(id: string): Project {
		const project = this.getProject(id);
		if (!project) throw new DurableStoreProjectNotFoundError(id);
		return project;
	}

	private getSessionOrThrow(id: string): Session {
		const session = this.getSession(id);
		if (!session) throw new DurableStoreSessionNotFoundError(id);
		return session;
	}

	listProjects(options: ListProjectsOptions = {}): Project[] {
		this.assertOpen();
		const rows = this.db.prepare(
			`SELECT id, path, name, pinned, archived, created_at FROM projects ${options.includeArchived === true ? "" : "WHERE archived = 0"} ORDER BY pinned DESC, created_at ASC, id ASC`,
		).all();
		return rows.map(row => projectFromRow(row as Row));
	}

	getProject(id: string): Project | undefined {
		this.assertOpen();
		const projectId = requireString(id, "projectId");
		const row = this.db.prepare("SELECT id, path, name, pinned, archived, created_at FROM projects WHERE id = ?").get(projectId) as Row | undefined;
		return row ? projectFromRow(row) : undefined;
	}

	createProject(input: CreateProjectInput): Project {
		this.assertOpen();
		const path = canonicalProjectPath(input.path);
		const name = input.name === undefined ? basename(path) || path : requireString(input.name, "project name", 512).trim();
		if (!name) throw new TypeError("project name must be a non-empty string");
		const pinned = optionalBoolean(input.pinned, "project pinned") ?? false;
		const archived = optionalBoolean(input.archived, "project archived") ?? false;
		const id = createEntityId(input.id);
		const createdAt = nowIso();
		try {
			return this.transaction(() => {
				this.db.prepare("INSERT INTO projects (id, path, name, pinned, archived, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
					id,
					path,
					name,
					boolToSql(pinned),
					boolToSql(archived),
					createdAt,
				);
				return this.getProjectOrThrow(id);
			});
		} catch (error) {
			if (isUniqueConstraint(error)) throw new DurableStoreError("project-exists", `Project path already exists: ${path}`, error);
			throw error;
		}
	}

	updateProject(id: string, patch: UpdateProjectPatch): Project {
		this.assertOpen();
		const projectId = requireString(id, "projectId");
		const current = this.getProjectOrThrow(projectId);
		const nextPath = patch.path === undefined ? current.path : canonicalProjectPath(patch.path);
		const nextName = patch.name === undefined ? current.name : requireString(patch.name, "project name", 512).trim();
		if (!nextName) throw new TypeError("project name must be a non-empty string");
		const nextPinned = patch.pinned === undefined ? current.pinned : optionalBoolean(patch.pinned, "project pinned")!;
		const nextArchived = patch.archived === undefined ? current.archived : optionalBoolean(patch.archived, "project archived")!;
		try {
			return this.transaction(() => {
				this.db.prepare("UPDATE projects SET path = ?, name = ?, pinned = ?, archived = ? WHERE id = ?").run(
					nextPath,
					nextName,
					boolToSql(nextPinned),
					boolToSql(nextArchived),
					projectId,
				);
				return this.getProjectOrThrow(projectId);
			});
		} catch (error) {
			if (isUniqueConstraint(error)) throw new DurableStoreError("project-exists", `Project path already exists: ${nextPath}`, error);
			throw error;
		}
	}

	listSessions(projectId?: string, options: ListSessionsOptions = {}): Session[] {
		this.assertOpen();
		if (projectId !== undefined) this.getProjectOrThrow(requireString(projectId, "projectId"));
		const includeArchived = options.includeArchived === true;
		const rows = projectId === undefined
			? this.db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY pinned DESC, updated_at DESC, id DESC`).all()
			: this.db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE project_id = ? ${includeArchived ? "" : "AND archived = 0"} ORDER BY pinned DESC, updated_at DESC, id DESC`).all(projectId);
		return rows.map(row => sessionFromRow(row as Row));
	}

	getSession(id: string): Session | undefined {
		this.assertOpen();
		const sessionId = requireString(id, "sessionId");
		const row = this.db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(sessionId) as Row | undefined;
		return row ? sessionFromRow(row) : undefined;
	}

	createSession(input: CreateSessionInput): Session {
		this.assertOpen();
		const projectId = requireString(input.projectId, "projectId");
		const project = this.getProjectOrThrow(projectId);
		const id = createEntityId(input.id);
		const title = input.title === undefined ? DEFAULT_SESSION_TITLE : requireString(input.title, "session title", 2_048);
		const cwd = input.cwd === undefined ? project.path : requireString(input.cwd, "session cwd", 4_096);
		const sessionFile = input.sessionFile === undefined ? join(this.stateDir, "sessions", `${id}.jsonl`) : requireString(input.sessionFile, "sessionFile", 8_192);
		const incarnation = input.incarnation === undefined ? randomUUID() : requireString(input.incarnation, "incarnation", INCARNATION_MAX_BYTES);
		const status = input.status === undefined ? "idle" : validateStatus(input.status);
		const archived = optionalBoolean(input.archived, "session archived") ?? false;
		const timestamp = nowIso();
		try {
			return this.transaction(() => {
				this.db.prepare("INSERT INTO sessions (id, project_id, title, cwd, session_file, incarnation, status, archived, created_at, updated_at, workspace_task_id, workspace_project_id, workspace_actual_cwd, cleanup_generation, cleanup_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'retained')").run(
					id,
					projectId,
					title,
					cwd,
					sessionFile,
					incarnation,
					status,
					boolToSql(archived),
					timestamp,
					timestamp,
					id,
					projectId,
					cwd,
				);
				return this.getSessionOrThrow(id);
			});
		} catch (error) {
			if (isForeignKeyConstraint(error)) throw new DurableStoreProjectNotFoundError(projectId);
			throw error;
		}
	}

	updateSession(id: string, patch: UpdateSessionPatch): Session {
		this.assertOpen();
		const sessionId = requireString(id, "sessionId");
		const current = this.getSessionOrThrow(sessionId);
		const title = patch.title === undefined ? current.title : requireString(patch.title, "session title", 2_048);
		const cwd = patch.cwd === undefined ? current.cwd : requireString(patch.cwd, "session cwd", 4_096);
		const sessionFile = patch.sessionFile === undefined ? current.sessionFile : requireString(patch.sessionFile, "sessionFile", 8_192);
		const incarnation = patch.incarnation === undefined ? current.incarnation : requireString(patch.incarnation, "incarnation", INCARNATION_MAX_BYTES);
		const status = patch.status === undefined ? current.status : validateStatus(patch.status);
		const archived = patch.archived === undefined ? current.archived : patch.archived;
		const pinned = patch.pinned === undefined ? current.pinned ?? false : optionalBoolean(patch.pinned, "session pinned")!;
		if (typeof archived !== "boolean") throw new TypeError("session archived must be boolean");
		return this.transaction(() => {
			this.db.prepare("UPDATE sessions SET title = ?, cwd = ?, session_file = ?, incarnation = ?, status = ?, archived = ?, pinned = ?, workspace_actual_cwd = ?, updated_at = ? WHERE id = ?").run(
				title,
				cwd,
				sessionFile,
				incarnation,
				status,
				boolToSql(archived),
				boolToSql(pinned),
				cwd,
				nowIso(),
				sessionId,
			);
			return this.getSessionOrThrow(sessionId);
		});
	}

	/** Read the task-row workspace/cleanup projection without consulting sidecar files. */
	getSessionWorkspaceMetadata(id: string): SessionWorkspaceMetadata | undefined {
		return this.getSession(id)?.workspaceMetadata;
	}

	/** Atomically update durable workspace facts or advance the cleanup state machine. */
	updateSessionWorkspaceMetadata(id: string, patch: SessionWorkspaceMetadataPatch): SessionWorkspaceMetadata {
		this.assertOpen();
		const sessionId = requireString(id, "sessionId");
		const session = this.getSessionOrThrow(sessionId);
		const current = session.workspaceMetadata ?? {
			taskId: session.id,
			projectId: session.projectId,
			actualCwd: session.cwd,
			cleanupGeneration: 0,
			cleanupState: "retained" as const,
		};
		const text = (value: string | null | undefined, label: string): string | null | undefined => {
			if (value === null || value === undefined) return value;
			return requireString(value, label, 16_384);
		};
		const optional = (value: string | null | undefined, previous: string | undefined, label: string): string | undefined => {
			if (value === undefined) return previous;
			if (value === null) return undefined;
			return text(value, label)!;
		};
		const generation = patch.cleanupGeneration === undefined ? current.cleanupGeneration : patch.cleanupGeneration;
		if (!Number.isSafeInteger(generation) || generation < 0) throw new TypeError("cleanup generation must be a non-negative safe integer");
		const state = patch.cleanupState === undefined ? current.cleanupState : validateCleanupState(patch.cleanupState);
		const next: SessionWorkspaceMetadata = {
			taskId: text(patch.taskId, "workspace task id") ?? current.taskId,
			projectId: text(patch.projectId, "workspace project id") ?? current.projectId,
			actualCwd: text(patch.actualCwd, "workspace actual cwd") ?? current.actualCwd,
			cleanupGeneration: generation,
			cleanupState: state,
			...(optional(patch.repositoryId, current.repositoryId, "workspace repository id") === undefined ? {} : { repositoryId: optional(patch.repositoryId, current.repositoryId, "workspace repository id") }),
			...(optional(patch.worktreeRoot, current.worktreeRoot, "workspace root") === undefined ? {} : { worktreeRoot: optional(patch.worktreeRoot, current.worktreeRoot, "workspace root") }),
			...(optional(patch.sourceCommit, current.sourceCommit, "workspace source commit") === undefined ? {} : { sourceCommit: optional(patch.sourceCommit, current.sourceCommit, "workspace source commit") }),
			...(optional(patch.taskBranch, current.taskBranch, "workspace task branch") === undefined ? {} : { taskBranch: optional(patch.taskBranch, current.taskBranch, "workspace task branch") }),
			...(optional(patch.integrationTargetRef, current.integrationTargetRef, "integration target ref") === undefined ? {} : { integrationTargetRef: optional(patch.integrationTargetRef, current.integrationTargetRef, "integration target ref") }),
			...(optional(patch.integrationTargetCommit, current.integrationTargetCommit, "integration target commit") === undefined ? {} : { integrationTargetCommit: optional(patch.integrationTargetCommit, current.integrationTargetCommit, "integration target commit") }),
			...(optional(patch.integrationObservedCommit, current.integrationObservedCommit, "integration observed commit") === undefined ? {} : { integrationObservedCommit: optional(patch.integrationObservedCommit, current.integrationObservedCommit, "integration observed commit") }),
			...(optional(patch.restorationRef, current.restorationRef, "restoration ref") === undefined ? {} : { restorationRef: optional(patch.restorationRef, current.restorationRef, "restoration ref") }),
			...(optional(patch.restorationSha, current.restorationSha, "restoration SHA") === undefined ? {} : { restorationSha: optional(patch.restorationSha, current.restorationSha, "restoration SHA") }),
			...(optional(patch.lastFailure, current.lastFailure, "cleanup last failure") === undefined ? {} : { lastFailure: optional(patch.lastFailure, current.lastFailure, "cleanup last failure") }),
		};
		this.transaction(() => {
			this.db.prepare("UPDATE sessions SET workspace_task_id = ?, workspace_project_id = ?, workspace_repository_id = ?, workspace_root = ?, workspace_actual_cwd = ?, workspace_source_commit = ?, workspace_task_branch = ?, integration_target_ref = ?, integration_target_commit = ?, integration_observed_commit = ?, restoration_ref = ?, restoration_sha = ?, cleanup_generation = ?, cleanup_state = ?, cleanup_last_failure = ?, updated_at = ? WHERE id = ?").run(
				next.taskId,
				next.projectId,
				next.repositoryId ?? null,
				next.worktreeRoot ?? null,
				next.actualCwd,
				next.sourceCommit ?? null,
				next.taskBranch ?? null,
				next.integrationTargetRef ?? null,
				next.integrationTargetCommit ?? null,
				next.integrationObservedCommit ?? null,
				next.restorationRef ?? null,
				next.restorationSha ?? null,
				next.cleanupGeneration,
				next.cleanupState,
				next.lastFailure ?? null,
				nowIso(),
				sessionId,
			);
		});
		return this.getSessionOrThrow(sessionId).workspaceMetadata!;
	}

	/** Short alias used by callers that treat workspace metadata as a row projection. */
	setSessionWorkspaceMetadata(id: string, patch: SessionWorkspaceMetadataPatch): SessionWorkspaceMetadata {
		return this.updateSessionWorkspaceMetadata(id, patch);
	}

	/**
	 * Remove a session row for good.
	 *
	 * Commands and events reference the row with `ON DELETE CASCADE`, and the store
	 * runs with `PRAGMA foreign_keys=ON`, so they go with it. The row's files on
	 * disk are the caller's business (`CediaHost.deleteSession` removes them).
	 */
	deleteSession(id: string): void {
		this.assertOpen();
		const sessionId = requireString(id, "sessionId");
		this.getSessionOrThrow(sessionId);
		this.transaction(() => {
			this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
		});
		this.retainedJournalBytes.delete(sessionId);
	}

	readDraft(deviceId: string, draftId: string): DraftSnapshot | undefined {
		this.assertOpen();
		const normalizedDeviceId = requireString(deviceId, "deviceId", DEVICE_ID_MAX_BYTES);
		const normalizedDraftId = requireString(draftId, "draftId", DRAFT_ID_MAX_BYTES);
		const row = this.db.prepare("SELECT device_id, draft_id, revision, text, attachments_json, content_json, session_id, source, updated_at FROM drafts WHERE device_id = ? AND draft_id = ?").get(normalizedDeviceId, normalizedDraftId) as Row | undefined;
		return row ? draftFromRow(row) : undefined;
	}

	writeDraft(input: WriteDraftInput): DraftWriteResult {
		this.assertOpen();
		const deviceId = requireString(input.deviceId, "deviceId", DEVICE_ID_MAX_BYTES);
		const draftId = requireString(input.draftId, "draftId", DRAFT_ID_MAX_BYTES);
		const expectedRevision = validateDraftRevision(input.expectedRevision, "expectedRevision");
		const text = validateDraftText(input.text);
		const attachments = validateDraftAttachments(input.attachments);
		const content = input.content === undefined ? undefined : validateDraftContent(input.content);
		const sessionId = input.sessionId === undefined ? undefined : requireString(input.sessionId, "sessionId", DRAFT_SESSION_ID_MAX_BYTES);
		const source = input.source === undefined ? undefined : requireString(input.source, "source", DRAFT_SOURCE_MAX_BYTES);
		return this.transaction(() => {
			const read = () => this.db.prepare("SELECT device_id, draft_id, revision, text, attachments_json, content_json, session_id, source, updated_at FROM drafts WHERE device_id = ? AND draft_id = ?").get(deviceId, draftId) as Row | undefined;
			const currentRow = read();
			if (currentRow) {
				const current = draftFromRow(currentRow);
				if (expectedRevision === 0 || expectedRevision !== current.revision) return { outcome: "conflict", draft: current };
				const revision = current.revision + 1;
				const nextSessionId = sessionId === undefined ? current.sessionId : sessionId;
				const nextSource = source === undefined ? current.source : source;
				// An omitted payload keeps the stored one, so a caller that only touches
				// the readable text cannot erase the other window's draft.
				const nextContent = content === undefined ? current.content : content;
				this.db.prepare("UPDATE drafts SET revision = ?, text = ?, attachments_json = ?, content_json = ?, session_id = ?, source = ?, updated_at = ? WHERE device_id = ? AND draft_id = ? AND revision = ?").run(
					revision,
					text,
					JSON.stringify(attachments),
					nextContent === undefined ? null : JSON.stringify(nextContent),
					nextSessionId ?? null,
					nextSource ?? null,
					nowIso(),
					deviceId,
					draftId,
					current.revision,
				);
				const row = read();
				if (!row) throw new DurableStoreError("store-write", "Draft update was not persisted");
				return { outcome: "written", draft: draftFromRow(row) };
			}
			if (expectedRevision !== 0) return { outcome: "conflict" };
			this.db.prepare("INSERT INTO drafts (device_id, draft_id, revision, text, attachments_json, content_json, session_id, source, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)").run(
				deviceId,
				draftId,
				text,
				JSON.stringify(attachments),
				content === undefined ? null : JSON.stringify(content),
				sessionId ?? null,
				source ?? null,
				nowIso(),
			);
			const row = read();
			if (!row) throw new DurableStoreError("store-write", "Draft creation was not persisted");
			return { outcome: "created", draft: draftFromRow(row) };
		});
	}

	claimDraftSubmission(input: ClaimDraftSubmissionInput): ClaimDraftSubmissionResult {
		this.assertOpen();
		const deviceId = requireString(input.deviceId, "deviceId", DEVICE_ID_MAX_BYTES);
		const draftId = requireString(input.draftId, "draftId", DRAFT_ID_MAX_BYTES);
		const revision = validateDraftRevision(input.revision, "revision");
		if (revision < 1) throw new TypeError("revision must be at least 1");
		const commandId = requireString(input.commandId, "commandId", COMMAND_ID_MAX_BYTES);
		const payloadHash = requireString(input.payloadHash, "payloadHash", 512);
		return this.transaction(() => {
			const draftRow = this.db.prepare("SELECT device_id, draft_id, revision, text, attachments_json, content_json, session_id, source, updated_at FROM drafts WHERE device_id = ? AND draft_id = ?").get(deviceId, draftId) as Row | undefined;
			if (!draftRow || draftFromRow(draftRow).revision !== revision) throw new DurableStoreDraftConflictError(`Draft revision is no longer ${revision}: ${draftId}`);
			const existingRow = this.db.prepare("SELECT device_id, draft_id, revision, submission_id, command_id, payload_hash, created_at FROM draft_submissions WHERE device_id = ? AND draft_id = ? AND revision = ?").get(deviceId, draftId, revision) as Row | undefined;
			if (existingRow) {
				if (getRowString(existingRow, "payload_hash") !== payloadHash) throw new DurableStoreDraftConflictError(`Draft revision already has a different submission: ${draftId}@${revision}`);
				return { submission: draftSubmissionFromRow(existingRow), created: false };
			}
			const createdAt = nowIso();
			const submissionId = randomUUID();
			try {
				this.db.prepare("INSERT INTO draft_submissions (device_id, draft_id, revision, submission_id, command_id, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(deviceId, draftId, revision, submissionId, commandId, payloadHash, createdAt);
			} catch (error) {
				if (isUniqueConstraint(error)) throw new DurableStoreDraftConflictError(`Draft submission identity is already claimed: ${draftId}@${revision}`);
				throw error;
			}
			const row = this.db.prepare("SELECT device_id, draft_id, revision, submission_id, command_id, payload_hash, created_at FROM draft_submissions WHERE device_id = ? AND draft_id = ? AND revision = ?").get(deviceId, draftId, revision) as Row | undefined;
			if (!row) throw new DurableStoreError("store-write", "Draft submission was not persisted");
			return { submission: draftSubmissionFromRow(row), created: true };
		});
	}

	clearDraft(input: ClearDraftInput): { cleared: boolean; draft?: DraftSnapshot } {
		this.assertOpen();
		const deviceId = requireString(input.deviceId, "deviceId", DEVICE_ID_MAX_BYTES);
		const draftId = requireString(input.draftId, "draftId", DRAFT_ID_MAX_BYTES);
		const revision = validateDraftRevision(input.revision, "revision");
		return this.transaction(() => {
			const row = this.db.prepare("SELECT device_id, draft_id, revision, text, attachments_json, content_json, session_id, source, updated_at FROM drafts WHERE device_id = ? AND draft_id = ?").get(deviceId, draftId) as Row | undefined;
			if (!row) return { cleared: false };
			const current = draftFromRow(row);
			if (current.revision !== revision) return { cleared: false, draft: current };
			this.db.prepare("DELETE FROM drafts WHERE device_id = ? AND draft_id = ? AND revision = ?").run(deviceId, draftId, revision);
			// Delivery consumes the revision's claim: the next draft restarts at revision 1
			// (see writeDraft), so a spent submission left behind would collide with it and
			// every later Send on the task would refuse as a cross-window conflict. A stale
			// clear that matches nothing leaves live claims alone by construction.
			this.db.prepare("DELETE FROM draft_submissions WHERE device_id = ? AND draft_id = ? AND revision = ?").run(deviceId, draftId, revision);
			return { cleared: true };
		});
	}

	importDrafts(input: { deviceId: string; entries: ReadonlyArray<ImportDraftEntry> }): { imported: number; skipped: number } {
		this.assertOpen();
		const deviceId = requireString(input.deviceId, "deviceId", DEVICE_ID_MAX_BYTES);
		if (!Array.isArray(input.entries)) throw new TypeError("entries must be an array");
		return this.transaction(() => {
			let imported = 0;
			let skipped = 0;
			for (const entry of input.entries) {
				const draftId = requireString(entry?.draftId, "draftId", DRAFT_ID_MAX_BYTES);
				const text = validateDraftText(entry?.text);
				const attachments = validateDraftAttachments(entry?.attachments ?? []);
				const content = entry?.content === undefined ? undefined : validateDraftContent(entry.content);
				const sessionId = entry?.sessionId === undefined ? undefined : requireString(entry.sessionId, "sessionId", DRAFT_SESSION_ID_MAX_BYTES);
				const source = requireString(entry?.source, "source", DRAFT_SOURCE_MAX_BYTES);
				const existing = this.db.prepare("SELECT 1 FROM drafts WHERE device_id = ? AND draft_id = ?").get(deviceId, draftId);
				if (existing) {
					skipped += 1;
					continue;
				}
				this.db.prepare("INSERT INTO drafts (device_id, draft_id, revision, text, attachments_json, content_json, session_id, source, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)").run(deviceId, draftId, text, JSON.stringify(attachments), content === undefined ? null : JSON.stringify(content), sessionId ?? null, source, nowIso());
				imported += 1;
			}
			return { imported, skipped };
		});
	}

	claimCommand(input: ClaimCommandInput): ClaimCommandResult {
		this.assertOpen();
		const sessionId = requireString(input.sessionId, "sessionId");
		const commandId = requireString(input.commandId, "commandId", COMMAND_ID_MAX_BYTES);
		const deviceId = requireString(input.deviceId, "deviceId", DEVICE_ID_MAX_BYTES);
		const incarnation = requireString(input.incarnation, "incarnation", INCARNATION_MAX_BYTES);
		const kind = requireString(input.kind, "kind", KIND_MAX_BYTES);
		const payloadJson = canonicalizeJson(input.payload);
		const payloadHash = commandPayloadHash({ deviceId, incarnation, kind, payload: input.payload });
		return this.transaction(() => {
			this.getSessionOrThrow(sessionId);
			const existingRow = this.db.prepare("SELECT session_id, command_id, device_id, incarnation, kind, payload_json, payload_hash, status, ack_json, result_json, error, created_at, updated_at FROM commands WHERE session_id = ? AND command_id = ?").get(sessionId, commandId) as Row | undefined;
			if (existingRow) {
				const existing = commandFromRow(existingRow);
				if (existing.payloadHash !== payloadHash) throw new DurableStoreCommandConflictError(sessionId, commandId);
				return { command: existing, created: false };
			}
			const timestamp = nowIso();
			this.db.prepare("INSERT INTO commands (session_id, command_id, device_id, incarnation, kind, payload_json, payload_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'claimed', ?, ?)").run(
				sessionId,
				commandId,
				deviceId,
				incarnation,
				kind,
				payloadJson,
				payloadHash,
				timestamp,
				timestamp,
			);
			const row = this.db.prepare("SELECT session_id, command_id, device_id, incarnation, kind, payload_json, payload_hash, status, ack_json, result_json, error, created_at, updated_at FROM commands WHERE session_id = ? AND command_id = ?").get(sessionId, commandId) as Row | undefined;
			if (!row) throw new DurableStoreError("store-write", "Command claim was not persisted");
			return { command: commandFromRow(row), created: true };
		});
	}

	getCommand(sessionId: string, commandId: string): Command | undefined {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		const normalizedCommandId = requireString(commandId, "commandId", COMMAND_ID_MAX_BYTES);
		this.getSessionOrThrow(normalizedSessionId);
		const row = this.db.prepare("SELECT session_id, command_id, device_id, incarnation, kind, payload_json, payload_hash, status, ack_json, result_json, error, created_at, updated_at FROM commands WHERE session_id = ? AND command_id = ?").get(normalizedSessionId, normalizedCommandId) as Row | undefined;
		return row ? commandFromRow(row) : undefined;
	}

	/**
	 * Persist one submitted turn intent before it is dispatched (§2.4).
	 *
	 * Idempotent by command: a replay or a reconciliation that names the same command and the
	 * same payload returns the intent that already exists instead of claiming a second one, and
	 * a different payload for that command is a conflict, exactly like the command receipt.
	 */
	beginTurnIntent(input: BeginTurnIntentInput): { intent: TurnIntent; created: boolean } {
		this.assertOpen();
		const sessionId = requireString(input.sessionId, "sessionId");
		const turnIntentId = requireString(input.turnIntentId, "turnIntentId", COMMAND_ID_MAX_BYTES);
		const commandId = requireString(input.commandId, "commandId", COMMAND_ID_MAX_BYTES);
		const deviceId = requireString(input.deviceId, "deviceId", DEVICE_ID_MAX_BYTES);
		const incarnation = requireString(input.incarnation, "incarnation", INCARNATION_MAX_BYTES);
		const payloadHash = requireString(input.payloadHash, "payloadHash", KIND_MAX_BYTES);
		return this.transaction(() => {
			this.getSessionOrThrow(sessionId);
			const existingRow = this.db.prepare(`SELECT ${TURN_INTENT_COLUMNS} FROM turn_intents WHERE session_id = ? AND command_id = ?`).get(sessionId, commandId) as Row | undefined;
			if (existingRow) {
				const existing = turnFromRow(existingRow);
				if (existing.payloadHash !== payloadHash) throw new DurableStoreCommandConflictError(sessionId, commandId);
				return { intent: existing, created: false };
			}
			const sequenceRow = this.db.prepare("SELECT MAX(accepted_sequence) AS sequence FROM turn_intents WHERE session_id = ?").get(sessionId) as Row | undefined;
			const previous = sequenceRow?.sequence;
			const acceptedSequence = previous === null || previous === undefined ? 1 : requireSequence(previous, "turn accepted sequence") + 1;
			const timestamp = nowIso();
			this.db.prepare("INSERT INTO turn_intents (session_id, turn_intent_id, command_id, device_id, incarnation, payload_hash, accepted_sequence, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)").run(
				sessionId,
				turnIntentId,
				commandId,
				deviceId,
				incarnation,
				payloadHash,
				acceptedSequence,
				timestamp,
				timestamp,
			);
			const row = this.db.prepare(`SELECT ${TURN_INTENT_COLUMNS} FROM turn_intents WHERE session_id = ? AND turn_intent_id = ?`).get(sessionId, turnIntentId) as Row | undefined;
			if (!row) throw new DurableStoreError("store-write", "Turn intent was not persisted");
			return { intent: turnFromRow(row), created: true };
		});
	}

	getTurnIntent(sessionId: string, turnIntentId: string): TurnIntent | undefined {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		this.getSessionOrThrow(normalizedSessionId);
		const row = this.db.prepare(`SELECT ${TURN_INTENT_COLUMNS} FROM turn_intents WHERE session_id = ? AND turn_intent_id = ?`).get(normalizedSessionId, requireString(turnIntentId, "turnIntentId", COMMAND_ID_MAX_BYTES)) as Row | undefined;
		return row ? turnFromRow(row) : undefined;
	}

	getTurnIntentByCommand(sessionId: string, commandId: string): TurnIntent | undefined {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		this.getSessionOrThrow(normalizedSessionId);
		const row = this.db.prepare(`SELECT ${TURN_INTENT_COLUMNS} FROM turn_intents WHERE session_id = ? AND command_id = ?`).get(normalizedSessionId, requireString(commandId, "commandId", COMMAND_ID_MAX_BYTES)) as Row | undefined;
		return row ? turnFromRow(row) : undefined;
	}

	/** Recent intents for one task, newest first, bounded so a session row stays small. */
	listTurnIntents(sessionId: string, limit: number = DEFAULT_TURN_PAGE_SIZE): TurnIntent[] {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		this.getSessionOrThrow(normalizedSessionId);
		const pageSize = validatePage(limit, "turn limit", MAX_TURN_PAGE_SIZE);
		const rows = this.db.prepare(`SELECT ${TURN_INTENT_COLUMNS} FROM turn_intents WHERE session_id = ? ORDER BY accepted_sequence DESC LIMIT ?`).all(normalizedSessionId, pageSize);
		return rows.map(row => turnFromRow(row));
	}

	/** Intents that still describe unfinished work: submitted, or accepted, or unresolved. */
	listOpenTurnIntents(sessionId: string): TurnIntent[] {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		this.getSessionOrThrow(normalizedSessionId);
		const rows = this.db.prepare(`SELECT ${TURN_INTENT_COLUMNS} FROM turn_intents WHERE session_id = ? AND state IN ('prepared', 'queued', 'running', 'needs_continue') ORDER BY accepted_sequence ASC`).all(normalizedSessionId);
		return rows.map(row => turnFromRow(row));
	}

	transitionTurnIntent(sessionId: string, turnIntentId: string, state: TurnState, fields: TurnTransitionFields = {}): TurnIntent {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		const normalizedTurnId = requireString(turnIntentId, "turnIntentId", COMMAND_ID_MAX_BYTES);
		const nextState = validateTurnState(state);
		if (fields.reason !== undefined) requireString(fields.reason, "turn reason", ERROR_MAX_BYTES);
		if (fields.queuePosition !== undefined) requireSequence(fields.queuePosition, "turn queue position");
		if (fields.evidenceSequence !== undefined) requireSequence(fields.evidenceSequence, "turn evidence sequence", 0);
		if (fields.model !== undefined) requireString(fields.model, "turn model", KIND_MAX_BYTES);
		if (fields.thinkingLevel !== undefined) requireString(fields.thinkingLevel, "turn thinking level", KIND_MAX_BYTES);
		return this.transaction(() => {
			this.getSessionOrThrow(normalizedSessionId);
			const row = this.db.prepare(`SELECT ${TURN_INTENT_COLUMNS} FROM turn_intents WHERE session_id = ? AND turn_intent_id = ?`).get(normalizedSessionId, normalizedTurnId) as Row | undefined;
			if (!row) throw new DurableStoreTurnNotFoundError(normalizedSessionId, normalizedTurnId);
			const current = turnFromRow(row);
			if (current.state !== nextState && isFinishedTurnState(current.state)) {
				throw new DurableStoreCommandTransitionError(`Finished turn ${normalizedSessionId}/${normalizedTurnId} cannot transition from ${current.state} to ${nextState}`);
			}
			const nextReason = fields.reason === undefined ? current.reason : fields.reason;
			const nextQueuePosition = fields.queuePosition === undefined ? current.queuePosition : fields.queuePosition;
			const nextEvidence = fields.evidenceSequence === undefined ? current.evidenceSequence : fields.evidenceSequence;
			const nextModel = fields.model === undefined ? current.model : fields.model;
			const nextThinkingLevel = fields.thinkingLevel === undefined ? current.thinkingLevel : fields.thinkingLevel;
			// Repeating a state is not a transition, but it may still carry new evidence - the
			// position OMP reported for a still-queued turn, or the model a running turn actually
			// uses - so only a call that changes nothing at all is a no-op.
			if (current.state === nextState && nextReason === current.reason && nextQueuePosition === current.queuePosition
				&& nextEvidence === current.evidenceSequence && nextModel === current.model && nextThinkingLevel === current.thinkingLevel) return current;
			this.db.prepare("UPDATE turn_intents SET state = ?, queue_position = ?, evidence_sequence = ?, model = ?, thinking_level = ?, reason = ?, updated_at = ? WHERE session_id = ? AND turn_intent_id = ?").run(
				nextState,
				nextQueuePosition === undefined ? null : nextQueuePosition,
				nextEvidence === undefined ? null : nextEvidence,
				nextModel === undefined ? null : nextModel,
				nextThinkingLevel === undefined ? null : nextThinkingLevel,
				nextReason === undefined ? null : nextReason,
				nowIso(),
				normalizedSessionId,
				normalizedTurnId,
			);
			const updated = this.db.prepare(`SELECT ${TURN_INTENT_COLUMNS} FROM turn_intents WHERE session_id = ? AND turn_intent_id = ?`).get(normalizedSessionId, normalizedTurnId) as Row | undefined;
			if (!updated) throw new DurableStoreError("store-write", "Turn intent transition was not persisted");
			return turnFromRow(updated);
		});
	}

	listOpenTurnSessions(): string[] {
		this.assertOpen();
		const rows = this.db.prepare("SELECT DISTINCT session_id FROM turn_intents WHERE state IN ('prepared', 'queued', 'running')").all() as Row[];
		return rows.map(row => getRowString(row, "session_id"));
	}

	listCommands(sessionId: string, limit: number = DEFAULT_COMMAND_PAGE_SIZE): Command[] {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		this.getSessionOrThrow(normalizedSessionId);
		const pageSize = validatePage(limit, "command limit", MAX_COMMAND_PAGE_SIZE);
		const rows = this.db.prepare("SELECT session_id, command_id, device_id, incarnation, kind, payload_json, payload_hash, status, ack_json, result_json, error, created_at, updated_at FROM commands WHERE session_id = ? ORDER BY created_at DESC, command_id DESC LIMIT ?").all(normalizedSessionId, pageSize);
		return rows.map(row => commandFromRow(row as Row));
	}

	/** Return every command that could still have an unknown side effect. */
	listPendingCommands(sessionId: string): Command[] {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		this.getSessionOrThrow(normalizedSessionId);
		const rows = this.db.prepare("SELECT session_id, command_id, device_id, incarnation, kind, payload_json, payload_hash, status, ack_json, result_json, error, created_at, updated_at FROM commands WHERE session_id = ? AND status IN ('claimed', 'acknowledged') ORDER BY created_at ASC, command_id ASC").all(normalizedSessionId);
		return rows.map(row => commandFromRow(row as Row));
	}

	transitionCommand(sessionId: string, commandId: string, status: CommandStatus, fields: CommandTransitionFields = {}): Command {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		const normalizedCommandId = requireString(commandId, "commandId", COMMAND_ID_MAX_BYTES);
		const nextStatus = validateCommandStatus(status);
		if (nextStatus === "acknowledged" && fields.result !== undefined) {
			throw new DurableStoreCommandTransitionError("Acknowledgement cannot carry a completion result");
		}
		if (fields.ack !== undefined) canonicalizeJson(fields.ack);
		if (fields.result !== undefined) canonicalizeJson(fields.result);
		if (fields.error !== undefined) requireString(fields.error, "command error", ERROR_MAX_BYTES);
		return this.transaction(() => {
			this.getSessionOrThrow(normalizedSessionId);
			const row = this.db.prepare("SELECT session_id, command_id, device_id, incarnation, kind, payload_json, payload_hash, status, ack_json, result_json, error, created_at, updated_at FROM commands WHERE session_id = ? AND command_id = ?").get(normalizedSessionId, normalizedCommandId) as Row | undefined;
			if (!row) throw new DurableStoreCommandNotFoundError(normalizedSessionId, normalizedCommandId);
			const current = commandFromRow(row);
			if (current.status === nextStatus) return current;
			if (isTerminalCommandStatus(current.status)) {
				throw new DurableStoreCommandTransitionError(`Terminal command ${normalizedSessionId}/${normalizedCommandId} cannot transition from ${current.status} to ${nextStatus}`);
			}
			if (!isAllowedCommandTransition(current.status, nextStatus)) {
				throw new DurableStoreCommandTransitionError(`Command ${normalizedSessionId}/${normalizedCommandId} cannot transition from ${current.status} to ${nextStatus}`);
			}
			if (nextStatus === "failed" && fields.error === undefined && current.error === undefined) {
				throw new DurableStoreCommandTransitionError("Failed command transitions require an error");
			}
			const ackJson = fields.ack === undefined ? undefined : canonicalizeJson(fields.ack);
			const resultJson = fields.result === undefined ? undefined : canonicalizeJson(fields.result);
			const errorText = fields.error === undefined ? undefined : requireString(fields.error, "command error", ERROR_MAX_BYTES);
			const nextAck = ackJson === undefined ? current.ack : fields.ack;
			const nextResult = resultJson === undefined ? current.result : fields.result;
			const nextError = errorText === undefined ? current.error : errorText;
			this.db.prepare("UPDATE commands SET status = ?, ack_json = ?, result_json = ?, error = ?, updated_at = ? WHERE session_id = ? AND command_id = ?").run(
				nextStatus,
				nextAck === undefined ? null : canonicalizeJson(nextAck),
				nextResult === undefined ? null : canonicalizeJson(nextResult),
				nextError ?? null,
				nowIso(),
				normalizedSessionId,
				normalizedCommandId,
			);
			const updated = this.db.prepare("SELECT session_id, command_id, device_id, incarnation, kind, payload_json, payload_hash, status, ack_json, result_json, error, created_at, updated_at FROM commands WHERE session_id = ? AND command_id = ?").get(normalizedSessionId, normalizedCommandId) as Row | undefined;
			if (!updated) throw new DurableStoreError("store-write", "Command transition was not persisted");
			return commandFromRow(updated);
		});
	}

	appendEvent(sessionId: string, incarnation: string, frame: Json): SessionEvent {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		const normalizedIncarnation = requireString(incarnation, "incarnation", INCARNATION_MAX_BYTES);
		const frameJson = canonicalizeJson(frame);
		const frameBytes = Buffer.byteLength(frameJson, "utf8");
		let retainedAfterAppend = 0;
		const event = this.transaction(() => {
			this.getSessionOrThrow(normalizedSessionId);
			// Seed the session's byte total before the insert, so the total retained
			// below counts this frame exactly once.
			const retained = this.#journalBytes(normalizedSessionId) + frameBytes;
			const row = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events WHERE session_id = ?").get(normalizedSessionId) as Row;
			const previous = row.sequence;
			if (typeof previous !== "number" || !Number.isSafeInteger(previous) || previous < 0) throw new DurableStoreSchemaError("Invalid event sequence projection");
			const sequence = previous + 1;
			if (!Number.isSafeInteger(sequence)) throw new DurableStoreError("event-limit", "Event sequence exhausted safe integer range");
			const timestamp = nowIso();
			this.db.prepare("INSERT INTO events (session_id, incarnation, sequence, timestamp, frame_json) VALUES (?, ?, ?, ?, ?)").run(
				normalizedSessionId,
				normalizedIncarnation,
				sequence,
				timestamp,
				frameJson,
			);
			retainedAfterAppend = this.#retainJournal(normalizedSessionId, retained);
			return { sessionId: normalizedSessionId, incarnation: normalizedIncarnation, sequence, timestamp, frame: parseJson(frameJson, "events.frame_json") };
		});
		// Only a committed append may move the running total, or a rolled-back
		// transaction would leave retention believing in bytes that are still there.
		this.retainedJournalBytes.set(normalizedSessionId, retainedAfterAppend);
		return event;
	}

	/**
	 * Read one page of a session's journal, oldest first.
	 *
	 * `historyTruncated` is retention's other half: whatever the client's cursor,
	 * the page says when the journal no longer holds this session's oldest events,
	 * so a reader at `after: 0` cannot mistake the oldest frame it received for the
	 * beginning of the task.
	 */
	readEvents(sessionId: string, after: number = 0, limit: number = DEFAULT_EVENT_PAGE_SIZE): SessionEventPage {
		this.assertOpen();
		const normalizedSessionId = requireString(sessionId, "sessionId");
		this.getSessionOrThrow(normalizedSessionId);
		const cursor = validateAfter(after);
		const pageSize = validatePage(limit, "event limit", MAX_EVENT_PAGE_SIZE);
		const rows = this.db.prepare("SELECT session_id, incarnation, sequence, timestamp, frame_json FROM events WHERE session_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?").all(normalizedSessionId, cursor, pageSize + 1);
		const hasMore = rows.length > pageSize;
		const events = rows.slice(0, pageSize).map(row => eventFromRow(row as Row));
		return { events, cursor: events.length > 0 ? events[events.length - 1]!.sequence : cursor, hasMore, ...this.#journalHead(normalizedSessionId) };
	}

	/** Oldest retained sequence of one session, and whether retention cut its head off. */
	#journalHead(sessionId: string): { firstSequence: number; historyTruncated: boolean } {
		const row = this.db.prepare("SELECT MIN(sequence) AS first FROM events WHERE session_id = ?").get(sessionId) as Row;
		const first = row.first ?? 0;
		if (typeof first !== "number" || !Number.isSafeInteger(first) || first < 0) throw new DurableStoreSchemaError("Invalid event sequence bounds");
		return { firstSequence: first, historyTruncated: first > 1 };
	}

	/**
	 * Bytes one session's journal holds now: its running total, or a one-off count of
	 * the table the first time this host appends to a session (a journal written before
	 * it opened the store). The append path stores the post-append total.
	 */
	#journalBytes(sessionId: string): number {
		const cached = this.retainedJournalBytes.get(sessionId);
		if (cached !== undefined) return cached;
		const row = this.db.prepare("SELECT COALESCE(SUM(LENGTH(CAST(frame_json AS BLOB))), 0) AS bytes FROM events WHERE session_id = ?").get(sessionId) as Row;
		const bytes = row.bytes;
		if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) throw new DurableStoreSchemaError("Invalid journal byte total");
		return bytes;
	}

	/**
	 * Drop the oldest events of one session until it is inside both retention caps.
	 *
	 * Called inside the append transaction with the exact post-append byte total, and
	 * always keeps the newest event: even a fork whose single hydration frame is
	 * larger than the byte cap is readable, it just is not accompanied by the rest
	 * of a long history. Returns the retained total.
	 */
	#retainJournal(sessionId: string, retained: number): number {
		const bounds = this.db.prepare("SELECT MIN(sequence) AS first, MAX(sequence) AS last FROM events WHERE session_id = ?").get(sessionId) as Row;
		const first = bounds.first;
		const last = bounds.last;
		if (typeof first !== "number" || typeof last !== "number" || first < 1 || last < first) throw new DurableStoreSchemaError("Invalid event sequence bounds");
		// Sequences are dense and only a prefix is ever deleted, so the row count is the
		// span between the two bounds: two index probes instead of a COUNT(*) scan.
		if (last - first + 1 > MAX_SESSION_EVENTS) retained -= this.#deleteEventsBefore(sessionId, last - MAX_SESSION_EVENTS + 1);
		if (retained > MAX_SESSION_EVENT_BYTES) {
			// Walk from the oldest up, never past the newest event, and stop as soon as
			// the remainder fits: the walk costs one row per row dropped. The running
			// total is only projected here; the delete below reports the real one.
			const rows = this.db.prepare("SELECT sequence, LENGTH(CAST(frame_json AS BLOB)) AS bytes FROM events WHERE session_id = ? AND sequence < ? ORDER BY sequence ASC LIMIT ?").all(sessionId, last, MAX_SESSION_EVENTS) as Row[];
			let cut: number | undefined;
			let projected = retained;
			for (const row of rows) {
				const sequence = row.sequence;
				const rowBytes = row.bytes;
				if (typeof sequence !== "number" || typeof rowBytes !== "number") throw new DurableStoreSchemaError("Invalid event row");
				if (projected <= MAX_SESSION_EVENT_BYTES) break;
				projected -= rowBytes;
				cut = sequence + 1;
			}
			if (cut !== undefined) retained -= this.#deleteEventsBefore(sessionId, cut);
		}
		return retained;
	}

	/** Delete one session's events below a sequence and report the bytes they held. */
	#deleteEventsBefore(sessionId: string, sequence: number): number {
		const rows = this.db.prepare("DELETE FROM events WHERE session_id = ? AND sequence < ? RETURNING LENGTH(CAST(frame_json AS BLOB)) AS bytes").all(sessionId, sequence) as Row[];
		let freed = 0;
		for (const row of rows) {
			const bytes = row.bytes;
			if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) throw new DurableStoreSchemaError("Invalid deleted journal bytes");
			freed += bytes;
		}
		return freed;
	}

	/** Mark work interrupted by a previous owner as unknown; never retry it. */
	recoverPending(): void {
		this.transaction(() => {
			const timestamp = nowIso();
			const unfinished = this.db.prepare("SELECT DISTINCT session_id FROM commands WHERE status IN ('claimed', 'acknowledged')").all() as Row[];
			this.db.prepare("UPDATE commands SET status = 'outcome_unknown', updated_at = ? WHERE status IN ('claimed', 'acknowledged')").run(timestamp);
			// A turn whose start Cedia never saw is pending work: it is paused for an explicit
			// Continue instead of being replayed. A turn that was already running when the owner
			// stopped has an unknown outcome, and only evidence - never a guess - may settle it.
			this.db.prepare("UPDATE turn_intents SET state = 'needs_continue', reason = ?, updated_at = ? WHERE state IN ('prepared', 'queued')").run(
				"Cedia stopped before OMP reported this turn starting. Continue explicitly; Cedia does not replay it.",
				timestamp,
			);
			this.db.prepare("UPDATE turn_intents SET state = 'outcome_unknown', reason = ?, updated_at = ? WHERE state = 'running'").run(
				"Cedia stopped while this turn was running and OMP reported no end for it. The outcome is unknown.",
				timestamp,
			);
			this.db.prepare("UPDATE sessions SET status = 'recovery_required', updated_at = ? WHERE status = 'running'").run(timestamp);
			for (const row of unfinished) {
				const sessionId = row.session_id;
				if (typeof sessionId !== "string") throw new DurableStoreSchemaError("Invalid command session id during recovery");
				this.db.prepare("UPDATE sessions SET status = 'recovery_required', updated_at = ? WHERE id = ?").run(timestamp, sessionId);
			}
		});
	}
}

function initializeSchema(db: DatabaseSync, journalPath: string): void {
	// The backup runs before the migration transaction: a checkpoint taken inside a write
	// transaction is a no-op, which would leave the copy missing everything the WAL still held.
	const existing = readRecordedSchemaVersion(db);
	if (existing !== undefined && existing < DURABLE_STORE_SCHEMA_VERSION) backupBeforeMigration(db, journalPath, existing);
	db.exec("BEGIN IMMEDIATE");
	try {
		db.exec(SCHEMA_SQL);
		const row = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as Row | undefined;
		if (!row) {
			db.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', ?)").run(String(DURABLE_STORE_SCHEMA_VERSION));
		} else {
			const value = row.value;
			if (typeof value !== "string" || !/^\d+$/.test(value)) throw new DurableStoreSchemaError("Invalid schema version metadata");
			const version = Number(value);
			if (!Number.isSafeInteger(version) || version < 1) throw new DurableStoreSchemaError(`Invalid schema version metadata: ${value}`);
			if (version > DURABLE_STORE_SCHEMA_VERSION) {
				throw new DurableStoreSchemaError(`State schema ${version} is newer than supported schema ${DURABLE_STORE_SCHEMA_VERSION}`);
			}
			// Version 1 is the initial schema; version 2 added the pinned session field.
			// Every accepted upgrade is explicit so a partially understood database is
			// never silently treated as the current schema.
			if (version === 1) {
				const columns = db.prepare("PRAGMA table_info(sessions)").all() as Row[];
				if (!columns.some(column => column.name === "pinned")) db.exec("ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))");
			}
			if (version > DURABLE_STORE_SCHEMA_VERSION) {
				throw new DurableStoreSchemaError(`Unsupported state schema ${version}`);
			}
			// `drafts` gained its cross-window payload column while the schema version was
			// already 3, so a state directory written by that intermediate build is
			// repaired here instead of failing every draft read.
			const draftColumns = db.prepare("PRAGMA table_info(drafts)").all() as Row[];
			if (draftColumns.length > 0 && !draftColumns.some(column => column.name === "content_json")) db.exec("ALTER TABLE drafts ADD COLUMN content_json TEXT");
			// Version 3 added the shared-draft submission reservation, version 4 the turn intents
			// of §2.4, version 5 the model a turn actually ran on, and version 6 the durable
			// workspace/cleanup projection of §2.6. Every column and table these added is either
			// created above or repaired below, so an older state directory only needs its recorded
			// version advanced.
			const turnColumns = db.prepare("PRAGMA table_info(turn_intents)").all() as Row[];
			if (turnColumns.length > 0 && !turnColumns.some(column => column.name === "model")) db.exec("ALTER TABLE turn_intents ADD COLUMN model TEXT");
			if (turnColumns.length > 0 && !turnColumns.some(column => column.name === "thinking_level")) db.exec("ALTER TABLE turn_intents ADD COLUMN thinking_level TEXT");
			const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as Row[];
			const sessionColumnNames = new Set(sessionColumns.map(column => column.name));
			const workspaceColumns: ReadonlyArray<[string, string]> = [
				["workspace_task_id", "TEXT"],
				["workspace_project_id", "TEXT"],
				["workspace_repository_id", "TEXT"],
				["workspace_root", "TEXT"],
				["workspace_actual_cwd", "TEXT"],
				["workspace_source_commit", "TEXT"],
				["workspace_task_branch", "TEXT"],
				["integration_target_ref", "TEXT"],
				["integration_target_commit", "TEXT"],
				["integration_observed_commit", "TEXT"],
				["restoration_ref", "TEXT"],
				["restoration_sha", "TEXT"],
				["cleanup_generation", "INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_generation >= 0)"],
				["cleanup_state", "TEXT NOT NULL DEFAULT 'retained' CHECK (cleanup_state IN ('retained', 'archive_requested', 'prepared', 'removed'))"],
				["cleanup_last_failure", "TEXT"],
			];
			for (const [name, definition] of workspaceColumns) {
				if (!sessionColumnNames.has(name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${definition}`);
			}
			// Existing task rows predate the workspace projection.  Their sidecar identity may
			// be unavailable, but the row still has enough durable identity to seed the
			// migration without guessing a repository, branch or commit.  Keep the update
			// idempotent so reopening a partially upgraded state directory is harmless.
			db.exec("UPDATE sessions SET workspace_task_id = id WHERE workspace_task_id IS NULL");
			db.exec("UPDATE sessions SET workspace_project_id = project_id WHERE workspace_project_id IS NULL");
			db.exec("UPDATE sessions SET workspace_actual_cwd = cwd WHERE workspace_actual_cwd IS NULL");
			if (version <= 5) db.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run(String(DURABLE_STORE_SCHEMA_VERSION));
		}
		db.exec("COMMIT");
	} catch (error) {
		try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
		throw error;
	}
}

/**
 * Keep the state a schema upgrade started from.
 *
 * The copy lands beside the journal in the private state directory, named for the schema
 * version it holds, and is written to a temporary name first so an interrupted copy can never
 * be read as a backup. An existing backup of that version is left alone: it is evidence of
 * what the owner actually had, not scratch space.
 */
function backupBeforeMigration(db: DatabaseSync, journalPath: string, version: number): void {
	const path = `${journalPath}.schema-${version}.backup`;
	if (existsSync(path)) return;
	const temporary = `${path}.${randomUUID()}.tmp`;
	// Checkpoint first so the copy on disk is the whole state, not a WAL fragment of it. This
	// process already owns the store, so nothing else can be writing while the copy is made.
	try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* the copy below is still the best available state */ }
	copyFileSync(journalPath, temporary);
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
}

/** The schema version a state file records, or `undefined` for a state file with no metadata. */
function readRecordedSchemaVersion(db: DatabaseSync): number | undefined {
	let row: Row | undefined;
	try {
		row = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as Row | undefined;
	} catch {
		return undefined;
	}
	if (row === undefined || row === null) return undefined;
	const value = row.value;
	if (typeof value !== "string" || !/^\d+$/.test(value)) throw new DurableStoreSchemaError("Invalid schema version metadata");
	const version = Number(value);
	if (!Number.isSafeInteger(version) || version < 1) throw new DurableStoreSchemaError(`Invalid schema version metadata: ${value}`);
	return version;
}

function canonicalProjectPath(input: unknown): string {
	const supplied = requireString(input, "project path", 16_384);
	try {
		return realpathSync(supplied);
	} catch (error) {
		throw new DurableStoreError("project-path", `Project path must resolve to an existing path: ${supplied}`, error);
	}
}

function isUniqueConstraint(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const code = String((error as { code?: unknown }).code ?? "");
	const message = String((error as { message?: unknown }).message ?? "");
	return code === "SQLITE_CONSTRAINT_UNIQUE" || message.toUpperCase().includes("UNIQUE CONSTRAINT");
}

function isForeignKeyConstraint(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const code = String((error as { code?: unknown }).code ?? "");
	const message = String((error as { message?: unknown }).message ?? "");
	return code === "SQLITE_CONSTRAINT_FOREIGNKEY" || code.endsWith("_FOREIGNKEY") || message.toLowerCase().includes("foreign key");
}

function isTerminalCommandStatus(status: CommandStatus): boolean {
	return status === "completed" || status === "failed" || status === "outcome_unknown" || status === "not_dispatched";
}

/**
 * A finished turn is proven finished. `needs_continue` and `outcome_unknown` stay open on
 * purpose: a late OMP frame or an explicit reconciliation may still resolve them, and until
 * something proves otherwise the honest answer is "Cedia does not know".
 */
function isFinishedTurnState(state: TurnState): boolean {
	return state === "completed" || state === "failed" || state === "cancelled";
}

function isAllowedCommandTransition(current: CommandStatus, next: CommandStatus): boolean {
	if (current === "claimed") return next === "acknowledged" || isTerminalCommandStatus(next);
	if (current === "acknowledged") return next === "completed" || next === "failed" || next === "outcome_unknown" || next === "not_dispatched";
	return false;
}

/** IDs also become session filenames and must remain a single bounded path segment. */
function createEntityId(value: unknown): string {
	if (value === undefined) return randomUUID();
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new TypeError("Invalid entity id");
	return value;
}
