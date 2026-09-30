# Slice (`/move <existing-dir>` relocates headless; `moveSession` settled)

The standing claim was that both `/move` forms hang headless
(evidence/o02-move-headless-hang-2026-09-25/). Re-probing on the current pinned
patch (manifest sha `2ab75a7c`, was `519c9494` at the earlier probe) splits the
forms: bare `/move` still times out at 15 s on its overlay cancel path, but
`/move <existing-dir>` returns in ~250 ms with `agentInvoked: false`.

## What the run proves

- The with-args form dispatches through the headless handler
  (`relocateHeadlessSession` in builtin-lifecycle.ts) into the session's own
  `moveSession`: `get_state` names a new session-file path afterwards, the
  relocated file exists on disk, and the source file is gone (rename, not copy).
- No model turn runs and no provider request leaves the machine.
- Bare `/move` still hangs (15 s timeout, outcome unknown) - re-verified the same
  day on the same patch, so the fence stays.

## Gate changes

- `moveSession` (O02 sdk) settles through the SDK slash-link rule (`{ name:
  "moveSession", slash: "move" }`, following the `setModelTemporary`/`switch`
  precedent: bare form inert, with-args form the carrier), with an
  `sdkPresentation` entry citing the smoke.
- The `move` hang-table reason now states the split instead of claiming both forms
  hang; the entry itself stays (bare still hangs) and the composer-menu guard is
  unchanged (typed text still passes through).
- `slash move` and `sdk switchSession` stay open honestly.

## Proof

- `bun scripts/omp-move-smoke.ts`: 9 checks OK (run twice).
- `bun run check:omp-coverage`: integrity PASS, gaps 19 -> 18.
