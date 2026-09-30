# Packaged draft staging diagnostic — 2026-09-27

Driver hardening and bounded diagnostic only; §10 item 70 owns D acceptance. No
gap change. The packaged two-renderer Send-versus-edit interleave remains open.

## Safety changes

`scripts/omp-send-race-packaged-proof.ts` no longer deletes the macOS
`Cedia Safe Storage` Keychain item. It now requires
`CEDIA_SEND_RACE_APP_PATH` to name a separately staged `Cedia.app`, rejects the
repository's installed app path, and checks for the executable before creating
scratch state or starting the fixture host. Calling the driver without that
path fails before host startup. The app was staged by copying the current
packaged bundle to `/tmp/cedia-race-app.TkrQSp/Cedia.app` and ad-hoc signing that
copy; the installed bundle was not launched or modified.

## Bounded packaged observation

The scratch package opened two windows on the fixture project. Playwright
focused the production Cedia Composer command and observed its Code-OSS
`vscode-webview://` frame, but the parent workbench page has no webview element
or controllable Playwright frame target. The Agents window's visible draft was
read back from the host before the diagnostic sender ran:

- draft id `23c26ba5-c6a0-403b-8345-f31a31252d2b`, revision `1`;
- text `Two-window race: both windows send exactly this line`;
- one prompt row in the host journal, payload hash
  `dcf363d831f0eede79d976e6e3486e2cfeb67cad66a0ef211b6ad4ce1e8e75b9`;
- the second sender was a separate in-process production adapter, not the IDE
  dock renderer. It was accepted; the packaged two-renderer interleave is
  therefore **not proven**.

The scratch app exited and no `cedia-send-race-pkg-*` process remained. The run
made no provider requests. Screenshots are in
`dist/send-race-packaged-proof/` (scratch output; not an acceptance receipt).

## Verification

- `bun run smoke:send-race`: passed all 36 deterministic live checks against
  OMP 18.1.18, including same-revision claim/release, conflicting edit refusal,
  one journaled winner, restart persistence, and two loopback-only model hits.
- `bun run typecheck`: passed.
- `bun test apps/macos/test/app-lifecycle.test.ts apps/macos/test/desktop-patch-set.test.ts`:
  29 passed, 0 failed. This covers the packaged-login registration contract and
  hidden login-launch window decision in source tests, not a real macOS login
  cycle or background launch.
- `bun run check:omp-coverage --require-complete`: passed, 1,041/1,041 audited
  records mapped; this is F source completeness, not full F acceptance.
- `git diff --check -- scripts/omp-send-race-packaged-proof.ts`: passed.
- Running the packaged diagnostic without `CEDIA_SEND_RACE_APP_PATH` failed
  before scratch host creation, as intended.

No product behavior changed. A real dock-driven, same-revision interleave still
needs a controllable webview input/execution context; time-based sends do not
create the required reservation window deterministically.
