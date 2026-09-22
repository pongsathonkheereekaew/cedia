import { createServer, type Server } from "node:http";
import { chmodSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { HostDescriptor } from "../../../packages/protocol/src/index.ts";
import { DeviceAuth } from "./auth.ts";
import { CediaHost, type HostOptions } from "./service.ts";
import { DurableStore } from "./store.ts";
import { createRouter, type HostRouter } from "./router.ts";
import { createHostGit, type HostGitService } from "./git.ts";
import { ArtifactStore } from "./artifacts.ts";
import { RemoteConnection } from "./remote.ts";
import { EditorConnections } from "./editors.ts";
import { workspaceJudgeFromEnv } from "./workspace-mode.ts";

/** What a started host hands back: the live objects plus the lifetime hooks.
 *
 * Named rather than inferred so a consumer (the CLI, a smoke script, an
 * integration test) states the contract it depends on instead of a
 * `ReturnType<typeof startHostServer>` spelling of it. */
export interface StartedHostServer {
  readonly host: CediaHost;
  readonly auth: DeviceAuth;
  readonly router: HostRouter;
  readonly descriptor: HostDescriptor;
  readonly editors: EditorConnections;
  stats(): { lastRequestAt: number; runningSessions: number; remotePaired: boolean };
  close(): Promise<void>;
}

export async function startHostServer(options: Omit<HostOptions, "store"> & { port?: number }): Promise<StartedHostServer> {
  const store = DurableStore.open({ stateDir: options.stateDir });
  let server: Server | undefined;
  let host: CediaHost | undefined;
  // Activity record for the lifetime watchdog: the last time any client reached this
  // host. A window that is still open keeps reaching it; a closed app stops.
  let lastRequestAt = Date.now();
  try {
    const auth = new DeviceAuth(options.stateDir);
    const editors = new EditorConnections();
    // The judge comes from an explicit option or the operator's opt-in environment; without
    // either, the host has no judge and the suggestion endpoint answers "no opinion".
    host = new CediaHost({ ...options, store, editors, workspaceJudge: options.workspaceJudge ?? workspaceJudgeFromEnv(process.env) });
    const extras: { artifacts: ArtifactStore; editors: EditorConnections; remote?: RemoteConnection; git: HostGitService } = { artifacts: new ArtifactStore(options.stateDir), editors, git: createHostGit({ store }) };
    const router = createRouter(host, auth, extras);
    const remote = new RemoteConnection(options.stateDir, auth, router);
    extras.remote = remote;
    void remote.restore().catch(() => {});
    server = createServer(async (request, response) => {
      lastRequestAt = Date.now();
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      const reply = (status: number, body: unknown) => { if (!response.destroyed) { response.writeHead(status); response.end(JSON.stringify(body)); } };
      // Native clients do not send Origin. Reject web origins, including localhost,
      // rather than turn the owner's bearer API into a cross-origin browser endpoint.
      if (request.headers.origin) { reply(403, { error: { code: "origin_forbidden", message: "Browser origin is not authorized" } }); return; }
      const address = server!.address();
      const port = typeof address === "object" && address ? address.port : 0;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host ?? "")) {
        reply(403, { error: { code: "host_forbidden", message: "Invalid loopback host" } }); return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) { reply(413, { error: { code: "too_large", message: "Request exceeds 16 MiB" } }); request.resume(); return; }
          chunks.push(Buffer.from(chunk));
        }
        const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.authorization ?? "")?.[1];
        const body = size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
        if (
          (request.method ?? "GET") === "POST"
          && typeof request.url === "string"
          && /\/commands(?:\?|$)/.test(request.url)
          && body && typeof body === "object" && !Array.isArray(body)
          && (body as { command?: unknown }).command === "login"
        ) {
          request.setTimeout(620_000);
          response.setTimeout(620_000);
        }
        const result = await router({ method: request.method ?? "GET", path: request.url ?? "/", token, body });
        reply(result.status, result.body);
      } catch { reply(400, { error: { code: "invalid_request", message: "Invalid JSON request" } }); }
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(options.port ?? 0, "127.0.0.1", () => { server!.off("error", reject); resolve(); }); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback listener did not start");
    const descriptor: HostDescriptor = { protocolVersion: 1, url: `http://127.0.0.1:${address.port}`, token: auth.ownerToken, pid: process.pid };
    const descriptorPath = join(options.stateDir, "host.json");
    const temporary = `${descriptorPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(descriptor), { mode: 0o600 });
    renameSync(temporary, descriptorPath); chmodSync(descriptorPath, 0o600);
    let closing: Promise<void> | undefined;
    return { host, auth, router, descriptor, editors, stats(): { lastRequestAt: number; runningSessions: number; remotePaired: boolean } {
      return {
        lastRequestAt,
        runningSessions: store.listSessions(undefined, { includeArchived: true }).filter(session => session.status === "running").length,
        remotePaired: remote.status().enabled === true,
      };
    }, close(): Promise<void> {
      return closing ??= (async () => {
        server!.closeAllConnections();
        await new Promise<void>(resolve => server!.close(() => resolve()));
        await remote.close();
        await host!.close();
        editors.close();
        try { unlinkSync(descriptorPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        store.close();
      })();
    } };
  } catch (error) {
    server?.close();
    await host?.close().catch(() => {});
    store.close();
    throw error;
  }
}
