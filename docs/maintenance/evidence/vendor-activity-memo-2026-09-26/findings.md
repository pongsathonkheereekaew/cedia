# Selective backport batch 27: #1290 activity-feed memoization — 2026-09-26

Ports the #1290 `SidebarActivityView.tsx` feed memoization: stable
`isRealProject` callback plus per-derivation memos (scope options, unread
sweep, view model, priority split, recency split, date buckets, project
groups) and a minute-coarse clock for the day-granular buckets. The global
vendor pin is UNCHANGED; ported from the release PR patch with adaptation
for this tree's own priority split. §10 item 70 owns status. No provider
involvement. No gap change (stays **2**).

## Base verification and adaptation

- 4/5 hunks applied via patch; the controller hunk rejected on line drift
  and was applied manually against CEDIA's exact region (no partial state
  left behind; `.rej` removed).
- Two Cedia adaptations, both noted in code: the priority split upstream
  lacks is kept, pure and memoized on the same terms; the project-groups
  memo keeps CEDIA's 3-arg `groupActivityThreadsByProject` call (with
  `{ nowMs }`) and adds `nowMs` to deps. Dep arrays otherwise mirror
  upstream; CEDIA's memo never read `props.projects`, so it was not added.
- Behavior-identical (same pure functions over the same inputs); no new
  test — view-level memoization needs a renderer the tree does not vendor,
  recorded rather than worked around.

## Proof

- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  `CediaToolCatalogSurface.tsx` error from another slice's in-flight file.
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`,
  0 provider calls, `errors: []`, batch-21 `archiveRestore` still true).
- `package:mac` (Node 24 via `CEDIA_HOST_NODE`) + `bun run check:packaged`:
  all checks OK with batch 27 inside.
- `git diff --check`: clean.

## Not claimed

- No wholesale vendor upgrade, no ACP, no OMP pin change.
- D1–D5 and the open `switchSession` untouched; uncommitted tree preserved,
  nothing committed.
