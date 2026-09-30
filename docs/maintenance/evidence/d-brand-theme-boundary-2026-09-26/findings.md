# D brand/theme boundary verification (onboarding + theme authority) — 2026-09-26

Verification sweep over two D rows with no product change: the settings/brand onboarding
half and the theme/syntax chrome-ownership half. No provider, no spend, no packaged run.
W/N out of scope per owner. §10 item 70 owns status.

## Done

- New `apps/macos/agent-window/test/onboarding-brand.test.tsx` (4 tests): the welcome
  step renders the local-first story with no foreign-harness copy; the step order
  welcome → tour → project → done with the no-auto-close-past-setup rule; the pure
  first-run gate shows the tour exactly on fresh installs and hides it on projects,
  recorded completion, unsettled inputs, or key errors; completion markers from another
  installation are ignored. The dialog shell itself renders in a portal (static markup
  is empty by design), so the tests target the step content plus the gate logic; the
  first attempt asserting on the shell caught exactly this and was rewritten.
- Branding facts pinned by the same run: `APP_BASE_NAME` is `Cedia`, and the retained
  `SynaraLogo` component renders Cedia's Pangaea-petal mark with aria-label `Cedia`
  (no visible upstream text). Bundle sources carry no telemetry/analytics/update URLs
  and no other-harness names (verified by search this turn).
- Theme authority re-verified, not rebuilt: `bun test apps/macos/test/host-theme-authority.test.ts`
  is 10/10 green, so the completeness rule still holds — every colour custom property the
  vendor theme emits is mapped from a workbench chrome anchor or listed as derived, and
  nothing paints from the ported palette after the first host snapshot. The anchor map
  carries no syntax/token colours (chrome anchors only: sidebar, editor background,
  status bar); fonts stay window-owned. IDE syntax cannot override agent chrome by
  construction, matching the owned direction (item 54, follow-without-overriding).

## Reconciliation (no new work, recorded so the audit is not re-read stale)

- The 2026-09-26 D/W/N/F remainder audit predates three same-day receipts that close
  what it lists as open: `destructive-confirm-audit` (reset preview), and
  `r3-packaged-restore-observed` + `o02-restore-button-proof` (packaged restore
  observation). Those rows are closed by those receipts, not by this one.
- Turn crash rehearsal at every live boundary and a packaged two-window Send-vs-edit
  race remain open (live two-adapter proof stands via `r2-send-race-live`); both need
  the runtime, which is being rebuilt this turn after `dist/` vanished mid-turn from
  an external cause. Focus/IME/multilingual theme behaviour still needs packaged
  observation. No gap change (stays 2).

## Preserved

- D1–D5, deferred voice, `switchSession`/`browser-relay` untouched. Nothing committed.
