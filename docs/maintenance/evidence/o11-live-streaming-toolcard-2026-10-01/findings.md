# Packaged streaming + tool-card receipts, agent-driven — 2026-10-01

## Result

PASS. One read-only live turn on `opencode-go/muse-spark-1.3-contributor`
(user-approved unlimited row) from the on-screen IDE dock composer of a staged
scratch Cedia.app, typed by the agent through computer-use (ABC layout,
single-keystroke probe, select-all, full-prompt keystrokes, on-screen Send
click). Event journal shows `message_update` streaming frames before turn end,
`tool_execution_start` → `tool_execution_end`, terminal `turn_end`/`agent_end`,
exactly one completed turn. A mid-stream screenshot and an expanded tool-row
capture retain the visible evidence. Staged Electron exited 0 with zero
surviving staged processes (harness guards green).

## Runtime evidence

- Runner: `bun scripts/omp-live-streaming-toolcard-proof.ts` with an explicitly
  staged scratch Cedia.app (Login Item shimmed, re-signed; installed app never
  launched) against an in-process source host + pinned OMP 18.4.3 with the
  user's own auth (scratch copy) and an always-ask overlay (no approval arose
  on the read-only turn). Scratch project only.
- Run ID: `2026-10-01T02-33-55-536Z` (UTC; Oct 1 +07).
- `result.json` and screenshots (`streaming-mid-turn.png`,
  `toolcard-expanded.png`, `turn-completed.png`, IDE dock states) are under the
  ignored runtime output directory `dist/live-streaming-toolcard-proof/<runId>/`.
- The staged Login Item shim intercepted its setter calls. This is not a Login
  Item or macOS login-cycle test.

## Input-method note

Clipboard paste does not deliver into these composers (recipient never reads
the pasteboard); single keystrokes deliver but follow the active input source
(Thai layout maps Latin keys to Thai glyphs — confirmed live with a probe
character). The passing run typed with the ABC layout active. The input path
itself was already proven by the Send-race receipt; this receipt proves
streaming and tool output, not text entry.

## Prior attempt retained as failure

`2026-10-01T00-49-45-477Z`: the same turn stalled model-side (thinking + tool
start journaled, then no completion frames; projection completed via the
submission boundary). A host-level rerun of the identical prompt minutes later
completed with full frames, confirming upstream flakiness rather than a harness
or product defect. No spend beyond trivial text turns.

## Limits

This closes the live streaming in-place (33) and visible tool output (35)
runtime receipts. Still open: attachment-carrying live turn (34), remaining F
semantic/dynamic packets, and full D/W/N/F acceptance.
