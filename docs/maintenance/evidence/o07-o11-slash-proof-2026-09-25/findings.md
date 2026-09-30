# Live prompt-path proof for the slash-carried operations — 2026-09-25

This receipt records a hardening slice with no gap change: the two SDK rows settled last
turn through `OMP_SDK_VIA_SLASH` (`armPrewalk` via `/prewalk`, `getAsyncJobSnapshot` via
`/jobs`) rested on audit reachability plus the generic prompt-path proof. This slice runs
both commands live over the prompt path and names them in the rows' presentation. §10 item
70 owns status. No provider request was made and no model turn ran.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. No upstream change in this slice; `dist/omp/omp` not
  re-prepared.
- Changed for this slice: `scripts/omp-slash-smoke.ts` (two candidates),
  `scripts/check-omp-coverage.ts` (two presentation test strings); this receipt;
  `docs/maintenance/CEDIA-PLAN.md` (item 70 row).

## What was observed

- `bun scripts/omp-slash-smoke.ts`: `/jobs` and `/prewalk` both answer with
  `agentInvoked: false`, zero provider requests, and no started turn — the same bar as the
  six existing candidates. `/jobs` reports no background jobs; `/prewalk` answers the
  usage refusal (no `@smol` model is configured in the fixture env) without invoking the
  agent.
- `bun run check:omp-coverage`: integrity PASS, gap count **41** (unchanged — this slice
  strengthens the proof behind two settled rows rather than settling new ones).
- `bun test scripts/lib`: 84 pass / 0 fail.
- `git diff --check` clean.

## Still open (not claimed)

- Everything listed in the previous row stands: work pools and the job snapshot UI,
  code-mode getters, `refreshMCPTools`, extensions/management, AgentHub/loop/prewalk
  surfaces, btw/cleanse workflows, roles, provider-backed dynamic tools, explicitly
  qualified external operations, and the O10 browser/computer subsystem.
