# Provider usage is a Cedia surface, and unknown is not zero — 2026-09-24

This receipt records the O03 usage slice: the reports OMP's auth storage fetches are readable from
Cedia, with the plan's rule that an unavailable number reads as unknown rather than as zero, and
with no provider traffic the owner did not ask for. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice: manifest sha
  `32d8758d68608979efa7831c546359c81e5d143ad9f8b874dd08ba7ceeb947aa`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`).
- Runtime: new `packages/coding-agent/src/modes/rpc/cedia-usage-bridge.ts`; changed
  `.../rpc/{cedia-capability-bridge,rpc-mode,rpc-types}.ts`, new
  `test/cedia-usage-bridge.test.ts`, changed `test/cedia-capability-bridge.test.ts`.
- Cedia: new `apps/host/src/omp-usage.ts`, `apps/host/test/omp-usage.test.ts`,
  `apps/macos/agent-window/vendor/synara/apps/web/src/components/chat/CediaUsageSurface.tsx`,
  `apps/macos/agent-window/test/cedia-usage*.test.*`; changed `apps/host/src/{service,router}.ts`,
  `apps/host/test/fixtures/fake-host.mjs`, `apps/macos/agent-window/src/cedia-adapter.ts`, vendor
  `lib/serverReactQuery.ts`, `components/ChatView.tsx`,
  `packages/omp-adapter/test/cedia-capabilities.test.ts`,
  `scripts/{omp-capabilities-smoke,lib/omp-coverage,check-omp-coverage}.ts`.

## What changed

- **Usage stays OMP's snapshot.** `usage.get` calls the session's own `fetchUsageReports()` and
  projects what the auth storage returned: per report the provider, fetch time, each limit's
  identifier, label, scope, window (including `resetsAt`), amount and notes, plus the saved-reset
  count and each credit's expiry when the provider listed them, and the account identity the
  provider itself reported. Reports, limits, credit rows and notes are bounded (20 / 20 / 20 items,
  512 characters per note).
- **Unknown is not zero, and a failure is not an empty list.** An amount field the provider did not
  send stays ABSENT in the projection - `get_state`-style zeroing is exactly what would make a
  client claim "0% used" for a provider that said nothing. A fetch that throws answers
  `{ reports: [], unavailable: <the runtime's own message> }`; an auth storage that cannot report
  usage at all answers `supported: false` with its own reason.
- **The read is on demand.** `GET /v1/sessions/:id/usage` is owner-only, takes no query or body
  field (an unknown query is a typed 400, another method a typed 405), and is never issued at
  startup or on activity: the host wires the client, nothing more. The composer's Usage panel starts
  empty with a `Refresh usage` action that says plainly that refreshing asks the providers, so the
  owner's click is what causes the provider traffic.
- **The panel shows only what arrived.** Each limit renders its own unit and only the numbers the
  runtime sent; an absent one reads as unknown. Reset credits are shown with their expiries and
  there is deliberately no redeem control - redeeming stays the separate owner-confirmed action O03
  still owes. The runtime's own `unavailable` message and a `supported: false` answer are rendered
  beside whatever reports arrived, an unavailable host answer shows its reason with a way to ask
  again, and no percentage or total is invented.

## Evidence (this revision and build)

- `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` → **1257 pass,
  0 fail** (148 files); `bun test apps/macos/agent-window/test` → 242 pass; `bun test apps/host` →
  334 pass; `bun run --cwd apps/macos/agent-window typecheck` → exit 0; `bun run typecheck` → the 10
  pre-existing errors, none in a file this slice touched.
- `cd upstream/omp && bun test packages/coding-agent/test/cedia-usage-bridge.test.ts` → 5 pass:
  units/windows/account identity carried, an unreported amount stays absent, `supported: false` and
  a failed fetch each keep their own message, and every collection is bounded.
- `bun scripts/omp-capabilities-smoke.ts` → every check OK; the available table now lists 31
  descriptors, and the adapter's probe runs `usage.get` with no payload against the prepared
  runtime (its fixture provider has a dead endpoint, so the answer is an honest one).
- `bun run check:omp-coverage` → integrity PASS, **101 → 100** records without a disposition:
  `fetchUsageReports` settles through the registered `usage.get` operation.
- `node scripts/ci-validate.mjs` → CI-OK; `git diff --check` clean.

## Limits

- No real provider account was queried: the live smoke runs against a fixture provider whose
  endpoint is dead, so what is proven live is the plumbing and the honest-failure path. A real
  entitlement/usage read needs its own authorized run (§8.2 O03), and the release qualification
  manifest must record which providers were actually exercised.
- O03 still owes the saved-reset redeem action (owner-only, explicit confirmation), the OAuth account
  selection and `setServiceTierFamily`; `listResetCredits` now has a live path (`usage.get` returns
  the counts the provider reported) but the *list* operation and its account rows are the next
  slice's work, together with the gate question about a snapshot command carrying more than one SDK
  read.
- No packaged window was captured rendering the panel.
