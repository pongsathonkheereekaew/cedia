# SDD ledger — plan: docs/superpowers/plans/2026-10-05-agent-window-cards-plan.md
# Spec: .scratch/agent-layout-mockup/mockup-2026-10-04.png (no separate spec file — mockup is authority; provisional rulings)

## Preflight conflict scan

| Pair | Produces vs Consumes | Finding |
|---|---|---|
| Task 1 (left edge) vs Task 3 (dock position) | T1 moves 8px inset container→inner; T3 changes dock fixed→absolute-in-outlet | No conflict: different files, different coordinate systems |
| Task 3 (dock) vs Task 4 (center bind) | T3 picks (a) offcanvas-translate or (b) absolute-in-outlet; T4 default un-portal assumes flex sibling | CONFLICT if T3 picks (b) and T4 un-portal: absolute-in-outlet + un-portal disagree on outlet ownership. Ruling below |
| Task 4 vs Global Constraints (resize math intact) | T4 un-portal moves dock into flex flow | No conflict: beginResize/shouldAcceptWidth untouched, only mount point changes |
| Task 6 (rebuild) vs all | rebuild consumes all prior file states | Sequential by construction, no conflict |

Ruling: T3 default is (b) absolute-in-relative-outlet; T4 default is un-portal flex sibling. These are ALTERNATIVES, not both — implementer of T4 chooses one and documents. If T4 picks un-portal, T3-(b) absolute positioning is void (flex sibling needs no absolute). If T4 picks var+max-width, T3-(b) stands. Cost if wrong: one extra fix round to align the two.

Ruling (FixRailTests deadlock): dock `md:right-0` pins to outlet right edge = viewport edge, overlapping the in-flow 48px rail by rail width — production bug, not harness artifact (maxDockWidth/maximized math all subtract rail width; only the pin class disagrees). Fix prod `right-0` → `right-12` (48px = rail width, matches seam rail `fixed right-12`). Tests keep adjacency assertions. Cost if wrong: dock overlaps rail by 48px, visible on CDP verify.

## Tasks

Task 1: complete (review: spec approved, quality approved with 1 parked minor + 1 contested)
- Parked minor: ui/sidebar.tsx inner base h-full w-full retained alongside variant h-auto w-auto (order-dependent; cosmetic). SUPERSEDED by fix wave (deterministic variant scoping landed).
- Ruling: reviewer Important (container h-svh + top/bottom over-constrained) is CONTESTED — index.css:3155 already forces height:auto on floating containers, so bottom-2 takes effect; no fix dispatched. Cost if wrong: left card bottom overshoots 54px, visible on next CDP verify.

Task 2: complete (review: spec + quality approved; option (b) absolute-in-outlet; outlet `relative` owned by Task 3)
- Deferred minors for final review: (1) `.cedia-dock-card overflow:hidden` clips open-state resize handle at -left-2 — FIXED in wave (overflow visible on container, clip on inner); (2) top/bottom geometry duplicated inline + index.css — PARKED (identical values, cleanup follow-up); (3) reopen seam `fixed right-12` — PARKED (correct at 48px rail; revisit if rail width varies).

Task 3: complete (review: spec + quality approved; mechanism (ii) var+gap, Task-2 absolute stands, no un-portal)
- Controller fix: wired CenterDockShare.browser.tsx into vitest.rail.config.ts include + optimizeDeps (untracked file, was invisible to suite).
- RightDock direct-render bypass of portal null-outlet path: documented in comment, accepted (null = no right cards, never duplicate).

Task 4 (fix wave): complete (re-review: 4/4 ADDRESSED, no new breakage)
- Inner sizing deterministic; dock overflow moved to inner; fallback comment matches code (null, no duplicate); dock right-12 clears rail.
- Regression found + fixed in wave: onToggleDevice accidentally dropped from DeferredChatView props — restored; dead DIFF_INLINE_DEFAULT_WIDTH const renamed to CEDIA_DOCK_DEFAULT_WIDTH and wired.

Rail tests: RightToolRail 8/8 + CenterDockShare 1/1 + AgentRunTimelineRow 3/3 = 12/12 green.
Live CDP verify: header 46px single row, 0 in-card headers; cards row y=46 bottoms 1042×4 equal; dock card x=1271 y=54 w=440 h=980 beside rail x=1711 (no overlap, no underlap at rest).
