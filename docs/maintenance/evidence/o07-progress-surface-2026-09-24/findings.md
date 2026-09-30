# The task's own progress is a Cedia surface — 2026-09-24

This receipt records the O07 Progress slice: the todo phases OMP itself is tracking for a task are
projected by the host and rendered in the shared composer strip, so the owner reads the runtime's
own plan progress instead of a reconstruction (§2.8 O07's "Progress view shows actual native state").
It needs no runtime patch - the phases are already on the wire - and it settles the
`getTodoPhases` record through the registered `progress.get` operation. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice (the one runtime addition below): patch manifest sha
  `cf833ab57ffb5edafa12ffc6f3c0f229cc3664a04602ca09fbbdad6146ee70f9`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`).
- Runtime: `packages/coding-agent/src/modes/rpc/{cedia-capability-bridge.ts,rpc-mode.ts}` and
  `test/cedia-capability-bridge.test.ts` (the `progress.get` operation).
- Cedia: `apps/host/src/{omp-todos.ts,service.ts,router.ts}`, `apps/host/test/{omp-todos,service}.test.ts`,
  `apps/host/test/fixtures/fake-host.mjs`, `apps/macos/agent-window/src/cedia-adapter.ts`,
  vendor `lib/serverReactQuery.ts`, the new `components/chat/CediaProgressSurface.tsx` and its mount
  in `components/ChatView.tsx`, `apps/macos/agent-window/test/{cedia-progress,cedia-progress-surface}.*`.
- Gate and proof: `scripts/check-omp-coverage.ts`, `scripts/lib/omp-coverage.ts`,
  `scripts/omp-progress-smoke.ts` (new), `scripts/omp-capabilities-smoke.ts`,
  `packages/omp-adapter/test/cedia-capabilities.test.ts`.

## What changed

- **OMP's list, not Cedia's.** `GET /v1/sessions/:id/progress` answers the runtime's own
  `todoPhases` - `{ name, tasks: [{ content, status, blocker? }] }` - in OMP's order, with no field
  Cedia invented. The projection is seeded from the `get_state` read the host already performs,
  folded from a `todo` tool result inside a turn, re-read once at a turn boundary, and folded from
  the runtime's own `set_todos` acknowledgement (including a durable command replay). A malformed
  shape is ignored rather than half-applied, and a session with no live runtime answers
  `unavailable` with the reason instead of an empty list.
- **The Progress surface.** The shared bundle renders the phases above the composer, beside the plan
  strip: each phase in the runtime's order, each task's own status, a blocked task's own blocker
  text, and counts of those phases. An empty list renders nothing; `unavailable` names the host's
  reason. Counts are arithmetic over the returned phases - no percentage, ETA or duration exists in
  OMP's data and none was invented.
- **One registered read for progammatic clients.** `progress.get` joins the runtime's capability
  table (O07, session scope, controller principal) and answers the same phases the direct route
  serves, so the coverage record is settled against a live table rather than against a shared
  command name: the RPC table forbids one command standing in for two operations, and `get_state`
  already carries the context usage.

## Verification

| Command | Result |
|---|---|
| `bun scripts/omp-progress-smoke.ts` | every check OK against the prepared runtime: an empty list on a fresh session, the runtime answering the phases it accepted from `set_todos`, `get_state` returning the same list in order with the blocker text, the owner-only route answering the same phases in the same order, `unavailable` with a reason before any runtime and again after a stop, and 401 without the owner token |
| `bun test apps/host packages/omp-adapter` | 354 pass, 0 fail |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1203 pass, 0 fail |
| `bun test apps/macos/agent-window/test` | 184 pass, 0 fail |
| `bun run --cwd apps/macos/agent-window typecheck` | pass |
| `bun run check:types` (runtime package) | clean |
| `bun scripts/omp-capabilities-smoke.ts` | every check OK; the available-row list now includes `progress.get` |
| `bun run check:omp-coverage` | integrity PASS, 1041 audited records, 17 descriptors, gaps 123 -> 122 |
| `bun run typecheck` | 10 pre-existing errors, all in the vendor tree's `~/nativeApi` alias and `apps/macos/test/state.test.ts`; none in this slice's files |
| packaged run: `build:agent`, `CEDIA_HOST_NODE=… package:mac`, `check:packaged` | `Cedia.app` rebuilt and every `check:packaged` row OK, including the Agent Window assets matching the local build |
| packaged window (live runtime) | with a real session started, the runtime's own `set_todos` sent through Cedia's command envelope, the window rendered `Cedia progress` / `Progress` / `Done: 2  In progress: 1  Blocked: 1  Pending: 1`, the phases `Recon` and `Build` in OMP's order, and `Blocked wait for the owner's call ( owner has not answered yet )`. Stopping the session and quitting left no app, host or OMP process and a durable `stopped` lifecycle receipt |

Record the gate settles (1): `getTodoPhases`, through the registered `progress.get` operation, with
the Progress surface named as its presentation.

## Defects and decisions found while building

- **A client `set_todos` went stale in the projection.** The first live smoke found that phases set
  through Cedia's own command envelope never reached `GET /progress`: the projection's triggers were
  the seed, a `todo` tool result and a turn boundary, and a client command is none of them. Fixed by
  folding the runtime's own acknowledgement (and its durable replay) instead of waiting for
  unrelated activity; the smoke now fails without that fold.
- **The RPC table's uniqueness rule forced the honest shape.** `get_state` already carries context
  usage, and the shipped SDK table refuses to let one command stand in for two operations, so
  `getTodoPhases` was settled the way the goal and plan rows were: a registered, validated read
  (`progress.get`) rather than a second name on an existing command.
- **The UI does not poll.** The progress query is refreshed by thread activity, so a change made
  outside the window (another client, or a command sent straight to the host) appears on the next
  remount or activity rather than instantly. A phase change the agent makes in a turn arrives as
  thread activity and does refresh it; cross-window live push is not built.

## Not done, and why

- **No live run showed the agent filling the list itself.** Reaching the `todo` tool needs a model
  turn, so this slice proves the read path, the tool-result fold and the rendering with the runtime's
  own command; a provider-backed run is a separate authorized step.
- **Cedia cannot edit the list.** The panel is read-only: the runtime owns the todos, and the client
  write path (`set_todos`) stays what Cedia already routes, not a second task manager.
- **The rest of O07 remains open**: Advisor (configs, stats, status, history, enable), Prewalk,
  `get_subagent_messages`, `/agents`/`/hub`/`/loop`/`/guided-goal`, and `goal show`/`goal budget`.
