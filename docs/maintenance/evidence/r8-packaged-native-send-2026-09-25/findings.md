# The fresh package sends, branches, opens the IDE and returns — 2026-09-25

This receipt records a native packaged run of the current tree: the repackaged
`Cedia.app` (previous slice) launches, renders the Agents window, completes the
full agent-window smoke — first send, reload persistence, second thread in its
own worktree, Open in IDE, return to Agents — with zero renderer errors and zero
provider calls. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Packaged `Cedia.app` from `bun run package:mac` (previous slice), stamp patch
  set `086d31f75d36` (18 patches); `bun run check:packaged` 12/12 OK before
  this run.
- No product code changed for this slice; the run exercises the tree as it stands.

## What was observed

- `bun scripts/agent-window-smoke.ts --native`: `Agent Window UI smoke passed`.
- First send answers `Fixture response` and survives reload; the second thread is
  created in its own worktree through the busy-project default with the real
  (unshimmed) Git panel; Open in IDE opens the second window and Meta+Shift+A
  returns to two live windows.
- `result.json`: `ok: true`, `providerCalls: 0`, IDE handoff cwd canonical,
  `errors: []`. Screenshots (`home`, `conversation`, `restored`,
  `returned-from-ide`) in `dist/agent-window-native-smoke/`.
- This run certifies the recent renderer slices in the real Electron path:
  fresh-profile settings defaults, idle→ready session status with the worktree
  default it enables, and the fixture URI-scheme echo — all live without the
  browser harness shims.

## Still open (not claimed)

- Login cycle, background launch, crash/adoption and update paths: untouched by
  this run, keeping whatever status the handoff's not-verified list gives them.
- No OAuth account, provider sign-in, service tier or reset spend; no Tailscale
  or off-LAN leg; no physical iPhone.
