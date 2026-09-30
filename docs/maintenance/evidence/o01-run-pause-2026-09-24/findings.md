# Pausing a run without aborting it, end to end — 2026-09-24

This receipt records the O01 slice that closes the `/pause` gap with a real control: the
composer offers Pause beside Stop while a turn runs and Resume with a Paused badge while the
process gate is engaged. Stop still aborts; pause freezes every agent loop at its next safe
point without aborting anything, and resume wakes them. §10 item 70 owns status; this file
records what was observed at the revision below. No provider turn was run and no model
endpoint was configured.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. Upstream changed in this slice (new pause bridge, two
  registered operations, rpc-mode wiring, bridge tests): `patches/omp/0001-cedia-rpc-bridges.patch`
  regenerated (828,987 bytes, sha256
  `0025f46b92ae497684a38da52c8d229c6b6a7fc6fa1b8c13f5037cc04ef31f50` per
  `patches/omp/manifest.json`); `bun scripts/prepare-omp-runtime.ts` re-prepared
  `dist/omp/omp`.
- Changed for this slice: `upstream/omp` `cedia-pause-bridge.ts`, `rpc-types.ts`,
  `cedia-capability-bridge.ts`, `rpc-mode.ts`, `test/cedia-pause-bridge.test.ts`,
  `test/cedia-capability-bridge.test.ts`, `test/cedia-model-state-bridge.test.ts`;
  `apps/host/src/omp-pause.ts`, `apps/host/src/{service,router}.ts`,
  `apps/host/test/omp-pause.test.ts`, `apps/host/test/fixtures/fake-host.mjs`;
  `apps/macos/agent-window/src/cedia-adapter.ts`,
  `apps/macos/agent-window/test/adapter.test.ts`,
  `vendor/synara/.../lib/serverReactQuery.ts`,
  `vendor/synara/.../components/chat/CediaRunPauseControl.tsx`,
  `vendor/synara/.../components/chat/ChatComposerFooter.tsx`,
  `vendor/synara/.../components/ChatView.tsx`,
  `apps/macos/agent-window/test/cedia-pause-surface.test.tsx`;
  `scripts/omp-pause-smoke.ts`, `scripts/check-omp-coverage.ts`; this receipt;
  `docs/maintenance/CEDIA-PLAN.md` (item 70 row).

## What changed (one vertical, each layer owning its half)

- **Runtime** (`cedia-pause-bridge.ts`, plan §8.2 O01): `pause.get` reads the process gate as
  it stands (`{paused, pausedAt?}`, no paused key while running); `pause.set` drives it and
  answers the state that follows, idempotently — pausing while paused replays the state, not
  an error. Cedia starts one runtime process per task session, so the process gate is that
  task's gate. Registered as `pause.get` (controller) and `pause.set` (owner) over
  `cedia_control`, advertised in the live capability table (46 → 48 descriptors).
- **Host** (`omp-pause.ts`, service, router): strict `OmpPause` projection with revision CAS
  semantics matching the sibling controls; owner-only `GET /v1/sessions/:id/pause` and
  owner-only durable `POST /v1/sessions/:id/pause` (`{commandId, incarnation, paused}`,
  boolean strictly validated, stale incarnation refused, replay returns the receipt).
- **Adapter + window**: `getRunPause`/`setRunPause` with typed refusals preserved; strict
  `parseCediaPauseAnswer` with query/mutation options (no polling timer, like the queue);
  `CediaRunPauseControl` beside Stop in both windows' composer (Pause while running, Resume
  with a Paused badge while engaged, hidden when the bridge is absent so no fake control ever
  renders). Pausing a parked run still leaves Stop working: abort unwinds a parked loop
  without releasing the gate, per OMP's own semantics.
- **Gate**: `/pause` is `platform_presentation_equivalent` — the composer control over the
  registered operations, proven live.

## What was observed

- `bun scripts/omp-pause-smoke.ts`: 16 checks OK through a real booted host against the
  prepared runtime — absence before start, running read with no paused key, owner pause
  accepted with the pause and its start, identical re-read, idempotent replay, owner resume
  with no paused key, 400 on missing/non-boolean/extra fields, 409 on stale incarnation.
- Upstream: `test/cedia-pause-bridge.test.ts` 3 pass (idempotent re-pause, resuming a running
  gate, gate restored after each test); capability + model-state bridge tests pass;
  `bun run check:types` in `packages/coding-agent` exits 0;
  `packages/agent/test/pause-gate.test.ts` 5 pass (the parking semantics this slice relies on).
- Host: `apps/host/test/omp-pause.test.ts` 6 pass, including the real-host route driving the
  fixture gate (engage, re-read, replay-once on the wire, release).
- Adapter: `apps/macos/agent-window/test/adapter.test.ts` 46 pass, including the new read +
  write-shape test with boolean refusal.
- Window: `apps/macos/agent-window/test/cedia-pause-surface.test.tsx` 3 pass (Pause vs
  Resume rendering, strict parsing, no polling timer).
- Sweeps: root (`packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib`)
  1307 pass / 0 fail; agent-window suite 285 pass / 0 fail; host suite 379 pass / 0 fail;
  `bun run typecheck` holds the 10 pre-existing `apps/macos` errors only;
  `bun run check:omp-coverage` integrity PASS with gap count **58** (was 59);
  `node scripts/ci-validate.mjs` CI-OK; `git diff --check` clean.

## Still open (not claimed)

- No packaged capture of the Pause control and no parked-run observation against a live
  provider turn (pausing a streaming turn needs a provider; the smoke proves state control,
  OMP's own tests prove parking).
- The control hides when the bridge is absent rather than explaining why; the composer still
  offers Stop there, so no task is left without a run control.
