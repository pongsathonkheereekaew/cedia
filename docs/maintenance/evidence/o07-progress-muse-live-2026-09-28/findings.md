# O07 live agent todo-to-progress proof — 2026-09-28

## Scope

Verify that a live OMP agent can create its native todo list and that CEDIA's host progress route
projects the same runtime-authored phases and task status. The proof uses an isolated scratch task,
the existing OMP profile and no packaged app.

## Result

- OMP `18.1.18` was source-attested before dispatch. Runtime tree:
  `7e0ac3862e0c849b4467c508b8b3c175217968cc`; source revision
  `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`; patch manifest SHA-256
  `246014bfe03ee7dbf1e6f2034c4e7df516b2a43919228f183811ea3fc2fb0431`; executable SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`.
- The host selected/read back `opencode-go/muse-spark-1.3-contributor` and observed authenticated,
  available provider metadata before dispatch.
- The corrected proof sent one user prompt. OMP emitted a `tool_execution_end` frame for its native
  `todo` tool; the host `/progress` route projected exactly one phase and the same one task from
  that tool result. The task content matched `CEDIA_O07_LIVE_TODO_PROOF`, and the status was
  `in_progress` (OMP auto-starts the first task created by `todo.init`). Event sequence was 96;
  progress revision was 2.
- An initial proof-runner attempt had the wrong expected status (`pending`). It still observed one
  phase and one task, then failed that harness assertion. The existing OMP `TodoTool` test confirms
  `init` auto-starts the first task as `in_progress`; the corrected runner now checks that behavior
  and also compares the OMP tool-result phases with the host projection. Across the two proof runs,
  two user prompts were dispatched; neither run retried a prompt internally.
- Both isolated scratch task/state directories were removed. No project file, packaged Cedia app,
  Login Item, Keychain, physical device, commit or push was used.

## Verification

- Corrected `bun scripts/omp-progress-muse-live-proof.ts`: **PASS**; native todo result and host
  projection matched.
- `bun test apps/host/test/omp-progress.test.ts upstream/omp/packages/coding-agent/test/tools/todo.test.ts`:
  **89 pass, 0 fail, 246 expectations**. Includes the existing auto-start behavior.
- Root `bun run typecheck` and `bun run check:repo` passed before the live run.
- Proof runner SHA-256: `3c46f8bd0443d68dc07eb561478ee832137ce062048572b7ab5b93d8d18ce17a` at repository
  revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` (dirty working tree).

## Limits

This closes one live O07 progress-semantic case only. The Progress panel is still read-only by
design; packaged capture, cross-window push behavior and O07 Advisor, Prewalk, AgentHub and loop
records remain open. It is not D or F acceptance.
