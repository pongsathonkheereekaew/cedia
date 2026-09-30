# Goal budget control and budget/usage read, proven live through the host route — 2026-09-24

This receipt records the O07 slice that settles the `goal budget` and `goal show` subcommands:
no new runtime, host, adapter or window code was needed — the whole vertical already existed
(runtime `goal.set` with `op: budget` and `goal.get` with budget beside usage; host owner-only
durable `POST /v1/sessions/:id/goal` accepting `budget` and controller-visible `GET`; adapter
`getGoalDetails`/`setGoalBudget`; the composer goal header's budget control with its status,
budget, tokens-used and elapsed read). What this slice adds is the missing live proof through
the real host route plus the gate settlement. §10 item 70 owns status; this file records what
was observed at the revision below. No provider request was made: the fixture model endpoint
is dead, and the turn a goal set dispatches fails in the background after the operation answers.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. No upstream change in this slice; `dist/omp/omp` not re-prepared.
- Changed for this slice: `scripts/omp-goal-budget-smoke.ts` (new, 17 live checks),
  `scripts/check-omp-coverage.ts` (two subcommand dispositions); this receipt;
  `docs/maintenance/CEDIA-PLAN.md` (item 70 row).

## What was observed

- `bun scripts/omp-goal-budget-smoke.ts`: 17 checks OK against the prepared pinned runtime
  through a real booted host — absence with a reason before start; owner `set` with a budget
  accepted with the runtime's objective and budget in the snapshot; controller GET showing the
  budget, non-negative tokens used and elapsed seconds, and live status; owner `budget` change
  accepted with the budget that follows and visible on re-read; repeated command id replays the
  same receipt; non-positive budget refused with 400 before any runtime call; goal dropped.
- Pre-existing per-hop proof, re-verified: `packages/omp-adapter/test/cedia-goal.test.ts`
  (3 pass live: set/pause/resume/budget/complete/drop), `apps/host/test/omp-progress.test.ts`
  (POST goal routes every op including `budget` with idempotent replay),
  `apps/macos/agent-window/test/adapter.test.ts` ("projects live goal details and routes budget
  changes to OMP": details projection plus the exact `{op: budget, tokenBudget}` POST body).
- `bun run check:omp-coverage`: integrity PASS, 1,041 audited records with 1,041 Cedia mappings,
  live `omp/18.1.18`; gap count **67** (was 69), O07 slash-subcommand 0 (was 2).
  `--list-gaps` no longer names `goal budget` or `goal show`.
- `bun test scripts/lib`: 81 pass / 0 fail. `node scripts/ci-validate.mjs`: CI-OK.
- `git diff --check` clean.

## Still open (not claimed)

- O07: `applyAdvisorConfigs` (the runtime's TUI editor), `armPrewalk`/`getPrewalkState`,
  `/agents`, `/guided-goal`, `/hub`, `/loop`.
- No packaged window was captured driving the budget control; the header's budget section has
  no rendered-component test (its query/parse/mutation halves are covered at the adapter layer).
