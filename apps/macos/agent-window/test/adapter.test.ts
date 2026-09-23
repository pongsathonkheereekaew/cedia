import { describe, expect, it } from "bun:test";
import { Schema } from "../vendor/synara/packages/contracts/node_modules/effect/dist/index.js";
import { OrchestrationShellSnapshot, OrchestrationThreadDetailSnapshot, ThreadId } from "@synara/contracts";
import { resolveLatestTailUserMessageEditTarget } from "@synara/shared/conversationEdit";
import { useComposerDraftStore } from "../vendor/synara/apps/web/src/composerDraftStore";
import { useComposerFocusRequestStore } from "../vendor/synara/apps/web/src/composerFocusRequestStore";

import {
	createCediaNativeApi,
	OMP_UNRESOLVED_MODEL,
	projectCediaShellSnapshot,
} from "../src/cedia-adapter.ts";

type Request = {
	kind: "request";
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: string;
	body?: unknown;
};

const project = {
	id: "project-1",
	path: "/workspace/demo",
	name: "Demo",
	pinned: true,
	archived: false,
	createdAt: "2026-09-19T00:00:00.000Z",
};

const session = {
	id: "session-1",
	projectId: project.id,
	title: "First task",
	cwd: project.path,
	sessionFile: "/state/session-1.json",
	incarnation: "inc-1",
	status: "idle" as const,
	archived: false,
	createdAt: "2026-09-19T00:01:00.000Z",
	updatedAt: "2026-09-19T00:02:00.000Z",
};

const frames = [
	{
		sessionId: session.id,
		incarnation: session.incarnation,
		sequence: 1,
		timestamp: "2026-09-19T00:03:00.000Z",
		frame: { type: "message_start", message: { id: "user-1", role: "user", content: "hello" } },
	},
	{
		sessionId: session.id,
		incarnation: session.incarnation,
		sequence: 2,
		timestamp: "2026-09-19T00:03:01.000Z",
		frame: { type: "message_start", message: { id: "assistant-1", role: "assistant", content: "hi" } },
	},
];

function fakeBridge(
	eventFrames = frames,
	// A caller can hand the fixture another answer for a command, or another session row, without
	// restating the routes the rest of the suite depends on.
	options: { commands?: Record<string, unknown>; session?: Record<string, unknown> } = {},
) {
	const calls: Request[] = [];
	// One mutable row, so the fixture behaves like the host: a PATCH changes what the
	// next read returns. Archive/unarchive tests are meaningless otherwise.
	let row: Record<string, unknown> = { ...session, ...(options.session ?? {}) };
	const bridge = {
		invoke: async (_channel: string, request: Request) => {
			calls.push(request);
			if ((request as Request & { kind?: string }).kind === "bootstrap") return { platform: "darwin", homeDir: "/Users/tester", worktreesDir: "/Users/tester/Library/Application Support/Cedia/host/worktrees", version: "test-host" };
			if ((request as Request & { kind?: string }).kind === "keybindings") {
				const action = (request as unknown as { action?: string }).action;
				if (action === "read") return { configPath: "/Users/tester/Library/Application Support/Cedia/User/keybindings.json", keybindings: [], issues: [] };
				if (action === "write") {
					const rule = (request as unknown as { rule?: { key?: string; command?: string } }).rule;
					return { keybindings: [{ command: rule?.command ?? "chat.new", shortcut: { key: "n", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, modKey: true } }], issues: [] };
				}
				throw new Error(`Unexpected keybindings action ${action}`);
			}
			if (request.path === "/v1/projects") return [project];
			if (request.path === "/v1/models") return {
				source: "omp",
				models: [{ id: "fixture-model", provider: "fixture", label: "Fixture model", reasoning: true, thinking: ["low", "high"], contextWindow: 128000, maxTokens: 4096 }],
			};
			if (request.path === `/v1/sessions?projectId=${project.id}`) return [row];
			// The host answers a PATCH with the updated row, so the fixture must too: a
			// reader that only saw the pre-patch row would make archive/unarchive look inert.
			if (request.path === `/v1/sessions/${session.id}` && request.method === "PATCH") {
				row = { ...row, ...(request.body as Record<string, unknown>) };
				return row;
			}
			if (request.path === `/v1/sessions/${session.id}` && request.method === "DELETE") return { deleted: true };
			if (request.path === `/v1/sessions/${session.id}`) return row;
			if (request.path === `/v1/sessions/${session.id}/fork`) return { ...session, id: "side-1", sidechatSourceThreadId: session.id };
			if (request.path === `/v1/sessions/${session.id}/start` && request.method === "POST") return { ...row, status: "running", incarnation: "inc-2", updatedAt: "2026-09-19T00:03:00.000Z" };
			if (request.path.startsWith(`/v1/sessions/${session.id}/events`)) {
				return { events: eventFrames, cursor: eventFrames.at(-1)?.sequence ?? 0, hasMore: false };
			}
			if (request.path === "/v1/sessions" && request.method === "POST") {
				return { ...session, id: "session-created", title: (request.body as { title?: string }).title ?? "New task" };
			}
			if (request.path.endsWith("/commands") && request.method === "POST") {
				const kind = (request.body as { command: string }).command;
				const answer = options.commands?.[kind];
				if (answer !== undefined) return answer;
				if (kind === "get_branch_messages") return { status: "completed", result: { data: { messages: [{ entryId: "entry-1", text: "hello" }] } } };
				if (kind === "get_available_commands") return { status: "completed", result: { data: { commands: [
					{ name: "review", description: "Review a change", source: "builtin" },
					{ name: "super-review", description: "A skill of OMP", source: "skill" },
				] } } };
				if (kind === "branch") return { status: "completed", result: { data: { text: "hello", cancelled: false } } };
				if (kind === "get_messages") return { status: "completed", result: { data: { messages: [{ id: "user-1", role: "user", content: [{ type: "text", text: "hello" }] }] } } };
				return {
					sessionId: session.id,
					commandId: (request.body as { commandId: string }).commandId,
					incarnation: session.incarnation,
					kind,
					payload: (request.body as { payload?: unknown }).payload ?? null,
					status: "acknowledged",
				};
			}
			throw new Error(`Unexpected ${request.method} ${request.path}`);
		},
	};
	return { bridge, calls };
}

/** The commands a dispatch sent, in order, with the payload each carried. */
function sentCommands(calls: readonly Request[]): Array<{ command: string; payload?: Record<string, unknown> }> {
	return calls
		.filter(call => call.path.endsWith("/commands"))
		.map(call => {
			// The fixture records the very body it was handed on the command route.
			const body = call.body as { command: string; payload?: Record<string, unknown> };
			return { command: body.command, payload: body.payload };
		});
}

describe("Cedia Agent Window native adapter", () => {
	it("shows no terminal transport rows in the chat transcript", async () => {
		// The visible symptom: a turn's virtual-terminal repaints arrived as activity
		// rows whose summary was a raw escape sequence, so the chat read as garbage.
		// They belong to the terminal panel's own channel, never to this transcript.
		const events = [
			...frames,
			{
				sessionId: session.id,
				incarnation: session.incarnation,
				sequence: 10,
				timestamp: "2026-09-19T00:06:00.000Z",
				frame: { type: "cedia_terminal_open", terminalId: "tty-1", title: "Shell", cols: 80, rows: 24 },
			},
			...Array.from({ length: 3 }, (_, index) => ({
				sessionId: session.id,
				incarnation: session.incarnation,
				sequence: 11 + index,
				timestamp: "2026-09-19T00:06:01.000Z",
				frame: {
					type: "cedia_terminal_output",
					terminalId: "tty-1",
					sequence: index,
					data: "\u001b[?25l\u001b[1;1H\u001b[38;2;107;114;128mxdev: xd://: mounted\u001b[0m",
				},
			})),
		];
		const api = createCediaNativeApi({ bridge: fakeBridge(events).bridge });
		const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
		const activities = detail.thread.activities as ReadonlyArray<{ kind?: string; summary?: string }>;

		expect(activities.some(activity => activity.kind === "cedia_terminal_output")).toBe(false);
		expect(activities.some(activity => activity.kind === "cedia_terminal_open")).toBe(false);
		const rendered = JSON.stringify(activities);
		expect(rendered).not.toContain("\u001b[");
		expect(rendered).not.toContain("cedia_terminal_");
	});

	it("refreshes OMP context occupancy after messages without polling its own state replies", async () => {
		const events = [...frames, { sessionId: session.id, incarnation: session.incarnation, sequence: 3,
			timestamp: "2026-09-19T00:04:00.000Z", frame: { type: "agent_end", isTerminal: true } }];
		const { bridge } = fakeBridge(events);
		let reads = 0;
		let used = 32000;
		const api = createCediaNativeApi({ bridge: { invoke: async (channel, input) => {
			const request = input as Request;
			if (request.path?.endsWith("/commands") && (request.body as { command?: string })?.command === "get_state") {
				reads++;
				return { result: { data: { contextUsage: { tokens: used, contextWindow: 128000 } } } };
			}
			return bridge.invoke(channel, request);
		} } });
		const first = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
		expect(Schema.is(OrchestrationThreadDetailSnapshot)(first)).toBe(true);
		expect(first.thread.activities.at(-1)).toMatchObject({ kind: "context-window.updated", payload: { usedTokens: 32000, maxTokens: 128000, usedPercent: 25 } });
		await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
		expect(reads).toBe(1);
		used = 8000;
		events.push({ sessionId: session.id, incarnation: session.incarnation, sequence: 4,
			timestamp: "2026-09-19T00:05:00.000Z", frame: { type: "auto_compaction_end", isTerminal: true } });
		const compacted = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
		expect(compacted.thread.activities.at(-1)).toMatchObject({ payload: { usedTokens: 8000, usedPercent: 6.25 } });
		expect(reads).toBe(2);
	});

	it("carries a forked task's source task from the session row into both snapshots", async () => {
		// The adapter used to declare its own session row with an index signature, so
		// `sidechatSourceThreadId` — the field the host really sends and the split pane
		// really reads — was invisible to the compiler (§10 item 65c).
		const forked = { ...session, id: "side-1", sidechatSourceThreadId: session.id };
		const { bridge } = fakeBridge();
		const api = createCediaNativeApi({ bridge: { invoke: async (channel, input) => {
			const request = input as Request;
			if (request.path === "/v1/sessions/side-1") return forked;
			if (request.path === `/v1/sessions?projectId=${project.id}`) return [session, forked];
			if (request.path?.startsWith("/v1/sessions/side-1/")) return bridge.invoke(channel, { ...request, path: `/v1/sessions/${session.id}/${request.path.slice("/v1/sessions/side-1/".length)}` });
			return bridge.invoke(channel, request);
		} } });

		const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: "side-1" });
		expect(detail.thread.sidechatSourceThreadId).toBe(session.id);
		expect(Schema.is(OrchestrationThreadDetailSnapshot)(detail)).toBe(true);

		const shell = await api.orchestration.getShellSnapshot();
		const rows = shell.threads as ReadonlyArray<{ id: string; sidechatSourceThreadId: string | null }>;
		expect(rows.find(row => row.id === "side-1")?.sidechatSourceThreadId).toBe(session.id);
		expect(rows.find(row => row.id === session.id)?.sidechatSourceThreadId).toBeNull();
	});

	it("forks side chats through OMP without submitting renderer-provided history", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });
		await api.orchestration.dispatchCommand({ type: "thread.fork.create", commandId: "fork-1", threadId: "side-1", sourceThreadId: session.id, title: "Side chat", importedMessages: [{ role: "user", text: "untrusted renderer history" }] });
		expect(calls).toContainEqual({ kind: "request", method: "POST", path: `/v1/sessions/${session.id}/fork`, body: { id: "side-1", title: "Side chat" } });
		expect(JSON.stringify(calls)).not.toContain("untrusted renderer history");
	});
	it("projects durable Cedia projects and sessions into a Synara shell snapshot", async () => {
		const { bridge } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		const snapshot = await api.orchestration.getShellSnapshot();
		expect(Schema.is(OrchestrationShellSnapshot)(snapshot)).toBe(true);

		expect(snapshot.projects).toHaveLength(1);
		expect(snapshot.projects[0]).toMatchObject({
			id: project.id,
			title: project.name,
			workspaceRoot: project.path,
			isPinned: true,
		});
		expect(snapshot.threads[0]).toMatchObject({ id: session.id, projectId: project.id, title: session.title });
		expect(snapshot.threads[0]?.session).toMatchObject({ threadId: session.id, status: "idle" });
	});

	it("loads the shell without replaying every task transcript", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });
		const snapshot = await api.orchestration.getShellSnapshot();
		expect(snapshot.threads).toHaveLength(1);
		expect(calls.filter(call => call.path?.includes("/events"))).toEqual([]);
		// Selecting a task still hydrates its durable OMP transcript.
		await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
		expect(calls.some(call => call.path?.includes("/events"))).toBe(true);
	});

	it("updates background task lifecycle from host metadata without replaying history", async () => {
		const activeFrames = [...frames, {
			sessionId: session.id, incarnation: session.incarnation, sequence: 3,
			timestamp: "2026-09-19T00:03:02.000Z", frame: { type: "agent_start", id: "turn-active" },
		}];
		const { bridge, calls } = fakeBridge(activeFrames);
		let status = "running";
		const api = createCediaNativeApi({ bridge: { invoke: async (channel, input) => {
			const result = await bridge.invoke(channel, input as Request);
			return (input as Request).path === `/v1/sessions?projectId=${project.id}`
				? [{ ...session, status }] : result;
		} } });
		const cold = await api.orchestration.getShellSnapshot();
		expect(cold.threads[0]?.session?.status).toBe("running");
		await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
		status = "idle";
		calls.length = 0;
		const completed = await api.orchestration.getShellSnapshot();
		expect(completed.threads[0]?.session?.status).toBe("idle");
		expect(completed.threads[0]?.session?.activeTurnId).toBeNull();
		expect(completed.threads[0]?.latestTurn).toBeNull();
		expect(calls.some(call => call.path?.includes("/events"))).toBe(false);
	});

	it("hydrates OMP events into thread messages without inventing provider output", async () => {
		const { bridge } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
		expect(Schema.is(OrchestrationThreadDetailSnapshot)(detail)).toBe(true);

		expect(detail.thread.messages.map(message => [message.role, message.text])).toEqual([
			["user", "hello"],
			["assistant", "hi"],
		]);
		expect(detail.thread.messages.every(message => message.source === "native")).toBe(true);
	});

	it("projects an active OMP turn and tool history while hiding control frames", async () => {
		const eventFrames = [
			...frames,
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 3, timestamp: "2026-09-19T00:03:02.000Z", frame: { type: "cedia_command", command: { kind: "prompt", commandId: "turn-1", status: "acknowledged" } } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 4, timestamp: "2026-09-19T00:03:03.000Z", frame: { type: "agent_start", id: "turn-1" } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 5, timestamp: "2026-09-19T00:03:04.000Z", frame: { type: "tool_execution_start", toolCallId: "tool-1", toolName: "read_file", arguments: { path: "README.md" } } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 6, timestamp: "2026-09-19T00:03:05.000Z", frame: { type: "tool_execution_end", toolCallId: "tool-1", toolName: "read_file", result: "contents" } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 7, timestamp: "2026-09-19T00:03:06.000Z", frame: { type: "response", data: { model: { id: "fixture-model", provider: "fixture" } } } },
		];
		const { bridge } = fakeBridge(eventFrames);
		const api = createCediaNativeApi({ bridge });

		const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });

		expect(detail.thread.session).toMatchObject({ status: "running", activeTurnId: "turn-1" });
		expect(detail.thread.latestTurn).toMatchObject({ turnId: "turn-1", state: "running" });
		expect(detail.thread.modelSelection).toMatchObject({ provider: "omp", model: "fixture/fixture-model", ompProvider: "fixture" });
		expect(detail.thread.activities).toHaveLength(1);
		expect(detail.thread.activities[0]).toMatchObject({ kind: "read_file", tone: "tool" });
		expect(detail.thread.activities.some((activity: { kind?: string }) => activity.kind === "cedia_command")).toBe(false);
		expect(Schema.is(OrchestrationThreadDetailSnapshot)(detail)).toBe(true);
	});

	it("does not put a finished turn back into running when its command ack arrives", async () => {
		// The host records a prompt twice: the request when it is created, and a write-through ack
		// carrying the result when it finishes. The ack lands after that turn's `agent_end`, so
		// reading it as "a turn started" left the task `running` forever - measured live 2026-09-20:
		// the window showed `Thinking` after the answer had arrived, offered `Steer` instead of
		// `Send`, and queued every later message instead of sending it.
		const eventFrames = [
			...frames,
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 3, timestamp: "2026-09-20T04:05:40.075Z", frame: { type: "cedia_command", command: { commandId: "turn-1", kind: "prompt", payload: { message: "hi" } } } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 4, timestamp: "2026-09-20T04:05:42.000Z", frame: { type: "agent_start", id: "turn-1" } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 5, timestamp: "2026-09-20T04:05:43.000Z", frame: { type: "agent_end", isTerminal: true } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 6, timestamp: "2026-09-20T04:05:43.100Z", frame: { type: "cedia_command", command: { commandId: "turn-1", kind: "prompt", status: "completed", ack: { command: "prompt", success: true }, result: { isTerminal: true } } } },
		];
		const { bridge } = fakeBridge(eventFrames);
		const api = createCediaNativeApi({ bridge });

		const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });

		expect(detail.thread.latestTurn).toMatchObject({ turnId: "turn-1", state: "completed" });
		expect(detail.thread.session).toMatchObject({ activeTurnId: null });
	});

	it("keeps OMP lifecycle frames out of the transcript after an auto-retry storm", async () => {
		// Measured live 2026-09-20: a turn that OMP retried printed `Turn_start`, `Turn_end`,
		// `Auto_retry_start`, `Auto_retry_end` and `Model_changed` as transcript rows, because the
		// reducer stores one `event` entry per unmodelled frame and hands it the frame's own type as
		// its text. Only the tool call that ran and the messages belong on screen.
		const eventFrames = [
			...frames,
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 3, timestamp: "2026-09-20T03:05:28.000Z", frame: { type: "cedia_command", command: { kind: "prompt", commandId: "turn-1", status: "acknowledged" } } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 4, timestamp: "2026-09-20T03:05:29.000Z", frame: { type: "turn_start" } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 5, timestamp: "2026-09-20T03:05:30.000Z", frame: { type: "agent_start", id: "turn-1" } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 6, timestamp: "2026-09-20T03:05:31.000Z", frame: { type: "turn_end" } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 7, timestamp: "2026-09-20T03:05:32.000Z", frame: { type: "auto_retry_start", attempt: 2, delayMs: 59972 } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 8, timestamp: "2026-09-20T03:05:33.000Z", frame: { type: "auto_retry_end" } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 9, timestamp: "2026-09-20T03:05:34.000Z", frame: { type: "model_changed" } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 10, timestamp: "2026-09-20T03:05:35.000Z", frame: { type: "thinking_level_changed", thinkingLevel: "high" } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 11, timestamp: "2026-09-20T03:05:36.000Z", frame: { type: "advisor_cost_changed" } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 12, timestamp: "2026-09-20T03:05:37.000Z", frame: { type: "agent_end", id: "turn-1" } },
		];
		const { bridge } = fakeBridge(eventFrames);
		const api = createCediaNativeApi({ bridge });

		const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });

		expect(detail.thread.activities).toEqual([]);
		expect(detail.thread.messages.map(message => [message.role, message.text])).toEqual([
			["user", "hello"],
			["assistant", "hi"],
		]);
		// The frames still reach the reducer: the turn projection and the model selection read them.
		expect(detail.thread.latestTurn).toMatchObject({ turnId: "turn-1", state: "completed" });
		expect(Schema.is(OrchestrationThreadDetailSnapshot)(detail)).toBe(true);
	});

	it("prints the provider's own sentence when a turn ends on a provider error", async () => {
		// Measured live 2026-09-20: a rate-limited turn recorded `message_start` with no content and
		// then a `message_end` carrying `stopReason: "error"` plus the provider's `errorMessage`. The
		// row had no text, so the timeline painted `(empty response)` and the reason the turn produced
		// nothing never reached the window. The Code-OSS sessions window already prints that sentence
		// through `entryFailureText`; this path has to say the same thing.
		const eventFrames = [
			...frames,
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 3, timestamp: "2026-09-20T03:05:29.000Z", frame: { type: "message_start", message: { id: "assistant-2", role: "assistant", content: [] } } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 4, timestamp: "2026-09-20T03:05:30.000Z", frame: { type: "message_end", message: { id: "assistant-2", role: "assistant", content: [], stopReason: "error", errorClassificationMessage: "Connect error resource_exhausted: Error", errorMessage: "You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue." } } },
		];
		const { bridge } = fakeBridge(eventFrames);
		const api = createCediaNativeApi({ bridge });

		const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });

		expect(detail.thread.messages.map(message => [message.role, message.text])).toEqual([
			["user", "hello"],
			["assistant", "hi"],
			["assistant", "You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue."],
		]);
		expect(detail.thread.messages.some(message => message.text === "(empty response)")).toBe(false);
		expect(Schema.is(OrchestrationThreadDetailSnapshot)(detail)).toBe(true);
	});

	it("dispatches a turn through the OMP command envelope with the durable incarnation", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		await api.orchestration.dispatchCommand({
			type: "thread.turn.start",
			commandId: "cmd-1",
			threadId: session.id,
			message: { messageId: "message-1", role: "user", text: "ship it", attachments: [] },
			runtimeMode: "approval-required",
			interactionMode: "default",
			createdAt: "2026-09-19T00:04:00.000Z",
		});

		const command = calls.find(call => call.path.endsWith("/commands"));
		expect(command).toMatchObject({
			method: "POST",
			body: {
				commandId: "cmd-1",
				incarnation: "inc-2",
				command: "prompt",
				payload: { message: "ship it" },
			},
		});
	});

	it("never sends the UI-only unresolved model sentinel to OMP", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		await api.orchestration.dispatchCommand({
			type: "thread.turn.start",
			commandId: "cmd-unresolved",
			threadId: session.id,
			message: { messageId: "message-unresolved", role: "user", text: "use OMP default", attachments: [] },
			modelSelection: { provider: "omp", model: OMP_UNRESOLVED_MODEL },
			runtimeMode: "approval-required",
			interactionMode: "default",
			createdAt: "2026-09-19T00:04:00.000Z",
		});

		expect(calls.filter(call => call.path.endsWith("/commands")).map(call => (call.body as { command: string }).command)).toEqual(["prompt"]);
	});

	it("uses the native bootstrap paths in server configuration", async () => {
		const { bridge } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		const config = await api.server.getConfig();
		expect(config).toMatchObject({
			cwd: "/Users/tester",
			homeDir: "/Users/tester",
			worktreesDir: "/Users/tester/Library/Application Support/Cedia/host/worktrees",
			keybindingsConfigPath: "/Users/tester/Library/Application Support/Cedia/User/keybindings.json",
		});
	});
	it("reads and writes the real keybindings file through the bridge (item 57)", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		const config = await api.server.getConfig();
		expect(config.keybindings).toEqual([]);
		const written = await api.server.upsertKeybinding({ rule: { key: "mod+n", command: "chat.new" } });
		expect(written.keybindings).toHaveLength(1);
		const ops = calls.filter(call => (call as unknown as { kind?: string }).kind === "keybindings");
		expect(ops.map(op => (op as unknown as { action?: string }).action)).toEqual(["read", "write"]);
		expect((ops[1] as unknown as { file?: string }).file).toBe("/Users/tester/Library/Application Support/Cedia/User/keybindings.json");
	});

	it("emits a snapshot envelope to subscribers after a refresh", async () => {
		const { bridge } = fakeBridge();
		const api = createCediaNativeApi({ bridge });
		const events: unknown[] = [];
		const unsubscribe = api.orchestration.onShellEvent(event => events.push(event));

		await api.orchestration.subscribeShell();
		await api.orchestration.getShellSnapshot();
		unsubscribe();

		expect(events.some(event => (event as { kind?: string }).kind === "snapshot")).toBe(true);
	});

	it("stays quiet when a poll finds nothing new, and speaks when it does", async () => {
		// `subscribeThread`/`subscribeShell` poll the host once a second and emit what they read,
		// and the window repaints on every emit. Measured 2026-09-20 on an idle task: one snapshot
		// per second produced ~510 DOM mutations a second with the renderer pinned at 110% CPU,
		// which a user reads as the chat flickering. A poll that finds the same cursor, session and
		// catalog has nothing to say, and only a change may reach the window.
		const eventFrames = [...frames];
		const { bridge } = fakeBridge(eventFrames);
		const api = createCediaNativeApi({ bridge });
		const shellEvents: unknown[] = [];
		const threadEvents: unknown[] = [];
		api.orchestration.onShellEvent(event => shellEvents.push(event));
		api.orchestration.onThreadEvent(event => threadEvents.push(event));

		await api.orchestration.subscribeShell();
		await api.orchestration.subscribeThread({ threadId: session.id });
		const shellAfterFirst = shellEvents.length;
		const threadAfterFirst = threadEvents.length;
		expect(shellAfterFirst).toBeGreaterThan(0);
		expect(threadAfterFirst).toBeGreaterThan(0);

		await api.orchestration.subscribeShell();
		await api.orchestration.subscribeThread({ threadId: session.id });
		expect(shellEvents.length).toBe(shellAfterFirst);
		expect(threadEvents.length).toBe(threadAfterFirst);

		// A new event moves the cursor, and that is news.
		eventFrames.push({
			sessionId: session.id,
			incarnation: session.incarnation,
			sequence: 3,
			timestamp: "2026-09-19T00:04:00.000Z",
			frame: { type: "message_end", message: { id: "assistant-2", role: "assistant", content: [{ type: "text", text: "more" }], stopReason: "stop" } },
		});
		await api.orchestration.subscribeThread({ threadId: session.id });
		expect(threadEvents.length).toBeGreaterThan(threadAfterFirst);
		await api.orchestration.unsubscribeShell();
		await api.orchestration.unsubscribeThread({ threadId: session.id });
	});

	it("keeps the workspace metadata the renderer asserts, without patching the host for it", async () => {
		// The branch toolbar keeps a local thread pointing at the checkout it sits in: when the
		// thread's `branch` disagrees with the current Git branch it dispatches `thread.meta.update`
		// (`shouldSyncLocalThreadBranch`). Cedia dropped those fields and projected `branch: null`
		// forever, so the toolbar re-asked ~60 times a second and every ask stamped the session's
		// `updated_at`, which the poll then read as news. Measured live 2026-09-20: 549 dispatches
		// in 9s with the renderer pinned at 110% CPU.
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		await api.orchestration.dispatchCommand({
			type: "thread.meta.update",
			commandId: "meta-1",
			threadId: session.id,
			envMode: "local",
			branch: "codex/single-opencode-namespace",
			worktreePath: null,
			associatedWorktreePath: null,
			associatedWorktreeBranch: null,
			associatedWorktreeRef: null,
		});

		const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
		expect(detail.thread).toMatchObject({
			envMode: "local",
			branch: "codex/single-opencode-namespace",
			worktreePath: null,
			associatedWorktreePath: null,
		});
		// The command carried no host field, so the session row must not move: an empty `PATCH`
		// still stamps `updated_at` on the host, and the poll would report that as a change.
		expect(calls.some(call => call.method === "PATCH")).toBe(false);

		// A field the host does own still reaches it.
		await api.orchestration.dispatchCommand({ type: "thread.meta.update", commandId: "meta-2", threadId: session.id, title: "Renamed" });
		expect(calls.some(call => call.method === "PATCH" && (call.body as { title?: string }).title === "Renamed")).toBe(true);
	});

	it("archives a thread the window put away, and only an explicit delete removes one", async () => {
		// §10 item 1d: the renderer's temporary-thread lifecycle used to dispatch `thread.delete`
		// when focus left a draft, and this host's DELETE removes the record and its transcript -
		// so a `New task` thread the user glanced away from was gone for good (observed
		// 2026-09-20). The automatic path now archives (the disposal hook calls
		// `archiveThreadFromClient`), which keeps the two intents apart in the adapter too.
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		await api.orchestration.dispatchCommand({ type: "thread.archive", commandId: "archive-1", threadId: session.id });
		expect(calls.some(call => call.path === `/v1/sessions/${session.id}` && call.method === "PATCH" && (call.body as { archived?: boolean }).archived === true)).toBe(true);
		expect(calls.some(call => call.method === "DELETE")).toBe(false);

		const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
		expect(detail.thread.archivedAt).not.toBeNull();

		// Restoring is the same field the other way, and an explicit delete still deletes.
		await api.orchestration.dispatchCommand({ type: "thread.unarchive", commandId: "unarchive-1", threadId: session.id });
		expect(calls.some(call => call.method === "PATCH" && (call.body as { archived?: boolean }).archived === false)).toBe(true);

		await api.orchestration.dispatchCommand({ type: "thread.delete", commandId: "delete-1", threadId: session.id });
		expect(calls.some(call => call.method === "DELETE" && call.path === `/v1/sessions/${session.id}`)).toBe(true);
	});

	it("carries a turn id so the window offers its edit affordance", async () => {
		// Synara's "edit message" button is gated on `resolveLatestTailUserMessageEditTarget`, which
		// answers `missing-turn-metadata` unless the tail from the latest user message belongs to
		// exactly one turn. Cedia projected `turnId: null` for every message, so the button never
		// rendered (measured live 2026-09-20: zero `Edit message` controls).
		const eventFrames = [
			// The host records the prompt when it is created, the messages while it runs, and the
			// write-through ack when it finishes - that order is what makes the ack harmless.
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 1, timestamp: "2026-09-19T00:03:59.000Z", frame: { type: "cedia_command", command: { commandId: "turn-1", kind: "prompt", payload: { message: "hello" } } } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 2, timestamp: "2026-09-19T00:04:00.000Z", frame: { type: "message_start", message: { id: "user-1", role: "user", content: "hello" } } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 3, timestamp: "2026-09-19T00:04:01.000Z", frame: { type: "message_start", message: { id: "assistant-1", role: "assistant", content: "hi" } } },
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 4, timestamp: "2026-09-19T00:04:02.000Z", frame: { type: "cedia_command", command: { commandId: "turn-1", kind: "prompt", ack: { command: "prompt", success: true }, result: { isTerminal: true } } } },
		];
		const { bridge } = fakeBridge(eventFrames);
		const api = createCediaNativeApi({ bridge });

		const detail = await api.orchestration.getThreadDetailSnapshot({ threadId: session.id });
		const messages = detail.thread.messages as ReadonlyArray<{ id: string; role: string; turnId: string | null; source?: string }>;
		const target = resolveLatestTailUserMessageEditTarget({ messages });

		expect(target).toMatchObject({ editable: true, messageId: "user-1", mode: "rollback" });
		// The write-through ack must not count as a second turn, or the tail would span two.
		expect(messages.find(message => message.id === "assistant-1")?.turnId).toBe("turn-1");
	});

	it("rewinds through OMP's own branch and resubmits the edited text", async () => {
		// OMP rewinds by branching: the conversation is cut at that user message and the abandoned
		// path stays in the session tree. Cedia's journal is append-only, so the transcript has to be
		// re-read from OMP's current leaf afterwards or the window would keep showing the old tail.
		const eventFrames = [
			...frames,
			{ sessionId: session.id, incarnation: session.incarnation, sequence: 3, timestamp: "2026-09-19T00:04:00.000Z", frame: { type: "cedia_command", command: { commandId: "turn-1", kind: "prompt", payload: { message: "hello" } } } },
		];
		const { bridge, calls } = fakeBridge(eventFrames);
		const api = createCediaNativeApi({ bridge });

		await api.orchestration.dispatchCommand({
			type: "thread.message.edit-and-resend",
			commandId: "edit-1",
			threadId: session.id,
			messageId: "user-1",
			text: "hello, again",
			runtimeMode: "approval-required",
			interactionMode: "default",
		});

		const sent = calls.filter(call => call.path.endsWith("/commands")).map(call => (call.body as { command: string; payload?: Record<string, unknown> }));
		expect(sent.map(call => call.command)).toEqual(["get_branch_messages", "branch", "get_messages", "prompt"]);
		expect(sent[1]?.payload).toEqual({ entryId: "entry-1" });
		expect(sent[3]?.payload).toEqual({ message: "hello, again" });
	});

	// A task with three turns: a rewind target can then be a message that is not the last one.
	const rewindFrames = [
		{ sessionId: session.id, incarnation: session.incarnation, sequence: 1, timestamp: "2026-09-19T00:03:00.000Z", frame: { type: "message_start", message: { id: "user-1", role: "user", content: "hello" } } },
		{ sessionId: session.id, incarnation: session.incarnation, sequence: 2, timestamp: "2026-09-19T00:03:01.000Z", frame: { type: "message_start", message: { id: "assistant-1", role: "assistant", content: "hi" } } },
		{ sessionId: session.id, incarnation: session.incarnation, sequence: 3, timestamp: "2026-09-19T00:03:02.000Z", frame: { type: "message_start", message: { id: "user-2", role: "user", content: "second question" } } },
		{ sessionId: session.id, incarnation: session.incarnation, sequence: 4, timestamp: "2026-09-19T00:03:03.000Z", frame: { type: "message_start", message: { id: "assistant-2", role: "assistant", content: "answer two" } } },
		{ sessionId: session.id, incarnation: session.incarnation, sequence: 5, timestamp: "2026-09-19T00:03:04.000Z", frame: { type: "message_start", message: { id: "user-3", role: "user", content: "third question" } } },
		{ sessionId: session.id, incarnation: session.incarnation, sequence: 6, timestamp: "2026-09-19T00:03:05.000Z", frame: { type: "message_start", message: { id: "assistant-3", role: "assistant", content: "answer three" } } },
	];
	/** The three rewind points OMP offers for `rewindFrames`, and its branch answer for the second. */
	const rewindCommands = {
		get_branch_messages: { status: "completed", result: { data: { messages: [
			{ entryId: "entry-1", text: "hello" },
			{ entryId: "entry-2", text: "second question" },
			{ entryId: "entry-3", text: "third question" },
		] } } },
		branch: { status: "completed", result: { data: { text: "second question", cancelled: false } } },
		get_messages: { status: "completed", result: { data: { messages: [
			{ id: "user-1", role: "user", content: [{ type: "text", text: "hello" }] },
			{ id: "assistant-1", role: "assistant", content: [{ type: "text", text: "hi" }] },
		] } } },
	};
	const rollbackCommand = {
		type: "thread.conversation.rollback" as const,
		commandId: "rollback-1",
		threadId: session.id,
		messageId: "user-2",
		numTurns: 1,
		createdAt: "2026-09-19T00:05:00.000Z",
	};

	it("rewinds to a message that is not the last one, and sends nothing after it", async () => {
		// §10 item 1b: the window's "Revert to this message" control was gated on turn-diff
		// checkpoints this adapter never projects, and its click dispatched `thread.checkpoint.revert`
		// - a command the adapter refuses. The rewind is OMP's own branch, addressed by the message the
		// user named, and it stops at the branch: the returned text belongs in the composer, never in
		// a new turn.
		const { bridge, calls } = fakeBridge(rewindFrames, { commands: rewindCommands });
		const api = createCediaNativeApi({ bridge });

		await api.orchestration.dispatchCommand({ ...rollbackCommand });

		const sent = sentCommands(calls);
		expect(sent.map(call => call.command)).toEqual(["get_branch_messages", "branch", "get_messages"]);
		// The second of three messages: the entry branched at is the second rewind point, not the tail.
		expect(sent[1]?.payload).toEqual({ entryId: "entry-2" });
	});

	it("puts the rewound message back into the composer and focuses it", async () => {
		const thread = ThreadId.makeUnsafe(session.id);
		useComposerDraftStore.getState().setPrompt(thread, "");
		const focusesBefore = useComposerFocusRequestStore.getState().requestsByThreadId[session.id] ?? 0;
		const { bridge } = fakeBridge(rewindFrames, { commands: rewindCommands });
		const api = createCediaNativeApi({ bridge });

		await api.orchestration.dispatchCommand({ ...rollbackCommand });

		expect(useComposerDraftStore.getState().draftsByThreadId[thread]?.prompt).toBe("second question");
		expect(useComposerFocusRequestStore.getState().requestsByThreadId[session.id]).toBe(focusesBefore + 1);
		useComposerDraftStore.getState().setPrompt(thread, "");
	});

	it("refuses to rewind when OMP's rewind points and the transcript disagree", async () => {
		// OMP omits user messages whose extracted text is empty, and Cedia's journal keeps rows OMP's
		// current branch no longer holds. Two points against three rows is exactly that skew, and the
		// Nth row then names a different message than the user's: here the second row would branch at
		// OMP's second point, which the user never named. The text has to single a point out, and it
		// does not, so nothing is branched.
		const { bridge, calls } = fakeBridge(rewindFrames, { commands: {
			get_branch_messages: { status: "completed", result: { data: { messages: [
				{ entryId: "entry-1", text: "hello" },
				{ entryId: "entry-2", text: "third question" },
			] } } },
		} });
		const api = createCediaNativeApi({ bridge });

		await expect(api.orchestration.dispatchCommand({ ...rollbackCommand })).rejects.toThrow(/does not single one out/);

		expect(sentCommands(calls).map(call => call.command)).toEqual(["get_branch_messages"]);
	});

	it("finds the rewind point by text when OMP lists a message the window never rendered", async () => {
		// The other side of the same skew: OMP's branch holds a user message this transcript has no
		// row for, so the ordinal would branch one message early. The text names exactly one point and
		// that point is the one branched at.
		const { bridge, calls } = fakeBridge(rewindFrames, { commands: {
			get_branch_messages: { status: "completed", result: { data: { messages: [
				{ entryId: "entry-1", text: "hello" },
				{ entryId: "entry-2", text: "a summary this window never rendered" },
				{ entryId: "entry-3", text: "second question" },
				{ entryId: "entry-4", text: "third question" },
			] } } },
			branch: { status: "completed", result: { data: { text: "second question", cancelled: false } } },
			get_messages: rewindCommands.get_messages,
		} });
		const api = createCediaNativeApi({ bridge });

		await api.orchestration.dispatchCommand({ ...rollbackCommand });

		const sent = sentCommands(calls);
		expect(sent.map(call => call.command)).toEqual(["get_branch_messages", "branch", "get_messages"]);
		expect(sent[1]?.payload).toEqual({ entryId: "entry-3" });
	});

	it("refuses to rewind a running task, like the edit path does", async () => {
		const { bridge, calls } = fakeBridge(rewindFrames, { commands: rewindCommands, session: { status: "running" } });
		const api = createCediaNativeApi({ bridge });

		await expect(api.orchestration.dispatchCommand({ ...rollbackCommand })).rejects.toThrow("Interrupt the current turn before rewinding to an earlier message.");

		expect(calls.some(call => call.path.endsWith("/commands"))).toBe(false);
	});

	it("keeps the pure projection stable for an empty host", () => {
		const snapshot = projectCediaShellSnapshot([], [], 1, "2026-09-19T00:00:00.000Z");
		expect(snapshot).toEqual({
			snapshotSequence: 1,
			spaces: [],
			projects: [],
			threads: [],
			updatedAt: "2026-09-19T00:00:00.000Z",
		});
	});

	it("discovers models through the global host catalog without starting a task", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		const result = await api.provider.listModels({ provider: "omp" });

		expect(result).toMatchObject({ source: "omp" });
		expect(result.models).toEqual([expect.objectContaining({
			slug: "fixture/fixture-model",
			name: "Fixture model",
			upstreamProviderId: "fixture",
			upstreamProviderName: "fixture",
			supportedReasoningEfforts: [
				{ value: "low", label: "low" },
				{ value: "high", label: "high" },
			],
			maxOutputTokens: 4096,
			contextWindow: 128000,
		})]);
		expect(calls.some(call => call.path === "/v1/models")).toBe(true);
		expect(calls.some(call => call.path.endsWith("/start"))).toBe(false);
	});

	it("refuses a catalog answer that carries no model list", async () => {
		const { bridge } = fakeBridge();
		const api = createCediaNativeApi({ bridge: { invoke: async (channel, input) => {
			if ((input as Request).path === "/v1/models") return { source: "omp" };
			return bridge.invoke(channel, input as Request);
		} } });

		// "The host answered with no catalog" and "the picker has nothing to show" are
		// different facts: only the second may be silent, or a broken host reads as
		// "OMP advertises no models".
		await expect(api.provider.listModels({ provider: "omp" })).rejects.toThrow("did not return a model catalog");

		const unreachable = createCediaNativeApi({ bridge: { invoke: async (channel, input) => {
			if ((input as Request).path === "/v1/models") throw new Error("relay unavailable");
			return bridge.invoke(channel, input as Request);
		} } });
		await expect(unreachable.provider.listModels({ provider: "omp" })).resolves.toEqual({ models: [], source: "omp" });
	});

	it("persists the picker selection through OMP before Synara submits the turn", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });
		await api.orchestration.dispatchCommand({ type: "thread.meta.update", commandId: "pick-model", threadId: session.id,
			modelSelection: { provider: "omp", model: "fixture/fixture-model" } });
		expect(calls.find(call => call.path.endsWith("/commands") && (call.body as { command?: string })?.command === "set_model")).toMatchObject({
			body: { payload: { provider: "fixture", modelId: "fixture-model" } },
		});
		expect(calls.some(call => (call.body as { command?: string })?.command === "prompt")).toBe(false);
	});

	it("resolves a selected provider-qualified model from the global catalog", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		await api.orchestration.dispatchCommand({
			type: "thread.turn.start",
			commandId: "cmd-model",
			threadId: session.id,
			message: { messageId: "message-model", role: "user", text: "use fixture", attachments: [] },
			modelSelection: { provider: "omp", model: "fixture/fixture-model", ompProvider: "fixture" },
			runtimeMode: "approval-required",
			interactionMode: "default",
			createdAt: "2026-09-19T00:04:00.000Z",
		});

		expect(calls.find(call => call.path.endsWith("/commands") && (call.body as { command?: string })?.command === "set_model")).toMatchObject({
			body: { payload: { provider: "fixture", modelId: "fixture-model" } },
		});
		expect(calls.some(call => call.path === "/v1/models")).toBe(true);
	});
	it("creates the project through host POST /v1/projects (item 59)", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });
		await api.orchestration.dispatchCommand({ type: "project.create", commandId: "project-1", projectId: "project-new", workspaceRoot: "/repo/new-project", title: "New project" });
		const posted = calls.find(call => call.path === "/v1/projects" && call.method === "POST");
		expect((posted?.body as { id?: string; path?: string; name?: string })).toEqual({ id: "project-new", path: "/repo/new-project", name: "New project" });
		// No GitHub provisioning path: the adapter has no second project source.
		expect(calls.some(call => JSON.stringify(call).includes("provisionFromGitHub"))).toBe(false);
	});
});

it("routes duplicate model IDs by upstream provider and passes the selected thinking level", async () => {
  const { bridge, calls } = fakeBridge();
  const original = bridge.invoke;
  bridge.invoke = async (channel, request) => {
    if (request.path === "/v1/models") {
      calls.push(request);
      return { source: "omp", models: [
        { id: "same", provider: "a", reasoning: true, thinking: ["high"] },
        { id: "same", provider: "b", reasoning: true, thinking: ["high"] },
      ] } as any;
    }
    return original(channel, request);
  };
  const api = createCediaNativeApi({ bridge });
  await api.orchestration.dispatchCommand({ type: "thread.turn.start", commandId: "model-turn", threadId: session.id, message: { text: "hello" }, modelSelection: { provider: "omp", model: "b/same", options: { thinkingLevel: "high" } } });
  expect(calls.find(call => (call.body as { command?: string })?.command === "set_model")?.body).toMatchObject({ incarnation: "inc-2", payload: { provider: "b", modelId: "same" } });
  expect(calls.find(call => (call.body as { command?: string })?.command === "set_thinking_level")?.body).toMatchObject({ payload: { level: "high" } });
});

describe("attachments, mentions and skills reach OMP (Cedia §10 items 61-62)", () => {
	const imageAttachment = {
		type: "image" as const,
		id: "img-1",
		name: "shot.png",
		mimeType: "image/png",
		sizeBytes: 2,
		previewUrl: "blob:preview",
		file: new File([new Uint8Array([104, 105])], "shot.png", { type: "image/png" }),
	};

	it("folds image bytes into OMP's images[] and names files/mentions", async () => {
		await useComposerDraftStore.getState().addImages(ThreadId.makeUnsafe(session.id), [imageAttachment]);
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		await api.orchestration.dispatchCommand({
			type: "thread.turn.start",
			commandId: "cmd-attach",
			threadId: session.id,
			message: {
				text: "look at this",
				attachments: [
					{ type: "image", id: "img-1", name: "shot.png", mimeType: "image/png", sizeBytes: 2 },
					{ type: "file", id: "file-1", name: "notes.md", mimeType: "text/markdown", sizeBytes: 12 },
				],
				mentions: [{ name: "x.ts", path: "/workspace/demo/src/x.ts" }],
			},
		});

		const prompt = calls.find(
			(call) => call.path.endsWith("/commands") && (call.body as { command?: string })?.command === "prompt",
		);
		expect(prompt?.body).toMatchObject({
			payload: {
				message:
					"look at this\n\nAttached context:\n- notes.md\n- /workspace/demo/src/x.ts",
				images: [{ type: "image", data: "aGk=", mimeType: "image/png" }],
			},
		});
	});

	it("refuses to drop an image whose bytes cannot be read", async () => {
		const { bridge } = fakeBridge();
		const api = createCediaNativeApi({ bridge });
		await expect(
			api.orchestration.dispatchCommand({
				type: "thread.turn.start",
				commandId: "cmd-missing-bytes",
				threadId: session.id,
				message: {
					text: "look",
					attachments: [{ type: "image", id: "img-ghost", name: "ghost.png", mimeType: "image/png", sizeBytes: 1 }],
				},
			}),
		).rejects.toThrow("could not read the bytes");
	});

	it("advertises the real capabilities and splits OMP's catalogue by source", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		expect(await api.provider.getComposerCapabilities()).toMatchObject({
			supportsSkillDiscovery: true,
			supportsNativeSlashCommandDiscovery: true,
			supportsThreadCompaction: true,
		});

		const commands = await api.provider.listCommands({
			provider: "omp",
			cwd: "/workspace/demo",
			threadId: session.id,
		});
		expect(commands).toMatchObject({ source: "omp" });
		expect(commands.commands).toEqual([{ name: "review", description: "Review a change" }]);

		const skills = await api.provider.listSkills({
			provider: "omp",
			cwd: "/workspace/demo",
			threadId: session.id,
		});
		expect(skills).toMatchObject({ source: "omp" });
		expect(skills.skills).toEqual([
			{ name: "super-review", path: "super-review", enabled: true, description: "A skill of OMP" },
		]);

		expect(
			calls.filter(
				(call) => (call.body as { command?: string })?.command === "get_available_commands",
			),
		).toHaveLength(2);
	});

	it("asks no OMP catalogue without a host session, and compaction runs on OMP", async () => {
		const { bridge, calls } = fakeBridge();
		const api = createCediaNativeApi({ bridge });

		const draftCommands = await api.provider.listCommands({ provider: "omp", cwd: "/workspace/demo" });
		expect(draftCommands).toEqual({ commands: [], source: "omp" });
		expect(
			calls.some((call) => (call.body as { command?: string })?.command === "get_available_commands"),
		).toBe(false);

		await api.provider.compactThread({ threadId: session.id });
		expect(calls.some((call) => (call.body as { command?: string })?.command === "compact")).toBe(true);

		await expect(api.provider.compactThread({ threadId: "session-missing" })).rejects.toThrow();
	});
});
