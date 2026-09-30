# R3 dirty-file picker vertical (UI through worktree carry) — 2026-09-26

Closes the last unbuilt D code item: the composer offers which uncommitted paths a new
worktree carries. Vendor UI + draft state + command schema + adapter forwarding (landed
earlier this turn) + host carry (pre-existing) + a live creation-only proof. No provider,
no spend, no turns. §10 item 70 owns status.

## Done

- New `components/WorktreeDirtyFilePicker.tsx`: checklist over the checkout's git status
  (existing status query, no new backend), default-all display matching the host default,
  explicit selection including carry-none, toggle/all/none. Mounted in `BranchToolbar`
  beside the base-branch selector, gated to draft first-worktree sends only.
- State seams, all following existing patterns: `dirtyFiles` on `ThreadWorkspaceState`/
  `Patch` (store merge), draft state/options/builder/equality (`sameStringList`), and
  `buildLocalDraftThread` so the draft reaches the send pipeline; `thread.create` carries
  it gated exactly like `baseRef` (new optional schema field); `thread.meta.update` and the
  fixed-workspace path deliberately untouched (creation-only, matching the host refusal).
- Two real defects found by verification, both fixed: tsc narrowing (`serverThread` is
  `undefined` inside the `!hasServerThread` branch — read the draft instead), and the
  builder/patch forwarding that an early shortcut had skipped (`buildLocalDraftThread`
  picks explicit fields; the toolbar callback rebuilds both server and draft patches).
- New `bun run smoke:dirty-carry` (`scripts/omp-dirty-carry-proof.ts`): against a real host
  and real git repo through the production adapter path — selected tracked file arrives
  byte-exact while an unselected untracked file stays behind, `[]` yields a clean checkout,
  a malformed selection is refused with no session created, source dirt intact. Green.
- `upstream.json` records the addition in its own words.

## Verified (current tree, zero provider calls)

- 6 new bun tests (defaults, checklist render, draft builder/equality, local-thread carry).
- Agent-window suite 399 green; typecheck shows only the 1 pre-existing vendor error.
- `bun run smoke:dirty-carry`: `{"ok": true}`. Mid-slice harness bug (porcelain leading
  space vs trim) fixed; product code untouched by it.

## Honest scope (no gap change, stays 2)

- The vendor send-pipeline seam (selection into `thread.create`) is covered by types
  (excess-property checked against the extended schema), render/store tests, and the live
  same-shape proof — not by a vendor runtime test (hook-heavy). Packaged run of the picker
  stays open with the other packaged items. `switchSession`/`browser-relay` untouched.

## Preserved

- D1–D5, deferred voice, W/N deferred per owner. Nothing committed.

## Addendum (bundle rebuild + shipped-frontend re-proof, same day)

- `bun run build:agent` rebuilds `dist/agent-window` with the picker (chunk-size warning only,
  same as before); the packaged `Cedia.app` still carries the earlier bundle until the next
  `--package`, which remains blocked on machine memory, not code.
- `bun scripts/agent-window-smoke.ts` (headless, fixture, zero spend) passes on the rebuilt
  bundle: first send, reload persistence, second thread in its own worktree, IDE handoff —
  `Agent Window UI smoke passed`. The picker's live in-flow appearance still stays open.

## Addendum (packaged picker clicks, 2026-09-27)

- New `bun run smoke:dirty-picker-packaged` (`scripts/omp-dirty-picker-packaged-proof.ts`):
  same topology as `agent-window-smoke.ts --native` (in-process host on fixture OMP +
  packaged `Cedia.app` via `_electron` on a scratch profile/state dir). Fixture repo has
  two TRACKED modifications (`keep.txt`, `drop.txt` — both tracked so the picker's status
  working tree lists them and the host carries them by diff-apply, isolating selection
  semantics from the untracked-copy path `smoke:dirty-carry` already covers).
- Real clicks in the packaged window: fixture project row → row create button (a bare New
  thread stays unbound with no BranchToolbar), env chip `Local` → `New worktree` menuitem,
  picker heading `Carry changes into worktree` mounts, `drop.txt` checkbox starts checked,
  uncheck leaves `keep.txt` checked, fill + Send. Session identified by set difference
  (exactly 1 created); its `session.cwd` worktree carries the `keep.txt` modification and
  NOT the `drop.txt` one. Screenshots in `dist/dirty-picker-packaged-proof/`.
- Two harness-only fixes, no product code: env-chip selector is now exact (`/^(Local|Worktree)$/`,
  the earlier `/Work in|Local|Worktree/` matched the "Work in a project" tab on an unbound
  thread); session identified by `session.cwd`, not `worktrees/<id>` (dir name is a UUID
  unrelated to the session id — the earlier assertion read a stale worktree).
- Green: all `OK` lines + `OMP dirty-picker packaged proof passed`. `switchSession` /
  `browser-relay` untouched.
