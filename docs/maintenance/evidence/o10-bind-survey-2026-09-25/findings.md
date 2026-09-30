# Survey (O10 real bridge: the bind point is `browser.cdpUrl` + per-call `app.cdp_url`)

The runtime bind half of §8.2 O10 now has a named design instead of a vague "bridge".
All source facts below are read from the pinned OMP tree, no code changed in this slice.

## How OMP browser actions address a browser (source)

- `tools/browser/registry.ts` acquires a `BrowserHandle` by `BrowserKind`: `headless`,
  `spawned`, `connected` (puppeteer-core over a CDP URL), `relay` (extension), `cmux`.
- Schema `browser.cdpUrl` (settings-schema.ts:4634): "Default HTTP CDP discovery endpoint
  (for example http://127.0.0.1:9222) to attach to instead of launching a browser.
  Explicit app.cdp_url or app.path on the tool call take precedence." — i.e. OMP
  browser tool calls accept a per-call CDP endpoint. That is the bind seam: no relay,
  no extension, no user Chrome involved when Cedia supplies the endpoint.
- `attach.ts` speaks plain CDP discovery over loopback TCP (with proxy-env pitfalls
  already handled upstream there).

## The Cedia-side design this implies (next slice, not this one)

1. Cedia serves a per-task loopback CDP discovery endpoint (`/json`) backed ONLY by
   tabs carrying a live `OmpBrowserTabs` handle (built + tested in
   `o10-tab-handles-2026-09-25`): attached agent tabs and nothing else — never user
   tabs, never other windows, never other tasks (cross-task handles are already
   refused at the registry).
2. OMP browser tool calls name that endpoint per call (`app.cdp_url`) or via the
   session `browser.cdpUrl`; the endpoint dies with the task (handle invalidation on
   task end already exists).
3. The endpoint needs a CDP↔WebContents shim in the macOS host (per-tab Electron
   debugger sessions). Explicitly rejected: `--remote-debugging-port` on the app —
   app-wide exposure contradicts the owner/device boundaries; the shim serves attached
   tabs only.

## Security boundaries preserved

Loopback-only, ephemeral per task, attached-tabs-only; no user-profile reads, no
extension installs, no credentials, no provider spend. Packaged proof against a visible
tab and the runtime patch op that registers the endpoint remain the acceptance.
`browser-relay` CLI row stays open: the relay path is unselected while Cedia-owned tabs
are the plan's browser owner (§8.2 O10).
