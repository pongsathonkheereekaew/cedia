# Code Mode initialization is OMP's own startup flow, plus a survey of the next builds — 2026-09-24

This receipt records a one-row O06 gate settlement (`initializeCodeMode` through a
source-evidence disposition) and the survey that scoped the next real builds without starting
any of them: no half-built slice is left behind. §10 item 70 owns status. No provider request
was made and no model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. No upstream change in this slice; `dist/omp/omp` not re-prepared.
- Changed for this slice: `scripts/lib/omp-coverage.ts` (one disposition); this receipt;
  `docs/maintenance/CEDIA-PLAN.md` (item 70 row).

## Settled: `initializeCodeMode`

Code Mode is applied by OMP's own startup and settings flow — initialized once when the session
starts on a Code Mode model (`sdk.ts`), re-reconciled whenever the code-mode setting changes
(`agent-session.ts` subscribes internally) — so the restricted direct surface and namespaces
snapshot exist before the first provider turn with no client call. The gate re-reads both
literals on every run.

Observed: `bun run check:omp-coverage` integrity PASS, gap count **59** (was 60), O06 sdk 4
(was 5); `--list-gaps` no longer names the row. Negative probe (evidence without the literals)
reports `unclassified`. `bun test scripts/lib`: 81 pass / 0 fail. `git diff --check` clean.

Still open in code-mode: `getCodeModeDirectToolNames` and `getEvalPreludes` stay gaps — they
are live getters with no Cedia reader, and the catalog's `active` flag already carries the
effective surface, so neither was stretched into a disposition.

## Surveyed, not claimed (next-build scoping)

- **`/pause` is unblocked and has a concrete path.** The run-pause primitive exists below the
  session: `packages/agent/src/pause.ts` is a process-global pause gate polled at the agent
  loop's action boundaries (in-flight streams and started tools run to completion, queued
  steering/follow-ups stay queued, abort still unwinds a parked loop), and "hosts drive the
  singleton" with the TUI `/pause` command as the precedent. The session exposes no pause
  method and there is no RPC for it, so a Cedia Pause needs: an upstream `pause`/`resume`
  RPC driving the gate, run-state surfacing distinct from turn boundaries, and a Pause control
  distinct from Stop (process-global vs per-session semantics need care: one runtime per
  session makes them equivalent today). Not started this turn.
- **`moveSession`/`switchSession` confirmed open.** `moveSession(newCwd, targetSessionDir?)`
  relocates the live session file and cwd from inside the session; Cedia owns cwd/worktrees at
  the host level and spawns runtimes into them, so the session-owned relocation has no Cedia
  caller. `switchSession` (same-file reload plus session switching) likewise has no Cedia
  path — Cedia resumes sessions by starting runtimes, not by switching inside one.
- **O08 discovery half confirmed open pending a surface decision.** Listing live owners means
  enumerating session directories for `owner.json` records (the probe module already decides
  one directory); where that list surfaces (CLI verb vs window surface) and what persistent
  attachment a "detach without stopping" would release are undecided — deliberately not
  guessed here.
- **Prewalk pair confirmed open.** `/prewalk` is already reachable over the prompt path (the
  slash row is integrated), but `armPrewalk` has no clean gate mechanism (no audited RPC names
  the operation; the `prompt` literal is taken by the uniqueness rule) and `getPrewalkState`
  has no Cedia reader — and the plan asks for no prewalk UI, so neither was forced.
