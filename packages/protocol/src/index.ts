/** Cedia application protocol. OMP remains the execution/transcript authority. */
export const CEDIA_PROTOCOL_VERSION = 1 as const;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Project {
  id: string;
  path: string;
  name: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
}

export interface Session {
  pinned?: boolean;
  id: string;
  projectId: string;
  title: string;
  cwd: string;
  sessionFile: string;
  incarnation: string;
  status: "idle" | "running" | "stopped" | "recovery_required";
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Set when this session is a sidechat fork: the id of the task it was forked
   * from. `null` for an ordinary session; the host stamps it on every session
   * row it serves, because that relationship decides whether a client may
   * re-open an existing fork id instead of creating a new task.
   */
  sidechatSourceThreadId?: string | null;
}

export type CommandStatus = "claimed" | "acknowledged" | "completed" | "failed" | "outcome_unknown" | "not_dispatched";
export interface Command {
  sessionId: string;
  commandId: string;
  deviceId: string;
  incarnation: string;
  kind: string;
  payload: Json;
  payloadHash: string;
  status: CommandStatus;
  ack?: Json;
  result?: Json;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionEvent {
  sessionId: string;
  incarnation: string;
  sequence: number;
  timestamp: string;
  frame: Json;
}

/**
 * One run of adjacent visible cells sharing a style. Rows are 0-based within the
 * checkpoint grid; `col` is the 0-based starting column. Colours are `#rrggbb`.
 */
export interface TerminalCheckpointRun {
  readonly row: number;
  readonly col: number;
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly foreground?: string;
  readonly background?: string;
}

/**
 * One checkpoint of a virtual terminal, as the host keeps it.
 *
 * OMP owns the PTY; the host keeps a headless screen per terminal so a client that
 * attaches (or reattaches) can restore the screen instead of replaying a bounded chunk
 * history. `lastSequence` is the highest `cedia_terminal_output` sequence folded into
 * this screen, and `historyIncomplete` says the host itself dropped a gap and cannot
 * vouch for the whole grid.
 */
export interface TerminalCheckpoint {
  terminalId: string;
  title?: string;
  cols: number;
  rows: number;
  cursorRow: number;
  cursorCol: number;
  /** Visible rows, right-trimmed; trailing blank rows are dropped. */
  lines: string[];
  /** Styled runs of the visible grid; absent when the engine reported no cells. */
  readonly runs?: readonly TerminalCheckpointRun[];
  lastSequence: number;
  closed: boolean;
  closeReason?: string;
  historyIncomplete: boolean;
}

export interface CommandRequest {
  commandId: string;
  incarnation: string;
  command: string;
  payload?: { [key: string]: Json };
}

export interface UiResponseRequest {
  commandId: string;
  incarnation: string;
  token: string;
  answer: string | boolean | { cancelled: true; timedOut?: boolean };
}

/**
 * One page of a session's event journal.
 *
 * A host that bounds a session's journal (retention drops that session's oldest
 * frames once it crosses a cap) owes every reader two extra facts, so a short
 * page is never mistaken for a whole history:
 *
 * - `firstSequence` is the oldest sequence the host still holds, 0 when the
 *   session has no events at all.
 * - `historyTruncated` says retention dropped older frames, so this page is not
 *   the session's whole history.
 *
 * Both are optional because a client also builds pages of its own (a local
 * replay, a test fixture) where no host retention decision exists; a bounded
 * host always sends both.
 */
export interface EventPage {
  events: SessionEvent[];
  cursor: number;
  hasMore: boolean;
  /** Oldest sequence the host still holds; 0 when the session has no events. */
  firstSequence?: number;
  /** True when the host dropped this session's oldest events. */
  historyTruncated?: boolean;
}

export interface HostDescriptor {
  protocolVersion: typeof CEDIA_PROTOCOL_VERSION;
  url: string;
  /** Stored only in the private local descriptor; never returned by health. */
  token: string;
  pid: number;
}

export interface ApiError {
  error: { code: string; message: string };
}
