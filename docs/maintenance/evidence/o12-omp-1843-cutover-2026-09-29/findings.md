# OMP v18.4.3 cutover — live-repo pin move + attested rebuild (2026-09-29)

## Result

Live pin moved 18.1.18 (`00085d4e7d`) → v18.4.3 (`fc671eba38`).
`patches/omp/manifest.json` names both patches (0001 frozen 18.1.18 record,
0002 active rebased patch, SHA `a90b75f9…`); `prepare-omp-runtime.ts` selects
the entry matching the pinned revision. `upstream-lock.json` + `docs/UPSTREAM-LOCK.md`
pin the new revision; `OMP_BASELINE_VERSION` is now `18.4.3` (floor moved with it).

Rebuilt attested development runtime: `dist/omp/omp` reports `omp/18.4.3`,
`runtime.json` revision `fc671eba…`, source tree `3b333bd1fea898e8c5c81e6e06d83db26d70d61d`,
active patch `0002` only. Native addon rebuilt with the isolated cargo toolchain
after restoring the one-line `path_policy::{PathPolicy, UrlResolution}` re-export
the 18.4.3 rebase hunk had dropped (upstream moved the canonical import there;
`pi-natives/edit.rs` still imports both from the crate root): `cargo build
--locked -p pi-natives` green, `prepare-omp-runtime` prints the prepared line.

The `0002` patch file on disk differs from the scratch-clone export by exactly
two hunks: the lib.rs re-export fix (additive line, corrected hunk counts) and
regenerated context. Verified: fresh clone at `fc671eba38` + `git apply --check`
passes, full 121-file apply succeeds, committed tree builds the native addon clean.

## Verification

- `bun run typecheck`: clean. `git diff --check`: clean.
- `bun test packages/omp-adapter apps/host`: 548 pass / 4 fail.
  Two fails are stale-env artifacts, not regressions: the suite's default
  `CEDIA_OMP_BINARY` fallback (`/Users/pond/.local/bin/omp`, still `omp/18.4.2`)
  is now below the moved floor, and `dist/omp-standalone/omp` is still the
  18.1.18 build. With `CEDIA_OMP_BINARY=dist/omp/omp` the second-lock test passes;
  the adopt-after-EOF incarnation assertion and the standalone-editor test still
  fail and need a re-probe against the new runtime (open below).
- `packages/omp-adapter/test/version.test.ts` + `apps/host/test/router.test.ts`: 16/16.
- `bun scripts/check-omp-coverage.ts`: 1041/1041 mappings, 0 gaps;
  Integrity FAIL with 61 fatal issues — all expected audit drift against the new
  revision: 12 `stale_source` + 1 `source_missing` (audit JSONs pin 18.1.18 file
  hashes/paths, e.g. `settings-schema.ts` moved), 46 `runtime_mismatch`
  (14 audited settings gone, 32 new live settings; live inventory now 516 keys
  vs audited 498), 3 `unclassified` (SDK dispositions whose claimed upstream
  call sites moved). The dated `omp-complete-scope-2026-09-23` audit was written
  against 18.1.18 and was never regenerated for 18.4.3. No mapping was silently
  dropped: every audited record still has exactly one Cedia disposition.

## Not done (explicit)

- Coverage audit re-generation for 18.4.3: the `omp-complete-scope` JSONs
  (`config-cli.json`, `rpc.json`, `tools.json`, `sdk.json`, `coverage.json`,
  `verify.py`) still describe 18.1.18. Until they are re-inventoried from the
  new pin, the coverage gate cannot pass `--require-complete` and F stays open.
- Adopt-after-EOF incarnation semantics on the new runtime (test asserts the
  adopted incarnation equals the pre-EOF one; live 18.4.3 returns a new one).
- Standalone `dist/omp-standalone/omp` rebuild (still 18.1.18 build; the
  packaged-editor test refuses it by version).
- Packaged re-proof (`package:mac`, `check:packaged`) on the new runtime.
- `dist/` and `upstream/omp` are git-ignored build/checkout state, not commits;
  the committed cutover is manifest + locks + baseline + patch file + scripts.
