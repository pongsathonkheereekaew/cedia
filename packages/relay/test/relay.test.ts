import { describe, expect, it } from "bun:test";
import {
	CediaRelayCapacityError,
	CediaRelayClient,
	CediaRelayDisconnectedError,
	CediaRelayOfferError,
	CediaRelayRequestTimeoutError,
	createCediaRelayPairingOffer,
	createCediaRelayRequest,
	parseCediaRelayMessage,
	MAX_RELAY_PAYLOAD_BYTES,
} from "../src/index.ts";
import type { Json } from "../../protocol/src/index.ts";
import { CediaRelayServer } from "../src/server.ts";
import {
	decrypt,
	deriveSharedKey,
	encrypt,
	generateKeyPair,
	importPublicKey,
	importSecretKey,
} from "../src/e2ee.ts";
import type { CediaRelaySocket, CediaRelayWebSocketFactory } from "../src/transport.ts";

type Listener = (...args: unknown[]) => void;
type EventTargetListener = (event: unknown) => void;

/** A deterministic synthetic relay: it implements Paseo v2 routing only. */
class FixtureSocket implements CediaRelaySocket {
	readyState = 0;
	peer: FixtureSocket | null = null;
	readonly listeners = new Map<string, Set<Listener>>();
	readonly eventListeners = new Map<string, Set<EventTargetListener>>();
	readonly pendingMessages: Array<{ data: string | ArrayBuffer; isBinary: boolean }> = [];
	closeCode: number | undefined;

	on(event: string, listener: Listener): void {
		const listeners = this.listeners.get(event) ?? new Set<Listener>();
		listeners.add(listener);
		this.listeners.set(event, listeners);
	}

	off(event: string, listener: Listener): void {
		this.listeners.get(event)?.delete(listener);
	}

	/** Model the browser/EventTarget surface also exposed by recent `ws`. */
	addEventListener(event: string, listener: EventTargetListener): void {
		const listeners = this.eventListeners.get(event) ?? new Set<EventTargetListener>();
		listeners.add(listener);
		this.eventListeners.set(event, listeners);
	}

	removeEventListener(event: string, listener: EventTargetListener): void {
		this.eventListeners.get(event)?.delete(listener);
	}

	send(data: string | ArrayBuffer | Uint8Array): void {
		if (this.readyState !== 1) throw new Error("fixture socket is not open");
		const peer = this.peer;
		const isBinary = typeof data !== "string";
		const payload = data instanceof Uint8Array && !(data instanceof ArrayBuffer)
			? data.slice().buffer
			: data;
		if (!peer || peer.readyState !== 1) {
			this.pendingMessages.push({ data: payload, isBinary });
			return;
		}
		queueMicrotask(() => peer.emit("message", payload, isBinary));
	}

	flushPending(): void {
		const pending = this.pendingMessages.splice(0);
		for (const item of pending) this.send(item.data);
	}

	close(code = 1000, _reason = ""): void {
		this.#close(code, true);
	}

	#close(code: number, notifyPeer: boolean): void {
		if (this.readyState === 3) return;
		this.closeCode = code;
		this.readyState = 3;
		this.emit("close", code, "fixture closed");
		const peer = this.peer;
		if (notifyPeer && peer) peer.#close(code, false);
	}

	terminate(): void {
		this.#close(1006, true);
	}

	emit(event: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(event) ?? []) listener(...args);
		const eventValue = event === "message"
			? { data: args[0] }
			: event === "close"
				? { code: args[0], reason: args[1] }
				: event === "error"
					? { error: args[0] }
					: {};
		for (const listener of this.eventListeners.get(event) ?? []) listener(eventValue);
	}

	open(): void {
		if (this.readyState !== 0) return;
		this.readyState = 1;
		queueMicrotask(() => this.emit("open"));
	}
}

class FixtureRelay {
	control: FixtureSocket | null = null;
	readonly clients = new Map<string, FixtureSocket>();
	readonly servers = new Map<string, FixtureSocket>();
	#assignedConnectionOrdinal = 0;

	readonly factory: CediaRelayWebSocketFactory = (url) => {
		const parsed = new URL(url);
		const role = parsed.searchParams.get("role");
		const connectionId = parsed.searchParams.get("connectionId");
		if (role === "server" && !connectionId) {
			const socket = new FixtureSocket();
			this.control = socket;
			socket.open();
			return socket;
		}
		if (role === "client") {
			const resolvedConnectionId = connectionId ?? `conn_fixture_${++this.#assignedConnectionOrdinal}`;
			const socket = new FixtureSocket();
			this.clients.set(resolvedConnectionId, socket);
			socket.open();
			queueMicrotask(() => this.control?.emit("message", JSON.stringify({ type: "connected", connectionId: resolvedConnectionId })));
			return socket;
		}
		if (role === "server" && connectionId) {
			const client = this.clients.get(connectionId);
			if (!client) throw new Error(`missing fixture client ${connectionId}`);
			const socket = new FixtureSocket();
			socket.peer = client;
			client.peer = socket;
			this.servers.set(connectionId, socket);
			socket.open();
			client.flushPending();
			socket.flushPending();
			return socket;
		}
		throw new Error(`unsupported fixture URL: ${url}`);
	};

	disconnect(connectionId: string): void {
		this.clients.get(connectionId)?.terminate();
		this.servers.get(connectionId)?.terminate();
	}
}

function base64ToBytes(encoded: string): Uint8Array {
	const binary = atob(encoded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function waitForMicrotasks(): Promise<void> {
	return new Promise((resolve) => queueMicrotask(resolve));
}

function waitForTick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 1));
}

function makeOffer(daemonKeyPair: ReturnType<typeof generateKeyPair>, token = "device-token"): ReturnType<typeof createCediaRelayPairingOffer> {
	return createCediaRelayPairingOffer({
		serverId: "fixture-server",
		daemonPublicKeyB64: btoa(String.fromCharCode(...daemonKeyPair.publicKey)),
		relayEndpoint: "fixture.test:443",
		relayUseTls: true,
		deviceId: "device-1",
		deviceToken: token,
	});
}

describe("Cedia relay protocol", () => {
	it("decrypts a fixed Paseo tweetnacl vector", () => {
		const ourSecret = importSecretKey("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=");
		const peerPublic = importPublicKey("Pry2khSTRNxU5YFgz5C+2e6h3RToHI6R3lV699ev2RU=");
		const shared = deriveSharedKey(ourSecret, peerPublic);
		const encrypted = base64ToBytes("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYbhE9JlEWtXmpBj5TKV4zaZRsE9PDlgXW8kAI1Xzy1pmOgQ==");
		const plain = decrypt(shared, encrypted.buffer as ArrayBuffer);
		expect(new TextDecoder().decode(plain)).toBe("cedia-paseo-vector");
	});

	it("requires Cedia protocol v1 while pairing only uses Paseo wire v2", () => {
		const keyPair = generateKeyPair();
		const offer = makeOffer(keyPair);
		expect(offer.v).toBe(2);
		expect(offer.protocolVersion).toBe(1);
		expect(() => createCediaRelayPairingOffer({ ...offer, relayUseTls: false, relayEndpoint: "fixture.test:80" })).not.toThrow();
		expect(() => createCediaRelayPairingOffer({ ...offer, daemonPublicKeyB64: "not-a-key" })).toThrow(CediaRelayOfferError);
		expect(() => parseCediaRelayMessage(JSON.stringify({ type: "request", v: 2 }))).toThrow();
	});

	it("roundtrips authenticated JSON requests and rechecks revoked tokens", async () => {
		const daemonKeyPair = generateKeyPair();
		const offer = makeOffer(daemonKeyPair);
		const fixture = new FixtureRelay();
		let revoked = false;
		const calls: Array<{ method: string; path: string; token: string }> = [];
		const server = new CediaRelayServer({ authorize: () => !revoked,
			endpoint: offer.relayEndpoint,
			useTls: offer.relayUseTls,
			serverId: offer.serverId,
			daemonKeyPair,
			autoReconnect: false,
			createWebSocket: fixture.factory,
			handler: async (request): Promise<{ status: number; body: Json }> => {
				calls.push({ method: request.method, path: request.path, token: request.token });
				return revoked ? { status: 401, body: { error: { code: "unauthorized", message: "revoked" } } } : { status: 200, body: { ok: true, path: request.path } };
			},
		});
		const client = new CediaRelayClient({ offer, createWebSocket: fixture.factory, connectionId: "connection-a", requestTimeoutMs: 500 });
		await server.start();
		await client.connect();
		const first = await client.request({ method: "GET", path: "/v1/health" });
		expect(first).toEqual({ status: 200, body: { ok: true, path: "/v1/health" } });
		const duplicate = await client.request({ method: "GET", path: "/v1/health", requestId: "health-once" });
		const duplicateReplay = await client.request({ method: "GET", path: "/v1/health", requestId: "health-once" });
		expect(duplicateReplay).toEqual(duplicate);
		expect(calls).toHaveLength(2);
		revoked = true;
		const second = await client.request({ method: "GET", path: "/v1/sessions/demo/events?after=0" });
		expect(second.status).toBe(401);
		expect(calls).toHaveLength(2);
		expect((await client.request({ method: "GET", path: "/v1/health", requestId: "health-once" })).status).toBe(401);
		expect(calls.every((call) => call.token === offer.deviceToken)).toBe(true);
		const replay = await client.pollEvents("/v1/sessions/demo/events", 4);
		expect(replay.status).toBe(401);
		client.close();
		await server.stop();
	});

	it("uses Paseo v2's relay-assigned client route when no connectionId is supplied", async () => {
		const daemonKeyPair = generateKeyPair();
		const offer = makeOffer(daemonKeyPair);
		const fixture = new FixtureRelay();
		let clientUrl = "";
		const factory: CediaRelayWebSocketFactory = (url) => {
			const parsed = new URL(url);
			if (parsed.searchParams.get("role") === "client") clientUrl = url;
			return fixture.factory(url);
		};
		const server = new CediaRelayServer({
			authorize: () => true,
			endpoint: offer.relayEndpoint,
			useTls: offer.relayUseTls,
			serverId: offer.serverId,
			daemonKeyPair,
			autoReconnect: false,
			createWebSocket: factory,
			handler: async () => ({ status: 200, body: { assigned: true } }),
		});
		const client = new CediaRelayClient({ offer, createWebSocket: factory, requestTimeoutMs: 500 });
		await server.start();
		await client.connect();
		expect(new URL(clientUrl).searchParams.has("connectionId")).toBe(false);
		expect(client.connectionId).toBeUndefined();
		expect(await client.request({ method: "GET", path: "/v1/health" })).toEqual({
			status: 200,
			body: { assigned: true },
		});
		client.close();
		await server.stop();
	});

	it("settles connect when closed before the socket opens", async () => {
		const daemonKeyPair = generateKeyPair();
		const offer = makeOffer(daemonKeyPair);
		const fixture = new FixtureRelay();
		const client = new CediaRelayClient({ offer, createWebSocket: fixture.factory, connectionId: "closing-before-open", handshakeTimeoutMs: 100 });
		const connecting = client.connect();
		client.close();
		await expect(connecting).rejects.toBeInstanceOf(CediaRelayDisconnectedError);
		expect(client.state).toBe("closed");
	});

	it("closes the pending socket and immediately reconnects with a fresh attempt", async () => {
		const keyPair = generateKeyPair();
		const offer = makeOffer(keyPair);
		const fixture = new FixtureRelay();
		const server = new CediaRelayServer({ authorize: () => true, endpoint: offer.relayEndpoint, useTls: true, serverId: offer.serverId, daemonKeyPair: keyPair, autoReconnect: false, createWebSocket: fixture.factory, handler: async () => ({ status: 200, body: { ok: true } }) });
		await server.start();
		const client = new CediaRelayClient({ offer, createWebSocket: fixture.factory, connectionId: "immediate-reconnect" });
		const first = client.connect();
		const oldSocket = fixture.clients.get("immediate-reconnect")!;
		const rejected = first.then(() => null, error => error);
		const second = client.reconnect();
		expect(oldSocket.readyState).toBe(3);
		expect(await rejected).toBeInstanceOf(CediaRelayDisconnectedError);
		await second;
		expect(client.state).toBe("open");
		expect(fixture.clients.get("immediate-reconnect")).not.toBe(oldSocket);
		client.close(); await server.stop();
	});

	it("settles connect when closed during the E2EE handshake", async () => {
		const daemonKeyPair = generateKeyPair();
		const offer = makeOffer(daemonKeyPair);
		const fixture = new FixtureRelay();
		const client = new CediaRelayClient({ offer, createWebSocket: fixture.factory, connectionId: "closing-during-handshake", handshakeTimeoutMs: 100 });
		const connecting = client.connect();
		await waitForMicrotasks();
		client.close();
		await expect(connecting).rejects.toBeInstanceOf(CediaRelayDisconnectedError);
		expect(client.state).toBe("closed");
	});

	it("bounds silent data connections and expires incomplete handshakes", async () => {
		const keyPair = generateKeyPair(); const offer = makeOffer(keyPair); const fixture = new FixtureRelay();
		const server = new CediaRelayServer({ authorize: () => true, endpoint: offer.relayEndpoint, useTls: true, serverId: offer.serverId, daemonKeyPair: keyPair, autoReconnect: false, createWebSocket: fixture.factory, maxConnections: 2, handshakeTimeoutMs: 15, handler: async () => ({ status: 200, body: {} }) });
		await server.start();
		for (let i = 0; i < 10; i++) { const id = `silent-${i}`; fixture.clients.set(id, new FixtureSocket()); fixture.control!.emit("message", JSON.stringify({ type: "connected", connectionId: id })); }
		expect(server.connectionCount).toBe(2);
		await new Promise(resolve => setTimeout(resolve, 25));
		expect(server.connectionCount).toBe(0);
		await server.stop();
	});

	it("retains the global handler budget across disconnected channels", async () => {
		const keyPair = generateKeyPair(); const offer = makeOffer(keyPair); const fixture = new FixtureRelay();
		let release!: () => void; let calls = 0;
		const work = new Promise<void>(resolve => { release = resolve; });
		const server = new CediaRelayServer({ authorize: () => true, endpoint: offer.relayEndpoint, useTls: true, serverId: offer.serverId, daemonKeyPair: keyPair, autoReconnect: false, createWebSocket: fixture.factory, maxActiveHandlers: 1, handler: async () => { calls++; await work; return { status: 200, body: {} }; } });
		await server.start();
		const first = new CediaRelayClient({ offer, createWebSocket: fixture.factory, connectionId: "budget-one" }); await first.connect();
		const result = first.request({ method: "POST", path: "/work" }).catch(error => error);
		while (!calls) await waitForTick(); first.close(); await result;
		const second = new CediaRelayClient({ offer, createWebSocket: fixture.factory, connectionId: "budget-two" }); await second.connect();
		expect((await second.request({ method: "POST", path: "/work" })).status).toBe(429);
		expect(calls).toBe(1); release(); second.close(); await server.stop();
	});

	it("rejects altered ciphertext and cannot open it with another connection key", () => {
		const server = generateKeyPair();
		const client = generateKeyPair();
		const other = generateKeyPair();
		const shared = deriveSharedKey(server.secretKey, client.publicKey);
		const otherShared = deriveSharedKey(other.secretKey, client.publicKey);
		const ciphertext = new Uint8Array(encrypt(shared, "one authenticated frame"));
		const altered = ciphertext.slice();
		altered[altered.length - 1] ^= 1;
		expect(() => decrypt(shared, altered.buffer)).toThrow();
		expect(() => decrypt(otherShared, ciphertext.buffer)).toThrow();
		expect(new TextDecoder().decode(decrypt(shared, ciphertext.buffer))).toBe("one authenticated frame");
	});

	it("bounds payloads, pending requests, and timeout outcomes", async () => {
		const keyPair = generateKeyPair();
		const offer = makeOffer(keyPair);
		const fixture = new FixtureRelay();
		let release = false;
		const server = new CediaRelayServer({ authorize: () => true, endpoint: offer.relayEndpoint, useTls: true, serverId: offer.serverId, daemonKeyPair: keyPair, autoReconnect: false, createWebSocket: fixture.factory, handler: async () => {
			while (!release) await waitForTick();
			return { status: 200, body: { done: true } };
		} });
		const client = new CediaRelayClient({ offer, createWebSocket: fixture.factory, connectionId: "connection-b", requestTimeoutMs: 20, maxPendingRequests: 1 });
		await server.start();
		await client.connect();
		const first = client.request({ method: "POST", path: "/v1/mutate", body: { value: "pending" } });
		expect(() => client.request({ method: "GET", path: "/v1/health" })).toThrow(CediaRelayCapacityError);
		await expect(first).rejects.toBeInstanceOf(CediaRelayRequestTimeoutError);
		release = true;
		const tooLarge = { data: "x".repeat(MAX_RELAY_PAYLOAD_BYTES) } as unknown as Json;
		expect(() => createCediaRelayRequest({ id: "too-large", epoch: 1, method: "POST", path: "/v1/mutate", token: "t", body: tooLarge })).toThrow();
		client.close();
		await server.stop();
	});

	it("returns 413 for an oversized generic handler response", async () => {
		const keyPair = generateKeyPair();
		const offer = makeOffer(keyPair);
		const fixture = new FixtureRelay();
		const server = new CediaRelayServer({
			authorize: () => true,
			endpoint: offer.relayEndpoint,
			useTls: true,
			serverId: offer.serverId,
			daemonKeyPair: keyPair,
			autoReconnect: false,
			createWebSocket: fixture.factory,
			handler: async () => ({ status: 200, body: { data: "x".repeat(MAX_RELAY_PAYLOAD_BYTES) } }),
		});
		const client = new CediaRelayClient({ offer, createWebSocket: fixture.factory, connectionId: "oversized-response", requestTimeoutMs: 200 });
		await server.start();
		await client.connect();
		const response = await client.request({ method: "GET", path: "/v1/oversized" });
		expect(response.status).toBe(413);
		expect(response.body).toEqual({ error: { code: "response_too_large", message: "Cedia host response exceeds the relay payload limit" } });
		client.close();
		await server.stop();
	});

	it("keeps timed-out uncooperative handlers inside the admission bound", async () => {
		const keyPair = generateKeyPair();
		const offer = makeOffer(keyPair);
		const fixture = new FixtureRelay();
		let calls = 0;
		let release!: () => void;
		const waiting = new Promise<void>((resolve) => { release = resolve; });
		const server = new CediaRelayServer({
			authorize: () => true,
			endpoint: offer.relayEndpoint,
			useTls: true,
			serverId: offer.serverId,
			daemonKeyPair: keyPair,
			autoReconnect: false,
			createWebSocket: fixture.factory,
			maxPendingRequests: 1,
			requestTimeoutMs: 20,
			handler: async () => {
				calls += 1;
				await waiting;
				return { status: 200, body: { ok: true } };
			},
		});
		const client = new CediaRelayClient({ offer, createWebSocket: fixture.factory, connectionId: "bounded-host", requestTimeoutMs: 200 });
		await server.start();
		await client.connect();
		const first = await client.request({ method: "POST", path: "/v1/slow", requestId: "slow-once" });
		expect(first.status).toBe(504);
		expect(calls).toBe(1);
		const second = await client.request({ method: "GET", path: "/v1/health", requestId: "while-slow" });
		expect(second.status).toBe(429);
		expect(second.body).toEqual({ error: { code: "host_capacity", message: "Cedia host request capacity reached" } });
		release();
		await waitForTick();
		const third = await client.request({ method: "GET", path: "/v1/health", requestId: "after-slow" });
		expect(third.status).toBe(200);
		expect(calls).toBe(2);
		client.close();
		await server.stop();
	});

	it("retries the control socket after an initial connection failure", async () => {
		const keyPair = generateKeyPair();
		const offer = makeOffer(keyPair);
		const fixture = new FixtureRelay();
		let controlAttempts = 0;
		const factory: CediaRelayWebSocketFactory = (url) => {
			const parsed = new URL(url);
			if (parsed.searchParams.get("role") === "server" && !parsed.searchParams.has("connectionId")) {
				controlAttempts += 1;
				if (controlAttempts === 1) throw new Error("synthetic first control failure");
			}
			return fixture.factory(url);
		};
		const server = new CediaRelayServer({
			authorize: () => true,
			endpoint: offer.relayEndpoint,
			useTls: true,
			serverId: offer.serverId,
			daemonKeyPair: keyPair,
			autoReconnect: true,
			minReconnectDelayMs: 1,
			maxReconnectDelayMs: 2,
			createWebSocket: factory,
			handler: async () => ({ status: 200, body: { ok: true } }),
		});
		await expect(server.start()).rejects.toThrow("synthetic first control failure");
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(controlAttempts).toBeGreaterThanOrEqual(2);
		expect(server.started).toBe(true);
		await server.stop();
	});

	it("does not replay a timed-out mutation after disconnect and rejects malformed frames", async () => {
		const keyPair = generateKeyPair();
		const offer = makeOffer(keyPair);
		const fixture = new FixtureRelay();
		let calls = 0;
		let release!: () => void;
		const waiting = new Promise<void>((resolve) => { release = resolve; });
		const server = new CediaRelayServer({ authorize: () => true, endpoint: offer.relayEndpoint, useTls: true, serverId: offer.serverId, daemonKeyPair: keyPair, autoReconnect: false, createWebSocket: fixture.factory, handler: async () => { calls += 1; await waiting; return { status: 200, body: { ok: true } }; } });
		const client = new CediaRelayClient({ offer, createWebSocket: fixture.factory, connectionId: "connection-c", requestTimeoutMs: 500 });
		await server.start();
		await client.connect();
		const pending = client.request({ method: "POST", path: "/v1/mutate", requestId: "mutation-once", body: { value: 1 } });
		await waitForTick();
		fixture.disconnect("connection-c");
		await expect(pending).rejects.toBeInstanceOf(CediaRelayDisconnectedError);
		expect(calls).toBe(1);
		release();
		await expect(() => parseCediaRelayMessage(JSON.stringify({ protocolVersion: 1, type: "response", id: "x", epoch: 1, status: 200, body: {}, unknown: true }))).toThrow();
		client.close();
		await server.stop();
	});
});
