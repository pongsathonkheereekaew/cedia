import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter";
import { isOmpSettingsStaleRevisionError } from "../vendor/synara/apps/web/src/components/settings/OmpSettingsPanel.logic";

type Request = {
  kind: "request";
  method: "GET" | "PATCH";
  path: string;
  body?: unknown;
};

function fixture(options: { readonly failure?: Error } = {}) {
  const calls: Request[] = [];
  const bridge = {
    invoke: async (_channel: string, request: Request) => {
      calls.push(request);
      if (options.failure) throw options.failure;
      if (request.path === "/v1/omp/settings/keys") return { state: "available", keys: [], settingsRevision: "rev-1" };
      if (request.path === "/v1/omp/settings/value?path=models.default") return { state: "available", path: "models.default", credential: false, redacted: false, configured: true, value: "smol", settingsRevision: "rev-1" };
      if (request.path === "/v1/omp/settings") return { state: "available", path: "models.default", credential: false, redacted: false, configured: true, value: "default", settingsRevision: "rev-2" };
      throw new Error(`Unexpected request ${request.path}`);
    },
  };
  return { api: createCediaNativeApi({ bridge }), calls };
}

describe("Cedia OMP settings adapter", () => {
  it("forwards inventory, value and revision-checked write routes", async () => {
    const { api, calls } = fixture();

    await api.cedia.getOmpSettingsKeys();
    await api.cedia.getOmpSettingValue("models.default");
    await api.cedia.setOmpSetting({ path: "models.default", value: "default", expectedRevision: "rev-1" });

    expect(calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/omp/settings/keys" },
      { kind: "request", method: "GET", path: "/v1/omp/settings/value?path=models.default" },
      { kind: "request", method: "PATCH", path: "/v1/omp/settings", body: { path: "models.default", value: "default", expectedRevision: "rev-1" } },
    ]);
  });

  it("restores the host code the Electron transport flattened", async () => {
    // What a real renderer receives: one message, no properties, code tagged inside the text.
    const delivered = new Error(
      "Error invoking remote method 'cedia-agent': Error: [cedia-code:omp_settings_stale_revision] The effective settings moved: expected revision r1, the runtime reports r2",
    );
    const { api } = fixture({ failure: delivered });

    const rejection = await api.cedia.setOmpSetting({ path: "models.default", value: "default", expectedRevision: "r1" }).catch(error => error as Error & { code?: string });
    expect(rejection.code).toBe("omp_settings_stale_revision");
    expect(rejection.message).toBe("The effective settings moved: expected revision r1, the runtime reports r2");
    // The row's conflict branch switches on exactly this, so the safe retry is reachable.
    expect(isOmpSettingsStaleRevisionError(rejection)).toBe(true);
  });

  it("rejects with the host's typed code and message", async () => {
    const failure = Object.assign(new Error("The effective settings moved"), { code: "omp_settings_stale_revision" });
    const { api: failingApi } = fixture({ failure });

    const expected = {
      code: "omp_settings_stale_revision",
      message: "The effective settings moved",
    };
    await expect(failingApi.cedia.getOmpSettingsKeys()).rejects.toMatchObject(expected);
    await expect(failingApi.cedia.getOmpSettingValue("models.default")).rejects.toMatchObject(expected);
    await expect(failingApi.cedia.setOmpSetting({ path: "models.default", value: "default", expectedRevision: "rev-1" })).rejects.toMatchObject(expected);
  });
});
