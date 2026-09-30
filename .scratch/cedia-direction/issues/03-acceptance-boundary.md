# Define complete OMP support and same-task remote control

Parent: [Choose a coherent Synara-based OMP workspace](../../../docs/maintenance/CEDIA-PLAN.md#wayfinder-map-choose-a-coherent-synara-based-omp-workspace)
Label: wayfinder:grilling
Type: grilling
Status: claimed
Assignee: current CEDIA owner conversation (Codex)
Blocked by: 01-upstream-readiness.md, 08-task-worktree-lifecycle.md, 09-omp-collab-readiness.md

## Question

What observable behavior makes the owner's requirement for a complete Synara application
with OMP and same-task remote control satisfied? Establish the must-have OMP capabilities
and acceptable temporary gaps, plus phone/other-computer controls, approvals, reconnects,
and task continuity. Which requirements would rule out an upstream release or candidate
integration even if it can start a text turn?

The result informs the application-base decision and later runtime validation; it is not
an implementation plan. Other providers do not satisfy OMP support, and SSH execution on
a different machine does not satisfy control of the same Mac task.

## Comments

The owner already chose OMP as the sole harness and same-Mac-task control. Do not reopen
those choices. Resolve the remaining meaning of complete support with the owner.

- 2026-09-23 clarification: changing the selected model or its model provider must keep
  OMP as the harness. Other harnesses and automatic cross-harness fallback are outside
  the desired product. Model discovery and supported effort should come from OMP.

- 2026-09-23 correction from the explicit owner answer: a full IDE is required, including
  language services, debugging, and extensions. The earlier basic-editor scope was not
  accepted. This settles the capability level, not the window arrangement or complete
  OMP/remote acceptance boundary; this ticket remains open for the latter details.

- Window arrangement is now settled separately: one CEDIA application, two windows,
  with the AI workspace primary and full IDE secondary, following a Cursor-like workflow.
  Remaining acceptance includes task/project/worktree identity, file/selection handoff,
  review state, and OMP model/settings consistency across those windows and remote clients.

- Round 3 choices: shared terminal OMP configuration is recorded in the branding/settings
  ticket. Separate worktrees for concurrent Git tasks and explicit IDE handoff are recorded
  in [Define isolated task workspaces and result integration](08-task-worktree-lifecycle.md).
  Their remaining lifecycle details are prerequisites for complete workspace acceptance.

### Confirmed interview decisions — round 6, 2026-09-23

The owner answered 16A, 17A, 18A:

- New tasks default to acting on the user's instruction, with an explicit Plan control.
  Natural-language restrictions such as analysis-only or no edits still apply. The default
  mode does not override instructions or grant automatic commit/merge/push permission.
- Send during an active turn queues a follow-up after that turn. A separate, explicit
  steer action delivers an instruction during the running turn. CEDIA presents and forwards
  these choices through OMP's supported operations; it must not add a second agent loop.
- A model change during an active turn is pending for the next turn in the same task.
  Let the current turn finish on its actual model; display the running and pending models
  distinctly. Preserve the task's conversation and sole OMP execution owner. Validate
  deferred selection against OMP before starting the next turn rather than presenting the
  pending model as already running or silently substituting a different harness.

These are accepted behavior requirements, not a claim that all current adapter paths already
implement them. Queue ordering, failure/retry, and remote consistency need runtime evidence.

### Confirmed interview decisions — round 7, 2026-09-23

The owner answered 19C, 20A, 21A:

- Both a mobile-friendly web client and a dedicated iPhone app are required.
- Remote access must work away from the Mac's local network, including cellular and other
  Wi-Fi networks. The transport, hosting, and any costs have not been selected or authorized.
- Closing both desktop windows keeps the application and active tasks running in the
  background, with a visible status/stop entry and continued remote access. Closing windows
  and explicitly quitting the application must be distinct; exact Quit/sleep behavior is
  still to be decided. This does not claim execution can continue on a sleeping/offline Mac.
- The owner pointed out OMP's collab support. Assess that existing capability before
  choosing or building another remote-session transport. Keep one OMP execution/session owner.

The supporting fact investigation is
[Establish OMP collab capabilities for CEDIA remote control](09-omp-collab-readiness.md).

### Confirmed interview decisions — round 8, 2026-09-23

The owner answered 22A, 23A, 24A:

- The owner's Mac and remote clients may control the same task concurrently; there is no
  manual controller handoff. All clients see the authoritative task state, commands have
  an authoritative acceptance order, and each approval request is settled only once.
  This does not authorize concurrent agent loops or independent transcript owners.
- Mobile notifications cover task completion, failure, and requests for input/approval,
  with per-category controls. Do not notify for every transcript message or tool step.
  Delivery mechanism, lock-screen content, and device runtime acceptance remain open.
- Explicit Quit asks for confirmation if work is active: stop the work and quit, or cancel
  Quit. With no active work, quit immediately subject to the IDE's unsaved-document handling.
  Closing windows continues background work under round 7; explicit Quit does not leave
  a separately running execution service. Stopping is not a promise of resumable suspension
  or automatic rollback of effects already performed.

These choices define intended behavior, not verified current remote or notification support.
Automatic sleep and device enrollment remain to be selected. Reconnect handling must preserve
the single execution owner and avoid treating an uncertain command outcome as permission
to execute that command again.

### Confirmed interview decisions — round 9, 2026-09-23

The owner answered C, A, A to questions 25, 26, 27:

- Respect macOS sleep settings. CEDIA does not prevent automatic sleep, even while work
  is active or Remote is enabled. Remote availability depends on the Mac being awake and
  connected; this choice does not add wake-on-demand or guarantee work during sleep.
- Enroll a device once using a QR code or code presented on the Mac, then remember that
  device. Provide a device list with revocation. This selects the enrollment experience,
  not a new identity provider, credential store, or an already-proven collab capability.
- Default lock-screen notifications show only a generic completion, problem, or waiting-for-
  response status. Open the client to inspect task details. More detailed notification
  content may be enabled through Settings, as offered in the question; the default does
  not expose task names, code, file contents, answers, or approval details.

Remote action coverage, terminal-created OMP session continuity, and the capability-to-UI
mapping remain open. These answers do not resolve the application-base decision.

### Confirmed interview decisions — round 10, 2026-09-23

The owner answered A, A, A to questions 28, 29, 30 and clarified that the IDE should have
an Agent Chat experience like Cursor:

- Attach IDE files or selected code through an explicit Send to AI action, with visible
  attachments before submitting. Do not silently include the active editor on every turn.
  The target task/workspace must be explicit when the main AI window and IDE differ.
- Discover and continue terminal-created OMP sessions in CEDIA, preserving the same
  session and one execution owner. How to attach to a running CLI owner or transfer an
  idle session requires capability verification; this is not permission to run two owners
  against one session or to silently move its working directory.
- The IDE includes a compact but usable Agent Chat: the current task's conversation and
  composer, code attachments, execution status, and approval interactions. The primary AI
  window provides full task management. Compact refers to its layout and management scope,
  not a status-only panel or a separate conversation. Both surfaces project the same OMP
  task when they are displaying that task; choosing a different task in the main window
  must still respect the previously selected explicit IDE-handoff behavior.

The Cursor reference here specifies the Agent Chat workflow, not adoption of its harness,
branding, theme, or unrelated services. Unsaved-buffer attachment semantics, editing
conflicts, and CLI session workspace isolation remain to be clarified before implementation.

- Round 11 settles explicit IDE Save, user-triggered Review in the task's IDE, and retaining
  the original directory for terminal-created sessions. See
  [Define isolated task workspaces and result integration](08-task-worktree-lifecycle.md)
  for the decision and the limits of CEDIA's shared-directory coordination.

### Confirmed interview decisions — round 12, 2026-09-23

The owner answered A, A, A to questions 34, 35, 36:

- Explicit Send to AI may attach the current unsaved editor text or selection as a snapshot.
  Mark it as unsaved and do not save the file implicitly. Distinguish this attached snapshot
  from the on-disk content that OMP tools read; attachment does not authorize discarding or
  overwriting the live editor buffer. Capture the path/selection and snapshot identity so
  later edits cannot silently change what the submitted message contained.
- Remote clients must support creating tasks, selecting projects, changing models, continuing
  conversations, stopping tasks, inspecting diffs, and answering approvals. Apply the same
  task ownership, worktree, queue/steer, and pending-model rules as the desktop. This settles
  the desired control scope, not a claim that today's collab guest implements all actions.
  Unsupported applicable capabilities remain on the separate capability-status page until
  implemented and verified under the accepted release policy.
- Both web and iPhone clients include an interactive terminal for commands executed on the
  Mac. Keep its panel available on demand rather than taking permanent space in the main
  mobile conversation. This requires terminal transport/lifecycle and real-device evidence;
  OMP collab prompt control alone is not an interactive shell or proof of terminal support.

These are product decisions only. No service exposure, device deployment, credentials,
provider operations, or terminal command execution is authorized by this interview.

### Permission-path observation — 2026-09-23

The retained host has both a CEDIA editor-change confirmation path and an OMP native
permission bridge in `apps/host/src/service.ts` (`#permission`, `#nativePermission`).
The RPC adapter in `packages/omp-adapter/src/client.ts` forwards UI requests and does not
auto-approve them. These source paths do not prove duplicate prompts at runtime, nor that
every OMP tool is governed by one complete permission policy. The intended policy and
presentation boundary must be explicit before integration; validate actual enforcement
rather than adding a merely cosmetic permission selector.

### Confirmed permission decision — round 16, 2026-09-23

The owner chose 48A: use the configured OMP tool-permission policy, presenting its requests
through CEDIA without a second approval for the same operation. Responses from desktop,
web, and iPhone must settle the same request once. Do not introduce a separate CEDIA prompt
merely because OMP already permitted an operation. This does not authorize auto-approving
an outstanding OMP request, expand its actual enforcement coverage, or override the explicit
commit/merge/push rule. Device enrollment and application lifecycle choices are separate
from tool-use permission.

Actual OMP permission gaps and native/editor bridge behavior must be verified and shown
honestly; the desired single policy is not proof that every current tool is covered.

### Remote cost clarification — question 50 remains unanswered, 2026-09-23

The owner asked which connection option is free; this is not a selection of A or B and
does not set a spending budget or authorize installing/exposing a service.

- [Tailscale pricing](https://tailscale.com/pricing) explicitly lists Personal at $0,
  up to six users and unlimited user devices, for non-commercial personal use. This is
  a concrete zero-subscription-cost candidate for the private-network option, with client
  setup on the participating devices. It does not implement CEDIA's remote UI/protocol.
- [Paseo's FAQ](https://paseo.sh/) describes Paseo as free/open source and offers an optional
  hosted relay. Its [relay terms](https://paseo.sh/terms) specify fair-use limits and no
  uninterrupted-service guarantee. This is not a verified promise of free hosted service
  for CEDIA's custom client/protocol; compatibility and applicable service access still
  need checking. Self-hosting software does not eliminate infrastructure costs.
- [OMP collab documentation](https://github.com/can1357/oh-my-pi/blob/main/docs/collab.md)
  documents the hosted `my.omp.sh` service but did not establish a pricing/quota commitment
  in this check. Do not promise free/unlimited full CEDIA remote from that fact.

These comparisons concern remote connectivity cost, not model inference charges. If the
owner prioritizes a verified free connectivity plan and accepts separate client setup,
the private-network candidate is currently the clearer recommendation; selection is pending.


### Home-hosted remote clarification and transport audit — 2026-09-23

The owner asked whether CEDIA can use their own infrastructure, noting that the Mac
stays powered on at home while they are away. This is feasibility input, not yet a
selection of a remote transport or authorization to deploy one; question 50 remains open.

The Mac remains the CEDIA/OMP execution host for all candidates. A relay is only a
connectivity intermediary. Current `apps/host/src/remote.ts` defaults new identities to
`relay.paseo.sh:443`, disabled until pairing. CEDIA owns device authorization and command
routing; OMP remains the sole harness. The relay package accepts a custom endpoint, but
there is no current host API/settings control for choosing one. Do not describe editing
the private identity file as the completed self-hosting user experience.

Paseo's open-source relay can be deployed separately. A home deployment still needs a
reachable network path and TLS; merely leaving the Mac powered on does not bypass NAT
or CGNAT. A publicly reachable owned server can relay outbound connections from the home
Mac and phone, with infrastructure cost and maintenance determined by that deployment.
Alternatively, a private Tailscale network can connect the user's devices without using
Paseo's hosted relay; it still depends on Tailscale services and requires its client/account.
The Personal plan is a zero-subscription-cost candidate for eligible personal use.

Private direct access is not turnkey in the retained CEDIA build: the host binds loopback,
checks its Host header and rejects browser Origin headers (`apps/host/src/server.ts`);
the mobile HTTP transport requires HTTPS outside explicit localhost development
(`apps/ios/src/core/transport.ts`). A deliberate HTTPS gateway, browser-origin boundary,
and controller pairing/revocation integration must precede claims of web/iPhone support.
Keep existing authorization checks rather than exposing the owner API unchanged.

Verification: `bun test packages/relay/test/relay.test.ts apps/host/test/remote.test.ts`
passed 17 tests, 0 failed, 68 assertions (Bun 1.4.2). These use isolated/mock transports.
No hosted-relay connection, private-network deployment, or physical iPhone/cellular test
was performed in this audit. Protocol and hosting research is recorded in
[the dated evidence](../../../docs/maintenance/evidence/paseo-relay-research-2026-09-23/findings.md).


### Planning consolidation draft — 2026-09-23

The owner instructed the agent to start the detailed consolidation. The concrete draft is
in the canonical plan: §3.C–§3.D behavior/screens, §6.5 remote gates and §11.1 acceptance. Existing owner answers remain
accepted; newly proposed technical boundaries/defaults await review. This record links
rationale to that single contract and does not duplicate its requirements. Remote selection
and explicitly named feasibility/dependency gates remain open. No application implementation,
deployment or current runtime acceptance is implied, and this HITL ticket is not closed merely
because the document was written.


### Confirmed remote, cost and voice choices — 50A/51A/52A, 2026-09-23

The owner explicitly selected Tailscale as the primary connection, initially no additional
supporting-service charges, and speech-to-text into an editable draft with explicit Send.
The canonical requirements and migration boundary are consolidated in plan §6.5; this
supersedes the earlier pending-transport notes. Paid-required capabilities remain documented
pending under the accepted release policy; existing model usage is outside this cost question.
No installation, subscription, deployment or application implementation occurred in this turn.

Next interview frontier: start-at-login behavior; treatment of a new message composed while
the Mac is unreachable (distinct from reconciling a previously sent command); voice processing
location and whether audio may be sent to an external transcription provider. These are
questions for the owner, not inferred accepted requirements.


### Confirmed login, offline drafts and local voice — 53A/54A/55A, 2026-09-23

The owner selected automatic background start after macOS login with status/Open/Quit,
retaining new unsent messages as editable drafts while the Mac is unreachable, and local
speech transcription on the home Mac (including phone audio sent to that Mac). The canonical
contract is updated in plan §3.C/§6.4/§6.5/§11.1. Explicit Send remains required after
transcription or reconnect; login does not replay tasks. The user also asked whether Synara
already supports the chosen local transcription and whether its implementation can be reused.
This is a source investigation, not installation or voice-runtime acceptance.


### Confirmed audio retention and draft ownership — 56A/57A, 2026-09-23

The owner selected deleting temporary audio after successful transcription or cancellation,
retaining only text, and sharing a task's unsent draft between AI/IDE windows on the same
Mac while keeping phone/other-device drafts separate. Plan §3.C/§6.5/§11.1 now owns these
requirements. This is draft synchronization, not a second transcript or agent owner.


### Synara voice source result — 2026-09-23

[Voice research](../../../docs/maintenance/evidence/synara-voice-research-2026-09-23/findings.md)
checked v0.9.1/main and the retained CEDIA paths. Synara supplies the recording and editable-
draft interaction, but its current backend sends audio to ChatGPT with Codex-discovered auth;
no local speech engine was found in the bounded source inspection. Reuse UI/state/encoding,
replace backend/auth coupling with the selected Mac-local input utility. This preserves 55A,
does not create a second agent harness, and is not proof of Thai accuracy or current operation.


### Follow-up on reusing Synara voice unchanged — 2026-09-23

In the current exchange the owner answered 53A/54A/55A and asked whether Synara already
supports that voice behavior and should be reused. The existing evidence was cross-checked:
recording/editable-draft UI is reusable, whereas the checked upstream backend uploads to
ChatGPT with Codex-discovered login. This does not itself establish a second agent loop,
but it does add external audio processing and a Codex/ChatGPT auth dependency.

The owner was asked whether to retain Mac-local processing with reused Synara UI or
explicitly change the voice-backend decision after learning this distinction. Until an
answer changes it, 55A remains authoritative; the reuse question alone is not permission
to send audio externally. Preserve the no-additional-service-charge constraint in either case.


### Owner reaffirmation after source clarification — 2026-09-23

The owner explicitly reaffirmed local processing on the Mac, reusing Synara's voice UI and
recording machinery while replacing its backend. This settles the reuse follow-up above:
55A remains unchanged; there is no external ChatGPT transcription fallback. Source reuse
must preserve the editable draft / explicit Send behavior. Local engine selection and real
Thai/mixed-language performance remain agent verification work, not a request for the owner
to choose an implementation library.


### Confirmed recovery, update installation and remote shell — 2026-09-23

In the recovery/update/terminal round (numbered 1–3 within that round), the owner answered
1A, 2A, 3A. Interrupted execution restores saved history/status and waits for explicit
Continue. Validated application updates are announced and installed only at the owner's
chosen time. Remote Terminal opens the user's own Mac shell in the task cwd; AI tool
terminals remain separately selectable. These decisions are consolidated into plan
§2.2–§2.3, §3.C–§3.D, §6.4–§6.5, §8 and §11.1. A still-running OMP owner after a view
failure is reattached, not restarted; no uncertain command is replayed. This round does
not authorize implementation, an actual update, or terminal execution.

### Technical closure check — 2026-09-23

The recovery/update/user-terminal answers complete the behavioral interview. The canonical
plan now records source-verified constraints for external CLI attachment, shared OMP settings
RPC, permission ownership, Tailscale Serve/gateway and native notification delivery. Local
speech has a pinned engineering candidate, not a performance receipt. See the plan's §13
evidence index. The next owner interaction is review of the concrete design; do not restart
generic interview rounds or interpret pending runtime gates as unanswered preferences.
This does not close the HITL ticket or authorize implementation by itself.

### Owner scope amendment — scrutinize review, 2026-09-23

The owner explicitly deferred speech-to-text until later. This applies to all languages,
desktop and remote capture, engine integration and accuracy/performance work. It supersedes
the earlier voice decisions as current-delivery obligations; their local-processing and
draft-only choices remain historical direction for a later review. Shared text-draft
ownership is unaffected. The canonical plan removes voice from R5/R7 delivery gates and
requires inactive/hidden recording/transcription paths in the current scope.

### Owner-authorized scrutiny corrections — 2026-09-23

The owner asked to fix the eight scrutiny findings. The canonical plan now specifies the
OMP queue/turn projection, shared Mac draft CAS/Send, durable cleanup/restore protocol,
Electron-main lifecycle coordination, packaged Expo web client and fixed D/W/N delivery
checkpoints. Required capabilities cannot be hidden to pass a checkpoint. This records
plan corrections, not application implementation or completed runtime acceptance.
