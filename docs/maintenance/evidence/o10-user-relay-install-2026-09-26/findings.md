# O10 user relay install (headed Chrome, computer-use) — 2026-09-26

User-approved headed install via `@oai/sky` computer-use (no silent install).
No profile touched except the approved unpacked extension.

## Done

- `omp browser-relay install --dir /tmp/relay-ext` bundle written
  (`background.js`, `manifest.json`, `options.html`, `options.js`).
- Chrome `chrome://extensions` → Developer mode ON → Load unpacked →
  `/tmp/relay-ext` → OMP Browser Relay 0.1.0 ID `jegkahlpddddmekihnipekbjekjidmpb`
  toggle ON (Value 1), verified via accessibility tree.
- `omp config set browser.relay true` (was false, now true).
- Expected waiting state: extension logs one
  `ws://127.0.0.1:9224/ext ERR_CONNECTION_REFUSED` until OMP starts the
  relay on prelude demand. Not a failure; retry/backoff path.

## Still open (not external)

Scoped tab-attachment bridge build + packaged proof (§8.2 O10).
User prerequisites (unpacked install + `browser.relay` config) now met.

## Preserved

- Paid approval recorded separately (user consent 2026-09-26, minimal
  approval/tool-loop probe only). W/N deferred per owner (test later).
- D1–D5, `switchSession` open. Nothing committed.
