# Packaged native-confirm rerun (current source, staged app) — 2026-09-29

## Result

`CEDIA_PACKAGED_APP_PATH=<tmp stage>/Cedia.app bun scripts/omp-native-confirm-packaged-proof.ts`
passed with **1 paid Muse prompt** (`opencode-go/muse-spark-1.3-contributor`):
all eight proof checks true, `ok: true`, `paidPromptTurns: 1`.

## What changed vs the 2026-09-28 receipt

- The installed `VSCode-darwin-arm64/Cedia.app` (built 2026-09-27) no longer
  matches current source: its bundled `extension.js` lacks the
  `cedia-public-asset-base` fix (0 hits vs 2 in `dist/mac-extension`), so a
  first attempt on a plain copy failed only on the resource gate — dozens of
  `central-icons-reversed/*.svg` 403s (`agents.svg`, `arrow-left-right.svg`,
  …) from the Agents webview. The paid turn itself completed in that run
  (journal: prompt `completed`, turn `completed` on the exact Muse model,
  `cedia_editor` read → guarded apply → post-approval re-read, disk untouched),
  but the runner's all-resources gate failed by design.
- The rerun staged a **current-source bundle**: installed app copy +
  `dist/mac-extension`, `dist/agent-window`, `dist/omp-standalone/omp`,
  `dist/host/cli.js` overlaid, re-codesigned. That run is fully green:
  `unexpectedHttpFailures: []`, `errors: []` (only the documented Node 24
  `[DEP0169]` warnings remain, recorded separately in `result.json`).

## Procedure and observations

- Checkout HEAD `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, working tree dirty
  by design; nothing committed.
- OMP `omp/18.1.18`, runtime kind `development-source-launcher`,
  `sourceVerified: true`, source tree `d0105be6509186319c7ae76249d1dc61932c7967`
  (from `result.json`).
- Exact model selection + host `/model-state` readback before dispatch; real
  Code-OSS editor bridge registered; `unsaved original` typed with disk
  unchanged.
- Muse's read returned the exact fixture handle/version/SHA-256; the pending
  `confirm` echoed them with one guarded range edit
  (`[0:0–0:16]` → `unsaved edited`).
- Visible `Allow this editor change?` card → `Approve once` clicked
  (visible/enabled/hit-tested); broker settled; prompt `completed`.
- Post-approval Monaco reads `unsaved edited`; disk stays `disk original\n`
  (`bufferText: "unsaved edited"`, `diskText: "disk original\n"`).
- Model's own closing turn: post-approval `cedia_editor` re-read then `done`.
- Captures: `dist/native-confirm-packaged-proof/result.json`,
  `approved-editor-buffer.png`, `approval-prompt.png`.

## Login Item / Keychain boundary

- The staged run carries no Login Item shim (plain bundle + current-source
  overlay); it wrote no Login Item and touched no Keychain. macOS did move the
  existing Login Item URL to this staged bundle on launch (read-only
  observation in the companion Login Item receipt) — that is platform behavior
  on staged launch, not a proof claim.

## Limits

- One paid prompt, no retry inside the run. Closes only the packaged
  native-confirm postcondition on current source; D/F checkpoints stay open.
