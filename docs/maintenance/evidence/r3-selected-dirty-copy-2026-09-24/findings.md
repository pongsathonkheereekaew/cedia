# R3 workspace: a new worktree carries the uncommitted files the caller selected — 2026-09-24

This receipt records §3.C's "optional selected uncommitted-file copying" on the host owner
path: which uncommitted project files a new worktree carries, what the caller is told about
each one, and why nothing is written back to the source folder. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- `apps/host/src/workspaces.ts`, `apps/host/src/service.ts`, `apps/host/src/router.ts`,
  `packages/protocol/src/index.ts`, and the host tests.

## The gap

`createWorktree` carried the project folder's *entire* uncommitted state: the full
`git diff HEAD` patch plus every untracked file under `--exclude-standard`. §3.C asks for the
selection to be the caller's, and for copy conflicts to be reported. There was no request
field, no per-path outcome, and no way to start a worktree from exactly the base revision.

## What changed

- `POST /v1/sessions` accepts `dirtyFiles`, a list of project-relative paths, and
  `createSession`/`createWorktree` pass it through as `CreateWorktreeOptions.dirtyFiles`.
- Three modes, one of which is the historical default:
  - omitted: carry the whole uncommitted state, exactly as before;
  - `[]`: carry nothing, so the worktree is the base revision;
  - a list: carry exactly those paths.
- A selected path is classified against one `git status --porcelain=v1 -z
  --untracked-files=all --no-renames` read taken before the worktree exists: an untracked file
  is `copied`, a tracked change (including a deletion) is `applied` and travels in that path's
  own binary patch, a path with no uncommitted change is `unchanged`, and a path that cannot be
  carried is `conflict` with its reason — a directory ("Cedia copies files, not directories"),
  a Git-ignored path (ignored files belong to the workspace allowlist, not to a selection), or
  one that no longer exists.
- A conflict is reported, not fatal: the task still gets its worktree, and the per-path outcome
  is written to `workspace-identity.json` so the creation answer and every later read agree.
  It also projects through `Session.workspace.dirtyCopy`, so a client does not have to trust the
  creation response.
- A malformed list (absolute, `..`, backslash, NUL, empty, over-long, duplicate) refuses the
  request *before* anything is created, so no half-made task is left behind. A selection with
  `workspaceMode: "local"`, or in a folder that is not a repository, is refused with
  `worktree_required`, because a task in the project folder already works on those files.
- Nothing in this path writes to the project folder. The source keeps every byte and every
  uncommitted path; the change is copied into the new worktree, never moved.
- The "tracked source changed during snapshot" check now compares only the paths this mode
  actually carries, so an empty selection cannot compare the whole repository against nothing.

## Verification

```
bun test apps/host/test/workspaces.test.ts                              # 12 pass, 0 fail
bun test apps/host/test/http.test.ts                                    # 13 pass, 0 fail
bun test apps/host                                                       # 227 pass, 0 fail
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                                                                        # 1102 pass, 0 fail
bun run typecheck                                                       # same 10 pre-existing errors, none new
git diff --check                                                        # clean
```

The fixtures use real repositories created through `git`. The unit tests assert the selection
travels and nothing else does (the unselected tracked file is at the starting revision, the
unselected untracked file does not exist in the new worktree, the source keeps both), that the
four conflict/unchanged reasons are reported per path, that `[]` produces a clean worktree, and
that every malformed list leaves no destination behind. The HTTP test drives the real route and
then re-reads `GET /v1/sessions/:id` to prove the receipt is durable rather than only echoed.

## Not done here

- No renderer surface yet: the new-task composer still sends no `dirtyFiles`, so the default
  (carry everything) is what a packaged task does today. The host contract and its receipt
  exist; the file-picker UI is not built.
- A selection combined with `baseRef` applies a `HEAD`-relative patch onto the named base. Git
  refuses the apply when the paths differ from `HEAD`, and the task creation fails loudly rather
  than producing a mixed workspace; the interaction is not otherwise designed yet.
