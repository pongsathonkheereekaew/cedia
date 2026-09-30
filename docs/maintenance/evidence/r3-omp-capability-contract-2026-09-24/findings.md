# R3/O04 shared wire contract: the runtime's own capability table — 2026-09-24

§8.2 names the shared wire contract as the O04/R1 prerequisite for every O packet. This receipt
records the contract itself: what the pinned runtime advertises, which operations it really runs,
which it declares without registering, and the three layers that were verified. §10 item 70
remains the owner of status.

## Source state

Workspace `/Users/pond/cedia`, branch `main`, revision
`0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.

- Pinned runtime source `upstream/omp` (revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`);
  `patches/omp/0001-cedia-rpc-bridges.patch` regenerated from the staged diff and the manifest
  sha256 updated. The regeneration was verified reproducible: `git add -A` + `git diff --cached
  HEAD` in `upstream/omp` reproduces the recorded hash byte for byte.
- `dist/omp/omp` (prepared developer runtime) and `dist/omp-standalone/omp` (standalone runtime
  embedded in the packaged app) were rebuilt; `Cedia.app` was repackaged and `check:packaged`
  passes.

## The contract

The ready frame gains `cediaCapabilitiesVersion: 1`, advertised unconditionally and inert unless
a client uses it (the same rule the turn and pending-model bridges follow).

`cedia_get_capabilities` answers the runtime's own descriptor table plus the
`capabilityRevision` that identifies exactly that table. Each descriptor carries the plan's own
coverage family, its `state` (`available` / `dependency_unavailable` / `integration_missing`),
scope, apply policy, surfaces, principal, bridge/schema version, the OMP source module that owns
the behaviour, `ompRevision` and a `reason` whenever it is not available.

`cedia_control` runs one operation by id against a static registration table
(`packages/coding-agent/src/modes/rpc/cedia-capability-bridge.ts`). A payload cannot name
JavaScript, an executable or source text: an unknown operation is refused before any handler
runs, and each registered operation validates its own payload — in this generation every one of
them is a read that accepts no fields, so any field is refused rather than ignored. A caller that
names a `capabilityRevision` other than the live one is refused instead of silently refreshed.

**Registered (available):** `capabilities.get` (O04), `model.roles.get` (O03),
`auth.providers.list` (O03), `turn.queue.get` (O01). Each handler is the same projection the
direct `cedia_*` command already answers with — `model.roles.get` was verified to equal the
direct `cedia_get_model_roles` result, not a second implementation of it.

**Declared, not registered** (`integration_missing`, each with its reason): `model.roles.set`,
`auth.api-key.set`, `auth.logout`, `model.pending`. Each is reachable today through its own
negotiated command; the `cedia_control` handler for it is the next slice.

The table and the dispatcher read one list, so a descriptor cannot claim `available` without a
handler — the bridge throws on that construction rather than serving a lying table. The table
itself is one snapshot: `capabilities.get` reads the bridge's own value rather than a
caller-supplied handler (a fixture test caught the version where those could disagree).

Authorization is deliberately not in the runtime: it has exactly one transport client, so each
descriptor declares its `principal` and the embedding host, which does know whether a caller is
the owner or a controller, is where that check belongs. The owner-only host route already
refuses a controller token.

## Verification performed

| Layer | Command | Result |
|---|---|---|
| Runtime bridge fixtures | `bun test packages/coding-agent/test/cedia-capability-bridge.test.ts` | 7 pass, 0 fail |
| Runtime typecheck | `bun run check:types` in `packages/coding-agent` (tsgo) | 0 errors |
| Existing Cedia runtime bridges | `bun test test/cedia-*.test.ts` (5 files) | 48 pass, 0 fail |
| Adapter against the prepared runtime | `bun test packages/omp-adapter/test/cedia-capabilities.test.ts` | 5 pass, 0 fail |
| Same suite against the **packaged** runtime | `CEDIA_OMP_BINARY=…/Cedia.app/…/runtime/omp/omp …` | 5 pass, 0 fail (three consecutive runs) |
| Host path, live | `bun scripts/omp-capabilities-smoke.ts` | every check OK |
| Host fixtures | `bun test apps/host` (incl. `omp-capabilities.test.ts`) | 208 pass, 0 fail |
| Whole CEDIA suite | `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1,067 pass, 0 fail |
| Root typecheck | `npx tsc --noEmit` | same 4 pre-existing error files, no new one |

The live host smoke starts a real host against the prepared runtime with a fixture provider whose
endpoint is never contacted, opens one session so a runtime exists, and checks: a host with no
live runtime reports absence **with a reason** rather than an empty table; the live table names
`omp/18.1.18` and a 32-hex revision; every `available` row is one of the four registered
operations; every declared gap carries a reason; the owner-only route reports the same revision
and carries the runtime rows beside the pre-existing aggregate rows; naming the live revision
answers, and naming a stale one is a `409 omp_capability_revision_mismatch` typed conflict. No
model request is made anywhere in that run.

A flake was found and fixed while verifying the packaged binary: bun's default 5 s per-test
timeout is shorter than the first launch of a freshly copied 150 MB standalone binary (macOS
validates the copy), so the first run against a new artifact failed while later runs passed. The
tests now carry an explicit 60 s timeout, and the first-run case passes on a fresh copy.

## Not claimed

- **Only reads are registered.** The four mutating operations are declared with reasons; nothing
  routes them through `cedia_control` yet, and the direct commands are unchanged.
- **The O04 config half is not done.** The settings/config key inventory and its classification
  (global/project precedence, effective readback after CLI edits and restart, "applies now vs at
  the turn boundary vs on reload") are still open, as is `scripts/check-omp-coverage.ts` and the
  registry-to-surface mapping §8.2 requires before F.
- The runtime declares `principal`; the host enforces it on this route, but no controller-scoped
  OMP operation exists yet to exercise the distinction end to end.
- No window renders these runtime rows yet: the host answer is available to the UI, but no
  packaged observation of a settings/capability screen reading it was made.

---

## Addendum, same day: the settings half of O04

Appended rather than rewritten; the section above is the receipt for the first half.

`settings.keys.list` and `settings.get` are now registered operations, both owner-principal,
`apply: "immediate"`:

- **Inventory.** `settings.keys.list` answers OMP's own `SETTINGS_SCHEMA`: `path`, `type`, the
  credential marker, whether a settings-UI row exists, its tab, and `projectWritable`. Only
  `modelRoles` is project-writable — the single documented exception in `settings.ts` — so every
  other path is a global-layer value. The inventory carries no values and no defaults.
- **Readback.** `settings.get` answers one effective value plus `configured`, which says whether a
  layer set it or the schema default is in effect. A path the schema does not define is refused by
  the dispatcher's validator before any handler runs (the payload can only carry `path`, so an
  extra field is refused too).
- **Redaction.** A path the runtime marks as a credential answers `credential: true`,
  `redacted: true` and no value — the same rule native `omp config` listing follows. A value too
  large for a client is refused with `tooLarge` and its byte count rather than sent truncated.

### Verification added

| Check | Evidence |
|---|---|
| The live inventory equals the dated audit | `packages/omp-adapter/test/cedia-capabilities.test.ts` reads the live table and compares it to all 498 paths in `evidence/omp-complete-scope-2026-09-23/config-cli.json` — same count, same set; `modelRoles` is the only `projectWritable` row |
| Credential never leaves | `settings.get {path: "auth.broker.token"}` answers `redacted: true` with no `value` key |
| CLI edit + restart readback | the test writes `cycleOrder` with the runtime's own `config set` CLI in an isolated agent dir, then reads it back in a second and third process: `configured` flips `false` → `true` and the value survives both |
| Unknown key denied | `settings.get {path: "not.a.setting"}` is `cedia_control_invalid_payload`; no handler runs |
| Runtime bridge fixtures | `bun test packages/coding-agent/test/cedia-capability-bridge.test.ts` → 9 pass, 0 fail (2,601 assertions with the provider-auth suite) |
| Same suite against the packaged runtime | `CEDIA_OMP_BINARY=…/Cedia.app/…/runtime/omp/omp` → 9 pass, 0 fail |
| Whole CEDIA suite | 1,071 pass, 0 fail |

`dist/omp`, `dist/omp-standalone` and the packaged `Cedia.app` were rebuilt; both runtime
descriptors attest the new patch hash `0c86e844c39d……`.

### Still not claimed (added)

- **No host route reads OMP settings yet.** The operations exist and are verified at the
  runtime/adapter boundary; `CediaHost` does not expose an owner route for them, so no window can
  show an OMP settings value. That is the remaining half of item 70's "OMP settings bridge".
- **Per-key CEDIA disposition is not decided.** The inventory proves every audited key is
  *enumerable*; it does not yet say which keys CEDIA exposes in normal settings, which are advanced
  or read-only, and which are deliberately hidden but reachable — the classification §8.2 requires.
- `scripts/check-omp-coverage.ts` still does not exist, so the F coverage gate is not executable
  yet.

---

## Addendum 2, same day: the host readback route

The runtime operations are now reachable through the host, owner-only:

- `GET /v1/omp/settings/keys` answers the live runtime's own inventory, or
  `{ state: "unavailable", reason }` when no runtime is live — never an empty list.
- `GET /v1/omp/settings/value?path=…` answers one effective value with `configured`, a credential
  path redacted, and an oversized value as `{ tooLarge, bytes }`. A key the running runtime does
  not define is a typed `404 omp_settings_unknown_path`; a missing `path` is `400 invalid_query`;
  a controller token is `403`. No route starts a runtime: the host reads from a session runtime
  that is already live.

The host re-validates the shape it receives instead of trusting the runtime: a redacted answer
that carried a value, a credential path that was not redacted, or an answer with neither a value
nor a reason is rejected by the protocol parser, so a runtime that changed its mind cannot leak a
secret through Cedia.

### Verification added

| Check | Evidence |
|---|---|
| Fixture coverage | `bun test apps/host/test/omp-settings.test.ts` → 8 pass, 0 fail (absent bridge, malformed inventory, redaction invariant, oversized value, typed unknown key, owner-only route, absent runtime, no owner wired) |
| Live host path | `bun scripts/omp-capabilities-smoke.ts` → inventory route answers 498 keys from the live runtime, marks 8 credential paths, only `modelRoles` is project-writable, a value route answers for a defined key, a credential path is answered redacted with no `value`, and an undefined key is a typed 404 |
| Whole CEDIA suite | 1,079 pass, 0 fail |
| **Packaged application** | the repackaged `Cedia.app`, launched with an isolated fixture profile, served the routes from **its own host**: `GET /v1/capabilities` reported `omp.state = "available"` with 18 aggregate rows; `GET /v1/omp/settings/keys` answered 498 keys from the embedded runtime's schema with 8 credential paths; `GET /v1/omp/settings/value?path=modelRoleStorage` answered `state: "available"`, `configured: false`; `…?path=auth.broker.token` answered `redacted: true` with no `value` key; `…?path=not.a.setting` answered `404 omp_settings_unknown_path`. A deliberate Quit afterwards left no process and a durable `stopped` receipt. |

Two absence reasons were split while doing this: "no live runtime" and "the live runtime has no
bridge" are different facts, and the capability route keeps its original wording so an existing
caller's expectation did not change silently.

### Still not claimed (added)

- **Read-only.** Nothing writes an OMP setting through Cedia yet: no route issues `Settings.set`,
  and the revisioned write contract in §6.4 is still open.
- No window renders this route yet: the packaged host serves it (proven above), but no UI reads it.
- The fixture task and project this run created ("Settings fixture" / "Settings route proof") remain in
  this machine's personal state directory as verification artifacts.

---

## Addendum 3, same day: the write path and the per-key disposition

Appended again rather than rewritten; the sections above are the receipts for the first halves.

**Runtime.** `settings.set` is a registered owner operation. It validates the path against OMP's
own schema, validates the value against that path's own type or enum (including the one record
with a bespoke validator, `providers.maxInFlightRequests`), applies the write through
`Settings.set`, flushes to disk and answers the readback. Every settings answer now carries a
`settingsRevision`: a digest over the paths a layer actually configured, so a caller that read a
revision can write only while nobody else changed the configuration - including an edit made
through OMP's own `config` CLI. The digest never returns the values it covers, so a credential
path's secret stays inside the runtime. A mismatched revision is
`cedia_control_stale_settings_revision`.

**Host.** `PATCH /v1/omp/settings` (owner-only) is the write route. Cedia's policy is separated
from the runtime's mechanism: the route classifies the path with `ompSettingDisposition` and
refuses anything that is not `editable`, then the runtime validates the value and the revision.

| Disposition | Meaning | Count today |
|---|---|---|
| `editable` | a normal settings surface may show and write it | 366 |
| `protected` | a credential path; the provider-auth surface owns it, never shown or written here | 8 |
| `advanced` | real and reachable, but with no settings row of its own | 115 |
| `excluded` | the plan excludes it from the settings surface (provider endpoint/order/enabled fields) | 9 |

Every one of the 498 schema paths has a disposition and a reason whenever it is not `editable`, so
a control can be generated from the inventory instead of re-deriving the policy. The excluded set
is written out path by path - not pattern-matched - so a future key cannot be excluded by accident.
All four dispositions, and the readback and write routes, were observed on the packaged
application:

| Step (packaged `Cedia.app`, isolated fixture profile) | Observed |
|---|---|
| `GET /v1/omp/settings/keys` | 200, `available`, 498 keys, dispositions `{editable: 366, protected: 8, advanced: 115, excluded: 9}` |
| `PATCH /v1/omp/settings` on an editable array key | 200, `configured: true`, a new `settingsRevision` |
| the same write with the revision it just applied | 409 `omp_settings_stale_revision` |
| `PATCH` on `auth.broker.token` | 403 `omp_settings_not_editable` |
| `PATCH` with a value the schema rejects | 400 `omp_settings_rejected` |
| `GET …/value?path=<that key>` | 200 with the written value; a deliberate Quit afterwards left no process and a durable `stopped` receipt |

### A defect this slice found and fixed

The first live write answered `result: {}`. The bridge returned the handler's value directly, so an
`async` handler's promise was serialised instead of awaited: the write really happened while the
client saw an empty result. `control()` is now asynchronous and awaits the handler, which is also
what makes "the answer describes a value already on disk" true for a flushing write. The bridge
fixtures and the runtime-backed adapter test both cover it now.

### Verification added

| Check | Evidence |
|---|---|
| Runtime bridge fixtures | `bun test packages/coding-agent/test/cedia-capability-bridge.test.ts` → 11 pass |
| Adapter against the prepared runtime | `bun test packages/omp-adapter/test/cedia-capabilities.test.ts` → 10 pass, including a write, its readback in a second process, a stale-revision refusal and a schema-rejected value |
| Host fixtures | `bun test apps/host/test/omp-settings.test.ts` → 11 pass (dispositions, write, 403/404/400/409 mapping, controller denial) |
| Live host path | `bun scripts/omp-capabilities-smoke.ts` - every check OK, including the write, its revision, the stale 409, the protected 403, the rejected 400 and the readback |
| Whole CEDIA suite | 1,089 pass, 0 fail |

### Still not claimed (added)

- **No window renders any of this.** The routes and the disposition table are real and verified;
  a settings UI generated from them does not exist yet.
- **Write timing per key is not classified.** The descriptor promises the mechanism
  (`apply: "reload"`); which keys a running session picks up immediately, at a turn boundary, on
  reload or only in a new session is still per-key work, and §6.4 asks for it beside the control.
- The coverage gate still reports the settings family as a gap: it counts a Cedia *surface*, and
  reachability through the host API is not yet a rendered control. Teaching it the disposition
  vocabulary (an `excluded` or `protected` key is classified, not a gap) is the next step.
