# O11 Muse approval loop: live `select` click — 2026-09-27

The owner approved `opencode-go/muse-spark-1.3-contributor` paid turns. This run used
the pinned OMP `18.1.18`, a scratch project/session and an isolated `always-ask`
overlay. The production Agent Window bundle ran in headless Chromium against a live
host. The user's OMP profile supplied the model catalog and authentication; no global
approval setting was changed. §10 item 70 owns acceptance.

## Driver correction

The earlier driver opened an unbound new task in `/Users/pond` while polling the
pre-created scratch task. Its `/switch` bubble did not set an effective model; the
previous stall therefore could not establish Muse behavior. That run was stopped,
left no file in `/Users/pond`, and all owned processes exited. The corrected driver
opens the exact scratch task ID, verifies its canonical cwd, sets the model through
the host's `set_model` command, and reads back `model-state` before the paid turn.
It uses the user's OMP model catalog while the host/session files remain in scratch.

## Observed run at revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` (dirty working tree)

- The on-screen composer sent one bounded file-create request. The runtime reported
  `opencode-go/muse-spark-1.3-contributor` as the effective model before that send.
- The live broker held `method: select`, `Allow tool: write`, for the scratch file.
  The Agent Window rendered Approve/Deny; the driver clicked Approve once.
- The file appeared with byte-exact content `approval_probe_spark_ok`; the model turn
  reached `completed`, the broker had zero pending requests, and the renderer logged
  zero errors. Captures are `dist/live-approval-spark/approval-prompt.png` and
  `dist/live-approval-spark/final.png`. `bun run smoke:live-approval` exited 0.

This closes the answering-model live `select` approval/tool loop for D. It does not
exercise a native editor `confirm`: this driver has no Code-OSS editor bridge. A
separate packaged editor run must prove that click and dirty-buffer preservation.
