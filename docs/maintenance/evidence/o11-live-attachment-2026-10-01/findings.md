# Packaged live-attachment receipt, agent-driven — 2026-10-01

## Result

PASS at the behavior level: two read-only live turns on
`opencode-go/muse-spark-1.3-contributor` (user-approved unlimited row), each
typed agent-side through computer-use into the on-screen IDE dock composer of
a staged scratch Cedia.app, each submitting a `fileMention` carrying real
image bytes (1x1 red PNG, webp base64 in the OMP session file), each answered
`red` by the live model with exactly one completed turn, zero staged
survivors afterwards. This closes the attachment-carrying live turn (34)
runtime receipt.

Honesty note: the proof runner never wrote its own `result.json` /
`turn-completed.png` — the parent died post-completion on both runs (exit
137, see below), so this receipt rests on the host journal and the OMP
session files, which are the stronger evidence for byte delivery anyway.

## Runtime evidence

- Runner: `bun scripts/omp-live-attachment-packaged-proof.ts` (added in this
  slice) with an explicitly staged scratch Cedia.app (Login Item shimmed,
  re-signed; installed app never launched) against an in-process source host
  + pinned OMP with the user's own auth (scratch copy) and an always-ask
  overlay (no approval arose on these read-only turns). Scratch project only.
- Run A `2026-10-01T03-22-52-341Z`, session
  `9943fac8-1dda-4a80-986b-08d7f738eb09`: journal `turn_intents` 1 completed;
  assistant `message_end` TEXT `red` (journal sequence 1286, role assistant,
  stop `stop`); OMP session file carries a `fileMention` with
  `image/webp` base64 data.
- Run B `2026-10-01T03-33-44-821Z`, session
  `54ccdf22-a7c3-4fb2-98fa-e49296077f5f`: journal `turn_intents` 1 completed;
  assistant TEXT `red`; OMP session file carries the same `fileMention` /
  `image/webp` shape. Run-output and journal paths are under the ignored
  runtime directories `dist/live-attachment-packaged-proof/<runId>/` and the
  per-run `$TMPDIR/cedia-live-approval-pkg-*/host`.
- After each run `ps` showed zero surviving staged processes.
- The staged Login Item shim intercepted its setter calls. This is not a
  Login Item or macOS login-cycle test.

## Driver defects disclosed

- Run B's journaled user text contains the prompt twice, overlapped
  (`...reply with Look at the attached image and reply with only its...`).
  Cause: two overlapping computer-use `typeText` calls at different composer
  offsets. The image bytes were unaffected and the model still answered
  `red`. Working rule learned: click the composer and type in the SAME
  computer-use call, let the chip render settle first (a bare `typeText`
  without an in-call click lands nowhere observable).
- Computer-use `getApp` on the staged path launched a SECOND bare instance
  without harness args on the real profile (`~/Library/Application
  Support/Cedia`). It was killed immediately; `ps` confirmed zero survivors
  and no real-profile writes were made. Rule: verify the bound webview URL
  carries the run's fixture session hash before EVERY action, and check
  staged `user-data-dir` values via `ps` after every bind.

## Proof-design weakness noted

The fixture filename `red-square.png` itself contains the answer, so a bare
`red` reply is weaker than it looks. What carries this receipt is the OMP
session file: the mention resolved to a `fileMention` with real `image/webp`
base64 bytes submitted to the model. A future hardening is a neutral
filename (e.g. `square.png`) so the text channel cannot leak the answer.

## Runner robustness (open, no new spend needed)

On both runs the proof parent exited 137 after the turn completed but before
the playwright screenshots / `computer-use-expand-ready.json`. The Mac showed
~430 MB free on 8 GB RAM at the time with staged Electron + bun host + OMP
agent resident — suspected memory pressure, not a product defect. Follow-up:
make the post-answer phase not require a live Electron (re-verify from
journal + session files), or reduce resident weight before screenshots.

## Limits

This closes the attachment turn (34) runtime receipt. Remaining F
semantic/dynamic packets and full D/W/N/F acceptance stay open.
