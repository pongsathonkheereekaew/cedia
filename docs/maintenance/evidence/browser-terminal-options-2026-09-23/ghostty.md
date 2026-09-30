# Ghostty / libghostty terminal option — 2026-09-23

Scope: assess Ghostty for the CEDIA Agent window, browser/iPhone terminal, and host
terminal state. This is a read-only source review; no Ghostty build, package install, or
renderer swap was performed. The user said “ghosttyy”; this note treats that as Ghostty.

## Verified upstream facts

- Ghostty is MIT-licensed and its repository describes the product as a native GUI plus an
  embeddable library. The current `main` identifies Ghostty as `1.3.2-dev`; the latest
  visible app tag is `v1.3.1` ([repository](https://github.com/ghostty-org/ghostty/tree/7fb75b3c508ce8dfccfe796d9bec3cba75843d84),
  [build.zig.zon](https://github.com/ghostty-org/ghostty/blob/7fb75b3c508ce8dfccfe796d9bec3cba75843d84/build.zig.zon#L1-L6)).
- The public embeddable slice is `libghostty-vt`: parser, terminal state, scrollback,
  input encoding, snapshots and a render-state API for a custom renderer. Ghostty says the
  behavior is mature but the API signatures are still in flux and it has not tagged a
  `libghostty-vt` version ([roadmap](https://github.com/ghostty-org/ghostty/blob/7fb75b3c508ce8dfccfe796d9bec3cba75843d84/README.md#L145-L169),
  [VT header](https://github.com/ghostty-org/ghostty/blob/7fb75b3c508ce8dfccfe796d9bec3cba75843d84/include/ghostty/vt.h#L1-L27)).
- `include/ghostty.h` is explicitly an internal embedder API whose only consumer is the
  macOS app; it contains macOS/Metal-specific pieces and directs external embedders to
  `libghostty-vt` ([header](https://github.com/ghostty-org/ghostty/blob/7fb75b3c508ce8dfccfe796d9bec3cba75843d84/include/ghostty.h#L1-L10)).
- The official WebAssembly example initializes a VT state machine and formats plain text;
  it does not provide an HTML/canvas/Metal terminal widget ([wasm example](https://github.com/ghostty-org/ghostty/blob/7fb75b3c508ce8dfccfe796d9bec3cba75843d84/example/wasm-vt/README.md#L1-L20)).
- The available Node binding is MIT and exposes feed/resize/snapshot/state semantics. Its
  README explicitly says it is not a screenshot, browser, GUI, or raster renderer; the
  upstream C API remains unstable and the initial prebuild set excludes Windows
  ([binding README](https://github.com/coder/libghostty-vt-node/blob/e222ffe744ad57f41c4f1893ba3963e92006be42/README.md#L1-L7),
  [prebuild/limits](https://github.com/coder/libghostty-vt-node/blob/e222ffe744ad57f41c4f1893ba3963e92006be42/README.md#L80-L101),
  [limitations](https://github.com/coder/libghostty-vt-node/blob/e222ffe744ad57f41c4f1893ba3963e92006be42/README.md#L129-L142)).

## CEDIA trace and decision

- CEDIA already uses `@coder/libghostty-vt-node` in the host as an optional headless
  checkpoint engine for OMP terminal frames. It feeds bytes, detects sequence gaps, and
  emits bounded styled checkpoints ([`terminal-state.ts`](../../../../apps/host/src/terminal-state.ts#L1-L13),
  [`terminal-state.ts`](../../../../apps/host/src/terminal-state.ts#L161-L183)). Keep this
  path; it is the right place for Ghostty's state/snapshot advantages.
- The Agent window's Synara terminal is a visible xterm.js surface with search, clipboard,
  image, ligature, Unicode and WebGL addons ([`terminalRuntime.ts`](../../../../apps/macos/agent-window/vendor/synara/apps/web/src/components/terminal/terminalRuntime.ts#L1-L24),
  [`terminalRuntime.ts`](../../../../apps/macos/agent-window/vendor/synara/apps/web/src/components/terminal/terminalRuntime.ts#L760-L803)).
- The browser/iPhone surface is also a self-contained xterm.js document in a WebView or
  iframe, so it works without a CDN or runtime network request ([`document.ts`](../../../../apps/ios/src/components/terminal/document.ts#L19-L35)).

**Recommendation:** do not replace the visible Agent-window, IDE, browser, or iPhone
renderer with Ghostty in this release. Use Ghostty VT only for host-side OMP terminal
state/checkpoints (already the current direction), and keep xterm.js as the rendering
contract for all three visible surfaces. This avoids writing a new GPU/canvas renderer,
reimplementing xterm addons and accessibility behavior, and coupling the app to an
unstable VT ABI without a user-visible benefit.

## Later option and entry gate

A future experiment may use `libghostty-vt` plus a CEDIA-owned canvas/WebGL renderer for
the browser/iPhone or Agent window, but that is a new renderer project, not a drop-in
package swap. It must first pin Ghostty and the binding commits, define a renderer/input/
selection/accessibility contract, preserve OSC 633/133, OSC 8, synchronized output,
alternate-screen, resize, search, images and clipboard behavior, pass the existing
terminal-conformance corpus on every target, and prove packaged macOS plus WebAssembly
memory/latency bounds. Until those gates pass, do not add `ghostty-web` or another
third-party browser renderer to the product.

## Version assumptions and limits

Facts above were checked 2026-09-23 against Ghostty `main` `7fb75b3c…` and binding
`main` `e222ffe7…`. CEDIA's existing package pin and prior spike are older, measured
evidence; they remain the basis for the host checkpoint, not proof that a visible renderer
swap is safe ([prior spike](../terminal-vt-spike-2026-09-16/README.md#L70-L94)). No claim is
made here about third-party `ghostty-web` projects, Windows support, or future upstream
API stability.
