# Roles-precedence check: CEDIA reads match OMP by construction — 2026-09-26

Closes reusable item 1 from the #1166 differential (batch 10): verify CEDIA's
roles read matches OMP's own layer precedence instead of reimplementing it.
No product code changed; no gap change (stays **2**: `switchSession`,
`browser-relay`). §10 item 70 owns status. No provider involvement.

## Chain (source-verified, current tree)

- Pinned patch (`patches/omp/0001-cedia-rpc-bridges.patch`,
  `cediaModelRoles`): `model.roles.get` delegates to
  `session.settings.getModelRoles()` and reports
  `settings.getModelRoleProvenance(role)` per row. No config-file I/O, no
  layer merge, no yml/yaml fallback logic on CEDIA's side — the global /
  project precedence (including first-wins and failure-stops-fallback) is
  OMP's own `Settings` behavior by construction.
- Host (`apps/host/src/omp-model-state.ts`): strict projection requiring
  `source` in {runtime, overlay, project, global, default} — the provenance
  layers, so a surface shows which layer won (project-over-global included)
  without CEDIA merging anything.
- Upstream's documented precedence therefore holds for CEDIA reads
  automatically. Nothing to port; no second role-resolution path exists to
  drift.

## Proof

- `bun test apps/host/test/omp-model-state.test.ts`: 9 pass, 0 fail
  (88 expects) — strict projection incl. provenance layers, this turn.
- `git diff --check`: clean.

## Preserved

- D1–D5, deferred voice, `switchSession` open, single OMP
  execution/transcript/auth owner. Pin unchanged. Nothing committed;
  uncommitted tree preserved.
