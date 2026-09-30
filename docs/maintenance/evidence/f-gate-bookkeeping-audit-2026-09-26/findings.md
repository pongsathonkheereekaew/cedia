# F gate bookkeeping audit: mappings match the plan — 2026-09-26

Verifies the coverage gate's bookkeeping against the plan's claims, inline
in `scripts/check-omp-coverage.ts` against the dated audit
(`omp-complete-scope-2026-09-23`). No product code changed; no gap change
(stays **2**). §10 item 70 owns status. No provider involvement.

## Verified (this turn, current tree)

- 1041 audited records, 1041 Cedia mappings, integrity PASS, 0 fatal issues;
  live runtime omp/18.1.18 reread (498 settings, 50 RPC commands, 73
  capability descriptors agree).
- `--require-complete` fails on exactly 2 records without an available
  disposition: `browser-relay` (O10 cli) and `switchSession` (O02 sdk) —
  the same two the plan names; both blocked outside the tree (user Chrome
  install + config; owner gate with no retarget).
- 17 `explicitly_excluded` mappings, each citing its owner decision with
  date and rationale: D1 rooms/collab/join/leave (`join`, `share` excluded
  per-row; `collab`, `collab view/status/stop`), D2 `ssh` (amended scope),
  D3 `auth-broker`, D4 `auth-gateway`, D5 `share`, `update` (updater
  permanently forbidden), `tiny-models`. No silent exclusion: every row
  names its decision.
- No orphan, duplicate, invalid-family or stale-audit-source rows (gate
  integrity half, green).

## Reading

F's bookkeeping is exact. The only path to green `--require-complete` runs
through the two named external prerequisites, not through reclassification.

## Preserved

- D1–D5, deferred voice, `switchSession` open. Pin unchanged. Nothing
  committed; uncommitted tree preserved (`git diff --check` clean).
