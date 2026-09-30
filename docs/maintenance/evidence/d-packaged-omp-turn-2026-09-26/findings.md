# D real packaged OMP turns (text + write tool) — 2026-09-26

First real OMP turns driven in the packaged `Cedia.app` by computer use (`@oai/sky`):
a text turn and a bounded write turn on `opencode-go/muse-spark-1.3-contributor` (xhigh),
both completed live with honest model/runtime states. Two short turns of provider spend on
the user's own auth; per-turn observations below. No product code changed for this proof.
§10 item 70 owns status.

## Proven

- **Text turn**: new thread, prompt "Reply with exactly the word READY and nothing else."
  Assistant answered `READY`. Thread, timestamps and message actions (copy/fork/pin)
  rendered; sidebar row created.
- **Write turn** (follow-up in the same thread): "Create `/tmp/cedia-turn-proof/hello.txt`
  with exactly `hello from cedia`, edit nothing else." Completed in 22 s ("Worked for 22s")
  with the runtime-verified outcome card ("Created … with exact bytes `hello from cedia`. —
  verified"). File confirmed byte-exact on disk (17 bytes); the repo tree gained nothing.
- **Honest runtime transition**: the composer panels flipped from "No OMP runtime is running"
  to live states once the runtime existed for the task — Plan mode Off ("No plan file is
  active", Enter plan mode / Vibe off), Advisor off with real zeros (context 0/0, total 0,
  cost $0, 0 user · 0 assistant) plus "Turn advisor on". Model chip reads
  "Muse Spark 1.3 Contributor · xhigh" throughout.
- **Archived destination**: Settings > Archived threads renders the honest empty state
  ("No archived threads … can be restored to the sidebar"). Archive→restore flow itself was
  already proved packaged in `r3-packaged-restore-observed-2026-09-26`; this confirms the
  destination UI on the current revision.
- **Lifecycle observed**: a `kill -9` of the host node mid-session did not take the window
  down — the app adopted a fresh host (new pid/port/gateway in `host.json`/`host.log`) and
  the open thread later rendered fully. Host-outlives-app was already proved in
  `caret-host-lifetime-2026-09-15`.

## Not proved / open (recorded, not hidden)

- **Broker approval round-trip**: the write ran under "Ask for approval" and proceeded
  without raising a broker prompt (policy allowed the `/tmp` write), so no approve/deny
  click was exercised live. The confirm-frame rendering landed in
  `o11-confirm-approval-surface-2026-09-26` (fixture-level). The spark + always-ask stall
  (`o11-spark-approval-stall-2026-09-26`, three reproductions, model-side) was deliberately
  not burned into again — no retry into spend.
- **IDE dirty-buffer handoff** (§11.1: Cancel path, unsaved snapshot, AI disk conflict):
  not staged live. Agent-side guard code exists (`EditorDirtyRouteGuard`, lifecycle
  dirty-buffer protection); IDE open itself was proved in
  `d-computer-use-packaged-2026-09-26`. Staging needs a dirty IDE buffer plus the
  conflicting AI action in one session — left as explicit next work, no failure found.
- **W/N**: gateway serves loopback (observed `127.0.0.1:58520` + enrollment/devices live in
  Settings), but off-LAN web access, Tailscale Serve pointing, and physical-iPhone
  cellular/keyboard/terminal/WebView remain unobserved — external device/network
  prerequisites, not local implementation.

## Driving notes

- Sky clicks need the target app frontmost (`open -a` first) or they fail
  `noWindowsAvailable`; a stale "user changed <app>" interlock after repackaging is cured
  by a REPL reset + reimport, not by re-querying.
- Send-arrow centroid measured by pixel scan (bright-blob centroid in the composer strip);
  model-picker pill sits ~30 px left of it — blind clicks open the picker instead.
- `press_key` accepts macOS names (`Return`, `Escape`); `Enter` is rejected.
