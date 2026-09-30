# Packaged dirty Quit/Cancel preflight stopped before an unsaved buffer — 2026-09-27

The dirty working-copy count IPC is implemented and covered by the earlier
`r1-dirty-editor-quit-2026-09-27` receipt. This follow-up attempted the required
runtime observation in a scratch packaged Cedia: open an IDE file, type unsaved text,
request application Quit, inspect the production pre-Quit dialog, click Cancel, and
verify the app, host admission and dirty editor remain intact. No provider call is
part of this proof. §10 item 70 owns D status.

The bounded driver `scripts/omp-dirty-quit-packaged-proof.ts` reached the packaged
Agents window and IDE workbench. Quick Open was not interactable in one run; the
fallback `--goto` did not expose the scratch file in a Monaco editor. That earlier
failure is recorded in `dist/dirty-quit-packaged-proof/failure.json`; it stopped
before creating a dirty buffer and did not exercise Quit, the dialog, or Cancel.
The final bounded observation and its remaining automation limitation are recorded
in the addendum below.

## Addendum — bounded native observation — 2026-09-27

The final bounded scratch run used the production Agents preload `openIde` bridge
with an absolute fixture path. It reached a real packaged Code-OSS Monaco editor,
replaced the buffer with `unsaved editor text`, and left the fixture on disk at the
exact baseline bytes `64 69 73 6b 20 62 61 73 65 6c 69 6e 65 0a`
(`disk baseline\n`). The pre-quit screenshot is retained at
`dist/dirty-quit-packaged-proof/dirty-editor-before-quit.png`; its `fixture.txt`
tab has the dirty marker and visibly contains the unsaved text.

Computer Use inspected the native Cedia window while the driver was waiting. The
accessibility tree was:

- dialog alert text: `Quit Cedia and stop its work? 0 tasks are still running. 1 file has unsaved changes; Cedia will ask about them as the window closes. Stop and Quit stops the running turns and holds queued work until you Continue the task.`
- buttons: `Stop and Quit` and `Cancel`

Computer Use clicked `Cancel`. The dialog disappeared and the same IDE window
returned with the fixture active, `Explorer - 1 unsaved file`, and Cedia ready.
The packaged main log for scratch PID `73262` records this decision and the host
state around it:

```text
13:31:41.998  Cedia host lifecycle: unreachable  (startup only)
13:31:42.741  Cedia host lifecycle: ready
13:32:42.222  Cedia cancelled the quit
13:32:42.932  Cedia host lifecycle: ready
13:32:50.583  Cedia host lifecycle: ready
13:32:50.589  Cedia host lifecycle: ready
```

The log is retained at
`/private/var/folders/r7/96w_6l296fnck1z_4vnydbp80000gn/T/dq-nwmgcB/u/logs/20260927T133120/main.log`.
The repeated Cancel at `13:33:15.447` and final `stopped` receipt at
`13:33:16.449` belong to bounded driver cleanup after the first observation; they
are not the acceptance action. The first Cancel therefore left the packaged main
process alive and the host accepting. The retained scratch receipt is
`/private/var/folders/r7/96w_6l296fnck1z_4vnydbp80000gn/T/dq-nwmgcB/h/lifecycle.json`;
its final stopped phase is cleanup evidence, while the main log is the evidence
that Cancel reopened the host. No provider/model call was made.

The automated driver could not complete its own AX assertion because this host
does not grant `osascript` Assistive Access. `System Events` returned
`osascript is not allowed assistive access (-1728)` when reading windows/static
texts/buttons (an earlier probe returned `-25211`). This is an OS permission
blocker, not a missing dialog selector. The driver now pipes bounded stderr,
raises a structured `macos-accessibility-permission` failure, skips the unsafe
Quit fallback for that error, and writes valid JSON with the blocker plus the
observed dirty-buffer, disk, and PID fields. The source is
[`scripts/omp-dirty-quit-packaged-proof.ts`](../../../../scripts/omp-dirty-quit-packaged-proof.ts).

`bunx tsc --noEmit`, Bun bundling of the driver, and `git diff --check` pass. The
driver's automated receipt remains a failure because the required native AX
reader is unavailable; the CUA observation above is retained as runtime evidence
of the actual dialog and Cancel behavior, while the unattended packaged proof
gate remains externally blocked.
