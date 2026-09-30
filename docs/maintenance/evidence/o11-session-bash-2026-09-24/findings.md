# Session shell execution through the audited commands, end to end — 2026-09-24

This receipt records the O11 slice that closes the audited `bash`/`abort_bash` RPC rows plus
the `executeBash`/`abortBash` SDK rows with a real surface: the composer Shell panel runs one
shell command at a time through the session's own foreground bash and aborts through its
cancel. No upstream change was needed — the runtime already answers both commands, so the
host sends them directly exactly as the terminal's bash mode does. §10 item 70 owns status;
this file records what was observed at the revision below. No provider was configured.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. No upstream change in this slice; `dist/omp/omp` not
  re-prepared.
- Changed for this slice: `apps/host/src/omp-bash.ts`,
  `apps/host/src/{service,router}.ts`, `apps/host/test/omp-bash.test.ts`,
  `apps/host/test/fixtures/fake-host.mjs` (bash answer corrected to the real `BashResult`
  shape); `apps/macos/agent-window/src/cedia-adapter.ts`,
  `apps/macos/agent-window/test/adapter.test.ts`,
  `vendor/synara/.../lib/serverReactQuery.ts`,
  `vendor/synara/.../components/chat/CediaShellSurface.tsx`,
  `vendor/synara/.../components/ChatView.tsx`,
  `apps/macos/agent-window/test/cedia-shell-surface.test.tsx`;
  `scripts/omp-bash-smoke.ts`, `scripts/lib/omp-coverage.ts`,
  `scripts/check-omp-coverage.ts`; this receipt; `docs/maintenance/CEDIA-PLAN.md` (item 70 row).

## What changed (one vertical, each layer owning its half)

- **Host** (`omp-bash.ts`, service, router): strict `BashResult` projection (bounded output,
  nullable exit code, cancelled/timedOut flags, working dir, image count — PTY bytes,
  graphics bytes and OMP-side artifact references never cross); owner-only durable
  `POST /v1/sessions/:id/bash/exec` (`{commandId, incarnation, command}`, command strictly
  validated and bounded, stale incarnation refused, replay returns the receipt without
  re-running) and `POST /v1/sessions/:id/bash/abort` (confirms delivery; what ran is
  visible in the exec outcome's `cancelled` flag). Output enters the agent's context exactly
  as the terminal's bash mode leaves it — same shell routing, environment, cwd and
  extension hooks, no second routing invented.
- **Adapter + window**: `execBash`/`abortBash` with typed refusals preserved; strict parse
  plus mutation options (no polling timer); the composer gains a Shell panel in both windows
  (command input, Run/Abort, exit line, bounded output, truncation and image notes, refusal
  alert), clearly labeled as running in the task session rather than the window terminal.
- **Gate**: `bash`/`abort_bash` carried by named host callers sending the audited commands;
  `executeBash`/`abortBash` carried by the same callers (the audited commands run those
  exact session methods with default options — no chunk streaming over this path). Four rows
  settled, each failing the run if its caller stops sending the command.

## What was observed

- `bun scripts/omp-bash-smoke.ts`: 14 checks OK through a real booted host against the
  prepared runtime — exact output with exit 0, a failing command answered (not errored), a
  `sleep 20` cancelled live through abort (exec answers `cancelled: true`), idle abort
  accepted, idempotent replay, 400s before any runtime call, stale refused.
- Host: `apps/host/test/omp-bash.test.ts` 5 pass, including the real-host route driving the
  corrected fixture shell (output names the command; exactly one `bash` on the wire).
- Adapter: `apps/macos/agent-window/test/adapter.test.ts` 48 pass, including the new
  exec/abort read-write test with refusal.
- Window: `apps/macos/agent-window/test/cedia-shell-surface.test.tsx` 3 pass (Run vs Abort
  rendering, exit/cancelled states, strict parsing, per-session mutation keys).
- `bun run check:omp-coverage`: integrity PASS, gap count **53** (was 57), O11 rpc 0
  (was 2), O11 sdk 10 (was 12).
- Sweeps: root (`packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib`)
  1318 pass / 0 fail (156 files, including the new shell tests); agent-window suite 296 pass
  / 0 fail (63 files); `bun run typecheck` holds the 10 pre-existing `apps/macos` errors
  only (no upstream change in this slice, so no patch or runtime rebuild was needed);
  `node scripts/ci-validate.mjs` CI-OK; `git diff --check` clean.
- The fixture correction was load-bearing: the old `{stdout, stderr}` stub did not match any
  runtime answer, so no strict parser could ever have been proven against it.

## Still open (not claimed)

- O11 keeps eval (`executePython`, `abortEval`), async jobs (`getAsyncJobSnapshot`,
  `hasPendingAsyncWork`, `settleAsyncWork`), work pools (`get/setWorkPoolYieldItems`) and
  IRC (`deliverIrcMessage`, `drainPendingIrcInboxMessages`, `waitForIrcReplies`) — each a
  separate subsystem with its own owner, none claimed by shipping a shell path.
- No PTY streaming on this path (output answers when the run finishes), no packaged
  capture of the Shell panel, and no parked-run observation against a provider turn.
