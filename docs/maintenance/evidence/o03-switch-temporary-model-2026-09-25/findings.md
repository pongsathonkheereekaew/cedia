# Slice (O03 session-only model switch): `setModelTemporary` carried by `/switch`

No new runtime, host or window code. The audited SDK operation `setModelTemporary` has no
audited RPC command and no registered `cedia_control` operation, but the reachable `/switch`
command's with-args form performs exactly that method: `builtin-modes.ts` (`Switch model
for this session`) resolves the selector and calls
`await runtime.session.setModelTemporary(resolved.model, resolved.thinkingLevel)`.
The composer already sends reachable slash text over the prompt path, so the command is
the carrier — the same rule that settled `armPrewalk` (via `/prewalk`),
`getAsyncJobSnapshot` (via `/jobs`) and `refreshMCPTools` (via `/mcp reload`).
The bare form only reports the current model; the with-args form is the named carrier.

Unlike the earlier dispatch-only proofs, this one observes the effect: the smoke fixture
grows a second model, sends `/switch slash-second-fixture-model`, and asserts `get_state`
reports the second model afterwards — with `agentInvoked: false`, zero provider requests
and no started turn. The run's frames even carry `model_changed`, so the temporary switch
observably happened without a turn.

`applyRoleModel` (the other O03 SDK gap) stays open honestly: its only callers are the TUI
model selector's role picks and plan-execution model application in interactive mode, and
no reachable slash performs it. `/switch @role` resolves through `setModelTemporary`,
not through role application, so it is not a carrier for that row.

## Changes

- `scripts/lib/omp-coverage.ts`: new `OMP_SDK_VIA_SLASH` row
  `{ name: "setModelTemporary", slash: "switch" }` with a comment naming the with-args
  carrier. The existing verifier re-checks every run (audited SDK name +
  audit-reachable slash + adapter still sends `prompt`).
- `scripts/omp-slash-smoke.ts`: second fixture model, `/switch
  slash-second-fixture-model` candidate, and a `switch-carrier-took-effect` check asserting
  `get_state` reports the switched model.

## Proof (pinned runtime 18.1.18, provider-free)

- `bun scripts/omp-slash-smoke.ts`: all ten candidates `agentInvoked: false`, zero provider
  requests, no turn; `get_state` confirms the switch took effect.
- `bun run check:omp-coverage`: integrity PASS, gap count **36** (was 37), O03 sdk 1 (was 2).
- `bun test scripts/lib` (84 pass).

## Still open in O03

`applyRoleModel` (TUI-only callers, no reachable carrier — a Cedia role-application surface
would be a new feature, not a carrier claim).
