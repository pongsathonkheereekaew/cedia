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
