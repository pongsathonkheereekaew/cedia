# Packaged Agents/IDE Send-edit race — 2026-09-30 (agent-driven CUA)

## Result

PASS. The two-window Send/edit interleave passes against a separately staged
scratch Cedia app on the current source build. The proof runner sent revision 1
(`Agents renderer sends revision one`) from the packaged Agents renderer and held
the fixture OMP ACK. The CUA half was performed by the agent itself through
computer-use (Sky `cua` runtime: native window Raise, composer click, select-all,
clipboard paste) — no human operator. The production IDE input route persisted
revision 2 (`IDE webview keeps revision two`) to the host before the ACK release.

The host then rejected the delayed Agents empty write for revision 1 with HTTP
409. After the fixture OMP acknowledged the one submitted prompt, the production
revision-1 clear returned HTTP 200 with `cleared: false`; the host retained
revision 2 and its exact text. The prompt journal contains exactly one prompt for
revision 1, and revision 2 remains draft text rather than a second submitted
prompt. Zero provider requests; staged Electron exited 0.

## Runtime evidence

- Runner: `bun scripts/omp-send-race-packaged-proof.ts` with
  `CEDIA_SEND_RACE_APP_PATH=<fresh mkdtemp scratch>/Cedia.app` (1.4 GB copy of
  the installed `2026-09-30T08:25:21.069Z` package; installed app never launched).
- Run ID: `2026-09-30T11-23-40-107Z`; fixture session ID:
  `c6266242-51ba-422d-bbb3-7625eab4e095`.
- Result: `ok: true`, one journaled prompt (`b973582b-2507-4f49-810b-c6154f80de38`,
  status completed), final draft revision 2 with the exact revision-2 text, stale
  Agents write 409 `draft_conflict`, old clear 200 `cleared: false`, zero provider
  requests, and `rootCediaPidTouched: false`.
- The harness's own assertions confirm the CUA half: `real keyboard input replaced
  the IDE composer text` (before/after/focused) and `Lexical keyboard input updated
  the IDE's persisted composer store`. A screenshot verified the exact revision-2
  text with cursor in the composer before the release file was written.
- Screenshots and `result.json` are under the ignored runtime output directory
  `dist/send-race-packaged-proof/2026-09-30T11-23-40-107Z/`.
- The staged Login Item shim intercepted its setter call and simulated packaged
  state. This is not a Login Item or macOS login-cycle test.

Relevant source at the run (HEAD `60799ec3bc8`):

| File | SHA-256 |
|---|---|
| `apps/macos/src/agent-ide-webview.ts` | `6fe45ac730e80f46119f7273b7abe155402d5f03bb94899ac7ff09ed0f8ae925` |
| `apps/host/src/service.ts` | `d75e712995eabada7a710e6ad6e0f82e252995820485c68f02b577f823bb092d` |
| `apps/macos/src/agent-window-main.ts` | `567278b382e40ab8561ebad46df9e212502c0de791f43b9f12df49fa76eb8449` |
| `apps/macos/agent-window/src/cedia-adapter.ts` | `74be10813f55f1165a525446a072d659e7efda8c7f4c54de065e8a7d9a2d9c0e` |
| `scripts/omp-send-race-packaged-proof.ts` | `6011811808ff93562823677dfa62d0b35deec804b91aada97a09bf43ef47c0d2` |

## Retained failures on the way

Two earlier attempts the same day are retained as failures in their ignored
`dist/` output directories, not counted as passes:

- `2026-09-30T09-14-50-177Z`: timed out at the preflight gate; no CUA edit strategy
  was in place yet.
- `2026-09-30T09-19-20-066Z`: the agent's CUA edit landed (harness-confirmed), but
  an earlier mis-click on the shifting accessibility tree hit the Composer extras
  button and enabled Plan mode, committing draft revision 3 instead of 2; the proof
  correctly failed the revision-2 assertion. The run then stalled at teardown on the
  staged app's own quit-decision dialog (`Quit Cedia and stop its work?`), which the
  agent confirmed with Stop and Quit so the proof could exit and record the failure.
  The staged Electron had also survived the runner's close (orphaned PIDs using the
  real user-data-dir flag); only those staged PIDs were killed, after which the
  Login Item was read back as still pointing at the installed app. No Keychain,
  Send, or real-task action was taken in either attempt.

## Limits

This closes the packaged two-renderer Send/edit race scenario with an agent-driven
CUA half. The broader shared-draft row still requires restart and conflicting
legacy-draft migration checks. It does not prove packaged app/host crash adoption,
Login Item behavior, remote clients or iPhone behavior, and it does not close
D/W/N/F acceptance.
