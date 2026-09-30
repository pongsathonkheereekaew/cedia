# O10 packaged browser tab title — 2026-09-27

The packaged browser proof from 2026-09-26 found that the tab row and scoped
`/json/list` kept the URL fallback title after the fixture page's DOM title had
loaded. This slice fixes that display metadata; it does not close the separate
`browser-relay` coverage row or prove a model-driven browser turn. §10 item 70
owns the remaining work.

## Cause and change

`page-title-updated` set the real title, then `did-stop-loading` overwrote it
with `titleForUrl(url)`. The stop handler now reads the live WebContents title
when present, trims and bounds it, and retains the navigation fallback when
the page still reports `New tab` or no usable title. Tab IDs, URLs, attachment
scope and authorization did not change.

## Verification on this checkout

- Source: `main` at `0676dd70d54` with the existing dirty working tree preserved.
- Regression test red before the fix: expected `Fixture article`, received
  `example.com` after `did-stop-loading`. It passes after the fix; the browser
  test file reports 11 pass, 0 fail.
- The extended `smoke:browser-packaged` was red on the previous package:
  DOM title `Cedia Browser Proof`, row title `127.0.0.1`.
- `CEDIA_HOST_NODE=/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node bun run package:mac`
  rebuilt and ad-hoc signed the local app. `check:packaged` passed the 18-patch
  stamp and asset checks (packaged at `2026-09-27T03:55:26.505Z`).
- `bun run smoke:browser-packaged` passed on that package: DOM, row and
  `/json/list` all reported `Cedia Browser Proof`; the same run drove the
  loopback fixture, verified cross-task denial and teardown, and recorded zero
  host commands/provider calls in `dist/packaged-browser-proof/result.json`.
- `bun run typecheck` and `bun run check:repo` passed. A separate
  `bun run --cwd apps/macos typecheck` reports seven `Window.nativeApi`
  errors in untouched vendored `nativeApi.ts`; none names this slice.

No user Chrome profile, provider, device, tailnet, or Keychain was used.
