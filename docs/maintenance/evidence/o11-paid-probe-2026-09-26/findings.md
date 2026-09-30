# O11 paid probes (user-approved minimal) — 2026-09-26

Paid consent: user-approved 2026-09-26, minimal single-word no-tool probes only.
Both probes: host `startHostServer` + project/session/start, `/switch` as a
prompt turn, then `reply with exactly the single word pong; call no tools`,
120 s deadline, abort on timeout, scratch deleted, no retries into spend.
Pinned runtime `omp/18.1.18`. OMP-native auth only.

## Probe 1: antigravity `gemini-2.5-flash-lite` — 429, zero spend

- switch 200, send 200. Host turns never both terminal; aborted per design.
- Runtime log (pid 34382, 06:35): provider `google-antigravity`,
  model `gemini-2.5-flash-lite`, `agent turn ended with provider error`:
  `Cloud Code Assist API error (429) RESOURCE_EXHAUSTED: Resource has been
  exhausted (e.g. check quota).`
- `omp usage` still shows Antigravity 0.0% on all six rows — display vs
  API quota mismatch, recorded not resolved.

## Probe 2: opencode-go `deepseek-flash` — ANSWERED, zero tools

- switch 200, send 200. Host reported `FINAL-TURNS: ["queued","completed"]`
  and aborted the leftover queued turn per design (the queued one is the
  `/switch`-as-prompt turn — harness artifact, not a model failure).
- Runtime log (pid 35126, 06:38:41): provider `opencode-go`, model
  `deepseek-flash`, `stopReason: stop`, `contentBlocks: 1`,
  `hasToolCalls: false`, `hasText: true`. First live answering-model turn
  since the o11 block.
- Exact text not captured (temp stateDir deleted after abort while the
  switch turn was still queued) — runtime attestation above is the receipt.
  Future probes should select the model without spending a prompt turn on
  `/switch` so both host turns can settle terminal.
- Side note: `opencode-go` usage endpoint returned 401 during fetch, yet the
  model call succeeded — second display-vs-API mismatch, recorded.

## Reading

Approval/tool-loop proof path is UNBLOCKED via `opencode-go/deepseek-flash`
under the existing paid consent. Next slice (not started): real
approval/tool-loop turn with a permission prompt from the on-screen composer
path (§10 item 1), then the remaining live-model packets.

## Preserved

- D1–D5, `switchSession` open. Relay user-install from today stands.
  W/N deferred per owner. Nothing committed; scratch files deleted.

## Probe 3: `muse-spark-1.3-contributor` pong — ANSWERED (user: spark 1.3 for all)

- Same minimal harness, `/switch muse-spark-1.3-contributor`, single-word pong, no tools.
- Host `FINAL-TURNS: ["queued","completed"]` (queued = `/switch`-as-prompt artifact).
- Runtime log 07:09:15: provider `opencode-go`, model
  `muse-spark-1.3-contributor`, `stop`, `contentBlocks 2`, `hasText true`,
  no tools. Answering path confirmed on the user-requested model family.

## Probe 4: tool-call loop with `muse-spark-1.3-contributor` — PROVEN (read half)

- Prompt: one read-only tool to list workDir files, then reply `done`.
  Temp workDir held only `AGENTS.md` + `note.txt`; scratch deleted after.
- Host: `FINAL-TURNS: ["queued","completed"]`, events 99 kB with tool
  entries, transcript tail shows `Tool Call: read` (correct temp path) →
  `Tool Result` listing both files with sizes → Assistant `done`.
- Runtime log 07:12:37: same provider/model, `stop`, `hasText true`
  (`hasToolCalls false` on the final yield segment; the tool executed
  earlier in the turn per host transcript).
- Permission-prompt half stays OPEN: reads auto-allow under virtualUi
  (`service.ts` authorize passthrough); writes need native/editor bridge,
  and item 1 demands the on-screen composer. Next: same-model write with
  approval prompt from the composer path.

## Probe 5: composer write under yolo — PROVEN (tool-call half, item 1)

- Live headless-Chromium agent window (`dist/agent-window`) against a live
  host + real `dist/omp/omp`, model `opencode-go/muse-spark-1.3-contributor`
  (user: spark 1.3 for all). `/switch` typed in the on-screen composer;
  status bar confirms `host · live` + `model · opencode-go/muse-spark-1.3-contributor`.
- Prompt from composer: create `approval-probe.txt` with exact content.
  Result: `Created approval-probe.txt with exact text approval_probe_ok`,
  `Worked for 3.8s`, file verified byte-exact on disk, zero renderer errors.
- Screenshots: `dist/live-approval-probe/` (`switch-done`, `final`).
- NO permission prompt surfaced. Root cause found the same turn:
  `omp config get tools.approvalMode` → `yolo` (global default), which
  auto-approves read+write+exec. The write was never going to prompt.
- Harness lessons: `/switch`-as-prompt turns stay `queued` in host view
  forever (gating on them deadlocks — gate the last turn only); button
  substring `/approv/i` false-positives on project names (use exact labels).

## Probes 6–7: composer write under always-ask — STALLED, prompt unobserved

- Mechanism (verified, no spend): `PI_CONFIG_FILES=/tmp/cedia-always-ask.yml`
  (`tools.approvalMode: always-ask`) IS honored by the OMP child
  (`config get` → `always-ask`); global config untouched (still `yolo`).
- Same write task via composer, same model, twice: turn stuck
  (`Thinking`, empty response, 4–5 min), no tool attempted, no approval UI
  (exact-label button scan every 3 s), file never created. Probe 7 ended in
  abort + `Timeout waiting for OMP response to cedia_control (30000 ms);
  outcome is unknown`. Zero renderer errors both runs.
- Cannot distinguish model/provider flake (opencode-go spark thinking
  stalls) from a mode interaction from these runs alone — no tool was ever
  attempted, so the approval gate never engaged either way.
- Screenshots: `dist/live-approval-probe2/`, `dist/live-approval-probe3/`.

## Standing for item 1

Tool call from the on-screen composer: PROVEN (probe 5). Permission prompt:
still OPEN — observed auto-approve under yolo (by design) and no prompt
under always-ask (turn never reached a tool call). Cheapest next slices:
retry always-ask later (flake check), same gate with `deepseek-flash`,
or broker-level pending-request inspection without the model in the loop.

## Probe 8: broker holds the approval, wrong answer shape stalls (host API)

- always-ask + `deepseek-flash`, host API only: `GET .../ui` returned the live
  broker frame: `{kind: interactive, method: select, title: "Allow tool: write
  / Path: ... / Content: ...", options: [Approve, Deny]}`.
- Answering `true` (boolean) 79x: HTTP 200 every time, frame NEVER cleared,
  file never created. Wrong shape for a `select` frame — it needs the option
  string, and the adapter maps `select` to a *userInput* interaction
  (`thread.user-input.respond` with answers), not an approval boolean.
- Lesson: `select` frames are user-input selects, not approval booleans.

## Probe 9: same, answered "Approve" — FULL MECHANICAL LOOP PROVEN

- Same setup, `answer: "Approve"`: write frame cleared → model followed with a
  `bash` verification (`wc -c ... && od -c ...`) → second select approved →
  turn `completed`, file byte-exact (`hello-approval-2`) on disk. 2 answers,
  zero waste. Paid consent respected (short turns only).
- So: runtime asks correctly, broker holds correctly, `POST .../ui` with the
  option string resolves correctly, turn completes. The loop works end to end
  at the host/broker layer on `deepseek-flash` + always-ask overlay
  (`PI_CONFIG_FILES`, global `yolo` untouched).

## Probe 10: live window, select-aware scan — NOTHING RENDERS (the gap)

- Same gate + model in the real headless agent window, scanning
  `option/radio/menuitemradio/button` for Approve/Deny every 3 s for 7 min:
  zero candidates, turn frozen, file never created, no renderer errors.
- Wiring audit (all read-only): `threadSnapshot` DOES pass live
  `GET .../ui` data as `pendingUi` into `pendingInteractions`
  (`cedia-adapter.ts:2189,2197,2066`), refreshed every 1 s while subscribed
  (`:2934`). The bundle receives the select interaction and renders nothing
  clickable. Shell list passes `undefined` (`:2178`, by design).
- Precise remaining gap: the agent window has no working surface for
  broker-pending `select`/user-input interactions. Fix slice: render
  `pendingInteractions` userInput items with their options and wire the pick
  to `thread.user-input.respond` → broker resolves → turn completes
  (probe 9 proves everything downstream of that click).
- Screenshots: `dist/live-approval-probe6/` (`approval-prompt-*.png` absent
  by design — nothing ever surfaced; `final.png` shows the frozen turn).

## Probe 11: live window, always-ask write — PERMISSION HALF CLOSED

- Same gate + model + on-screen composer as probe 10, with the adapter fix
  (`pendingInputActivities` in `apps/macos/agent-window/src/cedia-adapter.ts`):
  broker `select`/`input`/`editor` frames now project to `user-input.requested`
  activities carrying only the decision surface (title + option labels), so the
  bundle's `derivePendingUserInputs` replay has something to render. Settlement
  rows stay token-only per #1305 (covered by unit tests both halves).
- Timeline: prompt sent → broker `select` (`Allow tool: write`, options
  Approve/Deny) in ~6 s → window rendered two `ComposerChoiceRow` buttons
  (DOM-verified, shortcut chips `1 Approve` / `2 Deny`) → clicked Approve →
  file byte-exact (`approval_probe_ok`) in ~5 s → turn completed (`done`,
  `Worked for 6.3s`), zero pending UI frames after. 1 click, 1 approval.
- Harness note: choice-row buttons carry the shortcut chip in the accessible
  name (`1 Approve`), so exact-name role selectors miss; match
  `button:has-text("Approve")`.
- Screenshots: `dist/live-approval-probe7/` (`task-open`, `switch-done`,
  `frame-live`, `approval-prompt`, `final`).

## Item 1 standing (updated)

Tool call from the on-screen composer: PROVEN (probe 5). Permission prompt:
loop proven at broker layer (probe 9) AND now closed live in the agent
window (probe 11): pending `select` renders as clickable Approve/Deny,
the click answers through `thread.user-input.respond`, the broker resolves,
and the turn completes. Remaining: `confirm`-method frames still project to
settlement rows only (no `approval.requested` activity synthesis) — OMP's
permission gate uses `select`, so this is a known gap, not a blocker.

## Item 1 standing

Tool call from the on-screen composer: PROVEN (probe 5, yolo, 3.8 s).
Permission prompt: loop proven at broker layer (probe 9); on-screen
rendering is the single remaining implementation gap, now specified above.
