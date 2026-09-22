import { describe, expect, it } from "bun:test";
import { applyEvent, applyEventPage, applyFrame, createInitialTaskState, normalizeSlashCommands, parseCediaUiRequest, reduceTaskState } from "../src/state.ts";
import type { Json } from "../../../packages/protocol/src/index.ts";

describe("Cedia task reducer", () => {
	it("keeps a terminal panel's frames out of the transcript", () => {
		// A turn emits one virtual-terminal screen update per TUI repaint - ~140 for
		// the turn that exposed this - each carrying raw escape sequences. They are
		// the terminal panels' transport, not conversation.
		const events = [
			{ sessionId: "s", incarnation: "i", sequence: 1, timestamp: "t", frame: { type: "cedia_terminal_open", terminalId: "tty-1", cols: 80, rows: 24 } },
			{ sessionId: "s", incarnation: "i", sequence: 2, timestamp: "t", frame: { type: "cedia_terminal_output", terminalId: "tty-1", sequence: 0, data: "\u001b[31mred\u001b[0m" } },
			{ sessionId: "s", incarnation: "i", sequence: 3, timestamp: "t", frame: { type: "cedia_terminal_close", terminalId: "tty-1" } },
			{ sessionId: "s", incarnation: "i", sequence: 4, timestamp: "t", frame: { type: "notice", message: "kept" } },
		];
		const state = applyEventPage(createInitialTaskState(), { events, cursor: 4, hasMore: false });
		expect(state.transcript).toHaveLength(1);
		expect(state.transcript[0]!.rawFrames[0]!.type).toBe("notice");
		// The cursor still advances past the skipped frames, so a client resumes from
		// the last frame it actually consumed rather than replaying them forever.
		expect(state.cursor).toBe(4);
	});

  it("hydrates OMP-owned fork history from get_messages without replay duplicates", () => {
    const history = { sessionId: "child", incarnation: "child-inc", sequence: 1, timestamp: "2026-09-19T00:00:00Z", frame: {
      type: "response", command: "get_messages", success: true, data: { messages: [
        { role: "user", content: "Original question", timestamp: 1 },
        { role: "assistant", content: [{ type: "text", text: "Original answer" }], timestamp: 2 },
      ] },
    } };
    const page = { events: [history], cursor: 1, hasMore: false };
    const state = applyEventPage(createInitialTaskState(), page);
    expect(state.transcript.map(row => [row.role, row.text])).toEqual([
      ["user", "Original question"], ["assistant", "Original answer"],
    ]);
    expect(applyEventPage(state, page).transcript).toEqual(state.transcript);
  });
	it("keeps host connectivity while navigating an empty project and clears recovered errors", () => {
		let state = reduceTaskState(createInitialTaskState(), { type: "connection", status: "connected" });
		state = reduceTaskState(state, { type: "reset", project: null, session: null });
		expect(state.connection).toBe("connected");
		state = reduceTaskState(state, { type: "session", session: null });
		expect(state.connection).toBe("connected");
		state = reduceTaskState(state, { type: "connection", status: "offline", error: "old failure" });
		state = reduceTaskState(state, { type: "connection", status: "connected" });
		expect(state.lastError).toBeUndefined();
	});
	it("prepends advertised OMP history without duplicating live rows", () => {
		let state = reduceTaskState(createInitialTaskState(), {
			type: "history_page",
			entries: [{ id: "omp-hist:m1", kind: "message", role: "user", text: "hello", status: "completed", rawFrames: [] }],
		});
		state = reduceTaskState(state, {
			type: "history_page",
			entries: [{ id: "omp-hist:m1", kind: "message", role: "user", text: "hello", status: "completed", rawFrames: [] }],
		});
		expect(state.transcript.map(entry => entry.id)).toEqual(["omp-hist:m1"]);
	});
	it("projects pinned OMP message snapshots into one stable row per incarnation", () => {
		const event = (sequence: number, frame: Record<string, unknown>) => ({
			sessionId: "session-1",
			incarnation: "incarnation-1",
			sequence,
			timestamp: new Date(sequence).toISOString(),
			frame: frame as Json,
		});
		const text = (value: string) => [{ type: "text", text: value }];
		const events = [
			event(1, { type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } }),
			event(2, {
				type: "message_update",
				message: { role: "assistant", content: text("hello"), timestamp: 1 },
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello", partial: { role: "assistant", content: text("hello"), timestamp: 1 } },
			}),
			event(3, {
				type: "message_update",
				message: { role: "assistant", content: text("hello world"), timestamp: 1 },
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " world", partial: { role: "assistant", content: text("hello world"), timestamp: 1 } },
			}),
			event(4, { type: "message_end", message: { role: "assistant", content: text("hello world"), stopReason: "stop", timestamp: 1 } }),
		];
		let state = applyEventPage(createInitialTaskState(), { events, cursor: 4, hasMore: false });
		expect(state.transcript).toHaveLength(1);
		expect(state.transcript[0]).toMatchObject({ id: "incarnation-1:message:1", role: "assistant", text: "hello world", status: "completed" });
		expect(state.transcript[0]?.rawFrames).toHaveLength(4);
		// The same journal page is a no-op, including for snapshots that expose a
		// response id only at message_end.
		const lateFinal = event(4, { type: "message_end", message: { role: "assistant", content: text("hello world"), responseId: "late-response-id", stopReason: "stop", timestamp: 1 } });
		state = applyEventPage(state, { events: [...events.slice(0, 3), lateFinal], cursor: 4, hasMore: false });
		expect(state.transcript).toHaveLength(1);
		expect(state.transcript[0]?.rawFrames).toHaveLength(4);
	});

	it("renders OMP tool partialResult/result content and isError on one card", () => {
		const event = (sequence: number, frame: Record<string, unknown>) => ({ sessionId: "session-1", incarnation: "incarnation-1", sequence, timestamp: new Date(sequence).toISOString(), frame: frame as Json });
		const text = (value: string) => [{ type: "text", text: value }];
		const state = applyEventPage(createInitialTaskState(), {
			events: [
				event(10, { type: "tool_execution_start", toolCallId: "call-1", toolName: "write_file", args: { path: "a.txt" } }),
				event(11, { type: "tool_execution_update", toolCallId: "call-1", toolName: "write_file", args: { path: "a.txt" }, partialResult: { content: text("writing") } }),
				event(12, { type: "tool_execution_end", toolCallId: "call-1", toolName: "write_file", result: { content: text("permission denied"), isError: true }, isError: true }),
		],
		cursor: 12,
		hasMore: false,
	});
		expect(state.transcript).toHaveLength(1);
		expect(state.transcript[0]).toMatchObject({ id: "call-1", kind: "tool", toolName: "write_file", toolStatus: "failed", status: "failed" });
		expect(state.transcript[0]?.output).toContain("writing");
		expect(state.transcript[0]?.output).toContain("permission denied");
		expect(state.transcript[0]?.rawFrames).toHaveLength(3);
	});

	it("ignores events from another session or incarnation", () => {
		const session = { id: "session-1", projectId: "project-1", title: "Task", cwd: "/tmp", sessionFile: "/tmp/task.jsonl", incarnation: "incarnation-1", status: "running" as const, archived: false, createdAt: "now", updatedAt: "now" };
		let state = reduceTaskState(createInitialTaskState(), { type: "session", session });
		state = applyEvent(state, { sessionId: "session-2", incarnation: "incarnation-1", sequence: 1, timestamp: "now", frame: { type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "wrong session" }] } } });
		state = applyEvent(state, { sessionId: "session-1", incarnation: "incarnation-2", sequence: 2, timestamp: "now", frame: { type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "stale incarnation" }] } } });
		state = reduceTaskState(state, { type: "frame", sessionId: "session-2", incarnation: "incarnation-1", sequence: 3, frame: { type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "wrong session" }] } } });
		expect(state.transcript).toHaveLength(0);
	});

	it("keeps stable message identity while streaming and retains raw OMP frames", () => {
		const start = { sessionId: "s", incarnation: "i", sequence: 1, timestamp: "t", frame: { type: "message_start", messageId: "m-1", role: "assistant" } } as const;
		const update = { sessionId: "s", incarnation: "i", sequence: 2, timestamp: "t", frame: { type: "message_update", messageId: "m-1", delta: "hel" } } as const;
		const end = { sessionId: "s", incarnation: "i", sequence: 3, timestamp: "t", frame: { type: "message_end", messageId: "m-1", text: "lo" } } as const;
		let state = applyEventPage(createInitialTaskState(), { events: [start, update, end], cursor: 3, hasMore: false });
		expect(state.transcript).toHaveLength(1);
		expect(state.transcript[0]).toMatchObject({ id: "m-1", text: "hel", status: "completed" });
		expect(state.transcript[0]?.rawFrames).toHaveLength(3);
		// Replaying the same page is harmless after reconnect.
		state = applyEventPage(state, { events: [start, update, end], cursor: 3, hasMore: false });
		expect(state.transcript).toHaveLength(1);
		expect(state.transcript[0]?.rawFrames).toHaveLength(3);
	});

	it("projects tool execution frames into one expandable identity", () => {
		const state = applyEventPage(createInitialTaskState(), {
			events: [
				{ sessionId: "s", incarnation: "i", sequence: 5, timestamp: "t", frame: { type: "tool_execution_start", toolCallId: "call-1", toolName: "write_file", args: { path: "a" } } },
				{ sessionId: "s", incarnation: "i", sequence: 6, timestamp: "t", frame: { type: "tool_execution_update", toolCallId: "call-1", output: "checking" } },
				{ sessionId: "s", incarnation: "i", sequence: 7, timestamp: "t", frame: { type: "tool_execution_end", toolCallId: "call-1", output: "done" } },
			],
			cursor: 7,
			hasMore: false,
		});
		expect(state.transcript).toHaveLength(1);
		expect(state.transcript[0]).toMatchObject({ id: "call-1", kind: "tool", toolName: "write_file", toolStatus: "completed" });
		expect(state.transcript[0]?.output).toContain("checking");
		expect(state.transcript[0]?.output).toContain("done");
		expect(state.transcript[0]?.rawFrames).toHaveLength(3);
	});

	it("binds interactive requests to the current session incarnation", () => {
		const session = { id: "session-1", projectId: "project-1", title: "Task", cwd: "/tmp", sessionFile: "/tmp/task.jsonl", incarnation: "incarnation-1", status: "running" as const, archived: false, createdAt: "now", updatedAt: "now" };
		let state = reduceTaskState(createInitialTaskState(), { type: "session", session });
		state = reduceTaskState(state, { type: "ui_request", event: { kind: "interactive", token: "tok-1", request: { method: "confirm", id: "r1", title: "Allow?", message: "run" } } });
		expect(state.uiRequests[0]).toMatchObject({ token: "tok-1", sessionId: "session-1", incarnation: "incarnation-1" });
	});
	it("accepts exact broker interactive envelopes without auto-approving", () => {
		const envelope = { kind: "interactive", token: "tok-1", request: { method: "confirm", id: "request-1", title: "Write file?", message: "a.txt" } };
		expect(parseCediaUiRequest(envelope)).toMatchObject({ token: "tok-1", request: envelope.request });
		let state = reduceTaskState(createInitialTaskState(), { type: "ui_request", event: envelope });
		expect(state.uiRequests).toHaveLength(1);
		expect(state.uiRequests[0]?.request.method).toBe("confirm");
		state = reduceTaskState(state, { type: "ui_resolved", token: "tok-1" });
		expect(state.uiRequests).toHaveLength(0);
		expect(parseCediaUiRequest({ ...envelope, request: { ...envelope.request, message: 42 } })).toBeUndefined();
		expect(parseCediaUiRequest({ kind: "interactive", token: "tok-p", request: { method: "password", id: "p1", title: "Secret" } })?.request.method).toBe("password");
		expect(parseCediaUiRequest({ kind: "interactive", token: "tok-m", request: { method: "multi_select", id: "m1", title: "Pick", options: ["a", "b"] } })?.request.method).toBe("multi_select");
		expect(parseCediaUiRequest({ kind: "interactive", token: "tok-s", request: { method: "schemaform", id: "s1", title: "Form" } })?.request.method).toBe("schemaform");
		expect(parseCediaUiRequest({ kind: "interactive", token: "tok-c", request: { method: "confirm", id: "c1", title: "Allow?", message: "run", scopes: ["cwd"], dangerous: true } })?.request).toMatchObject({ scopes: ["cwd"], dangerous: true });
		expect(parseCediaUiRequest({
			kind: "interactive",
			token: "tok-r",
			request: {
				method: "select",
				id: "s1",
				title: "Pick",
				options: ["a", "b"],
				required: true,
				optionDetails: [{ value: "a", label: "Alpha", description: "first" }, { description: "second" }],
			},
		})?.request).toMatchObject({
			required: true,
			optionDetails: [{ value: "a", label: "Alpha", description: "first" }, { description: "second" }],
		});
	});

	it("does not treat message fragments with no journal sequence as duplicates", () => {
		let state = createInitialTaskState();
		state = applyFrame(state, { type: "message_start", messageId: "m", role: "assistant" });
		state = applyFrame(state, { type: "message_update", messageId: "m", delta: "one" });
		state = applyFrame(state, { type: "message_update", messageId: "m", delta: " two" });
		expect(state.transcript[0]?.text).toBe("one two");
	});

	it("marks in-flight commands unknown on disconnect and never makes them replayable", () => {
		let state = createInitialTaskState();
		state = reduceTaskState(state, { type: "command_created", command: { commandId: "cmd-1", incarnation: "inc-1", command: "prompt", payload: { message: "go" } } });
		state = reduceTaskState(state, { type: "command_status", commandId: "cmd-1", status: "sent" });
		state = reduceTaskState(state, { type: "connection", status: "offline", error: "host closed" });
		expect(state.pendingCommands["cmd-1"]).toMatchObject({ status: "unknown", replayable: false });
	});
});

// Item 63a: the task-shell message boundary is deleted with webview.ts — the dock
// talks to the extension through the bridge contract (bridge-contract.test.ts).
