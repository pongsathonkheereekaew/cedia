# Card-layout target fix — packaged findings (2026-10-04)

Owner report: the Agents window still rendered flat after the card-layout
slice landed in source — no floating cards, content bleeding to the window
edges, status bar missing below the fold.

Root cause: two layers. (1) The running `Cedia.app` embeds its own agent-UI
copies, so the source fix never reached the screen without `--package`.
(2) The source slice itself had four defects against
`.scratch/card-layout-mockup/target.html` (8px shell, 6px gaps, 12px cards).

## Source changes (vendored agent-window surface, own-and-cherry-pick)

- `routes/_chat.tsx`: sidebar gap stays transparent so the opaque shell shows
  between floating cards (was a solid `bg-sidebar` fill in light mode).
- `index.css`: legacy square `chat-content-card::before` seam suppressed
  inside `.cedia-center-card` (a line where the target wants a gap).
- `components/chat/RightToolRail.tsx`: 8px top inset to match bottom/right.
- `components/chat/composerPickerStyles.ts` + `RouteInsetSurface.tsx`:
  route shells fill the card (`h-full`) instead of the viewport (`h-dvh`),
  which overflowed the flex-1 column and pushed the status bar off-screen.
- `apps/macos/agent-window/upstream.json`: adaptation 61 records the above.
- `scripts/card-layout-packaged-proof.ts`: isolated packaged proof (fixture
  host, zero provider calls) measuring card geometry + screenshots.

Positioning shells, drag math and resize behavior untouched.

## Packaged runtime proof (isolated profile, fixture host, 1440x900)

- `CEDIA_HOST_NODE=<node24> bun scripts/build-cedia.ts --package`: green,
  ad-hoc signed; fresh bundle confirmed inside both app copies.
- Proof run: `providerCalls 0`, zero page/console errors.
- Measured in the live window: shell padding 8px all sides, gap 6px,
  sidebar card radius 12px with shadow at (8,8), center card 1px border,
  seam `::before` display none, rail margins 8/8/8/0, status bar on-screen
  (top 867, bottom 891 of 900).
- Screenshots: `dist/card-layout-proof/cards-dock-closed.png`
  (sidebar card, center card, rail card, status bar all separated).

## Still open

- Relaunching the owner's live window (it still runs the pre-package
  bundle): quit Cedia, then `bun scripts/launch-cedia-personal.ts`.
- Composer max width stays wide (target mock shows a narrower composer);
  not part of this card-separation slice.

## Tone follow-up (same day): the stage must be opaque gray

First packaged capture still read white-on-white. Measured cause: every solid
surface token resolves to `#ffffff` at runtime and the window backing is black,
so `bg-muted` (a translucent wash) staged black gutters instead of gray. The
shell now mixes an opaque stage from the same tokens
(`color-mix(in srgb, var(--card) 96%, var(--foreground) 4%)`); center card is
the background token (white); dark mode and the IDE dock are untouched.

Pixel ground truth from the packaged capture (1440x900, zero provider calls,
zero page errors): shell margins and inter-card gaps `#ededed`–`#eeeeee`,
sidebar/center/rail card interiors `#ffffff`, status bar on-screen
(top 867, bottom 891 of 900). Screenshot `dist/card-layout-proof/cards-dock-closed.png`
now shows the mockup relationship: gray stage, white floating cards.

## Owner mockup slice (same day): narrow composer + header search

Owner confirmed: no new features, layout only. The composer is now a centered
480px pill (measured `maxWidth 480px` at x=607 in the packaged window) while
the transcript keeps full width; the header carries a centered Search field
with the real shortcut hint that opens the existing sidebar palette
(proof-clicked open, `headerSearchOpensPalette true`); the right card remains
the existing tool panel. The field hides on sidechat panes, empty-draft
landings and compact (<700px) headers. Typecheck clean, 492 unit tests pass,
packaged + ad-hoc signed, zero provider calls, zero page errors. Screenshot
above (gray stage, white cards, centered search, narrow composer) matches
`.scratch/agent-layout-mockup/mockup-2026-10-04.png`.

## Leak/overlap audit (same day, owner: gaps 8px, look before fixing)

Audited the dark dock-open screenshot element by element. Found defects:

1. Open dock overlapped the status bar and clipped its own last row mid-item
   (fixed-positioned dock with bottom:8px vs the fixed 25px status row).
   Fix: dock bottom is now calc(8px + 25px), ending exactly above the bar.
2. Shell gaps were 6px, owner wants 8px everywhere. Fix: provider gap-2
   (margins already 8px; dock top/bottom and rail insets already 8px).
3. Right rail had no left inset (0px, touching the transcript). Fix: uniform
   8px rail margins.

Not defects (checked, left alone): truncated thread rows (normal ellipsis),
touching row highlights (full-width rows by design), compact header in
dock-open state (labels + search field yield below the 700px breakpoint —
the search field shows when the header has room), drawer-style dock overlay
on the center's right edge (collapse-in-shell reveal, by design).

Packaged proof (Terminal pane open, then emulated dark): dock bottom 867 =
status top 867 (overlap false), provider gap 8px, dark shell transparent
glass with elevated cards, zero provider calls, zero page errors.
Screenshots: cards-dock-open.png, cards-dock-open-dark.png.
