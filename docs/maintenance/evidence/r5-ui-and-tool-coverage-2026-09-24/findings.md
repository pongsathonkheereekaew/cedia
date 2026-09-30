# O05: the UI methods and tools the audit lists now map to Cedia's own code — 2026-09-24

This receipt records the O05 half of the coverage gap: the gate judged extension-UI methods and
tools from literals it kept beside the implementation, and one of those literals was wrong.
§10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22d10eb`, dirty with the open slices.
- Changed: `packages/protocol/src/ui.ts`, `apps/macos/src/state.ts`,
  `scripts/lib/omp-coverage.ts`, `scripts/check-omp-coverage.ts`,
  new `apps/macos/test/omp-ui-methods.test.ts`, new `apps/macos/test/omp-tool-presentation.test.ts`.

## What was wrong

`scripts/check-omp-coverage.ts` decided an extension-UI record from
`new Set(["select", "confirm", "input", "cancel", "notify", "open_url"])`. The audit lists eleven
methods, and Cedia already carried the other five: `editor` through `uiRequestFromEnvelope`,
`setStatus`, `setWidget`, `setTitle` and `set_editor_text` through `presentationFromEnvelope`. The
gate reported five integration gaps that did not exist because its own list had gone stale - the
kind of drift the plan's "the gate reads the implementation" rule is for.

The tool families had the opposite problem: the gate marked all of them `integration_missing` with
"Cedia has no equivalent execution owner", which contradicts the audit's own `cedia_boundary`
block: `omp_owns` includes `tool_registry` and `execution`, and Cedia owns the host and the
surfaces. Cedia is not supposed to own a second tool executor.

## What changed

- `packages/protocol/src/ui.ts` declares the three classes in one table, `UI_METHOD_CLASSES`,
  built from the interactive union and the new `UI_PRESENTATION_METHODS`, plus `cancel` as the
  cancellation class. Adding a member to either union without a class is a compile error, so the
  table cannot drift away from the parsers.
- `apps/macos/src/state.ts#presentationFromEnvelope` now refuses a method the table has not
  classified before it looks at any field, so "is this a presentation" has one answer.
- The gate reads `uiMethodClass` and the tool registries instead of its own literals, and names the
  real handler and presentation for each row.
- `OmpCediaEntry`/`OmpCoverageRowReport` gained an optional `test`, so a coverage row can carry the
  test that proves it (the plan's "test/receipt IDs" requirement for the descriptor table).
- Built-in, hidden and alias tools are `available` through OMP's registry plus Cedia's tool card.
  The six dynamic tools stay `integration_missing`, each naming the packet that must register it:
  browser and computer (O10), MCP and extension tools (O06), image and speech provider surfaces.

## Verification

```
bun test apps/macos/test/omp-ui-methods.test.ts       # 3 pass, 0 fail, 42 expect() calls
bun test apps/macos/test/omp-tool-presentation.test.ts # 4 pass, 0 fail, 240 expect() calls
bun run check:omp-coverage                            # Integrity PASS; 912 gaps (was 950)
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                                                      # 1114 pass, 0 fail
bun run typecheck                                     # same 10 pre-existing errors, none new
git diff --check                                      # clean
```

`omp-ui-methods.test.ts` reads the audit's own eleven rows, asserts `UI_METHOD_CLASSES` equals
them in the same class, then drives each one through the production path: an interactive method
becomes a pending request with its token, a presentation method becomes a bounded presentation row
with its fields, and cancellation clears the request the server-cancel names. It also pins the
documented rule that an unclassified presentation row is not rendered rather than half-parsed.

`omp-tool-presentation.test.ts` reads every audited name - 28 built-ins, 3 hidden controls, 2
aliases and the 6 dynamic shapes - and applies a full `start`/`update`/`end` lifecycle per name,
asserting one card that keeps the name OMP sent, the outcome, and all three raw frames. It also
pins that a failed tool stays failed and that a tool name the audit does not list still reaches a
card, so a new OMP tool cannot be dropped by the renderer (the gate reports it instead).

## Not done here

- The dynamic tools' own subsystems (O10 browser/computer, O06 MCP/extension discovery, the image
  and speech provider surfaces) are untouched; only their presentation seam is proven.
- No packaged window has been observed rendering these cards or presentations; this is the
  reducer and its fixtures, not a packaged paint.
