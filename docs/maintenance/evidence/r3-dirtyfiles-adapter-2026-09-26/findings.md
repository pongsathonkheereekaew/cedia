# R3 dirty-file selection, adapter half (forwarding + seams) — 2026-09-26

The host already takes a `dirtyFiles` selection (resolve, carry exactly those paths,
per-path outcomes, malformed-list refusal); the composer UI picker is still open. This
slice closes the Cedia-side contract half so the later picker only needs presentation:
no provider, no spend. §10 item 70 owns status.

## Done

- `apps/macos/agent-window/src/cedia-adapter.ts`: `thread.create` forwards `dirtyFiles`
  verbatim for worktree creations (gated like `baseRef`; local tasks never carry it) so
  the host's refusal and per-path outcomes surface instead of being decided in the UI layer.
- Test: worktree create carries a 2-file selection and an empty selection (`[]` carries
  none); local create drops the field. Adapter suite 55/55 at the time (falsification
  discipline per the confirm slice).
- Seams mapped for the picker (not built): read the dirty list from the existing
  `gitStatusQueryOptions(cwd)` → `api.git.status` → `native-git.ts` bridge path (no new
  backend needed); selection state belongs beside the base-branch flow
  (`BranchToolbarBranchSelector` → `onSetThreadWorkspace`, send via `prepareChatSendWorkspace`
  → `threadCreateCommand` in `useChatTurnExecution.ts`); packaged proof stays open with it.

## Still open (no gap change, stays 2)

- The composer dirty-file picker UI (checkbox list, default-all, carry-none) and its
  packaged run. `switchSession`/`browser-relay` untouched.

## Preserved

- D1–D5, deferred voice, W/N deferred per owner. Nothing committed.
