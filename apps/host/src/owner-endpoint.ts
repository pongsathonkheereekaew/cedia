/**
 * Cedia's view of one OMP session's local owner endpoint (plan §8.2 O08).
 *
 * The runtime publishes a mode-0600 record and a Unix socket beside its exclusive session lock.
 * Probing reads the record and refuses anything it cannot prove; it never starts or stops a
 * process. A separate recovery helper removes endpoint files only after the host has an explicit
 * acknowledgement, an exact task/incarnation match and proof that the recorded PID is gone.
 *
 * The qualified CLI launcher and Mac UI share one owner decision instead of each inventing its own
 * test. Recovery is reserved for the host's acknowledged unknown-outcome path.
 */
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { attachCediaOwnerReadClient as attachReadClient, type CediaOwnerReadClient } from "../../../packages/omp-adapter/src/owner-read-client.ts";
import { OmpOwnerControlClient, OmpOwnerControlError } from "../../../packages/omp-adapter/src/owner-control-client.ts";
import type { OmpFrameListener } from "../../../packages/omp-adapter/src/types.ts";
import { CEDIA_OWNER_BRIDGE_VERSION } from "../../../packages/protocol/src/owner.ts";
import { readCediaProcessStartIdentity } from "../../../packages/protocol/src/process-start-identity.ts";

export { CEDIA_OWNER_BRIDGE_VERSION };

/** The record format the patched runtime writes; the host validates it strictly. */
export interface CediaOwnerRecord {
  readonly version: 1;
  readonly protocolVersion: number;
  /** A v2 record without mode predates inspect-only owners and is controller-capable. */
  readonly mode?: "controller" | "inspect_only";
  readonly sessionId: string;
  readonly incarnation: string;
  readonly pid: number;
  readonly processStartIdentity: string;
  readonly ownerStartedAt: string;
  readonly startedAt: string;
  readonly cwd: string;
  readonly sessionFile?: string;
  readonly socket: string;
  readonly token: string;
}

export interface CediaOwnerIdentity {
  readonly mode?: "controller" | "inspect_only";
  readonly sessionId: string;
  readonly incarnation: string;
  readonly pid: number;
  readonly processStartIdentity: string;
  readonly ownerStartedAt: string;
  readonly cwd: string;
  readonly sessionFile?: string;
}

export type CediaOwnerAttachment =
  /** The owner answered as itself: a client may broker requests through this socket. */
  | { readonly state: "attached"; readonly identity: CediaOwnerIdentity; readonly uptimeMs: number }
  /** No record: nothing to attach to, and nothing to clean up. */
  | { readonly state: "absent" }
  /** A record names an owner that is not there any more. The record is left alone. */
  | { readonly state: "stale"; readonly reason: string }
  /** Something is there but is not the session that was asked for. Never resolved automatically. */
  | { readonly state: "conflict"; readonly reason: string };

export function cediaOwnerRecordPath(directory: string): string {
  return join(directory, "owner.json");
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Read and validate the record. An unreadable or malformed record is absent, never a guess. */
export function readCediaOwnerRecord(directory: string): CediaOwnerRecord | undefined {
  const path = cediaOwnerRecordPath(directory);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) return undefined;
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const row = parsed as Record<string, unknown>;
  if (row.version !== 1) return undefined;
  if (typeof row.protocolVersion !== "number" || !Number.isSafeInteger(row.protocolVersion)) return undefined;
  if (row.mode !== undefined && row.mode !== "controller" && row.mode !== "inspect_only") return undefined;
  if (!text(row.sessionId) || !text(row.incarnation) || !text(row.cwd) || !text(row.socket) || !text(row.token)) return undefined;
  if (!text(row.startedAt) || !text(row.ownerStartedAt) || !text(row.processStartIdentity) || row.processStartIdentity.length > 128) return undefined;
  if (typeof row.pid !== "number" || !Number.isSafeInteger(row.pid) || row.pid <= 0) return undefined;
  if (row.sessionFile !== undefined && !text(row.sessionFile)) return undefined;
  return {
    version: 1,
    protocolVersion: row.protocolVersion,
    ...(row.mode === undefined ? {} : { mode: row.mode }),
    sessionId: row.sessionId,
    incarnation: row.incarnation,
    pid: row.pid,
    processStartIdentity: row.processStartIdentity,
    ownerStartedAt: row.ownerStartedAt,
    startedAt: row.startedAt,
    cwd: row.cwd,
    ...(row.sessionFile === undefined ? {} : { sessionFile: row.sessionFile }),
    socket: row.socket,
    token: row.token,
  };
}

export type CediaOwnerRecovery =
  | { readonly state: "absent" | "cleared" }
  | { readonly state: "conflict"; readonly reason: string };

function sameOwnerRecord(left: CediaOwnerRecord | undefined, right: CediaOwnerRecord): boolean {
  return left !== undefined && left.protocolVersion === right.protocolVersion
    && left.sessionId === right.sessionId && left.incarnation === right.incarnation
    && left.pid === right.pid && left.processStartIdentity === right.processStartIdentity
    && left.socket === right.socket && left.token === right.token;
}

/**
 * Remove one provably dead endpoint after the owner explicitly acknowledges an
 * unknown outcome. Ambiguous, live, malformed, replaced or cross-task records stay
 * in place as evidence and continue to block another executor.
 */
export function recoverStaleCediaOwnerEndpoint(
  directory: string,
  expected: { readonly sessionId: string; readonly incarnation: string },
): CediaOwnerRecovery {
  const recordPath = cediaOwnerRecordPath(directory);
  if (!existsSync(recordPath)) return { state: "absent" };
  const record = readCediaOwnerRecord(directory);
  if (!record) return { state: "conflict", reason: "The owner record is malformed or not private." };
  if (record.protocolVersion !== CEDIA_OWNER_BRIDGE_VERSION) {
    return { state: "conflict", reason: "The owner record uses an unsupported protocol." };
  }
  if (record.sessionId !== expected.sessionId || record.incarnation !== expected.incarnation) {
    return { state: "conflict", reason: "The owner record does not match this task incarnation." };
  }
  if (!socketIsContained(directory, record.socket)) {
    return { state: "conflict", reason: "The owner record points outside its task directory." };
  }
  const recordStat = lstatSync(recordPath);
  if (typeof process.getuid === "function" && recordStat.uid !== process.getuid()) {
    return { state: "conflict", reason: "The owner record belongs to a different user." };
  }
  if (processIsAlive(record.pid)) {
    return { state: "conflict", reason: "The recorded owner process is still alive or its identity is ambiguous." };
  }
  const socketPath = record.socket;
  let socketStat: Stats | undefined;
  try {
    socketStat = lstatSync(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { state: "conflict", reason: "The owner socket could not be inspected safely." };
    }
  }
  if (socketStat && (!socketStat.isSocket() || (socketStat.mode & 0o077) !== 0
      || (typeof process.getuid === "function" && socketStat.uid !== process.getuid()))) {
    return { state: "conflict", reason: "The owner socket is not a private socket owned by this user." };
  }

  // The session directory is private, but re-read the token and inode before unlinking
  // so a replaced endpoint can never be mistaken for the dead owner being reconciled.
  if (!sameOwnerRecord(readCediaOwnerRecord(directory), record) || processIsAlive(record.pid)) {
    return { state: "conflict", reason: "The owner endpoint changed while recovery was being checked." };
  }
  if (socketStat) {
    let currentSocket: Stats;
    try { currentSocket = lstatSync(socketPath); }
    catch { return { state: "conflict", reason: "The owner socket changed while recovery was being checked." }; }
    if (!currentSocket.isSocket() || currentSocket.dev !== socketStat.dev || currentSocket.ino !== socketStat.ino) {
      return { state: "conflict", reason: "The owner socket changed while recovery was being checked." };
    }
    unlinkSync(socketPath);
  }
  if (!sameOwnerRecord(readCediaOwnerRecord(directory), record) || processIsAlive(record.pid)) {
    return { state: "conflict", reason: "The owner endpoint changed while recovery was being checked." };
  }
  unlinkSync(recordPath);
  return { state: "cleared" };
}

/**
 * A socket the record names must be this directory's own `owner.sock`.
 *
 * Both sides go through `realpath`: a session directory reached as `/var/...` and as
 * `/private/var/...` is one directory, and a check that compared the spellings would refuse a
 * legitimate owner (or accept a symlinked one).
 */
function socketIsContained(directory: string, socket: string): boolean {
  try {
    const root = realpathSync(directory);
    const candidate = resolve(socket);
    if (basename(candidate) !== "owner.sock") return false;
    return realpathSync(dirname(candidate)) === root;
  } catch {
    return false;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not ours to signal; that is still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface OwnerAnswer {
	readonly id?: unknown;
  readonly protocolVersion?: unknown;
  readonly ok?: unknown;
  readonly error?: unknown;
  readonly identity?: unknown;
  readonly status?: unknown;
  readonly summary?: unknown;
}

/** One request, one line, bounded by a deadline so a wedged owner cannot hang the caller. */
export function askCediaOwner(socket: string, token: string, request: "identify" | "status" | "read", timeoutMs: number): Promise<OwnerAnswer> {
	return new Promise((resolvePromise, reject) => {
		const client = connect(socket);
		const requestId = randomUUID();
    let buffered = "";
    const timer = setTimeout(() => { client.destroy(); reject(new Error("owner did not answer in time")); }, timeoutMs);
    const finish = (error?: Error, answer?: OwnerAnswer): void => {
      clearTimeout(timer);
      client.removeAllListeners();
      client.destroy();
      if (error) reject(error);
      else resolvePromise(answer ?? {});
    };
    client.setEncoding("utf8");
    client.once("error", error => finish(error));
		client.once("connect", () => client.write(`${JSON.stringify({ protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, token, request, id: requestId, ...(request === "read" ? { kind: "summary" } : {}) })}\n`));
    client.on("data", chunk => {
      buffered += chunk;
      if (buffered.length > 64 * 1024) { finish(new Error("owner answer was too large")); return; }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
			try {
				const answer = JSON.parse(buffered.slice(0, newline)) as OwnerAnswer;
				if (answer.id !== requestId) { finish(new Error("owner response request ID mismatch")); return; }
				finish(undefined, answer);
			}
      catch { finish(new Error("owner answer was not JSON")); }
    });
    client.once("close", () => finish(new Error("owner closed the connection without answering")));
  });
}

export interface CediaOwnerSummary {
  readonly state: "available";
  readonly identity: CediaOwnerIdentity;
  readonly summary: {
    /** OMP's transcript session id; it can differ from identity.sessionId, the CEDIA task id. */
    readonly sessionId: string;
    readonly sessionName?: string;
    readonly provider?: string;
    readonly modelId?: string;
    readonly isStreaming: boolean;
    readonly isCompacting: boolean;
    readonly queuedMessageCount: number;
    readonly messageCount: number;
    readonly creditGuardEnabled: boolean;
  };
}

function summaryFrom(value: unknown): CediaOwnerSummary["summary"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!text(row.sessionId) || typeof row.isStreaming !== "boolean" || typeof row.isCompacting !== "boolean"
      || !Number.isSafeInteger(row.queuedMessageCount) || !Number.isSafeInteger(row.messageCount)
      || typeof row.creditGuardEnabled !== "boolean") return undefined;
  if ((row.sessionName !== undefined && !text(row.sessionName)) || (row.provider !== undefined && !text(row.provider))
      || (row.modelId !== undefined && !text(row.modelId))) return undefined;
  return {
    sessionId: row.sessionId,
    ...(row.sessionName === undefined ? {} : { sessionName: row.sessionName }),
    ...(row.provider === undefined ? {} : { provider: row.provider }),
    ...(row.modelId === undefined ? {} : { modelId: row.modelId }),
    isStreaming: row.isStreaming,
    isCompacting: row.isCompacting,
    queuedMessageCount: row.queuedMessageCount as number,
    messageCount: row.messageCount as number,
    creditGuardEnabled: row.creditGuardEnabled,
  };
}

/** Read the owner's allowlisted summary. This does not grant a generic OMP command transport. */
export async function readCediaOwnerSummary(directory: string, options: CediaOwnerProbeOptions = {}): Promise<CediaOwnerSummary | CediaOwnerAttachment> {
  const attached = await probeCediaOwner(directory, options);
  if (attached.state !== "attached") return attached;
  if (attached.identity.mode === "inspect_only") return { state: "conflict", reason: "This owner publishes presence only; it does not offer a session summary." };
  const record = readCediaOwnerRecord(directory);
  if (!record) return { state: "conflict", reason: "The owner record disappeared before its summary could be read." };
  let answer: OwnerAnswer;
  try {
    answer = await askCediaOwner(record.socket, record.token, "read", options.timeoutMs ?? 2_000);
  } catch {
    return { state: "stale", reason: "The owner disconnected before its read-only summary arrived." };
  }
  if (answer.protocolVersion !== CEDIA_OWNER_BRIDGE_VERSION || answer.ok !== true) return { state: "stale", reason: "The owner refused or could not provide its versioned read-only summary." };
  const identity = identityFrom(answer.identity);
  const summary = summaryFrom(answer.summary);
  // The authenticated endpoint identity is the CEDIA task key. OMP's get_state summary retains
  // its own transcript session id, which is a separate identity domain for host-started tasks.
  if (!identity || !summary || identity.sessionId !== attached.identity.sessionId
      || identity.incarnation !== attached.identity.incarnation || identity.pid !== attached.identity.pid
      || identity.ownerStartedAt !== attached.identity.ownerStartedAt
      || identity.processStartIdentity !== attached.identity.processStartIdentity
      || (identity.mode ?? "controller") !== attached.identity.mode) {
    return { state: "conflict", reason: "The read-only summary does not match the owner that was probed." };
  }
  return { state: "available", identity, summary };
}

function identityFrom(value: unknown): CediaOwnerIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!text(row.sessionId) || !text(row.incarnation) || !text(row.cwd)) return undefined;
  if (typeof row.pid !== "number" || !Number.isSafeInteger(row.pid)) return undefined;
  if (!text(row.ownerStartedAt) || !text(row.processStartIdentity) || row.processStartIdentity.length > 128) return undefined;
  if (row.sessionFile !== undefined && !text(row.sessionFile)) return undefined;
  if (row.mode !== undefined && row.mode !== "controller" && row.mode !== "inspect_only") return undefined;
  return {
    ...(row.mode === undefined ? {} : { mode: row.mode }),
    sessionId: row.sessionId,
    incarnation: row.incarnation,
    pid: row.pid,
    processStartIdentity: row.processStartIdentity,
    ownerStartedAt: row.ownerStartedAt,
    cwd: row.cwd,
    ...(row.sessionFile === undefined ? {} : { sessionFile: row.sessionFile }),
  };
}

export interface CediaOwnerProbeOptions {
  /** The session the caller believes it is talking about; a mismatch is a conflict, not a retry. */
  readonly expected?: { readonly sessionId?: string; readonly incarnation?: string };
  readonly timeoutMs?: number;
  /** Optional host listener installed only after the authenticated controller lease is claimed. */
  readonly onFrame?: OmpFrameListener;
}

/** Attach a typed read-only transport to an already running, authenticated local RPC owner. */
export async function attachCediaOwnerReadClient(directory: string, options: CediaOwnerProbeOptions = {}): Promise<CediaOwnerReadClient | CediaOwnerAttachment> {
	const attachment = await probeCediaOwner(directory, options);
	if (attachment.state !== "attached") return attachment;
	const record = readCediaOwnerRecord(directory);
	if (!record) return { state: "conflict", reason: "The owner record disappeared before the read client attached." };
	try {
		return await attachReadClient({
			socket: record.socket,
			token: record.token,
			protocolVersion: record.protocolVersion,
			expectedIdentity: attachment.identity,
			timeoutMs: options.timeoutMs,
		});
	} catch {
		return { state: "stale", reason: "The owner disconnected or changed identity before the read client attached." };
	}
}

/**
 * Attach the host's full controller to an already running owner.
 *
 * Discovery and controller election are deliberately separate: the first probe proves that the
 * record, process and endpoint name one identity, then the controller performs its own
 * authenticated claim. A read-only owner is not a usable host runtime, and a failed claim is
 * returned as a typed refusal so callers never rotate the incarnation or start a second process.
 */
export async function attachCediaOwnerControlClient(directory: string, options: CediaOwnerProbeOptions = {}): Promise<OmpOwnerControlClient | CediaOwnerAttachment> {
  const attachment = await probeCediaOwner(directory, options);
  if (attachment.state !== "attached") return attachment;
  if (attachment.identity.mode === "inspect_only") return { state: "conflict", reason: "This owner offers inspection only; Cedia cannot claim its controller lease." };
  const record = readCediaOwnerRecord(directory);
  if (!record) return { state: "conflict", reason: "The owner record disappeared before the controller attached." };
  try {
    const client = await OmpOwnerControlClient.attach({
      socket: record.socket,
      token: record.token,
      protocolVersion: record.protocolVersion,
      expectedIdentity: attachment.identity,
      timeoutMs: options.timeoutMs,
      onFrame: options.onFrame,
    });
    if (client.mode !== "read-write") {
      try { client.detach(); } catch { /* A failed read-only claim is already a refusal. */ }
      return { state: "conflict", reason: "The owner offered read-only access; Cedia will not adopt it as the session controller." };
    }
    if (client.readyFrame?.cediaOwnerControllerVersion !== 1) {
      try { client.detach(); } catch { /* A controller without the capability marker is refused. */ }
      return { state: "conflict", reason: "The owner controller did not advertise the required Cedia control capability." };
    }
    return client;
  } catch (error) {
    if (error instanceof OmpOwnerControlError && ["primary_active", "controller_busy", "identity_mismatch", "credit_guard_required"].includes(error.code ?? "")) {
      return { state: "conflict", reason: `The live owner refused controller adoption: ${error.code}.` };
    }
    return { state: "stale", reason: error instanceof Error ? error.message : "The owner disconnected before the controller claim completed." };
  }
}

/**
 * Decide what is at this session directory's owner endpoint.
 *
 * Order matters: the record is validated, the socket must belong to the directory, the recorded
 * process must still exist, and only then is the socket asked to prove it is the same owner. A
 * failure at any step is reported with its own state so a caller never treats "I could not tell"
 * as "available".
 */
export async function probeCediaOwner(directory: string, options: CediaOwnerProbeOptions = {}): Promise<CediaOwnerAttachment> {
  const recordPath = cediaOwnerRecordPath(directory);
  if (!existsSync(recordPath)) return { state: "absent" };
  const record = readCediaOwnerRecord(directory);
  if (!record) return { state: "conflict", reason: "The owner record exists but is not a record this Cedia understands." };
  if (record.protocolVersion !== CEDIA_OWNER_BRIDGE_VERSION) {
    return { state: "conflict", reason: `The owner speaks bridge protocol ${record.protocolVersion}; this Cedia understands ${CEDIA_OWNER_BRIDGE_VERSION}.` };
  }
  if (options.expected?.sessionId !== undefined && options.expected.sessionId !== record.sessionId) {
    return { state: "conflict", reason: `The record names session ${record.sessionId}, not ${options.expected.sessionId}.` };
  }
  if (options.expected?.incarnation !== undefined && options.expected.incarnation !== record.incarnation) {
    return { state: "conflict", reason: "The record names a different incarnation of this task." };
  }
  if (!socketIsContained(directory, record.socket)) {
    return { state: "conflict", reason: "The owner record points at a socket outside its own session directory." };
  }
  if (!processIsAlive(record.pid)) {
    return { state: "stale", reason: `The owner process ${record.pid} is gone; its record was left behind.` };
  }
  const processStartIdentity = readCediaProcessStartIdentity(record.pid);
  if (!processStartIdentity) {
    return { state: "conflict", reason: "The host cannot verify this PID's operating-system process start identity." };
  }
  if (processStartIdentity !== record.processStartIdentity) {
    return { state: "conflict", reason: "The recorded process start identity does not match this PID; it may have been reused." };
  }

  const timeoutMs = options.timeoutMs ?? 2_000;
  let answer: OwnerAnswer;
  try {
    answer = await askCediaOwner(record.socket, record.token, "identify", timeoutMs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A socket nobody answers is the liveness proof: the record is stale, and it is left alone.
    if (code === "ECONNREFUSED" || code === "ENOENT" || code === "ECONNRESET") {
      return { state: "stale", reason: "The owner socket refused the connection; the owner is not running." };
    }
    return { state: "stale", reason: error instanceof Error ? error.message : "The owner endpoint did not answer." };
  }
  if (answer.protocolVersion !== CEDIA_OWNER_BRIDGE_VERSION || answer.ok !== true) return { state: "conflict", reason: "The owner response used an unsupported protocol or refused the probe." };
  const identity = identityFrom(answer.identity);
  if (!identity) return { state: "conflict", reason: "The owner answered with an identity Cedia cannot read." };
  if (record.mode !== identity.mode) {
    return { state: "conflict", reason: "The owner record and authenticated response disagree about control mode." };
  }
  if (identity.sessionId !== record.sessionId || identity.incarnation !== record.incarnation || identity.pid !== record.pid
      || identity.ownerStartedAt !== record.ownerStartedAt || identity.processStartIdentity !== record.processStartIdentity) {
    // A different process took the socket: the record and the answer disagree, so nothing here is
    // trustworthy and nothing is resolved automatically.
    return { state: "conflict", reason: "The owner endpoint answered as a different process than its record names." };
  }
  let uptimeMs = 0;
  try {
    const status = await askCediaOwner(record.socket, record.token, "status", timeoutMs);
    const row = status.status;
    if (status.protocolVersion !== CEDIA_OWNER_BRIDGE_VERSION || status.ok !== true || !row || typeof row !== "object" || Array.isArray(row)
        || typeof (row as { uptimeMs?: unknown }).uptimeMs !== "number" || !Number.isFinite((row as { uptimeMs: number }).uptimeMs)) {
      return { state: "conflict", reason: "The owner status response is malformed or uses an unsupported protocol." };
    }
    if (record.mode !== undefined) {
      const statusIdentity = identityFrom(status.identity);
      if (!statusIdentity || statusIdentity.mode !== record.mode
          || statusIdentity.sessionId !== record.sessionId || statusIdentity.incarnation !== record.incarnation
          || statusIdentity.pid !== record.pid || statusIdentity.ownerStartedAt !== record.ownerStartedAt
          || statusIdentity.processStartIdentity !== record.processStartIdentity) {
        return { state: "conflict", reason: "The authenticated owner status disagrees with its record identity or control mode." };
      }
    }
    uptimeMs = Math.max(0, (row as { uptimeMs: number }).uptimeMs);
  } catch (error) {
    return { state: "stale", reason: error instanceof Error ? error.message : "The owner status endpoint did not answer." };
  }
  return { state: "attached", identity: { ...identity, mode: identity.mode ?? "controller" }, uptimeMs };
}
