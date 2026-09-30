# CEDIA plan scrutiny — 2026-09-23

Scope: the uncommitted canonical plan and current source tree based on CEDIA commit
`0676dd70d54e429b5a72c98cb3f22a646bbd10eb`. This is a review receipt, not a second plan,
an implementation authorization, or a runtime acceptance certificate. The owner explicitly
deferred all speech-to-text; that scope amendment has been applied to the canonical plan.
Prior source and test receipts retain their original revision limits.

## Intent and smaller route

The goal is one CEDIA application with an AI-primary Synara-derived workspace, a full
Code-OSS IDE, one OMP executor, coherent settings, and same-Mac remote control.
Doing nothing preserves the existing settings/ownership mismatches. Replacing Code-OSS
with standalone Synara loses the required full IDE; adding Zed loses the single-app target.
Retaining the existing base is therefore reasonable. A smaller delivery route is to prove
the desktop task-to-IDE-to-review workflow first, then the existing mobile UI's web export
over Tailscale, then native iPhone acceptance. These are delivery checkpoints, not removal
of the complete target. Defer automatic worktree cleanup until its recovery protocol is
proved; preserve worktrees in the interim. Do not build another remote renderer by default.

## Findings

### F1 — P1: queued command acceptance and turn completion need distinct contracts

The plan §3.C promises queued Send, pending model changes before the next turn and no replay
after interruption. §2.2 requires ordered commands, but R3 does not define the queue owner,
queued-turn identity or how an accepted follow-up becomes an executed turn.

Trace: [adapter dispatch](../../../../apps/macos/agent-window/src/cedia-adapter.ts#L1507)
maps queue to `follow_up`; [host command](../../../../apps/host/src/service.ts#L414)
only treats designated turn commands as active turns. In
[`#dispatch`](../../../../apps/host/src/service.ts#L435), a follow-up is marked completed
on its OMP acknowledgment, although execution can occur later. The
[command table](../../../../apps/host/src/store.ts#L518) has no queued-turn lifecycle.
An ACK followed by a host/process failure can therefore mean accepted-but-unexecuted;
it must not be displayed as a completed turn or automatically replayed.

Correction: document OMP as execution-queue owner and a CEDIA command/turn projection,
distinguish accepted/queued/running/finished/unknown, and define pending-model application
at an authoritative turn boundary. Avoid a second independent queue drainer. Specify
reconciliation of queued content after interruption and explicit user continuation.
Test two clients queueing, changing the pending model and crashing between ACK and turn end.

### F2 — P1: cleanup requires a durable restore receipt before any worktree removal

Plan §3.C/§11.1 requires automatic eligible cleanup and restoration to the retained revision.
R3 names the files but leaves the integration predicate and Git/filesystem/database crash
ordering unspecified. Those operations cannot be one ordinary database transaction.

Trace: [archive route](../../../../apps/host/src/router.ts#L161) changes the archived flag;
[workspace creation](../../../../apps/host/src/workspaces.ts#L176) returns initial base/patch
metadata, while [session deletion](../../../../apps/host/src/service.ts#L539) deliberately
retains worktrees. These existing safe paths are not evidence of the proposed cleanup flow.

Correction: specify a durable task-to-worktree association and immutable restoration ref,
record and verify that receipt before removal, then use idempotent cleanup states with
crash reconciliation. Define the integration proof conservatively; clean status alone is
insufficient, and uncertain squash/cherry-pick equivalence should retain the worktree.
Recheck dirty/ignored files, IDE buffers and active PTYs immediately before removal.
Test failure before/after ref creation, removal and metadata completion, plus restore after
primary-branch advancement. Until these pass, Archive should retain the worktree.

### F3 — P2: shared drafts need a single revision and atomic Send, not two local serializers

Plan §3.C promises one Mac draft with revision-aware edits and one successful Send, while
§3.B still calls draft persistence renderer-local with no host dependency. R2/R4 does not
name the shared revision/Send transaction or its conflict behavior.

Trace: [sharedUiDraftBridge](../../../../apps/macos/agent-window/vendor/synara/apps/web/src/sharedUiDraftBridge.ts#L167)
keeps revision counters and write chains inside each renderer. The
[main-process write endpoint](../../../../apps/macos/src/agent-window-main.ts#L138)
accepts a draft without an expected stored revision. Two windows can each serialize locally
and still overwrite one another, or generate distinct commands for the same draft.

Correction: name one app-side draft owner with compare-and-swap revision checks, conflict
preservation and change broadcasts; link Send to a draft revision and command ID so a stale
window cannot submit or clear newer text. Reuse the existing app-side bridge where possible.
Test two independent renderer instances, delayed writes, send-vs-edit and restart recovery.
The two existing draft tests pass, but exercise a single bridge instance at a time.

### F4 — P2: app/host lifetime must precede remote availability

Plan §3.C requires background windows-close, explicit Quit stop-and-wait, login startup and
no leftover execution daemon. R6 can establish remote availability before R7 defines the
lifecycle path. The supervisor, reattachment/adoption and orderly shutdown handshake remain
unnamed, despite being dependencies of same-Mac continuity.

Trace: [gateway launcher](../../../../apps/macos/src/agent-window-main.ts#L191) can reuse an
existing healthy host; [host lifetime](../../../../apps/host/src/host-lifetime.ts#L26)
intentionally retains an orphan while work is running or a remote client is paired.
[Existing tests](../../../../apps/host/test/host-lifetime.test.ts#L34) assert that behavior;
they do not exercise an explicit Quit or login startup in the packaged application.

Correction: assign one app lifecycle coordinator (prefer Electron main, retaining existing
launch code) and distinguish close, deliberate Quit, app crash, host crash and view/network
disconnect. Specify Stop/await/Cancel and old-host adoption. A surviving stdio OMP child
after host failure must stay blocked unless a proven attach/handoff exists; view reconnect
to a still-healthy host is a different case. Gate remote release on these lifecycle tests,
not just HTTP/socket reachability.

### F5 — P2: the web deliverable needs a named renderer and build/serving path

Plan §6.5 specifies a same-origin web gateway, but R6/R7 does not identify its static artifact
or packaging path. A working authenticated API is not yet the promised remote web product.

Trace: [current phone pairing](../../../../apps/ios/App.tsx#L577) constructs the relay
transport; an [HTTP transport](../../../../apps/ios/src/core/transport.ts#L72) exists but is
not wired there. [Mobile package scripts](../../../../apps/ios/package.json#L11) already
provide `export:web`. The [host server](../../../../apps/host/src/server.ts#L49) is presently
a loopback API, not a static web server.

Correction: explicitly reuse the Expo web export from `apps/ios`, package its output with
the gateway, define the static root and API/auth paths, and distinguish web cookie/CSRF
authentication from native bearer-token storage. Adapt the existing HTTP transport rather
than assuming it already implements the new auth contract. Test a clean packaged install,
deep-link reload, pairing/revocation and actual web control over the tailnet.

### F6 — P2: required release scope cannot be inferred from “available capabilities”

R5 covers all applicable features; §2.3 leaves automation, MCP management, statistics and
several other families pending. §11 checks available capabilities and per-capability claims.
There is no fixed list that prevents a nominal release from moving required features to
pending, nor a bounded first checkpoint that avoids waiting for every upstream feature.

Trace: [adapter catalogs](../../../../apps/macos/agent-window/src/cedia-adapter.ts#L1714)
return empty placeholders, and [automation mutations](../../../../apps/macos/agent-window/src/cedia-adapter.ts#L1823)
are unsupported. Those are already acknowledged implementation gaps, not additional defects.
The planning defect is the missing release classification around them.

Correction: classify each existing capability family as required for a named desktop,
remote-web or native-iPhone checkpoint, or explicitly deferred. Give each checkpoint a
bounded observable workflow and forbid hiding a required feature to pass its gate. Preserve
the full long-term target and the owner's explicit voice deferral; no new questionnaire is
needed merely to propose this engineering delivery split.

### F7 — P2: active plan rules still refer to a retired window implementation

Plan §5's panel-controls and tab-group rows instruct keeping native panel controls and the
`cedia-apps-strip` from patch 0017, referring to §7's old React pass. This conflicts with
§2/§7/§8's retained standalone Synara bundle and prohibition on restoring the obsolete shell.

Trace: [patch 0056](../../../../patches/desktop/0056-cedia-agent-window.patch#L217) loads
`vs/cedia/agent/index.html`; the [patch manifest](../../../../patches/desktop/manifest.json)
does not retain 0017/0026. This is a live normative contradiction, not merely an old receipt.

Correction: remove or explicitly supersede those two §5 rules and reconcile §3.B's draft
ownership row with §3.C. Keep dated history in its existing historical sections. A single
filename and a passing link gate do not by themselves establish one consistent specification.

### F8 — P2: the verification commands omit the changed agent UI's typecheck

The R2/R4/R5 source boundary includes the isolated agent UI/vendor tree, but §8 lists only
root/mobile typechecking. [Root tsconfig](../../../../tsconfig.json#L14) explicitly excludes
`apps/macos/agent-window`. [Its package](../../../../apps/macos/agent-window/package.json#L24)
has the required `tsc` and vendor pass; [build-agent-window](../../../../scripts/build-agent-window.ts#L33)
runs only its Vite build. Thus the prescribed build does not invoke that typecheck.

Correction: add `bun run --cwd apps/macos/agent-window typecheck` to the relevant gates,
and require the named mobile web export for its checkpoint. No assertion is made here that
either currently fails; the demonstrated defect is missing coverage in the proposed gate.

## Claims checked but not counted as new plan defects

The missing generic settings RPC, inactive production voice backend, new remote gateway,
and separate user-shell implementation are already named work. Their current absence is
not itself a plan defect. Theme precedence is already stated in §6.4: CEDIA chrome wins,
syntax stays independent and observers must not write back syntax choices as app theme.
The old theme synchronizer and read-only Appearance tests need changing in R2, but this
review does not invent another unresolved product choice from that known transition.

## Verification performed

- `bun test apps/macos/agent-window/test/shared-ui-draft.test.ts`: 2 pass, 0 fail.
- `bun test apps/host/test/host-lifetime.test.ts apps/host/test/workspaces.test.ts`:
  11 pass, 0 fail; temporary Git fixtures only. Expected non-Git fixture diagnostics appeared.
- Source tracing across UI, adapter, host, storage, runtime lifecycle and mobile transport.
- No app launch, provider calls, device enrollment, deployment or voice evaluation.

These passing tests demonstrate existing behavior and the limited coverage described above;
they do not certify the proposed redesign. Findings are plan corrections to make before
their affected implementation slices, not claims that all planned code should already exist.

Verdict: **fix-then-implement**. Retain the selected product/base; define the shared state,
failure boundaries and bounded release gates before calling the full plan execution-ready.

## Owner-authorized plan correction follow-up — 2026-09-23

The owner subsequently requested correction of this review. The findings above preserve
the reviewed state; the canonical plan now resolves the document-design gaps as follows:

| Finding | Canonical correction | Status limit |
|---|---|---|
| F1 | §2.4 OMP queue/turn identities, separate ACK/completion, interruption recovery and serialized pending-model application | Design corrected; runtime bridge/tests still required. |
| F2 | §2.6 immutable restoration ref, durable receipt before removal, conservative integration predicate and crash reconciliation | Design corrected; Archive retains worktrees until activation tests pass. |
| F3 | §2.5 host draft CAS, immutable Send reservation/idempotency and legacy migration; §3.B aligned | Design corrected; two-renderer tests still required. |
| F4 | §2.7 Electron-main lifecycle, adoption/shutdown and host-vs-view failure distinction; R1 prerequisite | Design corrected; packaged lifecycle and paired-device tests still required. |
| F5 | §6.5 names Expo export, packaged static root, API/auth separation and transport wiring | Design corrected; actual web/native delivery still required. |
| F6 | §8.1 fixes D/W/N required capability families and deferred scope; §11.1 cannot waive required features | Design corrected; this does not claim full long-term feature parity. |
| F7 | §5 retired shell rows removed/superseded; §3.B shared-draft ownership aligned | Document contradiction corrected. |
| F8 | §8 commands include isolated agent UI/vendor typecheck and Expo web export | Gate coverage corrected; commands are prescribed, not claimed passing. |

A separate read-only reviewer checked these revisions. It found two follow-up corrections:
model acceptance must be OMP-acknowledged and serialized with dequeue (host receipt can
still be in transit), and R3 Send reservation depends on R2 draft storage. Both were applied
before final document validation, including a delayed-delivery test requirement. No source
implementation changed, no new provider tests ran, and speech-to-text remains deferred.

The prior fix-then-implement verdict applies to the original draft. The eight listed design
findings are addressed in the amended plan; their implementation and runtime evidence remain
open under canonical §10 item 70. Browser/terminal options were separately researched and
recorded as recommendations under §6.6, without changing the selected base or adding packages.
