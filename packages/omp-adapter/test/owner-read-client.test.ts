import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachCediaOwnerReadClient } from "../src/owner-read-client.ts";

describe("Cedia owner read client", () => {
	test("correlates concurrent allowlisted reads and detach leaves owner socket alive", async () => {
		let requests = 0;
		const server = createServer(socket => {
			let buffered = "";
			socket.setEncoding("utf8");
			socket.on("data", chunk => {
				buffered += chunk;
				for (;;) {
					const newline = buffered.indexOf("\n");
					if (newline < 0) break;
					const request = JSON.parse(buffered.slice(0, newline));
					buffered = buffered.slice(newline + 1);
					if (request.request === "identify") {
						socket.write(`${JSON.stringify({ protocolVersion: 3, ok: true, id: request.id, identity: { sessionId: "session-a", incarnation: "inc-a", pid: process.pid, processStartIdentity: "darwin-ps-lstart:v1:Mon Sep 28 08:32:42 2026", ownerStartedAt: "2026-09-28T00:00:00.000Z", cwd: "/tmp" } })}\n`);
					} else {
						requests++;
					const data = request.command === "get_state" ? { sessionId: "session-a", provider: "openai", modelId: "model-x", isStreaming: false, isCompacting: false, queuedMessageCount: 1, messageCount: 4, creditGuardEnabled: false } : { commands: [], truncated: false };
						setTimeout(() => socket.write(`${JSON.stringify({ protocolVersion: 3, ok: true, id: request.id, command: request.command, data })}\n`), request.command === "get_state" ? 10 : 1);
					}
				}
			});
		});
		const dir = await mkdtemp(join(tmpdir(), "owner-read-test-"));
		const socketPath = join(dir, "owner.sock");
		await new Promise<void>(resolve => server.listen(socketPath, resolve));
		const client = await attachCediaOwnerReadClient({
			socket: socketPath, token: "secret", protocolVersion: 3,
			expectedIdentity: { sessionId: "session-a", incarnation: "inc-a", pid: process.pid, processStartIdentity: "darwin-ps-lstart:v1:Mon Sep 28 08:32:42 2026", ownerStartedAt: "2026-09-28T00:00:00.000Z" },
		});
		const [state, commands] = await Promise.all([client.getState(), client.getAvailableCommands()]);
		expect(state).toEqual({ sessionId: "session-a", provider: "openai", modelId: "model-x", isStreaming: false, isCompacting: false, queuedMessageCount: 1, messageCount: 4, creditGuardEnabled: false });
		expect(commands).toEqual({ commands: [], truncated: false });
		expect(requests).toBe(2);
		client.detach();
		expect(server.listening).toBe(true);
		await new Promise<void>(resolve => server.close(() => resolve()));
		await rm(dir, { recursive: true, force: true });
	});

	test("rejects an identity mismatch before returning an attached client", async () => {
		const server = createServer(socket => {
			let buffered = "";
			socket.setEncoding("utf8");
			socket.on("data", chunk => {
				buffered += chunk;
				if (!buffered.includes("\n")) return;
				const request = JSON.parse(buffered.slice(0, buffered.indexOf("\n")));
				socket.end(`${JSON.stringify({ protocolVersion: 3, ok: true, id: request.id, identity: { sessionId: "other", incarnation: "inc-a", pid: process.pid, processStartIdentity: "darwin-ps-lstart:v1:Mon Sep 28 08:32:42 2026", ownerStartedAt: "2026-09-28T00:00:00.000Z", cwd: "/tmp" } })}\n`);
			});
		});
		const dir = await mkdtemp(join(tmpdir(), "owner-read-test-"));
		const socketPath = join(dir, "owner.sock");
		await new Promise<void>(resolve => server.listen(socketPath, resolve));
		await expect(attachCediaOwnerReadClient({
			socket: socketPath, token: "secret", protocolVersion: 3,
			expectedIdentity: { sessionId: "session-a", incarnation: "inc-a", pid: process.pid, processStartIdentity: "darwin-ps-lstart:v1:Mon Sep 28 08:32:42 2026", ownerStartedAt: "2026-09-28T00:00:00.000Z" },
		})).rejects.toThrow("identity mismatch");
		await new Promise<void>(resolve => server.close(() => resolve()));
		await rm(dir, { recursive: true, force: true });
	});
});
