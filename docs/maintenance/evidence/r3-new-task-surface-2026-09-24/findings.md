# R3 new-task surface: base branch, shared folder, worktree default — 2026-09-24

This slice closes the §3.C new-task appearance gaps item 70 listed: a rendered base-branch
choice, a visible shared-folder label, and a client default to an isolated worktree for a busy
Git project. §10 item 70 remains the owner of status.

## Source state

Workspace `/Users/pond/cedia`, branch `main`, revision
`0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one. The
adapter already forwarded `baseRef` to `POST /v1/sessions` for a worktree task and the host
already resolved it to a commit; what was missing was the control that offers the choice.

## What is implemented

- **Base-branch picker** in the new-draft composer. It lists the project's real local branches
  through the existing IDE git bridge (`listBranches`), prefers the branch Git reports as
  `isDefault`, falls back to the current branch, and names the branch the task would start from.
  The choice travels as `baseRef` on `thread.create` **only** for a first worktree send, so a
  local-folder task can never carry a base revision the host would refuse. The copy states that
  Cedia does not fetch or pull.
- **Shared-folder label**: a non-Git task working in the original folder shows a persistent
  `Shared folder` identity in the header and in the empty composer, with the reason (no Git
  base branch; one CEDIA task may edit that folder at a time).
- **Busy-Git default**: a new task in a Git project that already has an active CEDIA task
  defaults to an isolated worktree once, with the reason rendered (`Worktree by default`).
  The client rule is a hint; the host stays authoritative and its `worktree_required` /
  `shared_folder_busy` refusal is rendered as an actionable message instead of an empty success.
- Host error codes (`unknown_base_ref`, `worktree_required`, `shared_folder_busy`) are parsed
  from both the `{code, reason}` shape and the message shape, and surface as titles plus
  descriptions in the thread error toast.

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/macos/agent-window/test` | 125 pass, 0 fail (400 assertions), 29 files |
| `bun test apps/macos/test` | 733 pass, 0 fail |
| `bun run --cwd apps/macos/agent-window typecheck` | pass (app and vendor projects) |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1,052 pass, 0 fail |
| `git diff --check` | clean |

The adapter tests prove the base revision is forwarded for a worktree task and omitted for a
local one, and that each host refusal reaches a rendered, actionable state.

## Not claimed

- This is renderer and adapter evidence, not a packaged two-window observation of the picker.
  The packaged receipts for this baseline are `r3-packaged-lifecycle-2026-09-24` and
  `r3-quit-decision-2026-09-24`.
- Copying selected uncommitted files into a new worktree is still open; the new-task surface
  neither offers it nor pretends to.
