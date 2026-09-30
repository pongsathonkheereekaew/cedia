# §2.6: an archived task says what was kept and where Continue resumed — 2026-09-24

This receipt records the rendered half of §2.6. The host already archived and restored with a durable
receipt (`archive-receipt.json`, the immutable `refs/cedia/archive/…`, the refusal reasons), and the
window already had Restore and Delete controls; what no surface ever showed was the decision itself —
what the archive kept, and where a restored task continued. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- New: `apps/macos/agent-window/vendor/synara/apps/web/src/lib/threadRetention.ts`,
  `apps/macos/agent-window/test/thread-retention.test.ts`.
- Changed: `apps/macos/agent-window/src/cedia-adapter.ts`,
  `vendor/synara/packages/contracts/src/orchestration.ts`, `vendor/synara/apps/web/src/types.ts`,
  `.../storeNormalization.ts`, `.../components/settings/ConversationStorageSettingsPanels.tsx`,
  `apps/macos/agent-window/upstream.json`, and the session normalization tests.

## The same three-layer drop as the pending model, found in one pass

`Session.archive` was on the host's session row and had been since the archive/restore slice, but no
window could see it: `asSessions` built each row field by field and did not include it; the renderer's
`normalizeThreadSession` reconstructed the session without it; and neither snapshot key mentioned it,
so `Continue` rewriting the receipt from `retained` to `restored` would not have repainted the row.
All three are fixed here, and the receipt is validated on the way in: a record with a state, a
`dirty`/`ignored` fact and a `recordedAt`/`reason` — plus the restoration fields when the state is
`restored` — is read; anything else carries nothing.

## What the window now shows

- `threadRetention.ts` turns the host's record into the owner's words: `Kept · cedia/task-1 at
  0123456789ab · <worktree> · uncommitted changes` (or `ignored files`, or `no worktree` for a task
  that worked in the project folder), the host's own reason for retaining, and, after Continue,
  `Continued in <worktree> on <branch>` — with the case worth naming spelled out:
  `… on cedia/restore/task-1, on a new branch` when the recorded branch had moved and the host did
  not move it back.
- The Archived conversations list renders that line on each row, next to the Restore action the owner
  decides with. The theme publisher is untouched; this is presentation of the host's record, never a
  claim that files came back by itself.

## Verification

```
bun test apps/macos/agent-window/test/thread-retention.test.ts      # 3 pass, 0 fail
bun test apps/macos/agent-window/test/adapter.test.ts              # 43 pass, 0 fail
bun test apps/macos/agent-window/test/session-normalization.test.ts# 3 pass, 0 fail
bun test apps/macos/agent-window/test apps/macos/test              # 912 pass, 0 fail
bun test apps/host scripts/lib                                     # 301 pass, 0 fail
bun run --cwd apps/macos/agent-window typecheck                    # clean (includes the vendor tree)
bun run typecheck                                                  # the same 10 pre-existing errors, none new
git diff --check                                                   # clean
```

The fixtures cover the label for each retention fact, the two restoration outcomes, the `no worktree`
case, silence for an unknown state or an empty reason, the adapter carrying a real receipt and
dropping a malformed one, and the store keeping, repainting on and clearing the record.

## What this does not claim

- **No packaged or rendered-window observation.** The row's value mapping is fixture-tested; no
  running window was captured and no screenshot or accessibility read was taken.
- The sidebar's own archive action does not yet toast what was kept; the receipt becomes visible when
  the task's row refreshes. Deciding whether that moment needs its own surface is presentation work
  this slice did not take.
- Deletion of an archived task and the cleanup protocol are unchanged: cleanup stays inactive and
  nothing here removes a worktree, a branch or a file.
