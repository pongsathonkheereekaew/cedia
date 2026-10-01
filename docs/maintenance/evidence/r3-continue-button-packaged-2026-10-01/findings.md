# Packaged Continue-button proof (archived-row Restore click) — 2026-10-01

## Result

PASS. The open UI path from the packaged restore receipt is now observed
end to end on a staged scratch Cedia.app: after a tiny live Muse turn
(`archived-ok`) and archiving through the host route, the operator opened
Settings → Archived threads, clicked the archived row's Restore button saw
the `Thread restored` toast with the list going empty, went back, reopened
the task from the project list, and read the intact transcript (prompt plus
`archived-ok` answer). The proof then verified through the host that the
task is unarchived and its journal still carries the pre-archive turn, and
closed with zero staged survivors.

Run ID `2026-10-01T11-23-22-772Z`; window PNGs and `result.json` under the
ignored runtime directory
`dist/packaged-continue-proof/2026-10-01T11-23-22-772Z/`. Staged app only
(Login Item shimmed, re-signed; installed app never launched), scratch git
project/profile, one tiny paid Muse turn on the user-approved row,
always-ask overlay with no approval arising.

## Honestly scoped

The archive step itself went through the host route (as in the prior
receipt); the Restore click, toast, empty-list state, sidebar return, and
transcript readback are the newly observed UI half. Cleanup stays inactive
by design.

## Limits

One task, one turn, folder-backed project (receipt notes `Kept · no
worktree`). Worktree-backed restore was covered by the prior receipt; full
D/W/N/F acceptance stays open.
