# Login/background lifecycle preflight — 2026-09-27

This is a failed, safety-stopped preflight, not a login-cycle receipt and not a
D acceptance. §10 item 70 and §11.1 own lifecycle status.

## Packaged runtime attempt

The lifecycle driver was changed to require an explicitly staged app under
`/tmp`, reject the repository app, and intercept login-item API calls before
launch. The staged app is `/tmp/cedia-lifecycle-app.XjUGpS/Cedia.app`. The first
implementation used `NODE_OPTIONS=--require=...`; the packaged
run showed zero windows after three seconds, but its main-process marker was
absent, so the interception was **not established**. The driver stopped before
the graceful-quit/crash phases. It did not write a success receipt or claim a
background pass.

Afterward, System Settings → General → Login Items & Extensions showed a “Cedia”
application under Open at Login. There was no pre-run snapshot, so its origin
cannot be attributed to this attempt or distinguished from an existing Cedia
installation. The entry was not changed or removed. Read-only `launchctl list`
contained no Cedia label. `sfltool dumpbtm` did not return within the bounded
check and was interrupted. Therefore no further packaged login-path run is
authorized by the available evidence; do not remove the visible entry.

The driver now uses an explicit scratch-bundle shim at the Cedia lifecycle
module seam: it simulates `wasOpenedAtLogin` and logs/intercepts
`setLoginItemSettings` before signing and launch. This edit is typechecked but
has **not** been runtime-validated, and the login-path experiment remains
stopped until the Login Item state has a known baseline and the shim is reviewed
on a disposable machine/profile. It must not be described as a real macOS login
cycle. The earlier scratch crash/relaunch receipt remains valid only for its
empty-state, unpaired scenario; real task-state crash/adoption is still open.

## Other validation

- `bun run typecheck`: passed after the fail-closed driver changes.
- `git diff --check`: passed.
- No tailnet or physical iPhone was available; neither W nor N changed status.

## Read-only Login Item provenance follow-up — 2026-09-28

The earlier preflight had no pre-run snapshot. Later read-only macOS state and unified logs
identify the current scratch URL's origin without changing the Login Item or launching Cedia:

- `sfltool dumpbtm` currently reports enabled `Cedia`, identifier
  `2.com.cedia.editor`, generation 7, at
  `file:///private/tmp/cedia-race-app.TkrQSp/Cedia.app/`.
- On 2026-09-27 at 14:39, `backgroundtaskmanagementd` repeatedly logged the same item UUID
  `CEC161BE-0E55-4A62-8B30-02B71F90A073` with URL
  `file:///Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/` and disposition
  `[enabled, allowed, notified]`.
- At 22:01:51 the same UUID was updated from that persistent bundle to
  `/private/tmp/cedia-native-confirm-app.T7yfin/Cedia.app/`.
- At 22:48:38 the same UUID was updated from the native-confirm scratch bundle to
  `/private/tmp/cedia-race-app.TkrQSp/Cedia.app/`, the current URL.

This gives the prior persistent bundle URL and enabled disposition, and attributes the current
temporary URL to the race proof. No Login Item change or packaged app launch was made in this
follow-up. Restoring the persistent URL through the documented `launch-cedia-personal.ts` path
would delete the named `Cedia Safe Storage` and legacy `Caret Safe Storage` Keychain items before
launch, so that launcher was inspected but not run. Packaged acceptance remains paused until the
persistent URL can be restored without an unapproved Keychain change.
