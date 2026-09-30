# Live OMP queue-drop settlement — 2026-09-28

This is a provider-free O01 / §2.4 live-runtime follow-up to the queue-surface receipt. It proves
that dropping a queued user submission settles its matching host turn intent, rather than leaving
the intent in `queued`. It does not claim packaged D/F acceptance.

## Revision and runtime

- CEDIA workspace: `/Users/pond/cedia`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`; existing dirty work was preserved.
- Pinned OMP source revision: `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`.
- Consolidated OMP patch SHA-256:
  `4e98f7bd1ba70243eff621fdde8413af416d39fcbfeedc7bee124d3bea67535e`.
- Prepared development runtime source tree: `d0105be6509186319c7ae76249d1dc61932c7967`.
- `attestOmpRuntime` returned `sourceVerified: true`, runtime kind
  `development-source-launcher`, executable SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`.

## Change

OMP now preserves the Cedia intent identity on a restored queued message and returns identities
only for user submissions it actually removed. The host validates those IDs, uses them only to
settle intents still in `queued`, and omits the internal metadata from both the public queue
snapshot and durable drop receipt. A running turn is not cancelled by dropping another queued
submission. `all` reports every removed identity; `last` reports only the exact row returned by
OMP's own dequeue method.

## Evidence

- `bun run prepare:omp` prepared the pinned development runtime from the refreshed patch.
- `bun run smoke:omp:queue` passed 25 checks on `omp/18.1.18`. A host-owned prompt reached a
  local loopback HTTP fixture that never responds. While that turn remained running, a follow-up
  was observed in OMP's queue; `queue.drop(last)` returned its exact text; the matching turn
  intent became `cancelled`; neither the route response nor durable command receipt exposed
  `droppedIntentIds`; and the fixture observed no second request. No external provider was called.
- `bun test apps/host/test/omp-queue.test.ts apps/host/test/service.test.ts`: 48 passed,
  300 expectations.
- `bun test ./upstream/omp/packages/coding-agent/test/cedia-queue-bridge.test.ts`: 6 passed,
  15 expectations, including exact ID preservation for both `last` and `all`.
- `bun test apps/macos/agent-window/test/cedia-queue.test.ts
  apps/macos/agent-window/test/cedia-queue-surface.test.tsx`: 7 passed, 21 expectations.
- Root `bun run typecheck`, OMP `bun run check:types`, and the Agent Window's
  `bun run typecheck` (both app and vendor projects) passed.

## Remaining scope

This is source-attested host/runtime evidence. The packaged queue panel was not opened or captured,
the macOS Login Item was not changed, and no Keychain item was touched. The queue panel's packaged
observation and the remaining D/F gates stay open under §10 item 70.
