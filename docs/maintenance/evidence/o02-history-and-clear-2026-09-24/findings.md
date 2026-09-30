# The task's own history reaches the window — 2026-09-24

This receipt records the O02 slice (plan §8.2 "O02 — complete history/recovery"): the runtime's own
checkpoint and rewind facts, its bounded transcript text, and the two owner-only context operations
now reach the owner through registered `cedia_control` operations and owner-only host routes, and the
composer's Context panel gained a History section. §10 item 70 owns status; this file records what was
observed at the revision below. No provider request was made and no model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`
  with this slice applied. The tree is deliberately dirty (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. `patches/omp/0001-cedia-rpc-bridges.patch` is 752,619 bytes with
  sha256 `b0bd7c677a3e572e846caf92d6dba1e67cb1e37c26fbb8d58b70837d49b91adc`, recorded in
  `patches/omp/manifest.json`. `bun scripts/refresh-omp-patch.ts` regenerated the patch and the
  manifest hash together, and `bun scripts/prepare-omp-runtime.ts` re-prepared `dist/omp/omp`,
  re-attesting that the source tree is exactly the pinned revision plus that patch.
- Changed for this slice: `upstream/omp` `cedia-capability-bridge.ts`, `rpc-mode.ts`,
  `test/cedia-history-bridge.test.ts` (new), `test/cedia-capability-bridge.test.ts`;
  `packages/omp-adapter/test/cedia-capabilities.test.ts`; `apps/host/src/omp-history.ts` (new),
  `apps/host/src/{service,router}.ts`, `apps/host/test/omp-history.test.ts` (new),
  `apps/host/test/fixtures/fake-host.mjs`; `apps/macos/agent-window/src/cedia-adapter.ts`,
  `.../lib/serverReactQuery.ts`, `.../components/chat/CediaContextSurface.tsx`,
  `apps/macos/agent-window/test/cedia-history.test.ts` (new),
  `apps/macos/agent-window/test/cedia-context-surface.test.tsx`;
  `scripts/lib/omp-coverage.ts`, `scripts/check-omp-coverage.ts`, `scripts/lib/omp-coverage.test.ts`;
  `scripts/omp-history-smoke.ts` (new).

## What changed

- **Four runtime operations**, each delegating to the session's own method rather than becoming a
  second implementation of it (plan §2.8):
  - `context.reset` runs the same reset `/clear` performs - the compaction drain and
    `resetSessionContext()` that `handleResetContextCommand` calls in `command-controller.ts` - with
    the runtime's own refusal surfaced as the operation's error rather than as an empty success.
    It answers `{ reset: true }`.
  - `session.fresh` runs the session's own `freshSession()` and answers
    `{ fresh: true, providerSessionId: string | null }`.
  - `history.state` projects the session's own `getCheckpointState()`/`getLastCompletedRewind()`
    into `{ checkpoint: { messageCount, entryId, startedAt } | null, lastRewind: { report,
    reportTruncated, startedAt, rewoundAt } | null }`, bounding the retained report to 4,096
    characters and saying when it did.
  - `history.transcript` answers `{ text, truncated, bytes }` from `formatSessionAsText()`, bounded
    to 262,144 bytes on a UTF-8 boundary (a cut inside a multi-byte sequence would have made the
    returned byte count exceed the cap).
- **Owner-only host routes**: `GET /v1/sessions/:id/history`, `GET .../history/transcript`,
  `POST .../history/clear`, `POST .../history/fresh`. Reads answer `{ available: false, reason }`
  when the session has no live runtime instead of an empty history; the writes use the existing
  durable, idempotent command envelope (claim before dispatch, replay by command id,
  `stale_incarnation` refusal) and every runtime answer is parsed strictly.
- **The History section** in the composer Context panel: the runtime's checkpoint (message count,
  start time) and last completed rewind (timestamps plus its own report, with the truncation mark),
  a plain "nothing yet" state when neither exists, the host's own reason when the runtime is absent,
  a confirmed `Clear context`, a confirmed `Rotate provider state`, and `Copy transcript` that names
  a truncated answer instead of copying it silently. No polling and no automatic read: the panel
  reads on request.
- **Coverage settlement** (10 audited O02 records, measured by the gate): `resetSessionContext`,
  `freshSession`, `getCheckpointState`, `getLastCompletedRewind` and `formatSessionAsText` through
  the registered operations; `newSession` through a new source-verified caller link
  (`apps/macos/src/provider-review.ts` sends `new_session`); `buildDisplaySessionContext`,
  `buildTranscriptSessionContext` and `fork` through source-evidence dispositions (the first two are
  context builders the runtime runs itself; the third is Cedia's Fork performed at runtime start
  through OMP's own `--fork`, which is the same operation through a different OMP entry point); and
  the `/clear` slash row, whose operation Cedia now owns. Every claim is re-read at run time: an
  operation link fails unless the live table advertises it, a caller link fails unless that file
  still sends the command, and a disposition fails unless its needles are still in the file it names.
- **A defect in the pinned patch found while checking it**: `rpc-mode.ts` used
  `CediaPendingModelChange` without importing it, and four owner-only write handlers passed an
  `unknown` projection into `success()`. `bun run check:types` in `packages/coding-agent` now exits
  0 (it previously reported those five errors). This is a typing fix with no behaviour change.

## Evidence (this revision and build)

| Command | Result |
|---|---|
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1275 pass, 0 fail, 7487 expect() calls, 150 files (was 1264 pass) |
| `bun test apps/macos/agent-window/test` | 258 pass, 0 fail, 850 expect() calls, 55 files (was 248 pass) |
| `cd upstream/omp && bun test packages/coding-agent/test/cedia-history-bridge.test.ts` | 6 pass, 0 fail, 26 expect() calls |
| `cd upstream/omp && bun test packages/coding-agent/test/cedia-capability-bridge.test.ts` | 23 pass, 0 fail, 3923 expect() calls |
| `cd upstream/omp/packages/coding-agent && bun run check:types` | exit 0 (five errors before this slice) |
| `bun scripts/omp-history-smoke.ts` | 20 checks OK against the prepared `omp/18.1.18`, and `{"ok":true,"version":"omp/18.1.18"}` |
| `bun run check:omp-coverage` | 1041 audited records, 1041 Cedia mappings; live runtime 37 capability descriptors (was 33); integrity PASS, 0 fatal issues; **88 records without an available Cedia disposition (was 98)** |
| `bun run typecheck` | 10 errors, the pre-existing `apps/macos` set recorded since `0676dd70d54`; none in this slice's files |
| `bun run build:agent` | `Agent Window assets written to dist/agent-window` |
| `node scripts/ci-validate.mjs` | `CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=468 md=186 evidence=163` |
| `git diff --check` | clean |

The smoke is the runtime half, and it runs the pinned launcher rather than a mock: it negotiated the
virtual terminal, asked the runtime for `history.state`, `history.transcript`, `session.fresh` and
`context.reset`, confirmed that an operation outside the static table is refused before any handler
runs, and then drove the four host routes - no runtime before start (absence with a reason), the live
reads, the refusal of an unknown body field before the durable or runtime call, a durable clear whose
repeat replays the same receipt, the fresh route, a stale incarnation refused with 409, and a paired
controller refused on both the read and the write. Its model endpoint is a listener that never
answers, so no provider request can complete in this run.

## Limits and what is not claimed

- O02 is not complete: 12 of its gap records remain. Still open are the session tree and its lineage
  (`/tree`, `navigateTree`), the side-question path (`/btw`, `branchFromBtw`), moving or switching a
  session (`moveSession`, `switchSession`), and the workflow commands `/cleanse`, `/copy`, `/git`,
  `/omfg`, `/open` and `/tan`. Each keeps its own reason in the gate rather than a reclassification.
- No real checkpoint or completed rewind was produced: reaching either needs a provider turn, so the
  smoke proves the live plumbing on a session that honestly reports `null` for both, while the
  bounded and truncated shapes are proven by fixtures (`apps/host/test/omp-history.test.ts`,
  `packages/coding-agent/test/cedia-history-bridge.test.ts`).
- No packaged window was captured rendering the History section, and no remote client was exercised:
  the four routes are owner-only, so they are outside the controller surface by construction.
- `history.transcript` carries the runtime's own dump, which includes the session's system prompt and
  messages; the route is owner-only for that reason. The panel's byte label is the runtime's own
  count, not a second measurement.
- F is not claimed, and this slice closes no D/W/N checkpoint: it removes 10 of the 88 remaining
  audit gaps and leaves the packaged and remote scenarios to their own gates.
