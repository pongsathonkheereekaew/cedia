import { describe, expect, test } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_CONTROLLER_FRAME_BYTES,
	OmpOwnerControlClient,
	OmpOwnerControlDisconnectedError,
	OmpOwnerControlError,
} from "../src/owner-control-client.ts";

const identity = {
	sessionId: "session-a",
	incarnation: "inc-a",
	pid: process.pid,
	processStartIdentity: "darwin-ps-lstart:v1:Mon Sep 28 08:32:42 2026",
	ownerStartedAt: "2026-09-28T00:00:00.000Z",
	cwd: "/tmp/cedia-session",
	sessionFile: "/tmp/cedia-session/session.jsonl",
} as const;

const ready = {
	type: "ready",
	protocolVersion: 1,
	supportedProtocolVersions: [1, 2],
	maxFrameBytes: 1024 * 1024,
	maxReassembledFrameBytes: 64 * 1024 * 1024,
	cediaVirtualUiVersion: 1,
	cediaModelRolesVersion: 1,
	cediaAuthVersion: 1,
	cediaTurnBridgeVersion: 1,
	cediaPendingModelVersion: 1,
	cediaGoalVersion: 1,
	cediaPlanVersion: 1,
	cediaCapabilitiesVersion: 1,
	cediaOwnerControllerVersion: 1,
	cediaOwnerControllerMaxFrameBytes: 1024 * 1024,
	cediaOwnerControllerMaxPending: 64,
} as const;

type Request = Record<string, unknown>;

async function fixtureServer(onRequest: (socket: Socket, request: Request) => void): Promise<{ server: Server; socketPath: string; dir: string }> {
	const dir = await mkdtemp(join(tmpdir(), "owner-control-test-"));
	const socketPath = join(dir, "owner.sock");
	const server = createServer(socket => {
		let buffered = "";
		socket.setEncoding("utf8");
		socket.on("data", chunk => {
			buffered += chunk;
			for (;;) {
				const newline = buffered.indexOf("\n");
				if (newline < 0) return;
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				onRequest(socket, JSON.parse(line) as Request);
			}
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return { server, socketPath, dir };
}

function claimReply(request: Request, mode: "read-write" | "read-only" = "read-write", leaseId = "lease-a"): Request {
	return {
		protocolVersion: 3,
		id: request.id,
		ok: true,
		controllerProtocolVersion: 1,
		leaseId,
		identity,
		mode,
		ready,
	};
}

function send(socket: Socket, frame: Request): void {
	socket.write(`${JSON.stringify(frame)}\n`);
}

async function stopFixture(fixture: { server: Server; dir: string }): Promise<void> {
	await new Promise<void>(resolve => fixture.server.close(() => resolve()));
	await rm(fixture.dir, { recursive: true, force: true });
}

describe("OmpOwnerControlClient", () => {
	test("claims one owner lease, correlates out-of-order ACKs, forwards events, and sends tracked side-channel replies", async () => {
		const seen: Request[] = [];
		const frames: Record<string, unknown>[] = [];
		let commandRequests: Request[] = [];
		const fixture = await fixtureServer((socket, request) => {
			seen.push(request);
			if (request.request === "claim_controller") {
				send(socket, claimReply(request));
				setTimeout(() => send(socket, { protocolVersion: 3, type: "controller_frame", leaseId: "lease-a", frame: { type: "extension_ui_request", id: "ui-1", method: "confirm", title: "Approve", message: "Continue?" } }), 1);
				return;
			}
			if (request.request === "controller_command") {
				commandRequests.push(request);
				if (commandRequests.length === 2) {
					for (const item of [...commandRequests].reverse()) {
						const command = item.command as Request;
						send(socket, {
							protocolVersion: 3,
							type: "controller_frame",
							leaseId: "lease-a",
							frame: { type: "response", id: item.id, command: command.type, success: true, data: { command: command.type } },
						});
					}
				}
				return;
			}
			if (request.request === "controller_sidechannel") return;
		});
		const client = await OmpOwnerControlClient.attach({ socket: fixture.socketPath, token: "secret", protocolVersion: 3, expectedIdentity: identity, timeoutMs: 1_000, requestTimeoutMs: 500, onFrame: frame => frames.push(frame) });
		expect(client.mode).toBe("read-write");
		expect(client.leaseId).toBe("lease-a");
		expect(client.readyFrame?.type).toBe("ready");
		const [first, second] = await Promise.all([
			client.request("get_state", {}),
			client.request("get_available_commands", {}),
		]);
		expect(first.data).toEqual({ command: "get_state" });
		expect(second.data).toEqual({ command: "get_available_commands" });
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(frames.some(frame => frame.type === "extension_ui_request" && frame.id === "ui-1")).toBe(true);
		await client.send({ type: "extension_ui_response", id: "ui-1", confirmed: true });
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(seen.some(request => request.request === "controller_sidechannel" && (request.frame as Request).id === "ui-1")).toBe(true);
		await client.close();
		expect(seen.some(request => request.request === "release_controller" && request.leaseId === "lease-a")).toBe(true);
		await stopFixture(fixture);
	});

	test("refuses mutations locally when the owner grants a read-only claim", async () => {
		const requests: Request[] = [];
		const fixture = await fixtureServer((socket, request) => {
			requests.push(request);
			if (request.request === "claim_controller") send(socket, claimReply(request, "read-only"));
			if (request.request === "controller_command") {
				const command = request.command as Request;
				send(socket, { protocolVersion: 3, type: "controller_frame", leaseId: "lease-a", frame: { type: "response", id: request.id, command: command.type, success: true, data: { ok: true } } });
			}
		});
		const client = await OmpOwnerControlClient.attach({ socket: fixture.socketPath, token: "secret", protocolVersion: 3, expectedIdentity: identity, timeoutMs: 1_000 });
		await expect(client.request("prompt", { message: "must not dispatch" })).rejects.toThrow("read-only");
		await expect(client.requestCedia("cedia_set_model_role", { role: "default", modelId: "x" })).rejects.toThrow("read-only");
		await expect(client.request("get_state", {})).resolves.toMatchObject({ success: true });
		expect(requests.filter(request => request.request === "controller_command")).toHaveLength(1);
		client.detach();
		await stopFixture(fixture);
	});

	test("reports claim denial and identity mismatch without starting a second owner", async () => {
		const denied = await fixtureServer((socket, request) => {
			if (request.request === "claim_controller") send(socket, { protocolVersion: 3, id: request.id, ok: false, error: "controller_busy" });
		});
		await expect(OmpOwnerControlClient.attach({ socket: denied.socketPath, token: "secret", protocolVersion: 3, expectedIdentity: identity, timeoutMs: 1_000 })).rejects.toMatchObject({ name: "OmpOwnerControlError", code: "controller_busy" });
		await stopFixture(denied);

		const mismatched = await fixtureServer((socket, request) => {
			if (request.request === "claim_controller") send(socket, { ...claimReply(request), identity: { ...identity, processStartIdentity: "darwin-ps-lstart:v1:Mon Sep 28 08:32:43 2026" } });
		});
		await expect(OmpOwnerControlClient.attach({ socket: mismatched.socketPath, token: "secret", protocolVersion: 3, expectedIdentity: identity, timeoutMs: 1_000 })).rejects.toThrow("identity mismatch");
		await stopFixture(mismatched);
	});

	test("correlates an owner-side command refusal without waiting for a timeout", async () => {
		const fixture = await fixtureServer((socket, request) => {
			if (request.request === "claim_controller") send(socket, claimReply(request));
			if (request.request === "controller_command") send(socket, { protocolVersion: 3, id: request.id, ok: false, error: "credit_guard_required" });
		});
		const client = await OmpOwnerControlClient.attach({ socket: fixture.socketPath, token: "secret", protocolVersion: 3, expectedIdentity: identity, timeoutMs: 1_000, requestTimeoutMs: 500 });
		await expect(client.request("prompt", { message: "guarded" })).rejects.toMatchObject({ name: "OmpCommandError", code: "credit_guard_required" });
		client.detach();
		await stopFixture(fixture);
	});

	test("removes cancelled side-channel requests and fails closed on side-channel backlog", async () => {
		const cancelled = await fixtureServer((socket, request) => {
			if (request.request !== "claim_controller") return;
			send(socket, claimReply(request));
			setTimeout(() => {
				send(socket, { protocolVersion: 3, type: "controller_frame", leaseId: "lease-a", frame: { type: "extension_ui_request", id: "ui-cancelled", method: "confirm", title: "x", message: "x" } });
				send(socket, { protocolVersion: 3, type: "controller_frame", leaseId: "lease-a", frame: { type: "extension_ui_request", id: "ui-cancel", method: "cancel", targetId: "ui-cancelled" } });
			}, 5);
		});
		const client = await OmpOwnerControlClient.attach({ socket: cancelled.socketPath, token: "secret", protocolVersion: 3, expectedIdentity: identity, timeoutMs: 1_000 });
		await new Promise(resolve => setTimeout(resolve, 20));
		await expect(client.send({ type: "extension_ui_response", id: "ui-cancelled", confirmed: true })).rejects.toThrow("does not match");
		client.detach();
		await stopFixture(cancelled);

		const overflow = await fixtureServer((socket, request) => {
			if (request.request !== "claim_controller") return;
			send(socket, claimReply(request));
			setTimeout(() => {
				for (let index = 0; index < 65; index++)
					send(socket, { protocolVersion: 3, type: "controller_frame", leaseId: "lease-a", frame: { type: "host_tool_call", id: `call-${index}`, toolCallId: `tool-${index}`, toolName: "fixture", arguments: {} } });
			}, 5);
		});
		const overflowing = await OmpOwnerControlClient.attach({ socket: overflow.socketPath, token: "secret", protocolVersion: 3, expectedIdentity: identity, timeoutMs: 1_000 });
		await new Promise(resolve => setTimeout(resolve, 40));
		expect(overflowing.phase).toBe("closed");
		await stopFixture(overflow);
	});

		test("marks a dispatched command outcome unknown when the owner disconnects and bounds outgoing frames", async () => {
		let commandCount = 0;
		const fixture = await fixtureServer((socket, request) => {
			if (request.request === "claim_controller") send(socket, claimReply(request));
			if (request.request === "controller_command") {
				commandCount++;
				if (commandCount === 1) socket.destroy();
			}
		});
		const client = await OmpOwnerControlClient.attach({ socket: fixture.socketPath, token: "secret", protocolVersion: 3, expectedIdentity: identity, timeoutMs: 1_000, requestTimeoutMs: 500 });
		await expect(client.request("prompt", { message: "x".repeat(MAX_CONTROLLER_FRAME_BYTES) })).rejects.toThrow(/1 MiB/);
		await expect(client.request("prompt", { message: "will be unknown" })).rejects.toBeInstanceOf(OmpOwnerControlDisconnectedError);
		expect(commandCount).toBe(1);
		await stopFixture(fixture);
	});

	test("rejects a controller frame from a different lease", async () => {
		const fixture = await fixtureServer((socket, request) => {
			if (request.request === "claim_controller") {
				send(socket, claimReply(request));
				setTimeout(() => send(socket, { protocolVersion: 3, type: "controller_frame", leaseId: "other-lease", frame: { type: "response", id: "unknown", command: "get_state", success: true } }), 5);
			}
		});
		const client = await OmpOwnerControlClient.attach({ socket: fixture.socketPath, token: "secret", protocolVersion: 3, expectedIdentity: identity, timeoutMs: 1_000 });
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(client.phase).toBe("closed");
		await stopFixture(fixture);
	});
});
