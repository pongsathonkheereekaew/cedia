# Rail/tab/tool-rail packaged proof (2026-10-03)

Slice 4 runtime evidence for §3.E (item 71): independent left rail, task-tab
strip and persistent right tool rail in the packaged Agents window.

## Revision/runtime

- Source: working tree on `1f80d55cfb3` plus the uncommitted §3.E/vendor/wobble
  changes (left rail, task tabs, right rail, header glide fix).
- Package: `VSCode-darwin-arm64/Cedia.app`, rebuilt with
  `bun scripts/build-cedia.ts --package` (19 patches, `check:packaged` 12/12
  green before the run).
- Runner: `scripts/rail-tabs-packaged-proof.ts` — Playwright `_electron`
  against the packaged app, isolated scratch profile + fixture host, pinned
  provider-free fixture OMP (`apps/macos/test/fixtures/agent-window-omp`).
  Zero provider calls; `dist/rail-tabs-packaged-proof/result.json` holds the
  machine-readable verdict, PNGs the captures.

## Observed (all green, `ok: true`)

- Rail open: six rail icons (Threads, New thread, Search, Activity, Projects,
  Settings) beside the full thread panel; header shows the thread title and no
  tab strip (`rail-open.png`).
- Wobble: 42 rAF samples of the title rect across the collapse animation show
  **0px** vertical spread (`titleYSpread: 0`); the fixed toggle/arrows cluster
  never moves.
- Collapsed: rail persists, panel hides, the `Tasks` tablist replaces the title
  with the unfinished task + project label (`tabs-collapsed.png`).
- Right rail: `Tools` toolbar visible open and closed; Terminal opens a live
  task PTY, picking the active icon collapses the panel, Browser switches to
  the start-browsing pane (`tool-rail.png`).
- Carry: with Terminal visible, switching tasks reopens the new task's own
  terminal; the transcript, draft target and window stay put (`tool-carry.png`).
- Keyboard: Enter on the focused sidebar toggle collapses and re-expands.
- Narrow (900px): strip keeps a 64px minimum and scrolls internally
  (`scrollWidth: 356`, `clientWidth: 64`; `tabs-narrow.png`).
- IDE round trip: `Open in IDE` opens the fixture workspace, `Meta+Shift+A`
  returns without duplicating windows.

## Fixes the proof forced

- The legacy floating dock toggle overlaid the rail's top icon and swallowed
  its clicks: removed (the rail + header toggle own open/close now).
- The tab strip could squeeze to zero width with the tool panel open: it keeps
  a 4rem minimum and scrolls instead.

## Explicitly not claimed

- Compact IDE-dock visuals (rail/tab absence there is code-gated behind
  `isIdeEmbeddedRuntime` and typechecked, not screen-captured).
- Light/dark switching on screen (no new color tokens; dots reuse the
  existing amber/emerald/sky pill language).
- Provider-backed turns, remote/device runs, login-cycle behavior.

## Follow-up (2026-10-03, same revision line)

Owner screenshot review found two dock chrome issues; both fixed, repackaged,
and re-proven by the same script with two new assertions
(`singlePaneTerminalButtons: 1`, `twoPaneBrowserButtons: 2`):

- One pane hid its dock-level tab row (it duplicated the pane's own chrome:
  `Terminal` over `Terminal 1`). The row renders again at two or more panes,
  where switching needs it; Add/Maximize controls never moved.
- The right rail had no background and read transparent next to the panel; it
  now paints the one-piece `app-sidebar-surface` material like the left chrome.

## Follow-up 3 (2026-10-03, same revision line)

Owner review: the top open/close icon must stay fixed at its original
top-right corner with the rail below it, mirroring the left rail. The interim
in-flow header toggle moved with content width, so the fixed corner toggle is
restored above a reserved 46px rail header row (Windows caption gutter kept;
never overlaps a tool icon). Re-proven packaged (`headerDockToggle: true`,
full suite still green).

## Follow-up 4 (2026-10-03, same revision line)

One proof run failed the carry assertion with the terminal pane present but
hidden: the carry origin was ambiguous (whichever pane happened to be active),
so a rail click could collapse instead of opening. Not a product regression —
two earlier runs carried green on the same build. The script now sets a
deterministic origin (collapse-if-active, then open) and asserts the rail's
`aria-pressed` store truth alongside pane visibility. Re-run green.

## Follow-up 5 (2026-10-03, same revision line)

Owner review: the toggle must sit fixed at the far right like the left shell
cluster, not move with content width. Restored the fixed corner slot above the
rail's reserved header row and removed the interim in-flow toggle. The flip now
goes through an atomic `toggleDockOpen` store action
(`toggleDockOpenInState`, unit-tested) instead of a render-time closure.
Re-proven packaged: toggle box at (1404, 9) on a 1440 window, open/close works,
full suite green.

## Follow-up 6 (2026-10-03, same revision line)

Owner review of the live dark window: the rail still read transparent. Root
cause found in code, not perception — the rail root was
`bg-background dark:bg-transparent` (plus blur), i.e. literally transparent
over the black chat backdrop in dark mode, while the left sidebar sits on
solid tokens. It now paints `bg-sidebar`, solid in both themes. Repackaged,
gate green, full proof green again.

## Follow-up 7 (2026-10-03): heavy-dock toggle responsiveness

Owner report: the corner toggle feels dead on a heavy dock (terminal, browser,
device, diff over ~2.4k changed files, sidechat embed). Reproduced the shape in
scratch (`scripts/dock-heavy-toggle-proof.ts`: 4 panes incl. a 30-file Review,
close via corner toggle, reopen, time it): the dock reopened with all four tabs
and a fully rendered diff — the flip itself is fast and pane-agnostic; the
probe's first assertions were wrong (they waited on inactive panes' content).
No hang found. The remaining perceived deadness tracks to (a) toggling an empty
dock (launcher grid appears, easy to miss), (b) slow first paint of huge diffs
("Loading working tree diff..." is working, not stuck), and (c) stale windows
from earlier packages. Toggle mechanism verified four ways: unit, packaged
hit-tested clicks, live AX click in the owner's window (dock responded), and
this heavy reopen render.

## Live-window ledger (2026-10-03 ~10:34, fresh process + latest bundle)

Proven in the owner's live window via read-only AX plus three single clicks:
- Corner toggle exists (AX) and flips the dock (empty launcher on/off). Twice.
- Rail toolbar renders all seven tools; store transitions flow per click (WAL).
- Stale-window hypothesis is dead: fresh 10:34 process loads the current bundle
  (bg-sidebar/min-w-16 present on disk).
Could NOT reproduce: "Review opens the left sidebar too". The rail-to-dock
path (`handleAddDockPane`/`openPane`) has no code path to the left sidebar,
and the live Review click raced the owner's own clicks, so its diff is
inconclusive. No code changed on inconclusive evidence (iron law).
Left-side/left-rail, tabs, carry and packaged proof remain green as recorded.
