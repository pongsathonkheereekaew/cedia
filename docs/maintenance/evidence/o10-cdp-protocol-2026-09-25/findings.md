# Slice (O10 browser-level CDP: puppeteer-real wire compat, no gap change)

Extends `o10-tab-endpoint-2026-09-25` from per-tab sockets to the full two-level CDP
a real client speaks, proven against the exact puppeteer-core OMP ships (25.3.0) —
not a mock of it. No Electron, no user browser, no provider involved.

## What was built (`apps/macos/src/cdp-tab-endpoint.ts`)

- Browser-level socket (`/`): `Target.getTargets`, `attachToTarget`/`detachFromTarget`,
  `sendMessageToTarget` (fire-and-forget answer + flattened `receivedMessageFromTarget`
  reply), `setDiscoverTargets` with live `targetCreated`/`targetDestroyed`,
  `Target.getBrowserContexts`, `Browser.getVersion`, flattened session messages routed
  by inline `sessionId` and answered inline, debugger-detach fan-out with
  `Target.detachedFromTarget`, default execution-context announcement per session.
- Refusals with reasons: `createTarget`/`closeTarget` (Cedia owns tab lifecycle),
  unknown tabs/sessions (4404/unknown-session), malformed frames (4400).
- `/json/version` carries the browser `webSocketDebuggerUrl` (without it
  `puppeteer.connect` cannot start — found by failing).

## Behavior verified against real Chrome where it mattered

Three endpoint bugs were found by real-client traffic, not by reading: browser
sessions never subscribed to debugger events (fan-out dead until attach subscribed
them); explicit `attachToTarget` answered without the `attachedToTarget` event
puppeteer builds sessions from; the event must precede the answer or the client's
session lookup races. A fourth (test-only) race — listeners attached after attach —
was fixed in the test to match real client setup order.

## Proof

- `scripts/omp-cdp-endpoint-smoke.ts` green with upstream puppeteer-core: loopback
  bind, discovery (1 page target), page open, evaluate round-trip, navigate through an
  explicit session. Fixture answers init chatter + utility-world + navigation
  lifecycle; lifecycle *waiting* (load/domcontentloaded) is puppeteer page-model
  behavior the fixture scopes out, documented in the script.
- Endpoint fixture suites 6 pass (including the new browser-level paths); macos 766
  untouched areas green; root + upstream typechecks clean for this slice's files.
- No gap change by design: still no OMP browser action through a handle, so the
  `browser-relay` CLI row stays open. Remaining: Electron debugger behind the seam,
  thread-switch clearing (separate slice), packaged proof against a visible tab.

## Addendum: self-review fixes (same verification bar)

A line-by-line re-read found two Chrome-parity gaps, both fixed with tests:

- Explicit `Target.detachFromTarget` never emitted `Target.detachedFromTarget`,
  leaving stale rows in clients (the debugger-detach path already emitted it).
  Now emitted; new test asserts the event plus `attached: false` on re-list.
- The announced execution context carried a fictional `frameId: "F1"`. The endpoint
  now reads the real main frame id via `Page.getFrameTree` at attach time (fallback
  `"F1"` when unreadable); the fixture answers a real id and the test pins it
  flowing into `auxData`.

Verified: endpoint suites 7 pass, upstream puppeteer-core smoke green
(discover/open/evaluate/navigate), browser-service 10 pass, root `tsc` exit 0.
