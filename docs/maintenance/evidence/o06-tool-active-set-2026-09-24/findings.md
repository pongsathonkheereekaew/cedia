# Enabling and disabling the session's tools, through OMP's own manager — 2026-09-24

This receipt records the O06 enable/disable slice: the Tool catalog panel's per-row toggles drive
the session's own activation path through one registered owner-only operation and one durable
owner-only host route, and the write answers the catalog that follows so the panel re-reads what the
runtime applied. §10 item 70 owns status; this file records what was observed at the revision below.
No provider request was made and no model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`
  with this slice applied; the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. `patches/omp/0001-cedia-rpc-bridges.patch` regenerated for this slice
  (817,412 bytes, sha256 `8c0d32ab4552650e7d8c033d021fa85d5924c225b1916736b701ff4f2feed4ae`), recorded in
  `patches/omp/manifest.json`; `bun scripts/prepare-omp-runtime.ts` re-prepared `dist/omp/omp`.
- Changed for this slice: `upstream/omp` `cedia-tools-bridge.ts`, `cedia-capability-bridge.ts`,
  `rpc-mode.ts`, `test/cedia-tools-catalog-bridge.test.ts`;
  `packages/omp-adapter/test/cedia-capabilities.test.ts` (45-operation table plus the write probe);
  `apps/host/src/omp-management.ts`, `apps/host/src/{service,router}.ts`,
  `apps/host/test/omp-management.test.ts`, `apps/host/test/fixtures/fake-host.mjs`;
  `apps/macos/agent-window/src/cedia-adapter.ts`, `vendor/synara/.../lib/serverReactQuery.ts`,
  `vendor/synara/.../components/chat/CediaToolCatalogSurface.tsx`,
  `vendor/synara/.../components/ChatView.tsx` (unchanged mount), `apps/macos/agent-window/test/cedia-tools-catalog.test.tsx`;
  `scripts/lib/omp-coverage.ts`, `scripts/check-omp-coverage.ts`, `scripts/omp-tools-catalog-smoke.ts`.

## What changed

- **One runtime operation**, delegating to OMP's own session (plan §8.2 O06):
  - `tools.active.set` validates `{toolNames}` (array, at most 500, every name a non-empty string)
    and runs the session's own `setActiveToolsByName`, answering the bounded catalog that follows.
    Unknown names are OMP's to ignore: the answer carries what applied, so the panel can never show
    a tool as toggled that the registry does not hold. Family O06, session scope, owner principal,
    agent/ide surfaces.
- **One durable host command** (`cedia_tools_active_set`): owner-only
  `POST /v1/sessions/:id/tools/active` with the command envelope (stale incarnation refused, replay
  by command id, `not_dispatched`/`failed`/`outcome_unknown` transitions matching the tree command).
  A paired controller may read the catalog but receives 403 on the write.
- **Panel toggles.** Each catalog row carries Enable/Disable behind the same confirm dialog idiom as
  tree navigation (naming the tool and the consequence); the mutation sends the whole resulting set
  and invalidates the catalog query, so the panel shows the runtime's answer. No install, update,
  remove or refresh control was added.
- **One audit row settled** through the gate's live-table rule (`setActiveToolsByName`): gap count
  74 (was 75); integrity PASS.

## What was observed

- `bun test upstream/omp/packages/coding-agent/test/cedia-tools-catalog-bridge.test.ts`: 8 pass,
  including the apply-then-catalog-follows case and the payload refusals.
- `bun test apps/host/test/omp-management.test.ts`: 6 pass, including the real-host durable test
  (live read, one write, identical replay receipt, stale-incarnation 409, read-after-write).
- `bun scripts/omp-tools-catalog-smoke.ts`: 23 checks OK — disable-one/restore-all round trip on the
  live runtime, owner write plus identical replay through the host route.
- `packages/omp-adapter/test/cedia-capabilities.test.ts`: 10 pass (45-operation table; the write
  probe selects the native read tool, which later probes do not need).
- No-regression sweep: root suites 1299 pass / 0 fail, `apps/host` 372 pass, agent-window 280 pass,
  agent-window typecheck exit 0, tree/history/model-state smokes pass, root typecheck holds the 10
  pre-existing `apps/macos` errors only, `node scripts/ci-validate.mjs` `CI-OK`, `git diff --check`
  clean. `cd upstream/omp/packages/coding-agent && bun run check:types` exits 0.

## Still open (not claimed)

- No install/update/remove/refresh path: the three refresh operations, `reload`, `extensionRunner`,
  code-mode partitions and `subscribeCommandMetadataChanged` stay gaps with their O06 reasons, and
  `/extensions` plus the `status` alias have no surface.
- The four dynamic-tool rows stay `integration_missing` under their owning packets; O06's two
  (MCP/extension) still wait for the subsystem that registers them.
- Disabling every tool including `read` is permitted with confirmation (OMP's own semantics allow
  it); whether Cedia should guard that quorum is an undecided product question, recorded here rather
  than enforced in code.
- No packaged capture of the catalog panel or its toggles exists.
