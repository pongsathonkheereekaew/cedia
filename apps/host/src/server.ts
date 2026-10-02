import { createServer, type Server } from "node:http";
import { chmodSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { HostDescriptor, HostLifecycleSnapshot, HostLifecycleStatus } from "../../../packages/protocol/src/index.ts";
import { DeviceAuth } from "./auth.ts";
import { CediaHost, type HostOptions } from "./service.ts";
import { DurableStore } from "./store.ts";
import { createRouter, type HostRouter } from "./router.ts";
import { createHostGit, type HostGitService } from "./git.ts";
import { ArtifactStore } from "./artifacts.ts";
import { RemoteConnection } from "./remote.ts";
import { EditorConnections } from "./editors.ts";
import { workspaceJudgeFromEnv } from "./workspace-mode.ts";
import { HostLifecycle } from "./lifecycle.ts";
import { SettingsStore } from "./settings.ts";
import { EnrollmentStore } from "./enrollment.ts";
import { startRemoteGateway, type StartedRemoteGateway } from "./remote-gateway.ts";
import { DraftStore } from "./drafts.ts";

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
  readonly lifecycle: HostLifecycle;
  readonly editors: EditorConnections;
  /** The selected remote path's local end, when this host was given a packaged web client. */
  readonly gateway?: { readonly url: string };
  stats(): { lastRequestAt: number; runningSessions: number; remotePaired: boolean; shutdownRequested: boolean };
  close(): Promise<void>;
}

export async function startHostServer(options: Omit<HostOptions, "store"> & {
  port?: number;
  onQuitRequested?: () => void;
  /** The packaged remote web client. Without it the gateway is not started at all. */
  remoteWebRoot?: string;
  /** Extra `Host` values Tailscale Serve sends, e.g. the tailnet name. */
  remoteGatewayHosts?: readonly string[];
  remoteGatewayPort?: number;
}): Promise<StartedHostServer> {
  const store = DurableStore.open({ stateDir: options.stateDir });
  let server: Server | undefined;
  let host: CediaHost | undefined;
  // Activity record for the lifetime watchdog: the last time any client reached this
  // host. A window that is still open keeps reaching it; a closed app stops.
  let lastRequestAt = Date.now();
  try {
    const auth = new DeviceAuth(options.stateDir);
    const lifecycle = new HostLifecycle(options.stateDir, new Date().toISOString(), 1, process.env.CEDIA_APP_GENERATION);
    const editors = new EditorConnections();
    // The judge comes from an explicit option or the operator's opt-in environment; without
    // either, the host has no judge and the suggestion endpoint answers "no opinion".
    host = new CediaHost({ ...options, store, editors, workspaceJudge: options.workspaceJudge ?? workspaceJudgeFromEnv(process.env) });
    let closeHost: () => Promise<void> = async () => {};
    let closing: Promise<void> | undefined;
    let remote: RemoteConnection | undefined;
    let gateway: StartedRemoteGateway | undefined;
    const stats = (): { lastRequestAt: number; runningSessions: number; remotePaired: boolean; shutdownRequested: boolean } => ({
      lastRequestAt,
      runningSessions: store.listSessions(undefined, { includeArchived: true }).filter(session => session.status === "running").length,
      remotePaired: remote?.status().enabled === true,
      shutdownRequested: lifecycle.snapshot().phase !== "ready",
    });
    const lifecycleStatus = (): HostLifecycleStatus => {
      const snapshot = lifecycle.snapshot();
      const current = stats();
      return { ...snapshot, accepting: lifecycle.accepting(), runningSessions: current.runningSessions, remotePaired: current.remotePaired };
    };
    // One identity for the router's extras: the router is built before the remote
    // connection exists, so `remote` is assigned onto this same object afterwards
    // instead of being copied into a snapshot that would always be empty.
    const extras: {
      artifacts: ArtifactStore;
      editors: EditorConnections;
      remote?: RemoteConnection;
      git: HostGitService;
      ompCapabilities: (expectedRevision?: string) => Promise<import("../../../packages/protocol/src/index.ts").HostOmpCapabilitySnapshot>;
      ompSettingsKeys: () => Promise<import("../../../packages/protocol/src/index.ts").HostOmpSettingsAnswer<import("../../../packages/protocol/src/index.ts").OmpSettingsKeysSnapshot>>;
      ompSettingsValue: (path: string) => Promise<import("../../../packages/protocol/src/index.ts").HostOmpSettingsAnswer<import("../../../packages/protocol/src/index.ts").OmpSettingsValue>>;
      ompSettingsWrite: (request: { path: string; value: unknown; expectedRevision?: string }) => Promise<import("../../../packages/protocol/src/index.ts").HostOmpSettingsAnswer<import("../../../packages/protocol/src/index.ts").OmpSettingsValue>>;
      ompSettingsValueIn: (path: string, context: import("../../../packages/protocol/src/index.ts").OmpSettingsContext) => Promise<import("../../../packages/protocol/src/index.ts").HostOmpSettingsAnswer<import("../../../packages/protocol/src/index.ts").OmpSettingsValue>>;
      ompSettingsMutate: (mutation: import("../../../packages/protocol/src/index.ts").OmpSettingsMutation) => Promise<{ values: readonly import("../../../packages/protocol/src/index.ts").OmpSettingsValue[]; scope: "global" | "project" }>;
      ompSettingsResetPreview: (paths: string[]) => Promise<{ path: string; globalConfigured: boolean; current: import("../../../packages/protocol/src/index.ts").OmpSettingsValue }[]>;
      /** Cedia's product-policy layer as the live runtime reports it (plan §2.8). */
      ompPolicy: () => Promise<import("../../../packages/protocol/src/index.ts").HostOmpSettingsAnswer<import("./omp-policy.ts").OmpCreditPolicy>>;
      lifecycle: {
        snapshot(): HostLifecycleSnapshot;
        identity(): unknown;
        adopt(input: unknown, stateDir: string, protocolVersion: number): HostLifecycleSnapshot;
        assertAccepting(): void;
        status(): HostLifecycleStatus;
        requestQuit(): HostLifecycleSnapshot;
        resume(): HostLifecycleSnapshot;
      };
      settings: SettingsStore;
      drafts: DraftStore;
      stateDir: string;
      gateway?: () => { readonly url: string } | undefined;
      /** Issue one short-lived enrollment code into the gateway's own store (§6.5). */
      issueRemoteEnrollment?: (name: string) => { readonly code: string; readonly pin: string; readonly expiresAt: string };
    } = {
      artifacts: new ArtifactStore(options.stateDir),
      editors,
      git: createHostGit({ store }),
      ompCapabilities: (expectedRevision?: string) => host!.ompCapabilitySnapshot(expectedRevision),
      ompSettingsKeys: () => host!.ompSettingsKeys(),
      ompSettingsValue: (path: string) => host!.ompSettingsValue(path),
      ompSettingsWrite: (request: { path: string; value: unknown; expectedRevision?: string }) => host!.ompSettingsWrite(request),
      ompSettingsValueIn: (path, context) => host!.ompSettingsValueIn(path, context),
      ompSettingsMutate: mutation => host!.ompSettingsMutate(mutation),
      ompSettingsResetPreview: paths => host!.ompSettingsResetPreview(paths),
      ompPolicy: () => host!.ompPolicy(),
      lifecycle: {
        snapshot: () => lifecycle.snapshot(),
        identity: () => lifecycle.identity(),
        adopt: (input, stateDir, protocolVersion) => lifecycle.adopt(input, stateDir, protocolVersion),
        assertAccepting: () => lifecycle.assertAccepting(),
        status: lifecycleStatus,
        requestQuit: () => lifecycle.requestQuit(),
        resume: () => lifecycle.resume(),
      },
      settings: new SettingsStore(options.stateDir),
      drafts: new DraftStore(store),
      stateDir: options.stateDir,
    };
    const router = createRouter(host, auth, extras);
    remote = new RemoteConnection(options.stateDir, auth, router);
    extras.remote = remote;
    // §6.5: the Paseo relay is not the selected transport and must not come up by itself. It starts
    // only from an explicit owner action (`POST /v1/remote/pair`); a recorded identity is kept, not
    // reconnected, so nothing silently falls back to an endpoint the owner did not choose.
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
        let path = "";
        try { path = new URL(request.url ?? "/", "http://cedia.local").pathname; } catch { /* router already returned the request error */ }
        if ((request.method ?? "GET") === "POST" && path === "/v1/lifecycle/quit" && result.status === 200) {
          setImmediate(() => options.onQuitRequested?.());
        }
      } catch { reply(400, { error: { code: "invalid_request", message: "Invalid JSON request" } }); }
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(options.port ?? 0, "127.0.0.1", () => { server!.off("error", reject); resolve(); }); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback listener did not start");
    if (options.remoteWebRoot !== undefined) {
      // One store for the gateway and the owner route that issues a code into it, so a code the
      // owner reads out is exactly the code the gateway can redeem.
      const enrollment = new EnrollmentStore(options.stateDir);
      gateway = await startRemoteGateway({
        auth,
        enrollment,
        router,
        webRoot: options.remoteWebRoot,
        ...(options.remoteGatewayHosts === undefined ? {} : { extraHosts: options.remoteGatewayHosts }),
        ...(options.remoteGatewayPort === undefined ? {} : { port: options.remoteGatewayPort }),
      });
      // The capability row reports the selected remote path from the process that actually
      // started it, so a build with no packaged client says so instead of claiming availability.
      extras.gateway = () => (gateway === undefined ? undefined : { url: gateway.url });
      extras.issueRemoteEnrollment = name => enrollment.issue(name);
    }
    const descriptor: HostDescriptor = { protocolVersion: 1, url: `http://127.0.0.1:${address.port}`, token: auth.ownerToken, pid: process.pid,
      processStartedAt: lifecycle.snapshot().processStartedAt, appGeneration: process.env.CEDIA_APP_GENERATION };
    const descriptorPath = join(options.stateDir, "host.json");
    const temporary = `${descriptorPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(descriptor), { mode: 0o600 });
    renameSync(temporary, descriptorPath); chmodSync(descriptorPath, 0o600);
    closeHost = () => {
      if (closing) return closing;
      closing = (async () => {
        server!.closeAllConnections();
        await new Promise<void>(resolve => server!.close(() => resolve()));
        await gateway?.close();
        await remote?.close();
        await host!.close();
        editors.close();
        try { unlinkSync(descriptorPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        lifecycle.completeQuit();
        store.close();
      })();
      return closing;
    };
    return {
      host,
      auth,
      router,
      descriptor,
      lifecycle,
      editors,
      stats,
      ...(gateway === undefined ? {} : { gateway: { url: gateway.url } }),
      close(): Promise<void> { return closeHost(); },
    };
  } catch (error) {
    server?.close();
    await host?.close().catch(() => {});
    store.close();
    throw error;
  }
}
