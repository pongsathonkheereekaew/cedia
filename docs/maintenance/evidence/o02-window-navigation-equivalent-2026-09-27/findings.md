# O02 `switchSession`: CEDIA window navigation equivalent — 2026-09-27

The owner approved treating CEDIA's task navigation as the platform equivalent of OMP's
in-process `switchSession(sessionPath)`. CEDIA selects a durable task in the window and
leaves each task's OMP runtime, session file, and host placement under its own owner. A
navigation does not abort or retarget the previously selected runtime. This is an
explicit product difference, not an RPC claim. It supersedes the open decision in
`o02-session-placement-decision-2026-09-25`; `moveSession` remains host-owned under that
decision. §10 item 70 remains the completion authority.

## Implementation and evidence

- The coverage gate has a separate `OMP_SDK_VIA_WINDOW_LOCAL` link kind with no
  `rpcCommand`. It binds the audited `switchSession` row to
  `apps/macos/src/provider-projects.ts` task selection, and verifies source markers plus
  named behavioral test files. Missing source, a stale marker, or an SDK name absent from
  the dated audit is a fatal integrity issue.
- Native handoff tests select A then B by durable task ID without dispatching an OMP
  retarget command. The workbench state test selects A → B → A and retains each
  incarnation. A host fixture starts two independent task runtimes, reads both via the
  task route, commands both, verifies separate session files/incarnations, and finds no
  `switch_session` or `abort` command in either task's event stream.
- This verifies the platform-equivalent source and behavior boundary. It does not claim
  that CEDIA invokes OMP's `switchSession`, and it is not a packaged two-window
  navigation capture or full F checkpoint acceptance.

## Verification at revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` (dirty working tree)

- `bun test scripts/lib/omp-coverage.test.ts apps/macos/agent-window/test/native-handoff.test.ts apps/macos/test/workbench-mode.test.ts`: 63 pass, 0 fail.
- `bun test apps/host/test/service.test.ts -t 'keeps both task runtimes independently owned'`: 1 pass, 0 fail.
- `bun run check:omp-coverage --require-complete`: integrity PASS, 1,041 audited records / 1,041 mappings, zero gaps.
- `bun run typecheck` and `git diff --check`: pass.

The source gate is now complete for the pinned OMP audit. F still requires N and the
semantic/dynamic/device evidence in §8.1 and §11.1; W needs off-LAN tailnet proof and N
needs a physical iPhone, which the owner has not yet supplied.
