# The model's own effort, the provider's accounts, and the tier — 2026-09-24

This receipt records the O03 slice that finishes the packet's remaining state: the effort the runtime
is actually configured with and what it auto-resolved, the provider's own OAuth accounts, and the
service tier. All four come from the runtime's own session methods through registered `cedia_control`
operations, reach the window through owner/controller routes, and are shown where the owner already
works (the model picker and provider settings). §10 item 70 owns status; this file records what was
observed at the revision below. No provider request was made and no model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`
  with this slice applied. The tree is deliberately dirty (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. `patches/omp/0001-cedia-rpc-bridges.patch` is 772,041 bytes with
  sha256 `ece9d930307522af8153be0f572bd09d0e64566e11ed48f6fa1465dda9c419b2`, recorded in
  `patches/omp/manifest.json`; `bun scripts/refresh-omp-patch.ts` wrote the patch and the manifest
  hash together and `bun scripts/prepare-omp-runtime.ts` re-prepared `dist/omp/omp`, re-attesting
  that the source tree is exactly the pinned revision plus that patch.
- Changed for this slice: `upstream/omp` `cedia-capability-bridge.ts`, `rpc-mode.ts`,
  `test/cedia-model-state-bridge.test.ts` (new), `test/cedia-capability-bridge.test.ts`;
  `packages/omp-adapter/test/cedia-capabilities.test.ts`; `apps/host/src/omp-model-state.ts` (new),
  `apps/host/src/{service,router}.ts`, `apps/host/test/omp-model-state.test.ts` (new),
  `apps/host/test/fixtures/fake-host.mjs`; `apps/macos/agent-window/src/cedia-adapter.ts`,
  `.../lib/serverReactQuery.ts`, `.../components/CediaRuntimeModelState.tsx` (new),
  `.../components/CediaRuntimeProviderState.tsx` (new), `.../components/settings/ProvidersSettingsPanel.tsx`,
  `.../components/settings/OmpProviderSettingsPanel.tsx`, the picker's runtime-state notice in
  `.../components/chat/`, and their tests; `scripts/lib/omp-coverage.ts`,
  `scripts/check-omp-coverage.ts`; `scripts/omp-model-state-smoke.ts` (new).

## What changed

- **Four runtime operations**, each delegating to the session's own method (plan §2.8):
  - `model.state.get` answers the live selection: the current model as `{provider, id} | null`, the
    effort state (`configured` from `configuredThinkingLevel()`, `autoResolved` from
    `autoResolvedThinkingLevel()`, `isAuto` from `isAutoThinking`), and the per-family service tiers
    from `serviceTierByFamily` **together with the families and tiers the runtime itself accepts**,
    so a client can only offer real choices. A value the runtime does not have is `null`.
  - `model.service-tier.set` validates `{family, tier}` against the runtime's own unions (unknown
    family, unknown tier, unknown key refused before any handler runs) and runs the session's own
    `setServiceTierFamily(family, tier ?? undefined)`, answering the state that follows.
  - `auth.accounts.list` runs `listCurrentProviderOAuthAccounts()`; `undefined` from the runtime is
    reported as `supported: false`, never as an empty success, and each account row carries only
    identity and state (credential id, label, active). No token or raw credential is in the answer,
    and the list is bounded with an explicit `truncated` flag.
  - `auth.account.pin` validates `{credentialId}` and runs `pinCurrentProviderOAuthAccount`; a
    runtime `false` is answered as `pinned: false` with the refreshed list rather than as success.
- **Host routes**: controller-visible `GET /v1/sessions/:id/model-state` (the picker exists on every
  client), owner-only `GET /v1/sessions/:id/accounts`, and owner-only durable/idempotent
  `POST .../accounts/pin` and `POST .../service-tier` through the existing command envelope. Each
  read answers `{available: true, ...}` or `{available: false, reason}`; a runtime refusal is the
  runtime's own answer, and a malformed runtime answer is a typed host failure rather than a coerced
  value.
- **The window**: the picker area shows the runtime's configured effort beside what an `auto` effort
  actually resolved to (and says "unknown" rather than guessing); the provider settings destination
  gained an Accounts section (identity, which account is in use, a `Pin` action, the host's reason
  when unavailable, `supported: false` rendered as "this provider has no account list") and a
  Service tiers control that offers only the families and tiers the runtime published, shows the
  current value including "no override", and lets the owner set or clear it. The settings destination
  resolves the focused task's session id from the shell's own store, so an owner with a task open sees
  that task's real accounts and tiers; the placeholder remains only for a window with no task.
- **Coverage settlement** (6 audited records, measured by the gate): `configuredThinkingLevel` and
  `autoResolvedThinkingLevel` through `model.state.get`, `setServiceTierFamily` through
  `model.service-tier.set`, `listCurrentProviderOAuthAccounts` through `auth.accounts.list`,
  `pinCurrentProviderOAuthAccount` through `auth.account.pin`, and `cycleModel` through a new
  source-verified slash link (`/model` is reachable over the prompt path and the composer sends
  reachable slash commands as text).
- **A contract mismatch found in integration and fixed**: the host first answered the two reads with
  the bare projection (the convention of some older host modules) while the window's parsers required
  the explicit `available` marker the frozen contract specified. The host now wraps both reads with
  `asAvailableAnswer`, its fixture test asserts the wire shape, and the live smoke confirms it; a
  missing wrapper would have made the picker and the accounts section unable to read a real host.

## Evidence (this revision and build)

| Command | Result |
|---|---|
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1283 pass, 0 fail, 7561 expect() calls, 151 files (was 1275 pass) |
| `bun test apps/macos/agent-window/test` | 269 pass, 0 fail, 896 expect() calls, 57 files (was 258 pass) |
| `bun test apps/host` | 356 pass, 0 fail, 1901 expect() calls, 43 files (was 348 pass) |
| `cd upstream/omp/packages/coding-agent && bun test test/cedia-model-state-bridge.test.ts` | 7 pass, 0 fail |
| `cd upstream/omp/packages/coding-agent && bun test test/cedia-capability-bridge.test.ts` | 23 pass, 0 fail |
| `cd upstream/omp/packages/coding-agent && bun run check:types` | exit 0 |
| `bun scripts/omp-model-state-smoke.ts` | 20 checks OK against the prepared `omp/18.1.18` |
| `bun scripts/omp-history-smoke.ts` | 20 checks OK (the previous slice's runtime proof still holds at this revision) |
| `bun run check:omp-coverage` | 1041 audited records, 1041 Cedia mappings; live runtime 41 capability descriptors (was 37); integrity PASS, 0 fatal issues; **82 records without an available Cedia disposition (was 88)** |
| `bun run typecheck` | 10 errors, the pre-existing `apps/macos` set recorded since `0676dd70d54`; none in this slice's files |
| `bun run build:agent` | `Agent Window assets written to dist/agent-window` (the new picker/settings components build) |
| `node scripts/ci-validate.mjs` | `CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=470 md=188 evidence=164` |
| `git diff --check` | clean |

The model-state smoke runs the pinned launcher rather than a mock. It proved the runtime answers its
own model/effort/tier state and publishes the vocabulary it accepts (`openai`, `anthropic`, `google`;
`auto`, `default`, `flex`, `scale`, `priority`), that a family outside that vocabulary is refused
before any handler runs, that an unknown credential id is answered as `pinned: false` with the
refreshed list, that an unsupported provider is reported as unsupported rather than as an empty list,
and - through the host - that a paired controller may read the model state but is refused (403) the
account list, that a tier that is neither a string nor `null` is refused (400), that a repeated
command id replays the same receipt, and that the owner's tier choice is applied and then cleared
through the runtime's own vocabulary. Its model endpoint is a listener that never answers, so no
provider request can complete in this run.

## Limits and what is not claimed

- O03 has two records left, and they are left as gaps with their reasons rather than reclassified:
  `applyRoleModel` (OMP's picker applying a role's model; Cedia's picker resolves a concrete model and
  sends it) and `setModelTemporary` (OMP's own application of a queued transition inside its drain
  path). Settling either needs a real decision about whether Cedia owns a second application path.
- No real OAuth account was listed or pinned and no provider was signed in: the prepared fixture
  runtime reports `supported: true` with no stored accounts, so the refusal path is live-proven and
  the accepted path is proven by fixtures (`apps/host/test/omp-model-state.test.ts`,
  `packages/coding-agent/test/cedia-model-state-bridge.test.ts`).
- The service-tier control changes the runtime's own live tier state for the families the runtime
  publishes. The smoke sets a tier and clears it again inside a throwaway agent directory; no
  provider request follows it in this run.
- No packaged window was captured rendering the picker's effort line, the Accounts section or the
  Service tiers control; the settings destination's task resolution is proven by tests, not by a
  rendered run.
- F is not claimed, and this slice closes no D/W/N checkpoint: it removes 6 of the 82 remaining audit
  gaps and leaves the packaged and remote scenarios to their own gates.
