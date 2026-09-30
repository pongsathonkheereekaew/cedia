import { afterEach, describe, expect, it } from "bun:test";
import { WebSocket } from "ws";

import { CdpTabEndpoint, type CdpEndpointTab } from "../src/cdp-tab-endpoint.ts";

type MessageListener = (method: string, params?: Record<string, unknown>) => void;
type DetachListener = (reason: string) => void;

class FakeDebugger {
	attached = false;
	readonly answers = new Map<string, unknown>([
		["Page.navigate", { frameId: "f1" }],
		["Page.getFrameTree", { frameTree: { frame: { id: "frame-real-1" } } }],
	]);
	readonly messageListeners = new Set<MessageListener>();
	readonly detachListeners = new Set<DetachListener>();

	isAttached(): boolean {
		return this.attached;
	}

	async attach(): Promise<void> {
		this.attached = true;
	}

	async detach(): Promise<void> {
		this.attached = false;
		for (const listener of [...this.detachListeners]) listener("test-detach");
	}

	async sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (!this.attached) throw new Error("Debugger is not attached");
		if (!this.answers.has(method)) throw new Error(`Unknown method ${method}`);
		void params;
		return this.answers.get(method);
	}

	on(event: "message", listener: MessageListener): void;
	on(event: "detach", listener: DetachListener): void;
	on(event: string, listener: MessageListener | DetachListener): void {
		if (event === "message") this.messageListeners.add(listener as MessageListener);
		else this.detachListeners.add(listener as DetachListener);
	}

	removeListener(event: "message", listener: MessageListener): void;
	removeListener(event: "detach", listener: DetachListener): void;
	removeListener(event: string, listener: MessageListener | DetachListener): void {
		if (event === "message") this.messageListeners.delete(listener as MessageListener);
		else this.detachListeners.delete(listener as DetachListener);
	}

	emit(method: string, params?: Record<string, unknown>): void {
		for (const listener of [...this.messageListeners]) listener(method, params);
	}
}

function tab(tabId: string, attached: boolean): CdpEndpointTab {
	const debugger_ = new FakeDebugger();
	debugger_.attached = attached;
	return { tabId, url: `https://example.com/${tabId}`, title: `Title ${tabId}`, debugger: debugger_ };
}

function rpc(socket: WebSocket, method: string, params?: Record<string, unknown>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const id = Math.floor(Math.random() * 1_000_000);
		const timer = setTimeout(() => reject(new Error("CDP reply timeout")), 5_000);
		const onMessage = (data: unknown) => {
			let frame: { id?: unknown; result?: unknown; error?: unknown };
			try {
				frame = JSON.parse(String(data)) as typeof frame;
			} catch {
				return;
			}
			if (frame.id !== id) return;
			clearTimeout(timer);
			socket.removeListener("message", onMessage);
			if (frame.error !== undefined) reject(new Error(JSON.stringify(frame.error)));
			else resolve(frame.result);
		};
		socket.on("message", onMessage);
		socket.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }));
	});
}

const endpoints: CdpTabEndpoint[] = [];
afterEach(async () => {
	while (endpoints.length > 0) await endpoints.pop()?.close();
});

function browserRpc(socket: WebSocket, method: string, params?: Record<string, unknown>): Promise<unknown> {
	return rpc(socket, method, params);
}

async function openBrowserSocket(port: number): Promise<WebSocket> {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
	await new Promise<void>((resolve, reject) => {
		socket.on("open", () => resolve());
		socket.on("error", reject);
	});
	return socket;
}

describe("CdpTabEndpoint", () => {
	it("lists only attached tabs with websocket urls", async () => {
		const tabs = [tab("tab-1", true), tab("tab-2", false)];
		const endpoint = new CdpTabEndpoint(() => tabs);
		endpoints.push(endpoint);
		const address = await endpoint.listen();
		expect(address.url.startsWith("http://127.0.0.1:")).toBe(true);
		const list = (await (await fetch(`${address.url}/json/list`)).json()) as { id: string; webSocketDebuggerUrl: string }[];
		expect(list.map(entry => entry.id)).toEqual(["tab-1"]);
		expect(list[0]?.webSocketDebuggerUrl).toBe(`ws://127.0.0.1:${address.port}/tab-1`);
		const version = (await (await fetch(`${address.url}/json/version`)).json()) as { Browser: string };
		expect(version.Browser.length).toBeGreaterThan(0);
		const missing = await fetch(`${address.url}/json/nope`);
		expect(missing.status).toBe(404);
	});

	it("proxies commands and forwards debugger events, refusing unknown tabs and bad frames", async () => {
		const tabs = [tab("tab-1", true)];
		const endpoint = new CdpTabEndpoint(() => tabs);
		endpoints.push(endpoint);
		const address = await endpoint.listen();

		const socket = new WebSocket(`ws://127.0.0.1:${address.port}/tab-1`);
		await new Promise<void>((resolve, reject) => {
			socket.on("open", () => resolve());
			socket.on("error", reject);
		});
		try {
			expect(await rpc(socket, "Page.navigate", { url: "https://example.com/next" })).toEqual({ frameId: "f1" });
			await expect(rpc(socket, "Nope.nope")).rejects.toThrow("Unknown method");
			const seen: unknown[] = [];
			socket.on("message", data => {
				try {
					const frame = JSON.parse(String(data)) as { method?: string };
					if (frame.method !== undefined) seen.push(frame);
				} catch {
					// Replies carry ids, not methods; ignore them here.
				}
			});
			(tabs[0]?.debugger as FakeDebugger).emit("Page.loadEventFired", {});
			await new Promise(resolve => setTimeout(resolve, 100));
			expect(seen).toEqual([{ method: "Page.loadEventFired", params: {} }]);
		} finally {
			socket.terminate();
		}

		const stranger = new WebSocket(`ws://127.0.0.1:${address.port}/tab-9`);
		const closeCode = await new Promise<number>(resolve => {
			stranger.on("close", code => resolve(code));
		});
		expect(closeCode).toBe(4404);

		const rude = new WebSocket(`ws://127.0.0.1:${address.port}/tab-1`);
		const rudeCode = await new Promise<number>(resolve => {
			rude.on("open", () => rude.send("not-json{{"));
			rude.on("close", code => resolve(code));
		});
		expect(rudeCode).toBe(4400);
	});

	it("closes sockets when the debugger detaches and frees the port on close", async () => {
		const tabs = [tab("tab-1", true)];
		const endpoint = new CdpTabEndpoint(() => tabs);
		const address = await endpoint.listen();
		const socket = new WebSocket(`ws://127.0.0.1:${address.port}/tab-1`);
		await new Promise<void>((resolve, reject) => {
			socket.on("open", () => resolve());
			socket.on("error", reject);
		});
		const closeCode = new Promise<number>(resolve => {
			socket.on("close", code => resolve(code));
		});
		await (tabs[0]?.debugger as FakeDebugger).detach();
		expect(await closeCode).toBe(4499);
		await endpoint.close();
		await expect(fetch(`${address.url}/json/list`)).rejects.toThrow();
	});
});

describe("CdpTabEndpoint browser-level protocol", () => {
	it("exposes the browser socket on /json/version and lists page targets", async () => {
		const tabs = [tab("tab-1", true), tab("tab-2", false)];
		const endpoint = new CdpTabEndpoint(() => tabs);
		endpoints.push(endpoint);
		const address = await endpoint.listen();
		const version = (await (await fetch(`${address.url}/json/version`)).json()) as { webSocketDebuggerUrl?: string };
		expect(version.webSocketDebuggerUrl).toBe(`ws://127.0.0.1:${address.port}/`);
		const socket = await openBrowserSocket(address.port);
		try {
			const targets = (await browserRpc(socket, "Target.getTargets")) as { targetInfos: { targetId: string; type: string }[] };
			expect(targets.targetInfos.map(entry => entry.targetId)).toEqual(["tab-1"]);
			expect(targets.targetInfos[0]?.type).toBe("page");
		} finally {
			socket.terminate();
		}
	});

	it("attaches sessions, routes commands flatten-style, and refuses tab lifecycle", async () => {
		const tabs = [tab("tab-1", true)];
		const endpoint = new CdpTabEndpoint(() => tabs);
		endpoints.push(endpoint);
		const address = await endpoint.listen();
		const socket = await openBrowserSocket(address.port);
		try {
			// Collect session traffic from connection setup, like real clients do:
			// attach-time announcements must not be missed by a late listener.
			const seen: { sessionId: string; message: string }[] = [];
			socket.on("message", data => {
				try {
					const frame = JSON.parse(String(data)) as { method?: string; params?: { sessionId?: string; message?: string } };
					if (frame.method === "Target.receivedMessageFromTarget" && frame.params?.sessionId && frame.params.message) {
						seen.push({ sessionId: frame.params.sessionId, message: frame.params.message });
					}
				} catch {
					// Direct answers carry ids, not methods.
				}
			});
			const attached = (await browserRpc(socket, "Target.attachToTarget", { targetId: "tab-1", flatten: true })) as { sessionId: string };
			expect(typeof attached.sessionId).toBe("string");
			// sendMessageToTarget answers {} at once; the real reply arrives as an event.
			const ack = (await browserRpc(socket, "Target.sendMessageToTarget", {
				sessionId: attached.sessionId,
				message: JSON.stringify({ id: 7, method: "Page.navigate", params: { url: "https://example.com/next" } }),
			})) as Record<string, unknown>;
			expect(ack).toEqual({});
			// Attaching announces the default execution context (Chrome parity) and the
			// command reply follows; either may arrive first, so wait for both.
			const deadline = Date.now() + 5_000;
			const hasReply = () =>
				seen.some(entry => {
					try {
						const message = JSON.parse(entry.message ?? "");
						return message.id === 7;
					} catch {
						return false;
					}
				});
			while ((!hasReply() || seen.length < 2) && Date.now() < deadline) {
				await new Promise(resolve => setTimeout(resolve, 25));
			}
			expect(seen[0]?.sessionId).toBe(attached.sessionId);
			const messages = seen.map(entry => JSON.parse(entry.message ?? ""));
			expect(messages).toContainEqual({
				method: "Runtime.executionContextCreated",
				params: { context: expect.objectContaining({ id: 1, auxData: expect.objectContaining({ frameId: "frame-real-1" }) }) },
			});
			expect(messages).toContainEqual({ id: 7, result: { frameId: "f1" } });
			// Debugger events fan out to sessions too.
			(tabs[0]?.debugger as FakeDebugger).emit("Page.loadEventFired", {});
			const deadline2 = Date.now() + 5_000;
			while (seen.length < 3 && Date.now() < deadline2) await new Promise(resolve => setTimeout(resolve, 25));
			expect(seen.length).toBe(3);
			await expect(browserRpc(socket, "Target.attachToTarget", { targetId: "tab-9", flatten: true })).rejects.toThrow();
			await expect(browserRpc(socket, "Target.createTarget", { url: "https://example.com/" })).rejects.toThrow("tab lifecycle");
			await expect(browserRpc(socket, "Target.closeTarget", { targetId: "tab-1" })).rejects.toThrow("tab lifecycle");
			await expect(browserRpc(socket, "Target.sendMessageToTarget", { sessionId: "s_nope", message: "{}" })).rejects.toThrow();
			const detached = (await browserRpc(socket, "Target.detachFromTarget", { sessionId: attached.sessionId })) as Record<string, unknown>;
			expect(detached).toEqual({});
		} finally {
			socket.terminate();
		}
	});

	it("emits detachedFromTarget on explicit detach so clients drop the row", async () => {
		const tabs = [tab("tab-1", true)];
		const endpoint = new CdpTabEndpoint(() => tabs);
		endpoints.push(endpoint);
		const address = await endpoint.listen();
		const socket = await openBrowserSocket(address.port);
		try {
			const attached = (await browserRpc(socket, "Target.attachToTarget", { targetId: "tab-1", flatten: true })) as { sessionId: string };
			const ended: unknown[] = [];
			socket.on("message", data => {
				try {
					const frame = JSON.parse(String(data)) as { method?: string };
					if (frame.method === "Target.detachedFromTarget") ended.push(frame);
				} catch {
					// Ignore answers.
				}
			});
			const detached = (await browserRpc(socket, "Target.detachFromTarget", { sessionId: attached.sessionId })) as Record<string, unknown>;
			expect(detached).toEqual({});
			const deadline = Date.now() + 5_000;
			while (ended.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
			expect(ended.length).toBe(1);
			const targets = (await browserRpc(socket, "Target.getTargets")) as { targetInfos: { attached: boolean }[] };
			expect(targets.targetInfos.every(entry => entry.attached === false)).toBe(true);
		} finally {
			socket.terminate();
		}
	});

	it("ends sessions when the debugger detaches", async () => {
		const tabs = [tab("tab-1", true)];
		const endpoint = new CdpTabEndpoint(() => tabs);
		endpoints.push(endpoint);
		const address = await endpoint.listen();
		const socket = await openBrowserSocket(address.port);
		try {
			const attached = (await browserRpc(socket, "Target.attachToTarget", { targetId: "tab-1", flatten: true })) as { sessionId: string };
			const ended: unknown[] = [];
			socket.on("message", data => {
				try {
					const frame = JSON.parse(String(data)) as { method?: string };
					if (frame.method === "Target.detachedFromTarget") ended.push(frame);
				} catch {
					// Ignore answers.
				}
			});
			await (tabs[0]?.debugger as FakeDebugger).detach();
			const deadline = Date.now() + 5_000;
			while (ended.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
			expect(ended.length).toBe(1);
		} finally {
			socket.terminate();
		}
	});
});
