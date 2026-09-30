# Slice (O10 prelude diagnosis): namespaces proven through the partition — 2026-09-25

`browser` and `computer` are eval prelude namespaces, not session tools: they never
appear in the tool catalog rows, so the catalog-absence probe that settled
`generate_image`/`tts` could never see them. Their live signal arrived with the Code
Mode slice: `tools.codemode.get` reports each prelude's name with the runtime's own
enabled flag. This slice wires that signal into the Tool catalog panel's Needs-setup
diagnosis — an enabled prelude reads as registered, anything else as a dependency row
naming the `browser.enabled`/`computer.enabled` requirement with per-half diagnosis
once the setting value is known. No runtime or host code changed. Gap count
**29 → 27** (O10 dynamic-tool 2 → 0).

## What was built

- Window only (`CediaToolCatalogSurface.tsx`): `browser`/`computer` join
  `DYNAMIC_TOOL_DEPENDENCIES` (audit-pinned names); `dynamicToolDependencies` takes
  the Code Mode answer and exempts a prelude the partition proves enabled;
  `dynamicToolDetail` gains per-half sentences (setting unknown / off / on-but-unproven);
  the surface reads both settings lazily only while the prelude is unproven.
- Gate (`scripts/check-omp-coverage.ts`): both rows settle as `dependency_unavailable`
  with the partition read as handler, the panel as presentation, and the renderer
  tests as proof — the same shape as the O05 provider pair.
- Tests: `cedia-tools-catalog.test.tsx` +partition proof, per-half sentences, and a
  panel render with a proving partition (browser row gone, computer row diagnosed).

## Still open

- O10 `browser-relay` CLI (an external relay daemon; needs its own qualification).
- The O10 browser/computer subsystems themselves (automation surfaces) — this slice
  classifies availability, it does not drive either prelude.

## Evidence (this revision and build)

- Agent-window suite 328 pass / 0 fail; root typecheck clean.
- Partition read itself is live-proven by `scripts/omp-codemode-smoke.ts` (unchanged
  paths, no re-run needed); setting-value reads ride the proven settings route.
- `bun run check:omp-coverage`: integrity PASS, gap count **27** (was 29).
- `git diff --check`: clean.
