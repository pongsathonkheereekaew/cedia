# The two Mac windows now push a committed draft revision to each other — 2026-09-24

This receipt records the push half of R2's shared draft contract (§2.5 item 1: "a database
transaction updates only that revision and broadcasts the new one to both Mac windows"). The
pull half (hydrate on route change and focus) and the Send reservation already existed; until now
the two windows converged only when one of them was looked at. It also records a real defect the
new fixture caught: after a Send delivered a draft, that task's shared draft owner refused every
later write. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- `apps/macos/src/agent-window-main.ts`, `apps/macos/src/agent-window-bridge.ts`,
  `apps/macos/agent-window/vendor/synara/apps/web/src/sharedUiDraftBridge.ts`, and their tests.

## What changed

- The main process is the fan-in point, because it is the only place both Mac windows meet. A
  committed host revision is published on `vscode:cedia-draft-updated` to every window except the sender
  (`publishDraftUpdate`, with the sender read from the IPC event and a window that closes
  mid-publish ignored rather than fatal). The host stays the record's owner; nothing here keeps a
  second authority.
- Both renderers subscribe to that channel through the same bridge they already used for reads and
  writes. A window with nothing pending adopts the newer revision outright. A window that typed
  since its last confirmed revision keeps its text and gets the existing choose-a-side conflict,
  so neither version is discarded (§2.5 item 1).
- A Send's authoritative clear now publishes `delivered`, and the receiving window resets its base
  revision to the restarted one (`0`) instead of continuing from the delivered revision. A window
  that is still composing keeps its text; one that is not loses a draft that has already been sent.
- **Defect found and fixed.** The host *deletes* a delivered draft record, so a task's revision
  space restarts at 1. The window's next write still names the delivered revision, the host answers
  409, and the conflict path had two outcomes, both wrong. If this main process had not read that
  task yet, `read` re-imported the window's own offline cache as if it were a pre-host draft, so the
  write was answered as a conflict with the very text it had just written. If a read had already
  happened (the import is spent once per task), the write was answered `unavailable`: the text
  stayed in the local cache and every later edit repeated the same refusal without ever reaching
  the host. Which of the two happened depended on whether the window had hydrated the task, which
  is not a contract. The conflict path now asks the host what it actually holds, without the import
  step: a real row is still a conflict with that row, and no row at all means the previous draft
  was delivered, so the write continues as the first revision of the next draft.

## Verification

```
bun test apps/macos/test/shared-draft.test.ts                      # 12 pass, 0 fail
bun test apps/macos/agent-window/test/shared-ui-draft.test.ts      # 9 pass, 0 fail
bun test apps/macos/test apps/macos/agent-window/test              # 890 pass, 0 fail
bun test apps/host scripts/lib                                     # 301 pass, 0 fail
bun run --cwd apps/macos/agent-window typecheck                    # clean (includes the vendor tree)
bun run typecheck                                                  # the same 10 pre-existing errors, none new
git diff --check                                                   # clean
```

The push path is covered by fixtures at both ends: the main process publishes `written` with the
committed revision and `delivered` after a matched clear, never publishes on a refused clear, and
skips the sender; the renderer adopts a pushed revision, opens the conflict instead of overwriting
an unsaved edit, treats `delivered` as a fresh revision space, and stops listening on dispose.

## Correction from the packaged run (same day)

Running the packaged app found the channel this receipt introduced was named outside the namespace
the Code-OSS preload delivers: it is `vscode:cedia-draft-updated` now, because the packaged Agents
window refused to start with `Unsupported event IPC channel 'cedia:draft-updated'`. See
[the packaged two-window run](../r8-packaged-two-window-2026-09-24/findings.md). The fixture evidence
below still describes the mechanism; the channel name it quotes is the corrected one.

## What this does not claim

- **No packaged or two-window run.** This is fixture evidence: two renderer instances against one
  main process, and one main-process publisher against a fake window list. A packaged run with both
  windows open on one task is still owed by R2/R4 (§2.5's own wording: "Existing single-renderer
  write-chain tests are necessary but insufficient").
- **A rendered choose-a-side surface was not observed.** The conflict object and its resolution are
  tested; the on-screen control was not exercised.
- The IDE window's renderer shares the same bridge and therefore subscribes too, but this receipt
  does not measure the IDE webview as a second independent renderer.
