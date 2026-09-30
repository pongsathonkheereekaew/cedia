# R3 packaged app: two windows, a real Quit, and the defect Quit hid — 2026-09-24

This receipt records the first packaged run of this baseline: the app was built from the current
patch set, structurally verified, launched, its two windows rendered, and a deliberate Quit
executed. That run found a real defect in the quit path, which is fixed here and re-verified in
the packaged app. §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- The last packaged `Cedia.app` predated `patches/desktop/0060`/`0061`; item 70 recorded that
  `package:mac` had never been run in this baseline.

## What was built and verified

- `bun run build:agent`, `bun scripts/prepare-desktop.ts` (already prepared, 17 patches/19
  removals), `cd desktop && npx gulp vscode-darwin-arm64-min` (2.87 min, fresh shell bundles),
  then `CEDIA_HOST_NODE=… bun run package:mac` and `bun run check:packaged`.
- `check:packaged`: **every check OK** - patch-set sha256 `a1b889d80fe2…` (17 patches), base
  revision `ea1912fd…`, sessions/workbench/native-main/cedia-extension sha256 stamps, Agent
  Window assets matching the local build, and all three shells at least as new as the newest
  patch.

## Rendered evidence (packaged app)

- **Agents window** renders the standalone Cedia bundle
  (`vscode-file://…/out/vs/cedia/agent/index.html#/980cf826-…`): sidebar (New thread, project
  `cedia`, thread `hi`, Chats), the thread transcript, the composer with approval and model
  controls, the panel row (Review/Terminal/Browser/Files/Side chats/iOS Simulator/Source
  control), and the status bar `host · live`, `model · opencode-go/muse-spark-1.3-contributor`,
  `session · closed`, `branch · main`.
- **Open in IDE** from that window opened the IDE window rendering
  `…/out/vs/code/electron-browser/workbench/workbench.html` with the Explorer on the Cedia
  workspace, the workbench terminal panel, and the **AGENT dock** showing the same task with
  `Muse Spark 1.3 Contributor > ~/cedia > main *12 ?4 →2%` and "Cedia ready".
- The packaged host exercised the real user state directory: it migrated the existing
  schema-2 journal and left `journal.sqlite.schema-2.backup` beside it, which is the backup rule
  added in the tenth slice running for real rather than in a fixture.

## Defect found by the packaged Quit, and its fix

**Symptom.** A deliberate Quit (Cmd+Q) exited the app, but the host and its OMP child kept
running and `lifecycle.json` still said `phase: "ready"`. The app log said:

```
[info] Cedia host lifecycle: unreachable   (x3)
[info] Cedia host shutdown: idle
```

while the very same host answered a read with its own token:
`GET /v1/lifecycle` -> `200 {"phase":"ready","accepting":true,…}` (and `401` without it). So the
host was healthy and reachable; the application simply never asked it to stop.

**Root cause.** The quit path reads the host without starting one (`gateway.peek()`), and `peek`
began with `const active = client; if (!active) return undefined;`. In the packaged app the
window's host traffic goes through another client, so the main process's own cache was empty:
"no client yet" was reported as "no host", `tryQuit` classified the state as `idle`, and the
managed host was left behind. The three `unreachable` lines are that misclassification.

**Fix.** `peek()` now probes read-only through the gateway's existing `healthy()` helper - it
reads the descriptor from the state directory, health-checks the host, caches the client on
success, and still returns `undefined` instead of spawning anything when there is genuinely no
host. A unit test (`agent-window-main.test.ts`) asserts that a process which never called
`ensure()` still sees a running host and can quit it.

**Re-verification (repackaged).** After `package:mac` again, launching and quitting the packaged
app produced:

```
[info] Cedia host lifecycle: unreachable
[info] Cedia host lifecycle: ready
[info] Cedia host lifecycle: stopped
[info] Cedia host shutdown: stopped
```

with the app process gone, no `cli.js serve` and no OMP child left, and
`lifecycle.json = {"phase":"stopped","appGeneration":"34902",…}`.

## Verification performed

| Command | Result |
|---|---|
| `bun run build:agent` | Agent Window assets written |
| `cd desktop && npx gulp vscode-darwin-arm64-min` | finished in 2.87 min |
| `CEDIA_HOST_NODE=… bun run package:mac` | app stamped (patch set `a1b889d80fe2`, 17 patches), ad-hoc signed |
| `bun run check:packaged` | all checks OK |
| packaged launch + `cua` AX/screenshot | two windows rendered as described |
| packaged Cmd+Q before the fix | defect above (host survived, `shutdown: idle`) |
| `bun test apps/macos/test/agent-window-main.test.ts` | 12 passed, 0 failed (includes the new peek test) |
| packaged Cmd+Q after the fix | `Cedia host shutdown: stopped`, host + OMP gone, `phase: "stopped"` |

## Not implemented / not claimed

- **The login cycle and background launch are still unobserved**: the login item is registered
  by patch `0060`, but no logout/login (or `wasOpenedAtLogin`) run has been performed, so the
  plan's login row has no packaged evidence yet.
- The pre-quit **Stop-and-quit / Cancel prompt** is still missing (`onBeforeShutdown` has no veto
  in this fork), so a Quit with running work stops it without asking.
- This run quits and relaunches; it does not exercise the app-crash/host-survives adoption path,
  the update path, or any paired remote client.
- Two windows were observed, but only through `Open in IDE` from the Agents window; no test
  drove a task from one window while the other was focused.
- The packaged app in this run had no task started (`session · closed`), so no OMP turn ran
  inside the packaged runtime.
- §2.6 cleanup, the rest of §3.C, R4-R8 and every §8.2 O-packet remain open; speech-to-text
  stays deferred.

## Limitations

Evidence is from this machine's packaged app and its own state directory. It is a personal
ad-hoc-signed build (`--sign -`), not a notarized release; `check:packaged` is structural, and
the rendered observations come from accessibility state and screenshots of that one run.
