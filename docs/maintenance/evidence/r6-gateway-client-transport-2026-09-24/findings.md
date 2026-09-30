# The remote clients pair and call the Mac through the selected transport — 2026-09-24

This receipt records the client half of §6.5's remote path, and the one host change it required:
the gateway now serves a browser and a native client as the two different principals they are, and
`apps/ios` pairs and calls through the selected Tailscale endpoint instead of the Paseo relay.
§10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- `apps/ios/src/core/gateway.ts` (new), `apps/ios/src/core/pairing.ts`, `apps/ios/App.tsx`,
  `apps/ios/src/core/api.ts`, `apps/ios/src/__tests__/gateway.test.ts`,
  `packages/relay/src/index.ts`, `apps/host/src/remote-gateway.ts` and its test.

## The two principals

A browser and a native app cannot share one answer, so the gateway now separates them:

- **Browser** — `POST /gateway/enroll` with no `client` field answers two `Set-Cookie` headers
  (`cedia_session`, HttpOnly; `cedia_csrf`) and never puts the credential in the body. Proxied
  requests authenticate from the cookie and a mutation must carry `X-Cedia-CSRF`, because a cookie
  is sent automatically.
- **Native** — `POST /gateway/enroll` with `{ client: "native" }` answers `{ device, token }` in the
  body and sets no cookie, because React Native does not expose `Set-Cookie` to JavaScript. A
  request carrying `Origin` is refused with `origin_forbidden`, so the JSON answer can never be
  handed to a web page — including the packaged web client itself, which is same-origin and does
  send `Origin` on a POST. Proxied requests then authenticate from
  `Authorization: Bearer <controller token>` and need no CSRF token, because nothing ambient is
  sent and a cross-origin browser cannot set that header without a preflight this gateway refuses.
- **Both paths are controller-only.** The Mac's owner credential is refused at the gateway whether
  it arrives as a cookie or as a Bearer token, which keeps the owner API loopback-only (§6.5).

On the client, `pairing.ts` gained a versioned transport discriminator: a legacy Paseo relay offer
still parses, is preserved, and is reported as inert — reading or importing one never opens or arms
the relay. The Tailscale offer names an explicit HTTPS origin with no credential in a URL path,
query or userinfo, the transport actually in use is what the pairing label shows, and the native
token lives in the existing `PairingSecretStore` seam.

## Verification

```
bun run test:mobile                                   # 172 pass, 0 fail (813 expects)
bun run --cwd apps/ios typecheck                      # clean
bun run --cwd apps/ios export:web                     # the packaged client still exports
bun test apps/host/test/remote-gateway.test.ts        # 5 pass, 0 fail
bun test apps/host                                    # 255 pass, 0 fail
git diff --check                                      # clean
```

The gateway fixture covers the whole boundary rather than the happy path: a browser asking for the
native answer is refused, a native enrollment returns a token and no cookies, a Bearer mutation
reaches `/v1` with no CSRF token, a wrong Bearer token is 401, the owner token is refused at the
gateway, and the existing cookie-session and revocation cases still pass.

## Not done here

- No Tailscale Serve configuration, tailnet hostname, paired tailnet device or off-LAN request was
  exercised. That is W's actual acceptance and it needs the owner's Tailscale setup; until then the
  remote path is proven between a loopback client and this Mac only.
- No native iOS build, signing or physical-device pairing was done (that is N, and it needs the
  device and signing prerequisites).
- The gateway reads its extra tailnet `Host` values from `CEDIA_REMOTE_HOSTS`; a Cedia settings
  surface that writes them is not built, so the owner sets that once for the app process.
