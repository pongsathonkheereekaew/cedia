# R3 crash boundary proof (SIGKILL mid-turn, no replay) — 2026-09-26

Live proof of the §2.4 crash boundary: a real turn running against the pinned runtime is
killed with SIGKILL, and the host must notice, name the unknown, refuse automatic recovery,
and come back only through reconcile. Loopback model endpoint, zero provider involvement,
zero spend, scratch state only. §10 item 70 owns status.

## Done

- New `scripts/omp-crash-proof.ts` (registered as `bun run smoke:crash`): boots a real host
  + pinned `omp/18.1.18`, dispatches one adapter turn against a never-answering loopback
  endpoint (1 hit, genuinely running), then SIGKILLs the runtime child — selected as a
  direct child of the script whose command carries `--mode rpc-ui` (the prepared launcher
  re-execs, so its own path does not survive; `ps` needs `-ax` here since the driver has
  no controlling terminal — both traps are commented in the script).
- Proves, in order: running → `outcome_unknown` with reason `OMP process exited …`
  (live, via the client's close detection, not only at restart); task
  `recovery_required`; exactly one prompt ever reached OMP; `POST …/start` refused 409
  `recovery_required` (nothing auto-restarts, nothing replays); explicit
  `acknowledgeUnknown` → reconcile → stopped → restart → second turn runs (2nd loopback
  hit) → abort settles `cancelled`. Final `{"ok": true}`.

## Verified

- `bun run smoke:crash`: green, 2 loopback hits, 0 external requests. First run caught two
  real harness bugs (bridge shape, ps visibility); the ack requirement surfaced the
  designed `acknowledgement_required` gate, which the driver now satisfies explicitly.

## Still open (no gap change, stays 2)

- Crash at *every* boundary (prepared/queued intents live, not only running) is covered by
  fixture tests plus this running-turn proof; a live prepared-turn kill is not separately
  staged. `switchSession`/`browser-relay` untouched.

## Preserved

- D1–D5, deferred voice, W/N deferred per owner. Nothing committed.
