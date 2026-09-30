# Tier re-probe: union-alpha still unavailable — 2026-09-26

Re-probes the o11 block (free-tier silence) with a minimal plain no-tool
turn: switch to `union-alpha` + `reply with exactly the single word pong`,
120 s budget, abort on timeout, scratch probe deleted after the run. No gap
change. No spend (zero completions). §10 item 70 owns status.

## Result (negative, with new precise data)

- Switch turn completes (200/200, model switch works, runtime alive).
- Prompt turn: `queued` at 110 s with zero assistant text (transcript tail
  ends at `## Assistant`), aborted per design → `needs_continue` — the
  honest-unknown path working as specified, not a pipeline break.
- Runtime log (`~/.omp/logs`, this run's pid, 03:13 local): the turn fails
  with `400 {"type":"error","error":{"type":"api_error","message":"Upstream
  request failed: Model is unavailable."}}` on `opencode-zen/union-alpha`,
  retries identical — same signature as o11's addendum. Auth passes.
- Side-evidence: live turn-model attribution works — the running turn
  projected `model: opencode-zen/union-alpha` (the model actually attempted,
  not the session default).

## Reading

Tier NOT recovered. The approval/tool-loop proof stays blocked on an
answering model (paid only with explicit user consent, tier recovery, or
the on-screen composer path). Pipeline innocence re-confirmed: intent
claimed before dispatch, transcript written, abort honest, no retries into
spend, no provider calls billed.

## Preserved

- D1–D5, `switchSession` open, single OMP owner, OMP-native auth only.
  Nothing committed; scratch probe deleted; uncommitted tree preserved
  (`git diff --check` clean).

## Addendum: second re-probe, still down (2026-09-26 ~04:14)

Same minimal probe (switch + plain no-tool turn, 120 s, abort on timeout,
scratch deleted): switch 200, prompt turn `queued` at deadline with zero
assistant text, aborted to `needs_continue`. Fresh runtime-log 400
`Model is unavailable` on `opencode-zen/union-alpha` (this run's pid).
Zero spend. Approval/tool loop stays blocked; no new table row — repeat
negative.

## Addendum: third probe, still down (2026-09-26 ~05:13)

Same minimal probe ~1 h later: switch 200, prompt turn `queued` at deadline
with zero assistant text, aborted to `needs_continue`. Fresh runtime-log 400
`Model is unavailable` on `opencode-zen/union-alpha` (this run's pid).
Zero spend. Tier down ~2 h and counting; approval/tool loop stays blocked.
