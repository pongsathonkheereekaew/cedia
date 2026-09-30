# Slice (O10 relay precedence: the silent steering loss, now loud)

OMP resolves `browser.relay` before `browser.cdpUrl`: with relay on, an attached
endpoint sits idle while driving goes to the user's Chrome — and nothing in the
attach flow said so. The personal profile keeps relay off by default (verified
read-only earlier), so this is a guard for a user-changed setting, not a live fire.

## What was built (renderer only, no host/runtime change)

- Pure `steeringConflictWarning` (pinned by tests: warns only on boolean `true`).
- The attach bar reads `browser.relay` on every refresh and renders the warning
  inline when on; the attach confirm carries the warning as a preamble. Declined
  confirms still do nothing; settings-bridge failures resolve to no warning, never an
  error state.
- 2 new tests green (6 in the file); slice files typecheck-clean.

## Coverage consequence

None by design: no OMP action, no row change. The steering story now names all three
precedence levels honestly (relay beats endpoint beats launch), and the one silent
loss is loud.

## Addendum: disabled-prelude loss covered the same way

`browser.enabled === false` is the second silent loss in the same family: OMP never
calls any browser backend, so an attached endpoint waits for no one. The bar now reads
both `browser.relay` and `browser.enabled` per refresh, renders each warning inline,
and prepends them to the attach confirm. Pure `browserDisabledWarning` pinned (warns
only on boolean `false`); 1 test added. No host/runtime change, no gap change.
