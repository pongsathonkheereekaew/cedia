# An MCP tool appears in the Cedia session catalog — 2026-09-25

This receipt records the O06 MCP-appearance slice. The audited `mcp__<server>_<tool>`
dynamic-tool row said the tool "cannot appear in a Cedia session" until O06 lands the
subsystem that registers it. The subsystem is the runtime's own MCP discovery: a session
started in a folder with `.mcp.json` connects the listed stdio servers itself and mounts
their tools, and Cedia's existing catalog bridge (`tools.catalog.get` over the runtime's
own `getAllToolInfos()`, owner route `GET /v1/sessions/:id/tools/catalog`) carries the
mounted row with the runtime's own source class. No runtime change was needed and no
provider request was made. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned runtime OMP `18.1.18`; `dist/omp/omp` not re-prepared, no patch change.
- Cedia: new `apps/host/test/fixtures/fixture-mcp-server.mjs`,
  `scripts/omp-tools-mcp-smoke.ts`, this receipt; changed
  `scripts/check-omp-coverage.ts` (the `mcp__<server>_<tool>` row is `integrated`).

## What changed

- **A fixture MCP server that speaks the protocol.** `fixture-mcp-server.mjs` answers
  `initialize` (2025-11-25), `tools/list` (one tool, `echo`), `tools/call` and `ping`
  over newline-delimited JSON-RPC on stdio, stays alive until stdin closes, and never
  touches the network — the same fixture discipline as the agent-window OMP fixture.
- **The bridge was already there; the proof was missing.** The smoke starts a host
  session in a folder whose `.mcp.json` lists the fixture as a stdio server, starts the
  session, and polls the live catalog until `mcp__fixture_echo` appears: 22 tools total,
  13 active, the MCP row present with source `mcp`, a non-empty description, and the
  bounded projection (no parameter schema, no source record).
- **Mount-scoped, honestly reported.** The row arrives with `active: false`, and an owner
  `tools.active.set` naming it returns 200 yet leaves it false. That is the runtime's own
  partition, not a Cedia refusal: `setActiveToolsByName` applies a top-level versus
  `xd://` partition and connected MCP tools stay mounted rather than top-level active
  (`session-tools.ts`). The catalog reports the runtime's flag instead of inventing
  activation, and the smoke logs the flag rather than pinning it so a runtime that
  promotes mounts later re-opens the question instead of failing on a stale pin.
- **One gate row settled.** `scripts/check-omp-coverage.ts` marks the
  `mcp__<server>_<tool>` dynamic-tool row `integrated` with the catalog bridge as
  handler, the tool card as presentation, and the new smoke as test. Integrity PASS,
  gaps 41 → 40.

## Evidence (this revision and build)

- `bun scripts/omp-tools-mcp-smoke.ts`: all checks OK against the pinned runtime; the
  fixture listener never answers and the fixture model endpoint never responds, so no
  provider request leaves the machine.
- `bun run check:omp-coverage`: integrity PASS, 0 fatal issues; 40 records without an
  available Cedia disposition.
- `git diff --check`: clean.

## Still open (not claimed)

- The `<custom-or-extension-name>` dynamic-tool row: extension install/update boundaries
  are still O06 work (the `/extensions` dashboard is TUI-only in the runtime).
- The `refreshMCPTools` SDK row: MCP refresh is runtime-owned (connect-time plus the
  manager's `onToolsChanged`), and no host-driven rediscovery path is claimed.
- `getCodeModeDirectToolNames` / `getEvalPreludes`: code-mode internals with no Cedia
  surface.
- Calling the MCP tool through a turn was not exercised: reaching `tools/call` needs a
  provider turn, which fixture smokes never run.
