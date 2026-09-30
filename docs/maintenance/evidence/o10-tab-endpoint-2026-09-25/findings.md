# Slice (O10 scoped tab bridge: endpoint + attach + steering, no OMP action yet)

The first implementation slice of the bind design in `o10-bind-survey-2026-09-25`:
Cedia serves a per-thread loopback CDP endpoint over explicitly attached agent tabs,
and steering the runtime onto it uses the already-verified settings path. No user
Chrome, profile, extension, credential, or provider involvement anywhere.

## What was built

- `apps/macos/src/cdp-tab-endpoint.ts`: per-thread `CdpTabEndpoint` — `GET /json[/list]`
  naming attached tabs only (id/title/url/ws url), `/json/version` probe, per-tab
  websockets proxying CDP frames to the tab's debugger with id echo, unknown-tab
  close (4404), malformed-frame close (4400), debugger-detach socket close, loopback +
  ephemeral port + teardown lifetime. 3 fixture tests green (real HTTP + real WS client).
- `apps/macos/src/agent-window-browser.ts`: `agentAttach` (explicit tab only — never
  the resolveTab active-fallback; foreign-attached debuggers refused; idempotent
  re-attach), `agentDetach` (per tab or all; debugger detached; endpoint closed when
  empty), `agentEndpoint` (status for the UI); invalidation hooks on tab close, thread
  close and owner destruction. No bridge-contract change (existing panel+browser path).
  3 service tests green with a fake debugger (refusals, serve+teardown, close-detach).
- Renderer: `agentAttach/agentDetach/agentEndpoint` on the native browser API
  (contracts extended as Cedia-optional; dead WS backend untouched), `setOmpSetting`
  reuse for steering, `BrowserAgentAttachBar` (status + Attach active/Detach all behind
  outcome-stating confirms, capability-probed to null) mounted under the tab strip;
  attach-then-steer / detach-then-clear flows extracted as tested helpers (4 tests green).
- Steering proof `scripts/omp-browser-steer-smoke.ts` green on the prepared runtime:
  inventory marks `browser.cdpUrl` editable, write lands, readback matches, revision
  moves, clear restores empty (upstream treats empty as unset), controller 403.
  Honest wart recorded: reading an UNSET cdpUrl answers request_failed (no value to
  project) — steering writes first, the bar never reads settings.

## Task-isolation design (recorded, enforced in structure)

At most one thread's tabs are OMP-drivable at a time: attach opens the endpoint and
points global `browser.cdpUrl` at it; detach-all (or tab close/thread end) closes the
endpoint and clears steering to "". A stale URL would brick browser tools (upstream has
no fallback past a dead endpoint), so clearing is load-bearing, not tidy-up. A
background task's turns fall back to their own browser launch; cross-task driving is
structurally impossible. Automatic clearing on thread switch is NOT built — the next
slice must hook it or scope steering explicitly; until then the bar shows the state.

## Deliberately not in this slice (no greenwash)

- No OMP browser action through a handle yet: `browser-relay` CLI row stays open, and
  no coverage row closes here. End-to-end driving (navigate/read/capture through a
  handle), thread-switch clearing, and packaged proof against a visible tab are named
  follow-ups with the seam ready.
- Typecheck note: `apps/macos/agent-window` vendor check reports one error in
  `CediaToolCatalogSurface.tsx`, an untracked file from another thread's in-flight
  slice — untouched here; all files in this slice are clean (root `tsc` green,
  macos 766/766, agent-window suites touching this slice green).
