# IDE shell alignment — 2026-10-04

## Scope and design decision

The owner approved aligning the IDE's top chrome and left/right rails with the
Agent window while preserving the Code-OSS editor workflow. Cursor's separate
Agents and IDE windows, and its configurable native IDE layout, informed the
boundary: shared Cedia visual language, native IDE editor/Explorer/terminal and
secondary side bar ownership. The screenshots attached by the owner were visual
references, not implementation instructions.

The IDE title bar now reserves at least 46px for Cedia, matching the Agent
window's top region. Product-scoped workbench styling gives the 48px activity
rail, title bar and right auxiliary bar opaque theme surfaces, clear borders,
hover/focus feedback and reduced-motion behavior. The right Agent dock opens
for a fresh IDE through the native secondary-side-bar default. Code-OSS still
owns its width, sash, title controls, keyboard commands and saved visibility.
The extension reads live auxiliary-bar visibility before a same-window switch
to Agents, so an explicit close is restored when returning to IDE mode.

## Source and build verification

- The additive Code-OSS patch is
  [`0064-cedia-ide-chrome-alignment.patch`](../../../../patches/desktop/0064-cedia-ide-chrome-alignment.patch)
  and is SHA-pinned in `patches/desktop/manifest.json`. Reverse apply check
  passed against the built desktop checkout.
- `bun test apps/macos/test/workbench-mode.test.ts apps/macos/test/ide-native-workbench.test.ts`:
  72 passed, 0 failed (309 assertions). These include first-open dock visibility
  and an explicit user close before IDE-to-Agents-to-IDE mode switching.
- `bun run --cwd apps/macos typecheck`, `bun run build:mac`,
  `npx gulp vscode-darwin-arm64-min`, `bun run package:mac`, and
  `bun run check:packaged` passed. The packaged checker reported 12 passed.
- Desktop's broad `npm run typecheck-client` remains unavailable because the
  checkout lacks upstream Electron/original-fs typings and modules. Its one
  new patch-local access error was corrected before the final build; the
  complete package and targeted extension typecheck succeeded.

## Packaged native interaction

The freshly packaged `Cedia.app` was launched with the personal-build launcher
and inspected using Computer Use. The Agent window's **Open in IDE** action
opened a separate IDE window with the new titlebar height, solid left rail and
native right Agent dock. Explorer, editor, terminal and status bar remained
available. The titlebar toggles closed and reopened both sidebars. Search in the
left activity rail opened its real workbench view; Explorer could be restored.

Dragging the native right sash expanded the dock from about 300px to 450px and
restoring it worked without an overlay or stuck resize cursor. After closing
the right dock and reloading the same IDE window, its native toggle remained
off; reopening restored the dock. A separately opened IDE window started from
its own native default and opened the dock. Thus the observed persistence is
per workbench window, not a cross-window preference claim.

The Agent surface briefly reported offline after the reload with its dock
hidden. The authenticated host health endpoint returned HTTP 200, and
reopening the dock reconnected it to Ready. The cause of this lazy reconnect
was not established by this shell-layout check.

## Captures and references

- [Before packaged IDE](before-ide.png)
- [After packaged IDE with Explorer and Agent dock](after-ide.png)
- [Cursor 3 — Agents and IDE windows](https://cursor.com/en-US/blog/cursor-3)
- [Cursor layout customization](https://cursor.com/changelog/2-3)
- [Cursor Agent Tabs](https://cursor.com/changelog/3-0)
- [Cursor full-screen panel](https://cursor.com/changelog/3-4)

## Addendum — 2026-10-04: sidebar, panel and status bar

Follow-up review found `0064` covered the title bar, activity rail and
auxiliary bar but left the Explorer sidebar, bottom panel and status bar on
their upstream treatment while the theme already painted them opaque. The
patch now gives those three parts the same shell language: opaque
theme surfaces, no shadow, quiet inward dividers and the shared 8px / 120ms
hover treatment with reduced-motion behavior. Panel open/close motion stays
with the native grid, which owns width, sash dragging and keyboard behavior.
Reverse-apply check passes; `workbench-mode`, `ide-native-workbench`,
`cedia-theme`, `agent-window-chrome`, `host-theme-authority`, chrome
inventory, task chrome and agent theme suites pass (134 tests) and
`apps/macos` typecheck passes.

## Addendum — 2026-10-04: rail icon geometry

Side-by-side screenshots showed the IDE rail icons rendering larger and on a
wider pitch than the Agent rails. Both Agent rails use 48px rails with 32px
buttons, 4px gaps and 18px glyphs, starting flush below the 46px top chrome
(`Sidebar.tsx`, `RightToolRail.tsx`); the IDE activity bar used 48px items
with 24px glyphs. The patch now gives the IDE activity bar the same geometry
(32px hit area, 2px/8px margins for a 36px pitch, 18px glyphs, badges tucked
to the smaller box) and the auxiliary/sidebar/panel title actions the same
32px/18px treatment. Native drag, overflow and grid behavior is untouched.

## Addendum — 2026-10-04: floating sidebar card

The owner asked for the Codex-style rounded sidebar card in the Agent window.
The vendored shell already carries a `floating` sidebar variant (8px container
inset with a rounded, bordered inner surface), so `_chat.tsx` now renders the
thread sidebar with `variant="floating"`. Rail/panel widths, the 46px drag
spacer, flyout anchoring and the content-seam resize path were unchanged.
Bundle typecheck (`tsc` + `tsconfig.vendor.json`) and the sidebar/right-rail
suites passed. The owner then rejected the rounded look, so the prop was
removed again and the sidebar is back to the full-height square card.

## Addendum — 2026-10-04: packaged verification of rail geometry + floating card

Rebuilt (`build:mac`, `vscode-darwin-arm64-min`, `package:mac`) and
`check:packaged` passes (12 checks). Launched the packaged app and captured
both windows with `screencapture -l`:

- Agent window: the thread sidebar renders as a floating rounded card with an
  8px inset (Codex language), left/right 48px rails intact, empty-state hero,
  composer and right tool launcher all connected (host `ready`).
- IDE window: activity rail shows 18px glyphs on the 32px/36px rhythm, 46px
  title bar, opaque sidebar/panel/statusbar surfaces and the native right
  Agent dock.

Two environment notes. First, `package:mac` failed with `Set
CEDIA_HOST_NODE...` because only Homebrew Node was present, and after pointing
it at Homebrew's Node 24 the packaged host still could not start: Homebrew
links `node` dynamically (`@rpath/libnode.137.dylib`), so the binary copied
into the bundle dies with exit 134. Repackaging with a statically linked
nodejs.org Node 24 (`CEDIA_HOST_NODE=<dist>/bin/node`) fixed it; `ensure`
then exits 0. Future repackaging must use a static nodejs.org Node, not
Homebrew's. Second, one IDE capture showed a 4px blue bar at the
sidebar/editor sash; the live DOM (via CDP) showed a transparent,
non-hover sash and no blue element, and a fresh window capture has no bar, so
it was a stale compositor frame, not a style defect. No code change was made
for it.

## Addendum — 2026-10-04: full rebuild and packaged verification

Rebuilt from the current tree (`bun run build:mac`, desktop
`gulp vscode-darwin-arm64-min`, `CEDIA_HOST_NODE=<node24> bun run package:mac`)
and `bun run check:packaged` passes, including the newest-patch freshness rows
for `0064` (patch set `280af665ffea`, 20 patches). The packaged app was
launched with the personal launcher; fullscreen and region captures
(`.scratch/rebuild-proof/`) confirm the rebuilt IDE window renders the new
32px/18px activity-bar geometry and the opaque shell surfaces. Opening the
standalone Agents window still requires the in-app `Open Agents Window`
command, which needs a user action (no assistive access or CDP endpoint in
this runtime to drive it programmatically).

## Addendum — 2026-10-04: card layout implementation and verification state

Implemented the owner-approved card treatment in the agent bundle
(`routes/_chat.tsx` shell padding/gap plus `variant="floating"` on the
thread sidebar; `index.css` 12px card surfaces with retired rail seams;
`Sidebar.tsx` rail-flyout offsets following the 8px shell margin;
`RightDock.tsx` dock card flush against the rail; `RightToolRail.tsx`
rail card). Bundle typecheck, the sidebar/dock suites and a full
rebuild plus `check:packaged` (10/10) pass on the packaged app, which was
relaunched. Pixel verification of the live window could not be completed
unattended: this runtime has no `mcp__node_repl__js` (the computer-use
skill's required tool), no assistive access and no live CDP endpoint, and
the screen kept changing between captures. The remaining check is eyes-on
by the owner with the sidebar and dock open.

## Addendum — 2026-10-04: card pixels confirmed on the fresh build

After the height-auto correction the bundle was rebuilt, repackaged and
relaunched. A zoomed crop of the live window
(`.scratch/rebuild-proof/v3-right.png`) shows the right rail drawing as a
card: bordered surface with a rounded bottom corner and a margin to the
window edge. Rail seams were retired in favor of card borders as approved.
Left/dock cards ship in the same build through the same mechanism; their
open-state look still awaits an eyes-on pass with the thread panel and the
dock both open.

## Addendum — 2026-10-04: why the 13:22 shots showed no cards

Pixel measurement of the owner's screenshots shows content starting right
at the window edge with no shell margin and no card surfaces. The window in
those shots is the IDE window, not the standalone Agents window: its menu
bar carries Selection/Go/Run/Terminal, which the workspace contract reserves
for the IDE (§3.D), and its left chrome is the native activity bar plus the
Cedia extension views. The card implementation went into the standalone
agent-bundle route (`_chat` sidebar, dock, rails), whose components are
gated off in the embedded IDE dock — only the center webview runs bundle
code there. So no cards can appear in that window; the code path is correct
but targets the other window. Card-ifying the IDE window itself means
floating native Code-OSS grid parts and is scoped separately (it amends
§3.A, which keeps the IDE editor-first with native sidebars).

## Addendum — 2026-10-04: isolated packaged run proves cards render

Drove the packaged app from a scratch profile and scratch host (fixture OMP,
no provider) with the repo's own Electron harness. Computed styles on the
live window: provider padding 8px with 6px gaps, floating container padded
8px at full height, floating inner radius 12px with border and deep shadow,
right rail with 8px right/bottom margins and 14px radius, dock container at
top/bottom 8px and right 56px with 12px radius and hidden overflow, dock
opened through a real rail click, zero page errors. Screenshots
(`.scratch/rebuild-proof/verify-A-sidebar.png`,
`verify-B-dock.png`) show the left, dock and rail cards. A window that still
renders flat is running a bundle from before the final package: quit Cedia
fully and reopen so new windows load the current assets.

## Addendum — 2026-10-04: center card joins, top band verified stable

The center column is now the middle card (same lift/border/radius family,
overflow hidden) and the dock sits flush against the rail card at a 64px
right offset. A fresh isolated packaged run confirms computed geometry for
all three cards with zero page errors, and the screenshots
(`verify-A-sidebar.png`, `verify-B-dock.png`) show clean margins, aligned
card tops under one 8px top gap, and matching radii. The empty-state hero
renders no thread header by pre-existing behavior; the 46px header rows
appear with an active thread and keep the band aligned. Seeing this in the
daily window requires an app restart so new windows load the repackaged
bundle.
