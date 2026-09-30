# O10 relay live connect (user-installed headed extension) — 2026-09-26

Live qualification of the `browser-relay` path against the pinned runtime, using the
user-approved headed install from today. No provider, no model, no spend, no profile change.
Loopback only. Daemon stopped after the probe. §10 item 70 owns status.

## Done

- `dist/omp/omp config get browser.relay` → `true` (set during the approved install slice).
- Started `dist/omp/omp browser-relay -p 9224 --verbose` on loopback; log:
  `relay listening port 9224`, `extension endpoint ws://127.0.0.1:9224/ext`.
- The already-installed headed extension connected live:
  `[relay] extension connected {"tabs":5,"version":"Chrome/153.0.0.0"}`,
  `Extension connected. The omp browser prelude can now drive your tabs.`
- `curl http://127.0.0.1:9224/json/version` answered a real browser descriptor
  (`Browser Chrome/153.0.0.0`, `Protocol-Version 1.3`, `webSocketDebuggerUrl ws://127.0.0.1:9224/cdp`)
  instead of the headless `503 not connected` absence.
- Daemon killed after the probe; `ps` shows no relay running. User profile untouched
  beyond the previously approved unpacked extension.

## Still open (no gap change by design, stays 2)

- Driving a user tab through the relay from an OMP prelude turn (scoped attach,
  cross-task denial, packaged proof) is still the O10 bridge work the install receipt
  names. This probe proves connect + descriptor only, so the `browser-relay` CLI row
  stays `integration_missing`; only the owner can reclassify it to excluded or accept
  this as full relay-path qualification.
- `switchSession` untouched.

## Preserved

- D1–D5, deferred voice, W/N deferred per owner. Nothing committed.
