# Login Item persistent-URL restore (Keychain-safe) — 2026-09-29

## Result

The Login Item is back at the persistent installed-app URL with zero Keychain
writes, zero deletions, and zero login/logout.

## Procedure (all read-only except one normal app launch)

- Pre-run `sfltool dumpbtm`: item `2.com.cedia.editor`, disposition
  `[enabled, allowed, notified]`, URL at the staged overlay-proof bundle
  (`.../tmp.yH25kfnXpg/Cedia.app/`), generation 15.
- Launched the installed app directly, bypassing the personal launcher
  entirely: `open -a .../VSCode-darwin-arm64/Cedia.app --args
  --password-store=basic --use-inmemory-secretstorage`. No
  `security delete-generic-password` ran; the `Cedia Safe Storage` item found
  earlier was left untouched (and `Caret Safe Storage` does not exist).
- Post-launch `sfltool dumpbtm`: same UUID `CEC161BE-0E55-4A62-8B30-02B71F90A073`,
  same disposition, URL now
  `file:///Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/`, generation 16.
- `backgroundtaskmanagementd` log confirms the platform move:
  `_bundleURLForAuditToken: updating item ... url=.../tmp.yH25kfnXpg/Cedia.app/
  URL to: file:///Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/`, then
  `registerLaunchItem: found existing item` with the persistent URL.
- The launched app (PID 90160) started its bundled host (PID 90206) against
  the user's real `~/Library/Application Support/Cedia/host` (367M journal,
  5 sessions). Both left running for the owner; nothing was stopped, quit,
  or cleaned.

## Real login cycle: explicitly deferred

- Owner chose to skip the real logout/login this session. No background
  launch at login, no suspended-delivery evidence — D's Login Item/login-cycle
  gate remains open, now with the correct persistent URL in place for whenever
  the cycle is run.
