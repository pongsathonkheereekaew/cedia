# Staged packaged SIGKILL/relaunch adoption (current source) — 2026-09-29

## Result

`CEDIA_PACKAGED_OWNED_HOST_APP_PATH=<tmp stage>/Cedia.app bun scripts/omp-packaged-owned-host-adoption-proof.ts`
passed on OMP 18.1.18 with zero provider requests and zero renderer errors.

## Procedure and observations

- Staged bundle: installed app copy + current-source `dist/mac-extension`,
  `dist/agent-window`, `dist/omp-standalone/omp`, `dist/host/cli.js`, Login
  Item interception shim, re-codesigned. Checkout HEAD
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty by design.
- Packaged app started its bundled host from blank scratch state; project +
  task created through the packaged host; idle OMP owner attached with the
  exact task/incarnation identity.
- Real composer text committed to the shared host draft (revision 1);
  renderer-local caches cleared to isolate host hydration.
- App SIGKILL → relaunch on the same profile: same packaged host PID
  (`75337`), same OMP owner PID (`75392`), same task/incarnation, owner
  summary `available`, composer rehydrated from the host draft.
- `loginItemInterceptions: 2` in the shim log; `providerRequests: 0`;
  source SHAs recorded in `result.json` (`host 208d9284…`, `omp 29847d53…`,
  `main.cjs 4f645de2…`, `extension.js a8eef2db…`).
- Captures: `dist/packaged-owned-host-adoption-proof/2026-09-29T02-06-36-763Z/`
  (`result.json`, before/after screenshots).

## Post-proof hygiene note

- The proof driver deletes its scratch dir in `finally`, but at handoff one
  scratch host survived with its directory unlinked: PID `75816` (staged
  `cli.js serve`, PPID 1, holding the deleted `c-oh-adopt-4XnM9Y` journal fd).
  It was SIGTERMed after the receipt was recorded and confirmed gone. No
  owner/user work was touched — scratch-only leftover, now reaped.

## Limits

- Idle-owner adoption only; active-turn variant is opt-in
  (`CEDIA_PROVE_ACTIVE_TURN_CRASH=1`) and was not run. No Login Item cycle,
  no paired clients, no D/W/N/F acceptance.
