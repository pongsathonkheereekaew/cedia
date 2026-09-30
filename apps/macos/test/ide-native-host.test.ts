import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHostServer, type StartedHostServer } from "../../host/src/server.ts";
import { CediaHostClient } from "../src/api.ts";
import { installVscodeStub, stubState, stubUri } from "./helpers/vscode-stub.ts";

/*
 * The only test in this repository that activates the Mac extension against a
 * real Cedia host.
 *
 * The other behavioural tests use an unreachable host, which proves the
 * surface degrades honestly but says nothing about the connected path. This one
 * starts the actual host server on a private loopback descriptor, seeds a
 * project through the real client, and checks that the workbench citizen
 * reflects the live connection instead of a placeholder.
 *
 * No OMP process is started: the host only spawns the agent runtime when a
 * session starts, and this slice stays at the project/connection surface.
 */

const vscodeApi: any = installVscodeStub();

// The host stores canonical paths, so the stub's workspace root must be
// canonical too or the extension will not match the open folder to a project.
const root = realpathSync(mkdtempSync(join(tmpdir(), "cedia-ide-host-")));
const stateDir = join(root, "host");
const workspace = join(root, "workspace");
mkdirSync(stateDir, { recursive: true });
mkdirSync(join(workspace, "src"), { recursive: true });
mkdirSync(join(root, "extension", "agent-ui"), { recursive: true });
// The IDE provider loads this renderer before it can accept its ready/RPC
// messages. The live-host test exercises the bridge, not the packaged asset
// build, so a minimal document keeps that boundary self-contained.
writeFileSync(join(root, "extension", "agent-ui", "ide.html"), "<!doctype html><html><head></head><body></body></html>");

let server: StartedHostServer;
let client: CediaHostClient;
let projectId = "";
let projectName = "";
let sharedDraftSessionId = "";

beforeAll(async () => {
	server = await startHostServer({ stateDir });
	// Seed through the real client so the whole client -> router -> store path
	// runs, not just the test's own HTTP calls.
	client = await CediaHostClient.fromStateDir(stateDir, { requirePrivateMode: true });
	const project = await client.createProject(workspace, "ide-native-fixture");
	projectId = project.id;
	projectName = project.name;
});

afterAll(async () => {
	await server.close();
	rmSync(root, { recursive: true, force: true });
});

stubState.workspaceRoot = workspace;
stubState.config.set("cedia.hostStateDir", stateDir);
// Empty host paths mean the extension may not start a helper; it must reach the
// host through the descriptor the server already published.
stubState.config.set("cedia.hostNodePath", "");
stubState.config.set("cedia.hostScriptPath", "");

const extension: any = await import("../src/extension.ts");
const { CediaIdeAgentProvider } = await import("../src/agent-ide-webview.ts");

function context(): any {
	return {
		extensionPath: join(root, "extension"),
		extensionUri: stubUri(`file://${join(root, "extension")}`),
		globalStorageUri: stubUri(`file://${join(root, "globalStorage", "cedia.cedia")}`),
		storageUri: stubUri(`file://${join(root, "workspaceStorage")}`),
		subscriptions: [],
		globalState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {}, keys: () => [] },
		workspaceState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {}, keys: () => [] },
		extension: { id: "cedia.cedia", packageJSON: { name: "cedia", publisher: "cedia", version: "0.1.0" } },
	};
}

interface WebviewHarness {
	view: any;
	posted: unknown[];
	receive(message: unknown): Promise<unknown>;
}

function createWebviewHarness(): WebviewHarness {
	let receiver: ((message: unknown) => unknown) | undefined;
	const posted: unknown[] = [];
	const webview = {
		html: "",
		options: {},
		cspSource: "",
		asWebviewUri: (uri: unknown) => uri,
		postMessage: async (message: unknown) => {
			posted.push(message);
			stubState.posted.push(message);
			return true;
		},
		onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
			receiver = listener;
			return { dispose() {} };
		},
	};
	return {
		view: {
			webview,
			onDidDispose: () => ({ dispose() {} }),
			onDidChangeVisibility: () => ({ dispose() {} }),
			show() {},
		},
		posted,
		receive: async (message: unknown) => receiver?.(message),
	};
}

let ide: WebviewHarness | undefined;
let requestId = 0;

async function resolveViews(): Promise<WebviewHarness> {
	if (ide) return ide;
	const entry = stubState.views.find(view => view.id === "cediaComposerDock");
	if (!entry) throw new Error("cediaComposerDock was not registered");
	ide = createWebviewHarness();
	await entry.provider.resolveWebviewView(ide.view);
	await ide.receive({ type: "cedia-agent-ready" });
	return ide;
}

async function ideRequest(input: Record<string, unknown>): Promise<any> {
	const bridge = await resolveViews();
	const id = `ide-host-${++requestId}`;
	await bridge.receive({ type: "cedia-agent-request", channel: "vscode:cediaAgent", id, input });
	const response = [...stubState.posted].reverse().find((message): message is { type: string; id: string; result?: unknown; error?: string } => {
		const value = message as { type?: string; id?: string };
		return value.type === "cedia-agent-response" && value.id === id;
	});
	if (!response) throw new Error(`No IDE response for ${id}`);
	if (response.error) throw new Error(response.error);
	return response.result;
}

describe("ide-native surface with a live host", () => {
	it("reports the real connection instead of a placeholder", async () => {
		extension.activate(context());
		const bootstrap = await ideRequest({ kind: "bootstrap" });
		expect(bootstrap).toMatchObject({ cwd: workspace });
		const health = await ideRequest({ kind: "request", method: "GET", path: "/v1/health" });
		expect(health).toMatchObject({ status: "ready" });
		// The status bar must show the state the host actually reported.
		const item = stubState.statusItems.at(-1)!;
		expect(item.text).toContain("Cedia ready");
		expect(item.visible).toBe(true);
		expect(item.command).toBe("cedia.showAgents");
		expect(vscodeApi).toBeDefined();
	});

	it("surfaces a project the host really stores", async () => {
		const projects = await ideRequest({ kind: "request", method: "GET", path: "/v1/projects" }) as readonly { name?: string }[];
		expect(projects.map(project => project.name)).toContain(projectName);
		// The bridge returns the host's project record directly; no local snapshot
		// projection is involved now that the dock is CediaIdeAgentProvider.
		expect(projects.find(project => project.name === projectName)).toBeDefined();
	});

	it("does not need to spawn a host helper when the descriptor is live", async () => {
		// Empty host paths would raise HostSetupRequiredError if the client had
		// needed to start one, so a bridge request proves the live descriptor path.
		const health = await ideRequest({ kind: "request", method: "GET", path: "/v1/health" });
		expect(health).toMatchObject({ status: "ready" });
		expect(stubState.statusMessages.some(message => message.includes("host helper"))).toBe(false);
	});

	it("lists a task the host really stores", async () => {
		const created = await client.createSession({ projectId, title: "Retry the sync client" });
		sharedDraftSessionId = created.id;
		const sessions = await ideRequest({ kind: "request", method: "GET", path: `/v1/sessions?projectId=${encodeURIComponent(projectId)}` }) as readonly { id?: string; title?: string }[];
		const titles = sessions.map(session => session.title);
		expect(titles).toContain("Retry the sync client");
		// The task the host minted is the one the client renders, not a local guess.
		const listed = await client.listSessions(projectId);
		expect(listed.map(session => session.id)).toContain(created.id);
	});

	it("forwards another window's committed draft into the IDE webview", async () => {
		const provider = new CediaIdeAgentProvider(context(), stateDir, async () => client, async () => {});
		const bridge = createWebviewHarness();
		await provider.resolveWebviewView(bridge.view);
		try {
			await bridge.receive({ type: "cedia-agent-ready" });
			await bridge.receive({
				type: "cedia-agent-request",
				channel: "vscode:cediaAgent",
				id: "draft-test-active-session",
				input: { kind: "activeSession", sessionId: sharedDraftSessionId },
			});
			const payload = { draft: { prompt: "typed in Agents" }, draftThread: null, projectMappings: {} };
			await client.requestApplication("PATCH", `/drafts/${encodeURIComponent(sharedDraftSessionId)}`, {
				expectedRevision: 0,
				text: "typed in Agents",
				content: payload,
			});

			const deadline = Date.now() + 3_000;
			let update: any;
			while (Date.now() < deadline) {
				update = bridge.posted.find((message: any) => message.type === "cedia-agent-event"
					&& message.channel === "vscode:cedia-draft-updated"
					&& message.payload?.threadId === sharedDraftSessionId);
				if (update) break;
				await new Promise(resolve => setTimeout(resolve, 25));
			}
			expect(update).toMatchObject({
				type: "cedia-agent-event",
				channel: "vscode:cedia-draft-updated",
				payload: { status: "written", threadId: sharedDraftSessionId, revision: 1, payload },
			});

			await client.requestApplication("POST", `/drafts/${encodeURIComponent(sharedDraftSessionId)}/clear`, { expectedRevision: 1 });
			const deliveryDeadline = Date.now() + 3_000;
			let delivered: any;
			while (Date.now() < deliveryDeadline) {
				delivered = bridge.posted.find((message: any) => message.type === "cedia-agent-event"
					&& message.channel === "vscode:cedia-draft-updated"
					&& message.payload?.status === "delivered"
					&& message.payload?.threadId === sharedDraftSessionId);
				if (delivered) break;
				await new Promise(resolve => setTimeout(resolve, 25));
			}
			expect(delivered).toMatchObject({
				type: "cedia-agent-event",
				channel: "vscode:cedia-draft-updated",
				payload: { status: "delivered", threadId: sharedDraftSessionId },
			});
		} finally {
			provider.dispose();
		}
	}, 15_000);

	it("pairs a device through the host and shows a real QR code", async () => {
		vscodeApi.window.showInputBox = async () => "Test iPhone";
		await stubState.commands.get("cedia.pairDevice")!();
		const panel = stubState.panels.at(-1);
		expect(panel).toBeDefined();
		expect(panel!.title).toBe("Pair iPhone");
		// A real QR data URL, not a placeholder image.
		expect(panel!.webview.html).toContain("data:image/png;base64,");
		const devices = await client.listDevices();
		expect(devices.map(device => device.name)).toContain("Test iPhone");
	});

	it("offers native code actions once a real task surface exists", async () => {
		// Runs after the activation above, like the project/task tests: the
		// provider is registered during activate(). Refresh the controller's
		// native task state explicitly; the IDE bridge intentionally returns
		// application records instead of emitting the retired snapshot.
		await stubState.commands.get("cedia.refresh")!();
		const provider = stubState.codeActions.at(-1);
		expect(provider).toBeDefined();
		const document = { uri: stubUri(`file://${join(workspace, "src", "greet.ts")}`) };
		const selection = provider!.provider.provideCodeActions(document, { isEmpty: false });
		expect(selection.map((action: { command?: { command: string } }) => action.command?.command))
			.toEqual(["cedia.explainSelection", "cedia.fixSelection", "cedia.inlineEdit", "cedia.addSelectionToTask", "cedia.reviewInDiff"]);
		// With no selection the file action survives; the selection actions do not.
		const cursor = provider!.provider.provideCodeActions(document, { isEmpty: true });
		expect(cursor.map((action: { command?: { command: string } }) => action.command?.command))
			.toEqual(["cedia.reviewInDiff"]);
		// A virtual document (the review original) never gets a file-space action.
		const virtual = provider!.provider.provideCodeActions({ uri: stubUri("cedia-review:/HEAD/src/greet.ts") }, { isEmpty: false });
		expect(virtual).toEqual([]);
	});
});
