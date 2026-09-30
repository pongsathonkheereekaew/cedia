# R3 pre-quit decision: a Quit that can really be cancelled — 2026-09-24

This receipt records §2.7's "Deliberate Quit" row on a packaged build: the Stop-and-quit /
Cancel prompt, what Cancel actually leaves behind, and the deadlock the first packaged run
found. The patch-set base revision is unchanged; §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- New: `patches/desktop/0062-cedia-quit-decision.patch` (18 patches, 19 removals).
  `apps/macos/src/app-lifecycle.ts`, `apps/macos/src/agent-window-bridge.ts` and their tests.

## Why the pinned base cannot do this

`ILifecycleMainService.onBeforeShutdown` fires only *after* the quit is recorded
(`_quitRequested = true`), and no window in this fork vetoes it. A main-process prompt wired to
that event would always appear too late: the shutdown sequence has already started.
`installCediaQuitGuard` existed in `app-lifecycle.ts` with no caller, because installing a
`before-quit` handler that calls `preventDefault()` leaves Code-OSS's `_quitRequested` set — so
a Cancel would still quit the moment the last window closed.

## What patch 0062 adds

`ILifecycleMainService.registerQuitDecider(decider)` runs inside `before-quit`, before
`_quitRequested` is set and before `onBeforeShutdown` fires. The decider answers whether this
quit may proceed; `false` leaves the lifecycle exactly as it was, `true` lets the same quit
continue into the shutdown join. `app.ts` passes the service to the bundle's
`installCediaMainProcessLifecycle`, which registers Cedia's decider; without the bundle the
service behaves exactly as upstream.

Cedia's side is `createCediaQuitDecision` plus one real macOS dialog
(`askBeforeStopping`): "Quit Cedia and stop its work?" with `Stop and Quit` / `Cancel`, stating
the running task count, paired-device loss and — when the host can count them — unsaved files.
An unanswered dialog (a dialog that cannot be shown) is **not** consent: the quit is refused and
the reason is logged. A stop that the host does not confirm is reported and still allowed to
continue, because the host reaps itself once its parent is gone; it is never reported as a
successful Quit.

## The defect this run found

The first packaged run of 0062 prompted correctly, but **Cancel poisoned every later Quit**:
`doQuit()` caches `pendingQuitPromise`, and a quit cancelled before `will-quit` or a window veto
never resolves it. The next `lifecycleMainService.quit()` found the pending promise and returned
without ever calling `app.quit()` again — no dialog, no log, and no way to quit from the UI.
Fixed inside the decider's cancel branch by resolving that promise with a veto, which is what
makes a cancel final. Screenshot of the prompt:
`quit-prompt.png` (this directory).

## Verification performed (packaged app, current patch set)

Built with `bun run build:agent`, `bun scripts/prepare-desktop.ts`, `cd desktop && npx gulp
vscode-darwin-arm64-min`, `CEDIA_HOST_NODE=… bun run package:mac`, then `bun run check:packaged`
("packaged Cedia.app matches the current patch set", all three shells at least as new as
`patches/desktop/0062-cedia-quit-decision.patch`).

The running task is a real OMP turn held open without any provider traffic: the app was launched
with `PI_CODING_AGENT_DIR` pointing at a fixture profile whose `models.yml` names a provider at a
local endpoint that accepts the request and never answers. The host reports
`runningSessions: 1`, the session row is `running`, and OMP's own frames (`agent_start`,
`turn_start`) carry the submission's `cediaIntentId` and the model it started on.

| Step | Observed |
|---|---|
| Quit with a running task | Dialog "Quit Cedia and stop its work? 1 task is still running. Stop and Quit stops the running turns and holds queued work until you Continue the task." with `Stop and Quit` / `Cancel` |
| Cancel | Main log `Cedia cancelled the quit`; host `phase=ready`, `accepting=true`, `runningSessions=1`; session still `running`; the app and its window are unchanged |
| Quit again after Cancel | The dialog appears again (this is the deadlock above, fixed) |
| Stop and Quit | Main log `Cedia stops 1 running task(s) with the application` then `Cedia host lifecycle: stopped`; app process gone, `cli.js serve` and `runtime/omp/omp` gone, `lifecycle.json` `phase=stopped` |
| Quit while idle (separate launch) | No prompt; app exited and the host stopped (`Cedia host shutdown: idle`, `phase=stopped`), so the idle path from §3.C is unchanged |

Fixture-level suites: `apps/macos/test/app-lifecycle.test.ts` 20 pass / 0 fail.

## Build note

The packaged app was rebuilt once more after the §2.6 cleanup slice froze, so the shipped
`dist/host` matches the current host sources; `check:packaged` reports the workbench shell, the
native main and the sessions shell all at least as new as `patches/desktop/0062`, and
"packaged Cedia.app matches the current patch set". The quit observations above come from the
same `main.js` and extension bundle that this final package contains - the host slice did not
touch either.

## Not claimed

- The prompt covers running tasks. Active host user terminals and unsaved IDE buffers do not
  yet contribute to the decision: the host's lifecycle status carries `runningSessions`, not a
  terminal count, and no main-process probe for dirty editors exists. Code-OSS still owns the
  Save / Don't Save / Cancel dialog during the window close that follows a confirmed quit.
- The plan's "enter `quitting` first, then offer … Cancel reopens admission" ordering is not
  implemented: the host has one `POST /v1/lifecycle/quit` that fences admission *and* stops, so
  Cedia asks before fencing. A remote client can therefore still start new work during the
  decision window. Splitting that route into fence / resume / stop is the remaining work.
- No crash/adopt, login-item cycle, or update-path verification was performed here.
- The two synthetic fixture tasks ("Quit fixture", "Quit fixture 2") remain in this machine's
  personal state directory; they are verification artifacts, not real work.
