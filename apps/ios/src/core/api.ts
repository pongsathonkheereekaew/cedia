import type {
  Command,
  CommandRequest,
  EventPage,
  Json,
  Project,
  Session,
  TerminalCheckpoint,
  UiResponseRequest,
} from "../../../../packages/protocol/src/index.ts";
import { isRecord, nonEmptyString, type LoginProviderOption, type ModelOption, type PendingUiRequest } from "./types.ts";
import type { ArtifactChunk, ArtifactReceipt } from "../../../../packages/protocol/src/artifacts.ts";
import { parseArtifactChunk, parseArtifactReceipt } from "./artifacts.ts";
import { parseHostReview, type HostReviewPayload } from "./review-sheet.ts";
import { TransportError, type ClientTransport, type TransportMethod } from "./transport.ts";

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function query(path: string, values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value));
  return params.size > 0 ? `${path}?${params.toString()}` : path;
}

function objectBody<T>(body: unknown, description: string): T {
  if (!isRecord(body)) throw new Error(`Cedia host returned an invalid ${description}`);
  return body as T;
}

function arrayBody<T>(body: unknown, description: string): T[] {
  if (!Array.isArray(body)) throw new Error(`Cedia host returned an invalid ${description}`);
  return body as T[];
}

export interface CediaApiOptions {
  readonly transport: ClientTransport;
  /** Optional SHA-256 seam for pure tests; native builds use Web Crypto/Expo. */
  readonly digestSha256?: (text: string) => Promise<string>;
}

interface FrameReference {
  readonly type: "cedia_frame_reference";
  readonly sequence: number;
  readonly length: number;
  readonly sha256: string;
}

interface ResponseReference {
  readonly sha256: string;
  readonly length: number;
}

const MAX_FRAME_TEXT_CHARS = 64 * 1024 * 1024;
const MAX_FRAME_CHUNK_CHARS = 24_000;

function frameReference(value: unknown): value is FrameReference {
  if (!isRecord(value)) return false;
  const length = value.length;
  const sha256 = value.sha256;
  if (value.type !== "cedia_frame_reference" || !Number.isSafeInteger(value.sequence) || !Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > MAX_FRAME_TEXT_CHARS || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(sha256)) return false;
  return true;
}

function responseReference(value: unknown): value is ResponseReference {
  if (!isRecord(value)) return false;
  const length = value.length;
  const sha256 = value.sha256;
  return Object.keys(value).length === 2
    && Number.isSafeInteger(length)
    && (length as number) >= 0
    && (length as number) <= MAX_FRAME_TEXT_CHARS
    && typeof sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(sha256);
}

function hexDigest(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function defaultDigestSha256(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return hexDigest(await subtle.digest("SHA-256", new TextEncoder().encode(text)));
  // Expo's native implementation is loaded only when a large frame needs it,
  // keeping the pure reducer/API tests independent of React Native modules.
  const expoCrypto = await import("expo-crypto");
  return expoCrypto.digestStringAsync(expoCrypto.CryptoDigestAlgorithm.SHA256, text, { encoding: expoCrypto.CryptoEncoding.HEX });
}

/** A non-2xx answer from the host, keeping its machine code and human message intact. */
export class CediaHostError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CediaHostError";
    this.status = status;
    this.code = code;
  }
}

function hostError(status: number, body: unknown): CediaHostError {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message } = body.error;
    if (nonEmptyString(code) && nonEmptyString(message)) return new CediaHostError(status, code, message);
  }
  return new CediaHostError(status, "request_failed", `Cedia host request failed (${status})`);
}

/** Typed projection of the host API. It never starts OMP or a provider itself. */
export class CediaApi {
  readonly #transport: ClientTransport;
  readonly #digestSha256: (text: string) => Promise<string>;

  constructor(options: CediaApiOptions) {
    this.#transport = options.transport;
    this.#digestSha256 = options.digestSha256 ?? defaultDigestSha256;
  }

  async request<T>(method: TransportMethod | string, path: string, body?: unknown): Promise<T> {
    let result: { status: number; body: unknown };
    try {
      result = await this.#transport.request(method, path, body);
    } catch (error) {
      // HTTP transports may reject before returning a response so that their
      // auth mode can carry a typed session/CSRF state. Keep the API surface's
      // existing host error contract while preserving the machine code.
      if (error instanceof TransportError && error.status !== undefined) {
        throw new CediaHostError(error.status, error.code ?? "request_failed", error.message);
      }
      throw error;
    }
    if (result.status < 200 || result.status >= 300) throw hostError(result.status, result.body);
    return await this.#hydrateResponseBody(path, result.body) as T;
  }

  async #hydrateResponseBody(path: string, body: unknown): Promise<unknown> {
    if (!isRecord(body) || !responseReference(body.cediaResponseReference)) return body;
    return this.#readResponseText(body.cediaResponseReference, path);
  }

  async #readResponseText(reference: ResponseReference, sourcePath: string): Promise<Json> {
    let offset = 0;
    let text = "";
    while (offset < reference.length) {
      const result = await this.#transport.request("GET", query(`/v1/responses/${encodeURIComponent(reference.sha256)}`, { offset }));
      if (result.status < 200 || result.status >= 300) throw hostError(result.status, result.body);
      const body = objectBody<Record<string, unknown>>(result.body, "response chunk");
      const chunkHash = body.sha256;
      const chunkLength = body.length;
      const chunkOffset = body.offset;
      const chunk = body.text;
      if (typeof chunkHash !== "string" || chunkHash.toLowerCase() !== reference.sha256.toLowerCase() || chunkLength !== reference.length || chunkOffset !== offset || typeof chunk !== "string") {
        throw new Error(`Cedia response reference for ${sourcePath} is invalid`);
      }
      if (chunk.length === 0 || chunk.length > MAX_FRAME_CHUNK_CHARS || offset + chunk.length > reference.length) {
        throw new Error(`Cedia response reference for ${sourcePath} has an invalid chunk length`);
      }
      text += chunk;
      offset += chunk.length;
      if (text.length > MAX_FRAME_TEXT_CHARS) throw new Error("Cedia response exceeds the mobile size limit");
    }
    if (text.length !== reference.length) throw new Error(`Cedia response reference for ${sourcePath} is truncated`);
    const digest = (await this.#digestSha256(text)).toLowerCase();
    if (digest !== reference.sha256.toLowerCase()) throw new Error(`Cedia response reference for ${sourcePath} failed integrity verification`);
    try {
      return JSON.parse(text) as Json;
    } catch (error) {
      throw new Error(`Cedia response reference for ${sourcePath} is malformed`, { cause: error });
    }
  }

  listProjects(): Promise<Project[]> {
    return this.request<unknown>("GET", "/v1/projects").then(body => arrayBody<Project>(body, "projects"));
  }

  createProject(path: string, name?: string): Promise<Project> {
    if (!path.trim()) throw new TypeError("project path is required");
    return this.request<unknown>("POST", "/v1/projects", { path, ...(name?.trim() ? { name: name.trim() } : {}) }).then(body => objectBody<Project>(body, "project"));
  }

  patchProject(projectId: string, patch: { readonly name?: string; readonly archived?: boolean; readonly pinned?: boolean }): Promise<Project> {
    if (!Object.keys(patch).length) throw new TypeError("project patch must contain a field");
    return this.request<unknown>("PATCH", `/v1/projects/${encoded(projectId)}`, patch as Record<string, Json>).then(body => objectBody<Project>(body, "project"));
  }

  patchSession(sessionId: string, patch: { readonly title?: string; readonly archived?: boolean; readonly pinned?: boolean }): Promise<Session> {
    if (!Object.keys(patch).length) throw new TypeError("session patch must contain a field");
    return this.request<unknown>("PATCH", `/v1/sessions/${encoded(sessionId)}`, patch as Record<string, Json>).then(body => objectBody<Session>(body, "session"));
  }

  listSessions(projectId?: string): Promise<Session[]> {
    return this.request<unknown>("GET", query("/v1/sessions", { projectId })).then(body => arrayBody<Session>(body, "sessions"));
  }

  createSession(input: { readonly projectId: string; readonly title?: string }): Promise<Session> {
    if (!input.projectId.trim()) throw new TypeError("projectId is required");
    return this.request<unknown>("POST", "/v1/sessions", { projectId: input.projectId, ...(input.title?.trim() ? { title: input.title.trim() } : {}) }).then(body => objectBody<Session>(body, "session"));
  }

  startSession(sessionId: string): Promise<Session> {
    return this.request<unknown>("POST", `/v1/sessions/${encoded(sessionId)}/start`).then(body => objectBody<Session>(body, "session"));
  }

  getSession(sessionId: string): Promise<Session> {
    return this.request<unknown>("GET", `/v1/sessions/${encoded(sessionId)}`).then(body => objectBody<Session>(body, "session"));
  }

  getReview(sessionId: string): Promise<HostReviewPayload> {
    return this.request<unknown>("GET", `/v1/sessions/${encoded(sessionId)}/review`).then(body => parseHostReview(body));
  }

  /**
   * The host's headless screen per virtual terminal.
   *
   * Used when the app's bounded chunk history was trimmed: rendering this paints the
   * real screen instead of asking OMP to redraw. An empty list is an honest answer
   * (virtual UI off, session not running, or a host without the terminal engine).
   */
  getTerminalCheckpoints(sessionId: string): Promise<TerminalCheckpoint[]> {
    return this.request<unknown>("GET", `/v1/sessions/${encoded(sessionId)}/terminals`)
      .then(body => arrayBody<TerminalCheckpoint>(body, "terminals"));
  }

  getEvents(sessionId: string, after = 0, limit = 200): Promise<EventPage> {
    if (!Number.isSafeInteger(after) || after < 0) throw new RangeError("after must be a non-negative integer");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError("limit must be between 1 and 1000");
    return this.request<unknown>("GET", query(`/v1/sessions/${encoded(sessionId)}/events`, { after, limit }))
      .then(body => objectBody<EventPage>(body, "event page"))
      .then(page => this.#hydrateEventPage(sessionId, page));
  }

  async #hydrateEventPage(sessionId: string, page: EventPage): Promise<EventPage> {
    const events = [] as EventPage["events"];
    for (const event of page.events) {
      if (!frameReference(event.frame)) {
        events.push(event);
        continue;
      }
      const text = await this.#readFrameText(sessionId, event.sequence, event.frame);
      let frame: Json;
      try {
        frame = JSON.parse(text) as Json;
      } catch (error) {
        throw new Error(`Cedia host returned malformed event frame ${event.sequence}`, { cause: error });
      }
      events.push({ ...event, frame });
    }
    return { ...page, events };
  }

  async #readFrameText(sessionId: string, sequence: number, reference: FrameReference): Promise<string> {
    let offset = 0;
    let text = "";
    while (offset < reference.length) {
      const result = await this.request<unknown>("GET", query(`/v1/sessions/${encoded(sessionId)}/events/${sequence}/frame`, { offset }));
      const body = objectBody<Record<string, unknown>>(result, "event frame chunk");
      const chunkSequence = body.sequence;
      const chunkOffset = body.offset;
      const chunk = body.text;
      const chunkLength = body.length;
      const chunkHash = body.sha256;
      if (chunkSequence !== sequence || chunkOffset !== offset || typeof chunk !== "string" || !Number.isSafeInteger(chunkLength) || chunkLength !== reference.length || typeof chunkHash !== "string" || chunkHash.toLowerCase() !== reference.sha256.toLowerCase()) {
        throw new Error(`Cedia host returned an invalid event frame chunk ${sequence}`);
      }
      if (chunk.length === 0 || chunk.length > MAX_FRAME_CHUNK_CHARS || offset + chunk.length > reference.length) {
        throw new Error(`Cedia host returned an invalid event frame chunk length ${sequence}`);
      }
      text += chunk;
      offset += chunk.length;
      if (text.length > MAX_FRAME_TEXT_CHARS) throw new Error("Cedia event frame exceeds the mobile size limit");
    }
    if (text.length !== reference.length) throw new Error(`Cedia event frame ${sequence} is truncated`);
    const digest = (await this.#digestSha256(text)).toLowerCase();
    if (digest !== reference.sha256.toLowerCase()) throw new Error(`Cedia event frame ${sequence} failed integrity verification`);
    return text;
  }

  sendCommand(sessionId: string, request: CommandRequest): Promise<Command> {
    return this.request<unknown>("POST", `/v1/sessions/${encoded(sessionId)}/commands`, request).then(body => objectBody<Command>(body, "command"));
  }

  getCommands(sessionId: string, limit = 200): Promise<Command[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError("limit must be between 1 and 1000");
    return this.request<unknown>("GET", query(`/v1/sessions/${encoded(sessionId)}/commands`, { limit })).then(body => arrayBody<Command>(body, "commands"));
  }

  listArtifacts(sessionId: string): Promise<ArtifactReceipt[]> {
    if (!sessionId.trim()) throw new TypeError("sessionId is required");
    return this.request<unknown>("GET", `/v1/sessions/${encoded(sessionId)}/artifacts`)
      .then(body => arrayBody<unknown>(body, "artifacts"))
      .then(values => values.map(value => parseArtifactReceipt(value, sessionId)));
  }

  captureArtifact(sessionId: string, path: string, sourcePaths: readonly string[] = []): Promise<ArtifactReceipt> {
    if (!sessionId.trim()) throw new TypeError("sessionId is required");
    if (!path.trim()) throw new TypeError("artifact path is required");
    if (sourcePaths.length > 1_000 || sourcePaths.some(sourcePath => typeof sourcePath !== "string" || !sourcePath.trim())) throw new TypeError("sourcePaths must contain non-empty paths");
    return this.request<unknown>("POST", `/v1/sessions/${encoded(sessionId)}/artifacts`, { path, ...(sourcePaths.length ? { sourcePaths: [...sourcePaths] } : {}) })
      .then(body => parseArtifactReceipt(body, sessionId));
  }

  readArtifact(sessionId: string, sha256: string, offset = 0): Promise<ArtifactChunk> {
    if (!sessionId.trim()) throw new TypeError("sessionId is required");
    return this.request<unknown>("GET", query(`/v1/sessions/${encoded(sessionId)}/artifacts/${encoded(sha256)}`, { offset }))
      .then(body => parseArtifactChunk(body, sessionId, sha256, offset));
  }

  /** Authoritative live UI broker state; logged historical cedia_ui frames are not actionable. */
  getPendingUi(sessionId: string): Promise<PendingUiRequest[]> {
    return this.request<unknown>("GET", `/v1/sessions/${encoded(sessionId)}/ui`).then(body => arrayBody<PendingUiRequest>(body, "pending UI requests"));
  }

  sendUiResponse(sessionId: string, request: UiResponseRequest): Promise<Command | undefined> {
    return this.request<unknown>("POST", `/v1/sessions/${encoded(sessionId)}/ui`, request).then(body => body === undefined ? undefined : objectBody<Command>(body, "UI response command"));
  }

  stopSession(sessionId: string): Promise<Session | undefined> {
    return this.request<unknown>("POST", `/v1/sessions/${encoded(sessionId)}/stop`).then(body => body === undefined ? undefined : objectBody<Session>(body, "stopped session"));
  }

  reconcile(sessionId: string): Promise<Session> {
    return this.request<unknown>("POST", `/v1/sessions/${encoded(sessionId)}/reconcile`, { acknowledgeUnknown: true }).then(body => objectBody<Session>(body, "reconciled session"));
  }

  setModel(sessionId: string, input: CommandRequest): Promise<Command> {
    if (input.command !== "set_model") throw new TypeError("setModel requires set_model command");
    return this.sendCommand(sessionId, input);
  }

  /**
   * The OMP model catalog, read without a session.
   *
   * Same route the agent window and the CLI use, so a paired phone can list models
   * before a session exists and never starts OMP to learn what is available.
   */
  listModels(): Promise<ModelOption[]> {
    return this.request<unknown>("GET", "/v1/models").then(body => modelsFromCatalog(body));
  }

  /**
   * OMP provider login state, read without a session. Credential material never
   * appears in this answer, so the phone only learns which providers exist.
   */
  listLoginProviders(): Promise<LoginProviderOption[]> {
    return this.request<unknown>("GET", "/v1/providers").then(body => loginProvidersFromCatalog(body));
  }
}

/**
 * A catalog answer whose list is missing or not a list is a failed read, not an empty
 * catalog: collapsing it to `[]` would make the screen claim OMP advertised nothing.
 */
export function modelsFromCatalog(body: unknown): ModelOption[] {
  const rows = isRecord(body) ? body.models : undefined;
  if (!Array.isArray(rows)) throw new Error("Cedia host returned an invalid models catalog");
  return rows.flatMap((value: unknown): ModelOption[] => {
    if (typeof value === "string" && value.trim()) return [{ id: value, label: value }];
    if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return [];
    return [{ id: value.id, label: typeof value.label === "string" ? value.label : value.id, ...(typeof value.provider === "string" ? { provider: value.provider } : {}), ...(typeof value.available === "boolean" ? { available: value.available } : {}), ...(typeof value.reason === "string" ? { reason: value.reason } : {}) }];
  });
}

export function loginProvidersFromCatalog(body: unknown): LoginProviderOption[] {
  const rows = isRecord(body) ? body.providers : undefined;
  if (!Array.isArray(rows)) throw new Error("Cedia host returned an invalid providers catalog");
  return rows.flatMap((value: unknown): LoginProviderOption[] => {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return [];
    return [{
      id: value.id,
      name: typeof value.name === "string" && value.name.trim() ? value.name : value.id,
      available: value.available !== false,
      authenticated: value.authenticated === true,
    }];
  });
}
