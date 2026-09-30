# Slice (O02 cleanse): detection plus one bounded repair batch, headless — 2026-09-25

`/cleanse` detects project diagnostics with local checker commands and fixes them with
weighted parallel subagents. The terminal carries this in an overlay panel with pickers;
Cedia runs the same `runCleanse` core without the interactive half: an explicit target
selects the checkers (empty runs every discovered checker, like the terminal's "run
all"), progress plus the bounded held report land in the run state, and the abort signal
is the one the terminal's Esc drives. The composer Cleanse panel runs, aborts, and draws
the report; the transcript is never touched. Gap count **25 → 24** (O02 slash 4 → 3).

## What was built

- Runtime (`upstream/omp`, pinned `omp/18.1.18`): `cedia-cleanse-bridge.ts` —
  `createCediaCleanseBridge` with `run` (same core the overlay and the `omp cleanse`
  CLI call, headless board recording into the held state), `read`, and `abort` through
  the run's own signal. `cleanse.state.get` (controller) + `cleanse.run` with a
  validated target + `cleanse.abort` (owner), all session/immediate. The wire carries
  bounded summaries only: checker identity/exit/diagnostic counts, per-agent status
  with short detail, bounded diagnostics and log lines. Repair output bodies and full
  transcripts stay in the runtime. `cedia-cleanse-bridge.test.ts` (7 pass, runner
  injected — no checkers, no subagents, no provider).
- Host (`apps/host/src/omp-cleanse.ts`): strict parses (including unknown-field
  rejection, so a smuggled repair body fails), `OmpCleanse` projection,
  controller-visible `GET /v1/sessions/:id/cleanse`, owner-only durable
  `POST .../cleanse/run` and `POST .../cleanse/abort`. `omp-cleanse.test.ts` (5 pass,
  including a fixture round trip that dispatches at once, lands the held report,
  refuses a concurrent second run, and aborts to idle).
- Window: `CediaCleanseSurface.tsx` (request input, Run/Abort, progress rows, bounded
  report with diagnostics + skipped) mounted in the composer panel stack; query with
  a 3 s poll while a batch runs (terminal states never poll) + strict parses in
  `serverReactQuery.ts`; `getCleanse`/`runCleanse`/`abortCleanse` in `cedia-adapter.ts`
  + native exposure. `cleanse-run-surface.test.tsx` (6 pass).

## Design correction made mid-slice

The first version awaited the repair batch inside the run call. A dead-endpoint probe
showed even the failure path takes ~31 s (OMP's retry budget) — past the host's 30 s
control timeout — and success takes a whole repair batch. There is no per-model
timeout worth tuning, so the bridge matches the terminal overlay, which fires without
awaiting: the call answers the running state at once, the held report lands later,
the panel polls while running, and the durable receipt is the acceptance. The unit
tests caught a real snapshot bug in the first version on the way (same class as the
btw slice: a return evaluated before its running flag cleared).

## Live proof (prepared runtime, repo tsgo on PATH, fixture models)

`bun scripts/omp-cleanse-smoke.ts`: a clean project lands a clean report with the
TypeScript checker row and zero diagnostics — no model, no provider call; a dirty
project dispatches repair workers against a hanging endpoint (provider reached),
the abort answers at once, and the batch lands cancelled with zero completions;
host routes hold (controller read-only, owner run/abort, replay, 400s, 409).

## Incidents during the slice

- `tsgo` is a node script: the host runtime's minimal PATH had no `node`, so the
  checker exited 127 and a phantom diagnostic dispatched a doomed repair (which then
  failed on the environment's default model credentials). Fixed by shipping node on
  the smoke PATH — and the failure cascade itself proved the report honestly carries
  checker exits, repair failures, and their reasons.
- A receipt parser rejected its own `available` envelope key (same class of bug as
  the btw slice's state-key collision): the replay fell through to the durable error
  instead of the recorded receipt. Fixed by stripping the envelope before delegating.

## Still open

- A live repair that actually fixes (needs a provider turn): detection, dispatch,
  abort, and reporting are live-proven; the fix half is fixture-shaped.
- The cleanse auxiliary session file is deliberately not adopted by the host (it is
  not the task session); the report is the record.
- O02 `omfg`, `tan`, `move`/`moveSession`/`switchSession` remain gaps.

## Evidence (this revision and build)

- `bun scripts/omp-cleanse-smoke.ts`: all checks pass (clean/proven-clean, abort-to-cancelled, routes).
- Upstream cleanse/capability bridges (30 pass); `check:types` clean.
- Host suite 423 pass / 0 fail; agent-window suite 341 pass / 0 fail; root typecheck clean.
- `bun run check:omp-coverage`: integrity PASS, gap count **24** (was 25).
- Patch regen is faithful to the worktree (spot-audited); runtime re-prepared with attestation.
- `git diff --check`: clean.
