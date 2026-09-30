# iOS source and web-export check — 2026-09-28

## Verification

- `bun run test` in `apps/ios` — **172 passed, 0 failed; 813 expectations across 24 files**.
- `bun run typecheck` in `apps/ios` — **passed**.
- Expo static export — `./node_modules/.bin/expo export --platform web --output-dir /tmp/cedia-ios-web-export.LVdWMB` from `apps/ios` — **passed**. The export produced `index.html`, `metadata.json`, and three JavaScript bundles. The main web bundle SHA-256 is `a07957bc3d5b32676049926b3b783259dd0a8a1464f2994f5192dca6a97eb285`; `index.html` SHA-256 is `995692c41dac2fd72ea45434d663598c03f6f560da3527d09a176a894c4158d4`.

The export went to a new temporary directory. The existing `apps/ios/dist` tree and source files were not regenerated or overwritten. Expo emitted only `NO_COLOR`/`FORCE_COLOR` environment warnings while Metro bundled the app.

## Limits

This verifies the iOS source tests, TypeScript, and a static web artifact. It does not verify the packaged host's web serving, enrollment/authentication, off-LAN behavior, remote continuity, or a physical iPhone. W and N remain open; this does not close F acceptance.
