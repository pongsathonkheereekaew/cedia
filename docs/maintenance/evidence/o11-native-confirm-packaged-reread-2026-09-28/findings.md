# Packaged native-editor confirm postcondition — 2026-09-28

## Result

The corrected proof runner passed on a staged Cedia Code-OSS app. One approved Muse Spark 1.3
prompt read an unsaved native Monaco buffer, requested the guarded `cedia_editor` apply, and was
approved through the visible production Agent Window card. The turn completed; Monaco contained
`unsaved edited`, while `fixture.txt` on disk remained byte-for-byte `disk original\n`.

## Changes needed for the rerun

The phase-aware renderer lookup from the preceding
[runner fix](../o11-native-confirm-runner-reread-2026-09-28/findings.md) selects the baseline
buffer after open and the edited buffer after approval. The prior failed harness run also exposed
webview asset URLs outside Code-OSS's `localResourceRoots`. The IDE webview now injects a
`cedia-public-asset-base` derived from `asWebviewUri`; `publicAssetUrl` and the Cedia logo use that
base. A regression test checks the allowed root and injected URL. This fixed the missing shipped
icons in the staged webview.

## Procedure and observations

- CEDIA checkout HEAD: `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`; the working tree was already
  dirty and remains uncommitted.
- App: staged copy at
  `/var/folders/r7/96w_6l296fnck1z_4vnydbp80000gn/T/cedia-package-stage-ZYC6qa/Cedia.app`;
  profile and workspace were temporary. The app was launched with `--password-store=basic` and
  `--use-inmemory-secretstorage`.
- The proof explicitly selected `opencode-go/muse-spark-1.3-contributor`; the host model-state
  route and composer both read back that exact model before the prompt.
- The production composer form had a React submit handler, its Send button belonged to that form,
  and the exact draft was durable before dispatch. It created one prompt command.
- The real Code-OSS editor bridge opened `fixture.txt`; typing `unsaved original` left disk
  unchanged. Muse's native-editor read result named that file and returned a document handle,
  document version, and SHA-256. The pending confirmation echoed the exact handle, version and
  hash and carried one guarded text edit.
- The visible `Allow this editor change?` card's enabled, hit-tested `Approve once` option was
  clicked. The broker settled, the prompt reached `completed`, and post-approval renderer
  rediscovery read `unsaved edited`; disk stayed `disk original\n`.
- `paidPromptTurns`: **1**. OMP: `omp/18.1.18`, runtime kind `development-source-launcher`,
  `sourceVerified: true`, source revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, source
  tree `d0105be6509186319c7ae76249d1dc61932c7967`; executable SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`; patch manifest SHA-256
  `ce787ee9c8bbfb94d97b8909008d1fec265f0d27f81ab8ed153d6f6e9a180a55`.
- The resource monitor found no unexpected renderer errors or failed HTTP requests. It recorded
  one expected 403 for the optional `vscode-webview://…/api/editor-icon?id=vscode` route, which
  falls back to the packaged VS Code glyph, and the Node 24 Extension Host `[DEP0169]` URL
  deprecation warning. These are reported separately, not treated as unobserved.
- CUA inspected the staged IDE before dispatch: the fixture editor, Agent dock, composer and Muse
  selector were visible, with shipped icons rendered.

## Login Item and Keychain boundary

The staged `main.cjs` used the reviewed test shim (SHA-256
`6675f4bc7253a4a1e769c8454a9626d83da8c5c2a17a3df7d5388a5c15a032c0`). Its log records two
`intercept-set-login-item` events and two simulated states with `isPackaged: true` and
`openedAtLogin: false`. The proof did not use `launch-cedia-personal.ts`, access the persistent
app profile, or remove Keychain items.

After the run, read-only `sfltool dumpbtm` showed the enabled/allowed/notified item UUID
`CEC161BE-0E55-4A62-8B30-02B71F90A073`, identifier `2.com.cedia.editor`, at the persistent
`/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/` URL (generation 10). Read-only unified logs
show that URL was registered at 13:45:08 on 2026-09-28, before the proof result at 14:07:34; the
14:07 staged run has no corresponding URL update to its temporary bundle. The persistent Cedia
process started at 13:45, coinciding with the earlier CUA resolution of an app named `Cedia`;
the logs do not identify whether that selection launched it or whether another event did. The
persistent process was left open and untouched during the final staged proof. This is not a real
macOS login-cycle test.

## Verification

- `bun test apps/macos/test/ide-native-workbench.test.ts`: **49 pass, 0 fail, 217 assertions**.
- `bun test apps/host/test/model-catalog.test.ts scripts/lib/omp-native-confirm-editor.test.ts`:
  **6 pass, 0 fail, 35 assertions**.
- `bun run typecheck`: passed.
- `bun run build`: passed; existing Bun `module.register()` deprecation and large Vite chunk
  warnings remain.
- `bun scripts/omp-native-confirm-packaged-proof.ts` with the staged app and login-item shim:
  **passed**, `paidPromptTurns: 1`, all eight proof checks true.
- `bun run check:repo`: passed after recording this receipt and updating the sole plan/handoff
  (`CI-OK`, 867 doc links, 376 Markdown files, 334 evidence items).
- `bun run check:omp-coverage --require-complete`: passed after the same documentation update;
  1,041/1,041 mappings, zero fatal issues and zero unavailable dispositions. This is source
  completeness only.
- `git diff --check`: passed.

The runner's raw `result.json`, shim log and screenshots are under ignored `dist/native-confirm-packaged-proof/`.
The relevant source hashes are recorded in the current checkout and the proof script itself has
SHA-256 `f0bb316dc61f194d263043d71a9b297fa9e6a9bb200734f1304e6055b828df48`.

## Limits

This closes the packaged native-confirm postcondition reread only. D remains open for the true
two-renderer Send/edit interleave, the macOS login cycle, task-state crash/adoption and other
§11.1 rows. F's source-disposition gate is complete, but its semantic/dynamic surface checks remain
open; W still needs off-LAN access and N still needs a physical iPhone. No D/W/N/F checkpoint is
claimed.
