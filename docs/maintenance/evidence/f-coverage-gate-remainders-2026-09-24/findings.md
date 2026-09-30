# The coverage gate settles 11 more SDK rows by source, and says why the rest are open — 2026-09-24

This receipt records the non-settings half of the F coverage gate's remaining work: the SDK
records that Cedia really reaches through an audited path are now settled by a link the checker
verifies, and the rest keep an actionable reason instead of a reason string that hides a missing
integration. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Changed: `scripts/lib/omp-coverage.ts`, `scripts/lib/omp-coverage.test.ts`,
  `scripts/check-omp-coverage.ts`.

## What changed

- `OMP_SDK_VIA_OTHER_PATH` joins the existing `OMP_RPC_VIA_OTHER_PATH` idea on the SDK side. A
  link names the audited RPC command, the Cedia path that carries the same operation (a command
  Cedia's adapter sends, a slash command the audit marks reachable over the prompt path, or a
  settings path the runtime's schema defines), and the reason. Nine SDK rows are settled this way:
  `setFastMode`, `setTodoPhases`, `abortRetry`, `getSessionStats`, `exportToHtml`, `setSessionName`,
  `setAutoCompactionEnabled`, `setAutoRetryEnabled` and `getLastAssistantText`.
- Two more are settled by a direct call site rather than an equivalent: `getAvailableModels` is the
  audited `get_available_models` command sent from `apps/macos/src/provider-omp.ts` (the only
  source the checker allows for that link), and `getContextUsage` is the audited `get_state`.
- The verifier refuses a link whose target is not in the dated audit, whose slash command the audit
  does not mark reachable, whose settings path the schema does not define, whose adapter literal has
  disappeared, or that claims a direct client which no longer sends it. Every rule has a negative
  test, including an "unrelated source" case so a link cannot be proved by the wrong file.

## Measured result

```
bun run check:omp-coverage
  OMP coverage: 1041 audited records; 1041 Cedia mappings.
  Live runtime: checked omp/18.1.18; 498 settings, 50 audited RPC commands and 11 capability
  descriptors read.
  Integrity PASS: 0 fatal issue(s); 142 audited records without an available Cedia disposition.

bun run check:omp-coverage --require-complete ; echo "exit=$?"
  Integrity PASS; the same 142 real gaps; exit=1
```

The gate moved from 638 gaps to 142. The 485 `setting` gaps closed when the runtime began
publishing a per-key timing (its own receipt), and 11 `sdk` gaps closed here.

## The 142 that remain, by kind

```
sdk                87   (O01 10, O02 13, O03 11, O06 12, O07 19, O09 10, O11 12)
slash              26   (O01 queue/pause, O02 10, O06 extensions + status alias, O07 8, O08 3, O12 2)
slash-alias         1   (O06 `status`)
slash-subcommand    9   (`goal` 6, `collab` 3)
cli                 8   (O08 `join`, O10 `browser-relay`, O11 `ssh`, O12 5, plus `auth-broker`,
                         `auth-gateway`, `share`, `tiny-models`)
dynamic-tool        6   (`browser`, `computer`, `generate_image`, `tts`, an MCP-discovered tool
                         and a custom/extension tool)
rpc                 5   (`set_host_uri_schemes`, `get_subagents`, `get_subagent_messages`,
                         `bash`, `abort_bash`)
```

Every one of these is an operation whose Cedia surface does not exist yet, and each names the
packet that owes it. They are the O01–O12 packets themselves — native plan/goals/subagent views,
the MCP and extension catalog, session jobs and kernels, the runtime's own maintenance verbs — not
bookkeeping the gate could settle. No record was reclassified to make the number smaller.

## Verification

```
bun test scripts/lib                                    # 76 pass, 0 fail (184 expects)
bun build scripts/check-omp-coverage.ts --target bun    # passes
git diff --check                                        # clean
```

## Not done here

- The remaining 142 gaps are implementation work under their own packets; the gate is the honest
  measure of them, and F is not closeable while any `integration_missing` entry remains.
- No runtime was started beyond the isolated dead-endpoint fixture the gate already used, and no
  model request was made.
