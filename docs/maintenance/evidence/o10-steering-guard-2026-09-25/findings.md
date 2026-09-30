# Slice (O10 steering guard: at most one visible thread drivable)

Closes the cross-task hole named in `o10-tab-endpoint-2026-09-25`: `browser.cdpUrl` is
global while endpoints are per-thread, so switching threads used to leave steering
pointed at the old thread — whose background turns could then drive the wrong tabs.

## What was built

- `BrowserSteeringGuard` (renders nothing), mounted in the thread route for both the
  single and split surfaces: on every route-thread change it reconciles steering via
  the testable `reconcileBrowserSteering` helper — split view always clears (no
  unambiguous driver); otherwise a live endpoint re-steers, and a thread with nothing
  attached clears. Bridge/settings failures resolve to "untouched", never breaking
  route mounting.
- 5 renderer tests green (re-steer, clear, split-clear without endpoint read, endpoint
  failure untouched, null render).

## Verification

- New suites green; vendor typecheck shows no error in this slice's files (the one
  remaining vendor error sits in another thread's untracked in-flight file, untouched).
- No gap change by design: still no OMP browser action through a handle, so the
  `browser-relay` CLI row stays open. Enforcement is structural from here: attach opens
  the endpoint and steers, detach-all/tab-close/thread-end closes and clears, and now
  thread switches reconcile — a stale URL cannot survive any of the four transitions.

## Addendum: guard respects backend selection

The route guard steered onto any live endpoint — including when relay precedence or
a disabled prelude made steering void. It now reads both settings alongside the
endpoint: relay-on or tools-disabled clears instead of steering pointlessly, and an
unreadable selection keeps the old steer behavior. 3 tests added (8 in the file).
No host/runtime change, no gap change.
