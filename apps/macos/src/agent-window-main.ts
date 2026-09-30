import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CediaHostClient, HostHttpError } from "./api.ts";
import { createAgentTerminalService } from "./agent-window-terminal.ts";
import { createAgentFilesService } from "./agent-window-files.ts";
import { createAgentBrowserService } from "./agent-window-browser.ts";
import { createAgentGitService } from "./agent-window-git.ts";
import { createAgentDeviceService } from "./agent-window-device.ts";
import { agentUiStateDir, readAgentUiState, removeAgentUiState, resolveAgentUiThread, saveIdeHandoff, validAgentThreadId, writeAgentUiState } from "./agent-ui-state.ts";
import { readAgentThemeSnapshot } from "./agent-theme.ts";
import { startAgentThemePublisher } from "./agent-window-theme-publisher.ts";
import { AGENTS_WINDOW_WORKSPACE } from "./workbench-mode.ts";
import { defaultKeybindingsFile, readKeybindingsFile, writeKeybindingRule } from "./agent-window-keybindings.ts";

import { AGENT_WINDOW_CHANNEL } from "./bridge-contract.ts";
import { tagCediaHostErrorMessage } from "../agent-window/src/host-error-codes.ts";

export { AGENT_WINDOW_CHANNEL };
/** The HTTP methods a renderer may ask the host for; exported so a caller (and its
 * tests) can name the contract instead of restating it. */
export type HostMethod = "GET" | "POST" | "PATCH" | "DELETE";
export interface IdeTarget { cwd: string; path?: string; line?: number }
export interface HandlerOptions {
  stateDir?: string;
  authorize(event: unknown): boolean;
  ensure(): Promise<void>;
  request(method: HostMethod, path: string, body?: unknown): Promise<unknown>;
  pickFolder(event: unknown): Promise<string | null>;
  openIde(input: IdeTarget, event: unknown): Promise<void>;
	openExternal(url: string): Promise<void>;
	getZoomFactor?(event: unknown): number;
	zoom?(event: unknown, action: "in" | "out" | "reset"): number;
  panel?(event: unknown, surface: string, method: string, input: unknown): Promise<unknown>;
  version?: string;
	/**
	 * Publish a committed draft revision to the *other* Mac windows (plan §2.5 item 1).
	 *
	 * The host owns the record; the main process is the only place both windows meet, so it is
	 * where one window's committed revision reaches the other without either renderer polling.
	 */
	broadcastDraft?(event: unknown, update: SharedDraftBroadcast): void;
	/** Publish a committed Cedia preference revision to the *other* Mac windows (§6.4). */
	broadcastPreferences?(event: unknown, update: HostPreferenceBroadcast): void;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Agent Window request");
  return value as Record<string, unknown>;
}
interface KeybindingsRequest {
	readonly action?: unknown;
	readonly file?: unknown;
	readonly rule?: unknown;
	readonly replacing?: unknown;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 16_384 || /[\u0000-\u001f]/.test(value)) throw new Error("Invalid Agent Window argument");
  return value;
}

/** Top-level names the renderer may reach at any depth; the host's router stays authoritative
 * for the segments below them. */
const APPLICATION_ROOTS = ["health", "capabilities", "lifecycle", "projects", "sessions", "responses", "models", "voice", "omp", "settings", "workspace-suggestion"];
/** Provider auth, matched segment by segment. `*` is exactly one opaque identifier, so a
 * lookalike such as `/v1/providers/x/credentials` never leaves the application. */
const PROVIDER_ROUTES: readonly (readonly string[])[] = [
  ["providers"],
  ["providers", "*", "api-key"],
  ["providers", "*", "auth"],
  ["providers", "*", "login"],
  ["provider-logins", "*"],
  ["provider-logins", "*", "input"],
];
/** Selected remote path (§6.5) the Settings > Remote panel drives: gateway state, one
 * enrollment code, and the paired-device list with revoke. Matched by shape so the
 * retained Paseo relay verbs (`pair`, `disable`) stay unreachable from the renderer;
 * the host's owner gate stays authoritative for the four shapes below. */
const REMOTE_ROUTES: readonly (readonly string[])[] = [
  ["remote", "gateway"],
  ["remote", "enrollment"],
  ["devices"],
  ["devices", "*", "revoke"],
];

function matchesProviderRoute(shape: readonly string[], segments: readonly string[]): boolean {
  return shape.length === segments.length
    && shape.every((part, index) => part === "*" ? /^[A-Za-z0-9._:@+-]{1,128}$/.test(segments[index]!) : part === segments[index]);
}

/** Only application routes are exposed; device credentials and editor registration stay native. */
function applicationPath(value: unknown): string {
  const path = text(value);
  if (!path.startsWith("/v1/") || path.includes("\\") || path.includes("#")) throw new Error("Invalid application path");
  const pathname = path.split("?")[0]!;
  const segments = pathname.split("/").map(part => decodeURIComponent(part));
  if (segments.some(part => part === "." || part === ".." || /[/\\\u0000-\u001f]/.test(part))) throw new Error("Invalid application path");
  const route = segments.slice(2);
  if (!APPLICATION_ROOTS.includes(segments[2]!) && !PROVIDER_ROUTES.some(shape => matchesProviderRoute(shape, route)) && !REMOTE_ROUTES.some(shape => matchesProviderRoute(shape, route))) throw new Error("Unsupported application route");
  return path.slice(4);
}

/** What a renderer learns when it reads or writes the shared draft (plan §2.5). */
export interface SharedDraftRead {
  readonly revision: number;
  readonly payload: unknown;
  /** The host was unreachable and this came from the offline cache. */
  readonly stale?: true;
}

export type SharedDraftWrite =
  | { readonly status: "accepted"; readonly revision: number }
  | { readonly status: "conflict"; readonly revision: number; readonly payload: unknown }
  | { readonly status: "unavailable" };

/**
 * What a Send learns before it dispatches (plan §2.5 item 2).
 *
 * `reserved` carries the command the host bound to this draft revision - a repeated send of
 * the same revision and text resolves to the same command. `conflict` means that revision was
 * already sent with different text, so dispatch must stop. `none` means this task has no draft
 * record (a CLI-created session, or a renderer that never wrote one), so there is nothing to
 * reserve and the send proceeds with its own command id.
 */
export type SharedDraftReserve =
  | { readonly status: "reserved"; readonly commandId: string; readonly revision: number }
  | { readonly status: "conflict" }
  | { readonly status: "none" };

/**
 * One committed change to a task's shared draft, as the other Mac window learns it (§2.5 item 1).
 *
 * `written` carries the revision and payload the host now holds. `delivered` means a Send's
 * authoritative acceptance cleared the record: the host has no draft for this task any more, the
 * revision space restarts at 1, and a window that is still composing keeps its text as the next
 * draft instead of losing it.
 */
export type SharedDraftBroadcast =
  | { readonly status: "written"; readonly threadId: string; readonly revision: number; readonly payload: unknown }
  | { readonly status: "delivered"; readonly threadId: string };

/** What a window learns when the other Mac window committed a Cedia preference change (§6.4). */
export interface HostPreferenceBroadcast {
  readonly revision: number;
  readonly values: Readonly<Record<string, unknown>>;
}

/** The composer text inside the renderer's own draft payload, when it carries one. */
export function draftTextOf(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const draft = (payload as { draft?: unknown }).draft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return "";
  const prompt = (draft as { prompt?: unknown }).prompt;
  return typeof prompt === "string" ? prompt.slice(0, 262_144) : "";
}

/**
 * The one shared Mac draft per task.
 *
 * The host owns the revision: this class translates the renderer's read/write into
 * the draft routes and never keeps a second authority. The local `agent-ui` file is
 * read exactly once per task, to import a draft a pre-host build left behind, and is
 * never written again; the small offline cache below only exists so a window can
 * still see the last known payload while the host is unreachable.
 */
export function createSharedDraftAccess(options: Pick<HandlerOptions, "request" | "stateDir"> & {
  /**
   * Called after the host committed a revision, or after a Send's acceptance cleared the record.
   * The event is what identifies the window that already knows, so the publisher can skip it.
   */
  readonly broadcast?: (event: unknown, update: SharedDraftBroadcast) => void;
}) {
  const importedLegacy = new Set<string>();
  const route = (threadId: string): string => `drafts/${encodeURIComponent(threadId)}`;
  // The cache keeps the file the pre-host builds wrote (`draft:<thread>`, the raw
  // payload `resolveAgentUiThread` still reads) plus a sibling revision, so a window
  // can still resolve and show a draft while the host is unreachable.
  const cacheKey = (threadId: string): string => `draft:${threadId}`;
  const revisionKey = (threadId: string): string => `draft-revision:${threadId}`;
  const importedFileKey = (threadId: string): string => `draft-import:${threadId}`;

  const readCache = async (threadId: string): Promise<SharedDraftRead | null> => {
    const directory = agentUiStateDir(options.stateDir);
    const payload = await readAgentUiState(directory, cacheKey(threadId));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const meta = await readAgentUiState(directory, revisionKey(threadId)) as { revision?: unknown } | null;
    const revision = meta && typeof meta.revision === "number" && Number.isSafeInteger(meta.revision) && meta.revision >= 0 ? meta.revision : 0;
    return { revision, payload, stale: true };
  };
  const writeCache = async (threadId: string, revision: number, payload: unknown): Promise<void> => {
    const directory = agentUiStateDir(options.stateDir);
    await writeAgentUiState(directory, cacheKey(threadId), payload);
    await writeAgentUiState(directory, revisionKey(threadId), { revision });
  };
  /**
   * A delivered draft is gone for good: leaving the cache behind would let the next read
   * resurrect the text the user just sent as a fresh draft.
   */
  const clearCache = async (threadId: string): Promise<void> => {
    const directory = agentUiStateDir(options.stateDir);
    await removeAgentUiState(directory, cacheKey(threadId));
    await removeAgentUiState(directory, revisionKey(threadId));
  };

  const preserveConflictingFile = async (threadId: string, payload: unknown): Promise<void> => {
    const draftId = `legacy-agent-ui-${createHash("sha256").update(threadId, "utf8").update("\0").update(JSON.stringify(payload) ?? "null", "utf8").digest("hex")}`;
    const directory = agentUiStateDir(options.stateDir);
    const prior = await readAgentUiState(directory, importedFileKey(threadId)) as { draftId?: unknown } | null;
    if (prior?.draftId === draftId) return;
    const expected = { draftId, text: draftTextOf(payload), content: payload, source: "agent-ui-import-conflict" };
    await options.request("POST", "drafts/import", { entries: [expected] });
    const stored = await options.request("GET", `drafts/${encodeURIComponent(draftId)}`) as { revision?: unknown; text?: unknown; source?: unknown; content?: unknown };
    if (typeof stored?.revision !== "number" || !Number.isSafeInteger(stored.revision) || stored.revision < 1
      || stored.text !== expected.text || stored.source !== expected.source || !isDeepStrictEqual(stored.content, expected.content)) {
      throw new Error(`Conflicting legacy draft import could not be verified for ${draftId}`);
    }
    await writeAgentUiState(directory, importedFileKey(threadId), { draftId });
  };

  async function read(threadId: string): Promise<SharedDraftRead | null> {
    try {
      const snapshot = await options.request("GET", route(threadId)) as { revision?: unknown; content?: unknown };
      if (typeof snapshot?.revision === "number" && Number.isSafeInteger(snapshot.revision)) {
        const payload = snapshot.content ?? null;
        const cached = await readAgentUiState(agentUiStateDir(options.stateDir), cacheKey(threadId));
        if (cached && typeof cached === "object" && !Array.isArray(cached) && !isDeepStrictEqual(cached, payload)) {
          await preserveConflictingFile(threadId, cached);
        }
        await writeCache(threadId, snapshot.revision, payload);
        return { revision: snapshot.revision, payload };
      }
      return null;
    } catch (error) {
      // A host that answers 404 simply has no draft for this task yet; every other
      // failure means the host is unavailable, where the cache is better than nothing.
      if (!(error instanceof HostHttpError) || error.status !== 404) return readCache(threadId);
    }
    if (importedLegacy.has(threadId)) return null;
    importedLegacy.add(threadId);
    const legacy = await readAgentUiState(agentUiStateDir(options.stateDir), `draft:${threadId}`);
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return null;
    // One-time import. It preserves the pre-host draft instead of discarding it; a
    // second import cannot happen because the host now answers for this thread.
    const created = await options.request("PATCH", route(threadId), {
      expectedRevision: 0,
      text: draftTextOf(legacy),
      content: legacy,
      source: "agent-ui-import",
    }) as { revision?: unknown };
    if (typeof created?.revision !== "number") return null;
    await writeCache(threadId, created.revision, legacy);
    return { revision: created.revision, payload: legacy };
  }

  const patch = async (threadId: string, payload: unknown, expectedRevision: number): Promise<number | undefined> => {
    const snapshot = await options.request("PATCH", route(threadId), { expectedRevision, text: draftTextOf(payload), content: payload }) as { revision?: unknown };
    return typeof snapshot?.revision === "number" && Number.isSafeInteger(snapshot.revision) ? snapshot.revision : undefined;
  };

  /**
   * Ask the host what it holds, without the one-time legacy import a read performs.
   *
   * The write path needs that distinction: a host that answers 404 has no record at all, while a
   * read that answers 404 may still be importing a pre-host draft file.
   */
  const readHostRecord = async (threadId: string): Promise<{ revision: number; payload: unknown } | undefined> => {
    try {
      const snapshot = await options.request("GET", route(threadId)) as { revision?: unknown; content?: unknown };
      if (typeof snapshot?.revision !== "number" || !Number.isSafeInteger(snapshot.revision)) return undefined;
      return { revision: snapshot.revision, payload: snapshot.content ?? null };
    } catch {
      return undefined;
    }
  };

  async function write(threadId: string, payload: unknown, expectedRevision: number, event?: unknown): Promise<SharedDraftWrite> {
    // Cache before the host write so an unreachable host cannot lose the text.
    await writeCache(threadId, expectedRevision, payload);
    const accepted = async (revision: number): Promise<SharedDraftWrite> => {
      await writeCache(threadId, revision, payload);
      options.broadcast?.(event, { status: "written", threadId, revision, payload });
      return { status: "accepted", revision };
    };
    try {
      return await accepted((await patch(threadId, payload, expectedRevision)) ?? expectedRevision);
    } catch (error) {
      if (!(error instanceof HostHttpError) || error.status !== 409) return { status: "unavailable" };
      const current = await readHostRecord(threadId);
      if (current) {
        // Another window's revision really is newer: keep both and let the window decide.
        await writeCache(threadId, current.revision, current.payload);
        return { status: "conflict", revision: current.revision, payload: current.payload };
      }
      // No record at all: the previous draft was delivered, and the host deletes a delivered
      // record, so its revision space restarts at 1. A write that still named the delivered
      // revision is the first edit of the *next* draft, not a conflict with another window -
      // treating it as one would leave this task's draft owner refusing every later write.
      try {
        return await accepted((await patch(threadId, payload, 0)) ?? 1);
      } catch {
        return { status: "unavailable" };
      }
    }
  }

  /**
   * Bind the exact draft revision this Send is about to dispatch to its command.
   *
   * The host owns the claim: it returns the command already bound to that revision, so two
   * windows sending the same revision produce one command rather than two. A revision sent
   * earlier with different text is a conflict and the caller must not dispatch.
   */
  async function reserve(threadId: string, commandId: string, message: string): Promise<SharedDraftReserve> {
    try {
      const snapshot = await options.request("GET", route(threadId)) as { revision?: unknown };
      const revision = typeof snapshot?.revision === "number" && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 1
        ? snapshot.revision
        : undefined;
      if (revision === undefined) return { status: "none" };
      const receipt = await options.request("POST", `${route(threadId)}/submissions`, {
        expectedRevision: revision,
        commandId,
        // The host compares this opaque token; it never receives the text itself.
        payloadHash: `sha256:${createHash("sha256").update(message, "utf8").digest("hex")}`,
      }) as { submission?: { commandId?: unknown } };
      const canonical = receipt?.submission?.commandId;
      return {
        status: "reserved",
        commandId: typeof canonical === "string" && canonical.length > 0 ? canonical : commandId,
        revision,
      };
    } catch (error) {
      if (error instanceof HostHttpError && error.status === 409) return { status: "conflict" };
      // No draft record, a draft route that is unavailable, or a host that cannot answer:
      // there is nothing to reserve, and bookkeeping must not be what blocks a send.
      return { status: "none" };
    }
  }

  /**
   * Drop the draft the Send just delivered, and only when its revision still matches: an edit
   * made in the other window while the turn was being accepted survives.
   */
  async function release(threadId: string, revision: number, event?: unknown): Promise<boolean> {
    try {
      const answer = await options.request("POST", `${route(threadId)}/clear`, { expectedRevision: revision }) as { cleared?: unknown };
      if (answer?.cleared !== true) return false;
      await clearCache(threadId);
      options.broadcast?.(event, { status: "delivered", threadId });
      return true;
    } catch {
      return false;
    }
  }

  return { read, write, reserve, release };
}

export function createAgentWindowHandler(options: HandlerOptions) {
  const sharedDrafts = createSharedDraftAccess({
    request: options.request,
    ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    ...(options.broadcastDraft === undefined ? {} : { broadcast: options.broadcastDraft }),
  });
  return async (event: unknown, input: unknown): Promise<unknown> => {
    if (!options.authorize(event)) throw new Error("Untrusted Agent Window sender");
    const value = record(input);
    switch (value.kind) {
      case "panel": {
        const surface = text(value.surface);
        if (!["terminal", "browser", "files", "device", "git"].includes(surface) || !options.panel) throw new Error("Unsupported native panel");
        const method = text(value.method);
        if (value.input !== undefined && JSON.stringify(value.input).length > 16 * 1024 * 1024) throw new Error("Panel request is too large");
        return options.panel(event, surface, method, value.input);
      }
      case "bootstrap": {
        await options.ensure();
        const theme = await readAgentThemeSnapshot(options.stateDir);
        return {
          platform: process.platform,
          homeDir: homedir(),
          worktreesDir: join(options.stateDir ?? process.env.CEDIA_STATE_DIR ?? join(homedir(), "Library", "Application Support", "Cedia", "host"), "worktrees"),
          version: options.version ?? "0.1.0",
          ...(theme ? { theme } : {}),
        };
      }
      case "theme":
        return (await readAgentThemeSnapshot(options.stateDir)) ?? null;
      case "request": {
        if (!["GET", "POST", "PATCH", "DELETE"].includes(String(value.method))) throw new Error("Unsupported application method");
        const path = applicationPath(value.path);
        if (value.body !== undefined && JSON.stringify(value.body).length > 16 * 1024 * 1024) throw new Error("Application request is too large");
        try {
          return await options.request(value.method as HostMethod, path, value.body);
        } catch (error) {
          // Electron's IPC carries an error's message and drops every other property (measured
          // against the pinned runtime), so a typed host error would arrive as an anonymous
          // refusal. The code travels in the message for the Cedia adapter to restore.
          if (error instanceof HostHttpError && error.code) throw new Error(tagCediaHostErrorMessage(error.code, error.message));
          throw error;
        }
      }
      case "pickFolder": return options.pickFolder(event);
      case "openIde": {
        const cwd = text(value.cwd);
        if (!isAbsolute(cwd)) throw new Error("IDE workspace must be an absolute path");
        const target: IdeTarget = { cwd: resolve(cwd) };
        if (value.path !== undefined) {
          target.path = resolve(cwd, text(value.path));
          const child = relative(target.cwd, target.path);
          if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error("IDE file must belong to the workspace");
        }
        if (value.line !== undefined) {
          if (!Number.isSafeInteger(value.line) || (value.line as number) < 1) throw new Error("Invalid IDE line");
          target.line = value.line as number;
        }
        if (value.sessionId !== undefined) {
          if (!validAgentThreadId(value.sessionId)) throw new Error("Invalid IDE session");
          const session = await resolveAgentUiThread(options.stateDir, value.sessionId, path => options.request("GET", path));
          if (resolve(session.cwd) !== target.cwd) throw new Error("IDE session does not belong to this workspace");
          await saveIdeHandoff(options.stateDir, target.cwd, value.sessionId);
        }
        await options.openIde(target, event);
        return;
      }
      case "uiDraft": {
        if (!validAgentThreadId(value.threadId)) throw new Error("Invalid draft thread");
        const threadId = value.threadId;
        if (value.action === "read") return sharedDrafts.read(threadId);
        // A Send asks the shared owner for the command bound to this draft revision
        // before it dispatches, and releases the draft once the turn is accepted.
        if (value.action === "reserve") {
          const commandId = text(value.commandId);
          const message = typeof value.text === "string" ? value.text.slice(0, 262_144) : "";
          return sharedDrafts.reserve(threadId, commandId, message);
        }
        if (value.action === "clear") {
          const revision = value.revision;
          if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw new Error("Invalid draft revision");
          return { cleared: await sharedDrafts.release(threadId, revision as number, event) };
        }
        if (value.action !== "write" || !value.draft || typeof value.draft !== "object" || Array.isArray(value.draft) || JSON.stringify(value.draft).length > 2 * 1024 * 1024) throw new Error("Invalid draft state");
        const expectedRevision = value.expectedRevision;
        if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw new Error("Invalid draft revision");
        return sharedDrafts.write(threadId, value.draft, expectedRevision as number, event);
      }
      case "uiSettings": {
        // The host owns the CEDIA preference subset (§6.4): this window neither keeps a second
        // authority nor writes the local file as one. A read is the host's own snapshot; a write
        // names the revision it is based on so a stale one is the host's typed refusal.
        //
        // The path is the gateway's relative shape (`settings`), not a full `/v1/...` route: the
        // client resolves it against the host's `/v1/` base, and handing it `/v1/settings` asked the
        // host for `/v1/v1/settings` - a 404 this window reported as "unavailable", which is exactly
        // why a real host, not a fake request function, is what the end-to-end fixture uses.
        if (value.action === "read") return await options.request("GET", "/settings");
        if (value.action !== "write") throw new Error("Unsupported settings action");
        if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) throw new Error("Invalid settings revision");
        if (typeof value.category !== "string" || !["appearance", "layout", "composer"].includes(value.category)) throw new Error("Unsupported settings category");
        const patch = record(value.patch);
        if (value.patch !== undefined && !patch) throw new Error("Invalid settings patch");
        const body = { expectedRevision: value.expectedRevision as number, category: value.category, patch: patch ?? {} };
        const snapshot = async (): Promise<HostPreferenceBroadcast | undefined> => {
          try {
            const answer = await options.request("GET", "/settings") as { revision?: unknown; values?: unknown };
            return typeof answer?.revision === "number" && record(answer.values)
              ? { revision: answer.revision, values: answer.values as Record<string, unknown> }
              : undefined;
          } catch {
            return undefined;
          }
        };
        try {
          const written = await options.request("PATCH", "/settings", body) as { revision?: unknown; values?: unknown };
          if (typeof written?.revision !== "number" || !record(written.values)) return { status: "unavailable" };
          const committed: HostPreferenceBroadcast = { revision: written.revision, values: written.values as Record<string, unknown> };
          options.broadcastPreferences?.(event, committed);
          return { status: "saved", ...committed };
        } catch (error) {
          // A stale revision is the host's typed refusal, not a failure of the path: answer with the
          // record that won so the window can adopt it and decide, exactly as the draft routes do.
          if (error instanceof HostHttpError && error.status === 409) {
            const current = await snapshot();
            return { status: "conflict", ...(current ?? { revision: value.expectedRevision as number, values: {} }) };
          }
          return { status: "unavailable" };
        }
      }
      case "openExternal": {
        const url = new URL(text(value.url));
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Only web links can be opened externally");
        await options.openExternal(url.toString());
        return;
      }
      case "getZoomFactor": {
			if (!options.getZoomFactor) throw new Error("Desktop zoom is unavailable");
			return options.getZoomFactor(event);
		}
		case "zoom": {
			if (!options.zoom || !["in", "out", "reset"].includes(String(value.action))) throw new Error("Invalid desktop zoom action");
			return options.zoom(event, value.action as "in" | "out" | "reset");
		}
      case "keybindings": {
        const body = value as KeybindingsRequest;
        // Tests point the owned file at a temp dir through CEDIA_KEYBINDINGS_FILE;
        // anything else is refused even for a trusted sender.
        const allowed = process.env.CEDIA_KEYBINDINGS_FILE ?? defaultKeybindingsFile();
        const requested = typeof body.file === "string" && body.file.length > 0 ? body.file : allowed;
        if (resolve(requested) !== resolve(allowed)) throw new Error("Keybindings are owned by the workbench user file.");
        if (body.action === "read") return readKeybindingsFile(allowed);
        if (body.action === "write") return writeKeybindingRule(allowed, body.rule, body.replacing);
        throw new Error("Unsupported keybindings action");
      }
      default: throw new Error("Unsupported Agent Window operation");
    }
  };
}

const DEFAULT_AGENT_HOST_REQUEST_TIMEOUT_MS = 30_000;
const MAX_AGENT_HOST_REQUEST_TIMEOUT_MS = 300_000;

export function parseAgentHostRequestTimeoutMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_AGENT_HOST_REQUEST_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_AGENT_HOST_REQUEST_TIMEOUT_MS) {
    throw new RangeError(`CEDIA_HOST_REQUEST_TIMEOUT_MS must be an integer from 1 to ${MAX_AGENT_HOST_REQUEST_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

export interface GatewayOptions { appRoot: string; parentPid: number; stateDir?: string; requestTimeoutMs?: number }

/**
 * The host's durable lifetime file, read directly by the main process.
 *
 * The host removes `host.json` and writes phase `stopped` here before its process
 * exits, which is the only proof that survives the listener closing. Missing or
 * malformed input is `undefined`, never a guess.
 */
export function readLifecycleReceipt(stateDir: string): { phase?: string; generation?: string; processStartedAt?: string } | undefined {
  try {
    const path = join(stateDir, "lifecycle.json");
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
    const value = JSON.parse(readFileSync(path, "utf8")) as { phase?: unknown; generation?: unknown; processStartedAt?: unknown };
    if (value.phase !== "ready" && value.phase !== "quitting" && value.phase !== "stopped") return undefined;
    return {
      phase: value.phase,
      ...(typeof value.generation === "string" ? { generation: value.generation } : {}),
      ...(typeof value.processStartedAt === "string" ? { processStartedAt: value.processStartedAt } : {}),
    };
  } catch { return undefined; }
}

/** One client/launcher per application, independent of the lifetime of any IDE extension host. */
export function createAgentHostGateway(options: GatewayOptions) {
  const stateDir = options.stateDir ?? process.env.CEDIA_STATE_DIR ?? join(homedir(), "Library", "Application Support", "Cedia", "host");
  const requestTimeoutMs = options.requestTimeoutMs ?? parseAgentHostRequestTimeoutMs(process.env.CEDIA_HOST_REQUEST_TIMEOUT_MS);
  let client: CediaHostClient | undefined;
  let pending: Promise<CediaHostClient> | undefined;
  async function healthy(): Promise<CediaHostClient | undefined> {
    try {
      const candidate = await CediaHostClient.fromStateDir(stateDir, { requirePrivateMode: true, timeoutMs: 1500 });
      await candidate.health();
      const health = await candidate.health() as { identity?: { stateDir?: string; protocolVersion?: number; processStartedAt?: string; generation?: string; appGeneration?: string } };
      if (health.identity?.stateDir !== stateDir || health.identity.protocolVersion !== candidate.descriptor.protocolVersion
        || health.identity.processStartedAt !== candidate.descriptor.processStartedAt || typeof health.identity.generation !== "string") return undefined;
      if (candidate.descriptor.appGeneration !== undefined && candidate.descriptor.appGeneration !== health.identity.appGeneration) return undefined;
      return new CediaHostClient({ descriptor: candidate.descriptor, timeoutMs: requestTimeoutMs });
    } catch { return undefined; }
  }
  async function start(): Promise<CediaHostClient> {
    const existing = await healthy();
    if (existing) return existing;
    const runtime = join(options.appRoot, "extensions/cedia/runtime");
    const bundledNode = join(runtime, "node/bin/node");
    const bundledHost = join(runtime, "host/cli.js");
    const developmentHost = resolve(options.appRoot, "../dist/host/cli.js");
    const executable = process.env.CEDIA_HOST_NODE ?? (existsSync(bundledNode) ? bundledNode : process.execPath);
    const script = existsSync(bundledHost) ? bundledHost : developmentHost;
    if (!existsSync(script)) throw new Error("Cedia host is not built. Run the Cedia build before opening Agents.");
    await new Promise<void>((done, reject) => {
      const child = spawn(executable, [script, "ensure"], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CEDIA_STATE_DIR: stateDir, CEDIA_PARENT_PID: String(options.parentPid), CEDIA_APP_GENERATION: process.env.CEDIA_APP_GENERATION ?? String(options.parentPid) },
        stdio: "ignore",
        timeout: 25_000,
      });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? done() : reject(new Error("Cedia host could not start; inspect its private host log.")));
    });
    const ready = await healthy();
    if (!ready) throw new Error("Cedia host did not become ready");
    return ready;
  }
  async function ensureClient(): Promise<CediaHostClient> {
    if (client) return client;
    pending ??= start();
    const attempt = pending;
    try { client = await attempt; return client; }
    finally { if (pending === attempt) pending = undefined; }
  }
  async function withClient<T>(operation: (active: CediaHostClient) => Promise<T>): Promise<T> {
    const active = await ensureClient();
    try { return await operation(active); }
    catch (error) {
      if (client === active) client = undefined;
      throw error;
    }
  }
  /**
   * Reach a host that already exists without ever starting one. Asking to quit must not
   * spawn the process it is about to stop, which is why the fence and reopen use this
   * instead of `withClient`.
   */
  async function withExistingClient<T>(operation: (active: CediaHostClient) => Promise<T>): Promise<T> {
    const active = client ?? await healthy();
    if (!active) throw new Error("Cedia host is not running");
    client ??= active;
    try { return await operation(active); }
    catch (error) {
      if (client === active) client = undefined;
      throw error;
    }
  }
  return {
    ensure: async () => { await ensureClient(); },
    ensureClient,
    reliable: () => client !== undefined,
    capabilities: () => withClient(active => active.capabilities()),
    lifecycleStatus: () => withClient(active => active.lifecycle()),
    quitHost: () => withClient(active => active.quitHost()),
    lifecycle: () => withClient(active => active.lifecycle()),
    quit: () => withClient(active => active.quitHost()),
    // The pre-quit decision closes admission first and reopens it when the owner cancels
    // (plan §2.7). Both find a host read-only: neither may start the one it is stopping.
    fence: () => withExistingClient(active => active.fenceLifecycle()),
    resume: () => withExistingClient(active => active.resumeLifecycle()),
    // Asking to quit must never *start* the host it is about to stop, but it must still find a
    // host this process has not talked to yet: a packaged window's traffic can go through
    // another client (the extension side), and an unused in-process cache is not evidence that
    // no host exists. `healthy()` is the read-only probe - it reads the descriptor from the
    // state directory, health-checks it and returns undefined instead of spawning anything.
    peek: async () => {
      const active = client ?? await healthy();
      if (!active) return undefined;
      client ??= active;
      try { return await active.lifecycle(); }
      catch (error) { if (client === active) client = undefined; throw error; }
    },
    // The host writes phase `stopped` to this file before its process exits, so the
    // application can still prove a completed shutdown after the listener is gone.
    shutdownReceipt: async () => readLifecycleReceipt(stateDir),
    request: async (method: HostMethod, path: string, body?: unknown): Promise<unknown> => {
      const active = await ensureClient();
      try { return await active.requestApplication(method, path, body); }
      catch (error) {
        // Invalidate the connection, but never replay a mutation whose outcome may be unknown.
        if (client === active) client = undefined;
        throw error;
      }
    },
  };
}

export { isCediaAgentBrowserWebContents } from "./agent-window-browser.ts";
