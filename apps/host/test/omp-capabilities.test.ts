import { describe, expect, it } from "bun:test";
import { OmpClientStateError } from "../../../packages/omp-adapter/src/client.ts";
import type { RpcAck } from "../../../packages/omp-adapter/src/types.ts";
import {
  parseOmpCapabilitySnapshot,
  type OmpCapabilitySnapshot,
} from "../../../packages/protocol/src/index.ts";
import {
  OmpCapabilityRevisionError,
  OmpCapabilityValidationError,
  readOmpCapabilities,
} from "../src/omp-capabilities.ts";
import { capabilitySnapshot } from "../src/capabilities.ts";
import { createRouter } from "../src/router.ts";
import { DeviceAuth } from "../src/auth.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const validDescriptor = {
  id: "capabilities.get",
  family: "O04",
  state: "available",
  scope: "session",
  apply: "immediate",
  surfaces: ["agent", "ide"],
  principal: "owner",
  bridgeVersion: 1,
  schemaVersion: 1,
  source: "modes/rpc/capabilities.ts",
  ompRevision: "omp/18.4.3",
} as const;

const validSnapshot: OmpCapabilitySnapshot = {
  bridgeVersion: 1,
  schemaVersion: 1,
  capabilityRevision: "sha256:fixture-capabilities",
  ompRevision: "omp/18.4.3",
  capabilities: [validDescriptor],
};

function response(data: unknown): RpcAck {
  return { type: "response", command: "cedia_get_capabilities", success: true, data } as unknown as RpcAck;
}

function fixtureClient(data: unknown): { requestCedia: () => Promise<RpcAck> } {
  return { requestCedia: async () => response(data) };
}

describe("OMP capability metadata", () => {
  it("reports an absent bridge instead of fabricating an empty success", async () => {
    const client = {
      requestCedia: async () => {
        throw new OmpClientStateError("This OMP runtime does not advertise the Cedia capability bridge");
      },
    };

    expect(await readOmpCapabilities(client)).toBeUndefined();
  });

  it("reads and validates a capability table from the negotiated client", async () => {
    const snapshot = await readOmpCapabilities(fixtureClient(validSnapshot));

    expect(snapshot).toEqual(validSnapshot);
    expect(snapshot?.capabilityRevision).toBe(validSnapshot.capabilityRevision);
  });

  it("rejects each malformed descriptor validation class", () => {
    const malformed = [
      ["missing id", { ...validDescriptor, id: undefined }],
      ["unknown family", { ...validDescriptor, family: "O99" }],
      ["unknown state", { ...validDescriptor, state: "disabled" }],
      ["unknown scope", { ...validDescriptor, scope: "account" }],
      ["unknown apply policy", { ...validDescriptor, apply: "later" }],
      ["unknown surface", { ...validDescriptor, surfaces: ["cli"] }],
      ["unknown descriptor field", { ...validDescriptor, unexpected: true }],
      ["descriptor revision mismatch", { ...validDescriptor, ompRevision: "omp/99.0.0" }],
      ["non-string reason for unavailable state", { ...validDescriptor, state: "integration_missing", reason: 42 }],
    ] as const;

    for (const [name, descriptor] of malformed) {
      expect(() => parseOmpCapabilitySnapshot({ ...validSnapshot, capabilities: [descriptor] }), name)
        .toThrow(OmpCapabilityValidationError);
    }
  });

  it("requires a reason for a descriptor that is not available", () => {
    expect(() => parseOmpCapabilitySnapshot({
      ...validSnapshot,
      capabilities: [{ ...validDescriptor, state: "integration_missing" }],
    })).toThrow(/reason/i);
  });

  it("preserves an integration-missing descriptor and its reason", async () => {
    const descriptor = {
      ...validDescriptor,
      id: "model.roles.set",
      family: "O03" as const,
      state: "integration_missing" as const,
      reason: "The direct cedia_set_model_role command still owns this operation.",
    };
    const snapshot = await readOmpCapabilities(fixtureClient({ ...validSnapshot, capabilities: [descriptor] }));

    expect(snapshot?.capabilities[0]).toMatchObject({ id: descriptor.id, state: descriptor.state, reason: descriptor.reason });
  });

  it("refuses a caller's stale expected revision", async () => {
    await expect(readOmpCapabilities(fixtureClient(validSnapshot), "sha256:old"))
      .rejects.toBeInstanceOf(OmpCapabilityRevisionError);
  });

  it("keeps the pre-existing aggregate rows unchanged when no runtime answers", () => {
    const snapshot = capabilitySnapshot();

    expect(snapshot.capabilities).toEqual([
      { id: "desktop.host-lifecycle", availability: "available", scope: "app", operations: ["adopt", "shutdown"] },
      { id: "omp.execution", availability: "available", scope: "session", operations: ["start", "send", "steer", "stop"] },
      // The settings bridge and its rendered destination exist; what a host with no runtime lacks
      // is something to read, which is a dependency state rather than a missing integration.
      { id: "omp.settings", availability: "dependency_unavailable", scope: "global", reason: "No OMP runtime is running, so the settings inventory has nothing to read. Start a task and the runtime's own schema becomes readable.", operations: [] },
      { id: "omp.live-cli-attach", availability: "integration_missing", scope: "session", reason: "The pinned OMP runtime has no qualified live-owner attach endpoint.", operations: [] },
      { id: "remote.tailscale", availability: "dependency_unavailable", scope: "device", reason: "This build carries no remote web client, so the loopback gateway did not start.", operations: [] },
      { id: "app.automations", availability: "integration_missing", scope: "app", reason: "Cedia has no automation backend; the sidebar row stays off until a host schedule owner exists.", operations: [] },
      { id: "voice.speech-to-text", availability: "integration_missing", scope: "device", reason: "Speech-to-text is deferred by the product scope.", operations: [] },
    ]);
  });

  it("answers explicitly unavailable when the host has no live runtime", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omp-capability-host-"));
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const host = new CediaHost({ store, stateDir: directory });
    try {
      await expect(host.ompCapabilitySnapshot()).resolves.toEqual({
        state: "unavailable",
        reason: "No OMP runtime is running; Cedia reads the capability table from a live session runtime.",
      });
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("maps runtime descriptors into the existing aggregate", () => {
    const snapshot = capabilitySnapshot(validSnapshot);
    const runtime = snapshot.capabilities.find(item => item.id === "capabilities.get");

    expect(runtime).toEqual({ id: "capabilities.get", availability: "available", scope: "session", operations: ["capabilities.get"] });
    expect(snapshot.ompCapabilityRevision).toBe(validSnapshot.capabilityRevision);
  });

  it("surfaces runtime metadata through the authenticated owner capability route", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omp-capability-route-"));
    const stateDir = join(directory, "state");
    mkdirSync(stateDir, { recursive: true });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const host = new CediaHost({ store, stateDir });
    const seenExpectations: (string | undefined)[] = [];
    const router = createRouter(host, auth, {
      ompCapabilities: async (expectedRevision?: string) => {
        seenExpectations.push(expectedRevision);
        if (expectedRevision !== undefined && expectedRevision !== validSnapshot.capabilityRevision)
          throw new OmpCapabilityRevisionError(expectedRevision, validSnapshot.capabilityRevision);
        return { state: "available", snapshot: validSnapshot };
      },
    });
    try {
      const owner = await router({ method: "GET", path: "/v1/capabilities", token: auth.ownerToken });
      expect(owner.status).toBe(200);
      expect((owner.body as { omp?: { state: string; capabilityRevision?: string; ompRevision?: string } }).omp).toEqual({
        state: "available",
        capabilityRevision: validSnapshot.capabilityRevision,
        ompRevision: validSnapshot.ompRevision,
      });

      const controller = auth.issue("fixture-controller");
      const denied = await router({ method: "GET", path: "/v1/capabilities", token: controller.token });
      expect(denied).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });

      // A caller that names the revision it already saw is answered only while that is still the
      // live table; a table that moved is a typed conflict rather than a silent refresh.
      const matching = await router({
        method: "GET",
        path: `/v1/capabilities?expectRevision=${validSnapshot.capabilityRevision}`,
        token: auth.ownerToken,
      });
      expect(matching.status).toBe(200);
      const stale = await router({
        method: "GET",
        path: "/v1/capabilities?expectRevision=00000000000000000000000000000000",
        token: auth.ownerToken,
      });
      expect(stale).toMatchObject({ status: 409, body: { error: { code: "omp_capability_revision_mismatch" } } });
      expect(seenExpectations).toEqual([undefined, validSnapshot.capabilityRevision, "00000000000000000000000000000000"]);
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
