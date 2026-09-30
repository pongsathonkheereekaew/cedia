# Slice (O03 role assignment from the window): configuring is owned, activating was owned — 2026-09-26

`model.roles.set` wrote the role→model mapping but only config files and the
TUI could invoke it; the window could list mappings and apply them, never
assign one. This slice adds the missing assignment half as a full vertical and
closes §10 item 6. No gap change (the op was already counted; this is its
surface). No provider request anywhere. §10 item 70 owns status.

## What was built

- Runtime: no change — `model.roles.set` op (`{role, modelId|null}`, exact
  payload rule) and `cedia_set_model_role` RPC already delegate to the single
  `applyCediaModelRole` implementation, answering the roles table that
  follows (`null` clears back to default resolution).
- Host (`apps/host/src/omp-model-state.ts`): `setOmpModelRole` control call +
  `OmpModelState.setRole` (validated role, string-or-null modelId, parsed
  against the roles table) + `OmpRoleSetCommandRequest`.
- Host (`apps/host/src/service.ts`): owner-only durable `rolesSet`
  (`kind: cedia_model_role_set`, stale-incarnation refusal, not_dispatched
  paths, completed ack/result, replay returns the recorded table).
- Host (`apps/host/src/router.ts`): owner-only durable `POST
  .../roles/set` with method/query/body guards + `roleSetCommand` parser
  (unknown fields, blank role, non-string/missing modelId refused 400).
- Adapter (`apps/macos/agent-window/src/cedia-adapter.ts`): `setModelRole`
  (same validation before dispatch) + native exposure.
- Window (`serverReactQuery.ts` + Settings Model roles section): per-row
  model input with Set/Clear behind outcome-stating text, a new-role form
  (role + `provider/model` + Assign), and a `serverSetRoleMutationOptions`
  that writes the returned table into the roles cache. The set answer is the
  bare table, so the roles parser accepts it as available with identical
  strictness (shared table validator for both shapes). Row/message aria-labels
  added for the assignment controls.

## Proof

- Browser interaction test (new, real Chrome): typing into the smol input +
  Set dispatches `("smol", "fixture/edited-model")`; Clear dispatches
  `("smol", null)`; new-role form dispatches `("tiny", "fixture/tiny-1")`.
- Extended `bun scripts/omp-roles-apply-smoke.ts` on the pinned runtime
  (30+ checks): set answers the table, get reads it back, apply-after-set
  activates the new model, restore works, temp set/clear behaves (cleared row
  disappears, siblings intact), op payload-rule refusals, plus host routes
  (controller 403, set/readback/byte-identical replay, single runtime call in
  the command log, clear, 400s, stale 409).
- `bun test apps/host apps/macos/agent-window/test apps/macos/test`: green
  (mock gates/validation, live set/readback/replay/clear, adapter routes,
  surface static tests). Root + vendor typechecks clean (only the known
  foreign-file vendor error, untouched).
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS.
- Coverage gate: still exactly 2 gaps (`switchSession`, `browser-relay`).

## Still open (recorded, not built)

- Mid-turn set/apply races the running turn like a terminal `/model` switch
  (same standing as the apply slice).
- `cycleOrder` enforcement, path-scoped `enabledModels`, `agentModelOverrides`
  (items 7–8), role tooltip visual check (item 9).

## Addendum: running-window end to end (`smoke:roles-window`)

`scripts/omp-roles-window-proof.ts` drives the real bundle against the
prepared pinned runtime (fixture provider + fixture mappings, zero provider
calls): task runtime started without a turn, Settings Agent providers shows
the live mapping with prefilled per-row inputs, then real typed input performs
Set (outcome names the mapping, section reads it back), Clear (fallback
outcome), and new-role Assign — all green with zero renderer errors
(`dist/roles-window-proof/`, `roles-window.png`). A turn is deliberately not
sent: the fixture provider cannot answer one, and the control ops under test
never need it. This closes item 6 at full stack: window input, host durable
routes, runtime operation.

## Addendum: cycle-order display (item 7 first half) — 2026-09-26

`cycleOrder` was parsed and typed but never used: rows rendered in incidental
wire order. The section now sorts rows by the runtime's `cycleOrder`, appending
roles absent from the cycle in listed order (`CediaModelRolesControls`, pure
presentation — no behavior invented). Proven by a static render test (shuffled
input renders smol, default, extra against cycle `["smol", "default"]`).
Path-scoped `enabledModels` has no surface anywhere in host/adapter/window
sources (verified by search), so there is nothing to exercise through CEDIA —
that half stays open as stated.
