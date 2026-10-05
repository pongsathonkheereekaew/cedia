# Agent Window 3-Card Row: Fix-in-Place vs Beta-Rebase Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick fix-in-place or beta-rebase for the 3-card row, then execute it.

**Architecture:** Fix-in-place keeps the Cedia card row (route header + portal + outlet) and repairs 3 measured defects at their exact lines. Beta-rebase ports the card row onto Synara v1.0.0-beta.1's rail shell. Evidence below favors fix-in-place; the plan prices both.

**Tech Stack:** React 19, Tailwind v4, Tanstack Router, Vitest browser (Chrome), Electron (CDP verify).

**Spec:** `.scratch/agent-layout-mockup/mockup-2026-10-04.png` (header 46px full-width; 3 floating cards on gray stage, 8px gaps; left thread card; center chat + floating composer; right tool rail; no footer; keep IDE button).

## Global Constraints

- Keep the IDE button (user requirement, this conversation).
- IDE-embedded mode unchanged (every task).
- No new palettes/tokens (reuse `--sidebar/--background/--card/--foreground`).
- Resize/drag math intact (`resolveSidebarResizable`, `beginDockResize/shouldAcceptWidth`).
- Verify live via CDP (`--remote-debugging-port=9333`, `vscode-file://...agent/index.html`), not screenshots alone.
- Sync `dist/agent-window` into `Cedia.app/.../out/vs/cedia/agent` (incl. `main.cjs`) + relaunch before user-visible verify.

---

## Evidence summary (from BetaDelta + CardDefects agents, read-only)

- Pin: `upstream.json` commit `33333439` (2026-09-17), 64 adaptations. Beta: `/tmp/synara-beta` v1.0.0-beta.1 (`37439ec`).
- Beta does NOT fix wide-dock (`SingleChatSurface.tsx:146` still `max(28rem, calc(50vw - 8rem))`, no 440px cap) or double-header (`ChatView.tsx:6260` in-card header remains).
- Beta structural changes vs pin: rail shell (`AppRail`, `AppRailPortal`, `AppRailSlotProvider`, `SidebarLeadingControlsDock`, `app-rail-panel [contain:paint]`, `_chat.tsx:585-665`); Spaces/Studio/Hubs/Tasks/Inbox/Kanban routes; `EditorRailTabs`; plain offcanvas sidebar (no `top-[54px]`, no `collapseInShell`, no outlet portal).
- Conflicting adaptations if rebasing: #10 Studio cut, #11 Spaces cut, #12 Environment-Studio cut, #13 copy sweep, #14 kanban delete, #25-36/#50-52/#56/#58/#60 rail/sidebar/dock rework, #8/#18/#60/#61/#63 status-bar+stage, #37/#39 task tabs, #5/#9 theme, #62 composer+search.
- Live-measured (CDP): header 46px single row OK; cards row y=46: rail 48 / sidebar 289 / center 926 / outlet 464; all h=996; dock fixed w=416 top:54px bottom:8px; rail 48px in-flow.

### Option A — Fix-in-place (RECOMMENDED): ~3 small edits + 3 assertions

**Files:**
- Modify: `apps/macos/agent-window/vendor/synara/apps/web/src/components/ui/sidebar.tsx:389-390`
- Modify: `apps/macos/agent-window/vendor/synara/apps/web/src/components/Sidebar.tsx:6164-6165`
- Modify: `apps/macos/agent-window/vendor/synara/apps/web/src/components/chat/RightDock.tsx:470-489`
- Modify: `apps/macos/agent-window/vendor/synara/apps/web/src/components/chat/SingleChatSurface.tsx:192-219`
- Modify: `apps/macos/agent-window/vendor/synara/apps/web/src/routes/_chat.tsx:775-779`
- Test: `apps/macos/agent-window/vendor/synara/apps/web/src/components/ui/SidebarRail.browser.tsx`
- Test: `apps/macos/agent-window/vendor/synara/apps/web/src/components/chat/RightDock.browser.tsx`
- Test: new `CenterDockShare.browser.tsx` (or extend `PanelMotion.browser.tsx:57`)

**Interfaces:**
- Consumes: existing `--cedia-right-dock-width` var (set `RightDock.tsx:451`), existing dock gap (`dockWidthClassName`), existing `RightCardsOutlet` portal.
- Produces: equal card bottom edges (pairwise ≤1px); dock-open ⇒ `centerRect.right <= dockGapLeft + 1px`; dock-closed ⇒ outlet 0 + center full width.

- [ ] **Step 1: Left card bottom edge — move 8px inset from fixed container to inner card**

```tsx
// ui/sidebar.tsx floating container (was: "top-[54px] bottom-2 p-2 ..."):
"top-[54px] bottom-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
// inner surface carries the inset instead (innerClassName or border-box) so the
// outer container edges match center/dock exactly.
```

Run: `bunx --bun vitest run --config vitest.rail.config.ts src/components/ui/SidebarRail.browser.tsx`
Expected: PASS (existing suite still green; geometry assertion lands in Step 4)

- [ ] **Step 2: Unify flyout bottom edge (threads + more share the card edge)**

```tsx
// Sidebar.tsx rail-flyout portal className: BOTH sections get bottom-2 AND max-h:
railFlyout.section === "more" ? "max-h-[calc(100dvh-62px)]" : "bottom-2",
// becomes: always "bottom-2 max-h-[calc(100dvh-62px)]"
```

Run: same suite as Step 1
Expected: PASS

- [ ] **Step 3: Dock stops overlaying — absolute in outlet OR plain offcanvas translate**

Pick ONE (default: b — smaller blast radius):
  - (a) drop `md:right-16` + clip-path reveal (`RightDock.tsx:470-475`), keep offcanvas translate + gap (beta behavior) with the 440px clamp + 22rem default retained; or
  - (b) keep clip, change container from `fixed + right-16` (viewport coords) to `absolute` inside a `relative` outlet (outlet owns the reserved box).

```tsx
// RightDock.tsx — option (b) sketch:
"maximized"
  ? { width: expandedWidth || undefined, zIndex: 1, top: "calc(46px + 8px)", bottom: "8px" }
  : props.collapseInShell && !isMobile
    ? { width: dockWidth, zIndex: 1, top: "calc(46px + 8px)", bottom: "8px", position: "absolute", right: 0 }
    : undefined
// + outlet div in _chat.tsx:775-779 becomes `relative`
```

Run: `bunx --bun vitest run --config vitest.rail.config.ts src/components/chat/RightDock.browser.tsx`
Expected: PASS

- [ ] **Step 4: Bind center to dock state (ONE mechanism)**

Default: un-portal — render `<ChatRightCards>` as a true flex sibling of the viewport shell in the cards row (no `fixed`, no outlet portal) so flexbox shrinks center automatically. Fallback: cards-row CSS var + `.cedia-center-card { max-width: calc(100% - var(--cedia-right-dock-width)) }` toggled by dock open.

Run: new `CenterDockShare.browser.tsx` (dock open ⇒ `centerRect.right <= dockGapLeft + 1px`; closed ⇒ outlet 0 + full width)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/macos/agent-window/vendor/synara/apps/web/src/components/ui/sidebar.tsx apps/macos/agent-window/vendor/synara/apps/web/src/components/Sidebar.tsx apps/macos/agent-window/vendor/synara/apps/web/src/components/chat/RightDock.tsx apps/macos/agent-window/vendor/synara/apps/web/src/components/chat/SingleChatSurface.tsx apps/macos/agent-window/vendor/synara/apps/web/src/routes/_chat.tsx
git commit -m "fix(agent-window): align 3-card row edges, dock shares row instead of overlay"
```

- [ ] **Step 6: Rebuild + sync + relaunch + verify live**

```bash
bun scripts/build-agent-window.ts
rm -rf "VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/out/vs/cedia/agent" && cp -R dist/agent-window "VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/out/vs/cedia/agent"
pkill -f "VSCode-darwin-arm64/Cedia.app"; open "/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app" --args --remote-debugging-port=9333
```

Expected: CDP DOM shows header 46px single row, 0 in-card headers, cards row y=46 with equal bottoms ±1px, dock-open no overlap.

### Option B — Beta-rebase (NOT RECOMMENDED): port card row onto beta rail shell

**Files:**
- Re-vendor: `apps/macos/agent-window/vendor/synara/*` from `/tmp/synara-beta` (`37439ec`)
- Re-port: all 64 `upstream.json` adaptations, resolving conflicts #5 #8-14 #18 #25-39 #50-52 #56 #58 #60-63 against beta's `AppRail`/Spaces/Studio/kanban structure
- Re-implement: floating left card, dock card geometry, outlet portal, rail, 440px clamp, single-header portal, composer pill, agent-run row
- Test: full `vitest.rail.config.ts` + `test:browser` suites on the new tree

- [ ] **Step 1: Re-vendor beta source + record new pin in upstream.json**
- [ ] **Step 2: Re-port 64 adaptations (conflict list above), Studio/Spaces/kanban cuts re-applied**
- [ ] **Step 3: Re-implement 3-card sharing on rail-shell layout (strictly larger than Option A)**
- [ ] **Step 4: Full browser suites green**
- [ ] **Step 5: Commit**

Cost: loses measured 46/54/8px geometry + 440px clamp tuning; beta fixes neither wide-dock nor double-header, so all of Option A is still owed afterwards. Strictly larger than A with no layout payoff.

---

## Recommendation

Do Option A. Beta-rebase buys the workspace rail + Hubs/Tasks/Inbox (none requested) at the price of re-porting 64 adaptations and re-implementing the card row from scratch — while fixing neither reported defect.

## Self-Review

1. Spec coverage: single 46px header ✓ (done, portal), 3 cards equal edges (Option A Steps 1-4), floating composer ✓ (done), right rail ✓ (done), no footer ✓ (done), IDE button kept ✓ (untouched `ChatHeader` IDE action), IDE-embedded unchanged ✓ (all branches guarded).
2. Placeholder scan: no TBD/TODO/similar-to; every step names exact files/lines/commands.
3. Type consistency: `CediaChatHeaderPortal({ node })` / `useCediaChatHeaderSlot()` names match `cediaChatHeaderSlot.tsx`; `--cedia-right-dock-width` matches `RightDock.tsx:451`; `turnStateByTurnId` maps match `MessagesTimeline.logic.ts` `AgentRunState`.
