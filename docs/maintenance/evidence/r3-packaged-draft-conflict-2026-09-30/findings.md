# Packaged restart with conflicting renderer draft — 2026-09-30

## Result

PASS. The packaged app persists an unsent composer draft to its bundled host;
a stale renderer file cache is then seeded over the host canonical record and
the app process is SIGKILLed. After relaunch the composer rehydrates the host
canonical text, and the stale copy is preserved as a labeled
`agent-ui-import-conflict` host record with exact payload bytes. The relaunched
file cache is refreshed to the canonical draft. Zero provider requests, no
renderer exceptions, staged Electron exited cleanly.

## Runtime evidence

- Runner: `bun scripts/omp-packaged-draft-conflict-proof.ts` (new; modeled on
  `omp-packaged-owned-host-adoption-proof.ts` without the active-turn half) with
  `CEDIA_PACKAGED_OWNED_HOST_APP_PATH=<fresh $TMPDIR scratch>/Cedia.app` (copy of
  the installed `2026-09-30T08:25:21.069Z` package; installed app never launched).
- Flow: canonical draft typed in the real packaged composer and persisted to the
  host; renderer localStorage cache cleared to isolate host hydration; conflicting
  file cache (`draft:<task>` + `draft-revision:<task>`) seeded while the app is
  dead; SIGKILL; relaunch adopts the same host PID, generation, task incarnation
  and OMP owner; composer rehydrates canonical text.
- Assertions green: canonical rehydration despite stale cache; conflict record
  text, source `agent-ui-import-conflict`, and exact content bytes; file cache
  refreshed to canonical; same host/OMP owner across relaunch; zero provider
  requests; no renderer errors.
- `result.json`, screenshots and the shim log are under the ignored runtime
  output directory `dist/packaged-draft-conflict-proof/<runId>/`.
- The staged Login Item shim intercepted its setter calls (2) and simulated
  packaged state. This is not a Login Item or macOS login-cycle test.

## Limits

This closes the packaged restart + conflicting-draft combined case: the
production `preserveConflictingFile` path, previously proven only at fixture
level, now has packaged evidence. It does not prove legacy `cedia.drafts` map
migration on a packaged app (fixture-proven), real login-cycle, remote clients,
iPhone behavior, or full D/W/N/F acceptance.
