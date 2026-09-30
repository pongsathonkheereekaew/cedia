# Slice (O03 role apply): configuring was owned, activating was not — 2026-09-25

`model.roles.set` writes the role→model mapping; nothing activated one. The TUI role
picks and plan-execution application call the session's own `getRoleModelCycle` +
`applyRoleModel` pair, and Cedia had no caller for it (the reachable `/switch @role`
form resolves through `setModelTemporary`, a different operation). This slice adds the
missing half: the registered `model.roles.apply` operation, the host routes, and a
Model roles section in Settings that lists the mapping and applies one per row.
Gap count **30 → 29** (O03 sdk 1 → 0).

## What was built

- Runtime (`upstream/omp`, pinned `omp/18.1.18`): `cedia-model-roles-bridge.ts` —
  `applyCediaRoleModel(session, role)` resolves the named role through the session's
  own single-role cycle and applies it through the session's own application, answering
  the session model read back afterwards; an unconfigured role is refused, never
  defaulted. `RpcCediaRoleApplyData`; `model.roles.apply` registered
  session/owner/immediate with a role-only payload rule; `cedia-model-roles-bridge.test.ts`
  (6 pass).
- Host (`apps/host/src/omp-model-state.ts`): strict `parseOmpModelRoles` (provenance
  layer union, rejects unknown fields) and `parseOmpRoleApplyResult`,
  `OmpModelState.roles()` (controller-visible read) and `.applyRole()` (owner write),
  controller-visible `GET /v1/sessions/:id/roles`, owner-only durable
  `POST .../roles/apply` (`kind: cedia_model_role_apply`, replay returns the receipt).
  `omp-model-state.test.ts` +parse/route/live coverage (9 pass in file).
- Window: Model roles section in the Settings provider destination (`CediaModelRolesControls`
  pure + wired section with apply mutation, per-row busy state, and the post-switch
  confirmation naming the active model), query/mutation options + strict parse in
  `serverReactQuery.ts`, `getModelRoles`/`applyModelRole` in `cedia-adapter.ts` +
  native exposure. `model-roles-surface.test.tsx` (4 pass).

## Live proof (prepared runtime, fixture models + config roles, no provider request)

`bun scripts/omp-roles-apply-smoke.ts` (16 checks): mapping reads with both roles and
their provenance; applying `smol` answers `fixture/cedia-roles-fast` **and** the
session really runs it afterwards (verified through an independent `model.state.get`
readback); an unconfigured role is refused; host half repeats the same through the
routes (controller reads, controller apply 403, owner apply + replay, bad bodies 400,
stale incarnation 409, post-switch model-state readback).

## Incidents during the slice

- Smoke configured `fixture/…` role mappings against a `cedia-roles-fixture` provider:
  resolution honestly found no model and refused. The mismatch was the smoke's, not the
  bridge's — fixed by naming the provider `fixture`, which is also what the refusal
  path is for. Recorded so the next fixture author checks the provider half.

## Still open

- §10 item 6 (`configureRoles` from the window) is narrowed but not closed: assigning
  mappings still has no window control — only activating them does now.
- `setModelTemporary` stays open by the one-command-one-operation rule (no second version).
- Applying mid-turn races the running turn's model like a terminal `/model` switch does;
  no deferral was added — the pending route carries model ids, not roles.

## Evidence (this revision and build)

- `bun scripts/omp-roles-apply-smoke.ts`: all 16 checks pass.
- Upstream roles/capability/model-state bridges (36 pass); `check:types` clean.
- Host suite 413 pass / 0 fail; agent-window suite 327 pass / 0 fail; root typecheck clean.
- `bun run check:omp-coverage`: integrity PASS, gap count **29** (was 30).
- Patch regen is faithful to the worktree (spot-audited: this slice's hunks only, plus
  previously documented slices); runtime re-prepared with attestation.
- `git diff --check`: clean.
