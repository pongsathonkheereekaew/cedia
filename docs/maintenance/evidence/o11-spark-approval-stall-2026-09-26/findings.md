# O11 spark approval attempt: model-side stall, no prompt (user-approved) — 2026-09-26

**Correction, 2026-09-27:** This driver opened an unbound new task in `/Users/pond`
while polling the pre-created scratch session. Its `/switch` did not set an effective
model in that scratch session. The negative run cannot establish a Muse/always-ask
stall or count as a valid model retry. The corrected scratch-task driver explicitly
selected and read back Muse, then completed the live `select` approval click and
byte-exact write; see [the replacement receipt](../o11-muse-select-approval-2026-09-27/findings.md).

One bounded write turn on `opencode-go/muse-spark-1.3-contributor` (user: spark 1.3 for all)
in a headless production-bundle window against a live host + pinned runtime with an
always-ask overlay (global `yolo` untouched, scratch workdir, OMP-native auth). No product
code changed for this attempt: the select rendering (probe 11) and the confirm synthesis
(this turn's slice) are both landed; the question was only whether spark answers under
always-ask. New `bun run smoke:live-approval` driver (`scripts/omp-live-approval-proof.ts`).
§10 item 70 owns status.

## Result: STALL, aborted per contract (no retry into spend)

- `/switch` turn dispatched through the on-screen composer; write turn
  (`Create approval-probe-spark.txt …`, one tool max) dispatched after.
- 5 minutes of broker polling (`GET /v1/sessions/:id/ui`): NO pending `select`, NO
  pending `confirm`, no tool attempt observed. Aborted with spend stopped at two short
  input-only prompts. No file created, nothing clicked (nothing renderable appeared).
- This reproduces probes 6–7 exactly (spark + always-ask, turn never reaches a tool call),
  now a third time. Spark calls tools fine under `yolo` (probes 4–5); the stall correlates
  with the always-ask gate, cause unknown (model-side flake vs mode interaction).

## Caveat (driver gap, recorded not hidden)

- Switch effectiveness was screenshotted but never asserted: the switch-done capture shows
  the `/switch` turn sent, but the composer picker still reads `Choose model` and the run
  never reads the status-bar model label (probe 11 did). The stalled turn may have run on
  spark-under-always-ask (matching probes 6–7) or on the default model after a silent
  switch miss. Next attempt must assert the model label post-switch before the write turn.

## Not attempted

- No second turn, no `deepseek-flash` fallback (proven path, but the user asked for spark),
  no global config change, no packaged-app turn (overlay cannot be injected there).

## Still open (no gap change, stays 2)

- Live confirm-click: needs an answering turn; spark is 0/3 under always-ask. Options are
  retry later (flake check), deepseek-flash, or the owner running one write turn by hand.
  `switchSession`/`browser-relay` untouched.

## Preserved

- D1–D5, deferred voice, W/N deferred per owner. Nothing committed.
