# O06 extension generation primitives — 2026-09-28

## Result

The pinned OMP source now has two prerequisites for same-session TypeScript extension reload: a stable `ExtensionRunner.swapGeneration` operation, and rollback-capable replacement of extension-sourced model provider registrations. A host-backed acceptance probe was added and intentionally remains red against the current `dist/omp/omp`: `/reload-plugins` still refreshes discovery and file commands but does not call these primitives. This is an implementation checkpoint, not O06 or F acceptance.

## Source changes

- `ExtensionRunner.swapGeneration(extensions, runtime)` retains the runner object captured by `AgentSession` and tool wrappers. It waits for the runner's idle, active extension callback and pending tool-registration barriers, retires the prior generation's managed timers so a stale context cannot schedule new work, removes and reinstalls file fallbacks, rebinds late tool observers, and initializes the new runtime with the existing session actions. Candidate initialization failure restores the previous runner generation and its timer context.
- `ModelRegistry.replaceExtensionProviders(replacedSourceIds, registrations)` validates the candidate, records successful source registrations, restores the previous provider generation if a later registration fails after mutating model, credential, OAuth, or custom API state, and returns a restore action for a later transaction failure. It leaves unrelated source registrations intact and refuses a candidate's attempted takeover of another source's provider. The caller still needs exclusive ownership of the replaced source IDs across the whole transaction, including shared subagent sessions.
- `scripts/omp-extension-hot-reload-smoke.ts` creates one isolated host-backed session with a stable trusted lifetime-lock extension separate from the replaceable trusted fixture. It checks same-path generation A to B, provider/tool/command catalog changes, failed-candidate rollback, removal, stale selected slash refusal, stable OMP PID/incarnation, and zero inference. It does not run a provider request.

## Verification

- `bun test packages/coding-agent/test/extensions-runner.test.ts packages/coding-agent/test/model-registry-runtime-provider.test.ts packages/coding-agent/test/extension-provider-registration-rollback.test.ts`: 137 passed, 927 assertions, including in-flight callback drain, stale timer refusal, runner initialization rollback, unrelated provider preservation, and provider restore after a successful replacement.
- `bun --cwd=packages/coding-agent run check:types`: passed after both source changes.
- OX lint/format for the changed OMP files and `git diff --check`: passed. The new smoke script was formatted and linted.
- `bun scripts/omp-extension-hot-reload-smoke.ts` against pinned development binary SHA-256 `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107` reached generation A and completed `/reload-plugins` without an inference turn, then timed out waiting for generation B's command. The corrected fixture kept the host lifetime lock in a separate trusted file; this rules out fixture removal as the failure cause. Later assertions were not reached. The binary has not been rebuilt from this source checkpoint, so no integrated-runtime claim follows.

Source checkout HEAD: `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`; five-file OMP working diff SHA-256: `ee6056143f6e8ec8ac669c3095c5cddeb077f6a31a83d4487cd5cd8cc6b48c03`; acceptance script SHA-256: `7340b4f8ef24c8c4ca08e262b4970d4f1915766cd6cb68b3c039ea43dc3afc05`. The working tree is intentionally uncommitted.

## Remaining work

Wire the staged generation into the owning SDK/session and RPC, fence new turn and extension dispatch before the first reload await, resolve model-registry exclusivity across shared subagent sessions, drain in-flight callbacks and tool mutations, commit tools/providers/commands with rollback, then publish the catalog. Interactive autocomplete and shortcuts need the same generation update. Rebuild and attest the pinned runtime, run the same-PID acceptance probe through all assertions, and verify packaged surfaces before O06/F acceptance. Physical iPhone and Login Item provenance remain separate D/F prerequisites.
