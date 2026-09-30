# Selective intake batch 9: entangled PRs excluded with source proof — 2026-09-26

Dispositions #1261 and #1255 as not portable units, verified from the PR
patches themselves (fetched from the release PRs) against the current tree.
No product code changed; no gap change (stays **2**: `switchSession`,
`browser-relay`). §10 item 70 owns status. No provider involvement.

## #1261 activity recency: excluded (import-harness-bound, migration-entangled)

The PR is 8 commits / 129 files / ~11.6k lines. Commits 1–2, 7(part), 8 build
project import from Codex and Claude Code (provider adapters, import catalog,
guard, routes, migrations, import UI) — another harness, out of scope by the
baseline. The recency commits ([3/8] order activity by latest human message,
[6/8], [7/8]) are woven through machinery CEDIA does not share: Synara's
server projection pipeline (`ProjectionPipeline`, `ProjectionSnapshotQuery`),
persistence migrations (`106_ProjectionThreadsHumanMessage`, sequenced after
the import-origins migration), and the web store projection/event reducer.
The web ordering depends on projection fields that have no CEDIA equivalent
(OMP owns the transcript; CEDIA's sidebar reads the host store). CEDIA's own
`SidebarActivityView.logic.ts` already carries a deliberate ordering model
(task-feed: needs-user first) — different, not broken. Recorded as a future
design candidate (order CEDIA's session list by latest human message from
OMP/host data), not a backport.

## #1255 mention drops + pane splits: excluded (surface-bound, no drop model)

The PR is 3 commits / ~1.5k lines across desktop Electron browser automation,
marketing docs, ChatView/Sidebar/RightDock/model-picker changes, and new
files (`useComposerThreadMentionDrop.ts`, `lib/threadDrag.ts`,
`ChatPaneDropOverlay.tsx`, `SplitChatSurface.tsx`, slider UI). The feature's
core — draggable thread rows plus composer drop handling that inserts a
thread @mention — has no CEDIA counterpart: `threadDrag.ts` and
`useComposerThreadMentionDrop.ts` do not exist in the tree, and CEDIA has no
thread-mention composer model or split-pane drop design (window management
belongs to the Code-OSS shell). The one separable hunk (splitting
`buildThreadMentionComposerItems` into candidates + `resolveThreadMentionForThreadId`)
was left out deliberately: the resolver's only caller is the absent drop
path, so porting it would be dead code. The CI commit ([3/3] brand-identity
gitlinks skip) has no CEDIA counterpart script. Revisit only with a CEDIA
composer/split-pane design; the `@`-menu disambiguation stays as is.

## Preserved

- D1–D5, deferred voice, `switchSession` open, #1332 durable-catalog
  exclusion, no wholesale vendor upgrade, no ACP migration, no OMP pin
  change, no worktree deletion. Pin unchanged. Nothing committed;
  uncommitted tree preserved (`git diff --check` clean).
