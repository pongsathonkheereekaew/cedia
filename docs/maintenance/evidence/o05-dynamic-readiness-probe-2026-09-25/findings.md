# Slice (O05 dynamic-tool readiness probe): `generate_image`/`tts` as `dependency_unavailable`

Item 70 prescribed exactly this: the two provider-backed dynamic tools need a
`dependency_unavailable` disposition with a readiness probe, and the probe needed a way to
read the session's active tool catalog — which the `tools.catalog.get` bridge (O06) has
provided since. No runtime or host code was needed; both reads already exist.

## Registration facts (verified, not assumed)

Session-start tool setup (`upstream/omp/packages/coding-agent/src/sdk.ts`): `generate_image`
registers only when `generate_image.enabled` is on *and* `getImageGenTools` resolves at
least one image-capable provider; `tts` registers when `speechgen.enabled` is on (its
worker can still fail later, at execution). Both settings paths exist in the dated audit
with settings-UI rows. Absence from the catalog therefore always means "not registered
this session" — the panel states the requirements without diagnosing which half failed,
because that distinction needs a live settings read the panel deliberately does not do.

## Changes

- `CediaToolCatalogSurface.tsx` (Cedia-adapted vendor file): a local
  `DYNAMIC_TOOL_DEPENDENCIES` table plus the pure `dynamicToolDependencies` helper; the
  pure `CediaToolCatalogPanel` renders a "Needs setup" section for absent known tools
  (identity and requirements, no toggle, excluded from the active/registered counts).
  Renderer tests pin the table's names against the dated audit's dynamic-tool names, so an
  upstream rename fails the run instead of showing a stale requirement.
- `check-omp-coverage.ts`: the two rows settle as `dependency_unavailable` naming the
  panel probe (same special-case shape as the earlier MCP row).

## Proof

- `bun test apps/macos/agent-window/test/cedia-tools-catalog.test.tsx` (7 pass: rows,
  absence/presence branches, audit pin).
- `bun test apps/macos/agent-window/test` (305 pass), `bun run typecheck` (0 errors).
- `bun run check:omp-coverage`: integrity PASS, gap count **35** (was 37), O05
  dynamic-tool 0 (was 2).

## Still open

O06 `<custom-or-extension-name>` (a pattern, not fixed names — nothing static to pin),
O10 `browser`/`computer` (eval preludes, not session tools; registration chain unverified),
per-half diagnosis (setting-off vs provider-missing needs a live settings read the panel
does not do), and packaged capture.

## Addendum 2026-09-25 (per-half diagnosis landed)

The deferred item is done with window-only code, no new routes: both settings are
global-only (only `modelRoles` is project-writable), so the existing owner-only global
value read (`GET /v1/omp/settings/value` via `getOmpSettingValue`, shared query cache
with the settings destination) is valid for every task. The catalog wrapper reads the
two values only while their tool is absent; controllers get a 403, which reads as unknown
and keeps the generic requirements sentence. `dynamicToolDetail` names the responsible
half: setting-off says so with a pointer to Settings; `generate_image` setting-on means
no image-capable provider resolved; `tts` setting-on-but-absent can only be a tool
selection filter (the runtime pushes the tool unconditionally once the setting is on).
Pure helpers plus the prop-injected sentence are renderer-tested; the hook wiring degrades
to today's behavior on any read failure.
