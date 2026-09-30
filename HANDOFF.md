# CEDIA handoff

Status, next actions and the acceptance contract all live in the one authoritative plan:

[docs/maintenance/CEDIA-PLAN.md](docs/maintenance/CEDIA-PLAN.md)

Planning is complete for the inspected OMP pin. Begin at the plan’s opening implementation
reading contract, then §8 and §10 item 70. Item 69 and Wayfinder tickets record the completed
decision process; they are not a new questionnaire.

Documentation map: [docs/README.md](docs/README.md)

- §0 - product definition (owned Agentic-IDE, OMP harness)
- §2–§3 - integration/capability inventory, queue/draft/cleanup/lifecycle protocols, task behavior and screen contract
- §6 - SSOT, settings/migration/branding and remote design gates
- §8 - R1–R8 integration sequence and Mac / remote-web / native-iPhone / full pinned-OMP checkpoints and O01–O12 completion packets (S1–S5 are historical stages)
- §9 - landed work, with a receipt for each
- §10 - **what is open right now**; the only authoritative list of unfinished work
- §14 - CEDIA rename ledger (runtime identifiers still migrate in order)

Superseded handoffs were deleted, not archived: git history holds them, and keeping them in the
tree would create a second owner of truth.

## Current source baseline (2026-09-30)

The owner authorized a baseline commit of the accumulated source, tests, patches and
cited evidence. Current verification and explicit exclusions are recorded in
[the baseline receipt](docs/maintenance/evidence/baseline-snapshot-2026-09-30/findings.md).
The plan's opening status and item 70 now reflect OMP 18.4.3 and 1,101 mappings.
Documentation validation still reports 105 existing failures; the packaged app is absent
from this checkout. D/W/N/F acceptance remains open. Earlier receipts below keep their
original scope and are not evidence that a package is currently installed or running.

## Historical checkpoint (2026-09-28, with September 29 follow-ups)

- Branch `main`, revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, working tree dirty by design.
  Existing unrelated changes were preserved. Nothing was
  committed, pushed or published, and no branch was reset or cleaned.
- Pinned runtime: OMP `18.4.3` (`fc671eba38`). Coverage audit re-generated for the pin: `evidence/omp-complete-scope-2026-09-29` (1101 mappings; Integrity PASS 0 fatal 0 gaps; `--require-complete` F completeness PASS). Standalone rebuilt (`omp/18.4.3`, packaged-editor test green). Adopt-after-EOF failure root-caused to test EOF inside the ~57KB startup burst (test-only quiescence gate; 44/44 file). 552/552 host+adapter with `CEDIA_OMP_BINARY=dist/omp/omp`. `package:mac` + `check:packaged` 12/12 on the new build; send-race proof repaired to stage-time shim with the CUA edit half gated on a human operator (no Screen Recording permission in this context). Receipt: `docs/maintenance/evidence/df-closeout-1843-2026-09-29/findings.md`, plan §13. Still open: packaged Send/edit CUA half, real Login Item cycle, paired-client repeats, W (tailnet), N (iPhone).
- O08 qualified TUI presence now uses a host-authored private task context, explicit
  `cedia-omp --cedia-session-dir` launch and trusted lifetime lock. The same interactive OMP
  process publishes authenticated `inspect_only` status; controller claim and host adoption are
  refused. A provider-free PTY run observed publication, refusal and SIGINT cleanup. The refreshed
  development runtime is source-attested (tree `bc8f98db7bc844e0da9dde596a465ceaefd1feab`,
  patch SHA `57720486da416bbb155976ea92c113265799efed80e8b589ef5763343c012b87`); host
  affected tests 68/68, OMP owner tests 9/9, Agent Window 414/414, typechecks and coverage pass.
  Receipt: `docs/maintenance/evidence/o08-qualified-tui-presence-2026-09-28/findings.md`.
  Interactive TUI control, uninstrumented owners, packaged selection and D/F acceptance remain
  open. Read-only `sfltool dumpbtm` now lists enabled `Cedia` (`2.com.cedia.editor`, generation
  10) at the persistent `VSCode-darwin-arm64/Cedia.app/`. Logs show the URL changed from a
  lifecycle sandbox bundle to the persistent path at 13:45:08 on Sep 28, before the final staged
  proof at 14:07:34. That staged proof's shim logged interception of both Login Item setter calls
  and simulated `openedAtLogin:false`; the logs show no update to its temporary bundle URL. The
  persistent Cedia process began at the same time as the earlier CUA resolution of an app named
  `Cedia`; the logs cannot attribute which event launched it. It was left open, and not closed or
  interacted with, during the final staged proof. The proof did not use the personal launcher,
  which deletes the named Cedia/Caret Safe Storage Keychain items. This does not establish a real
  login cycle.
- O07 native goal restart lifecycle: `bun scripts/omp-goal-restart-smoke.ts` passes both cases
  against OMP 18.1.18: explicitly paused before shutdown stays paused; active at shutdown returns
  paused with the same id/objective/budget. The active case enables RPC continuation against a
  local held fixture and verifies zero requests after recovery until owner resume, followed by
  exactly one request. The RPC goal bridge now reconciles OMP's persisted `goal`/`goal_paused`
  mode on its first goal request. It was rerun after source audit and patch/runtime refresh on
  the fully attested source tree `1543a4c9ee84f8e3fb195023a47e1082176200ec`; receipt:
  `docs/maintenance/evidence/o07-goal-restart-live-2026-09-28/findings.md`.
  O07 and F remain open; this is not a packaged or full acceptance proof.
- O07 Muse subagent follow-up selected/read back the exact approved model and authenticated
  provider metadata, then dispatched one bounded `/tan` turn. It verified the completion marker,
  stale-incarnation 409 with no receipt, revive to idle and unchanged transcript/no unrequested
  turn. The local fixture found and fixed an OMP allowlist mismatch: transcript RPC now accepts only
  exact session files from runtime-owned `kind: sub` rows, while arbitrary paths remain refused.
  Extended canned-loopback proof verifies 2 child messages, JSONL/`nextByte` agreement, revive to
  idle and replay. Runtime was refreshed and attested before the one Muse turn; no retry followed.
  Receipt: `docs/maintenance/evidence/o07-agents-muse-transcript-2026-09-28/findings.md`.
- O03/F credit-policy follow-up: a mock spendable report invokes one redemption without the
  CEDIA guard and zero with it, including a fresh guarded session. The host's owner usage route
  answered before and after reconnect while stored `autoRedeem=yes` remained effective `no`; the
  stored setting was not rewritten. A separate simulated 429 regression now proves the unguarded
  positive-control retry and the guarded refusal: one original model call only, no usage or credit
  listing, no mock redemption, and no attempt key. Patch/runtime refreshed and source-attested on
  tree `44f96f536568fd5c34444af5a303ae53b856d423`. Real entitlement, reload and external CLI attach
  remain open. Receipt:
  `docs/maintenance/evidence/o03-credit-guard-usage-reconnect-2026-09-28/findings.md`.
  429 receipt: `docs/maintenance/evidence/o03-credit-guard-limit-retry-2026-09-28/findings.md`.
- O04 current-runtime settings requalification passed on source-attested OMP 18.1.18 tree
  `7e0ac3862e0c849b4467c508b8b3c175217968cc`: the live owner inventory returned 498 keys, all
  classified (`immediate=13`, `turn_boundary=416`, `new_session=39`, `reload=30`), with isolated
  write/readback and stale-revision, protected-key and invalid-value refusals. The first rerun
  exposed a stale O07 operation fixture in the smoke driver; it was updated and the corrected run
  passed. Focused host/OMP tests passed 36/36 (4,152 expectations), and OMP typecheck passed.
  The OMP Settings introduction's stale claim that timing was unclassified is corrected; its row
  helper suite passes 7/7 (28 expectations), and root typecheck passes after the copy change.
  Receipt: `docs/maintenance/evidence/o04-settings-apply-classification-2026-09-24/findings.md`.
  Packaged settings, a running-window conflict choice and a two-window settings record remain open.
- O01 queue-drop settlement now has a live, provider-free proof on the refreshed and
  source-attested development OMP 18.1.18 runtime (`d0105be6509186319c7ae76249d1dc61932c7967`,
  patch SHA-256 `4e98f7bd1ba70243eff621fdde8413af416d39fcbfeedc7bee124d3bea67535e`). A prompt was
  held at a local loopback endpoint, a follow-up entered OMP's queue, and `queue.drop(last)`
  returned that text and settled only its queued intent as `cancelled`. The fixture observed no
  second request, and internal IDs were absent from the public response and durable receipt.
  Host tests pass 48/48 (300 expectations), OMP queue tests 6/6 (15 expectations), and root/OMP
  typechecks pass. The packaged queue-panel capture remains open. Receipt:
  `docs/maintenance/evidence/o01-queue-drop-live-2026-09-28/findings.md`.
- O06/F same-session TypeScript extension add/remove now works on the pinned development
  runtime for a CEDIA-hosted RPC-UI session. SDK/session and RPC/RPC-UI/ACP reload paths stage and
  commit the runner, provider, tool and command generation; interactive shortcuts refresh.
  The source-attested same-PID, provider-free host probe passes add, same-path replacement,
  failed-candidate rollback, removal and stale-selected-command refusal with zero inference.
  The attested source tree is `4b1bc9e823471bea7a50022bd341a10e78b0b18b`, patch SHA-256
  `bc82e38716491753e9776a9c00d8611b9d4a2eae961613e5e65fd56605bfde61`; targeted OMP
  tests pass 343/343, and root/OMP typechecks pass. Receipt:
  `docs/maintenance/evidence/o06-extension-live-transaction-2026-09-28/findings.md`.
  Requalified on this checkpoint's later source-attested tree
  `7e0ac3862e0c849b4467c508b8b3c175217968cc`: the same-PID acceptance smoke again passes generation
  replacement, baseline preservation, failed-candidate rollback, removal and stale-selection
  refusal; OMP focused tests pass 134/134 (927 expectations), OMP typecheck passes, and inference
  remains zero. The earlier red generation-primitives probe is an intermediate result superseded by
  this transaction proof.
  Packaged Mac capture, standalone interactive/ACP concurrent reload, live shared-source
  provider replacement across live subagents, and remaining O-packets are open, so O06/F are not accepted.
  Reload currently refuses while another live session shares the model registry.
  The earlier checkpoint receipt records the pre-transaction red probe. The host follow-up projects pushed command catalogs through
  host task snapshots/events, refreshes the provider-command query on initial snapshot/catalog
  changes, and refuses a selected command removed since selection before dispatch. Rejected sends
  retain the menu marker for retry; queue and running-turn steer/follow-up refuse a selected command
  before it can become model text. The marker is now in the shared Mac draft, survives renderer
  reload and second-window hydration in fixture tests, and clears on first-token change or accepted
  send; packaged two-renderer interleave is still unproved. Manually typed slash text remains ordinary prompt text. Receipt:
  `docs/maintenance/evidence/o06-extension-hot-reload-gap-2026-09-28/findings.md`.
- O08 gained a typed inspect-only persistent local read client for CEDIA-hosted RPC owners.
  Protocol v2 added the bounded reader; the current wire protocol v3 authenticates owner identity
  and correlates request IDs. Only `get_state` and `get_available_commands` pass through the OMP
  dispatcher, with bounded/redacted
  projections. A refreshed-runtime proof reads with the credit guard off, refuses a prompt method,
  detaches, and confirms the same owner and primary RPC remain alive. A subsequent source/runtime
  slice adds one authenticated controller after primary EOF: the host adopts that same session and
  PID without spawning, commands/events use OMP's dispatcher, and interactive replies are fenced
  to the lease. Explicit spawned-owner close sends an acknowledged shutdown frame before EOF;
  crash-style EOF preserves the owner. On the attested development runtime, OMP controller tests
  passed 7/7, host tests 48/48 (including real owner adoption after EOF) and adapter tests 83/83.
  `ownerStartedAt` remains a bridge marker,
  independent CLI/TUI owners have no endpoint, and full crash/permission recovery and packaged
  O08/F acceptance remain open. A later
  owner-only `GET /v1/owners` lists persisted CEDIA task states; the Agent Window Task controls
  picker can select and explicitly attach a live task through the host's re-probed start path,
  then navigate to it. Host tests pass 49/49 and Agent Window tests 414/414. Independently started
  CLI/TUI owners are still undiscoverable; packaged owner selection remains unverified. Direct
  external SIGTERM had intermittently left a stale endpoint after publication; the bridge now
  registers with OMP postmortem before publication and removes its record/socket on a cooperative
  signal exit. The real-child test and a 12-run immediate-signal loop pass on the refreshed,
  source-attested development runtime. SIGKILL still leaves an explicit unknown-outcome refusal;
  the separate provider-free task recovery now passes after acknowledgement and exact dead-owner
  reconciliation. A separate provider-free host-process SIGKILL/restart proof now adopts the same
  idle task, incarnation and surviving OMP PID, then reads the live summary with zero provider
  requests. A staged packaged-app-owned-host proof now starts its bundled host and pinned OMP
  runtime from scratch state; after SIGKILL/relaunch, the same host, idle owner, task and
  incarnation survive and the owner summary remains available. A current-source staged proof also
  keeps one loopback-held turn running through app SIGKILL/relaunch with the same host/OMP owner,
  confirms the prompt was not replayed, and settles it by explicit abort. A real Login Item cycle
  remains unverified.
  Receipts:
  `docs/maintenance/evidence/o08-owner-read-broker-2026-09-28/findings.md`,
  `docs/maintenance/evidence/o08-owner-controller-2026-09-28/findings.md`, and
  `docs/maintenance/evidence/o08-known-owner-selection-2026-09-28/findings.md`, and
  `docs/maintenance/evidence/o08-owner-sigterm-cleanup-2026-09-28/findings.md`.
- O08 process-start identity now travels separately from `ownerStartedAt` in protocol v3. The OMP
  owner bridge records macOS `ps lstart` under a fixed locale/timezone; the host independently
  checks the PID before opening the socket, then compares authenticated identify/status and
  controller-claim identities. Protocol v2 owners are refused. The prepared development runtime
  is source-attested on tree `7e0ac3862e0c849b4467c508b8b3c175217968cc`, patch SHA-256
  `d76cd4d7db1418923ec7d8e73221261484eb06e871df05b04f2d82724d141afb`. Host/CLI tests pass
  26/26, host owner-service tests 7/7, OMP owner tests 11/11, adapter tests 9/9, and root/OMP
  typechecks pass. The timestamp is one-second resolution; same-second PID reuse, uninstrumented
  owners, packaged qualification and D/F acceptance remain open. Receipt:
  `docs/maintenance/evidence/o08-process-start-identity-2026-09-28/findings.md`.
- D native-editor `confirm` packaged reread: the phase-aware driver now passes on a staged Cedia
  app. One approved Muse prompt used the real composer and editor bridge, matched the apply
  request's handle/version/hash to the prior native read, clicked the visible production approval,
  and completed. Monaco read back `unsaved edited`; disk stayed `disk original\n`. The public
  webview asset base was fixed so icons load under `localResourceRoots`; CUA verified the staged
  dock and composer. One expected optional editor-icon 403 fallback and the Node 24 `[DEP0169]`
  warning are separately recorded; no unexpected renderer/resource errors occurred. The run used
  one paid Muse prompt and OMP's source-attested development launcher. Receipt:
  `docs/maintenance/evidence/o11-native-confirm-packaged-reread-2026-09-28/findings.md`.
- D packaged Send/edit race now passes with Computer Use in the actual IDE Agent dock while the
  fixture OMP ACK is held: revision 2 persists before release, the delayed revision-1 write gets
  HTTP 409, the old clear is refused, and exactly one prompt is journaled. Restart and legacy
  draft-migration checks remain open. Receipt:
  `docs/maintenance/evidence/r2-send-race-packaged-cua-2026-09-28/findings.md`.
- D provider-free task crash recovery now passes against OMP 18.1.18: SIGKILL during a running
  prompt records `outcome_unknown`, restart is refused until explicit acknowledgement, and only
  the exact dead task/incarnation owner endpoint is cleared before a later turn. A separate proof
  SIGKILLs the host while its idle OMP owner survives, then adopts that same task/incarnation/PID
  from a new host and reads its summary with zero provider calls. The summary check also now
  respects OMP's internal transcript id as distinct from the CEDIA task id. These host/task proofs
  do not prove app-owned host startup or active-turn packaged-app recovery. Receipt:
  `docs/maintenance/evidence/r3-task-crash-recovery-2026-09-28/findings.md`.
- D host-process crash/restart adoption passes on OMP 18.1.18: host PIDs `80497` and `80506`
  adopted task `1aa4fea1-2b2e-484d-8cb7-35c6cac8d54d` / incarnation
  `d5276470-cf38-47ae-9752-83d045ad16f4` with the same OMP PID `80500`; owner summary was
  available and provider requests were zero. Receipt:
  `docs/maintenance/evidence/r3-host-crash-owner-adoption-2026-09-28/findings.md`.
- D staged packaged-app crash/relaunch attachment passes on OMP 18.1.18: after SIGKILL and relaunch
  on the same scratch profile, Computer Use saw the existing project/task, with the same
  harness-owned source host, task incarnation and OMP owner PID; the summary remained available
  and provider requests were zero. This is UI reattachment to an existing host, not app-owned host
  startup or active-turn recovery. Receipt:
  `docs/maintenance/evidence/r3-packaged-app-crash-reattach-2026-09-28/findings.md`.
- D app-owned packaged-host startup/recovery passes on attested OMP 18.1.18, including a
  current-checkout rerun: a staged app started its bundled host from a blank scratch profile,
  created a task and attached the correct task/incarnation owner. After app SIGKILL/relaunch, the
  same host PID, task/incarnation and OMP PID survived; the summary remained available and there
  were zero provider requests. Computer Use saw the project/task in the staged app. The rerun's
  current host SHA is `208d92846782bcac5b6992d9d6b41c3e26b99d3f007054e61699020266f5a24b` and
  attested OMP SHA is `9c4619f443a0458f240c2c282d34c890529aa2dba90eb882051cb503668f7cfa`.
  A follow-on current-source packaged run types an unsent prompt in the real composer, verifies
  the host revision, clears the renderer-local caches, SIGKILLs and relaunches the staged app, and
  confirms the same text returns to the selected composer from the surviving host. Computer Use
  saw the restored text; provider requests remained zero. The cause was TanStack route updates
  using `pushState` without a DOM `hashchange`; both renderers now subscribe to app-history changes,
  with periodic host reconciliation as a fallback. The draft UI-hydration subscenario passes; the
  combined §11.1 shared-draft row remains open. A current-source proof holds one turn at a loopback
  model endpoint while SIGKILLing and relaunching the staged app; the same host and OMP owner retain
  the single running turn, the prompt is not replayed, and explicit abort settles it as cancelled.
  No external provider is called. This closes the active-turn app-crash/relaunch subscenario; a real
  Login Item cycle and full §11.1 lifecycle remain open. Legacy draft migration and conflict
  preservation pass real-host fixtures, including a host-process restart. Receipt:
  `docs/maintenance/evidence/r3-packaged-owned-host-adoption-2026-09-28/findings.md`.
- F catalog freshness now has a QueryObserver fixture for the production active-refetch helper
  and composer projection: add/remove snapshots update tabs, rows and shared cache; the ten-second
  interval is active only while observed. The combined catalog tests pass 9/9 (37 expectations).
  A headless Chromium fixture now also mounts the production `useProviderModelCatalog` hook and
  confirms its rendered catalog adds/removes model rows as the fixture API changes; the hook and
  provider-browser suite passes 8/8 across three files. Its settings-panel test now has the
  required `QueryClientProvider`; the API is still fixture-backed, and no packaged runtime event
  is exercised. Receipt:
  `docs/maintenance/evidence/f-provider-catalog-refresh-2026-09-28/findings.md`.
- O07 provider-backed plan review now passes through the host on source-attested OMP 18.1.18:
  exact Muse 1.3 selection/auth readback, one user prompt, live `xd://propose` review projected
  with 1,079 untruncated characters, owner cancellation and a fresh no-review read. The plan text
  was not retained; no packaged app or retry was used. Packaged review-panel capture and other
  O07 rows remain open. Receipt:
  `docs/maintenance/evidence/o07-plan-review-muse-live-2026-09-28/findings.md`.
- A separate O07 Muse 1.3 plan-review approval proof now passes on attested OMP 18.1.18. The live
  proposal was inspected before approval; the owner route cleared the pending review and the host
  event journal recorded terminal `agent_end` at sequence 445, with the scratch project unchanged.
  The first runner attempt approved but did not observe completion through its weak event route;
  the second failed before approval because that route supplied no cursor; the corrected third run
  reads the host's in-process event journal. Three prompts across three isolated runs; no internal
  retries. The proposal body was not retained. This is host/runtime evidence, not packaged O07/D/F
  acceptance. Receipt:
  `docs/maintenance/evidence/o07-plan-approval-muse-live-2026-09-28/findings.md`.
- O07 native Todo → host progress projection now has one live semantic proof on source-attested
  OMP 18.1.18: exact Muse 1.3 selection/auth readback, one corrected prompt, OMP's `todo` event,
  and an identical host `/progress` phase/task projection (`in_progress`, as OMP auto-starts the
  first task). The first runner attempt incorrectly expected `pending`; across both attempts two
  prompts were dispatched, with no retry inside either run. No packaged UI was used. Receipt:
  `docs/maintenance/evidence/o07-progress-muse-live-2026-09-28/findings.md`.
- Slices landed since the 2026-09-24 checkpoint (all §10 item 70, receipts linked from the plan):
  The bullets below are a chronological record; older open-state sentences are superseded by
  the current checkpoint receipts above and by §10 item 70.
  - Packaged restore observed — `agent-window-smoke.ts --native` re-run green on the fresh
    bundle (`ok: true`, window-button Restore, `archived-restored.png`, IDE open/return,
    zero renderer errors; `dist/agent-window-native-smoke/result.json`).
  - Dirty-file picker UI packaged run — new `bun run smoke:dirty-picker-packaged`
    (`scripts/omp-dirty-picker-packaged-proof.ts`): real clicks in `Cedia.app` (project row
    create button → env `Local` → `New worktree` → uncheck `drop.txt` → Send); the created
    session's own worktree carries the `keep.txt` mod, not `drop.txt`'s. Evidence appended
    to `docs/maintenance/evidence/r3-dirty-picker-2026-09-26/findings.md`; captures in
    `dist/dirty-picker-packaged-proof/`.
  - Missing packaged panel captures — panels smoke now opens the `Task controls` disclosure
    in the packaged run and records all 27 aria-labels across the 13 Cedia surfaces in
    `result.json:taskControls` + `task-controls-open.png`
    (`dist/agent-window-panels-smoke/result.json`: `ok: true`, `native: true`,
    `providerCalls: 0`). Receipt: `docs/maintenance/evidence/packaged-task-controls-2026-09-27/`.
    Two fixes on the way: Automations row is capability-gated (assert hidden-or-honest, not
    present); `Sidebar.tsx` primary row forwards `disabledReason` as `aria-description`.
    Theme white-card tie recorded as a finding, not a failure (`--background` must flip).
  - The packaged two-window Send-race diagnostic opens Agents and the IDE, but Playwright
    cannot drive the Code-OSS dock webview. Its second in-process adapter is diagnostic only.
    A later run recorded two prompts because Playwright `fill()` showed text without updating
    the shared draft owner; this is a driver staging error, not a CAS regression. The driver
    now fails instead of claiming D success. Receipt:
    `docs/maintenance/evidence/r2-send-race-driver-audit-2026-09-27/findings.md`.
  - Packaged browser tab title fixed — `did-stop-loading` now keeps the live page title rather
    than overwriting it with the URL fallback. The regression test and extended
    `smoke:browser-packaged` were red on the old behavior and green after repackaging;
    DOM, tab row and `/json/list` agree. Receipt:
    `docs/maintenance/evidence/o10-tab-title-2026-09-27/findings.md`. No coverage row closed by that metadata fix.
  - O10 browser-relay qualified through the packaged runtime — new
    `bun run smoke:browser-relay-packaged` uses the installed headed extension and existing
    loopback relay, creates its own local fixture tab, then has packaged Cedia's pinned OMP
    session use Eval `browser.open({app:{relay:true,target:<exact fixture title>}})` and click
    only that tab. One fixture click, command completed, two local canned-model responses, zero
    external provider requests; proof tab closed. Receipt:
    `docs/maintenance/evidence/o10-relay-browser-proof-2026-09-27/findings.md`. O10 row is now
    evidence-backed `integrated`; the embedded per-thread CDP path remains a separate proof.
  - Dirty IDE working-copy count now reaches the CEDIA pre-Quit decision over trusted,
    count-only IPC. Patch `0063` carries the Code-OSS publisher and main-process sender
    check; the fresh 19-patch app passes `check:packaged` and scratch lifecycle smoke.
    The actual packaged edit → Quit dialog → Cancel path remains unobserved after the
    attempted Playwright attach returned no window. Receipt:
    `docs/maintenance/evidence/r1-dirty-editor-quit-2026-09-27/findings.md`.
  - Owner-approved O02 `switchSession` is represented by a distinct window-local coverage
    link with no fake RPC carrier. Task navigation keeps two runtimes/session files distinct;
    the source gate now passes 1,041/1,041 with zero gaps. Receipt:
    `docs/maintenance/evidence/o02-window-navigation-equivalent-2026-09-27/findings.md`.
  - A corrected live Muse 1.3 proof selects the exact scratch task, sets and reads back the
    effective model, sends from the Agent Window, clicks a real `select` approval, and sees
    a byte-exact file plus completed turn and zero pending UI/errors. Receipt:
    `docs/maintenance/evidence/o11-muse-select-approval-2026-09-27/findings.md`.
  - The packaged dirty Quit/Cancel run opened a real Monaco file through the Agents
    preload bridge, typed an unsaved buffer, and showed a native dialog reporting one
    unsaved file. Computer Use clicked Cancel; the host returned to ready and the disk
    bytes stayed unchanged. The unattended AppleScript reader lacks macOS Assistive
    Access, so its automated assertion remains blocked. A bounded packaged Muse
    `confirm` run rendered the valid editor approval; the production Approve once
    click settled it, the turn completed, and OMP read the Monaco buffer back as
    `unsaved edited` while disk stayed `disk original\n`. The driver reported failure
    only because it read a stale Playwright page after the IDE handoff moved Monaco
    to another renderer. The no-paid retry then stopped before sending because the
    composer catalog did not expose the Muse row. The valid behavior is evidenced by
    the retained host journal; the proof-runner postcondition still needs a runtime-only
    reread. The context-refresh wait that hid the earlier card was fixed with a red/green
    adapter regression test. Receipts:
    `docs/maintenance/evidence/o11-native-confirm-preflight-2026-09-27/findings.md` and
    `docs/maintenance/evidence/r1-dirty-quit-packaged-preflight-2026-09-27/findings.md`.
    A 2026-09-28 read-only driver diagnosis found the no-paid retry searched the current provider
    tab without selecting `opencode-go`; the picker scopes search results to that tab. The proof
    runner now selects the visible provider tab, and the phase-aware Monaco reread plus the
    webview asset-base fix passed in one staged packaged run. The production composer sent one
    paid Muse prompt; `Approve once` completed the guarded native edit, Monaco read `unsaved
    edited`, disk stayed `disk original\n`, and no unexpected renderer/resource errors occurred.
    The login-item shim intercepted both setter calls. D remains open for other §11.1 gates.
    Full receipt: `docs/maintenance/evidence/o11-native-confirm-packaged-reread-2026-09-28/findings.md`.
  - Two isolated O09 host/OMP semantics are now live-verified on pinned OMP 18.1.18: manual
    soft-compaction cancellation while its summary request is held, and manual provider-native
    compaction failure (HTTP 503) advancing to the configured soft method. The latter records
    OMP's fallback warning, returns owner context to available/idle, commits one soft entry and
    completes a follow-up turn. Both use loopback fixtures only. Receipts:
    `docs/maintenance/evidence/o09-context-cancel-live-2026-09-28/findings.md` and
    `docs/maintenance/evidence/o09-context-fallback-live-2026-09-28/findings.md`. These cases
    do not establish full O09 or F acceptance.
  - A third bounded O09 case proves nonzero image reduction through the owner
    `context.shake` images route on the attested 18.1.18 runtime: persisted branch image count
    1→0, OMP `imagesDropped: 1`, exact preservation of all transcript text blocks and profile
    configuration bytes, identical same-command replay, stale-incarnation refusal before a
    durable command row, and a completed follow-up turn. The two requests used a loopback model
    fixture. A valid PNG normalizes to one `image/webp` data-URI `image_url` (168 decoded bytes,
    RIFF/WEBP) on the first request; the post-shake follow-up request has no image parts. This
    verifies one O05 prompt-image forwarding/serialization case plus one O09 shake case, not
    full O05/O09/F acceptance. An
    earlier false-negative was caused by a corrupt PNG fixture rejected by OMP's unreadable-image
    guard; no production guard changed. The canned fixture does not perform vision inference.
    Receipt: `docs/maintenance/evidence/o09-context-images-live-2026-09-28/findings.md`.
  - The live F dynamic-provider smoke passes in one host-backed OMP 18.1.18 session:
    extension command add/remove, same-session owner catalog readback, baseline preservation,
    stale model selection refused by OMP, and zero provider requests. The prompt command's
    initial durable `acknowledged` row was followed through `prompt_result` to `completed`.
    Exact runtime and relevant source hashes are recorded in
    `docs/maintenance/evidence/f-dynamic-provider-live-2026-09-28/findings.md`; after refreshing
    the consolidated patch for the sole authorized O07 goal-bridge delta and preparing the
    launcher, full runtime attestation passed.
    No renderer/package/device projection or full F acceptance is claimed.

### Verified at this checkpoint

| Command | Result |
|---|---|
| `bun test apps/macos/agent-window/test` | 399 pass, 0 fail, 76 files |
| `bun run check:omp-coverage --require-complete` | PASS, integrity 1041/1041, zero gaps; O02 `switchSession` is an explicit window-local equivalent and O10 `browser-relay` has the packaged receipt |
| `bun test scripts/lib/omp-coverage.test.ts apps/macos/agent-window/test/native-handoff.test.ts apps/macos/test/workbench-mode.test.ts` | 63 pass, 0 fail; window-local source/gate behavior |
| `bun test apps/host/test/service.test.ts -t 'keeps both task runtimes independently owned'` | 1 pass, 0 fail; two task runtimes remain separately commandable |
| `bun run smoke:live-approval` | PASS; Muse 1.3 live `select` click, exact scratch file, completed turn, zero pending UI/errors |
| `bun run smoke:send-race` | PASS; deterministic same-revision two-adapter race, one winning prompt per round |
| panels smoke (`dist/agent-window-panels-smoke/result.json`) | `ok: true`, `native: true`, `taskControls.open: true`, `providerCalls: 0` |
| native smoke (`dist/agent-window-native-smoke/result.json`) | `ok: true`, `errors: []` |
| `git diff --check` | clean |
| `bun test apps/macos/test/agent-window-browser.test.ts` | 11 pass, 0 fail |
| `bun run smoke:browser-packaged` | passed on fresh `Cedia.app`; title agrees in DOM, row and `/json/list`; zero provider calls |
| Current turn: `bun run typecheck` | PASS after native-confirm driver changes |
| Current turn: `bun test apps/macos/agent-window/test/adapter.test.ts` | 55 pass, 0 fail; includes pending-confirm snapshot under blocked context refresh |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS, 1041/1041 audited records mapped, 0 fatal issues, F source completeness green; not full F acceptance |
| Current turn: `git diff --check` | PASS |
| Current turn: `bun scripts/omp-dynamic-provider-smoke.ts` | PASS on one host-backed OMP 18.1.18 session; provider add/remove observed in owner catalog, stale selection refused, 0 provider requests |
| Current turn: `bun run typecheck` | PASS |
| Current turn: `bun run check:repo` | PASS; CI-OK, 808 doc links and 313 evidence items |
| Current turn: `bun run check:omp-coverage` | PASS; integrity 1041/1041 mappings, 0 fatal issues |
| Current turn: `git diff --check` | PASS |
| After OMP provenance refresh: `bun scripts/omp-goal-restart-smoke.ts` | PASS; both restart cases on fully attested source tree `1543a4c9ee84f8e3fb195023a47e1082176200ec` |
| After OMP provenance refresh: `bun scripts/omp-dynamic-provider-smoke.ts` | PASS; add/remove/stale refusal, 0 provider requests, full attestation passed |
| After OMP provenance refresh: `attestOmpRuntime(".", "dist/omp/omp")` | PASS; development-source-launcher, source verified, patch SHA `d30b933ad3cd68da09582d43626d7db21da99af34ea7670bd160b8132ea5c469` |
| `bun run smoke:browser-relay-packaged` | passed on packaged `Cedia.app`; exact relay target title, one fixture click, completed command, local model only; see receipt |
| `bun run check:packaged` | 19-patch stamp and assets pass on the fresh app |
| `bun test apps/macos/test/app-lifecycle.test.ts apps/macos/test/desktop-patch-set.test.ts` | 29 pass, 0 fail; includes trusted dirty-count IPC and old-bundle refusal |
| `bun run smoke:lifecycle-packaged` | 3 boots, graceful quit drain, relaunch and SIGKILL adoption on scratch state; no dirty IDE edit |
| `bun run check:repo` / `bun run typecheck` | both pass; separate `apps/macos` typecheck still has seven errors in untouched vendored `nativeApi.ts` |
| `bun test upstream/omp/packages/coding-agent/test/rpc-input-frame.test.ts` | 18 pass, 0 fail, 67 expectations; includes cancellation preemption and error-frame regressions |
| `bun run check:types` in `upstream/omp/packages/coding-agent` | PASS after aligning `RunRpcMode` with the session-owned MCP manager argument |
| `bun scripts/omp-context-cancel-smoke.ts` | PASS on prepared OMP 18.1.18; held summary request cancelled, no compaction commit, follow-up turn completed; loopback fixture only |
| OMP `bun run check:types` (`upstream/omp/packages/coding-agent`) | PASS |
| Current turn: `bun scripts/omp-context-fallback-smoke.ts` | PASS on the attested OMP 18.1.18 launcher; five loopback requests, one soft compaction commit, follow-up completed |
| Current turn: `bun run typecheck` | PASS |
| Current turn: `bun run check:repo` | PASS; CI-OK, 804 doc links and 311 indexed evidence items |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS; 1041/1041 mappings, zero fatal issues; source completeness only |
| Current turn: `git diff --check` | PASS |
| Current turn: `bun test scripts/lib/omp-native-confirm-editor.test.ts` | 2 pass, 0 fail; phase-specific renderer selection after approval |
| Current turn: `bun run typecheck` | PASS with the native-confirm driver change |
| Current turn: `bun run check:repo` | PASS; CI-OK, 837 doc links, 362 Markdown files, 329 evidence items |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS; 1041/1041 audited records mapped, 0 fatal issues, 0 missing dispositions; source completeness only |
| Current turn: `bun scripts/omp-plan-review-muse-live-proof.ts` | PASS on attested OMP 18.1.18; one user prompt, `xd://propose` review observed, owner cancel acknowledged, no retry |
| Current turn: `bun scripts/omp-progress-muse-live-proof.ts` | PASS on attested OMP 18.1.18; corrected run observed native `todo` and identical host projection (`in_progress`); two prompts total across initial assertion mistake and corrected run |
| Current turn: `bun test apps/host/test/omp-progress.test.ts upstream/omp/packages/coding-agent/test/tools/todo.test.ts` | PASS; 89 tests, 246 expectations; includes OMP auto-start behavior |
| Current turn: `bun run typecheck` | PASS |
| Current turn: `bun run check:repo` | PASS; CI-OK, 844 doc links, 364 Markdown files, 330 evidence items |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS; 1041/1041 mappings, zero fatal issues and zero missing dispositions; source completeness only |
| Current turn: `git diff --check` | PASS |
| Current turn: `bun scripts/omp-plan-review-muse-live-proof.ts` | PASS on source-attested OMP 18.1.18; final corrected run inspected and approved `xd://propose`, cleared review, and observed terminal `agent_end` at host journal sequence 445. Three user prompts across three isolated runs; no internal retries |
| Current turn: `bun test upstream/omp/packages/coding-agent/test/interactive-mode-plan-review.test.ts upstream/omp/packages/coding-agent/test/modes/controllers/event-controller-plan-approval-dispatch.test.ts` | PASS; 63 tests, 196 expectations |
| Current turn: `bun test upstream/omp/packages/coding-agent/test/cedia-plan-bridge.test.ts apps/host/test/omp-progress.test.ts` | PASS; 25 tests, 99 expectations |
| Current turn: `bun scripts/omp-plan-mode-smoke.ts` | PASS; host plan-mode transition/refusal/idempotency path; does not exercise a provider proposal |
| Current turn: `bun scripts/omp-extension-hot-reload-smoke.ts` | PASS on source-attested OMP 18.1.18; same PID/session A-to-B command/provider/tool replacement, baseline preservation, failed-candidate rollback, removal, stale-selected-slash 409, zero inference |
| Current turn: `bun test upstream/omp/packages/coding-agent/test/extensions-runner.test.ts upstream/omp/packages/coding-agent/test/model-registry-runtime-provider.test.ts upstream/omp/packages/coding-agent/test/reload-plugins-mcp.test.ts` | PASS; 134 tests, 927 expectations |
| Current turn: `bun run check:types` in `upstream/omp/packages/coding-agent` | PASS |
| Current turn: `bun scripts/omp-capabilities-smoke.ts` | PASS; live 498-key settings inventory and timing distribution, isolated write/readback, refusal and redaction checks |
| Current turn: `bun test upstream/omp/packages/coding-agent/test/cedia-capability-bridge.test.ts apps/host/test/omp-settings.test.ts` | PASS; 36 tests, 4,152 expectations |
| Current turn: `bun test apps/macos/agent-window/vendor/synara/apps/web/src/components/settings/OmpSettingsPanel.logic.test.ts` | PASS; 7 tests, 28 expectations; published timing labels and unclassified fallback |
| Current turn: OMP `bun run check:types` (`upstream/omp/packages/coding-agent`) | PASS |
| Current turn: `bun run check:repo` | PASS; CI-OK, parents=198, ui=75, children=129, lock-shas=3, doc-links=855, md=366, evidence=331 |
| Current turn: `bun run typecheck` | PASS |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS; live OMP 18.1.18, 1041/1041 mappings, zero fatal issues and zero missing dispositions; source completeness only |
| Current turn: `git diff --check` | PASS |
| Current turn: `bun run smoke:omp:queue` | PASS; 25 checks on source-attested OMP 18.1.18; a held local turn, queued follow-up, exact live drop, cancelled intent and no identity leak or second request |
| Current turn: `bun test apps/host/test/omp-queue.test.ts apps/host/test/service.test.ts` | PASS; 48 tests, 300 expectations |
| Current turn: `bun test ./upstream/omp/packages/coding-agent/test/cedia-queue-bridge.test.ts` | PASS; 6 tests, 15 expectations; exact identities preserved for `last` and `all` |
| Current turn: `bun test apps/macos/agent-window/test/cedia-queue.test.ts apps/macos/agent-window/test/cedia-queue-surface.test.tsx` | PASS; 7 tests, 21 expectations |
| Current turn: root, OMP and Agent Window typechecks | PASS |
| Current turn: `bun run check:repo` | PASS; CI-OK, 860 doc links, 369 Markdown files, 332 evidence items |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS; 1041/1041 mappings, zero fatal issues, zero missing dispositions; source completeness only |
| Current turn: `git diff --check` | PASS |
| Current turn: staged `bun scripts/omp-native-confirm-packaged-proof.ts` | PASS; one Muse prompt, exact editor read/apply correlation, visible Approve once, edited Monaco buffer, unchanged disk; staged Login Item setters intercepted |
| Current turn: `bun test apps/macos/test/ide-native-workbench.test.ts apps/host/test/model-catalog.test.ts scripts/lib/omp-native-confirm-editor.test.ts apps/macos/agent-window/test/provider-tabs.test.ts` | PASS; 62 tests, 281 expectations |
| Current turn: `bun run typecheck` | PASS |
| Current turn: `bun run check:repo` | PASS; CI-OK, 867 doc links, 376 Markdown files, 334 evidence items |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS; 1041/1041 mappings, zero fatal issues, source completeness only |
| Current turn: `git diff --check` | PASS |
| Current turn: `bun run test` | PASS; 1,430 tests, 8,507 expectations |
| Current turn: D/F focused suites (host recovery/owner attach, Mac owner bridge, draft reservation, provider catalog refresh/projection) | PASS; 95 tests, 516 expectations |
| Current turn: root and Agent Window typechecks | PASS |
| Current turn: `bun scripts/omp-crash-proof.ts` | PASS on OMP 18.1.18; SIGKILL → `outcome_unknown`, no replay, explicit reconcile, recovered turn; two loopback model hits |
| Current turn: `bun test apps/host/test/service.test.ts -t 'reconciles an unknown turn only after removing its dead matching owner record'` | PASS; 1 test, 9 expectations |
| Current turn: `bun run check:repo` | PASS; CI-OK, 873 doc links, 382 Markdown files, 337 evidence items |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS; live OMP 18.1.18, 1,041/1,041 mappings, zero fatal/missing dispositions; source completeness only |
| Current turn: `git diff --check` | PASS |
| Current turn: `bun run smoke:host-crash-adoption` | PASS; OMP 18.1.18; new host adopts same idle task/incarnation/owner PID after host SIGKILL; summary available; zero provider requests |
| Current turn: `bun run typecheck` | PASS |
| Current turn: `bun run test` | PASS; 1,431 tests, 8,508 expectations |
| Current turn: `bun run check:repo` | PASS; CI-OK, 875 doc links, 383 Markdown files, 338 evidence items |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS; 1,041/1,041 mappings, 498 settings, 50 RPC commands, 73 capability descriptors; source completeness only |
| Current turn: `git diff --check` | PASS |
| Current turn: `bun test apps/macos/test/agent-window-main.test.ts apps/macos/test/shared-draft.test.ts apps/macos/test/agent-ui-state.test.ts` | PASS; 35 tests, 170 expectations; includes host-side legacy import, conflicting app draft preservation and host-process restart readback |
| Current turn: `bun test apps/host/test/http.test.ts apps/host/test/drafts.test.ts` | PASS; 22 tests, 193 expectations; includes PATCH source allowlist and durable draft routes |
| Current turn: `bun run test` | PASS; 1,434 tests, 8,526 expectations |
| Current turn: `bun run typecheck` | PASS |
| Current turn: `bun run test` in `apps/ios` | PASS; 172 tests, 813 expectations; fixture/source tests only |
| Current turn: `bun run typecheck` in `apps/ios` | PASS |
| Current turn: Expo `export --platform web` to `/tmp/cedia-ios-web-export.LVdWMB` | PASS; static iOS web artifact built in a new temp directory |
| Current turn: `bun run build` | PASS; current host, extension and Agent Window outputs built to `dist/`; existing chunk-size and Node deprecation warnings |
| Current turn: `bun run check:repo` | PASS; CI-OK, 886 doc links, 387 Markdown files, 342 evidence items |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS; 1,041/1,041 mappings, 498 settings, 50 audited RPC commands, 73 capability descriptors; source coverage only |
| Current turn: `git diff --check` | PASS |
| Current turn: `bun run build` | PASS; current Cedia host/Agent Window and extension outputs built to `dist/` |
| Current turn: `bun scripts/prepare-omp-runtime.ts --standalone` | PASS; pinned OMP 18.1.18 rebuilt and attested to source tree `d0105be6509186319c7ae76249d1dc61932c7967` |
| Current turn: `bun run smoke:packaged-owned-host-adoption` and current-source rerun via `bun scripts/omp-packaged-owned-host-adoption-proof.ts` | PASS; packaged host/idle OMP owner survive staged app SIGKILL/relaunch with same task/incarnation/host identity; CUA sees task; zero provider calls; latest host SHA `208d9284…f5a24b`, OMP SHA `9c4619f4…68f7cfa` |
| Current turn: `bun run typecheck` | PASS after staged host/OMP overlay changes |
| Current turn: `bun run smoke:packaged-app-owner-adoption` | PASS on OMP 18.1.18; staged app SIGKILL/relaunch reattaches to the same existing host and idle task owner; CUA sees the project/task; zero provider requests or renderer exceptions |
| Current turn: `bun run typecheck` | PASS |
| Current turn: `bun run test` | PASS; 1,431 tests, 8,508 expectations |
| Current turn: `bun run check:repo` | PASS; CI-OK, 879 document links, 384 Markdown files, 339 evidence items |
| Current turn: `bun run check:omp-coverage --require-complete` | PASS; 1,041/1,041 mappings, 498 settings, 50 RPC commands, 73 capability descriptors; source completeness only |
| Current turn: `git diff --check` | PASS |
| Current turn: provider Chromium tests (`vitest.providers.config.ts`) | PASS; 3 files, 8 tests, including mounted `useProviderModelCatalog` add/remove projection |
| Current turn: `bun run typecheck` in `apps/macos/agent-window` | PASS |
| Current turn: `bun run check:repo` | FAIL; 102 dead links in historical `.scratch/cedia-direction` and brand-prototype evidence references; no current CEDIA plan or receipt links flagged |
| Current turn: `git diff --check` | PASS |
| Current turn: `bun run check:omp-coverage --require-complete` (2026-09-28 re-verify) | PASS; 1,041/1,041 mappings, zero fatal/missing dispositions; static audit only, live runtime absent; source completeness only |
| Current turn: `bun run typecheck` (2026-09-28 re-verify) | PASS |
| Current turn: D/F focused suites (host drafts/owner-attach/queue/model-catalog, Mac shared-draft/provider-tabs/owner-surface/queue) | PASS; 58 pass, 2 skip (live-runtime owner endpoint, runtime not prepared), 0 fail |
| Current turn: provider Chromium tests (`vitest.providers.config.ts`, 2026-09-28 re-verify) | PASS; 3 files, 8 tests |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: packaged catalog-event feasibility (source-only) | VERDICT: OMP accumulates repeated `--trusted-extension`; host appends its lock ext after `ompArgs`, but packaged `cli.ts serve` has no env channel for an extra extension (only `CEDIA_OMP_PATH`/bridge flags). Settings-file roots and `--extension` were already closed by the o06 roots survey. Renderer side is ready: Synara `useProviderModelCatalog` refetches on a 10 s interval while observed (fixture-proven 8/8). |
| Current turn: packaged catalog-event options | (a) staged-only lock-extension overlay carrying the fixture provider command (no product change; proves renderer propagation, extension mechanics already proven headlessly); (b) ship a `CEDIA_EXTRA_TRUSTED_EXTENSION` passthrough (new shipped attack surface, needs explicit owner approval). Awaiting owner choice before building the proof driver. |
| Current turn: packaged-catalog direction resolved (2026-09-29) | owner picked (a) staged-only overlay + authorized paid/staged reruns. Built `scripts/omp-packaged-catalog-overlay-proof.ts` (`smoke:packaged-catalog-overlay`): lock-first overlay on the staged bundled lock file only, packaged session catalog add/remove verified, stale `set_model` refused, 0 provider calls, 0 renderer errors, staged originals restored + re-codesigned. Renderer note corrected during build: packaged `GET /v1/models` spawns `--no-extensions` metadata workers, so the session extension row is expected ABSENT there — propagation gap recorded, not claimed. Receipt `evidence/f-packaged-catalog-overlay-2026-09-29`, indexed in CEDIA-PLAN. Paid/staged work still gated per-run. |
| Current turn: `bun run typecheck` (2026-09-29) | PASS with the overlay proof driver |
| Current turn: `bun scripts/omp-dynamic-provider-smoke.ts` (2026-09-29) | PASS (headless baseline still green) |
| Current turn: `bun run smoke:packaged-catalog-overlay` (2026-09-29) | PASS on OMP 18.1.18: session catalog absent→added→removed, baseline preserved, stale refused, global catalog omits row by construction, 0 provider calls, 0 renderer errors; staged lock file verified restored |
| Current turn: `bun run check:omp-coverage --require-complete` (2026-09-29) | PASS, 1,041/1,041 mappings, zero fatal/missing; source completeness only |
| Current turn: `bun run check:repo` (2026-09-29) | same 102 pre-existing dead links, none from this turn's files |
| Current turn: `git diff --check` (2026-09-29 re-verify) | PASS |
| Current turn: `bun run test` (2026-09-28) | first run 1,412 pass / 2 fail, both in `cli-launcher.test.ts` from the missing `dist/omp/omp` development launcher (not a tree regression); restored via `bun scripts/prepare-omp-runtime.ts`, rerun PASS 1,434 tests, 8,526 expectations, 0 fail |
| Current turn: `bun run check:omp-coverage --require-complete` (2026-09-28, live) | PASS on live omp/18.1.18 after launcher restore: 1,041/1,041 mappings, 498 settings, 50 RPC commands, 73 capability descriptors; source completeness only |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: live D/F smoke re-verification on current revision | PASS: `omp-dynamic-provider-smoke` (add/remove/stale-refusal, 0 provider calls, dev-source-launcher attested `d0105be6`), `smoke:omp:queue` (25-check drop settlement), `smoke:crash` (`outcome_unknown`, reconcile-start-run-abort), `smoke:host-crash-adoption` (owner PID preserved), `smoke:send-race`, `smoke:dirty-carry` |
| Current turn: `smoke:restore-window` | first run failed on missing Playwright chromium-1228 in a fresh `ms-playwright` cache (environment, not a regression; no leftover worktree); installed browsers via the repo's own playwright binary and reran PASS: archived row, Restore click, toast, host readback |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: iOS/web re-verification on current revision | PASS: `test:mobile` 172 tests/813 expectations, `apps/ios` typecheck clean, `export:web` builds the static artifact; `apps/macos/agent-window` typecheck clean (root + vendor configs) |
| Current turn: O04/O07 live smoke re-verification | PASS: `omp-capabilities-smoke` (live 498-key inventory, write/readback, typed refusals) and `omp-goal-restart-smoke` (paused-stays-paused, active-recovers-paused, zero requests until owner resume, exactly one turn after) on attested OMP 18.1.18 |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: `bun run check:repo` guard (2026-09-28) | still FAIL with exactly the same 102 pre-existing dead links in historical `.scratch/cedia-direction` and brand-prototype evidence; no HANDOFF/plan/current-receipt link flagged, so this turn's doc edits add no new breakage |
| Current turn: O09/O06/slash live smoke re-verification | PASS: `omp-context-cancel-smoke` (abort, no compaction commit), `omp-context-fallback-smoke` (503 soft fallback, one entry), `omp-context-images-live-smoke` (image drop, stale 409), `omp-extension-hot-reload-smoke` (same-PID replacement/rollback/removal, 0 inference), `smoke:omp:slash` on attested OMP 18.1.18 |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: O03/O07 live smoke re-verification | PASS: `omp-credit-guard-smoke`, `omp-goal-budget-smoke` (budget adjust/replay/refusal), `omp-guided-goal-smoke` (refused-while-disabled, interview-while-enabled) on attested OMP 18.1.18, zero provider spend |
| Current turn: packaged-proof environment note | Playwright chromium-1228 + headless shell + ffmpeg are now cached; this repo's playwright has no `electron` install target, but the packaged drivers launch the staged `Cedia.app` binary itself via `_electron`, so no separate Electron download is needed. Remaining packaged work is the proof driver (awaiting owner choice) plus the long stage/build/run itself. |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: `bun run check:terminal` (2026-09-28) | PASS: 12/12 xterm cases, 0 required failures; libghostty-vt not installed so only the repository's own xterm gate ran |
| Current turn: stray-process hygiene after this session's smoke runs | PASS: no proof-owned host/OMP/staged-app/browser processes remain; only the owner's Caret shells, cursor-agent workers and the user's own global `omp` daemon broker were listed, all left untouched |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: D shared-draft row scoping (source-only analysis, no acceptance claimed) | the row's source-level scenarios compose across three existing evidences: live `omp-send-race-proof` (two adapter instances, race/arbitration, restart survival), `agent-window-main.test` conflicting-copy test (real host server, separate labeled records for app-side vs extension text, restart readback of both), and `drafts.test` import rules. What stays open is exactly the packaged half: on-screen conflict-choice control and a packaged legacy-migration run, matching the already-listed open item. |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: O-packet fixture smoke sweep (2026-09-28, real exit codes) | 30/31 PASS on attested OMP 18.1.18; `omp-tan-smoke` failed 3/3 (not flake). Root causes: product answered a no-output tan child as available-empty (silent empty), and the smoke asserted a non-existent `text` field instead of `messages[]`. |
| Current turn: tan transcript honesty fix | `OmpAgents.transcript` now refuses zero-message reads at `fromByte 0` as unavailable-with-reason (later pages past the end stay available); corrected smoke assertion; new refusal/paging unit test. Verification: agents suite 12/12, root typecheck clean, live tan smoke green with zero provider calls, full `bun run test` 1,435 pass / 0 fail. Receipt `evidence/o07-tan-transcript-honesty-2026-09-28`, indexed in CEDIA-PLAN; `check:repo` stays at the same 102 pre-existing dead links. |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: virtual-ui smoke regression (2026-09-28) | committed `omp-virtual-ui-smoke` (green 2026-09-13) failed 2/2 on the current tree: new item-37 `set_host_uri_schemes` startup step is refused with `cedia_initializing` while a `session_start` custom pends; `get_state`/`set_host_tools` proceed concurrently as before. Same-session `agents-live-proof` failure was the same `text`-vs-`messages[]` assertion bug as tan; corrected identically. |
| Current turn: URI-scheme startup deferral fix | startup defers the install only on the `cedia_initializing` code (other refusals still fail startup) and `#dispatch` retries a pending install without ever failing the command. Verification: virtual-ui smoke fully green, agents-live smoke green, root typecheck clean, full `bun run test` 1,435 pass / 0 fail. Receipt `evidence/o05-host-uri-startup-deferral-2026-09-28`, indexed in CEDIA-PLAN; `check:repo` keeps only the 102 pre-existing dead links. |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: post-fix startup regression sweep | PASS after the URI-scheme deferral change: `omp-dynamic-provider-smoke`, `smoke:omp:queue`, `smoke:send-race` (two adapters + restart), `omp-browser-steer-smoke`, `omp-cdp-endpoint-smoke` — all exit 0 with zero provider calls |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: post-fix crash/recovery sweep | PASS after the URI-scheme deferral change: `smoke:crash` (`outcome_unknown`, reconcile-start-run-abort), `smoke:host-crash-adoption` (owner PID preserved), `smoke:restore-window` (archived row, Restore click, toast, readback), `smoke:dirty-carry`; stray-process check clean |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: URI-scheme retry unit test | new `host-uri-schemes.test.ts` with a gate-once fake (`CEDIA_FAKE_SCHEMES_GATE=startup-once`) proves startup succeeds past the refusal with a deferral diagnostic, exactly one schemes call at startup, and the successful retry before the next command; fixture default behavior unchanged. Full `bun run test` 1,436 pass / 0 fail, root typecheck clean. |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: retry observability | a persistently refusing (non-gate) scheme retry is now reported on diagnostics exactly once instead of retried silently on every command; covered by a second `host-uri-schemes` test with a refuse-after-gate fixture. Full `bun run test` 1,437 pass / 0 fail, root typecheck clean. |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: self-review of the startup-deferral diff | reviewed the settled hunks (startup try/catch, `#installHostUriSchemes` extraction, `#retryHostUriSchemes` + `#dispatch` hook, two Runtime flags): branch placement preserved, dispatcher/client assumptions match the pre-existing call sites, `OmpCommandError.code` usage covered by the existing import, edge cases (close/reap, attach-clients, flag lifecycle) behave; no defects found, no change made. |
| Current turn: live coverage + hygiene re-verify | `check:omp-coverage --require-complete` PASS on live omp/18.1.18 (1,041/1,041, 498 settings, 50 RPC, 73 caps); `dist/omp/omp` launcher present; no proof-owned processes remain. |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: native-editor fixture smokes (2026-09-28) | PASS with zero paid calls on the attested development runtime: `smoke:omp:ast` (dirty-only match, guarded apply, disk unchanged), `smoke:omp:editor` (unsaved-text read, overlay staging, single apply), `smoke:omp:permissions` (allow/reject-once gating with journaling). Synthetic transports only; real Monaco/CUA observation stays open. |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: runnable-universe audit (2026-09-28) | every headless/fixture proof in `scripts/` is now re-verified green on the current revision except two deliberate skips: `omp-live-turn.ts` spends real provider credit and declares itself out of automated gates, and `omp-agents-native-proof.ts` runs against the personal OMP profile (real HOME), so neither belongs in a re-verify sweep. Paid-model and staged-app proofs stay gated on their existing authorizations. |
| Current turn: `git diff --check` (2026-09-28 re-verify) | PASS |
| Current turn: repo-cleanliness audit, read-only (2026-09-29) | 729-line `git status` is session-work dirty-by-design; repo-root `agent.db`/`history.db`/`models.db` (touched 23:22) and `WATCHDOG.yml` belong to other live work (only reference is `typesafe-shadow-eval.ts`), `Library/` predates Sep 25 — none are proof-run leftovers of this goal's smokes, and nothing was deleted or moved. Live sibling subagents are active in this tree, so no overlapping writes were made beyond HANDOFF rows. |
| Current turn: `git diff --check` (2026-09-29 re-verify) | PASS |
| Current turn: slice-freshness recheck amid sibling subagent activity | files this goal's slices depend on keep their prior status kinds (no unexpected untracked/modified flips); reran the two focused suites on current content: `omp-agents` + `host-uri-schemes` 14 pass / 0 fail, so the tan-honesty and deferral fixes still hold. No overlapping writes made. |
| Current turn: `git diff --check` (2026-09-29 re-verify) | PASS |
| Current turn: key live-smoke rerun on current content | `omp-tan-smoke`, `omp-virtual-ui-smoke`, and `omp-dynamic-provider-smoke` all exit 0 on the present tree (tan honesty fix, URI-scheme deferral, and dynamic provider add/remove/stale-refusal hold with zero provider calls). |
| Current turn: `git diff --check` (2026-09-29 re-verify) | PASS |
| Current turn: tree-stability check (2026-09-29) | status count still 729 with identical kinds on this goal's files, so the verified-green state stands; no reruns needed and no writes made beyond this row. Standing by on the owner's packaged-proof choice and external prerequisites (Login Item cycle, physical iPhone, tailnet/off-LAN). |
| Current turn: `git diff --check` (2026-09-29 re-verify) | PASS |
| Current turn: steady-state confirm (2026-09-29) | status still 729, diff-check clean; all headless/fixture proofs green on this tree, two fixes landed with tests and receipts. No further unblocked slices remain: packaged catalog proof awaits the owner's direction choice, paid-model and staged-app reruns await their authorizations, Login Item cycle / physical iPhone / tailnet await external prerequisites. Goal stays active, not blocked. |
| Current turn: `git diff --check` (2026-09-29 re-verify) | PASS |
| Current turn: steady-state recheck (2026-09-29) | status still 729, diff-check clean, focused `omp-agents` + `host-uri-schemes` suites 14 pass / 0 fail. Still parked on the owner's packaged-proof direction choice and external prerequisites; goal stays active. |
| Current turn: `git diff --check` (2026-09-29 re-verify) | PASS |
| Current turn: goal status (2026-09-29) | the same blocking condition held for three consecutive turns with no further unblocked slices (revalidated: no extension channel added, tree steady at 729, diff clean), so the goal is now marked blocked per the blocked-audit rule. Unblocks, any one of which resumes work: (1) owner picks the packaged-catalog-proof direction, staged-only overlay vs shipped env channel; (2) authorization for paid-model/staged-app reruns; (3) external prerequisites: real Login Item cycle, physical iPhone, tailnet/off-LAN. |
| Current turn: steady-state recheck (2026-09-29) | status still 729, diff-check clean, focused `omp-agents` + `host-uri-schemes` suites 14 pass / 0 fail. Still parked on the owner's packaged-proof direction choice and external prerequisites; goal stays active. |
| Current turn: `git diff --check` (2026-09-29 re-verify) | PASS |
| Current turn: paid Muse native-confirm rerun (2026-09-29, owner-authorized) | plain installed-app copy failed ONLY the resource gate (installed `extension.js` predates the asset-base fix; journal proves the paid turn completed). Current-source staged overlay rerun fully PASS: 1 paid Muse prompt, exact handle/version/hash correlation, visible `Approve once`, `unsaved edited` buffer, `disk original` disk, 0 renderer errors. Receipt `evidence/o11-native-confirm-packaged-rerun-2026-09-29` |
| Current turn: staged SIGKILL/relaunch (2026-09-29, owner-authorized) | `smoke:packaged-owned-host-adoption` PASS on current-source stage: same host PID 75337, same OMP owner 75392, same task/incarnation, draft rehydrated, 0 provider calls, 0 renderer errors, 2 shim interceptions. One scratch host (PID 75816, unlinked dir) reaped post-receipt. Receipt `evidence/r3-packaged-sigkill-relaunch-2026-09-29` |
| Current turn: Login Item read-only-safe (2026-09-29, owner-authorized) | no writes, no Keychain, no login cycle. Pre-run item at overlay-proof staged URL; staged launches moved UUID `CEC161BE…` to the paid-proof staged URL, disposition preserved, no second item. Real login cycle still open. Receipt `evidence/r3-login-item-readonly-2026-09-29` |
| Current turn: `git diff --check` (2026-09-29 re-verify) | PASS |
| Current turn: `check:omp-coverage --require-complete` (2026-09-29) | PASS 1,041/1,041, source completeness only |
| Current turn: `check:repo` (2026-09-29) | FAIL same as baseline: 102 pre-existing dead links in `.scratch/cedia-direction` + brand prototypes, plus 1 pre-existing unindexed `cedia-monochrome-icon-research-2026-09-28` (untracked, not this turn's); none from the 3 new receipts (all indexed in plan §13) |
| Current turn: staged active-turn crash (2026-09-29, owner-authorized paid/staged scope) | `CEDIA_PROVE_ACTIVE_TURN_CRASH=1` PASS on current-source stage: 1 loopback prompt running at SIGKILL, same host 78187 + owner 78243 retained `running` across relaunch, no replay, abort → `cancelled`, exactly 1 fixture request, 0 renderer errors. Receipt `evidence/r3-packaged-active-turn-crash-2026-09-29`, plan §13. No stray proof processes. |
| Current turn: `git diff --check` (2026-09-29 re-verify) | PASS |
| Current turn: O05 two-client winner (2026-09-29) | new host test, no product change: two clients race one `select` — winner `completed`, loser `not_dispatched`, exactly one journaled outcome. `service.test.ts` 44/44, root typecheck clean. Receipt `evidence/o05-two-client-winner-2026-09-29`, plan §13. |
| Current turn: O05 loser-marker follow-up (2026-09-29) | 8-line host `stale-response` → already-answered mapping so the loser's window refreshes via the existing vendor handler; test asserts marker text. `service.test.ts` 44/44 (283 expectations), typecheck clean, `diff --check` clean. Receipt updated in place. |
| Current turn: O03 provider-paths live (2026-09-29) | `smoke:provider-accounts-live` PASS on attested 18.1.18, read-mostly, no spend/turn: opencode-go authenticated, accounts honestly empty (API-key auth), unknown pin refused, tier set + readback. Successful OAuth pin unprovable by fact. Receipt `evidence/o03-provider-accounts-live-2026-09-29`, plan §13. |
| Current turn: finish-all survey (2026-09-29) | O03/O05 live+fixture rows re-verified green (model-state smoke, credits, usage, ui, host — 76 tests). `applyRoleModel` already bridged (`model.roles.apply`) + window-proven; saved-reset redeem is owner-confirmed by design (no auto-spend to prove beyond the guard smokes). No further unblocked code slices: remainder is external/prerequisite-gated (below). Coverage 1,041/1,041 PASS, `diff --check` clean, no strays. |
| Current turn: Login Item restore (2026-09-29) | installed app launched directly (personal launcher bypassed, 0 Keychain writes/deletes): UUID `CEC161BE…` moved staged → persistent URL, disposition kept, generation 16, confirmed in `backgroundtaskmanagementd` log. App (90160) + bundled host (90206) left running on the real profile. Logout/login skipped by owner choice. Receipt `evidence/r3-login-item-restore-2026-09-29`, plan §13. |
| Current turn: credits live read (2026-09-29) | real `opencode-go` account `pongsathon.dev@pm.me`, `availableCount: 0` — nothing to redeem, owner chose no fire. Wire fixture-covered (8 tests). Receipt `evidence/o03-credits-live-read-2026-09-29`, plan §13. |
| Current turn: D+F closeout on 18.4.3 (2026-09-29) | Audit regen green (1101 mappings, Integrity PASS, `--require-complete` PASS); standalone = `omp/18.4.3`; adopt-EOF root-caused to burst-timing test artifact (quiescence gate, 44/44); 552/552 host+adapter with `CEDIA_OMP_BINARY=dist/omp/omp`; `package:mac` + `check:packaged` 12/12; send-race proof on stage-time shim, CUA edit half gated on human operator. Superseeds the cutover row's "not done" list except the CUA half. Receipt `evidence/df-closeout-1843-2026-09-29`, plan §13. |

### Where the open work is

§10 item 70 is the only authoritative list; the paragraph below is orientation for whoever picks this
up next, not a second backlog.

- D-closeout remainder: audit regen green on the 18.4.3 pin (1101 mappings, `--require-complete` PASS); standalone rebuilt; adopt-EOF re-probed to a test burst-timing artifact with a quiescence gate; `package:mac` + `check:packaged` 12/12 on the new build; send-race proof repaired to the stage-time shim with only the native-keyboard CUA edit gated on a human operator (this context lacks Screen Recording permission; two staged runs reached the preflight gate and timed out as designed). Still open: that CUA edit half, a real macOS Login Item/login cycle, and paired-client lifecycle repeats. Older staged-app receipts (Send/edit interleave on 18.1.18, native `confirm`, dirty Quit/Cancel, crash recovery, draft hydration) stand; the 18.4.3 re-proof of the CUA half is the one D row without a new-pin receipt.
- F source coverage gate is complete for pinned OMP 18.4.3 (new dated audit `evidence/omp-complete-scope-2026-09-29`; zero-gap gate, not a device or end-to-end pass). Full F acceptance still requires N and §11.1 semantic/dynamic/platform evidence. iOS source tests/typecheck pass and Expo produced a static web export in a temporary directory; packaged remote serving, off-LAN behavior and physical-device use are still open. O10 browser-relay and O02 navigation receipts are indexed in the plan.
- W stays blocked on tailnet/off-LAN prerequisites; N stays blocked on a physical device. No D/W/N/F checkpoint is claimed.

### Not verified (external or later gates)

- Provider management paths: the Muse 1.3 write/approval turn is real, but no OAuth account
  was listed or pinned, no service tier was changed, and no saved reset was spent.
- Remote: no Tailscale Serve configuration, no tailnet device and no off-LAN request was exercised;
  no physical iPhone run exists, and the paired-client lifecycle repeats (close/Quit/crash) are
  unobserved.
- A real Login Item/login cycle and packaged background launch remain unverified. Current-source
  staged proofs cover packaged shared-draft UI hydration and an active-turn app crash/relaunch, but
  the combined §11.1 shared-draft and app-lifecycle rows and update paths remain unverified.
  Host-side legacy draft migration/conflict preservation and host-process restart readback have
  focused integration coverage. The
  staged app-owned host startup/recovery proof is in
  `r3-packaged-owned-host-adoption-2026-09-28`.
- The earlier Spark-stall receipt was corrected: its driver selected the wrong task; the corrected
  Muse `select` run succeeds. No OAuth account was listed or pinned, no service tier changed, and
  no saved reset was spent.

### Prior checkpoint (2026-09-24, superseded)

- The 2026-09-24 checkpoint below is superseded by the 2026-09-27 checkpoint above. Its "77
  records without disposition" gap count is stale (now 0); its "no packaged capture" limits
  are closed by the slices listed above. Its O06 stopped-work note is historical: the
  `tools.catalog.get` bridge it said was missing has since landed (O06 discovery slice).

### Intake open for review (not approved work): OMP 18.3.0

(Unchanged from prior session — see below.)

### Stopped work (historical, 2026-09-24 session)

- A slice for O06 ("discovery and management") was selected because §10 item 70 names the missing
  piece for it explicitly: *"that probe needs a way to read a session's active tool catalog, which has
  no bridge yet"* - the same bridge would also let O05's two dynamic tools be classified honestly.
- Two **read-only** explorers (`explore_o06_runtime`, `explore_o06_cedia`) were opened to map the OMP
  `getAllToolInfos`/`getActiveToolNames`/`setActiveToolsByName`/`refreshMCPTools`/`refreshSkills`/
  `refreshRpcHostTools`/`reload`/`extensionRunner`/code-mode APIs and Cedia's existing tool/skill/MCP
  surfaces. They were interrupted before reporting, so **no findings from them exist** and nothing was
  written to the repository by that step.
- No O06 code, contract, patch change, test or document was produced after the checkpoint above; the
  newest repository edits remain the tree-slice files and the plan/receipt/handoff text.
### Environment and agents

- No proof-owned scratch host or OMP runtime remains running. One post-proof Computer Use lookup
  reopened the staged bundle without its scratch arguments and started host PID `94045` against
  `/Users/pond/Library/Application Support/Cedia/host`. Its descriptor PID and staged-bundle
  command were matched; the authenticated quit returned HTTP 200, then the exact staged host/app
  processes exited. That default host directory was opened and its metadata/log may have changed;
  no user-state files were deleted or manually reverted. The installed app was not launched.
- No staged `Cedia.app` process remains running. The proof driver restored and byte-compared its
  staged host CLI, OMP executable and lifecycle module against the original staged files.
- Long-lived processes on this Mac that are **not** this task's and must not be stopped:
  the owner's Caret application, and the local `python -m http.server` serving image output.
- No subagents are running; all slices this session were executed by the root agent in-session.
- Proof scripts added this session (all registered in `package.json`, all green at handoff):
  `bun run smoke:dirty-picker-packaged`, `bun run smoke:send-race-packaged`,
  `bun run smoke:omp:queue`.
  Re-verify with: `bun run smoke:send-race`, `bun run smoke:dirty-carry`,
  `bun run smoke:restore-window`, `bun test apps/macos/agent-window/test`,
  `bun run check:omp-coverage --require-complete` (integrity PASS, 1041/1041 mappings;
  source coverage only, not full F acceptance).
