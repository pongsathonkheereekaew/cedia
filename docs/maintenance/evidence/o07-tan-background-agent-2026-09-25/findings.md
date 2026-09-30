# Slice (O07 background agent): the roster already had the row — 2026-09-25

`/tan` runs a full background agent on tangential work: it forks the parent transcript
into a clone session file and runs it as a background job through the session's own
async job manager, and the clone registers in the runtime's agent roster with its
parent linkage. No Cedia operation was added for any of this — the composer prompt path
dispatches `/tan` headless through the RPC terminal owner exactly like the terminal
dispatches it (verified: fast ack, `agentInvoked: false`, no turn of its own), and the
existing Agents surface reads the roster row plus the clone transcript. Gap count
**23 → 22** (O07 slash 2 → 1).

## Live proof (prepared runtime, dead endpoint, no provider request anywhere)

`bun scripts/omp-tan-smoke.ts`: the fixture model is selected; `/tan` dispatches with
no turn of its own; the roster carries the running tan with `parentId: Main`, its name,
live status, and the named clone file, which exists on disk with content while the tan
runs; the same dispatch through the host commands route lands the same row in the host
roster with the same linkage and file. A tan that finishes its work end to end needs a
provider turn — the worker hangs on its first model call here and dies with the runtime
at close.

## Honestly open inside this slice

- A running tan's transcript is not yet readable through the transcript routes: both
  the direct `get_subagent_messages` and the host transcript route answer unknown
  (the runtime's tracker does not resolve the running clone id). The clone file with
  its content is proven on disk instead. Parked-terminal readability is unproven for
  the same provider reason. Neither is claimed.
- Cancelling a running tan has no control — and neither does the terminal, so parity
  demands none. A hung tan rides out the retry budget; closing the session kills it.
- A persisted session is required: an unpersisted one refuses with the runtime's own
  "/tan requires a persisted session." Host sessions are always persisted, so this is
  the honest live state, not a gap.
- O07 `agents` and `hub` remain gaps (the dashboards' per-agent model/prewalk/advisor
  controls and the work-pool hub have no Cedia counterpart; the roster/transcript
  surface proven here is their foundation, not their replacement).

## Evidence (this revision and build)

- `bun scripts/omp-tan-smoke.ts`: all checks pass (dispatch, roster, parentage, clone
  file, transcript-route honesty, host parity).
- No runtime, host, or window code changed — dispatch proof only, by design.
- `bun run check:omp-coverage`: integrity PASS, gap count **22** (was 23).
- `git diff --check`: clean.
