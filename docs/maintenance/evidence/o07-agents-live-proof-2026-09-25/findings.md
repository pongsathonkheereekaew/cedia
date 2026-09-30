# Slice (O07 live kill of a running agent, no provider turn anywhere)

The host/UI half proved every path except the two that need real agents. This slice
closes the first one: a `/tan` dispatched through the host commands route forks a worker
that hangs on its first model call (the fixture endpoint accepts and never responds),
so the roster carries a genuinely running subagent. Cedia's own owner-only durable kill
route then aborts the live turn and releases the row. Zero provider cost, zero
credentials, loopback only — `scripts/omp-agents-live-proof.ts`, green.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, dirty with the open slices.
- Pinned runtime `omp/18.1.18`; no product code changed in this slice (proof only).

## What the proof shows (all live, all local)

- Dispatch `POST /v1/sessions/:id/commands` with `/tan` → 200; roster carries the worker
  with `parentId: "Main"` and `status: "running"` on its hung model call.
- Focus while running: `GET .../agents/:id/transcript` → 200, honestly unavailable or
  readable, never a silent empty.
- Kill `POST .../agents/kill` → 200 `{available: true, id, aborted: true, released: true}`.
- Roster re-read: the row stays visible with `status: "aborted"` (tombstone), no longer
  running — matching the panel rule that offers Kill to live rows only.
- Revive of the tombstoned row → 200 `available: false` with the hub's own sentence
  (`... is aborted — only parked agents can be revived`), never silently revived.

## Deliberately not proven: revive of a parked agent

A parked agent needs a worker whose turn completes or yields at least once, which needs
a model that answers; no local stub answers (the fixture hangs by design) and no provider
credentials are authorized in this baseline. Prerequisite, not a failure: an answering
model (provider turn or a canned completions stub that follows the runtime's wire format).
The refusal above is the honest boundary. No gap change by design: `/agents` + `/hub`
slash rows still need their own slash carriers.
