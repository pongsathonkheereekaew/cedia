# Task crash recovery after owner-endpoint reconciliation — 2026-09-28

## Result

`bun scripts/omp-crash-proof.ts` passes against pinned OMP 18.1.18 using isolated host state and
a loopback model endpoint that never answers. The first prompt reaches the local endpoint and is
running when the OMP child receives SIGKILL. The host records `outcome_unknown` with the process
exit reason, moves the task to `recovery_required`, and records exactly one prompt. A start attempt
returns HTTP 409 `recovery_required` and dispatches nothing.

The owner explicitly posts `acknowledgeUnknown: true` to reconcile. The host clears the stale
`owner.json` and Unix socket only after verifying the record is private, its task ID and
incarnation match, its PID is gone, and its socket remains a private socket contained in the task
directory. A live owner or a mismatched incarnation remains a conflict and is not cleared. After
reconciliation, the task restarts, a second prompt reaches the same loopback endpoint, and the
turn aborts cleanly. Exactly two prompts reach OMP across the crash and recovery; no prompt is
replayed.

## Verification

- `bun scripts/omp-crash-proof.ts` — **passed**; OMP `18.1.18`, two loopback hits, two total
  prompts, first turn `outcome_unknown`, explicit reconcile, restarted second turn cancelled.
- `bun test apps/host/test/service.test.ts -t 'reconciles an unknown turn only after removing its dead matching owner record'`
  — **1 passed**; verifies start refusal before acknowledgement, no deletion for a live PID or
  wrong incarnation, cleanup for the dead matching owner, and successful task restart.
- The recovery helper is reachable through the host's owner-only reconcile route, which still
  requires `acknowledgeUnknown: true`. Ambiguous, malformed, cross-user, live or replaced endpoint
  state returns a refusal and remains in place.

The test uses a host-started OMP subprocess, scratch directories and a loopback-only model fixture.
It makes no provider request, does not use a packaged app, and changes no installed app state.
Relevant current source hashes:

| File | SHA-256 |
|---|---|
| `apps/host/src/owner-endpoint.ts` | `ae3962dc51af4624155002391a229719f7197ca9ebcd625a0b7eb41b783159f0` |
| `apps/host/src/service.ts` | `9ce7e06bc375e280d68502e050fefae06ff1bc686a6ee2d92270022cebcb46bd` |
| `apps/host/src/router.ts` | `d2ac730dd134f47b16e4efabd725338935dc0cc39f5c2965e4827c1a90cbba6e` |
| `scripts/omp-crash-proof.ts` | `0bb21a9694d8a1eb3bd1db864f705e8b6cf9818191868a89f3905e271906f9f1` |

## Limits

This proves host/OMP task crash recovery after a confirmed unknown outcome. It does not prove a
packaged Cedia app crash followed by host adoption of a surviving task owner, host crash with a
surviving OMP child, a real macOS Login Item cycle, or D/W/N/F acceptance.
