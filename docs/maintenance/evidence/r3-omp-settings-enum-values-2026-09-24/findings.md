# O04 settings inventory: an enum path's allowed values now travel to the control — 2026-09-24

This receipt corrects a limitation the previous settings-surface receipt recorded as an OMP
contract gap. It was not: OMP's schema declares an enum's values, Cedia's own bridge dropped
them, and the panel fell back to a free-text input. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- OMP patch `0001-cedia-rpc-bridges.patch`, sha256
  `6d67c35a67b9f6b26c0cb4410261b904fb13014712825a37ee2fd4a0aac182a2`
  (previous `51cb5151b8a826efa4ee9564d9be6dea277aa4bca512bd2d08337bb7b79d8f29`).
- Changed: `upstream/omp/.../modes/rpc/rpc-types.ts`,
  `upstream/omp/.../modes/rpc/cedia-capability-bridge.ts`,
  `upstream/omp/.../test/cedia-capability-bridge.test.ts`,
  `packages/protocol/src/index.ts`, the settings panel and its logic and tests.

## The measurement that changed the conclusion

`packages/coding-agent/src/config/settings-schema.ts` is the single source of truth for every
setting, and an enum entry declares its choices, for example
`"power.sleepPrevention": { type: "enum", values: ["off", "idle", "display", "system"], ... }`.
`getEnumValues(path)` already existed and `validateSettingValue` already used it to refuse a bad
write. `settingsKeys()` simply never projected the field, so the inventory carried the type
`enum` with no values and the panel had nothing to render but a text box. The limitation was in
Cedia's patch, not in OMP.

## What changed

- `RpcCediaSettingsKey` gains an optional `values?: string[]`, and `settingsKeys()` fills it from
  `getEnumValues(path)` for enum paths only. The list a control offers is therefore the same list
  the runtime's validator enforces - one definition, not a second opinion.
- `OmpSettingsKey` in the protocol accepts `values`, and the parser validates it strictly: a
  non-empty bounded array of unique non-empty strings. A list the validator would disagree with
  is refused rather than trimmed, because offering a value the runtime refuses is worse than
  offering none.
- The panel renders a real `select` with the published values when they exist and keeps the
  free-text editor, validated by the runtime, when they do not. The placeholder now says which
  case applies instead of implying OMP has no choices.
- The settings-surface receipt's "contract limitation" paragraph is corrected in place, because
  it recorded the wrong owner of the gap.

## Verification (runtime, not source inspection)

```
bun scripts/prepare-omp-runtime.ts              # pinned source + patch applied, dev runtime
bun scripts/prepare-omp-runtime.ts --standalone # the runtime the packaged app ships
bun test packages/omp-adapter/test/cedia-capabilities.test.ts   # 10 pass, against dist/omp/omp
CEDIA_OMP_BINARY=/Users/pond/cedia/dist/omp-standalone/omp \
  bun test packages/omp-adapter/test/cedia-capabilities.test.ts # 10 pass, against the packaged runtime
bun run check:omp-coverage                      # Integrity PASS, live omp/18.1.18, 498 settings
bun test apps/macos/agent-window/test           # 130 pass, 0 fail
(cd apps/macos/agent-window && bun test)        # 145 pass, 0 fail - this is what runs the vendor tree
                                                # (the panel logic test lives under vendor/, so the
                                                #  root-level path alone would not execute it)
bun test apps/host/test/omp-settings.test.ts    # 12 pass, 0 fail
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                                                # 1103 pass, 0 fail
```

The adapter test asserts against the live runtime that enum rows publish their values,
`power.sleepPrevention` among them, that a non-enum row publishes none, and that no list repeats
a value. It was run against both prepared runtimes and passed both times. The host test pins the
protocol half: a well-formed list is carried, and a duplicated, empty, non-string or
empty-string entry is refused. `dist/omp/runtime.json` and `dist/omp-standalone/runtime.json`
both attest the new patch sha, and the standalone binary answers `omp/18.1.18`.

## Not done here

- The write-timing classification §6.4 asks for is still open: OMP's schema declares a type and
  a default, but not when a changed value reaches a running session. The panel still tells the
  owner the honest thing it knows ("a change may reach a running session after reload or in a new
  task") rather than guessing a per-key policy.
- No packaged window has been observed rendering the select; this run proves the runtime data and
  the renderer logic, not a packaged paint.
