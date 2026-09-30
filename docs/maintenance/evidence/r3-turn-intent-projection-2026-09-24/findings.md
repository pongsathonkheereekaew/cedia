# R3 turn intent projection and honest unknowns — 2026-09-24

This receipt records the host half of §2.4 (turn acceptance, queue and pending-model
contract): a submitted turn now has a durable identity and a projection whose states come
from OMP evidence or say plainly that Cedia does not know. Evidence is fixture-based; the
OMP-side queue snapshot and intent echo are the next slice, and §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- Before this slice a submitted turn existed only as a command receipt
  (`claimed`/`acknowledged`/`completed`/`failed`/`outcome_unknown`/`not_dispatched`) plus an
  in-memory `activeCommand`. A host restart could not say which accepted turn had started,
  and a queued turn had no identity of its own.

## Implemented in this working tree

**Every submitted turn has an identity, persisted before dispatch (§2.4).**
`turn_intents` (store schema 4) records `turnIntentId`, the `commandId` it is linked to, the
device, incarnation, the command receipt's payload hash, the host's acceptance order, the
state, the OMP event sequence the state came from, an OMP queue position when a runtime
reports one, and the reason in the user's words. `prompt`, `abort_and_prompt` and `follow_up`
claim an intent; `steer` deliberately does not, because it is input to the turn already
running rather than a second queued turn. A replay of the same command returns the same
intent, and a different payload for that command is a conflict, exactly like the command
receipt.

**The states come from evidence or admit ignorance.**
`prepared` (accepted, not dispatched), `queued` (OMP acknowledged the transport - accepted,
never "completed"), `running` (OMP's `agent_start`/`turn_start`), `completed` (OMP's
`prompt_result`/`agent_end`, carrying the event sequence it was read from), `failed` (OMP
refused the command), `cancelled` (Stop interrupted a running turn), `needs_continue` (a turn
that never reached OMP, or was paused by Stop) and `outcome_unknown` (the OMP owner vanished
while the turn was dispatched). A finished turn is final; `needs_continue` and
`outcome_unknown` stay open so evidence can still settle them. Nothing is ever replayed, and
no state is inferred from a missing fact.

**Recovery never invents an outcome.** `recoverPending` now pauses intents that had not
started (`needs_continue`) and marks intents that were running as `outcome_unknown`, beside
the existing command/session recovery. A queued-but-undispatched turn is paused, not replayed.

**Clients read one projection.** `sessionView` stamps `turns` (most recent 20, oldest first)
on every session row, so a window, the CLI or a remote client reads the same Cedia record.
Turn projections are bookkeeping: the conversation stays in OMP's session file.

**A schema upgrade keeps what it started from.** `initializeSchema` copies
`journal.sqlite` to `journal.sqlite.schema-<old>.backup` (0600, checkpointed first, never
overwritten) before migrating an older state directory, which is the rule §8's migration
policy asks for and which the earlier v3 upgrade did not yet implement.

## Defects and decisions found by the fixtures

- **A never-dispatched turn cannot be produced through `command()` on an unstarted task**: the
  stale-incarnation guard refuses it first, so the fixture that wanted to observe `prepared`
  had to stop a started session's OMP owner instead. The guard is correct; the test now
  exercises the path that really exists.
- **`#record` had to return the event it appended.** The projection names the OMP event
  sequence each state came from, so the frame path needs that sequence; the two
  `ExtensionUiBroker` listeners now ignore the return value explicitly.
- **A checkpoint inside the migration transaction is a no-op**, which the backup fixture
  caught: the first copy was a valid SQLite file with no `metadata` table because the WAL had
  not been folded in. The backup now runs before `BEGIN IMMEDIATE`.

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/host/test/store.test.ts` | 17 passed, 0 failed |
| `bun test apps/host/test/service.test.ts` | 27 passed, 0 failed |
| `bun test apps/host` | 182 passed, 0 failed, 23 files (1,079 assertions) |
| `bun test apps/host apps/macos/agent-window/test` | 300 passed, 0 failed, 51 files (1,441 assertions) |
| `npx tsc --noEmit` scoped to `apps/host`/`packages/protocol` | no new errors |

The service fixtures drive the real host against the fake OMP process: a prompt is projected
from acceptance to `completed` with the OMP event sequence it was read from and the same
payload hash as its command, a replay produces one intent rather than two, a turn that never
reached OMP is paused (`not_dispatched` + `needs_continue`), a second prompt behind a running
turn is refused and paused at acceptance order 2, and Stop cancels the running turn while
pausing the one behind it. The store fixtures prove the same table survives a reopen with
`needs_continue`/`outcome_unknown` instead of a guessed outcome, and that a schema-2 state
directory is migrated with a private, version-named backup beside it.

## Not implemented / not claimed

- **No OMP intent echo and no OMP queue snapshot yet.** The pinned OMP runtime still knows
  nothing about these identities: it neither echoes `cediaIntentId` on turn boundaries nor
  reports which queued intent started, so `queuePosition` is empty, the host binds a turn
  boundary to the oldest open intent (unambiguous only because Cedia serializes turn
  acceptance per task), and a queued `follow_up` behind a running turn stays `queued` until
  evidence arrives. The tracked patch (`patches/omp/0001-cedia-rpc-bridges.patch`), its
  manifest hash and the rebuilt runtime are the next slice.
- **The per-turn actual model is not recorded.** OMP's boundary frames carry no model, so
  §2.4's "actual model" stays unpopulated until the same bridge reports it.
- No rendered turn state and no per-turn model indicator in either window; no packaged or
  two-window run of this projection.
- Pending-model/effort revision acceptance, §2.6 cleanup, R4-R8 and every §8.2 O-packet remain
  open; speech-to-text stays deferred.

## Limitations

Fixture evidence from the revision above, on a real host with a scripted OMP stand-in. It does
not certify the real pinned runtime's cooperation - that is exactly what the next slice has to
prove - nor any packaging or rendered control.
