# O06 packaged reload boundary — 2026-10-01

## Result

Blocked by a product boundary, fully evidenced: there is currently NO
swappable TypeScript-extension path on the packaged topology, so packaged
hot-reload (A→B→rollback→removal) cannot be qualified today. This converts
the open "packaged qualification" tail of the O06 live-transaction receipt
into a specified implementation requirement instead of a silent absence.

Proven on OMP 18.4.3 (packaged + source builds hash-matched), zero provider
calls on every run, staged scratch apps only, zero staged survivors after
each run:

1. Lock-overlay loads at startup: the staged bundled lock file overlaid with
   lock body + fixture generation A loads `hot-reload-packaged-a` and
   `cedia_packaged_reload_fixture/hot-reload-packaged-model-a` through the
   packaged owner with the baseline preserved
   (`dist/packaged-reload-proof/2026-10-01T05-57-51-805Z/`).
2. Rewriting the staged lock file to generation B + `/reload-plugins`
   completes but the catalog is unchanged — the session-lock extension is
   NOT re-evaluated on reload (same failure point retained in `failure.json`).
3. The same swap works when the fixture is a DIRECT `--trusted-extension`
   on the same standalone binary (`w5-a` → `w5-b` live), so the binary
   supports the mechanism; only the lock path is exempt.
4. `settings.json` `extensions: [<file>]` and `<profile>/extensions/`,
   `<state>/extensions/`, `<project>/.omp/extensions/` do NOT load for
   CEDIA-hosted sessions (threeplacements probed, `FOUND: []`) — discovery
   is not an alternate injection path.
5. A fixed wrapper that dynamically re-imports a fixture is re-evaluated but
   the inner file import goes stale (Bun file-module cache) or fails
   (`Cannot find module ... from ''`), so indirection does not help either.

## Requirement for future work

Packaged reload needs one injectable, reloadable extension path, e.g. a
host-supported extra `--trusted-extension` for scratch proofs or a
session-scoped extension root honored for hosted sessions. Until then the
packaged half of O06/F stays explicitly blocked (not merely unattempted).

## Mechanism notes (verified, reusable)

- Rewritten `--trusted-extension` files swap generations on reload; the
  rewrite must cross the change-detection tick (explicit ~1.3 s settle before
  `/reload-plugins`, else the change is missed).
- Wrapper re-import does not escape the module cache; per-generation unique
  file imports fail inside the extension sandbox. Put fixture content
  directly in a reloaded file.
- Probe scripts: `scripts/omp-packaged-reload-proof.ts` (packaged attempt,
  fails honestly at the B-swap check); `/tmp` wrapper/discovery probes were
  scratch-only and are described here, not committed.

## Limits

Development-runtime reload stays green (requalified 18.4.3 in the same
session: full A→B→rollback→removal→409 sequence, same PID/incarnation, zero
inference). Standalone interactive/ACP concurrent reload and live
shared-source provider replacement remain open alongside this boundary.
