# R3 archive retention and Continue/restore — 2026-09-24

This receipt records the R3 slice that makes archive and restore a host-owned state machine
(CEDIA-PLAN §2.6 "Archive, cleanup and restoration contract"). Evidence is fixture-based: no
packaged build, no rendered Restore surface and no two-window run. §10 item 70 remains the
owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- Before this slice `PATCH /v1/sessions/:id {archived:true}` only flipped a flag, nothing
  recorded what the archive kept, and `{archived:false}` was a plain flag update that could
  re-open a task whose worktree no longer existed.

## Implemented in this working tree

**Archive records what it kept (§2.6).** `CediaHost.archiveSession` refuses a running task
(409 `task_running`), then writes `archive-receipt.json` next to the task: `state: "retained"`,
the retained worktree and branch, the commit the task stopped on, whether it stopped dirty and
whether ignored files are present, when it was recorded, and why Cedia removed nothing. A task
in a managed worktree also gets an immutable `refs/cedia/archive/<task>/<timestamp>` pointing at
that commit; a task that worked directly in the project folder gets no ref, because Cedia does
not leave refs in the user's checkout.

**Continue is now a host operation (§2.6).** `CediaHost.restoreSession` is what
`PATCH /v1/sessions/:id {archived:false}` runs. A retained worktree that is still on disk is
resumed where it stopped. When the worktree folder is gone, the recorded revision is checked
out again into a managed worktree - and `workspaces.restoreWorktree` checks out that exact
revision rather than the source repository's current state, so a restore never carries today's
uncommitted work into an archived task.

**A restore never moves a branch someone else owns.** `workspaces.planRestoration` reattaches
the preserved task branch only when it still points at the archived commit and no worktree
holds it; otherwise the task continues on `cedia/restore/<task>` (then `-2`, `-3`, ... if that
name is taken) and the recorded branch stays exactly where the user left it. A deleted worktree
folder is pruned first, so a stale registration cannot hold the branch hostage or block the
path. Anything uncertain refuses with an actionable reason and leaves the task archived:
occupied path (`restore_unavailable`), unavailable repository, or an archive with no recorded
revision. The archive receipt then moves to `state: "restored"` with the worktree, branch,
whether the branch was reattached and why.

## Defects found by the fixtures

- **A test fixture claimed a project folder may not exist.** It created a project at
  `join(stateDir, "other")` without creating the folder. `createProject` requires a path that
  resolves, so the project call answered `request_failed`, the task creation then failed and
  the archive assertion read a 404 body. The host behaviour is correct; the fixture now makes a
  real plain folder and asserts the archive response status instead of silently reading an
  error body.
- **Reattaching used `git worktree add -b`.** The first restore fixture failed with
  `fatal: a branch named 'cedia/task-...' already exists`. Reattaching must check out the
  existing branch (`git worktree add <dest> <branch>`); only a restoration branch is created
  with `-b`.
- **The restore rewrote the folder identity.** The first draft overwrote
  `workspace-identity.json` with the restored worktree, which threw away the repository root
  the task began from and broke the next restore with `restore_unavailable`. The record now
  stays what it always was - where the task began - and the restore is named by the session's
  `cwd` plus the receipt's `restored` field. The fixture caught this by asserting the second
  restore of the same task.

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/host/test/workspaces.test.ts` | 8 passed, 0 failed (46 assertions) |
| `bun test apps/host/test/http.test.ts` | 10 passed, 0 failed (102 assertions) |
| `bun test apps/host` | 178 passed, 0 failed, 23 files (1,050 assertions) |
| `bun test apps/macos/agent-window/test` | 118 passed, 0 failed, 28 files |
| `npx tsc --noEmit` scoped to `apps/host`/`packages/protocol` | no new errors; the only repository-wide error in scope is the pre-existing `apps/macos/test/state.test.ts` frame-union assertion |

The HTTP fixture builds a real repository and drives the real loopback server: archiving a
running task is refused; archiving a stopped task with tracked changes records `dirty: true`,
an `refs/cedia/archive/...` ref that resolves to the commit the task stopped on, a surviving
worktree and branch, and no ref for a task working in a plain project folder. The restore
fixture then deletes the worktree folder three times: a plain delete restores the same revision
on the task's own branch, a deleted worktree whose branch was moved afterwards restores on
`cedia/restore/<task>` with the moved branch untouched, and a path something else occupies is
refused with `restore_unavailable` while the task stays archived and the occupying file
survives.

## Not implemented / not claimed

- **Cleanup stays inactive.** No removal path exists: the receipt only ever says `retained` or
  `restored`, there is no `prepared`/`removed` generation, no integration-ancestry proof (the
  retained commit being an ancestor of the recorded integration target), no IDE/PTY cleanup
  veto and no recheck-before-removal step. §2.6 requires all of them before removal is enabled,
  so nothing in this slice may be read as a cleanup gate.
- **§2.6 workspace metadata is partial.** Integration target/ref and observed commit, and the
  cleanup generation/last-failure fields, are not recorded yet.
- The Restore action is wired at the adapter/route level only: no rendered Restore-or-Continue
  surface, no packaged build and no two-window run has been observed.
- §2.4 intent/queue projection and pending-model boundary, the rest of §3.C (choosing another
  base branch, copying selected dirty files), the visible shared-folder label, R4-R8 and every
  §8.2 O-packet remain open; speech-to-text stays deferred.

## Limitations

Fixture evidence from the revision above, on real repositories and a real loopback host. It
does not certify the desktop checkpoint, packaging, or any rendered control.
