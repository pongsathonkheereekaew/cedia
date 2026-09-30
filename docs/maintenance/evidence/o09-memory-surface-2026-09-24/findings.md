# The session's memory backend is a Cedia surface — 2026-09-24

This receipt records the O09 memory slice. OMP owns the memory backend and its two session states;
Cedia now shows which backend a session is on, what state it holds, and can re-apply it, without
ever publishing a memory row. Four SDK records move. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice: manifest sha
  `c31b97dc388a41819d7f7a3424eb92d1d54eaba86ed1a6aba71fea9d13c5f26a`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`).
- Runtime: new `packages/coding-agent/src/modes/rpc/cedia-memory-bridge.ts`; changed
  `.../rpc/{cedia-capability-bridge,rpc-mode,rpc-types}.ts`, new
  `test/cedia-memory-bridge.test.ts`, changed `test/cedia-capability-bridge.test.ts`.
- Cedia: new `apps/host/src/omp-memory.ts`, `apps/host/test/omp-memory.test.ts`,
  `scripts/omp-memory-smoke.ts`, `apps/macos/agent-window/test/cedia-memory*.test.*`; changed
  `apps/host/src/{service,router}.ts`, `apps/host/test/fixtures/fake-host.mjs`,
  `apps/macos/agent-window/src/cedia-adapter.ts`, vendor `lib/serverReactQuery.ts`,
  `components/chat/CediaContextSurface.tsx`, `routes/__root.tsx`,
  `packages/omp-adapter/test/cedia-capabilities.test.ts`,
  `scripts/{omp-capabilities-smoke,lib/omp-coverage,check-omp-coverage}.ts`.

## What changed

- **Memory stays OMP's, and only its shape crosses the wire.** `memory.get` answers the effective
  `memory.backend` from the runtime's own schema, plus a reduced view of whichever session state
  exists: Mnemopi's session id, retained-turn counter, first-turn recall flag, recall-target count
  and whether a global target exists; Hindsight's session id, bank id, bank count, tag counts,
  tag-match mode and retained-turn counter. It deliberately carries no `lastRecallSnippet`, no
  `mentalModelsSnippet` and no stored row - memory content is user data - and a backend with no live
  state simply has no block, which the panel renders as an absence rather than an empty object.
  A `memory.backend` value the schema does not define (a hand-edited config) reads as `off` rather
  than being guessed into another backend's state.
- **`memory.apply` is the runtime's own call.** It runs the session's `applyMemoryBackend()` -
  rebuilding runtime state, tools and the base prompt - and answers the state that follows with
  `applied: true`, so the panel never claims an apply it cannot show.
- **Owner-only routes.** `GET /v1/sessions/:id/memory` and
  `POST /v1/sessions/:id/memory/apply` with exactly `{ commandId, incarnation }`, through the
  durable command envelope (claim-before-dispatch, replay answers the same receipt). A strict parser
  refuses a bad backend word, a wrong field type, an unknown field inside a block and an `applied`
  that is not `true`; a session with no live runtime is `unavailable` with the runtime's own reason.
- **The Context panel gains a Memory section.** It names the runtime's backend, shows each present
  state block, says plainly when an active backend reports no live state, offers `Apply backend`
  (whose answer drives the display) and keeps the setting itself in the OMP settings destination -
  the same split between policy (this panel) and the writable setting that the credit policy uses.

## Evidence (this revision and build)

- `bun scripts/omp-memory-smoke.ts` → every check OK against the prepared `omp/18.1.18` with an
  unresponsive local fixture listener (no provider request can complete), including
  `an absent backend state stays absent in JSON`, `memory.apply answers the applied state beside the
  same backend`, `a repeated memory command id replays the same receipt` and `the memory routes are
  owner-only (401)`, final `{"ok":true,"version":"omp/18.1.18"}`.
- `bun test apps/host packages/omp-adapter` → 395 pass, 0 fail; `bun test apps/macos/agent-window/test`
  → 231 pass, 0 fail; `bun run --cwd apps/macos/agent-window typecheck` → exit 0.
- `cd upstream/omp && bun test packages/coding-agent/test/cedia-memory-bridge.test.ts` → 5 pass,
  including that a Mnemopi recall snippet and a Hindsight mental-model block are absent from the
  serialised projection.
- `bun scripts/omp-capabilities-smoke.ts` → every check OK; the available table now lists 29
  descriptors.
- `bun run check:omp-coverage` → integrity PASS, **109 → 106** records without a disposition. Three
  rows settled through the registered operations (`getMnemopiSessionState`, `getHindsightSessionState`,
  `applyMemoryBackend`) and one through a checked path (`retry`, carried by the `/retry` command the
  runtime's own `retry()` backs). The same pass corrected a mis-attribution: `/retry` was previously
  credited to `abortRetry`, but that command runs the session's `retry()`, so the carrier now names
  `retry` and `abortRetry` (the *cancel* of a scheduled retry, which Cedia has no separate control
  for) is listed as the gap it is. `bun test scripts/lib` → 76 pass, 0 fail.

## Limits

- No live memory backend ran: the smoke's session is on `backend: "off"`, so a populated Mnemopi or
  Hindsight state is proven by the runtime fixture rather than by a live backend. Remote-backend
  configuration (Hindsight's service, credentials, provisioning) stays an explicit owner action and
  was not exercised or configured.
- Memory `inspect/edit/clear` of individual rows is not a Cedia surface; OMP's own memory tools own
  that, and this panel deliberately shows state only.
- No packaged window was captured rendering the Memory section.
