# Configured extension roots do not reach host-started sessions — 2026-09-25

This receipt records a survey slice with no gap change: four configurations were tried
for getting a fixture extension's tool into a live Cedia session catalog, and a marker
file the fixture writes at module top level proves the factory never ran in any of
them. No half-built slice is left behind (the probe smoke was deleted, not kept).
§10 item 70 owns status. No provider request was made and no model turn ran.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned runtime OMP `18.1.18`; `dist/omp/omp` not re-prepared, no patch change.
- Changed for this slice: this receipt; `docs/maintenance/CEDIA-PLAN.md` (item 70
  row). No code, contract, gate or fixture change remains in the tree.

## What was tried

A fixture extension package (`package.json` manifest naming `./index.mjs`, default
export factory calling `pi.registerTool` for a `fixture_echo` tool, module top level
writing a marker file through `CEDIA_EXT_PROBE_MARKER`) was named as an extension root
in four ways, each followed by host session start and a 90 s poll of the live
`GET /v1/sessions/:id/tools/catalog`:

1. Project `<cwd>/.omp/settings.json` with a relative root — marker absent.
2. Project `<cwd>/.claude/settings.json` with a relative root — marker absent.
3. Project `<cwd>/.claude/settings.json` with an absolute root — marker absent.
4. User `<agentDir>/settings.json` with an absolute root — marker absent.

The marker runs before any factory or registration logic, so its absence means
discovery never imported the module — not a tool-shape or activation dispute.
The factory itself is sound (it loads and registers under a mock ExtensionAPI).

## Loophole closed: the live user config also fails

The four configurations above left one gap: `<agentDir>/settings.json` is only a
migration source — the live user file is `config.yml` (`MAIN_CONFIG_FILENAMES`).
A follow-up probe wrote `<agentDir>/config.yml` with an absolute extension root
and the same module-top marker: marker absent, catalog row absent after 90 s.
File-based roots fail at project layer (`.omp/settings.json`,
`.claude/settings.json`, relative or absolute) and at user layer (live
`config.yml`, absolute) alike. The conclusion below stands across all layers.

## What is proven instead

Every live catalog read in the probes carries ambient extension tools
(`init_experiment`, `run_experiment`, `log_experiment`, `update_notes`) with source
`extension`: the session extension loader runs in host-started sessions and the
catalog bridge carries extension-sourced rows. Only *configured* roots fail to
arrive — the wall is in roots plumbing, not in loading or projection.

## What the next slice needs

A host-owned extension-roots path, because every file-free alternative is closed:

- Settings files (`extensions` key, project or user layer) do not reach rpc-ui
  sessions started by the host, relative or absolute.
- The `--extension`/`-e` CLI flag cannot be combined with the `--trusted-extension`
  lock the host always passes (`CliUsageError`), so it cannot be smuggled through
  the host's `ompArgs` passthrough.
- What remains is either a runtime change (settings plumbing for the rpc-ui
  session path, in the pinned patch) or a host change (an explicit extension-roots
  session option with a route), plus the install/update boundaries the plan
  already names for O06 management. The `/extensions` dashboard (TUI-only) also
  persists MCP enable/disable, so that surface belongs to the same slice.

## Evidence (this revision and build)

- `bun run check:omp-coverage`: integrity PASS, gap count **40** (unchanged — this
  slice surveys rather than settles).
- `bun test scripts/lib`: 84 pass / 0 fail.
- `git diff --check`: clean.
- Still open and unchanged: the `<custom-or-extension-name>` dynamic-tool row, the
  `refreshMCPTools` / `getCodeModeDirectToolNames` / `getEvalPreludes` SDK rows, and
  slash `extensions` with alias `status`.
