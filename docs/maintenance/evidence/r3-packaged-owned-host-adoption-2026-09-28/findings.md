# Packaged app-owned host startup and crash/relaunch adoption — 2026-09-28

## Result

PASS. A staged Cedia app copy started its bundled host and pinned OMP 18.1.18 runtime from a
blank scratch profile. The test created a project/task through that host, started an idle OMP
owner, then SIGKILLed only the first staged app main process. The bundled host and OMP owner
survived. A second staged app process reattached to the same host PID, host generation, task ID,
task incarnation and OMP owner PID; the owner summary remained available.

The proof made zero provider requests and recorded zero renderer exceptions. Computer Use observed
the project and task in the staged app before the crash; the driver also saved Playwright screenshots
before the crash and after relaunch adoption. The Login Item calls were intercepted in the staged
copy (two setter calls); this does not prove a real Login Item launch or login cycle.

## Runtime and identity

- CEDIA checkout `HEAD`: `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` (working tree was dirty).
- Staged host build SHA-256: `17af849b2a5a9b0699b7d1b827824f1bae5a8ae734e8515c15f95c7d30f3faad`.
- OMP runtime: `omp/18.1.18`, source revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`,
  verified source tree `d0105be6509186319c7ae76249d1dc61932c7967`.
- Staged OMP binary SHA-256: `9c4619f443a0458f240c2c282d34c890529aa2dba90eb882051cb503668f7cfa`.
- Task `83c62bf2-75a5-436c-b474-674d92db6884`, incarnation
  `11fe2119-2de3-4a65-be8b-20e8bb9828aa`, OMP owner PID `93286`.
- Host PID `93224`, generation `3fac36be-615c-4c94-af57-7d5bd38c0dbd`.
- Provider requests: `0`; renderer exceptions: `0`; owner summary: available.

The app bundle's original OMP executable had the right version label but predated the current
task-ID owner bridge. The test therefore staged the source-attested host and standalone OMP build
into a temporary copy of the app bundle. It did not modify the installed `Cedia.app`. The proof
driver restored the staged host directory, OMP executable and lifecycle module after the run;
byte comparisons of `host/cli.js`, the OMP executable and lifecycle module passed, and its
scratch-profile app, host and OMP processes exited.

## Current-source rerun

On the same checkout `HEAD` (`0676dd70d54e429b5a72c98cb3f22a646bbd10eb`), the current portable
outputs were rebuilt and copied into a fresh temporary clone of the packaged app. The installed
`Cedia.app` was not modified. The packaged proof passed again against OMP 18.1.18: the staged app
started its bundled host, created a project/task, and started the task's idle OMP owner. Computer
Use observed the project/task in the exact staged app. After SIGKILL and relaunch, the same host
PID `2436`, task `4eebfab4-4785-4fb7-adec-c38bbb158687`, incarnation
`c1dca3d9-da33-4cac-b394-43f9f7de2692`, and OMP owner PID `2461` remained attached; the owner
summary was available. Provider requests were `0`; Login Item setter interceptions were `2`.

- Current source host SHA-256: `208d92846782bcac5b6992d9d6b41c3e26b99d3f007054e61699020266f5a24b`.
- Attested OMP binary SHA-256: `9c4619f443a0458f240c2c282d34c890529aa2dba90eb882051cb503668f7cfa`.
- Result: `dist/packaged-owned-host-adoption-proof/2026-09-28T14-14-10-208Z/result.json`.
- Computer Use read the staged app while its exact process was running; no post-proof lookup was
  made that could relaunch it against a default profile.

This rerun strengthens the idle app-owned host adoption result only. The following current-source
draft-hydration rerun separately proves that a host-owned unsent draft returns to the packaged
composer after app crash and relaunch.

## Current-source packaged draft hydration

At the same CEDIA checkout revision (`0676dd70d54e429b5a72c98cb3f22a646bbd10eb`), the portable
outputs were rebuilt and staged into the temporary app clone. The proof created a project and task
through the bundled host, typed an unsent prompt in the actual packaged composer, and observed
revision 1 in the host-owned draft record. It then cleared the renderer's
`synara:composer-drafts:v1` localStorage cache, SIGKILLed only the staged app process, and cleared
only that scratch profile's per-session renderer cache files. The packaged host and OMP owner
survived. After relaunch, the app selected the task and restored the exact prompt from the host
into the composer. Computer Use confirmed the visible text in the staged app after relaunch.

- Host PID `8996`, generation `99d16304-908d-47fa-a562-a1bb48d9adec`; task
  `c57fd470-674a-43d6-b05d-38cc4da2908b`, incarnation
  `f012ed31-e55a-467f-a00c-2321f3ae9f96`; OMP owner PID `9046`, summary available.
- Draft revision `1`, text `unsent restart draft 0bbcbc94-3427-4b13-89aa-f89a2542ab7e`.
- OMP runtime `omp/18.1.18`; source host SHA-256
  `208d92846782bcac5b6992d9d6b41c3e26b99d3f007054e61699020266f5a24b`; standalone OMP SHA-256
  `29847d53cb4c1249a12e913b15678f13592e5fd33f6b911b84edda64f7bfc313`; Agent Window main
  SHA-256 `4f645de219ac2e8b1f4e41517172e4dc7a39ca3734c58ca579bafcfb70400e61`; extension JS
  SHA-256 `a8eef2db5982f2153d984799a2aac85ce1777d362eb659bb2cde74a6719cf88e`.
- Provider requests: `0`; Login Item setter calls were intercepted twice in the staged clone.
  This is not a real Login Item or login-cycle test.
- Result: [`result-current-source-draft-hydration.json`](result-current-source-draft-hydration.json).
  Screenshots: [`app-before-crash-draft-hydration.png`](app-before-crash-draft-hydration.png),
  [`app-after-crash-draft-hydration.png`](app-after-crash-draft-hydration.png).

The packaged restart/UI-hydration subscenario now passes. The full §11.1 shared-draft row remains
open because it combines independent-renderer edits, Send arbitration, restart and migration
acceptance. A real macOS Login Item cycle and a crash during an active turn also remain untested.

## Current-source active-turn app crash and relaunch

The opt-in packaged proof mode used the same current-source staged app and scratch host profile.
After the host-backed draft restore, the proof sent one prompt through the actual composer to a
loopback-only model endpoint that deliberately held its response open. Once the host projected the
turn as `running`, the driver SIGKILLed only the staged app main process. The same host and OMP
owner stayed alive and attached, and the host continued to report that same turn as `running` while
the app was closed. A third app process relaunched, selected the task, and read the same single
running turn; the fixture request count remained one, so the prompt was not replayed. The driver
then sent one explicit abort and observed the turn settle as `cancelled`.

- Active-turn task `59cde9cb-683a-4f5e-b655-2c4fbda48fc8`, incarnation
  `aa2c6216-1d03-4083-956b-bf3cb26883a3`, turn command
  `3e038f2c-6cb7-4a65-876d-ed3f2f3f4f92`.
- Host PID `12150`, generation `24eea6f4-3dcc-4fb2-a6b3-102b88b86a9a`; OMP owner PID `12188`.
  App PID `12257` was killed while the turn was running; PID `12430` reattached afterward.
- Host status was `running` with one turn while the app was closed and after relaunch. The turn
  settled as `cancelled` after the proof's explicit abort.
- The only model request was to the local held loopback fixture; no external provider was called.
  Renderer exceptions: `0`. Login Item setter calls were intercepted three times in the staged
  app; no real Login Item or login-cycle behavior is claimed.
- Result: [`result-current-source-active-turn-crash.json`](result-current-source-active-turn-crash.json).
  Screenshots: [`app-before-active-turn-crash.png`](app-before-active-turn-crash.png),
  [`app-after-active-turn-relaunch.png`](app-after-active-turn-relaunch.png).

This closes the staged active-turn app-crash/relaunch subscenario. The full §11.1 app lifecycle
row and D checkpoint remain open for a real Login Item/login cycle and paired-client behavior.

## Incidental Computer Use launch and cleanup

A Computer Use lookup made after the proof driver had closed the scratch-profile app reopened the
staged bundle without the scratch-profile launch arguments. That separate staged process started
host PID `94045` against `/Users/pond/Library/Application Support/Cedia/host`; its `host.json` PID
matched the process and its command named the staged bundle. The authenticated host quit endpoint
returned HTTP 200, then only the exact staged host and app processes were signalled to finish.
No staged app, host or OMP process remained afterward. The default Application Support host
directory was opened by that extra process; its host metadata/log may have been updated and is not
claimed untouched. No user-state files were removed or manually reverted.

## Evidence files

- [`result.json`](result.json)
- [`app-before-crash.png`](app-before-crash.png)
- [`app-after-crash-adoption.png`](app-after-crash-adoption.png)
- [`result-current-source-draft-hydration.json`](result-current-source-draft-hydration.json)
- [`app-before-crash-draft-hydration.png`](app-before-crash-draft-hydration.png)
- [`app-after-crash-draft-hydration.png`](app-after-crash-draft-hydration.png)
- [`result-current-source-active-turn-crash.json`](result-current-source-active-turn-crash.json)
- [`app-before-active-turn-crash.png`](app-before-active-turn-crash.png)
- [`app-after-active-turn-relaunch.png`](app-after-active-turn-relaunch.png)
