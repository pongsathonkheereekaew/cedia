# Slice (O07 agent lifecycle, host + UI half: kill / revive / focus)

Owner-ordered full vertical, second half. The runtime half (`o07-agents-lifecycle-runtime-2026-09-25`)
registered `agents.kill` + `agents.revive` with no driver; this half drives both end to end
(runtime → host → UI) with OMP keeping the lifecycle. Focus needs no sender: selecting an
agent opens its transcript through the already-carried `get_subagent_messages`, attaching the
view with zero lifecycle calls.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned runtime `omp/18.1.18` (prepared in the runtime half); this half adds no runtime change.

## Command outcomes (each specified)

- **kill** — abort-then-release with tombstone, hub-mirroring refusals, strict `{id}`-only
  payload; answers `{id, aborted, released}`. Unknown id → `unavailable` with the runtime's
  own `Unknown agent: <id>` reason (nothing started). Advisor rows and non-id payloads refused
  before any runtime call. Repeated command id replays the stored refusal byte-identically.
- **revive** — restore parked only, hub-mirroring refusals (unknown, advisor, non-parked),
  answers `{id, revived}`. Same replay and strict-payload rules as kill.
- **focus** — selecting an agent sets it selected and reads its transcript (paged, bounded,
  reset/truncation flags); no lifecycle call is made, so there is no lifecycle outcome to specify.

## What was built

- Host: owner-only durable `POST /v1/sessions/:id/agents/kill` and `.../agents/revive`
  (`router.ts` routes + `agentsKillCommand`/`agentsReviveCommand` strict validators,
  `service.ts` `agentsKill`/`agentsRevive` with stale-incarnation guard, controller 403,
  durable command replay, unavailable-with-reason when no live runtime), strict parsers in
  `apps/host/src/omp-agents.ts`.
- Adapter: `killAgent`/`reviveAgent` plus `parseCediaAgentKillAnswer`/`parseCediaAgentReviveAnswer`.
- UI: `CediaAgentsSurface` renders Kill on live non-advisor rows and Revive on parked
  non-advisor rows (nothing on terminal/advisor rows), each behind a native confirm dialog
  stating the outcome, with panel-level error and busy states; roster refreshes through the
  existing thread-activity invalidation.

## Proof

- `bun run typecheck` clean; `apps/host/test/omp-agents.test.ts` 10 pass;
  `cedia-agents.test.ts` + `cedia-agents-surface.test.tsx` 14 pass (button visibility rules,
  strict answer parsing); full `apps/host` suite 436 pass.
- `scripts/omp-agents-smoke.ts` green against the prepared runtime (`omp/18.1.18`): unknown-id
  kill/revive answer unavailable with reason, replay identical, empty-id/unknown-param 400,
  controller kill 403, routes owner-only 401, no-runtime read reports absence and starts nothing.
- Coverage gate: integrity PASS, gaps stay **5** — no gate row closes here (`/agents` + `/hub`
  slash rows need their own slash carriers; buttons are not slash rows).

## Tested vs live proof still needing a provider

- Tested without any provider call: every refusal/validation/replay/absence path above, plus
  button visibility and answer parsing.
- Still unproven: kill of a running agent (abort + release + tombstone against a live turn)
  and revive of a parked agent (restore through the lifecycle's own restore). Both need
  provider turns and stay open by design.
