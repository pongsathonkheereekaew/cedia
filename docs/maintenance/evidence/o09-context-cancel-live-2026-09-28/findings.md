# O09 live compaction cancellation — 2026-09-28

Bounded F semantic evidence for one O09 case: cancel an active manual compaction through
CEDIA's owner route while OMP is waiting for its summary response. This does not close O09 or
F, and makes no packaged, web, iPhone, automatic-compaction, retry/fallback or external-provider
claim.

## Reproduction and root cause

The regression test `test/rpc-input-frame.test.ts` failed before the fix with
`abort was serialized behind compaction`. `RpcInputDispatcher` put ordinary commands on one
serial tail. RPC `prompt` runs the virtual TUI's `/compact` handler and awaits
`session.compact()`. The subsequent `cedia_control` operation `context.abort-compaction` used
the same serial tail, so it could not call `session.abortCompaction()` until the summary
request—and therefore the compaction—had ended.

`runsInBackground()` now dispatches only this interrupting context operation outside the serial
tail and tracks it through the existing background-task shutdown drain. OMP remains the sole
owner of compaction. The dispatcher also labels background errors with the actual command type.
The prior O06 manager handoff's `RunRpcMode` type alias was updated to include the already-wired
session-owned MCP manager; this was required for the OMP source typecheck.

## Live observation

`bun scripts/omp-context-cancel-smoke.ts` passed against the prepared OMP `18.1.18` runtime.
The isolated host used one loopback OpenAI-compatible fixture: it returned the seed turn, held
the actual soft-compaction summary request open, and served the post-cancellation follow-up.
No credentials or external model service were used.

- The seed turn completed with one local response.
- The host accepted `/compact`; the runtime reached the second, held summary request and the
  host command remained `claimed`.
- While that request was held, the owner-only `/context/abort-compaction` route answered
  HTTP 200 with the runtime's available context projection. OMP then closed the pending
  summary response, proving the active provider call was cancelled.
- The context route subsequently reported `compacting: false`; the OMP session file had no
  compaction entry; and a follow-up prompt completed, showing the session recovered.
- The fixture saw exactly three calls: seed, aborted summary, and follow-up.

## Verification

- RED: `bun test test/rpc-input-frame.test.ts -t 'context compaction abort preempts a prompt waiting on compaction'`
  failed with the expected serialization timeout before the fix.
- GREEN: `bun test test/rpc-input-frame.test.ts` — 18 passed, 0 failed, 67 expectations,
  including an error-frame regression that prevents `cedia_control` failures being mislabeled
  as `bash`.
- `bun run check:types` in `upstream/omp/packages/coding-agent` — passed.
- `bun run typecheck` at the CEDIA root — passed.
- `bun run check:repo` — passed (CI-OK; documentation links, evidence index and repository checks clean).
- `bun run check:omp-coverage --require-complete` — passed; 1,041/1,041 audited records have CEDIA mappings and zero fatal issues.
- `bun scripts/prepare-omp-runtime.ts` — prepared the pinned development launcher from the
  consolidated patch; the live smoke passed on that launcher.

The final runtime attestation (`attestOmpRuntime`) is:

- Runtime: `development-source-launcher`, OMP `18.1.18`
- Pinned source revision: `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`
- Verified source tree: `46a035a378569e81ed55bb065de6f7c858276489`
- Patch manifest SHA-256: `fce3ed0f89e40ee9f25558bb1f865bf24e80be06b9d931486d5fbf986832fac5`
- Pinned patch SHA-256: `0d05ce6796f83633ec498c78f3a0ed71e6b139c5c5dd0ec989d0b241ddad760e`
- Launcher SHA-256: `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`

This receipt proves the active manual
soft-compaction cancellation path through the host and OMP RPC dispatcher. It does not prove a
packaged Context-panel click, real provider inference, auto-compaction cancellation, other O09
behaviors, or F acceptance.
