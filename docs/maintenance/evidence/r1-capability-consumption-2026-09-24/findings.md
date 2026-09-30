# R1 capability snapshot consumed by the UI — 2026-09-24

This receipt records the slice that turns the host's capability answer into something the two
Mac windows actually obey (CEDIA-PLAN §2.2 "UI to application", §3.B honesty rule, §3.D
Capability status). Evidence is fixture-level: no packaged build and no rendered-window
capture. §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
  Existing work was preserved.
- Before this slice the pieces existed but nothing consumed them: the host published
  `GET /v1/capabilities`, the main process allowed the route, and the adapter had no reader -
  so the Automations row stayed in the sidebar as a disabled row with an invented reason.

## Implemented in this working tree

**The host advertises what the UI gates on.** `apps/host/src/capabilities.ts` gains
`app.automations` (`integration_missing`, scope `app`, reason "Cedia has no automation
backend; the sidebar row stays off until a host schedule owner exists"). The host remains the
only author of these rows.

**Both windows can read the snapshot.** `CediaAgentAdapter.capabilities()` requests
`/v1/capabilities` through the same bridge as every other application call, and
`createCediaNativeApi` exposes it as the Cedia-owned namespace
`window.nativeApi.cedia.getCapabilities()`. The namespace is separate on purpose: the vendor
contracts describe Synara's server, and this snapshot is a Cedia host fact.

**The bundle decides honestly.** New `capabilityGate.ts` parses the snapshot and maps each id
to `available` / `blocked` / `missing` / `unknown`. Only recognisable rows survive parsing, and
anything absent - an unreachable host, a future availability value, an unparsed answer - stays
`unknown`, which is deliberately not `missing`: an unknown snapshot changes no row, so a
briefly unreachable host cannot make working UI disappear. `serverCapabilitiesQueryOptions()`
reads it once per session and returns `undefined` rather than throwing when the host cannot
answer.

**The sidebar obeys it.** `sidebarNavItemVisible(id, capabilities)` gates
`SIDEBAR_NAV_CAPABILITY_IDS` (`automations → app.automations`) inside the existing
`visibleSidebarNavIds` memo. With the snapshot loaded, an integration-missing row is absent
from the sidebar (§3.B); with no snapshot it keeps today's disabled row and its explanation.

**A Capability status destination exists.** Settings gains a `status` section
(`CapabilityStatusPanel`) that lists the host rows as Available / Needs setup / Not
implemented yet, each with the host's own reason. `normalizeSettingsSection` derives from the
section list, so `?section=status` works and unknown deep links still normalize to general.

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/macos/agent-window/test` | 115 passed, 0 failed (353 assertions), 27 files |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1,017 passed, 1 failed (the pre-existing `ide-native-workbench` theme failure), 124 files |
| `bun run --cwd apps/macos/agent-window typecheck` | passed, including the vendor tree |
| `bun run build:agent` | built (the new vendor modules and settings section bundle) |
| `node scripts/ci-validate.mjs` | `CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=371 md=124 evidence=105` |
| `git diff --check` | clean |

New fixtures prove: parsing keeps only recognised rows and never invents one; `unknown` stays
distinct from `missing`; only `integration_missing` hides a row; the automations row is hidden
on an explicit host answer, visible with no snapshot, and visible when the host says available,
while the core New-thread row is not gated at all; the adapter and the shared query read the
host route through the real bridge (`GET /v1/capabilities`), and a host that throws leaves
every row unknown; the capability-status destination exists in the settings taxonomy and
unknown deep links still land on general. One test reads `apps/host/src/capabilities.ts` and
requires every gated id to be advertised there, so the two sides cannot drift silently; the
HTTP suite asserts the same `app.automations` row from the host side.

## Not implemented / not claimed

- **Only the sidebar is gated.** Settings sections, the command palette, search results and
  deep links other than `?section=` are not filtered by capability yet; the new status
  destination is a settings section rather than its own top-level route.
- The snapshot is fetched once per window session (`staleTime: Infinity`) and is not
  invalidated when the host restarts; a window must reload to see changed capabilities.
- `omp.settings`, `omp.live-cli-attach`, `remote.tailscale` and `voice.speech-to-text` have no
  UI consumer yet - they are published for the status list and for the slices that will own
  them.
- The settings search index has no entry for the capability rows, so they are reachable by the
  section but not yet by search.
- No packaged or rendered-window verification: this is source, typecheck and fixture evidence.
  R2-R8 and every §8.2 O-packet remain open; speech-to-text stays deferred.

## Limitations

Fixture evidence from the revision above. It proves the capability answer now reaches both
windows and that one real row is governed by it; it does not certify the desktop checkpoint or
any rendered appearance.
