# D/W/N/F remainder audit against §11.1 — 2026-09-26

Requirement-by-requirement pass over the 19 §11.1 scenario rows against
current-tree evidence. No product code changed; no gap change (stays **2**).
§10 item 70 owns status. No provider involvement.

## D (integrated Mac workspace)

- One harness/same task: PROVEN for desktop (turn-bridge smoke, host
  routes, packaged native send/branch/IDE-open/return). Remote same-task
  compare only loopback-proven (packaged gateway redeem + native token
  read); off-LAN compare is W work.
- Settings/brand: PARTIAL. Destinations, search, deep links, capability
  gating and reset/migration paths proven; onboarding flow and reset
  preview coverage not established.
- Theme/syntax: PARTIAL. Tokens pinned by test; cross-window theme/density
  change proven packaged; IDE-syntax-cannot-override-chrome, focus/IME and
  multilingual content not exercised.
- Shared OMP config/auth: PROVEN (revision-checked write + 409 conflict,
  CLI readback surviving real edit + two restarts, credentials stay in OMP,
  honest write/reload failures).
- Turn ordering/approvals: PARTIAL. Intent IDs, queue ACK, boundaries and
  pending-model proven (batch-13: 8 green); approval/tool-loop proof needs
  an answering model (free tier silent mid-day, o11 negative result); crash
  at every boundary not rehearsed.
- Shared draft/Send: PARTIAL. CAS/race/broadcast/delivered fixture-proven;
  packaged or two-window Send-vs-edit race NOT observed (item 70 open).
- Workspace/IDE preservation: PARTIAL. Packaged two-window run proven
  (density persist + quit); dirty-editor probe absent by construction
  (Code-OSS owns the dialog); dirty-file picker UI + packaged run open.
- Archive/restore: PARTIAL. Host pair fixture-proven with receipt on the
  restoring row; no packaged run of restore observed; cleanup deliberately
  inactive (12 green).
- CLI continuity: PARTIAL. Qualified launcher + owner endpoint live;
  discovery half (list live owners, detach) open; live attach unaccepted.
- Capability fidelity: PARTIAL. Gate integrity passes; honest absence
  states shipped; several panels lack packaged captures.
- Deferred voice: HELD. No getUserMedia/SpeechRecognition/microphone in
  window sources (verified this turn; remaining hits are "transcript");
  standing owner exclusion.

## W (same-Mac remote web)

- Remote boundary: PARTIAL. Packaged gateway serves export, cookies/CSRF vs
  bearer, enrollment/revoke/reconnect, hostile-origin refusals — all
  loopback-proven. NOT done: Tailscale Serve config, tailnet device,
  off-LAN request, `CEDIA_REMOTE_HOSTS` as a Cedia control, Remote panel
  screen capture.
- Lifecycle/notifications: PARTIAL. Packaged quit drain/relaunch/crash
  adoption on isolated state proven; menu Quit, pre-quit prompt, login,
  background launch, real-state crash, paired clients open. Foreground
  notification surface not established.

## N (native iPhone)

- Native/web continuity: OPEN. No physical-iPhone cellular evidence
  anywhere; export:web builds, gateway serves, pairing protocol exists —
  none of it observed from a device. APNs/locked-device deferred by cost
  policy on top.

## F (full pinned-OMP integration)

- Source coverage: PARTIAL. Integrity PASS; `--require-complete` FAIL at
  exactly 2 (`switchSession` — owner gate, no retarget; `browser-relay` —
  needs user's own Chrome install + config). Neither closeable in-tree.
- Semantic/dynamic: PARTIAL. Packet fixtures green; no live-model turn
  anywhere (interview, subagent run, repair, compaction-cancel, image
  drop with removals, advisor review); several packaged panel captures
  missing.
- Config/policy: MOSTLY PROVEN. Credit guard at decision points + live
  policy read; update policy manual/owner-confirmed. Open: explicit
  owner-confirmed redeem control, OAuth selection, `setServiceTierFamily`.
- Honesty: PROVEN as process (per-slice receipts, no 100% claims,
  negative results kept).
- Migration/rollback/updates: PARTIAL. Schema migrations with private
  versioned backups tested (journal v1/v2, cleanup v5, turn-intent
  schemas); representative-legacy-twice, rollback rehearsal and pinned
  upstream-candidate upgrade + gate rerun not established.

## Net

D is proven except: packaged two-window Send-vs-edit race, packaged
restore observation, approval/tool loop with an answering model, and
surface-capture gaps. W is blocked on tailnet/off-LAN prerequisites. N is
blocked on a physical device. F is blocked on the 2 named gaps plus live
model turns. No row was reclassified to pass.

## Addendum: iOS typecheck still clean (2026-09-26)

`bun run --cwd apps/ios typecheck` (`tsc --noEmit`): clean. Native-client
types compile; still no device evidence — N stays blocked on hardware.

## Addendum: mobile unit tests green, still no device (2026-09-26)

`bun run --cwd apps/ios test`: 172 pass, 0 fail (813 expects, 24 files).
Unit layer holds; N stays blocked on physical-iPhone cellular evidence.
