import { afterEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
	DurableStore,
	DurableStoreCommandConflictError,
	DurableStoreCommandTransitionError,
	DurableStoreOwnershipError,
	DurableStoreSchemaError,
	MAX_EVENT_PAGE_SIZE,
	MAX_SESSION_EVENTS,
	MAX_SESSION_EVENT_BYTES,
	canonicalizeJson,
	commandPayloadHash,
} from "../src/store.ts";
import type { Json } from "../../../packages/protocol/src/index.ts";

const stores: DurableStore[] = [];
const temporaryDirectories: string[] = [];

function temporaryStore(recover = true): { dir: string; store: DurableStore } {
	const dir = mkdtempSync(join(tmpdir(), "cedia-host-store-"));
	temporaryDirectories.push(dir);
	const store = DurableStore.open({ stateDir: dir, recover });
	stores.push(store);
	return { dir, store };
}

function projectDirectory(root: string, name: string): string {
	const path = join(root, name);
	// The test process owns this temporary tree; creating project roots models a
	// non-Git project without making Git itself part of the store contract.
	mkdirSync(path, { recursive: true });
	return path;
}

function waitForOutput(process: ReturnType<typeof spawn>, expected: RegExp, timeoutMs = 2_000): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = (error?: Error) => {
			if (timer) clearTimeout(timer);
			process.stdout?.off("data", onData);
			process.stderr?.off("data", onData);
			if (error) reject(error); else resolve(output);
		};
		const onData = (chunk: Buffer | string) => {
			output += String(chunk);
			if (expected.test(output)) done();
		};
		process.stdout?.on("data", onData);
		process.stderr?.on("data", onData);
		process.once("error", error => done(error));
		timer = setTimeout(() => done(new Error(`Timed out waiting for ${expected}: ${output}`)), timeoutMs);
	});
}

function waitForExit(process: ReturnType<typeof spawn>, timeoutMs = 2_000): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("child process did not exit")), timeoutMs);
		process.once("exit", () => { clearTimeout(timer); resolve(); });
		process.once("error", error => { clearTimeout(timer); reject(error); });
	});
}

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("DurableStore", () => {
	it("creates a private state directory and durable WAL/full-sync databases", () => {
		const { dir, store } = temporaryStore(false);
		const stateMode = statSync(dir).mode & 0o777;
		const journalMode = statSync(store.paths.journalPath).mode & 0o777;
		const lockMode = statSync(store.paths.ownerLockPath).mode & 0o777;
		expect(stateMode).toBe(0o700);
		expect(journalMode).toBe(0o600);
		expect(lockMode).toBe(0o600);
	});

	it("uses realpath uniqueness for Git and non-Git project roots and supports pin/archive CRUD", () => {
		const { dir, store } = temporaryStore(false);
		const root = projectDirectory(dir, "plain-project");
		const project = store.createProject({ path: root, name: "Plain", pinned: true });
		expect(project.path).toBe(realpathSync(root));
		expect(store.getProject(project.id)).toEqual(project);
		expect(store.listProjects()).toEqual([project]);
		expect(store.updateProject(project.id, { pinned: false, archived: true, name: "Archived" })).toMatchObject({
		id: project.id,
		name: "Archived",
		pinned: false,
		archived: true,
	});
		expect(store.listProjects()).toEqual([]);
		expect(store.listProjects({ includeArchived: true })).toHaveLength(1);
		expect(() => store.createProject({ path: root })).toThrow(/already exists/);
	});

	it("keeps projects and sessions isolated, with UUID sessions and default durable files", () => {
		const { dir, store } = temporaryStore(false);
		const first = store.createProject({ path: projectDirectory(dir, "first") });
		const second = store.createProject({ path: projectDirectory(dir, "second") });
		const firstSession = store.createSession({ projectId: first.id, title: "One" });
		const secondSession = store.createSession({ projectId: second.id, title: "Two" });
		expect(firstSession.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(firstSession.projectId).toBe(first.id);
		expect(firstSession.sessionFile).toContain(join(dir, "sessions"));
		expect(store.listSessions(first.id)).toEqual([firstSession]);
		expect(store.listSessions(second.id)).toEqual([secondSession]);
		expect(store.updateSession(firstSession.id, { status: "running", archived: true }).status).toBe("running");
		expect(store.listSessions(first.id)).toEqual([]);
		expect(store.listSessions(first.id, { includeArchived: true })).toHaveLength(1);
	});

	it("deletes a session row with its commands and events, and refuses an unknown id", () => {
		const { dir, store } = temporaryStore(false);
		const project = store.createProject({ path: projectDirectory(dir, "delete-project") });
		const session = store.createSession({ projectId: project.id, incarnation: "inc-1" });
		store.claimCommand({ sessionId: session.id, commandId: "cmd", deviceId: "mac", incarnation: "inc-1", kind: "prompt", payload: {} });
		store.appendEvent(session.id, "inc-1", { type: "agent_start" });
		expect(store.listCommands(session.id).length).toBe(1);
		expect(store.readEvents(session.id, 0, 10).events.length).toBe(1);
		store.deleteSession(session.id);
		expect(store.getSession(session.id)).toBeUndefined();
		expect(store.listSessions(project.id, { includeArchived: true })).toEqual([]);
		// The row is gone for every reader...
		expect(() => store.listCommands(session.id)).toThrow(/not found/i);
		expect(() => store.readEvents(session.id, 0, 10)).toThrow(/not found/i);
		// ...and the foreign keys took its commands and events with it, so nothing is
		// left pointing at an id no session owns.
		const probe = new DatabaseSync(store.paths.journalPath);
		try {
			expect(probe.prepare("SELECT COUNT(*) AS count FROM commands").get()).toMatchObject({ count: 0 });
			expect(probe.prepare("SELECT COUNT(*) AS count FROM events").get()).toMatchObject({ count: 0 });
		} finally { probe.close(); }
		expect(() => store.deleteSession(session.id)).toThrow(/not found/i);
	});

	it("claims atomically, canonicalizes payload ordering, and rejects identity conflicts or unsafe JSON", () => {
		const { dir, store } = temporaryStore(false);
		const project = store.createProject({ path: projectDirectory(dir, "project") });
		const session = store.createSession({ projectId: project.id, incarnation: "inc-1" });
		const first = store.claimCommand({ sessionId: session.id, commandId: "same", deviceId: "phone", incarnation: "inc-1", kind: "prompt", payload: { z: 1, a: [true, null] } });
		const duplicate = store.claimCommand({ sessionId: session.id, commandId: "same", deviceId: "phone", incarnation: "inc-1", kind: "prompt", payload: { a: [true, null], z: 1 } });
		expect(first.created).toBe(true);
		expect(duplicate.created).toBe(false);
		expect(duplicate.command.payloadHash).toBe(first.command.payloadHash);
		expect(() => store.claimCommand({ sessionId: session.id, commandId: "same", deviceId: "tablet", incarnation: "inc-1", kind: "prompt", payload: { z: 1, a: [true, null] } })).toThrow(DurableStoreCommandConflictError);
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(() => canonicalizeJson(cycle)).toThrow(/cycle/);
		expect(() => canonicalizeJson({ value: Number.NaN })).toThrow(/finite/);
		expect(canonicalizeJson(JSON.parse('{"__proto__": {"polluted": true}}'))).toBe('{"__proto__":{"polluted":true}}');
		expect(commandPayloadHash({ deviceId: "phone", incarnation: "inc-1", kind: "prompt", payload: { a: 1 } })).toBe(commandPayloadHash({ deviceId: "phone", incarnation: "inc-1", kind: "prompt", payload: { a: 1 } }));
	});

	it("persists claim before dispatch, keeps ACK separate from completion, and freezes terminal state", () => {
		const { dir, store } = temporaryStore(false);
		const project = store.createProject({ path: projectDirectory(dir, "project") });
		const session = store.createSession({ projectId: project.id, incarnation: "inc-1" });
		const claimed = store.claimCommand({ sessionId: session.id, commandId: "command", deviceId: "mac", incarnation: "inc-1", kind: "prompt", payload: {} }).command;
		expect(claimed.status).toBe("claimed");
		const acknowledged = store.transitionCommand(session.id, claimed.commandId, "acknowledged", { ack: { accepted: true } });
		expect(acknowledged.status).toBe("acknowledged");
		expect(acknowledged.ack).toEqual({ accepted: true });
		expect(acknowledged.result).toBeUndefined();
		const completed = store.transitionCommand(session.id, claimed.commandId, "completed", { result: { done: true } });
		expect(completed.status).toBe("completed");
		expect(() => store.transitionCommand(session.id, claimed.commandId, "failed", { error: "too late" })).toThrow(DurableStoreCommandTransitionError);
		expect(store.listCommands(session.id, 10)[0]).toEqual(completed);
		const notDispatched = store.claimCommand({ sessionId: session.id, commandId: "queued", deviceId: "mac", incarnation: "inc-1", kind: "prompt", payload: {} }).command;
		expect(store.transitionCommand(session.id, notDispatched.commandId, "not_dispatched", { error: "busy" }).status).toBe("not_dispatched");
	});

	it("recovers unfinished commands and running sessions after reopen, without retrying them", () => {
		const { dir, store } = temporaryStore(false);
		const project = store.createProject({ path: projectDirectory(dir, "project") });
		const session = store.createSession({ projectId: project.id, incarnation: "inc-1", status: "running" });
		const command = store.claimCommand({ sessionId: session.id, commandId: "pending", deviceId: "mac", incarnation: "inc-1", kind: "prompt", payload: {} }).command;
		expect(store.listPendingCommands(session.id).map(item => item.commandId)).toEqual([command.commandId]);
		store.transitionCommand(session.id, command.commandId, "acknowledged", { ack: { id: "ack" } });
		store.close();
		stores.splice(stores.indexOf(store), 1);
		const reopened = DurableStore.open({ stateDir: dir });
		stores.push(reopened);
		expect(reopened.getCommand(session.id, command.commandId)?.status).toBe("outcome_unknown");
		expect(reopened.getSession(session.id)?.status).toBe("recovery_required");
		expect(() => reopened.transitionCommand(session.id, command.commandId, "completed", { result: { replay: true } })).toThrow(DurableStoreCommandTransitionError);
		const repaired = reopened.updateSession(session.id, { status: "stopped" });
		reopened.recoverPending();
		expect(reopened.getSession(session.id)).toEqual(repaired);
	});

	it("appends ordered per-session events and provides bounded cursor pagination", () => {
		const { dir, store } = temporaryStore(false);
		const project = store.createProject({ path: projectDirectory(dir, "project") });
		const one = store.createSession({ projectId: project.id, incarnation: "inc-1" });
		const two = store.createSession({ projectId: project.id, incarnation: "inc-2" });
		for (let i = 0; i < 5; i += 1) store.appendEvent(one.id, "inc-1", { index: i });
		store.appendEvent(two.id, "inc-2", { index: 99 });
		const first = store.readEvents(one.id, 0, 2);
		expect(first.events.map(event => event.sequence)).toEqual([1, 2]);
		expect(first.cursor).toBe(2);
		expect(first.hasMore).toBe(true);
		const second = store.readEvents(one.id, first.cursor, 2);
		expect(second.events.map(event => event.sequence)).toEqual([3, 4]);
		const third = store.readEvents(one.id, second.cursor, 2);
		expect(third.events.map(event => event.sequence)).toEqual([5]);
		expect(third.hasMore).toBe(false);
		expect(store.readEvents(two.id)).toMatchObject({ events: [{ sequence: 1, frame: { index: 99 } }] });
	});

	it("drops the oldest events and reports truncation when a session's journal exceeds the count cap", () => {
		const { store } = temporaryStore(false);
		const project = store.createProject({ path: projectDirectory(store.paths.stateDir, "retention-project") });
		const session = store.createSession({ projectId: project.id, incarnation: "inc-1" });
		// A journal can outgrow the cap before this host ever appends to it: an older
		// build wrote it, or a fork hydrated a long transcript into it. Seeding the
		// fixture directly reaches that state without 20k commits in the test.
		const seed = new DatabaseSync(store.paths.journalPath);
		try {
			seed.exec("BEGIN IMMEDIATE");
			const insert = seed.prepare("INSERT INTO events (session_id, incarnation, sequence, timestamp, frame_json) VALUES (?, 'inc-1', ?, '2026-01-01T00:00:00.000Z', ?)");
			for (let sequence = 1; sequence <= MAX_SESSION_EVENTS; sequence += 1) insert.run(session.id, sequence, JSON.stringify({ index: sequence - 1 }));
			seed.exec("COMMIT");
		} finally { seed.close(); }

		const appended = store.appendEvent(session.id, "inc-1", { index: MAX_SESSION_EVENTS });
		expect(appended.sequence).toBe(MAX_SESSION_EVENTS + 1);
		// The oldest frame is gone and the session says so to every reader, including
		// one at `after: 0` that would otherwise read a short journal as the whole task.
		const oldest = store.readEvents(session.id, 0, 5);
		expect(oldest.events.map(event => event.sequence)).toEqual([2, 3, 4, 5, 6]);
		expect(oldest).toMatchObject({ cursor: 6, hasMore: true, firstSequence: 2, historyTruncated: true });
		// A client whose cursor is inside the dropped range is told the same thing
		// instead of being handed an empty page it could mistake for the end.
		const behind = store.readEvents(session.id, 1, 5);
		expect(behind.events.map(event => event.sequence)).toEqual([2, 3, 4, 5, 6]);
		expect(behind).toMatchObject({ cursor: 6, firstSequence: 2, historyTruncated: true });
		// Oldest-first pagination still walks the retained journal exactly once.
		const walked: number[] = [];
		let cursor = 0;
		for (;;) {
			const page = store.readEvents(session.id, cursor, 1_000);
			walked.push(...page.events.map(event => event.sequence));
			cursor = page.cursor;
			if (!page.hasMore) break;
		}
		expect(walked).toHaveLength(MAX_SESSION_EVENTS);
		expect(walked[0]).toBe(2);
		expect(walked.at(-1)).toBe(MAX_SESSION_EVENTS + 1);
		expect(walked.every((sequence, index) => index === 0 || sequence === walked[index - 1]! + 1)).toBe(true);
		expect(store.readEvents(session.id, cursor, 1_000)).toMatchObject({ events: [], cursor: MAX_SESSION_EVENTS + 1, hasMore: false, firstSequence: 2, historyTruncated: true });
		// The newest frame - the one just appended - survived the cut.
		expect(store.readEvents(session.id, MAX_SESSION_EVENTS, 5)).toMatchObject({ events: [{ sequence: MAX_SESSION_EVENTS + 1, frame: { index: MAX_SESSION_EVENTS } }] });
	});

	it("keeps the newest frames and stops at the byte cap", () => {
		const { store } = temporaryStore(false);
		const project = store.createProject({ path: projectDirectory(store.paths.stateDir, "retention-bytes-project") });
		const session = store.createSession({ projectId: project.id, incarnation: "inc-1" });
		// 1 MiB frames are the shape a fork hydration has: 40 of them need more bytes
		// than the cap holds, so retention has to cut into the middle of the journal.
		const frames = Array.from({ length: 40 }, (_unused, index) => ({ type: "cedia_hydration", text: "x".repeat(1_000_000), index: index + 1 }));
		const sizes = frames.map(frame => Buffer.byteLength(canonicalizeJson(frame), "utf8"));
		expect(sizes.reduce((sum, size) => sum + size, 0)).toBeGreaterThan(MAX_SESSION_EVENT_BYTES);
		for (const frame of frames) store.appendEvent(session.id, "inc-1", frame);

		// What retention must leave behind: the largest suffix of the journal that fits
		// under the byte cap, which is the newest frames and nothing older.
		let kept = 0;
		let keptBytes = 0;
		for (let index = sizes.length - 1; index >= 0; index -= 1) {
			const size = sizes[index]!;
			if (keptBytes + size > MAX_SESSION_EVENT_BYTES) break;
			keptBytes += size;
			kept += 1;
		}
		expect(kept).toBeGreaterThan(1);
		expect(kept).toBeLessThan(frames.length);
		const firstSequence = frames.length - kept + 1;
		const probe = new DatabaseSync(store.paths.journalPath);
		try {
			expect(probe.prepare("SELECT COUNT(*) AS count, MIN(sequence) AS first, COALESCE(SUM(LENGTH(CAST(frame_json AS BLOB))), 0) AS bytes FROM events WHERE session_id = ?").get(session.id)).toEqual({
				count: kept,
				first: firstSequence,
				bytes: keptBytes,
			});
		} finally { probe.close(); }
		const page = store.readEvents(session.id, 0, MAX_EVENT_PAGE_SIZE);
		expect(page.historyTruncated).toBe(true);
		expect(page.firstSequence).toBe(firstSequence);
		expect(page.events[0]!.sequence).toBe(firstSequence);
		expect(page.events.at(-1)!.sequence).toBe(frames.length);
		// The newest frame is readable through the cursor a client at the tail holds.
		expect(store.readEvents(session.id, frames.length - 1, 5)).toMatchObject({ events: [{ frame: { index: frames.length } }] });
	});

	it("reports no truncation for a session that stays inside retention", () => {
		const { store } = temporaryStore(false);
		const project = store.createProject({ path: projectDirectory(store.paths.stateDir, "retained-project") });
		const session = store.createSession({ projectId: project.id, incarnation: "inc-1" });
		store.appendEvent(session.id, "inc-1", { index: 0 });
		store.appendEvent(session.id, "inc-1", { index: 1 });
		expect(store.readEvents(session.id)).toMatchObject({ firstSequence: 1, historyTruncated: false });
		expect(store.readEvents(session.id, 2)).toMatchObject({ events: [], cursor: 2, hasMore: false, firstSequence: 1, historyTruncated: false });
		// A session that never had an event is not truncated either.
		const empty = store.createSession({ projectId: project.id, incarnation: "inc-2" });
		expect(store.readEvents(empty.id)).toMatchObject({ events: [], cursor: 0, hasMore: false, firstSequence: 0, historyTruncated: false });
	});

	it("keeps a raw frame's own prototype-named keys intact in the journal", () => {
		const { store } = temporaryStore(false);
		const project = store.createProject({ path: projectDirectory(store.paths.stateDir, "prototype-project") });
		const session = store.createSession({ projectId: project.id, incarnation: "prototype-incarnation" });
		const frame = JSON.parse('{"type":"future_event","__proto__":{"injected":true},"nested":{"__proto__":{"value":1}}}') as Json;

		const appended = store.appendEvent(session.id, session.incarnation, frame);
		expect(Object.hasOwn(appended.frame as Record<string, unknown>, "__proto__")).toBe(true);
		expect((appended.frame as Record<string, unknown>)["__proto__"]).toEqual({ injected: true });
		expect(Object.getPrototypeOf(appended.frame)).toBe(Object.prototype);

		const replayed = store.readEvents(session.id).events[0]!.frame as Record<string, unknown>;
		expect(Object.hasOwn(replayed, "__proto__")).toBe(true);
		expect(replayed["__proto__"]).toEqual({ injected: true });
		expect((replayed.nested as Record<string, unknown>)["__proto__"]).toEqual({ value: 1 });
	});

	it("refuses a newer schema version before serving state", () => {
		const { dir, store } = temporaryStore(false);
		store.close();
		stores.splice(stores.indexOf(store), 1);
		const databasePath = join(dir, "journal.sqlite");
		const database = new DatabaseSync(databasePath);
		database.exec("UPDATE metadata SET value = '999' WHERE key = 'schema_version'");
		database.close();
		expect(() => DurableStore.open({ stateDir: dir, recover: false })).toThrow(DurableStoreSchemaError);
	});

	it("migrates a schema-1 journal by adding the pinned session field without losing rows", () => {
		const dir = mkdtempSync(join(tmpdir(), "cedia-host-store-migrate-"));
		temporaryDirectories.push(dir);
		const projectPath = projectDirectory(dir, "legacy-project");
		const database = new DatabaseSync(join(dir, "journal.sqlite"));
		database.exec(`
			PRAGMA journal_mode=WAL;
			CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
			CREATE TABLE projects (
				id TEXT PRIMARY KEY NOT NULL,
				path TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
				archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
				created_at TEXT NOT NULL
			);
			CREATE TABLE sessions (
				id TEXT PRIMARY KEY NOT NULL,
				project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				title TEXT NOT NULL,
				cwd TEXT NOT NULL,
				session_file TEXT NOT NULL,
				incarnation TEXT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'stopped', 'recovery_required')),
				archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE commands (
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
			CREATE TABLE events (
				session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
				incarnation TEXT NOT NULL,
				sequence INTEGER NOT NULL CHECK (sequence > 0),
				timestamp TEXT NOT NULL,
				frame_json TEXT NOT NULL,
				PRIMARY KEY (session_id, sequence)
			);
		`);
		const projectId = "legacy-project-id";
		const sessionId = "legacy-session-id";
		const timestamp = "2026-09-12T00:00:00.000Z";
		database.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', '1')").run();
		database.prepare("INSERT INTO projects (id, path, name, pinned, archived, created_at) VALUES (?, ?, ?, 1, 0, ?)").run(projectId, projectPath, "Legacy", timestamp);
		database.prepare("INSERT INTO sessions (id, project_id, title, cwd, session_file, incarnation, status, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'legacy-incarnation', 'idle', 0, ?, ?)").run(sessionId, projectId, "Legacy task", projectPath, join(dir, "legacy.jsonl"), timestamp, timestamp);
		database.close();

		const store = DurableStore.open({ stateDir: dir, recover: false });
		stores.push(store);
		const migrated = store.getSession(sessionId);
		expect(migrated).toMatchObject({ id: sessionId, projectId, pinned: false, title: "Legacy task" });
		expect(store.updateSession(sessionId, { pinned: true }).pinned).toBe(true);
		store.close();
		stores.splice(stores.indexOf(store), 1);

		const reopenedDatabase = new DatabaseSync(join(dir, "journal.sqlite"));
		const columns = reopenedDatabase.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
		const schema = reopenedDatabase.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value: string };
		reopenedDatabase.close();
		expect(columns.map(column => column.name)).toContain("pinned");
		expect(schema.value).toBe("2");
	});

	it("enforces one host owner across processes and releases after a crash", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cedia-host-store-owner-"));
		temporaryDirectories.push(dir);
		const moduleUrl = pathToFileURL(join(import.meta.dir, "../src/store.ts")).href;
		const childScript = [
			`const { DurableStore } = await import(${JSON.stringify(moduleUrl)});`,
			`const stateDir = process.argv[1];`,
			`try { const store = DurableStore.open({ stateDir, recover: false }); console.log('READY'); setInterval(() => {}, 1000); }`,
			`catch (error) { console.log('ERROR:' + (error.code ?? error.message)); process.exitCode = 2; }`,
		].join(" ");
		const node = "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node";
		const child = spawn(node, ["--input-type=module", "-e", childScript, dir], { stdio: ["ignore", "pipe", "pipe"] });
		await waitForOutput(child, /READY/);
		expect(() => DurableStore.open({ stateDir: dir, recover: false })).toThrow(DurableStoreOwnershipError);
		child.kill("SIGKILL");
		await waitForExit(child);
		const afterCrash = DurableStore.open({ stateDir: dir, recover: false });
		stores.push(afterCrash);
		expect(afterCrash.paths.stateDir).toBe(dir);
	});
});
