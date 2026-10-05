# Agent-window UI/UX retest — 2026-10-03

## Scope and method

Owner requested a fuller retest after reporting a resize cursor when opening Review.
Native Computer Use exercises the packaged Cedia app; browser regressions inspect
DOM hit targets, cursor cleanup and intermediate layout states. This receipt records
specific coverage, not a claim that every application feature or provider was exercised.
No messages, provider turns, Git mutations, device provisioning or external writes
are part of this UI check. Existing repository changes are preserved.

## Experiment ledger

- Plain Review close/reopen: native conversation/content remained clickable; ordinary
  divider drag and release worked. The reported persistent cursor did not reproduce
  on every open. Source trace isolates shared SidebarRail's global body cursor and
  missing lost-capture/blur cleanup; Review itself never writes a resize cursor.
- At 1013px with both sidebars expanded, persisted dock width squeezes the main
  conversation. The prior motion-only receipt recorded this; this broader pass
  includes correcting it while retaining preferred width on return to wide layout.
- Review displays error cards for valid PNG files in the workspace. Native preview
  transport is being checked separately from UI image format detection.
- All seven right-rail tools were opened. Terminal, Files, Side chats and Source
  control require an additional settled snapshot after their initial loading state.
- Files opens README.md in the editor. Source control loads repository state without
  activating write actions. Simulator shows its specific setup state; no runtime was
  installed and no device action was performed.
- Repeated Side chats rail picks created replacement forks instead of reopening the
  retained pane. Fix selects the existing pane; explicit Add panel remains the create
  path. The first asynchronous create also needs pending feedback.
- Maximize/restore keeps the right rail visible; collapse keeps resources retained.
- Left Search opens its palette and Escape dismisses it. Activity shows task state,
  Projects opens project navigation, and Settings General/Appearance load. Theme
  ownership correctly remains with the IDE. Appearance was later switched through the IDE to Dark Modern, observed in the Agents window, and restored to the original Light Modern setting. No other preferences were changed.
- Sidebar collapse exposes the selected task tab and retains the conversation.

## Final validation

Integration checks so far:

- New resize browser regressions first failed with `col-resize` left on body after
  lost capture, blur and controlled close. Seven cases now pass: those three plus
  pointer up/cancel, unmount, and seam-only hit testing/computed cursor. Synthetic
  interruption events supply only the browser capture primitive; real sidebar
  components and body styles remain under test.
- Narrow-layout regression first failed with 121px conversation width. It now
  preserves 320px at 1013px, keeps gap/panel widths aligned, restores saved 544px
  at 1440px, and preserves rail access while maximized.
- Sidechat decision regression first returned create for a retained pane; now it
  returns the same pane identity on reopen/switch. Pending UI test first could not
  find an opening state; now the initiating button is busy/disabled while other
  tools remain available, then returns to enabled.
- Integrated rail/browser/sidebar configuration: 4 files, 20 tests passed.

- Final integrated source checks: 467 unit/service tests across 84 files; 23 browser
  tests across five files; both Agent Window TypeScript configurations passed.
- Image service fixtures verify workspace containment, symlink escape, exact-path
  grant and size limit. Native image browser regressions verify successful decode,
  cacheKey reload and corrupt-image error UI. Native reads use bounded allocation;
  grant lifetime and map size are bounded.

- Owner follow-up requires equal left/right motion. Normal mode already shared
  300ms and cubic-bezier(0.32, 0.72, 0, 1); the new regression reproduced a
  reduced-motion mismatch (left 300ms, right 0ms). The shared token now handles
  reduced motion for both. Real left/right panels and both gaps pass equal-timing
  assertions through open/close in normal and reduced-motion browser contexts.
- Broader Mac typecheck exposed missing renderer Window ambient types in the host
  test project (its existing preference tests import renderer modules). Including
  the existing canonical vite-env.d.ts fixes the check without duplicate types;
  Mac typecheck now passes.
- Native package observations: Review PNG previews now render; 1013px conversation
  remains readable with both sidebars expanded; growing back restores dock width.
  Side chats select/collapse/reopen keeps the thread picker at the same five
  sidechat entries observed before the reopen regression check, rather than adding another fork.

## Native captures

- [Review before image fix](before-review.png)
- [Review after image fix](after-review-images.png)
- [Narrow window with both sidebars](after-narrow.png)
- [Shared dark theme observed](dark-theme-sync.png)

## Final package

- Built at `2026-10-03T05:32:59.701Z` from `1f80d55cfb3` plus the retained working
  tree and this UI slice. Agent Window digest:
  `9f66f95d78aa15f88dabf2e606d76e48eca89844caca705e3a7862f6a5cd67cd`.
- Package check: 12/12 passed; app launched through the personal launcher.
- Final integrated browser run: 24/24 across six files, plus 1/1 explicit
  reduced-motion parity run. App/vendor and Mac typechecks all passed.
- Final CUA: Review close/reopen and conversation clicks work; repaired PNGs remain
  visible. Original Light Modern theme and project sidebar view are restored.
- [Final running package](final-review.png).

## Limits

No provider-backed sending, Git write actions, device installation, destructive
file operations or every settings mutation was exercised. Simulator runtime setup
remains a machine prerequisite. The precise user-reported cursor trigger on every
Review open was not reproduced; the interrupted-resize leak was reproduced and
fixed, and cursor/hit-area regression checks cover the concrete shared cause.

## Sidebar flyout and Settings follow-up

Owner screenshots at 12:38–12:39 Bangkok time exposed a separate navigation defect.
Native Computer Use reproduced it on the preceding package:

- With the left sidebar expanded, clicking Threads created a second Threads dialog
  over the project list. Its top edge was at 8px, inside the 46px top chrome.
  [Before: overlapping flyout](before-flyout-leak.png).
- Collapsing the sidebar and clicking Settings navigated to General while leaving
  the category sidebar collapsed. The native accessibility toggle remained off.
  [Before: missing category navigation](before-settings-collapsed.png).
- Manually expanding Settings exposed its complete category navigation; clicking
  Threads then overlaid it. This distinguishes hidden navigation from absent
  settings data. [Before: Settings obscured](before-settings-overlay.png).

Source tracing found unconditional persistent-rail flyout triggers, a `top-2`
portal, and a sidebar-expansion effect that cleared visible state without cancelling
queued hover callbacks. Settings navigation did not request sidebar expansion.

The follow-up fixes constrain Threads/Projects previews to the collapsed desktop
sidebar, cancel delayed callbacks across route/layout changes, and reserve the
46px top-chrome region. More now contains only its actions. Settings entry opens
category navigation; manual collapse remains available, and pressing Settings
again reopens it. Activity and Customize explicitly leave Settings before selecting
the requested sidebar mode.

The owner's additional spacing/settings request changes Settings to a real chrome
row followed by a scrollable content area, with everyday defaults first. OMP rows
show readable labels, effective values and apply timing; schema, path and scope
metadata remain available in Technical details. No configuration values were
changed during validation. Source review found the generic Models & writing form
called unsupported `server.updateSettings` and Git-writing APIs; it is unmounted
and hidden. Legacy model links and search terms reach the existing OMP Providers &
models surface. Sidebar active-section resolution uses the same destination rule.

Integration checks caught a stale OMP row variable after the presentation change
and two Settings-to-sidebar navigation handlers that still selected hidden modes.
These were corrected before the final runtime validation below.

Native follow-up also exposed the collapsed preview behind the conversation: the
AX tree contained Threads while its pixels were hidden. The portal was z10 and
the conversation card z15. The preview now sits at z26 (above the card and z25
resize seam, below the z30 rail), with opacity-only motion to keep its entire
surface to the right of the rail throughout opening.

### Follow-up verification

- Final package: `2026-10-03T06:18:11.882Z`, Agent Window SHA-256
  `06f7acbdc9d000f6cdfb1b456ecae5b25081e5061fb94507e287249e0b846248`.
  `check:packaged` passed all 12 checks; launched using the personal launcher.
- Agent-window unit suite plus native-file service fixtures: **472 passed**.
  After consolidating legacy search keywords into the live catalog result, the
  affected navigation/capability suite passed **15 tests** again.
- Rail/dock browser suite: **24 passed**, including equal left/right panel motion,
  geometry and interrupted resize cleanup. App and vendor typechecks passed.
  The final flyout stacking correction was verified natively below; those browser
  fixtures do not mount the complete application sidebar.
- Native Computer Use: expanded Threads produced no duplicate dialog; collapsed
  Threads displayed above the conversation and below the titlebar; Settings
  dismissed the preview and expanded category navigation. Manual collapse and
  same-route Settings reopen both worked. More showed actions only; More and
  direct rail Customize left Settings and exposed customization. Activity also
  left Settings and exposed the activity list.
- Native Settings checks: General, Appearance, Notifications, Chat behavior,
  Providers & models, AI / OMP settings, Keybindings and Capability status opened.
  OMP Technical details expanded to expose path/schema/scope while effective
  values and apply timing remained visible. The model search result opened
  Providers & models and no longer advertised the unsupported Git-writing editor.
- Layout observed at **1440×900** and **1013×748**. Restored 1440×900 and left
  Settings General open. This pass did not change provider credentials, model
  configuration, permissions or other settings. It does not certify every remote,
  authentication, destructive or live-task operation; no provider turn was sent.
- Current screenshots: [General](after-settings-general.png),
  [narrow General](after-settings-narrow.png),
  [technical details](after-settings-details.png),
  [collapsed preview](after-collapsed-flyout.png),
  [sidebar spacing](after-sidebar-spacing.png).

### Traffic-light rail seam correction (13:32 Bangkok)

The owner's next comparison identified a full-height left-rail divider crossing
native traffic lights. Native capture and source tracing confirmed the rail's
inset box-shadow at x47 ran through the 46px titlebar. Both rail dividers now use
1px background strokes whose height excludes the titlebar; their opaque material
and hit areas remain intact.

Before, the left edge pixel at (47,12) and (47,35) was RGB 233 versus neighboring
RGB 243. After, x46–48 at both rows are uniformly RGB 243. The divider remains
visible below the header (x47,y60 RGB 232). Native left/right toggles worked;
expanded and collapsed screenshots show continuous top chrome.

- [Before seam](before-titlebar-rail-seam.png)
- [After seam](after-titlebar-rail-seam.png)
- [Collapsed](after-titlebar-collapsed.png)
- Targeted rail browser tests: 6 passed, including light/dark toggle coverage.
- Package checks: 12 passed. Package `2026-10-03T06:32:01.316Z`, Agent Window
  `6dac696c71a394196dc92c503e249d27b83ea17cffa4636d4592b0810d7f0b40`.

### Forge Review, tab ordering and Settings ownership (15:15 Bangkok)

The owner requested a Codex-style dedicated Code Review destination, GitHub/GitLab
PR/MR data, OMP review and editable drafts, plus tab ordering and navigation cleanup.
Implementation is on base `1f80d55cfb3` with the existing dirty workspace preserved;
no commit or push was made. §3.F and §10 item 72 in the canonical plan define this
slice. This receipt does not claim every Codex action or the broader acceptance matrix.

Implemented behavior:

- Task tabs support persisted pointer ordering, keyboard grab/move/cancel and
  Alt+Arrow ordering. Escape, blur and lost visibility cancel drag state safely.
- The left rail Settings icon appears only when its panel is collapsed. Settings
  opens the full category navigation. The standalone Customize entry is removed;
  More no longer duplicates Settings. Both opaque rails and the shared top chrome
  retain the prior seam, transition and resize corrections.
- Cedia Settings no longer write the unsupported generic server settings route.
  Visible controls match Cedia/OMP ownership; unsupported Profile/default workspace,
  generic automation/usage/PR/recap controls are excluded. Preference writes await
  host acknowledgement and preserve newer edits through concurrent writes and
  host broadcasts. Exhausted conflicts do not restart themselves indefinitely.
- Dedicated Code Review lists provider PRs/MRs, presents Summary/Changes, activity,
  checks and details, and runs review/follow-up through normal durable OMP tasks.
  Host CLI authentication stays outside the renderer. No publish/approve/merge
  endpoint is introduced. Local drafts use durable CAS revisions and full forge
  identity. Old-revision drafts remain accessible and need explicit re-anchoring.
  OMP task association survives navigation within the app; the durable task and
  saved draft survive app restart. The association cache itself is not a durable
  cross-restart index.

Native testing found additional defects missed by component-only fixtures:

1. The native IPC allowlist omitted forge fetches and direct draft records. Exact
   method/route entries now allow only the needed fetches and GET/PATCH draft
   operations. Draft identifiers permit the adapter's full 480-character limit,
   including base64url underscores, without broadening provider route wildcards.
2. The first asynchronous diff response changed React hook order and crashed the
   view (React error 310). Diff memo hooks now run before loading/error returns;
   an asynchronous diff browser regression covers the transition.
3. The composer height clipped actions and narrow details displaced all summary
   content. Actions now remain visible; compact details have their own bounded
   scrolling region. Draft editing is collapsed until requested or an OMP result
   is imported. Generated Cursor footer HTML stays available in a disclosure.
4. Closed/merged draft PRs incorrectly displayed Draft. Lifecycle state now wins;
   pasting a PR URL selects All so closed requests remain visible in the list.

Verification:

- Agent-window unit tests plus native file service: **494 passed** (89 files).
- Native IPC bridge tests: **21 passed**, including long real draft identifiers
  and rejected arbitrary routes/mutations. Host forge fixtures: **13 passed**.
- Rail, motion, tab ordering and Code Review browser tests: **39 passed** (8 files).
  The nine Code Review fixtures cover delayed draft reads, CAS conflict, stale
  re-anchoring, asynchronous diff loading, narrow details, lost-response command
  retry, PR-switch isolation and restored OMP association. The final footer-only
  presentation change was subsequently typechecked, packaged and observed natively.
- Agent-window source/vendor typechecks and macOS typecheck passed. `git diff --check`
  passed. Broader root typecheck is not clean: the default run hit its 2 GB heap;
  a 6 GB retry reported existing upstream/script diagnostics. The full host suite
  also has the existing `router.test.ts:289` command-count expectation (47 vs 50).
  These broad checks are not reported as passing.
- Read-only live GitHub service proof: Cedia PR #1, head
  `183269762fac10f8400ba5f6fe69485f57119e73`, base
  `a87d9b29ac9e60f5847540d7e6bddbdbfa8ddb49`; **28 files**, **48,196 patch characters**,
  no truncation, matching detail/diff revision hash. List distinguishes merged #2
  and closed #1. Native final build independently displayed the same PR and diff.
- Native Computer Use: Settings collapsed/expanded gear, same-route reopening,
  More cleanup, General/Appearance/Providers/OMP categories, reversible Chats
  preference change and restoration; PR URL paste, summary, first-load diff,
  local draft save, bounded live OMP review, Open OMP task, back-navigation,
  explicit response import, draft save and recovery after app restart. One OMP
  review task was created (`forge-review-05c04884-7133-4685-b23b-c37bdff499f1`);
  its generated findings remain an unsent Cedia draft. No remote comment, approval,
  merge or push was made. OMP was instructed not to use tools or edit files.
- Layout observed at **1440×900** and **1013×748**, including expanded compact details;
  restored 1440×900. Multiple-tab reorder is browser-tested, not newly claimed as
  a native multi-task drag proof. GitLab fixtures pass, but live GitLab verification
  remains unavailable: this machine has no `glab` authentication/configuration.
- Final package `2026-10-03T08:11:45.578Z`; Agent Window SHA-256
  `8b93e54678da63c31262e5c670a009f8d32924e1549397aebaf2a0a42ea2ea22`.
  All 12 packaged checks passed; launched with the personal launcher. Final native
  Summary and Changes captures are from this package. Earlier same-turn settings,
  OMP-import and narrow captures predate the final footer-only presentation change.

Screenshots: [final summary](forge-summary-final.png), [final diff](forge-diff-final.png),
[OMP draft import](forge-omp-draft.png), [narrow details](forge-narrow-details.png),
[owned settings](after-settings-owned.png), [clean More menu](after-more-clean.png).

### Reference gap audit and Projects rail removal (17:08 Bangkok)

The owner requested another comparison against the supplied Codex review screenshot
and removal of the Projects rail icon. Removed only that launcher; expanded
project/thread navigation remains available through Threads and the sidebar.
Updated the canonical §3.E contract and vendor adaptation record.

A read-only source audit confirms this is not complete Codex feature parity:

- The sidebar currently renders state-filtered repository lists, not Authored by me,
  Needs my review, or team-review groups. Host viewer/requested-reviewer data exists
  but is not projected into those groups. List pagination stops at the bounded first
  page; there is no Show more control.
- No independent PR tab/pin strip, stack display, reviewer-request control, review
  settings button, title/body editing, Draft status dropdown or Mark ready action.
- Activity renders only the first 12 commits, not the full event timeline/filter.
  Comments/reviews are capped at 4/6 and file summary at 8; there is no complete
  expandable discussion browser. This is an important remaining read-only UX gap.
- Diff works, but inline comment markers, thread replies, line-anchored drafts and
  file-level commenting are absent. Current drafts are global per PR snapshot.
- The review composer lacks attachments and a model selector. OMP task links are
  cached through navigation but not indexed durably for rediscovery after restart.
- Publish comment/review, approve/request changes, reviewer requests, mark-ready,
  title/body mutations and merge are not implemented. The earlier accepted slice
  deliberately implemented read/diff/OMP/local-draft operations; the screenshot
  does not turn those missing mutations into working features.
- GitLab live verification remains unavailable without glab/auth. Fixture support
  is not a claim of verified live GitLab parity.

Priority for a subsequent implementation slice: complete discussion/activity access,
inline drafts, viewer/reviewer grouping and pagination first; then durable review
navigation and explicitly designed provider mutation workflows. No additional
provider mutation or parity feature was implemented during this bounded audit.

Validation: Agent Window source/vendor typechecks and all 12 package checks passed;
`git diff --check` clean. Native Computer Use confirms no Projects rail button in
expanded or collapsed mode, existing project lists remain, and Code Review still
opens its sidebar from collapsed mode. Restored the user's previously viewed PR #2.
Package `2026-10-03T10:06:36.236Z`. [Native screenshot](rail-without-projects.png).

## 2026-10-03 follow-up: right dock resize and last-tab investigation

The owner reported sluggish right-panel resizing and a missing close action when
only one pane remained. Native Computer Use on the previously packaged build
confirmed that a single Files pane showed only Add/Maximize in its header. Source
tracing found an explicit `panes.length > 1` condition suppressing its tab.

A native drag moved the empty-draft Files divider from x977 to x782 at 1440×900.
The same drag with a project thread and the 61-file working-tree Review pane did
not advance the divider toward x803. The drag acceptance path repeatedly changed
and measured composer geometry on each animation frame and rejected the entire
candidate when it exceeded the composer limit. This provides an observed failure
path; static screenshots do not establish frame rate or input latency.

The implementation under verification snapshots composer constraints at drag start,
projects candidate widths numerically, clamps to the usable boundary, and restores
one-pane title/close controls. Open/close motion retains its shared 300ms timing;
dragging must disable width transitions. The native regression checks and final
package identity will be recorded after integration, not inferred from this trace.

[Heavy diff baseline](right-dock-heavy-before.png).

### Official Codex documentation cross-check

Consulted [Code review](https://learn.chatgpt.com/docs/code-review?surface=app)
and [GitHub integration](https://learn.chatgpt.com/docs/third-party/github) on
2026-10-03. The app guide distinguishes local checkout review from the PR
workspace and separates agent review chats from publishing provider feedback.
It documents revision-specific viewed markers, review instructions, PR queues,
related stacks, linked chats and checks context. Cedia reuses its local diff
presentation and retains OMP ownership; Codex's connected automatic cloud review
service is not an additional Cedia execution owner. The approved implementation
scope remains §3.F.1, with per-project instructions and registered-repository
boundaries rather than an unverified claim of complete Codex service parity.

### Workflow integration and independent review

The GitHub workflow now has typed host reads and mutations, paginated queues,
activity and review threads, explicit UI confirmations, and SHA-bound durable
command receipts. Provider credentials remain in the host's `gh` process.
Uncertain remote outcomes retain an `outcome_unknown` receipt rather than issuing
a second write. OMP commands claim a durable command-to-task binding before
execution, preserving the actual prompt/follow-up/steer kind on retries and
concurrent binding races. Inline drafts use host-owned CAS records.

Independent review identified and corrected UTF-8 octal Git path decoding,
fork-author management permissions, long activity-body preservation, and retry
binding edge cases. A final host run passed 45 tests / 126 assertions, including
23 isolated mutation matrix tests. Live GitHub reads against Cedia PR #1 verified
overview, activity pagination and the empty-thread response; list pagination
returned PR #2 then #1, and the merged filter returned only #2. No provider write
was sent. Populated live thread pagination and live mutations remain unverified;
GitLab authentication/CLI is unavailable locally.

The initial integrated browser run timed out in four geometry tests under
parallel file execution. Re-running the unchanged tests serially passed all
47 tests across 10 files in 41.55 seconds. The timeout run is not counted as a
pass; the serial run is the geometry verification evidence. Later UI integration
checks and the final native package receipt follow below.

### Arc-guided component cleanup and additional reproduced defects

The owner requested [Arc AI guidance](https://uiarc.dev/docs/ai) for this same
Code Review workspace. The implementation uses its free composition, tabs,
filter-toolbar and comment-thread patterns through Cedia's existing primitives.
No Arc foundation, global font, second theme or new UI dependency is installed.
Cedia retains visible keyboard focus and the host-owned palette. This is a
bounded application of the guidance, not a claim that every Arc checklist item
or every mobile breakpoint has been certified.

Native review of GitHub PR #1 exposed commit activity with blank messages and
“Unknown date”. GitHub's committed timeline events carry `message`, `author`
and `committer.date`, unlike issue events. The host now maps those fields and
preserves event labels. The added regression plus the complete forge host suite
pass: 46 tests / 127 assertions. No provider write was performed.

A repeated native dock drag remained inconsistent after the initial numeric
constraint fix. A new browser regression reproduced another concrete cause:
parent rerenders recreated resize options, triggering the storage-restoration
effect while a drag was active. It restored 320px over the active 400px width.
Suppressing restoration during the active drag made the same test pass; the
resize-rail suite passed 9/9. Native release verification follows below.

The UI cleanup shares the OMP review controller between the instruction action
and composer, separates presentation from mutation identity/receipts, shares
provider/revision-warning components, and improves narrow filters and keyboard
tabs. Confirmation scope and unknown-outcome command identity remain covered by
browser regressions. Final integrated counts and package identity follow below.

### Final integrated verification (2026-10-03, 19:38 ICT package)

- Agent-window + vendor TypeScript checks: passed.
- Browser suite: **55/55**, 10 files, 17.21 seconds. Covers shared header/composer
  single-flight dispatch, lost OMP responses across remount and delayed task
  association, storage-failure recovery, stale instruction reads, frozen remote
  mutation targets, unknown mutation command reuse, inline drafts, geometry,
  panel motion, cursor cleanup and final-tab controls.
- The first storage-recovery fixture intercepted an unrelated app-preference
  write during mount; it was corrected to reject only the OMP ledger key. The
  final complete suite above passed, rather than counting that fixture failure.
- Forge host suite: **46/46**, 127 assertions. Live read-only GitHub repeated
  successfully; the commit event now includes a real timestamp and message.
- `package:mac`, `check:packaged` (12 checks), personal launch and `git diff
  --check`: passed. No commit or push was made.

Package timestamp: `2026-10-03T12:38:32.397Z`. Checkout base:
`1f80d55cfb3cd8e9961b9591d74d27146a57487e` (dirty working-tree implementation;
see the current checkout for the full source diff). Agent Window asset SHA-256:
`d9e60f9ad24da0b14208c1c8691f8bb7098e1529580a8f45c350fc020c4d5984`.
Native main SHA-256:
`4f9cbbd67f6c21996edaae08263bb6b0ab99db8ccca6f195fdb572c22c2914d1`.

Native Computer Use on that package verified the 220px review sidebar without
filter overflow, two-line request titles, Summary/Changes keyboard arrow
navigation, populated commit messages/event labels, disabled Mark ready on a
closed draft, and the OMP instruction popover. The shared diff controls render
in the dedicated PR workspace. Closing the last visible Diff tab returns the
empty-panel launcher and clears its Review selection.

A heavy 65-file working-tree diff widened from divider x960 to x720 at
1440×900. Subsequent reverse-drag attempts did not provide a reliable native
result: Computer Use intermittently returned unchanged images and then
`noWindowsAvailable`, even though accessibility clicks, keyboard navigation,
process checks and fresh app reads remained available. Reconnecting the JS
runtime did not restore drag execution. **Repeated native dragging and measured
latency remain unverified**; the browser regressions establish the corrected
render/storage path, not a native frame-rate claim.

Screenshots: [review summary](code-review-arc-summary.png),
[instructions](code-review-arc-instructions.png),
[shared PR diff](code-review-arc-diff.png),
[heavy dock](right-dock-heavy-after.png),
[visible single tab](right-dock-single-tab-after.png).

The final review also found that in-memory OMP retry IDs were insufficient after
navigation. Unresolved requests now reserve a durable ID and frozen payload
before dispatch, excluding subsequently discovered task IDs from retry identity.
A storage failure clears pending UI state and fails closed; it cannot silently
start another turn. The pure ledger is separate from the per-review controller.

External qualifications remain explicit: GitHub mutations were verified with
isolated fixtures only; no comment, review, lifecycle or merge write was sent to
a live provider. GitLab live authentication is unavailable, and its GitHub-style
mutation workflow is not implemented. This does not claim complete Codex cloud
service parity or completion of the broader item-70 backlog.

## Sidebar click growth and right drag-open follow-up (2026-10-03, 20:30 ICT)

Native Computer Use reproduced the reported left seam click bug: the expanded
shell grew from x304 to x352 without dragging. `SidebarRail` measured the full
icon-mode container (48px rail plus panel), then stored that measurement in the
panel-only CSS variable. Pointer-down also wrote the value before movement.
The fix excludes the persistent rail and only commits/persists actual drags.
Collapsed presses leave the remembered panel width untouched.

Three browser regressions cover repeated clicks, exact drag delta, and collapsed
reopen. Before the fix the first two failed by exactly 48px. The rebuilt app
accepted three coordinate seam clicks with its edge stable at x352. A subsequent
native drag narrowed it, and the header toggle collapsed/reopened the panel.
See `left-seam-click-fixed.png` and `left-reopen-width-fixed.png`.

The owner's follow-up adds right-panel inward drag reopening. Its desktop seam
is outside the clipped/inert dock, below the titlebar, and reuses SidebarRail's
pointer lifecycle with an explicit reopen option. Dragging left at least 24px
reopens the retained dock without overwriting saved width. A browser regression
verifies hit-testing, reopening, and the retained 440px container width. It failed
before implementation because the seam did not exist. Native accessibility and
click testing confirms the seam opens the panel launcher. Native drag attempts
through Computer Use did not open it, so native drag qualification remains open;
this is not attributed conclusively to either the app or the automation service.

Validation on this dirty working-tree revision based on
`1f80d55cfb3cd8e9961b9591d74d27146a57487e`:
- Browser suite: 59/59 across 10 files (`/tmp/cedia-reopen-all.log`).
- Agent-window and vendor TypeScript checks: exit 0 (`/tmp/cedia-reopen-types.log`).
- macOS package and packaged checks: exit 0 (`/tmp/cedia-reopen-package.log`,
  `/tmp/cedia-reopen-packaged-check.log`). Rebuilt app launched using the personal
  launcher; no remote writes or provider turns were sent for this follow-up.

## Code Review main New tab (2026-10-03, 20:55 ICT)

The owner's screenshot is implemented as peer browser tabs in Code Review's top
bar. The plus action creates native browser tabs; selection, title updates and
closing reuse the existing browser state/service. Browser tabs use the UI-only
`cedia-main-browser:code-review` namespace, not an OMP thread. The main-tab
BrowserPanel variant hides nested tabs, agent attachment, annotations and
capture-to-composer while retaining address/search, navigation, reload, copy
screenshot/link and browser actions. The blank home shows working Cedia tools
(Code Review, New chat, Settings) and that browser owner's recent pages. Tabs
are retained within the app window session, not restored across app relaunch.

Independent review caught two new selection issues, both corrected before the
package: delayed browser operations cannot override a newer PR selection, and
closing the underlying selected PR while browsing updates the fallback review
route instead of resurrecting a closed tab when the browser closes.

Verification:
- 62/62 browser tests across 11 files, including peer-tab lifecycle and delayed
  selection regression; main-tab BrowserPanel controls tested with native mocks.
- Agent-window/vendor typecheck, macOS package, packaged checks: exit 0.
- Native Computer Use on rebuilt Cedia: plus opened New tab; URL entry loaded a
  real page and updated its top-tab title; selecting PR hid native web content;
  a second blank tab showed the recent page; closing it restored the first page;
  closing the final browser tab restored the selected GitHub PR summary.
- Screenshot: `code-review-new-tab.png`. Logs: `/tmp/cedia-newtab-all.log`,
  `/tmp/cedia-newtab-final-types.log`, `/tmp/cedia-newtab-package.log`,
  `/tmp/cedia-newtab-check.log`. No OMP turns or remote provider writes occurred.

## New tab usability correction and trailing close controls (2026-10-03)

The earlier New tab receipt missed immediate keyboard entry and the New chat
shortcut. Reproduction found that main-header tab creation bypassed the dock's
address-focus handler. BrowserPanel now focuses/selects its address once a blank
main tab is visible and ready. The New chat shortcut previously navigated to the
index route, which restores a previous session; it now uses the existing fresh
chat handler to create an unsent draft. Regression assertions failed before these
fixes and passed afterwards.

Native Computer Use on the rebuilt app verified plus → type URL → Enter loads
example.com without first clicking the address field. Mouse selection/paste and
Enter then navigated to example.org. The New chat tile opened a new route with an
empty composer and “What should we work on?” heading. One shortcut-based address
replacement attempt did not select all text reliably; mouse triple-selection
worked. This receipt does not qualify all native keyboard shortcuts.

The owner's trailing-close follow-up exposed two SurfaceTabChip modes: dock tabs
already used a trailing close button, while terminal groups/panes still replaced
the leading icon with a close control on hover. Removed that legacy mode and its
unused style constants. All shared surface tabs now keep their identity icon and
render an explicit trailing close button.

Automated validation: 63/63 browser tests across 11 files and both TypeScript
checks passed (`/tmp/cedia-close-right-tests.log`, `/tmp/cedia-close-right-types.log`).
No OMP turn or remote review write was sent for these checks.

Final package and packaged checks passed (`/tmp/cedia-close-right-package.log`,
`/tmp/cedia-close-right-check.log`). Computer Use on that build opened a second
terminal tab, visually confirmed trailing close buttons on both, closed Terminal
2 through its close button, and confirmed Terminal 1 retained its trailing close
control. Evidence: `right-tab-trailing-close.png`.

## Explorer menu mouse hit-testing (2026-10-03, 21:23 report)

Reproduced on the personal packaged app: Add panel → Explorer succeeded through
an accessibility action, but a coordinate mouse click at the same visible row did
nothing and left the popup open. The row overlapped BrowserTabStrip's native
window-drag rectangle. HTML stacking alone does not exclude a popup from that
native drag hit region.

MenuPopupBase now explicitly marks its complete portal positioner rectangle as
`-webkit-app-region: no-drag`. This shared fix also covers submenus. The same
coordinate click (1236,110 in the captured window) on the rebuilt app closed the
menu, selected Explorer, and displayed the file tree/search. Receipt:
`explorer-menu-mouse-fix.png`. This is a physical pointer check, not only an AX
activation or a DOM test.

Validation: 63/63 browser tests, agent-window/vendor typechecks, macOS package and
packaged checks all passed. Logs: `/tmp/cedia-explorer-menu-tests.log`,
`/tmp/cedia-explorer-menu-types.log`, `/tmp/cedia-explorer-menu-package.log`,
`/tmp/cedia-explorer-menu-check.log`. No provider turn or remote write was made.

## IDE/Agent visual alignment investigation (2026-10-03, 22:22 report)

Native inspection confirms Cedia's IDE retains the full Code-OSS workbench and
uses the same dark surface family as its Agent window. The reference's different
appearance is principally geometry and density: the native IDE titlebar is about
35px high in the captured window, while the Agent header contract is 46px. Keep
Explorer, editor groups, SCM, debug, terminal and status bar intact; align chrome
geometry, type scale, dividers and interaction states through the owned workbench
patch/theme bridge. Do not force the historical CEDIA colorCustomizations over a
user-selected theme. provider-chrome intentionally removes only legacy owned
palettes, and existing native-workbench tests protect user overrides.

Cursor's official themes documentation supports VS Code themes and customization
(https://docs.cursor.com/en/configuration/themes); its keyboard reference exposes
editor/panel layout controls (https://docs.cursor.com/advanced/keyboard-shortcuts).
These establish supported customization, not Cursor's private implementation.

A separate native defect was observed during this investigation: the embedded
Agent webview ultimately reports “Cedia Agent request timed out:
vscode:cediaAgent”, while the IDE host status says Cedia ready. This is not a
palette issue and IDE Agent-dock functionality is not qualified by this visual
audit. No large IDE shell/layout rewrite has been applied in this slice.

## Recent-page polish and IDE bootstrap follow-up (2026-10-03)

The Code Review New tab home now uses an extracted CodeReviewBrowserHome component.
Tool cards and recent pages have token-based hover/focus feedback, reduced-motion
support, and trailing accessible dismiss controls. Dismissals persist per browser
owner without closing live tabs. Repeated native snapshots do not resurrect a
dismissed URL; deliberate navigation back to that URL can restore it. Native CUA
removed the three Example Domain QA entries (example.com, example.org, and the
malformed combined URL). The two unrelated Google entries remain. Switching
project and returning to the browser tab preserved the dismissals. Screenshot:
`recent-pages-dismissed.png`.

The IDE bootstrap previously awaited session synchronization before replying to
the webview, while the 750ms handoff poll could start duplicate synchronizations.
It now replies before handoff synchronization, coalesces concurrent polls, guards
view generations, and stages context until the shared UI is ready. The regression
test holds synchronization beyond a polling interval and verifies a single sync
and context delivery.

Native verification on the rebuilt package: the IDE Agent dock now renders its
composer and model controls; Recent threads and New task respond. The native
editor opened docs/README.md and retained Explorer and Terminal. The previously
selected Home conversation still reports “This conversation didn't load” after
restoration; this is a remaining conversation/handoff qualification gap, not a
claim of complete Agent execution verification. No provider turn was sent.
Screenshot: `ide-agent-bootstrap-restored.png`. The broader IDE geometry alignment
remains a recommendation; no titlebar/workbench layout rewrite was applied.

Verification:
- Browser suite: 64 tests passed; affected final CodeReviewWorkspace tests: 4 passed.
- Agent-window and vendor typechecks passed.
- IDE host/workbench tests: 57 passed; final strengthened host test run: 8 passed.
- Shared-theme tests: 29 passed.
- package:mac and check:packaged passed, then the personal launcher opened the build.
- Agent asset stamp: 400792f7aa65425f02cb12b6e5c8eddd7701d9ff9c804e9d9666ebd6c4ed39f7.
- Logs: /tmp/cedia-home-final-test.log, /tmp/cedia-home-final-types.log,
  /tmp/cedia-home-ide-regression.log, /tmp/cedia-home-ide-final-test.log,
  /tmp/cedia-home-ide-package.log, /tmp/cedia-home-ide-check.log.
