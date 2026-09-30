# #1290 closure: full triage, useTheme assessed-not-ported — 2026-09-26

Closes #1290 intake: every web hunk is now ported, deferred to its owner,
ruled not-applicable, or assessed-not-ported with reason. No product code
changed by this slice; no gap change (stays **2**). §10 item 70 owns
status. No provider involvement.

## useTheme: assessed-not-ported (verified this turn)

Both hunks fail against this tree — and correctly so. CEDIA's
`useTheme.ts` is item-54-owned: one theme authority (the IDE workbench
theme), with the host-theme snapshot folded into the snapshot key
(`snapshotKey` carries `hostKey`), not upstream's localStorage-only
design. Upstream's refactor (refresh-on-emit + field-compare cache) does
not map onto IDE-driven invalidation; porting it would redesign the cache
this file exists to own, without a theme-behavior harness to re-verify
it. The key-string cache already covers the host theme. Not ported by
decision, not by omission.

## Full #1290 web disposition table

| File | Disposition | Where |
|---|---|---|
| `useTurnDiffSummaries.ts`, `ReviewFileTreePanel.tsx` | Ported | batch 2 |
| `storeSelectors.ts`, `GitActionsControl.tsx` | Ported | batch 14 |
| `Sidebar.logic.ts` (sort timestamps), `chat/GitPanel.tsx` | Ported | batch 23 |
| `Sidebar.tsx` (search identity), `useStableValue` (new) | Ported | batch 24 |
| `SidebarSearchPalette.tsx` (score memo) | Ported | batch 25 |
| `taskCompletion.logic.ts` (replay skip) | Ported | batch 26 |
| `SidebarActivityView.tsx` (feed memos) | Ported | batch 27 |
| `useTheme.ts` | Assessed-not-ported (item-54 design) | this slice |
| `skillsSettingsModel.ts` | N/A (absent in-tree) | batch 25 |
| kanban, pullRequest, automations routes, mentions fix, server/projection/GitCore, marketing | Different owners/surfaces | intake standing |

## Proof

- `patch --dry-run` of the useTheme hunks fails on both hunks against the
  item-54-adapted file (recorded, not forced).
- `git diff --check`: clean.

## Preserved

- D1–D5, deferred voice, `switchSession` open. Pin unchanged. Nothing
  committed; uncommitted tree preserved.
