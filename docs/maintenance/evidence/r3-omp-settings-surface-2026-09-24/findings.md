# O04 rendered settings surface: the owner can read and write OMP settings from Cedia — 2026-09-24

This receipt records the rendered half of §8.2's O04 packet: the inventory and the write route
already existed on the host, and this slice puts them on screen with Cedia's per-key
disposition, a revision-checked write and an honest contract limitation. §10 item 70 owns
status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- `apps/macos/agent-window/src/cedia-adapter.ts`,
  `vendor/synara/apps/web/src/lib/ompSettingsReactQuery.ts`,
  `vendor/synara/apps/web/src/components/settings/OmpSettingsPanel.tsx`,
  `.../OmpSettingsPanel.logic.ts`, `vendor/synara/apps/web/src/routes/_chat.settings.tsx`,
  `settingsNavigation.ts`, `settingsSearchIndex.ts`, and their tests.

## What changed

- The Cedia adapter gains three thin host requests: `getOmpSettingsKeys()`,
  `getOmpSettingValue(path)` and `setOmpSetting({ path, value, expectedRevision })`, using the
  existing `/v1/omp/settings/keys`, `/v1/omp/settings/value?path=…` and `PATCH /v1/omp/settings`
  routes the host already owned. The main process allows the `omp` root and strips the query
  string before the route allowlist, which is what makes the value read reachable at all.
- The panel renders the host inventory grouped by the runtime's own tab label with one explicit
  `Other` group, filtered by path and tab. It does not prefetch 498 values: a row reads its
  value when it scrolls into view (`IntersectionObserver`) with a visible `Load value`
  fallback, so the page costs what the owner looks at.
- Every schema path keeps Cedia's disposition from the host, with its reason: `editable` rows
  are editable, and `protected`, `advanced` and `excluded` rows explain why they are not.
  Redacted and too-large values are formatted as such instead of being shown as content.
- A write sends the revision the row was read at. A stale revision is answered with the
  conflict branch and a `Refresh and retry` action that re-reads before retrying, so a value
  that moved underneath the row is never silently overwritten. Success is shown only after the
  renderer has read the effective value back, and "the write was accepted but the readback
  failed" is its own message rather than a success.
- The destination is mounted in Settings with a navigation entry and a search entry, so it is
  reachable the way every other settings section is.

## Contract limitation (recorded, not hidden)

OMP's settings inventory exposes a key's `type` but no allowed-value metadata. The panel
therefore renders an `enum` key as a text input validated by the runtime's own schema and
reports the runtime's refusal, rather than inventing a value list. Closing this needs the
runtime's schema to publish its options; no option list is fabricated in the meantime.

**Correction, same day.** That owner was wrong: OMP's schema does declare an enum's values, and
Cedia's own runtime bridge dropped them, not OMP. The bridge now projects
`getEnumValues(path)` and the panel renders a real `select`; see
[the enum-values receipt](../r3-omp-settings-enum-values-2026-09-24/findings.md). The paragraph
above is kept as the record of what was believed when this receipt was written.

## Verification

```
bun test apps/macos/agent-window/test 2>&1 | tail -4          # 130 pass, 0 fail
bun test apps/macos/test apps/host                            # included in the 1102 below
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                                                              # 1102 pass, 0 fail
bun run --cwd apps/macos/agent-window typecheck               # clean (includes the vendor tree)
bun run build:agent                                           # Vite renderer + main.cjs built; assets written to dist/agent-window
bun run typecheck                                             # same 10 pre-existing errors, none new
git diff --check                                              # clean
```

The adapter test asserts the exact request each method makes, including the encoded key on the
value read and the `expectedRevision` in the PATCH body. The panel's pure logic is covered
separately (grouping, filtering, value formatting, input parsing).

## Not done here

- This was rendered in a source build and through the isolated typecheck. No packaged Cedia
  window has been observed rendering the panel, and no packaged write has been made; the host
  routes were exercised live by the earlier O04 receipt against a prepared runtime.
- The per-key write-timing classification §6.4 asks for (immediate, turn boundary, reload, new
  session) is not in the panel. It is the remaining half of O04 named in §10 item 70.
