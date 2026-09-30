# Fix (capability pin test catches up with five slices' operations)

The certification sweep caught `cedia-capabilities.test.ts` red: the prepared
runtime advertises 69 available operations while the test pinned 53. Five landed
slices each registered bridge ops and re-prepared the runtime without updating the
pin (`btw` x3, `cleanse` x3, `extensions` x2, `loop` x2, `model.roles.apply`,
`tools.codemode.get`, `omfg` x4) — none of them runs the omp-adapter suite, so the
staleness went unnoticed.

## What was done

- Extended the expected available-ID list to the runtime's actual 69, in table order.
- Encoded the smallest honest probe per new op, verified live first: pure reads run
  with `{}` (`btw/cleanse/omfg state`, `extensions.list`, `tools.codemode.get`,
  `loop.state`); `loop.set` disables while off (idempotent answer, never an error);
  `cleanse.abort`/`omfg.abort` answer idle state; `cleanse.run` dispatches a real
  checker batch fire-and-forget like the terminal overlay (returns `running` at
  once; the isolated dir contains it); validation/refusal paths assert exact
  messages (`omfg.draft` needs a complaint, `omfg.save` needs a scope,
  `model.roles.apply` needs a role, `btw.ask` with a question refuses on no model,
  `btw.branch` with nothing held, `extensions.set` on an unknown id).
- No product code changed: the runtime, bridges and gate were already right; only
  the pin was stale.

## Proof

- `bun test packages/omp-adapter/test/cedia-capabilities.test.ts`: 10 pass, 0 fail
  (1438 expects, every available op executed).
- Full sweep below stays green.

## Still open

- Nothing from this fix. The 18 gate gaps are untouched by design.
