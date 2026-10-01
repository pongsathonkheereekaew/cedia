# O06 live shared-registry reload finding — 2026-10-01

## Result

Split verdict. `bun scripts/omp-live-tan-reload-proof.ts` (host-backed,
zero spend — no auth copied, only dead/hanging loopback providers):

- PROVEN LIVE (5/5 runs): a `/tan` child mid-inference makes parent
  `/reload-plugins` refuse with exactly `Extension reload requires other
  live sessions sharing the model registry to be parked`, with the catalog
  unchanged. Liveness is genuine, not roster-deep: the tan's first model
  call arrives at a loopback that accepts and never answers, and the reload
  fires only after the arrival is observed.
- BLOCKED (3/3 runs past this point): after the tan is parked
  (`agents/kill` acknowledged, roster row `aborted`), `/reload-plugins`
  never settles (90 s+, then the probe gives up) while `get_available_commands`
  and a local `/usage` prompt complete normally. The hang is inside the
  reload action, not dispatch — prime suspects are generation quiescence or
  the reload fence waiting on the aborted worker's drained callbacks. The
  aborted row lingers in the roster (history, not liveness).

This is filed as a suspected product bug with a deterministic repro (the
script fails honestly at the post-park reload with a clear message), not as
a pass. The interim refusal boundary itself is now live-proven; it was
source/typecheck-only before.

## Mechanism notes (verified, reusable)

- `/tan` dispatches headless with no turn of its own; a dead-endpoint model
  keeps the worker merely rostered, but a request-observed hanging loopback
  proves mid-inference liveness.
- Destroying the hanging sockets does not end the worker within 60–150 s;
  `agents/kill` parks it (`aborted`), and kill is acknowledged 200.
- Roster rows persist after death (`aborted`) — presence is not liveness;
  assert on `status`, and confirm inference arrival independently.
- `session/new` validates `--trusted-extension` files still exist, so do not
  unlink fixtures before opening sessions that need them.
- A second host session cannot share the scratch project folder (non-git
  single-task rule) — the sharing under test is strictly parent↔tan child
  inside one OMP process.

## Limits

Park-then-replace recovery, removal, and usage-zero tail assertions stay
open behind the hang. Standalone interactive/ACP concurrent reload of
ordinary (non-tan) siblings and live shared-source provider replacement
remain open alongside it.
