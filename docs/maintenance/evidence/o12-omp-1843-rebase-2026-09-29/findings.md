# OMP v18.4.3 intake — rebase slice (no live-repo cutover)

## Result

CEDIA consolidated patch rebased 18.1.18 → upstream v18.4.3
(`fc671eba38`, 3,625 commits ahead of the pin). Work is committed in the
scratch clone `/tmp/omp-1843-fresh` (`c7a25d1c14`, working tree clean) and
exported as `/tmp/cedia-1843-handoff/0002-cedia-rpc-bridges-18.4.3.patch`
(121 files, SHA-256 `6628f5ef…f7f6`). The live repo still pins 18.1.18 —
no cutover, no manifest change, no live runtime rebuilt.

## Port shape

- 89/120 files applied clean. 31 hand-ported in two slices (OperationalLimpet
  1–16: rust natives + config/edit/runner/main/acp/input/interactive/rpc;
  MassiveBison 17–31: sdk/session/tools/tests). Zero hunks dropped as
  superseded; `modes/composer.ts` needs no port (deleted upstream, intent
  covered via hook-widget anchors).
- Upstream moves absorbed: registry-handle Settings reads, pi-tui UI moves,
  centralized settings registry, AuthStorage reshape, internal-URL routing.
- Follow-up fixes in-scratch: Claude-planner credit guard, memory-bridge
  fixture on real Settings, AST exact-file resolve path, throwing-disposer
  isolation, owner-test lock stub path.

## Verification (scratch clone)

- `tsc --noEmit -p packages/coding-agent`: 0 errors.
- `assertSettingApplyRegistry()`: 0 errors; schema 516 paths, index 516,
  counts `{immediate:26, new_session:30, reload:36, turn_boundary:424}`.
- CEDIA bridge suites green: capability 23/23, credit 5/5, queue/plan/owner/
  memory/ast-editor/editor-bridge/owner-controller (55/55 across the five
  first-listed files).
- Full package suite: 15,396 pass / 167 fail — failures are pre-existing
  environment gaps, not port regressions: stale 18.1.18 native addon
  (`pi_natives` needs `bun run build:native`, no Rust toolchain here) and
  tests that predate upstream refactors. No CEDIA-bridge failure outside the
  natively-blocked editor-routing set (same addon cause).

## Not done (explicit)

- Live-repo cutover: manifest pin move, `prepare-omp-runtime`, attested
  rebuild, coverage-gate re-run, packaged re-proof. That is a separate
  owner-gated step — this slice proves the patch exists and compiles.
- Native addon rebuild (`bun run build:native`, needs cargo) — unavailable
  in this environment.
