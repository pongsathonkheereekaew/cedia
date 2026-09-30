# Slice (O06 extension catalog read): records and roots, no sources — 2026-09-25

The Extension Control Center dashboard builds its rows from the runtime's own
discovery answer. This slice carries that same answer to Cedia without the overlay:
the registered `extensions.list` operation reads the session project's extension
records through the same `loadAllExtensions` the dashboard builds its rows from (with
the session's own `disabledExtensions` setting applied, so the states match) plus the
live root policy from the session's own `effectiveExtensionRoots`. The wire carries
identity, kind, display strings, source layer, state, and reasons only — the records'
`raw` discovery bag never crosses (for `mcp` rows it holds the discovered server
config). The Tool catalog panel draws an Extensions section from it. Gap count
**unchanged at 22**: this is the read half of the O06 extension packet, and the rows
name catalog *and management* — settling them on a read-only surface would be
greenwashing. The gate moves when management lands.

## What was built

- Runtime (`upstream/omp`, pinned `omp/18.1.18`): `readCediaExtensions` in a new
  `cedia-extensions-bridge.ts` (bounded descriptions, duplicate-id refusal, row
  skipping for malformed entries rather than refusing the whole read);
  `RpcCediaExtensionData`; `extensions.list` registered controller/session/immediate
  in the conditional tools.* shape with `noPayload` validation.
  `cedia-extensions-bridge.test.ts` (4 pass, project MCP fixture with a hermetic
  agent dir: active + flag-disabled states, disabled-list honoring, no-raw-key pin).
- Host (`apps/host/src/omp-management.ts`): strict `parseOmpExtensionsData`
  (provenance layer union, unknown-field rejection including `raw`, duplicate ids,
  non-negative total), `OmpExtensions` projection, controller-visible
  `GET /v1/sessions/:id/tools/extensions`. `omp-management.test.ts` +5 (parse
  strictness, bridge absence honesty, controller route + refusals, live fixture
  round trip).
- Window: Extensions section in the Tool catalog panel (roots line, per-row state
  labels with disabled/shadowed reasons, truncation notes), query + strict parse in
  `serverReactQuery.ts`, `getExtensions` in `cedia-adapter.ts` + native exposure.
  `tool-extensions-section.test.tsx` (5 pass).

## Live proof (prepared runtime, fixture MCP pair, no model, no provider)

`bun scripts/omp-extensions-smoke.ts` (13 checks): the active and flag-disabled
fixture servers read with their own states; no record carries `raw`; roots ride
along; the route carries the same answer controller-visible, refuses query fields
(400) and writes (405), and reports absence with a reason pre-start.

## Deliberately not built (next slice owns it)

- Enable/disable: non-MCP toggles are a `disabledExtensions` settings write (existing
  machinery, restart-owned like the dashboard's own repaint-only view update); MCP
  toggles need the canonical mcp.json writer plus the live-manager apply from the
  dashboard. One panel toggle spanning both backends is the management slice.
- Custom roots: the runtime reads extension paths from settings files and CLI flags
  only — a roots path needs a runtime change, a host session option, or both
  (triage standing verdict, unchanged).
- The `extensions` slash row and `status` alias stay `integration_missing` until that
  slice lands. This receipt must not be cited to settle them.

## Evidence (this revision and build)

- `bun scripts/omp-extensions-smoke.ts`: all 13 checks pass.
- Upstream extensions/capability/model-state bridges (34 pass); `check:types` clean.
- Host suite 433 pass / 0 fail; agent-window suite 352 pass / 0 fail; root typecheck clean.
- `bun run check:omp-coverage`: integrity PASS, gap count **22 (unchanged, by design)**.
- Patch regen is faithful to the worktree (spot-audited); runtime re-prepared with attestation.
- `git diff --check`: clean.
