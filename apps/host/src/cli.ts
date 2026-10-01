import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join, dirname, delimiter } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runCli } from "./cli-client.ts";
import { startHostServer, type StartedHostServer } from "./server.ts";
import { isProcessAlive, shouldStopHost } from "./host-lifetime.ts";
import { resolveBundledRemoteWeb } from "./remote-web-assets.ts";
import type { HostDescriptor } from "../../../packages/protocol/src/index.ts";

/**
 * Operator-only extra `--trusted-extension` paths for runtimes this host starts
 * (O06 packaged-reload path). Delimiter-separated absolute paths; blank entries
 * are ignored and validation (absolute, existing file) happens in CediaHost.
 */
export function extraTrustedExtensionsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CEDIA_EXTRA_TRUSTED_EXTENSIONS ?? "").split(delimiter).map(entry => entry.trim()).filter(entry => entry.length > 0);
}

const stateDir = resolve(process.env.CEDIA_STATE_DIR ?? join(homedir(), "Library", "Application Support", "Cedia", "host"));
async function healthy(): Promise<boolean> {
  try {
    const descriptor = JSON.parse(readFileSync(join(stateDir, "host.json"), "utf8")) as HostDescriptor;
    const url = new URL(descriptor.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return false;
    const headers = { Authorization: `Bearer ${descriptor.token}` };
    const response = await fetch(`${url.origin}/v1/health`, { headers, signal: AbortSignal.timeout(1000) });
    const health = await response.json() as {protocolVersion?: number; lifecycle?: {phase?: string}; identity?: {stateDir?: string; protocolVersion?: number; processStartedAt?: string; generation?: string; appGeneration?: string}};
    if (!(response.ok && health.protocolVersion === 1 && health.lifecycle?.phase === "ready" && descriptor.pid > 0
      && descriptor.processStartedAt === health.identity?.processStartedAt
      && descriptor.appGeneration === health.identity?.appGeneration
      && health.identity?.stateDir === stateDir && health.identity?.protocolVersion === descriptor.protocolVersion
      && typeof health.identity?.generation === "string")) return false;
    const lifecycleResponse = await fetch(`${url.origin}/v1/lifecycle`, { headers, signal: AbortSignal.timeout(1000) });
    const lifecycle = await lifecycleResponse.json() as { phase?: string; accepting?: boolean };
    return lifecycleResponse.ok && lifecycle.phase === "ready" && lifecycle.accepting === true;
  } catch { return false; }
}
async function adoptExisting(): Promise<boolean> {
  try {
    const descriptor = JSON.parse(readFileSync(join(stateDir, "host.json"), "utf8")) as HostDescriptor;
    const response = await fetch(`${descriptor.url}/v1/health`, { headers: { Authorization: `Bearer ${descriptor.token}` }, signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const health = await response.json() as { protocolVersion?: number; identity?: { generation?: string; processStartedAt?: string; stateDir?: string; protocolVersion?: number; appGeneration?: string } };
    if (health.protocolVersion !== descriptor.protocolVersion || health.identity?.stateDir !== stateDir
      || health.identity.protocolVersion !== descriptor.protocolVersion || health.identity.processStartedAt !== descriptor.processStartedAt
      || health.identity.appGeneration !== descriptor.appGeneration || typeof health.identity.generation !== "string") return false;
    const appGeneration = process.env.CEDIA_APP_GENERATION;
    if (!appGeneration || appGeneration === health.identity.appGeneration) return false;
    const adopted = await fetch(`${descriptor.url}/v1/lifecycle/adopt`, { method: "POST", headers: { Authorization: `Bearer ${descriptor.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...health.identity, stateDir, protocolVersion: descriptor.protocolVersion, appGeneration }), signal: AbortSignal.timeout(1000) });
    return adopted.ok;
  } catch { return false; }
}
async function main(): Promise<void> {
  const action = process.argv[2] ?? "serve";
  if (action === "status") { process.stdout.write((await healthy() ? "ready" : "offline") + "\n"); return; }
  if (action === "ensure") {
    if (await healthy() && await adoptExisting()) return;
    mkdirSync(stateDir, { recursive: true, mode: 0o700 }); chmodSync(stateDir, 0o700);
    const log = openSync(join(stateDir, "host.log"), "a", 0o600);
    const appGeneration = process.env.CEDIA_APP_GENERATION ?? randomUUID();
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], { detached: true, stdio: ["ignore", log, log], env: { ...process.env, CEDIA_APP_GENERATION: appGeneration } });
    let spawnFailure: Error | undefined;
    child.once("error", error => { spawnFailure = error; });
    child.unref(); closeSync(log);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnFailure) throw spawnFailure;
      if (await healthy()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Cedia host did not become ready; inspect the private host log");
  }
  if (action !== "serve") { process.exitCode = await runCli(process.argv.slice(2)); return; }
  let fatalDuringStartup = false;
  let stopping = false;
  let server: StartedHostServer | undefined;
  async function stop(code = 0) { if (stopping) return; stopping = true; try { await server?.close(); process.exitCode = code; } catch { process.exitCode = 1; } }
  const bundledOmp = resolve(dirname(fileURLToPath(import.meta.url)), "../omp/omp");
  const useBundled = !process.env.CEDIA_OMP_PATH && existsSync(bundledOmp);
  // The packaged web client is the same runtime tree's sibling of `host/` (§6.5). Without it the
  // gateway is not started at all, which is the honest state for a build that carries no export.
  const remoteWeb = resolveBundledRemoteWeb({ runtimeRoot: resolve(dirname(fileURLToPath(import.meta.url)), "..") });
  server = await startHostServer({ stateDir, ompExecutable: process.env.CEDIA_OMP_PATH ?? (useBundled ? bundledOmp : undefined),
    extraTrustedExtensions: extraTrustedExtensionsFromEnv(process.env),
    virtualUi: process.env.CEDIA_RPC_VIRTUAL_UI === "1" || (useBundled && process.env.CEDIA_RPC_VIRTUAL_UI !== "0"),
    ownerBridge: process.env.CEDIA_RPC_OWNER_BRIDGE === "1" || (useBundled && process.env.CEDIA_RPC_OWNER_BRIDGE !== "0"),
    editorBridge: process.env.CEDIA_RPC_EDITOR_BRIDGE === "1" || (useBundled && process.env.CEDIA_RPC_EDITOR_BRIDGE !== "0"),
    nativeBridge: process.env.CEDIA_RPC_NATIVE_BRIDGE === "1" || (useBundled && process.env.CEDIA_RPC_NATIVE_BRIDGE !== "0"),
    ...(remoteWeb.webRoot === undefined ? {} : { remoteWebRoot: remoteWeb.webRoot }),
    ...(remoteWeb.hosts === undefined ? {} : { remoteGatewayHosts: remoteWeb.hosts }),
    onDiagnostic: message => process.stderr.write(`${message}\n`),
    onFatal: () => { fatalDuringStartup = true; if (server) void stop(1); },
    onQuitRequested: () => void stop() });
  if (fatalDuringStartup) { await stop(1); return; }
  if (server.gateway !== undefined) process.stderr.write(`Cedia remote gateway on ${server.gateway.url}; point Tailscale Serve at it to reach this Mac from the tailnet\n`);
  process.once("SIGTERM", () => void stop()); process.once("SIGINT", () => void stop());
  // A host the app started stops when that app is gone and nothing needs it any more.
  // Without this the detached `serve` process outlived every run (PPID 1) and the app
  // looked like it was still open.
  const parentPid = Number(process.env.CEDIA_PARENT_PID ?? "") || undefined;
  const idleMs = Number(process.env.CEDIA_HOST_IDLE_MS ?? "") || 60_000;
  if (parentPid !== undefined) {
    const watchdog = setInterval(() => {
      const stats = server?.stats();
      if (!stats) return;
      if (!stats.remotePaired && !stats.runningSessions && (stats.shutdownRequested || shouldStopHost({ parentPid, parentAlive: isProcessAlive(parentPid), lastRequestAt: stats.lastRequestAt, now: Date.now(), idleMs, runningSessions: stats.runningSessions, remotePaired: stats.remotePaired }))) {
        void stop();
      }
    }, 5_000);
    watchdog.unref();
  }
  process.stdout.write("Cedia host ready on authenticated loopback\n");
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Cedia host failed"}\n`); process.exitCode = 1; });
