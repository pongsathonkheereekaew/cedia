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
	existsSync,
	lstatSync,
	mkdirSync,
	realpathSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
	Command,
	CommandStatus,
	EventPage,
	Json,
	Project,
	Session,
	SessionEvent,
} from "../../../packages/protocol/src/index.ts";

/** Current on-disk schema. Newer versions are refused rather than guessed. */
export const DURABLE_STORE_SCHEMA_VERSION = 2 as const;
export const DEFAULT_EVENT_PAGE_SIZE = 200 as const;
export const MAX_EVENT_PAGE_SIZE = 1_000 as const;
export const DEFAULT_COMMAND_PAGE_SIZE = 100 as const;
export const MAX_COMMAND_PAGE_SIZE = 10_000 as const;

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
	return {
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
  updated_at TEXT NOT NULL
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
			initializeSchema(db);
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
			? this.db.prepare(`SELECT id, project_id, title, cwd, session_file, incarnation, status, pinned, archived, created_at, updated_at FROM sessions ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY pinned DESC, updated_at DESC, id DESC`).all()
			: this.db.prepare(`SELECT id, project_id, title, cwd, session_file, incarnation, status, pinned, archived, created_at, updated_at FROM sessions WHERE project_id = ? ${includeArchived ? "" : "AND archived = 0"} ORDER BY pinned DESC, updated_at DESC, id DESC`).all(projectId);
		return rows.map(row => sessionFromRow(row as Row));
	}

	getSession(id: string): Session | undefined {
		this.assertOpen();
		const sessionId = requireString(id, "sessionId");
		const row = this.db.prepare("SELECT id, project_id, title, cwd, session_file, incarnation, status, pinned, archived, created_at, updated_at FROM sessions WHERE id = ?").get(sessionId) as Row | undefined;
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
				this.db.prepare("INSERT INTO sessions (id, project_id, title, cwd, session_file, incarnation, status, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
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
			this.db.prepare("UPDATE sessions SET title = ?, cwd = ?, session_file = ?, incarnation = ?, status = ?, archived = ?, pinned = ?, updated_at = ? WHERE id = ?").run(
				title,
				cwd,
				sessionFile,
				incarnation,
				status,
				boolToSql(archived),
				boolToSql(pinned),
				nowIso(),
				sessionId,
			);
			return this.getSessionOrThrow(sessionId);
		});
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
			this.db.prepare("UPDATE sessions SET status = 'recovery_required', updated_at = ? WHERE status = 'running'").run(timestamp);
			for (const row of unfinished) {
				const sessionId = row.session_id;
				if (typeof sessionId !== "string") throw new DurableStoreSchemaError("Invalid command session id during recovery");
				this.db.prepare("UPDATE sessions SET status = 'recovery_required', updated_at = ? WHERE id = ?").run(timestamp, sessionId);
			}
		});
	}
}

function initializeSchema(db: DatabaseSync): void {
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
			// Version 1 is the initial schema. Future migrations must be explicit
			// here rather than silently accepting a partially understood database.
			if (version === 1) {
                db.exec("ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))");
                db.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run(String(DURABLE_STORE_SCHEMA_VERSION));
            }
		}
		db.exec("COMMIT");
	} catch (error) {
		try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
		throw error;
	}
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
