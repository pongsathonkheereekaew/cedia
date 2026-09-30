# Regression sweep after bundle-changing batches 7 + 14 — 2026-09-26

Full consumer + unit sweep over the two batches that changed the shipped
bundle (#1274 folding, #1290 stability). No product code changed by this
slice; no gap change (stays **2**: `switchSession`, `browser-relay`). §10
item 70 owns status. No provider involvement.

## Results (this turn, current tree)

- Vendor vitest suite (`src` only): 7 files / 34 tests pass, including the
  14 new batch-7/14 tests. One collection failure in
  `OmpSettingsPanel.logic.test.ts` is a pre-existing harness artifact (the
  file imports `bun:test`, so vitest cannot collect it; it belongs to the
  bun suite below and is untouched by these batches).
- Agent-window bun suite (`bun test test/`): 385 pass, 0 fail
  (1370 expects) — all vendor consumers green.
- Full default `bun run test` in the vendor dir also sweeps the parent
  `test/` tree and reports 75 collection failures, all identically
  "Cannot find package 'bun:test'" — same harness mismatch, not product
  regressions; the suites above are the correct runners for each tree.
- `bun run check:packaged`: green at turn start (batches already inside).

## Preserved

- D1–D5, deferred voice, `switchSession` open, single OMP
  execution/transcript/auth owner. Pin unchanged. Nothing committed;
  uncommitted tree preserved (`git diff --check` clean).

## Addendum: batch test files re-run together (2026-09-26)

After batches 24/27 touched neighboring modules (Sidebar consumes the
batch-14 equality function): all four batch test files green together —
19 passed (liveFold 10, stability 4, sort 2, skip 3).

## Addendum: backend gate suite (§8.1 command, 2026-09-26)

`bun test packages/omp-adapter packages/relay apps/host apps/macos/test
scripts/lib`: 1380 pass, 0 fail (8287 expects, 163 files) on the current
tree. No backend code changed this session; confirms the session's
vendor/harness/evidence edits broke no backend contract.

## Addendum: agent-window bun suite after bundles 23–29 (2026-09-26)

`bun test test/` in `apps/macos/agent-window`: 385 pass, 0 fail (1370
expects, 74 files). The batch-17 green predated the batch 23–29 vendor
edits; this re-run closes that gap.
