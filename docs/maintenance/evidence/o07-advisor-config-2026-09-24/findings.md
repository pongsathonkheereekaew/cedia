# Advisor roster editing without the terminal overlay, end to end — 2026-09-24

This receipt records the O07 slice that closes `applyAdvisorConfigs` with a real surface: the
composer Advisor panel edits one scope's `WATCHDOG.yml` as raw text and saves it through the
registered `advisor.config.set` operation, which validates strictly before touching disk and
applies the re-discovered roster without a restart — the `/advisor configure` save path
without the terminal overlay. §10 item 70 owns status; this file records what was observed at
the revision below. No advisor turn ran and no provider was configured.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. Upstream changed in this slice (new config bridge, exported
  schema const, two registered operations, rpc-mode wiring, bridge tests): `patches/omp/0001-cedia-rpc-bridges.patch`
  regenerated (845,154 bytes, sha256
  `7c4307347dee8de7cab51c3bf7c0ab81484d46598355b1dbbf7cabc1203c5261` per
  `patches/omp/manifest.json`); `bun scripts/prepare-omp-runtime.ts` re-prepared
  `dist/omp/omp`.
- Changed for this slice: `upstream/omp` `cedia-advisor-config-bridge.ts`, `rpc-types.ts`,
  `cedia-capability-bridge.ts`, `rpc-mode.ts`, `advisor/config.ts` (one-word schema export),
  `test/cedia-advisor-config-bridge.test.ts`, `test/cedia-capability-bridge.test.ts`,
  `test/cedia-model-state-bridge.test.ts`;
  `apps/host/src/omp-advisor-config.ts`, `apps/host/src/{service,router}.ts`,
  `apps/host/test/omp-advisor-config.test.ts`, `apps/host/test/fixtures/fake-host.mjs`;
  `apps/macos/agent-window/src/cedia-adapter.ts`,
  `apps/macos/agent-window/test/adapter.test.ts`,
  `vendor/synara/.../lib/serverReactQuery.ts`,
  `vendor/synara/.../components/chat/CediaAdvisorSurface.tsx`,
  `apps/macos/agent-window/test/cedia-advisor-config-surface.test.tsx`;
  `scripts/omp-advisor-config-smoke.ts`, `scripts/lib/omp-coverage.ts`,
  `scripts/check-omp-coverage.ts`; this receipt; `docs/maintenance/CEDIA-PLAN.md` (item 70 row
  plus the O07 prose it supersedes).

## What changed (one vertical, each layer owning its half)

- **Runtime** (`cedia-advisor-config-bridge.ts`, plan §8.2 O07): `advisor.config.get` reads one
  scope's file as raw editor text (missing reads as absent); `advisor.config.set` validates
  the text strictly (YAML parse plus schema, 64 KiB bound) before writing exactly what was
  validated, removes the file on an empty write, then re-discovers the merged roster and
  applies it through the session's own `applyAdvisorConfigs`. Registered as
  `advisor.config.get` (controller) and `advisor.config.set` (owner) over `cedia_control`,
  advertised in the live capability table (48 → 50 descriptors).
- **Host** (`omp-advisor-config.ts`, service, router): strict projection; owner-only
  `GET /v1/sessions/:id/advisor/config?scope=` (scope required) and owner-only durable
  `POST /v1/sessions/:id/advisor/config` (`{commandId, incarnation, scope, text}`, replay
  returns the receipt, stale incarnation refused).
- **Adapter + window**: `getAdvisorConfig`/`setAdvisorConfig` with typed refusals preserved;
  strict parse plus query/mutation options (refetch on focus, no polling timer); the Advisor
  panel gains a Configure section (Project/User tabs, file path, raw textarea, Save/Cancel,
  applied-roster confirmation, refusal alert) in both windows, reusing the existing toggle
  and transcript.
- **Gate**: `applyAdvisorConfigs` is carried by the registered `advisor.config.set`
  operation, settled only while the live table reports it.

## What was observed

- `bun scripts/omp-advisor-config-smoke.ts`: 22 checks OK through a real booted host against
  the prepared runtime — absence before start, malformed and schema-violating writes refused
  with the reason and no file left behind, owner write accepted with the exact text on disk,
  re-read round-trip, idempotent replay, empty write removes the file, 400s before any
  runtime call, stale refused; then enabling the advisor shows the applied roster live with
  its honest `no_model` status (the fixture models carry no advisor role, so zero runnable is
  the correct count) before switching back off.
- Upstream: `test/cedia-advisor-config-bridge.test.ts` 6 pass (raw round-trip, both refusals
  leave no file, empty removal, scope/bound refusals); capability + model-state bridge tests
  pass; `bun run check:types` in `packages/coding-agent` exits 0.
- Host: `apps/host/test/omp-advisor-config.test.ts` 6 pass, including the real-host route
  driving the fixture gate.
- Adapter: `apps/macos/agent-window/test/adapter.test.ts` 47 pass, including the new
  read + write-shape test with scope/text refusals.
- Window: `apps/macos/agent-window/test/cedia-advisor-config-surface.test.tsx` 6 pass
  (closed vs open editor, scope tabs, missing-file note, saved count, refusal alert, strict
  parsing, no polling timer).
- `bun run check:omp-coverage`: integrity PASS, gap count **57** (was 58), O07 sdk 2
  (was 3).
- Sweeps: root (`packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib`)
  1313 pass / 0 fail (155 files, including the new config tests and the extended live
  capabilities enumeration); agent-window suite 292 pass / 0 fail (62 files);
  `bun run check:types` in `packages/coding-agent` exits 0; root `bun run typecheck` holds
  the 10 pre-existing `apps/macos` errors only; `node scripts/ci-validate.mjs` CI-OK;
  `git diff --check` clean.

## Still open (not claimed)

- No packaged capture of the Configure section; the editor is a raw textarea (structured
  per-advisor controls would be a separate surface, not a correction).
- O07 keeps `armPrewalk`/`getPrewalkState`, `/agents`, `/guided-goal`, `/hub`, `/loop`.
