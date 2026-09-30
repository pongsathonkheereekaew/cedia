# Selective backport batch 23: #1290 perf remainder (portable half) — 2026-09-26

Ports the remaining CEDIA-applicable #1290 web hunks: project sort
timestamps resolved once per project, and the Git pane on the shell-only
workspace-metadata selector. The global vendor pin is UNCHANGED; ported
from the release PR patch with per-file base verification. §10 item 70
owns status. No provider involvement. No gap change (stays **2**).

## Base verification (before touching)

- All hunk anchors verified present; `Sidebar.logic.ts` locally diverged
  as the intake table warned (only the comparator region ported, nothing
  else); `createThreadWorkspaceMetadataSelector` predates #1290 in-tree so
  the GitPanel swap resolves; `thread` in CEDIA's GitPanel used only at
  the two hunk lines, so the rename is safe (diff-reviewed).
- `Sidebar.tsx` (useStableValue + WeakMap projections) needs the absent
  `useStableValue` hook plus wider integration — deferred with the other
  #1290 owners/surfaces (server/projection/GitCore, marketing, automations
  routes, PR/kanban, mentions fix, theme, notifications, skills settings).
- Upstream unit test files not vendored: behavior pinned by a new Cedia
  test instead (below).

## What was ported (2 files + 1 new test)

- `Sidebar.logic.ts`: `sortProjectsForSidebar` builds
  `timestampByProjectId` once; comparator reads the map (same outputs,
  O(P log P × threads) rescans gone).
- `chat/GitPanel.tsx`: subscribes to the workspace-metadata slice instead
  of the full derived Thread, plus the same-hunk `stagedPatch` /
  `unstagedPatch` memoization.
- `Sidebar.sort.test.ts` (new): newest-thread-first ordering and manual
  order preservation, 2 green.

## Proof

- New unit test via vitest: 2 passed.
- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  `CediaToolCatalogSurface.tsx` error from another slice's in-flight file.
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`,
  0 provider calls, `errors: []`, batch-21 `archiveRestore` still true).
- `package:mac` (Node 24 via `CEDIA_HOST_NODE`) + `bun run check:packaged`:
  all checks OK with batch 23 inside.
- `git diff --check`: clean.

## Not claimed

- No wholesale vendor upgrade, no ACP, no OMP pin change, no behavior
  change beyond render work (fewer re-renders, cheaper sort).
- D1–D5 and the open `switchSession` untouched; uncommitted tree preserved,
  nothing committed.
