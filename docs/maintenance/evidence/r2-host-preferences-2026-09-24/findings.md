# §6.4: the host owns the CEDIA preference subset, and both windows read one record — 2026-09-24

This receipt records the owner-routing half of §6.4. The host `SettingsStore` and its routes already
existed and were proven over HTTP, but nothing in the application could reach them, and the two ends
of the same preference did not agree on a vocabulary. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- New: `apps/macos/agent-window/vendor/synara/apps/web/src/hostPreferences.ts`,
  `apps/macos/agent-window/test/host-preferences.test.ts`.
- Changed: `apps/macos/src/agent-window-main.ts`, `apps/macos/src/agent-window-bridge.ts`,
  `apps/macos/agent-window/src/bootstrap.ts`, `apps/macos/agent-window/src/ide-bootstrap.ts`,
  `apps/host/src/settings.ts`, the vendored `appSettings.ts` / `hooks/useLocalStorage.ts`,
  and their tests.

## What changed

- The renderer can reach the owner at all: `settings` joined the application route allowlist, and a
  `uiSettings` request kind carries read and revision-checked write. A write answers a discriminated
  result — `saved`, `conflict` with the record that won, or `unavailable` — so no window has to parse
  an error string to tell a race from an outage.
- The main process publishes a committed record to the **other** window on `vscode:cedia-settings-updated`
  (the same fan-out the draft revision uses), and it never publishes a refused write.
- `hostPreferences.ts` binds the keys the host owns, projects the host's record into the window's own
  settings store, sends this window's changes back with the revision it read, and adopts a pushed
  record. It writes through the same storage key the app already uses and raises the same in-document
  change signal, so every mounted settings control re-reads instead of holding a stale value.
- One vocabulary, one key per preference: the host now accepts the renderer's own words
  (`chatWidth`: `standard|wide|full`; `sidebarThreadSortOrder`: `updated_at|created_at`). A host-only
  word would be a value no control can produce or show.
- Keys the host does not own stay where they are: server/provider settings keep their server owner,
  and the app theme is still the theme publisher's (it is in the host record but deliberately not
  bound here, so this cannot become a second theme authority).

## Race behaviour (decided, not incidental)

A stale revision is the host's typed refusal, never a silent overwrite. On a conflict the window
adopts the record that won — including keys the other window changed and this one did not — keeps the
keys the user just moved, and re-sends only those on top of the new revision, once. If that retry
also conflicts, the keys stay in `unsaved()`: the window neither claims they were saved nor keeps
overwriting another writer. My first implementation got this wrong and let the winning record
overwrite the user's own action; the fixture that caught it is in the suite.

## Verification

```
bun test apps/macos/agent-window/test/host-preferences.test.ts   # 9 pass, 0 fail
bun test apps/macos/test/agent-window-main.test.ts               # 15 pass, 0 fail
bun test apps/macos/agent-window/test apps/macos/test            # 907 pass, 0 fail
bun test apps/host scripts/lib packages/omp-adapter              # 369 pass, 0 fail (includes /v1/settings over HTTP:
                                                                 #  owner-only read/patch, stale revision 409, unsupported key 400)
bun run --cwd apps/macos/agent-window typecheck                  # clean (includes the vendor tree)
bun run typecheck                                                # the same 10 pre-existing errors, none new
git diff --check                                                 # clean
```

The fixtures cover: only bound keys are projected and only host-renderable values; a local change
sends the revision it read with the host's own category; an unowned key sends nothing; a pushed
record is adopted and an older one is ignored; a conflict keeps this window's change, adopts the
other window's other keys and re-sends once on the new revision; a double conflict stays visible in
`unsaved()`; an unreachable host leaves the window's values alone; and dispose removes both
subscriptions.

## Correction from the packaged run (same day)

The packaged app found two defects in this slice: the event channel is `vscode:cedia-settings-updated`
(the preload only delivers `vscode:` channels), and the `uiSettings` handler asked the host for
`/v1/v1/settings`, so a preference change from a window reached nothing. Both are fixed, the second
now has `apps/macos/test/host-preferences-end-to-end.test.ts` against a real host, and the packaged
window's density change is proven in
[the packaged two-window run](../r8-packaged-two-window-2026-09-24/findings.md).

## What this does not claim

- **No packaged or two-window run.** This is fixture evidence: one renderer against a fake transport,
  and the main-process handler against a fake host. The two windows were not opened together.
- **No remote surface.** Controllers do not get these preferences yet; that is W/N work and §6.4's
  redaction rules.
- The app theme is not routed through this record; it still reaches the windows through the theme
  publisher's own snapshot.
- `chatFontSizePx` is normalized on the way out; the host's numeric range and the renderer's are the
  same (11–18), but the receipt does not prove a packaged control's rendering at each size.
