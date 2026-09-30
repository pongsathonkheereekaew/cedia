# Slice (custom extension tool, live in the session catalog)

The last O06 dynamic-tool gap (`<custom-or-extension-name>`) claimed no Cedia session
could show a custom extension-registered tool. The runtime loads trusted JS extensions
itself (`--trusted-extension`, repeatable, absolute paths), so no install UI is needed
for the proof: a fixture extension calling `api.registerTool` mounts its tool in the
session registry exactly like production extensions do.

## What was built

- `apps/host/test/fixtures/fixture-extension-tool.mjs`: deterministic trusted
  extension registering `cedia_smoke_widget` (read tier, constant-string execute, no
  network/provider/state).
- `scripts/omp-extension-tool-smoke.ts`: proves both levels against the pinned
  18.1.18 runtime with no model, provider, or session turn - the registered
  `tools.catalog.get` operation answers the widget with source `extension`, and the
  controller-visible host route carries the identical row. Catalog rows are asserted
  field-exact (no parameter schemas or credentials cross).

## Proof

- `bun scripts/omp-extension-tool-smoke.ts`: 13 checks OK.
- `bun run check:omp-coverage`: integrity PASS, gaps 20 -> 19 (O06 dynamic-tool gone).

## Still open (deliberately)

- Installing, updating and custom-rooting extensions through Cedia stays a separate
  O06 surface; this slice proves registration + catalog carriage only.
- Executing the widget inside a turn is the shared tool-card path (already proven
  for every tool); the fixture tool is never executed here by design.
