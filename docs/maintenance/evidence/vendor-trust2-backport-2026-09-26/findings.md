# Selective intake batch 4: foreground consent (#1312) + process safety (#1270) — 2026-09-26

Both assessed as NO-CHANGE with evidence, plus one pinning test for the exact
#1270 case. No product behavior changed. No provider involvement. §10 item 70
owns status.

## #1312 foreground consent: NO-CHANGE (boundary complete)

The native browser resource (attach/drive/navigate) is reachable only through
paths that already require local-window ownership plus explicit user action:

- Production IPC authorizes by main-frame window identity
  (`authorize: event => !!windowForEvent(event)` in
  `desktop/src/vs/code/electron-main/app.ts`); the handler refuses anything
  else ("Untrusted Agent Window sender"), and that refusal is covered by the
  trusted/untrusted patterns in `apps/macos/test/agent-window-main.test.ts`.
  Remote and paired clients never reach Electron IPC — and the host router
  exposes no browser/cdp/tab/attach routes at all (verified by search), so no
  controller path to tabs exists.
- UI consent: the attach bar sends Attach only behind outcome-stating
  confirms, and nothing auto-attaches (explicit tab ids; the active-tab
  fallback is deliberately excluded from the agent path).
- No code from the upstream consent gate was copied: its server/approval
  machinery answers a different ownership model, and duplicating an approval
  loop around an already-gated local bridge would add a second owner.

## #1270 process safety: NO-CHANGE (defenses complete) + pinning test

- No arbitrary-PID signaling exists: the adapter reaps only its own spawned
  child (TERM-then-KILL with exit/drain accounting); the host never kills by
  PID at all.
- Both liveness probes are signal-0 (no-op) and fail closed; `isProcessAlive`
  additionally validates integer/positive.
- The owner record parser rejects non-integer/non-positive pids before any
  probe runs, so an invalid pid is unreachable through the record path.
- New pin (in the malformed-record test): pids `-1`, `0`, `1.5`, `NaN` all
  resolve to conflict, never to a probe. Green with the file's suite.
