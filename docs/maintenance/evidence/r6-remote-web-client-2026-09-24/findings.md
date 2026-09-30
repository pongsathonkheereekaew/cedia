# The packaged remote web client reaches the gateway — 2026-09-24

This receipt records the server half of §6.5's remote path: the existing `apps/ios` Expo export
is staged into the packaged runtime and the bundled host resolves it at startup, so a packaged
Cedia serves the remote client instead of answering `web_client_missing`. §10 item 70 owns
status; the client half (pairing, cookie/CSRF transport, tailnet endpoint) is a separate slice.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- `apps/host/src/remote-web-assets.ts`,
  `apps/host/test/remote-web-assets.test.ts`, `apps/host/test/remote-gateway.test.ts`,
  `apps/host/src/cli.ts`, `scripts/build-cedia.ts`, `scripts/verify-packaged-cedia.ts`.

## What changed

- The host owns one decision about the remote client (`remote-web-assets.ts`): which directory is
  the packaged client, and which extra `Host` values Tailscale Serve is expected to send. A
  directory counts as a client only when it really holds the document the gateway serves at `/`,
  and `CEDIA_REMOTE_WEB_ROOT` must be an absolute path to one. `CEDIA_REMOTE_HOSTS` is read as a
  hostname list; a URL, a scheme or a path is a configuration error rather than a value the
  gateway silently ignores, because such a value would match no forwarded `Host`.
- The bundled host resolves `runtime/remote-web` beside `host/` at startup and passes it to
  `startHostServer` as `remoteWebRoot`, with the configured tailnet names as
  `remoteGatewayHosts`. A build with no export starts no gateway at all, which is the honest
  state; it never serves an empty document. When the gateway does start, the host writes its
  loopback URL and what to point Tailscale Serve at to the private host log.
- `scripts/build-cedia.ts` stages `apps/ios/dist` to `dist/remote-web` and, for a packaged build,
  copies it to `runtime/remote-web`. The export stays a separate deliberate command: a build
  without one fails by name and prints the exact command, because a silent empty client is the
  failure this step exists to prevent.
- `scripts/verify-packaged-cedia.ts` now refuses a packaged app whose
  `extensions/cedia/runtime/remote-web/index.html` is missing or empty, and records its hash in
  the packaged receipt. The check is `bundled-remote-web-client`.

## Verification

The gateway was run against the real export, not a fixture, with the real host server:

```
bun run --cwd apps/ios export:web                 # 3 web bundles, index.html, metadata.json
GET /                       -> 200 text/html       (the exported document)
GET /_expo/static/js/web/index-0fc7638b7e66e787d39a7efe33bc750b.js
                            -> 200 text/javascript, 1,416,280 bytes
GET /tasks/abc              -> 200 text/html       (SPA deep link -> the one document)
GET /v1/not-a-route         -> 401 unauthorized    (the API namespace never answers HTML)
GET /assets/missing.js      -> 404 asset_missing
Host: evil.example          -> 403 host_forbidden

bun test apps/host/test/remote-web-assets.test.ts  # 5 pass, 0 fail
bun test apps/host                                 # 255 pass, 0 fail
bun run typecheck                                  # 10 errors, all pre-existing and unrelated
git diff --check                                   # clean
```

The export's own document now carries the Cedia title rather than the earlier branded one; that
is a build artefact of this slice, not a branding audit.

## Also fixed here

`apps/host/test/remote-gateway.test.ts` had two fixture defects that made its first case fail
for the wrong reason: the enrollment helper carried only the session cookie while a browser
sends both cookies, and the case asserted the owner token would be *routed* at the gateway. Both
now describe the real contract — the CSRF cookie travels with the session cookie, and the Mac's
owner token is refused at the gateway rather than proxied.

## Not done here

- The client does not yet pair or call the host through the gateway: relay-only offer parsing,
  the versioned transport discriminator, same-origin cookie/CSRF auth in the web runtime and the
  native tailnet token are the separate R6 client slice.
- No packaged `.app` was rebuilt or launched for this change, so the packaged remote-web asset is
  verified by the build step and the structural check, not yet by a packaged run.
- No Tailscale Serve configuration, tailnet device or off-LAN access was exercised; W's
  acceptance requires that receipt and it needs the owner's Tailscale setup.
