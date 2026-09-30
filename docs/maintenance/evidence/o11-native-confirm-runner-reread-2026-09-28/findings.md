# Native editor confirm runner rediscovery — 2026-09-28

## Root cause

The packaged proof runner used the same Monaco text predicate both when opening the fixture and
after approving the editor change. That predicate searched for the original disk text even though
the post-approval contract requires the edited unsaved buffer. When the previous Code-OSS renderer
still showed a baseline view, the runner could select that stale renderer; otherwise it could fail
to find the renderer that owned the edited buffer.

## Change

The runner now selects the Monaco page by phase: the disk baseline after opening the file, and the
approved edited text after the confirmation. The production helper is covered by two renderer
snapshots: one proves the post-approval search skips a stale baseline renderer, and one preserves
the initial-open behavior.

## Verification

- The regression failed with the old baseline-only predicate: the approved-phase search returned
  the stale handoff page instead of the renderer containing `unsaved edited`.
- `bun test scripts/lib/omp-native-confirm-editor.test.ts`: **2 pass, 0 fail**.
- `bun run typecheck`: passed.
- `bun run check:repo`: passed (`CI-OK`, 835 doc links, 361 Markdown files, 328 evidence items).
- `bun run check:omp-coverage --require-complete`: passed (1,041/1,041 mappings; zero missing
  dispositions). This is source completeness, not D/F acceptance.
- `git diff --check`: passed.
- Repository revision at this source checkpoint: `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`;
  implementation and test are in the existing dirty working tree.
- Changed-code SHA-256: proof runner
  `c69414331e09d718baf9d48c27120c7ee41ad5420254059981b2d29619c5e32e`, selection helper
  `51123fd3518ef1788dd33a2213cbc85fb70c919fd46e936fff4969aacc20a971`, regression test
  `29404deeabc25802146cf07b3a1cce86e37d0b7a98da1832e550924e9b59e564`.

## Limits

This is a source-level proof-runner correction only. No packaged app, Login Item, Keychain, Muse
prompt or provider spend was used. The prior host journal and unchanged scratch-file bytes support
the already observed editor behavior, but the corrected runner has not yet performed a packaged
post-approval reread. Login Item provenance must be resolved before another packaged run; D and F
remain open.
