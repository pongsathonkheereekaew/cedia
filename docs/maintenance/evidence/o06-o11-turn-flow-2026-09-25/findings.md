# Turn-flow internals plus the deferred voice exclusion — 2026-09-25

This receipt records a four-row gate settlement with no new runtime, host or window code:
three O06/O11 SDK rows settled as OMP-internal turn flow through source-evidence
dispositions the gate re-reads every run, and the `/live` slash row excluded with the
owner's voice-input deferral. §10 item 70 owns status. No provider request was made and no
model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. No upstream change in this slice; `dist/omp/omp` not
  re-prepared.
- Changed for this slice: `scripts/lib/omp-coverage.ts` (three dispositions),
  `scripts/check-omp-coverage.ts` (one exclusion); this receipt;
  `docs/maintenance/CEDIA-PLAN.md` (item 70 row).

## What changed (one disposition per SDK row, each with re-read source evidence)

- `reload` (O06): the session-reload action in the extension command-context table, invoked
  by extension, ACP and TUI hosts — never by Cedia. Cedia resumes sessions by starting
  runtimes (archive/restore) and never reloads inside one.
- `hasPendingAsyncWork` (O11): the quiescence barrier the task executor polls inside OMP's
  own turn flow. Cedia observes turn outcomes at boundaries instead of polling the barrier.
- `settleAsyncWork` (O11): draining owner-scoped async work inside OMP's own turn
  completion, looped by the executor while the barrier holds. Async results reach Cedia
  through OMP's own follow-up turns.
- `/live` (O12 slash): excluded, not implemented. Starting Codex-backed realtime voice mode
  is voice input, which the owner deferred across all clients on 2026-09-23 — all voice
  input is outside this delivery in every language and client (plan §1257, §2.3). The TTS
  output rows are untouched by this: deferring input does not defer speech output, and the
  plan says so explicitly.

## What was observed

- `bun run check:omp-coverage`: integrity PASS, 1,041 audited records with 1,041 Cedia
  mappings, live `omp/18.1.18`; gap count **47** (was 51). `--list-gaps` no longer names
  any of the four rows.
- Negative probes: evidence text without the literals reports `unclassified` for all three
  SDK rows — every guard holds. (`live` carries no needle guard, like the existing `debug`
  exclusion: its protection is the dated audit plus the plan deferral it cites.)
- `bun test scripts/lib`: 81 pass / 0 fail.
- `git diff --check` clean.

## Still open (not claimed)

- `getAsyncJobSnapshot` stays a gap honestly: unlike the barrier and the drain, the running
  and recent job list is state a client can meaningfully show, and the O11 packet wants job
  views — a future job surface carries it, not a disposition.
- O06 keeps `refreshMCPTools`, code-mode getters, `/extensions`, `status` and dynamic
  tools; O11 keeps eval-adjacent rows already closed except async jobs, work pools and IRC.
- No behavior changed anywhere in this slice. If a future upstream revision moves any cited
  literal, the gate fails instead of leaving the claim standing.
