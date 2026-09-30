# Native editor `confirm`: packaged preflight stopped before model — 2026-09-27

The owner approved Muse 1.3 paid testing. A new bounded driver,
`scripts/omp-native-confirm-packaged-proof.ts`, prepares a scratch workspace and
host with `editorBridge:true`, launches packaged Cedia Agents and IDE windows, and
requires a dirty native editor buffer before its one allowed Muse turn. It would
wait for a broker `method: confirm`, click the production Approve once button,
and verify the editor changes while disk stays at its original bytes. §10 item 70
owns D status.

Four preflight attempts reached both windows; after focusing the packaged Composer,
the real `EditorConnections` bridge registered. Opening the scratch file and
observing its text in Monaco remained unreliable through Quick Open and `--goto`.
The latest run timed out waiting for the Monaco editor after `--goto`, recorded in
`dist/native-confirm-packaged-proof/failure.json`. No Muse prompt was sent and no
native `confirm` request or click occurred. All owned Cedia processes exited;
the latest scratch fixture was retained for diagnosis.

This is a driver/UI access blocker, not evidence that the production confirm
handler failed. The live `select` loop is proven separately by
`o11-muse-select-approval-2026-09-27`. Native `confirm` remains open for D.

## Dated addendum — 2026-09-27

The later bounded run retained scratch fixture `c-fNal0d` and reached the real
packaged approval surface. The host observed a broker token with
`method: confirm` and title `Allow this editor change?`; the production card
rendered the visible `Approve once` option. The screenshot provenance is
`dist/native-confirm-packaged-proof/approval-prompt.png` (captured during this
run, 2026-09-27 14:13 local time). The driver’s DOM focus check failed before
the documented card shortcut was sent, so no approval was accepted and the
turn did not complete; the native-buffer and disk postconditions remain
unverified.

A final diagnostic fixture, `c-gnRJGo`, stopped before any paid prompt when
the host returned its bounded `session_starting` HTTP 409 while accepting the
explicit model selection. It produced no `confirm` request or approval
screenshot. Both scratch app/host process trees were cleaned, while the
user-owned Cedia process was left untouched. These runs add evidence of the
production card projection and its driver focus race, but do not close D.

## Dated addendum — 2026-09-27, native confirmation follow-up

The proof driver now uses the production semantic `Approve once` button,
waits for the composer draft to become durable, and checks the broker payload
before any click. It specifies the editor protocol's `edits` shape (one range
from line 0, character 0 through character 16) rather than the unsupported
`content` shape, and checks that the approval is for exactly this scratch
`fixture.txt` replacement.

One paid run with the old prompt shape showed the visible card and the semantic
button click closed that request, but the extension rejected the malformed
editor request as `invalid editor bridge request`; this is not an edit proof.
Runs before the dispatch guard was made race-safe also found that a one-shot
draft read could return 404 before persistence, so the driver now waits up to
30 seconds for the exact durable text.

With the corrected `edits` payload, a packaged run showed the valid `confirm`
card, and the production `Approve once` action answered it. The single Muse turn
completed. The OMP journal records `cedia_editor` reading the dirty Monaco
buffer (`unsaved original`), applying the exact range replacement with
`saved:false`, reading back `unsaved edited`, and replying `done`. The scratch
file on disk remained byte-exact `disk original\n`. This closes the native
editor confirm-and-apply behavior for this one packaged scenario.

The proof process itself exited nonzero because its post-approval browser check
kept reading a stale Playwright page after the production IDE handoff moved the
Monaco model to another Code-OSS renderer. The subsequent page re-discovery fix
compiled, but a no-paid retry stopped before prompt dispatch: the composer
catalog did not expose a visible Muse row within 30 seconds. The host journal
had `set_model` and `get_available_models`, but no `thread.turn.start`; no
second paid turn was sent. The successful first run's authoritative evidence is
the host journal and the dirty disk fixture, not the incomplete proof result
file. A later runtime-only postcondition reread should verify the current page
without requiring another model turn.

## Dated addendum — 2026-09-28, model-picker driver diagnosis

The prior no-paid retry's missing Muse row is explained by the proof runner, not by an established
catalog outage. `ComposerModelPicker.tsx` scopes `buildProviderTabRows()` to the current upstream
provider tab, while opening the picker resets to the selected model's provider tab. The driver
searched for `muse-spark-1.3-contributor` without selecting `opencode-go`; if the current model was
under another provider, the Muse row could not appear in that search. The existing browser picker
test confirms search filtering is tab-local.

The proof driver now reads the visible tab labels, selects the exact `opencode-go` tab before
searching, waits for its selected state, and captures the tab list, selected tab, visible menu
items, body text, and screenshot if the tab or model row is absent. Exact OMP catalog metadata was
not captured in this no-app diagnostic, so availability of the Muse row remains to be verified by a
future permitted run. No packaged app was launched and no paid Muse turn was sent for this fix.

D remains open. No packaged rerun was performed, and Login Item provenance must be resolved before
any future packaged proof. This change does not establish D acceptance.

The source cause of the earlier missing card was fixed in `threadSnapshot()`:
it no longer awaits `get_state` context accounting while host UI has a live
time-bounded request. A regression test failed before the guard and passes
after it. The same packaged bundle then rendered the valid approval, which was
clicked successfully. Adapter tests pass 55/55, root typecheck passes, and the
source F completeness gate passes 1041/1041 against OMP 18.1.18. D remains open
for its other §11.1 scenarios; F remains open for N and semantic/dynamic gate
evidence. Tailnet/off-LAN and physical-iPhone prerequisites remain unavailable.
