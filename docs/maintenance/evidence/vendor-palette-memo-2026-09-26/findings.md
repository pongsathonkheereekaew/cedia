# Selective backport batch 25: #1290 palette memo (search payoff) — 2026-09-26

Ports the #1290 `SidebarSearchPalette.tsx` hunk: memoize the thread-match
scoring keyed on the (now identity-stable after batches 23/24) thread list
plus query, so highlight/keyboard/state re-renders and unrelated store
flushes stop rescoring the workspace per token. The global vendor pin is
UNCHANGED; anchor verified present, dry-run clean, applied as-is. §10 item
70 owns status. No provider involvement. No gap change (stays **2**).

## Triaged but not ported this turn

- `SidebarActivityView.tsx` (memoized feed derivations), `useTheme.ts`
  (snapshot cache with tearing guarantee), `taskCompletion.logic.ts`
  (activity-replay short-circuit): present but diverged — each needs its
  own base verification; next candidates, not claimed.
- `skillsSettingsModel.ts`: absent in-tree (CEDIA settings model differs)
  — hunk not applicable.

## Proof

- Behavior-identical memo (same inputs → same outputs); comparator pinned
  by batch-14 tests.
- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  `CediaToolCatalogSurface.tsx` error from another slice's in-flight file.
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`,
  0 provider calls, `errors: []`, batch-21 `archiveRestore` still true).
- `package:mac` (Node 24 via `CEDIA_HOST_NODE`) + `bun run check:packaged`:
  all checks OK with batch 25 inside.
- `git diff --check`: clean.

## Not claimed

- No wholesale vendor upgrade, no ACP, no OMP pin change.
- D1–D5 and the open `switchSession` untouched; uncommitted tree preserved,
  nothing committed.
