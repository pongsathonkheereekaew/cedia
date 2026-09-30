# Login Item attempt, read-only-safe — 2026-09-29

## Boundary

- No Login Item was written, removed, or restored by hand. No Keychain item
  was touched (the `launch-cedia-personal.ts` path deletes named Safe Storage
  items, so it was not run). No login/logout cycle was performed. All
  observations below are read-only (`sfltool dumpbtm`, `log show`).

## Pre-run baseline (before the staged paid + SIGKILL proofs)

- `sfltool dumpbtm` (exit 0): one `Cedia` app item —
  identifier `2.com.cedia.editor`, disposition `[enabled, allowed, notified]`,
  URL `file:///private/var/folders/r7/96w_6l296fnck1z_4vnydbp80000gn/T/tmp.yH25kfnXpg/Cedia.app/`
  (leftover staged URL from this session's catalog-overlay proof),
  generation 15.
- `log show --last 24h backgroundtaskmanagementd` filtered for cedia: only the
  overlay-proof launch entries.

## What the staged launches did (observed, not directed)

- The staged paid native-confirm launch and the staged SIGKILL/relaunch
  launch each carry the standard Login Item registration call. Both staged
  bundles had **no interception shim** for this run (plain current-source
  overlay), so macOS processed the registration normally.
- `backgroundtaskmanagementd` at 08:54:44 moved the existing item UUID
  `CEC161BE-0E55-4A62-8B30-02B71F90A073` from the older staged URL
  (`tmp.jyyDnQb2Qv`, pre-run baseline receipt) to the paid-proof staged URL
  (`tmp.yH25kfnXpg`): `_bundleURLForAuditToken: updating item … URL to:
  file://…/tmp.yH25kfnXpg/Cedia.app/`, then `registerLaunchItem: found
  existing item` with the new URL.
- Post-run `sfltool dumpbtm` (exit 0): same UUID/identifier/disposition,
  same `tmp.yH25kfnXpg` URL, generation still 15. No second item was created;
  no entry points at the persistent installed app.

## Staged-app shim evidence (separate, from the SIGKILL proof bundle)

- That proof's staged `main.cjs` *does* carry the interception shim; its log
  shows 2× `intercept-set-login-item` (`{openAtLogin: true,
  openAsHidden: true}`) + 2× `simulated-login-state (isPackaged: true,
  openedAtLogin: false)`. Those are shim interceptions inside the staged copy,
  not macOS state changes.

## Conclusion

- Still **no real login-cycle evidence**: no logout/login, no background
  launch at login, no persistent-URL restoration. The platform behavior is now
  documented end to end (staged launch → UUID URL update → enabled
  disposition preserved), but D's Login Item/login-cycle gate remains open.
- Suggested next step when approved: restore the persistent installed-app URL
  through a Keychain-preserving method (never the personal launcher), then a
  real logout/login cycle. That step is explicitly **not** taken here.
