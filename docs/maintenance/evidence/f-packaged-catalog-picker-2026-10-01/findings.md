# F packaged catalog picker-row receipt (native observation) — 2026-10-01

## Result

PASS. `bun scripts/omp-packaged-catalog-overlay-proof.ts` with
`CEDIA_CATALOG_CUA=1` on a staged scratch Cedia.app went green
(`result.json` `ok: true`, `nativeObservationGates: true`, zero provider
calls, zero renderer errors) with all three native observation gates driven
by the agent through computer-use. The on-screen model picker visibly
tracked the dynamic provider lifecycle:

1. before-add: picker shows the `cedia-packaged-catalog-baseline` source tab
   with the single `Packaged catalog baseline` row; no fixture anywhere.
2. after-add: a new `cedia_packaged_catalog_fixture` source tab appears and
   its row reads `Ephemeral Packaged Fixture Model` — the dynamically
   registered model is selectable on screen with the baseline preserved.
3. after-remove: the fixture tab was briefly still visible on first picker
   open, then disappeared on refresh leaving baseline tab + row only — the
   picker refreshes live off the pushed session catalog (no restart).

This closes the on-screen picker-row half left open by the staged-only
[f-packaged-catalog-overlay-2026-09-29](../f-packaged-catalog-overlay-2026-09-29/findings.md)
receipt. Run ID `2026-10-01T04-04-32-604Z`; staged `Cedia.app` under the
system temp dir (installed app untouched); Login Item shimmed; staged
originals restored + re-codesigned in `finally`; `ps` confirmed zero staged
survivors. An earlier same-day attempt (`...T03-58-31-569Z`) is retained as
a failure: the 180 s `before-add` gate expired while the operator polled too
slowly — drive gates promptly, releases are not UI assertions by themselves.

## Runtime evidence

- Route assertions (same run): fixture absent before add, present atomically
  after `/dynamic-provider add` (`agentInvoked: false`), baseline preserved
  throughout, absent after `/dynamic-provider remove`, stale `set_model`
  refused with `Model not found`, global `GET /v1/models` omits the fixture
  row by construction (`--no-extensions` metadata workers, size 1).
- Gate screenshots taken by the runner: `before-add-window-0.png`,
  `after-add-window-0.png`, `after-remove-window-0.png`,
  `packaged-app-after-add.png`, plus per-phase `*-preferences.json` and
  `catalog-state.json`, under the ignored runtime directory
  `dist/packaged-catalog-overlay-proof/2026-10-01T04-04-32-604Z/`.
- OMP 18.4.3 (packaged + current source builds match, hashes in
  `result.json`).

## Limits

Staged-app proof only. Global-catalog propagation remains absent by design
(session extensions never reach `GET /v1/models`); other §11.1 F
semantic/dynamic/platform cases remain open. No gap count or D/W/N/F
checkpoint is reclassified by this receipt alone.
