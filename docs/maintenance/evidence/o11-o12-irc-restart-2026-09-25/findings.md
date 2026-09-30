# Agent bus internals plus the lifecycle restart, settled honestly — 2026-09-25

This receipt records a four-row settlement with no new runtime, host or window code: three
O11 IRC rows settled as agent-to-agent plumbing inside OMP's own runs through source-evidence
dispositions the gate re-reads every run, and the `/restart` slash row settled as Cedia's own
stop plus start of the task session. §10 item 70 owns status. No provider request was made
and no model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. No upstream change in this slice; `dist/omp/omp` not
  re-prepared.
- Changed for this slice: `scripts/lib/omp-coverage.ts` (three dispositions),
  `scripts/check-omp-coverage.ts` (one platform equivalent); this receipt;
  `docs/maintenance/CEDIA-PLAN.md` (item 70 row).

## What changed (one disposition per SDK row, each with re-read source evidence)

- `deliverIrcMessage`: the IRC bus injecting a message into a recipient session or waking
  it with a real turn — called only by the bus itself. No client addresses the bus; Cedia
  sees transcripts, tool cards and the Agents roster instead.
- `drainPendingIrcInboxMessages`: the inbox read behind the agents' own IRC tool, consumed
  mid-turn before automatic injection. The tool call renders on Cedia's tool cards like
  every other tool; the drain behind it is not a separate client operation.
- `waitForIrcReplies`: waiting out reply obligations (auto-replies, wake-turn relays),
  observed by the bus after delivery. Peers hold stop verdicts on it inside OMP's flow.
- `/restart` (O12 slash): restarting the runtime is Cedia's stop plus start of the task
  session — stopping ends the runtime process with a durable stopped receipt, starting
  launches a new one resuming the same session file. No single restart button exists
  because the lifecycle owns both halves (plan §2.7).

## What was observed

- `bun run check:omp-coverage`: integrity PASS, 1,041 audited records with 1,041 Cedia
  mappings, live `omp/18.1.18`; gap count **41** (was 45). `--list-gaps` no longer names
  any of the four rows.
- Negative probes: evidence text without the literals reports `unclassified` for all three
  SDK rows — every guard holds. (`restart` carries no needle guard, like every other
  settled slash row: its protection is the dated audit plus the lifecycle it names.)
- `bun test scripts/lib`: 84 pass / 0 fail.
- `git diff --check` clean.

## Still open (not claimed)

- O11 keeps work pools (`get/setWorkPoolYieldItems`) for a future hub surface and
  `getAsyncJobSnapshot` for future job views — state a surface could show, not plumbing.
- O12 keeps `auth-broker`, `auth-gateway`, `share`, `tiny-models`, `update` (separately
  qualified operations) and the excluded `live` (deferred voice input).
- No behavior changed anywhere in this slice. If a future upstream revision moves any cited
  literal, the gate fails instead of leaving the claim standing.
