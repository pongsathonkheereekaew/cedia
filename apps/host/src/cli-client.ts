/** Headless JSON client for the loopback host (`cedia-host <verb>`).
 *
 * Why this file exists: the host already forwards every canonical OMP RPC command
 * (`POST /v1/sessions/:id/commands`), but the only terminal entry points were
 * `serve`/`ensure`/`status`. These verbs drive sessions, turns, approvals, reviews
 * and files from the terminal with JSON output, and the generic `rpc` verb covers
 * all 42 RPC command types so the CLI never lags OMP again.
 *
 * Pure argument parsing (`parseCliArgs`) is separated from the fetch driver
 * (`runCliOp`) so tests run against a stub without a live host or OMP runtime.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CEDIA_UI_COMMAND_TYPES, RPC_COMMAND_TYPES } from "../../../packages/omp-adapter/src/types.ts";
import type { HostDescriptor } from "../../../packages/protocol/src/index.ts";

export const CLI_USAGE = `cedia-host <verb> [args] [--json]

Session verbs:
  sessions [--project <id>]                          list tasks
  session-create --project <id> [--title <t>] [--mode local|worktree] [--id <id>]
  session-get|session-delete|session-start|session-stop <id>
  session-set <id> [--title <t>] [--archive|--unarchive] [--pin|--unpin]
  session-fork <id> --title <t> --id <new-id>
Turn verbs (incarnation is read from the task unless --incarnation is given):
  send|steer|follow-up|abort-and-prompt <id> --message <m> [--message-file <f>]
      [--command-id <c>] [--wait] [--timeout-ms <n>]
  abort <id> [--command-id <c>]
Approval verbs:
  approvals <id>                                     list pending UI requests
  approve <id> --command-id <c> --token <t> --answer <json|string|bool>
      [--incarnation <i>]
Read verbs:
  events <id> [--after <n>] [--limit <n>]
  review <id>                                        pending review workspace
  files <id> [--path <p>]                            workspace listing or file text
Generic OMP verbs (all 42 RPC command types):
  rpc <id> <command> [--payload <json>] [--payload-file <f>]
      [--command-id <c>] [--incarnation <i>]
Catalog verbs:
  models  providers  projects
  project-create --path <p> [--name <n>] [--id <id>]
  help                                               this text

Output is JSON on stdout; errors are JSON on stderr (exit 1, usage errors exit 2).`;

const TURN_COMMANDS = ["prompt", "steer", "follow_up", "abort_and_prompt"] as const;
type TurnCommand = (typeof TURN_COMMANDS)[number];
const TURN_VERBS: Record<string, TurnCommand> = {
  send: "prompt",
  steer: "steer",
  "follow-up": "follow_up",
  "abort-and-prompt": "abort_and_prompt",
};
const TERMINAL_COMMAND_STATUS = new Set(["completed", "failed", "outcome_unknown", "not_dispatched"]);

export class CliUsageError extends Error {
  readonly exitCode = 2;
}

export type CliOp =
  | { verb: "sessions"; projectId?: string }
  | { verb: "session-create"; projectId: string; title?: string; mode?: "local" | "worktree"; id?: string }
  | { verb: "session-get" | "session-delete" | "session-start" | "session-stop"; id: string }
  | { verb: "session-set"; id: string; title?: string; archived?: boolean; pinned?: boolean }
  | { verb: "session-fork"; id: string; title: string; newId: string }
  | { verb: "turn"; command: TurnCommand; id: string; message: string; commandId: string; incarnation?: string; wait: boolean; timeoutMs: number }
  | { verb: "abort"; id: string; commandId: string; incarnation?: string }
  | { verb: "approvals"; id: string }
  | { verb: "approve"; id: string; commandId: string; token: string; answer: string | boolean | { cancelled: true; timedOut?: boolean }; incarnation?: string }
  | { verb: "events"; id: string; after: number; limit: number }
  | { verb: "review"; id: string }
  | { verb: "files"; id: string; path: string }
  | { verb: "rpc"; id: string; command: string; payload: Record<string, unknown>; commandId: string; incarnation?: string }
  | { verb: "models" | "providers" | "projects" }
  | { verb: "project-create"; path: string; name?: string; id?: string }
  | { verb: "help" };

interface FlagSpec { name: string; takesValue: boolean }

function splitFlags(argv: string[], specs: readonly FlagSpec[]): { positional: string[]; flags: Map<string, string | true> } {
  const names = new Map(specs.map(spec => [spec.name, spec]));
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (!token.startsWith("--")) { positional.push(token); continue; }
    const name = token.slice(2);
    const spec = names.get(name);
    if (!spec) throw new CliUsageError(`Unknown flag --${name}\n\n${CLI_USAGE}`);
    if (!spec.takesValue) { flags.set(name, true); continue; }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new CliUsageError(`Flag --${name} needs a value\n\n${CLI_USAGE}`);
    flags.set(name, value);
  }
  return { positional, flags };
}

function need(flags: Map<string, string | true>, name: string, what: string): string {
  const value = flags.get(name);
  if (typeof value !== "string" || value.length === 0) throw new CliUsageError(`Missing --${name} ${what}\n\n${CLI_USAGE}`);
  return value;
}

function optional(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integerFlag(flags: Map<string, string | true>, name: string, fallback: number): number {
  const raw = optional(flags, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new CliUsageError(`Flag --${name} needs a non-negative integer\n\n${CLI_USAGE}`);
  return value;
}

function messageFrom(flags: Map<string, string | true>, readFile: (path: string) => string): string {
  const direct = optional(flags, "message");
  const file = optional(flags, "message-file");
  if (direct !== undefined && file !== undefined) throw new CliUsageError("Use --message or --message-file, not both");
  if (file !== undefined) {
    try { return readFile(file); }
    catch { throw new CliUsageError(`Cannot read --message-file ${file}`); }
  }
  if (direct === undefined) throw new CliUsageError("Missing --message <text> (or --message-file <path>)");
  return direct;
}

function payloadFrom(flags: Map<string, string | true>, readFile: (path: string) => string): Record<string, unknown> {
  const direct = optional(flags, "payload");
  const file = optional(flags, "payload-file");
  if (direct !== undefined && file !== undefined) throw new CliUsageError("Use --payload or --payload-file, not both");
  const raw = file !== undefined
    ? (() => { try { return readFile(file); } catch { throw new CliUsageError(`Cannot read --payload-file ${file}`); } })()
    : (direct ?? "{}");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch { throw new CliUsageError("Payload must be a JSON object"); }
}

function answerFrom(raw: string): string | boolean | { cancelled: true; timedOut?: boolean } {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as { cancelled: true; timedOut?: boolean };
    } catch { /* fall through to plain string */ }
  }
  return raw;
}

/** Parse argv (without the binary name) into one operation. Pure: no I/O. */
export function parseCliArgs(argv: string[], readFile: (path: string) => string = (path): string => readFileSync(path, "utf8")): CliOp {
  const [verb, ...rest] = argv;
  if (verb === undefined || verb === "help" || verb === "--help" || verb === "-h") return { verb: "help" };
  const valueFlags = (names: string[]): FlagSpec[] => names.map(name => ({ name, takesValue: true }));
  switch (verb) {
    case "sessions": {
      const { flags } = splitFlags(rest, valueFlags(["project"]));
      return { verb: "sessions", projectId: optional(flags, "project") };
    }
    case "session-create": {
      const { flags } = splitFlags(rest, [...valueFlags(["project", "title", "mode", "id"]), { name: "json", takesValue: false }]);
      const mode = optional(flags, "mode");
      if (mode !== undefined && mode !== "local" && mode !== "worktree") throw new CliUsageError("--mode must be local or worktree");
      return { verb: "session-create", projectId: need(flags, "project", "for the new task"), title: optional(flags, "title"), mode, id: optional(flags, "id") };
    }
    case "session-get": case "session-delete": case "session-start": case "session-stop": {
      const { positional } = splitFlags(rest, []);
      if (positional.length !== 1 || !positional[0]) throw new CliUsageError(`Usage: cedia-host ${verb} <id>`);
      return { verb, id: positional[0] };
    }
    case "session-set": {
      const { positional, flags } = splitFlags(rest, [...valueFlags(["title"]),
        { name: "archive", takesValue: false }, { name: "unarchive", takesValue: false },
        { name: "pin", takesValue: false }, { name: "unpin", takesValue: false }]);
      if (positional.length !== 1 || !positional[0]) throw new CliUsageError("Usage: cedia-host session-set <id> [--title <t>] [--archive|--unarchive] [--pin|--unpin]");
      if (flags.has("archive") && flags.has("unarchive")) throw new CliUsageError("Use --archive or --unarchive, not both");
      if (flags.has("pin") && flags.has("unpin")) throw new CliUsageError("Use --pin or --unpin, not both");
      const title = optional(flags, "title");
      const archived = flags.has("archive") ? true : flags.has("unarchive") ? false : undefined;
      const pinned = flags.has("pin") ? true : flags.has("unpin") ? false : undefined;
      if (title === undefined && archived === undefined && pinned === undefined) throw new CliUsageError("Nothing to set: give --title, --archive/--unarchive or --pin/--unpin");
      return { verb: "session-set", id: positional[0], title, archived, pinned };
    }
    case "session-fork": {
      const { positional, flags } = splitFlags(rest, valueFlags(["title", "id"]));
      if (positional.length !== 1 || !positional[0]) throw new CliUsageError("Usage: cedia-host session-fork <id> --title <t> --id <new-id>");
      return { verb: "session-fork", id: positional[0], title: need(flags, "title", "for the fork"), newId: need(flags, "id", "for the fork") };
    }
    case "send": case "steer": case "follow-up": case "abort-and-prompt": {
      const { positional, flags } = splitFlags(rest, [...valueFlags(["message", "message-file", "command-id", "incarnation", "timeout-ms"]), { name: "wait", takesValue: false }]);
      if (positional.length !== 1 || !positional[0]) throw new CliUsageError(`Usage: cedia-host ${verb} <id> --message <text>`);
      return {
        verb: "turn", command: TURN_VERBS[verb]!, id: positional[0],
        message: messageFrom(flags, readFile),
        commandId: optional(flags, "command-id") ?? randomUUID(),
        incarnation: optional(flags, "incarnation"),
        wait: flags.has("wait"), timeoutMs: integerFlag(flags, "timeout-ms", 300_000),
      };
    }
    case "abort": {
      const { positional, flags } = splitFlags(rest, valueFlags(["command-id", "incarnation"]));
      if (positional.length !== 1 || !positional[0]) throw new CliUsageError("Usage: cedia-host abort <id>");
      return { verb: "abort", id: positional[0], commandId: optional(flags, "command-id") ?? randomUUID(), incarnation: optional(flags, "incarnation") };
    }
    case "approvals": {
      const { positional } = splitFlags(rest, []);
      if (positional.length !== 1 || !positional[0]) throw new CliUsageError("Usage: cedia-host approvals <id>");
      return { verb: "approvals", id: positional[0] };
    }
    case "approve": {
      const { positional, flags } = splitFlags(rest, valueFlags(["command-id", "incarnation", "token", "answer"]));
      if (positional.length !== 1 || !positional[0]) throw new CliUsageError("Usage: cedia-host approve <id> --command-id <c> --token <t> --answer <json|string|bool>");
      return {
        verb: "approve", id: positional[0],
        commandId: need(flags, "command-id", "of the pending request"),
        token: need(flags, "token", "of the pending request"),
        answer: answerFrom(need(flags, "answer", "as JSON, true/false or text")),
        incarnation: optional(flags, "incarnation"),
      };
    }
    case "events": {
      const { positional, flags } = splitFlags(rest, valueFlags(["after", "limit"]));
      if (positional.length !== 1 || !positional[0]) throw new CliUsageError("Usage: cedia-host events <id> [--after <n>] [--limit <n>]");
      return { verb: "events", id: positional[0], after: integerFlag(flags, "after", 0), limit: integerFlag(flags, "limit", 200) };
    }
    case "review": {
      const { positional } = splitFlags(rest, []);
      if (positional.length !== 1 || !positional[0]) throw new CliUsageError("Usage: cedia-host review <id>");
      return { verb: "review", id: positional[0] };
    }
    case "files": {
      const { positional, flags } = splitFlags(rest, valueFlags(["path"]));
      if (positional.length !== 1 || !positional[0]) throw new CliUsageError("Usage: cedia-host files <id> [--path <p>]");
      return { verb: "files", id: positional[0], path: optional(flags, "path") ?? "." };
    }
    case "rpc": {
      const { positional, flags } = splitFlags(rest, valueFlags(["payload", "payload-file", "command-id", "incarnation"]));
      if (positional.length !== 2 || !positional[0] || !positional[1]) throw new CliUsageError("Usage: cedia-host rpc <id> <command> [--payload <json>]");
      const command = positional[1];
      if (!(RPC_COMMAND_TYPES as readonly string[]).includes(command) && !(CEDIA_UI_COMMAND_TYPES as readonly string[]).includes(command)) {
        throw new CliUsageError(`Unknown OMP command ${command} (see: cedia-host rpc <id> get_available_commands --payload {})`);
      }
      return {
        verb: "rpc", id: positional[0], command,
        payload: payloadFrom(flags, readFile),
        commandId: optional(flags, "command-id") ?? randomUUID(),
        incarnation: optional(flags, "incarnation"),
      };
    }
    case "models": case "providers": case "projects": return { verb };
    case "project-create": {
      const { flags } = splitFlags(rest, valueFlags(["path", "name", "id"]));
      return { verb: "project-create", path: need(flags, "path", "of the project root"), name: optional(flags, "name"), id: optional(flags, "id") };
    }
    default: throw new CliUsageError(`Unknown verb ${verb}\n\n${CLI_USAGE}`);
  }
}

export interface CliHttp {
  (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

export interface CliDeps {
  http: CliHttp;
  stdout: (text: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Follow a chunked response reference to its full body. */
async function dereference(http: CliHttp, body: unknown): Promise<unknown> {
  if (!isRecord(body)) return body;
  const ref = body.cediaResponseReference;
  if (!isRecord(ref) || typeof ref.sha256 !== "string") return body;
  let text = "";
  let offset = 0;
  for (;;) {
    const page = await http("GET", `/v1/responses/${ref.sha256}?offset=${offset}`);
    if (page.status !== 200 || !isRecord(page.body) || typeof page.body.text !== "string") {
      throw new Error(`Chunked response unreadable (http ${page.status})`);
    }
    text += page.body.text as string;
    if (text.length >= (ref.length as number)) break;
    offset = text.length;
  }
  return JSON.parse(text) as unknown;
}

async function readIncarnation(http: CliHttp, id: string, given: string | undefined): Promise<string> {
  if (given) return given;
  const session = await http("GET", `/v1/sessions/${encodeURIComponent(id)}`);
  if (session.status !== 200 || !isRecord(session.body) || typeof session.body.incarnation !== "string") {
    throw new Error("Start the task first: no live incarnation to address");
  }
  return session.body.incarnation as string;
}

async function postCommand(http: CliHttp, id: string, command: string, payload: Record<string, unknown>, commandId: string, incarnation: string | undefined): Promise<unknown> {
  const resolved = await readIncarnation(http, id, incarnation);
  const posted = await http("POST", `/v1/sessions/${encodeURIComponent(id)}/commands`, { commandId, incarnation: resolved, command, payload });
  if (posted.status !== 200) throw new Error(`Command refused (http ${posted.status}): ${JSON.stringify(posted.body)}`);
  return dereference(http, posted.body);
}

async function waitForCommand(http: CliHttp, id: string, commandId: string, timeoutMs: number, sleep: (ms: number) => Promise<void>): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const listed = await http("GET", `/v1/sessions/${encodeURIComponent(id)}/commands`);
    if (listed.status === 200 && Array.isArray(listed.body)) {
      const current = (listed.body as Array<Record<string, unknown>>).find(entry => entry.commandId === commandId);
      if (current && typeof current.status === "string" && TERMINAL_COMMAND_STATUS.has(current.status)) return current;
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${commandId}`);
    await sleep(1000);
  }
}

/** Execute one parsed operation. Returns the process exit code. */
export async function runCliOp(op: CliOp, deps: CliDeps): Promise<number> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const emit = (value: unknown): number => { deps.stdout(`${JSON.stringify(value, null, 2)}\n`); return 0; };
  const call = async (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown> => {
    const response = await deps.http(method, path, body);
    if (response.status < 200 || response.status >= 300) throw new Error(`Request failed (http ${response.status}): ${JSON.stringify(response.body)}`);
    return dereference(deps.http, response.body);
  };
  switch (op.verb) {
    case "help": deps.stdout(`${CLI_USAGE}\n`); return 0;
    case "sessions": return emit(await call("GET", op.projectId ? `/v1/sessions?projectId=${encodeURIComponent(op.projectId)}` : "/v1/sessions"));
    case "session-create": return emit(await call("POST", "/v1/sessions", { projectId: op.projectId, ...(op.title === undefined ? {} : { title: op.title }), ...(op.mode === undefined ? {} : { workspaceMode: op.mode }), ...(op.id === undefined ? {} : { id: op.id }) }));
    case "session-get": return emit(await call("GET", `/v1/sessions/${encodeURIComponent(op.id)}`));
    case "session-delete": return emit(await call("DELETE", `/v1/sessions/${encodeURIComponent(op.id)}`));
    case "session-start": return emit(await call("POST", `/v1/sessions/${encodeURIComponent(op.id)}/start`));
    case "session-stop": return emit(await call("POST", `/v1/sessions/${encodeURIComponent(op.id)}/stop`));
    case "session-set": return emit(await call("PATCH", `/v1/sessions/${encodeURIComponent(op.id)}`, { ...(op.title === undefined ? {} : { title: op.title }), ...(op.archived === undefined ? {} : { archived: op.archived }), ...(op.pinned === undefined ? {} : { pinned: op.pinned }) }));
    case "session-fork": return emit(await call("POST", `/v1/sessions/${encodeURIComponent(op.id)}/fork`, { title: op.title, id: op.newId }));
    case "turn": {
      const result = await postCommand(deps.http, op.id, op.command, { message: op.message }, op.commandId, op.incarnation).catch(error => { throw error; });
      if (!op.wait) return emit(result);
      const settled = await waitForCommand(deps.http, op.id, op.commandId, op.timeoutMs, sleep);
      return emit({ command: result, settled });
    }
    case "abort": return emit(await postCommand(deps.http, op.id, "abort", {}, op.commandId, op.incarnation));
    case "approvals": return emit(await call("GET", `/v1/sessions/${encodeURIComponent(op.id)}/ui`));
    case "approve": {
      const incarnation = await readIncarnation(deps.http, op.id, op.incarnation);
      return emit(await call("POST", `/v1/sessions/${encodeURIComponent(op.id)}/ui`, { commandId: op.commandId, incarnation, token: op.token, answer: op.answer }));
    }
    case "events": return emit(await call("GET", `/v1/sessions/${encodeURIComponent(op.id)}/events?after=${op.after}&limit=${op.limit}`));
    case "review": return emit(await call("GET", `/v1/sessions/${encodeURIComponent(op.id)}/review`));
    case "files": return emit(await call("GET", `/v1/sessions/${encodeURIComponent(op.id)}/files?path=${encodeURIComponent(op.path)}`));
    case "rpc": return emit(await postCommand(deps.http, op.id, op.command, op.payload, op.commandId, op.incarnation));
    case "models": return emit(await call("GET", "/v1/models"));
    case "providers": return emit(await call("GET", "/v1/providers"));
    case "projects": return emit(await call("GET", "/v1/projects"));
    case "project-create": return emit(await call("POST", "/v1/projects", { path: op.path, ...(op.name === undefined ? {} : { name: op.name }), ...(op.id === undefined ? {} : { id: op.id }) }));
  }
}

export interface LoopbackClient {
  origin: string;
  token: string;
}

/** Read the private loopback descriptor written by `serve`. */
export function readLoopbackDescriptor(stateDir = resolve(process.env.CEDIA_STATE_DIR ?? join(homedir(), "Library", "Application Support", "Cedia", "host"))): LoopbackClient {
  const descriptor = JSON.parse(readFileSync(join(stateDir, "host.json"), "utf8")) as HostDescriptor;
  const url = new URL(descriptor.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !descriptor.token) {
    throw new Error("Host descriptor is missing or not loopback; is the host running?");
  }
  return { origin: url.origin, token: descriptor.token };
}

/** Run argv against the loopback host. Returns the process exit code. */
export async function runCli(argv: string[], environment: {
  readDescriptor?: () => LoopbackClient;
  fetchImpl?: typeof fetch;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  sleep?: (ms: number) => Promise<void>;
} = {}): Promise<number> {
  const stdout = environment.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = environment.stderr ?? ((text: string) => process.stderr.write(text));
  let op: CliOp;
  try {
    op = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) { stderr(`${error.message}\n`); return 2; }
    throw error;
  }
  if (op.verb === "help") { stdout(`${CLI_USAGE}\n`); return 0; }
  let client: LoopbackClient;
  try {
    client = (environment.readDescriptor ?? readLoopbackDescriptor)();
  } catch (error) {
    stderr(`${JSON.stringify({ error: { code: "host_offline", message: error instanceof Error ? error.message : String(error) } })}\n`);
    return 1;
  }
  const fetchImpl = environment.fetchImpl ?? fetch;
  const http: CliHttp = async (method, path, body) => {
    const response = await fetchImpl(`${client.origin}${path}`, {
      method,
      headers: { Authorization: `Bearer ${client.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, body: await response.json() as unknown };
  };
  try {
    return await runCliOp(op, { http, stdout, sleep: environment.sleep });
  } catch (error) {
    stderr(`${JSON.stringify({ error: { code: "request_failed", message: error instanceof Error ? error.message : String(error) } })}\n`);
    return 1;
  }
}
