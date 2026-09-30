# Slice (O02 `/move` headless hang): falsified carrier, one honest gap added

This slice started as a carrier hunt for the O02 SDK row `moveSession` and ended by
falsifying the gate's standing claim underneath it. No new runtime, host or window code.

## What was believed

`/move` is audit-reachable over rpc/acp, so the gate's blanket rule marked slash `/move`
as carried by Cedia's prompt path — and `handleMoveCommand` does call
`#relocateSession` → `session.moveSession`, which looked like a via-slash settlement in
the making (same shape as `/switch` → `setModelTemporary`).

## What the probes showed

Three provider-free probes, all with the virtual terminal negotiated exactly as the Cedia
host does it (`CEDIA_RPC_VIRTUAL_UI=1` + `cedia_terminal_negotiate`):

1. `--no-session` mode, `/move subdir` (existing dir, so no create-confirm path):
   prompt times out at 15 s, outcome unknown.
2. `--no-session` mode, bare `/move`, then `/move subdir` on the same client:
   both time out at 8 s with outcome unknown.
3. Production-style `--session <file> --session-dir <dir>` session, `/move subdir`:
   times out at 10 s with outcome unknown.

So both the bare form (overlay cancel path via `showHookCustom`) and the with-args form
(`relocateSession` → `moveSession` → `applyCwdChange`) hang headless, with and without a
session — likely the session-move/cwd-change machinery waiting on TUI-only interaction.
Reproduce with any `OmpRpcClient` script in the shape above against `dist/omp/omp` at the
pinned patch; nothing provider-backed is involved (zero provider hits in every probe).

## Gate change

- `scripts/check-omp-coverage.ts`: new `slashHangHeadless` exception table (currently only
  `move`) wired into the slash loop's `available` computation and reason chain. A reachable
  command with a hang entry becomes `integration_missing` carrying the probe reason instead
  of `integrated`. Deliberately minimal: no per-command test harness (a timeout-expecting
  test would be flaky by design), and the table comment orders a re-probe before removal —
  an upstream fix would silently keep the gap open, which is the safe side.
- `moveSession` (O02 sdk) stays open: its slash hangs and no Cedia surface sends an
  equivalent RPC, so there is no carrier. Same for `switchSession` (no Cedia sender for
  `switch_session`) and `branchFromBtw` (`/btw` is TUI-only) — surveyed, not started.

Gap count **37** (was 36): the number goes up because a false green is removed, the same
direction as the earlier RPC-row-evidence slice.

## Proof

- `bun run check:omp-coverage`: integrity PASS; new `GAP O02 slash move` row carries the
  hang reason verbatim.
- `bun test scripts/lib` (84 pass).

## Opened (not closed) by this slice

- The composer still lists `/move` from the runtime's own `available_commands` catalog, and
  sending it wedges the turn with outcome unknown. A future slice should either hide/guard
  the row in Cedia's menu or reconcile the moved cwd with the host's task record (R3 owns
  task cwd) — until then the hang reason above is the honest label.
- `/wt` shares the `#relocateSession` machinery: probed 2026-09-25 (with-session client, `/wt probe-branch` in a fixture git repo) and answers fast with `agentInvoked: false` — but only via its fail-fast error path (`Worktree creation failed: Not inside a git repository`, the probe-environment cwd), so the relocate path is still unexercised and `/wt` is untouched; systematic hang-testing of
  every reachable slash command is future work.

## Addendum 2026-09-25 (O02 handler census + full matrix)

- `btw`, `tan`, `omfg`, `cleanse` each expose only a `handleTui` controller path
  (`builtin-lifecycle.ts` into `handleBtwCommand` / `handleTanCommand` /
  `handleOmfgCommand` / `handleCleanseCommand`); none has a prompt-path `handle`, so none
  can carry an SDK row the way `/switch` or `/mcp reload` do. The O02 carrier hunt is
  closed: `moveSession` (hanging slash), `switchSession` (no Cedia sender for
  `switch_session`), `branchFromBtw` (TUI-only `/btw`) all stay open with recorded reasons.
- Full verification matrix green on the current tree: 1328 pass across
  `packages/omp-adapter`, `packages/relay`, `apps/host`, `apps/macos/test` and
  `scripts/lib`; 302 pass in `apps/macos/agent-window/test`; gate integrity PASS at 37
  gaps; `ci-validate` CI-OK; `git diff --check` clean.
- `bun run typecheck` is fully clean (0 errors): the four type errors the gate rebuild
  introduced were fixed in place, and the 10 pre-existing `apps/macos` errors recorded in
  HANDOFF are gone from the current tree.
