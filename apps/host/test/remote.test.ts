import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateCediaRelayPairingOffer } from "../../../packages/relay/src/index.ts";
import type { CediaRelaySocket, CediaRelayWebSocketFactory } from "../../../packages/relay/src/transport.ts";
import { DeviceAuth } from "../src/auth.ts";
import { createRouter, type HostResponse, type HostRouter } from "../src/router.ts";
import { RemoteConnection } from "../src/remote.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

/**
 * The relay belongs to another package and, in production, to someone else's
 * server. This fixture stands in for its control socket so the host's own
 * perimeter - what it hands out when pairing, and what stopping the relay
 * really stops - can be tested without a network.
 */
class FixtureRelaySocket implements CediaRelaySocket {
	readyState = 0;
	closedCode: number | undefined;
	readonly #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

	on(event: string, listener: (...args: unknown[]) => void): void {
		const listeners = this.#listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
		listeners.add(listener);
		this.#listeners.set(event, listeners);
	}

	off(event: string, listener: (...args: unknown[]) => void): void {
		this.#listeners.get(event)?.delete(listener);
	}

	send(): void {
		if (this.readyState !== 1) throw new Error("fixture relay socket is closed");
	}

	close(code = 1000, reason = ""): void {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.closedCode = code;
		this.#emit("close", code, reason);
	}

	open(): void {
		if (this.readyState !== 0) return;
		this.readyState = 1;
		this.#emit("open");
	}

	#emit(event: string, ...args: unknown[]): void {
		for (const listener of this.#listeners.get(event) ?? []) listener(...args);
	}
}

interface RemoteFixture {
	stateDir: string;
	store: DurableStore;
	auth: DeviceAuth;
	remote: RemoteConnection;
	router: HostRouter;
	sockets: FixtureRelaySocket[];
}

const fixtures: RemoteFixture[] = [];
const directories: string[] = [];

function makeFixture(): RemoteFixture {
	const stateDir = mkdtempSync(join(tmpdir(), "cedia-remote-"));
	directories.push(stateDir);
	mkdirSync(join(stateDir, "project"), { recursive: true });
	const store = DurableStore.open({ stateDir, recover: false });
	const auth = new DeviceAuth(join(stateDir, "devices"));
	const host = new CediaHost({ store, stateDir });
	const sockets: FixtureRelaySocket[] = [];
	const factory: CediaRelayWebSocketFactory = () => { const socket = new FixtureRelaySocket(); sockets.push(socket); socket.open(); return socket; };
	const extras: { remote?: RemoteConnection } = {};
	const router = createRouter(host, auth, extras);
	const remote = new RemoteConnection(stateDir, auth, router, factory);
	extras.remote = remote;
	const fixture = { stateDir, store, auth, remote, router, sockets };
	fixtures.push(fixture);
	return fixture;
}

async function request(fixture: RemoteFixture, method: string, path: string, body?: unknown, token = fixture.auth.ownerToken): Promise<HostResponse> {
	return fixture.router({ method, path, token, ...(body === undefined ? {} : { body }) });
}

afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		await fixture.remote.close();
		fixture.store.close();
	}
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("host remote relay", () => {
	it("pairs one controller with a usable offer and stops the relay on disable", async () => {
		const fixture = makeFixture();
		expect((await request(fixture, "GET", "/v1/remote")).body).toMatchObject({ enabled: false, state: "stopped" });
		expect(fixture.sockets).toHaveLength(0);

		// Only the local owner can hand out a paired controller credential.
		const controller = fixture.auth.issue("Already paired phone");
		expect(await request(fixture, "POST", "/v1/remote/pair", { name: "Intruder" }, controller.token)).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
		expect(fixture.sockets).toHaveLength(0);

		const paired = await request(fixture, "POST", "/v1/remote/pair", { name: "Fixture phone" });
		expect(paired.status).toBe(200);
		// A client must be able to use this offer as it stands: the pinned daemon key
		// parses and the issued token authenticates as a controller of this host.
		const offer = validateCediaRelayPairingOffer(paired.body);
		expect(offer).toMatchObject({ relayEndpoint: "relay.paseo.sh:443", relayUseTls: true, protocolVersion: 1 });
		expect(fixture.auth.authenticate(offer.deviceToken)).toMatchObject({ id: offer.deviceId, role: "controller", name: "Fixture phone" });
		expect(fixture.remote.status()).toMatchObject({ enabled: true, state: "open" });
		expect(fixture.sockets).toHaveLength(1);
		expect(fixture.sockets[0]!.readyState).toBe(1);

		const disabled = await request(fixture, "POST", "/v1/remote/disable");
		expect(disabled.body).toMatchObject({ enabled: false, state: "stopped" });
		// The relay is off because its control connection is closed, not because a
		// flag says so; pairing again builds a new one instead of reusing a live socket.
		expect(fixture.sockets[0]!.closedCode).toBe(1000);
		expect(fixture.sockets[0]!.readyState).toBe(3);
		await request(fixture, "POST", "/v1/remote/pair", { name: "Second phone" });
		expect(fixture.sockets).toHaveLength(2);
		expect(fixture.sockets[1]!.readyState).toBe(1);
	});

	it("keeps the relay identity private, and off, across a reopen", async () => {
		const fixture = makeFixture();
		await request(fixture, "POST", "/v1/remote/pair", { name: "Fixture phone" });
		const path = join(fixture.stateDir, "remote.json");
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ version: 1, enabled: true });

		await request(fixture, "POST", "/v1/remote/disable");
		expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ enabled: false });
		// Disabling is durable: a host that starts over this state directory restores
		// the identity without reaching the relay at all.
		const reopened = new RemoteConnection(fixture.stateDir, fixture.auth, fixture.router, () => { throw new Error("a disabled relay must not connect"); });
		await reopened.restore();
		expect(reopened.status()).toMatchObject({ enabled: false, state: "stopped" });
		await reopened.close();
	});
});
