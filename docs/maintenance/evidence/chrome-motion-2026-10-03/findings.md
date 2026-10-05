# Chrome boundaries and right-dock motion — 2026-10-03

## Scope

Owner follow-up to the earlier right-rail layout fix: right rail flashes during
panel opening; top chrome and left/right rails need distinct, coherent surfaces.
The two-rail layout in §3.E is preserved. No OMP/session/runtime ownership changes.

Codex Computer Use refused access to `com.openai.codex` for safety reasons. The
agent did not bypass that restriction or claim to operate Codex. The owner-supplied
Codex screenshot is the visual reference; native interaction checks target Cedia.

## Experiment ledger

1. Existing Cedia build: open/close controls work when settled. The earlier screenshot
   checks therefore did not establish stable animation.
2. New browser regression sampled each animation frame of the real dock/rail:
   the translated dock's right edge crossed the rail by up to **600px** in a 1200px
   viewport. This reproduces the moving-surface overlap independently of paint timing.
3. Source trace: the shared offcanvas sidebar translates the whole fixed panel by
   its width. `right: 3rem` only fixes its final position. The moving panel still
   passes underneath the persistent rail. Chrome also used differing blurred/solid
   materials, making the boundaries inconsistent.
4. First stationary-reveal trial still failed: the shared group-state translate
   selector outranked the local utility. Explicit local translate precedence removed
   that path; the same frame regression passed.
5. The right dock now remains stationary and animates a left-edge clip within its
   own bounds. It stays above the chat card and below the rail. Closed dock content
   is inert; reduced-motion mode removes the reveal duration. The existing gap
   animation retains chat resizing and panes retain their prior lifetimes.

## Chrome

Shared opaque, theme-derived chrome surfaces distinguish the top bar and both
rails from the sidebar/conversation/panel content, with aligned header dividers.
The compact IDE composer retains its existing styling. No separate theme owner,
new feature, provider request or external service was added.

## Verification

- Source: `1f80d55cfb3` plus the existing working tree and this bounded change.
- Packaged at `2026-10-03T04:43:29.602Z`; Agent Window asset digest
  `fda7ed4968689abcee522b1536ea6ee05ce8913b85d2a21866cb7dae78dd2a08`.
- `bun test apps/macos/agent-window/test`: 458 passed, 0 failed.
- Rail/browser Vitest configuration: 11 passed across two files. Includes
  per-frame light/dark open/close geometry and rail hit testing, retained native
  guest visibility, and delayed native guest reveal during a clip transition.
- Both Agent Window TypeScript configurations passed.
- `package:mac` succeeded; `check:packaged` passed all 12 checks.
- Native Computer Use on the freshly launched package: right toggle closes the
  loaded Browser, Browser reopens the retained page, Review opens one Diff pane,
  and a second Review click collapses it. No page remains over the conversation
  after closing. Opaque top/left/right chrome and aligned dividers are visible.
- Native captures are settled-state checks; the automated frame-sampling tests
  establish motion geometry. They are not a GPU pixel recording.
- At 1013px with a persisted 544px dock and both sidebars expanded, the remaining
  conversation is cramped (existing width policy). Collapsing the left sidebar
  restores readable content while preserving both rails. Automatic width policy
  was not changed in this motion/material slice.

## Native guest correction

Review identified that a native Browser guest cannot inherit the DOM clip. Two
regressions first failed: closing a retained pane left non-null native bounds,
and opening during an 800ms clip reveal restored those bounds immediately.
BrowserPanel now receives the pane visibility and treats running ancestor
clip-path transitions as occlusion. Transition end/cancel resynchronizes bounds;
the browser session is retained. Both regressions now pass.

## Captures

- [Before](before.png)
- [Open panel](after-open.png)
- [Closed panel](after-closed.png)
- [Review](after-review.png)
- [Loaded Browser restored](after-browser.png)
- [Narrow, both sidebars expanded](after-narrow.png)
- [Narrow, left sidebar collapsed](after-narrow-sidebar-collapsed.png)
