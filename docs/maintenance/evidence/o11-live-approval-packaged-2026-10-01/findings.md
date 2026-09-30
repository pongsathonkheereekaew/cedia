# Packaged on-screen approval loop, agent-driven — 2026-10-01

## Result

PASS. One bounded write turn on `opencode-go/muse-spark-1.3-contributor`
(user-approved unlimited row) from the on-screen IDE dock composer of a staged
scratch Cedia.app, typed by the agent through computer-use (single-keystroke
probe, select-all, full-prompt keystrokes — clipboard paste does not deliver on
this surface). The broker `select` approval rendered as a production card
(Allow tool: write, exact path and content, Approve/Deny toggles, bell and
status-bar approval indicators); the agent clicked Approve. The turn completed
with a byte-exact file. Exactly one turn ran. Staged Electron exited 0 with
zero surviving staged processes (harness guards green).

## Runtime evidence

- Runner: `bun scripts/omp-live-approval-packaged-proof.ts`
  (`CEDIA_APPROVAL_USE_IDE=1`) with an explicitly staged scratch Cedia.app
  (Login Item shimmed, re-signed; installed app never launched) against an
  in-process source host + pinned OMP 18.4.3 with the user's own auth (scratch
  copy) and an always-ask overlay. Scratch project only.
- Run ID: `2026-09-30T17-28-41-275Z` (UTC; Oct 1 +07).
- Assertions green: fixture composer visible; broker holds
  `select:Allow tool: write` with the exact path; approved write lands
  byte-exact; exactly one turn completed.
- `result.json` and screenshots (`agents-composer.png`, `ide-dock-state.png`,
  `approval-prompt.png`, `turn-completed.png`) are under the ignored runtime
  output directory `dist/live-approval-packaged-proof/<runId>/`.
- The staged Login Item shim intercepted its setter calls. This is not a Login
  Item or macOS login-cycle test.

## Input-method note (Agents vs IDE dock composer)

Clipboard paste delivers into the IDE dock webview composer but times out
unread on the standalone Agents window composer; single keystrokes deliver in
the IDE dock once the editor holds focus (coordinate click to the text line).
Thai-layout machine: Latin keystrokes arrived intact through this path. The
input path itself was already proven by the Send-race receipt; this receipt
proves the approval loop, not text entry.

## Limits

This closes the on-screen composer approval-click runtime receipt (items 1,
32). Still open: live streaming in-place verification (33),
attachment-carrying live turn (34), visible tool output receipt (35), remaining
F semantic/dynamic packets, and full D/W/N/F acceptance.
