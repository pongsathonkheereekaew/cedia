# O10 relay headless smoke port fix (live extension owns 9224) — 2026-09-26

Fixes a real staleness the user install created: `scripts/omp-relay-smoke.ts` probed
absence on the default port 9224, which the user's now-installed live headed extension
also watches — the extension won the race and the expected 503 read as 200. No provider,
no spend, no profile touched. §10 item 70 owns status.

## Done

- The smoke now probes an unclaimed port (9333) with the reason in a comment; boundary
  assertions unchanged. `bun scripts/omp-relay-smoke.ts` → `{"ok": true}` again.
- Relay live-connect re-proven against the rebuilt runtime in the same turn (headed
  extension connected, 5 tabs, real CDP descriptor on 9224; daemon stopped after).

## Still open (no gap change, stays 2)

- Prelude-driven tab control through the relay (scoped attach + packaged proof).
  `switchSession` untouched.

## Preserved

- D1–D5, deferred voice, W/N deferred per owner. Nothing committed.
