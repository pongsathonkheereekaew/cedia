# Intake dispositions assessed against the current tree — 2026-09-26

Records adopt/equivalent/excluded decisions for items assessed (not ported)
this round, with reasons tied to the present source. Research basis:
`synara-v0.9.2-intake-2026-09-26`. §10 item 70 owns status. No code changed
for these items; no provider involvement.

## #1256 model discovery/starred presets: equivalent already closed, not ported

The release work is Codex-provider mechanics (`codexAppServerManager`,
`ProviderDiscoveryService`, Codex/Claude/antigravity catalog merging) — not
applicable under OMP-as-sole-catalog ownership. Its one generic behavior (a
remembered model the catalogue no longer advertises reads as unavailable,
never selectable) is already closed in our tree via the D1/item-5a path (draft
pick resolved against the live catalogue, stale pick named, host model shown
instead; `d1-draft-send-in-place-2026-09-18`). Verified the Codex-only file
set; nothing to port.

## Item 8 reconciliation: advisor done, overrides untracked

- Advisor half: DONE — `o07-advisor-surface-2026-09-24` (projection, switch
  control, dump view, 4 SDK records) plus `o07-advisor-config-2026-09-24`.
  The "untouched surfaces" wording is superseded history.
- `task.agentModelOverrides` (per-subagent routing): zero references anywhere
  in host/adapter/macos sources, no coverage-map record, no requirement-graph
  entry, no item-70 row. It is therefore neither open nor closed — explicitly
  NOT added to item 70 here. If wanted, it enters as new scoped intake with
  its own OMP API evidence, not as a revival of item 8.

## Standing exclusions restated (unchanged)

D1–D5, deferred voice, `switchSession` open (owner gate, no retarget),
#1332 durable catalog (OMP bypasses it), no wholesale vendor upgrade, no ACP
migration, no OMP pin change, no worktree deletion. Model/role UX continues as
its own batch.
