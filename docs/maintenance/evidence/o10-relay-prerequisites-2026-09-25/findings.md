# Survey (O10 browser-relay: machine-side halves proven, prerequisites named)

The `browser-relay` CLI row stays open (OMP browser integration is O10 work), but it is
no longer vague. Both machine-side halves were proven against the pinned runtime
`omp/18.1.18` without touching the user's Chrome profile, `~/.omp`, or any service:

## Proven live (this machine, 2026-09-25)

- `omp browser-relay install --dir <tmp>` writes the extension bundle
  (`background.js`, `manifest.json`, `options.html`, `options.js`, `LICENSE`,
  `THIRD-PARTY-NOTICES.txt`) to any directory and prints the exact Chrome-side steps.
- `omp browser-relay -p 19331` binds loopback only and reports the extension endpoint
  (`ws://127.0.0.1:19331/ext`), then waits for the extension. Port probed open while
  serving, closed after stop. No extension connected, no tab driven, no Chrome launched.

## Exact prerequisites for a future O10 slice

1. The user loads the unpacked extension in their Chrome with Developer mode on
   (a deliberate user action in their own browser; Cedia must never do this silently).
2. `browser.relay true` (+ optional `browser.relayUrl`) set in OMP config — the runtime
   then starts the relay automatically when the browser prelude needs it.
3. The O10 scoped tab-attachment bridge itself (§8.2 O10: task-scoped tab handle,
   cross-task denial, consent routing, packaged proof against a visible tab) — Cedia-side
   implementation work (tab registry, permission/task-isolation contract, fixture
   verification), NOT an external prerequisite; only the packaged-vs-real-browser proof
   waits on a browser. `Google Chrome.app` is present on this Mac, so the eventual proof
   has a browser to point at. Correction 2026-09-25: an earlier heading of this receipt
   mislabelled all three items as outside code; item 3 is implementation work and is
   corrected here.

No gap change by design: there is still no Cedia carrier for the relay, and driving a
real tab needs the O10 bridge plus the user's own extension install. Chrome was not
launched and no browsing happened in this survey.

## Addendum: headless qualification proven impossible (branded-Chrome refusal)

`scripts/omp-relay-smoke.ts` now proves the full prerequisite chain green, including
the boundary itself: install to throwaway dir ok, daemon serves loopback with honest
503 absence, and branded Google Chrome refuses `--load-extension` in its own log
words — so no headless flow on this machine can complete the handshake, and the relay
waiting afterwards is the expected boundary, not a failure. Qualifying the relay path
therefore requires exactly one thing no agent can do: the user's manual unpacked
install in a headed browser. Nothing here touches the user's Chrome, profile, or
extensions; no model, provider, or spend involved.
