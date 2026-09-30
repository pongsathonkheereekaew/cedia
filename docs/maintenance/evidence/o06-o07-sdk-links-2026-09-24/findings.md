# Goal context steering and the extension runner handle, through paths that already exist — 2026-09-24

This receipt records the gate-settlement slice for one O07 and one O06 audited SDK row, with no
new runtime, host or window code — `sendGoalModeContext` through the registered `goal.set`
operation (named operation link), and `extensionRunner` through OMP's own in-process bus
(source-evidence disposition). §10 item 70 owns status; this file records what was observed at
the revision below. No provider request was made and no model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. No upstream change in this slice; `dist/omp/omp` not re-prepared.
- Changed for this slice: `scripts/lib/omp-coverage.ts`, `scripts/check-omp-coverage.ts`;
  this receipt; `docs/maintenance/CEDIA-PLAN.md` (item 70 row plus the O06 prose it supersedes).

## What changed

- **One operation link** (`OMP_SDK_VIA_OPERATION`): `sendGoalModeContext` is carried by `goal.set`.
  Entering a goal steers its context into work in flight: the Cedia goal bridge's own `startGoal`
  (backing `goal.set`/`goal.replace`) runs the session's `sendGoalModeContext({ deliverAs:
  'steer' })` while streaming (`upstream/omp/packages/coding-agent/src/modes/rpc/cedia-goal-bridge.ts`),
  exactly as `/goal` does. The gate settles the row only while the live runtime table reports
  `goal.set` as available.
- **One source-evidence disposition** (`OMP_SDK_DISPOSITIONS`): `extensionRunner` is
  `platform_presentation_equivalent` — OMP's own in-process bus, held by the session and drawn on
  by controllers inside OMP's own turn flow. No client asks the handle for anything separately:
  extension commands already reach the composer menu (`get_available_commands` plus the
  `available_commands_update` push) and extension tools already reach the Tool catalog panel, and
  Cedia's own tree carries no reference to the handle at all. The gate re-reads both literals on
  every run.

## What was observed

- `bun run check:omp-coverage`: integrity PASS, 1,041 audited records with 1,041 Cedia mappings,
  live `omp/18.1.18` (498 settings, 50 audited RPC commands, 46 capability descriptors); gap
  count **69** (was 71), O06 sdk 5 (was 6), O07 sdk 3 (was 4). `--list-gaps` no longer names
  either row.
- Negative probes: a live table without `goal.set` and an evidence text without the runner
  literals each report `unclassified` — the guards hold.
- `bun test scripts/lib`: 81 pass / 0 fail.
- `bun test packages/omp-adapter/test/cedia-goal.test.ts`: 3 pass against the prepared runtime.
- `bun test upstream/omp/packages/coding-agent/test/goals/goal-mode-integration.test.ts`: 24 pass,
  including the two tests asserting a goal start/replace while streaming calls
  `sendGoalModeContext({ deliverAs: 'steer' })`.
- `git diff --check` clean.

## Still open (not claimed)

- O06: `refreshMCPTools` (discovery-produced input), `reload` (session lifecycle), code-mode rows
  (`getCodeModeDirectToolNames`, `initializeCodeMode`, `getEvalPreludes`), `/extensions` plus the
  `status` alias, the two dynamic-tool rows, and any packaged capture of the catalog panel.
- O07: `applyAdvisorConfigs` (the runtime's TUI editor), `armPrewalk`/`getPrewalkState`,
  `/agents`, `/guided-goal`, `/hub`, `/loop`, and the `goal show`/`goal budget` subcommands.
- No packaged capture of the goal header driving a live goal exists in this slice.
