# R1 lifetime: the quit decision closes admission before it asks — 2026-09-24

This receipt records the §2.7 "Deliberate Quit" ordering fix: the host could fence admission
and stop, but it had no way to fence *without* stopping, so the owner's Stop-and-quit / Cancel
dialog ran with the host still admitting new work. §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- `apps/host/src/lifecycle.ts`, `apps/host/src/router.ts`, `apps/host/src/server.ts`,
  `packages/protocol/src/index.ts`, `apps/macos/src/api.ts`,
  `apps/macos/src/agent-window-main.ts`, `apps/macos/src/app-lifecycle.ts`.

## The gap

§2.7 requires a deliberate Quit to "enter `quitting` and reject new starts/mutations, including
remote ones" and to "offer Stop-and-quit or Cancel", with "Cancel reopens admission". The host
had one lifetime transition, `POST /v1/lifecycle/quit`, which fenced *and* committed the
shutdown. The application therefore had to choose between two wrong orders:

- ask first and fence on the answer, which leaves the whole decision window admitting local and
  remote work the answer is about to ignore; or
- fence first by calling the quit route, which stops the host even when the owner cancels.

## What changed

- `HostLifecycle.resume()` returns a `quitting` host to `ready` and refuses a `stopped` one:
  a fenced host has stopped nothing, but a stopped host is a completed shutdown the owner
  cannot take back. The refusal is `lifecycle_stopped` (409), not a silent reopen.
- `POST /v1/lifecycle/fence` fences admission and answers
  `{ accepted, changed, phase, generation, runningSessions }` without stopping; repeated calls
  answer `changed: false`. `POST /v1/lifecycle/resume` reopens it, and `POST
  /v1/lifecycle/quit` keeps its fence-and-stop meaning, so `alreadyRequested` stays honest when
  a fence came first. All three are owner-only.
- The router's admission fence now lets exactly the lifetime transitions through a fenced host
  (`quit`, `fence`, `resume`); every other mutation is still `host_quitting` (409).
- `createCediaAppLifecycle` fences before it prompts when the quit has something to decide
  (running sessions or unsaved editors), and reopens admission on Cancel. Two failures are
  reported rather than hidden: a quit whose admission never closed is *not* asked about
  (`failed`, with the reason), and a cancel whose reopen failed is `failed` rather than
  `cancelled`, because a silently fenced host would refuse work after the owner chose to stay.
  The cancel republishes the reopened state so the surface does not keep showing a fenced host.
- A quit with nothing to decide does not fence at all: the same call stops the host immediately.
- The gateway reaches an existing host read-only for both new calls. `withClient` starts a host
  when none is running, which is wrong for a quit, so `fence`/`resume` use the same
  never-start acquisition `peek` already used (plan §2.7: asking to quit must not spawn the
  process it is about to stop).

## Verification

```
bun test apps/host/test/lifecycle.test.ts apps/host/test/http.test.ts   # 16 pass, 0 fail
bun test apps/macos/test/app-lifecycle.test.ts                          # 25 pass, 0 fail
bun test apps/host                                                       # 227 pass, 0 fail
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                                                                        # 1102 pass, 0 fail
bun run typecheck                                                       # same 10 pre-existing errors, none new
git diff --check                                                        # clean
```

The HTTP test drives the real loopback server: `fence` answers `changed: true` with
`runningSessions: 0`, a `POST /v1/projects` then answers `409 host_quitting`, the listener and
descriptor survive, a repeated fence answers `changed: false`, `resume` answers `changed: true`
with phase `ready`, and the *same* project creation that the fence refused then succeeds. A
controller token gets 403 from both routes. The lifecycle unit test covers `resume` from
`ready` and `quitting` and the refusal after `completeQuit`.

## Not done here

- The pre-quit dialog still counts running sessions and unsaved editors only. Active host user
  terminals cannot contribute yet because the separate host user-shell owner does not exist
  (§8.1 "Terminal": W/N requires it). No terminal count is invented in the meantime.
- No packaged run of the new ordering: the packaged Quit path was exercised by the earlier
  §2.7 receipt, but this fence/resume ordering has source-level evidence only.
