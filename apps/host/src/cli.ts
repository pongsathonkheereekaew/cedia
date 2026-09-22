import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli-client.ts";
import { startHostServer, type StartedHostServer } from "./server.ts";
import { isProcessAlive, shouldStopHost } from "./host-lifetime.ts";
import type { HostDescriptor } from "../../../packages/protocol/src/index.ts";

const stateDir = resolve(process.env.CEDIA_STATE_DIR ?? join(homedir(), "Library", "Application Support", "Cedia", "host"));
async function healthy(): Promise<boolean> {
  try {
    const descriptor = JSON.parse(readFileSync(join(stateDir, "host.json"), "utf8")) as HostDescriptor;
    const url = new URL(descriptor.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return false;
    const response = await fetch(`${url.origin}/v1/health`, { headers: { Authorization: `Bearer ${descriptor.token}` }, signal: AbortSignal.timeout(1000) });
    return response.ok && (await response.json() as {protocolVersion?: number}).protocolVersion === 1;
  } catch { return false; }
}
async function main(): Promise<void> {
  const action = process.argv[2] ?? "serve";
  if (action === "status") { process.stdout.write((await healthy() ? "ready" : "offline") + "\n"); return; }
  if (action === "ensure") {
    if (await healthy()) return;
    mkdirSync(stateDir, { recursive: true, mode: 0o700 }); chmodSync(stateDir, 0o700);
    const log = openSync(join(stateDir, "host.log"), "a", 0o600);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], { detached: true, stdio: ["ignore", log, log], env: process.env });
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
  const bundledOmp = resolve(dirname(fileURLToPath(import.meta.url)), "../omp/omp");
  const useBundled = !process.env.CEDIA_OMP_PATH && existsSync(bundledOmp);
  server = await startHostServer({ stateDir, ompExecutable: process.env.CEDIA_OMP_PATH ?? (useBundled ? bundledOmp : undefined),
    virtualUi: process.env.CEDIA_RPC_VIRTUAL_UI === "1" || (useBundled && process.env.CEDIA_RPC_VIRTUAL_UI !== "0"),
    editorBridge: process.env.CEDIA_RPC_EDITOR_BRIDGE === "1" || (useBundled && process.env.CEDIA_RPC_EDITOR_BRIDGE !== "0"),
    nativeBridge: process.env.CEDIA_RPC_NATIVE_BRIDGE === "1" || (useBundled && process.env.CEDIA_RPC_NATIVE_BRIDGE !== "0"),
    onDiagnostic: message => process.stderr.write(`${message}\n`),
    onFatal: () => { fatalDuringStartup = true; if (server) void stop(1); } });
  if (fatalDuringStartup) { await stop(1); return; }
  async function stop(code = 0) { if (stopping) return; stopping = true; try { await server?.close(); process.exitCode = code; } catch { process.exitCode = 1; } }
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
      if (shouldStopHost({ parentPid, parentAlive: isProcessAlive(parentPid), lastRequestAt: stats.lastRequestAt, now: Date.now(), idleMs, runningSessions: stats.runningSessions, remotePaired: stats.remotePaired })) {
        void stop();
      }
    }, 5_000);
    watchdog.unref();
  }
  process.stdout.write("Cedia host ready on authenticated loopback\n");
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Cedia host failed"}\n`); process.exitCode = 1; });
