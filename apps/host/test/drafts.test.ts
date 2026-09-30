import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DraftConflictError, DraftStore } from "../src/drafts.ts";
import { DurableStore } from "../src/store.ts";

const stores: DurableStore[] = [];
const directories: string[] = [];

function fixture(): DraftStore {
	const directory = mkdtempSync(join(tmpdir(), "cedia-drafts-"));
	directories.push(directory);
	const durable = DurableStore.open({ stateDir: directory, recover: false });
	stores.push(durable);
	return new DraftStore(durable);
}

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("creates revisioned drafts, round-trips attachments, and rejects invalid patches", () => {
	const drafts = fixture();
	const attachment = { id: "image-1", name: "screen.png", kind: "image" as const, byteLength: 12 };
	const created = drafts.patch("mac", "task-1", { expectedRevision: 0, text: "hello", attachments: [attachment], sessionId: "session-1" });
	expect(created.revision).toBe(1);
	expect(created.attachments).toEqual([attachment]);
	expect(drafts.read("mac", "task-1")).toEqual(created);

	const edited = drafts.patch("mac", "task-1", { expectedRevision: 1, text: "hello again", attachments: [attachment] });
	expect(edited.revision).toBe(2);
	expect(() => drafts.patch("mac", "task-1", { expectedRevision: 1, text: "stale" })).toThrow(DraftConflictError);
	expect(() => drafts.patch("mac", "task-2", { expectedRevision: 0, text: "x", attachments: [{ id: "a", kind: "unknown" as "image" }] })).toThrow(/kind/);
	expect(() => drafts.patch("mac", "task-2", { expectedRevision: 0, text: "x".repeat(262_145) })).toThrow(/text/);
	expect(() => drafts.patch("mac", "task-2", { expectedRevision: 0, text: "x", attachments: Array.from({ length: 33 }, (_, index) => ({ id: String(index), kind: "file" as const })) })).toThrow(/attachments/);
});

test("claims one submission per draft revision and detects payload conflicts", () => {
	const drafts = fixture();
	drafts.patch("mac", "task-1", { expectedRevision: 0, text: "send me" });
	const first = drafts.submit("mac", "task-1", { expectedRevision: 1, commandId: "cmd-1", payloadHash: "hash-a" });
	const duplicate = drafts.submit("mac", "task-1", { expectedRevision: 1, commandId: "cmd-1", payloadHash: "hash-a" });
	expect(first.created).toBe(true);
	expect(duplicate.created).toBe(false);
	expect(duplicate.submission).toEqual(first.submission);
	expect(() => drafts.submit("mac", "task-1", { expectedRevision: 1, commandId: "cmd-2", payloadHash: "hash-b" })).toThrow(DraftConflictError);
});

test("a delivered revision releases its submission claim for the next draft", () => {
	const drafts = fixture();
	drafts.patch("mac", "task-1", { expectedRevision: 0, text: "first send" });
	drafts.submit("mac", "task-1", { expectedRevision: 1, commandId: "cmd-1", payloadHash: "hash-a" });
	expect(drafts.clear("mac", "task-1", { expectedRevision: 1 })).toEqual({ cleared: true });
	// The next draft restarts at revision 1: the spent claim must not haunt it, or every
	// later Send on the task would refuse as a cross-window conflict.
	const next = drafts.patch("mac", "task-1", { expectedRevision: 0, text: "second send" });
	expect(next.revision).toBe(1);
	const reserved = drafts.submit("mac", "task-1", { expectedRevision: 1, commandId: "cmd-2", payloadHash: "hash-b" });
	expect(reserved.created).toBe(true);
	expect(reserved.submission.commandId).toBe("cmd-2");
	// A stale clear still leaves a live revision's claim alone.
	drafts.patch("mac", "task-1", { expectedRevision: 1, text: "second send edited" });
	drafts.submit("mac", "task-1", { expectedRevision: 2, commandId: "cmd-3", payloadHash: "hash-c" });
	expect(drafts.clear("mac", "task-1", { expectedRevision: 1 })).toMatchObject({ cleared: false });
	const reread = drafts.submit("mac", "task-1", { expectedRevision: 2, commandId: "cmd-3", payloadHash: "hash-c" });
	expect(reread.created).toBe(false);
	expect(reread.submission.commandId).toBe("cmd-3");
});

test("clear uses compare-and-delete semantics", () => {
	const drafts = fixture();
	drafts.patch("mac", "task-1", { expectedRevision: 0, text: "first" });
	drafts.patch("mac", "task-1", { expectedRevision: 1, text: "second" });
	const stale = drafts.clear("mac", "task-1", { expectedRevision: 1 });
	expect(stale).toMatchObject({ cleared: false, draft: { revision: 2, text: "second" } });
	const cleared = drafts.clear("mac", "task-1", { expectedRevision: 2 });
	expect(cleared).toEqual({ cleared: true });
	expect(drafts.read("mac", "task-1")).toBeUndefined();
});

test("imports each draft id once and preserves the first copy", () => {
	const drafts = fixture();
	const first = drafts.import("mac", [{ draftId: "legacy", text: "first", source: "legacy-profile" }]);
	const second = drafts.import("mac", [{ draftId: "legacy", text: "replacement", source: "extension" }, { draftId: "new", text: "new", source: "extension" }]);
	expect(first).toEqual({ imported: 1, skipped: 0 });
	expect(second).toEqual({ imported: 1, skipped: 1 });
	expect(drafts.read("mac", "legacy")).toMatchObject({ text: "first", source: "legacy-profile", revision: 1 });
});

test("round-trips the shared cross-window payload and keeps it when a patch omits it", () => {
	const drafts = fixture();
	const payload = { draft: { text: "shared draft", attachments: [{ id: "a" }] }, draftThread: { projectId: "p1" }, projectMappings: { p1: "task-1" } };
	const created = drafts.patch("mac", "task-1", { expectedRevision: 0, text: "shared draft", content: payload });
	expect(created.content).toEqual(payload);
	expect(drafts.read("mac", "task-1")?.content).toEqual(payload);

	// A patch that only touches the readable text must not erase the other window's payload.
	const textOnly = drafts.patch("mac", "task-1", { expectedRevision: 1, text: "renamed" });
	expect(textOnly.revision).toBe(2);
	expect(textOnly.content).toEqual(payload);

	const replaced = drafts.patch("mac", "task-1", { expectedRevision: 2, text: "renamed", content: { draft: { text: "second" } } });
	expect(replaced.content).toEqual({ draft: { text: "second" } });
});

test("bounds the shared payload and reports an unserializable one", () => {
	const drafts = fixture();
	expect(() => drafts.patch("mac", "task-1", { expectedRevision: 0, text: "x", content: "y".repeat(2 * 1024 * 1024 + 1) })).toThrow(/content/);
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	expect(() => drafts.patch("mac", "task-1", { expectedRevision: 0, text: "x", content: cyclic as never })).toThrow(/JSON-serializable/);
	expect(drafts.read("mac", "task-1")).toBeUndefined();
});

test("import carries the legacy payload too", () => {
	const drafts = fixture();
	const payload = { draft: { text: "legacy shared" } };
	drafts.import("mac", [{ draftId: "legacy", text: "legacy shared", source: "agent-ui", content: payload }]);
	expect(drafts.read("mac", "legacy")).toMatchObject({ text: "legacy shared", content: payload, revision: 1 });
});
