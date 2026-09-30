# Delivery-reference check: #1276 properties already hold — 2026-09-26

Checks upstream #1276 (`completionDelivery.ts`: bind completion to the
originating message/run, wait for durable output settlement, re-read durable
state every pass, no replay after uncertain outcomes) against CEDIA's turn
machinery. No product code changed; no gap change (stays **2**:
`switchSession`, `browser-relay`). §10 item 70 owns status. No provider
involvement.

## Mapping (source-verified, current tree)

- Originating-submission ownership: every `prompt`/`abort_and_prompt`/
  `follow_up` claims a durable turn intent (store schema 4/5) before
  dispatch, travels as `cediaIntentId`, and OMP names it on all four
  boundaries (`agent_start`/`turn_start`/`turn_end`/`agent_end`) — the
  result is attributed to the submission that started the run, never to
  whatever is latest at poll time. The session's queue snapshot is read in
  OMP's own order.
- Durable settlement before reading: the session projection only ever says
  what OMP proved (`prepared` → `queued` on transport ack → `running` from
  turn boundaries → `completed` with its event sequence), and per-turn
  model attribution is recorded from OMP's report, not the session's
  current model.
- No replay after uncertainty: recovery pauses `needs_continue` /
  `outcome_unknown` intents instead of replaying them; `steer` claims no
  intent (input to the running turn, not a second delivery).
- Goal semantics stay out of delivery: goal continuation is opt-in
  (`goal.continuationModes` default runs nothing on its own), matching the
  reference's explicit rejection of goal-completion semantics.

## Proof

- `bun test apps/host/test/service.test.ts -t "turn"`: 8 pass, 0 fail
  (111 expects) — projection never past evidence, unreached turns paused
  not replayed, second turn refused behind a running one, this turn.
- `git diff --check`: clean.

## Preserved

- D1–D5, deferred voice, `switchSession` open, single OMP
  execution/transcript/auth owner. Pin unchanged. Nothing committed;
  uncommitted tree preserved.
