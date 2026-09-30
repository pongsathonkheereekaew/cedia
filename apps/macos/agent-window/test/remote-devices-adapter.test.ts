import { describe, expect, it } from "bun:test";

import { createCediaNativeApi } from "../src/cedia-adapter";

type Request = {
  kind: "request";
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

function fixture(answers: Readonly<Record<string, unknown>> = {}) {
  const calls: Request[] = [];
  const bridge = {
    invoke: async (_channel: string, request: Request) => {
      calls.push(request);
      if (request.path in answers) return answers[request.path];
      return { ok: true };
    },
  };
  return { api: createCediaNativeApi({ bridge }), calls };
}

describe("Cedia remote devices adapter", () => {
  it("reads the gateway state, issues one code, lists devices and revokes one", async () => {
    const { api, calls } = fixture();

    await api.cedia.getRemoteGatewayState();
    await api.cedia.issueRemoteEnrollment("Kitchen phone");
    await api.cedia.listDevices();
    await api.cedia.revokeDevice("device/with space");

    expect(calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/remote/gateway" },
      { kind: "request", method: "POST", path: "/v1/remote/enrollment", body: { name: "Kitchen phone" } },
      { kind: "request", method: "GET", path: "/v1/devices" },
      // A device id is an opaque identifier the host issued, so it is encoded rather than
      // interpolated into a path where a slash would silently address another route.
      { kind: "request", method: "POST", path: "/v1/devices/device%2Fwith%20space/revoke", body: {} },
    ]);
  });
});
