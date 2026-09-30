import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isRemoteWebRoot,
  remoteGatewayHosts,
  resolveBundledRemoteWeb,
} from "../src/remote-web-assets.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runtimeRoot(options: { readonly webClient?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cedia-remote-web-"));
  roots.push(root);
  if (options.webClient !== false) {
    mkdirSync(join(root, "remote-web", "assets"), { recursive: true });
    writeFileSync(join(root, "remote-web", "index.html"), "<!doctype html><title>Cedia remote</title>");
    writeFileSync(join(root, "remote-web", "assets", "app.js"), "export const ready = true;\n");
  }
  return root;
}

test("a packaged build with an export yields the client the gateway serves", () => {
  const root = runtimeRoot();
  const resolved = resolveBundledRemoteWeb({ runtimeRoot: root, env: {} });
  expect(resolved.webRoot).toBe(join(root, "remote-web"));
  expect(resolved.hosts).toBeUndefined();
  expect(isRemoteWebRoot(resolved.webRoot!)).toBe(true);
});

test("a build without the export reports no client instead of an empty root", () => {
  const root = runtimeRoot({ webClient: false });
  expect(resolveBundledRemoteWeb({ runtimeRoot: root, env: {} })).toEqual({});
  // A directory that exists but has no document is not a client either: the gateway would answer
  // every deep link with `web_client_missing`, which is the state this check exists to prevent.
  mkdirSync(join(root, "remote-web"), { recursive: true });
  expect(resolveBundledRemoteWeb({ runtimeRoot: root, env: {} })).toEqual({});
  expect(isRemoteWebRoot(join(root, "remote-web"))).toBe(false);
});

test("the development override must be an absolute path to a real client", () => {
  const root = runtimeRoot();
  const client = join(root, "remote-web");
  expect(resolveBundledRemoteWeb({ runtimeRoot: root, env: { CEDIA_REMOTE_WEB_ROOT: client } }).webRoot).toBe(client);
  expect(() => resolveBundledRemoteWeb({ runtimeRoot: root, env: { CEDIA_REMOTE_WEB_ROOT: "relative/remote-web" } }))
    .toThrow("CEDIA_REMOTE_WEB_ROOT must be an absolute path");
  expect(() => resolveBundledRemoteWeb({ runtimeRoot: root, env: { CEDIA_REMOTE_WEB_ROOT: root } }))
    .toThrow("CEDIA_REMOTE_WEB_ROOT has no index.html");
});

test("tailnet hostnames are read as names, and a URL is refused", () => {
  expect(remoteGatewayHosts(undefined)).toBeUndefined();
  expect(remoteGatewayHosts("  ")).toBeUndefined();
  expect(remoteGatewayHosts("Cedia.tailnet.ts.net, mac.local:8443")).toEqual(["cedia.tailnet.ts.net", "mac.local:8443"]);
  // A scheme or a path would match no forwarded Host, so it is a configuration error, not a value
  // the gateway silently ignores.
  expect(() => remoteGatewayHosts("https://cedia.tailnet.ts.net")).toThrow("CEDIA_REMOTE_HOSTS is not a hostname");
  expect(() => remoteGatewayHosts("cedia.tailnet.ts.net/remote")).toThrow("CEDIA_REMOTE_HOSTS is not a hostname");
  expect(remoteGatewayHosts("cedia.tailnet.ts.net")).toHaveLength(1);
});

test("configured hosts reach the gateway options beside the resolved client", () => {
  const root = runtimeRoot();
  const resolved = resolveBundledRemoteWeb({ runtimeRoot: root, env: { CEDIA_REMOTE_HOSTS: "cedia.tailnet.ts.net" } });
  expect(resolved).toEqual({ webRoot: join(root, "remote-web"), hosts: ["cedia.tailnet.ts.net"] });
});
