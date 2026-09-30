# Proof (O10 packaged tab driving: scoped endpoint over a visible tab) — 2026-09-26

Deterministic native bridge proof on the real packaged app — not a
model-driven tool-loop proof. No turns, no provider calls, no user Chrome, no
app-wide CDP, no Keychain, no credentials. §10 item 70 owns status.

## Build under test

- Source branch `main` at `0676dd70d54` dirty (all prior uncommitted slices
  preserved, nothing committed), including the transcript-stack-bound fix.
- Packaged `Cedia.app` from `bun run package:mac` 2026-09-25T16:54:33Z, stamp
  `086d31f75d36` (18 desktop patches), agent-window assets `76f1dd6b…`.
- OMP prepared runtime `dist/omp/omp` rev `00085d4e`, patch `8e8a74…` (attested,
  matches manifest). The runtime never boots in this run: zero host commands.
- Driver: `scripts/omp-packaged-browser-proof.ts` (`smoke:browser-packaged`),
  fixture page on loopback only, scratch profile + scratch state dir, packaged
  app adopts the script-owned host (project + session visible in sidebar,
  `packaged-window.png`).

## What was proven (30 checks, all green)

- Tab opened on the fixture URL through the real panel bridge (`open`), layout
  bounds through the real `setPanelBounds` method. Bounds are driver-supplied
  (explicit on-screen rect) standing in for the renderer layout pass — recorded,
  not hidden.
- `agentAttach` answers a **loopback-only** URL, idempotent re-attach, and the
  `/json/list` discovery (standard DevTools shape) names exactly the one tab.
- Driven with OMP's own puppeteer-core 25.3.0 through the scoped endpoint:
  page found, DOM marker read matches, marker laid out 784x37, button click
  mutates the DOM, 13042-byte PNG pixels captured.
- `agentEndpoint` names the tab while attached; detach answers not-attached,
  status empties, and the endpoint socket refuses connections afterwards.
- Cross-task denial per contract: foreign-thread attach refused (`Unknown
  browser tab`), foreign endpoint status empty, second thread's endpoint lists
  only its own tab (no id leakage either way).
- Close invalidation: a closed tab refuses `(re)attach`; endpoint tabs empty.
- `result.json`: `ok: true`, `providerCommands: 0`, `errors: []`.

## Warts and honest limits (not fixed here)

- The `/json/list` and row `title` still carry the host fallback even though
  the DOM title is correct (`page-title-updated` never updates the row for this
  navigation; commit, favicon, and DOM all prove the load). Suspect: the
  `onTitle` path in `apps/macos/src/agent-window-browser.ts`. Future slice —
  discovery here keys on the exact fixture URL instead.
- Settings steering on the packaged session and model-driven browser tool use
  are NOT proven here: steering is covered on the prepared runtime by
  `scripts/omp-browser-steer-smoke.ts`; tool use needs an answering model.
- Thread-switch auto-clearing of the endpoint is NOT built (recorded design);
  the route-mounted steering guard covers the setting, fixture-tested.
- Harness lesson: tmp profile prefixes must stay short — Electron's singleton
  socket path has a 103-char `sun_path` limit under `/var/folders` and the app
  exits code 1 instantly when it overflows (`cedia-packaged-browser-*` tripped
  it; `cedia-pb-*` works).

## Not claimed

No coverage row closes here (`browser-relay` CLI stays open: the relay
extension/backend path is a separate backend from these embedded per-thread
endpoints, and no row was reclassified). No browser/computer automation
subsystem is qualified — only the bridge plumbing in this receipt.
