# Reducing stored context is a Cedia control — 2026-09-24

This receipt records the last O09 slice: OMP's own context-reduction strategies are reachable from
Cedia, the two remaining O09 SDK rows are settled with source evidence, and the gate gains a way to
record an operation that is OMP's own behaviour rather than a client control. §10 item 70 owns
status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice: manifest sha
  `f7171909fed6467b46ad72796a0da68dd95c8106bbf6475c0738b475be423e89`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`).
- Runtime: `upstream/omp/packages/coding-agent/src/modes/rpc/cedia-context-bridge.ts` (the three
  strategies and the payload rule), `.../{cedia-capability-bridge,rpc-mode}.ts`,
  `test/cedia-context-bridge.test.ts`, `test/cedia-capability-bridge.test.ts`.
- Cedia: `apps/host/src/{omp-context,service,router}.ts`, `apps/host/test/omp-context.test.ts`,
  `apps/host/test/fixtures/fake-host.mjs`, `scripts/omp-context-smoke.ts`,
  `apps/macos/agent-window/src/cedia-adapter.ts`, vendor `lib/serverReactQuery.ts`,
  `components/chat/CediaContextSurface.tsx`, `apps/macos/agent-window/test/cedia-context*.test.*`,
  `packages/omp-adapter/test/cedia-capabilities.test.ts`,
  `scripts/{omp-capabilities-smoke,lib/omp-coverage,lib/omp-coverage.test,check-omp-coverage}.ts`.

## What changed

- **The reduction is the runtime's own.** `context.shake` takes exactly one field, `mode`, restricted
  to OMP's three strategies (`elide`, `images`, `thinking`); anything else is refused before the
  session is asked to drop anything, and the bridge re-checks the mode as well. The answer carries the
  runtime's own `ShakeResult` - counts per kind, reclaimed tokens and the session artifact that holds
  what it dropped when one was written - beside the context state that follows, so the panel shows
  the window it just reduced from one response. Nothing in it is a Cedia estimate.
- **Owner-only route.** `POST /v1/sessions/:id/context/shake` with exactly
  `{ commandId, incarnation, mode }` through the durable command envelope (claim-before-dispatch,
  replay answers the same receipt, an unknown mode claims nothing). A missing or wrong `mode`, an
  extra field, a missing command id/incarnation and the wrong method keep the sibling routes' typed
  refusals; a session with no live runtime is `unavailable` with the runtime's reason.
- **The panel asks before it reduces.** Each strategy is named for what it drops, the chosen one needs
  an explicit second confirmation (it rewrites the stored transcript), and the result the panel shows
  is the runtime's answer - including a zero result reading as "nothing to reduce" rather than as a
  failure.
- **Two O09 SDK rows are settled with evidence rather than with a control.** `refreshBaseSystemPrompt`
  is what OMP's own settings listener does after a change to `browser.enabled`/`computer.enabled`
  (and what the host's `set_host_tools` handshake drives), so the Cedia path is the settings surface.
  `runAutolearnCapture` is OMP's own capture inside a turn, gated by `autolearn.enabled`, which the
  settings destination owns - there is deliberately no Cedia control for it, and the gate now records
  that as a disposition with **source evidence**: `OMP_SDK_DISPOSITIONS` names the file and the
  literals that must still be there, and the run fails if either moves.

## Evidence (this revision and build)

- `bun scripts/omp-context-smoke.ts` → every check OK against the prepared `omp/18.1.18`, including
  the runtime's numeric `elide` result on a fresh session, the same command id replaying, an unknown
  mode refused before any runtime call, and the routes being owner-only.
- `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` → **1246 pass,
  0 fail** (146 files); `bun test apps/macos/agent-window/test` → 233 pass; `bun test apps/host` →
  323 pass; `bun run --cwd apps/macos/agent-window typecheck` → exit 0; `bun run typecheck` → the same
  10 pre-existing errors, none in a file this slice touched.
- `bun scripts/omp-capabilities-smoke.ts` → every check OK; the available table now lists 30
  descriptors. `packages/omp-adapter/test/cedia-capabilities.test.ts` probes every available row with
  a real payload (its `context.shake` probe runs `elide`), so an advertised operation without a
  handler still fails the run.
- `bun run check:omp-coverage` → integrity PASS, **106 → 103** records without a disposition
  (`shake` settled through the registered operation; `refreshBaseSystemPrompt` and
  `runAutolearnCapture` through the disposition table). The same pass moved `abortRetry` into the
  same table - OMP's `abort()` calls `abortRetry()`, so Cedia's Stop is what carries it and there is
  no separate user action to expose - which leaves **102 gaps and no O09 row at all**: the family is
  closed. `bun test scripts/lib` → 77 pass, including a test that reads the shipped table's real
  sources and fixtures proving the verifier fails on a moved literal, an unreadable file and an
  orphan name.
- `node scripts/ci-validate.mjs` → CI-OK; `git diff --check` clean.

## Limits

- No live turn had heavy context to reduce: the smoke proves the live plumbing with a real (zero)
  runtime result, and the runtime's dropping behaviour is proven by its own tests and fixtures.
- `elide`/`images`/`thinking` are the strategies this OMP revision defines; a future strategy would
  be refused by the payload rule until Cedia names it, which is the intended failure mode.
- No packaged window was captured rendering the control.
