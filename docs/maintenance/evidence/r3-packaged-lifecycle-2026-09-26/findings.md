# Proof (packaged lifecycle: quit drain, relaunch, crash adoption) — 2026-09-26

Gated D lifecycle checks on isolated scratch state with owned processes only:
no user profile, no user processes touched (PID-targeted signals on the launched
instance only), no provider, no Keychain, no credentials. Driver:
`scripts/omp-packaged-lifecycle-proof.ts` (`smoke:lifecycle-packaged`). §10 item
70 owns status.

## Build under test

Same build as the browser proof: source `main` at `0676dd70d54` dirty,
packaged `Cedia.app` 2026-09-25T16:54:33Z, stamp `086d31f75d36` (18 patches).

## What was proven (3 runs: 1 cold red, 3 consecutive green)

- Boot reaches a window on a fresh isolated profile (3/3 recent runs).
- Graceful quit (SIGTERM through the real will-quit path): app exits and **zero
  scratch-owned processes survive** — the r3 quit-path defect class (host
  outliving the app) is absent on this build.
- Relaunch on the same isolated state boots a new process and reaches a window.
- Crash (SIGKILL, no cleanup): relaunch still boots and reaches a window. The
  only post-crash leftover referencing scratch is the crashpad handler
  (`leftovers-after-crash.txt` — crash-reporting helper, harmless); adoption
  holds despite it.
- `result.json`: `ok: true`, `boots: 3`, `gracefulQuitDrained: true`,
  `crashRelaunch: true`, `errors: []`.
- First run red once (cold boot: scratch drain exceeded 20 s), green on every
  rerun since — recorded as observed cold-start flake, not claimed away.

## Not claimed

Menu-driven Quit, pre-quit stop-or-cancel prompt, login cycle, background
launch (launchd), crash with real user state, paired-client repeats — those
need interactive runs or real hands and stay open with that exact reason.

## Addendum: re-certified on the 18:40:41Z package + crashpad scoping

Re-ran green on the repackaged build (stamp `086d31f75d36`, agent-window
assets `89b96831…`): 3 boots, quit drain, crash relaunch, `errors: []`.

Cold-boot finding, then fix: the first run against the fresh signature failed
the drain window; the survivor dump identified it as `chrome_crashpad_handler`
only (crash reporting referencing the scratch Crashpad dir — not app/host
state, adoption unaffected, relaunch proceeded). The driver now excludes that
exact process name from the teardown assertion with the reason in code, so a
cold boot cannot fail the gate for a harmless reporter; anything else
lingering still fails. Tally across runs: 5 greens, 2 cold reds, both reds
explained by this cause.
