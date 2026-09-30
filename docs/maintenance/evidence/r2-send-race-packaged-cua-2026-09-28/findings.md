# Packaged Agents/IDE Send-edit race — 2026-09-28

## Result

The two-window Send/edit interleave now passes against a separately staged scratch Cedia app.
The proof runner sent revision 1 from the packaged Agents renderer and held the fixture OMP ACK.
Computer Use typed revision 2 into the actual IDE Agent dock composer while the ACK was still
held. The production IDE input route persisted revision 2 to the host before the ACK was released.

The host then rejected the delayed Agents empty write for revision 1 with HTTP 409. After the
fixture OMP acknowledged the one submitted prompt, the production revision-1 clear returned
HTTP 200 with `cleared: false`; the host retained revision 2 and its exact text. The prompt
journal contains exactly one prompt for revision 1, and revision 2 remains draft text rather
than a second submitted prompt.

## Runtime evidence

- Runner: `bun run smoke:send-race-packaged` with
  `CEDIA_SEND_RACE_APP_PATH=/var/folders/r7/96w_6l296fnck1z_4vnydbp80000gn/T/cedia-package-stage-ZYC6qa/Cedia.app`.
- Run ID: `2026-09-28T10-54-02-352Z`; fixture session ID:
  `2246a0a7-59cc-4c9e-a835-82631ea28e3a`.
- Result: `ok: true`, one journaled prompt, final draft revision 2, stale Agents write 409,
  old clear `cleared: false`, zero provider requests, and `rootCediaPidTouched: false`.
- Native CUA confirmed the visible IDE composer changed from “Agents renderer sends revision one”
  to “IDE webview keeps revision two” before releasing the ACK.
- Screenshots and `result.json` are under the ignored runtime output directory
  `dist/send-race-packaged-proof/2026-09-28T10-54-02-352Z/`.
- The staged Login Item shim intercepted its setter call and simulated packaged state. This is
  not a Login Item or macOS login-cycle test.

The run was provider-free and used an isolated fixture host/OMP ACK gate. It did not touch the
installed Cedia app or its state. Relevant source at the run:

| File | SHA-256 |
|---|---|
| `apps/macos/src/agent-ide-webview.ts` | `6fe45ac730e80f46119f7273b7abe155402d5f03bb94899ac7ff09ed0f8ae925` |
| `apps/host/src/service.ts` | `9044b3aa437b0ef5286ae0735082baccde8dfe126eb1801705eee1cab89f88fa` |
| `apps/macos/src/agent-window-main.ts` | `3abbe8267a9913483543ee82db123aafdc44a3671bbe659f81160beb662c3dd5` |
| `apps/macos/agent-window/src/cedia-adapter.ts` | `ef317ada1cf6da3413e1e9f14c0fd58f87a8af1470f09468211b687603b2401a` |
| `scripts/omp-send-race-packaged-proof.ts` | `18f199b60b910a5c8c2cb05c4a74fad670c7b034d02f43aa93368b1e770b4041` |

## Limits

This closes the packaged two-renderer Send/edit race scenario. The broader shared-draft row still
requires restart and conflicting legacy-draft migration checks. It does not prove packaged
app/host crash adoption, Login Item behavior, remote clients or iPhone behavior, and it does not
close D/W/N/F acceptance.
