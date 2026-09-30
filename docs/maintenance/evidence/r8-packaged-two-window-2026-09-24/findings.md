# Packaged run: one app, two windows, the host-backed settings record, and a quit that stays quit — 2026-09-24

This receipt records a packaged run of the current working tree (revision `0676dd70d54`) rather
than a fixture. It re-verifies the two windows and the Quit path at the current patch set and takes
the first packaged evidence for §6.4's host-owned preference record. It also records two defects the
run found — one of which stopped the AI window from starting at all. §10 item 70 owns status.

## Source state and build

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- `bun run build:agent`, then `CEDIA_HOST_NODE=<Node v24.18.0> bun run package:mac`, then
  `bun run check:packaged` → every check OK: patch set
  `086d31f75d3688905304e07758c808e138632c4fb672167950c6df01e45a31b5` (18 patches, base
  `ea1912fd6a05b80a56b2ad9b955075211deea521`), the three shell hashes, the Cedia extension and the
  Agent Window assets all matching the repository build.
- Launched with `open -a …/Cedia.app` (a personal ad-hoc-signed build; `use-inmemory-secretstorage`
  in the packaged `argv.json`).

## Defects found by the run, and fixed

1. **The AI window did not start.** The packaged Agents window rendered only
   `Cedia Agents could not start: Unsupported event IPC channel 'cedia:draft-updated'`. The Code-OSS
   preload's `validateIPC` refuses any subscription outside the `vscode:` namespace, so both Cedia
   event channels (`cedia:draft-updated`, `cedia:settings-updated`) are now
   `vscode:cedia-draft-updated` and `vscode:cedia-settings-updated`, and the rule is pinned by a test
   because no fixture can see the preload.
2. **A setting change went nowhere.** After the channel fix the window rendered and the density
   control moved, but the host's settings record stayed at revision 0. The `uiSettings` handler asked
   the host for `/v1/settings`, while the client resolves a *relative* path against the host's `/v1/`
   base — so the request was `/v1/v1/settings`, a 404 the window honestly reported as
   `unavailable`. The path is now `settings`, and `apps/macos/test/host-preferences-end-to-end.test.ts`
   runs the real main-process handler against a real host so a wrong path fails a test instead of
   silently disabling the feature. The earlier unit test in `agent-window-main.test.ts` had enshrined
   the wrong path; its expectation is corrected and annotated.

A third observation was **not** a defect: an intermediate reading suggested the app relaunched right
after Quit. It did not — binding the app with the computer-use `getApp` call launches a quit
application. The final measurement below avoids binding after the quit.

## What the packaged run verified

- **One application, two windows.** The Agents window rendered the full Cedia UI (projects, tasks,
  chat, composer and the Cedia status bar reading `host · live`, `model · …`, `session · closed`,
  `branch · main`). `Open in IDE` opened the second window, `cedia — Cedia`, carrying the AGENT dock
  with the Cedia Agent webview for the same task.
- **The host owns the preference record (§6.4).** In Settings > Appearance the owner selected
  `Spacious`. The host persisted it: `~/Library/Application Support/Cedia/host/settings/app-preferences.json`
  now reads `{"version":1,"revision":1,"values":{…"uiDensity":"spacious"…}}`, and the live host
  answered the owner-only `GET /v1/settings` with `revision 1` and `uiDensity: spacious`. A
  subsequent launch of the same packaged app showed the control back at the host's value rather than
  the window's previous local pick, which is the host-as-authority behaviour the bridge implements.
- **A deliberate Quit quits.** Choosing Quit Cedia from the app menu stopped the host and left the
  durable receipt at `phase: "stopped"`; over 30 s of polling the application process count stayed at
  zero and the host process count at zero.

## What this does not claim

- **No two-window *simultaneous* settings change.** The owner changed a setting in one window with
  the other open but idle, and no conflict was forced, so the broadcast/conflict path is still
  fixture-only evidence.
- **The rendered OMP settings surface, the archive-retention row and the "awaiting OMP" segment were
  not exercised in this run.** The window had no pending model change and no archived task was
  opened, and the host had no live runtime to read an OMP settings inventory from.
- The login-item cycle and a background launch at login were still not exercised; the run only proves
  the explicit Quit path (it does not prove the "start in the background at login" branch).
- Speech-to-text remains deferred and was not touched; no provider, model or network call was made
  by this run.
