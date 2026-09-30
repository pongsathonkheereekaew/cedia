# The owner can see and steer an OMP goal from Cedia — 2026-09-24

This receipt records the first real O07 surface: OMP's own goal mode is now readable and
controllable from Cedia through the runtime's registered operations, so the task's objective, its
status and its budget are the runtime's state and the composer's goal header is a control over it
rather than a piece of Cedia metadata (§8.2 O07). §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned runtime `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`; patch
  `patches/omp/0001-cedia-rpc-bridges.patch` regenerated through a throwaway index (48 changed
  files, 19 new-file hunks), `bun scripts/prepare-omp-runtime.ts` verified and rebuilt it.
- New: `upstream/omp/packages/coding-agent/src/modes/rpc/cedia-goal-bridge.ts`,
  `packages/omp-adapter/test/cedia-goal.test.ts`, `apps/host/src/omp-progress.ts`,
  `apps/host/test/omp-progress.test.ts`, `apps/macos/agent-window/test/omp-progress.test.ts`.
  Changed: `rpc-types.ts`, `rpc-mode.ts`, `cedia-capability-bridge.ts` (runtime);
  `packages/omp-adapter/src/{types,client}.ts`, `packages/protocol/src/index.ts`,
  `apps/host/src/{service,router}.ts`, `apps/host/src/capabilities.ts`,
  `apps/macos/agent-window/src/cedia-adapter.ts`, `scripts/{check-omp-coverage,omp-capabilities-smoke}.ts`.

## What changed

- **The runtime owns the operation.** `cedia_goal` takes `get | set | replace | pause | resume |
  drop | complete | budget` and answers the whole of OMP's goal state after the operation, and the
  same handler is registered as `goal.get`/`goal.set` in the `cedia_control` table, so the direct
  command and the registered operation cannot drift into two projections of one thing.
- **Every gate is OMP's own.** `set`/`replace`/`resume` refuse while plan mode or vibe mode is
  active; `set`/`replace` refuse when `goal.enabled` is false; a `set` that lands on a live goal is
  refused the way `/goal <objective>` refuses it (an active goal is managed or dropped first, a
  paused one is resumed or dropped) so a control that looks like a set cannot overwrite an
  objective the owner is pursuing; `pause`, `drop` and `budget` refuse when there is no goal to act
  on; `complete` reports the runtime's own `mode: "exiting"`, `reason: "completed"`.
- **`set`/`replace` dispatch the objective as the turn**, exactly as `/goal <objective>` does
  (a steer while streaming), and the answer says `startedTurn: true`. The operations that only
  change state do not claim to have started anything.
- **Continuation stays opt-in.** OMP decides which run modes may auto-continue between turns
  through its own `goal.continuationModes` setting; this bridge answers to the `rpc` entry. With
  the shipped default (`["interactive"]`) a goal set from Cedia is an objective the agent pursues
  within the turns the owner sends and nothing runs on its own - including after a restart, where
  the setting is read again rather than remembered.
- **Cedia projects it, per session.** `apps/host/src/omp-progress.ts` seeds from `cedia_goal {op:
  "get"}`, updates from every streamed `goal_updated` frame, and answers `GET
  /v1/sessions/:id/goal` from that cache; `POST /v1/sessions/:id/goal` is a durable command
  (idempotent by `commandId`, typed `stale_incarnation`, the runtime's refusal text preserved
  verbatim, `not_dispatched` when there is no live runtime rather than a fabricated outcome). The
  adapter fills the task's `goal`, `goalStartedAt` and `goalPausedAt` from the newest
  `goal_updated` frame (the host route is only a fallback), so the existing composer goal header
  renders OMP's objective, elapsed time and paused state, and its edit/pause/resume/delete actions
  dispatch `set`/`replace`/`pause`/`resume`/`drop` back to the runtime.
- **Two stale arguments in evidence were corrected while proving this.** The capability smoke still
  expected `omp.settings` to be `integration_missing`, and the aggregate row still said "No OMP
  runtime is running" *while a runtime was running*: the row is now `available` with the settings
  operations whenever a runtime answered, and the smoke asserts that plus `remote.tailscale` being
  `dependency_unavailable` in a build with no packaged web client.

## Verification

```
bun scripts/omp-capabilities-smoke.ts          # every check OK, including the goal round trip
bun test packages/omp-adapter/test/cedia-goal.test.ts        # 3 pass, 0 fail
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                                              # 1182 pass, 0 fail
bun test apps/macos/agent-window/test         # 171 pass, 0 fail
bun run --cwd apps/macos/agent-window typecheck  # clean
bun run typecheck                             # the same 10 pre-existing errors
bun run check:omp-coverage                    # Integrity PASS; 134 gaps (was 142)
git diff --check                              # clean
```

The smoke drives the host's own routes against the prepared pinned runtime with a dead model
endpoint, so no provider request leaves the machine: `set` (objective + budget) answers the
runtime's record and `startedTurn: true`, a repeated `commandId` answers the identical result, the
stored record moves to `paused`, the read route reports that paused state, and `resume` returns it
to `active`. The adapter suite proves the projection from a fixture `goal_updated` frame and the
command mapping for `set`/`replace`/`pause`/`resume`/`drop`.

## Gate effect

Eight audited records moved from gap to settled, all of them against evidence rather than a
narrative: `sdk getGoalModeState`, `sdk setGoalModeState` and `sdk goalRuntime` are now linked to
the registered `goal.get`/`goal.set` operations, and the link is verified against the **live**
runtime table (`verifyOmpSdkOperationLinks`), so a runtime that stops advertising the operation
puts the row back in the gap list. The `/goal` slash command and its `set`, `pause`, `resume` and
`drop` subcommands are settled as Cedia's equivalent surface; `/goal show` and `/goal budget` stay
gaps with their own reasons, because Cedia shows the objective but neither the usage details nor a
budget control.

## Not done here

- No Cedia control for a goal's token budget or its usage details; `/goal show` and `/goal budget`
  remain gaps.
- Plan mode, vibe mode, `guided-goal`, loop, AgentHub/hub and the advisor surfaces have no Cedia
  surface yet; `sendGoalModeContext` and `getTodoPhases` are still unsettled records.
- No packaged window was captured showing the goal header with a live goal; the proof here is the
  host smoke, the adapter suite and the runtime contract.
