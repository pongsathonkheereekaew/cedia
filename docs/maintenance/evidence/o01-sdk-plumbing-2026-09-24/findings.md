# O01 execution plumbing: the runtime's own subscriptions, injection and teardown — 2026-09-24

This receipt records the gate-settlement slice for all seven remaining O01 SDK rows, with no
new runtime, host or window code: each one is OMP-internal plumbing a client never asks for
separately, settled through a source-evidence disposition (`platform_presentation_equivalent`)
that the gate re-reads on every run. §10 item 70 owns status; this file records what was
observed at the revision below. No provider request was made and no model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. No upstream change in this slice; `dist/omp/omp` not re-prepared.
- Changed for this slice: `scripts/lib/omp-coverage.ts` (seven dispositions); this receipt;
  `docs/maintenance/CEDIA-PLAN.md` (item 70 row).

## What changed (one disposition per row, each with re-read source evidence)

- `subscribe`: rpc-mode owns the forwarding subscription itself — every session event is
  forwarded to the RPC client and Cedia applies each frame through its typed event registry
  (no gaps) and frame reducer. A second Cedia subscription would be a second owner of the
  same stream.
- `subscribeRunState`: the run-state listener registry serves lifecycle owners; its in-tree
  subscriber is the global agent lifecycle, which Cedia deliberately does not join. Cedia reads
  running/idle from OMP's turn boundaries and its queue projection instead.
- `sendCustomMessage`: internal injection for mode-context and continuation messages inside
  flows Cedia drives through registered operations (`goal.set`, `plan.set`, `plan.review`
  steer context while streaming); every owner submission enters through `prompt`, `steer` or
  `follow_up`.
- `sendUserMessage`: extension-originated injection inside OMP's own turn flow, attributed to
  the running prompt by the runtime's own per-prompt tracker so agentInvoked accounting stays
  exact. Cedia never injects outside `prompt`, `steer` and `follow_up`.
- `beginDispose`: the synchronous disposal guard inside OMP's own teardown, run first by
  `dispose()` on the runtime's shutdown paths — never a client operation.
- `dispose`: terminal in-process teardown (listeners, writes, agent disconnect, owned jobs) on
  OMP's own shutdown paths. Cedia ends a session by closing the runtime client through its
  host lifecycle.
- `activeToolExecutionUpdates`: the unpersisted display-result snapshot a TUI focus rebuild
  replays. Headless Cedia never rebuilds focus; live tool progress arrives as
  `tool_execution` frames the tool cards render.

## What was observed

- `bun run check:omp-coverage`: integrity PASS, 1,041 audited records with 1,041 Cedia mappings,
  live `omp/18.1.18`; gap count **60** (was 67), O01 sdk 0 (was 7) — the family is closed.
  `--list-gaps` names no O01 sdk row.
- Negative probes: evidence text without the literals reports `unclassified` for all seven rows
  — every guard holds.
- `bun test scripts/lib`: 81 pass / 0 fail.
- `git diff --check` clean.

## Still open (not claimed)

- O01 keeps the `/pause` slash gap: pausing a run has no Cedia control and OMP exposes no
  run-pause primitive — Stop interrupts rather than pauses.
- No behavior changed anywhere in this slice: the runtime, host, adapter and both windows are
  byte-identical to the previous slice. If a future upstream revision moves any cited literal,
  the gate fails instead of leaving the claim standing.
