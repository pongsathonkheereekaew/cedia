# Slice (O07 agent lifecycle, runtime half: kill + revive senders)

Owner-ordered full vertical, first half. The hub's abort-and-release (`x` kill)
and revive-parked (`r` revive) had no Cedia sender; this slice registers both as
capability operations. Viewing needs no sender: `focusAgentSession` only attaches
the main view to the live session (zero lifecycle calls), and Cedia opens the
same child transcript through `get_subagent_messages` already.

## What was built (pinned patch, re-derived)

- New `cedia-agents-lifecycle-bridge.ts`: `killCediaAgent` (unknown id, advisor
  read-only and abort-then-release with tombstone mirroring the hub; answers
  `{id, aborted, released}`) and `reviveCediaAgent` (unknown, advisor and
  non-parked refusals with the hub's sentences; awaits the restore unlike the
  terminal's fire-and-forget; answers `{id, revived}`).
- Table: `agents.kill` + `agents.revive` descriptors (O07, session, owner) and
  operations with strict `{id}`-only validators, plus rpc-mode handlers.
- Patch regen verified surgical (only the 2 new files plus the 2 edited files
  differ from the backup), manifest sha updated, runtime re-prepared + attested.
- A unit test caught a real dead-code bug on the way (shared lookup threw for
  advisor rows before the specific messages).

## Proof

- Upstream `cedia-agents-lifecycle-bridge.test.ts`: 9 pass (refusals, abort +
  tombstone call shapes, abort-failure propagation without release, restore).
- Upstream `check:types` clean; `cedia-capability-bridge.test.ts` 23 pass.
- Live against the prepared runtime: both ops available/owner/O07; validation
  refusals exact; unknown ids refuse with `Unknown agent: <id>`; fast, no hangs.
- Pin test extended to 71 ops, all executed: 10 pass.

## Deliberately not in this half

- Host routes, adapter and panel buttons (host/UI half follows).
- Gate rows `/agents` + `/hub` stay open: no Cedia surface drives the new
  senders yet. Live kill of a running agent and live revive of a parked one need
  provider turns and stay unproven (refusal/validation paths are proven).
