# Relocation/import check: #1266 patterns recorded, #1271 out — 2026-09-26

Dispositions #1266 (project relocation) and #1271 (Claude Artifacts +
Claude project import) from patch-level reading. No product code changed;
no gap change (stays **2**: `switchSession`, `browser-relay`). §10 item 70
owns status. No provider involvement.

## #1271: out of scope

Claude Artifacts support plus Claude project import (5 commits) — another
harness's execution/import, excluded by the baseline like #1261's import
commits. No CEDIA counterpart exists or is owed.

## #1266: patterns recorded, feature needs design (not ported)

The relocation core is small and clean (`projectRelocationPaths.ts`,
~1.5k bytes): prefix-rewrite stored absolute paths from old root to new
(darwin-normalized comparison; non-absolute and outside values untouched),
plus two rules — missing cwd metadata is not proof of a move, and
relocation preserves the recorded archive and cwd-less provider sessions.

CEDIA mapping (current tree): task rows already record what relocation
would need to rewrite (worktree path, branch, sourceCommit) and the
archive receipt already records what must survive it (retained worktree,
branch, stopped-on commit, immutable `refs/cedia/archive/…`); restore
refuses an unavailable repository with an actionable reason instead of
guessing. What does NOT exist is a re-point operation: no host route moves
a task/project record to a moved folder, so a renamed project folder today
ends in honest refusal, not recovery. Building that route (prefix rewrite
+ archive-ref preservation + the missing-cwd rule, behind a confirm) is a
future design slice with its own tests — not a backport, since CEDIA has
no Synara-server decider/projection to receive it.

## Proof

- `bun test apps/host/test/workspaces.test.ts`: 12 pass, 0 fail
  (73 expects) — workspace identity, snapshot patch-hash binding, and
  traversal/symlink refusal, this turn (relocation preconditions).
- `git diff --check`: clean.

## Preserved

- D1–D5, deferred voice, `switchSession` open, single OMP
  execution/transcript/auth owner, no worktree deletion. Pin unchanged.
  Nothing committed; uncommitted tree preserved.
