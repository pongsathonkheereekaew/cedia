# D remainder packaged closer (History/Tree/Review/IDE/crash) — 2026-10-01

## Result

PASS. One staged scratch Cedia.app run closed the D items left open by the
remainder sweep, fully Playwright-driven with live turns on the
user-approved row. Exit code 0, zero staged survivors.

- History: live thread "Remainder task" with real turns on screen; T1
  answered exactly `พร้อมแดง red` (Thai + English, no CJK substitution).
- Tree: Files panel shows the `notes.md` + `app.ts` fixture files.
- Review: Changes panel shows the session-touched Thai edit as a working-tree
  diff (`notes.md` +2 -0, `- queue: คิวงาน` / `- done: เสร็จ`); the edit turn
  was approved through the broker API and landed byte-exact once.
- IDE: "Open in Cedia IDE" boots the full workbench in a second window
  (2 windows, `.monaco-workbench` detected); explorer shows the fixture
  files and the editor renders `notes.md` with the Thai lines intact.
- Crash rehearsal: SIGKILL mid-turn leaves no staged survivors; relaunch
  re-adopts the same session and the transcript survives (4 turns).
- Prewalk armed with a live handoff (`{"available":true,"armed":true}`).

Runner: `scripts/omp-packaged-d-remainder-proof.ts` (staged-only; asserts
the installed Cedia.app is never launched). Artifacts:
`dist/packaged-d-remainder-proof/2026-10-01T16-25-11-482Z/`
(history/files/review PNGs + text, ide-tree/ide-editor PNGs + text,
crash-relaunch.png, prewalk-state.json, result.json with `"ok":true`).
Spend: two tiny turns plus prewalk plus the killed count turn (4 turns).

## Driver notes

- The runner read the transcript before its `message_end` event landed
  (turn `completed` wins the race); it now waits for non-empty text under
  the same deadline instead of asserting on the first completed poll.
- The IDE gate previously clicked the "IDE" Environment entry (opens the
  section, boots nothing) and waited on window count. It now clicks
  "Open in Cedia IDE" exact, picks the "Cedia IDE" menu item, and accepts
  either a second window or a reused window via `.monaco-workbench`.
- The Environment panel is single-context: Files is opened first, then
  "Close Explorer" restores the entry list before opening Review.
- Teardown hung in Playwright `browser.close()` with the relaunched app
  idle at 0% CPU; an external SIGKILL of the staged scratch pids (the same
  action the script's own sweep performs) unblocked it and the run exited
  0. Harness-side flake, not a product finding; the proof result and all
  artifacts were already recorded before the hang.

## Limits

IME inline preedit stays explicitly out: it needs OS-level IME composition
via the computer-use runtime, which this runner does not have.
