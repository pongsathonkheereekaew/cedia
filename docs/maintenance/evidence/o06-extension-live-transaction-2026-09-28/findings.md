# O06 same-session extension reload transaction — 2026-09-28

## Result

The pinned OMP 18.1.18 development runtime now reloads a trusted TypeScript extension in one CEDIA-hosted RPC-UI session. A host-backed, provider-free probe passed generation A to same-path generation B, failed candidate rollback, extension removal, and stale selected slash-command refusal. The OMP PID and CEDIA session incarnation remained fixed. This is a bounded O06 implementation result; O06 and F acceptance remain open.

## Implementation

- `AgentSession.reloadExtensionGeneration` fences new prompt admission and waits for the active turn. The SDK stages the next file and inline extension generation, replaces source-owned model providers, updates the tool registry and presentation, swaps the stable `ExtensionRunner`, then publishes the committed source list to future child sessions.
- The runner quiesces new extension callbacks before the registry transaction and defers late tool-registration notifications until the transaction finishes. New events paused during reload dispatch to the committed generation; an already selected retired handler is skipped after a swap. A candidate failure leaves the last good runner and provider generation in place. Retired managed-timer contexts cannot schedule new work.
- Reload explicitly refuses while another live session shares the model registry; child sessions must be parked before replacement. This is a safe interim boundary, not live cross-session provider replacement.
- RPC, RPC-UI/TUI, and ACP `/reload-plugins` paths call the same session transaction. The interactive path refreshes extension shortcuts, removing handlers from the prior generation. CEDIA's host keeps its lifetime-lock extension pinned independently of the replaceable trusted fixture.
- The host-backed probe verifies command, model/provider, and tool catalogs, unchanged baseline models, zero assistant turns/tool calls/inference requests during reload, and HTTP 409 refusal for a selected command removed before dispatch.

## Verification on this revision

- OMP working-source HEAD: `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`; attested working source tree: `4b1bc9e823471bea7a50022bd341a10e78b0b18b`.
- `bun scripts/refresh-omp-patch.ts` generated patch SHA-256 `bc82e38716491753e9776a9c00d8611b9d4a2eae961613e5e65fd56605bfde61`; the attestation reports patch-manifest SHA-256 `d375609fd70e6bfdc33c747f4fc91d2d37ffc18136d4c8c838b037e89df96f79`.
- `bun run prepare:omp` passed. `attestOmpRuntime` verified the development source launcher, source tree, pinned OMP revision, and native runtime; launcher SHA-256 `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`.
- `bun scripts/omp-extension-hot-reload-smoke.ts` passed every assertion on the refreshed runtime (`ok: true`, OMP PID `71574`, one session incarnation, zero inference requests). Its temporary fixture and PID vary per run.
- Targeted OMP suite: 343 passed, 0 failed, 1,713 assertions across runner, provider, session prompt race, SDK session binding, ACP agent/builtins, interactive keys, and reload/MCP tests. OMP and root TypeScript checks passed; `git diff --check` passed.
- Host service suite: 41 passed, 0 failed, including the real OMP owner lock. `bun run check:repo` passed (`CI-OK`), and `bun run check:omp-coverage` passed with 1,041 audited mappings and zero fatal issues. Root and OMP diff checks passed.

## Remaining qualification

The probe covers a CEDIA-hosted RPC-UI development runtime. It does not cover a packaged Mac app, standalone interactive/ACP concurrent reload, a provider inference request, or live shared-source provider replacement while a subagent is running. The shared-session refusal has source and typecheck coverage but no dedicated live-child reload probe. The arbitrary side effects of a trusted extension module during candidate import are outside the registry rollback. Interactive shortcut behavior has a unit test but no terminal capture. Those paths, the remaining O-packets, and D's device/package gates stay open under §10 item 70. No packaged CEDIA launch or Login Item/Keychain operation was attempted while provenance is unanswered.

## Current-runtime requalification — 2026-09-28

The acceptance probe was rerun after the intervening O08 runtime changes, against the runtime that
was source-attested immediately before execution:

- OMP `18.1.18`, source revision
  `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, source tree
  `7e0ac3862e0c849b4467c508b8b3c175217968cc`; patch-manifest SHA-256
  `246014bfe03ee7dbf1e6f2034c4e7df516b2a43919228f183811ea3fc2fb0431`; launcher SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`; Bun SHA-256
  `35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5`; native SHA-256
  `05774ec09950a150b7c1cce63359bd26ed6d3eecc44a6261e09e9403371e7869`.
- `bun scripts/omp-extension-hot-reload-smoke.ts`: **PASS** (`ok: true`): generation A loaded;
  same-path generation B replaced the command, provider/model and tool catalogs; baseline model
  remained; a throwing candidate left B intact; removing the fixture cleared its registrations;
  stale selected slash was refused with HTTP 409 before dispatch. PID and session incarnation stayed
  fixed. Every reload had zero assistant messages, tool calls and provider cost; total inference
  requests: zero.
- An earlier probe attempt timed out waiting for generation B and was not counted as a pass. The
  current-runtime run above is the passing requalification; it adds no claim for packaged Mac or
  concurrent standalone interactive/ACP reload.
- Targeted OMP tests:
  `bun test upstream/omp/packages/coding-agent/test/extensions-runner.test.ts upstream/omp/packages/coding-agent/test/model-registry-runtime-provider.test.ts upstream/omp/packages/coding-agent/test/reload-plugins-mcp.test.ts` —
  **134 pass, 0 fail, 927 expectations**. `bun run check:types` in
  `upstream/omp/packages/coding-agent` passed.
- Smoke driver SHA-256: `debaf5cec66c37fb240a4d8b7e6a3f5bccf943dafd936276d96c17baac2b4e7a` at root
  revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` (dirty working tree). Root
  `bun run typecheck` passed; `bun run check:repo` returned `CI-OK` (852 doc links, 366 Markdown
  files, 331 evidence files); `bun run check:omp-coverage --require-complete` passed with 1,041/1,041
  mappings and zero missing dispositions; `git diff --check` passed.
