# R3 cleanup protocol: the gates before anything is removed — 2026-09-24

§2.6 says archive changes visibility while the workspace is retained, and that automatic
cleanup may only enable after its complete protocol passes. This slice implements that
protocol and keeps it inactive. §10 item 70 remains the owner of status.

## Source state

Workspace `/Users/pond/cedia`, branch `main`, revision
`0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.

## What is implemented

- **Durable workspace metadata on the task row** (store schema v6, idempotent migration with a
  private version-named backup): task/project/repository identity, worktree root and actual
  cwd, source commit, task branch, integration target/ref and its observed commit, restoration
  ref/SHA, cleanup generation, cleanup state and last failure. Legacy rows are backfilled from
  the fields that already existed rather than from a guess.
- **State machine** `retained → archive_requested → prepared → removed`, with every refusal
  landing back in `retained` carrying an explicit reason and a durable `lastFailure`.
- **Gates, in order**: no active turn; integration ancestry proven through Git against the
  recorded target commit; tracked/untracked/ignored working-tree facts; active user/AI
  terminals; open or unsaved IDE work; and an immediate recheck of all of them before removal.
  An unavailable or uncertain check — including an external IDE or terminal probe this build
  cannot make — means `retained`, never removal.
- **Evidence before removal**: an immutable `refs/cedia/archive/<task>/<generation>` created
  with `git update-ref` against an all-zero old value (so an existing orphan ref is never
  overwritten) pointing at the actual clean task HEAD, the task branch preserved, and the
  restore receipt durably stored with state `prepared`. Removal uses `git worktree remove`
  without `--force`. Nothing deletes a branch, cleans unknown files, or removes a directory
  recursively.
- **Crash reconciliation**: a missing worktree with a valid `prepared` receipt may finish the
  recorded transition; an existing path is revalidated through every guard instead of being
  deleted because the state says `prepared`; an orphan ref is retained for reconciliation.
- **Honest availability**: cleanup is typed, reported as inactive with its reason, and has no
  automatic caller anywhere in the host.

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/host/test/cleanup.test.ts` | 12 pass, 0 fail (36 assertions) |
| `bun test apps/host` | 198 pass, 0 fail (1,133 assertions), 24 files |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1,052 pass, 0 fail (4,936 assertions), 125 files |
| `bunx tsc --noEmit` | no `apps/host` or `packages/protocol` error; the `apps/macos` errors are pre-existing at this revision |
| `git diff --check` | clean |

The cleanup fixtures cover integration ancestry proven / not proven / uncertain, dirty
tracked/untracked/ignored data, a terminal veto, an unavailable IDE check, failure to create the
ref, failure to persist the receipt, a detected race, repeated cleanup, and that nothing is
removed while the capability is inactive.

## Not claimed

- Cleanup is **not enabled**. No scheduler, no automatic caller, and no rendered cleanup
  action exist; enabling it is a separate, explicitly authorized step.
- Squash/cherry-pick equivalence is not guessed: only real ancestry through Git proves
  integration.
- Terminal and IDE liveness are host-side facts from this build; a live probe against a real
  IDE window and a real user shell was not exercised, and an unavailable probe retains.
