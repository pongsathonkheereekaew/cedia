# R3 tasks start from a named revision — 2026-09-24

This receipt records the R3 slice that lets a new task name the base revision it starts from
and proves the host resolved that label to a commit before creating the worktree
(CEDIA-PLAN §3.C "New Git task", §2.6 "New-task creation accepts a validated base ref").
Evidence is fixture-based: no packaged build, no rendered branch picker. §10 item 70 remains
the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- Before this slice a task always started from the project folder's `HEAD`: `createWorktree`
  already accepted a `baseRef`, but nothing resolved or recorded one, so the requested revision
  was never proven.

## Implemented in this working tree

**The label is resolved before anything is created.** `POST /v1/sessions` accepts an optional
`baseRef`. `CediaHost.#createSession` asks Git for `${baseRef}^{commit}` in the project
repository and refuses with `unknown_base_ref` when Git does not know it, so a refusal leaves
no half-made task behind. The resolved commit - not the label - is what `createWorktree` is
given, and it is what the task records as `workspace.sourceCommit`, so the recorded starting
point is the revision that was actually used.

**A base revision needs a worktree.** Asking for `baseRef` with `workspaceMode: "local"` is
refused with `worktree_required`, because Cedia cannot check another revision out inside the
project folder the user is working in.

**The label is kept beside the commit.** `SessionWorkspace` gains an optional `baseRef`, and
the per-task workspace record stores it. The record now answers both halves of §2.6: what the
caller asked for and which commit that resolved to. The desktop adapter forwards
`row.baseRef` for a worktree creation; the new-task surface still has no branch picker, so no
rendered control sends it yet.

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/host/test/http.test.ts` | 10 passed, 0 failed (110 assertions) |
| `bun test apps/host` | 178 passed, 0 failed, 23 files |
| `bun test apps/host apps/macos/agent-window/test` | 296 passed, 0 failed, 51 files (1,418 assertions) |
| `npx tsc --noEmit` scoped to `apps/host`/`packages/protocol`/adapter | no new errors |

The HTTP fixture builds a real repository with a second commit and a `base-line` branch at the
first one, then drives the real loopback server: a worktree task created with
`baseRef: "base-line"` reports `sourceCommit` equal to the first commit (not `HEAD`), repeats
that label as `baseRef`, and its worktree's `HEAD` really is that first commit. An unknown
revision is refused with `unknown_base_ref`, and a base revision requested for the project
folder itself is refused with `worktree_required`.

## Not implemented / not claimed

- No rendered branch picker: the adapter forwards a `baseRef` a window would have to supply,
  and no CEDIA surface offers the choice yet.
- §3.C's remaining clause - optionally copying selected uncommitted files into the new worktree
  - is untouched. `createWorktree` still copies the whole uncommitted snapshot; a selected copy
  is a separate, conflict-aware step.
- §2.4 intent/queue projection and pending-model boundary, §2.6 cleanup, R4-R8 and every §8.2
  O-packet remain open; speech-to-text stays deferred.

## Limitations

Fixture evidence from the revision above, on real repositories and a real loopback host. It
does not certify packaging or any rendered control.
