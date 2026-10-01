# Packaged dirty-file picker run on the current build — 2026-10-01

## Result

PASS. `bun scripts/omp-dirty-picker-packaged-proof.ts` green against the
installed `2026-09-30T08:25:21.069Z` package: real clicks in the packaged Agents
window switch the env chip to worktree mode, the dirty picker lists `drop.txt`
with a checkbox, unchecking it sticks while `keep.txt` stays checked, Send
creates exactly one session, and the real worktree carries the `keep.txt`
modification but NOT the unchecked `drop.txt` modification. Provider-free
(fixture OMP), scratch state.

## Runtime evidence

- Screenshots (`picker-home`, `picker-composer`, `picker-env-menu`,
  `picker-mounted`, `picker-unchecked-drop`, `picker-sent`, `picker-worktree-mode`)
  are under the ignored runtime output directory
  `dist/dirty-picker-packaged-proof/`.
- No staged processes survived the run (verified after exit).

## Limits

This closes the dirty-file picker UI + packaged run remainder. Still open
elsewhere: live streaming in-place (33), attachment live turn (34), tool-output
receipt (35), settings/theme remainders, CLI discovery half, and full D/W/N/F
acceptance.
