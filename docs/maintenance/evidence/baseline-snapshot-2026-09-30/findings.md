# Source baseline snapshot — 2026-09-30

## Scope

The owner selected the proposal to organize the accumulated working tree and create
one verified source baseline commit. The starting HEAD was
`0676dd70d54e429b5a72c98cb3f22a646bbd10eb` on `main`, 21 commits ahead of the locally
recorded `origin/main`. No remote fetch or push was performed. The resulting commit
contains this receipt; its identity is available from Git history.

The snapshot includes accumulated application source, tests, OMP 18.4.3 and desktop
patches, approved brand assets and dated evidence. The plan-cited decision records in
`.scratch/cedia-direction/issues/` are retained as historical rationale. Their directory
name does not make them disposable runtime output. This snapshot does not represent a
new full code review of every accumulated implementation change.

## Files preserved outside the commit

- Root `agent.db`, `history.db`, `models.db` and each database's `-shm`/`-wal` files;
  root `WATCHDOG.yml`. Exact root-only ignore rules now protect these runtime files.
- `assets/brand/monochrome-explorations/` and
  `docs/maintenance/evidence/cedia-monochrome-icon-research-2026-09-28/`: unrelated,
  unindexed brand exploration remains untracked and unchanged.
- Existing ignored credentials, local state, dependencies, upstream checkouts and
  build outputs retain their existing exclusions. No file was deleted or moved.

The staged inventory was checked for runtime/database/credential paths. A text pattern
scan found only three known synthetic credential strings in adapter tests; this is a
bounded hygiene check, not a guarantee that every possible secret format was detected.
Whitespace defects in two newly tracked files were corrected without changing behavior.

## Fresh verification

| Command | Result |
| --- | --- |
| `CEDIA_OMP_BINARY=/Users/pond/cedia/dist/omp/omp bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | PASS: 1,438 tests, 8,602 expectations |
| `bun test apps/macos/agent-window/test` | PASS: 418 tests, 1,519 expectations |
| `bun run test:mobile` | PASS: 172 tests, 813 expectations |
| `bun run typecheck` | PASS |
| `bun run --cwd apps/macos/agent-window typecheck` | PASS, including vendor check |
| `bun run --cwd apps/ios typecheck` | PASS |
| `bun scripts/check-omp-coverage.ts --require-complete` | PASS: 1,101/1,101, zero fatal issues or gaps; live OMP 18.4.3, 516 settings, 61 RPC commands, 73 descriptors |
| `bun run check:repo` | FAIL: 105 existing documentation issues |

The documentation failures include missing historical brand-prototype outputs, old
upstream source links and the excluded unindexed monochrome research. They are retained
as known failures rather than weakening the validator or inventing missing artifacts.
The default user OMP executable is older than the pinned baseline; tests explicitly use
the repository runtime. The current checkout has no `VSCode-darwin-arm64/Cedia.app`, so
no packaged verification was claimed or package rebuilt in this baseline operation.

## Acceptance boundary

This commit preserves tested source and its evidence. It does not close D/W/N/F,
reproduce every historical provider-backed receipt, or qualify remote/native devices.
The September 29 packaged results apply to those recorded builds. Remaining work stays
under CEDIA-PLAN section 10 item 70, including current-pin Send/edit CUA, real login,
Tailscale/off-LAN, physical iPhone and semantic/platform qualification.
