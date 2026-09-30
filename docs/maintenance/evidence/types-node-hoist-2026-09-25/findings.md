# Fix (build gate: root `tsc --noEmit` 65 errors → 0)

Root typecheck failed with 65 errors across 12 files, triaged by root cause instead
of by file ownership: ~35 are `ChildProcess.once/off/on`, `Server.on/once` and
`readline.Interface.on` missing (TS2339) plus ~30 cascading implicit-any callbacks
(TS7006) — all symptoms of one cause, not twelve.

## Root cause

`node_modules/@types/node` was absent (only `bun`, `qrcode`, `ws` hoisted). A prior
restructure (`.old_modules-*` leftover, same date as the surviving links) dropped the
hoist, and `package.json` never declared the dep directly — it arrived by hoisting
luck. With `@types/node` invisible, `node:child_process`/`node:net`/`node:readline`
types fell back to bun-types' narrower stubs, which lack the EventEmitter surface,
and every `.once`/`.off`/callback in the tree failed at once.

## Fix (2 committed lines + 1 environment link)

- `package.json` + `bun.lock`: `"@types/node": "22.20.2"` promoted to a direct
  devDependency (the exact version the lockfile already pinned transitively).
- Environment: recreated the `node_modules/@types/node` symlink to the pinned store
  copy, matching the sibling links' pattern.
- Verified with real exit codes throughout (`tsc` exit 0, 0 errors — earlier
  `| tail` invocations in this thread masked the exit status and are not cited as
  evidence anywhere): root `tsc --noEmit` green, `bun install --dry-run
  --frozen-lockfile` accepts the hand-edited lock without changes, no
  duplicate-identifier storm from bun-types coexistence.

## Left alone, on purpose

The vendor agent-window check still reports one error in
`CediaToolCatalogSurface.tsx` — a genuine union mismatch in another thread's
untracked in-flight file, unrelated to this root cause. Untouched: no revert, no
drive-by fix in someone else's slice.
