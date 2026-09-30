# Selective backport batch 26: #1290 attention replay short-circuit — 2026-09-26

Ports the #1290 `taskCompletion.logic.ts` hunk: `collectThreadAttentionCandidates`
skips threads whose derivation inputs are reference/value-identical, instead
of replaying every thread's activities per streamed token. The global vendor
pin is UNCHANGED; anchor verified, dry-run clean, applied as-is. §10 item 70
owns status. No provider involvement. No gap change (stays **2**).

## What was ported (1 file + 1 new test)

- `notifications/taskCompletion.logic.ts`: the five-input identity guard
  (activities, pendingInteractions, hasPendingApprovals, hasPendingUserInput,
  latestTurn.turnId) with the upstream comment stating the soundness basis
  (derivations below are pure functions of exactly these inputs).
- `notifications/taskCompletion.skip.test.ts` (new): same-reference emits
  nothing, rebuilt-but-derivably-identical agrees, unknown threads ignored
  — 3 green. (A full approval-deriving fixture would need orchestration
  activity shapes; the branch contract is pinned instead, recorded.)

## Proof

- New unit test via vitest: 3 passed.
- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  `CediaToolCatalogSurface.tsx` error from another slice's in-flight file.
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`,
  0 provider calls, `errors: []`, batch-21 `archiveRestore` still true).
- `package:mac` (Node 24 via `CEDIA_HOST_NODE`) + `bun run check:packaged`:
  all checks OK with batch 26 inside.
- `git diff --check`: clean.

## Not claimed

- No wholesale vendor upgrade, no ACP, no OMP pin change, no behavior
  change beyond skipping redundant derivation replays.
- D1–D5 and the open `switchSession` untouched; uncommitted tree preserved,
  nothing committed.
