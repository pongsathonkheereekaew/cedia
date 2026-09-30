import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHostServer } from "../src/server.ts";
import { EnrollmentStore } from "../src/enrollment.ts";
import { generateKeyPair, exportPublicKey, exportSecretKey } from "../../../packages/relay/src/e2ee.ts";

let running: Awaited<ReturnType<typeof startHostServer>> | undefined;

afterEach(async () => {
  await running?.close().catch(() => undefined);
  running = undefined;
});

function webRootFixture(root: string): string {
  const web = join(root, "remote-web");
  mkdirSync(join(web, "assets"), { recursive: true });
  writeFileSync(join(web, "index.html"), "<!doctype html><title>Cedia remote</title>");
  writeFileSync(join(web, "assets", "app.js"), "export const ready = true;\n");
  return web;
}

async function fixture(options: { readonly enabledRelay?: boolean } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-gateway-"));
  const webRoot = webRootFixture(stateDir);
  if (options.enabledRelay === true) {
    const key = generateKeyPair();
    writeFileSync(join(stateDir, "remote.json"), JSON.stringify({
      version: 1, serverId: "fixture-relay", publicKey: exportPublicKey(key.publicKey), secretKey: exportSecretKey(key.secretKey),
      endpoint: "relay.paseo.sh:443", enabled: true,
    }));
  }
  const enrollment = new EnrollmentStore(stateDir);
  const offer = enrollment.issue("Phone", { ttlMs: 5 * 60_000 });
  // Minted before the host starts, so the gateway's own view of the store is the same file.
  const spentOffers = { expired: enrollment.issue("Old phone", { ttlMs: 60_000, now: new Date(Date.now() - 10 * 60_000) }) };
  running = await startHostServer({ stateDir, remoteWebRoot: webRoot, remoteGatewayPort: 0 });
  const gateway = running.gateway;
  if (!gateway) throw new Error("gateway did not start");
  const owner = { Authorization: `Bearer ${running.descriptor.token}`, "Content-Type": "application/json" };
  return { stateDir, gateway: gateway.url, offer, owner, spentOffers, enrollment, hostUrl: running.descriptor.url };
}

async function enroll(url: string, code: string, name = "Phone"): Promise<{ cookie: string; csrf: string }> {
  const response = await fetch(`${url}/gateway/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { csrf: string };
  const setCookie = response.headers.getSetCookie();
  const session = setCookie.find(value => value.startsWith("cedia_session="));
  if (!session) throw new Error("no session cookie");
  // A browser sends both cookies together; the CSRF cookie is the state-changing half of the
  // session pair, so the fixture must carry it the same way or every POST would look unpaired.
  const csrfCookie = setCookie.find(value => value.startsWith("cedia_csrf="));
  if (!csrfCookie) throw new Error("no csrf cookie");
  return { cookie: [session, csrfCookie].map(value => value.split(";")[0]!).join("; "), csrf: body.csrf };
}

test("the gateway serves the packaged client and proxies the host API for a paired controller", async () => {
  const { gateway, offer, owner, stateDir, hostUrl } = await fixture();
  try {
    const index = await fetch(`${gateway}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toContain("Cedia remote");

    const asset = await fetch(`${gateway}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");

    // A client-side route still loads the one packaged document; a missing asset does not.
    expect((await fetch(`${gateway}/tasks/abc`)).status).toBe(200);
    expect((await fetch(`${gateway}/assets/missing.js`)).status).toBe(404);

    const anonymous = await fetch(`${gateway}/v1/sessions`);
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json() as { error: { code: string } }).error.code).toBe("unauthorized");

    const session = await enroll(gateway, offer.code, "Kitchen phone");
    const sessions = await fetch(`${gateway}/v1/sessions`, { headers: { Cookie: session.cookie } });
    expect(sessions.status).toBe(200);

    // The browser session is the controller's own credential: an owner-only route stays owner-only
    // over the gateway instead of being proxied with the Mac's owner token.
    const ownerOnly = await fetch(`${gateway}/v1/capabilities`, { headers: { Cookie: session.cookie } });
    expect(ownerOnly.status).toBe(403);

    // Unknown API paths answer a structured error, never the HTML document.
    const unknown = await fetch(`${gateway}/v1/not-a-route`, { headers: { Cookie: session.cookie } });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("application/json");
    expect((await unknown.json() as { error: { code: string } }).error.code).toBe("not_found");

    // State-changing requests need the session's CSRF token.
    const noCsrf = await fetch(`${gateway}/v1/not-a-route`, { method: "POST", headers: { Cookie: session.cookie, "Content-Type": "application/json" }, body: "{}" });
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json() as { error: { code: string } }).error.code).toBe("csrf_required");
    const withCsrf = await fetch(`${gateway}/v1/not-a-route`, { method: "POST", headers: { Cookie: session.cookie, "X-Cedia-CSRF": session.csrf, "Content-Type": "application/json" }, body: "{}" });
    expect(withCsrf.status).toBe(404);

    // The owner token is not a gateway credential: the gateway only accepts a paired browser
    // session, so the Mac's own token is refused here rather than proxied.
    const ownerTokenAtGateway = await fetch(`${gateway}/v1/devices`, { headers: owner });
    expect(ownerTokenAtGateway.status).toBe(401);
    expect((await ownerTokenAtGateway.json() as { error: { code: string } }).error.code).toBe("unauthorized");
    // The selected remote path is reported from the process that started it: this host has the
    // packaged client, so the row is available with the gateway's own operations, and the owner
    // reads it on the loopback API rather than through the gateway.
    const capabilities = await (await fetch(`${hostUrl}/v1/capabilities`, { headers: owner })).json() as { capabilities: Array<{ id: string; availability: string; operations: readonly string[]; reason?: string }> };
    const remote = capabilities.capabilities.find(item => item.id === "remote.tailscale");
    expect(remote?.availability).toBe("available");
    expect(remote?.operations).toContain("enroll");
    expect(remote?.reason).toBeUndefined();
    expect(stateDir.length).toBeGreaterThan(0);
  } finally { rmSync(stateDir, { recursive: true, force: true }); }
});

test("an enrollment code works once, expires, and a revoked device stops working", async () => {
  const { gateway, offer, spentOffers, owner, stateDir, hostUrl } = await fixture();
  try {
    void owner;
    const first = await enroll(gateway, offer.pin, "Paired once");
    const reused = await fetch(`${gateway}/gateway/enroll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: offer.code }) });
    expect(reused.status).toBe(409);
    expect((await reused.json() as { error: { code: string } }).error.code).toBe("enrollment_already_redeemed");

    const expired = await fetch(`${gateway}/gateway/enroll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: spentOffers.expired.code }) });
    expect(expired.status).toBe(410);
    expect((await expired.json() as { error: { code: string } }).error.code).toBe("enrollment_expired");

    const unknown = await fetch(`${gateway}/gateway/enroll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "not-a-code" }) });
    expect(unknown.status).toBe(401);

    // The owner revokes the device from the Mac; the browser's cookie stops being accepted.
    const devices = await (await fetch(`${hostUrl}/v1/devices`, { headers: owner })).json() as { id: string; name: string }[];
    const paired = devices.find(device => device.name === "Paired once");
    expect(paired).toBeDefined();
    const revoked = await fetch(`${hostUrl}/v1/devices/${paired!.id}/revoke`, { method: "POST", headers: owner, body: "{}" });
    expect(revoked.status).toBe(200);
    const after = await fetch(`${gateway}/v1/sessions`, { headers: { Cookie: first.cookie } });
    expect(after.status).toBe(401);

    const session = await fetch(`${gateway}/gateway/session`, { headers: { Cookie: first.cookie } });
    expect(await session.json()).toMatchObject({ authenticated: false });
  } finally { rmSync(stateDir, { recursive: true, force: true }); }
});

test("a native client redeems the same code for a token the browser can never be given", async () => {
  const { gateway, offer, stateDir } = await fixture();
  try {
    // A browser POST always carries Origin, including a same-origin one, so the native answer is
    // refused to it rather than handed a credential an HttpOnly cookie was protecting.
    const fromBrowser = await fetch(`${gateway}/gateway/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: gateway },
      body: JSON.stringify({ code: offer.code, name: "Web page", client: "native" }),
    });
    expect(fromBrowser.status).toBe(403);
    expect((await fromBrowser.json() as { error: { code: string } }).error.code).toBe("origin_forbidden");

    const native = await fetch(`${gateway}/gateway/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: offer.code, name: "iPhone", client: "native" }),
    });
    expect(native.status).toBe(200);
    const body = await native.json() as { device: { id: string; name: string }; token: string };
    expect(body.device.name).toBe("iPhone");
    expect(body.token.length).toBeGreaterThan(16);
    // No cookie jar is asked for, and none is handed out.
    expect(native.headers.getSetCookie()).toEqual([]);

    // The token is the credential: a mutation needs no CSRF because nothing ambient is sent.
    const withBearer = await fetch(`${gateway}/v1/devices`, { headers: { Authorization: `Bearer ${body.token}` } });
    expect(withBearer.status).toBe(403);
    expect((await withBearer.json() as { error: { code: string } }).error.code).toBe("forbidden");
    const revoked = await fetch(`${gateway}/v1/sessions`, { headers: { Authorization: `Bearer ${body.token}` } });
    expect(revoked.status).toBe(200);
    const anonymous = await fetch(`${gateway}/v1/sessions`, { headers: { Authorization: `Bearer not-a-token` } });
    expect(anonymous.status).toBe(401);
  } finally { rmSync(stateDir, { recursive: true, force: true }); }
});

test("the owner issues the code and the gateway redeems the same one", async () => {
  const { gateway, stateDir, owner, hostUrl } = await fixture();
  try {
    // Nothing else hands out a code: the owner route is the only path into the gateway's store.
    const state = await (await fetch(`${hostUrl}/v1/remote/gateway`, { headers: owner })).json() as { state: string; url: string };
    expect(state.state).toBe("available");
    expect(state.url).toBe(gateway);

    const issued = await fetch(`${hostUrl}/v1/remote/enrollment`, {
      method: "POST",
      headers: owner,
      body: JSON.stringify({ name: "Kitchen phone" }),
    });
    expect(issued.status).toBe(200);
    const offer = await issued.json() as { code: string; pin: string; expiresAt: string };
    expect(offer.code.length).toBeGreaterThan(20);
    expect(offer.pin).toMatch(/^[0-9]+$/);
    expect(offer.pin.length).toBeGreaterThanOrEqual(6);
    expect(Date.parse(offer.expiresAt)).toBeGreaterThan(Date.now());

    const redeemed = await fetch(`${gateway}/gateway/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: offer.code, name: "Kitchen phone" }),
    });
    expect(redeemed.status).toBe(200);
    expect(redeemed.headers.getSetCookie().length).toBe(2);

    // The paired device is the ordinary revocable device record, and the code cannot be reused.
    const devices = await (await fetch(`${hostUrl}/v1/devices`, { headers: owner })).json() as { id: string; name: string }[];
    expect(devices.some(device => device.name === "Kitchen phone")).toBe(true);
    const again = await fetch(`${gateway}/gateway/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: offer.code, name: "Kitchen phone" }),
    });
    expect(again.status).toBe(409);
  } finally { rmSync(stateDir, { recursive: true, force: true }); }
});

test("the gateway refuses a Host or Origin it was not configured for", async () => {
  const { gateway, offer, stateDir } = await fixture();
  try {
    const hostileHost = await fetch(`${gateway}/`, { headers: { Host: "evil.example" } });
    expect(hostileHost.status).toBe(403);
    expect((await hostileHost.json() as { error: { code: string } }).error.code).toBe("host_forbidden");

    const hostileOrigin = await fetch(`${gateway}/gateway/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ code: offer.code }),
    });
    expect(hostileOrigin.status).toBe(403);
    expect((await hostileOrigin.json() as { error: { code: string } }).error.code).toBe("origin_forbidden");

    // The gateway's own origin is allowed, which is what a browser on the tailnet sends.
    const allowed = await fetch(`${gateway}/gateway/session`, { headers: { Origin: gateway } });
    expect(allowed.status).toBe(200);
  } finally { rmSync(stateDir, { recursive: true, force: true }); }
});

test("the Paseo relay does not come up at startup even when its record says enabled", async () => {
  const { gateway, owner, stateDir, hostUrl } = await fixture({ enabledRelay: true });
  try {
    // The owner reads the host's own loopback API: the gateway deliberately does not accept the
    // owner token, so this is the only place the relay record is visible.
    expect((await fetch(`${gateway}/v1/remote`, { headers: owner })).status).toBe(401);
    const status = await (await fetch(`${hostUrl}/v1/remote`, { headers: owner })).json() as { enabled: boolean; state: string; endpoint: string };
    // The identity is kept, and nothing connects: the selected transport is the gateway, and the
    // relay starts only from an explicit owner action.
    expect(status.enabled).toBe(true);
    expect(status.state).toBe("stopped");
    expect(status.endpoint).toContain("relay.paseo.sh");
  } finally { rmSync(stateDir, { recursive: true, force: true }); }
});
