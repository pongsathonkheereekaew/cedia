import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CediaRelayServer } from "../../../packages/relay/src/server.ts";
import { generateKeyPair, exportPublicKey, exportSecretKey, importPublicKey, importSecretKey } from "../../../packages/relay/src/e2ee.ts";
import { createCediaRelayPairingOffer } from "../../../packages/relay/src/protocol.ts";
import type { CediaRelayWebSocketFactory } from "../../../packages/relay/src/transport.ts";
import type { Json } from "../../../packages/protocol/src/index.ts";
import type { DeviceAuth } from "./auth.ts";
import type { HostRequest, HostResponse } from "./router.ts";

interface RemoteIdentity { version: 1; serverId: string; publicKey: string; secretKey: string; endpoint: string; enabled: boolean }
export class RemoteConnection {
  readonly #path: string;
  readonly #auth: DeviceAuth;
  readonly #router: (request: HostRequest) => Promise<HostResponse>;
  /** Relay package's own socket injection point, passed through so a test can pair
   * and disable the relay without opening a connection to the real endpoint. */
  readonly #relaySocket?: CediaRelayWebSocketFactory;
  #identity: RemoteIdentity;
  #server?: CediaRelayServer;
  #state = "stopped";
  #error?: string;
  constructor(stateDir: string, auth: DeviceAuth, router: (request: HostRequest) => Promise<HostResponse>, relaySocket?: CediaRelayWebSocketFactory) {
    this.#path = join(stateDir, "remote.json"); this.#auth = auth; this.#router = router; this.#relaySocket = relaySocket;
    if (existsSync(this.#path)) {
      if (!lstatSync(this.#path).isFile() || lstatSync(this.#path).isSymbolicLink()) throw new Error("Remote identity must be a private file");
      this.#identity = JSON.parse(readFileSync(this.#path, "utf8"));
      if (this.#identity.version !== 1 || typeof this.#identity.serverId !== "string" || typeof this.#identity.enabled !== "boolean") throw new Error("Unsupported remote identity");
      importPublicKey(this.#identity.publicKey); importSecretKey(this.#identity.secretKey);
    } else {
      const key = generateKeyPair();
      this.#identity = { version: 1, serverId: randomUUID(), publicKey: exportPublicKey(key.publicKey), secretKey: exportSecretKey(key.secretKey), endpoint: "relay.paseo.sh:443", enabled: false };
      this.#save();
    }
  }
  status() { return { enabled: this.#identity.enabled, state: this.#state, endpoint: this.#identity.endpoint, ...(this.#error ? { error: this.#error } : {}) }; }
  async restore() { if (this.#identity.enabled) await this.#start(); }
  async pair(name: string) {
    this.#identity.enabled = true; this.#save();
    await this.#start();
    const issued = this.#auth.issue(name);
    return createCediaRelayPairingOffer({ serverId: this.#identity.serverId, daemonPublicKeyB64: this.#identity.publicKey,
      relayEndpoint: this.#identity.endpoint, relayUseTls: true, deviceId: issued.device.id, deviceToken: issued.token });
  }
  async disable() { this.#identity.enabled = false; this.#save(); await this.close(); }
  async close() { await this.#server?.stop(); this.#server = undefined; this.#state = "stopped"; }
  async #start() {
    if (!this.#server) this.#server = new CediaRelayServer({ endpoint: this.#identity.endpoint, useTls: true, serverId: this.#identity.serverId,
      ...(this.#relaySocket ? { createWebSocket: this.#relaySocket } : {}),
      authorize: token => !!this.#auth.authenticate(token),
      daemonKeyPair: { publicKey: importPublicKey(this.#identity.publicKey), secretKey: importSecretKey(this.#identity.secretKey) },
      handler: async request => { const response = await this.#router(request); return { status: response.status, body: JSON.parse(JSON.stringify(response.body)) as Json }; },
      onConnectionState: state => { this.#state = state; }, onError: () => { this.#error = "Relay connection unavailable"; },
    });
    await this.#server.start(); this.#error = undefined;
  }
  #save() { const temporary = `${this.#path}.${randomUUID()}.tmp`; writeFileSync(temporary, JSON.stringify(this.#identity), { mode: 0o600, flag: "wx" }); renameSync(temporary, this.#path); }
}
