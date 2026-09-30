# Packaged restore observed: archive → resume in the running window — 2026-09-26

Closes the D-audit open item "no packaged run of restore observed".
Extends the shared smoke (`scripts/agent-window-smoke.ts`: archive the
worktree-backed second task through the host-owned pair, assert the
retained receipt, restore, reload the window, assert the restored
transcript renders, capture `archived-restored.png`, reinstall the
command-recording proxy). No gap change (stays **2**). §10 item 70 owns
status. No provider involvement.

## Observed (current tree, both modes green)

- Headless (`dist/agent-window-smoke`): `ok: true`, 0 provider calls,
  `errors: []`; `archiveRestore` records worktree + immutable
  `refs/cedia/archive/…` + commit; restored transcript rendered after
  reload (`archived-restored.png`, 56 KB).
- Packaged (`--native`, `dist/agent-window-native-smoke`): same full flow
  in Cedia.app — send, reload, second task, archive → resume with
  worktree/ref/commit recorded, restored transcript rendered, IDE
  open/return — `ok: true`, 0 provider calls, 0 renderer errors.
- `bun run check:packaged` still all-OK (only the smoke script changed,
  not the bundle; no repackage owed).

## Honestly scoped

- The pair was driven through the host API (`archiveSession` /
  `restoreSession`); the window observed the restored state (transcript
  after reload + capture). The Archived-list Continue button itself was
  not clicked — that UI path stays open.
- D1–D5, deferred voice, `switchSession` open. Pin unchanged. Nothing
  committed; uncommitted tree preserved (`git diff --check` clean).

## Addendum: re-verified on the current bundle (2026-09-26)

Re-ran `--native` after batches 23–29 landed in the bundle: same full flow
green (`ok: true`, 0 provider calls, 0 renderer errors, `archiveRestore`
present). No flakes across runs.
