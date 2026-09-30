/**
 * The selected remote path's local end (plan §6.5): a loopback-only gateway that serves the
 * packaged web client and proxies `/v1/*` for one paired controller.
 *
 * Tailscale Serve terminates the tailnet's HTTPS and forwards here, so this process never owns
 * TLS, never listens beyond loopback, and never hands out the owner credential. A browser session
 * *is* a controller device credential, stored in an HttpOnly cookie; every proxied request is
 * authorized by that device through the ordinary router, so an owner-only route stays owner-only
 * over the gateway and a revoked device stops working immediately.
 *
 * Memory-only: there is no session table to lose, because the cookie carries the device token the
 * router already validates.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import type { Device, DeviceAuth } from "./auth.ts";
import type { EnrollmentStore } from "./enrollment.ts";
import type { HostRequest, HostRouter } from "./router.ts";

export interface RemoteGatewayOptions {
  readonly auth: DeviceAuth;
  readonly enrollment: EnrollmentStore;
  readonly router: HostRouter;
  /** Where the packaged web client lives. Absent means the API works and `/` explains why it cannot. */
  readonly webRoot?: string;
  /** Extra `Host` values Tailscale Serve sends, e.g. `cedia.example-tailnet.ts.net`. */
  readonly extraHosts?: readonly string[];
  readonly port?: number;
}

export interface StartedRemoteGateway {
  readonly url: string;
  close(): Promise<void>;
}

const COOKIE_SESSION = "cedia_session";
const COOKIE_CSRF = "cedia_csrf";
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** A gateway principal is a paired controller; the Mac's own owner device is never one (§6.5). */
function controllerOnly(device: Device | undefined): Device | undefined {
  return device?.role === "controller" ? device : undefined;
}

function cookies(request: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return jar;
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  if (response.destroyed) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  response.end(JSON.stringify(body));
}

const error = (response: ServerResponse, status: number, code: string, message: string) => json(response, status, { error: { code, message } });

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("too_large");
    chunks.push(Buffer.from(chunk as Buffer));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return undefined;
  try { return JSON.parse(text) as unknown; } catch { throw new Error("invalid_json"); }
}

export async function startRemoteGateway(options: RemoteGatewayOptions): Promise<StartedRemoteGateway> {
  const webRoot = options.webRoot === undefined ? undefined : resolve(options.webRoot);
  let realWebRoot: string | undefined;
  if (webRoot !== undefined) {
    try { realWebRoot = realpathSync(webRoot); } catch { realWebRoot = undefined; }
  }
  const servedAssets = new Set<string>();
  const server: Server = createServer(async (request, response) => {
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const host = (request.headers.host ?? "").toLowerCase();
      // Loopback plus whatever the owner configured for the tailnet name. A request that arrives
      // with any other Host is not from the selected transport.
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...(options.extraHosts ?? []).map(value => value.toLowerCase())]);
      if (!allowedHosts.has(host)) { error(response, 403, "host_forbidden", "Host is not one of this gateway's names"); return; }
      const origin = request.headers.origin;
      if (origin !== undefined) {
        const allowedOrigins = new Set([...allowedHosts].flatMap(value => [`https://${value}`, ...(value.startsWith("127.0.0.1") || value.startsWith("localhost") ? [`http://${value}`] : [])]));
        if (!allowedOrigins.has(origin.toLowerCase())) { error(response, 403, "origin_forbidden", "Origin is not authorized for this gateway"); return; }
      }
      const url = new URL(request.url ?? "/", `http://${host}`);
      const path = url.pathname;
      const method = (request.method ?? "GET").toUpperCase();

      if (path === "/gateway/enroll") {
        if (method !== "POST") { error(response, 405, "method_not_allowed", "Enrollment is a POST"); return; }
        const body = await readBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) { error(response, 400, "invalid_body", "Enrollment needs a JSON object"); return; }
        const { code, name, client } = body as { code?: unknown; name?: unknown; client?: unknown };
        if (typeof code !== "string") { error(response, 400, "invalid_body", "Enrollment needs the code from the owner"); return; }
        if (client !== undefined && client !== "native") { error(response, 400, "invalid_body", "Enrollment client is either absent (a browser) or \"native\""); return; }
        // A native client has no cookie jar, so it is answered the controller token directly. That
        // answer must never reach a web page: a browser always sends `Origin` on a POST, including
        // a same-origin one, so a request that carries it is refused here rather than trusted to
        // an HttpOnly cookie it cannot use.
        if (client === "native" && request.headers.origin !== undefined) {
          error(response, 403, "origin_forbidden", "A browser cannot ask for the native enrollment answer");
          return;
        }
        const label = typeof name === "string" && name.trim() ? name : "Paired device";
        const claimed = options.enrollment.claim(code);
        if (!claimed.ok) {
          const status = claimed.reason === "expired" ? 410 : claimed.reason === "already_redeemed" ? 409 : 401;
          error(response, status, `enrollment_${claimed.reason}`, claimed.reason === "unknown" ? "That enrollment code is not valid" : claimed.reason === "expired" ? "That enrollment code has expired; ask the Mac for a new one" : "That enrollment code was already used");
          return;
        }
        const issued = options.auth.issue(label);
        options.enrollment.bindDevice(claimed.record.id, issued.device.id);
        const csrf = randomBytes(24).toString("base64url");
        if (client === "native") {
          // No cookies and no CSRF for this answer: the token is the credential, and the Bearer
          // path below is what a native client uses.
          json(response, 200, { device: issued.device, token: issued.token });
          return;
        }
        // The session cookie carries the controller's own credential: the gateway authorizes each
        // proxied request with it and never with the owner token it can read from the state file.
        json(response, 200, { device: issued.device, csrf }, {
          // Two cookies need two headers: a single Set-Cookie joined by commas is one malformed
          // cookie, which is how the CSRF cookie would silently never arrive.
          "Set-Cookie": [
            `${COOKIE_SESSION}=${issued.token}; HttpOnly; SameSite=Strict; Path=/`,
            `${COOKIE_CSRF}=${csrf}; SameSite=Strict; Path=/`,
          ] as unknown as string,
        });
        return;
      }

      const jar = cookies(request);
      const token = jar.get(COOKIE_SESSION);
      // Two principals reach this gateway: a browser, which carries its controller token in an
      // HttpOnly cookie and therefore needs CSRF on mutations, and a native client, which carries
      // the same token as a Bearer credential. A browser cannot set that header cross-origin
      // without a preflight this gateway's Origin check refuses, so a valid Bearer token is
      // treated as its own proof rather than as a cookie session.
      const authorization = request.headers.authorization;
      const bearer = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : undefined;
      // Only a paired controller is a gateway principal. The Mac's own owner credential is not a
      // remote credential at all (§6.5), so it is refused here whether it arrives as a cookie or
      // as a Bearer token, and the loopback owner API keeps its separate authorization.
      const bearerDevice = controllerOnly(bearer ? options.auth.authenticate(bearer) : undefined);
      const device = bearerDevice ?? controllerOnly(options.auth.authenticate(token));
      // The credential the router will check is the one that actually authenticated: a browser's
      // cookie, or the Bearer token a native client sent in its place.
      const credential = bearerDevice === undefined ? token : bearer;

      if (path === "/gateway/session") {
        if (method !== "GET") { error(response, 405, "method_not_allowed", "Session state is a GET"); return; }
        json(response, 200, device ? { authenticated: true, device: { id: device.id, name: device.name, role: device.role }, csrf: jar.get(COOKIE_CSRF) ?? null } : { authenticated: false });
        return;
      }
      if (path === "/gateway/logout") {
        if (method !== "POST") { error(response, 405, "method_not_allowed", "Logout is a POST"); return; }
        // Ending the browser session is not revoking the device: the owner does that from the Mac.
        json(response, 200, { ended: true }, {
          "Set-Cookie": [
            `${COOKIE_SESSION}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
            `${COOKIE_CSRF}=; SameSite=Strict; Path=/; Max-Age=0`,
          ] as unknown as string,
        });
        return;
      }

      if (path === "/v1" || path.startsWith("/v1/")) {
        // The API namespace never answers HTML, and an unknown path stays a structured error.
        if (!device) { error(response, 401, "unauthorized", "Pair this browser before calling the host API"); return; }
        // CSRF exists because a cookie is sent automatically by the browser. A request that proved
        // itself with a Bearer credential has no such ambient authority, so it needs no token.
        if (bearerDevice === undefined && method !== "GET" && method !== "HEAD") {
          const header = request.headers["x-cedia-csrf"];
          const cookie = jar.get(COOKIE_CSRF);
          if (typeof header !== "string" || !cookie || header !== cookie) { error(response, 403, "csrf_required", "This request needs the session's CSRF token"); return; }
        }
        let body: unknown;
        try { body = await readBody(request); }
        catch (failure) {
          const message = failure instanceof Error ? failure.message : "invalid_json";
          error(response, message === "too_large" ? 413 : 400, message === "too_large" ? "too_large" : "invalid_json", message === "too_large" ? "Request exceeds 16 MiB" : "Invalid JSON request");
          return;
        }
        const proxied: HostRequest = { method, path: `${path}${url.search}`, token: credential, ...(body === undefined ? {} : { body }) };
        const answer = await options.router(proxied);
        json(response, answer.status, answer.body);
        return;
      }

      if (method !== "GET" && method !== "HEAD") { error(response, 405, "method_not_allowed", "Only the API accepts state-changing requests"); return; }

      if (realWebRoot === undefined) {
        error(response, 404, "web_client_missing", "This build has no packaged remote web client; the API is available at /v1");
        return;
      }
      const relative = decodeURIComponent(path).replace(/^\/+/, "");
      const candidate = normalize(join(realWebRoot, relative));
      const insideRoot = candidate === realWebRoot || candidate.startsWith(`${realWebRoot}${sep}`);
      if (insideRoot && relative.length > 0 && statIsFile(candidate)) {
        const extension = extname(candidate).toLowerCase();
        if (!CONTENT_TYPES[extension]) { error(response, 404, "asset_unknown_type", "This gateway serves only known web asset types"); return; }
        servedAssets.add(candidate);
        const bytes = readFileSync(candidate);
        response.writeHead(200, { "Content-Type": CONTENT_TYPES[extension]!, "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300", "X-Content-Type-Options": "nosniff" });
        response.end(bytes);
        return;
      }
      if (extname(relative).length > 0) { error(response, 404, "asset_missing", "No such asset in this build"); return; }
      // A client-side route: a deep link must still load the one packaged document.
      const index = join(realWebRoot, "index.html");
      if (!statIsFile(index)) { error(response, 404, "web_client_missing", "The packaged web client has no index.html"); return; }
      servedAssets.add(index);
      response.writeHead(200, { "Content-Type": CONTENT_TYPES[".html"]!, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(readFileSync(index));
    } catch {
      if (!response.headersSent) error(response, 500, "gateway_failure", "The gateway could not complete this request");
      else response.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve_, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => { server.off("error", reject); resolve_(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Remote gateway did not start");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve_ => server.close(() => resolve_())); },
  };
}

function statIsFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}
