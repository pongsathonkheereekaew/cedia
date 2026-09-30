# No second version of the temporary model change — 2026-09-25

This receipt records a decision slice with no gap change. §10 item 70 left O03's
`setModelTemporary` open as "an application path Cedia has not decided to own a second
version of". The investigation below decides it: no second version is needed, because
every Cedia model change already is the temporary kind. The row stays open only for
the mechanical reason that the coverage gate forbids crediting one audited command to
two SDK rows. §10 item 70 owns status. No provider request was made.

## What was established

- The runtime's rpc-ui `set_model` handler calls `session.setModel` with no persist
  option (`upstream/omp/packages/coding-agent/src/modes/rpc/rpc-mode.ts`): persisted
  settings are untouched, exactly as the `setModelTemporary` contract promises ("for
  this session only ... NOT to settings", `session/model-controls.ts`). The remaining
  deltas - the session-log role string and the explicit thinking-level argument - are
  below the operation's observable contract.
- Cedia has no model settings-write path at all: the adapter sends `set_model` for
  picker changes (`apps/macos/agent-window/src/cedia-adapter.ts`, pinned by
  `apps/macos/agent-window/test/adapter.test.ts`), and `model.roles.set` stays
  unregistered. Every model change Cedia performs is therefore session-scoped.
- A settlement link `{ name: "setModelTemporary", rpcCommand: "set_model" }` was
  built and then reverted in this slice: it flips the row to integrated and the gate
  stays PASS, but `scripts/lib/omp-coverage.test.ts` deliberately forbids it - "one
  entry cannot quietly stand in for two operations" and "the same command cannot be
  credited twice". Weakening those tests to keep the row green would be exactly the
  reclassification the gate exists to prevent, so the link was removed and the row
  stays a gap by rule, not by missing behavior.

## Decision

Cedia will not own a second version of the temporary model change, and will not add
a redundant `model.set-temporary` operation when `set_model` already performs it (a
duplicate bridge would be the fake capability §5 forbids). The `setModelTemporary`
gap row now means one precise thing: the gate's one-command-one-operation invariant
reserves `set_model` for the `setModel` row. If that invariant is ever relaxed by
owner decision, the reverted link above is the settlement, with the adapter test and
the rpc-mode handler as its proof.

`applyRoleModel` is unaffected by this decision and stays open: applying a resolved
role model has no Cedia path at all (role assignment itself is unbuilt), so unlike
the temporary change there is no performed operation to document.

## Evidence (this revision and build)

- `bun run check:omp-coverage`: integrity PASS, gap count **40** (unchanged).
- `bun test scripts/lib`: 84 pass / 0 fail (the uniqueness invariants hold).
- `git diff --check`: clean.
