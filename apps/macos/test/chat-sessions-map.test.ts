import { describe, expect, it } from "bun:test";
import {
	abortRequest,
	attachedContextLabels,
	CEDIA_CHAT_PARTICIPANT_ID,
	CEDIA_CHAT_SESSION_SCHEME,
	CEDIA_CHAT_SESSION_TYPE,
	isCediaDraftUri,
	currentModelFromOmpState,
	currentModelIdFromOmpState,
	getAvailableModelsRequest,
	getLoginProvidersRequest,
	getOmpStateRequest,
	modelPickerGroupFromSnapshot,
	ompModelRowForPick,
	ompModelForPickedLanguageModel,
	ompModelPickProviders,
	ompModelRows,
	thinkingPickerGroupFromParams,
	thinkingPickerGroupForModel,
	entryFailureText,
	normalizeOmpLoginProviders,
	normalizeOmpModels,
	projectNameFor,
	projectOmpModelSnapshot,
	promptImagesFromReferences,
	promptRequest,
	promptWithAttachedContext,
	resolveOmpModelPickProvider,
	selectedModelIdFromInputState,
	sessionIdFromUri,
	sessionItemShape,
	sessionState,
	sessionUriString,
	setOmpModelRequest,
	toolCardFromEntry,
	turnPlansFromTranscript,
	uiAnswerValue,
	uiCarouselQuestionId,
	uiQuestionFromRequest,
} from "../src/chat-sessions-map.ts";
import type { Project, Session } from "../../../packages/protocol/src/index.ts";
import { createInitialTaskState, type TranscriptEntry } from "../src/state.ts";

function session(patch: Partial<Session> = {}): Session {
	return {
		id: "s1",
		projectId: "p1",
		title: "Fix the sidebar",
		cwd: "/Users/pond/cedia",
		sessionFile: "/tmp/session.json",
		incarnation: "inc-1",
		status: "idle",
		archived: false,
		createdAt: "2026-09-14T07:00:00.000Z",
		updatedAt: "2026-09-14T07:30:00.000Z",
		...patch,
	};
}

function project(patch: Partial<Project> = {}): Project {
	return { id: "p1", name: "cedia", path: "/Users/pond/cedia", archived: false, ...patch } as Project;
}

function entry(patch: Partial<TranscriptEntry> & Pick<TranscriptEntry, "role">): TranscriptEntry {
	return {
		id: "e1",
		kind: "message",
		text: "",
		status: "completed",
		rawFrames: [],
		...patch,
	} as TranscriptEntry;
}

describe("session resource identity", () => {
	it("round-trips a session id through its resource uri", () => {
		expect(sessionIdFromUri({ scheme: CEDIA_CHAT_SESSION_SCHEME, authority: "session", path: "/abc-123" })).toBe("abc-123");
		expect(CEDIA_CHAT_SESSION_TYPE).toBe(CEDIA_CHAT_PARTICIPANT_ID);
	});

	it("does not claim resources owned by another provider", () => {
		expect(sessionIdFromUri({ scheme: "vscode-chat", authority: "session", path: "/abc" })).toBeUndefined();
		expect(sessionIdFromUri({ scheme: CEDIA_CHAT_SESSION_SCHEME, authority: "other", path: "/abc" })).toBeUndefined();
		expect(sessionIdFromUri({ scheme: CEDIA_CHAT_SESSION_SCHEME, authority: "session", path: "/" })).toBeUndefined();
	});

	it("keeps ids that need escaping reversible", () => {
		const id = "session/with space+plus";
		const parsed = new URL(sessionUriString(id));
		expect(sessionIdFromUri({ scheme: parsed.protocol.replace(":", ""), authority: parsed.host, path: parsed.pathname })).toBe(id);
	});

	it("recognizes a draft under either key the workbench builds it with", () => {
		// The workbench's `getNewChatSessionResource(sessionType)` gives a draft the session
		// type as its scheme, while the bridge's own drafts (and every draft that reuses one)
		// may carry the item scheme. Both are drafts: no host id, no transcript.
		expect(isCediaDraftUri({ scheme: CEDIA_CHAT_SESSION_TYPE, path: "/untitled-6f1e" })).toBe(true);
		expect(isCediaDraftUri({ scheme: CEDIA_CHAT_SESSION_SCHEME, path: "/untitled-6f1e" })).toBe(true);
		// A real session is not a draft, under either key.
		expect(isCediaDraftUri({ scheme: CEDIA_CHAT_SESSION_SCHEME, authority: "session", path: "/abc-123" })).toBe(false);
		expect(isCediaDraftUri({ scheme: CEDIA_CHAT_SESSION_TYPE, authority: "session", path: "/abc-123" })).toBe(false);
		// Another provider's resource is never Cedia's draft.
		expect(isCediaDraftUri({ scheme: "vscode-chat", path: "/untitled-6f1e" })).toBe(false);
	});

	it("reads the composer's picked model out of a session's input state", () => {
		// A draft's pick travels as the session's `models` option, in either shape the two halves of
		// the picker use (the bare OMP id the option item carries, or the vendor-prefixed identifier
		// the picker publishes). Both name the same model, and the bare id is what `set_model` wants.
		const withPick = (id: string) => ({ groups: [{ id: "models", items: [{ id, name: id }], selected: { id, name: id } }] });
		expect(selectedModelIdFromInputState(withPick("deepseek/deepseek-chat"))).toBe("deepseek/deepseek-chat");
		expect(selectedModelIdFromInputState(withPick("cedia-omp/deepseek/deepseek-chat"))).toBe("deepseek/deepseek-chat");
		// No pick at all, or a catalogue that is not Cedia's, is not a pick.
		expect(selectedModelIdFromInputState(undefined)).toBeUndefined();
		expect(selectedModelIdFromInputState({ groups: [{ id: "models", items: [] }] })).toBeUndefined();
		expect(selectedModelIdFromInputState({ groups: [{ id: "other", selected: { id: "x" } }] })).toBeUndefined();
	});
});

describe("sessionState", () => {
	it("maps the four host statuses without inventing a fifth", () => {
		expect(sessionState("running")).toBe("in-progress");
		expect(sessionState("recovery_required")).toBe("failed");
		expect(sessionState("idle")).toBe("completed");
		expect(sessionState("stopped")).toBe("completed");
	});
});

describe("sessionItemShape", () => {
	it("carries title, project name and timings from the host record", () => {
		const shape = sessionItemShape(session({ status: "running" }), "cedia");
		expect(shape).toMatchObject({ id: "s1", label: "Fix the sidebar", description: "cedia", state: "in-progress" });
		expect(shape.timing.created).toBe(Date.parse("2026-09-14T07:00:00.000Z"));
		expect(shape.timing.lastRequestStarted).toBe(Date.parse("2026-09-14T07:30:00.000Z"));
	});

	it("leaves lastRequestEnded unset while a turn is still running", () => {
		expect(sessionItemShape(session({ status: "running" })).timing.lastRequestEnded).toBeUndefined();
		expect(sessionItemShape(session({ status: "idle" })).timing.lastRequestEnded).toBe(Date.parse("2026-09-14T07:30:00.000Z"));
	});

	it("leaves description undefined rather than inventing a project label", () => {
		expect(sessionItemShape(session()).description).toBeUndefined();
	});

	it("carries the host's archived flag, which is what moves a row to Done", () => {
		expect(sessionItemShape(session()).archived).toBe(false);
		expect(sessionItemShape(session({ archived: true })).archived).toBe(true);
	});

	it("resolves the project name from the host list", () => {
		expect(projectNameFor([project(), project({ id: "p2", name: "cedia-ios" })], session())).toBe("cedia");
		expect(projectNameFor([project({ id: "p2" })], session())).toBeUndefined();
	});
});

describe("turnPlansFromTranscript", () => {
	it("pairs each user request with the assistant and tool work that answered it", () => {
		const tool = entry({ id: "t1", role: "tool", kind: "tool", text: "read_file", toolName: "read_file" });
		const plans = turnPlansFromTranscript([
			entry({ id: "u1", role: "user", text: "Fix the sidebar" }),
			entry({ id: "a1", role: "assistant", text: "Looking at the filters." }),
			tool,
			entry({ id: "a2", role: "assistant", text: "Fixed." }),
			entry({ id: "u2", role: "user", text: "Thanks" }),
		]);

		expect(plans).toEqual([
			{ kind: "request", text: "Fix the sidebar", toolNames: [] },
			{ kind: "response", text: "Looking at the filters.\n\nFixed.", toolNames: ["read_file"], toolEntries: [{ id: "t1", entry: tool }] },
			{ kind: "request", text: "Thanks", toolNames: [] },
		]);
	});

	it("drops system entries instead of showing them as assistant text", () => {
		const plans = turnPlansFromTranscript([
			entry({ id: "s1", role: "system", text: "compaction" }),
			entry({ id: "a1", role: "assistant", text: "Ready." }),
		]);
		expect(plans).toEqual([{ kind: "response", text: "Ready.", toolNames: [] }]);
	});

	it("names a tool run even when the frame carried no label", () => {
		const tool = entry({ id: "t1", role: "tool", kind: "tool", text: "bash" });
		const plans = turnPlansFromTranscript([tool]);
		expect(plans).toEqual([{ kind: "response", text: "", toolNames: ["bash"], toolEntries: [{ id: "t1", entry: tool }] }]);
	});
});

describe("tool cards (fixtures only)", () => {
	it("marks a running tool incomplete and carries its args as input", () => {
		const card = toolCardFromEntry(entry({ id: "t1", role: "tool", kind: "tool", text: "write_file", toolName: "write_file", toolStatus: "running", args: { path: "a.txt" } }));
		expect(card?.isComplete).toBe(false);
		expect(card?.isError).toBe(false);
		expect(card?.input).toContain("a.txt");
	});

	it("marks a completed tool complete and names the past action", () => {
		const card = toolCardFromEntry(entry({ id: "t2", role: "tool", kind: "tool", text: "done", toolName: "write_file", toolStatus: "completed", output: "done" }));
		expect(card?.isComplete).toBe(true);
		expect(card?.isError).toBe(false);
		expect(card?.past).toBe("write_file completed");
		expect(card?.output).toBe("done");
	});

	it("marks a failed tool as an error that is complete", () => {
		const card = toolCardFromEntry(entry({ id: "t3", role: "tool", kind: "tool", text: "boom", toolName: "bash", toolStatus: "failed", output: "boom" }));
		expect(card?.isError).toBe(true);
		expect(card?.isComplete).toBe(true);
	});

	it("clamps a huge output with the truncation suffix", () => {
		const card = toolCardFromEntry(entry({ id: "t4", role: "tool", kind: "tool", text: "", toolName: "bash", toolStatus: "completed", output: "x".repeat(5000) }));
		expect(card?.output.length).toBe(4000 + "\n… (truncated)".length);
		expect(card?.output.endsWith("(truncated)")).toBe(true);
	});

	it("returns undefined for a non-tool entry", () => {
		expect(toolCardFromEntry(entry({ id: "m1", role: "assistant", text: "hello" }))).toBeUndefined();
	});
});

describe("command requests", () => {
	it("sends a prompt as the OMP prompt command with a {message} payload", () => {
		expect(promptRequest(session(), "do the thing", "cmd-1")).toEqual({
			commandId: "cmd-1",
			incarnation: "inc-1",
			command: "prompt",
			payload: { message: "do the thing" },
		});
	});

	it("stops a turn with the abort command, never a second prompt", () => {
		expect(abortRequest(session(), "cmd-2")).toEqual({ commandId: "cmd-2", incarnation: "inc-1", command: "abort" });
	});

	it("keeps the participant id extension-owned", () => {
		expect(CEDIA_CHAT_PARTICIPANT_ID.startsWith("cedia.")).toBe(true);
	});

	it("builds OMP model commands through the host envelope only", () => {
		expect(getAvailableModelsRequest(session(), "cmd-models")).toEqual({
			commandId: "cmd-models",
			incarnation: "inc-1",
			command: "get_available_models",
			payload: {},
		});
		expect(getOmpStateRequest(session(), "cmd-state")).toEqual({
			commandId: "cmd-state",
			incarnation: "inc-1",
			command: "get_state",
			payload: {},
		});
		expect(setOmpModelRequest(session(), "probe", "probe-model", "cmd-set")).toEqual({
			commandId: "cmd-set",
			incarnation: "inc-1",
			command: "set_model",
			payload: { provider: "probe", modelId: "probe-model" },
		});
	});
});

describe("composer attachments (fixtures only)", () => {
	it("reads binary references into OMP images and skips non-binary ones", async () => {
		expect(await promptImagesFromReferences(undefined)).toEqual([]);
		expect(await promptImagesFromReferences([
			{ name: "shot", value: { mimeType: "image/png", data: async () => new Uint8Array([1, 2, 3]) } },
			{ name: "a.ts", value: { fsPath: "/repo/a.ts" } },
		])).toEqual([{ type: "image", data: "AQID", mimeType: "image/png" }]);
	});

	it("skips a reference whose data() rejects and still returns the others", async () => {
		const images = await promptImagesFromReferences([
			{ name: "broken", value: { mimeType: "image/png", data: async () => { throw new Error("unreadable"); } } },
			{ name: "ok", value: { mimeType: "image/jpeg", data: async () => new Uint8Array([4, 5]) } },
		]);
		expect(images).toEqual([{ type: "image", data: "BAU=", mimeType: "image/jpeg" }]);
	});

	it("labels non-binary references, name first, fsPath then path, without duplicates", () => {
		expect(attachedContextLabels([
			{ name: "a.ts", value: { fsPath: "/repo/a.ts" } },
			{ value: { fsPath: "/repo/b.ts" } },
			{ value: { path: "/repo/c.ts" } },
			{ name: " a.ts ", value: { fsPath: "/repo/other.ts" } },
			{ name: "shot", value: { mimeType: "image/png", data: async () => new Uint8Array([1]) } },
			{ value: 42 },
		])).toEqual(["a.ts", "/repo/b.ts", "/repo/c.ts"]);
		expect(attachedContextLabels(undefined)).toEqual([]);
	});

	it("appends labels as one block and leaves the prompt untouched without labels", () => {
		expect(promptWithAttachedContext("hello", ["a.ts", "b/c.ts"])).toBe("hello\n\nAttached context:\n- a.ts\n- b/c.ts");
		expect(promptWithAttachedContext("hello", [])).toBe("hello");
	});

	it("carries prompt images only when supplied and non-empty", () => {
		const image = { type: "image" as const, data: "AQID", mimeType: "image/png" };
		expect(promptRequest(session(), "hi", "c1")).toEqual({ commandId: "c1", incarnation: "inc-1", command: "prompt", payload: { message: "hi" } });
		expect(promptRequest(session(), "hi", "c2", [])).toEqual({ commandId: "c2", incarnation: "inc-1", command: "prompt", payload: { message: "hi" } });
		expect(promptRequest(session(), "hi", "c3", [image])).toEqual({
			commandId: "c3",
			incarnation: "inc-1",
			command: "prompt",
			payload: { message: "hi", images: [image] },
		});
	});
});

describe("native UI requests (fixtures only)", () => {
	it("maps a confirm to allow, deny and scoped options in the dock's order", () => {
		const question = uiQuestionFromRequest({
			method: "confirm",
			id: "ui-1",
			title: "Allow write?",
			message: "write_file a.txt",
			scopes: ["read this file"],
		});
		expect(question?.kind).toBe("single_select");
		expect(question?.message).toBe("write_file a.txt");
		expect(question?.options?.map(option => option.id)).toEqual(["allow", "deny", "read this file"]);
		expect(question?.options?.map(option => option.value)).toEqual([true, false, "scope:read this file"]);
		expect(question?.options?.map(option => option.label)).toEqual(["Allow", "Deny", "Allow scoped \u00B7 read this file"]);
	});

	it("maps a multiple select to multi_select, prefers optionDetails labels, and joins array answers", () => {
		const request = {
			method: "select",
			id: "ui-2",
			title: "Pick files",
			options: ["a.ts", "b.ts"],
			optionDetails: [{ label: "Alpha" }, {}],
			multiple: true,
		} as const;
		const question = uiQuestionFromRequest(request);
		expect(question?.kind).toBe("multi_select");
		expect(question?.options?.map(option => option.label)).toEqual(["Alpha", "b.ts"]);
		expect(question?.options?.map(option => option.value)).toEqual(["a.ts", "b.ts"]);
		expect(uiAnswerValue(request, ["a.ts", "b.ts"])).toBe("a.ts\nb.ts");
		expect(uiCarouselQuestionId(request)).toBe("ui-2");
	});

	it("never projects secrets or untrusted form HTML onto the native surface", () => {
		expect(uiQuestionFromRequest({ method: "password", id: "ui-3", title: "Token" })).toBeUndefined();
		expect(uiQuestionFromRequest({ method: "schemaform", id: "ui-4", title: "Form" })).toBeUndefined();
	});

	it("maps empty answers to a cancellation and accepts only shaped answers", () => {
		const confirm = { method: "confirm", id: "ui-5", title: "Allow?", message: "write_file a.txt" } as const;
		expect(uiAnswerValue(confirm, undefined)).toEqual({ cancelled: true });
		expect(uiAnswerValue(confirm, null)).toEqual({ cancelled: true });
		expect(uiAnswerValue(confirm, "")).toEqual({ cancelled: true });
		expect(uiAnswerValue(confirm, [])).toEqual({ cancelled: true });
		expect(uiAnswerValue(confirm, "yes")).toEqual({ cancelled: true });
		expect(uiAnswerValue(confirm, true)).toBe(true);
		expect(uiAnswerValue(confirm, false)).toBe(false);
		expect(uiAnswerValue(confirm, "scope:read this file")).toBe("scope:read this file");
	});

	it("carries a placeholder or prefill as the text question's message", () => {
		expect(uiQuestionFromRequest({ method: "input", id: "ui-6", title: "Name", placeholder: "type here" })).toMatchObject({
			kind: "text",
			message: "type here",
		});
		expect(uiQuestionFromRequest({ method: "editor", id: "ui-7", title: "Edit", prefill: "draft" })).toMatchObject({
			kind: "text",
			message: "draft",
		});
	});

	it("unwraps the workbench's answer objects, whose option values it stringifies", () => {
		const confirm = { method: "confirm", id: "ui-8", title: "Allow?", message: "write_file a.txt" } as const;
		expect(uiAnswerValue(confirm, { selectedValue: "true" })).toBe(true);
		expect(uiAnswerValue(confirm, { selectedValue: "false" })).toBe(false);
		expect(uiAnswerValue(confirm, { selectedValue: "scope:read this file" })).toBe("scope:read this file");
		const multi = { method: "multi_select", id: "ui-9", title: "Pick", options: ["a.ts", "b.ts"] } as const;
		expect(uiAnswerValue(multi, { selectedValues: ["a.ts", "b.ts"], freeformValue: undefined })).toBe("a.ts\nb.ts");
		expect(uiAnswerValue(multi, { selectedValues: [], freeformValue: "notes" })).toBe("notes");
	});
});

describe("OMP model catalog projection (fixtures only)", () => {
	const probeModels = {
		data: {
			models: [
				{ id: "probe-model", name: "Cedia OMP probe model", provider: "probe" },
				{ modelId: "second-model", provider: "probe", label: "Second", available: false, reason: "disabled for test" },
				{ provider: "probe" },
			],
		},
	};

	it("normalizes get_available_models ack/result shapes without inventing rows", () => {
		expect(normalizeOmpModels(probeModels)).toEqual([
			{ id: "probe-model", provider: "probe", label: "Cedia OMP probe model", available: true },
			{ id: "second-model", provider: "probe", label: "Second", available: false, reason: "disabled for test" },
		]);
		expect(normalizeOmpModels({ models: [] })).toEqual([]);
		expect(normalizeOmpModels(undefined)).toEqual([]);
	});

	it("reads the get_state current model id without guessing", () => {
		expect(currentModelIdFromOmpState({ data: { model: { id: "probe-model", provider: "probe" } } })).toBe("probe-model");
		expect(currentModelIdFromOmpState({ model: { modelId: "second-model" } })).toBe("second-model");
		expect(currentModelIdFromOmpState({ data: {} })).toBeUndefined();
		expect(currentModelIdFromOmpState(undefined)).toBeUndefined();
	});

	it("keeps the current selection only when still advertised (no fallback)", () => {
		const models = normalizeOmpModels(probeModels);
		expect(projectOmpModelSnapshot(models, "probe-model")).toMatchObject({
			selectedModelId: "probe-model",
			hasModels: true,
		});
		const dropped = projectOmpModelSnapshot(models, "gone-model");
		expect(dropped.selectedModelId).toBeUndefined();
		expect(dropped.hasModels).toBe(true);
		expect(dropped.models).toHaveLength(2);
		expect(projectOmpModelSnapshot([], "probe-model")).toEqual({ models: [], hasModels: false });
	});

	it("marks provider-unauthenticated rows with a needs-auth reason", () => {
		const models = normalizeOmpModels(probeModels);
		const snapshot = projectOmpModelSnapshot(models, "probe-model", [{ id: "probe", authenticated: false }]);
		expect(snapshot.models[0]?.reason).toBe("Provider is not authenticated");
		expect(snapshot.selectedModelId).toBe("probe-model");
	});

	it("projects an honest picker group (empty catalog stays empty)", () => {
		const advertised = projectOmpModelSnapshot(normalizeOmpModels(probeModels), "probe-model");
		const group = modelPickerGroupFromSnapshot(advertised);
		expect(group).toMatchObject({ id: "models", name: "Models" });
		expect(group.items.map(item => item.id)).toEqual(["probe-model", "second-model"]);
		expect(group.selected?.id).toBe("probe-model");
		expect(modelPickerGroupFromSnapshot(projectOmpModelSnapshot([], undefined)).items).toEqual([]);
	});

	it("unwraps a bare {data:'<id>'} current model id (m3)", () => {
		expect(currentModelIdFromOmpState({ data: "probe-model" })).toBe("probe-model");
		expect(currentModelIdFromOmpState({ data: { data: "probe-model" } })).toBe("probe-model");
		expect(currentModelIdFromOmpState("probe-model")).toBe("probe-model");
		expect(currentModelIdFromOmpState({ data: "" })).toBeUndefined();
	});

	it("matches a bare get_state id to the catalogue's provider-qualified row", () => {
		// Measured 2026-09-18: `get_state` answered `claude-4.6-opus-high` while
		// `get_available_models` listed `cursor/claude-4.6-opus-high`. Dropping the current id on
		// an exact-only match left the pill showing the catalogue's first row (a different model)
		// and made a draft's pick unresolvable when the session was created.
		const models = normalizeOmpModels({
			models: [
				{ id: "cursor/claude-4.6-opus-high", provider: "cursor", label: "Claude 4.6 Opus High" },
				{ id: "deepseek/deepseek-v4.1-flash", provider: "deepseek", label: "DeepSeek V4.1 Flash" },
			],
		});
		const snapshot = projectOmpModelSnapshot(models, "claude-4.6-opus-high");
		expect(snapshot.selectedModelId).toBe("cursor/claude-4.6-opus-high");
		expect(modelPickerGroupFromSnapshot(snapshot).selected?.id).toBe("cursor/claude-4.6-opus-high");
		expect(resolveOmpModelPickProvider(snapshot, "claude-4.6-opus-high")).toBe("cursor");
		// The provider-qualified spelling of the row itself still resolves exactly.
		expect(resolveOmpModelPickProvider(snapshot, "cursor/claude-4.6-opus-high")).toBe("cursor");
		// An id two providers both end with names no single model, so nothing is selected and no
		// provider is invented.
		const ambiguous = normalizeOmpModels({
			models: [
				{ id: "cursor/shared-model", provider: "cursor", label: "A" },
				{ id: "deepseek/shared-model", provider: "deepseek", label: "B" },
			],
		});
		const ambiguousSnapshot = projectOmpModelSnapshot(ambiguous, "shared-model");
		expect(ambiguousSnapshot.selectedModelId).toBeUndefined();
		expect(resolveOmpModelPickProvider(ambiguousSnapshot, "shared-model")).toBeUndefined();
		expect(ompModelRowForPick(ambiguousSnapshot, "shared-model")).toBeUndefined();
	});

	it("keeps the provider get_state names, so a shared id still names one row", () => {
		// Measured live 2026-09-19: `get_state` answered
		// `{id: 'deepseek/deepseek-v4.1-flash', provider: 'commandcode'}` while the catalogue carried
		// that same id from `openrouter` too. Keeping only the id left every row reader refusing to
		// choose, so the composer's reasoning chip - which reads the row's own `thinking.efforts` -
		// never appeared for a model that advertises a ladder.
		expect(currentModelFromOmpState({ data: { model: { id: "deepseek/deepseek-v4.1-flash", provider: "commandcode" } } }))
			.toEqual({ id: "deepseek/deepseek-v4.1-flash", provider: "commandcode" });
		expect(currentModelFromOmpState({ data: { model: { id: "probe-model" } } })).toEqual({ id: "probe-model" });
		expect(currentModelFromOmpState({ data: "probe-model" })).toEqual({ id: "probe-model" });
		expect(currentModelFromOmpState({ data: {} })).toBeUndefined();

		const models = normalizeOmpModels({
			models: [
				{ id: "deepseek/deepseek-v4.1-flash", provider: "openrouter", label: "DeepSeek V4.1 Flash" },
				{ id: "deepseek/deepseek-v4.1-flash", provider: "commandcode", label: "DeepSeek V4.1 Flash", thinking: { efforts: ["low", "high", "max"], mode: "effort" } },
			],
		});
		const snapshot = projectOmpModelSnapshot(models, "deepseek/deepseek-v4.1-flash", undefined, "commandcode");
		expect(snapshot.selectedModelId).toBe("deepseek/deepseek-v4.1-flash");
		expect(snapshot.selectedModelProvider).toBe("commandcode");
		// The picker marks that row (the second provider's row carries the selector spelling,
		// because the first one already claimed the bare id), and the ladder is read off it.
		expect(modelPickerGroupFromSnapshot(snapshot).selected?.id).toBe("commandcode/deepseek/deepseek-v4.1-flash");
		const row = ompModelRowForPick(snapshot, snapshot.selectedModelId ?? "", snapshot.selectedModelProvider);
		expect(row?.provider).toBe("commandcode");
		expect(row && thinkingPickerGroupForModel(row)?.items.map(item => item.id)).toEqual(["low", "high", "max"]);
		// A provider the catalogue does not carry for this model is never recorded as its provider.
		expect(projectOmpModelSnapshot(models, "deepseek/deepseek-v4.1-flash", undefined, "ghost").selectedModelProvider).toBeUndefined();
		// Without a provider the id stays ambiguous, exactly as before.
		expect(projectOmpModelSnapshot(models, "deepseek/deepseek-v4.1-flash").selectedModelProvider).toBeUndefined();
	});

	it("keeps every provider's row when a model id is advertised more than once", () => {
		// Live 2026-09-18: the catalogue advertises ids like `gpt-5.6-luna` from more than one
		// provider, and the workbench keeps one row per identifier, so the second provider's row was
		// dropped (`[LM] Model cedia-omp/gpt-5.6-luna is already registered. Skipping.`) and could not
		// be chosen at all. The first row keeps OMP's own id; later rows take their selector.
		const models = normalizeOmpModels({
			models: [
				{ id: "gpt-5.6-luna", provider: "openrouter", label: "GPT-5.6-Luna" },
				{ id: "gpt-5.6-luna", provider: "commandcode", label: "GPT-5.6-Luna (Command Code)" },
				{ id: "gpt-5.6-luna", provider: "cursor", label: "GPT-5.6-Luna" },
				{ id: "unique-model", provider: "cursor", label: "Unique" },
			],
		});
		const rows = ompModelRows(models);
		expect(rows.map(row => row.id)).toEqual([
			"gpt-5.6-luna",
			"commandcode/gpt-5.6-luna",
			"cursor/gpt-5.6-luna",
			"unique-model",
		]);
		// A label two providers share is disambiguated by the provider; a label that already names it
		// is left exactly as OMP wrote it.
		expect(rows.map(row => row.label)).toEqual([
			"GPT-5.6-Luna",
			"GPT-5.6-Luna (Command Code)",
			"GPT-5.6-Luna · cursor",
			"Unique",
		]);
		// The same provider and model listed twice is one row, not two; two different spellings that
		// OMP really lists (it carries both `auto` and `openrouter/auto`) are two models.
		expect(ompModelRows(normalizeOmpModels({ models: [
			{ id: "auto", provider: "openrouter", label: "Auto" },
			{ id: "auto", provider: "openrouter", label: "Auto" },
			{ id: "openrouter/auto", provider: "openrouter", label: "Auto Router" },
		] })).map(row => row.id)).toEqual(["auto", "openrouter/auto"]);

		// Both spellings still name their row, so a pick of either one resolves to its provider.
		const snapshot = projectOmpModelSnapshot(models);
		expect(resolveOmpModelPickProvider(snapshot, "commandcode/gpt-5.6-luna")).toBe("commandcode");
		expect(resolveOmpModelPickProvider(snapshot, "gpt-5.6-luna", "openrouter")).toBe("openrouter");
		// The picker group and the rows agree on every identity the group publishes.
		const groupIds = modelPickerGroupFromSnapshot(snapshot).items.map(item => item.id);
		expect(groupIds).toEqual(rows.map(row => row.id));
	});

	it("refuses a model id two providers advertise, unless one of them stands out", () => {
		// Measured live 2026-09-18: `deepseek/deepseek-v4.1-flash` is advertised by both
		// `openrouter`, which this machine has no credentials for, and `commandcode`, which it has.
		// Taking the first row sent the turn to openrouter, whose answer was `401 User not found`.
		// An id that several providers carry is a name, not a model, so the pick has to name one.
		const shared = (provider: string, extra: Record<string, unknown> = {}) => ({
			id: "deepseek/deepseek-v4.1-flash",
			provider,
			label: "DeepSeek V4.1 Flash",
			...extra,
		});

		// Nothing stands out: the pick is refused, and the providers are reported so the caller can
		// say which ones the user has to choose between.
		const tied = projectOmpModelSnapshot(normalizeOmpModels({
			models: [shared("openrouter"), shared("commandcode")],
		}));
		expect(ompModelRowForPick(tied, "deepseek/deepseek-v4.1-flash")).toBeUndefined();
		expect(resolveOmpModelPickProvider(tied, "deepseek/deepseek-v4.1-flash")).toBeUndefined();
		expect(ompModelForPickedLanguageModel(tied, { id: "deepseek/deepseek-v4.1-flash" })).toBeUndefined();
		expect(ompModelPickProviders(tied, "deepseek/deepseek-v4.1-flash")).toEqual(["openrouter", "commandcode"]);

		// The picker's own provider (what it drew for the row) singles one out.
		expect(ompModelRowForPick(tied, "deepseek/deepseek-v4.1-flash", "commandcode")?.provider).toBe("commandcode");
		expect(ompModelForPickedLanguageModel(tied, { id: "deepseek/deepseek-v4.1-flash", vendor: "commandcode" }))
			.toEqual({ provider: "commandcode", modelId: "deepseek/deepseek-v4.1-flash" });
		// A vendor that names nothing in the catalogue does not break the tie.
		expect(ompModelRowForPick(tied, "deepseek/deepseek-v4.1-flash", "cedia-omp")).toBeUndefined();

		// OMP's own answer singles one out: the other provider is unauthenticated.
		const annotated = projectOmpModelSnapshot(
			normalizeOmpModels({ models: [shared("openrouter"), shared("commandcode")] }),
			undefined,
			[{ id: "openrouter", authenticated: false }, { id: "commandcode", authenticated: true }],
		);
		expect(ompModelRowForPick(annotated, "deepseek/deepseek-v4.1-flash")?.provider).toBe("commandcode");
		expect(ompModelForPickedLanguageModel(annotated, { id: "deepseek/deepseek-v4.1-flash" }))
			.toEqual({ provider: "commandcode", modelId: "deepseek/deepseek-v4.1-flash" });
	});
	it("publishes a reasoning group only for the levels OMP advertises for that model", () => {
		// The chip is per model: OMP's get_state answers with what its current model accepts, and a
		// model that advertises none gets no control at all rather than an invented ladder.
		const group = thinkingPickerGroupFromParams({
			advertised: true,
			current: "high",
			options: [{ id: "low", label: "low", enabled: true }, { id: "high", label: "high", enabled: true }],
			reason: "",
		});
		expect(group).toMatchObject({ id: "reasoning", name: "Reasoning", selected: { id: "high" } });
		expect(group?.items.map(item => item.id)).toEqual(["low", "high"]);
		expect(thinkingPickerGroupFromParams({ advertised: false, options: [], reason: "OMP has not advertised thinking levels for this model." })).toBeUndefined();
	});

	it("maps the composer's picked language model onto an OMP model, or nothing", () => {
		// The composer's picker is the workbench's own: it carries every provider the user installed,
		// so a pick only means something when OMP runs that model. Measured 2026-09-18: the pill read
		// DeepSeek V4.1 Flash (opencode-go) while the host ran cursor/claude-4.6-opus-high, because
		// nothing read the pick at all.
		const snapshot = projectOmpModelSnapshot(normalizeOmpModels({
			models: [
				{ id: "deepseek/deepseek-v4.1-flash", provider: "deepseek", label: "DeepSeek V4.1 Flash" },
				{ id: "cursor/claude-4.6-opus-high", provider: "cursor", label: "Claude Opus 4.6 1M" },
			],
		}), "cursor/claude-4.6-opus-high");
		expect(ompModelForPickedLanguageModel(snapshot, { id: "deepseek/deepseek-v4.1-flash", vendor: "opencode-go" }))
			.toEqual({ provider: "deepseek", modelId: "deepseek/deepseek-v4.1-flash" });
		// A model OMP does not run is refused rather than quietly substituted by the host's default.
		expect(ompModelForPickedLanguageModel(snapshot, { id: "gpt-5.6-sol", vendor: "openai" })).toBeUndefined();
		expect(ompModelForPickedLanguageModel(snapshot, undefined)).toBeUndefined();
		expect(ompModelForPickedLanguageModel(snapshot, { id: "   " })).toBeUndefined();
	});

	it("reads a failed turn's provider message out of its raw frames", () => {
		const entry = (status: "failed" | "completed", frames: readonly Record<string, unknown>[]): TranscriptEntry => ({
			id: "m1",
			kind: "message" as const,
			role: "assistant" as const,
			text: "",
			status,
			rawFrames: frames,
		});
		// The shape the host recorded for the rate-limited turn of 2026-09-18.
		expect(entryFailureText(entry("failed", [
			{ type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "You're out of usage." } },
		]))).toBe("You're out of usage.");
		// The classification is the honest fallback when only it is present.
		expect(entryFailureText(entry("failed", [
			{ message: { stopReason: "error", errorClassificationMessage: "Connect error resource_exhausted: Error" } },
		]))).toBe("Connect error resource_exhausted: Error");
		// A completed turn, or a failure with nothing recorded, is not an error message.
		expect(entryFailureText(entry("completed", [{ message: { errorMessage: "stale" } }]))).toBeUndefined();
		expect(entryFailureText(entry("failed", [{ message: { stopReason: "error" } }]))).toBeUndefined();
	});

	it("builds the get_login_providers command through the host envelope only", () => {
		expect(getLoginProvidersRequest(session(), "cmd-login")).toEqual({
			commandId: "cmd-login",
			incarnation: "inc-1",
			command: "get_login_providers",
			payload: {},
		});
	});
});

describe("OMP login providers fetch shape (fixtures only, M1)", () => {
	it("normalizes get_login_providers ack/result shapes without inventing rows", () => {
		const nested = { data: { providers: [{ id: "probe", authenticated: false }, { id: "other", authenticated: true }] } };
		expect(normalizeOmpLoginProviders(nested)).toEqual([
			{ id: "probe", authenticated: false },
			{ id: "other", authenticated: true },
		]);
		expect(normalizeOmpLoginProviders({ providers: [{ id: "probe" }] })).toEqual([{ id: "probe" }]);
		expect(normalizeOmpLoginProviders({ data: [{ id: "probe", authenticated: true }] })).toEqual([
			{ id: "probe", authenticated: true },
		]);
		expect(normalizeOmpLoginProviders([{ id: "probe", authenticated: false }, { provider: "no-id" }])).toEqual([
			{ id: "probe", authenticated: false },
		]);
		expect(normalizeOmpLoginProviders(undefined)).toEqual([]);
		expect(normalizeOmpLoginProviders({ data: {} })).toEqual([]);
	});

	it("leaves unauthenticated flags absent instead of inventing false", () => {
		expect(normalizeOmpLoginProviders({ providers: [{ id: "probe" }] })[0]).not.toHaveProperty("authenticated");
	});

	it("annotates needs-auth only for explicit false, never for missing flags", () => {
		const models = normalizeOmpModels({ data: { models: [{ id: "m1", provider: "probe" }] } });
		const annotated = projectOmpModelSnapshot(models, "m1", [{ id: "probe", authenticated: false }]);
		expect(annotated.models[0]?.reason).toBe("Provider is not authenticated");
		const silent = projectOmpModelSnapshot(models, "m1", [{ id: "probe" }]);
		expect(silent.models[0]?.reason).toBeUndefined();
		const emptyProviders = projectOmpModelSnapshot(models, "m1", []);
		expect(emptyProviders.models[0]?.reason).toBeUndefined();
		expect(emptyProviders.selectedModelId).toBe("m1");
	});
});

describe("OMP model pick resolution (fixtures only, m4)", () => {
	const models = normalizeOmpModels({ data: { models: [{ id: "probe-model", provider: "probe" }] } });
	const snapshot = projectOmpModelSnapshot(models, "probe-model");

	it("prefers the advertised catalog row for the provider", () => {
		expect(resolveOmpModelPickProvider(snapshot, "probe-model", "stale-desc")).toBe("probe");
	});

	it("falls back to the picker description when the catalog row is stale", () => {
		expect(resolveOmpModelPickProvider(snapshot, "new-model", "probe")).toBe("probe");
	});

	it("returns undefined for an unknown provider so the caller fails honestly", () => {
		expect(resolveOmpModelPickProvider(snapshot, "ghost-model", undefined)).toBeUndefined();
		expect(resolveOmpModelPickProvider(snapshot, "ghost-model", "")).toBeUndefined();
		expect(resolveOmpModelPickProvider(snapshot, "ghost-model", 42)).toBeUndefined();
	});
});
