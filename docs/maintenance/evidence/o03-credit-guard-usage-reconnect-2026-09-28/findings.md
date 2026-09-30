# O03 credit guard across usage and reconnect — 2026-09-28

## Result

The existing smoke proved that a CEDIA-owned OMP process reports the credit guard and leaves the stored `codexResets.autoRedeem=yes` unchanged. This follow-up exercised the missing read path and restart boundary with isolated fixtures.

- The host's owner `GET /v1/sessions/:id/usage` answered in a guarded runtime with stored `yes` and effective `no`. After the host closed and reopened the same task, the policy stayed guarded, the usage route answered again, and OMP read the same stored `yes`. The fixture profile had no provider account or real reset credit.
- An OMP integration regression supplied a mock report with one spendable, soon-expiring credit. An unguarded control invoked the mock redemption once; a guarded session and a fresh guarded session after reconnection invoked it zero times. Both guarded sessions reported stored `yes`, effective `no`, and no scheduled sweep. No provider network request, real credit, purchase, or top-up occurred.

This proves the guarded usage-fetch and host reconnect cases. It does not prove a real provider's entitlement endpoint, a limit-retry path, reload, or externally owned CLI attachment. CEDIA's attach to an external CLI is still an O08 integration gap; its process does not inherit CEDIA's guard and must remain inspect-only. F remains open.

## Revision and verification

- Pinned OMP: `omp/18.1.18`, revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`.
- Prepared source tree: `cae44db0b8263efdc94eb61431302a166c219136`.
- Consolidated patch SHA-256: `67e0fd912944a283cf16121135ddc443954237bc13492b6d5aaa468b8a562fab`.
- Patch manifest SHA-256: `48a36e49b74611236a184adf02e61f0e0ee3d23f2724c8559cf2207c45e74fad`.
- `bun test packages/coding-agent/test/codex-auto-reset-integration.test.ts` in `upstream/omp`: 5 passed, 0 failed.
- `bun scripts/omp-credit-guard-smoke.ts`: passed before and after runtime preparation, including both owner usage reads and stored-setting readback after reconnect.
- `bun run typecheck`: passed.
- `attestOmpRuntime`: `sourceVerified: true` on the prepared tree above.

The working tree was preserved. No packaged app, Keychain, Login Item, relay, signing, or device action was used.
