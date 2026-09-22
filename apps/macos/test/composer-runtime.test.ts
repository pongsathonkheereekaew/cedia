import { describe, expect, it } from "bun:test";
import {
	normalizeOmpModels,
	projectOmpModelSnapshot,
} from "../src/omp-catalog.ts";
import {
	composerAxesFromTask,
	resolveComposerControls,
	shouldSendOnEnter,
	type ComposerControls,
	type ComposerTaskSnapshot,
} from "../src/composer-runtime.ts";

const connectedTask = {
	connection: "connected",
	project: { id: "proj-1" },
	session: { id: "session-1", status: "idle" },
	draft: "hello",
	uiRequests: [],
	pendingCommands: {},
	selectedModel: "test-model",
};

function controlsFrom(partial: Partial<ComposerTaskSnapshot>, extras?: Parameters<typeof composerAxesFromTask>[1]): ComposerControls {
	const axes = composerAxesFromTask({ ...connectedTask, ...partial }, extras);
	return resolveComposerControls(axes);
}

describe("composer runtime axes", () => {
	it("marks non-whitespace draft as a usable send payload when connected and idle", () => {
		const axes = composerAxesFromTask(connectedTask);
		expect(axes.connection).toBe("connected");
		expect(axes.run).toBe("idle");
		expect(axes.delivery).toBe("idle");
		expect(axes.usablePayload).toBe(true);
		const controls = resolveComposerControls(axes);
		expect(controls.primary).toBe("send");
		expect(controls.primaryEnabled).toBe(true);
		expect(controls.primaryLabel).toBe("Send");
		expect(controls.sendIntent).toBe("send_prompt");
		expect(controls.queueVisible).toBe(false);
		expect(controls.steerEnabled).toBe(false);
		expect(controls.stopEnabled).toBe(false);
	});

	it("uses Queue as the primary follow-up action while running with a payload", () => {
		const controls = controlsFrom({ session: { id: "session-1", status: "running" } });
		expect(controls.primary).toBe("queue");
		expect(controls.primaryEnabled).toBe(true);
		expect(controls.primaryLabel).toBe("Queue");
		expect(controls.queueVisible).toBe(true);
		expect(controls.queueEnabled).toBe(true);
		expect(controls.steerEnabled).toBe(true);
		expect(controls.stopEnabled).toBe(true);
		expect(controls.stopLabel).toBe("Stop");
		expect(controls.sendIntent).toBe("follow_up");
		expect(controls.modelEnabled).toBe(false);
	});

	it("maps reconnecting to waiting_host instead of check_status", () => {
		const controls = controlsFrom({ connection: "reconnecting" });
		expect(controls.primary).toBe("waiting_host");
		expect(controls.primaryEnabled).toBe(false);
		expect(controls.primaryReason).toBe("ติดต่อ Mac ไม่ได้ — เก็บฉบับร่างไว้แล้ว");
	});

	it("keeps offline composers draft-only with no send, queue, or steer", () => {
		const controls = controlsFrom({ connection: "offline" });
		expect(controls.primary).toBe("waiting_host");
		expect(controls.primaryEnabled).toBe(false);
		expect(controls.primaryLabel).toBe("Waiting for host");
		expect(controls.queueEnabled).toBe(false);
		expect(controls.steerEnabled).toBe(false);
		expect(controls.stopEnabled).toBe(false);
		expect(controls.modelEnabled).toBe(false);
		expect(controls.sendIntent).toBeNull();
	});

	it("treats unknown command outcome as Check status instead of Retry", () => {
		const controls = controlsFrom({
			pendingCommands: { "cmd-1": { status: "unknown", command: "send_prompt" } },
		});
		expect(controls.primary).toBe("check_status");
		expect(controls.primaryEnabled).toBe(true);
		expect(controls.primaryLabel).toBe("Check status");
		expect(controls.queueEnabled).toBe(false);
		expect(controls.steerEnabled).toBe(false);
		expect(controls.sendIntent).toBeNull();
	});

	it("keeps Stop available while running even when the payload is empty", () => {
		const controls = controlsFrom({ session: { id: "session-1", status: "running" }, draft: "   " });
		expect(controls.primary).toBe("queue");
		expect(controls.primaryEnabled).toBe(false);
		expect(controls.queueEnabled).toBe(false);
		expect(controls.steerEnabled).toBe(false);
		expect(controls.stopEnabled).toBe(true);
		expect(controls.stopLabel).toBe("Stop");
	});

	it("resolves structured model readiness and gates every action with a reason", () => {
		const axes = composerAxesFromTask({ ...connectedTask, selectedModel: undefined });
		expect(axes.modelReadiness).toBe("not_selected");
		expect(axes.modelReason).toBe("Choose a model");
		const controls = resolveComposerControls(axes);
		expect(controls.primaryEnabled).toBe(false);
		expect(controls.queueReason).toBeTruthy();
		expect(controls.steerReason).toBeTruthy();
		expect(controls.stopReason).toBeTruthy();
		expect(controls.sendIntent).toBeNull();
		const unavailable = composerAxesFromTask({ ...connectedTask, connection: "offline" });
		expect(unavailable.modelReadiness).toBe("unavailable");
		expect(unavailable.modelReason).toContain("unavailable");
	});

	it("drives sendIntent from the OMP catalog snapshot, not a hardcoded id", () => {
		const catalog = projectOmpModelSnapshot(
			normalizeOmpModels({ data: { models: [{ id: "probe-model", provider: "probe" }] } }),
			"probe-model",
		);
		const advertised = controlsFrom({ selectedModel: catalog.selectedModelId });
		expect(catalog.hasModels).toBe(true);
		expect(advertised.primary).toBe("send");
		expect(advertised.primaryEnabled).toBe(true);
		expect(advertised.sendIntent).toBe("send_prompt");
		const emptyCatalog = projectOmpModelSnapshot(normalizeOmpModels({ models: [] }), undefined);
		const disabled = controlsFrom({ selectedModel: emptyCatalog.selectedModelId });
		expect(emptyCatalog.hasModels).toBe(false);
		expect(disabled.primaryEnabled).toBe(false);
		expect(disabled.sendIntent).toBeNull();
		expect(disabled.primaryReason).toBe("Choose a model");
	});

	it("disables Send when the payload is empty", () => {
		const controls = controlsFrom({ draft: "" });
		expect(controls.primary).toBe("send");
		expect(controls.primaryEnabled).toBe(false);
		expect(controls.primaryLabel).toBe("Send");
		expect(controls.sendIntent).toBeNull();
	});

	it("counts a ready attachment as usable payload", () => {
		const axes = composerAxesFromTask({ ...connectedTask, draft: "" }, { attachmentsReady: 1 });
		expect(axes.usablePayload).toBe(true);
		expect(resolveComposerControls(axes).primaryEnabled).toBe(true);
	});

	it("blocks dispatch while an attachment is pending or failed", () => {
		const pending = controlsFrom({ draft: "hello" }, { attachmentsPending: 1 });
		expect(pending.primaryEnabled).toBe(false);
		const failed = controlsFrom({ session: { id: "session-1", status: "running" }, draft: "hello" }, { attachmentsFailed: 1 });
		expect(failed.primary).toBe("queue");
		expect(failed.primaryEnabled).toBe(false);
		expect(failed.stopEnabled).toBe(true);
	});

	it("maps awaiting ACK to Sending… and stopping abort to Stopping…", () => {
		const sending = controlsFrom({
			pendingCommands: { "cmd-1": { status: "sent", command: "send_prompt" } },
		});
		expect(sending.primary).toBe("sending");
		expect(sending.primaryEnabled).toBe(false);
		expect(sending.primaryLabel).toBe("Sending…");
		const stopping = controlsFrom({
			session: { id: "session-1", status: "running" },
			pendingCommands: { "abort-1": { status: "sent", command: "abort" } },
		});
		expect(stopping.primary).toBe("stopping");
		expect(stopping.primaryEnabled).toBe(false);
		expect(stopping.primaryLabel).toBe("Stopping…");
		expect(stopping.stopEnabled).toBe(false);
		expect(stopping.stopLabel).toBe("Stopping…");
		expect(stopping.queueEnabled).toBe(false);
	});

	it("queues while waiting on host input and does not treat it as a question response", () => {
		const controls = controlsFrom({
			session: { id: "session-1", status: "running" },
			uiRequests: [{ id: "req-1" }],
		});
		expect(composerAxesFromTask({ ...connectedTask, session: { id: "session-1", status: "running" }, uiRequests: [{ id: "req-1" }] }).run).toBe("waiting_input");
		expect(controls.primary).toBe("queue");
		expect(controls.primaryEnabled).toBe(true);
		expect(controls.steerEnabled).toBe(false);
		expect(controls.stopEnabled).toBe(true);
		expect(controls.modelEnabled).toBe(false);
	});

	it("asks for a project before send when no target exists", () => {
		const controls = controlsFrom({ project: null, session: null });
		expect(controls.primary).toBe("choose_project");
		expect(controls.primaryEnabled).toBe(true);
		expect(controls.primaryLabel).toBe("Choose project");
		expect(controls.queueVisible).toBe(false);
		expect(controls.stopEnabled).toBe(false);
	});
});

describe("composer enter intent", () => {
	it("sends on Enter when Send is enabled", () => {
		const controls = controlsFrom({ draft: "hello" });
		expect(shouldSendOnEnter({ composing: false, shiftKey: false, metaKey: false, controls })).toBe("send");
	});

	it("queues on Enter while running with a payload", () => {
		const controls = controlsFrom({ session: { id: "session-1", status: "running" } });
		expect(shouldSendOnEnter({ composing: false, shiftKey: false, metaKey: false, controls })).toBe("queue");
	});

	it("does not send during IME composition", () => {
		const controls = controlsFrom({ draft: "กำลังพิมพ์" });
		expect(shouldSendOnEnter({ composing: true, shiftKey: false, metaKey: false, controls })).toBe("ignore");
		const running = controlsFrom({ session: { id: "session-1", status: "running" } });
		expect(shouldSendOnEnter({ composing: true, shiftKey: false, metaKey: false, controls: running })).toBe("ignore");
		expect(shouldSendOnEnter({ composing: true, shiftKey: false, metaKey: true, submitEnter: false, controls })).toBe("ignore");
		expect(shouldSendOnEnter({ composing: true, shiftKey: false, metaKey: true, submitEnter: true, controls: running })).toBe("ignore");
	});

	it("inserts a newline on Shift+Enter and queues with Cmd+Enter only while running", () => {
		const ready = controlsFrom({ draft: "hello" });
		expect(shouldSendOnEnter({ composing: false, shiftKey: true, metaKey: false, controls: ready })).toBe("newline");
		expect(shouldSendOnEnter({ composing: false, shiftKey: false, metaKey: true, controls: ready })).toBe("newline");
		const running = controlsFrom({ session: { id: "session-1", status: "running" } });
		expect(shouldSendOnEnter({ composing: false, shiftKey: false, metaKey: true, controls: running })).toBe("queue");
	});

	it("sends with Cmd+Enter when submitEnter is off and idle with a payload", () => {
		const controls = controlsFrom({ draft: "hello" });
		expect(shouldSendOnEnter({ composing: false, shiftKey: false, metaKey: true, submitEnter: false, controls })).toBe("send");
	});

	it("inserts a newline on Enter without meta when submitEnter is off", () => {
		const controls = controlsFrom({ draft: "hello" });
		expect(shouldSendOnEnter({ composing: false, shiftKey: false, metaKey: false, submitEnter: false, controls })).toBe("newline");
	});

	it("queues with Cmd+Enter while running when submitEnter is on", () => {
		const controls = controlsFrom({ session: { id: "session-1", status: "running" } });
		expect(shouldSendOnEnter({ composing: false, shiftKey: false, metaKey: true, submitEnter: true, controls })).toBe("queue");
	});

	it("ignores Enter when Send or Queue is disabled", () => {
		const empty = controlsFrom({ draft: "" });
		expect(shouldSendOnEnter({ composing: false, shiftKey: false, metaKey: false, controls: empty })).toBe("ignore");
	});
});
