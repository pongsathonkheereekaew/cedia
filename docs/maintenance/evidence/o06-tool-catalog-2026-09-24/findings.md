# The session's live tool catalog, and nothing else — 2026-09-24

This receipt records the O06 discovery-half slice: the runtime's own tool registry and activation
state reach a paired controller through one registered `cedia_control` operation and one
controller-visible host route, with the same strict shape validation the tree slice uses. §10 item 70
owns status; this file records what was observed at the revision below. No provider request was made
and no model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`
  with this slice applied; the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. `patches/omp/0001-cedia-rpc-bridges.patch` regenerated for this slice
  (811,453 bytes, sha256 `d5d304b81985a5274da15fda19f0cf8b747df26f42a69997844674e42a91b039`), recorded in
  `patches/omp/manifest.json`; `bun scripts/prepare-omp-runtime.ts` re-prepared `dist/omp/omp`.
- Changed for this slice: `upstream/omp` `cedia-tools-bridge.ts` (new), `cedia-capability-bridge.ts`,
  `rpc-mode.ts`, `test/cedia-tools-catalog-bridge.test.ts` (new);
  `packages/omp-adapter/test/cedia-capabilities.test.ts` (44-operation table);
  `apps/host/src/omp-management.ts` (new), `apps/host/src/{service,router}.ts`,
  `apps/host/test/omp-management.test.ts` (new);
  `scripts/lib/omp-coverage.ts` (two SDK links), `scripts/omp-tools-catalog-smoke.ts` (new).

## What changed

- **One runtime operation**, delegating to OMP's own session (plan §8.2 O06):
  - `tools.catalog.get` answers the session's own `getAllToolInfos()` (the same `ToolInfo[]` the
    extension API publishes) beside its own `getActiveToolNames()`. The wire carries per tool only
    `name`, a 500-character-bounded `description` with its truncation flag, `source` as OMP classifies
    it (`builtin`/`mcp`/`sdk`/`extension`, unknown reported as `extension` rather than refused) and
    `active`; full JSON parameter schemas stay in the runtime. A tool the registry does not hold is
    absent rather than reported as disabled. Family O06, session scope, controller principal, all four
    surfaces, payload refused.
- **One host projection** (`apps/host/src/omp-management.ts`, plan's proposed `omp-management.ts`):
  strict per-row parsing with duplicate-name and unknown-field refusal, `OmpToolCatalog` per-session
  projection that never starts a runtime, and controller-visible
  `GET /v1/sessions/:id/tools/catalog` (query/body/method refusals before any runtime call).
- **Two audit rows settled** through the gate's live-table rule: `getAllToolInfos` and
  `getActiveToolNames` now link to `tools.catalog.get`. Gap count 77 → 75; integrity PASS.

## What was observed

- `bun test upstream/omp/packages/coding-agent/test/cedia-tools-catalog-bridge.test.ts`: 5 pass.
- `bun test apps/host/test/omp-management.test.ts`: 4 pass.
- `packages/omp-adapter/test/cedia-capabilities.test.ts`: 10 pass against the prepared runtime
  (the pinned 44-operation table; every available row ran, including the new read).
- `bun scripts/omp-tools-catalog-smoke.ts`: 15 checks OK — live registry names the native `read`
  tool, active is a subset of registered, the untruncated total names every tool, and the host route
  carries the runtime's own rows to a paired controller.
- No-regression sweep at this revision: root suites 1297 pass / 0 fail (1293 + 4 new),
  `apps/host` 370 pass (366 + 4 new), agent-window 276 pass, tree/history/model-state smokes pass,
  root typecheck holds the 10 pre-existing `apps/macos` errors only, `node scripts/ci-validate.mjs`
  `CI-OK`, `git diff --check` clean. `cd upstream/omp/packages/coding-agent && bun run check:types`
  exits 0.

## Still open (not claimed)

- No window surface yet: the Settings/catalog/command components in either window do not draw this
  catalog, so `/extensions` and the `status` alias stay gaps and O06's "same catalog in both windows"
  close condition is unmet.
- No management write: `setActiveToolsByName`, `refreshMCPTools`, `refreshSkills`,
  `refreshRpcHostTools`, `reload`, `extensionRunner`, code-mode partitions and
  `subscribeCommandMetadataChanged` stay gaps with their O06 reasons.
- The probe this slice adds is what O05's two dynamic tools (`generate_image`, `tts`) and O06's two
  dynamic rows (custom/extension, `mcp__<server>_<tool>`) need for an honest
  dependency-unavailable classification; that classification itself is the next slice, not this one.
- No packaged capture of any catalog surface exists.
