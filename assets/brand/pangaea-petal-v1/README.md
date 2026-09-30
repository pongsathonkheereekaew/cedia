# Retired Cedia Pangaea Petal — v1

Superseded on September 26, 2026 by [`cedia-terminal-d-v1`](../cedia-terminal-d-v1/README.md). These assets are retained as historical source files and are no longer used by app or package configuration.

- `mark.svg` is a transparent monochrome currentColor mark; its embedded high-resolution mask preserves the approved raster geometry.
- `cedia-mark.png` and `cedia-mask.png` are the transparent source raster and alpha mask.
- `cedia-light.svg` / `cedia-dark.svg` are transparent black and white marks for light and dark UI surfaces.
- `app-light.svg` / `app-dark.svg` and matching PNGs are opaque square app-icon masters; dark inverts both background and mark.
- `app-macos.png`, `cedia.iconset/`, and `cedia.icns` provide the rounded macOS app icon and standard platform sizes. `scripts/build-cedia.ts` uses this ICNS for desktop and packaged builds.
- iOS light/dark asset-catalog entries use the matching PNG masters.

The former icon used a Pangaea-inspired silhouette segmented with broad botanical petal forms.
