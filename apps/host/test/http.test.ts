import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHostServer } from "../src/server.ts";

test("loopback HTTP authenticates all reads, rejects browser origins and revokes controller access", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-"));
  const server = await startHostServer({ stateDir });
  try {
    const url = `${server.descriptor.url}/v1/health`;
    const headers = { Authorization: `Bearer ${server.descriptor.token}` };
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers })).status).toBe(200);
    expect((await fetch(url, { headers: { ...headers, Origin: "https://malicious.example" } })).status).toBe(403);
    const issued = server.auth.issue("Fixture phone");
    const phone = { Authorization: `Bearer ${issued.token}` };
    expect((await fetch(url, { headers: phone })).status).toBe(200);
    server.auth.revoke(issued.device.id);
    expect((await fetch(url, { headers: phone })).status).toBe(401);
    expect((await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: "{" })).status).toBe(400);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("DELETE removes a task, its transcript directory, and 404s the id afterwards", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-delete-"));
  const projectPath = join(stateDir, "project");
  mkdirSync(projectPath, { recursive: true });
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  try {
    const project = await (await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: JSON.stringify({ path: projectPath }) })).json() as { id: string };
    const session = await (await fetch(`${server.descriptor.url}/v1/sessions`, { method: "POST", headers, body: JSON.stringify({ projectId: project.id, title: "Delete me" }) })).json() as { id: string };
    const transcript = join(stateDir, "sessions", session.id);
    expect(existsSync(transcript)).toBe(true);
    const deleted = await fetch(`${server.descriptor.url}/v1/sessions/${session.id}`, { method: "DELETE", headers });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ deleted: true });
    expect(existsSync(transcript)).toBe(false);
    expect((await fetch(`${server.descriptor.url}/v1/sessions/${session.id}`, { headers })).status).toBe(404);
    expect((await fetch(`${server.descriptor.url}/v1/sessions/${session.id}`, { method: "DELETE", headers })).status).toBe(404);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("refuses every browser Origin, before credentials and without writing anything", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-origin-"));
  const projectPath = join(stateDir, "project");
  mkdirSync(projectPath, { recursive: true });
  const server = await startHostServer({ stateDir });
  const url = `${server.descriptor.url}/v1/health`;
  const token = `Bearer ${server.descriptor.token}`;
  try {
    // Web origins are refused before authentication, so a malicious page cannot even
    // probe whether the owner's token is live.
    const unauthenticated = await fetch(url, { headers: { Origin: "https://malicious.example" } });
    expect(unauthenticated.status).toBe(403);
    expect(await unauthenticated.json()).toMatchObject({ error: { code: "origin_forbidden" } });
    // The listener's own loopback origin is refused too: native clients send no Origin,
    // so a browser is never the intended caller, not even the owner's browser.
    const own = await fetch(url, { headers: { Authorization: token, Origin: `http://127.0.0.1:${new URL(url).port}` } });
    expect(own.status).toBe(403);
    const write = await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers: { Authorization: token, Origin: "null", "Content-Type": "application/json" }, body: JSON.stringify({ path: projectPath }) });
    expect(write.status).toBe(403);
    expect(await (await fetch(`${server.descriptor.url}/v1/projects`, { headers: { Authorization: token } })).json()).toEqual([]);
    // The same write without an Origin is accepted, so the refusal is about the origin.
    expect((await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ path: projectPath }) })).status).toBe(200);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("answers only to the loopback names of its own listener", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-host-"));
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}` };
  try {
    const url = `${server.descriptor.url}/v1/health`;
    // A page on a rebound DNS name reaches 127.0.0.1 but cannot claim the listener's
    // own name, and a mismatched port is the same refusal.
    for (const host of ["relay.attacker.example", "127.0.0.1:1"]) {
      const rebound = await fetch(url, { headers: { ...headers, Host: host } });
      expect(rebound.status).toBe(403);
      expect(await rebound.json()).toMatchObject({ error: { code: "host_forbidden" } });
    }
    expect((await fetch(url, { headers })).status).toBe(200);
    expect((await fetch(`http://localhost:${new URL(url).port}/v1/health`, { headers })).status).toBe(200);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("caps a request body at 16 MiB while it streams, before parsing it", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-body-"));
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  const post = (body: string) => fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body });
  try {
    // A body exactly at the cap is read and then rejected as JSON: the cap is a size
    // limit, not a blanket refusal of large requests.
    const atCap = await post("x".repeat(16 * 1024 * 1024));
    expect(atCap.status).toBe(400);
    expect(await atCap.json()).toMatchObject({ error: { code: "invalid_request" } });
    // One byte more is refused as too large, not as malformed: the limit is applied as
    // the body streams in, so the host never buffers or parses the oversized payload.
    const overCap = await post("x".repeat(16 * 1024 * 1024 + 1));
    expect(overCap.status).toBe(413);
    expect(await overCap.json()).toMatchObject({ error: { code: "too_large" } });
    // The listener survived both and still serves the next request.
    expect((await fetch(`${server.descriptor.url}/v1/health`, { headers })).status).toBe(200);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});
