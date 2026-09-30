# Staged active-turn app-crash/relaunch (current source) — 2026-09-29

## Result

`CEDIA_PROVE_ACTIVE_TURN_CRASH=1` variant of
`scripts/omp-packaged-owned-host-adoption-proof.ts` passed on OMP 18.1.18
against a current-source staged bundle. Zero stray proof processes remain.

## Procedure and observations

- Staged bundle: installed app copy + current-source `dist/mac-extension`,
  `dist/agent-window`, `dist/omp-standalone/omp`, `dist/host/cli.js`, Login
  Item interception shim, re-codesigned. Checkout HEAD
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty by design.
- Idle phase first: packaged host + OMP owner from blank scratch state, host
  draft revision 1, renderer caches cleared — same as the idle receipt.
- Active phase: one loopback-fixture prompt sent from the real composer;
  `providerRequests: 1`; the running turn (`runningBeforeCrash`,
  single intent) observed before SIGKILL.
- App SIGKILL during the running turn → relaunch: same packaged host PID
  (`78187`), same OMP owner PID (`78243`), same task/incarnation; host status
  `running` while the app was closed and after relaunch; exactly one prompt
  intent, no replay.
- Explicit `abort` settled the intent as `cancelled`;
  `loopbackProviderRequests: 1` — the fixture was hit once, never replayed.
- `loginItemInterceptions: 3` (shim log); zero renderer errors.
- Captures: `dist/packaged-owned-host-adoption-proof/2026-09-29T02-25-37-391Z/`
  (`result.json`, before/after screenshots).

## Limits

- Loopback fixture turn only — no external provider, no replay semantics
  beyond the single abort. Paired clients, real Login Item cycle, and D/W/N/F
  acceptance stay open.
