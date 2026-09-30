# F dynamic provider live smoke — 2026-09-28

## Result

`bun scripts/omp-dynamic-provider-smoke.ts` passed against the one host-backed OMP RPC session.
The smoke starts a temporary trusted fixture extension alongside CEDIA's existing host session
lock extension. Its local `/dynamic-provider add|remove` command registers or unregisters one
fixture provider without invoking an agent turn. The owner reads `get_available_models` from
that same live OMP session after each change.

Observed sequence:

1. `cedia_dynamic_fixture/ephemeral-model` is absent; the baseline fixture model is present.
2. `/dynamic-provider add` first returns the host's durable `acknowledged` admission, then its
   linked `prompt_result` moves that same receipt to `completed` with `agentInvoked: false`.
   The next catalog read contains the new model and retains the baseline row.
3. `/dynamic-provider remove` completes locally; the next catalog read omits the fixture model
   and retains the baseline row.
4. `set_model` for the removed model fails with OMP's `Model not found:
   cedia_dynamic_fixture/ephemeral-model` response.
5. The local loopback provider endpoint received zero requests.

This exercises one extension command and one dynamic provider in one running OMP session. It
does not prove provider/extension/command projection to packaged desktop, remote web, or iPhone
renderers; other §11.1 F semantic cases and full F acceptance remain open. No F gap count or
D/W/N/F checkpoint is reclassified.

## Runtime identity and limits

- Repository revision: `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` (working tree dirty).
- Runtime version: `omp/18.1.18`.
- OMP executable SHA-256: `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`.
- Relevant current source SHA-256 values:
  - `packages/coding-agent/src/modes/rpc/rpc-mode.ts`: `d7c8410ddbe85cbe215e09ba725c4da3bece83b3a091ab71a31c333f9863901e`
  - `packages/coding-agent/src/extensibility/extensions/loader.ts`: `4d97c0a3711d5b3ab8ffd2531d599356ca282cd5739f22ce248e1d8cce927040`
  - `packages/coding-agent/src/extensibility/extensions/runner.ts`: `3cf88291483667bb49e9321e31f705b27ad873cd84689833650f571498d741f1`
- The pre-refresh temporary-index audit compared manifest HEAD-plus-patch tree
  `46a035a378569e81ed55bb065de6f7c858276489` with actual tree
  `1543a4c9ee84f8e3fb195023a47e1082176200ec`; the only delta was the added authorized
  `packages/coding-agent/src/modes/rpc/cedia-goal-bridge.ts` from the O07 restart slice.
  The consolidated patch was refreshed and the pinned development runtime prepared from that
  exact tree. Patch SHA-256:
  `d30b933ad3cd68da09582d43626d7db21da99af34ea7670bd160b8132ea5c469`.
- `attestOmpRuntime(".", "dist/omp/omp")` now passes: runtime kind `development-source-launcher`,
  `sourceVerified: true`, revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, source tree
  `1543a4c9ee84f8e3fb195023a47e1082176200ec`, patch-manifest SHA-256
  `4f9324c38647d37754bee14fc9f7c699807ab5072b37a1bef383110f9dcfed12`, Bun SHA-256
  `35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5`, and native module
  SHA-256 `05774ec09950a150b7c1cce63359bd26ed6d3eecc44a6261e09e9403371e7869`.
- Test configuration used isolated temporary project/profile/state directories, a loopback-only
  endpoint, and no external provider, packaged app, Keychain, or Login Item changes.

## Verification

- `bun scripts/omp-dynamic-provider-smoke.ts` — passed; all assertions above, zero fixture
  provider requests, repeated after patch refresh and runtime preparation with full attestation
  embedded in the result.
- `bun scripts/omp-goal-restart-smoke.ts` — passed both restart cases after the same preparation.
- `bun run typecheck`, `bun run check:repo`, `bun run check:omp-coverage --require-complete`,
  and `git diff --check` — passed after refresh.
