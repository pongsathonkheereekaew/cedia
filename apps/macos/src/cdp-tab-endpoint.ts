/**
 * Per-thread loopback CDP endpoint over agent-controlled tabs (plan §8.2 O10).
 *
 * OMP browser tools attach to an existing CDP endpoint instead of launching a browser
 * when `browser.cdpUrl` (or per-call `app.cdp_url`) names one. This module serves that
 * endpoint for exactly the tabs Cedia attached for the agent: `GET /json[/list]` names
 * attached tabs only, and a websocket per tab proxies CDP messages to the tab's own
 * debugger session. It never enumerates user tabs, other threads, or anything beyond
 * the attached set it was given.
 *
 * Boundaries, enforced here rather than documented:
 * - Loopback only (`127.0.0.1`), ephemeral port, torn down with the thread. CDP has no
 *   auth, so lifetime + loopback is the entire exposure surface; a stale URL must never
 *   linger (upstream has no fallback past a configured-but-dead endpoint).
 * - A websocket for an unknown or detached tab is refused; debugger detach closes its
 *   sockets. Malformed client frames are answered or closed, never forwarded.
 */

import { randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

/** Minimal HTTP request surface this endpoint reads (method + url). */
interface CdpHttpRequest {
	readonly method?: string;
	readonly url?: string;
}

/** The debugger half of one attached tab. Electron's `webContents.debugger` satisfies this. */
export interface CdpTabDebugger {
	isAttached(): boolean;
	attach(): Promise<void>;
	detach(): Promise<void>;
	sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
	on(event: "message", listener: (method: string, params?: Record<string, unknown>) => void): void;
	removeListener(event: "message", listener: (method: string, params?: Record<string, unknown>) => void): void;
	on(event: "detach", listener: (reason: string) => void): void;
	removeListener(event: "detach", listener: (reason: string) => void): void;
}

export interface CdpEndpointTab {
	readonly tabId: string;
	readonly url: string;
	readonly title: string;
	readonly debugger: CdpTabDebugger;
}

export interface CdpEndpointAddress {
	readonly url: string;
	readonly port: number;
}

interface TabForwarder {
	readonly tab: CdpEndpointTab;
	readonly message: (method: string, params?: Record<string, unknown>) => void;
	readonly detach: (reason: string) => void;
}

function json(response: ServerResponse, status: number, value: unknown): void {
	const body = JSON.stringify(value);
	response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
	response.end(body);
}

/** Serves one thread's attached tabs as a CDP discovery endpoint plus per-tab websockets. */
export class CdpTabEndpoint {
	readonly #tabs: () => readonly CdpEndpointTab[];
	#server: Server | undefined;
	#sockets: WebSocketServer | undefined;
	#address: CdpEndpointAddress | undefined;
	#forwarders = new Map<string, TabForwarder>();
	#socketsByTab = new Map<string, Set<WebSocket>>();
	#browserSockets = new Set<WebSocket>();
	#discovering = new Set<WebSocket>();
	#autoAttach = new Set<WebSocket>();
	#sessions = new Map<string, { tabId: string; socket: WebSocket }>();

	constructor(tabs: () => readonly CdpEndpointTab[]) {
		this.#tabs = tabs;
	}

	get address(): CdpEndpointAddress | undefined {
		return this.#address;
	}

	async listen(): Promise<CdpEndpointAddress> {
		if (this.#address) return this.#address;
		const server = createServer((request, response) => this.#serveHttp(request, response));
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const address = server.address();
		if (!address || typeof address !== "object" || typeof address.port !== "number") {
			server.close();
			throw new Error("CDP endpoint failed to bind loopback");
		}
		this.#server = server;
		this.#sockets = new WebSocketServer({ server });
		this.#sockets.on("connection", (socket, request) => this.#serveSocket(socket, request));
		this.#address = { url: `http://127.0.0.1:${address.port}`, port: address.port };
		return this.#address;
	}

	/** Announce a newly attached tab to discovering browsers (live targetCreated). */
	notifyAttached(tabId: string): void {
		const tab = this.#attached(tabId);
		if (!tab || !tab.debugger.isAttached()) return;
		for (const socket of this.#discovering) {
			if (socket.readyState !== socket.OPEN) continue;
			socket.send(JSON.stringify({ method: "Target.targetCreated", params: { targetInfo: this.#targetInfo(tab, socket) } }));
		}
		for (const socket of this.#autoAttach) {
			if (socket.readyState !== socket.OPEN) continue;
			void this.#autoAttachTabs(socket);
		}
	}

	/** Announce a detached tab to discovering browsers (live targetDestroyed). */
	notifyDetached(tabId: string): void {
		for (const socket of this.#discovering) {
			if (socket.readyState !== socket.OPEN) continue;
			socket.send(JSON.stringify({ method: "Target.targetDestroyed", params: { targetId: tabId } }));
		}
	}

	async close(): Promise<void> {
		for (const forwarder of this.#forwarders.values()) this.#unforward(forwarder);
		this.#forwarders.clear();
		this.#socketsByTab.clear();
		this.#browserSockets.clear();
		this.#discovering.clear();
		this.#sessions.clear();
		const sockets = this.#sockets;
		this.#sockets = undefined;
		if (sockets) {
			for (const client of sockets.clients) client.terminate();
			await new Promise<void>(resolve => sockets.close(() => resolve()));
		}
		const server = this.#server;
		this.#server = undefined;
		this.#address = undefined;
		if (server) await new Promise<void>(resolve => server.close(() => resolve()));
	}

	#attached(tabId: string): CdpEndpointTab | undefined {
		return this.#tabs().find(tab => tab.tabId === tabId);
	}

	#serveHttp(request: CdpHttpRequest, response: ServerResponse): void {
		if (request.method !== "GET") {
			json(response, 405, { error: "CDP endpoint answers GET only" });
			return;
		}
		const path = (request.url ?? "").split("?", 1)[0];
		if (path === "/json/version") {
			json(response, 200, {
				Browser: "Cedia agent tabs",
				"Protocol-Version": "1.3",
				webSocketDebuggerUrl: `ws://127.0.0.1:${this.#address?.port ?? 0}/`,
			});
			return;
		}
		if (path === "/json" || path === "/json/list") {
			const port = this.#address?.port ?? 0;
			json(
				response,
				200,
				this.#tabs()
					.filter(tab => tab.debugger.isAttached())
					.map(tab => ({
						description: "",
						devtoolsFrontendUrl: "",
						id: tab.tabId,
						title: tab.title,
						type: "page",
						url: tab.url,
						webSocketDebuggerUrl: `ws://127.0.0.1:${port}/${tab.tabId}`,
					})),
			);
			return;
		}
		json(response, 404, { error: "Unknown CDP discovery path" });
	}

	#serveSocket(socket: WebSocket, request: CdpHttpRequest): void {
		const rawPath = (typeof request.url === "string" ? request.url : "").split("?", 1)[0] ?? "";
		if (rawPath === "/" || rawPath === "") {
			this.#serveBrowserSocket(socket);
			return;
		}
		const tabId = decodeURIComponent(rawPath.slice(1));
		const tab = tabId ? this.#attached(tabId) : undefined;
		if (!tab || !tab.debugger.isAttached()) {
			socket.close(4404, "Unknown or detached tab");
			return;
		}
		let set = this.#socketsByTab.get(tabId);
		if (!set) {
			set = new Set();
			this.#socketsByTab.set(tabId, set);
		}
		set.add(socket);
		socket.on("close", () => {
			const live = this.#socketsByTab.get(tabId);
			if (live) {
				live.delete(socket);
				if (live.size === 0) this.#socketsByTab.delete(tabId);
			}
		});
		this.#ensureForwarder(tabId, tab);
		socket.on("message", data => {
			void (async () => {
				let frame: { id?: unknown; method?: unknown; params?: unknown };
				try {
					frame = JSON.parse(String(data)) as typeof frame;
				} catch {
					socket.close(4400, "Malformed CDP frame");
					return;
				}
				if ((typeof frame.id !== "number" && typeof frame.id !== "string") || typeof frame.method !== "string") {
					socket.close(4400, "CDP frame needs a numeric id and a method");
					return;
				}
				if (frame.params !== undefined && (frame.params === null || typeof frame.params !== "object" || Array.isArray(frame.params))) {
					socket.send(JSON.stringify({ id: frame.id, error: { message: "CDP params must be an object" } }));
					return;
				}
				try {
					const result = await tab.debugger.sendCommand(frame.method, frame.params as Record<string, unknown> | undefined);
					if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ id: frame.id, result: result ?? {} }));
				} catch (error) {
					if (socket.readyState === socket.OPEN) {
						socket.send(JSON.stringify({ id: frame.id, error: { message: error instanceof Error ? error.message : String(error) } }));
					}
				}
			})();
		});
	}

	#targetInfo(tab: CdpEndpointTab, socket: WebSocket): Record<string, unknown> {
		return {
			targetId: tab.tabId,
			type: "page",
			title: tab.title,
			url: tab.url,
			attached: [...this.#sessions.values()].some(session => session.socket === socket && session.tabId === tab.tabId),
			canAccessOpener: false,
		};
	}

	async #autoAttachTabs(socket: WebSocket): Promise<void> {
		// Mirrors Chrome: enabling auto-attach attaches every attached tab and emits
		// attachedToTarget for each, which is what puppeteer builds its Target and
		// session objects from (verified against real headless Chrome).
		for (const tab of this.#tabs().filter(tab => tab.debugger.isAttached())) {
			if ([...this.#sessions.values()].some(session => session.socket === socket && session.tabId === tab.tabId)) continue;
			const sessionId = `s_${randomBytes(8).toString("hex")}`;
			this.#sessions.set(sessionId, { tabId: tab.tabId, socket });
			this.#ensureForwarder(tab.tabId, tab);
			if (socket.readyState !== socket.OPEN) continue;
			const frameId = await this.#mainFrameId(tab);
			if (socket.readyState !== socket.OPEN) continue;
			socket.send(
				JSON.stringify({
					method: "Target.attachedToTarget",
					params: { sessionId, targetInfo: this.#targetInfo(tab, socket), waitingForDebugger: false },
				}),
			);
			this.#announceExecutionContext(tab.tabId, sessionId, socket, frameId);
		}
	}

	#serveBrowserSocket(socket: WebSocket): void {
		this.#browserSockets.add(socket);
		socket.on("close", () => {
			this.#browserSockets.delete(socket);
			this.#discovering.delete(socket);
			this.#autoAttach.delete(socket);
			for (const [sessionId, session] of [...this.#sessions]) {
				if (session.socket === socket) this.#sessions.delete(sessionId);
			}
		});
		socket.on("message", data => {
			void (async () => {
				let frame: { id?: unknown; method?: unknown; params?: unknown };
				try {
					frame = JSON.parse(String(data)) as typeof frame;
				} catch {
					socket.close(4400, "Malformed CDP frame");
					return;
				}
				if ((typeof frame.id !== "number" && typeof frame.id !== "string") || typeof frame.method !== "string") {
					socket.close(4400, "CDP frame needs a numeric id and a method");
					return;
				}
				const answer = (result: unknown) => {
					if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ id: frame.id, result }));
				};
				const fail = (message: string, code = -32601) => {
					if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ id: frame.id, error: { message, code } }));
				};
				const params = (frame.params ?? {}) as Record<string, unknown>;
				// Flattened session traffic arrives on the browser socket carrying its
				// sessionId and is answered inline (Chrome answers these directly; only
				// Target-domain fan-out uses receivedMessageFromTarget events).
				if (typeof (frame as { sessionId?: unknown }).sessionId === "string") {
					const sessionId = (frame as { sessionId: string }).sessionId;
					const session = this.#sessions.get(sessionId);
					if (!session || session.socket !== socket) {
						fail("Unknown session");
						return;
					}
					const tab = this.#attached(session.tabId);
					if (!tab || !tab.debugger.isAttached()) {
						fail(`Tab detached: ${session.tabId}`);
						return;
					}
					try {
						const result = await tab.debugger.sendCommand(
							frame.method,
							params !== null && typeof params === "object" && !Array.isArray(params)
								? (params as Record<string, unknown>)
								: undefined,
						);
						answer(result ?? {});
					} catch (error) {
						fail(error instanceof Error ? error.message : String(error), -32000);
					}
					return;
				}
				switch (frame.method) {
					case "Target.getTargets": {
						answer({
							targetInfos: this.#tabs()
								.filter(tab => tab.debugger.isAttached())
								.map(tab => this.#targetInfo(tab, socket)),
						});
						return;
					}
					case "Target.attachToTarget": {
						const targetId = params.targetId;
						const tab = typeof targetId === "string" ? this.#attached(targetId) : undefined;
						if (!tab || !tab.debugger.isAttached()) {
							fail(`Unknown or detached tab: ${String(targetId)}`);
							return;
						}
						const sessionId = `s_${randomBytes(8).toString("hex")}`;
						this.#sessions.set(sessionId, { tabId: tab.tabId, socket });
						this.#ensureForwarder(tab.tabId, tab);
						const frameId = await this.#mainFrameId(tab);
						// Like Chrome, every attach — explicit or automatic — also emits
						// attachedToTarget, and the event precedes the answer: puppeteer
						// builds its session and Target objects from the event, so a
						// response-first order would fail its session lookup.
						if (socket.readyState === socket.OPEN) {
							socket.send(
								JSON.stringify({
									method: "Target.attachedToTarget",
									params: {
										sessionId,
										targetInfo: this.#targetInfo(tab, socket),
										waitingForDebugger: false,
									},
								}),
							);
							this.#announceExecutionContext(tab.tabId, sessionId, socket, frameId);
						}
						answer({ sessionId });
						return;
					}
					case "Target.detachFromTarget": {
						if (typeof params.sessionId === "string") {
							const entry = this.#sessions.get(params.sessionId);
							this.#sessions.delete(params.sessionId);
							// Like Chrome, an explicit detach also emits detachedFromTarget so
							// clients drop the Target instead of keeping a stale row.
							if (entry && socket.readyState === socket.OPEN) {
								socket.send(
									JSON.stringify({
										method: "Target.detachedFromTarget",
										params: { sessionId: params.sessionId, targetId: entry.tabId },
									}),
								);
							}
						}
						answer({});
						return;
					}
					case "Target.sendMessageToTarget": {
						const session = typeof params.sessionId === "string" ? this.#sessions.get(params.sessionId) : undefined;
						if (!session || session.socket !== socket || typeof params.message !== "string") {
							fail("Unknown session");
							return;
						}
						const tab = this.#attached(session.tabId);
						if (!tab || !tab.debugger.isAttached()) {
							fail(`Tab detached: ${session.tabId}`);
							return;
						}
						let inner: { id?: unknown; method?: unknown; params?: unknown };
						try {
							inner = JSON.parse(params.message) as typeof inner;
						} catch {
							fail("Message must be stringified JSON");
							return;
						}
						if ((typeof inner.id !== "number" && typeof inner.id !== "string") || typeof inner.method !== "string") {
							fail("Session message needs a numeric id and a method");
							return;
						}
						answer({});
						try {
							const result = await tab.debugger.sendCommand(
								inner.method,
								inner.params !== undefined && inner.params !== null && typeof inner.params === "object" && !Array.isArray(inner.params)
									? (inner.params as Record<string, unknown>)
									: undefined,
							);
							this.#emitSessionMessage(session, socket, { id: inner.id, result: result ?? {} });
						} catch (error) {
							this.#emitSessionMessage(session, socket, {
								id: inner.id,
								error: { message: error instanceof Error ? error.message : String(error) },
							});
						}
						return;
					}
					case "Target.setDiscoverTargets": {
						if (params.discover === true) {
							this.#discovering.add(socket);
							for (const tab of this.#tabs().filter(tab => tab.debugger.isAttached())) {
								if (socket.readyState !== socket.OPEN) break;
								socket.send(JSON.stringify({ method: "Target.targetCreated", params: { targetInfo: this.#targetInfo(tab, socket) } }));
							}
						} else {
							this.#discovering.delete(socket);
						}
						answer({});
						return;
					}
					case "Target.setAutoAttach": {
						if (params.autoAttach === true) {
							this.#autoAttach.add(socket);
							await this.#autoAttachTabs(socket);
						} else {
							this.#autoAttach.delete(socket);
						}
						answer({});
						return;
					}
					case "Target.getBrowserContexts": {
						answer({ browserContextIds: [] });
						return;
					}
					case "Browser.getVersion": {
						answer({
							protocolVersion: "1.3",
							product: "Cedia agent tabs",
							revision: "0",
							userAgent: "Cedia agent tabs",
							jsVersion: "0",
						});
						return;
					}
					case "Target.createTarget":
					case "Target.closeTarget": {
						fail("Cedia owns tab lifecycle: tabs attach and close through the agent surface, never through CDP");
						return;
					}
					default: {
						fail(`Unsupported browser method: ${frame.method}`);
						return;
					}
				}
			})();
		});
	}

	#ensureForwarder(tabId: string, tab: CdpEndpointTab): void {
		if (this.#forwarders.has(tabId)) return;
		const message = (method: string, params?: Record<string, unknown>) => {
			for (const client of this.#socketsByTab.get(tabId) ?? []) {
				if (client.readyState === client.OPEN) client.send(JSON.stringify({ method, ...(params === undefined ? {} : { params }) }));
			}
			this.#fanoutSessionEvent(tabId, method, params);
		};
		const detach = () => {
			for (const client of this.#socketsByTab.get(tabId) ?? []) client.close(4499, "Debugger detached");
			this.#socketsByTab.delete(tabId);
			this.#dropTabSessions(tabId, "debugger detached");
			this.#forwarders.delete(tabId);
		};
		const forwarder: TabForwarder = { tab, message, detach };
		this.#forwarders.set(tabId, forwarder);
		tab.debugger.on("message", message);
		tab.debugger.on("detach", detach);
	}

	/** Main frame id for context association, read from the tab itself. */
	async #mainFrameId(tab: CdpEndpointTab): Promise<string> {
		try {
			const tree = (await tab.debugger.sendCommand("Page.getFrameTree")) as {
				frameTree?: { frame?: { id?: unknown } };
			};
			const id = tree?.frameTree?.frame?.id;
			if (typeof id === "string" && id.length > 0) return id;
		} catch {
			// A tab that cannot report its frame tree still gets a context; the id is
			// best-effort either way.
		}
		return "F1";
	}

	#announceExecutionContext(tabId: string, sessionId: string, socket: WebSocket, frameId: string): void {
		// Chrome announces the default execution context per session; puppeteer waits for
		// it before the first evaluate. The origin follows the attached tab.
		const tab = this.#attached(tabId);
		let origin = "https://example.com/";
		try {
			origin = new URL(tab?.url ?? origin).origin;
		} catch {
			// Keep the fallback origin for non-URL tabs.
		}
		if (socket.readyState !== socket.OPEN) return;
		socket.send(
			JSON.stringify({
				method: "Target.receivedMessageFromTarget",
				params: {
					sessionId,
					targetId: tabId,
					message: JSON.stringify({
						method: "Runtime.executionContextCreated",
						params: { context: { id: 1, origin, name: "", auxData: { isDefault: true, type: "default", frameId } } },
					}),
				},
			}),
		);
	}

	#emitSessionMessage(session: { tabId: string; socket: WebSocket }, socket: WebSocket, payload: unknown): void {
		for (const [sessionId, entry] of this.#sessions) {
			if (entry.socket !== socket || entry.tabId !== session.tabId) continue;
			if (socket.readyState !== socket.OPEN) continue;
			socket.send(
				JSON.stringify({
					method: "Target.receivedMessageFromTarget",
					params: { sessionId, targetId: session.tabId, message: JSON.stringify(payload) },
				}),
			);
		}
	}

	#fanoutSessionEvent(tabId: string, method: string, params?: Record<string, unknown>): void {
		for (const [sessionId, session] of this.#sessions) {
			if (session.tabId !== tabId || session.socket.readyState !== session.socket.OPEN) continue;
			session.socket.send(
				JSON.stringify({
					method: "Target.receivedMessageFromTarget",
					params: {
						sessionId,
						targetId: tabId,
						message: JSON.stringify({ method, ...(params === undefined ? {} : { params }) }),
					},
				}),
			);
		}
	}

	#dropTabSessions(tabId: string, reason: string): void {
		for (const [sessionId, session] of [...this.#sessions]) {
			if (session.tabId !== tabId) continue;
			this.#sessions.delete(sessionId);
			if (session.socket.readyState === session.socket.OPEN) {
				session.socket.send(JSON.stringify({ method: "Target.detachedFromTarget", params: { sessionId, targetId: tabId } }));
			}
		}
		void reason;
	}

	#unforward(forwarder: TabForwarder): void {
		try {
			forwarder.tab.debugger.removeListener("message", forwarder.message);
		} catch {
			// Detaching forwarders is best-effort during teardown.
		}
		try {
			forwarder.tab.debugger.removeListener("detach", forwarder.detach);
		} catch {
			// Detaching forwarders is best-effort during teardown.
		}
	}
}
