# Cedia never spends a saved reset on its own — 2026-09-24

This receipt records the O03 product-invariant slice: the policy layer §2.8 requires before any
provider/usage operation can be called integrated. OMP can spend a saved Codex rate-limit reset by
itself — `codexResets.autoRedeem = "yes"` lets a usage fetch trigger a redemption, and `"unset"`
asks once and persists the answer — and Cedia's rule is narrower. A process Cedia started now
refuses both the automatic and the prompted paths, reports the stored value, the effective value and
the reason, and never rewrites the owner's shared configuration. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice: manifest sha
  `60bd9328850c3c93d765ad63473c2e8057960ad51a048aa39f5dadf6d1513585`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`).
- Runtime (under `upstream/omp/packages/coding-agent/`): new `src/session/cedia-policy.ts`; changed
  `src/session/agent-session.ts` and `src/modes/rpc/{cedia-capability-bridge,rpc-mode}.ts`; new
  `test/cedia-credit-policy.test.ts`, changed `test/cedia-capability-bridge.test.ts`.
- Cedia: new `apps/host/src/omp-policy.ts`, `apps/host/test/omp-policy.test.ts`,
  `scripts/omp-credit-guard-smoke.ts`; changed `apps/host/src/{service,router,server}.ts`,
  `packages/omp-adapter/test/cedia-capabilities.test.ts`, `scripts/omp-capabilities-smoke.ts`, and on
  the window side `apps/macos/agent-window/src/cedia-adapter.ts`, vendor `lib/serverReactQuery.ts`,
  vendor `components/settings/OmpSettingsPanel.tsx`, new
  `apps/macos/agent-window/test/omp-policy-surface.test.tsx`.

## What changed

- **The rule is applied where the spend decision is made.** `readCediaCreditPolicy` answers whether
  this process carries Cedia's flag (`CEDIA_POLICY_CREDIT_GUARD=1`), and `effectiveCodexAutoRedeem`
  answers the mode the session acts on: the stored `"yes"` and `"unset"` become `"no"` with
  `overridden: true`, an owner's own `"no"` stays theirs with `overridden: false`. The session reads
  that effective value at every decision point - the planner's `enabled`, the blocked pass's cheap
  exit (and its prompt), the usage-fetch sweep (and its prompt) - and the prompt path returns before
  any UI, so a guarded session asks nothing and persists nothing. Nothing writes
  `codexResets.autoRedeem`; the layer overrides the effect, which is what leaves a terminal using the
  same files untouched.
- **The rule travels with the process, not the setting.** The Cedia host sets
  `CEDIA_POLICY_CREDIT_GUARD=1` on every runtime it spawns, so "Cedia-controlled" is a property of
  the process. A runtime someone else started does not carry it and keeps stock OMP behaviour, which
  is the distinction §2.8 needs for an unguarded live owner.
- **It is readable, not hidden.** The runtime registers `policy.get` (O03, device scope, owner
  principal) answering `{ guardActive, stored, effective, overridden, reason }` from the session's
  own policy instance, and the host publishes it at owner-only `GET /v1/omp/policy` with the usual
  `available` / `unavailable`-with-a-reason answer. A malformed answer is refused rather than
  rendered, and a runtime without the bridge is an honest absence instead of an assumed guard.
- **The settings destination says it in words.** A read-only "Credit redemption policy" block leads
  the OMP settings panel: it shows the stored mode, the mode this process applies, and which of the
  three cases it is - Cedia's guard overriding the stored value, Cedia agreeing with a stored `no`,
  or no guard at all on a process Cedia did not start - always with the runtime's own reason. An
  unavailable answer renders the host's reason only, and there is deliberately no control here: the
  block explains a policy, it does not write one. The existing editable inventory is untouched, and
  a write to `codexResets.autoRedeem` from it invalidates the policy read so stored and effective
  cannot drift apart on screen.

## Evidence (this revision and build)

- `bun scripts/omp-credit-guard-smoke.ts` → 16 `OK` lines against the prepared `omp/18.1.18`, with
  no provider request leaving the machine: an unguarded runtime reports no guard and its stored value
  standing; a guarded runtime reports the guard active, overrides `unset` to `no`, reads back a
  deliberately written `yes` unchanged while reporting `effective: "no"` with its reason; and the
  runtime the *host* started answers `guardActive: true` through `GET /v1/omp/policy`, which is the
  owner-only route. Final `{"ok":true,"version":"omp/18.1.18"}`.
- `cd upstream/omp && bun test packages/coding-agent/test/cedia-credit-policy.test.ts` → 5 pass,
  0 fail. The fixtures include the pair that makes the guard meaningful: the same blocked-account
  snapshot plans one action under the unguarded effective value and zero under the guarded one, and a
  source check pins the effective value at all three session call sites plus the early return in the
  prompt path.
- `bun test apps/host packages/omp-adapter` → 383 pass, 0 fail (6 of them this slice's route and
  parser tests).
- `bun test apps/macos/agent-window/test` → 215 pass, 0 fail, including the policy block's own
  fixture for all four states; `bun run --cwd apps/macos/agent-window typecheck` → exit 0.
- `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` → 1232 pass,
  0 fail (144 files).
- `bun scripts/omp-capabilities-smoke.ts` → every check OK; the available table now lists 24
  descriptors including `policy.get`.
- `bun run typecheck` → the same 10 pre-existing errors as before this slice, none in a file this
  slice touched.

## Limits

- No real credit was redeemed or refused by a provider: the guard is proven at the decision points
  (the planner and the session's own entry conditions) and by the live policy read, not by a live
  Codex account. A real entitlement/read-only smoke is still required before any provider-account
  operation is called enabled (§8.2 O03).
- The explicit owner-confirmed redemption control does not exist yet: `/usage reset` in a terminal
  still redeems deliberately, and Cedia's own one-action redeem remains O03 work.
- An unguarded live owner (a CLI session Cedia did not start) is reported as unguarded, but the
  inspect-only attachment rule that §2.8 attaches to it is O08 work.
