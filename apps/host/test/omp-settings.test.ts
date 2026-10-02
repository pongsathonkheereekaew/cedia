import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpClientStateError, OmpCommandError } from "../../../packages/omp-adapter/src/client.ts";
import type { RpcAck } from "../../../packages/omp-adapter/src/types.ts";
import {
  OmpSettingsValidationError,
  parseOmpSettingsValue,
  type OmpSettingsKeysSnapshot,
  type OmpSettingsValue,
} from "../../../packages/protocol/src/index.ts";
import { DeviceAuth } from "../src/auth.ts";
import {
  OmpSettingsPathError,
  OmpSettingsRevisionError,
  ompSettingDisposition,
  readOmpSettingsKeys,
  readOmpSettingsValue,
} from "../src/omp-settings.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const keys: OmpSettingsKeysSnapshot = {
  keys: [
    {
      path: "cycleOrder",
      type: "array",
      credential: false,
      ui: true,
      tab: "models",
      projectWritable: false,
      apply: "turn_boundary",
    },
    { path: "auth.broker.token", type: "string", credential: true, ui: false, projectWritable: false, apply: "reload" },
    { path: "modelRoles", type: "record", credential: false, ui: false, projectWritable: true, apply: "new_session" },
    { path: "enabledProviders", type: "array", credential: false, ui: false, projectWritable: false, apply: "reload" },
  ],
  settingsRevision: "fixture-revision",
};

const value: OmpSettingsValue = {
  path: "cycleOrder",
  credential: false,
  redacted: false,
  configured: true,
  value: ["default", "smol"],
  settingsRevision: "fixture-revision",
  scope: "session",
};

function response(data: unknown): RpcAck {
  return { type: "response", command: "cedia_control", success: true, data } as unknown as RpcAck;
}

/** A client whose control calls answer the given result, or throw the given error. */
function fixtureClient(result: unknown, failure?: Error): { requestCedia: () => Promise<RpcAck> } {
  return {
    requestCedia: async () => {
      if (failure) throw failure;
      return response({ operation: "settings.keys.list", capabilityRevision: "rev", result });
    },
  };
}

describe("OMP settings readback", () => {
  it("answers absence, not an empty list, when the runtime has no capability bridge", async () => {
    const absent = fixtureClient(undefined, new OmpClientStateError("This OMP runtime does not advertise the Cedia capability bridge"));
    expect(await readOmpSettingsKeys(absent)).toBeUndefined();
    expect(await readOmpSettingsValue(absent, "cycleOrder")).toBeUndefined();
  });

  it("validates the inventory it is given instead of trusting it", async () => {
    const read = await readOmpSettingsKeys(fixtureClient(keys));
    expect(read?.keys.map(key => key.path)).toEqual(["cycleOrder", "auth.broker.token", "modelRoles", "enabledProviders"]);
    expect(read?.keys.filter(key => key.projectWritable).map(key => key.path)).toEqual(["modelRoles"]);

    const unknownField = { keys: [{ ...keys.keys[0]!, extra: true }] };
    await expect(readOmpSettingsKeys(fixtureClient(unknownField))).rejects.toThrow(OmpSettingsValidationError);

    const duplicated = { keys: [keys.keys[0]!, keys.keys[0]!], settingsRevision: "fixture-revision" };
    await expect(readOmpSettingsKeys(fixtureClient(duplicated))).rejects.toThrow(/duplicated/);
  });

  it("keeps a published enum choice list, and refuses a malformed one", async () => {
    // A runtime that publishes an enum's allowed values has them carried to the control.
    const withChoices = { keys: [{ ...keys.keys[0]!, type: "enum", values: ["smol", "slow"] }], settingsRevision: "fixture-revision" };
    expect((await readOmpSettingsKeys(fixtureClient(withChoices)))?.keys[0]?.values).toEqual(["smol", "slow"]);
    // A list the schema's own validator would disagree with is refused, not trimmed.
    for (const values of [["smol", "smol"], ["smol", 1], [], [""]]) {
      const malformed = { keys: [{ ...keys.keys[0]!, type: "enum", values }], settingsRevision: "fixture-revision" };
      await expect(readOmpSettingsKeys(fixtureClient(malformed))).rejects.toThrow(OmpSettingsValidationError);
    }
  });

  it("carries a published timing and refuses one Cedia does not know", async () => {
    const timed = { keys: [{ ...keys.keys[0]!, apply: "immediate" }], settingsRevision: "fixture-revision" };
    expect((await readOmpSettingsKeys(fixtureClient(timed)))?.keys[0]?.apply).toBe("immediate");
    // A timing outside the vocabulary would be rendered to the owner as a claim the runtime
    // never made, so it is refused rather than passed through.
    for (const apply of ["soon", "IMMEDIATE", 1, null]) {
      const malformed = { keys: [{ ...keys.keys[0]!, apply }], settingsRevision: "fixture-revision" };
      await expect(readOmpSettingsKeys(fixtureClient(malformed))).rejects.toThrow(OmpSettingsValidationError);
    }
  });

  it("re-validates the redaction invariant rather than forwarding whatever arrived", async () => {
    const redacted: OmpSettingsValue = {
      path: "auth.broker.token",
      credential: true,
      redacted: true,
      configured: false,
      settingsRevision: "fixture-revision",
      scope: "session",
    };
    expect((await readOmpSettingsValue(fixtureClient(redacted), "auth.broker.token"))?.redacted).toBe(true);

    // A runtime that answered a credential path with its value must not pass through Cedia.
    const leaky = { ...redacted, value: "sk-secret" };
    await expect(readOmpSettingsValue(fixtureClient(leaky), "auth.broker.token")).rejects.toThrow(OmpSettingsValidationError);

    // And a settings answer with neither a value nor a reason is malformed too.
    await expect(
      readOmpSettingsValue(fixtureClient({ path: "cycleOrder", credential: false, settingsRevision: "fixture-revision" }), "cycleOrder"),
    ).rejects.toThrow(OmpSettingsValidationError);
  });

  it("reports an oversized value by size rather than sending it truncated", () => {
    const oversized = parseOmpSettingsValue({
      path: "tools.disabled",
      credential: false,
      redacted: false,
      configured: true,
      tooLarge: true,
      bytes: 9_000,
      settingsRevision: "fixture-revision",
    });
    expect(oversized.tooLarge).toBe(true);
    expect(oversized.bytes).toBe(9_000);
    expect(Object.hasOwn(oversized, "value")).toBe(false);
    expect(() =>
      parseOmpSettingsValue({
        path: "tools.disabled",
        redacted: false,
        tooLarge: true,
        bytes: 9_000,
        value: "x",
        settingsRevision: "fixture-revision",
      }),
    ).toThrow(OmpSettingsValidationError);
  });

  it("turns a key the runtime refuses into a typed unknown-path error", async () => {
    const refusal = new OmpCommandError("not.a.setting is not a setting this runtime defines", "cedia_control", "cedia_control_invalid_payload");
    await expect(readOmpSettingsValue(fixtureClient(undefined, refusal), "not.a.setting")).rejects.toMatchObject({
      code: "omp_settings_unknown_path",
      path: "not.a.setting",
    });
  });
});

describe("OMP settings route", () => {
  it("answers the inventory and one value for the owner only, redacting a credential", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omp-settings-route-"));
    const stateDir = join(directory, "state");
    mkdirSync(stateDir, { recursive: true });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const host = new CediaHost({ store, stateDir });
    const router = createRouter(host, auth, {
      ompSettingsKeys: async () => ({ state: "available", answer: keys }),
      ompSettingsValue: async (path: string) =>
        path === "auth.broker.token"
          ? { state: "available" as const, answer: { path, credential: true, redacted: true, configured: false } as OmpSettingsValue }
          : { state: "available" as const, answer: value },
    });
    try {
      const inventory = await router({ method: "GET", path: "/v1/omp/settings/keys", token: auth.ownerToken });
      expect(inventory.status).toBe(200);
      expect((inventory.body as { keys: { path: string }[] }).keys.map(key => key.path)).toEqual([
        "cycleOrder",
        "auth.broker.token",
        "modelRoles",
        "enabledProviders",
      ]);
      expect((inventory.body as { keys: { path: string; apply: string }[] }).keys.map(key => key.apply)).toEqual([
        "turn_boundary",
        "reload",
        "new_session",
        "reload",
      ]);

      const read = await router({ method: "GET", path: "/v1/omp/settings/value?path=cycleOrder", token: auth.ownerToken });
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ state: "available", path: "cycleOrder", value: ["default", "smol"] });

      const redacted = await router({
        method: "GET",
        path: "/v1/omp/settings/value?path=auth.broker.token",
        token: auth.ownerToken,
      });
      expect(redacted.body).toMatchObject({ state: "available", credential: true, redacted: true });
      expect(Object.hasOwn(redacted.body as object, "value")).toBe(false);

      const missing = await router({ method: "GET", path: "/v1/omp/settings/value", token: auth.ownerToken });
      expect(missing).toMatchObject({ status: 400, body: { error: { code: "invalid_query" } } });

      const controller = auth.issue("fixture-controller");
      const denied = await router({ method: "GET", path: "/v1/omp/settings/keys", token: controller.token });
      expect(denied).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports an absent runtime with its reason, and refuses an unknown key", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omp-settings-absent-"));
    const stateDir = join(directory, "state");
    mkdirSync(stateDir, { recursive: true });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const host = new CediaHost({ store, stateDir });
    const router = createRouter(host, auth, {
      ompSettingsKeys: async () => ({
        state: "unavailable",
        reason: "No OMP runtime is running; Cedia reads this from a live session runtime.",
      }),
      ompSettingsValue: async () => {
        throw new OmpSettingsPathError("not.a.setting", "not.a.setting is not a setting this runtime defines");
      },
    });
    try {
      const absent = await router({ method: "GET", path: "/v1/omp/settings/keys", token: auth.ownerToken });
      expect(absent.status).toBe(200);
      expect(absent.body).toMatchObject({ state: "unavailable" });
      expect(String((absent.body as { reason: string }).reason)).toContain("No OMP runtime is running");

      const unknown = await router({ method: "GET", path: "/v1/omp/settings/value?path=not.a.setting", token: auth.ownerToken });
      expect(unknown).toMatchObject({ status: 404, body: { error: { code: "omp_settings_unknown_path" } } });
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("classifies every key Cedia would show, so a control can be generated from it", () => {
    const byPath = new Map(keys.keys.map(key => [key.path, key]));
    expect(ompSettingDisposition(byPath.get("cycleOrder")!)).toEqual({ disposition: "editable" });
    expect(ompSettingDisposition(byPath.get("auth.broker.token")!).disposition).toBe("protected");
    expect(ompSettingDisposition(byPath.get("modelRoles")!).disposition).toBe("advanced");
    expect(ompSettingDisposition(byPath.get("enabledProviders")!).disposition).toBe("advanced");
    // Every non-editable disposition explains itself, which is what a settings row shows in place
    // of a control it must not offer.
    for (const key of keys.keys) {
      const { disposition, reason } = ompSettingDisposition(key);
      if (disposition === "editable") expect(reason).toBeUndefined();
      else expect(String(reason ?? "").length).toBeGreaterThan(0);
    }
  });

  it("writes one editable setting and refuses a path Cedia does not write", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omp-settings-write-"));
    const stateDir = join(directory, "state");
    mkdirSync(stateDir, { recursive: true });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const host = new CediaHost({ store, stateDir });
    const writes: { path: string; value: unknown; expectedRevision?: string }[] = [];
    const router = createRouter(host, auth, {
      ompSettingsKeys: async () => ({ state: "available", answer: keys }),
      ompSettingsWrite: async (request: { path: string; value: unknown; expectedRevision?: string }) => {
        writes.push(request);
        if (request.path === "stale.path") throw new OmpSettingsRevisionError(request.expectedRevision ?? "", "fixture-current");
        if (request.path === "rejected.path") {
          const { OmpSettingsRejectedError } = await import("../src/omp-settings.ts");
          throw new OmpSettingsRejectedError(request.path, "cycleOrder takes an array");
        }
        return { state: "available", answer: { ...value, value: request.value, settingsRevision: "fixture-revision-2" } };
      },
    });
    try {
      const written = await router({
        method: "PATCH",
        path: "/v1/omp/settings",
        token: auth.ownerToken,
        body: { path: "cycleOrder", value: ["default"], expectedRevision: "fixture-revision" },
      });
      expect(written.status).toBe(200);
      expect(written.body).toMatchObject({ state: "available", path: "cycleOrder", settingsRevision: "fixture-revision-2" });
      expect(writes).toEqual([{ path: "cycleOrder", value: ["default"], expectedRevision: "fixture-revision" }]);

      // A credential path and a not-yet-writable Advanced path are refused by Cedia's own policy, with 403 (S1a; scoped writes land in S3).
      for (const path of ["auth.broker.token", "enabledProviders"]) {
        const refused = await router({ method: "PATCH", path: "/v1/omp/settings", token: auth.ownerToken, body: { path, value: ["x"] } });
        expect(refused).toMatchObject({ status: 403, body: { error: { code: "omp_settings_not_editable" } } });
      }

      const unknown = await router({ method: "PATCH", path: "/v1/omp/settings", token: auth.ownerToken, body: { path: "nope", value: 1 } });
      expect(unknown).toMatchObject({ status: 404, body: { error: { code: "omp_settings_unknown_path" } } });

      const noValue = await router({ method: "PATCH", path: "/v1/omp/settings", token: auth.ownerToken, body: { path: "cycleOrder" } });
      expect(noValue).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });

      const controller = auth.issue("fixture-controller");
      const denied = await router({ method: "PATCH", path: "/v1/omp/settings", token: controller.token, body: { path: "cycleOrder", value: [] } });
      expect(denied).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });

      // The inventory carries the disposition so a window does not have to re-derive the policy.
      const inventory = await router({ method: "GET", path: "/v1/omp/settings/keys", token: auth.ownerToken });
      const rows = (inventory.body as { keys: { path: string; disposition: string }[] }).keys;
      expect(rows.find(row => row.path === "cycleOrder")?.disposition).toBe("editable");
      expect(rows.find(row => row.path === "auth.broker.token")?.disposition).toBe("protected");

      expect(writes.length).toBe(1);
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("maps a stale settings revision and a rejected value to their own refusals", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omp-settings-stale-"));
    const stateDir = join(directory, "state");
    mkdirSync(stateDir, { recursive: true });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const host = new CediaHost({ store, stateDir });
    const router = createRouter(host, auth, {
      ompSettingsKeys: async () => ({ state: "available", answer: keys }),
      ompSettingsWrite: async (request: { path: string; value: unknown; expectedRevision?: string }) => {
        const { OmpSettingsRejectedError } = await import("../src/omp-settings.ts");
        if (request.path === "cycleOrder" && request.expectedRevision !== "fixture-revision")
          throw new OmpSettingsRevisionError(request.expectedRevision ?? "", "fixture-revision");
        if (request.path === "cycleOrder" && typeof request.value === "string")
          throw new OmpSettingsRejectedError(request.path, "cycleOrder takes an array");
        return { state: "available", answer: { ...value, settingsRevision: "fixture-revision" } };
      },
    });
    try {
      const stale = await router({
        method: "PATCH",
        path: "/v1/omp/settings",
        token: auth.ownerToken,
        body: { path: "cycleOrder", value: ["default"], expectedRevision: "moved" },
      });
      expect(stale).toMatchObject({ status: 409, body: { error: { code: "omp_settings_stale_revision" } } });

      const rejected = await router({
        method: "PATCH",
        path: "/v1/omp/settings",
        token: auth.ownerToken,
        body: { path: "cycleOrder", value: "default", expectedRevision: "fixture-revision" },
      });
      expect(rejected).toMatchObject({ status: 400, body: { error: { code: "omp_settings_rejected" } } });
      expect(String((rejected.body as { error: { message: string } }).error.message)).toContain("takes an array");

      const accepted = await router({
        method: "PATCH",
        path: "/v1/omp/settings",
        token: auth.ownerToken,
        body: { path: "cycleOrder", value: ["default"], expectedRevision: "fixture-revision" },
      });
      expect(accepted.status).toBe(200);
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("says the owner is not wired rather than pretending an inventory exists", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omp-settings-nowire-"));
    const stateDir = join(directory, "state");
    mkdirSync(stateDir, { recursive: true });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const host = new CediaHost({ store, stateDir });
    const router = createRouter(host, auth, {});
    try {
      const answer = await router({ method: "GET", path: "/v1/omp/settings/keys", token: auth.ownerToken });
      expect(answer).toMatchObject({ status: 503, body: { error: { code: "omp_settings_unavailable" } } });
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("OMP scoped settings routes", () => {
  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "cedia-omp-settings-scoped-"));
    const stateDir = join(directory, "state");
    mkdirSync(stateDir, { recursive: true });
    const store = DurableStore.open({ stateDir, recover: false });
    const auth = new DeviceAuth(join(directory, "devices"));
    const host = new CediaHost({ store, stateDir });
    const seen: { context?: unknown; mutation?: unknown; preview?: unknown } = {};
    const router = createRouter(host, auth, {
      ompSettingsKeys: async () => ({ state: "available", answer: keys }),
      ompSettingsValue: async () => ({ state: "available", answer: value }),
      ompSettingsValueIn: async (path: string, context) => {
        seen.context = context;
        if (context.scope === "session" && (context as { sessionId?: string }).sessionId !== "task-1")
          return { state: "unavailable", reason: "No live runtime owns this task" };
        return { state: "available", answer: { ...value, path, scope: context.scope } };
      },
      ompSettingsMutate: async mutation => {
        seen.mutation = mutation;
        return { values: [{ ...value, settingsRevision: "fixture-revision-2" }], scope: "global" as const };
      },
      ompSettingsResetPreview: async paths => {
        seen.preview = paths;
        return [{ path: "cycleOrder", globalConfigured: true, current: value }];
      },
    });
    return { directory, store, auth, host, router, seen };
  }

  it("reads global, project and session scopes, and guards unknown tasks", async () => {
    const { directory, store, auth, host, router, seen } = fixture();
    try {
      const global = await router({ method: "GET", path: "/v1/omp/settings/value?path=cycleOrder&scope=global", token: auth.ownerToken });
      expect(global.status).toBe(200);
      expect(seen.context).toEqual({ scope: "global" });
      expect((global.body as { scope: string }).scope).toBe("global");
      const project = await router({
        method: "GET",
        path: "/v1/omp/settings/value?path=cycleOrder&scope=project&projectId=p1",
        token: auth.ownerToken,
      });
      expect(project.status).toBe(200);
      expect(seen.context).toEqual({ scope: "project", projectId: "p1" });
      const named = await router({
        method: "GET",
        path: "/v1/omp/settings/value?path=cycleOrder&scope=session&sessionId=task-1",
        token: auth.ownerToken,
      });
      expect(named.status).toBe(200);
      const unknown = await router({
        method: "GET",
        path: "/v1/omp/settings/value?path=cycleOrder&scope=session&sessionId=nope",
        token: auth.ownerToken,
      });
      expect(unknown.body).toMatchObject({ state: "unavailable" });
      const badScope = await router({ method: "GET", path: "/v1/omp/settings/value?path=cycleOrder&scope=zone", token: auth.ownerToken });
      expect(badScope).toMatchObject({ status: 400 });
      const dangling = await router({ method: "GET", path: "/v1/omp/settings/value?path=cycleOrder&scope=project", token: auth.ownerToken });
      expect(dangling).toMatchObject({ status: 400 });
      // No scope stays on the legacy route, which preserves the runtime answer shape.
      const legacy = await router({ method: "GET", path: "/v1/omp/settings/value?path=cycleOrder", token: auth.ownerToken });
      expect(legacy.status).toBe(200);
      expect((legacy.body as { scope?: string }).scope).toBe("session");
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("applies scoped mutations and previews resets without writing", async () => {
    const { directory, store, auth, host, router, seen } = fixture();
    try {
      const mutated = await router({
        method: "PATCH",
        path: "/v1/omp/settings",
        token: auth.ownerToken,
        body: { context: { scope: "global" }, expectedRevision: "fixture-revision", changes: [{ path: "cycleOrder", operation: "set", value: ["x"] }] },
      });
      expect(mutated.status).toBe(200);
      expect(seen.mutation).toMatchObject({ context: { scope: "global" } });
      const badShape = await router({
        method: "PATCH",
        path: "/v1/omp/settings",
        token: auth.ownerToken,
        body: { context: { scope: "session", sessionId: "task-1" }, changes: [{ path: "cycleOrder", operation: "unset" }] },
      });
      expect(badShape).toMatchObject({ status: 400 });
      const preview = await router({
        method: "POST",
        path: "/v1/omp/settings/reset-preview",
        token: auth.ownerToken,
        body: { paths: ["cycleOrder"] },
      });
      expect(preview.status).toBe(200);
      expect(seen.preview).toEqual(["cycleOrder"]);
      expect((preview.body as { entries: { path: string }[] }).entries.map(entry => entry.path)).toEqual(["cycleOrder"]);
      const emptyPreview = await router({ method: "POST", path: "/v1/omp/settings/reset-preview", token: auth.ownerToken, body: { paths: [] } });
      expect(emptyPreview).toMatchObject({ status: 400 });
    } finally {
      await host.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
