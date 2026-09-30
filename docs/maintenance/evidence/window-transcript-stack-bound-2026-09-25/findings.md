# Fix (window transcript blanked by the unbounded composer panel stack) — 2026-09-25

Resolves the `window-transcript-render-2026-09-25` defect note. The window smoke
failed at the first send: the turn completed in the host journal, adapter
snapshots emitted and synced (store ended with the full 40-character fixture
response), the view bound the right thread with 2 timeline entries — yet the DOM
held zero message rows. §10 item 70 owns status. No provider request was made.

## Bisect (same headless harness, same host/fixture; only the bundle varied)

| Variant | Result |
|---|---|
| All 13 composer surfaces mounted (baseline) | FAIL, ~10 consecutive runs, first-send timeout, 0 renderer errors |
| 02:36 packaged bundle + current host/fixture (`--native`) | PASS full (send, reload, second task, IDE handoff) |
| 6 suspect vendor files reverted to HEAD (ChatView, turn execution, normalization, root subscription, thread route, timeline) | PASS first send + reload |
| ChatView.tsx alone reverted to HEAD | PASS first send |
| 13 surfaces mounted, all queries silenced (no poll, no per-snapshot invalidation) | FAIL |
| 13 surfaces mounted, panel stack `display:none` (queries still fire) | PASS |
| 13 surfaces mounted, stack bounded (`maxHeight: 200`, own scroll) | PASS full |
| Minus Plan / minus Progress / minus Tree / minus Shell (12 surfaces each) | PASS full, all four |
| Plan poll off, both mounted | FAIL |
| Per-snapshot invalidations off, both mounted | FAIL |

Reading: presence of all 13 *visible* panels is necessary; query traffic is not
the trigger (mount-fetch-only still fails, `display:none` passes with full
traffic). Removing any one of four different surfaces passes, so it is the
cumulative stack size, not one panel's logic. The unbounded stack squeezes the
transcript pane during updates and the virtualized list blanks permanently (no
later data change forces a recompute).

Falsified along the way (each measured live, not inferred): adapter push
starvation (5 emits reached 1 listener), store merge dropping text (store ended
full), wrong-thread binding (route = active = session), duplicate message ids
(`<incarn>:message:12` vs `:14`), Plan 1 s poll as trigger, per-snapshot
invalidation as trigger.

## Fix (one wrapper, no behavior change)

`apps/macos/agent-window/vendor/synara/apps/web/src/components/ChatView.tsx`:
the composer panel-stack wrapper is now `max-h-50 overflow-y-auto` with a
comment naming the failure mode. The bound only engages on overflow; with fewer
panels nothing changes. No query, subscription, normalization, or adapter code
changed. No surface removed, reordered, or collapsed.

## Proof

- `bun scripts/build-agent-window.ts`: green.
- `bun scripts/agent-window-smoke.ts`: `Agent Window UI smoke passed`
  (`result.json`: `ok: true`, `providerCalls: 0`, `errors: []`; first send,
  reload persistence, second task in its own worktree, IDE handoff all green).
  `conversation.png` shows user echo + fixture response above the panel stack.
- `bun test apps/macos/agent-window/test`: 382 pass, 0 fail, 74 files.
- `git diff --check`: clean; no probe, bisect-variant, or stash residue — the
  temporary `CEDIATMP`/`CEDIBISECT`/`H*-TEST` edits and both bisect stashes were
  fully reverted/popped during the session (verified by grep: 0 hits).

## Not claimed

- The virtualizer-level why (why the list blanks instead of recovering) is
  still open; the fix removes the triggering layout condition.
- No coverage gap change (stays **2**: `switchSession`, `browser-relay`, both
  with their recorded reasons). D1–D5 exclusions, `switchSession` open status,
  and OMP-native provider auth are untouched.
- No packaged capture of this exact bundle yet; the 02:36 package predates the
  fix and packaging is separately blocked (see
  `o10-packaged-driving-prereqs-2026-09-25`).
