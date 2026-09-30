# Slice (O07 guided-goal): the interview is already on the wire — 2026-09-25

`/guided-goal` interviews the user in chat, then sets up goal mode. Unlike the loop
and prewalk slices there is no state to project and no control to add: the runtime
kicks the interview off as an ordinary turn (hidden developer kickoff, the agent's
questions as assistant turns, the user's answers as prompts) and the finished interview
creates the goal through the `goal` tool, which the composer goal header already shows.
The transcript is the surface. What Cedia owed this row was proof the composer prompt
path actually dispatches it headless — both branches — and that proof is
`bun scripts/omp-guided-goal-smoke.ts`. Gap count **33 → 32** (O07 slash 3 → 2).

## Live proof (prepared runtime, no provider turn completing anywhere)

- Phase A (goal disabled via `config.yml`): `/guided-goal probe objective` is consumed,
  no turn starts (`agent_start` absent), and the runtime's own "Goal mode is disabled.
  Enable it in settings..." refusal reaches the terminal.
- Phase B (goal enabled, fixture model, dead endpoint): after `/switch` selects the
  fixture model, `/guided-goal probe objective` starts the interview turn (`agent_start`
  observed), and nothing can complete (connection refused).

## Inherited wart, recorded not fixed

The dispatch occupies the prompt call until the kickoff turn settles: the terminal's
`handleGuidedGoalCommand` awaits `session.prompt`, and the RPC path inherits that
await as-is. With a live model the call returns with the first interview question in
seconds; against an unanswering endpoint it rides OMP's own retry budget (observed:
60 s without settling). The smoke therefore sends without awaiting and observes the
start. Cedia surfaces the running turn through the existing turn projection; no second
submission path was added, and the handler was not re-timed — changing OMP's own
await is upstream behavior work, not a Cedia carrier.

## Still open

- An interview that reaches a live model, asks, and creates its goal end to end needs
  a provider turn (the goal header half is already live-proven via `goal.set`).
- O07 `agents` and `hub` remain gaps (AgentHub/job controls need their own bridge).

## Evidence (this revision and build)

- `bun scripts/omp-guided-goal-smoke.ts`: all 7 checks pass (both phases above).
- No runtime, host, or window code changed — dispatch proof only, by design.
- `bun run check:omp-coverage`: integrity PASS, gap count **32** (was 33).
- `git diff --check`: clean.
