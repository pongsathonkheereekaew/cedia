# Local Mac requalification — 2026-09-30

## Scope and revision

Owner instruction: continue the local Mac closeout, excluding W/N, Tailscale and
iPhone. Starting source baseline: `d2cee3c9d31`. This is a dated receipt, not a
second implementation plan; the unfinished queue remains CEDIA-PLAN section 10
item 70. No provider inference, real logout/login, Keychain operation or push is
authorized by this receipt.

## Fresh package

Rebuilt the Code-OSS base with the bundled Node 24.18.0 runtime, then ran
`CEDIA_HOST_NODE=/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node bun run package:mac`.
The local ad-hoc-signed package is present again at
`VSCode-darwin-arm64/Cedia.app`. `bun run check:packaged` passed all 12 checks.
The first build was stamped `2026-09-30T01:04:36.466Z`, upstream
`ea1912fd6a05b80a56b2ad9b955075211deea521`, 19 patches, patch-set SHA-256
`e1901f7eb472796a2ed9e35b8c456cf14e20b4de4dfe24ec63aa5b3150a28daa`.

## Packaged Send/edit race: PASS

Command: `CEDIA_SEND_RACE_APP_PATH=<scratch>/Cedia.app bun scripts/omp-send-race-packaged-proof.ts`.
The staged copy matched the current Agent Window main module before applying the
scratch-only Login Item interception. Both native windows used an isolated host,
profile and fixture OMP; the production package and user state were not launched.

Native Computer Use focused the mounted IDE composer and entered
`IDE webview keeps revision two` while the Agents revision-one Send acknowledgement
and old empty-draft write were held. The harness observed:

- Exactly one prompt for `Agents renderer sends revision one`.
- Revision 2 persisted through the production IDE input handler and host store.
- Delayed revision-one empty write: HTTP 409.
- Revision-one clear: HTTP 200, `cleared: false`.
- Final draft: revision 2, exact IDE text retained; no second prompt.
- Zero provider requests; one intercepted Login Item setter; Electron exited 0.

Passing generated artifacts: `dist/send-race-packaged-proof/2026-09-30T01-08-04-057Z/`.
Durable copies: [result](send-race-result.json), [IDE capture](send-race-ide.png).
The earlier run `2026-09-30T01-05-19-879Z` failed the exact-revision assertion:
native input initially used the Thai keyboard layout, and correcting it created
extra draft revisions. The successful run started from fresh isolated state and
made one exact English replacement; the failed run was not counted as a pass.

This closes that package's native Send/edit subscenario, not every shared
draft migration/settings scenario and not full D/F acceptance.

## Packaged lifecycle: PASS (simulated login only)

`CEDIA_LIFECYCLE_APP_PATH=<scratch>/Cedia.app bun scripts/omp-packaged-lifecycle-proof.ts`
passed on the same fresh package: three boots, graceful quit with zero surviving
app/host scratch processes, and post-SIGKILL relaunch. No renderer errors. Login
Item reads/writes were intercepted in the scratch copy, and background login was
simulated. This does **not** qualify an actual macOS logout/login cycle.
Durable [result](lifecycle-result.json).

## Documentation gate repair

Three tracked historical documents now retain missing generated brand paths as
explicit unavailable references and use immutable OMP source revisions. No missing
artifact was invented and the validator was not weakened. `check:repo` decreased
from 105 to 9 failures; all remaining failures concern unrelated, untracked
monochrome exploration, which remains unchanged.

## Defects found and implemented

### Live session model catalogs

The earlier packaged overlay exposed a real boundary mismatch: dynamic extension
models existed in the session owner, while the picker and selection validator
only read sessionless `--no-extensions` metadata. The fix adds a read-only
`GET /v1/sessions/:id/models` projection of the existing runtime. It never starts
an executor. A no-live-runtime marker permits ordinary metadata discovery; live
errors do not fall back and conceal removals. Settings and unregistered local
drafts remain on the global catalog. Registered tasks get separate query keys.

Independent review caught a second issue before packaging: TanStack observer
placeholder data could temporarily carry task A's models into task B while B's
request was pending. The OMP placeholder now rejects a different task scope;
an active observer regression was observed failing before the correction and
passing afterward. Non-OMP provider discovery behavior is unchanged.

### OMP virtual UI startup

Fresh packaged real-OMP startup failed twice with `ReadableStream is locked`.
The isolated standalone editor/permission bridge test passed; changing only
`CEDIA_RPC_VIRTUAL_UI=0` also allowed the packaged session to start. That diagnostic
run then reached the expected pre-fix session-catalog HTTP 404. Disabling virtual
UI is **not** the product fix.

OMP 18.4.3's `InteractiveMode` constructor takes a `Composer` in slot 8. The
bridge passed `undefined`, constructing a default `ProcessTerminal` which tried
to claim stdin already owned by RPC. The bridge now injects a `Composer` over
the existing `RpcVirtualUi.terminal`. The new isolated CLI regression verifies
negotiation, open/output frames, input acknowledgement and zero loopback provider
requests. The existing slash-surface harness uses the same terminal injection.

The active consolidated OMP patch is regenerated without modifying historical
patch entries. The refresh utility's old single-entry assumption was corrected;
its integration regression proves active patch refresh preserves historical
bytes, manifest entries and the source index (red before, green after).

Scoped independent review found no remaining material issue after these fixes.
Native packaged verification of the updated runtime is recorded separately below
when completed; source tests are not a substitute for that result.

## Qualification boundaries

Session-aware model-picker propagation and combined two-window draft/migration
observations have separate passing receipts below; they are not inferred from
the Send race result. Explicit OMP settings conflict controls remain separate
from CEDIA appearance preferences. A real Login Item logout/login cycle remains owner-operated. W/N,
Tailscale, physical iPhone and external-provider semantic requalification are
outside this local provider-free run.

## Final rebuild and verification

The later package stamp is `2026-09-30T01:40:11.793Z`. It includes the corrected
virtual-UI runtime and session catalog. Active OMP patch SHA-256:
`f38591036286f6011c115249227324686cc5f354978bea34717031ce361a91ee`;
source tree `966d834949f7ab797941efc0d69bfdfc9fe91514`.
The durable runtime descriptor is [runtime.json](runtime.json).
Fresh verification: 1,442 root tests (8,611 expectations), 422 Agent Window tests
(1,529 expectations), zero failures; root and Agent Window typechecks passed.
Coverage is 1,101/1,101, with the live 18.4.3 runtime, zero fatal issues and a
passing completeness gate. Final package checks passed 12/12. These facts do not
upgrade the earlier Send/edit and lifecycle runs to final-build native receipts.

Final-build packaged catalog proof `2026-09-30T01-51-43-082Z` passed with native
gates disabled: absent → added → removed → stale selection refused, session-route
propagation, global metadata isolation, baseline preserved, zero provider calls
and zero renderer errors. Durable [result](catalog-result.json). The real bundled
runtime used virtual UI; this is runtime/route evidence, not two-window picker
acceptance.

## Native catalog observation and test incident

The `2026-09-30T01-44-18-975Z` packaged fixture started real bundled OMP 18.4.3
with virtual UI enabled. Adding the extension exposed its model through the live
session catalog and preserved the baseline. Native inspection saw the added
provider tab and `Ephemeral Packaged Fixture Model` row in Agents, then mounted
the IDE composer and its live virtual terminal. The after-add native gate expired
before completing the IDE picker observation. This run FAILED and does not prove
two-window add/remove propagation.

Native app targeting after fixture termination unexpectedly launched the scratch
app without the harness arguments (including the isolated profile and password
store flags). Two such launches were stopped; their exact owned processes were
terminated. macOS logs confirmed the existing Cedia Login Item was retargeted to
the temporary app. No Keychain command or credential entry was performed, but
absence of app-initiated Keychain access cannot be asserted for these bare launches.

Recovery launched the persistent application with a temporary profile/state dir,
`--password-store=basic --use-inmemory-secretstorage`, then stopped that recovery
instance. At `2026-09-30 08:51:07 +07:00`, backgroundtaskmanagementd confirmed the
same existing item UUID `CEC161BE-0E55-4A62-8B30-02B71F90A073` was restored to
`file:///Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/`, retaining its
enabled/allowed/notified disposition. This restoration is not a real login-cycle
acceptance test. Native inspection must not target a fixture after its process
has exited; even observing a stale app binding can relaunch it.

## Follow-up final-build qualification

The final `01:40:11.793Z` package was copied fresh before each proof. Native
Send/edit run `2026-09-30T02-02-27-352Z` passed: the actual IDE composer hydrated
revision 1; one native paste replaced it with revision 2 while the Agents ACK and
empty write were held. One prompt, stale write 409, clear refused, exact revision-2
text retained, zero provider calls, one intercepted Login Item setter, exit 0.
Durable [result](send-race-final-result.json) and [IDE capture](send-race-final-ide.png).
This supersedes the earlier-build Send/edit qualification caveat, not the combined
migration/settings or real-login gates.

Final-build lifecycle requalification also passed: simulated background login,
graceful exit with no owned state processes surviving, and fresh processes after
quit/relaunch and crash/relaunch. [Result](lifecycle-final-result.json). An initial
attempt correctly refused the already-shimmed Send-race copy before launching;
the passing run used a fresh copy of the persistent package. No real login cycle.

Native catalog run `2026-09-30T01-56-31-731Z` observed the added extension provider
and exact `Ephemeral Packaged Fixture Model` row in both Agents and the IDE
composer, on the same registered task. Its removal wait then failed. Read-only
inspection found GET commands had crossed the host's 128KB response threshold:
it returned a `cediaResponseReference` rather than an array. The proof's raw
reader did not follow chunks, so the polling loop swallowed the shape error.
This failed run is retained; add-row observation alone does not pass removal.

The preserved journal independently confirms that removal command
`packaged-catalog-remove-ab32850d-adb2-4738-9b56-675ff489b944` completed with
`agentInvoked:false`. A bounded reader now follows response chunks and verifies
their offsets, length and reconstructed SHA-256. Independent review additionally
found a malformed catalog could masquerade as an empty removal result; strict
envelope validation and a retained-baseline assertion now reject that false pass.
Both helper suites pass (6 tests).

Native retry `2026-09-30T02-07-58-296Z` PASSED: the registered task initially showed
only its baseline; after extension registration, Agents and the mounted IDE
composer each showed the provider tab and `Ephemeral Packaged Fixture Model` row.
After removal, both actual pickers showed only the retained baseline, with no
extension provider tab. The host rejected stale selection, zero provider calls
and zero renderer errors were recorded, and cleanup completed. The three release
files record those observations, not substitute UI assertions. Durable
[result](catalog-native-result.json), [IDE added row](catalog-ide-added.png), and
[Agents after removal](catalog-agents-removed.png). This closes this packaged
two-window catalog add/remove subscenario, not concurrent ACP/standalone reload
or every dynamic-provider F scenario.

## Native task controls: PASS within the stated boundary

Run `2026-09-30T02-22-17-236Z` used the same package and a provider-free held OMP
fixture. Native Agents showed `model change · awaiting OMP · fixture/fixture-model-2`.
The New worktree picker showed `From main`, both dirty paths initially selected,
then exactly one of two selected after unchecking `drop.txt`; `keep.txt` remained
selected. No native Send was performed. A separate real-host worktree route used
`dirtyFiles: ["keep.txt"]`: its modified bytes were copied, the unselected path
retained base bytes, and the source worktree was unchanged. This qualifies the
native picker plus the separately exercised route, not an end-to-end native Send.
Zero provider requests and renderer exceptions; Login Item writes intercepted.
Durable [result](task-controls-result.json), [pending model](pending-model-window.png),
and [dirty picker](dirty-worktree-picker.png).

An earlier attempt failed before IPC registration because the harness supplied
`CEDIA_HOST_REQUEST_TIMEOUT_MS=600000`, above the supported maximum. The harness
was corrected to 180000 and rerun from a fresh app copy. That failure is not
counted as product acceptance.

## Shared draft, migration and appearance restart: PASS

Run `2026-09-30T02-26-09-001Z` used the actual packaged Agents and IDE renderers,
a real source host/store and fixture OMP, with no provider inference. Two route
clients read the same draft revision; the losing write was refused with HTTP 409
`draft_conflict`. The renderer's genuine legacy import preserved the losing
opaque payload as `agent-ui-import-conflict` and recorded its one-time marker.
Native Agents hydrated the host winner, then an Agents edit appeared in the IDE.
The IDE edit `IDE window draft wins` broadcast back to Agents and persisted as
revision 6. Extra native input corrections occurred, so this scenario does not
claim one keystroke or one write; the separate Send race owns exact revision-2
arbitration.

Two settings clients also produced HTTP 409 `settings_conflict` and a successful
retry. Native Appearance showed Compact/Wide, then changed density to Spacious.
After both app and host restarted, the Agents and IDE composers retained the
exact final draft; Appearance visibly retained Spacious and Wide. Host readback
retained settings revision 3. This proves persistence and the native appearance
control, not the separate OMP Settings panel's `Refresh and retry` control or a
visual density comparison in the IDE. Both windows were monitored for renderer
exceptions, including windows created later; none were recorded.

Durable [result](shared-state-result.json), [native observations](shared-state-native-observations.json),
and [restart observations](shared-state-restart-observations.json). Earlier
harness attempts exposed Darwin's Unix socket path limit; shortening the isolated
profile path resolved it. Another gate was intentionally released without native
edits to terminate an obsolete harness before adding all-window error monitoring;
its window-count failure is retained and not counted as a pass.

## OMP startup/output follow-up

The strict catalog rerun `2026-09-30T02-13-51-550Z` failed its 20-second ready
deadline. Direct inspection found noninteractive model discovery scheduled before
RPC readiness, and a second stdout loop writing frames already owned by
`RpcOutputWriter`. Direct probes observed duplicate ready/command-catalog frames;
the failed profile's discovery cache grew to 36 providers. Catalog discovery is
the supported workload hypothesis for the intermittent delay, not a timing claim
proved solely by cache size.

The fix keeps one backpressure-aware stdout writer and starts RPC/RPC-UI model
discovery through an `onReady` callback after emitting the ready frame. It does
not disable discovery or increase the ready deadline. Seventeen focused tests
pass, including real output/backpressure, actual main-to-RPC readiness ordering,
and owner/controller adoption after stdin EOF. Upstream typecheck and formatting
pass. Independent review found no additional material issue in this scoped fix.
Closed stdout-reader behavior is distinct from clean stdin EOF and is not inferred
from that adoption test.

Package stamp `2026-09-30T02:50:24.702Z` contains patch
`9ee81142bcf8c1fffb46e7fd5dcc813647419d78bcc1e8ff18d3a7d931c3a91b`
and source tree `7de51d4940e6fb39be0749775548a8c6042d2eef`.
[Runtime identity](runtime-startup-fix.json). Package integrity passes 12/12;
coverage passes 1,101/1,101 with live OMP 18.4.3. The earlier native receipts retain
their exact package identity; Agent Window assets are unchanged, but this does
not silently relabel earlier runs as executions of the new OMP binary.

Strict catalog run `2026-09-30T02-52-12-416Z` passes on the new binary with native
gates disabled: cold session startup, add/remove, preserved baseline, stale
selection refused, and zero provider calls. [Result](catalog-startup-fix-result.json).
One passing startup does not establish a long-run latency guarantee.

## Actual OMP settings stale-write/retry: PASS, editor issue found

Native run `2026-09-30T02-53-10-891Z` started another cold bundled OMP owner and
read its live 516-key inventory. In the actual AI / OMP Settings panel,
`defaultThinkingLevel` initially read `high`; the operator selected `low` without
saving. A second route client wrote `minimal` at the original revision. A real
stale route PATCH received HTTP 409 `omp_settings_stale_revision` (not a fabricated
error fixture). Native Save then displayed `This value is stale and was not written.`
and `Refresh and retry`; the route winner's value and revision were unchanged.
Native Refresh read `minimal`; selecting `low` again and saving produced the
visible saved/readback revision `52ad0d017f6a461f568231e30dfb4fb0` and the same
live-host value. Zero provider requests and renderer exceptions.

Durable [result](omp-settings-native-result.json), [stale UI](omp-settings-stale.png),
and [successful retry](omp-settings-retry.png). The proof's route-only mode was
corrected after review to require the same actual stale response, rather than
testing a constructed error literal.

This observation also found a product defect: the enum editor showed “Choose a
value” instead of its current value, both on initial Edit and after Refresh.
`settingValueToEditorText` JSON-quoted strings, while the enum options and string
parser expect raw strings. The new regression failed on `"high"`; the correction
returns strings unchanged while retaining structured JSON and redaction guards.
The CAS acceptance above passes after explicitly reselecting a value; it does not
qualify that subsequent editor correction until a fresh package is exercised.

## Closed stdout owner continuity correction

A follow-up review distinguished clean stdin EOF from a genuinely closed stdout
reader. The latter reproduced an existing owner-lifetime defect: the CLI's shared
postmortem stdout handler invoked `runQuit(0)` on EPIPE even though the CEDIA owner
socket was still listening. This was explicit cleanup/exit, not an event-loop
liveness problem; no polling timer or synthetic keepalive was added.

The shared handler now accepts a scoped disconnect handler. RPC registers it only
after creating the owner endpoint and before sending ready; it detaches the lost
primary transport without disposing the owner. Cleanup releases that registration,
and ordinary CLI registrations retain their default graceful-exit policy.
The `RpcOutputWriter` failure path likewise hands transport loss to the existing
owner. No second executor or transcript is created.

Review caught an initially weak regression that closed stdin immediately after
stdout, allowing clean EOF to win without EPIPE. The corrected test must claim a
controller and read the same owner while stdin is still open, then close stdin
and claim/read again. The source suites pass 27 tests (235 expectations), including
output/backpressure, startup ordering, owner/controller and postmortem behavior.
Compiled-runtime qualification is recorded separately when complete.

The host lock integration test also now defaults to this repository's prepared
`dist/omp/omp`, not a hard-coded personal OMP installation. Its previous plain
test run failed against that machine's old 18.4.2 installation; the corrected
focused test passes without an environment override. Explicit overrides remain
supported.

## Final qualified build and verification

The final local package is stamped `2026-09-30T03:15:47.176Z`, with OMP patch
`0c08a6cc4a6666fb2802b73ad9a165d5e6dafe81d118d5672785e1fad101b6f3`,
source tree `cf54f5c95b75442ea9c131c0405f10923fc5b8b1`, and standalone SHA-256
`364e897216588b8c165683fbd4815da1c07654ec286bf400b34999f5a9477a27`.
[Final runtime descriptor](runtime-final.json). This is a local ad-hoc-signed,
not-notarized package; no commit, push or distribution was performed.

- Plain `bun run test`: 1,452 pass, zero failures, 8,638 expectations.
- Agent Window's 422-test suite plus the seven settings-logic tests: 429 pass,
  zero failures, 1,559 expectations.
- Root and Agent Window typechecks: pass.
- `check:packaged`: 12/12 pass.
- `check:omp-coverage --require-complete`: 1,101/1,101, live 18.4.3,
  zero integrity failures or disposition gaps. Source coverage only.
- The strengthened owner test also passes against the actual standalone binary:
  controller attachment and state read before stdin closes, then another attachment
  after EOF. [Compiled test log](compiled-owner-epipe-test.log).
- Ordinary CLI `--help | true` retains its passing graceful-exit regression.

Final native settings run `2026-09-30T03-16-33-274Z` passes on this exact package.
Initial Edit displays `high`, not the placeholder. Native stale Save is rejected;
Refresh shows `minimal` in both row and dropdown; reselection and Save read back
`low` at the expected fresh revision. The real stale route receives HTTP 409.
Zero provider requests and renderer exceptions. Durable [result](omp-settings-final-result.json),
[stale state](omp-settings-final-stale.png), and [retry state](omp-settings-final-retry.png).
This closes the enum hydration defect and native OMP settings CAS/retry subscenario.

Final strict catalog run `2026-09-30T03-20-56-929Z` also passes on the same final
binary: another cold session, add/remove, baseline retained, stale selection
refused, zero provider calls, native gates disabled. [Final catalog result](catalog-final-result.json).

The earlier Send/edit, shared-draft/migration, pending-model/dirty-picker, catalog
picker and simulated-lifecycle receipts retain their recorded package revisions.
They are not silently counted as reruns of this final binary. Real macOS login,
remaining full-checkpoint semantic evidence and all excluded remote/device work
remain outside these passing local subscenarios. At this checkpoint, `check:repo`
still had nine unrelated monochrome-research reference/index failures, pending
owner direction. The follow-up below closes that documentation gate only.

## Owner-authorized documentation follow-up — 2026-09-30

The owner authorized the narrow repair of the remaining eight broken references
and one missing evidence-index entry. The referenced generated brand outputs are
absent from the checkout: their original repository-relative paths are retained
as text, explicitly marked missing, and the visual observations remain historical.
No replacement artwork was invented, no design conclusions changed, and no
validator rules were changed. The research is now indexed in the canonical plan.

Fresh verification: `bun run check:repo` exits 0 with
`CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=853 md=389 evidence=360`.
This is documentation validation, not a rerun of runtime tests or closure of the
remaining login, semantic-acceptance or excluded remote/device scenarios.

## Post-checkpoint native worktree Send — failed, 2026-09-30

Source checkpoint: `b848dd51cdb`. Package stamp: `2026-09-30T03:15:47.176Z`;
fresh `check:packaged` passed 12/12 before this run. The unchanged task-controls
runner used a freshly copied scratch app, isolated host/profile, fake OMP and
provider tripwire. Native interaction used the available app-native Computer Use
tool; the requested custom-model skill could not be initialized because its
referenced bundled instruction file was absent.

Run: `dist/task-controls-packaged-proof/2026-09-30T03-49-35-437Z/`.
The pending-model observation passed. In the dirty project, the native New
worktree picker showed `From main` and both files selected. Immediately before
Send, AX showed `Carry changes into worktree (1 of 2)`, `drop.txt` unchecked and
`keep.txt` checked. Clipboard transport timed out; native single-key input entered
the fixture prompt `a`. No provider-backed prompt was sent.

Native Send created task `badde4f1-fe70-4e14-86b2-6d9ed7afe62a` with one running
fixture turn, but produced two worktrees: first `bf5cd622-a559-40e3-b5c1-85b8584a504f`
on `synara/97f932d5`, then the task-named worktree on its `cedia/task-...` branch.
The final receipt said `dirtyCopy: { mode: "all", entries: [] }`. A direct byte
assertion failed: unselected `drop.txt` contained `dirty drop not selected\n`,
not `base drop\n`. Selected `keep.txt` contained its dirty bytes. This is a failed
native Send acceptance result, not a pass inferred from the earlier picker test.

The runner subsequently created its separate HTTP-route task
`14ac49a8-123d-478e-b02c-22474d9953aa`; that route still copied only `keep.txt` and
left `drop.txt` at base. Its `result.json` therefore passes only the original
observation/route scope, not the additional native Send. Provider requests and
renderer exceptions were both zero. Native Stop and Quit confirmed shutdown of
the extra held fixture task; the runner exited 0 and retained its scratch state
for diagnosis. No user project or production session was changed.

Durable [submitted native task capture](native-send-before-fix.png) and
[original observation/route result](native-send-diagnostic-route-result.json).
The latter's `ok: true` applies only to the separately created route task, not
the failed native selected-file Send described above.

## Native worktree Send correction and reproof — 2026-09-30

The failure had two distinct causes: the inherited renderer flow pre-created a
temporary Synara worktree before the CEDIA host created its own task worktree;
persisted/shared draft normalization also omitted `dirtyFiles`. The OMP draft
path now lets the host own worktree creation, preserves selected paths and an
explicit empty selection across hydration, and reads the latest draft selection
immediately before promotion. The adapter projects the host workspace back to the
renderer. Setup and turn dispatch require a matching absolute host worktree/cwd,
a task branch, and a path different from the source checkout.

Cancel/Work locally choices are consumed before creation and before setup.
After host creation, failures retain the durable task/worktree; a late Work
locally choice explicitly refuses this Send rather than pretending the host cwd
changed. Independent source review found no remaining material issue in that
flow. The generic non-OMP worktree path is unchanged.

Revision: `b848dd51cdb` plus the local production diff (SHA-256
`51502bb60d4775998862e546c95d378a11092e241c521c55295e3b8c29ae92cc`, covering
`cedia-adapter.ts`, `ChatView.logic.ts`, `useChatTurnExecution.ts`,
`composerDraftDomain.ts`, and `composerDraftPersistence.ts`). Package stamp:
`2026-09-30T04:25:38.600Z`; Agent Window asset receipt:
`3e00a051bb69ed7b0d53cf997a42b9670b3186fb0f36e32651350154a14f959d`.
The package build and all 12 packaged checks passed. A post-freeze two-expression
path fallback change was discarded, restoring the exact reviewed production
source used for this package; test-only additions do not change the package.

Run: `dist/task-controls-packaged-proof/2026-09-30T04-28-28-187Z/`, using
`CEDIA_TASK_CONTROLS_NATIVE_SEND=1` and CUA. The enhanced gate creates no separate
route task in this mode. The scratch app used isolated state and the reviewed
Login Item shim; no production profile, Keychain, or provider-backed turn was used.

Native CUA observed the pending-model label again, created one dirty-project
draft, chose Worktree from `main`, entered `a`, unchecked `drop.txt`, and entered
`b`. AX retained `1 of 2` after that prompt edit. One native Send submitted `ab`.
AX then showed the running fixture turn and branch
`cedia/task-bc573f65-d128-4c8a-b68f-29ca7244267a`.

The structured gate passed all assertions: exactly one additional task, one
running/completed submitted turn (native AX observed running), one additional
worktree, no temporary Synara worktree, task cwd matching that worktree, and the
selected `main` commit `d904f3adae950c9d79acaa929205ef3003047a55`.
The dirty-copy receipt contains only applied `keep.txt`; its dirty bytes are
present, `drop.txt` remains `base drop\n`, and both source dirty files remain
unchanged. Provider requests and renderer exceptions are zero. Cleanup stopped
the fixture tasks, closed the app/host, retained diagnostic state, and exited 0.

Durable evidence: [native submitted task](native-send-fixed.png),
[complete native-mode result](native-send-fixed-result.json), and
[worktree/file assertions](native-send-fixed-files.json).

Fresh focused tests passed 76/76 (254 assertions), including adapter projection,
selected/empty dirty-file persistence and negative proof-gate cases. Root and
Agent Window typechecks passed. Attempted full-ChatView browser cases could not
execute: the existing suite imports the absent `src/test/effectRpcWebSocketMock`
helper and has no general browser config. A temporary config confirmed the
missing-helper failure before tests. The temporary config and unvalidated new
browser cases were removed; this change retains the executable focused tests.
Cancellation/readback cases therefore have source-review coverage, not claimed
browser runtime acceptance.

This closes the reproduced native selected-file Send defect with fixture OMP.
It does not certify provider-backed turn semantics, a real macOS login cycle,
all D/F rows, or any excluded W/N/Tailscale/iPhone work. This continuation is
uncommitted; the earlier checkpoint and Draft PR are unchanged.

### Broader verification remains open

The default root suite reported 1,451 passes and one five-second model-role
persistence timeout. Its four-test file passed with a 60-second test budget
(runtime startup took 5.2–6.7 seconds, persistence 7.9 seconds). No production
timeout or assertion was weakened. A second full run with `--timeout 60000`,
overlapping build/UI verification, reported 1,448 passes and four failures in Git
round trips, version-probe responsiveness, and real owner attachment. The two Git
cases and version-probe case passed when isolated. Owner attachment first failed
with `owner did not answer in time`, then passed alone (27 assertions).

A final full run without overlapping build/UI work still observed an owner
read-client attachment failure at `omp-owner-attach.test.ts:437`. Before its
terminal summary could be retained, the repository's entire `dist/` directory
disappeared outside this task's actions, including the redirected test log. That
run exited 1; no final pass count is claimed. Further builds/tests were paused
pending coordination with the owner about possible concurrent cleanup. The
native artifacts copied into this evidence directory before that event survive.
This receipt does not claim a green full suite or diagnose the intermittent
owner-attachment failure as fixed.

### Resume after cleanup and disk-aware verification — 2026-09-30

The owner confirmed cleanup had ended and authorized continuation, asking that
free space be checked. The data volume initially had 48 GiB available. No user
files, caches, old builds, or scratch applications were deleted by this follow-up.
The persistent app occupies approximately 1.4 GB; no new app copy or full app
package was built. Final free space was approximately 44 GiB, adequate for this
bounded verification; subsequent full builds should recheck capacity first.
The final OS reading also reported approximately 6.5 GiB of swap in use, so
avoiding concurrent heavy builds/test suites remains useful for memory pressure
as well as disk growth. This observation does not establish the cause of the
earlier intermittent failures.

The packaged OMP binary passed the formerly intermittent real-owner test four
consecutive times without changing its two-second internal probe deadlines.
A serial full suite using that binary reported 1,451 passes and one failure:
`cli-launcher.test.ts:179` deliberately clears runtime overrides and requires
`dist/omp/omp`, which cleanup had removed. Its actual result was `undefined`.

`bun run prepare:omp` restored the development launcher and build receipts through
the normal verified preparation path. Cargo reused its 3.4 GB target directory
and downloaded missing dependency cache entries; the recreated `dist/` itself
was only 12 KB. The prepared runtime attestation passed for source revision
`fc671eba383f2a7208500836673b485c0dc7073d`, source tree
`cf54f5c95b75442ea9c131c0405f10923fc5b8b1`, and launcher SHA-256
`f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`.

Fresh serial verification, without an OMP binary override:

```sh
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib --timeout 60000
```

Result: **1,452 pass, 0 fail, 8,636 assertions across 173 files**, exit 0 in
65.46 seconds. The real-owner record/read-client case passed in 761.51 ms and the
restored default-launcher lookup passed. The 60-second budget belongs only to the
test runner; production connection deadlines, assertions and source code were
not changed. Focused native-proof/adapter/dirty-picker tests also passed 76/76,
254 assertions. The [retained full-run log](root-tests-after-cleanup.log) has SHA-256
`fb27780c8abd21090e0beaa84f05008c9ec65075d515d5557b70910371f03217`.

The current full suite is green. Earlier intermittent owner failures are not
claimed permanently fixed: source tracing identified bounded handshake/read
deadlines and runtime startup/queue timing as investigation points, not a proven
root cause. No speculative timeout increase or retry was introduced. The prior
native Send receipt remains qualified at its recorded package revision. Full
D/F acceptance, real login/device/excluded remote work, and publication of these
uncommitted changes remain separate.

### Executable worktree Send hook coverage — 2026-09-30

The earlier source-review-only cancellation/readback limitation above is now
partially closed by a dedicated Chrome-headless hook suite. It mounts the real
`useChatTurnExecution` hook and uses the real promotion and resolution helpers,
without importing the broken full-ChatView browser harness. Native API, stores,
attachments and setup execution are controlled fixtures; this is executable hook
coverage, not a native UI or real-host cancellation receipt.

Eight cases pass: canonical host worktree success for selected `keep.ts` and
explicit carry-none `[]`; Cancel before creation; late Cancel and Work locally
while host readback is deferred; and null, rejected or noncanonical readback.
Failure cases await the completed false result before checking no setup, turn,
task deletion or worktree removal, and check prompt restoration. Setup is enabled
in the negative fixtures so its absence is meaningful. Success checks ensure the
generic renderer worktree creator is skipped and setup receives the canonical
host cwd. A separate read-only review found no material defects in the harness.

Run from `apps/macos/agent-window/vendor/synara/apps/web`:

```sh
bunx vitest run --config vitest.worktree-send.config.ts
```

Fresh result: **8 passed, 0 failed**, one file, exit 0 in 2.31 seconds using
Vitest 4.1.11 and installed Chrome. The [browser log](worktree-send-hook-browser.log)
has SHA-256 `bd40460a338510931076c5d39212112121ff170e1489447e549a4fea5092b668`.
The initial runner-root/dependency resolution and harness-mount/promise errors
were corrected in test code/config only. The log retains a Node deprecation
warning; no passing tests are inferred from those failed setup attempts.
Browser test files are excluded from the existing vendor typecheck; no new
typecheck coverage is claimed. Focused Bun checks also passed 76/76, 254 assertions.

The five production-file diff hash remains
`51502bb60d4775998862e546c95d378a11092e241c521c55295e3b8c29ae92cc`:
no production change or new app package was needed. Disk space was approximately
44 GiB after verification. Only this run's failed-harness screenshots were moved
to `/tmp/cedia-worktree-hook-diagnostics.Rbk3fm` (recoverable); no user files or
caches were deleted. These additions are uncommitted and the checkpoint PR is
unchanged. The next bounded local candidate is live queue-panel Drop last
interaction; existing backend queue smoke and static markup checks do not prove
that UI action. Full D/F and excluded remote/device acceptance remain separate.

### Live queue-panel Drop last — 2026-09-30

The bounded queue-panel gap above now passes via
`bun scripts/omp-queue-smoke.ts --browser`. The opt-in harness serves the existing
Mac package's Agent Window assets in headless Chrome, connects the production
adapter/handler to an isolated real host and OMP 18.4.3, opens Task controls, and
clicks the actual Drop last button. The active turn and queued follow-up are
seeded through the host, not through composer Send; this does not qualify
composer enqueue behavior or native Electron/window acceptance.

The final run at `2026-09-30T05-30-29.037Z` exited 0. It observed the exact queued
text, one successful UI drop attempt, Dropped text and Nothing queued. Fresh host
readback confirmed both queues empty, the dropped intent `cancelled`, and the
original held turn still `running`. The loopback model fixture received exactly
one request; no external provider was used. Renderer errors were empty. The
shipped entry-script SHA-256 was
`78d0d8e1e2a1a64845bb4247a8a4fcd9101bfd05753360d5c5a5328b4b4aa888`.
No app package was rebuilt or launched and no Keychain operation was used.

Evidence: [before drop](queue-before-drop.png), [after drop](queue-after-drop.png),
[structured result](queue-browser-result.json), and [complete run log](queue-browser.log).
The initial run timed out because Task controls was collapsed. Review also found
the initial handler omitted its explicit fixture state directory, allowing its
theme/draft-cache access to fall back to the user's default directory. That run
is not an isolation receipt; no claim is made that it never accessed default UI
state. The corrected final run passes the fixture directory to both gateway and
handler. Review's remaining findings (count attempts before awaiting results;
load Playwright before acquiring a listener) were corrected and re-reviewed.

Root typecheck passed, and the queue adapter/surface/turn-state tests passed
10/10 with 31 assertions. Only test/proof code and documentation changed in this
slice. Free space was approximately 42 GiB. Successful fixture directories were
removed by the smoke's existing cleanup; screenshots and logs above are retained.
The failed run's diagnostic scratch data was not purged. No new commit/push was
performed. Full D/F acceptance and excluded remote/device work remain open.

### Composer enqueue to OMP and Drop last — 2026-09-30

The owner approved continuing the composer-driven queue scenario and a follow-up
checkpoint. Testing the existing package exposed a real integration gap: after
the first Send was acknowledged, Enter on a follow-up created a Synara
renderer-local queued row, not an OMP follow-up. Only one native turn dispatch
was recorded. [Failure diagnostics](composer-queue-before-fix.json) and the
[failure screenshot](composer-queue-before-fix.png) preserve this result.
An earlier harness attempt pressed Enter before the first dispatch settled and
left text in the composer; the retained reproduction waits for dispatch
settlement, the Stop button and cleared composer before entering the follow-up.

The bounded production fix bypasses the renderer-local chat queue for OMP only,
using the existing execution hook and adapter's `follow_up` dispatch. Other
providers retain their existing queue. Review identified a second effect:
optimistic transcript insertion left a normal user bubble after a queued prompt
was dropped. The extended proof [failed with two copies](composer-queue-optimistic-red.log)
before the fix. Live OMP queue submissions now omit optimistic transcript
insertion and its tail anchor; the OMP queue receipt represents acceptance, and
an eventual durable user echo still supplies real transcript history.

Build the frontend with `bun run --cwd apps/macos/agent-window build`, then run:

```sh
CEDIA_QUEUE_UI_ASSETS=/Users/pond/cedia/dist/agent-window bun scripts/omp-queue-smoke.ts --composer
```

Final run `2026-09-30T05-50-47.998Z` exited 0: exactly two composer submissions,
host states running/queued, exact Drop last receipt, dropped intent cancelled,
fresh empty queues, original turn still running, Stop still visible, and dropped
text only in Drop history rather than the transcript. One loopback model request
and zero renderer errors were recorded. Evidence: [result](composer-queue-fixed-result.json),
[log](composer-queue-fixed.log), [final screen](composer-queue-fixed.png).
The rebuilt frontend entry SHA-256 is
`41344f5ef6dd24dbd4c82538aa45f9eaee2ac6be79a8659a24540b796a51f2c7`.

This is a source-built frontend/real-host/OMP proof in headless Chrome, **not** a
repackaged native application proof. The installed package still needs this queue
fix incorporated and native qualification. Multiple pending entries, subsequent
queue execution and attachment-specific lifecycle are not qualified by this
plain-text cancellation scenario. Root and Agent Window typechecks pass; Agent
Window tests pass 424/424 (1,532 assertions). Build warnings about chunk sizes
and Node's deprecated module registration remain, without build failure.
Review of the follow-up fix found no remaining material findings in this slice.
Disk space after the frontend-only build was approximately 41 GiB. No provider
credential, Keychain, native app launch, deployment or excluded device work was
used. The checkpoint retains prior worktree fixes, both queue proof stages and
these qualifications; unrelated monochrome artwork remains outside it.

### Packaged native composer queue — 2026-09-30

The queue fix from checkpoint `24669f0a717` is now incorporated in the persistent
Mac package through the normal `package:mac` command using the configured Node
24 binary. Package stamp: `2026-09-30T06:00:41.178Z`; Agent Window aggregate
SHA-256: `e1a6cb4f773f50326d8f7420e074035b222212d300ec657bc1da1d09b6449731`.
The package checks pass 12/12 before and after native proof, including source
asset/stamp equality. [Retained package checks](native-queue-package-check.log).

An independent copy was made under the OS temporary directory. The proof reused
the reviewed two-call Login Item shim in that copy only, verified its main module
against the current build before shimming, and ad-hoc signed the copy. It launched
with isolated HOME, user-data and host state, basic password storage and in-memory
secret storage. No Keychain read/delete command was used. The runtime was the
copied package's OMP 18.4.3 executable; the isolated host was started from repository
source. This is not a bundled-host startup/adoption qualification.

The real Electron Agent Window, without the browser fixture's injected IPC bridge,
passed the same two-composer-submission/Drop last sequence. Final run:
`2026-09-30T06-05-59.983Z`, exit 0. Exactly two turn submissions, one UI drop,
one loopback model request, cancelled queued intent, empty queues and a still-running
first turn were verified. Stop remained visible, and the cancelled text appeared
only in Drop history, not as a transcript bubble. Renderer errors were empty.
The native entry-script hash matches the earlier source proof:
`41344f5ef6dd24dbd4c82538aa45f9eaee2ac6be79a8659a24540b796a51f2c7`.

Evidence: [native queued screen](native-queue-before-drop.png),
[native dropped screen](native-queue-after-drop.png), [result](native-queue-result.json),
[run log](native-queue.log), and [Login Item interception](native-queue-login-shim.jsonl).
The action method was Playwright Electron UI automation, not CUA. The scratch app
was explicitly exited after capture to bypass active-task quit confirmation, then
the outer smoke closed its host. No scratch app process remained. Normal quit,
real login-cycle and OS Login Item persistence are not certified. A read-only
`sfltool dumpbtm` attempt produced no output and was interrupted; no claim relies
on it.

Two harness-startup failures preceded the result: the path guard correctly refused
a copy under `/tmp` rather than this Mac's OS temp directory, then Code-OSS rejected
the long `native-profile` IPC socket path (`EINVAL`, over 103 characters). Moving
the copy to the OS temp root and shortening the isolated profile folder to `u`
resolved these without changing product code or connection deadlines. The reviewed
native runner addition is proof-only. Root typecheck and the eight native proof
helper tests pass. This closes the bounded native plain-text queue cancellation
scenario; multi-entry execution, attachments and full D/F remain separate.
The generated scratch application was removed after verifying its process had
exited and its main module had a different inode from the installed app. The
copy is reproducible from the retained installed package; durable proof artifacts
remain above. Final free space was approximately 37 GiB. This native proof/runner
follow-up is not yet committed; the published checkpoint remains `24669f0a717`.

### Sequential composer execution — initial failure, 2026-09-30

The new `bun scripts/omp-queue-smoke.ts --execute` scenario uses the same shipped
frontend and packaged OMP executable in headless Chrome, with the source host and
an isolated loopback SSE endpoint. It explicitly selects `one-at-a-time` follow-up
mode; this is not a claim about the default or the runtime's `all` mode. Three real
composer submissions hold A running while B/C wait. Responses are released only
after checking the expected request, queue order and host intent state.

Run `2026-09-30T06-32-51.653Z` failed the first completion gate. A's answer appeared
and B's HTTP request began, but A's durable intent did not complete. The journal
names A at `turn_end` sequence 140 and again at `turn_start` sequence 142 even
though B's user message is now in the transcript. The existing runtime ledger
adopts identity only at `agent_start` and releases it at `agent_end`; queued
follow-ups can run inside that same agent loop. This is a real uncovered identity
boundary, not a duplicate composer submission: exactly three dispatches and no
renderer errors were observed. The host also requires explicit submission-level
settlement rather than treating every model/tool `turn_end` as user-task completion.

Evidence: [failure result](queue-execution-before-fix.json),
[failure screen](queue-execution-before-fix.png), [run log](queue-execution-before-fix.log).
The failed fixture was closed; its isolated journal remains available for diagnosis.
Sequential execution acceptance remains open pending a corrected identity contract
and rerun. No production code was changed by this initial proof, and the installed
package remains the earlier qualified cancellation build. Free space: about 37 GiB.

The cancellation recheck also exposed a renderer timing gap: run
`2026-09-30T06-38-28.758Z` produced a second copy of the dropped prompt in the
transcript. Its OMP session file contained only A, while B's durable intent was
cancelled. The frontend's `hasQueueableLiveTurn` requires a projected active-turn
ID, which can lag the live/running session phase after ACK. The OMP optimistic
bubble guard now uses `hasLiveTurn`; the non-OMP renderer queue condition is
unchanged. Evidence: [failed result](queue-drop-recheck-failure.json),
[failed screen](queue-drop-recheck-failure.png), [failed log](queue-drop-recheck-failure.log).

After rebuilding the source frontend, the real composer/Drop last smoke passed
three consecutive runs with the packaged OMP executable and isolated source host:
`06-53-08.322Z`, `06-53-24.238Z`, and `06-53-35.718Z`. Each retained one model
request, two submissions, a cancelled queued intent, an empty queue and one copy
of the removed text in Drop history only. This qualifies the tested source UI,
not a new native package or proof that every timing interleaving is covered.
Evidence: [run 1](queue-drop-race-fixed-1.log), [run 2](queue-drop-race-fixed-2.log),
[run 3](queue-drop-race-fixed-3.log), [result](queue-drop-race-fixed-result.json),
[final screen](queue-drop-race-fixed.png). Agent Window tests pass 424/424 with
1,532 assertions; its typecheck and frontend build pass. Free space: about 35 GiB.

### Submission boundary corrected; transcript ordering follow-up

The OMP bridge now emits `cedia_turn_boundary` only after a prepared follow-up
batch commits, and settles its final batch at the actual terminal `agent_end`
emission. Tool/model rounds, named steering and cancelled preparation do not
promote another submission. The host consumes the named batches without releasing
its outer prompt command early, and can enrich an already-running intent with
the model metadata subsequently reported by OMP. The refreshed patch SHA-256 is
`6f02429fb272fb4fe6cd23d7622060e36d6505f121567f79c64184fbfd8bd28a`.

Verification: [55 runtime tests](queue-runtime-tests.log) pass with 262 assertions;
the coding-agent typecheck passes. The defined root test script passes
[1,453 tests](queue-host-adapter-tests.log), 8,649 assertions. Root typecheck and
the live OMP coverage check pass (1,101 mappings, zero fatal issues). An accidental
unscoped `bun test` invocation also traversed upstream scripts and encountered a
watchdog test failure; it is not reported as a passing full-upstream suite. That
test left two marker files in `upstream/omp/omp-test-runner-watchdog-rTNs7n`, which
the runtime source-attestation guard correctly rejected. Only those generated
`started`/`continued` files and their empty directory were removed; the source
patch was not expanded to include test residue.

Run `2026-09-30T07-10-06.483Z`, using the prepared development OMP runtime and
rebuilt source UI, passes every host execution gate: exactly three requests,
A/B/C started and completed in order, and no queued work remains. The final UI
gate still fails because B's answer is folded out of the visible transcript.
The journal contains B's assistant message at sequences 160–164 and C's user
message at 168–169. C retains its earlier enqueue timestamp, so timestamp sorting
places it before B's answer. This is a presentation-order defect, not a lost
OMP answer. Preserve the runtime timestamps and repair the UI's ordering contract.
Evidence: [result](queue-execution-transcript-failure.json),
[screen](queue-execution-transcript-failure.png),
[log](queue-execution-transcript-failure.log). The installed package has not yet
been rebuilt with these corrections; end-to-end sequential acceptance remains open.

### Sequential composer execution — source and native package pass

The UI now carries optional `transcriptOrder` from OMP's transcript projection
through the read-model contract, normalization and timeline. It uses the same
one-based coordinate as activity rows, preserving original timestamps while
keeping queued answers and tool activity inside the correct response segment.
Mixed optimistic rows retain stable source order; a newer authoritative snapshot
order wins even when live text is retained. The focused regression captures the
original inverted B-answer/C-user timestamps, tool placement with an optimistic
D row, normalization-only order changes and the non-OMP chronological fallback.
Independent review found and resolved mixed-order comparison/merge issues; full
live-hot-path hydration was inspected but is not a new dedicated regression test.

Source UI plus standalone OMP passed `--execute` in
`2026-09-30T07-28-01.551Z`: [result](queue-execution-source-passed.json),
[screen](queue-execution-source-passed.png), [log](queue-execution-source-passed.log).
The final mixed-row correction was then rebuilt into package
`2026-09-30T07:30:23.110Z`, which passes
[12/12 package checks](queue-execution-package-check.log).
Agent Window tests pass [428/428](queue-agent-tests.log), 1,537 assertions, and
both Agent Window typecheck configurations pass. The
[focused transcript tests](queue-transcript-focused-tests.log) pass 4/4.

The first native execution run `2026-09-30T07-31-29.018Z` completed all three
requests and displayed all six messages, but the proof incorrectly assumed DOM
insertion order was visual order. `LegendList` recycles row elements. The retained
[failure result](native-queue-execution-dom-order-failure.json),
[screen](native-queue-execution-dom-order-failure.png) and
[log](native-queue-execution-dom-order-failure.log) distinguish this runner defect
from the earlier real timestamp-sorting defect. The runner now checks rendered
row positions while retaining exact-text uniqueness and all host execution gates.

Native rerun `2026-09-30T07-33-47.008Z` passes through real Electron IPC, the
packaged frontend/OMP executable, an isolated source host and a loopback model:

- Exactly three composer submissions and three sequential model requests.
- A/B/C each transitions from waiting/running to completed at its named boundary.
- Queue readback contains only the later submissions, then becomes empty.
- All six user/assistant messages appear exactly once in visual execution order;
  Stop disappears after completion, with zero renderer errors.
- The owner-only route still rejects an unauthenticated read with 401.

Evidence: [result with visual row positions](native-queue-execution-result.json),
[queued screen](native-queue-execution-queued.png),
[completed screen](native-queue-execution-completed.png),
[log](native-queue-execution.log),
[isolated Login Item shim log](native-queue-execution-login-shim.jsonl).
Packaged Agent Window aggregate SHA-256:
`f14520f9cae2155e0fc3bd4edf7943623762ccb2c4ff8c8c9d8a385b9029e752`;
renderer entry SHA-256:
`1af1db63f37d06e0c23ef2566d4eca21b2a4a7108af551c08ae850bcf0bde6a9`;
installed and staged OMP executable SHA-256:
`bfafe01e3106dfc3fb28b6ce32d86157a11e3ebc965b573b23a36d262e6fe954`.

This closes the bounded native one-at-a-time plain-text execution scenario, not
attachment lifecycle, provider-backed behavior, native all-mode execution,
bundled-host startup, normal quit, real login-cycle or full D/F acceptance.
The scratch application uses separate profile/HOME/state paths and two Login
Item shims; no Keychain read/delete or paid provider call is part of this proof.

Final root verification: the run concurrent with native execution hit the default
five-second test-runner limit while applying the desktop patch set
([failure log](queue-root-tests-timeout.log)). After the native run exited,
`bun run test --timeout 60000` passed [1,453/1,453](queue-final-root-tests.log),
8,649 assertions, in 83.80 seconds. Only the test invocation's budget changed;
production timeouts and the patch-application test were not modified.

The current package also passes native composer/Drop last in
`2026-09-30T07-38-32.911Z`: two submissions, one held model request, the exact
queued text cancelled and shown only in Drop history, empty queue readback, and
the original turn still running. Evidence:
[result](native-queue-drop-current-result.json),
[screen](native-queue-drop-current.png), [log](native-queue-drop-current.log).
An earlier cold-start attempt had an empty composer and zero dispatched commands
when Send timed out ([result](native-queue-drop-startup-failure.json),
[log](native-queue-drop-startup-failure.log)). The runner now waits for the
fixture's selected model to appear before typing into the newly hydrated draft;
no production readiness timeout or Send behavior was changed for that rerun.

Root typecheck, Agent Window typechecks, documentation validation and
`git diff --check` pass. The generated scratch application was removed after its
process exited and its independent main-module inode was verified. Only that
reproducible test copy was removed; the installed package, user data and all
linked receipts remain. Final free space is approximately 35 GiB. These local
corrections are not yet committed; the published checkpoint remains `24669f0a717`.

## Image attachment lifecycle follow-up

The provider-free composer proof now submits distinct tiny PNG images with A and
queued B, then submits C without an image. The installed pre-fix assets exposed
two separate projection defects:

- Queue readback reports zero images for B: the OMP RPC queue bridge reads the
  text-only queue accessor and hardcodes the image count to zero. The
  [first failure](attachment-queue-before-fix.json) retains this assertion.
- All three submissions execute in order, but the completed user transcript has
  no image thumbnails. The CEDIA adapter retains OMP raw image content but omits
  attachments from its renderer message projection. The
  [transcript failure](attachment-transcript-before-fix.json) and
  [screen](attachment-transcript-before-fix.png) retain the reproduced defect.

Run `2026-09-30T08-02-46.469Z` used real OMP and a loopback model endpoint with
the existing packaged renderer. A and B reached that endpoint as distinct
normalized WebP images; C had no image in its latest user message. OMP resized
the original 1×1 PNGs to 200×200 WebP, so the proof compares decoded image pixels
with a small lossy-conversion tolerance rather than claiming byte identity.
[Bounded request summaries](attachment-requests-before-fix.json) omit system
prompts. The runner retains the queue-count failure while allowing execution to
reach the independent transcript assertion; it does not waive either gate.

This scope concerns raster image attachments. Generic file attachments currently
contribute labels, not uploaded file bytes, and are not accepted by this proof.
No paid provider, Keychain, external device or login-cycle action is involved.

### Corrections and current verification

The adapter now projects the latest authoritative user image content into bounded
raster data-URI previews. The read-model schema allows these previews without
widening the upload-command schema. Validation rejects remote URLs, SVG,
malformed base64 and payloads above 10 MiB. Generated image names are explicit:
OMP does not retain the original upload filename in this content. Immutable-entry
and attachment-object weak caches avoid rescanning unchanged historical images.
Safe previews survive stale/live snapshot merging; optimistic blob/remote URLs
are not copied into the durable read model. Independent review found and then
verified corrections for repeated validation and lost previews during merging.

OMP now exposes a read-only detailed queue accessor using the same user filter,
live-steering order and chip text as its existing text-only accessor. The RPC
bridge projects real image counts without returning image bytes or mutating the
queue. Drop behavior is unchanged. The consolidated patch SHA-256 is
`fc9be37adecaa184c6f973b230cff883997bf4d93d0e6c6e355c5f6353f42ba5`.

Two early source runs with immediate picker/whole-value `fill` sequencing failed:
[C reused B's attachment](attachment-composer-sequencing-failure.json) and
[A dispatched as image-only](attachment-composer-text-failure.json). The runner
now waits for the attachment chip, enters text through keyboard events, asserts
the exact dispatched text and attachment count, and waits for the consumed chip
to disappear. The failures remain retained. No production composer workaround
was added, and these runs do not establish that every rapid-input/shared-draft
race is absent. The strengthened source proof passes in
`2026-09-30T08-24-02.606Z` ([result](attachment-source-result.json),
[log](cedia-attachment-source-keyboard.log)).

Package `2026-09-30T08:25:21.069Z` passes
[12/12 packaged checks](cedia-attachment-package-check.log). Native run
`2026-09-30T08-26-52.520Z` passes using real Electron IPC, packaged renderer and
packaged OMP, with the source host and isolated loopback fixture:

- A/B/C preserve their entered text and carry image counts 1/1/0.
- The latest user image in each model request matches the correct fixture after
  OMP normalization; queued image counts are correct and no queue gate is waived.
- Exactly three requests and three completed intents produce six unique,
  visually ordered messages, then an empty queue and hidden Stop control.
- A/B thumbnails decode correctly after completion and page reload; C has none.
  Reload produces no additional model request and there are no renderer errors.

Evidence: [native result](native-attachment-result.json),
[completed screen](native-attachment-completed.png),
[reloaded screen](native-attachment-reloaded.png),
[native log](cedia-attachment-native-proof.log),
[isolated Login Item shim log](native-attachment-login-shim.jsonl).
The packaged Agent Window aggregate SHA-256 is
`38d803224b7ed998d6979d129a3ed071ef3ff42aa04fa6e4b928606e9c994189`;
renderer entry SHA-256 is
`7d99f1c3496b084d0e457105af2cb1e7b66bd0a0592a51e56198a38730fcae88`;
packaged OMP executable SHA-256 is
`866b140bae56092d7f4dbd923a7aa2420b6b92a21b6f1e6a344691246927fa28`.

Verification also passes [1,453 root tests](cedia-attachment-root-tests.log),
[436 Agent Window tests](cedia-attachment-ui-final-tests.log),
[10 queue projection tests](cedia-attachment-omp-tests.log),
[8 focused attachment tests](cedia-attachment-transcript-tests.log),
[root typecheck](cedia-attachment-root-typecheck.log), and
[1,101 live coverage mappings](cedia-attachment-coverage.log). The root suite uses
the existing 60-second test-runner budget; production deadlines are unchanged.

This closes only the bounded native raster-image send/queue/transcript/reload
scenario. Generic file bytes, provider-backed acceptance, bundled-host startup,
normal quit, login-cycle and full D/F acceptance remain outside this proof.

Native composer/Drop last also passes on this package in
`2026-09-30T08-29-20.873Z` ([result](native-attachment-drop-result.json),
[log](native-attachment-drop.log)): one held model request, queued turn cancelled,
empty queue, no ghost transcript row and the active turn preserved. An initial
attempt correctly refused to reuse the already instrumented scratch main module
([guard log](native-attachment-staged-copy-refusal.log)); restoring only that
scratch copy's two modules from the installed package allowed a fresh shimmed run.
No installed module was changed by the proof.

[Both Agent Window typechecks](cedia-attachment-ui-typecheck.log), documentation
validation and `git diff --check` pass. The temporary native application was
removed after process exit and independent-inode checks; it can be recreated from
the retained installed package. User data and all receipts remain. The fixes are
local and uncommitted; checkpoint `24669f0a717` remains the published revision.
