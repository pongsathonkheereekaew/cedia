# Selective backport batch 14: #1290 render stability remainder — 2026-09-26

Ports the remaining CEDIA-applicable #1290 web hunks: stable Git selectors
(no re-render of the always-mounted control per streamed token) and
field-wise search-list equality. The global vendor pin is UNCHANGED
(`upstream.json` stays `33333439c4b9c74d0097bc01196cccc921f67cf3`); ported
from the release PR patch with per-file base verification. §10 item 70 owns
status. No provider involvement. No gap change (stays **2**: `switchSession`,
`browser-relay`).

## Base verification (before touching)

- `storeSelectors.ts`: CEDIA blob == PR parent blob (`a710221860`) — exact.
- `GitActionsControl.tsx`, `SidebarSearchPalette.logic.ts`: diverged, but
  all hunk anchors verified present (selector import + `useStore` site;
  search-thread interface + match interface). No Cedia markers near the
  hunks; the control is the one mounted beside the tabbed DiffPanel that
  settled `/git`, so the perf fix lands on a rendered surface.
- Upstream unit test files not vendored: behavior pinned by a new Cedia
  test instead (below). Other #1290 hunks (server/projection/GitCore,
  marketing, automations routes, PR/kanban surfaces, mentions fix, theme,
  notifications, skills settings) stay out as different owners/surfaces.

## What was ported (3 files + 1 new test)

- `storeSelectors.ts`: `createThreadGitActionsMetadataSelector` — shell-only
  slice (worktree, branch, associated branch, branch-flow flag, title) kept
  reference-stable across streaming deltas.
- `GitActionsControl.tsx`: subscribes to the metadata slice instead of the
  full derived Thread.
- `SidebarSearchPalette.logic.ts`: `areSidebarSearchThreadListsEqual` —
  field-wise equality so rebuilt lists keep identity. One Cedia adaptation:
  the `spaceName` comparison is dropped with a note — this tree's
  `SidebarSearchThread` carries no space field (verified in the interface),
  so equality over the actual fields is complete.
- `storeSelectors.stability.test.ts` (new): mirrors the release assertions
  for both helpers (stability across message deltas, re-derivation on git
  field/title change, empty for unknown threads, list equality/inequality).

## Proof

- New unit test via vitest: 4 passed.
- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  `CediaToolCatalogSurface.tsx` error from another slice's in-flight file.
  (The port initially referenced the nonexistent `spaceName`; typecheck
  caught it and the adaptation above resolved it — clean since.)
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`,
  0 provider calls, `errors: []`).
- `package:mac` (Node 24 via `CEDIA_HOST_NODE`) + `bun run check:packaged`:
  all checks OK with batch 14 inside.
- `git diff --check`: clean.

## Not claimed

- No wholesale vendor upgrade, no ACP, no OMP pin change, no behavior change
  beyond render stability (fewer re-renders, stable list identity).
- D1–D5 and the open `switchSession` untouched; uncommitted tree preserved,
  nothing committed.
