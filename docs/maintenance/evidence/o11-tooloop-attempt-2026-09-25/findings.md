# Attempt (O11 tool+permission loop headless: not proven, model went silent)

Tried to close the §10-item-1 pipeline half (tool call + permission prompt through
host routes) with the zero-cost native model (`union-alpha`, existing file-based API
key — no purchase, no signup, no Keychain). Result is negative, recorded exactly.

## What was built and verified

- Loop mechanics exist and answer: `GET .../ui` (pending), `POST .../ui` (respond),
  turn abort via commands `abort` — all exercised live, all answer honestly.
- Safety harness in the attempt: read-only tool ask confined to scratch, approve
  only confined reads, refuse anything else, 240 s budget with abort, no retries
  into spend. No spend occurred anywhere (zero completions → zero tokens).

## What happened (5 free turns total today)

1. Native park+revive proof: worker completed, parked, revived — model answering.
2. Three tool-seeking turns: 220 s+ each, transcript EMPTY the whole time
   (`frames=[]` sampled every ~20 s), `/ui` always empty, then abort per design.
3. One plain no-tool turn: same — zero frames in 120 s. (An early "answered" reading
   was a sloppy substring matcher; corrected method shows timeout honestly.)

## Reading

The free tier answered 40 minutes earlier and now answers nothing at all, including
plain turns — a model-side stall (degradation or rate limit; five of today's turns
are mine, so the limit may be self-inflicted) rather than a pipeline break: the same
pipeline completes fixture turns in milliseconds and completed the native worker turn
earlier. Not distinguishable further without burning more quota, so stopped.

## Needed to actually close the loop

A model that answers tool-seeking turns when tried (paid model only with explicit
user consent for the spend, or the free tier after recovery), or the on-screen
composer path once the render break (`window-transcript-render-2026-09-25`) is
reconciled. The failing scratch smoke was deleted, not kept red; this note is the
record. No gap change.

## Addendum: root cause identified from runtime logs (no further probes needed)

The silence is neither rate-limit nor dead keys. The personal runtime log
(`~/.omp/logs`, pid 42255, 20:19 local) shows the turn failing three times ~8 s
apart with `400 {"type":"error","error":{"type":"api_error","message":"Upstream
request failed: Model is unavailable."}}` on `opencode-zen/union-alpha` — the
runtime's own retries, all identical. Auth passed (a dead key fails fast with
401/403, and the native proof turn completed on these same keys earlier); the
provider's upstream simply has no union-alpha capacity right now. The earlier
"rate-limit" guess in this receipt is superseded by this: do not re-probe blindly.
The `/models` 403s on all three providers are a separate, consistent signal (listing
forbidden; turn path unaffected when the model exists). The lone 401 belongs to the
opencode-go *usage* endpoint only, not to turns.

What unblocks, in order: (1) union-alpha availability returning on its own — worth
exactly one plain-turn probe in a later turn, not a loop; (2) explicit user consent
for a paid-model turn (out of current scope); (3) the on-screen composer path once
the render break reconciles. Zero spend throughout (failures carry no tokens).

## Addendum: outage predates this thread's probes

An older runtime log (`omp.2026-09-25.41812.log`, from 20:13) already shows 11
provider-error turn endings on `union-alpha` — before this thread's first
tool-seeking attempt. The unavailability is provider-side and independent of this
thread's quota usage; the earlier self-inflicted rate-limit hypothesis is withdrawn.
