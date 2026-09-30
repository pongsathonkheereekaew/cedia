# Capability gating reaches settings, search and deep links — 2026-09-24

This receipt records the R1 capability boundary §8/§3.B asks for beyond the sidebar row: the
host's snapshot now describes what this process can actually do, the settings destinations and
the settings search honour it, a stale `?section=` deep link cannot reopen a destination the host
reports as not implemented, and the snapshot is re-read instead of frozen for the window's life.
§10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- `apps/host/src/capabilities.ts`, `apps/host/src/router.ts`, `apps/host/src/server.ts`,
  `apps/host/test/http.test.ts`, `apps/host/test/remote-gateway.test.ts`,
  `vendor/synara/apps/web/src/settingsNavigation.ts`,
  `vendor/synara/apps/web/src/settingsSearchIndex.ts`,
  `vendor/synara/apps/web/src/components/SettingsSidebarNav.tsx`,
  `vendor/synara/apps/web/src/lib/serverReactQuery.ts`,
  `vendor/synara/apps/web/src/routes/_chat.settings.tsx`,
  `apps/macos/agent-window/test/capability-gate.test.ts`.

## What changed

- Two rows described a Cedia that no longer exists. `omp.settings` claimed "the versioned OMP
  settings bridge is not installed yet" while the inventory, the per-key disposition, the
  revision-checked write and the rendered destination all exist; and `remote.tailscale` claimed
  the gateway "is not integrated" while the gateway and enrollment are implemented. Both are now
  `dependency_unavailable` with the state that is actually missing: no OMP runtime is running, or
  this build carries no remote web client. The vocabulary is the point — only an
  `integration_missing` row leaves the working UI, so a capability that exists but is idle must
  say so instead of reporting itself unimplemented.
- `remote.tailscale` is decided by the process that started the gateway, not copied from the
  static list: `createRouter` gained a `gateway` accessor that `startHostServer` assigns once the
  gateway is up, so a host with a packaged client answers `available` with the gateway's own
  operations (`enroll`, `session`, `logout`) and a host without one answers `dependency_unavailable`.
- The settings destination and the settings search consume the same rule as the sidebar row. A
  gated destination is bound to a host capability id in one table beside the nav items,
  `SettingsSidebarNav` filters both the section list and its ranked results, and the settings
  route resolves `?section=` through the capability rule, so a stored deep link or an old profile
  falls back to the first destination the host still backs. A destination whose capability only
  needs setup stays visible, because its panel has to explain the reason.
- The snapshot is no longer frozen for the window's life. It was `staleTime: Infinity`, which
  meant a window opened before any task started kept reporting "no runtime" forever; it now has a
  30-second staleness window and re-reads on window focus, which is exactly when the owner can see
  those rows.

## Verification

```
bun test apps/host/test/http.test.ts apps/host/test/remote-gateway.test.ts apps/host/test/remote-web-assets.test.ts
                                                          # 22 pass, 0 fail
bun test apps/host                                        # 255 pass, 0 fail
bun test apps/macos/agent-window/test                     # 166 pass, 0 fail
bun run --cwd apps/macos/agent-window typecheck           # clean (tsc + vendor tree)
bun run build:agent                                       # renderer + main.cjs built
bun run typecheck                                         # 10 errors, all pre-existing and unrelated
git diff --check                                          # clean
```

The fixture assertions are the ones that would have caught the stale rows: a host started without
a web client answers `dependency_unavailable` with a reason naming the missing client, a host
started with one answers `available` with `enroll` among its operations, and the renderer tests
pin every gated settings destination to an id the host registry really contains, so a row bound to
an id the host never sends fails the suite instead of silently keeping its old behaviour.

## Not done here

- No packaged window was observed rendering the gated settings list or search; the gating is
  proven by the renderer suite and the bundled build, not by a capture.
- Workspace search has no settings entries at all, so there was nothing to gate there; the
  keybindings sheet and the archived/shortcuts deep links are core Cedia UI and are unaffected.
- `omp.live-cli-attach` and `app.automations` remain `integration_missing` on purpose: Cedia has
  no live attach and no schedule owner yet, and the sidebar row stays off until one exists.
