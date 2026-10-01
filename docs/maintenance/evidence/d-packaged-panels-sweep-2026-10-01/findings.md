# D packaged panels sweep (held turn + queued follow-up) — 2026-10-01

## Result

PASS with one script defect noted. A staged scratch Cedia.app held one
turn against a hanging loopback model while a follow-up sat queued; the
runner verified from the host journal that a running turn plus a second
intent existed before opening each gate, and the operator recorded the
visible rows of every major Agent-window surface. Zero provider spend
(hanging loopback answers nothing; no auth copied in).

Observed on screen (run `2026-10-01T10-00-54-332Z`, session `70cb99e5`):

- Composer + running turn: user bubble, `Thinking`, `Working for N s/min`,
  Pause run + Stop generation buttons, `queue · running
  cedia-panels-hang/hang-model`, session `running`.
- Queue: the `Turns OMP is holding for this task` section with the running
  row; the follow-up queues through composer Enter (no Send button while a
  turn runs) with the journal confirming the queued intent.
- Environment panel: Local, Git branch select, Initialize Git, Subagents
  (`No subagents in this task`), Sources, Local Servers 0, Editor
  (`Open in Cedia IDE`).
- Model picker: `Runtime selection` header with the hang model, source tab,
  `Panels hang model` row with star toggle and search field.
- Settings (via Panel sections): Personal/Coding/System/Archived sections
  with General, Remote, Profile, Appearance, Notifications, Chat behavior,
  Keybindings, Agent providers, Models & writing, AI/OMP settings, System
  tools, Capability status, Archived threads.

Runner window PNGs per gate (`prompt/queue/panels-window-0.png`) are under
the ignored runtime directory `dist/packaged-panels-proof/2026-10-01T10-00-54-332Z/`.

## Script defect (fixed, not re-proven)

The teardown sent command `stop`, which the commands route rejects with
400 — the correct command is `abort` (fixed in
`scripts/omp-packaged-panels-proof.ts` after the run). Teardown still
closed cleanly (app closed, zero staged survivors verified). A re-run to
green `result.json` is optional; the captures above stand on the
gate-time journal checks.

## Limits

One held turn, one queued follow-up, one model. Armed-state panels
(prewalk/loop/cleanse/btw/omfg ask flows), review panel, and History/Tree
with content remain open. Two earlier same-day attempts died to macOS
memory pressure (staged app OOM-killed, ~200 MB free on the 8 GB machine);
a Sky-launched bare instance without harness args was caught and killed
with zero survivors each time.
