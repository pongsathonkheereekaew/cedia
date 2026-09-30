# Spending a saved reset is the owner's own confirmed action — 2026-09-24

This receipt records the O03 saved-reset slice, the other half of the credit rule. The policy layer
from `o03-credit-policy-guard` stops OMP from spending on its own; this one makes the owner's own
deliberate spend possible, and only that. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice: manifest sha
  `03a9aa18a2cc472ef5db706248c50f843e7f99b41a8ea7659398263e96a062cc`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`).
- Runtime: new `packages/coding-agent/src/modes/rpc/cedia-credits-bridge.ts`; changed
  `.../rpc/{cedia-capability-bridge,rpc-mode,rpc-types}.ts`, new
  `test/cedia-credits-bridge.test.ts`, changed `test/cedia-capability-bridge.test.ts`.
- Cedia: new `apps/host/src/omp-credits.ts`, `apps/host/test/omp-credits.test.ts`; changed
  `apps/host/src/{service,router}.ts`, `apps/host/test/fixtures/fake-host.mjs`,
  `apps/macos/agent-window/src/cedia-adapter.ts`, vendor `lib/serverReactQuery.ts`,
  `components/chat/CediaUsageSurface.tsx`, `apps/macos/agent-window/test/cedia-usage*.test.*`,
  `packages/omp-adapter/test/cedia-capabilities.test.ts`,
  `scripts/{omp-capabilities-smoke,lib/omp-coverage,check-omp-coverage}.ts`.

## What changed

- **The listing is OMP's, and a failure is not zero.** `credits.get` answers each stored account -
  identifier, email, live `availableCount`, each credit's id/status/expiry/title, whether it is the
  session's active account, and the account's own `error` when its token refresh or listing failed.
  A whole-listing failure keeps the runtime's message in `unavailable`; neither case is flattened
  into "no credits". Accounts and credits per account are bounded.
- **The spend carries its confirmation on the wire.** `credits.redeem` requires a payload that names
  exactly one account (`credentialId`, `accountId` or `email`) *and* sets `confirm: true`. A payload
  without the flag, without an account, with two identifiers, with an unknown field or with the
  wrong type is refused before any provider call, so "explicitly confirmed" is a property of the
  request rather than a convention a user interface follows. The answer is OMP's own outcome
  (`ok`, `code`, account, credit) and is never translated: only `code: "reset"` means a credit was
  spent, and the other codes (`already_redeemed`, `no_credit`, `nothing_to_reset`, `no_account`,
  `credit_list_failed`, …) are shown as what they are.
- **The manual path stays outside the automatic guard, and a test says so.** The policy layer
  (`cedia-policy.ts`) turns off OMP's blocked-account pass and expiring-credit sweep for a process
  Cedia started; `cedia-credits-bridge.ts` must not consult it, or a guarded session could never
  redeem what its owner deliberately asked for. A focused test asserts the bridge imports nothing
  from the policy module and never calls its decision function, so a later edit cannot quietly gate
  the manual path.
- **The host route is the owner's, and the UI asks twice.** `GET /v1/sessions/:id/credits` reads on
  demand (never at startup or on activity); `POST /v1/sessions/:id/credits/redeem` takes exactly
  `{ commandId, incarnation, target }` through the durable command envelope - claim-before-dispatch,
  replay answers the same receipt and cannot spend twice - and adds `confirm: true` when it forwards,
  because the owner's authenticated, UI-confirmed request *is* the confirmation. The Usage panel
  offers `Redeem` only for an account with credits, requires a second confirmation that names the
  account and the reset window it will spend, renders each outcome code in words, and has no
  automatic path anywhere.

## Evidence (this revision and build)

- `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` → **1264 pass,
  0 fail** (149 files); `bun test apps/macos/agent-window/test` → 248 pass; `bun test apps/host` →
  341 pass; `bun run --cwd apps/macos/agent-window typecheck` → exit 0; `bun run typecheck` → the 10
  pre-existing errors, none in a file this slice touched.
- `cd upstream/omp && bun test packages/coding-agent/test/cedia-credits-bridge.test.ts` → 6 pass:
  the listing's counts and expiries, an account's own error kept, a failed listing keeping its
  message, the bounds, the untranslated outcome, and the "manual path is not gated" assertion.
- `packages/coding-agent/test/cedia-capability-bridge.test.ts` → 22 pass, including the redeem's
  refusals (no confirmation, no account, two accounts) and that a confirmed request reaches the
  handler with the account.
- `bun scripts/omp-capabilities-smoke.ts` → every check OK; the available table lists 33
  descriptors, and the adapter's probe runs `credits.get` and a `credits.redeem` whose target names
  an account this runtime does not store - the payload rule is what is under test, and a target that
  cannot resolve must not spend anything.
- `bun run check:omp-coverage` → integrity PASS, **100 → 98** records without a disposition
  (`listResetCredits` and `redeemResetCredit` settle through the registered operations).
- `node scripts/ci-validate.mjs` → CI-OK; `git diff --check` clean.

## Limits

- No real credit was spent: no live account was queried and no provider redeem ran. The runtime's
  own outcome codes are proven at the boundary, and the one live claim this slice makes is that the
  operation exists with its confirmation rule - a real redeem needs its own authorized run and a
  release-qualification note.
- O03 still owes the OAuth account selection (`listCurrentProviderOAuthAccounts`,
  `pinCurrentProviderOAuthAccount`) and `setServiceTierFamily`, plus the remaining effort/model
  reads. The gate's "one audited command, one SDK operation" question stays open for those.
- No packaged window was captured rendering the credits rows or the confirmation.
