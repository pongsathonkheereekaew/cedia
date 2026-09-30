# A running task's OMP subagents are visible in Cedia — 2026-09-24

This receipt records the second O07 surface: the runtime's own live subagent set is projected per
session and rendered by the composer's existing subagent strip, so what the owner sees is OMP's
lineage rather than a Cedia reconstruction of it (§8.2 O07, §8.1 D's "actual OMP subagent
status/lineage"). No runtime patch was needed: `get_subagents` and the subagent frames already
exist in the pinned patch, and the host already subscribed to them. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Packaged OMP patch unchanged for this slice; runtime attestation still passes at patch sha
  `9720d161…`.
- `packages/protocol/src/index.ts` (`OmpSubagentStatus`, `OmpSubagentRow`, a bounded
  `OmpSubagentProgressProjection`, strict row/list/snapshot/lifecycle/progress parsers),
  `apps/host/src/omp-progress.ts` (a second per-session table), `apps/host/src/service.ts`,
  `apps/host/src/router.ts`, `apps/macos/agent-window/src/cedia-adapter.ts`,
  `apps/host/test/omp-progress.test.ts`, `apps/macos/agent-window/test/omp-progress.test.ts`,
  `scripts/{lib/omp-coverage,check-omp-coverage,omp-capabilities-smoke}.ts`.

## What changed

- **The runtime's answer is the table.** `OmpProgress` seeds a per-session subagent table from
  `get_subagents` (no payload) and folds the streamed `subagent_lifecycle` and `subagent_progress`
  frames: `started` upserts, a terminal status removes, and a progress payload upserts by its own
  row id while keeping the task text the progress frame may not carry. A malformed frame is
  ignored, never guessed at. The projection is deliberately bounded - tool counts, requests,
  tokens, cost, duration, the current tool, context size and the resolved model - so no tool
  argument, output text or child transcript crosses into Cedia.
- **The live set, not a history.** OMP's own registry deletes a subagent when its lifecycle
  reaches a terminal state, so `GET /v1/sessions/:id/subagents` answers the *live* set and a row
  disappears when the runtime says the run ended. Cedia does not keep its own copy that could
  disagree, and a runtime that does not answer `get_subagents` is `unavailable` with the reason
  rather than "no subagents".
- **The existing strip renders it.** The adapter emits one work-log entry per live row in the
  shape the shared bundle's own decoders read (`workLog.ts` -> `decodeSubagentReceiverThreadIds` /
  `decodeSubagentReceiverAgents` / `decodeSubagentAgentStates`), so the composer's subagent strip
  (`ComposerSubagentStrip.logic.ts` -> `deriveComposerSubagentStripItems`) shows the run's status
  and model with no second subagent UI and no vendor edit. Two mapping decisions matter for
  honesty: the displayed role is OMP's own agent name (`task`, `explore`, …), not `agentSource`
  (`bundled` would have rendered as a meaningless label), and the row's message is the assignment
  or task it was actually given. A thread's own `subagentAgentId`/`subagentRole` are filled only
  when the thread really is that run.

## Verification

```
bun test apps/host                                        # 266 pass, 0 fail
bun test apps/macos/agent-window/test                     # 172 pass, 0 fail
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                                                          # 1186 pass, 0 fail
bun scripts/omp-capabilities-smoke.ts                     # every check OK
bun run --cwd apps/macos/agent-window typecheck           # clean
bun run typecheck                                         # the same 10 pre-existing errors
bun run check:omp-coverage                                # Integrity PASS; 133 gaps (was 134)
git diff --check                                          # clean
```

The adapter test is the one that proves the surface rather than the data: it builds the real
thread snapshot from a fixture `get_subagents` answer, runs the vendor's own
`deriveWorkLogEntries` and `deriveComposerSubagentStripItems`, and gets a strip row
`{ providerThreadId: "agent-1", primaryLabel: "Task", role: "task", modelLabel: "fixture/model",
statusKind: "running", isActive: true }`. The host suite proves the seed call, the upsert/remove
behaviour across lifecycle and progress frames, that a malformed frame leaves the table
unavailable instead of inventing rows, and that the route answers the cache.

## Gate effect

`rpc get_subagents` moved from gap to settled: the row is now credited to a **named Cedia
caller** (`apps/host/src/omp-progress.ts`) and `verifyOmpRpcCediaCallers` fails the run if that
file stops sending the command or cannot be read, so the credit cannot outlive its call site.
`get_subagent_messages` stays a gap: Cedia reads no child transcript yet.

## Not done here

- No live subagent run was observed end to end: a real `task` fan-out needs a model turn, so the
  proof here is the runtime contract, the seeds/frames fixtures and the vendor strip derivation -
  not a captured run.
- `get_subagent_messages` (a child's own transcript) has no Cedia view.
- The strip is a flat list of live runs; OMP's `parentToolCallId` is carried through the protocol
  but no surface draws parent/child nesting yet, and `AgentHub`/`/agents`/`/hub` remain gaps.
- No packaged window was captured showing the strip with live subagents.
