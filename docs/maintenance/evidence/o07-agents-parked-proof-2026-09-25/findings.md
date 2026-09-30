# Slice (O07 revive of a parked agent, fixture-backed live proof)

Supersedes the open item in `o07-agents-live-proof-2026-09-25`: revive-parked is now
proven live. This is a **fixture-backed proof, not a real-provider proof** — the parked
state itself comes from the runtime's real controller path (no production code was
changed to fake it), but the worker's turn completes on canned text, never on a model.

## How the parked agent is produced (real path, traced from source)

`/tan` in `tan-command-controller.ts` flips a finished clone to `parked` before dispose
(and to `aborted` when the abort signal fired). A loopback stub answers every
`POST .../chat/completions` with one standard SSE text turn (role preamble, content
delta, stop + usage, `[DONE]` — the `openai-completions` wire in
`packages/ai/src/providers/openai-completions.ts`), so the worker completes and parks
exactly the way a provider-completed worker would. No credentials, no cost, loopback only.

## What the proof shows (`scripts/omp-agents-parked-proof.ts`, green)

- `/tan` through the host commands route → roster carries the worker (`parentId: Main`);
  running → `parked` after 2 canned completions, 0 provider calls.
- Focus: transcript route answers for the parked (transcript-only) worker.
- Revive through Cedia's durable route → 200 `{available: true, id, revived: true}`;
  post-revive row reads `idle` (session reattached by the lifecycle's own restore).
- Replay: the same revive command id replays the stored result byte-identically —
  one restore, never a second spawn.

## Still not proven

A provider-completed worker parking and reviving end to end (needs an answering model;
none authorized in this baseline). The lifecycle and idempotency behavior proven here
is model-independent — the restore path does not branch on what completed the turn —
but the label stays fixture-backed until a real-provider run says otherwise.
No gap change claimed here: `/agents` + `/hub` slash rows still need their own slash
carriers (next slice in this thread).
