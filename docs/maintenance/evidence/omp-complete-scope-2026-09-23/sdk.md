# OMP SDK and service supplement — 2026-09-23

Source-only audit of the effective patched OMP v18.1.18 tree. The canonical
product requirements and work sequence remain CEDIA-PLAN.md §2.8/§8.2/§10.
`sdk.json` records selected public APIs and effective source hashes, not every internal method.

- RPC alone is not the complete OMP product surface. `docs/sdk.md` recommends RPC for
  process isolation; keep the current subprocess owner and extend its tracked bridge.
  Do not create an in-process second session to obtain a missing SDK operation.
- SDK auto-discovery includes shared settings/auth/models, skills/rules/context files,
  templates/slash/custom TS commands/extensions, tools, MCP and LSP. Preserve discovery
  precedence. `toolNames` alone is not an allowlist; `restrictToolNames` changes discovery
  of MCP/extensions/custom commands/LSP as well.
- A session has Plan, Goal, Vibe, Prewalk, Todo and Advisor controls beyond basic prompt/steer.
  UI instructions reading “Plan” are not evidence that these state machines are integrated.
- Context operations include breakdown, drop-images, shake, compaction and retry;
  memory includes local and optional external backends. Existing backend configuration
  does not authorize provisioning a new external service or transferring data to one.
- History includes branches/tree, side conversation branching, fork, move, import support
  elsewhere in session services and export. Conversation rewind does not by itself prove
  filesystem rollback; OMP checkpoint ownership and CEDIA buffer protection must be reconciled.
- Usage and OAuth account selection/reset-credit operations exist in OMP. These are distinct
  from a second Codex harness or Synara account backend. Any credit redemption needs explicit
  confirmation; source availability is not provider entitlement or network verification.
- Background jobs, work pools and IRC wake/delivery are OMP-owned. Event delivery and drain
  must remain integrated with the host lifecycle, not become a second scheduler.
- `agent_end.isTerminal === false` means maintenance/async delivery will resume execution.
  Treating every `agent_end` as completed would send premature completion notifications.
- `beginDispose()` closes admission before awaiting disposal. OMP drains session resources,
  including jobs, kernels, tabs, computer sessions, MCP, advisor and memory; persistence failure
  must remain visible. A host process exit alone does not certify successful disposal.
- SDK host/UI dependencies need versioned bridges and redacted projections. No generic
  serialized method invocation or arbitrary SDK evaluation is an acceptable controller API.

No runtime, model call, credentials, package installation or external service was exercised.
