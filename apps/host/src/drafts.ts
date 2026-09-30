import type { DraftAttachment, DraftSnapshot, DraftSubmission, Json } from "../../../packages/protocol/src/index.ts";
import {
	DurableStore,
	DurableStoreDraftConflictError,
	type DraftWriteResult,
	type ImportDraftEntry,
} from "./store.ts";

const MAX_TEXT_CHARS = 262_144;
const MAX_ATTACHMENTS = 32;
const MAX_ID_BYTES = 512;
const MAX_NAME_BYTES = 1_024;
const MAX_SOURCE_BYTES = 512;

export class DraftConflictError extends Error {
	readonly code = "draft_conflict";

	constructor(message = "Draft changed elsewhere; reload before applying this operation") {
		super(message);
		this.name = "DraftConflictError";
	}
}

export interface DraftPatchInput {
	expectedRevision: number;
	text: string;
	attachments?: readonly DraftAttachment[];
	/** The Mac windows' shared payload; opaque to the host and size-checked by the store. */
	content?: Json;
	sessionId?: string;
	source?: string;
}

export interface DraftSubmitInput {
	expectedRevision: number;
	commandId: string;
	payloadHash: string;
}

export interface DraftClearInput {
	expectedRevision: number;
}

function boundedString(value: unknown, label: string, maxBytes: number, allowEmpty = false): string {
	if (typeof value !== "string" || (!allowEmpty && value.length === 0) || Buffer.byteLength(value, "utf8") > maxBytes) throw new TypeError(`${label} is invalid`);
	return value;
}

function revision(value: unknown, label = "expectedRevision"): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
	return value as number;
}

function text(value: unknown): string {
	if (typeof value !== "string" || value.length > MAX_TEXT_CHARS) throw new TypeError(`draft text must be a string of at most ${MAX_TEXT_CHARS} characters`);
	return value;
}

function attachments(value: unknown): DraftAttachment[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw new TypeError(`draft attachments must contain at most ${MAX_ATTACHMENTS} entries`);
	return value.map((entry, index) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError(`draft attachment ${index} must be an object`);
		const item = entry as Record<string, unknown>;
		const id = boundedString(item.id, `draft attachment ${index} id`, MAX_ID_BYTES);
		if (item.kind !== "image" && item.kind !== "file" && item.kind !== "text") throw new TypeError(`draft attachment ${index} kind is invalid`);
		const result: DraftAttachment = { id, kind: item.kind };
		if (item.name !== undefined) (result as { name?: string }).name = boundedString(item.name, `draft attachment ${index} name`, MAX_NAME_BYTES);
		if (item.byteLength !== undefined) {
			if (!Number.isSafeInteger(item.byteLength) || (item.byteLength as number) < 0) throw new TypeError(`draft attachment ${index} byteLength is invalid`);
			(result as { byteLength?: number }).byteLength = item.byteLength as number;
		}
		return result;
	});
}

function source(value: unknown): string | undefined {
	return value === undefined ? undefined : boundedString(value, "draft source", MAX_SOURCE_BYTES);
}

function mapWrite(result: DraftWriteResult): DraftSnapshot {
	if (result.outcome === "conflict") throw new DraftConflictError("Draft changed elsewhere; reload before applying this patch");
	return result.draft;
}

export class DraftStore {
	constructor(private readonly store: DurableStore) {}

	read(deviceId: string, draftId: string): DraftSnapshot | undefined {
		return this.store.readDraft(boundedString(deviceId, "deviceId", MAX_ID_BYTES), boundedString(draftId, "draftId", MAX_ID_BYTES));
	}

	patch(deviceId: string, draftId: string, input: DraftPatchInput): DraftSnapshot {
		const normalizedDeviceId = boundedString(deviceId, "deviceId", MAX_ID_BYTES);
		const normalizedDraftId = boundedString(draftId, "draftId", MAX_ID_BYTES);
		const normalizedRevision = revision(input.expectedRevision);
		const normalizedText = text(input.text);
		const normalizedAttachments = input.attachments === undefined
			? (this.store.readDraft(normalizedDeviceId, normalizedDraftId)?.attachments ?? [])
			: attachments(input.attachments);
		const normalizedSessionId = input.sessionId === undefined ? undefined : boundedString(input.sessionId, "sessionId", MAX_ID_BYTES);
		const normalizedSource = source(input.source);
		return mapWrite(this.store.writeDraft({
			deviceId: normalizedDeviceId,
			draftId: normalizedDraftId,
			expectedRevision: normalizedRevision,
			text: normalizedText,
			attachments: normalizedAttachments,
			...(input.content === undefined ? {} : { content: input.content }),
			...(normalizedSessionId === undefined ? {} : { sessionId: normalizedSessionId }),
			...(normalizedSource === undefined ? {} : { source: normalizedSource }),
		}));
	}

	submit(deviceId: string, draftId: string, input: DraftSubmitInput): { submission: DraftSubmission; created: boolean } {
		const normalizedDeviceId = boundedString(deviceId, "deviceId", MAX_ID_BYTES);
		const normalizedDraftId = boundedString(draftId, "draftId", MAX_ID_BYTES);
		const normalizedRevision = revision(input.expectedRevision);
		if (normalizedRevision < 1) throw new TypeError("expectedRevision must be at least 1 for submission");
		const commandId = boundedString(input.commandId, "commandId", MAX_ID_BYTES);
		const payloadHash = boundedString(input.payloadHash, "payloadHash", MAX_ID_BYTES);
		try {
			return this.store.claimDraftSubmission({ deviceId: normalizedDeviceId, draftId: normalizedDraftId, revision: normalizedRevision, commandId, payloadHash });
		} catch (error) {
			if (error instanceof DurableStoreDraftConflictError) throw new DraftConflictError(error.message);
			throw error;
		}
	}

	clear(deviceId: string, draftId: string, input: DraftClearInput): { cleared: boolean; draft?: DraftSnapshot } {
		const normalizedRevision = revision(input.expectedRevision);
		return this.store.clearDraft({
			deviceId: boundedString(deviceId, "deviceId", MAX_ID_BYTES),
			draftId: boundedString(draftId, "draftId", MAX_ID_BYTES),
			revision: normalizedRevision,
		});
	}

	import(deviceId: string, entries: ReadonlyArray<ImportDraftEntry>): { imported: number; skipped: number } {
		if (!Array.isArray(entries)) throw new TypeError("entries must be an array");
		const normalized = entries.map(entry => ({
			draftId: boundedString(entry?.draftId, "draftId", MAX_ID_BYTES),
			text: text(entry?.text),
			attachments: attachments(entry?.attachments),
			...(entry?.content === undefined ? {} : { content: entry.content }),
			sessionId: entry?.sessionId === undefined ? undefined : boundedString(entry.sessionId, "sessionId", MAX_ID_BYTES),
			source: boundedString(entry?.source, "draft source", MAX_SOURCE_BYTES),
		}));
		return this.store.importDrafts({ deviceId: boundedString(deviceId, "deviceId", MAX_ID_BYTES), entries: normalized });
	}
}
