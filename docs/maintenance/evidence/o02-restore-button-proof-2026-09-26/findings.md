# Restore-button proof: Archived row → toast → host readback — 2026-09-26

Closes the batch-21 remainder (Continue-button UI path): the full Restore
chain driven with real clicks in the running window. No gap change (stays
**2**: `switchSession`, `browser-relay`). §10 item 70 owns status. No
provider involvement (fixture OMP executable, no turn ever sent).

## Chain proven (current tree, `bun run smoke:restore-window`)

New `scripts/omp-restore-window-proof.ts` (registered as
`smoke:restore-window`, modeled on the roles-window proof): two fixture
tasks (home local, archived task in its own worktree per R3 admission),
archive through the host-owned pair, then in headless Chromium against the
current bundle — open the home task, Settings → Archived threads section,
archived row lists the task with its retention record, Restore click,
"Thread restored" toast, host row reads back `archived: false`.
`dist/restore-window-proof/`: `ok: true`, 0 provider calls, 0 renderer
errors, `restore-window.png`.

Link-by-link: `ArchivedSettingsPanel` row + Restore button →
`unarchiveThreadFromClient` (`thread.unarchive` dispatch) → adapter PATCH
`{archived:false}` (already unit-tested) → `restoreSession` real restore
(already live-proven) → toast + host readback (proven here).

## Honestly scoped

- The archived task is worktree-backed and idle; contested restores
  (occupied path, missing repo, no recorded revision) stay on their typed
  refusals by existing fixtures, not re-proven here.
- D1–D5, deferred voice, `switchSession` open. Pin unchanged. Nothing
  committed; uncommitted tree preserved (`git diff --check` clean).

## Addendum: second consecutive green (2026-09-26)

Re-ran via the registered `bun run smoke:restore-window` (registration
itself was the new reason): same four OKs, `ok: true`, 0 provider calls, 0
renderer errors. No flakes across the two runs.

## Addendum: re-verified after bundles 23–29 (2026-09-26)

Re-ran `smoke:restore-window` unchanged: same four OKs, `ok: true`, 0
provider calls, 0 renderer errors. The Restore chain survived every later
bundle change.
