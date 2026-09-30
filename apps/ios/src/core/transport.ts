export type TransportMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * The mobile app talks to a host/relay through this narrow seam. The relay
 * worker can inject an encrypted implementation later without changing the
 * screens or their command semantics.
 */
export interface ClientTransport {
  request(method: TransportMethod | string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

export class TransportError extends Error {
  readonly status?: number;
  readonly path: string;
  readonly code?: string;

  constructor(path: string, message: string, status?: number, code?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransportError";
    this.path = path;
    this.status = status;
    this.code = code;
  }
}

export class InvalidTransportUrlError extends Error {
  readonly code = "invalid-transport-url";
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransportUrlError";
  }
}

export interface HttpTransportOptions {
  readonly baseUrl: string;
  readonly token?: string | (() => Promise<string | null>);
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** Development-only escape hatch for http://localhost. */
  readonly allowLocalhostDevelopment?: boolean;
}

export function validateTransportUrl(value: string, allowLocalhostDevelopment = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new InvalidTransportUrlError("Cedia transport URL is invalid");
  }
  if (url.username || url.password || url.search || url.hash) throw new InvalidTransportUrlError("Cedia transport URL must not contain credentials or query state");
  if (url.protocol === "https:") return url;
  const localhost = url.protocol === "http:" && allowLocalhostDevelopment && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (!localhost) throw new InvalidTransportUrlError("Cedia remote transport must use HTTPS; HTTP is allowed only for explicit localhost development");
  return url;
}

function asPath(value: string): string {
  if (!value.startsWith("/")) throw new TypeError("Transport paths must start with /");
  if (value.startsWith("//") || value.includes("\\")) throw new TypeError("Transport path is invalid");
  return value;
}

function tokenValue(token: HttpTransportOptions["token"]): Promise<string | null> {
  if (typeof token === "function") return token();
  return Promise.resolve(token ?? null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Dependency-free HTTPS client for local development and future relay adapters. */
export function createHttpTransport(options: HttpTransportOptions): ClientTransport {
  const base = validateTransportUrl(options.baseUrl, options.allowLocalhostDevelopment === true);
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new RangeError("timeoutMs must be an integer from 1 to 2147483647");
  const fetchImpl = options.fetch ?? fetch;
  return {
    async request(method, relativePath, body) {
      const path = asPath(relativePath);
      const target = new URL(path, base);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const headers = new Headers({ Accept: "application/json" });
      const token = await tokenValue(options.token);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const init: RequestInit = { method, headers, signal: controller.signal };
      if (body !== undefined) {
        headers.set("Content-Type", "application/json");
        init.body = JSON.stringify(body);
      }
      try {
        const response = await fetchImpl(target, init);
        const text = await response.text();
        let parsed: unknown = undefined;
        if (text.trim()) {
          try { parsed = JSON.parse(text) as unknown; } catch (error) {
            throw new TransportError(path, "Cedia transport returned malformed JSON", response.status, undefined, { cause: error });
          }
        }
        if (!response.ok) {
          const errorBody = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
          const message = errorBody && typeof errorBody.message === "string" ? errorBody.message : `Cedia request failed (${response.status})`;
          const code = errorBody && typeof errorBody.code === "string" ? errorBody.code : undefined;
          throw new TransportError(path, message, response.status, code);
        }
        return { status: response.status, body: parsed };
      } catch (error) {
        if (error instanceof TransportError) throw error;
        if (controller.signal.aborted) throw new TransportError(path, `Cedia request timed out after ${timeoutMs}ms`);
        throw new TransportError(path, error instanceof Error ? error.message : String(error), undefined, undefined, { cause: error });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
