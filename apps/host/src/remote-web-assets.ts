/**
 * Locating the packaged remote web client (plan §6.5).
 *
 * The web client is the existing Expo/React Native export from `apps/ios`, copied by the CEDIA
 * build into `runtime/remote-web` beside the bundled host. The gateway only starts when that
 * directory really holds a client, so a build without the export answers `/` with an explicit
 * `web_client_missing` instead of pretending the remote path exists.
 *
 * This module owns only the decision: which directory is the client, and which extra `Host`
 * values Tailscale Serve is expected to send. It reads the filesystem and never starts anything.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface BundledRemoteWeb {
  /** The packaged client, when this build has one. */
  readonly webRoot?: string;
  /** Extra `Host` header values an owner configured for the tailnet name. */
  readonly hosts?: readonly string[];
}

export interface ResolveRemoteWebOptions {
  /** The directory that holds the packaged runtime, i.e. the parent of `host/`. */
  readonly runtimeRoot: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** A directory is a web client only when it has the document the gateway serves at `/`. */
export function isRemoteWebRoot(path: string): boolean {
  try {
    return statSync(join(path, "index.html")).isFile();
  } catch {
    return false;
  }
}

/**
 * Read the owner's extra hostnames.
 *
 * Tailscale Serve terminates the tailnet's HTTPS and forwards to this loopback gateway, so the
 * forwarded `Host` is the tailnet name rather than `127.0.0.1`. The value is a hostname list, not
 * a URL: a scheme, a path or a wildcard is refused here rather than silently never matching.
 */
export function remoteGatewayHosts(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const hosts: string[] = [];
  for (const candidate of value.split(",")) {
    const host = candidate.trim().toLowerCase();
    if (!host) continue;
    if (!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host)) throw new Error(`CEDIA_REMOTE_HOSTS is not a hostname: ${candidate.trim()}`);
    hosts.push(host);
  }
  return hosts.length === 0 ? undefined : hosts;
}

/**
 * Resolve the packaged client and the configured tailnet hostnames.
 *
 * `CEDIA_REMOTE_WEB_ROOT` overrides the packaged location for development; it must be an absolute
 * path, and a directory without `index.html` is reported as absent rather than handed to the
 * gateway as a root that would 404 every deep link.
 */
export function resolveBundledRemoteWeb(options: ResolveRemoteWebOptions): BundledRemoteWeb {
  const env = options.env ?? process.env;
  const configured = env.CEDIA_REMOTE_WEB_ROOT;
  const hosts = remoteGatewayHosts(env.CEDIA_REMOTE_HOSTS);
  if (configured !== undefined && configured.trim() !== "") {
    const candidate = configured.trim();
    if (!isAbsolute(candidate)) throw new Error("CEDIA_REMOTE_WEB_ROOT must be an absolute path");
    const webRoot = resolve(candidate);
    if (!isRemoteWebRoot(webRoot)) throw new Error(`CEDIA_REMOTE_WEB_ROOT has no index.html: ${webRoot}`);
    return { webRoot, ...(hosts === undefined ? {} : { hosts }) };
  }
  const packaged = join(options.runtimeRoot, "remote-web");
  return {
    ...(existsSync(join(packaged, "index.html")) && isRemoteWebRoot(packaged) ? { webRoot: packaged } : {}),
    ...(hosts === undefined ? {} : { hosts }),
  };
}

/** The document the gateway serves at `/`, used by the build and packaged checks. */
export function remoteWebEntryFile(webRoot: string): string {
  return join(webRoot, "index.html");
}

/** Read the packaged document so a check can prove it is the client rather than an empty file. */
export function readRemoteWebEntry(webRoot: string): string {
  return readFileSync(remoteWebEntryFile(webRoot), "utf8");
}
