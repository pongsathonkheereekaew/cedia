# O07 native goal restart proof — 2026-09-28

## Result

Added RPC startup reconciliation for OMP's persisted `goal` and `goal_paused` session modes in
`upstream/omp/packages/coding-agent/src/modes/rpc/cedia-goal-bridge.ts`. On its first Cedia goal
request, the bridge reads the session's latest persisted mode, validates the goal record, and
calls OMP's `GoalRuntime.onThreadResumed()` so the runtime retains its existing restart semantics.
It restores the goal tool for follow-up owner operations. The completed hydration flag is set only
after successful state/tool restoration.

The new `bun scripts/omp-goal-restart-smoke.ts` uses an isolated CEDIA host, temporary OMP profile,
temporary project and the prepared OMP 18.1.18 executable. It exercises two different persisted
states across real host/OMP shutdown and restart:

1. **Explicitly paused before shutdown:** OMP writes `goal_paused`; after restart the same goal id,
   objective, paused status and 420,000-token budget are read through the controller route. The
   owner resumes and drops that same goal.
2. **Active at shutdown:** the test starts a goal and holds its objective request at a local
   loopback fixture, then confirms OMP persisted the `goal` mode before closing the host and OMP
   child. After a fresh pair starts on the same session file, controller readback shows the same
   goal id, objective and budget with status `paused`. With `goal.continuationModes: [rpc]` enabled
   in the isolated profile, the fixture receives no request during the recovery interval. An
   explicit owner `resume` then produces exactly one new loopback request. This proves active-at-
   shutdown recovery pauses the goal without an unrequested continuation.

## Verification

- `bun scripts/omp-goal-restart-smoke.ts` — PASS; both paused-before-shutdown and active-at-shutdown
  cases passed on OMP 18.1.18, including no continuation before owner resume and one request after it.
- After the source-tree audit below, the same smoke was rerun against the freshly prepared,
  fully attested OMP launcher and passed both cases again.

## Pinned runtime provenance (2026-09-28 refresh)

The pre-refresh temporary-index comparison found exactly one delta between manifest HEAD-plus-
patch tree `46a035a378569e81ed55bb065de6f7c858276489` and the actual tree:
the newly added, authorized `packages/coding-agent/src/modes/rpc/cedia-goal-bridge.ts` from this
slice. The patch was refreshed and the development runtime prepared from the resulting tree.

- OMP revision: `00085d4e7dfdcfbf302c122fa2682b410a0f43d1` (`omp/18.1.18`).
- Prepared/attested source tree: `1543a4c9ee84f8e3fb195023a47e1082176200ec`.
- OMP bridge patch SHA-256: `d30b933ad3cd68da09582d43626d7db21da99af34ea7670bd160b8132ea5c469`.
- Runtime launcher SHA-256: `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`.
- Patch manifest SHA-256: `4f9324c38647d37754bee14fc9f7c699807ab5072b37a1bef383110f9dcfed12`.
- Bun SHA-256: `35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5`.
- Native module SHA-256: `05774ec09950a150b7c1cce63359bd26ed6d3eecc44a6261e09e9403371e7869`.
- `attestOmpRuntime(".", "dist/omp/omp")` — PASS (`development-source-launcher`,
  `sourceVerified: true`).

Post-refresh gates: `bun run typecheck`, `bun run check:repo`,
`bun run check:omp-coverage --require-complete`, and `git diff --check` passed. The smoke uses
only local fixtures and does not claim packaged, remote-device, or full D/W/N/F acceptance.

## Boundaries

The smoke uses only a local loopback fixture; there are no external provider requests or inference.
It does not launch the packaged app, touch Keychain/Login Items, or alter coverage dispositions.
This proves these two native goal restart lifecycles through the host-backed RPC runtime. Remaining O07 work and
the packaged, dynamic, semantic and device gates for D/W/N/F remain open; no acceptance checkpoint
is claimed.
