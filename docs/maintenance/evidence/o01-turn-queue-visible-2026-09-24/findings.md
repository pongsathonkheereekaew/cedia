# O01: the window says how much work OMP is holding — 2026-09-24

The host has recorded a bounded turn projection per task since the §2.4 slices, and the runtime
answers `cedia_turn_queue`, but the projection was dropped on its way to any surface: `asSessions`
built each session row field by field and never carried `turns`, the renderer's session
normalization did not know it, and neither snapshot key mentioned it. So a task with three turns
queued looked exactly like an idle one. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- New: `apps/macos/agent-window/vendor/synara/apps/web/src/lib/turnQueue.ts`,
  `apps/macos/agent-window/test/turn-queue.test.ts`.
- Changed: `apps/macos/agent-window/src/cedia-adapter.ts`,
  `vendor/synara/packages/contracts/src/orchestration.ts`, `vendor/synara/apps/web/src/types.ts`,
  `.../storeNormalization.ts`, `.../components/cediaStatusBar.tsx`,
  `scripts/check-omp-coverage.ts`, and their tests.

## The same three-layer drop, third time

The pending-model record and the archive receipt had each been dropped in exactly these places; the
turn projection was too. All three now carry and compare it, and both snapshot keys include it, so a
queued turn starting repaints the task instead of waiting for an unrelated change to the session row.

## What the window says now

- The adapter projects only what a surface may draw — `turnIntentId`, `state`, `queuePosition`,
  `model`, `reason` — and deliberately not the device id or the payload hash it also receives. A
  fixture asserts the projection's exact shape and that the device identity never appears in it.
- Cedia's status bar draws one `queue` segment while the task has work in front of it:
  `running anthropic/claude-sonnet-5 · 2 waiting`, or `1 running · 1 waiting` when no model was
  reported, or `2 waiting` for a task that has not started yet. Finished work (`completed`,
  `cancelled`, `failed`) is history and draws nothing.
- A turn whose outcome Cedia cannot prove outranks the counts: `outcome unknown · <reason>` or
  `needs continue`. The counts alone would read as progress, which is exactly what §2.4 forbids.

## Verification

```
bun test apps/macos/agent-window/test/turn-queue.test.ts             # 3 pass, 0 fail
bun test apps/macos/agent-window/test/cedia-status-bar.test.tsx      # 10 pass, 0 fail
bun test apps/macos/agent-window/test/adapter.test.ts                # 44 pass, 0 fail
bun test apps/macos/agent-window/test/session-normalization.test.ts  # 4 pass, 0 fail
bun test apps/macos/agent-window/test apps/macos/test                # 920 pass, 0 fail
bun run --cwd apps/macos/agent-window typecheck                      # clean (includes the vendor tree)
bun run typecheck                                                    # the same 10 pre-existing errors, none new
bun run check:omp-coverage                                           # Integrity PASS (the 641 gap count is unchanged; see below)
git diff --check                                                     # clean
```

## What this does not claim, and what it changes in the gate

- The coverage gate still counts the `/queue` operation as **missing**, and the reason now says why:
  Cedia draws how much work is held, but not the queued submissions' own text and not a control to
  drop one. The host deliberately stores a payload hash rather than the text, so showing the text
  needs a new host projection and dropping a queued turn needs a runtime operation OMP does not
  expose over RPC yet (the audited command list has no queue mutation). Both are separate work; this
  receipt does not claim them.
- No packaged run of the segment was taken: the packaged window in this turn had no queued turns, and
  the evidence here is fixture-level.
- The `queue` reason in `scripts/check-omp-coverage.ts` was updated because its old wording
  ("no Cedia control draws it") stopped being true.
