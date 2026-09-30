# The context window and its maintenance are Cedia surfaces — 2026-09-24

This receipt records the O09 read slice. OMP already accounted for the context window; Cedia now
draws that accounting instead of a single percentage, and gains the two bounded controls §8.2 O09
requires beside it (cancel active compaction, strip image content). Three SDK records settle. §10
item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice: manifest sha
  `d4cf5eb3057e1535096a519f991fb78306a070932c0772888cecc98f496a1f63`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`).
- Runtime: new `packages/coding-agent/src/modes/rpc/cedia-context-bridge.ts`; changed
  `.../rpc/{cedia-capability-bridge,rpc-mode,rpc-types}.ts`, new
  `test/cedia-context-bridge.test.ts`, changed `test/cedia-capability-bridge.test.ts`.
- Cedia: new `apps/host/src/omp-context.ts`, `apps/host/test/omp-context.test.ts`,
  `scripts/omp-context-smoke.ts`, `apps/macos/agent-window/test/cedia-context*.test.*`; changed
  `apps/host/src/{service,router}.ts`, `apps/host/test/fixtures/fake-host.mjs`,
  `apps/macos/agent-window/src/cedia-adapter.ts`, vendor `lib/serverReactQuery.ts`, new
  `components/chat/CediaContextSurface.tsx`, `components/ChatView.tsx`, `routes/__root.tsx`,
  `packages/omp-adapter/test/cedia-capabilities.test.ts`,
  `scripts/{omp-capabilities-smoke,lib/omp-coverage,check-omp-coverage}.ts`.

## What changed

- **The numbers are OMP's own accounting.** `context.get` answers the session's own
  `getContextBreakdown()` split into base prompt, tools, discovered context, skills and messages
  against the model's window, plus `anchored`, plus the runtime's live maintenance state
  (`isCompacting`, `compactionSpeculation`). There is no Cedia token count: a breakdown the session
  cannot compute is *absent* from the answer, and the panel renders that absence as "context size
  not available" rather than as zero.
- **Two bounded controls, and neither overstates itself.** `context.drop-images` calls the session's
  own `dropImages()` and answers how many images it removed *together with* the state that follows,
  so the panel re-reads what it changed from one response; `context.abort-compaction` requests the
  session's own `abortCompaction` and answers the re-read maintenance state, so a client is never
  told a compaction stopped when it did not. Both are mutations behind the durable command envelope
  (claim-before-dispatch, replay answers the same receipt), and both are wired as no-payload
  `cedia_control` operations so a payload can never name code.
- **Owner-only routes.** `GET /v1/sessions/:id/context` (unknown query refused), and
  `POST /v1/sessions/:id/context/drop-images` + `/context/abort-compaction` with exactly
  `{ commandId, incarnation }`. A session with no live runtime is `unavailable` with the runtime's
  own reason and starts nothing; a malformed runtime answer is refused by a strict parser instead of
  being partly rendered.
- **The composer shows it.** A Context panel follows the queue panel: the used/window figures and
  the runtime's own split, the compaction and speculation state, `Cancel compaction` offered only
  while the runtime reports compaction active and driven by the answer, and `Drop images` behind an
  explicit second-click confirmation because it rewrites the stored transcript. `removed: 0` reads
  as "no images to remove", and an unavailable answer shows only the host's reason with no controls.

## Evidence (this revision and build)

- `bun scripts/omp-context-smoke.ts` → every check OK against the prepared `omp/18.1.18`, including
  `abort-compaction answers the state that follows the cancel request`, `drop-images reports zero
  removed images with the runtime's full accounting`, `a repeated context command id replays the
  same receipt` and `the context routes are owner-only (401)`, final
  `{"ok":true,"version":"omp/18.1.18"}`.
- `bun test apps/host packages/omp-adapter` → 389 pass, 0 fail; `bun test apps/macos/agent-window/test`
  → 223 pass, 0 fail; `bun run --cwd apps/macos/agent-window typecheck` → exit 0.
- `cd upstream/omp && bun test packages/coding-agent/test/cedia-context-bridge.test.ts` → 5 pass,
  including that an unavailable breakdown stays absent and that the cancel answers the following
  state rather than a claim.
- `bun scripts/omp-capabilities-smoke.ts` → every check OK; the available table now lists 27
  descriptors.
- `bun run check:omp-coverage` → integrity PASS, **112 → 109** records without a disposition
  (`getContextBreakdown`, `dropImages`, `abortCompaction` settled through the registered operations).
  The gate's `/cleanse` row was also corrected: OMP's own description of that command is "Detect and
  fix project diagnostics with weighted parallel subagents", so its earlier reason ("context cleanse
  is O09 work") was wrong. The row stays a gap, now naming the operation the command performs.

## Limits

- No live turn ran, so no live compaction was cancelled and no branch with images was stripped: the
  live smoke proves the read, the zero-removal path and the replay/owner rules, and the runtime's
  own behaviour (a real removal count, a real cancel) is proven by the session fixtures above.
- The `shake` strategies (`elide`, `images`, `thinking`) and the memory backend surface are still
  open under O09; the panel covers the breakdown and the two controls that exist.
- No packaged window was captured rendering the panel.
