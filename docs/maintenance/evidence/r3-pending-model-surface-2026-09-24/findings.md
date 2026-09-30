# The held model change reaches the window and is drawn as "awaiting OMP" — 2026-09-24

This receipt closes the last §2.4 item that was still invisible: the record and the deferred
request existed on the host and in the adapter, but three layers dropped it before any surface
could draw it, so a model change waiting for OMP looked exactly like a change already in effect.
§10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- `apps/macos/agent-window/src/cedia-adapter.ts`,
  `apps/macos/agent-window/vendor/synara/packages/contracts/src/orchestration.ts`,
  `vendor/synara/apps/web/src/types.ts`, `.../storeNormalization.ts`,
  `.../components/cediaStatusBar.tsx`, and their tests.

## Defects found and fixed

The previous receipt for the pending-model path said the request "travels to the window". It did
not, in three separate places, and each one alone was enough to hide it:

1. **The adapter's session parser dropped it.** `asSessions` builds each row field by field, and
   `pendingModel` was not among them, so a session that carried the record arrived at every
   downstream reader without it.
2. **The renderer's session normalization dropped it too.** `normalizeThreadSession` reconstructs
   `Thread["session"]` from the fields the UI uses; it neither carried `pendingModel` nor compared
   it, so even a row that arrived with the record would have been normalized away.
3. **Neither snapshot key mentioned it.** A held change is stored against the *task*, not against
   the OMP session row, so `session.updatedAt` can stand still while it moves. Both the thread key
   and the shell key now include the record, which is what makes a poll repaint at all.

## What changed

- `isPendingModelRecord` accepts only the host's own vocabulary (a positive integer revision, one
  of `awaiting`/`in-effect`/`refused`, an ISO acceptance time and a `requested` object). A row
  that does not match carries nothing rather than a half-read record.
- The vendored contract gains `OrchestrationSessionPendingModel` on `OrchestrationSession`, and
  the renderer's `ThreadSession` gains the same shape, so the record survives decoding and
  normalization instead of being an undeclared extra.
- `normalizeThreadSession` carries it, compares it (a change to the record alone still repaints),
  and drops it when a session stops holding one.
- Cedia's own status bar draws it (`cediaStatusBar.tsx`): `model change · awaiting OMP ·
  provider/model` while OMP has not committed, `model change · in effect · provider/model` with
  `· applied at once` when the runtime has no turn boundary, and `model change · refused · reason`
  otherwise. It is a separate segment from the effective-model segment, so a request is never
  drawn as the model in use.

## Verification

```
bun test apps/macos/agent-window/test/adapter.test.ts               # 42 pass, 0 fail
bun test apps/macos/agent-window/test/cedia-status-bar.test.tsx     # 9 pass, 0 fail
bun test apps/macos/agent-window/test/session-normalization.test.ts # 2 pass, 0 fail
bun test apps/macos/agent-window/test                               # 142 pass, 0 fail
bun test apps/macos/test apps/host scripts/lib packages/omp-adapter  # 1122 pass, 0 fail
bun run --cwd apps/macos/agent-window typecheck                     # clean (includes the vendor tree)
bun run typecheck                                                   # the same 10 pre-existing errors, none new
git diff --check                                                    # clean
```

New fixtures prove: the adapter emits the record on the thread snapshot; an unchanged poll emits
nothing while a change to the record alone emits a second snapshot with the committed state; the
store keeps the record, repaints when only it changes, and clears it when the session stops
holding one; and the status bar names awaiting/in-effect/refused honestly, including that a
runtime without a turn boundary applied the change at once.

## What this does not claim

- **No packaged or rendered-window observation.** The surface is drawn by a Cedia-owned component
  and its value mapping is fixture-tested, but no screenshot or accessibility read of a running
  window was taken in this slice.
- The rendered text lives in the Cedia status bar. Whether the composer's own model control should
  also show the held change is a presentation decision this slice did not make; the data path it
  needs now exists.
- The host's own half was measured earlier (`r3-pending-model`, `r3-pending-model-desktop`) and is
  not re-measured here; this slice adds the renderer path.
