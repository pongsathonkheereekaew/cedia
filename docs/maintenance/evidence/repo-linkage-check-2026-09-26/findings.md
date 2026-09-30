# Repo linkage check after evidence batches — 2026-09-26

Runs the control-repo validator after thirteen evidence batches added
dirs, plan table rows and receipt links. No product code changed; no gap
change (stays **2**). §10 item 70 owns status. No provider involvement.

## Result

- `bun run check:repo` (`node scripts/ci-validate.mjs`): green —
  `CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=710 md=293
  evidence=265`, this turn. Requirement-graph schema, upstream-lock shape
  and all 710 documentation links (including every batch evidence link)
  validate; no dangling evidence refs from this session's additions.
- `git diff --check`: clean.

## Preserved

- D1–D5, deferred voice, `switchSession` open. Pin unchanged. Nothing
  committed; uncommitted tree preserved.

## Addendum: re-run after batches 21–30 (2026-09-26)

`CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=732 md=304
evidence=276` — eleven more evidence dirs and all new plan rows validate,
no dangling refs.

## Addendum: re-run after batch 31 (2026-09-26)

`CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=736 md=306
evidence=278` — batch-31 evidence and plan links validate, no dangling refs.

## Addendum: re-run after batches 31–32 (2026-09-26)

`CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=738 md=307
evidence=279` — batch-31/32 evidence and plan links validate, no dangling
refs. Footprint unchanged by this check.
