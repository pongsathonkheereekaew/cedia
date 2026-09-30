# F packaged catalog overlay proof (staged-only) — 2026-09-29

## Result

`bun run smoke:packaged-catalog-overlay`
(`scripts/omp-packaged-catalog-overlay-proof.ts`, staged `Cedia.app` under the
system temp dir, `CEDIA_PACKAGED_CATALOG_APP_PATH`) passed against OMP 18.1.18.
The staged bundled lock-extension file
(`.../extensions/cedia/runtime/host/runtime-lock.ts`) was overlaid with a
lock-first wrapper whose single default export calls `lockOmpSession()` then
registers `/dynamic-provider add|remove` — the same fixture command shape as
`scripts/omp-dynamic-provider-smoke.ts`. No product file changed; no
`CEDIA_EXTRA_TRUSTED_EXTENSION` channel was added.

Observed sequence (all through the PACKAGED host + PACKAGED OMP owner):

1. `cedia_packaged_catalog_fixture/ephemeral-packaged-model` absent from the
   packaged session `get_available_models`; baseline row present.
2. `/dynamic-provider add` via `POST /v1/sessions/:id/commands` settles
   `completed` with `agentInvoked: false`; the same packaged session catalog
   gains the fixture row and keeps the baseline.
3. The packaged global `GET /v1/models` catalog OMITS the fixture row — by
   construction: `apps/host/src/model-catalog.ts` `metadataArgs` spawns
   `--no-extensions` metadata workers, so session extensions never reach it.
   This records the renderer-propagation gap; it does not claim propagation.
4. `/dynamic-provider remove` settles locally; the packaged session catalog
   loses the fixture row and keeps the baseline.
5. `set_model` for the removed model fails with OMP's `Model not found:
   cedia_packaged_catalog_fixture/ephemeral-packaged-model`.
6. Loopback provider tripwire received zero requests; zero renderer page errors.

## Runtime identity and limits

- Repository revision: `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` (working tree dirty by design).
- Runtime version: `omp/18.1.18` (packaged + current source builds match).
- Staged originals restored and the staged bundle re-codesigned in `finally`;
  the staged lock file carries no overlay after the run (verified).
- Captures: `dist/packaged-catalog-overlay-proof/<timestamp>/catalog-state.json`,
  `packaged-app-after-add.png`.
- This proves packaged extension mechanics (lock-first wrapper loads, session
  register/unregister propagate, stale refusal) with zero provider calls. It
  does not prove on-screen picker-row capture, global-catalog propagation, or
  full F acceptance; other §11.1 F semantic/dynamic/platform cases remain open.
  No gap count or D/W/N/F checkpoint is reclassified.
