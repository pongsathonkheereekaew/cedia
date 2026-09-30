# R3 first slice: new-task workspace admission and starting commit — 2026-09-24

This receipt records the first R3 slice: the host now decides where a new task works and
records the revision it started from (CEDIA-PLAN §3.C "New Git task" / "New non-Git task",
§2.2 project and workspace row). Evidence is fixture-based; no packaged build and no
two-window run. §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- Before this slice `createSession` created a worktree only when the caller asked for one, and
  nothing recorded which branch or commit a task began from.

## Implemented in this working tree

**Folder identity, read-only and offline.** `workspaceIdentity(path)` in
`apps/host/src/workspaces.ts` answers `{ isGit, root, branch?, sourceCommit? }` by asking git
for the top level, the branch and `HEAD` - never a fetch or a pull, so the recorded commit is
exactly what the user had. A folder that is not a repository reports `isGit: false` with its
canonical path.

**One file-mutating task per folder.** `admitNewTaskWorkspace({ identity,
activeTasksInFolder, requestedMode })` is a pure rule with three answers: the first task in a
folder works there directly; a second task in a Git folder is refused with
`worktree_required` (the refusal names the worktree rather than silently sharing the folder or
silently switching the user's chosen mode); a second task in a folder that is not a repository
is refused with `shared_folder_busy`, because there is nowhere to isolate it.

**The task records where it started.** `createSession` writes `workspace-identity.json` into
the task directory for both modes (`mode`, `isGit`, `cwd`, `root`, `branch`, `sourceCommit`),
and `sessionView` stamps it on every session row as `Session.workspace`. `POST /v1/sessions`
now answers with that same view, so a caller learns the workspace it actually got without a
second round trip.

## Decisions and defects found by the fixtures

- **A sidechat fork is exempt from the folder rule.** It is a branch of the task it came from
  and continues that conversation in the same folder, not a second task competing for it.
  Without the exemption five existing sidechat-fork tests failed; the fork path now calls the
  internal creator with `admit: false` and the reason is recorded in the code.
- Two fixtures created a second task in one folder (`service.test.ts`'s fork-conflict setup and
  `agent-window-temporary-thread.test.ts`'s delete case). Both now give the second task its own
  project folder, which is what the product rule requires; the behaviours they assert are
  unchanged.
- Every session creation printed `fatal: not a git repository` to the console, because the
  identity probe reused a runner that lets git's stderr through. `probeGit` was added to the
  single git module (`apps/host/src/git.ts`): read-only, quiet, `undefined` on any failure.
- The non-repository answer now canonicalizes its path, so it matches the real path git
  reports for a repository (a `/var` versus `/private/var` fixture caught this).

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/host/test/workspaces.test.ts` | 6 passed, 0 failed (37 assertions) |
| `bun test apps/host/test/http.test.ts` | 8 passed, 0 failed (70 assertions) |
| `bun test apps/host` | 174 passed, 0 failed, 23 files |
| `bun test apps/macos/agent-window/test` | 118 passed, 0 failed |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1,024 passed, 1 failed (the pre-existing `ide-native-workbench` theme failure), 124 files |
| `bun run --cwd apps/macos/agent-window typecheck` | passed, including the vendor tree |
| `node scripts/ci-validate.mjs` | `CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=375 md=126 evidence=107` |
| `git diff --check` | clean |

The HTTP fixture builds a real repository with one commit and proves, through the real
loopback server: the first task is admitted `local` with that commit recorded; the second
`local` task is refused `worktree_required`; the same task requested as `worktree` is admitted
and reports `mode: "worktree"` with the same starting commit; and reading the task back agrees
with what creation answered.

## Not implemented / not claimed

- The **visible shared-folder label** §3.C asks for on a non-Git task is not rendered yet; the
  host publishes the identity, no view shows it. The starting commit is likewise unrendered.
- The client still chooses the workspace mode; nothing defaults a new task in a busy Git
  project to a worktree. The host refuses and names the choice, which is the enforcement half.
- §3.C's other two clauses are untouched: choosing another base branch before Send, and the
  optional selected-uncommitted-file copying into a worktree.
- §2.6's archive/cleanup/restoration state machine, §2.4's intent and queue projection, R4-R8
  and every §8.2 O-packet remain open; speech-to-text stays deferred.

## Limitations

Fixture evidence from the revision above, on a real repository and a real loopback host. It
does not certify the desktop checkpoint, packaging, or any rendered label.
