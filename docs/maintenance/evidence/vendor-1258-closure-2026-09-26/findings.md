# #1258 closure: live-activity clock on the visible interval — 2026-09-26

Ports the #1258 remainder batch 2 deferred: `liveActivityPresentation.ts`
drives its 1 s activity clock through the batch-2 `visibleInterval`
helper, so elapsed/activity labels suspend while the document is hidden
and refresh once on resume. The global vendor pin is UNCHANGED. §10 item
70 owns status. No provider involvement. No gap change (stays **2**).

## Base verification

- CEDIA file blob == PR parent blob (`f14ded7bad`): exact base. Both
  hunks ([1/3] behavior + [3/3] formatting) applied in order via patch,
  diff-reviewed. The [2/3] brand-identity CI commit has no CEDIA
  counterpart (verified absent before) and stays out.
- With this, #1258 is fully covered: reveal-tail settle + energy test
  (batch 2), hidden-document ticks (batch 2), live-activity clock (here).

## Proof

- Behavior-identical while visible (same tick subscription semantics);
  suspension only engages on hidden documents. No new test: timer +
  visibilityState mocking for a module-level clock singleton is
  disproportionate next to the batch-2 energy coverage of the helper.
- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  `CediaToolCatalogSurface.tsx` error from another slice's in-flight file.
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`,
  0 provider calls, `errors: []`, batch-21 `archiveRestore` still true).
- `package:mac` (Node 24 via `CEDIA_HOST_NODE`) + `bun run check:packaged`:
  all checks OK with batch 29 inside.
- `git diff --check`: clean.

## Not claimed

- No wholesale vendor upgrade, no ACP, no OMP pin change.
- D1–D5 and the open `switchSession` untouched; uncommitted tree preserved,
  nothing committed.
