# Right rail layout and toggle verification — 2026-10-03

## Revision and scope

Working tree based on `1f80d55cfb3`, preserving the existing uncommitted
rail/task-tab and branding work. This follow-up changes `RightToolRail.tsx`,
`RightDock.tsx`, `SingleChatSurface.tsx`, and `ChatHeader.tsx`; it does not replace §3.E's two-rail
layout or change OMP ownership.

Packaged at `2026-10-03T04:14:57.309Z` with Node 24.18.0. Agent assets digest:
`6c5097519a314f0dff628bb210690c47f1d15eb69249819e479edeb40976fc1a`.
`bun run check:packaged` passed all 12 checks. The personal launcher was used
with basic password storage and in-memory secret storage; no Keychain mock.

## Cause and change

The dock reserved width in flex layout but its actual sidebar remained fixed
at `right: 0`, behind the newly added 48px tool rail. Review content consequently
painted underneath rail icons. Merely adding an opaque background was not enough:
the dock still occupied that column. The detached corner toggle also overlaid
the rail's Electron drag-region spacer.

The dock now ends before the rail. The opaque sidebar-token rail has its own
stacking layer, border and 32px tool hit targets. Its header owns the corner
toggle and a native no-drag hit area. The toggle reuses the existing atomic
store action. Maximizing subtracts the rail width and leaves it visible and
interactive. Existing singleton panes and multi-pane tabs retain their owners. A native narrow-window
check also exposed the header action cluster clipping Tasks navigation. The header now
reserves the task strip plus navigation clearance first and lets the action strip
scroll horizontally when constrained.
A fresh task's corner toggle opens the existing launcher without creating Review.

The old corner toggle worked through an accessibility click during reproduction;
a screenshot-coordinate click did not change its state. The geometry/drag-region
correction is supported by code and subsequent native verification; this is not
a claim that every historical no-op had the same cause.

## Verification

- Browser regressions failed before the fix (overlapping bounds, missing rail-owned
  toggle), then passed: 3/3 using `vitest.rail.config.ts`. Tests exercise real dock
  and rail components, their state reducers, computed panel/rail geometry,
  maximize, keyboard toggle, singleton Review and fresh-task launcher at 900px.
- `bun test apps/macos/agent-window/test`: 458 passed, 0 failed.
- `bun run --cwd apps/macos/agent-window typecheck`: both configurations passed.
- `bun run package:mac` passed with `CEDIA_HOST_NODE` set to the packaged Node 24
  binary; the first attempt lacked this required environment variable.
- `git diff --check` passed.

Native Computer Use used `@oai/sky` through the provided node_repl. The requested
skill's official dependency was located in the bundled marketplace at
`~/.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/computer-use/skills/computer-use/SKILL.md`.
On the rebuilt personal Cedia app, with no provider turn submitted:

1. Corner toggle opened Review; active Review collapsed it; Review reopened once.
2. Browser rail switched the existing panel; there was one visible tool surface.
3. Maximize kept the rail visible and clickable; corner collapse and Enter reopen
   worked while preserving the Browser selection.
4. Left sidebar collapse kept both rails and exposed Tasks navigation.
5. Native window resize to approximately 1013×748 kept the right rail separate;
   dragging the panel seam reduced its width and preserved access to the controls.
6. After the header follow-up, the same narrow window with a wide panel keeps
   the selected task tab visible and the actions horizontally scrollable.

Captures: [Review](review.png), [maximized Browser](maximized.png),
[left sidebar collapsed](left-collapsed.png), [narrow window](narrow.png),
[narrow panel resized](narrow-resized.png),
[final narrow-header correction](narrow-header-fixed.png).
The first five captures predate the final header-only follow-up; the final capture
uses the package digest above.

## Limits

Native captures are in the existing light host theme. No dark theme switch,
provider call, remote/device or full D/W/N/F acceptance is claimed. Existing Review image-preview errors on working-tree brand assets are visible
in the capture and are outside this chrome correction.
