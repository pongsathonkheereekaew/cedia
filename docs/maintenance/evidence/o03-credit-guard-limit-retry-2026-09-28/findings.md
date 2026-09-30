# O03 guarded limit-retry decision — 2026-09-28

## Result

Added a focused regression for the CEDIA credit guard at OMP's live 429 / limit-retry decision
point. The existing adjacent test is the positive control: an unguarded session with the same
spendable fixture redeems one mock reset and retries successfully. The guarded test inherits
`codexResets.autoRedeem=yes`, receives a simulated 429 with one available reset, and proves:

- the policy snapshot remains `guardActive: true`, `stored: yes`, `effective: no`,
  `overridden: true`;
- the failed turn makes exactly one model stream call, so no hidden retry follows the 429;
- no usage refresh or live-credit listing is attempted by the blocked pass;
- the mock redemption method is never called, and no attempt or in-flight key is left behind.

All provider seams are local spies and the model error is a fixture. No provider network request,
real credit, purchase, or top-up occurred. The previously recorded usage/reconnect proof remains
separate and was rerun against the refreshed runtime. The host fixture has no provider account.

## Revision and verification

- Pinned OMP: `omp/18.1.18`, revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`.
- Prepared source tree: `44f96f536568fd5c34444af5a303ae53b856d423`.
- Consolidated patch SHA-256: `61a85e5664cc6cbb8b89c59eca862caae223dbc3089882ab3b0f5e05007758c9`.
- Patch manifest SHA-256: `1055e14a3e4cfd3c92fa844eecb597a9e0ae1b16bf0d354cd436a900fd8a024e`.
- `cd upstream/omp && bun test packages/coding-agent/test/codex-auto-reset-integration.test.ts`:
  6 passed, 0 failed (including unguarded 429 recovery, guarded 429 refusal, and usage-sweep control).
- `bun scripts/prepare-omp-runtime.ts`: passed; rebuilt the development launcher for the pinned
  source tree.
- `attestOmpRuntime`: `sourceVerified: true`, runtime kind `development-source-launcher`, source tree
  `44f96f536568fd5c34444af5a303ae53b856d423`.
- `bun scripts/omp-credit-guard-smoke.ts`: passed all checks against `omp/18.1.18`, including the
  owner usage read before and after host reconnect and stored-setting readback.
- `git diff --check`: passed.

## Limits

This closes only the fixture-backed 429 guard regression. It does not qualify real provider
entitlement behavior, runtime reload, externally owned CLI attachment, or full O03/F acceptance.
The pinned runtime capability table still marks live CLI attach as `integration_missing`; no external
CLI process was attached or controlled. Existing CEDIA attachment remains inspect-only by design.
No packaged app, Keychain, Login Item, relay, signing, or device action was used.
