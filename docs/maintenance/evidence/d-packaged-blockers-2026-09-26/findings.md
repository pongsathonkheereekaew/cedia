# D packaged blockers — owner inspection follow-ups (2026-09-26)

Follow-up to `d-computer-use-packaged-2026-09-26`: the owner inspected the packaged
`Cedia.app` (matching current assets, `check:packaged` green) and reported four concrete
blockers. Each was root-caused, fixed, and re-verified on the packaged app by computer use
(`@oai/sky` drive, captures below). Zero provider calls. §10 item 70 owns status.

## 1. Type gates red — fixed, all green

- Root `tsc --noEmit` failed at `scripts/omp-live-approval-proof.ts:200` (implicit `any` on the
  `allTextContents().map` callback). Annotated `(text: string)`. Root typecheck now clean
  (exactly one error before, zero after).
- Agent-window vendor typecheck failed at `CediaToolCatalogSurface.tsx:478`: the error fallback
  built `{ state: "unavailable", ... }` but `CediaExtensionsAnswer` is discriminated by
  `available: boolean` (`{ available: false, reason }`), which is what `CediaToolCatalogPanel`
  reads. Fixed the fallback. `tsc -p tsconfig.vendor.json` and the default project both clean.
- Full suites: `apps/macos/test` 771 pass / 0 fail; repo gate
  (`packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib`) 1382 pass /
  0 fail. `check:packaged` all OK (patch set `086d31f75d36`, 18 patches).

## 2. "Record voice note" on New thread while STT is deferred — fixed, verified

- Root cause: `deriveComposerVoiceState` (`ChatView.logic.ts`) rendered the mic whenever
  `authStatus !== "unauthenticated"`, ignoring the transcription capability. The Cedia provider
  reports `authStatus: "unknown"` (managed by OMP), so the button always showed even with
  speech-to-text deferred/pending.
- Fix: the mic renders only when `voiceTranscriptionAvailable === true`. Recording/transcribing
  sessions still keep the recorder bar visible mid-flow.
- Verified on the packaged app: new-thread and thread composers show no mic control.

## 3. Task stuck on "Loading conversation" — root-caused, watchdog added

- The `hi` thread (806 events, 43 multi-page `cedia_frame_reference` frames) stayed on the
  spinner. Host endpoints all answer 200 (session, events with paging, ui, goal, projects);
  frame-chunk reassembly verified sha-clean; the adapter emits the full snapshot (6 messages,
  5 activities); the store reducer marks `threadDetailSyncById: "synced"` — proven by driving
  the real adapter + real store code against the live host in `bun` repro scripts.
- Underlying defect: with the Cedia polling adapter there is no stream-failure signal
  (`onThreadStreamFailure` belongs to the Synara websocket transport), so the `failed`
  transcript state with its Try Again retry was unreachable and any persistent stall spins
  forever with the poll swallowing errors.
- Fix (`ChatView.tsx`): a 45 s watchdog — while hydration stays `"loading"`, a timer marks
  `markThreadDetailSyncFailed(threadId)`, surfacing the existing didn't-load + retry UI. A
  late snapshot still heals to `synced` (verified in reducer semantics), and threads that
  already render entries never reach the timeout (their hydration is `"ready"`).
- Cold-load measurement on the packaged app: the same 806-event thread loads in well under
  30 s after a fresh launch, so 45 s does not false-fire on real hydrations.
- Not claimed: the watchdog has not fired live (by design it fires only on a genuine stall).

## 4. Capability "Remote Ready" vs settings "did not answer" — fixed, verified

- Root cause: the main-process renderer→host proxy (`applicationPath` in
  `apps/macos/src/agent-window-main.ts`) allowlists `APPLICATION_ROOTS` plus provider shapes.
  `remote` and `devices` were absent, so **every** `/v1/remote/*` and `/v1/devices/*` call from
  the renderer died with "Unsupported application route" while the host (gateway up, owner
  token valid — both probed 200 directly) and the capability row correctly said available.
- Fix: `REMOTE_ROUTES` shape allowlist — exactly the four routes the Settings > Remote panel
  drives (`remote/gateway`, `remote/enrollment`, `devices`, `devices/*/revoke`). The retained
  Paseo relay verbs (`remote/pair`, `remote/disable`) stay unreachable from the renderer, and
  the host's owner gate stays authoritative on all four shapes.
- Tests: `agent-window-main.test.ts` updated (the old "stays native" rejection of
  `/v1/devices` replaced; traversal/lookalike rejections extended to the new shapes) plus a
  new positive test forwarding all four routes. Suite green.
- Verified on the packaged app: Settings > Remote shows the gateway row
  (`http://127.0.0.1:58520` + Tailscale hint), device-name input + Create code, and the paired
  list (This Mac, Packaged browser, Packaged iPhone) with per-controller Revoke. Capability
  status and settings now agree.

## 5. Owner row offered Revoke and mislabeled "Paired controller" — fixed, verified

- The paired-device list hardcoded "Paired controller" and a Revoke button on every row,
  including "This Mac" (role `owner`). The host refuses owner revoke
  ("cannot be revoked through the controller API"), so the click could only produce a
  destructive error toast.
- Fix (`RemoteDevicesPanel.tsx`): the owner row reads "Local owner. This Mac cannot be
  revoked." with no Revoke button; controllers unchanged. Verified on the packaged app.

## Captures (viewed live, not stored)

- Fused unavailable rail (Plan/Progress/Advisor/Agents as one continuous surface), no mic in
  either composer, loaded `hi` transcript, working Remote panel with corrected owner row,
  Capability status with Remote Ready.
- Driving notes: the Sky runtime needs the target app frontmost before `click` (else
  `noWindowsAvailable`); every call takes `{app: <bundle-id>, ...}`; screenshots arrive as
  `file://` URLs emittable with `nodeRepl.emitImage`.

## Still open (not claimed)

- End-to-end real OMP turn inside the packaged app (packaged captures against a real
  bridge-advertising runtime).
- Watchdog live fire (only observable on a genuine stall).
- W/N/F beyond prerequisites: no off-LAN, physical-iPhone, or provider-backed turns observed.
