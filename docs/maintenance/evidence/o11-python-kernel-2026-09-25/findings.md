# Python execution through the shared kernel, with a cancel that can overtake — 2026-09-25

This receipt records the O11 slice that closes `executePython`/`abortEval` with a real
surface: the composer Shell panel toggles between Bash and Python and runs snippets one-shot
through the session's shared kernel — the same kernel the eval tool collaborates on — with
display outputs counted, never embedded. §10 item 70 owns status; this file records what was
observed at the revision below. No provider was configured and no model turn ran.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. Upstream changed in this slice (new Python bridge, two
  registered operations, rpc-mode wiring, one dispatcher carve-out, bridge tests):
  `patches/omp/0001-cedia-rpc-bridges.patch` regenerated (858,362 bytes, sha256
  `daf17540c7f23907b64a79f7ccf43842b54fc73bb737487c3f2dcb01358c45b9` per
  `patches/omp/manifest.json`); `bun scripts/prepare-omp-runtime.ts` re-prepared
  `dist/omp/omp`.
- Changed for this slice: `upstream/omp` `cedia-python-bridge.ts`, `rpc-types.ts`,
  `cedia-capability-bridge.ts`, `rpc-mode.ts`, `test/cedia-python-bridge.test.ts`,
  `test/cedia-capability-bridge.test.ts`, `test/cedia-model-state-bridge.test.ts`;
  `apps/host/src/omp-python.ts`, `apps/host/src/{service,router}.ts`,
  `apps/host/test/omp-python.test.ts`;
  `apps/macos/agent-window/src/cedia-adapter.ts`,
  `apps/macos/agent-window/test/adapter.test.ts`,
  `vendor/synara/.../lib/serverReactQuery.ts`,
  `vendor/synara/.../components/chat/CediaShellSurface.tsx`,
  `apps/macos/agent-window/test/cedia-python-surface.test.tsx`;
  `scripts/omp-python-smoke.ts`, `scripts/lib/omp-coverage.ts`,
  `scripts/check-omp-coverage.ts`; this receipt; `docs/maintenance/CEDIA-PLAN.md` (item 70 row).

## What changed (one vertical, each layer owning its half)

- **Runtime** (`cedia-python-bridge.ts`, plan §8.2 O11): `python.exec` validates code strictly
  (non-empty, 64 KiB bound) before the kernel sees it and answers the bounded result
  (`exitCode` nullable, output, truncation, cancelled, display-output count);
  `python.abort` confirms delivery. Registered as `python.exec`/`python.abort` (owner) over
  `cedia_control`, advertised in the live capability table (50 → 52 descriptors).
- **Dispatcher carve-out (the real find of this slice):** `cedia_control` runs on the RPC
  serial queue, so a kernel run blocked everything behind it — including its own abort. The
  first smoke proved it: abort answered only after the 20s sleep finished. `python.exec`
  now dispatches in the background exactly like `bash`, so `python.abort` is read and
  handled while code still runs; clients correlate via command id.
- **Host** (`omp-python.ts`, service, router): strict projection; owner-only durable
  `POST /v1/sessions/:id/python/exec` and `/python/abort` (validated, stale-refusing,
  replay-safe).
- **Adapter + window**: `execPython`/`abortPython` with typed refusals preserved; strict
  parse plus mutation options (no polling timer); the shared Shell panel gains a
  Bash/Python toggle with per-language labels, placeholders and media notes, in both
  windows. Python results show exit/cancelled state; a run answers when it finishes.
- **Gate**: `executePython`/`abortEval` carried by the registered operations, settled only
  while the live table reports them.

## What was observed

- `bun scripts/omp-python-smoke.ts`: 16 checks OK through a real booted host against the
  prepared runtime — exact output with exit 0, a failing snippet answered (not errored), a
  `sleep 20` cancelled live through abort (exec answers `cancelled: true`), idle abort
  accepted, idempotent replay, 400s before any runtime call, stale refused.
- Upstream: `test/cedia-python-bridge.test.ts` 4 pass (bounded result, null exit, refusals
  before the kernel, abort delivery); capability + model-state bridge tests pass;
  `bun run check:types` in `packages/coding-agent` exits 0.
- Host: `apps/host/test/omp-python.test.ts` 5 pass, including the real-host route driving
  the fixture kernel.
- Adapter: `apps/macos/agent-window/test/adapter.test.ts` 49 pass, including the new
  exec/abort read-write test with refusals.
- Window: new `cedia-python-surface.test.tsx` 4 pass (Python labels, cancelled state,
  strict parsing, per-session mutation keys); existing shell tests unchanged and green.
- `bun run check:omp-coverage`: integrity PASS, gap count **51** (was 53).
- Sweeps: root (`packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib`)
  1323 pass / 0 fail (157 files, including the new kernel tests and the extended live
  capabilities enumeration); agent-window suite 301 pass / 0 fail (64 files);
  `bun run check:types` in `packages/coding-agent` exits 0; root `bun run typecheck` holds
  the 10 pre-existing `apps/macos` errors only; `node scripts/ci-validate.mjs` CI-OK;
  `git diff --check` clean.
- `bun run typecheck` holds the 10 pre-existing `apps/macos` errors only;
  `node scripts/ci-validate.mjs` CI-OK; `git diff --check` clean.

## Still open (not claimed)

- O11 keeps async jobs (`getAsyncJobSnapshot`, `hasPendingAsyncWork`, `settleAsyncWork`),
  work pools (`get/setWorkPoolYieldItems`) and IRC (`deliverIrcMessage`,
  `drainPendingIrcInboxMessages`, `waitForIrcReplies`) — separate subsystems, none claimed
  by a kernel path.
- No PTY-style streaming on this path (output answers when the run finishes), no packaged
  capture of the language toggle, and no parked-run observation against a provider turn.
