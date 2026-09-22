import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { CEDIA_PROTOCOL_VERSION, type CommandRequest, type UiResponseRequest } from "../../../packages/protocol/src/index.ts";
import { isGitMethod } from "../../../packages/protocol/src/git.ts";
import { OMP_BASELINE_VERSION } from "../../../packages/omp-adapter/src/types.ts";
import { DeviceAuth } from "./auth.ts";
import { CediaHost, HostError } from "./service.ts";
import { ProviderAuthError } from "./provider-auth.ts";
import { reviewWorkspace, workspacePath } from "./workspaces.ts";
import { GitCapacityError, GitNotARepositoryError, GitPathNotAuthorizedError, gitAuthorizedRoots, type HostGitService } from "./git.ts";
import type { ArtifactStore } from "./artifacts.ts";
import type { RemoteConnection } from "./remote.ts";
import type { EditorConnections } from "./editors.ts";
import type { EditorResponse } from "../../../packages/protocol/src/editor.ts";
import { createHash } from "node:crypto";
import { ResponseChunks } from "./response-chunks.ts";

export interface HostRequest { method: string; path: string; token?: string; body?: unknown }
export interface HostResponse { status: number; body: unknown }
/** The router's published shape: one request in, one response out. */
export type HostRouter = (request: HostRequest) => Promise<HostResponse>;
export interface VoiceTranscriptionInput {
  provider: string;
  cwd: string;
  threadId?: string;
  mimeType: string;
  sampleRateHz: number;
  durationMs: number;
  audioBase64: string;
}
export interface VoiceEndpoint {
  transcribe(input: VoiceTranscriptionInput): Promise<{ text: string }>;
  prewarm?(input: { provider: string }): Promise<{ ready: boolean }>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HostError("invalid_body", "Expected an object", 400);
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new HostError("invalid_body", `Invalid ${name}`, 400);
  return value;
}
function integer(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new HostError("invalid_cursor", "Invalid pagination", 400);
  return Number(value);
}

/**
 * The git service's own refusals, translated for a client.
 *
 * An unauthorized folder and a folder without a repository are the two states the protocol names
 * (`GitPathRejection`), so they keep their own codes; everything else keeps git's diagnosis with
 * the host's runtime paths stripped, so a local owner can read what git objected to without the
 * reply doubling as a filesystem listing.
 */
function gitFailure(error: unknown, runtimePaths: readonly string[]): HostError {
  if (error instanceof HostError) return error;
  if (error instanceof GitPathNotAuthorizedError) return new HostError("path_not_authorized", error.message, 403);
  if (error instanceof GitNotARepositoryError) return new HostError("not_a_repository", error.message, 400);
  if (error instanceof GitCapacityError) return new HostError("too_many_actions", error.message, 429);
  const collapsed = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
  let message = collapsed.slice(0, 400);
  for (const path of runtimePaths) message = message.split(path).join(".");
  return new HostError("git_failed", message || "The git command failed", 400);
}

/** Identical authenticated application router for loopback HTTP and encrypted relay. */
export function createRouter(host: CediaHost, auth: DeviceAuth, extras: { artifacts?: ArtifactStore; remote?: RemoteConnection; editors?: EditorConnections; voice?: VoiceEndpoint; git?: HostGitService } = {}): HostRouter {
  const responses = new ResponseChunks();
  return async (request: HostRequest): Promise<HostResponse> => {
    try {
      const device = auth.authenticate(request.token);
      if (!device) throw new HostError("unauthorized", "Device credential is missing or revoked", 401);
      const url = new URL(request.path, "http://cedia.local");
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== "v1") throw new HostError("not_found", "Unknown API version", 404);
      const method = request.method.toUpperCase();
      const body = () => record(request.body);
      const owner = () => { if (device.role !== "owner") throw new HostError("forbidden", "Only the local owner can manage devices", 403); };
      const voiceInput = (): VoiceTranscriptionInput => {
        const b = body();
        if (b.provider !== "omp") throw new HostError("invalid_body", "Voice transcription must use OMP", 400);
        const cwd = string(b.cwd, "cwd");
        const mimeType = string(b.mimeType, "mimeType");
        const audioBase64 = b.audioBase64;
        const sampleRateHz = b.sampleRateHz;
        const durationMs = b.durationMs;
        if (!/^audio\/[A-Za-z0-9.+-]+$/.test(mimeType)) throw new HostError("invalid_body", "Invalid audio MIME type", 400);
        if (typeof audioBase64 !== "string" || audioBase64.length === 0 || audioBase64.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)) throw new HostError("invalid_body", "Invalid voice payload", 400);
        if (typeof sampleRateHz !== "number" || !Number.isSafeInteger(sampleRateHz) || sampleRateHz < 8_000 || sampleRateHz > 192_000) throw new HostError("invalid_body", "Invalid sample rate", 400);
        if (typeof durationMs !== "number" || !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 10 * 60_000) throw new HostError("invalid_body", "Invalid audio duration", 400);
        return { provider: "omp", cwd, ...(b.threadId === undefined ? {} : { threadId: string(b.threadId, "threadId") }), mimeType, sampleRateHz, durationMs, audioBase64 };
      };
      let result: unknown;
      if (parts.length === 3 && parts[1] === "responses" && method === "GET") {
        result = responses.read(device.id, parts[2]!, integer(url.searchParams.get("offset"), 0));
      } else if (parts.length === 2 && parts[1] === "health" && method === "GET") {
        // Informational: the OMP release this host was built against. The runtime gate accepts
        // that release or anything newer (see isSupportedOmpVersion), so this is the baseline,
        // not a claim about the binary on disk.
        result = { protocolVersion: CEDIA_PROTOCOL_VERSION, status: "ready", ompVersion: OMP_BASELINE_VERSION };
      } else if (parts.length === 2 && parts[1] === "models" && method === "GET") {
        result = await host.listModels();
      } else if (parts[1] === "providers" && parts.length === 2 && method === "GET") {
        // Provider auth belongs to OMP; this route only brokers its own API and
        // never returns credential material.
        result = await host.providerAuth().list();
      } else if (parts[1] === "providers" && parts.length === 4 && parts[3] === "api-key" && method === "POST") {
        result = await host.providerAuth().saveApiKey(parts[2]!, string(body().apiKey, "apiKey"));
      } else if (parts[1] === "providers" && parts.length === 4 && parts[3] === "auth" && method === "DELETE") {
        result = await host.providerAuth().logout(parts[2]!);
      } else if (parts[1] === "providers" && parts.length === 4 && parts[3] === "login" && method === "POST") {
        result = await host.providerAuth().login(parts[2]!);
      } else if (parts[1] === "provider-logins" && parts.length === 3 && method === "GET") {
        result = host.providerAuth().getLogin(parts[2]!);
      } else if (parts[1] === "provider-logins" && parts.length === 3 && method === "DELETE") {
        result = await host.providerAuth().cancel(parts[2]!);
      } else if (parts[1] === "provider-logins" && parts.length === 4 && parts[3] === "input" && method === "POST") {
        const b = body();
        result = await host.providerAuth().respond(parts[2]!, string(b.requestId, "requestId"), string(b.value, "value"));
      } else if (parts.length === 2 && parts[1] === "voice" && method === "GET") {
        result = extras.voice ? { provider: "omp", available: true } : { provider: "omp", available: false, reason: "The current OMP runtime does not expose a transcription endpoint" };
      } else if (parts.length === 3 && parts[1] === "voice" && parts[2] === "transcribe" && method === "POST") {
        if (!extras.voice) throw new HostError("voice_unavailable", "The current OMP runtime does not expose a transcription endpoint", 503);
        result = await extras.voice.transcribe(voiceInput());
      } else if (parts.length === 3 && parts[1] === "voice" && parts[2] === "prewarm" && method === "POST") {
        if (!extras.voice?.prewarm) throw new HostError("voice_unavailable", "The current OMP runtime does not expose a transcription endpoint", 503);
        const b = body();
        if (b.provider !== "omp") throw new HostError("invalid_body", "Voice prewarm must use OMP", 400);
        result = await extras.voice.prewarm({ provider: "omp" });
      } else if (parts[1] === "projects" && parts.length === 2) {
        if (method === "GET") result = host.store.listProjects({ includeArchived: true });
        else if (method === "POST") { const b = body(); result = host.store.createProject({ ...(b.id === undefined ? {} : { id: string(b.id, "id") }), path: string(b.path, "path"), ...(b.name === undefined ? {} : { name: string(b.name, "name") }) }); }
        else throw new HostError("method_not_allowed", "Unsupported method", 405);
      } else if (parts[1] === "projects" && parts.length === 3 && method === "PATCH") {
        const b = body();
        for (const key of Object.keys(b)) if (!["name", "pinned", "archived"].includes(key)) throw new HostError("invalid_body", `Unsupported project field ${key}`, 400);
        result = host.store.updateProject(parts[2]!, b);
      } else if (parts[1] === "workspace-suggestion" && parts.length === 2 && method === "POST") {
        // Opt-in capability. "No opinion" is a normal answer, not an error, so a client that
        // asks without a configured judge gets `mode: null` and keeps its own default.
        const prompt = body().prompt;
        if (typeof prompt !== "string") throw new HostError("invalid_body", "Invalid prompt", 400);
        result = (await host.suggestWorkspaceMode(prompt.slice(0, 2_000))) ?? { mode: null };
      } else if (parts[1] === "sessions" && parts.length === 2) {
        if (method === "GET") result = host.store.listSessions(url.searchParams.get("projectId") ?? undefined, { includeArchived: true }).map(session => host.sessionView(session));
        else if (method === "POST") {
          const b = body();
          if (b.workspaceMode !== undefined && b.workspaceMode !== "local" && b.workspaceMode !== "worktree") throw new HostError("unsupported_workspace", "Choose local or worktree mode", 400);
          result = host.createSession(string(b.projectId, "projectId"), b.title === undefined ? undefined : string(b.title, "title"), b.workspaceMode as "local" | "worktree" | undefined, b.id === undefined ? undefined : string(b.id, "id"));
        } else throw new HostError("method_not_allowed", "Unsupported method", 405);
      } else if (parts[1] === "sessions" && parts.length >= 3) {
        const id = parts[2]!;
        const session = host.store.getSession(id);
        if (!session) throw new HostError("not_found", "Task not found", 404);
        const action = parts[3];
        if (parts.length === 3 && method === "GET") result = host.sessionView(session);
        else if (parts.length === 3 && method === "DELETE") {
          await host.deleteSession(id);
          result = { deleted: true };
        } else if (parts.length === 3 && method === "PATCH") {
          const b = body();
          for (const key of Object.keys(b)) if (!["title", "archived", "pinned"].includes(key)) throw new HostError("invalid_body", `Unsupported task field ${key}`, 400);
          result = host.store.updateSession(id, b);
        } else if (action === "events" && parts.length === 6 && parts[5] === "frame" && method === "GET") {
          const sequence = integer(parts[4]!, 0);
          const page = host.store.readEvents(id, sequence - 1, 1);
          const event = page.events[0];
          if (!event || event.sequence !== sequence) {
            // Retention dropped it, or it never existed; a client can act on the
            // difference, and a bare 404 leaves a fork hydration guessing.
            if (page.firstSequence > sequence) throw new HostError("history_truncated", "That event was dropped by journal retention", 404);
            throw new HostError("not_found", "Event not found", 404);
          }
          const text = JSON.stringify(event.frame); const offset = integer(url.searchParams.get("offset"), 0);
          result = { sequence, offset, text: text.slice(offset, offset + 24_000), length: text.length, sha256: createHash("sha256").update(text).digest("hex") };
        } else if (action === "artifacts" && parts.length === 5 && method === "GET" && extras.artifacts) result = extras.artifacts.read(id, parts[4]!, integer(url.searchParams.get("offset"), 0));
        else if (action === "fork" && parts.length === 4 && method === "POST") {
          const b = body();
          result = await host.forkSession(id, string(b.title, "title"), string(b.id, "id"));
        }
        else if (parts.length !== 4) throw new HostError("not_found", "Unknown task route", 404);
        else if (action === "artifacts" && method === "GET" && extras.artifacts) result = extras.artifacts.list(id);
        else if (action === "artifacts" && method === "POST" && extras.artifacts) {
          const b = body(); const sourcePaths = b.sourcePaths ?? [];
          if (!Array.isArray(sourcePaths) || sourcePaths.some(path => typeof path !== "string")) throw new HostError("invalid_body", "sourcePaths must be a list of paths", 400);
          result = extras.artifacts.capture(id, session.cwd, string(b.path, "path"), sourcePaths);
        }
        // A client that just attached can render the host's headless screen instead of
        // replaying a bounded chunk history (empty list = no virtual UI or no engine).
        else if (action === "terminals" && parts.length === 4 && method === "GET") result = { terminals: host.terminalSnapshots(id) };
        else if (action === "start" && method === "POST") result = await host.startSession(id);
        else if (action === "stop" && method === "POST") result = await host.stopSession(id);
        else if (action === "reconcile" && method === "POST") {
          if (body().acknowledgeUnknown !== true) throw new HostError("acknowledgement_required", "Acknowledge the unknown outcome before reconciliation", 400);
          result = host.reconcile(id);
        } else if (action === "events" && method === "GET") {
          const after = integer(url.searchParams.get("after"), 0);
          const page = host.store.readEvents(id, after, integer(url.searchParams.get("limit"), 200));
          let bytes = 0;
          const events = [];
          for (const event of page.events) {
            const text = JSON.stringify(event.frame);
            const frame = Buffer.byteLength(text) > 48_000 ? { type: "cedia_frame_reference", sequence: event.sequence, length: text.length, sha256: createHash("sha256").update(text).digest("hex") } : event.frame;
            const projected = { ...event, frame }; const size = Buffer.byteLength(JSON.stringify(projected));
            if (events.length && bytes + size > 128_000) break;
            events.push(projected); bytes += size;
          }
          // `firstSequence`/`historyTruncated` are the retention half of this page: a
          // client that reattaches at `after: 0` is told where the journal starts now
          // instead of reading a short page as the whole task.
          result = { events, cursor: events.at(-1)?.sequence ?? after, hasMore: page.hasMore || events.length < page.events.length, firstSequence: page.firstSequence, historyTruncated: page.historyTruncated };
        }
        else if (action === "commands" && method === "GET") result = host.store.listCommands(id);
        else if (action === "commands" && method === "POST") {
          const b = body(); string(b.commandId, "commandId"); string(b.incarnation, "incarnation"); string(b.command, "command");
          if (b.payload !== undefined) record(b.payload);
          result = await host.command(id, device.id, b as unknown as CommandRequest);
        } else if (action === "ui" && method === "GET") result = host.pendingUi(id);
        else if (action === "ui" && method === "POST") {
          const b = body(); string(b.commandId, "commandId"); string(b.incarnation, "incarnation"); string(b.token, "token");
          result = await host.respond(id, device.id, b as unknown as UiResponseRequest);
        } else if (action === "review" && method === "GET") result = reviewWorkspace(session.cwd);
        else if (action === "files" && method === "GET") {
          const path = workspacePath(session.cwd, url.searchParams.get("path") ?? ".");
          const stat = lstatSync(path);
          if (stat.isDirectory()) result = { entries: readdirSync(path, { withFileTypes: true }).slice(0, 1000).map(entry => ({ name: entry.name, directory: entry.isDirectory(), symlink: entry.isSymbolicLink() })) };
          else if (stat.isFile() && stat.size <= 1024 * 1024) { const bytes = readFileSync(path); result = bytes.includes(0) ? { binary: true, size: stat.size } : { text: bytes.toString("utf8"), size: stat.size }; }
          else result = { binary: true, size: stat.size };
        } else throw new HostError("not_found", "Unknown task route", 404);
      } else if (parts[1] === "git" && extras.git) {
        // One git implementation behind three routes: a one-shot method, a streaming action, and
        // that action's poll. `path` is a working directory the host must already own, so the
        // refusal is always available before any git process starts. Owner-only for the same
        // reason the editor bridge is: these methods move the user's checkout (stage, checkout,
        // stash, commit, push, worktree removal), and a paired controller is a projection of the
        // session, not a second pair of hands on the repository.
        owner();
        const git = extras.git;
        const runtimePaths = [host.store.paths.stateDir, ...gitAuthorizedRoots(host.store)];
        try {
          if (parts.length === 2 && method === "POST") {
            const b = body();
            if (!isGitMethod(b.method)) throw new HostError("invalid_body", "Unknown git method", 400);
            result = await git.request({ path: b.path, method: b.method, input: b.input });
          } else if (parts.length === 3 && parts[2] === "actions" && method === "POST") {
            result = git.startAction(body());
          } else if (parts.length === 4 && parts[2] === "actions" && method === "GET") {
            const poll = git.pollAction(string(parts[3], "actionId"), integer(url.searchParams.get("after"), 0));
            if (!poll) throw new HostError("not_found", "Unknown git action", 404);
            result = poll;
          } else throw new HostError("not_found", "Unknown git route", 404);
        } catch (error) {
          throw gitFailure(error, runtimePaths);
        }
      } else if (parts[1] === "editors" && extras.editors) {
        owner();
        const id = string(parts[2], "editor client ID");
        if (parts.length === 3 && method === "POST") {
          const roots = body().roots;
          if (!Array.isArray(roots) || roots.some(root => typeof root !== "string")) throw new HostError("invalid_body", "Expected workspace roots", 400);
          extras.editors.register(id, roots); result = { registered: true };
        } else if (parts.length === 4 && parts[3] === "requests" && method === "GET") result = extras.editors.poll(id);
        else if (parts.length === 5 && parts[3] === "requests" && method === "GET") result = { valid: extras.editors.valid(id, parts[4]!) };
        else if (parts.length === 4 && parts[3] === "responses" && method === "POST") { extras.editors.respond(id, body() as unknown as EditorResponse); result = { accepted: true }; }
        else throw new HostError("not_found", "Unknown editor route", 404);
      } else if (parts[1] === "remote" && extras.remote) {
        owner();
        if (parts.length === 2 && method === "GET") result = extras.remote.status();
        else if (parts.length === 3 && parts[2] === "pair" && method === "POST") result = await extras.remote.pair(string(body().name, "name"));
        else if (parts.length === 3 && parts[2] === "disable" && method === "POST") { await extras.remote.disable(); result = extras.remote.status(); }
        else throw new HostError("not_found", "Unknown remote route", 404);
      } else if (parts[1] === "devices") {
        owner();
        if (parts.length === 2 && method === "GET") result = auth.list();
        else if (parts.length === 2 && method === "POST") result = auth.issue(string(body().name, "name"));
        else if (parts.length === 4 && parts[3] === "revoke" && method === "POST") { auth.revoke(parts[2]!); result = { revoked: true }; }
        else throw new HostError("not_found", "Unknown device route", 404);
      } else throw new HostError("not_found", "Unknown route", 404);
      return { status: 200, body: parts[1] === "responses" ? result : responses.wrap(device.id, result) };
    } catch (error) {
      if (error instanceof HostError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      // Provider-auth failures are authored by the host (OMP's own error text is
      // replaced at the manager), and the settings surface needs them verbatim.
      if (error instanceof ProviderAuthError) return { status: error.status, body: { error: { code: "provider_auth_failed", message: error.message } } };
      // Keep runtime paths, provider credentials and subprocess stderr out of remote errors.
      return { status: 400, body: { error: { code: "request_failed", message: "The host could not complete this request" } } };
    }
  };
}
