# Remote owns its enrollment: the owner mints a code, the packaged Mac redeems it — 2026-09-24

This receipt records the missing owner half of §6.5's pairing flow. Before this slice nothing in
Cedia could issue an enrollment code — `EnrollmentStore.issue` existed and the gateway could
redeem one, but no route or screen reached it — so the selected transport could be described but
never actually paired. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Packaged build at that revision: patch set `086d31f75d36` (18 patches), upstream
  `ea1912fd6a05b80a56b2ad9b955075211deea521`.
- `apps/host/src/server.ts`, `apps/host/src/router.ts`, `apps/host/test/remote-gateway.test.ts`,
  `apps/macos/agent-window/src/cedia-adapter.ts`,
  `vendor/synara/apps/web/src/components/settings/RemoteDevicesPanel.tsx` (new),
  `vendor/synara/apps/web/src/lib/remoteDevicesReactQuery.ts` (new),
  `vendor/synara/apps/web/src/settingsNavigation.ts`,
  `vendor/synara/apps/web/src/settingsSearchIndex.ts`,
  `vendor/synara/apps/web/src/routes/_chat.settings.tsx`,
  `apps/macos/agent-window/test/remote-devices-adapter.test.ts` (new).

## What changed

- **The host issues the code.** `extras.issueRemoteEnrollment` is assigned only when the gateway
  actually started, and `POST /v1/remote/enrollment` (owner-only) mints one code into that same
  store, so the code the owner reads is exactly the code the gateway can redeem. A build with no
  packaged client answers `503 remote_unavailable` with the reason instead of minting a code
  nothing can accept. `GET /v1/remote/gateway` reports `available` with the loopback URL, or
  `unavailable` with the reason. The relay branch was folded into one `remote` namespace with two
  distinct subjects rather than shadowing each other.
- **Settings has a Remote destination** in the General group (§6.4 "device enrollment in General >
  Remote"): the gateway address and what to point Tailscale Serve at, a device-name field and a
  `Create code` action, the code and pin shown once with the expiry, and the paired devices with a
  single `Revoke` action. The panel never stores a credential and says plainly that Cedia does not
  keep the code.
- **The adapter carries four thin host requests** — gateway state, issue, list, revoke — and the
  renderer's bridge reports a missing method instead of an empty list, so an older host cannot look
  like a Mac with no paired devices.

## Verification, on the packaged application

```
bun run build:agent
CEDIA_HOST_NODE=<Node v24.18.0> bun run package:mac        # 18 patches, ad-hoc signed
bun run check:packaged                                     # every check OK
bun scripts/verify-packaged-cedia.ts                       # 7/7 checks incl. bundled-remote-web-client
bun scripts/launch-cedia-personal.ts
  host log: "Cedia remote gateway on http://127.0.0.1:51105"
  GET  /v1/remote/gateway   -> 200 {"state":"available","url":"http://127.0.0.1:51105"}
  POST /v1/remote/enrollment-> 200 {code, pin, expiresAt}
  GET  /                      -> 200 text/html            (the packaged remote client)
  GET  /_expo/static/js/web/index-ead8188ef34826d7f60d959d4273f599.js
                              -> 200 text/javascript, 1,430,200 bytes
  GET  /tasks/packaged        -> 200 text/html            (SPA deep link)
  GET  /v1/sessions (anon)    -> 401 unauthorized
  GET  / with Host: evil.example -> 403
  POST http://127.0.0.1:51105/gateway/enroll (browser) -> 200, two Set-Cookie
  same code again                                      -> 409 already redeemed
  POST /gateway/enroll {client:"native"}               -> 200 {device, token}
  GET  /v1/sessions with that Bearer token             -> 200
  Quit                                                 -> lifecycle.json phase "stopped", no app or host process
bun test apps/host                                         # 257 pass, 0 fail
bun test apps/macos/agent-window/test                      # 167 pass, 0 fail
bun run --cwd apps/macos/agent-window typecheck            # clean
bun run typecheck                                          # the same 10 pre-existing errors
node scripts/ci-validate.mjs                               # CI-OK
```

The loopback fetches were made from this Mac; the packaged gateway accepted a real enrollment and
handed the browser two cookies and the native client a token.

## Not done here

- The Remote panel is built and bundled, but no packaged *screen* was captured showing it; the
  proof here is the route, the adapter test and the bundled build.
- `CEDIA_REMOTE_HOSTS` is still an environment value: a Cedia control that writes the tailnet
  hostname is not built, so the owner sets it once for the app process.
- No Tailscale Serve configuration, tailnet device or off-LAN request was exercised. That remains
  W's actual acceptance and needs the owner's Tailscale setup.
