# CEDIA D-terminal mark adoption — 2026-09-26

The owner approved option A from the flat final comparison board, with the former `>I` terminal
glyph centered inside. The production silhouette and glyph knockout are extracted from that exact
reference, rather than redrawn. The mark is the active CEDIA identity source in
`assets/brand/cedia-terminal-d-v1/`.

## Implemented

- `approved-reference-board.png` is the owner-approved source. `cedia-mark.png` and
  `cedia-mask.png` preserve its geometry and glyph knockout at 1024×1024.
- Light and dark UI marks and square app icons use exact black/white inversions.
- iOS app icon catalog entries, Agents-window artwork and alpha mask, macOS media mark, packaged
  Code-OSS icon, and the existing checkout's `Cedia.app` icon and Agents assets were updated from
  the same master.
- `scripts/generate-brand-icons.ts` regenerates raster exports, iconset sizes, ICNS, and app copies.
- All web, iOS, macOS, desktop, `dist`, and packaged app copies byte-match their source exports.
  App-light/app-dark outputs use inverse colors from the same embedded mask.
- Final option-A generation and `CEDIA_HOST_NODE=... bun scripts/build-cedia.ts --package`
  completed on 2026-09-26. `bun scripts/verify-packaged-cedia.ts` passed all seven structural
  checks, `codesign --verify --deep --strict` passed, and app/icon sources matched by `cmp`.
  UI launch verification was not run; `uiVerified` remains false in the packaged receipt.

## Verification

- `bun scripts/generate-brand-icons.ts` completed successfully.
- `scripts/build-agent-window.ts` completed successfully; Vite emitted only its existing large
  chunk-size advisory.
- `app-light.png`, `app-dark.png`, and `app-macos.png` report 1024×1024; the generated ICNS
  round-tripped through `iconutil`.
- iOS light/dark catalog PNGs byte-match their source exports. The packaged app's `Cedia.icns`,
  Agents mask and SVG marks byte-match the approved source exports.
- `codesign --verify --deep --strict` reports the existing `Cedia.app` valid on disk and satisfying
  its designated requirement after the resource refresh.
- Large and 32 px renders were visually reviewed; the silhouette remains solid (not a ring), and
  the equal-height `>I` pair remains distinct at the tested icon size.

No app launch, device install, or trademark clearance is claimed by this asset-level receipt.
