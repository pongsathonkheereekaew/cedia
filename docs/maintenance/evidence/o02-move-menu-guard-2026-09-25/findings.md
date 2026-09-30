# Slice (O02 `/move` menu guard): hung command out of the composer menu

No new runtime or host code. The previous slice proved `/move` hangs the headless prompt
path with outcome unknown and fenced the coverage claim; this slice removes the
discoverable path to that wedge in the working UI, following the established
capabilityGate rule (an integration-missing row is absent from the working UI).

## Changes

- `packages/protocol/src/headless-slash.ts` (new, with `test/headless-slash.test.ts`):
  the single owner of the pinned runtime's headless-hang slash list (currently only
  `move`, with its probe reference). The coverage gate derives its exception table from
  this module instead of a gate-local literal, so the two cannot disagree. Re-probe
  before removing an entry: an upstream fix would silently keep hiding a working command,
  which is the unsafe side of staleness here.
- `apps/macos/src/state.ts` (`normalizeSlashCommands`, the one funnel where the
  runtime's `available_commands_update` becomes composer menu rows): rows naming a listed
  command are dropped, including `move <path>`-shaped rows. Typed composer text still
  passes through untouched — this removes the menu path to the wedge, not the wedge.
- `apps/macos/test/state.test.ts`: the menu filter is pinned (a catalog advertising
  `move` beside `mcp` reaches the menu as `mcp` only).

## Proof

- `bun test apps/macos/test/state.test.ts` (18 pass, incl. the new filter test).
- `bun test apps/macos/test` (760 pass), `apps/macos/agent-window/test` (302 pass),
  `packages/protocol/test` (9 pass).
- `bun run typecheck`: no new errors in the touched files.
- `bun run check:omp-coverage`: unchanged — integrity PASS, 37 gaps (the `slash move`
  gap row stays exactly as the honest label for the still-hanging command).

## Deliberately not done

- Intercepting typed `/move` text at send time: that would commandeer user input, and the
  correct fix for typed text is upstream (answer headless) or an R3 cwd reconciliation,
  both larger than this slice.
- `/wt` shares the relocateSession machinery but fail-fasts on its own error path in the
  fixture env (unrelated cause: cwd not a repository), so it is unprobed and untouched.
