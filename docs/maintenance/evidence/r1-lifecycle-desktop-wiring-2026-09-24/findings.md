# R1 desktop lifecycle wiring and desktop typecheck — 2026-09-24

This receipt records the R1 slice that connects the Cedia host lifetime to the real
Code-OSS application lifecycle. It is source and typecheck evidence only: no packaged
application was rebuilt, signed or launched, so no packaged close/Quit/login behaviour is
certified here. CEDIA-PLAN.md §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, 45 changed entries at inspection (plan,
  instructions, READMEs, `.scratch/`, dated evidence, the R1/R2 implementation of the
  previous slice, and this one). Existing work was preserved; nothing was reset or cleaned.
- The Code-OSS mirror `desktop/` is the pinned base (`ea1912fd6a05b80a56b2ad9b955075211deea521`)
  plus `patches/desktop/*`. It is now **17 patches and 19 removals**.

## Implemented in this working tree

**Shutdown joins the application quit.** `apps/macos/src/agent-window-bridge.ts` exports
`installCediaMainProcessLifecycle`, which creates the one host gateway, builds the
coordinator from the previous slice, and joins
`lifecycleMainService.onWillShutdown(event => event.join("cedia-host-shutdown", promise))`.
Code-OSS waits for that promise before the process exits, so the host stops, its running
tasks pause and the durable `stopped` receipt is written first. A host that will not stop is
logged and the application still quits - the failure is never presented as a successful Quit.
`CediaAppLifecycle.tryQuit({ confirm: false })` exists for this seam, because shutdown is
already committed there and the prompt belongs to a pre-quit surface.

**Login item and background login launch.** `registerCediaLoginItem` registers the packaged
build only (`openAtLogin: true, openAsHidden: true`), never a development binary, and reports
a failure instead of throwing. `shouldOpenFirstWindowAtLaunch` answers the window question at
the `openFirstWindow` site: a packaged macOS login launch opens no work window and replays no
task, while a CLI launch, `--agents`, a folder/file argument, a URL or a protocol link always
opens its window and a normal launch is unchanged.

**Patch `0060-cedia-app-lifecycle.patch`** wires those two into
`src/vs/code/electron-main/app.ts`: it extends the module type declared by `0056`, stores the
bundle's `shouldOpenFirstWindow` decision, and consults it in `openFirstWindow`. Every call is
optional-chained inside a `try`/`catch`, so a checkout without the bundle - or a bundle older
than this export - starts exactly as before.

**Patch `0061-cedia-chat-action-returns.patch`** repairs two return paths that `0059`
introduced in `chatActions.ts` (`TS7030` under `noImplicitReturns`). `0059` stays as history;
the fix is appended.

**`scripts/prepare-desktop.ts`** can now prove "already applied" when a later patch rewrites
lines an earlier one added, which is exactly what `0060` does to `0056`. When neither a
per-patch reverse-check nor a forward-check decides, it reverses the whole set in reverse
manifest order over a mirror of the checkout's touched files, requires the removals to be
absent, and compares the result with the pinned base byte for byte.

## Defect found and fixed during this slice

The first version of the shutdown join assumed `ShutdownEvent.join(promise)`. The real
signature is `join(id: string, promise: Promise<void>)`, which
`desktop/node_modules/.bin/tsc --project ./src/tsconfig.json --noEmit --skipLibCheck` caught
immediately (`app.ts(768,6): Type 'ILifecycleMainService' is not assignable ...`). The types
and the call now carry the id. This is why the Code-OSS-side typecheck is part of the slice
rather than an afterthought.

A second pre-existing finding: that same typecheck reported two `TS7030` errors in
`chatActions.ts` from `0059`, which contradicted `patches/desktop/README.md`'s claim that the
prepared tree typechecks clean. They are repaired by `0061`, not left as a stale claim.

## Verification performed

| Command | Result |
|---|---|
| `cd desktop && ./node_modules/.bin/tsc --project ./src/tsconfig.json --noEmit --skipLibCheck` | **0 errors** over the whole client, including the patched `app.ts` (24.9 s) |
| `bun scripts/prepare-desktop.ts` | `Cedia desktop patches applied (17 patches, 19 removals)`; a second run reports `already prepared` |
| Drift probe: add a line to `desktop/.../app.ts`, drop the stamp, re-run `prepare-desktop` | fails loudly; the checkout is not the pinned base plus the set. Restored byte-identically afterwards. |
| `bun test apps/macos/test/desktop-patch-set.test.ts` | 1 passed, 0 failed - every patch applies in manifest order to the base and the result matches the checkout byte for byte |
| `bun test apps/macos/test/app-lifecycle.test.ts apps/macos/test/agent-window-main.test.ts` | 28 passed, 0 failed (131 assertions) |
| `bun run build:agent` | built; `dist/agent-window/main.cjs` exports `installCediaMainProcessLifecycle`, `isCediaAgentBrowserWebContents`, `registerCediaAgentWindowBridge` |
| `bun run --cwd apps/macos/agent-window typecheck` | passed, vendor tree included |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1,010 passed, 1 failed (the pre-existing `ide-native-workbench` theme failure, §§ below), 123 files |
| `node scripts/ci-validate.mjs` | `CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=367 md=122 evidence=103` |
| `git diff --check` | clean |

Root `npx tsc --noEmit` still reports the pre-existing vendor `~/nativeApi` errors and
`apps/macos/test/state.test.ts`; the current error-file set remains a strict subset of the set
at `HEAD` (96 files), so this slice adds none. The failing
`ide-native-workbench.test.ts` theme test also fails at `HEAD`.

## Not implemented / not claimed

- **No packaged evidence.** `package:mac` was not run, so the packaged `Cedia.app` is still
  the 2026-09-23 build: no real Quit click, no host-stop-before-exit observation, no
  logout/login cycle, no login-item registration on this machine, and no background-launch
  window check. The Code-OSS typecheck and the patch-set mirror proof are the only
  Code-OSS-side evidence here.
- **The pre-quit Stop-and-quit / Cancel prompt is not wired.** §2.7 asks for it when work or
  PTYs are active. This fork's `onBeforeShutdown` is `Event<void>` with no veto, so a real
  prompt needs a Cedia-owned quit surface or a window-level veto; today the shutdown join
  stops the host and reports it. This remains open under §10 item 70.
- No tray/menu-bar status with Open/Quit controls, no `recovery_required` admission hook for a
  host whose OMP child survived, and no view/network-disconnect reconciliation.
- R2 draft renderer wiring and migration, the OMP settings bridge, remote, R3-R8 and every
  §8.2 O-packet remain open. Speech-to-text stays deferred.

## Limitations

Source, typecheck and fixture evidence from the revision above. No packaged workflow, remote
network, device, provider, signing or spend was exercised in this slice.
