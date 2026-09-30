# The four owner-only writes run through the capability table — 2026-09-24

This receipt records the O03 slice the plan named as remaining: the four mutating operations the
capability table used to *declare* with a reason are now registered and runnable, and each delegates
to the same implementation its direct `cedia_*` command calls, so one behaviour cannot become two.
§10 item 70 owns status. The gate's remaining-record count does not change here - no audited record
was unsettled by this work - and that is stated rather than hidden behind a reclassification.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice: manifest sha
  `f2f885b6213aaa87ba38e806632658278de51dc0b9ed722ff11cf0b29c39faa7`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`).
- Runtime: `packages/coding-agent/src/modes/rpc/{cedia-capability-bridge,rpc-mode}.ts`,
  `test/cedia-capability-bridge.test.ts`.
- Cedia: `packages/omp-adapter/test/cedia-capabilities.test.ts`,
  `scripts/omp-capabilities-smoke.ts`.

## What changed

- **One implementation per write.** `rpc-mode.ts` now declares `applyCediaModelRole`,
  `applyCediaApiKey`, `applyCediaLogout` and `acceptCediaPendingModelChange` once, before the
  capability bridge is built. The direct `cedia_set_model_role` / `cedia_set_api_key` /
  `cedia_logout` / `cedia_pending_model` commands and the registered operations both call them, so
  the registered path cannot drift into a second version of a write - the same rule the goal, plan,
  advisor and context bridges follow.
- **Four operations join the table as available.** `model.roles.set` (role + modelId, `null`
  clears), `auth.api-key.set` (provider + key), `auth.logout` (provider) and `model.pending`
  (revision, optional provider/modelId, optional thinking level). Each validates its own payload
  before a handler runs: an unknown field, a missing field, a bad type, a non-positive or
  non-integer revision, and a provider without a model (or the reverse) are refused by name. The
  declared seam is now empty, with the comment explaining what belongs in it next.
- **The table advertises nothing it cannot run.** `model.pending` is session-scoped with
  `turn_boundary` apply timing, because a held change commits at OMP's own dequeue/start boundary
  and never into a running turn; the other three are global and immediate.

## Evidence (this revision and build)

- `bun scripts/omp-capabilities-smoke.ts` → every check OK against the prepared `omp/18.1.18`; the
  available table now lists 30 descriptors, and the smoke asserts that a declared row (of which
  there are now zero) would still have to carry its reason.
- `bun test packages/omp-adapter/test/cedia-capabilities.test.ts` → 10 pass, including the probe
  that runs *every* available operation with a real payload. The owner-only writes are probed with
  a role clear, a key stored for a provider OMP has no endpoint for, a logout of that same provider
  and a pending revision of 1 - so no provider request leaves the machine, and the stored key lives
  only in the test's isolated agent directory.
- `cd upstream/omp && bun test packages/coding-agent/test/cedia-capability-bridge.test.ts` → 22
  pass: the payload rules of each new operation, that the table advertises no `integration_missing`
  row, and that `model.pending` really runs through the control path.
- `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` → 1252 pass,
  0 fail (147 files); `bun run typecheck` → the same 10 pre-existing errors, none in a file this
  slice touched; `bun run check:omp-coverage` → integrity PASS, **101 records**, unchanged by this
  slice (it closes a requirement, not an unsettled record); `git diff --check` clean.

## Limits

- No real credential was stored for a real provider and no role was assigned to a real account: the
  writes are proven on the pinned runtime with an isolated agent directory and a provider OMP has
  no endpoint for. A live provider-account operation still needs its own authorized run before it
  can be called enabled (§8.2 O03).
- O03's remaining SDK records are untouched and still listed as gaps: `applyRoleModel`,
  `setModelTemporary`, `configuredThinkingLevel`, `autoResolvedThinkingLevel`, `cycleModel`,
  `fetchUsageReports`, `listResetCredits`, `redeemResetCredit`, `listCurrentProviderOAuthAccounts`,
  `pinCurrentProviderOAuthAccount` and `setServiceTierFamily`. Several of them read one snapshot
  command (`get_state`) that the gate's "one audited command, one SDK operation" rule already
  credits elsewhere; deciding whether that rule should allow a shared snapshot carrier is a gate
  design decision that belongs to the usage/accounts slice, not to this one, and no row was
  reclassified to move the number.

## Addendum 2026-09-25 (`applyRoleModel` surveyed, stays open)

Checked whether the remaining O03 SDK row is carried by anything existing: it is not.
`model.roles.set` (registered) configures a role-name-to-model mapping
(`settings.setModelRole` + flush) — it never activates anything. `applyRoleModel`
activates a resolved entry (session model switch plus thinking level) and its only
callers are the TUI model selector's role picks and plan-execution application. The
reachable `/switch @role` form resolves through `setModelTemporary`, not through role
application. A role-aware switch surface is future work, not a carrier claim.
